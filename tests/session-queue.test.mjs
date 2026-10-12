import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { CollaborationSessions, setCollaborationSessionsEnabled } from '../src/collaboration-sessions.mjs';
import { SessionQueue, setQueueConfig, queueConfig } from '../src/session-queue.mjs';
import { QueueSlots, trulyIdle, renderBatch } from '../src/session-queue-worker.mjs';

const P = 'p1';
function setup({ capability = 1, broadcast = true, sessions = 1 } = {}) {
  const db = new Store(':memory:'); let clock = Date.parse('2026-10-12T08:00:00Z');
  const now = () => clock, advance = s => { clock += s * 1000; };
  db.put('projects', { id: P, name: 'demo' });
  for (const id of ['codex', 'claude', 'grok']) db.put('roles', { id, projectId: P, name: id, nodeId: 'w1' });
  db.put('workers', { id: 'w1', capabilities: capability ? { sessionQueue: capability } : {} });
  setCollaborationSessionsEnabled(db, P, true);
  const ids = [];
  for (let i = 0; i < sessions; i++) {
    db.put('roomMessages', { id: `root${i}`, projectId: P, sender: 'human', text: `goal ${i}` });
    const s = new CollaborationSessions(db).create(P, { id: `s${i}`, goal: `goal ${i}`, participants: ['codex', 'claude', 'grok'], sourceMessageId: `root${i}` });
    if (broadcast) db.put('collaborationSessions', { ...db.get('collaborationSessions', s.id), broadcast: true });
    ids.push(s.id);
  }
  db.queueNow = now; const queue = new SessionQueue(db, { now });
  let n = 0;
  const say = (roleId, text, session = 0) => {
    const m = db.put('roomMessages', { id: `m${++n}`, projectId: P, sender: 'agent', roleId, replyToId: `root${session}`, text, createdAt: new Date(clock).toISOString() });
    queue.register(db.get('roomMessages', m.id)); return m.id;
  };
  return { db, queue, now, advance, say, ids };
}
/** Fake CLI: records every write to stdin and every native-history append. */
function fakeCli() { return { stdin: [], nativeAppends: [], state: { turnActive: true, pendingTools: 0, pendingApproval: false, ownedByThisWorker: true, manualTakeover: false } }; }
async function dispatch({ db, queue }, slots, cli, roleId) {
  const r = slots.reserve(roleId, cli.state);
  if (!r.ok) return null;
  const batch = queue.seal(P, roleId, { workerId: 'w1', reservation: r.reservation });
  if (!batch) { slots.cancel(roleId, r.reservation); return null; }
  queue.markDelivering(batch.id);
  await slots.deliver(roleId, r.reservation, cli.state, () => { cli.stdin.push(renderBatch(batch, batch.messageIds.map(id => db.get('roomMessages', id)))); cli.state = { ...cli.state, turnActive: true }; });
  return queue.confirmStarted(batch.id, { runId: `run-${batch.id}`, reservationId: r.reservation.id });
}

test('new messages are tagged with their session from existing links', () => {
  const env = setup(); const id = env.say('claude', 'hi');
  assert.equal(env.db.get('roomMessages', id).collaborationSessionId, 's0');
});

test('busy CLI receives nothing; after the turn ends it gets exactly one merged batch', async () => {
  const env = setup(), slots = new QueueSlots({ now: env.now }), cli = fakeCli();
  env.say('claude', 'c1'); env.say('claude', 'c2');
  env.say('grok', 'g1'); env.say('grok', 'g2'); env.say('grok', 'g3');
  env.say('codex', 'own message');                                    // sender is not woken by itself
  env.advance(60);
  for (let i = 0; i < 5; i++) assert.equal(await dispatch(env, slots, cli, 'codex'), null);
  assert.deepEqual(cli.stdin, []); assert.deepEqual(cli.nativeAppends, []);
  assert.ok(env.queue.status(P).receipts.filter(r => r.roleId === 'codex').every(r => r.state === 'queued'));
  cli.state = { ...cli.state, turnActive: false }; slots.stateChanged('codex');
  const batch = await dispatch(env, slots, cli, 'codex');
  assert.equal(batch.status, 'processing');
  assert.equal(cli.stdin.length, 1);
  assert.deepEqual(JSON.parse(cli.stdin[0]).messages.map(m => m.text), ['c1', 'c2', 'g1', 'g2', 'g3']);
  assert.equal(await dispatch(env, slots, cli, 'codex'), null);       // busy again, no second write
  assert.equal(cli.stdin.length, 1);
  env.queue.complete(batch.id, { outcome: 'replied' });
  assert.ok(env.queue.status(P).receipts.filter(r => r.roleId === 'codex').every(r => r.state === 'processed'));
});

test('messages arriving after sealing go to the next batch; merge window is respected', async () => {
  const env = setup(), slots = new QueueSlots({ now: env.now }), cli = fakeCli(); cli.state.turnActive = false;
  env.say('claude', 'a'); env.advance(5);
  assert.equal(await dispatch(env, slots, cli, 'codex'), null);        // still inside the 10s quiet window
  env.advance(10);
  const first = await dispatch(env, slots, cli, 'codex');
  env.say('claude', 'b'); env.queue.complete(first.id, { outcome: 'passed' });
  cli.state.turnActive = false; slots.stateChanged('codex'); env.advance(11);
  const second = await dispatch(env, slots, cli, 'codex');
  assert.deepEqual([first.messageIds, second.messageIds].map(ids => ids.map(id => env.db.get('roomMessages', id).text)), [['a'], ['b']]);
});

