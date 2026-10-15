import {randomUUID} from 'node:crypto';

/**
 * Takeover turns: the user continues one exact native CLI session from the Sessions page.
 * Home records each turn with its process events; the Worker resumes the same native ID in its original folder
 * and keeps one resident CLI per taken-over session where the CLI has a resident input mode.
 * No Task/Run, role rules, platform prompt or wb context is created or injected.
 */
export const NATIVE_TURN_RUNTIMES=['codex','claude','grok','agy'];
/** Resident processes: Codex app-server (thread/resume once, then turn/start), Claude and Agy stream-json input. Grok resumes per turn. */
export const NATIVE_RESIDENT_RUNTIMES=new Set(['codex','claude','agy']);
/** Images reach the model only where the adapter has a native image input. */
export const NATIVE_IMAGE_RUNTIMES=new Set(['codex','claude']);
export const NATIVE_IDLE_MS=30*60*1000;
const idPattern=/^[a-zA-Z0-9][a-zA-Z0-9_-]{7,127}$/;
const turnIdPattern=/^[a-zA-Z0-9-]{8,100}$/;
const ACTIVE=new Set(['queued','starting','running','waiting_user']);
const MAX_TEXT=60000,MAX_PROMPT=12000,MAX_EVENTS=400,MAX_EVENT_TEXT=8000;
const now=()=>new Date().toISOString();
const sessionKey=(nodeId,runtime,sessionId)=>`${nodeId}/${runtime}/${sessionId}`;
const clip=value=>typeof value==='string'&&value.length>MAX_EVENT_TEXT?`${value.slice(0,MAX_EVENT_TEXT)}…`:value;
/** Tool snapshots are bounded field by field; the page renders them with the group-chat live-scene projection. */
function boundedItem(item){if(!item||typeof item!=='object')return item;const next={};for(const[key,value]of Object.entries(item).slice(0,40)){if(typeof value==='string')next[key]=clip(value);else if(value&&typeof value==='object'){const json=JSON.stringify(value);next[key]=json.length>MAX_EVENT_TEXT?clip(json):value;}else next[key]=value;}return next;}

/** Pure reducer shared by Home and tests: ordered process events plus a reply text and coarse phase. */
export function applyNativeTurnEvent(turn,event){
 if(!turn||!event)return turn;
 const ended=!ACTIVE.has(turn.status)&&turn.status!=='stopping';
 if(ended&&event.kind!=='status')return turn;
 const next={...turn,updatedAt:now()},events=[...(turn.events||[])];
 const push=(type,payload)=>{const prior=events.at(-1);
  // Adjacent text deltas are merged into one event, so long replies stay within the bounded event list.
  if(type==='text'&&prior?.type==='text')events[events.length-1]={...prior,payload:{text:(prior.payload.text+payload.text).slice(-MAX_TEXT)}};
  else events.push({seq:(prior?.seq||0)+1,type,payload,createdAt:now()});
  if(events.length>MAX_EVENTS)events.splice(0,events.length-MAX_EVENTS);};
 if(event.kind==='text'&&typeof event.text==='string'){next.live=((next.live||'')+event.text).slice(-MAX_TEXT);push('text',{text:event.text});next.phase='replying';}
 if(event.kind==='message'&&typeof event.text==='string'){next.parts=[...(next.parts||[]),event.text.slice(-MAX_TEXT)].slice(-20);next.live='';push('message',{text:clip(event.text),phase:event.phase||null});next.phase='replying';}
 if(['text','message'].includes(event.kind))next.text=[...(next.parts||[]),next.live].filter(Boolean).join('\n\n').slice(-MAX_TEXT);
 if(event.kind==='tool'&&event.item){push('tool',{text:clip(String(event.text||'')),item:boundedItem(event.item)});next.phase=['completed','failed'].includes(event.item.status)?'working':'tool';next.toolName=String(event.item.name||event.item.command||event.item.tool||event.item.title||event.item.type||event.text||'').slice(0,200);}
 if(event.kind==='log'&&typeof event.text==='string'){push('log',{text:clip(event.text)});if(event.thinking)next.phase='thinking';}
 if(event.kind==='status'){
  if(ended)return turn;
  if(event.status&&!(turn.status==='stopping'&&ACTIVE.has(event.status)))next.status=event.status;
  if(event.status==='starting')next.phase='starting';
  if(event.status==='running'&&!next.phase)next.phase='thinking';
  if(event.status==='waiting_user')next.phase='waiting';
  if(event.resident!==undefined)next.resident=Boolean(event.resident);
  if(event.error){next.error=String(event.error).slice(0,2000);push('error',{text:next.error});}
  if(['succeeded','failed','interrupted'].includes(next.status)){next.endedAt=next.endedAt||now();next.phase=null;}
 }
 next.events=events;return next;
}

