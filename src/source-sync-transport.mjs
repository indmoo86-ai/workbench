import {timingSafeEqual} from 'node:crypto';
import {join} from 'node:path';
import {SourceSync} from './source-sync.mjs';
import {SourceSyncStorage} from './source-sync-storage.mjs';
import {SourceSyncWorker} from './source-sync-worker.mjs';
import {SourceSyncConflicts} from './source-sync-conflicts.mjs';
import {SourceSyncAgent} from './source-sync-agent.mjs';
import {runtimeIssue} from './runtime-probe.mjs';
import {validateSourceCapture,syncError,contentHash} from './source-sync-manifest.mjs';
import {sourceScopeBinding} from './source-sync-scopes.mjs';
import {SourceSyncWatch} from './source-sync-watch.mjs';
import {saveSourceBlob,readSourceBlob} from './source-sync-files.mjs';

const json=(res,value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
const matches=(a,b)=>typeof a==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
async function body(req,limit=64*1024*1024){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>limit)throw syncError('request_too_large');chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString());}
const entries=bundle=>[...Object.values(bundle.base.entries),...Object.values(bundle.manifest.entries)].filter(Boolean);

/** The existing Home listener transports content; scoped transfer credentials never enter model input. */
export class SourceSyncHome {
  constructor({db,data,online,socket,change,rooms,query}){Object.assign(this,{db,online,socket,change});this.sync=new SourceSync({db,online,change});this.storage=new SourceSyncStorage({db,root:join(data,'source-sync')});this.ticking=false;
    this.conflicts=new SourceSyncConflicts({db,rooms,sync:this.sync,reachability:role=>online(role.nodeId)&&db.get('workers',role.nodeId)?.capabilities?.sourceSyncTools===1&&!runtimeIssue(db.get('workers',role.nodeId),role.runtime,role.model)});
    this.agent=new SourceSyncAgent({db,sync:this.sync,conflicts:this.conflicts,storage:this.storage,query});
  }
  busy(projectId,nodeId){return this.db.listSourceSyncCommands({projectId,nodeId,action:'apply',pending:true}).length>0;}
  async tick(){if(this.ticking)return;this.ticking=true;try{
    this.watchTick();
    this.conflicts.tick();
    for(const c of this.sync.schedule()){
      const socket=this.socket(c.nodeId);if(!socket?.workerReady||socket.readyState!==1)continue;
      if(c.lastSentAt&&Date.now()-Date.parse(c.lastSentAt)<5000)continue;
      const binding=sourceScopeBinding(this.db,c.projectId,c.repositoryId,c.nodeId);
      if(c.scopeKind==='directory'){
        const batch=this.db.get('sourceSyncBatches',c.batchId);
        try{const current=this.sync.bindings(c.projectId,batch.repositoryIds,batch.nodeIds,batch).find(b=>b.repositoryId===c.repositoryId&&b.nodeId===c.nodeId);
          if(!current||current.root!==c.root||JSON.stringify(current.scopePolicy)!==JSON.stringify(c.scopePolicy))throw syncError('binding_changed');
        }catch(e){this.sync.acceptReceipt(c.nodeId,{commandId:c.id,result:{status:'blocked',reason:e.code||'binding_changed'}});continue;}
      }
      const source=c.sourceRunId?this.db.get('runs',c.sourceRunId):null,expectedRoot=source?.repositories?.find(r=>r.id===c.repositoryId)?.localRoot;
      const origin=this.db.get('sourceSyncBatches',c.batchId)?.actor?.runId;
      if(origin&&['failed','interrupted'].includes(this.db.get('runs',origin)?.status)){this.sync.acceptReceipt(c.nodeId,{commandId:c.id,result:{status:'blocked',reason:'source_run_failed'}});continue;}
      if(!this.db.get('projects',c.projectId)||(c.sourceRunId?(source?.projectId!==c.projectId||source.nodeId!==c.nodeId||expectedRoot!==c.root):binding?.localRoot!==c.root)){this.sync.acceptReceipt(c.nodeId,{commandId:c.id,result:{status:'blocked',reason:'binding_changed'}});continue;}
      this.db.put('sourceSyncCommands',{...c,lastSentAt:new Date().toISOString()});
      if(['cancelling','blocked'].includes(this.db.get('sourceSyncBatches',c.batchId)?.status)){socket.send(JSON.stringify({type:'source_sync_cancel',commandId:c.id}));continue;}
      socket.send(JSON.stringify({type:'source_sync_command',commandId:c.id,batchId:c.batchId,projectId:c.projectId,secret:c.secret}));
    }
  }finally{this.ticking=false;}}
  /** Persist each observation once and coalesce later saves; file notifications never invoke a model. */
  watchTick(){
    const configs=this.db.list('sourceSyncConfigs').filter(c=>c.enabled&&c.scopeKind==='directory'&&c.mode==='continuous');
    for(const worker of this.db.list('workers').filter(w=>w.capabilities?.sourceSyncDirectory===1)){
      const socket=this.socket(worker.id);if(!socket?.workerReady||socket.readyState!==1)continue;
      const scopes=configs.flatMap(c=>c.bindings.filter(b=>b.nodeId===worker.id&&sourceScopeBinding(this.db,c.projectId,b.repositoryId,b.nodeId)?.localRoot===b.root).map(b=>({...b,projectId:c.projectId,generation:c.generation})));
      const version=contentHash(JSON.stringify(scopes));
      if(socket.sourceWatchAck!==version&&(!socket.sourceWatchSent||Date.now()-socket.sourceWatchSent>5000)){socket.sourceWatchSent=Date.now();socket.send(JSON.stringify({type:'source_sync_watch_config',version,scopes}));}
    }
    if(this.db.get('settings','main')?.paused)return;
    for(const config of configs){
      const notices=this.db.listProject('sourceSyncWatchNotices',config.projectId).filter(n=>n.generation===config.generation&&!n.handled);
      for(const n of notices.filter(n=>n.batchId)){
        const batch=this.db.get('sourceSyncBatches',n.batchId);
        if(['completed','partial_conflict'].includes(batch?.status))this.db.put('sourceSyncWatchNotices',{...n,handled:true});
        else if(['blocked','cancelled'].includes(batch?.status)&&Date.now()-Date.parse(n.queuedAt)>30000)this.db.put('sourceSyncWatchNotices',{...n,batchId:null});
      }
      if(this.db.listProject('sourceSyncBatches',config.projectId).some(b=>!['completed','partial_conflict','blocked','cancelled','preview_ready','evidence_ready'].includes(b.status)))continue;
      const pending=this.db.listProject('sourceSyncWatchNotices',config.projectId).filter(n=>n.generation===config.generation&&!n.handled&&!n.batchId);if(!pending.length)continue;
      const sourceNodeId=config.nodeIds.includes(pending[0].nodeId)?pending[0].nodeId:config.nodeIds[0];
      try{const batch=this.sync.request(config.projectId,{requestId:contentHash(JSON.stringify(pending.map(n=>[n.noticeId,n.attempts||0]))),sourceNodeId,targetNodeIds:config.nodeIds.filter(id=>id!==sourceNodeId)} ,{kind:'watcher'});
        for(const n of pending)this.db.put('sourceSyncWatchNotices',{...n,batchId:batch.id,queuedAt:new Date().toISOString(),attempts:(n.attempts||0)+1});
      }catch(e){for(const n of pending)this.db.put('sourceSyncWatchNotices',{...n,error:e.code||'queue_failed'});}
    }
  }
  watchMessage(nodeId,message){
    if(message.type==='source_sync_watch_ack'){const socket=this.socket(nodeId);if(socket)socket.sourceWatchAck=message.version;return;}
    const config=this.sync.config(message.projectId);
    if(!config.enabled||config.scopeKind!=='directory'||config.mode!=='continuous'||config.generation!==message.generation||!config.nodeIds.includes(nodeId)||!config.repositoryIds.includes(message.repositoryId)){
      if(message.type==='source_sync_dirty')this.socket(nodeId)?.send(JSON.stringify({type:'source_sync_dirty_ack',noticeId:message.noticeId,disposition:'obsolete'}));return;
    }
    const id=`${nodeId}:${message.projectId}:${message.repositoryId}`;
    if(message.type==='source_sync_watch_status'){this.db.put('sourceSyncWatchStates',{id,projectId:message.projectId,nodeId,repositoryId:message.repositoryId,generation:message.generation,status:message.status,error:message.error,checkedAt:message.checkedAt,digest:message.digest});return;}
    if(!/^[a-f0-9-]{36}$/.test(message.noticeId||'')||!/^[a-f0-9]{64}$/.test(message.digest||''))throw syncError('invalid_notice');
    const prior=this.db.get('sourceSyncWatchNotices',id);
    if(prior?.noticeId!==message.noticeId)this.db.put('sourceSyncWatchNotices',{id,projectId:message.projectId,nodeId,repositoryId:message.repositoryId,generation:message.generation,noticeId:message.noticeId,digest:message.digest,observedAt:message.observedAt});
    this.socket(nodeId)?.send(JSON.stringify({type:'source_sync_dirty_ack',noticeId:message.noticeId}));
  }
  async message(nodeId,message){
    if(['source_sync_watch_ack','source_sync_watch_status','source_sync_dirty'].includes(message.type)){this.watchMessage(nodeId,message);return;}
    if(this.db.get('sourceSyncTombstones',message.commandId)?.nodeId===nodeId){this.socket(nodeId)?.send(JSON.stringify({type:'source_sync_receipt_ack',commandId:message.commandId,disposition:'project_deleted'}));return;}
    const c=this.db.get('sourceSyncCommands',message.commandId);if(!c||c.nodeId!==nodeId)throw syncError('receipt_owner_mismatch');
    const uploaded=c.action==='apply'?this.db.get('sourceSyncUploadReceipts',c.id):null;
    if(message.type==='source_sync_command_ack'){
      this.db.put('sourceSyncCommands',{...c,ackedAt:new Date().toISOString()});
      if(!uploaded)return;
    }else if(message.type!=='source_sync_receipt')return;
    if(message.result?.receiptId&&message.result.receiptId!==c.id)throw syncError('receipt_owner_mismatch');
    // A timed-out upload response cannot invalidate saved evidence. The ordinary receipt validator still decides completion.
    let result=uploaded?.result||message.result;
    if(uploaded&&uploaded.fingerprint!==contentHash(JSON.stringify(result)))throw syncError('receipt_changed');
    if(result?.receiptId)throw syncError('receipt_missing');
    if(result?.captureId){const bundle=this.db.get('sourceSyncUploads',c.id)?.bundle;if(!bundle)throw syncError('manifest_missing');
      for(const entry of entries(bundle))if(!await this.storage.has(c.projectId,entry))throw syncError('blob_missing');
      result={status:'completed',...bundle};
    }
    this.sync.acceptReceipt(nodeId,{commandId:c.id,result});
    const saved=this.db.get('sourceSyncCommands',c.id)?.result;
    // Only a validated, committed result can clear the matching Worker outbox; transient observations are not acknowledgments.
    if(saved)this.socket(nodeId)?.send(JSON.stringify({type:'source_sync_receipt_ack',commandId:c.id,receiptHash:contentHash(JSON.stringify(saved))}));
    this.change();await this.tick();
  }
  async workerHttp(req,res,pathname){
    const m=pathname.match(/^\/api\/worker\/source-sync\/([a-f0-9]{64})\/(plan|capture|receipt|blobs)(?:\/([a-f0-9]{64}))?$/);if(!m)return false;
    const c=this.db.get('sourceSyncCommands',m[1]);
    if(!c||!matches(req.headers.authorization||'',`Bearer ${c.secret}`)){json(res,{error:'Unauthorized'},401);return true;}
    const batch=this.db.get('sourceSyncBatches',c.batchId);
    if(!this.db.get('projects',c.projectId)||!batch||batch.status==='cancelled')throw syncError('batch_inactive');
    if(m[2]==='plan'&&req.method==='GET'){const {result,lastResult,secret,status,lastSentAt,ackedAt,receivedAt,...plan}=c;json(res,plan);return true;}
    if(m[2]==='receipt'&&req.method==='PUT'&&c.action==='apply'){
      const result=await body(req);if(!Array.isArray(result.files)||result.files.length>10000)throw syncError('invalid_receipt');
      const fingerprint=contentHash(JSON.stringify(result)),old=this.db.get('sourceSyncUploadReceipts',c.id);
      if(old&&old.fingerprint!==fingerprint)throw syncError('receipt_changed');
      this.db.put('sourceSyncUploadReceipts',{id:c.id,projectId:c.projectId,result,fingerprint});json(res,{stored:true});return true;
    }
    if(m[2]==='capture'&&req.method==='PUT'&&c.action==='capture'){
      const bundle=await body(req);
      // Reject old captures before accepting any content uploads, not after their bytes have been staged.
      for(const s of [bundle.base,bundle.manifest])validateSourceCapture(s,c);
      if(c.scopeKind!=='directory'&&(bundle.base.baseCommit!==bundle.manifest.baseCommit||c.baseCommit&&c.baseCommit!==bundle.base.baseCommit))throw syncError('git_baseline_mismatch');
      const fingerprint=contentHash(JSON.stringify(bundle)),old=this.db.get('sourceSyncUploads',c.id);
      if(old&&old.fingerprint!==fingerprint)throw syncError('capture_changed');
      this.db.put('sourceSyncUploads',{id:c.id,projectId:c.projectId,bundle,fingerprint});
      const missing=[];for(const entry of new Map(entries(bundle).map(e=>[e.hash,e])).values())if(!await this.storage.has(c.projectId,entry))missing.push(entry);
      json(res,{missing});return true;
    }
    if(m[2]==='blobs'&&m[3]){
      const bundle=this.db.get('sourceSyncUploads',c.id)?.bundle;
      const allowed=c.action==='capture'&&bundle?entries(bundle):(c.changes||[]).map(x=>x.after).filter(Boolean);
      const entry=allowed.find(e=>e.hash===m[3]);if(!entry)throw syncError('blob_not_in_command');
      if(req.method==='PUT'&&c.action==='capture'){json(res,await this.storage.receive(c.projectId,entry,req));return true;}
      if(req.method==='GET'&&c.action==='apply'){const bytes=await this.storage.read(c.projectId,entry.hash);res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':bytes.length,'Cache-Control':'no-store'});res.end(bytes);return true;}
    }
    throw syncError('invalid_sync_action');
  }
  async browserHttp(req,res,pathname){const m=pathname.match(/^\/api\/projects\/([^/]+)\/source-sync(?:\/(.*))?$/);if(!m)return false;
    const projectId=m[1],route=m[2]||'';if(!this.db.get('projects',projectId))throw syncError('project_missing');
    let value;
    if(req.method==='GET'&&!route)value=this.sync.status(projectId);
    else if(req.method==='GET'&&route==='config')value=this.sync.config(projectId);
    else if(req.method==='PUT'&&route==='config')value=this.sync.configure(projectId,await body(req,100000));
    else if(req.method==='POST'&&route==='preview')value=this.sync.preview(projectId,await body(req,100000));
    else if(req.method==='POST'&&route==='batches')value=this.sync.request(projectId,await body(req,100000));
    else if(req.method==='POST'&&/^batches\/[a-f0-9]{64}\/cancel$/.test(route))value=this.sync.cancel(projectId,route.split('/')[1],(await body(req,100000)).revision);
    else if(req.method==='GET'&&/^batches\/[a-f0-9]{64}$/.test(route)){
      const batch=this.db.get('sourceSyncBatches',route.split('/')[1]);if(batch?.projectId!==projectId)throw syncError('batch_changed');
      value={batch:{...batch,fingerprint:undefined},captures:this.db.listSourceSyncCommands({projectId,batchId:batch.id,action:'capture'}).map(c=>({nodeId:c.nodeId,repositoryId:c.repositoryId,status:c.status,root:c.root,entries:c.result?.manifest?.entries,excluded:c.result?.manifest?.excluded}))};
    }
    else if(req.method==='GET'&&/^conflicts\/[^/]+$/.test(route))value=await this.agent.execute({projectId},'read',{conflictId:route.split('/')[1]});
    else if(req.method==='POST'&&/^conflicts\/[^/]+\/read$/.test(route))value=await this.agent.execute({projectId},'read',{...await body(req,100000),conflictId:route.split('/')[1]});
    else if(req.method==='POST'&&/^conflicts\/[^/]+\/(assign|review)$/.test(route)){
      const id=route.split('/')[1],input=await body(req,100000);if(this.db.get('sourceSyncConflicts',id)?.projectId!==projectId)throw syncError('conflict_missing');
      value=route.endsWith('/assign')?this.conflicts.assign(id,input.generation,input.roleId,{kind:'human'}):this.conflicts.acceptReview(id,input.generation,input.proposalId);
    }
    else throw syncError('invalid_sync_action');
    await this.tick();json(res,value);return true;
  }
  /** A Worker may hydrate only manifests frozen on this active Run, never an arbitrary project hash. */
  async inputHttp(req,res,pathname){
    const candidate=pathname.match(/^\/api\/agent\/source-candidates\/([^/]+)\/([a-f0-9]{64})\/blob$/);
    if(candidate&&req.method==='PUT'){
      const run=this.db.get('runs',candidate[1]);if(!run||['succeeded','failed','interrupted','reconciling','stopping'].includes(run.status))throw syncError('candidate_not_ready');
      const value=this.agent.candidate(run,candidate[2]);if(!value.scopeVerified||!value.entry)throw syncError('candidate_not_ready');json(res,await this.storage.receive(run.projectId,value.entry,req));return true;
    }
    const m=pathname.match(/^\/api\/agent\/source-inputs\/([^/]+)\/([^/]+)(?:\/blobs\/([a-f0-9]{64}))?$/);if(!m||req.method!=='GET')return false;
    const run=this.db.get('runs',m[1]),input=run?.sourceInputs?.find(v=>v.manifestId===m[2]);
    if(!input||['succeeded','failed','interrupted'].includes(run.status)||!this.db.get('projects',run.projectId))throw syncError('source_input_not_ready');
    const version=this.db.get('sourceSyncVersions',input.manifestId);if(!version||version.projectId!==run.projectId||version.digest!==input.manifestHash)throw syncError('source_input_changed');
    if(!m[3]){json(res,version);return true;}
    if(!Object.values(version.entries).some(e=>e?.hash===m[3]))throw syncError('blob_not_in_command');
    const bytes=await this.storage.read(run.projectId,m[3]);res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':bytes.length,'Cache-Control':'no-store'});res.end(bytes);return true;
  }
}

/** Network replay carries metadata receipts, not full manifests or source bytes on the event outbox. */
export class SourceSyncClient {
  constructor({db,data,home,send,resolveBinding,activeRuns,takeoverState,paused}){
    Object.assign(this,{db,home,send,paused});this.blobRoot=join(data,'source-sync-blobs');this.inFlight=new Set();this.sent=new Map();
    this.worker=new SourceSyncWorker({db,blobRoot:this.blobRoot,resolveBinding,activeRuns,takeoverState,paused});
    this.watch=new SourceSyncWatch({db,send,resolveBinding,blocked:projectId=>Boolean(db.get('sourceSyncReservations',projectId))});
  }
  async request(message,path,method='GET',value){
    const response=await fetch(`${this.home}/api/worker/source-sync/${message.commandId}/${path}`,{method,headers:{Authorization:`Bearer ${message.secret}`,...(value&&!Buffer.isBuffer(value)?{'Content-Type':'application/json'}:{})},body:value===undefined?undefined:Buffer.isBuffer(value)?value:JSON.stringify(value),signal:AbortSignal.timeout(60000)});
    if(!response.ok){const result=await response.json();throw syncError(result.code||'transfer_failed',result.error||'');}return response;
  }
  async execute(message){
    if(this.inFlight.has(message.commandId))return;
    this.inFlight.add(message.commandId);
    try{
      const command=await (await this.request(message,'plan')).json();
      const transport=this.db.get('sourceSyncTransport',command.id);
      this.db.put('sourceSyncTransport',{...transport,id:command.id,projectId:command.projectId,message});
      this.send({type:'source_sync_command_ack',commandId:command.id});
      const saved=this.db.get('sourceSyncCommands',command.id)?.result;
      // Receipt replay needs only the saved result; execute still checks the exact command fingerprint below.
      if(command.action==='apply'&&!['completed','partial_conflict','cancelled','blocked'].includes(saved?.status))for(const entry of new Map(command.changes.map(c=>c.after).filter(Boolean).map(e=>[e.hash,e])).values()){
        let present=false;try{present=(await readSourceBlob(this.blobRoot,entry.hash)).length===entry.size;}catch{}
        if(!present){const r=await this.request(message,`blobs/${entry.hash}`),bytes=Buffer.from(await r.arrayBuffer());if(bytes.length!==entry.size||contentHash(bytes)!==entry.hash)throw syncError('blob_corrupt');await saveSourceBlob(this.blobRoot,bytes);}
      }
      const result=await this.worker.execute(command);
      this.watch.received(command,result);
      if(result.status==='completed'&&command.action==='capture'){
        const needed=await (await this.request(message,'capture','PUT',{base:result.base,manifest:result.manifest})).json();
        for(const entry of needed.missing)await this.request(message,`blobs/${entry.hash}`,'PUT',await readSourceBlob(this.blobRoot,entry.hash));
      }
      if(command.action==='apply'&&Array.isArray(result.files))await this.request(message,'receipt','PUT',result);
      this.db.put('sourceSyncTransport',{...this.db.get('sourceSyncTransport',command.id),ready:true});
      this.flush();
      if(!['completed','partial_conflict','cancelled'].includes(result.status))this.send({type:'source_sync_receipt',commandId:command.id,result});
    }catch(error){this.send({type:'source_sync_receipt',commandId:message.commandId,result:{status:!error.code||error.code==='transfer_failed'?'reconciling':'blocked',reason:error.code||'transfer_failed'}});
    }finally{this.inFlight.delete(message.commandId);}
  }
  acknowledge(id,message={}){
    const receipt=this.db.get('sourceSyncReceipts',id);
    // Old Homes send no result hash. Keep that receipt until a matching confirmation arrives after upgrade.
    if(!receipt||message.disposition!=='project_deleted'&&message.receiptHash!==contentHash(JSON.stringify(receipt.result)))return;
    this.db.remove('sourceSyncReceipts',id);this.sent.delete(id);
  }
  cancel(id){
    this.db.put('sourceSyncCancellations',{id});
    if(this.inFlight.has(id))return;
    const record=this.db.get('sourceSyncCommands',id),transport=this.db.get('sourceSyncTransport',id);
    if(record&&!record.result){
      // Restart loses the in-memory flight, not the journal. Recover before claiming cancellation.
      if(transport?.message){void this.execute(transport.message);return;}
      this.send({type:'source_sync_receipt',commandId:id,result:{status:'reconciling',reason:'recovery_required'}});return;
    }
    this.send({type:'source_sync_receipt',commandId:id,result:record?.result||{status:'cancelled',files:[]}});
  }
  flush(){for(const receipt of this.worker.receiptBatch()){
    if(this.inFlight.has(receipt.id))continue;
    if(!this.db.get('sourceSyncTransport',receipt.id)?.ready)continue;
    if(this.sent.has(receipt.id)&&Date.now()-this.sent.get(receipt.id)<5000)continue;
    const result=receipt.result.base?{status:'completed',captureId:receipt.id}:Array.isArray(receipt.result.files)?{status:receipt.result.status,receiptId:receipt.id}:receipt.result;
    this.send({type:'source_sync_receipt',commandId:receipt.id,result});this.sent.set(receipt.id,Date.now());
  }}
}
