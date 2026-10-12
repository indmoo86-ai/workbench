import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { CollaborationSessions, setCollaborationSessionsEnabled } from '../src/collaboration-sessions.mjs';
import { SessionQueue, setQueueConfig, grantBudget, setSessionBroadcast, setTestProject, ensureCycle } from '../src/session-queue.mjs';

const P = 'p1';
function env({ budget = 2 } = {}) {
  const db = new Store(':memory:'); let clock = Date.parse('2026-10-12T08:00:00Z');
  const now = () => clock, advance = s => { clock += s * 1000; };
  db.queueNow = now;
  db.put('projects', { id: P, name: 'demo', supervisorRoleId: 'sup' });
  db.put('roles', { id: 'sup', projectId: P, name: 'sup', model: 'm', enabled: true });
  for (const id of ['a', 'b', 'c']) db.put('roles', { id, projectId: P, name: id });
  db.put('workers', { id: 'w1', capabilities: { sessionQueue: 2 } });
  setCollaborationSessionsEnabled(db, P, true);
  setQueueConfig(db, P, { budgetBatches: budget });
  db.put('roomMessages', { id: 'root', projectId: P, sender: 'human', text: 'goal' });
  const s = new CollaborationSessions(db).create(P, { id: 's0', goal: 'g', participants: ['a', 'b', 'c'], sourceMessageId: 'root' });
  db.put('collaborationSessions', { ...db.get('collaborationSessions', s.id), broadcast: true });
  const queue = new SessionQueue(db, { now }); let n = 0, r = 0;
  const say = (roleId, text, replyToId = 'root') => { const id = `m${++n}`; db.put('roomMessages', { id, projectId: P, sender: 'agent', roleId, replyToId, text }); return id; };
  const res = () => ({ id: `r${++r}`, generation: 1 });
  const seal = roleId => queue.seal(P, roleId, { workerId: 'w1', reservation: res() });
  const start = b => { queue.markDelivering(b.id); return queue.confirmStarted(b.id, { runId: `run-${b.id}`, reservationId: b.reservation.id }); };
  const cycle = () => db.get('sessionCycles', 'cycle:s0');
  const alerts = () => db.list('tasks').filter(t => t.sessionQueueAlert);
  return { db, queue, say, advance, seal, start, cycle, alerts, now };
}

test('budget is reserved atomically before sealing and charged once on start', () => {
  const e = env({ budget: 2 });
  e.say('a', 'x'); e.advance(60);
  const b1 = e.seal('b'), b2 = e.seal('c');
  assert.deepEqual([e.cycle().reserved, e.cycle().used], [2, 0]);
  assert.equal(e.seal('a'), null);                                   // nothing for a (own message), but no budget either
  e.start(b1); e.start(b1);                                          // network re-confirmation does not double-charge
  assert.deepEqual([e.cycle().reserved, e.cycle().used], [1, 1]);
  e.start(b2);
  assert.deepEqual([e.cycle().reserved, e.cycle().used], [0, 2]);
});

test('undelivered reservation returns budget; a real rerun must reserve again', () => {
  const e = env({ budget: 1 });
  e.say('a', 'x'); e.advance(60);
  const b = e.seal('b');
  assert.equal(e.cycle().reserved, 1);
  e.advance(31); e.queue.expireLeases();                              // never sent -> released
  assert.deepEqual([e.cycle().reserved, e.cycle().used], [0, 0]);
  assert.equal(e.db.get('sessionBatches', b.id).budget, 'returned');
  const again = e.seal('b'); assert.ok(again); assert.equal(e.cycle().reserved, 1);
});

test('limit pauses propagation with one merged supervisor alert; @requests, sub-topics and restarts do not reset', () => {
  const e = env({ budget: 1 });
  e.say('a', 'x'); e.advance(60);
  e.start(e.seal('b'));
  assert.equal(e.seal('c'), null);
  assert.equal(e.cycle().paused, true);
  assert.equal(e.queue.status(P).collectors.find(c => c.roleId === 'c').waitingReason, 'broadcast_paused');
  // A derived sub-topic shares the cycle.
  const child = new CollaborationSessions(e.db).create(P, { id: 's1', goal: 'sub', participants: ['b', 'c'], parentSessionId: 's0' });
  assert.equal(ensureCycle(e.db, child).id, 'cycle:s0');
  // Restart (fresh queue instance) + more messages + an agent @request: still paused, no second alert.
  const fresh = new SessionQueue(e.db, { now: e.now });
  e.say('b', '@c please look'); e.advance(60);
  assert.equal(fresh.seal(P, 'c', { workerId: 'w1', reservation: { id: 'rz', generation: 1 } }), null);
  assert.equal(e.alerts().length, 1);
  assert.deepEqual(e.alerts()[0].sessionQueueAlert.kinds, ['budget_exhausted']);
  // Unresolved batch on the same session merges into the pending alert instead of waking the supervisor again.
  const b = e.db.list('sessionBatches')[0];
  e.db.put('sessionBatches', { ...b, id: 'bu', status: 'processing', runId: 'ru', passedAt: null, repliedMessageIds: [] });
  e.queue.finish({ id: 'ru', status: 'succeeded', collaborationBatchId: 'bu' });
  e.queue.finish({ id: 'ru', status: 'succeeded', collaborationBatchId: 'bu' });
  assert.equal(e.alerts().length, 1);
  assert.deepEqual(e.alerts()[0].sessionQueueAlert.kinds, ['budget_exhausted', 'unresolved']);
});

test('resume needs a human grant and keeps the used count', () => {
  const e = env({ budget: 1 });
  e.say('a', 'x'); e.advance(60);
  e.start(e.seal('b')); assert.equal(e.seal('c'), null);
  assert.throws(() => grantBudget(e.db, P, 's0', { additional: 2 }, { kind: 'agent' }));
  assert.throws(() => grantBudget(e.db, P, 's0', { additional: 0 }));
  const c = grantBudget(e.db, P, 's0', { additional: 2 });
  assert.deepEqual([c.used, c.limit, c.paused, c.grants.length], [1, 3, false, 2]);
  assert.ok(e.seal('c'));
});

test('acceptance broadcast switch only on test projects; budget config validated', () => {
  const e = env();
  assert.throws(() => setSessionBroadcast(e.db, P, 's0', { enabled: true, acknowledgeNoBudget: true }), /test project|\u6d4b\u8bd5\u9879\u76ee/);
  setTestProject(e.db, P, true);
  assert.throws(() => setSessionBroadcast(e.db, P, 's0', { enabled: true }));
  assert.equal(setSessionBroadcast(e.db, P, 's0', { enabled: true, acknowledgeNoBudget: true }).broadcast, true);
  for (const v of [0, -1, 1.5, 1001]) assert.throws(() => setQueueConfig(e.db, P, { budgetBatches: v }));
});
