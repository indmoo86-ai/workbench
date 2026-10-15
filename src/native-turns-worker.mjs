import { mkdir, open, rename, unlink, readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { NativeTurnRunner } from './native-turns.mjs';
import { createNativeSession } from './native-turn-sessions.mjs';
import { readNativeSession, assertNativeSessionIdle } from './native-sessions.mjs';

const LIMIT=20*1024*1024,COUNT=6,uuid=/^[a-f0-9-]{36}$/;

/** Takeover attachments are verified from Home into the Worker's own data folder, never into the user's session folder. */
export async function receiveTurnFiles({items=[],turnId,root,home,token,fetchImpl=fetch}) {
  if(!items.length)return [];
  if(!uuid.test(turnId)||items.length>COUNT)throw new Error('Invalid takeover attachments');
  const directory=join(root,turnId);await mkdir(directory,{recursive:true,mode:0o700});
  const received=[];
  for(const item of items){
    if(!uuid.test(item.id)||!Number.isSafeInteger(item.size)||item.size<1||item.size>LIMIT||!/^[a-f0-9]{64}$/.test(item.sha256||'')||typeof item.name!=='string')throw new Error('Invalid takeover attachment');
    const response=await fetchImpl(new URL(`/api/agent/native-turns/${turnId}/${item.id}`,home),{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(60000)});
    if(!response.ok)throw new Error(`Attachment download failed: ${item.name} (${response.status})`);
    const bytes=Buffer.from(await response.arrayBuffer());
    if(bytes.length!==item.size||createHash('sha256').update(bytes).digest('hex')!==item.sha256)throw new Error('Attachment verification failed');
    const extension=/\.[A-Za-z0-9]{1,16}$/.exec(item.name)?.[0]||'';
    const path=join(directory,`${item.id}${extension}`),temp=join(directory,`${randomUUID()}.part`),handle=await open(temp,'wx',0o600);
    try{await handle.writeFile(bytes);await handle.close();await rename(temp,path);}catch(error){await handle.close().catch(()=>{});await unlink(temp).catch(()=>{});throw error;}
    received.push({id:item.id,name:item.name,mime:item.mime,size:item.size,path:await realpath(path)});
  }
  return received;
}

/** The Worker's only takeover entry: worker.mjs passes its state accessors and routes four message types here. */
export function createWorkerNativeTurns({db,send,data,homeHttp,token,projectRoot,isPaused,runtimes,capacity,occupiedSlots}) {
  return new NativeTurnRunner({
    send,
    canStart:(m,{reusing})=>{
      if(isPaused())throw Error('Remote execution is paused');
      if(!runtimes().some(r=>r.type===m.runtime&&r.available&&r.supported!==false))throw Error('CLI is not available on this device');
      if(!reusing&&occupiedSlots()>capacity())throw Error('Device CLI capacity is full');
    },
    prepareInputs:async m=>{
      const files=await receiveTurnFiles({items:m.attachments||[],turnId:m.id,root:join(data,'native-turn-files'),home:homeHttp,token});
      const images=m.runtime==='claude'?await Promise.all(files.filter(f=>f.mime.startsWith('image/')).map(async f=>({mime:f.mime,data:(await readFile(f.path)).toString('base64')}))):[];
      return {files,images};
    },
    resolveSession:async(runtime,sessionId)=>{
      const history=await readNativeSession(runtime,sessionId);if(!history.workspace)return {workspace:null};
      const workspace=await projectRoot(history.workspace);assertNativeSessionIdle(db,{runtime,sessionId,workspace,projectId:null});return {workspace};
    },
    createSession:options=>createNativeSession(options)
  });
}
