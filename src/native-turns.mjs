import {randomUUID} from 'node:crypto';

/**
 * Takeover turns: the user continues one exact native CLI session from the Sessions page.
 * Home records each turn; the Worker resumes the same native ID in its original folder.
 * No Task/Run, role rules, platform prompt or wb context is created or injected.
 */
export const NATIVE_TURN_RUNTIMES=['codex','claude','grok','agy'];
const idPattern=/^[a-zA-Z0-9][a-zA-Z0-9_-]{7,127}$/;
const turnIdPattern=/^[a-zA-Z0-9-]{8,100}$/;
const ACTIVE=new Set(['queued','starting','running']);
const MAX_TEXT=60000,MAX_TOOLS=40,MAX_PROMPT=12000;
const now=()=>new Date().toISOString();

/** Pure state reducer so Home and tests share one event interpretation. */
export function applyNativeTurnEvent(turn,event){
 if(!turn||!event)return turn;
 const next={...turn,updatedAt:now()};
 // Completed assistant messages are kept in order; deltas only fill the message currently being written.
 if(event.kind==='text'&&typeof event.text==='string')next.live=((next.live||'')+event.text).slice(-MAX_TEXT);
 if(event.kind==='message'&&typeof event.text==='string'){next.parts=[...(next.parts||[]),event.text.slice(-MAX_TEXT)].slice(-20);next.live='';}
 if(['text','message'].includes(event.kind))next.text=[...(next.parts||[]),next.live].filter(Boolean).join('\n\n').slice(-MAX_TEXT);
 if(event.kind==='tool'&&typeof event.text==='string')next.tools=[...(next.tools||[]),event.text.slice(0,200)].slice(-MAX_TOOLS);
 if(event.kind==='status'){
  if(event.status&&!ACTIVE.has(next.status)&&next.status!=='stopping')return turn;
  if(event.status&&!(turn.status==='stopping'&&ACTIVE.has(event.status)))next.status=event.status;
  if(event.error)next.error=String(event.error).slice(0,2000);
  if(['succeeded','failed','interrupted'].includes(next.status))next.endedAt=next.endedAt||now();
 }
 return next;
}

export function nativeTurnView(turn){
 const {prompt,text,tools,status,error,id,runtime,sessionId,nodeId,createdAt,endedAt,clientTurnId}=turn;
 return {id,clientTurnId,nodeId,runtime,sessionId,prompt,text:text||'',tools:tools||[],status,error:error||null,createdAt,endedAt:endedAt||null};
}

