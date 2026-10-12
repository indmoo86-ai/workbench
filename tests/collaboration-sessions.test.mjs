import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { History } from '../src/history.mjs';
import { SessionTools } from '../src/session-tools.mjs';
import { assertAgentSender } from '../src/agent-bridge.mjs';
import { CollaborationSessions, sessionOf, reviewView, setCollaborationSessionsEnabled, collaborationSessionsEnabled } from '../src/collaboration-sessions.mjs';

const P = 'p1', t = i => `2026-10-12T08:00:${String(i).padStart(2, '0')}.000Z`;
function seed() {
  const db = new Store(':memory:');
  db.put('projects', { id: P, name: 'demo' });
  for (const id of ['alice', 'bob', 'sup']) db.put('roles', { id, projectId: P, name: id });
  db.put('roomMessages', { id: 'm0', projectId: P, sender: 'human', text: 'please review the plan', createdAt: t(0) });
  // Two reviewer tasks linked to the review, each with a run, result, report and session.
  for (const [i, role] of [[1, 'alice'], [2, 'bob']]) {
    db.put('tasks', { id: `task-${role}`, projectId: P, roleId: role, sourceMessageId: 'm0' });
    db.put('roleSessions', { id: `rs-${role}`, projectId: P, conversationId: P, roleId: role, status: 'idle' });
    db.put('runs', { id: `run-${role}`, projectId: P, taskId: `task-${role}`, roleId: role, roleSessionId: `rs-${role}`, status: 'succeeded', result: `${role} secret verdict`, createdAt: t(i) });
    db.put('roomMessages', { id: `msg-${role}`, projectId: P, sender: 'agent', roleId: role, runId: `run-${role}`, text: `${role} secret opinion`, attachments: [{ id: `att-${role}`, name: 'notes.md' }], createdAt: t(i + 2) });
    db.put('runReports', { id: `run-${role}`, projectId: P, roleId: role, verdict: 'passed', summary: `${role} secret report` });
    db.put('discussionMessages', { id: `dm-${role}`, projectId: P, sourceRunId: `run-${role}`, text: `${role} secret discussion` });
  }
  // A late reply quoting bob's opinion, and a supervisor message deriving from it.
  db.put('roomMessages', { id: 'late-bob', projectId: P, sender: 'agent', roleId: 'bob', replyToId: 'msg-bob', text: 'bob late addendum secret', createdAt: t(9) });
  db.put('roomMessages', { id: 'sup-derived', projectId: P, sender: 'agent', roleId: 'sup', replyToId: 'msg-bob', text: 'sup paraphrase of bob secret', createdAt: t(10) });
  db.put('coordinationRequests', { id: 'req-bob', projectId: P, targetRoleId: 'bob', parentRequestId: null, sourceMessageId: 'm0', summary: 'check it', result: 'bob secret answer', currentRunId: 'run-bob' });
  db.put('conversationContexts', { id: `${P}:${P}`, projectId: P, recentSummary: 'summary mentioning bob secret', roleSummaries: [{ roleSessionId: 'rs-bob', text: 'bob secret summary' }] });
  return db;
}
function review(db) {
  setCollaborationSessionsEnabled(db, P, true);
  return new CollaborationSessions(db).create(P, { goal: 'review the plan', type: 'independent-review', participants: ['alice', 'bob', { roleId: 'sup', reviewer: false }], sourceMessageId: 'm0', linkedTaskIds: ['task-alice', 'task-bob'] });
}
const aliceRun = { id: 'run-alice', projectId: P, roleId: 'alice', roleSessionId: 'rs-alice' };

test('identity: model-supplied sender fields are rejected, including nested ones', () => {
  for (const payload of [{ sender: 'x' }, { senderRoleId: 'bob' }, { projectId: 'p2' }, { input: { authorRoleId: 'bob' } }, { input: { items: [{ speaker: 'bob' }] } }, { batchId: 'b1' }, { input: { collaborationSessionId: 's' } }])
    assert.throws(() => assertAgentSender(payload), undefined, JSON.stringify(payload));
  // Target identifiers remain valid tool input.
  assert.doesNotThrow(() => assertAgentSender({ runId: 'r', role: 'bob', input: { roleId: 'bob', threadId: 't' } }));
});

test('feature flag defaults off and gates session creation', () => {
  const db = seed();
  assert.equal(collaborationSessionsEnabled(db, P), false);
  assert.throws(() => new CollaborationSessions(db).create(P, { goal: 'g', participants: ['alice'] }), /not enabled|\u672a\u542f\u7528/);
  setCollaborationSessionsEnabled(db, P, true);
  assert.equal(new CollaborationSessions(db).create(P, { goal: 'g', participants: ['alice'] }).type, 'open');
});

