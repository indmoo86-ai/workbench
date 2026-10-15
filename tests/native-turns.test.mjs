// Session-page takeover: exact native resume, idempotent sends, occupancy refusal and no Workbench injection.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const load = name => import(pathToFileURL(join(root, 'src', name)).href);
const { NativeTurnsHome, NativeTurnRunner, applyNativeTurnEvent } = await load('native-turns.mjs');
const { Store } = await load('store.mjs');
const { nativeTurnArgs, CliPrintSession } = await load('cli-print-session.mjs');
const { assertNativeSessionIdle } = await load('native-sessions.mjs');

const SID = '00000000-1111-4222-8333-444444444444';
function home(t) {
  const dir = mkdtempSync(join(tmpdir(), 'wb-native-turns-'));
  const db = new Store(join(dir, 'home.sqlite'));
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  const sent = [];
  const turns = new NativeTurnsHome({ db, send: (nodeId, payload) => sent.push({ nodeId, ...payload }), online: () => true, change() {},
    assertIdle: input => assertNativeSessionIdle(db, { ...input, workspace: null, projectId: null }) });
  return { db, sent, turns, worker: { id: 'n1', capabilities: { nativeTurns: 1 } } };
}

test('a takeover send is idempotent by client ID and forwards only the exact native ID and text', t => {
  const { sent, turns, worker } = home(t);
  const body = { runtime: 'codex', sessionId: SID, clientTurnId: 'client-000001', text: 'continue please' };
  const first = turns.create('n1', worker, body), again = turns.create('n1', worker, body);
  assert.equal(first.id, again.id);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], { nodeId: 'n1', type: 'native_turn', id: first.id, runtime: 'codex', sessionId: SID, prompt: 'continue please' });
  assert.throws(() => turns.create('n1', worker, { ...body, text: 'changed' }), /already used/);
  assert.throws(() => turns.create('n1', worker, { ...body, clientTurnId: 'client-000002' }), /still replying/);
});

test('takeover is refused for invalid input, old Workers and sessions owned by a terminal or managed run', t => {
  const { db, turns, worker } = home(t);
  const body = { runtime: 'claude', sessionId: SID, clientTurnId: 'client-000010', text: 'hi' };
  assert.throws(() => turns.create('n1', worker, { ...body, runtime: 'bash' }), /Unsupported CLI/);
  assert.throws(() => turns.create('n1', worker, { ...body, sessionId: '../x' }), /Invalid native session ID/);
  assert.throws(() => turns.create('n1', worker, { ...body, text: '  ' }), /Enter a message/);
  assert.throws(() => turns.create('n1', { capabilities: {} }, body), /Upgrade this Worker/);
  db.put('terminalSessions', { id: 'term-1', status: 'active', nativeSession: { runtime: 'claude', id: SID } });
  assert.throws(() => turns.create('n1', worker, body), /occupied/);
  db.put('terminalSessions', { id: 'term-1', status: 'released', nativeSession: { runtime: 'claude', id: SID } });
  db.put('runs', { id: 'run-1', projectId: 'p1', status: 'running', nativeSession: { runtime: 'claude', id: SID } });
  assert.throws(() => turns.create('n1', worker, body), /managed CLI/);
});

test('turn events keep completed messages in order and ignore updates after the end', () => {
  let turn = { id: 'x', status: 'queued', text: '' };
  for (const event of [{ kind: 'status', status: 'running' }, { kind: 'text', text: 'Hel' }, { kind: 'text', text: 'lo' }, { kind: 'message', text: 'Hello' },
    { kind: 'text', text: 'Done' }, { kind: 'message', text: 'Done.' }, { kind: 'tool', text: 'shell' }, { kind: 'status', status: 'succeeded' }, { kind: 'status', status: 'running' }])
    turn = applyNativeTurnEvent(turn, event);
  assert.equal(turn.text, 'Hello\n\nDone.');
  assert.equal(turn.status, 'succeeded');
  assert.deepEqual(turn.tools, ['shell']);
  assert.equal(applyNativeTurnEvent({ status: 'stopping' }, { kind: 'status', status: 'running' }).status, 'stopping');
});

test('disconnect and Home restart end unfinished turns instead of leaving them running', t => {
  const { db, turns, worker } = home(t);
  const turn = turns.create('n1', worker, { runtime: 'grok', sessionId: SID, clientTurnId: 'client-000020', text: 'go' });
  turns.disconnected('n1');
  assert.equal(db.get('nativeTurns', turn.id).status, 'interrupted');
  db.put('nativeTurns', { ...db.get('nativeTurns', turn.id), status: 'running' });
  turns.recover();
  assert.equal(db.get('nativeTurns', turn.id).status, 'interrupted');
});

