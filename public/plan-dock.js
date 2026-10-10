/** Hiding applies to the current version only; the dock reappears when the same plan resumes or has new results. */
export function planDismissKey(plan) {
  return JSON.stringify([plan.id, plan.status, plan.updatedAt || plan.createdAt || '']);
}

/** A step that never actually started is not reported as a failed run; the CLI final state and the report verdict are shown separately. */
export function planMemberLabel(request, run, task) {
  if(!request)return 'Not started';
  if(request.notExecutedReason || (!request.currentRunId&&request.status==='failed'))return 'Not executed';
  if(run?.status==='failed')return 'Execution failed';
  if(run?.status==='interrupted'||request.status==='cancelled')return 'Cancelled';
  const active={queued:'Queued',running:'Running',starting:'Starting',preparing:'Preparing',stopping:'Stopping',reconciling:'Awaiting node confirmation',waiting_approval:'Awaiting confirmation'}[run?.status];
  if(active)return active;
  if(request.status==='waiting_call')return 'Waiting for other roles to reply';
  if(request.status==='waiting_input')return 'Awaiting answer';
  if(run?.status==='succeeded') {
    const verdict=request.outcome||run.report?.verdict;
    return {passed:'Done',failed:'Verdict: not passed',blocked:'Verdict: blocked',needs_input:'Awaiting answer',unverified:'No verdict'}[verdict]||'To verify';
  }
  return task?.waitingReason||({succeeded:'Done',running:'Running',queued:'Queued',waiting_dependencies:'Waiting on prior steps',failed:'Failed'}[request.status]||'Waiting');
}

/** A scheduler stage can be open while every member is still queued; display execution evidence, not that lifecycle flag. */
export function planStageActivity(stage, requests=[], runs=[], tasks=[]) {
  const current=(stage?.members||[]).map(member=>{
    let request=requests.find(r=>r.id===member.requestId);
    for(let i=0;request?.continuationRequestId&&i<20;i++)request=requests.find(r=>r.id===request.continuationRequestId);
    return {request,run:runs.find(r=>r.id===request?.currentRunId),task:tasks.find(t=>t.id===request?.taskId)};
  });
  const active=current.find(item=>['running','starting','preparing','stopping','reconciling','waiting_approval'].includes(item.run?.status))||current.find(item=>item.run?.status==='queued');
  if(active)return {label:planMemberLabel(active.request,active.run,active.task),reason:''};
  if(current.some(item=>item.request?.status==='waiting_call'))return {label:'Waiting for other roles to reply',reason:''};
  if(current.some(item=>item.request?.status==='waiting_input'))return {label:'Awaiting answer',reason:''};
  const queued=current.filter(item=>['queued','waiting_dependencies'].includes(item.request?.status));
  const reason=queued.find(item=>item.task?.waitingReason)?.task.waitingReason||'';
  if(queued.length)return {label:reason?'Blocked in queue':'Queued',reason};
  return {label:'Waiting to advance',reason:''};
}

/** Show only the latest plan round created for the project; closing does not fall back to older rounds, and progress is still derived from call state. */
export function planDockState(plans, requests, projectId, dismissedKeys = []) {
  const time = plan => Date.parse(plan.createdAt || plan.updatedAt || '') || 0;
  const dated = (plans || []).filter(plan => plan.projectId === projectId)
    .sort((a, b) => time(b) - time(a)).slice(0, 1);
  const byId = new Map((requests || []).map(request => [request.id, request]));
  const dismissible = dated.filter(plan => {
    if (!['succeeded', 'cancelled', 'failed', 'blocked', 'completed_with_issues'].includes(plan.status)) return false;
    const ids = new Set((plan.stages || []).flatMap(stage => (stage.members || []).map(member => member.requestId)));
    for (const id of ids) {
      const request = byId.get(id);
      if (request && !['succeeded', 'failed', 'cancelled', 'waiting_dependencies'].includes(request.status)) return false;
      if (request?.continuationRequestId) ids.add(request.continuationRequestId);
    }
    return true;
  });
  const hidden = new Set(dismissedKeys);
  const canDismiss = new Set(dismissible.map(plan => plan.id));
  const visible = dated.filter(plan => !canDismiss.has(plan.id) || !hidden.has(planDismissKey(plan)));
  const current = visible[0] || null;
  if (!current) return { current: null, plans: dated, dismissible, completed: 0, total: 0, currentStage: '' };
  const completedRequest = id => {
    let request = byId.get(id);
    const seen = new Set();
    for (let index = 0; request?.continuationRequestId && index < 20; index++) {
      if (seen.has(request.id)) break;
      seen.add(request.id);
      request = byId.get(request.continuationRequestId);
    }
    return request?.status === 'succeeded' || (current.failurePolicy==='collect_reviews' && request?.status==='failed' && !!request.currentRunId && !request.notExecutedReason);
  };
  const stages = current.stages || [];
  const total = stages.reduce((count, stage) => count + (stage.members || []).length, 0);
  const completed = stages.reduce((count, stage) => count + (stage.status === 'succeeded'
    ? (stage.members || []).length : (stage.members || []).filter(member => completedRequest(member.requestId)).length), 0);
  const currentStage = current.status==='completed_with_issues'?'Reviews collected; some failed or missing':stages.find(stage => stage.status !== 'succeeded' && !(current.failurePolicy==='collect_reviews'&&stage.status==='failed'))?.title || (current.status === 'succeeded' ? 'All done' : 'Waiting to advance');
  return { current, plans: dated, dismissible, completed, total, currentStage };
}