test('session records membership changes and validates participants', () => {
  const db = seed(); setCollaborationSessionsEnabled(db, P, true);
  const sessions = new CollaborationSessions(db);
  const s = sessions.create(P, { goal: 'g', participants: ['alice'] });
  sessions.addMember(P, s.id, { roleId: 'bob' });
  const after = sessions.removeMember(P, s.id, { roleId: 'alice' });
  assert.deepEqual(after.participants.map(p => p.roleId), ['bob']);
  assert.deepEqual(after.membershipLog.map(e => `${e.action}:${e.roleId}`), ['add:alice', 'add:bob', 'remove:alice']);
  assert.throws(() => sessions.addMember(P, s.id, { roleId: 'ghost' }));
  assert.equal(sessions.close(P, s.id).state, 'closed');
  assert.throws(() => sessions.addMember(P, s.id, { roleId: 'sup' }));
});

test('inheritance: replies, consultation answers, reports and late replies stay in the original session', () => {
  const db = seed(); const s = review(db);
  db.put('coordinationRequests', { id: 'child', projectId: P, parentRequestId: 'req-bob' });
  db.put('runs', { id: 'run-child', projectId: P, requestId: 'child', roleId: 'sup' });
  db.put('roomMessages', { id: 'unrelated', projectId: P, sender: 'human', text: 'new topic', createdAt: t(20) });
  assert.equal(sessionOf(db, 'roomMessages', db.get('roomMessages', 'late-bob')), s.id);
  assert.equal(sessionOf(db, 'coordinationRequests', db.get('coordinationRequests', 'req-bob')), s.id);
  assert.equal(sessionOf(db, 'runs', db.get('runs', 'run-child')), s.id);
  assert.equal(sessionOf(db, 'runReports', db.get('runReports', 'run-bob')), s.id);
  assert.equal(sessionOf(db, 'roomMessages', db.get('roomMessages', 'unrelated')), null);
  assert.throws(() => { setCollaborationSessionsEnabled(db, P, true); new CollaborationSessions(db).create(P, { goal: 'x', participants: ['alice'], linkedTaskIds: ['task-bob'] }); });
});

test('isolation: every read path hides the other reviewer, then release restores access', () => {
  const db = seed(); const s = review(db);
  const view = reviewView(db, { projectId: P, roleId: 'alice' });
  const history = new History(view), tools = new SessionTools(view);
  const leaks = value => /bob[^"]*secret/.test(JSON.stringify(value));
  // Search and list run before pagination, so even limit=1 pages never surface protected items.
  let cursor = null, pages = [];
  do { const page = history.search(P, { query: 'secret', limit: 1, cursor }); pages.push(page); cursor = page.nextCursor; } while (cursor);
  assert.ok(!leaks(pages)); assert.ok(JSON.stringify(pages).includes('alice secret'));
  assert.throws(() => history.read(P, { kind: 'message', id: 'msg-bob' }));            // by id
  assert.throws(() => history.read(P, { kind: 'message', id: 'late-bob' }));           // late reply
  assert.throws(() => history.read(P, { kind: 'message', id: 'sup-derived' }));        // derived quote
  assert.ok(!leaks(history.read(P, { kind: 'result', id: 'run-bob' })));               // execution record
  assert.ok(!leaks(history.read(P, { kind: 'result', id: 'req-bob' })));               // consultation answer
  assert.ok(!leaks(tools.read(aliceRun, 'rs-bob')));                                   // session records
  assert.ok(!leaks(tools.list(aliceRun)));                                             // session list + summaries
  assert.ok(!leaks(tools.summary(aliceRun, 'rs-bob')));
  assert.ok(!leaks(tools.chatSummary(aliceRun)));                                      // conversation summary
  assert.equal(view.get('runReports', 'run-bob'), null);                               // reports
  assert.ok(!leaks(view.list('discussionMessages')));                                  // discussion read/peers
  assert.ok(!view.list('roomMessages').some(m => (m.attachments || []).some(a => a.id === 'att-bob'))); // attachments
  assert.throws(() => view.put('roomMessages', { id: 'x' }));
  // Own opinion and non-reviewers are unaffected.
  assert.equal(history.read(P, { kind: 'message', id: 'msg-alice' }).content, 'alice secret opinion');
  assert.equal(reviewView(db, { projectId: P, roleId: 'sup' }), db);
  // Release on transition to shared discussion.
  new CollaborationSessions(db).release(P, s.id);
  const released = new History(reviewView(db, { projectId: P, roleId: 'alice' }));
  assert.equal(released.read(P, { kind: 'message', id: 'msg-bob' }).content, 'bob secret opinion');
});

test('isolation also guards a reviewer removed mid-review and survives turning the flag off', () => {
  const db = seed(); const s = review(db);
  new CollaborationSessions(db).removeMember(P, s.id, { roleId: 'bob' });
  setCollaborationSessionsEnabled(db, P, false);
  assert.throws(() => new History(reviewView(db, { projectId: P, roleId: 'alice' })).read(P, { kind: 'message', id: 'msg-bob' }));
});
