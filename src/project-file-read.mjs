import {join} from 'node:path';
import {captureDirectorySnapshot,readSourceFile} from './source-sync-files.mjs';
import {syncError} from './source-sync-manifest.mjs';

/** Home supplies registered scope mappings; stable file access reuses the sync filesystem boundary. */
export async function readProjectFile({root,path,scopePolicy,metadata=false}){
  const captured=await readSourceFile(root,path,scopePolicy);
  if(!captured.entry)return {relativePath:path,path:null,entry:null,content:null};
  const common={relativePath:path,path:join(root,path),entry:captured.entry,size:captured.entry.size};if(metadata)return common;
  if(captured.bytes.length>600000)return {...common,preview:'too_large',content:null};
  const content=captured.bytes.toString('utf8');if(captured.bytes.includes(0)||!Buffer.from(content).equals(captured.bytes))return {...common,preview:'binary',content:null};
  return {...common,preview:'text',content};
}

/** Inventory comes from the real workspace independently of Run history, with explicit truncation. */
export async function listProjectFiles({root,scopePolicy,limit=200}){
  if(!Number.isSafeInteger(limit)||limit<1||limit>200)throw syncError('invalid_page');
  const snapshot=await captureDirectorySnapshot({root,scopePolicy}),paths=Object.keys(snapshot.entries).sort((a,b)=>Number(b.startsWith('.workbench/docs/'))-Number(a.startsWith('.workbench/docs/'))||a.localeCompare(b));
  return {items:paths.slice(0,limit).map(path=>({relativePath:path,path:join(root,path),entry:snapshot.entries[path],size:snapshot.entries[path].size})),partial:paths.length>limit,total:paths.length};
}
