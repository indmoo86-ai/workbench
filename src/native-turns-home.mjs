import { join } from 'node:path';
import { Attachments } from './attachments.mjs';
import { NativeTurnsHome } from './native-turns.mjs';
import { assertNativeSessionIdle } from './native-sessions.mjs';

/**
 * Home's only takeover entry. home.mjs forwards HTTP requests, two Worker message types and disconnects here.
 * Takeover files reuse the Attachments storage/validation code but live in their own directory and record kind,
 * so group-chat attachments, projects and runs are never read or written by this module.
 */
export function createHomeNativeTurns({db,dataDir,send,online,change}) {
  const ownDb=Object.create(db,{
    get:{value:(kind,id)=>kind==='projects'&&String(id).startsWith('native:')?{id}:db.get(kind==='attachments'?'nativeTurnAttachments':kind,id)},
    put:{value:(kind,value)=>db.put(kind==='attachments'?'nativeTurnAttachments':kind,value)}
  });
  const attachments=new Attachments(ownDb,join(dataDir,'native-turn-attachments'));
  const turns=new NativeTurnsHome({db,attachments,send,online,change,assertIdle:input=>assertNativeSessionIdle(db,{...input,workspace:null,projectId:null})});
  turns.recover();
  const file=(res,{item,bytes},disposition=true)=>{res.writeHead(200,{'Content-Type':item.mime,'Content-Length':bytes.length,'Cache-Control':'private, no-store',
    ...(disposition?{'Content-Disposition':`${item.mime.startsWith('image/')?'inline':'attachment'}; filename*=UTF-8''${encodeURIComponent(item.name)}`}:{})});res.end(bytes);return true;};
  /** Returns true when the request belonged to the takeover API. Authentication has already been checked by home.mjs. */
  async function http(req,res,{pathname,url,json,body}) {
    let m=pathname.match(/^\/api\/agent\/native-turns\/([^/]+)\/([^/]+)$/);
    if(m&&req.method==='GET'){const {owner,id}=turns.attachmentFor(m[1],m[2]);return file(res,await attachments.read(owner,id),false);}
    m=pathname.match(/^\/api\/native-sessions\/([^/]+)\/(attachments|takeover|turns)(?:\/([^/]+))?(?:\/([^/]+))?$/);
    if(!m)return false;
    const nodeId=decodeURIComponent(m[1]),worker=db.get('workers',nodeId);if(!worker)throw Error('Device is unavailable');
    const [,,area,a,b]=m;
    if(area==='attachments'&&req.method==='POST'&&!a){json(res,await attachments.upload(NativeTurnsHome.owner(nodeId),req),201);return true;}
    if(area==='attachments'&&req.method==='GET'&&a&&!b)return file(res,await attachments.read(NativeTurnsHome.owner(nodeId),decodeURIComponent(a)));
    if(area==='takeover'&&a==='release'&&!b&&req.method==='POST'){json(res,turns.release(nodeId,await body(req)));return true;}
    if(area==='turns'&&!a&&req.method==='GET'){const q=url.searchParams,[runtime,sessionId]=[q.get('runtime'),q.get('sessionId')];
      json(res,{items:turns.list(nodeId,runtime,sessionId),process:turns.process(nodeId,runtime,sessionId)?'open':'closed',supported:worker.capabilities?.nativeTurns===2});return true;}
    if(area==='turns'&&!a&&req.method==='POST'){json(res,turns.create(nodeId,worker,await body(req)),201);return true;}
    if(area==='turns'&&a&&b==='stop'&&req.method==='POST'){json(res,turns.stop(nodeId,decodeURIComponent(a)));return true;}
    throw Error('Invalid session action');
  }
  return {turns,http,
    message:(nodeId,m)=>['native_turn_event','native_takeover_closed'].includes(m.type)?(turns.receive(nodeId,m),true):false,
    disconnected:nodeId=>turns.disconnected(nodeId)};
}
