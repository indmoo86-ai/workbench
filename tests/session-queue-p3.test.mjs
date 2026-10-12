import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { Rooms } from '../src/rooms.mjs';
import { CollaborationSessions, setCollaborationSessionsEnabled } from '../src/collaboration-sessions.mjs';
import { SessionQueue, QueuePump, setQueueConfig } from '../src/session-queue.mjs';
import { QueueSlots, renderBatch } from '../src/session-queue-worker.mjs';
import { TurnStates, RUNTIME_TOOL_RULES } from '../src/session-queue-adapters.mjs';

const P = 'p1';
/** Fake driver event streams, shaped like what each real driver already emits. */
const FAKE_TOOL_EVENTS = {
  codex: [{ item: { id: 'i1', type: 'commandExecution', status: 'inProgress' } }, { item: { id: 'i1', type: 'commandExecution', status: 'completed' } }],
  claude: [{ item: { id: 'tu1', type: 'tool_use', name: 'Bash' } }, { item: { type: 'tool_result', tool_use_id: 'tu1', status: 'completed' } }],
  grok: [{ item: { id: 'g1', type: 'function_call', status: 'in_progress' } }, { item: { id: 'g1', type: 'function_call', status: 'completed' } }],
  agy: [{ item: { id: 'a1', type: 'tool_call', status: 'pending' } }, { item: { type: 'tool_result', tool_use_id: 'a1' } }]
};
const facts = (ts, runtime, key = 'k') => ts.state(key, { ownerNodeId: 'w1', runtime });

for (const runtime of Object.keys(FAKE_TOOL_EVENTS)) {
  test(`${runtime} adapter: busy during turn, tools and approvals; idle only after turn end`, () => {
    const ts = new TurnStates({ nodeId: 'w1' }), slots = new QueueSlots();
    ts.begin({ id: 'r1', roleSessionId: 'k', runtime });
    const [open, close] = FAKE_TOOL_EVENTS[runtime];
    ts.observe('r1', 'status', { status: 'running' });
    ts.observe('r1', 'tool', open);
    assert.equal(slots.reserve('k', facts(ts, runtime)).reason, 'turn_active');
    ts.observe('r1', 'approval', { id: 'r1:ap' });
    ts.observe('r1', 'status', { status: 'succeeded' });                       // turn reported over, tool still open
    assert.equal(slots.reserve('k', facts(ts, runtime)).reason, 'tools_running');
    ts.observe('r1', 'tool', close);
    assert.equal(slots.reserve('k', facts(ts, runtime)).reason, 'approval_pending');
    ts.observe('r1', 'approval_resolved', { id: 'r1:ap' });
    assert.equal(slots.reserve('k', facts(ts, runtime)).ok, true);
    assert.equal(ts.state('k', { ownerNodeId: 'w2', runtime }).ownedByThisWorker, false);
  });
}

test('unknown runtime is never idle', () => {
  const ts = new TurnStates({ nodeId: 'w1' });
  assert.equal(ts.state('k', { ownerNodeId: 'w1', runtime: 'mystery' }), null);
  assert.equal(new QueueSlots().reserve('k', null).ok, false);
  assert.equal(Object.keys(RUNTIME_TOOL_RULES).length, 4);
});