/** Home side: validation, idempotent creation, occupancy checks and event intake. */
export class NativeTurnsHome{
 constructor({db,send,online,change,assertIdle}){Object.assign(this,{db,send,online,change,assertIdle});}
 list(nodeId,runtime,sessionId){return this.db.list('nativeTurns').filter(t=>t.nodeId===nodeId&&t.runtime===runtime&&t.sessionId===sessionId).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)).slice(-50).map(nativeTurnView);}
 active(nodeId,runtime,sessionId){return this.db.list('nativeTurns').find(t=>t.nodeId===nodeId&&t.runtime===runtime&&t.sessionId===sessionId&&(ACTIVE.has(t.status)||t.status==='stopping'));}
 create(nodeId,worker,body){
  const {runtime,sessionId,clientTurnId,text}=body||{};
  if(!NATIVE_TURN_RUNTIMES.includes(runtime))throw Error('Unsupported CLI');
  if(!idPattern.test(sessionId||''))throw Error('Invalid native session ID');
  if(!turnIdPattern.test(clientTurnId||''))throw Error('Invalid takeover message ID');
  if(typeof text!=='string'||!text.trim())throw Error('Enter a message');
  if(text.length>MAX_PROMPT)throw Error('Message is too long for a takeover turn');
  const prior=this.db.list('nativeTurns').find(t=>t.clientTurnId===clientTurnId);
  if(prior){if(prior.nodeId!==nodeId||prior.sessionId!==sessionId||prior.prompt!==text)throw Error('Takeover message ID was already used');return nativeTurnView(prior);}
  if(worker?.capabilities?.nativeTurns!==1)throw Error('Upgrade this Worker to take over native sessions');
  if(!this.online(nodeId))throw Error('Device offline or not connected');
  if(this.active(nodeId,runtime,sessionId))throw Error('This session is still replying; wait or stop it first');
  this.assertIdle({runtime,sessionId});
  const turn={id:randomUUID(),clientTurnId,nodeId,runtime,sessionId,prompt:text,text:'',tools:[],status:'queued',createdAt:now(),updatedAt:now()};
  this.db.put('nativeTurns',turn);
  this.send(nodeId,{type:'native_turn',id:turn.id,runtime,sessionId,prompt:text});
  this.change();return nativeTurnView(turn);
 }
 stop(nodeId,id){
  const turn=this.db.get('nativeTurns',id);if(!turn||turn.nodeId!==nodeId)throw Error('Takeover turn not found');
  if(!ACTIVE.has(turn.status))return nativeTurnView(turn);
  this.db.put('nativeTurns',{...turn,status:'stopping',updatedAt:now()});this.send(nodeId,{type:'native_turn_stop',id});this.change();return nativeTurnView(this.db.get('nativeTurns',id));
 }
 receive(nodeId,m){
  const turn=this.db.get('nativeTurns',m.id);if(!turn||turn.nodeId!==nodeId)return false;
  this.db.put('nativeTurns',applyNativeTurnEvent(turn,m.event));this.change();return true;
 }
 /** After a Home restart no Worker connection carries an unfinished turn any more. */
 recover(){for(const t of this.db.list('nativeTurns'))if(ACTIVE.has(t.status)||t.status==='stopping')this.db.put('nativeTurns',{...t,status:'interrupted',error:'Home restarted; the turn was stopped',endedAt:now()});}
 /** A lost Worker connection ends its turns: the Worker stops them on disconnect, so nothing keeps running unseen. */
 disconnected(nodeId){
  let changed=false;for(const t of this.db.list('nativeTurns'))if(t.nodeId===nodeId&&(ACTIVE.has(t.status)||t.status==='stopping')){this.db.put('nativeTurns',{...t,status:'interrupted',error:'Device disconnected; the turn was stopped',endedAt:now()});changed=true;}
  if(changed)this.change();
 }
}

/** Worker side: one process per turn, exact resume in the history's original folder. */
export class NativeTurnRunner{
 constructor({send,createSession,resolveSession,canStart}){Object.assign(this,{send,createSession,resolveSession,canStart});this.turns=new Map();}
 get size(){return this.turns.size;}
 event(id,event){this.send({type:'native_turn_event',id,event});}
 async start(m){
  if(this.turns.has(m.id))return;
  const state={stopRequested:false,session:null};this.turns.set(m.id,state);
  const end=(status,error)=>{this.event(m.id,{kind:'status',status,...(error?{error}:{})});this.turns.delete(m.id);};
  try{
   if(!NATIVE_TURN_RUNTIMES.includes(m.runtime)||!idPattern.test(m.sessionId||''))throw Error('Invalid native session');
   this.canStart?.(m);
   const {workspace}=await this.resolveSession(m.runtime,m.sessionId);
   if(!workspace)throw Error('The original working folder of this session is unknown; continue it in iTerm');
   if(state.stopRequested)return end('interrupted');
   this.event(m.id,{kind:'status',status:'starting'});
   let settled=false;
   const session=this.createSession({runtime:m.runtime,cwd:workspace,resumeSessionId:m.sessionId,emit:(type,p={})=>{
    if(settled)return;
    if(type==='status'&&p.nativeSessionId&&p.nativeSessionId!==m.sessionId){settled=true;void session.stop();return end('failed','The CLI resumed a different native session; stopped');}
    if(type==='status'&&['succeeded','failed','interrupted','reconciling'].includes(p.status)){settled=true;session.shutdown?.();return end(p.status==='reconciling'?'failed':p.status,p.error);}
    if(type==='status'&&p.status)this.event(m.id,{kind:'status',status:p.status});
    else if(['text','message','tool'].includes(type)&&typeof p.text==='string')this.event(m.id,{kind:type,text:p.text});
   }});
   state.session=session;
   await session.start(m.prompt);
   if(state.stopRequested)await session.stop();
  }catch(error){if(this.turns.has(m.id))end('failed',error.message);}
 }
 async stop(id){const state=this.turns.get(id);if(!state)return;state.stopRequested=true;if(state.session)await state.session.stop();}
 stopAll(){for(const id of this.turns.keys())void this.stop(id);}
}
