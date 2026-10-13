import {t,dateLocale} from './i18n.js';
import {bindQuotaDetails} from './role-icons.js';

const valid=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;

/** Never borrow counters from an archived session, another device, or the role's old model. */
export function contextForRole(role,data) {
  const session=(data.roleSessions||[]).find(s=>s.roleId===role.id&&s.projectId===role.projectId&&s.conversationId===role.projectId&&s.nodeId===role.nodeId&&s.runtime===role.runtime&&s.status!=='archived'&&!s.candidateFor&&!s.historyClearedAt);
  const runs=session?(data.runs||[]).filter(r=>r.roleId===role.id&&r.projectId===role.projectId&&r.nodeId===role.nodeId&&r.roleSessionId===session.id&&!r.historyClearedAt&&!r.switchOperationId&&r.roleSnapshot?.runtime===role.runtime&&r.contextUsage&&(!r.contextUsage.sessionId||r.contextUsage.sessionId===session.nativeSessionId)):[];
  runs.sort((a,b)=>Date.parse(b.contextUsage.observedAt||b.createdAt)-Date.parse(a.contextUsage.observedAt||a.createdAt)||Date.parse(b.createdAt)-Date.parse(a.createdAt));
  const latest=runs[0],sample=(latest?.model||latest?.roleSnapshot?.model)===role.model?latest.contextUsage:{},used=valid(sample.usedTokens)?sample.usedTokens:null,limit=valid(sample.limitTokens)&&sample.limitTokens>0?sample.limitTokens:null;
  return {...sample,usedTokens:used,limitTokens:limit,percent:used!==null&&limit!==null?used/limit*100:null};
}

/** A hollow ring represents context used; the solid neighbouring badges remain account quota left. */
export function roleContextRing(role,data) {
  const sample=contextForRole(role,data),known=sample.percent!==null,pct=known?Math.round(sample.percent):null;
  const mark=document.createElement('button');mark.type='button';mark.className=`role-context-ring ${known?(pct>=90?'is-high':pct>=70?'is-mid':'is-normal'):'is-unknown'}`;
  mark.style.setProperty('--context-percent',`${known?Math.min(100,sample.percent):0}%`);
  mark.setAttribute('aria-haspopup','dialog');
  const details=()=>{
    const number=n=>new Intl.NumberFormat(dateLocale()).format(n);
    const remaining=known?t('Context used: {pct}%',{pct}):t('Context usage unknown');
    const values=sample.usedTokens===null?t(sample.state==='compacted'?'Compacted; awaiting the next context measurement.':'No current-session measurement. Updates after a supported CLI reports usage.'):
      sample.limitTokens===null?t('Last input: {used} tokens; context limit unavailable.',{used:number(sample.usedTokens)}):t('Last input: {used} / {limit} tokens',{used:number(sample.usedTokens),limit:number(sample.limitTokens)});
    const time=sample.observedAt&&Number.isFinite(Date.parse(sample.observedAt))?t('Measured at: {time}',{time:new Date(sample.observedAt).toLocaleString(dateLocale())}):'';
    return {remaining,reset:[values,time,t('Latest native request snapshot, not cumulative usage or remaining account quota.')].filter(Boolean).join('\n')};
  };
  mark.setAttribute('aria-label',details().remaining);bindQuotaDetails(mark,details,'Context usage');return mark;
}