function env() {
  const db = new Store(':memory:'); let clock = Date.parse('2026-10-12T08:00:00Z');
  const now = () => clock, advance = s => { clock += s * 1000; };
  db.put('projects', { id: P, name: 'demo' });
  for (const id of ['codex', 'claude']) db.put('roles', { id, projectId: P, name: id, nodeId: 'w1', runtime: id, model: 'm', mode: 'workspace-write' });
  db.put('workers', { id: 'w1', capabilities: { sessionQueue: 1 } });
  setCollaborationSessionsEnabled(db, P, true);
  db.put('roomMessages', { id: 'root', projectId: P, sender: 'human', text: 'goal' });
  const s = new CollaborationSessions(db).create(P, { id: 's0', goal: 'g', participants: ['codex', 'claude'], sourceMessageId: 'root' });
  db.put('collaborationSessions', { ...db.get('collaborationSessions', s.id), broadcast: true });
  db.queueNow = now; const queue = new SessionQueue(db, { now }); let n = 0;
  const say = (roleId, text) => { const id = `m${++n}`; db.put('roomMessages', { id, projectId: P, sender: 'agent', roleId, replyToId: 'root', text }); queue.register(db.get('roomMessages', id)); return id; };
  // Fake Worker on the other end of the WebSocket.
  const ts = new TurnStates({ nodeId: 'w1' }), slots = new QueueSlots({ now }), outbox = [];
  const pump = new QueuePump(db, { now, online: () => true, render: renderBatch, send: (nodeId, m) => outbox.push({ nodeId, m }) });
  const workerAnswer = () => { const out = []; while (outbox.length) { const { nodeId, m } = outbox.shift(); if (m.type === 'queue_reserve') out.push(pump.onReservation(nodeId, { type: 'queue_reservation', id: m.id, ...slots.reserve(m.key, ts.state(m.key, { ownerNodeId: m.ownerNodeId, runtime: m.runtime })) })); if (m.type === 'queue_cancel') slots.cancel(m.key, { id: m.reservationId }); } return out.filter(Boolean); };
  // Stand-in for Store.launch's queue hook + the Worker launch gate.
  const launch = async task => {
    const batch = db.get('sessionBatches', task.collaborationBatchId), runId = `run-${batch.id}`;
    db.put('sessionBatches', { ...batch, deliveryAttempted: true, runId });
    db.put('runs', { id: runId, projectId: P, taskId: task.id, roleId: task.roleId, roleSnapshot: task.roleSnapshot, status: 'queued', lastSeq: 0, collaborationBatchId: batch.id, collaborationBatch: task.collaborationBatch, explicitPublish: true });
    const q = task.collaborationBatch;
    await slots.deliver(q.key, q.reservation, ts.state(q.key, { ownerNodeId: q.ownerNodeId, runtime: q.runtime }), () => true);
    ts.begin({ id: runId, roleSessionId: q.key, runtime: q.runtime });
    return runId;
  };
  return { db, queue, pump, say, advance, ts, slots, workerAnswer, launch, now };
}
let seq = 0;
const ev = (db, runId, type, payload) => db.event({ id: `e${++seq}`, runId, seq: (db.get('runs', runId).lastSeq || 0) + 1, type, payload });

test('end to end over the fake WebSocket: busy CLI gets nothing, then one batch; explicit publish and wb pass', async () => {
  const e = env();
  // codex is mid-turn.
  e.ts.begin({ id: 'busy', roleSessionId: `${P}:codex`, runtime: 'codex' }); e.ts.observe('busy', 'status', { status: 'running' });
  e.say('claude', 'one'); e.say('claude', 'two'); e.advance(60);
  for (let i = 0; i < 3; i++) { e.pump.tick(); assert.deepEqual(e.workerAnswer(), []); }
  assert.equal(e.db.list('tasks').length, 0);
  assert.equal(e.queue.status(P).collectors.find(c => c.roleId === 'codex').waitingReason, 'turn_active');
  e.ts.observe('busy', 'status', { status: 'succeeded', processSettled: true });
  e.pump.tick(); const [task] = e.workerAnswer();
  assert.deepEqual(JSON.parse(task.prompt).messages.map(m => m.text), ['one', 'two']);
  e.pump.tick(); assert.deepEqual(e.workerAnswer(), []);               // one open batch per role
  const runId = await e.launch(task);
  ev(e.db, runId, 'status', { status: 'running' });
  assert.equal(e.queue.status(P).receipts.find(r => r.roleId === 'codex').state, 'processing');
  // wb pass: allowed for an open discussion batch, idempotent, no chat message.
  const run = e.db.get('runs', runId), before = e.db.list('roomMessages').length;
  assert.equal(e.queue.pass(run).idempotent, false); assert.equal(e.queue.pass(run).idempotent, true);
  assert.equal(e.db.list('roomMessages').length, before);
  assert.throws(() => e.queue.pass({ ...run, roleId: 'claude' }));        // identity from the run, not the caller
  ev(e.db, runId, 'message', { phase: 'final_answer', text: 'native final answer' });
  ev(e.db, runId, 'status', { status: 'succeeded' });
  new Rooms(e.db).complete(e.db.get('runs', runId));
  assert.ok(!e.db.list('roomMessages').some(m => m.text === 'native final answer'));   // final answer stays in run details
  assert.equal(e.db.get('sessionBatches', task.collaborationBatchId).outcome, 'passed');
  assert.equal(e.queue.status(P).receipts.find(r => r.roleId === 'codex').state, 'processed');
});

