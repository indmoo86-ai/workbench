import {realpath,stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {readProjectFile} from './project-file-read.mjs';
import {readError} from './node-query-recipes.mjs';

/** Directory device/inode/birth identity distinguishes replacement at the same canonical pathname. */
async function physicalDirectory(path){
  const canonical=await realpath(path),info=await stat(canonical,{bigint:true});
  if(!info.isDirectory()||canonical!==resolve(path))throw readError('source_workspace_mismatch');
  return {root:canonical,identity:{dev:String(info.dev),ino:String(info.ino),birthtime:String(info.birthtimeNs)}};
}
export async function inspectReadSource({db,descriptor,projectRoot,nodeId}){
  if(descriptor.sourceNodeId!==nodeId)throw readError('source_workspace_mismatch');
  if(descriptor.workspaceKind==='managed_run'){
    const owner=db.get('runs',descriptor.sourceRunId);
    if(!owner||owner.projectId!==descriptor.projectId||owner.nodeId!==nodeId||owner.workspace!==descriptor.workspaceRoot)throw readError('source_workspace_mismatch');
    const root=descriptor.scopeId==='project-files:'+descriptor.projectId?owner.workspace:owner.repositories?.find(r=>(r.id||r.repositoryId)===descriptor.scopeId)?.localRoot;
    if(!root||resolve(root)!==descriptor.root)throw readError('source_workspace_mismatch');
  }else if(descriptor.workspaceKind!=='bound_project')throw readError('source_workspace_mismatch');
  let scope,workspace;
  try{
    if(await projectRoot(descriptor.root)!==descriptor.root||await projectRoot(descriptor.workspaceRoot)!==descriptor.workspaceRoot)throw readError('source_workspace_mismatch');
    scope=await physicalDirectory(descriptor.root);workspace=await physicalDirectory(descriptor.workspaceRoot);
  }catch(error){if(error.code==='ENOENT')throw readError('source_workspace_missing');throw error;}
  return {projectId:descriptor.projectId,sourceNodeId:nodeId,sourceRunId:descriptor.sourceRunId||null,workspaceId:descriptor.workspaceId,scopeId:descriptor.scopeId,
    root:scope.root,workspaceRoot:workspace.root,bindingSnapshot:descriptor.bindingSnapshot,rootIdentity:scope.identity,workspaceIdentity:workspace.identity};
}

/** F reads one stable saved file, not a repository snapshot or a historical synchronization receipt. */
export async function readSourceCurrent({source,input,clock=()=>new Date()}){
  const verify=async()=>{
    try{
      const root=await physicalDirectory(source.root),workspace=await physicalDirectory(source.workspaceRoot);
      if(JSON.stringify(root.identity)!==JSON.stringify(source.proof.rootIdentity)||JSON.stringify(workspace.identity)!==JSON.stringify(source.proof.workspaceIdentity))throw readError('configuration_changed');
    }catch(error){if(error.code==='ENOENT')throw readError('source_workspace_missing');throw error;}
  };
  await verify();
  const captured=await readProjectFile({root:source.root,path:input.path,scopePolicy:source.scopePolicy,metadata:input.metadata});
  await verify();
  const entry=captured.entry,matched=Boolean(entry&&(!input.expectHash||input.expectHash===entry.hash));
  return {readSource:'source',sourceNodeId:source.sourceNodeId,readNodeId:source.sourceNodeId,workspaceId:source.workspaceId,generation:source.generation,scopeId:source.scopeId,scopeGeneration:source.scopeGeneration,
    relativePath:input.path,hash:entry?.hash||null,size:entry?.size??null,executable:entry?.executable??null,observedAt:clock().toISOString(),freshness:input.freshness,matched,
    preview:entry?(input.metadata?'metadata':captured.preview):'missing',content:matched&&!input.metadata?captured.content:null,...(entry&&!matched?{reason:'hash_mismatch'}:{}),proof:source.proof};
}
