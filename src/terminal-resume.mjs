import { userInfo, homedir } from 'node:os';
import { readdir, stat, access, realpath } from 'node:fs/promises';
import { constants, readFileSync } from 'node:fs';
import { join, resolve, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { Store } from './store.mjs';
import { tr } from './i18n.mjs';
import {syncError} from './source-sync-manifest.mjs';

const sessionPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{7,127}$/;
const quote = value => `'${String(value).replaceAll("'", "'\\''")}'`;
const closed = new Set(['released', 'cancelled']);
export const TERMINAL_PREPARATION_TTL_MS = 5 * 60 * 1000;

/** Only accept the CLI's session fields; an arbitrary tool call id is never treated as a session. */
export function nativeSessionId(raw, runtime) {
  const id = runtime === 'agy'
    ? raw.conversationId || raw.conversation_id || raw.session_id || raw.sessionId
    : raw.session_id || raw.sessionId;
  return typeof id === 'string' && sessionPattern.test(id) ? id : null;
}

/** Use an explicit native ID; never last, continue, or fork. */
export function resumeArgs(runtime, id) {
  if (!sessionPattern.test(id || '')) throw new Error(tr('terminalResume.validNativeSessionIdMissing'));
  const option = { codex:'resume', claude:'--resume', grok:'--resume', agy:'--conversation' }[runtime];
  if (!option) throw new Error(tr('terminalResume.cliDoesNotSupportResume'));
  return [option, id];
}

/** Start an interactive CLI with the saved role settings; never continue, fork or reference an old native ID. */
export function freshTerminalArgs({runtime,model,effort,instructions='',workspace}) {
  if(typeof model!=='string'||!model||typeof instructions!=='string'||(effort&&typeof effort!=='string'))throw new Error(tr('roleTerminal.unconfigured'));
  if(runtime==='codex')return ['--model',model,'--sandbox','workspace-write','--ask-for-approval','never','-c',`developer_instructions=${JSON.stringify(instructions)}`,'-c','sandbox_workspace_write.network_access=true',...(effort?['-c',`model_reasoning_effort=${JSON.stringify(effort)}`]:[])];
  if(runtime==='claude')return ['--model',model,'--append-system-prompt',instructions,'--dangerously-skip-permissions',...(effort?['--effort',effort]:[])];
  if(runtime==='grok')return ['--cwd',workspace,'-m',model,'--rules',instructions,'--always-approve','--no-plan','--permission-mode','bypassPermissions',...(effort?['--reasoning-effort',effort]:[])];
  if(runtime==='agy')return ['--model',model,'--mode','accept-edits','--dangerously-skip-permissions',...(effort?['--effort',effort]:[]),...(instructions?['--prompt-interactive',instructions]:[])];
  throw new Error(tr('terminalResume.cliDoesNotSupportResume'));
}

/** Take over the whole project's execution window on this node, avoiding concurrent use of the shared directory and deliveries. */
export function projectTerminalLock(db, projectId, nodeId) {
  return db.list('terminalSessions').find(s => s.projectId === projectId && s.nodeId === nodeId && !closed.has(s.status)) || null;
}

export function processAlive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code !== 'ESRCH'; }
}

/** A PID alone can be reused; capture the owner and start identity without exposing process arguments. */
export function terminalProcessIdentity(pid) {
  if(!Number.isInteger(pid)||pid<1)return null;
  try{
    const line=execFileSync('ps',['-p',String(pid),'-o','pid=,ppid=,uid=,pgid=,lstart=,stat=,command='],{encoding:'utf8',timeout:3000,maxBuffer:128000,env:{...process.env,LC_ALL:'C'},stdio:['ignore','pipe','ignore']}).trim();
    const m=line.match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\w{3}\s+\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(\S+)\s+([\s\S]*)$/);
    if(!m)throw new Error('ps');
    let start=m[5];
    if(process.platform==='linux'){const stat=readFileSync(`/proc/${pid}/stat`,'utf8');start=readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim()+':'+stat.slice(stat.lastIndexOf(')')+2).split(' ')[19];}
    return {pid:Number(m[1]),ppid:Number(m[2]),uid:Number(m[3]),pgid:Number(m[4]),start,zombie:m[6].startsWith('Z'),command:m[7]};
  }catch{return processAlive(pid)?{pid,unknown:true}:null;}
}
const processKey=p=>p&&!p.unknown?{pid:p.pid,uid:p.uid,start:p.start}:null;
const sameProcess=(actual,expected)=>!!actual&&!actual.unknown&&actual.pid===expected?.pid&&actual.uid===expected.uid&&actual.start===expected.start;
export {processKey as processIdentityKey,sameProcess as sameProcessIdentity};

