import {contentHash} from './source-sync-manifest.mjs';
import {readError} from './node-query-recipes.mjs';
import {READ_REPLY_BYTES} from './read-query-response.mjs';

export const READ_RESULT_STORAGE_BYTES=32*1024*1024;
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
const usage=db=>db.get('readStorageUsage','home')||{id:'home',usedBytes:0,reservedBytes:0};
const owner=(run,operation)=>operation?.projectId===run.projectId&&operation.runId===run.id;

/** Reserve once, before dispatch; retries never consume another slot or acquire a new observation. */
export function beginReadOperation(db,run,operation,input){
  const operationId=contentHash(JSON.stringify([run.projectId,run.id,operation,input.requestId])),inputHash=contentHash(JSON.stringify(canonical(input)));
  return db.transaction(()=>{
    const previous=db.get('readOperations',operationId);
    if(previous){if(previous.inputHash!==inputHash)throw readError('request_conflict');return {...previous,operationId,replayed:true};}
    const used=usage(db);
    if(used.usedBytes+used.reservedBytes+READ_REPLY_BYTES>READ_RESULT_STORAGE_BYTES)throw readError('read_storage_full');
    if(db.readResultFreeBytes()<READ_REPLY_BYTES*3)throw readError('insufficient_disk');
    db.put('readStorageUsage',{...used,reservedBytes:used.reservedBytes+READ_REPLY_BYTES});
    const record={id:operationId,projectId:run.projectId,runId:run.id,operation,requestId:input.requestId,input,inputHash,state:'pending',reservedBytes:READ_REPLY_BYTES};
    db.put('readOperations',record);return {...record,operationId,replayed:false};
  });
}

/** Persist the bounded original and settle its reservation atomically before an HTTP success exists. */
export function saveReadResult(db,operationId,result){
  const original=db.get('readOperations',operationId);if(!original)throw readError('read_result_unavailable');
  const record={id:operationId,projectId:original.projectId,runId:original.runId,result},serializedBytes=Buffer.byteLength(JSON.stringify(record),'utf8');
  if(serializedBytes>READ_REPLY_BYTES)throw readError('response_too_large');
  return db.transaction(()=>{
    const operation=db.get('readOperations',operationId);
    if(operation.state==='complete'){if(!db.get('readResults',operationId))throw readError('read_result_unavailable');return {operationId};}
    if(operation.reservedBytes!==READ_REPLY_BYTES)throw readError('read_result_unavailable');
    const used=usage(db);
    db.put('readResults',record);
    db.put('readOperations',{...operation,state:'complete',reservedBytes:0,resultBytes:serializedBytes});
    db.put('readStorageUsage',{...used,reservedBytes:used.reservedBytes-READ_REPLY_BYTES,usedBytes:used.usedBytes+serializedBytes});
    return {operationId};
  });
}
export function replayReadResult(db,run,operationId){
  const operation=db.get('readOperations',operationId);
  if(!owner(run,operation))throw readError('denied');
  const saved=db.get('readResults',operationId);
  if(operation.state!=='complete'||!saved||!owner(run,saved))throw readError('read_result_unavailable');
  return {operationId,replayed:true,replayedAt:new Date().toISOString(),result:saved.result};
}
