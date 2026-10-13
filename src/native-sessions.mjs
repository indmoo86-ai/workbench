import {readdir,open,realpath,stat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {homedir} from 'node:os';
import {join,basename,dirname,relative,isAbsolute} from 'node:path';
import {resumeArgs,processAlive} from './terminal-resume.mjs';

const runtimes=new Set(['codex','claude','grok','agy']);
const idPattern=/^[a-zA-Z0-9][a-zA-Z0-9_-]{7,127}$/;
const inside=(root,path)=>{const r=relative(root,path);return !r||r!=='..'&&!r.startsWith('../')&&!isAbsolute(r);};

/** A terminal link cannot start a second driver for an occupied history or overlapping work folder. */
export function assertNativeSessionIdle(db,{runtime,sessionId,workspace,projectId,claimId}){
 const overlap=path=>typeof path==='string'&&typeof workspace==='string'&&(inside(path,workspace)||inside(workspace,path));
 if(db.list('runs').some(r=>r.status==='reconciling'||(!['succeeded','failed','interrupted'].includes(r.status)||processAlive(r.pid))&&(r.projectId===projectId||overlap(r.workspace)||sessionId&&r.nativeSession?.runtime===runtime&&r.nativeSession?.id===sessionId)))throw Error('This session or folder is still used by a managed CLI; finish it before opening a terminal');
 if(db.list('terminalSessions').some(s=>s.id!==claimId&&!['released','cancelled','finished'].includes(s.status)&&(overlap(s.workspace)||sessionId&&s.nativeSession?.runtime===runtime&&s.nativeSession?.id===sessionId)))throw Error('Session is occupied; no second CLI was started');
}

/** Only discover vendor-owned history directories; no browser-supplied file path is accepted. */
function historyRoots(runtime,env){
 if(!runtimes.has(runtime))throw Error('Unsupported CLI');
 const home=env.HOME||homedir();
 return {codex:[join(env.CODEX_HOME||join(home,'.codex'),'sessions'),join(env.CODEX_HOME||join(home,'.codex'),'archived_sessions')],claude:[join(env.CLAUDE_CONFIG_DIR||join(home,'.claude'),'projects')],grok:[join(home,'.grok','sessions')],agy:[join(home,'.gemini','antigravity-cli','conversations')]}[runtime];
}

/** Bounded reads avoid loading complete transcripts; partial JSON lines are deliberately discarded. */
async function readWindow(file,root,tail=false,limit=131072){
 if(!inside(await realpath(root),await realpath(file)))throw Error('History outside CLI directory');
 const h=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const info=await h.stat();if(!info.isFile())throw Error('Not a history file');const start=tail?Math.max(0,info.size-limit):0,b=Buffer.alloc(Math.min(info.size,limit));const{bytesRead}=await h.read(b,0,b.length,start);let text=b.subarray(0,bytesRead).toString('utf8');if(start)text=text.slice(text.indexOf('\n')+1);return {text,partial:info.size>limit,modifiedAt:info.mtime.toISOString()};}finally{await h.close();}
}
const jsonLines=text=>text.split('\n').flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}});
const bodyText=content=>typeof content==='string'?content:Array.isArray(content)?content.map(c=>typeof c?.text==='string'?c.text:'').filter(Boolean).join('\n'):'';
function messagesFrom(rows,runtime){return rows.flatMap(row=>{
 const m=runtime==='codex'&&row.type==='response_item'?row.payload:runtime==='claude'?row.message:runtime==='grok'?{role:row.type,content:row.content}:null;
 if(!m||!['user','assistant'].includes(m.role))return [];
 const text=bodyText(m.content);return text?[{role:m.role,text:text.slice(0,12000),timestamp:row.timestamp||null}]:[];
});}