/** Old sessions are accepted only with a live, recognizable launcher or its direct child; uncertainty never authorizes a signal. */
function terminalProcesses(session,dbPath) {
  const wrapper=terminalProcessIdentity(session.pid),child=terminalProcessIdentity(session.childPid),owned=[];
  let unknown=false;
  const live=p=>p&&!p.zombie;
  const wrapperOwned=live(wrapper)&&(session.wrapperIdentity?sameProcess(wrapper,session.wrapperIdentity):!wrapper.unknown&&wrapper.command.includes('terminal-resume.mjs')&&wrapper.command.includes(dbPath)&&wrapper.command.includes(session.id));
  if(wrapperOwned)owned.push(processKey(wrapper));
  else if(live(wrapper)&&(!session.wrapperIdentity||wrapper.unknown||wrapper.start===session.wrapperIdentity.start&&wrapper.uid!==session.wrapperIdentity.uid))unknown=true;
  const childOwned=live(child)&&(session.childIdentity?sameProcess(child,session.childIdentity):!child.unknown&&wrapperOwned&&child.ppid===wrapper.pid&&child.uid===wrapper.uid);
  if(childOwned)owned.push(processKey(child));
  else if(live(child)&&(!session.childIdentity||child.unknown||child.start===session.childIdentity.start&&child.uid!==session.childIdentity.uid))unknown=true;
  for(const expected of session.stopProcesses||[]){const actual=terminalProcessIdentity(expected.pid);if(live(actual)&&sameProcess(actual,expected))owned.push(expected);else if(actual?.unknown||live(actual)&&actual.start===expected.start&&actual.uid!==expected.uid)unknown=true;}
  return {owned:[...new Map(owned.map(p=>[p.pid,p])).values()],unknown};
}

/** Revoke unused/dead links in the same transaction as native claiming; late preparation cannot resurrect the lease. */
export function checkTerminalSession(db,binding,dbPath,{automatic=false}={}) {
  return db.transaction(()=>{
    const prior=db.get('terminalSessions',binding.id),checkedAt=new Date().toISOString();
    if(prior&&(prior.projectId!==binding.projectId||prior.nodeId!==binding.nodeId))throw new Error(tr('worker.invalidTakeoverId'));
    if(!prior||closed.has(prior.status)){db.put('terminalSessions',{...binding,...prior,status:'released',releasedAt:prior?.releasedAt||checkedAt});return {id:binding.id,status:'released',processState:'released',checkedAt};}
    // Background checks allow time to open a new link; manual refresh remains an explicit revocation of unused links.
    if(automatic&&prior.status==='prepared'&&!prior.pid&&!prior.childPid&&Date.now()-Date.parse(prior.createdAt)<TERMINAL_PREPARATION_TTL_MS) {
      db.put('terminalSessions',{...prior,lastCheckedAt:checkedAt,processState:'prepared'});
      return {id:prior.id,status:'prepared',processState:'prepared',checkedAt};
    }
    const proof=terminalProcesses(prior,dbPath),processState=proof.unknown?'unknown':proof.owned.length?'active':'released';
    db.put('terminalSessions',{...prior,lastCheckedAt:checkedAt,processState,...(processState==='released'?{status:'released',releasedAt:checkedAt}:{})});
    return {id:prior.id,status:processState==='released'?'released':prior.status,processState,checkedAt,...(proof.unknown?{reason:tr('terminalControl.identityUnknown')}:{})};
  });
}