test('true idle needs explicit adapter facts; unknown counts as busy', () => {
  assert.equal(trulyIdle(null).idle, false);
  assert.equal(trulyIdle({ turnActive: false }).idle, false);
  assert.equal(trulyIdle({ turnActive: false, pendingTools: 1, pendingApproval: false, ownedByThisWorker: true, manualTakeover: false }).reason, 'tools_running');
  assert.equal(trulyIdle({ turnActive: false, pendingTools: 0, pendingApproval: false, ownedByThisWorker: true, manualTakeover: false }).idle, true);
});

test('reservation is re-checked before the write: expired or state-changed reservations never write', async () => {
  const env = setup(), slots = new QueueSlots({ now: env.now, leaseMs: 30000 }), cli = fakeCli(); cli.state.turnActive = false;
  const r = slots.reserve('codex', cli.state);
  slots.stateChanged('codex');
  await assert.rejects(slots.deliver('codex', r.reservation, cli.state, () => cli.stdin.push('x')));
  const r2 = slots.reserve('codex', cli.state); env.advance(31);
  await assert.rejects(slots.deliver('codex', r2.reservation, cli.state, () => cli.stdin.push('x')));
  assert.deepEqual(cli.stdin, []);
});

test('lease expiry: unsent returns to queue, possibly-sent waits for verification and is never started twice', async () => {
  const env = setup(); env.say('claude', 'x'); env.advance(60);
  const reservation = () => ({ id: `r${Math.random()}`, generation: 1, expiresAt: new Date(env.now() + 30000).toISOString() });
  // Case 1: never sent -> released, messages queued again.
  const b1 = env.queue.seal(P, 'codex', { workerId: 'w1', reservation: reservation() });
  env.advance(31); env.queue.expireLeases();
  assert.equal(env.db.get('sessionBatches', b1.id).status, 'released');
  assert.equal(env.queue.status(P).receipts.find(r => r.roleId === 'codex').state, 'queued');
  // Case 2: start command sent, acknowledgement lost -> pending verification, no new batch for the role.
  const res = reservation(); const b2 = env.queue.seal(P, 'codex', { workerId: 'w1', reservation: res });
  env.queue.markDelivering(b2.id); env.advance(31); env.queue.expireLeases();
  assert.equal(env.db.get('sessionBatches', b2.id).status, 'pending_verification');
  assert.equal(env.queue.status(P).receipts.find(r => r.roleId === 'codex').state, 'pending_verification');
  assert.equal(env.queue.seal(P, 'codex', { workerId: 'w1', reservation: reservation() }), null);
  assert.equal(env.queue.verify(b2.id, {}).status, 'pending_verification');       // still unknown: wait
  assert.equal(env.queue.verify(b2.id, { started: true, runId: 'run-x' }).status, 'processing');
  // Case 3: started batches are not touched by lease expiry.
  env.advance(100); env.queue.expireLeases();
  assert.equal(env.db.get('sessionBatches', b2.id).status, 'processing');
  assert.equal(env.db.list('sessionBatches').length, 2);
});

test('rotation across sessions is fair and survives a Home restart', () => {
  const env = setup({ sessions: 3 });
  for (let round = 0; round < 3; round++) for (const s of [0, 1, 2]) env.say('claude', `s${s}-${round}`, s);
  env.advance(60);
  const order = [];
  for (let i = 0; i < 3; i++) {
    const queue = new SessionQueue(env.db, { now: env.now });                          // fresh instance = restart
    const b = queue.seal(P, 'codex', { workerId: 'w1', reservation: { id: `r${i}`, generation: 1, expiresAt: new Date(env.now() + 30000).toISOString() } });
    order.push(b.sessionId); queue.markDelivering(b.id); queue.confirmStarted(b.id, { runId: `run${i}`, reservationId: `r${i}` }); queue.complete(b.id, { outcome: 'replied' });
  }
  assert.deepEqual(order, ['s0', 's1', 's2']);
});

test('old Workers keep messages queued; broadcast is off unless a session opts in', () => {
  const old = setup({ capability: 0 }); old.say('claude', 'x'); old.advance(60);
  assert.equal(old.queue.seal(P, 'codex', { workerId: 'w1', reservation: { id: 'r', generation: 1, expiresAt: new Date(old.now() + 30000).toISOString() } }), null);
  assert.equal(old.queue.status(P).collectors.find(c => c.roleId === 'codex').waitingReason, 'worker_upgrade_required');
  const quiet = setup({ broadcast: false }); quiet.say('claude', 'x');
  assert.equal(quiet.queue.status(P).receipts.length, 0);
});

test('config validation: max < quiet rejected and unchanged; equal and zero allowed', () => {
  const { db } = setup();
  assert.throws(() => setQueueConfig(db, P, { quietSeconds: 20, maxSeconds: 10 }));
  assert.throws(() => setQueueConfig(db, P, { quietSeconds: -1 }));
  assert.throws(() => setQueueConfig(db, P, { quietSeconds: 1.5 }));
  assert.equal(queueConfig(db, P).quietSeconds, 10); assert.equal(queueConfig(db, P).maxSeconds, 30);
  assert.equal(setQueueConfig(db, P, { quietSeconds: 15, maxSeconds: 15 }).maxSeconds, 15);
  const zero = setQueueConfig(db, P, { quietSeconds: 0, maxSeconds: 0 });
  assert.equal(zero.version, 2);
});
