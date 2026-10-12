import {t} from './i18n.js';

const labels={queued:'Queued on platform',pending_verification:'Pending verification',processing:'CLI processing',processed:'Batch processed',unresolved:'Needs attention'};
const reasons={collecting:'collecting',not_idle:'CLI busy',role_busy:'CLI busy',turn_active:'CLI busy',tools_running:'CLI busy',approval_pending:'Waiting for approval',
  worker_upgrade_required:'Worker upgrade required',session_closed:'Session closed',broadcast_paused:'Broadcast paused',manual_takeover:'Manual takeover',lease_expired:'Reservation expired',worker_rejected:'Reservation expired',not_owner:'CLI busy',unknown:'CLI state unknown'};

/** Read-only strip: shows platform queue vs. CLI execution truthfully; never offers a control that writes to a CLI. */
export function renderSessionQueue(status,{create,roleName,api,refreshState,projectId}) {
  if(!status)return null;
  const counts={};for(const r of status.receipts||[])if(r.state!=='processed')counts[r.state]=(counts[r.state]||0)+1;
  const waiting=(status.collectors||[]).map(c=>`${roleName(c.roleId)}: ${t(reasons[c.waitingReason]||'collecting')}`);
  const sessions=(status.sessions||[]).filter(x=>x.state==='open');
  if(!Object.keys(counts).length&&!waiting.length&&!sessions.length)return null;
  const box=create('div','session-queue-strip');box.setAttribute('role','status');
  box.append(create('strong','',t('Session queue')));
  for(const [state,n] of Object.entries(counts))box.append(create('span','pill',`${t(labels[state]||state)} · ${n}`));
  if(waiting.length)box.append(create('span','workspace-note',waiting.join(' · ')));
  if(api)for(const session of sessions)box.append(sessionRow(session,status,{create,roleName,api,refreshState,projectId}));
  return box;
}

/** Explicit human controls only: close, release an independent review, grant more broadcast budget. */
function sessionRow(session,status,{create,roleName,api,refreshState,projectId}) {
  const row=create('div','session-queue-row');
  const cycle=(status.cycles||[]).find(c=>c.rootSessionId===session.id);
  const label=`${session.goal} · ${session.participants.map(roleName).join(', ')}${cycle?` · ${t('Budget')} ${cycle.used}/${cycle.limit}`:''}`;
  row.append(create('span','',label));
  const base=`/api/projects/${encodeURIComponent(projectId)}/collaboration-sessions/${encodeURIComponent(session.id)}`;
  const act=(text,run)=>{const b=create('button','secondary compact',t(text));b.type='button';b.onclick=async()=>{b.disabled=true;try{await run();await refreshState({quiet:true});}catch(e){alert(e.message);}finally{b.disabled=false;}};row.append(b);};
  if(cycle?.paused&&!cycle.ended)act('Grant more batches',async()=>{const n=Number(prompt(t('Additional batches (1-1000)'),'5'));if(!Number.isSafeInteger(n)||n<1)return;await api(`${base}/budget`,{method:'POST',json:{additional:n}});});
  if(session.type==='independent-review'&&!session.reviewReleased)act('Release reviews',()=>api(`${base}/release`,{method:'POST',json:{}}));
  act('End discussion',async()=>{if(confirm(t('End this discussion? Accepted tasks are not cancelled.')))await api(`${base}/close`,{method:'POST',json:{}});});
  return row;
}
