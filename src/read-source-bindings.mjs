import {relative,isAbsolute,resolve} from 'node:path';
import {contentHash} from './source-sync-manifest.mjs';
import {projectFileScopeId,sourceScopeBinding} from './source-sync-scopes.mjs';
import {normalizeReadSelector,readError} from './node-query-recipes.mjs';

const childPath=(root,path)=>{const rel=relative(root,path);return !isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('../')?rel:null;};
const fingerprint=value=>contentHash(JSON.stringify(value));
const rootOf=b=>b?.localRoot||b?.workspace;
const repositoryId=b=>b.repositoryId||b.id;

/** Resolve source ownership from Home records only; managed sources never fall back to ordinary roots. */
export function resolveReadSource(db,callerRun,input){
  const selector=normalizeReadSelector(input),{sourceNodeId,sourceWorkspace,scopeId}=selector,projectId=callerRun.projectId;
  if(!db.get('projects',projectId)||!db.get('workers',sourceNodeId))throw readError('source_workspace_mismatch');
  const projectScope=scopeId===projectFileScopeId(projectId);
  if(!projectScope&&db.get('repositories',scopeId)?.projectId!==projectId)throw readError('source_workspace_mismatch');
  let binding,workspaceRoot,sourceRunId=null,owner,layout;
  if(sourceWorkspace.kind==='managed_run'){
    sourceRunId=sourceWorkspace.sourceRunId;owner=db.get('runs',sourceRunId);
    if(!owner||owner.projectId!==projectId||owner.nodeId!==sourceNodeId)throw readError('source_workspace_mismatch');
    if(!owner.workspace)throw readError('source_workspace_missing');
    workspaceRoot=owner.workspace;layout=owner.repositories||[];
    binding=projectScope?{localRoot:workspaceRoot}:layout.find(b=>repositoryId(b)===scopeId);
    if(!rootOf(binding))throw readError('source_workspace_missing');
  }else{
    owner=db.get('workspaces',`${projectId}:${sourceNodeId}`);
    workspaceRoot=owner?.localRoot;
    binding=sourceScopeBinding(db,projectId,scopeId,sourceNodeId);
    layout=db.listProject('repositoryWorkspaces',projectId).filter(b=>b.nodeId===sourceNodeId);
    if(binding?.projectId!==projectId||binding.nodeId!==sourceNodeId||!workspaceRoot||!rootOf(binding))throw readError('source_workspace_missing');
  }
  const root=resolve(rootOf(binding));workspaceRoot=resolve(workspaceRoot);
  const excludeRoots=[...new Set(layout.filter(b=>repositoryId(b)!==scopeId&&rootOf(b)).map(b=>childPath(root,resolve(rootOf(b)))).filter(p=>p!==null))].sort();
  if(!projectScope&&excludeRoots.includes(''))throw readError('source_workspace_mismatch');
  const scopePolicy={sharedDocs:projectScope,excludeRoots};
  const workspaceId='read:'+fingerprint([projectId,sourceNodeId,sourceWorkspace.kind,owner.workspaceRunId||sourceRunId||projectId]).slice(0,40);
  const bindingSnapshot=fingerprint({root,workspaceRoot,scopeId,scopePolicy,owner:sourceRunId?{id:owner.workspaceRunId||owner.id}:owner,
    binding:sourceRunId?{root,repositoryId:binding.repositoryId||null}:binding});
  const descriptor={projectId,sourceNodeId,sourceRunId,workspaceKind:sourceWorkspace.kind,workspaceId,scopeId,root,workspaceRoot,scopePolicy,bindingSnapshot};
  if(sourceWorkspace.workspaceId!==undefined){
    const registered=db.get('readWorkspaceBindings',workspaceId+':'+scopeId);
    if(sourceWorkspace.workspaceId!==workspaceId||!registered||registered.generation!==sourceWorkspace.generation||registered.bindingSnapshot!==bindingSnapshot)throw readError('configuration_changed');
  }
  return descriptor;
}

/** Only an authenticated device's canonical physical proof can bootstrap or advance read generations. */
export function registerReadSource(db,descriptor,proof){
  for(const key of ['projectId','sourceNodeId','workspaceId','scopeId','root','workspaceRoot','bindingSnapshot'])if(proof?.[key]!==descriptor[key])throw readError('source_workspace_mismatch');
  if((proof.sourceRunId||null)!==descriptor.sourceRunId)throw readError('source_workspace_mismatch');
  for(const identity of [proof.rootIdentity,proof.workspaceIdentity])if(!identity||['dev','ino','birthtime'].some(k=>typeof identity[k]!=='string'||!identity[k]||identity[k].length>100))throw readError('source_workspace_mismatch');
  const proofHash=fingerprint(proof),id=descriptor.workspaceId+':'+descriptor.scopeId;
  return db.transaction(()=>{
    const previous=db.get('readWorkspaceBindings',id),changed=!previous||previous.proofHash!==proofHash;
    const generation=(previous?.generation||0)+(changed?1:0);
    const result={id,...descriptor,generation,scopeGeneration:generation,bindingVersion:proofHash,proofHash};
    if(changed)db.put('readWorkspaceBindings',result);
    return result;
  });
}

/** Re-resolve after every await; this compares identities, not a historical directory catalogue. */
export function readSourceStillCurrent(db,callerRun,descriptor,proof){
  try{
    const current=resolveReadSource(db,callerRun,{sourceNodeId:descriptor.sourceNodeId,sourceWorkspace:{kind:descriptor.workspaceKind,...(descriptor.sourceRunId?{sourceRunId:descriptor.sourceRunId}:{})},scopeId:descriptor.scopeId});
    const registered=db.get('readWorkspaceBindings',descriptor.workspaceId+':'+descriptor.scopeId);
    return current.bindingSnapshot===descriptor.bindingSnapshot&&registered?.proofHash===fingerprint(proof);
  }catch{return false;}
}
