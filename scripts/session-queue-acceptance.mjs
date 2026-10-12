#!/usr/bin/env node
// Session queue V3 phase 3 acceptance runner. Run once per CLI (codex, claude, grok, agy) against a real Home,
// on a DEDICATED test project. It never edits prompts and only touches the given project.
//
//   WB_HOME_URL=http://127.0.0.1:8787 WB_API_TOKEN=... \
//   node scripts/session-queue-acceptance.mjs --project <id> --busy <roleId> --peer <roleId> [--busy-seconds 90]
//
// Pass criteria printed at the end; the native-history check (step 6) is manual.
import { randomUUID } from 'node:crypto';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => v.startsWith('--') ? [...a, [v.slice(2), all[i + 1]]] : a, []));
const home = process.env.WB_HOME_URL, token = process.env.WB_API_TOKEN || '';
const { project, busy, peer } = args, busySeconds = Number(args['busy-seconds'] || 90);
if (!home || !project || !busy || !peer) { console.error('Usage: see header.'); process.exit(2); }
const api = async (path, init = {}) => {
  const res = await fetch(new URL(path, home), { method: init.method || 'GET', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: init.json ? JSON.stringify(init.json) : undefined });
  const data = await res.json(); if (!res.ok) throw new Error(`${path}: ${data.error || res.status}`); return data;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const base = `/api/projects/${encodeURIComponent(project)}`;
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}`); };
const queue = () => api(`${base}/collaboration-sessions/queue`);
const state = () => api('/api/state');

// 1. Enable the flag and create an isolated open session with broadcast limited for acceptance.
await api(`${base}/collaboration-sessions/feature`, { method: 'POST', json: { enabled: true } });
await api(`${base}/collaboration-sessions/queue-config`, { method: 'POST', json: { quietSeconds: 5, maxSeconds: 15 } });
const rootId = randomUUID();
await api(`${base}/messages`, { method: 'POST', json: { clientMessageId: rootId, text: `Acceptance root ${new Date().toISOString()}` } });
const session = await api(`${base}/collaboration-sessions`, { method: 'POST', json: { goal: 'session queue acceptance', participants: [busy, peer], sourceMessageId: rootId } });
await api(`${base}/collaboration-sessions/${session.id}/broadcast`, { method: 'POST', json: { enabled: true, batchLimit: 2, acknowledgeNoBudget: true } });

// 2. Make the busy role run an observable long turn (normal user dispatch, not part of the session).
const busyMessage = randomUUID();
await api(`${base}/messages`, { method: 'POST', json: { clientMessageId: busyMessage, targetRoleId: busy,
  text: `Run a shell command that sleeps ${busySeconds} seconds, then reply with the single word DONE.` } });
let busyRun = null;
for (let i = 0; i < 60 && !busyRun; i++) { await sleep(2000); busyRun = (await state()).runs.find(r => r.projectId === project && r.roleId === busy && r.status === 'running'); }
check('busy role started a running turn', Boolean(busyRun));

// 3. While it runs, post five session messages (replies to the root, so they inherit the session).
const posted = [];
for (let i = 1; i <= 5; i++) { const id = randomUUID(); posted.push(id); await api(`${base}/messages`, { method: 'POST', json: { clientMessageId: id, replyToId: rootId, text: `queued note ${i}` } }); }
await sleep(20000);

// 4. During the turn: receipts stay queued and no batch run exists for the busy role.
const during = await queue(), duringState = await state();
const mine = during.receipts.filter(r => r.roleId === busy && posted.includes(r.messageId));
check('5 receipts registered for busy role', mine.length === 5, `${mine.length}`);
check('all receipts still queued while busy', mine.every(r => r.state === 'queued'));
check('no batch run started while busy', !duringState.runs.some(r => r.roleId === busy && r.collaborationBatchId && r.status !== 'interrupted'));
check('busy turn still running at the check', duringState.runs.some(r => r.id === busyRun?.id && r.status === 'running'));

// 5. After the turn ends: exactly one batch containing all five messages.
for (let i = 0; i < 120; i++) { await sleep(3000); if (!(await state()).runs.some(r => r.id === busyRun?.id && r.status === 'running')) break; }
let batches = [];
for (let i = 0; i < 40; i++) { await sleep(3000); batches = (await queue()).batches.filter(b => b.roleId === busy && b.sessionId === session.id); if (batches.some(b => ['processing', 'processed', 'unresolved'].includes(b.status))) break; }
const delivered = batches.filter(b => b.status !== 'released');
check('exactly one batch delivered after the turn', delivered.length === 1, `${delivered.length}`);
check('batch carries all five messages in order', JSON.stringify(delivered[0]?.messageIds) === JSON.stringify(posted));

// 6. Manual: open the busy CLI's native transcript and confirm the five notes appear only in the batch turn,
//    never as stdin/appended input during the sleep turn. Record runtime + version below.
console.log('\nMANUAL: confirm in the native transcript that "queued note 1..5" first appear in the batch turn.');
console.log('MANUAL: confirm the batch turn either posted via wb chat post (one bubble) or ran wb pass (no bubble), and its native final answer did not appear in the chat.');

await api(`${base}/collaboration-sessions/${session.id}/broadcast`, { method: 'POST', json: { enabled: false } });
await api(`${base}/collaboration-sessions/${session.id}/close`, { method: 'POST', json: {} });
const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} automated checks passed.`);
process.exit(failed ? 1 : 0);
