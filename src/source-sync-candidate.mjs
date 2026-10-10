import {captureSourceSnapshot,readSourceFile,saveSourceBlob} from './source-sync-files.mjs';
import {entryEqual,validateSourcePath,manifestDigest,syncError} from './source-sync-manifest.mjs';

/** Compare the whole eligible repository against the pinned repair input, not a model-provided file list. */
export async function captureSourceCandidate({root,path,baseline,blobRoot}) {
  validateSourcePath(path);if(manifestDigest(baseline.entries)!==baseline.digest)throw syncError('source_input_changed');
  const captured=await captureSourceSnapshot({root,repositoryId:baseline.repositoryId,expectedHead:baseline.baseCommit,blobRoot});
  const changedPaths=[...new Set([...Object.keys(baseline.entries),...Object.keys(captured.entries)])].sort().filter(p=>!entryEqual(Object.hasOwn(baseline.entries,p)?baseline.entries[p]:null,Object.hasOwn(captured.entries,p)?captured.entries[p]:null));
  return {entry:Object.hasOwn(captured.entries,path)?captured.entries[path]:null,changedPaths,manifestHash:captured.digest};
}

/** Directory conflicts propose only this file's stable bytes, not a whole Git delivery. */
export async function captureDirectoryCandidate({root,path,scopePolicy,blobRoot,assignmentId}) {
  const first=await readSourceFile(root,path,scopePolicy),second=await readSourceFile(root,path,scopePolicy);
  if(!entryEqual(first.entry,second.entry))throw syncError('source_busy');
  if(second.bytes)await saveSourceBlob(blobRoot,second.bytes);
  return {scopeKind:'directory',root,path,entry:second.entry,changedPaths:[path],baselineManifestId:assignmentId};
}