test('explicit reply publishes once and blocks wb pass; explicit request cannot pass; no result stays unresolved', async () => {
  const e = env();
  e.say('claude', 'hi'); e.advance(60); e.pump.tick();
  const [task] = e.workerAnswer(); const runId = await e.launch(task); ev(e.db, runId, 'status', { status: 'running' });
  const rooms = new Rooms(e.db); rooms.touch = () => {};
  const reply = rooms.agentNote(e.db.get('runs', runId), 'my answer');
  assert.equal(e.db.get('roomMessages', reply.id).collaborationSessionId, 's0');
  assert.throws(() => e.queue.pass(e.db.get('runs', runId)));
  ev(e.db, runId, 'status', { status: 'succeeded' }); rooms.complete(e.db.get('runs', runId));
  assert.equal(e.db.list('roomMessages').filter(m => m.runId === runId).length, 1);
  assert.equal(e.db.get('sessionBatches', task.collaborationBatchId).outcome, 'replied');
  // Explicit request batch.
  const b = e.db.get('sessionBatches', task.collaborationBatchId);
  e.db.put('sessionBatches', { ...b, id: 'bx', explicit: true, status: 'processing', runId: 'rx', passedAt: null, repliedMessageIds: [] });
  assert.throws(() => e.queue.pass({ id: 'rx', roleId: 'codex', projectId: P, collaborationBatchId: 'bx' }), /request|\u8bf7\u6c42/);
  // Run ends with neither reply nor pass -> unresolved, not processed.
  e.db.put('sessionBatches', { ...b, id: 'by', status: 'processing', runId: 'ry', passedAt: null, repliedMessageIds: [] });
  assert.equal(e.queue.finish({ id: 'ry', status: 'succeeded', collaborationBatchId: 'by' }).status, 'unresolved');
});

test('worker launch gate: stale reservation is rejected and the batch returns to the queue without a run', async () => {
  const e = env();
  e.say('claude', 'x'); e.advance(60); e.pump.tick();
  const [task] = e.workerAnswer();
  e.slots.stateChanged(`${P}:codex`);                                     // state moved after reservation
  await assert.rejects(e.launch(task));
  const runId = e.db.get('sessionBatches', task.collaborationBatchId).runId;
  ev(e.db, runId, 'status', { status: 'interrupted', queueRejected: true, processSettled: true });
  assert.equal(e.db.get('sessionBatches', task.collaborationBatchId).status, 'released');
  assert.equal(e.queue.status(P).receipts.find(r => r.roleId === 'codex').state, 'queued');
});

test('Home lease timeout cancels a not-yet-launched task; reservation answers from another Worker are ignored', () => {
  const e = env();
  e.say('claude', 'x'); e.advance(60); e.pump.tick();
  const [task] = e.workerAnswer();
  e.advance(31); e.pump.tick();
  assert.equal(e.db.get('tasks', task.id).status, 'cancelled');
  e.workerAnswer();                                                       // re-reserve after release
  e.pump.tick();
  e.db.put('workers', { id: 'w2', capabilities: { sessionQueue: 1 } });
  assert.equal(e.pump.onReservation('w2', { id: [...e.pump.pending.keys()][0], ok: true, reservation: { id: 'forged', generation: 1 } }), null);
});

test('supervisor alert after pending verification exceeds the project threshold, once per batch', () => {
  const e = env();
  e.db.put('roles', { id: 'sup', projectId: P, name: 'sup', nodeId: 'w1', runtime: 'codex', model: 'm', enabled: true, systemSupervisor: true });
  e.db.put('projects', { ...e.db.get('projects', P), supervisorRoleId: 'sup' });
  assert.throws(() => setQueueConfig(e.db, P, { verifyAlertSeconds: 30 }));
  assert.throws(() => setQueueConfig(e.db, P, { verifyAlertSeconds: 90.5 }));
  setQueueConfig(e.db, P, { verifyAlertSeconds: 120 });
  e.say('claude', 'x'); e.advance(60); e.pump.tick();
  const [task] = e.workerAnswer(); const b = e.db.get('sessionBatches', task.collaborationBatchId);
  e.db.put('sessionBatches', { ...b, deliveryAttempted: true, runId: 'r-lost' });
  e.advance(31); e.pump.tick();
  assert.equal(e.db.get('sessionBatches', b.id).status, 'pending_verification');
  e.advance(60); assert.equal(e.pump.alertStaleVerifications().length, 0);
  e.advance(70); const alerts = e.pump.alertStaleVerifications();
  assert.equal(alerts.length, 1); assert.equal(alerts[0].roleId, 'sup');
  e.advance(600); assert.equal(e.pump.alertStaleVerifications().length, 0);
  assert.equal(e.db.get('sessionBatches', b.id).status, 'pending_verification');   // never rerun
});
