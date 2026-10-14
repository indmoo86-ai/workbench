import {normalizeFileRead,normalizeReadQuery,normalizeReadSelector,readObject,readId,readError,READ_RECIPE_IDS,READ_QUERY_LIMITS} from './node-query-recipes.mjs';
import {resolveReadSource,registerReadSource,readSourceStillCurrent} from './read-source-bindings.mjs';
import {reviewView,reviewSourceFileAllowed} from './collaboration-sessions.mjs';
import {validateEntry,validateSourcePath,contentHash} from './source-sync-manifest.mjs';
import {budgetReadReply,READ_REPLY_BYTES} from './read-query-response.mjs';
import {beginReadOperation,saveReadResult,replayReadResult} from './read-result-replay.mjs';

const safeCode=error=>typeof error?.code==='string'&&/^[a-z_]{1,64}$/.test(error.code)?error.code:'read_failed';
const selector=input=>input.params?{...input.params,sourceNodeId:input.sourceNodeId}:input;
const reviewPath=path=>path?.startsWith('.workbench/')?path.slice('.workbench/'.length):path;
const proofKeys=['projectId','sourceNodeId','sourceRunId','workspaceId','scopeId','root','workspaceRoot','bindingSnapshot','rootIdentity','workspaceIdentity'];
function validateProof(proof,source){
  readObject(proof,proofKeys);
  for(const key of proofKeys.filter(k=>!k.endsWith('Identity')))if(proof[key]!==source[key])throw readError('invalid_read_reply');
  for(const key of ['rootIdentity','workspaceIdentity'])readObject(proof[key],['dev','ino','birthtime']);
}