async function discover(runtime,env){
 const files=[];let visited=0,partial=false;
 for(const root of historyRoots(runtime,env)){
  async function walk(dir,depth){
   if(depth>6||visited>=20000){partial=true;return;}
   const entries=await readdir(dir,{withFileTypes:true}).catch(e=>{if(e.code==='ENOENT')return [];throw e;});
   entries.sort((a,b)=>b.name.localeCompare(a.name));
   for(const e of entries){if(++visited>20000){partial=true;break;}const path=join(dir,e.name);
    if(e.isSymbolicLink())continue;
    if(e.isDirectory()&&!['subagents','resources_state','terminal'].includes(e.name))await walk(path,depth+1);
    else if(e.isFile()){
     const id=runtime==='codex'?e.name.match(/-([a-f0-9]{8}-[a-f0-9-]{27})\.jsonl$/i)?.[1]:runtime==='grok'&&e.name==='chat_history.jsonl'?basename(dir):['claude','agy'].includes(runtime)&&/\.(jsonl|db|pb)$/.test(e.name)?e.name.replace(/\.(jsonl|db|pb)$/,''):null;
     if(id&&idPattern.test(id)){const info=await stat(path);files.push({id,path,root,modifiedAt:info.mtime.toISOString()});}
    }
   }
  }
  await walk(root,0);
 }
 return {files:files.sort((a,b)=>b.modifiedAt.localeCompare(a.modifiedAt)),partial};
}
const discoveryCache=new Map();
async function cachedDiscovery(runtime,env,after=0){
 const key=JSON.stringify([runtime,...historyRoots(runtime,env)]),prior=discoveryCache.get(key);
 if(prior&&Date.now()-prior.at<20000&&prior.at>=after)return prior.value;
 const value=await discover(runtime,env);discoveryCache.set(key,{at:Date.now(),value});return value;
}

async function describe(runtime,file){
 const row={id:file.id,runtime,title:file.id,workspace:null,modifiedAt:file.modifiedAt,previewAvailable:!file.path.endsWith('.db')&&!file.path.endsWith('.pb')};
 if(!row.previewAvailable)return row;
 const lines=jsonLines((await readWindow(file.path,file.root)).text);
 row.workspace=lines.find(x=>x.type==='session_meta')?.payload?.cwd||lines.find(x=>typeof x.cwd==='string')?.cwd||null;
 row.title=messagesFrom(lines,runtime).find(m=>m.role==='user')?.text.replace(/\s+/g,' ').slice(0,100)||file.id;
 if(runtime==='grok'){
  try{row.workspace=JSON.parse((await readWindow(join(dirname(file.path),'prompt_context.json'),file.root)).text).working_directory||row.workspace;}catch{}
  try{const meta=JSON.parse((await readWindow(join(dirname(file.path),'summary.json'),file.root)).text);row.title=meta.generated_title||row.title;}catch{}
 }
 return row;
}

const nativeView=(history,{nodeId=null,runtime=history?.runtime,origin='vendor',title=null,createdAt=null,id=history?.id,sessionId=history?.id,status=history?'ready':'missing_history',workspace=null,exactLastScan=null}={})=>({
 id,...(origin==='dialog'?{entryId:id}:{}),nodeId,runtime,sessionId:sessionId||null,title:title||history?.title||sessionId||id,
 createdAt:createdAt||null,modifiedAt:history?.modifiedAt||createdAt||null,workspace:workspace||history?.workspace||null,origin,status,
 hasHistory:Boolean(history),previewAvailable:Boolean(history?.previewAvailable),canReopen:origin==='dialog'&&status==='draft',canResume:Boolean(history)&&!['active','prepared'].includes(status),exactLastScan,...(history?.error?{error:history.error}:{})
});

