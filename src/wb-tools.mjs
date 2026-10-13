import { mkdir, readFile, writeFile, readdir, stat, realpath } from 'node:fs/promises';
import {createHash} from 'node:crypto';
import { agentRequest } from './agent-bridge.mjs';
import { join, resolve, relative, isAbsolute, dirname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tr } from './i18n.mjs';

const exec = promisify(execFile);
const now = () => new Date().toISOString();

function env(name, fallback = '') {
  return String(process.env[name] || fallback).trim();
}

export function context() {
  const projectRoot = env('WB_PROJECT_ROOT');
  const knowledge = env('WB_KNOWLEDGE') || (projectRoot ? join(projectRoot, '.workbench') : '');
  return {
    projectRoot,
    knowledge,
    workspace: env('WB_WORKSPACE'),
    runId: env('WB_RUN_ID'),
    role: env('WB_ROLE'),
    hop: Number(env('WB_HOP') || 0),
    home: env('WB_HOME'),
    token: env('WB_TOKEN'),
    mode: env('WB_MODE'),reviewPrivate:env('WB_REVIEW_PRIVATE'),documentViews:env('WB_DOCUMENT_VIEWS')==='1'
  };
}

function inside(root, path) {
  const rel = relative(root, path);
  return !rel || (!rel.startsWith('..') && !isAbsolute(rel));
}

async function ensureKnowledge(dir) {
  if (!dir) throw new Error(tr('wbTools.wbKnowledgeWbProjectRoot'));
  await mkdir(join(dir, 'docs'), { recursive: true });
  await mkdir(join(dir, 'handoffs'), { recursive: true });
  return dir;
}

export async function boot() {
  const ctx = context();
  const knowledge = await ensureKnowledge(ctx.knowledge);
  const last = ctx.documentViews&&ctx.home&&ctx.runId?(await homeFetch('/api/agent/documents',{runId:ctx.runId,action:'last'}).catch(()=>null))?.text||'':await readFile(join(knowledge, 'handoffs', 'LATEST.md'), 'utf8').catch(() => '');
  return {
    ok: true,
    role: ctx.role || null,
    hop: ctx.hop,
    knowledge,
    projectRoot: ctx.projectRoot,
    lastHandoff: last.slice(0, 2000) || null
  };
}

export async function docsList() {
  const ctx=context();if(ctx.documentViews&&ctx.home&&ctx.runId)return homeFetch('/api/agent/documents',{runId:ctx.runId,action:'list'});
  const dir = await ensureKnowledge(context().knowledge);
  const docs = join(dir, 'docs');
  let names = [];
  try { names = (await readdir(docs)).filter(n => !n.startsWith('.')); } catch { names = []; }
  return { docs: names };
}

export async function docsRead(rel) {
  const ctx=context();if(ctx.documentViews&&ctx.home&&ctx.runId)return homeFetch('/api/agent/documents',{runId:ctx.runId,action:'read',path:String(rel||'')});
  const dir = await ensureKnowledge(context().knowledge);
  const target = resolve(dir, String(rel || ''));
  if (!inside(dir, target)) throw new Error(tr('wbTools.onlyFilesInsideWorkbenchCan'));
  const st = await stat(target);
  if (!st.isFile()) throw new Error(tr('wbTools.notFile'));
  if (st.size > 200000) throw new Error(tr('wbTools.fileExceeds200kbUseShorter'));
  return { path: relative(dir, target), text: await readFile(target, 'utf8') };
}

function gitEnv() {
  return { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: 'ssh -oBatchMode=yes -oStrictHostKeyChecking=yes -oConnectTimeout=8' };
}

async function gitCwd() {
  const root = context().workspace || context().projectRoot;
  if (!root) throw new Error(tr('wbTools.wbProjectRootNotSet'));
  return root;
}

async function git(args) {
  const cwd = await gitCwd();
  const { stdout, stderr } = await exec('git', args, { cwd, timeout: 60000, maxBuffer: 1024 * 1024, env: gitEnv() });
  return { stdout: stdout.trim(), stderr: stderr.trim(), cwd };
}

export async function gitStatus() {
  const { stdout, cwd } = await git(['status', '-sb']);
  let origin = '';
  try { origin = (await git(['remote', 'get-url', 'origin'])).stdout; } catch { origin = ''; }
  return { cwd, origin, status: stdout };
}

