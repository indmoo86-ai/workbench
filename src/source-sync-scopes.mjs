import {relative,isAbsolute,resolve} from 'node:path';
import {syncError} from './source-sync-manifest.mjs';

export const projectFileScopeId=projectId=>`project-files:${projectId}`;
export const isProjectFileScope=(projectId,id)=>id===projectFileScopeId(projectId);
const beneath=(root,path)=>{const rel=relative(root,path);return !isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('../')?rel:null;};

/** Resolve only registered project/repository bindings; filesystem scopes never masquerade as Git repositories. */
export function sourceScopeBinding(db,projectId,repositoryId,nodeId){
  if(isProjectFileScope(projectId,repositoryId))return db.get('workspaces',`${projectId}:${nodeId}`);
  if(db.get('repositories',repositoryId)?.projectId!==projectId)return null;
  return db.get('repositoryWorkspaces',`${repositoryId}:${nodeId}`);
}

/** Partition container/repository layouts so each physical file has exactly one receiving scope. */
export function buildSourceBindings(db,projectId,repositoryIds,nodeIds,{scopeKind}={}){
  const directory=scopeKind==='directory',withProject=repositoryIds.includes(projectFileScopeId(projectId));
  const bindings=repositoryIds.flatMap(repositoryId=>nodeIds.map(nodeId=>{
    const projectScope=isProjectFileScope(projectId,repositoryId),binding=sourceScopeBinding(db,projectId,repositoryId,nodeId),worker=db.get('workers',nodeId),repo=db.get('repositories',repositoryId);
    if(projectScope&&!directory)throw syncError('invalid_scope');
    if(worker?.capabilities?.sourceSync!==1||directory&&worker.capabilities.sourceSyncDirectory!==1)throw syncError('worker_unsupported',nodeId);
    if(binding?.projectId!==projectId||!binding.localRoot)throw syncError('binding_missing');
    if(binding.readOnly||repo?.readOnly)throw syncError('scope_read_only');
    const root=resolve(binding.localRoot);
    if(directory&&db.listProject('runs',projectId).some(r=>r.nodeId===nodeId&&r.execution?.isolated&&(r.workspace===root||r.repositories?.some(repo=>repo.localRoot===root))))throw syncError('deliver_to_project_first');
    if(!directory)return {repositoryId,nodeId,root,repoUrl:repo.repoUrl};
    const projectRoot=db.get('workspaces',`${projectId}:${nodeId}`)?.localRoot;
    const others=db.list('repositoryWorkspaces').filter(b=>b.projectId===projectId&&b.nodeId===nodeId&&b.repositoryId!==repositoryId&&b.localRoot);
    const excludeRoots=others.map(b=>beneath(root,resolve(b.localRoot))).filter(p=>p!==null);
    if(!projectScope&&withProject&&projectRoot&&resolve(projectRoot)!==root){const rel=beneath(root,resolve(projectRoot));if(rel!==null)excludeRoots.push(rel);}
    const scopePolicy={sharedDocs:projectScope,excludeRoots:[...new Set(excludeRoots)].sort()};
    if(!projectScope&&scopePolicy.excludeRoots.includes(''))throw syncError('overlapping_scope');
    return {repositoryId,nodeId,root,repoUrl:repo?.repoUrl||null,scopeKind:'directory',scopePolicy};
  }));
  // Different container layouts still need one common exclusion policy for each logical scope.
  if(directory)for(const repositoryId of repositoryIds){
    const peers=bindings.filter(b=>b.repositoryId===repositoryId),excludeRoots=[...new Set(peers.flatMap(b=>b.scopePolicy.excludeRoots))].sort();
    for(const b of peers)b.scopePolicy={...b.scopePolicy,excludeRoots};
  }
  return bindings;
}