export function nativeTurnView(turn){
 const {prompt,text,status,error,id,runtime,sessionId,nodeId,createdAt,endedAt,clientTurnId,events,phase,toolName,attachments,resident}=turn;
 return {id,clientTurnId,nodeId,runtime,sessionId,prompt,text:text||'',status,phase:phase||null,toolName:toolName||null,error:error||null,createdAt,endedAt:endedAt||null,events:events||[],
  attachments:(attachments||[]).map(({id,name,mime,size})=>({id,name,mime,size})),resident:Boolean(resident)};
}

/** Home side: validation, idempotent creation, occupancy checks, attachment binding and event intake. */
export class NativeTurnsHome{
 constructor({db,send,online,change,assertIdle,attachments=null}){Object.assign(this,{db,send,online,change,assertIdle,attachments});}
 static owner(nodeId){return `native:${nodeId}`;}
 list(nodeId,runtime,sessionId){return this.db.list('nativeTurns').filter(t=>t.nodeId===nodeId&&t.runtime===runtime&&t.sessionId===sessionId).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)).slice(-50).map(nativeTurnView);}
 active(nodeId,runtime,sessionId){return this.db.list('nativeTurns').find(t=>t.nodeId===nodeId&&t.runtime===runtime&&t.sessionId===sessionId&&(ACTIVE.has(t.status)||t.status==='stopping'));}
 process(nodeId,runtime,sessionId){return this.db.get('nativeTakeovers',sessionKey(nodeId,runtime,sessionId))?.status==='open';}
 create(nodeId,worker,body){
  const {runtime,sessionId,clientTurnId,text='',attachmentIds=[]}=body||{};
  if(!NATIVE_TURN_RUNTIMES.includes(runtime))throw Error('Unsupported CLI');
  if(!idPattern.test(sessionId||''))throw Error('Invalid native session ID');
  if(!turnIdPattern.test(clientTurnId||''))throw Error('Invalid takeover message ID');
  if(typeof text!=='string'||(!text.trim()&&!attachmentIds?.length))throw Error('Enter a message');
  if(text.length>MAX_PROMPT)throw Error('Message is too long for a takeover turn');
  const prior=this.db.list('nativeTurns').find(t=>t.clientTurnId===clientTurnId);
  if(prior){if(prior.nodeId!==nodeId||prior.sessionId!==sessionId||prior.prompt!==text||JSON.stringify((prior.attachments||[]).map(a=>a.id))!==JSON.stringify(attachmentIds||[]))throw Error('Takeover message ID was already used');return nativeTurnView(prior);}
  const items=attachmentIds?.length?this.attachments.resolve(NativeTurnsHome.owner(nodeId),attachmentIds):[];
  if(items.some(item=>item.mime.startsWith('image/'))&&!NATIVE_IMAGE_RUNTIMES.has(runtime))throw Error('This CLI cannot receive images in a takeover; send files or use iTerm');
  if(worker?.capabilities?.nativeTurns!==2)throw Error('Upgrade this Worker to take over native sessions');
  if(!this.online(nodeId))throw Error('Device offline or not connected');
  if(this.active(nodeId,runtime,sessionId))throw Error('This session is still replying; wait or stop it first');
  this.assertIdle({runtime,sessionId});
  const turn={id:randomUUID(),clientTurnId,nodeId,runtime,sessionId,prompt:text,text:'',events:[],attachments:items,status:'queued',phase:'queued',createdAt:now(),updatedAt:now()};
  this.db.put('nativeTurns',turn);
  this.db.put('nativeTakeovers',{id:sessionKey(nodeId,runtime,sessionId),nodeId,runtime,sessionId,status:'open',updatedAt:now()});
  this.send(nodeId,{type:'native_turn',id:turn.id,runtime,sessionId,prompt:text,attachments:items});
  this.change();return nativeTurnView(turn);
 }
 /** Workers download only the attachments bound to an unfinished turn. */
 attachmentFor(turnId,attachmentId){const turn=this.db.get('nativeTurns',turnId);if(!turn||!(ACTIVE.has(turn.status)||turn.status==='stopping')||!turn.attachments?.some(a=>a.id===attachmentId))throw Error('Attachment does not belong to an unfinished takeover turn');return {owner:NativeTurnsHome.owner(turn.nodeId),id:attachmentId};}
 stop(nodeId,id){
  const turn=this.db.get('nativeTurns',id);if(!turn||turn.nodeId!==nodeId)throw Error('Takeover turn not found');
  if(!ACTIVE.has(turn.status))return nativeTurnView(turn);
  this.db.put('nativeTurns',{...turn,status:'stopping',updatedAt:now()});this.send(nodeId,{type:'native_turn_stop',id});this.change();return nativeTurnView(this.db.get('nativeTurns',id));
 }
 /** Ending takeover closes the resident CLI; an unfinished turn is stopped first by the Worker. */
 release(nodeId,{runtime,sessionId}={}){
  if(!NATIVE_TURN_RUNTIMES.includes(runtime)||!idPattern.test(sessionId||''))throw Error('Invalid native session');
  const key=sessionKey(nodeId,runtime,sessionId),current=this.db.get('nativeTakeovers',key);
  if(current)this.db.put('nativeTakeovers',{...current,status:'closed',reason:'released',updatedAt:now()});
  if(this.online(nodeId))this.send(nodeId,{type:'native_takeover_release',runtime,sessionId});
  this.change();return {released:true};
 }
 receive(nodeId,m){
  if(m.type==='native_takeover_closed'){const key=sessionKey(nodeId,m.runtime,m.sessionId),current=this.db.get('nativeTakeovers',key);if(current){this.db.put('nativeTakeovers',{...current,status:'closed',reason:m.reason||null,updatedAt:now()});this.change();}return true;}
  const turn=this.db.get('nativeTurns',m.id);if(!turn||turn.nodeId!==nodeId)return false;
  this.db.put('nativeTurns',applyNativeTurnEvent(turn,m.event));this.change();return true;
 }
 /** After a Home restart no Worker connection carries an unfinished turn any more. */
 recover(){for(const t of this.db.list('nativeTurns'))if(ACTIVE.has(t.status)||t.status==='stopping')this.db.put('nativeTurns',{...t,status:'interrupted',phase:null,error:'Home restarted; the turn was stopped',endedAt:now()});for(const p of this.db.list('nativeTakeovers'))if(p.status==='open')this.db.put('nativeTakeovers',{...p,status:'closed',reason:'home_restart'});}
 /** A lost Worker connection ends its turns and resident processes: the Worker closes them on disconnect. */
 disconnected(nodeId){
  let changed=false;for(const t of this.db.list('nativeTurns'))if(t.nodeId===nodeId&&(ACTIVE.has(t.status)||t.status==='stopping')){this.db.put('nativeTurns',{...t,status:'interrupted',phase:null,error:'Device disconnected; the turn was stopped',endedAt:now()});changed=true;}
  for(const p of this.db.list('nativeTakeovers'))if(p.nodeId===nodeId&&p.status==='open'){this.db.put('nativeTakeovers',{...p,status:'closed',reason:'disconnected'});changed=true;}
  if(changed)this.change();
 }
}