async function homeFetch(pathname, payload) {
  const ctx = context();
  if (!ctx.home) throw new Error(tr('wbTools.wbHomeNotSet'));
  return agentRequest(pathname, payload);
}

export async function chatPost(text) {
  if (!String(text || '').trim()) throw new Error(tr('wbTools.chatNeedsText'));
  return homeFetch('/api/agent/note', { runId: context().runId, text: String(text).trim() });
}

export async function askRole(name, text) {
  const ctx = context();
  if (!name || !text) throw new Error(tr('wbTools.usageWbAskRoleName'));
  return homeFetch('/api/agent/ask', { runId: ctx.runId, role: String(name).replace(/^@/, ''), text: String(text).trim() });
}

/** The platform handles cross-node communication; local tools neither connect to other CLIs directly nor read their workspaces. */
export async function callRole({ role, kind = 'consult', requestId, text, file, deliveryId,sourceSyncBatchId }) {
  if (!role || !text || !requestId) throw new Error(tr('wbTools.roleTextStableRequestId'));
  if (!['consult', 'handoff','direct'].includes(kind)) throw new Error(tr('wbTools.kindMustBeConsultHandoff'));
  if(file!==undefined) {
    const document=await callDocument(file);
    // Quoted JSON remains reference data through language conversion and preserves the exact Unicode text and digest.
    text=`${text}\n\n${tr('wbTools.callDocumentReference')}\n${JSON.stringify(document)}`;
  }
  if(text.length>12000)throw new Error(tr('wbTools.callDocumentTooLong'));
  return homeFetch('/api/agent/calls', { runId: context().runId, role, kind,
    requestId: `${context().runId}:${requestId}`, text, deliveryId,sourceSyncBatchId });
}

/** Read only caller-bound files; copying bytes here avoids asking the model to retype an encoded document. */
export async function callDocument(file,ctx=context()) {
  if(ctx.reviewPrivate)throw new Error(tr('wbTools.callDocumentReviewGuard'));
  if(typeof file!=='string'||!file.trim())throw new Error(tr('wbTools.callDocumentNotText'));
  const base=ctx.workspace||ctx.projectRoot;
  if(!base)throw new Error(tr('wbTools.wbProjectRootNotSet'));
  const roots=[base,ctx.projectRoot,ctx.knowledge,...JSON.parse(env('WB_REPOSITORIES','[]')).map(r=>r.localRoot)].filter(Boolean);
  const target=await realpath(resolve(base,file));
  const allowed=await Promise.all(roots.map(root=>realpath(root).catch(()=>null)));
  const owner=allowed.find(root=>root&&inside(root,target));
  if(!owner)throw new Error(tr('wbTools.callDocumentOutside'));
  const info=await stat(target);
  if(!info.isFile())throw new Error(tr('wbTools.notFile'));
  if(info.size>200000)throw new Error(tr('wbTools.fileExceeds200kbUseShorter'));
  const bytes=await readFile(target);
  if(bytes.length>200000)throw new Error(tr('wbTools.fileExceeds200kbUseShorter'));
  let text;
  try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}catch{throw new Error(tr('wbTools.callDocumentNotText'));}
  if(text.includes('\0'))throw new Error(tr('wbTools.callDocumentNotText'));
  return {path:relative(owner,target),bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),text};
}

export async function waitForRole(summary,options={}) {
  return homeFetch('/api/agent/wait', { runId: context().runId, summary,requestIds:options.requestIds,timeoutSeconds:options.timeoutSeconds });
}

/** Only submits a delivery request; once the user approves it, the Worker pushes the specified SHA. */
export async function requestDelivery(requestId, commit, summary) {
  if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(requestId)
    || typeof commit !== 'string' || (commit !== 'auto' && !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit))
    || typeof summary !== 'string' || !summary.trim() || summary.length > 8000) throw new Error(tr('wbTools.deliveryUsage'));
  if (commit === 'auto') {
    const repositories = JSON.parse(process.env.WB_REPOSITORIES || '[]');
    if (!repositories.length) throw new Error(tr('wbTools.currentRunHasNoDeliverable'));
    const items = [];
    for (const repo of repositories) {
      const head = (await exec('git',['rev-parse','HEAD'],{cwd:repo.localRoot,timeout:5000})).stdout.trim();
      items.push({id:repo.id,repoUrl:repo.repoUrl,commit:head});
    }
    return homeFetch('/api/agent/deliveries',{runId:context().runId,requestId,commit:items[0].commit,items,summary});
  }
  return homeFetch('/api/agent/deliveries', { runId: context().runId, requestId, commit, summary });
}

