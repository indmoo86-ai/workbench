import {t} from './i18n.js';

const labels={queued:'Queued on platform',pending_verification:'Pending verification',processing:'CLI processing',processed:'Batch processed',unresolved:'Needs attention'};
const reasons={collecting:'collecting',not_idle:'CLI busy',role_busy:'CLI busy',turn_active:'CLI busy',tools_running:'CLI busy',approval_pending:'Waiting for approval',
  worker_upgrade_required:'Worker upgrade required',broadcast_paused:'Broadcast paused',manual_takeover:'Manual takeover',lease_expired:'Reservation expired',worker_rejected:'Reservation expired',not_owner:'CLI busy',unknown:'CLI state unknown'};

/** Read-only strip: shows platform queue vs. CLI execution truthfully; never offers a control that writes to a CLI. */
export function renderSessionQueue(status,{create,roleName}) {
  if(!status)return null;
  const counts={};for(const r of status.receipts||[])if(r.state!=='processed')counts[r.state]=(counts[r.state]||0)+1;
  const waiting=(status.collectors||[]).map(c=>`${roleName(c.roleId)}: ${t(reasons[c.waitingReason]||'collecting')}`);
  if(!Object.keys(counts).length&&!waiting.length)return null;
  const box=create('div','session-queue-strip');box.setAttribute('role','status');
  box.append(create('strong','',t('Session queue')));
  for(const [state,n] of Object.entries(counts))box.append(create('span','pill',`${t(labels[state]||state)} · ${n}`));
  if(waiting.length)box.append(create('span','workspace-note',waiting.join(' · ')));
  return box;
}
