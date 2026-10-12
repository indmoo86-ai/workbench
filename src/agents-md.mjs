import { writeFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tr } from './i18n.mjs';

const exec = promisify(execFile);
const git = (cwd, args) => exec('git', args, { cwd, timeout: 30000, maxBuffer: 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
export const AGENTS_COMMIT_MESSAGE = 'chore: add AGENTS.md project memory';

/** Create AGENTS.md (the single project memory) and a CLAUDE.md pointer only when absent; existing files are never overwritten.
 * When the directory is a Git repository root, commit only the newly created files locally (never pushes); commit failures are reported, not thrown. */
export async function ensureAgentsFiles(dir) {
  const created = [];
  for (const [name, text] of [['AGENTS.md', tr('agentsMd.template')], ['CLAUDE.md', '@AGENTS.md\n']]) {
    try { await writeFile(join(dir, name), text, { flag: 'wx', mode: 0o644 }); created.push(name); }
    catch (e) { if (e.code !== 'EEXIST') throw e; }
  }
  const result = { created, committed: false, commitError: null };
  if (!created.length) return result;
  let top;
  try { top = await realpath((await git(dir, ['rev-parse', '--show-toplevel'])).stdout.trim()); } catch { return result; }
  if (top !== await realpath(dir)) return result;
  try {
    await git(dir, ['add', '--', ...created]);
    await git(dir, ['commit', '-q', '-m', AGENTS_COMMIT_MESSAGE, '--only', '--', ...created]);
    result.committed = true;
  } catch (e) {
    await git(dir, ['reset', '-q', '--', ...created]).catch(() => {});
    result.commitError = String(e.stderr || e.message || e).trim().slice(0, 300);
  }
  return result;
}