async function gitSnapshot(cwd) {
  if (!cwd) return { head: '', branch: '', files: '', status: '' };
  const run = async args => {
    try { return (await exec('git', args, { cwd, timeout: 8000, env: gitEnv() })).stdout.trim(); }
    catch { return ''; }
  };
  return {
    head: await run(['rev-parse', '--short', 'HEAD']),
    branch: await run(['rev-parse', '--abbrev-ref', 'HEAD']),
    files: (await run(['diff', '--name-status', 'HEAD'])) || (await run(['status', '--porcelain'])),
    status: await run(['status', '-sb'])
  };
}

function renderHandoff({ ctx, git, done, files, verify, next, blocked, auto }) {
  const fileLines = files || git.files || tr('wbTools.noChanges');
  return tr('wbTools.handoffRoleTimeRunWorkspace', { p1: ctx.role || 'unknown', p2: now(), p3: ctx.runId || '', p4: ctx.workspace || '', p5: git.branch || '—', p6: git.head || '—', p7: auto ? tr('wbTools.filledInByWorkerFrom') : tr('wbTools.submittedByRole'), p8: (done || tr('wbTools.notProvided')).trim(), p9: String(fileLines).trim(), p10: (verify || tr('wbTools.notProvided2')).trim(), p11: (next || tr('wbTools.nextPersonStartsWithWb')).trim(), p12: (blocked || tr('wbTools.none')).trim() });
}

export async function handoffLast() {
  const ctx=context();if(ctx.documentViews&&ctx.home&&ctx.runId){const result=await homeFetch('/api/agent/documents',{runId:ctx.runId,action:'last'});return {ok:true,...result};}
  const dir = await ensureKnowledge(context().knowledge);
  const text = await readFile(join(dir, 'handoffs', 'LATEST.md'), 'utf8').catch(() => '');
  if (!text) return { ok: false, error: tr('wbTools.noWrittenHandoffYet') };
  return { ok: true, path: join(dir, 'handoffs', 'LATEST.md'), text };
}

export async function handoffHasRun(runId, knowledge) {
  if (!runId) return false;
  const dir = join(knowledge || context().knowledge, 'handoffs');
  const names = await readdir(dir).catch(() => []);
  return names.some(name => name.includes(runId));
}

/** Fixed template: done items / files / commit / next steps. With auto=true, skipped if this run already has a handoff. */
export async function writeHandoff(fields = {}, override = {}) {
  const ctx = { ...context(), ...override };
  const dir = await ensureKnowledge(ctx.knowledge);
  const handoffs=ctx.reviewPrivate?join(dir,'handoffs','private',ctx.reviewPrivate):join(dir,'handoffs');
  if (fields.auto && ctx.runId && (await readdir(handoffs).catch(()=>[])).some(name=>name.includes(ctx.runId))) {
    return { ok: true, skipped: true, reason: tr('wbTools.turnAlreadyHasWrittenHandoff') };
  }
  const git = await gitSnapshot(ctx.workspace || ctx.projectRoot);
  const body = renderHandoff({
    ctx, git,
    done: fields.done,
    files: fields.files,
    verify: fields.verify,
    next: fields.next,
    blocked: fields.blocked,
    auto: !!fields.auto
  });
  const stamp = now().replace(/[:.]/g, '-');
  const file = join(handoffs, `${stamp}-${ctx.role || 'role'}-${ctx.runId || 'norun'}.md`);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, body, 'utf8');
  await writeFile(join(handoffs, 'LATEST.md'), body, 'utf8');
  return { ok: true, path: file, latest: join(handoffs, 'LATEST.md') };
}

export const helpText = () => [tr('minimal.teamHelp'),tr('minimal.waitHelp'),tr('wbTools.builtInCollaborationToolsWorkbench'),process.env.WB_QUEUE_BATCH==='1'?tr('sessionQueue.passRule'):'',process.env.WB_SYSTEM_SUPERVISOR==='1'?tr('collabSessions.toolHelp'):'',process.env.WB_SOURCE_SYNC==='1'?tr('sourceSync.toolGuide'):''].filter(Boolean).join('\n\n');