/** Native history remains on its device; every filtered item is matched by an exact native ID. */
export async function listNativeSessions(runtime,{env=process.env,limit=100,scope='all',registry=[],managedSessions=[],nodeId=null}={}){
 if(!['created','group','all'].includes(scope))throw Error('Invalid native session scope');
 const dialogRecords=registry.filter(record=>record?.runtime===runtime),records=scope==='created'?dialogRecords:scope==='group'?managedSessions:[];
 const needsHistory=scope==='all'||records.some(record=>idPattern.test((record?.sessionId||record?.id)||'')&&!['draft','prepared','active'].includes(record.status));
 const refreshAfter=Math.max(0,...dialogRecords.map(record=>Date.parse(record.exactLastScan)||0)),{files=[],partial=false}=needsHistory?await cachedDiscovery(runtime,env,refreshAfter):{},unique=[...new Map(files.toReversed().map(f=>[f.id,f])).values()].sort((a,b)=>b.modifiedAt.localeCompare(a.modifiedAt)),byId=new Map(unique.map(file=>[file.id,file]));
 const described=new Map();
 const history=async id=>{
  if(!idPattern.test(id||'')||!byId.has(id))return null;
  if(!described.has(id)){const file=byId.get(id);try{described.set(id,await describe(runtime,file));}catch{described.set(id,{id,runtime,title:id,modifiedAt:file.modifiedAt,workspace:null,previewAvailable:false,error:'History could not be read'});}}
  return described.get(id);
 };
 let items=[],scopedTotal=0;
 if(scope==='created'){
  for(const record of records){
   const entryId=record.entryId||record.id;if(typeof entryId!=='string'||!entryId)continue;
   const exact=await history(record.sessionId),status=exact?(record.status==='active'||record.status==='prepared'?record.status:'ready'):record.sessionId?(record.status==='active'||record.status==='prepared'||record.status==='draft'?record.status:'awaiting_history'):(record.status||'awaiting_native_id');
   items.push(nativeView(exact,{nodeId,runtime,origin:'dialog',id:entryId,sessionId:record.sessionId,title:record.title,createdAt:record.createdAt,status,workspace:record.workspace,exactLastScan:record.exactLastScan}));
  }
 }else if(scope==='group'){
  for(const record of managedSessions){
   const sessionId=record?.sessionId||record?.id;if(!idPattern.test(sessionId||''))continue;
   items.push(nativeView(await history(sessionId),{nodeId,runtime,origin:'managed',id:sessionId,sessionId,title:record.title,createdAt:record.createdAt,status:byId.has(sessionId)?'ready':'missing_history',workspace:record.workspace}));
  }
 }else{
  const managedIds=new Set(managedSessions.map(record=>record?.sessionId||record?.id).filter(id=>idPattern.test(id||''))),dialogIds=new Set(dialogRecords.map(record=>record.sessionId).filter(id=>idPattern.test(id||'')));
  for(const record of dialogRecords){const entryId=record.entryId||record.id;if(typeof entryId!=='string'||!entryId)continue;const exact=await history(record.sessionId),status=exact?(record.status==='active'||record.status==='prepared'?record.status:'ready'):record.sessionId?(record.status==='active'||record.status==='prepared'||record.status==='draft'?record.status:'awaiting_history'):(record.status||'awaiting_native_id');items.push(nativeView(exact,{nodeId,runtime,origin:'dialog',id:entryId,sessionId:record.sessionId,title:record.title,createdAt:record.createdAt,status,workspace:record.workspace,exactLastScan:record.exactLastScan}));}
  const vendorFiles=unique.filter(file=>!managedIds.has(file.id)&&!dialogIds.has(file.id));scopedTotal=items.length+vendorFiles.length;
  for(const file of vendorFiles.slice(0,Math.max(0,limit-items.length))){const exact=await history(file.id);items.push(nativeView(exact,{nodeId}));}
 }
 items.sort((a,b)=>String(b.modifiedAt||b.createdAt||'').localeCompare(String(a.modifiedAt||a.createdAt||'')));
 return {items:items.slice(0,limit),partial:partial||items.length>limit||(scope==='all'&&scopedTotal>limit)};
}

/** Resume and preview resolve an exact native ID on the selected device, never a filename from the client. */
export async function readNativeSession(runtime,id,{env=process.env}={}){
 if(!idPattern.test(id||''))throw Error('Invalid native session ID');
 const {files}=await discover(runtime,env),file=files.find(f=>f.id===id);if(!file)throw Error('Native session not found on this device');
 const info=await describe(runtime,file);if(!info.previewAvailable)return {...info,messages:[],notice:'This CLI history format has no text preview. Continue in the native terminal.'};
 const window=await readWindow(file.path,file.root,true,524288),messages=messagesFrom(jsonLines(window.text),runtime);
 return {...info,messages:messages.slice(-80),partial:window.partial||messages.length>80};
}

/** Native defaults stay intact unless the user explicitly opts into unrestricted execution. */
export function nativeTuiArgs(runtime,{id,freshId=null,allowAll=false}={}){
 if(!runtimes.has(runtime)||typeof allowAll!=='boolean')throw Error('Invalid CLI or permission mode');
 if(id&&freshId)throw Error('A native session cannot resume and create at the same time');
 if(freshId&&!idPattern.test(freshId))throw Error('Invalid exact fresh session ID');
 const fresh=freshId?{claude:['--session-id',freshId],grok:['--session-id',freshId]}[runtime]:[];
 if(freshId&&!fresh)throw Error('This CLI does not support an exact fresh session ID');
 return [...(id?resumeArgs(runtime,id):fresh),...(allowAll?{codex:['--dangerously-bypass-approvals-and-sandbox'],claude:['--dangerously-skip-permissions'],grok:['--always-approve','--permission-mode','bypassPermissions'],agy:['--dangerously-skip-permissions']}[runtime]:[])];
}