const alive=session=>Boolean(session?.proc&&session.proc.exitCode===null&&session.proc.signalCode===null&&!session.proc.killed);

/** Worker side: one resident CLI per taken-over session (where supported), exact resume in the history's original folder. */
export class NativeTurnRunner{
 constructor({send,createSession,resolveSession,canStart,prepareInputs=async()=>({files:[],images:[]}),cleanup=null,idleMs=NATIVE_IDLE_MS}){Object.assign(this,{send,createSession,resolveSession,canStart,prepareInputs,cleanup,idleMs});this.turns=new Map();this.resident=new Map();}
 /** CLI slots: each resident process counts once, plus per-turn processes that are not resident. */
 get size(){return this.resident.size+[...this.turns.values()].filter(t=>!t.resident).length;}
 holds(runtime,sessionId){return this.resident.has(`${runtime}/${sessionId}`)||[...this.turns.values()].some(t=>t.key===`${runtime}/${sessionId}`);}
 event(id,event){this.send({type:'native_turn_event',id,event});}
 close(key,reason){const entry=this.resident.get(key);if(!entry)return;this.resident.delete(key);clearTimeout(entry.timer);if(typeof entry.session.close==='function')entry.session.close();else entry.session.shutdown?.();const [runtime,sessionId]=key.split('/');this.send({type:'native_takeover_closed',runtime,sessionId,reason});}
 idle(key){const entry=this.resident.get(key);if(!entry)return;clearTimeout(entry.timer);entry.timer=setTimeout(()=>this.close(key,'idle'),this.idleMs);entry.timer.unref?.();}
 async start(m){
  if(this.turns.has(m.id))return;
  const key=`${m.runtime}/${m.sessionId}`,existing=this.resident.get(key),state={stopRequested:false,session:null,key,resident:Boolean(existing)};this.turns.set(m.id,state);
  let ended=false;
  const end=(status,error)=>{if(ended)return;ended=true;this.turns.delete(m.id);void Promise.resolve().then(()=>this.cleanup?.(m.id)).catch(()=>{});
   const entry=this.resident.get(key);
   if(entry&&entry.session===state.session){if(alive(entry.session)&&status!=='mismatch'){entry.busy=null;this.idle(key);}else this.close(key,status==='mismatch'?'mismatch':'exited');}
   else if(state.session&&!state.resident)state.session.shutdown?.();
   this.event(m.id,{kind:'status',status:status==='mismatch'?'failed':status,...(error?{error}:{}),resident:this.resident.has(key)});};
  try{
   if(!NATIVE_TURN_RUNTIMES.includes(m.runtime)||!idPattern.test(m.sessionId||''))throw Error('Invalid native session');
   if(existing?.busy||[...this.turns.entries()].some(([id,t])=>id!==m.id&&t.key===key))throw Error('This session is still replying; wait or stop it first');
   this.canStart?.(m,{reusing:Boolean(existing)});
   const {workspace}=await this.resolveSession(m.runtime,m.sessionId,{reusing:Boolean(existing)});
   if(!workspace)throw Error('The original working folder of this session is unknown; continue it in iTerm');
   if(state.stopRequested)return end('interrupted');
   this.event(m.id,{kind:'status',status:'starting'});
   const {files=[],images=[]}=await this.prepareInputs(m,workspace);
   if(state.stopRequested)return end('interrupted');
   if(images.length&&!NATIVE_IMAGE_RUNTIMES.has(m.runtime))throw Error('This CLI cannot receive images in a takeover; send files or use iTerm');
   const others=files.filter(f=>!(m.runtime==='codex'&&f.mime?.startsWith('image/'))&&!(m.runtime==='claude'&&f.mime?.startsWith('image/')));
   const prompt=[m.prompt,others.length?`Attached files for this message (local paths):\n${others.map(f=>`- ${f.name}: ${f.path}`).join('\n')}`:''].filter(Boolean).join('\n\n');
   const emit=(type,p={})=>{
    if(ended)return;
    if(type==='status'&&p.nativeSessionId&&p.nativeSessionId!==m.sessionId){void state.session?.stop();return end('mismatch','The CLI resumed a different native session; stopped');}
    if(type==='status'&&['succeeded','failed','interrupted','reconciling'].includes(p.status))return end(p.status==='reconciling'?'failed':p.status,p.error);
    if(type==='status'&&p.status)this.event(m.id,{kind:'status',status:p.status});
    else if(type==='tool'&&p.item)this.event(m.id,{kind:'tool',text:p.text,item:p.item});
    else if(type==='message'&&typeof p.text==='string')this.event(m.id,{kind:'message',text:p.text,phase:p.phase||null});
    else if(type==='text'&&typeof p.text==='string')this.event(m.id,{kind:'text',text:p.text});
    else if(type==='log'&&typeof p.text==='string')this.event(m.id,{kind:'log',text:p.text.slice(0,4000),thinking:/think|\u601d\u8003/i.test(p.text)});
   };
   const resident=NATIVE_RESIDENT_RUNTIMES.has(m.runtime),inputs={attachments:files,inputImages:images};
   if(existing&&alive(existing.session)){clearTimeout(existing.timer);existing.busy=m.id;state.session=existing.session;state.resident=true;existing.session.reuse({emit,...inputs});}
   else{
    if(existing)this.close(key,'exited');
    state.session=this.createSession({runtime:m.runtime,cwd:workspace,resumeSessionId:m.sessionId,emit,keepAlive:resident,...inputs});
    if(resident){this.resident.set(key,{session:state.session,busy:m.id,timer:null});state.resident=true;}
   }
   this.event(m.id,{kind:'status',status:'starting',resident:state.resident});
   await state.session.start(prompt);
   if(state.stopRequested)await state.session.stop();
  }catch(error){end('failed',error.message);}
 }
 /** Stop interrupts the current turn; a resident process stays for the next message where the CLI supports it. */
 async stop(id){const state=this.turns.get(id);if(!state)return;state.stopRequested=true;if(state.session)await state.session.stop();}
 release(runtime,sessionId){const key=`${runtime}/${sessionId}`;for(const [id,state] of this.turns)if(state.key===key)void this.stop(id);this.close(key,'released');}
 stopAll(){for(const id of this.turns.keys())void this.stop(id);for(const key of [...this.resident.keys()])this.close(key,'disconnected');}
}