/** Stop only verified descendants of this launcher/CLI, rechecking every identity before signalling. */
export async function stopTerminalSession(db,binding,dbPath,{graceMs=3000,killMs=3000}={}) {
  const checked=checkTerminalSession(db,binding,dbPath);
  if(checked.processState==='released')return {...checked,released:true,forced:false};
  if(checked.processState==='unknown')throw new Error(tr('terminalControl.identityUnknown'));
  const tracked=new Map();
  const collect=()=>{
    const prior=db.get('terminalSessions',binding.id),proof=terminalProcesses(prior,dbPath);
    if(proof.unknown)throw new Error(tr('terminalControl.identityUnknown'));
    for(const p of proof.owned)tracked.set(p.pid,p);
    const parents=new Set(proof.owned.map(p=>p.pid));
    const rows=execFileSync('ps',['-axo','pid=,ppid='],{encoding:'utf8',timeout:3000,maxBuffer:1024*1024}).trim().split('\n').map(s=>s.trim().split(/\s+/).map(Number));
    let changed=true;while(changed){changed=false;for(const [pid,parent]of rows){if(tracked.has(pid)||!parents.has(parent))continue;if(!sameProcess(terminalProcessIdentity(parent),tracked.get(parent)))continue;const p=terminalProcessIdentity(pid);if(!p||p.zombie)continue;if(p.unknown||p.uid!==tracked.get(parent).uid)throw new Error(tr('terminalControl.identityUnknown'));tracked.set(pid,processKey(p));parents.add(pid);changed=true;}}
    db.transaction(()=>{const current=db.get('terminalSessions',binding.id);if(!closed.has(current.status))db.put('terminalSessions',{...current,status:'stopping',stopProcesses:[...tracked.values()]});});
  };
  const alive=()=>[...tracked.values()].some(p=>{const actual=terminalProcessIdentity(p.pid);return actual?.unknown||sameProcess(actual,p)&&!actual.zombie;});
  const signal=name=>{const launcherPid=db.get('terminalSessions',binding.id)?.pid;for(const expected of [...tracked.values()].reverse()){if(name==='SIGTERM'&&expected.pid===launcherPid&&tracked.size>1)continue;const current=terminalProcessIdentity(expected.pid);if(current?.unknown)throw new Error(tr('terminalControl.identityUnknown'));if(sameProcess(current,expected)&&!current.zombie){if(typeof process.getuid==='function'&&current.uid!==process.getuid())throw new Error(tr('terminalControl.identityUnknown'));try{process.kill(expected.pid,name);}catch(e){if(e.code!=='ESRCH')throw e;}}}};
  collect();signal('SIGTERM');let forced=false;
  const wait=async ms=>{const until=Date.now()+ms;while(alive()&&Date.now()<until){await new Promise(r=>setTimeout(r,100));collect();}return !alive();};
  if(!await wait(graceMs)){forced=true;collect();signal('SIGKILL');if(!await wait(killMs))throw new Error(tr('terminalControl.stopPending'));}
  const result=checkTerminalSession(db,binding,dbPath);
  if(result.processState!=='released')throw new Error(tr('terminalControl.stopPending'));
  return {...result,released:true,forced};
}

/** The native CLI environment is stored only in the Worker's private database; secrets are never passed to Home or in the launch link. */
export function resumeEnvironment(env) {
  return Object.fromEntries(Object.entries(env).filter(([key])=>
    /^(HOME|PATH|USER|LOGNAME|SHELL|LANG|LC_.*|TMPDIR|XDG_.*|GIT_CONFIG_GLOBAL|GIT_TERMINAL_PROMPT|CODEX_.*|CLAUDE_.*|ANTHROPIC_.*|OPENAI_.*|GROK_.*|XAI_.*|AGY_.*|GOOGLE_.*|GEMINI_.*|HTTPS?_PROXY|ALL_PROXY|NO_PROXY|https?_proxy|all_proxy|no_proxy|NODE_EXTRA_CA_CERTS|SSL_CERT_FILE|SSL_CERT_DIR)$/.test(key)));
}

