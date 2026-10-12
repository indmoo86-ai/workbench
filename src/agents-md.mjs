import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tr } from './i18n.mjs';

/** Create AGENTS.md (the single project memory) and a CLAUDE.md pointer only when absent; existing user files are never overwritten and nothing is committed. */
export async function ensureAgentsFiles(dir) {
  const created = [];
  for (const [name, text] of [['AGENTS.md', tr('agentsMd.template')], ['CLAUDE.md', '@AGENTS.md\n']]) {
    try { await writeFile(join(dir, name), text, { flag: 'wx', mode: 0o644 }); created.push(name); }
    catch (e) { if (e.code !== 'EEXIST') throw e; }
  }
  return created;
}