/** Home owns grants/review/replay; Workers own the actual source facts. Neither path touches task state. */
export class CrossDeviceRead{
  constructor({db,query,online=()=>false,clock=()=>new Date()}){Object.assign(this,{db,workerQuery:query,online,clock});this.inflight=new Map();}
  configuration(projectId){
    if(!this.db.get('projects',projectId))throw readError('denied');
    return this.db.get('projectReadAccess',projectId)||{id:projectId,version:0,enabled:false,nodeIds:[],scopeIds:[],recipeIds:[]};
  }
  updateConfiguration(projectId,input){
    readObject(input,['id','version','enabled','nodeIds','scopeIds','recipeIds']);
    if(input.id!==undefined&&input.id!==projectId||typeof input.enabled!=='boolean')throw readError('invalid_read_request');
    for(const field of ['nodeIds','scopeIds','recipeIds']){
      if(!Array.isArray(input[field])||input[field].length>100||new Set(input[field]).size!==input[field].length)throw readError('invalid_read_request');
      input[field].forEach(readId);
    }
    if(input.recipeIds.some(id=>!READ_RECIPE_IDS.includes(id))||input.nodeIds.some(id=>!this.db.get('workers',id))||
      input.scopeIds.some(id=>id!=='project-files:'+projectId&&this.db.get('repositories',id)?.projectId!==projectId))throw readError('invalid_read_request');
    return this.db.transaction(()=>{
      const old=this.configuration(projectId);if(input.version!==old.version)throw readError('configuration_changed');
      return this.db.put('projectReadAccess',{id:projectId,version:old.version+1,enabled:input.enabled,nodeIds:input.nodeIds,scopeIds:input.scopeIds,recipeIds:input.recipeIds});
    });
  }
  authorize(caller,input,operation){
    const run=this.db.get('runs',caller?.id);
    if(!run||run.projectId!==caller.projectId||!['starting','running'].includes(run.status)||run.switchOperationId||this.db.get('tasks',run.taskId)?.currentRunId!==run.id)throw readError('denied');
    if(this.db.listProject('terminalSessions',run.projectId).some(s=>s.nodeId===run.nodeId&&!['released','cancelled'].includes(s.status)))throw readError('denied');
    const selected=selector(input),config=this.configuration(run.projectId);
    if(!config.enabled||!config.nodeIds.includes(selected.sourceNodeId)||!config.scopeIds.includes(selected.scopeId)||operation==='query'&&!config.recipeIds.includes(input.recipeId))throw readError('denied');
    const view=reviewView(this.db,{projectId:run.projectId,roleId:run.roleId});
    const sourceRunId=selected.sourceWorkspace.sourceRunId;
    if(sourceRunId&&view.get('runs',sourceRunId)?.reviewRedacted)throw readError('denied');
    if(operation==='file'&&!reviewSourceFileAllowed(this.db,run,{sourceNodeId:selected.sourceNodeId,reviewPath:reviewPath(input.path),scopeId:selected.scopeId,sourceRunId,preflight:true}))throw readError('denied');
    return {run,config};
  }
  inspect(run,input){
    readObject(input,['requestId','sourceNodeId','sourceWorkspace','scopeId']);
    return this.execute(run,'inspect',{requestId:readId(input.requestId),...normalizeReadSelector(input)});
  }
  query(run,input){return this.execute(run,'query',normalizeReadQuery(input));}
  read(run,input){return this.execute(run,'file',normalizeFileRead(input));}
  replay(run,operationId,input,operation){
    this.authorize(run,input,operation);
    const replay=replayReadResult(this.db,run,operationId);
    if(operation==='file'&&!replay.result.error&&!reviewSourceFileAllowed(this.db,run,{sourceNodeId:input.sourceNodeId,reviewPath:reviewPath(input.path),hash:replay.result.hash,scopeId:input.scopeId,sourceRunId:input.sourceWorkspace.sourceRunId}))throw readError('denied');
    return replay;
  }
  async execute(caller,operation,input){
    const {run,config}=this.authorize(caller,input,operation);
    const attempt=beginReadOperation(this.db,run,operation,input);
    if(attempt.replayed){
      const pending=this.inflight.get(attempt.operationId);if(pending)await pending;
      return this.replay(run,attempt.operationId,input,operation);
    }
    const pending=this.perform(run,config,operation,input,attempt.operationId);
    this.inflight.set(attempt.operationId,pending);
    try{return await pending;}finally{this.inflight.delete(attempt.operationId);}
  }
  async perform(run,config,operation,input,operationId){
    let result;
    try{
      const selection=selector(input),source=resolveReadSource(this.db,run,selection),worker=this.db.get('workers',source.sourceNodeId);
      if(!this.online(source.sourceNodeId))throw readError('source_offline');
      if(worker?.capabilities?.readSourceBindings!==1||operation==='file'&&(worker.capabilities.fileReadFreshness!==1||!worker.capabilities.fileReadModes?.includes(input.freshness))||operation==='query'&&worker.capabilities.queryRecipes!==1)throw readError('unsupported');
      if(operation!=='inspect'&&!selection.sourceWorkspace.workspaceId)throw readError('source_identity_required');
      const target={id:run.id,nodeId:source.sourceNodeId};
      const proof=await this.workerQuery(target,'source_inspect',{source},READ_QUERY_LIMITS.timeoutMs);
      validateProof(proof,source);
      this.authorize(run,input,operation);
      const current=resolveReadSource(this.db,run,selection);if(current.bindingSnapshot!==source.bindingSnapshot)throw readError('configuration_changed');
      const registered=registerReadSource(this.db,source,proof);
      if(selection.sourceWorkspace.generation!==undefined&&selection.sourceWorkspace.generation!==registered.generation)throw readError('configuration_changed');
      if(operation==='inspect')result={workspaceId:source.workspaceId,generation:registered.generation,scopeId:source.scopeId,scopeGeneration:registered.scopeGeneration,sourceNodeId:source.sourceNodeId,workspaceKind:source.workspaceKind,observedAt:this.clock().toISOString()};
      else{
        const prepared={...source,...registered,proof};
        result=await this.workerQuery(target,operation==='file'?'source_read':'read_query',{source:prepared,input},READ_QUERY_LIMITS.timeoutMs);
        try{readObject(result,operation==='file'?['readSource','sourceNodeId','readNodeId','workspaceId','generation','scopeId','scopeGeneration','relativePath','hash','size','executable','observedAt','freshness','matched','preview','content','reason','proof']:
          ['recipeId','recipeVersion','sourceNodeId','observedAt','items','state','partial','truncated','workspaceId','generation','scopeId','scopeGeneration','proof']);}
        catch{throw readError('invalid_read_reply');}
        if(Buffer.byteLength(JSON.stringify({type:'reply',id:operationId,result}))>READ_REPLY_BYTES)throw readError('invalid_read_reply');
        for(const key of ['sourceNodeId','workspaceId','generation','scopeId','scopeGeneration'])if(result?.[key]!==prepared[key])throw readError('invalid_read_reply');
        if(typeof result.observedAt!=='string'||!Number.isFinite(Date.parse(result.observedAt))||JSON.stringify(result.proof)!==JSON.stringify(proof))throw readError('invalid_read_reply');
        if(operation==='file'){
          if(result.readNodeId!==source.sourceNodeId||result.readSource!=='source'||result.relativePath!==input.path||result.freshness!==input.freshness)throw readError('invalid_read_reply');
          validateSourcePath(result.relativePath,source.scopePolicy);
          if(!['text','metadata','binary','too_large','missing'].includes(result.preview))throw readError('invalid_read_reply');
          if(result.hash!==null)validateEntry(result);
          else if(result.preview!=='missing'||result.size!==null||result.executable!==null)throw readError('invalid_read_reply');
          if(result.preview==='text'){
            if(typeof result.content!=='string'||contentHash(Buffer.from(result.content))!==result.hash||Buffer.byteLength(result.content)!==result.size)throw readError('invalid_read_reply');
          }else if(result.content!==null)throw readError('invalid_read_reply');
          if(result.matched!==Boolean(result.hash&&(!input.expectHash||input.expectHash===result.hash)))throw readError('invalid_read_reply');
          if(!reviewSourceFileAllowed(this.db,run,{sourceNodeId:source.sourceNodeId,reviewPath:reviewPath(input.path),hash:result.hash,scopeId:source.scopeId,sourceRunId:source.sourceRunId}))throw readError('denied');
        }else{
          if(result.recipeId!==input.recipeId||result.recipeVersion!==1||!Array.isArray(result.items)||result.items.length>100||Buffer.byteLength(JSON.stringify(result))>READ_QUERY_LIMITS.bytes)throw readError('invalid_read_reply');
          try{
            if(typeof result.partial!=='boolean'||typeof result.truncated!=='boolean')throw readError('invalid_read_reply');
            for(const item of result.items){
              readObject(item,input.recipeId==='workspace_check'?['exists','git']:['pid','verified','idle','state']);
              if(input.recipeId==='workspace_check'){
                if(typeof item.exists!=='boolean')throw readError('invalid_read_reply');
                if(item.git){readObject(item.git,['head','branch']);if(!/^[a-f0-9]{40,64}$/.test(item.git.head)||typeof item.git.branch!=='string'||item.git.branch.length>200)throw readError('invalid_read_reply');}
              }else if(!Number.isSafeInteger(item.pid)||item.pid<1||typeof item.verified!=='boolean'||typeof item.idle!=='boolean'||!['idle','unconfirmed','unknown'].includes(item.state))throw readError('invalid_read_reply');
            }
          }catch{throw readError('invalid_read_reply');}
        }
        if(!readSourceStillCurrent(this.db,run,source,proof))throw readError('configuration_changed');
        // Root proof is private control metadata, not an Agent-visible path or error detail.
        const {proof:privateProof,...visible}=result;result=visible;
      }
      this.authorize(run,input,operation);
      if(this.configuration(run.projectId).version!==config.version)throw readError('configuration_changed');
    }catch(error){result={error:safeCode(error),observedAt:null};}
    const bounded=budgetReadReply({id:operationId,result},{maxBytes:READ_REPLY_BYTES-2048}).message;
    if(bounded.error)result={error:bounded.error,observedAt:null};else result=bounded.result;
    saveReadResult(this.db,operationId,result);
    this.authorize(run,input,operation);
    return {operationId,replayed:false,result};
  }
}
