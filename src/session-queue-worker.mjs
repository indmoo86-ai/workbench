import { randomUUID } from 'node:crypto';
import { tr } from './i18n.mjs';

/**
 * Worker side of the external queue. Idleness comes from the adapter's real execution state, never from CPU,
 * silence or process existence; anything unknown counts as busy. A reservation is re-validated right before the
 * single write to the CLI, and the generation changes whenever the slot's state changes.
 */
export function trulyIdle(state) {
  if (!state || typeof state !== 'object') return { idle: false, reason: 'unknown' };
  if (state.turnActive !== false) return { idle: false, reason: state.turnActive ? 'turn_active' : 'unknown' };
  if (state.pendingTools !== 0) return { idle: false, reason: 'tools_running' };
  if (state.pendingApproval !== false) return { idle: false, reason: 'approval_pending' };
  if (state.ownedByThisWorker !== true) return { idle: false, reason: 'not_owner' };
  if (state.manualTakeover !== false) return { idle: false, reason: 'manual_takeover' };
  return { idle: true, reason: null };
}

/** Every terminal path preserves delivery evidence; an unknown write or surviving driver is never refunded. */
export function terminalDeliveryFacts(run, payload) {
  if(!['succeeded','failed','interrupted'].includes(payload.status))return payload;
  if(payload.inputDeliveryState==='not_delivered'&&payload.queueRejected===true)return payload;
  if(run.inputDeliveryState==='not_delivered')return {...payload,inputDeliveryState:'not_delivered',queueRejected:true,queueRetryable:run.queueRetryable===true,processSettled:run.processSettled===true||payload.processSettled===true};
  if((run.collaborationBatch?.deliveryProtocol===2||run.propagationBudget==='reserved')&&!run.inputDeliveryState&&!payload.controlLost
    && (!run.pid||payload.processSettled===true))return {...payload,inputDeliveryState:'not_delivered',queueRejected:true,queueRetryable:false,processSettled:true};
  return payload;
}

export class QueueSlots {
  constructor({ now = () => Date.now(), leaseMs = 30000 } = {}) { this.now = now; this.leaseMs = leaseMs; this.slots = new Map(); }

  #slot(key) { if (!this.slots.has(key)) this.slots.set(key, { generation: 0, reservation: null }); return this.slots.get(key); }

  /** Any change of the adapter state invalidates outstanding reservations. */
  reservationFor(key) { return this.slots.get(key)?.reservation || null; }

  stateChanged(key) { const s = this.#slot(key); s.generation++; s.reservation = null; }

  reserve(key, state) {
    const check = trulyIdle(state);
    if (!check.idle) return { ok: false, reason: check.reason };
    const s = this.#slot(key);
    if (s.reservation && Date.parse(s.reservation.expiresAt) > this.now()) return { ok: false, reason: 'reserved' };
    s.generation++;
    s.reservation = { id: randomUUID(), generation: s.generation, expiresAt: new Date(this.now() + this.leaseMs).toISOString() };
    return { ok: true, reservation: { ...s.reservation } };
  }

  /** Home declined to seal (nothing ready, budget, capability): give the reservation back without writing. */
  cancel(key, reservation) { const s = this.#slot(key); if (s.reservation?.id === reservation?.id) s.reservation = null; }

  /** Re-check, then write exactly once. Expired, stale-generation or no-longer-idle reservations never execute. */
  async deliver(key, reservation, state, write) {
    const s = this.#slot(key);
    if (!s.reservation || s.reservation.id !== reservation?.id || s.reservation.generation !== reservation.generation)
      throw new Error(tr('sessionQueue.reservationInvalid'));
    if (!(Date.parse(s.reservation.expiresAt) > this.now())) { s.reservation = null; throw new Error(tr('sessionQueue.reservationExpired')); }
    if (!trulyIdle(state).idle) { s.reservation = null; throw new Error(tr('sessionQueue.reservationInvalid')); }
    s.reservation = null; s.generation++;
    return write();
  }
}

/** One batch becomes one input; peer messages are labelled as chat records, not user commands. */
export function renderBatch(batch, messages) {
  return JSON.stringify({ kind: 'collaboration_batch', batchId: batch.id, sessionId: batch.sessionId, explicitRequest: batch.explicit,
    messages: messages.map(m => ({ id: m.id, author: m.senderName || m.sender, roleId: m.roleId || null, createdAt: m.createdAt, replyToId: m.replyToId || null, text: m.text })) });
}
