/**
 * Per-runtime turn-state adapters. They read only the normalised Worker events (status / tool / approval) that
 * each driver already emits, and derive the facts trulyIdle() needs. Unknown runtimes or missing facts stay busy.
 */
const OPEN = new Set(['inProgress', 'in_progress', 'running', 'pending', 'started']);
const CLOSED = new Set(['completed', 'failed', 'declined', 'cancelled', 'canceled', 'error', 'success']);
const TERMINAL = new Set(['succeeded', 'failed', 'interrupted']);

/** How each driver identifies a tool call start and end in its 'tool' events. */
export const RUNTIME_TOOL_RULES = Object.freeze({
  // Codex app-server items carry a stable id and a status that moves inProgress -> completed/failed/declined.
  codex: item => item?.id ? { id: item.id, open: OPEN.has(item.status), closed: CLOSED.has(item.status) } : null,
  // Claude stream-json: tool_use opens by id, tool_result closes by tool_use_id.
  claude: item => item?.type === 'tool_result' ? { id: item.tool_use_id || item.id, closed: true }
    : item?.type === 'tool_use' && item.id ? { id: item.id, open: true } : null,
  // Grok and Agy print sessions: items with id + status, or tool_result items that reference the call id.
  grok: item => printItem(item),
  agy: item => printItem(item)
});
function printItem(item) {
  if (!item) return null;
  if (item.type === 'tool_result') return { id: item.tool_use_id || item.id, closed: true };
  if (!item.id) return null;
  return { id: item.id, open: OPEN.has(item.status) || (!item.status && item.type !== 'tool_result'), closed: CLOSED.has(item.status) };
}
export const runtimeKey = runtime => ({ codex: 'codex', claude: 'claude', 'claude-code': 'claude', grok: 'grok', agy: 'agy', antigravity: 'agy', gemini: 'agy' })[String(runtime || '').toLowerCase()] || null;

/** Tracks one Worker's runs; state(key) answers for a role session (or project:role key). */
export class TurnStates {
  constructor({ nodeId }) { this.nodeId = nodeId; this.runs = new Map(); this.manual = new Set(); }

  /** Register a run before its first event so a starting turn is already busy. */
  begin(run) {
    this.runs.set(run.id, { key: run.roleSessionId || `${run.projectId}:${run.roleId}`, roleKey: `${run.projectId}:${run.roleId}`, runtime: runtimeKey(run.runtime), active: true, tools: new Set(), approvals: new Set() });
  }

  observe(runId, type, payload = {}) {
    const r = this.runs.get(runId);
    if (!r) return;
    if (type === 'status') {
      if (TERMINAL.has(payload.status)) {
        r.active = false;
        // A turn is over only when the driver also says its tools are closed or the process settled.
        if (payload.discussionCleanup?.toolsClosed === true || payload.processSettled === true) r.tools.clear();
        if (payload.processSettled === true) r.approvals.clear();
      } else if (payload.status) r.active = true;
    }
    if (type === 'tool') {
      const rule = RUNTIME_TOOL_RULES[r.runtime];
      const fact = rule ? rule(payload.item) : null;
      if (fact?.closed) r.tools.delete(fact.id); else if (fact?.open) r.tools.add(fact.id);
    }
    if (type === 'approval') r.approvals.add(payload.id ?? payload.rpcId);
    if (type === 'approval_resolved') r.approvals.delete(payload.id);
  }

  setManualTakeover(key, value) { value ? this.manual.add(key) : this.manual.delete(key); }

  /** Facts for trulyIdle(); a runtime without a tool rule is never reported idle. */
  state(key, { ownerNodeId, runtime, excludeRunId } = {}) {
    // Reservations use the project-role mutex; native UUIDs remain available for driver identity.
    const runs = [...this.runs.entries()].filter(([id, r]) => id !== excludeRunId && (r.key === key || r.roleKey === key)).map(([, r]) => r);
    if (!runtimeKey(runtime) || runs.some(r => !r.runtime)) return null;
    return { turnActive: runs.some(r => r.active), pendingTools: runs.reduce((n, r) => n + r.tools.size, 0),
      pendingApproval: runs.some(r => r.approvals.size > 0), ownedByThisWorker: ownerNodeId === this.nodeId, manualTakeover: this.manual.has(key) };
  }

  /** Forget fully finished runs. */
  prune() { for (const [id, r] of this.runs) if (!r.active && !r.tools.size && !r.approvals.size) this.runs.delete(id); }
}