test('Worker runner resumes the history folder and stops a CLI that returns a different native ID', async () => {
  const events = [], created = [];
  const fake = reply => ({ start: async () => reply(), stop: async () => { fake.stopped = true; }, shutdown() {} });
  const runner = new NativeTurnRunner({ send: m => events.push(m), resolveSession: async () => ({ workspace: '/tmp/demo' }),
    createSession: options => { created.push(options); return fake(() => { options.emit('status', { status: 'running', nativeSessionId: SID }); options.emit('message', { text: 'ok' }); options.emit('status', { status: 'succeeded' }); }); } });
  await runner.start({ id: 't1', runtime: 'codex', sessionId: SID, prompt: 'p' });
  assert.equal(created[0].cwd, '/tmp/demo');
  assert.equal(created[0].resumeSessionId, SID);
  assert.deepEqual(events.map(e => e.event.status || e.event.kind), ['starting', 'running', 'message', 'succeeded']);
  assert.equal(runner.size, 0);
  events.length = 0;
  const other = new NativeTurnRunner({ send: m => events.push(m), resolveSession: async () => ({ workspace: '/tmp/demo' }),
    createSession: options => fake(() => options.emit('status', { status: 'running', nativeSessionId: 'aaaaaaaa-0000-0000-0000-000000000000' })) });
  await other.start({ id: 't2', runtime: 'codex', sessionId: SID, prompt: 'p' });
  assert.match(events.at(-1).event.error, /different native session/);
  events.length = 0;
  const unknown = new NativeTurnRunner({ send: m => events.push(m), resolveSession: async () => ({ workspace: null }), createSession: () => assert.fail('must not start') });
  await unknown.start({ id: 't3', runtime: 'claude', sessionId: SID, prompt: 'p' });
  assert.match(events.at(-1).event.error, /working folder/);
});

test('native takeover arguments resume exactly and carry no Workbench rules or model override', () => {
  for (const runtime of ['claude', 'grok', 'agy']) {
    const args = nativeTurnArgs(runtime, { cwd: '/tmp/demo', sessionId: SID, prompt: 'hello' });
    assert.ok(args.includes(SID), runtime);
    for (const flag of ['--append-system-prompt', '--rules', '--model', '-m', '--system-prompt-snapshot']) assert.ok(!args.includes(flag), `${runtime} ${flag}`);
  }
  assert.throws(() => nativeTurnArgs('claude', { cwd: '/tmp', sessionId: null, prompt: 'x' }), /exact native session ID/);
});

test('a controlled Claude executable receives the exact resume and streams its reply', async t => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'wb-native-cli-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bin = join(dir, 'claude');
  writeFileSync(bin, `#!/usr/bin/env node\nconst a=process.argv.slice(2);const id=a[a.indexOf('--resume')+1];\nconsole.log(JSON.stringify({type:'system',session_id:id}));\nconsole.log(JSON.stringify({type:'result',subtype:'success',session_id:id,result:'echo:'+a[a.indexOf('-p')+1]+':'+process.cwd()}));\n`);
  chmodSync(bin, 0o755);
  const prior = process.env.CLAUDE_BIN; process.env.CLAUDE_BIN = bin; t.after(() => { if (prior === undefined) delete process.env.CLAUDE_BIN; else process.env.CLAUDE_BIN = prior; });
  const events = [];
  const runner = new NativeTurnRunner({ send: m => events.push(m.event), resolveSession: async () => ({ workspace: dir }),
    createSession: ({ runtime, cwd, resumeSessionId, emit }) => new CliPrintSession({ cwd, runtime, emit, resumeSessionId, env: process.env, native: true }) });
  const done = new Promise(resolve => { const timer = setInterval(() => { if (events.some(e => ['succeeded', 'failed'].includes(e.status))) { clearInterval(timer); resolve(); } }, 20); });
  await runner.start({ id: 't9', runtime: 'claude', sessionId: SID, prompt: 'hi' });
  await done;
  assert.equal(events.at(-1).status, 'succeeded', JSON.stringify(events));
  assert.equal(events.find(e => e.kind === 'message').text, `echo:hi:${dir}`);
});
