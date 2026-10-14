import { randomUUID } from 'node:crypto';
import { tr } from './i18n.mjs';
import { defaultRoleTemplates, isBroadcastName, isSupervisorName } from './default-roles.mjs';
import { normalizeResponsibility } from './role-definition.mjs';

const KIND = 'roleTemplateRecords';
const now = () => new Date().toISOString();

/** Built-in text follows the current language until a user edits it; edited or added templates keep the saved text verbatim. */
function merged(db) {
  const records = new Map(db.list(KIND).map(record => [record.id, record]));
  const builtins = defaultRoleTemplates().map(template => {
    const record = records.get(template.key);
    if (record?.deleted) return { ...template, builtin: true, deleted: true, revision: record.revision };
    return record && !record.restored
      ? { ...template, name: record.name, responsibility: record.responsibility, instructions: record.instructions, builtin: true, customized: true, revision: record.revision, updatedAt: record.updatedAt }
      : { ...template, builtin: true, customized: false, revision: record?.revision || 0 };
  });
  const custom = [...records.values()].filter(record => record.custom && !record.deleted)
    .map(record => ({ key: record.id, name: record.name, responsibility: record.responsibility, instructions: record.instructions,
      mode: 'workspace-write', builtin: false, customized: true, revision: record.revision, updatedAt: record.updatedAt }));
  return [...builtins, ...custom];
}

/** Templates offered when creating a role; deleted built-ins are hidden but remain restorable. */
export function listRoleTemplates(db) {
  return merged(db).filter(template => !template.deleted);
}

export function hiddenRoleTemplates(db) {
  return merged(db).filter(template => template.deleted).map(({ key, name, responsibility, revision }) => ({ key, name, responsibility, revision }));
}

function validate(db, input, key) {
  const name = typeof input?.name === 'string' ? input.name.trim() : '';
  if (!/^[\p{L}\p{N}_-]{1,32}$/u.test(name)) throw new Error(tr('rooms.roleNamesMustBe1'));
  if (isBroadcastName(name)) throw new Error(tr('rooms.broadcastNameReserved'));
  if (isSupervisorName(name)) throw new Error(tr('rooms.supervisorFixedSystemRoleUse'));
  if (listRoleTemplates(db).some(template => template.key !== key && template.name === name)) throw new Error(tr('roleTemplates.nameInUse'));
  if (typeof input.instructions !== 'string' || input.instructions.length > 12000) throw new Error(tr('rooms.roleInstructionsLimited12000Characters'));
  return { name, responsibility: normalizeResponsibility(typeof input.responsibility === 'string' ? input.responsibility : ''), instructions: input.instructions.trim() };
}

function current(db, key) {
  const template = merged(db).find(item => item.key === key && !item.deleted);
  if (!template) throw new Error(tr('roleTemplates.notFound'));
  return template;
}

/** Every change to an existing template must name the revision the editor last saw; a missing or stale revision is rejected. */
function checkRevision(template, revision) {
  if (!Number.isSafeInteger(revision) || revision !== template.revision) throw new Error(tr('roleTemplates.changedReopen'));
}

/** Create when no key is given; otherwise update a built-in or custom template with an optimistic revision check. */
export function saveRoleTemplate(db, input = {}) {
  return db.transaction(() => {
    if (input.key === undefined || input.key === null || input.key === '') {
      const value = validate(db, input, null), id = `custom-${randomUUID()}`;
      db.put(KIND, { id, custom: true, ...value, revision: 1, createdAt: now(), updatedAt: now() });
      return current(db, id);
    }
    if (typeof input.key !== 'string') throw new Error(tr('roleTemplates.notFound'));
    const template = current(db, input.key);
    checkRevision(template, input.revision);
    const value = validate(db, input, template.key), old = db.get(KIND, template.key);
    db.put(KIND, { ...old, id: template.key, custom: !template.builtin, deleted: false, restored: false, ...value,
      revision: template.revision + 1, createdAt: old?.createdAt || now(), updatedAt: now() });
    return current(db, template.key);
  });
}

/** Deleting affects only future role creation; roles already created from a template keep their own copied text. */
export function deleteRoleTemplate(db, key, revision) {
  return db.transaction(() => {
    const template = current(db, key);
    checkRevision(template, revision);
    if (!template.builtin) db.remove(KIND, key);
    else db.put(KIND, { id: key, deleted: true, revision: template.revision + 1, updatedAt: now() });
    return { key, deleted: true };
  });
}

/** Restores the shipped text of a built-in template, whether it was edited or deleted. The record is kept with a higher revision so a page opened before the restore cannot save over it. */
export function restoreRoleTemplate(db, key, revision) {
  return db.transaction(() => {
    if (!defaultRoleTemplates().some(template => template.key === key)) throw new Error(tr('roleTemplates.notFound'));
    const template = merged(db).find(item => item.key === key);
    checkRevision(template, revision);
    db.put(KIND, { id: key, restored: true, revision: template.revision + 1, updatedAt: now() });
    return current(db, key);
  });
}
