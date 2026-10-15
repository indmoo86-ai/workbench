// Role templates: stale editors must be rejected after edit, delete or restore; revisions never go backwards.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { Store } = await import(pathToFileURL(join(root, 'src', 'store.mjs')).href);
const templates = await import(pathToFileURL(join(root, 'src', 'role-templates.mjs')).href);
const i18n = await import(pathToFileURL(join(root, 'src', 'i18n.mjs')).href);

function withStore(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'wb-role-templates-'));
  const db = new Store(join(dir, 'home.sqlite'));
  try { return i18n.runWithLanguage('en', () => fn(db)); } finally { db.db?.close?.(); rmSync(dir, { recursive: true, force: true }); }
}
const tester = db => templates.listRoleTemplates(db).find(t => t.key === 'tester');
const save = (db, t, patch) => templates.saveRoleTemplate(db, { key: t.key, revision: t.revision, name: t.name, responsibility: t.responsibility, instructions: t.instructions, ...patch });
const stale = /changed; reopen/;

test('a page opened before restore cannot overwrite the restored built-in', () => withStore(db => {
  const opened = tester(db);
  const edited = save(db, opened, { responsibility: 'edited' });
  assert.equal(edited.revision, opened.revision + 1);
  const restored = templates.restoreRoleTemplate(db, 'tester', edited.revision);
  assert.ok(restored.revision > edited.revision, 'restore keeps a monotonic revision');
  assert.equal(restored.customized, false);
  // Both the original page and the page that made the edit are now stale.
  assert.throws(() => save(db, opened, { responsibility: 'old page' }), stale);
  assert.throws(() => save(db, edited, { responsibility: 'older page' }), stale);
  assert.equal(tester(db).responsibility, restored.responsibility, 'restored text is not overwritten');
}));

test('restore checks the editor revision and rejects a missing one', () => withStore(db => {
  const edited = save(db, tester(db), { responsibility: 'edited' });
  assert.throws(() => templates.restoreRoleTemplate(db, 'tester', edited.revision - 1), stale);
  assert.throws(() => templates.restoreRoleTemplate(db, 'tester', undefined), stale);
  assert.equal(tester(db).responsibility, 'edited');
}));

test('delete and restore of a built-in keep revisions increasing and reject stale pages', () => withStore(db => {
  const opened = tester(db);
  templates.deleteRoleTemplate(db, 'tester', opened.revision);
  assert.equal(tester(db), undefined);
  const hidden = templates.hiddenRoleTemplates(db).find(t => t.key === 'tester');
  assert.ok(hidden.revision > opened.revision);
  assert.throws(() => save(db, opened, { responsibility: 'old page' }), /not found|changed/);
  const restored = templates.restoreRoleTemplate(db, 'tester', hidden.revision);
  assert.ok(restored.revision > hidden.revision);
  assert.throws(() => save(db, opened, { responsibility: 'old page' }), stale);
}));

test('updates and deletes require the current revision', () => withStore(db => {
  const created = templates.saveRoleTemplate(db, { name: 'QA', responsibility: 'check', instructions: 'run' });
  assert.throws(() => templates.saveRoleTemplate(db, { key: created.key, name: 'QA', responsibility: 'x', instructions: '' }), stale);
  assert.throws(() => templates.deleteRoleTemplate(db, created.key, undefined), stale);
  const updated = save(db, created, { responsibility: 'new' });
  assert.throws(() => templates.deleteRoleTemplate(db, created.key, created.revision), stale);
  templates.deleteRoleTemplate(db, created.key, updated.revision);
  assert.equal(templates.listRoleTemplates(db).some(t => t.key === created.key), false);
}));