/** Record the same user and storage paths; tokens and managed wb credentials are not recorded. */
export async function nativeEnvironment(runtime, env = process.env) {
  const command = env[`${runtime.toUpperCase()}_BIN`] || runtime;
  let binary;
  for (const file of command.includes('/') ? [resolve(command)] : String(env.PATH || '').split(delimiter).map(p => join(p, command))) {
    try { await access(file, constants.X_OK); binary = file; break; } catch {}
  }
  if (!binary) throw new Error(tr('terminalResume.originalCliExecutableWasNot'));
  const paths = Object.fromEntries(['HOME','CODEX_HOME','CLAUDE_CONFIG_DIR','XDG_CONFIG_HOME','XDG_DATA_HOME','PATH'].filter(k => env[k]).map(k => [k, env[k]]));
  return { runtime, user:userInfo().username, home:env.HOME || homedir(), binary, env:paths };
}

/** Search the vendor session directory by exact ID only; if missing, refuse to create a blank session. */
export async function findSessionHistory(session) {
  const { runtime, id, home, env = {} } = session;
  resumeArgs(runtime, id);
  const roots = {
    codex:[join(env.CODEX_HOME || join(home,'.codex'),'sessions'),join(env.CODEX_HOME || join(home,'.codex'),'archived_sessions')],
    claude:[join(env.CLAUDE_CONFIG_DIR || join(home,'.claude'),'projects')],
    grok:[join(home,'.grok','sessions')],
    agy:[join(home,'.gemini','antigravity-cli','conversations')]
  }[runtime];
  let visited = 0;
  async function walk(dir, depth = 0) {
    let entries; try { entries = await readdir(dir,{withFileTypes:true}); } catch (e) { if(e.code==='ENOENT')return null; throw e; }
    for (const entry of entries) {
      if (++visited > 20000) throw new Error(tr('terminalResume.sessionDirectoryTooLargeCould'));
      const file = join(dir,entry.name);
      if (entry.isFile() && (entry.name === `${id}.jsonl` || entry.name === `${id}.pb` || (runtime==='agy'&&entry.name===`${id}.db`) || (runtime==='codex' && entry.name.endsWith(`-${id}.jsonl`)))) return file;
      if (runtime==='grok' && entry.isDirectory() && entry.name===id) {
        const history = join(file,'chat_history.jsonl');
        try { if((await stat(history)).size>0)return history; } catch {}
      }
      if (entry.isDirectory() && depth < 5 && !['subagents','resources_state','terminal'].includes(entry.name)) {
        const match = await walk(file,depth+1); if(match)return match;
      }
    }
    return null;
  }
  for (const root of roots) { const file=await walk(root); if(file && (await stat(file)).size>0)return file; }
  throw new Error(tr('terminalResume.nativeSessionHistoryForUser'));
}

/** iTerm decodes percent escapes, not form '+' spaces; rebuild old saved links without changing their takeover identity. */
export function terminalLaunchView(session) {
  return session.command?{...session,url:`iterm2:/command?c=${encodeURIComponent(session.command)}`}:session;
}

/** Generate a reviewable command; the link carries no password or platform token. */
export function terminalCommand(info, device = null, identityFile = null) {
  const command = info.launcher.map(quote).join(' ');
  if (!device) return command;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9.:-]*$/.test(device.host || '') || !/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(device.user || '') || !/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(info.user || '') || !Number.isInteger(Number(device.port)) || device.port<1 || device.port>65535) throw new Error(tr('terminalResume.sshConfigurationIncomplete'));
  const remote = device.user === info.user ? command : `sudo -H -u ${quote(info.user)} -- ${command}`;
  return ['ssh','-t',...(identityFile?['-i',identityFile]:[]),'-p',String(device.port),`${device.user}@${device.host}`,remote].map(quote).join(' ');
}

/** A link may be claimed by only one terminal process; an old link cannot run again after release. */
export function claimTerminalSession(db, id, pid) {
  return db.transaction(() => {
    const s=db.get('terminalSessions',id);
    if(s?.status!=='prepared')throw new Error(tr('terminalResume.takeoverHasAlreadyStartedBeen'));
    if(db.get('sourceSyncReservations',s.projectId))throw syncError('sync_busy');
    const wrapperIdentity=processKey(terminalProcessIdentity(pid));
    if(!wrapperIdentity)throw new Error(tr('terminalControl.identityUnknown'));
    return db.put('terminalSessions',{...s,status:'active',pid,wrapperIdentity,startedAt:new Date().toISOString()});
  });
}

