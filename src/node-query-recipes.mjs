import {validateSourcePath} from './source-sync-manifest.mjs';

export const READ_QUERY_LIMITS=Object.freeze({timeoutMs:5000,rows:100,bytes:262144});
export const READ_RECIPE_IDS=Object.freeze(['workspace_check','cli_session_check']);
export const readError=code=>Object.assign(new Error(code),{code});

/** Strict schemas are the action boundary; a read request never carries executable options. */
export function readObject(value,keys){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)))throw readError('invalid_read_request');
  return value;
}
export function readId(value){
  if(typeof value!=='string'||!value||value.length>200||!/^[a-zA-Z0-9_.:-]+$/.test(value))throw readError('invalid_read_request');
  return value;
}
export function normalizeReadWorkspace(value){
  readObject(value,['kind','sourceRunId','workspaceId','generation']);
  if(!['bound_project','managed_run'].includes(value.kind))throw readError('invalid_read_request');
  if(value.kind==='managed_run')readId(value.sourceRunId);
  else if(value.sourceRunId!==undefined)throw readError('invalid_read_request');
  if(value.workspaceId!==undefined||value.generation!==undefined){
    readId(value.workspaceId);
    if(!Number.isSafeInteger(value.generation)||value.generation<1)throw readError('invalid_read_request');
  }
  return {kind:value.kind,...(value.sourceRunId?{sourceRunId:value.sourceRunId}:{}),...(value.workspaceId?{workspaceId:value.workspaceId,generation:value.generation}:{})};
}
export function normalizeReadSelector(input){
  return {sourceNodeId:readId(input.sourceNodeId),sourceWorkspace:normalizeReadWorkspace(input.sourceWorkspace),scopeId:readId(input.scopeId)};
}
export function normalizeReadQuery(input){
  readObject(input,['requestId','sourceNodeId','recipeId','recipeVersion','params','freshness']);
  if(!READ_RECIPE_IDS.includes(input.recipeId)||input.recipeVersion!==1)throw readError('unsupported');
  if(input.freshness!==undefined&&input.freshness!=='source_current')throw readError('unsupported');
  readObject(input.params,['sourceWorkspace','scopeId']);
  const source=normalizeReadSelector({...input.params,sourceNodeId:input.sourceNodeId});
  if(input.recipeId==='cli_session_check'&&source.sourceWorkspace.kind!=='managed_run')throw readError('invalid_read_request');
  return {requestId:readId(input.requestId),sourceNodeId:source.sourceNodeId,recipeId:input.recipeId,recipeVersion:1,params:{sourceWorkspace:source.sourceWorkspace,scopeId:source.scopeId},freshness:'source_current'};
}
export function normalizeFileRead(input){
  readObject(input,['requestId','sourceNodeId','sourceWorkspace','scopeId','path','freshness','expectHash','metadata']);
  const freshness=input.freshness??'source_current';
  if(!['source_current','expected_version'].includes(freshness))throw readError('unsupported');
  if(freshness==='expected_version'||input.expectHash!==undefined){
    if(typeof input.expectHash!=='string'||!/^[a-f0-9]{64}$/.test(input.expectHash))throw readError('invalid_read_request');
  }
  if(input.metadata!==undefined&&typeof input.metadata!=='boolean')throw readError('invalid_read_request');
  return {requestId:readId(input.requestId),...normalizeReadSelector(input),path:validateSourcePath(input.path,{sharedDocs:true}),freshness,
    ...(input.expectHash!==undefined?{expectHash:input.expectHash}:{}),metadata:input.metadata??false};
}