/** Shares the SQLite write transaction with the other process's claim, so it cannot be preempted after the PID check. */
export function releaseTerminalSession(db,id) {
  return db.transaction(()=>{
    const prior=db.get('terminalSessions',id);
    if(prior && (processAlive(prior.pid)||processAlive(prior.childPid)))throw new Error(tr('terminalResume.terminalCliHasNotExited'));
    return db.put('terminalSessions',{...prior,id,status:'released'});
  });
}

/** Native exit is recorded locally; manual refresh verifies it with the Worker before resuming platform dispatch. */
async function runTerminal(dbPath,id) {
  const db=new Store(dbPath), before=db.get('terminalSessions',id);
  if(!before?.nativeSession || before.nativeSession.user!==userInfo().username)throw new Error(tr('terminalResume.runningUserDoesNotMatch'));
  if(!(await stat(before.workspace)).isDirectory())throw new Error(tr('terminalResume.originalWorkingDirectoryDoesNot'));
  if(['new','native'].includes(before.kind)&&await realpath(before.workspace)!==before.workspace)throw new Error(tr('terminalResume.originalWorkingDirectoryDoesNot'));
  if(before.kind!=='new'&&(before.kind!=='native'||before.nativeSession.id))await findSessionHistory(before.nativeSession);
  await access(before.nativeSession.binary,constants.X_OK);
  if(before.kind==='native')(await import('./native-sessions.mjs')).assertNativeSessionIdle(db,{runtime:before.nativeSession.runtime,sessionId:before.nativeSession.id,workspace:before.workspace,projectId:before.projectId,claimId:id});
  const session=claimTerminalSession(db,id,process.pid);
  const args=session.kind==='native'?(await import('./native-sessions.mjs')).nativeTuiArgs(session.nativeSession.runtime,{id:session.nativeSession.id,...session.nativeOptions}):session.kind==='new'?freshTerminalArgs({...session.roleSettings,runtime:session.nativeSession.runtime,workspace:session.workspace}):resumeArgs(session.nativeSession.runtime,session.nativeSession.id);
  console.log(session.kind==='new'||session.kind==='native'&&!session.nativeSession.id?tr('roleTerminal.startingNew',{workspace:session.workspace}):tr('terminalResume.resumingOriginalSessionDirectoryPlatform', { id: session.nativeSession.id, workspace: session.workspace }));
  const env={...session.privateEnv};
  for(const key of ['TERM','COLORTERM','TERM_PROGRAM','TERM_PROGRAM_VERSION'])if(process.env[key])env[key]=process.env[key];
  const child=spawn(session.nativeSession.binary,args,{cwd:session.workspace,env,stdio:'inherit'});
  // Ctrl-C is handed to the CLI; the wrapper process stays until the child process actually exits.
  const onSignal=()=>{};process.on('SIGINT',onSignal);process.on('SIGTERM',()=>child.kill('SIGTERM'));
  db.transaction(()=>{const current=db.get('terminalSessions',id);if(closed.has(current.status)){child.kill('SIGTERM');return;}db.put('terminalSessions',{...current,childPid:child.pid,childIdentity:processKey(terminalProcessIdentity(child.pid))});});
  const code=await new Promise(resolve=>{child.once('error',e=>{console.error(e.message);resolve(1);});child.once('exit',code=>resolve(code??1));});
  db.transaction(()=>{const current=db.get('terminalSessions',id);if(!closed.has(current.status))db.put('terminalSessions',{...current,status:'finished',finishedAt:new Date().toISOString()});});
  process.removeListener('SIGINT',onSignal);db.db.close();process.exitCode=code;
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  runTerminal(process.argv[2],process.argv[3]).catch(e=>{console.error(e.message);process.exitCode=1;});
}
