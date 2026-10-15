import {t as globalT,dateLocale,getLanguage} from './i18n.js';
import pageZh from './locales/native-takeover-zh.js';
import {simplifiedCliOutput} from './output-language.js';
import {agentIconEl,setActionIcon} from './role-icons.js';
import {renderMarkdown} from './markdown.js';
import {liveSceneRows} from './live-scene.js';
import {toolStatusLabel,stripAnsi} from './run-log-data.js';

/** New takeover strings resolve from this page's own dictionary; every existing string keeps the global translation. */
const t=(text,params)=>{const own=getLanguage()==='zh'&&typeof text==='string'?pageZh[text]:undefined;return own===undefined?globalT(text,params):params?own.replace(/\{(\w+)\}/g,(m,k)=>params[k]??m):own;};
const names={codex:'Codex',claude:'Claude Code',grok:'Grok',agy:'Agy'};
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
const button=(text,fn,cls='secondary')=>{const n=el('button',cls,t(text));n.type='button';n.addEventListener('click',fn);return n;};
const closeButton=fn=>{const n=button('',fn,'icon-button native-close');setActionIcon(n,'close','Close');n.dataset.close='';return n;};

/** The session view reads native history and prepares terminal links. Only after an explicit takeover does it submit turns, resuming the same native ID. */
export function createNativeSessionUI({api,getData,onModeChange,onPreview}){
 const mode=document.querySelector('#navigation-mode'),list=el('nav','project-list native-session-list'),content=el('section','native-session-content panel'),side=el('section','native-session-sidebar');
 list.id='native-session-list';content.id='native-session-content';side.id='native-session-sidebar';
 document.querySelector('#project-list').after(list);document.querySelector('main.workspace').append(content);document.querySelector('#node-sidebar').append(side);
 const filters=el('div','native-session-filters'),device=el('select'),tool=el('select');device.setAttribute('aria-label',t('Session device'));tool.setAttribute('aria-label',t('Agent tool'));filters.append(device,tool);list.before(filters);
 const note=el('p','workspace-note');list.before(note);note.classList.add('native-session-note');
 let selected=null,items=[],version=0,detailVersion=0,lastCatalog='',loading=false,pendingRefresh=false,modeValue='groups',lastRefresh=0,listSignature='',detailSignature='';
 const active=()=>modeValue==='sessions';
 const endpoint=nodeId=>`/api/native-sessions/${encodeURIComponent(nodeId)}`;
 const key=item=>item?`${item.nodeId}/${item.runtime}/${item.entryId||item.id}`:'';
 const nativeId=item=>item.entryId?item.sessionId:item.sessionId||item.id;
 const workerName=id=>getData().workers?.find(w=>w.id===id)?.name||id;
 const time=value=>{const date=new Date(value);return Number.isNaN(date.getTime())?'':date.toLocaleString(dateLocale(),{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});};
 function options(select,values){const old=select.value;select.replaceChildren(...values.map(([value,label])=>{const o=el('option','',label);o.value=value;return o;}));if(values.some(([v])=>v===old))select.value=old;}
 function populate(){const signature=JSON.stringify((getData().workers||[]).map(w=>[w.id,w.name,w.online,w.nodeKind,w.runtimes?.map(r=>[r.type,r.available,r.supported])]));if(signature===lastCatalog)return false;lastCatalog=signature;options(device,[['all',t('All sessions')],['created',t('Created sessions')],['group',t('Group chats')],['local',t('Local machine')],['cloud',t('Servers')],['other',t('Other devices')]]);options(tool,[['all',t('All Agents')],...Object.entries(names)]);return true;}
 function workers(){return(getData().workers||[]).filter(w=>['all','created','group'].includes(device.value)||(device.value==='other'?!['local','cloud'].includes(w.nodeKind):w.nodeKind===device.value));}
 function resetDetail(){detailVersion++;selected=null;detailSignature='';takeover.detach();content.replaceChildren(el('div','native-empty',t('Select a native session to view its details.')));side.replaceChildren(el('h2','native-side-title',t('Session details')),el('p','native-side-hint',t('Read-only preview. Take over at the bottom to continue here, or open iTerm.')));}
 function renderList(){const signature=JSON.stringify([key(selected),items]);if(signature===listSignature)return;listSignature=signature;const scroll=list.scrollTop;list.replaceChildren();for(const item of items){const b=el('button',`project-item${key(selected)===key(item)?' active':''}`);b.type='button';b.title=`${item.title||item.id}\n${workerName(item.nodeId)}`;const copy=el('span','project-item-copy');const title=el('strong','',item.title||item.id);title.translate=false;copy.append(title,el('small','',`${names[item.runtime]} · ${time(item.modifiedAt||item.createdAt)}`));b.append(agentIconEl(item.runtime),copy);b.addEventListener('click',()=>read(item));list.append(b);}list.scrollTop=scroll;}
 /** Fetch at most two device catalogues at a time; one unavailable device must not hide the others. */
 async function load({quiet=false}={}){if(!active())return;if(quiet&&loading){pendingRefresh=true;return;}pendingRefresh=false;const ticket=++version;loading=true;lastRefresh=Date.now();if(!quiet){items=[];resetDetail();renderList();note.textContent=t('Loading native sessions…');}
  // The API's all scope excludes managed group history; combine both scopes only for the unfiltered view.
  const scopes=device.value==='all'?['all','group']:[['created','group'].includes(device.value)?device.value:'all'];
  const jobs=workers().flatMap(w=>(tool.value==='all'?Object.keys(names):[tool.value]).filter(runtime=>device.value==='created'||w.runtimes?.some(r=>r.type===runtime&&r.available&&r.supported!==false)).flatMap(runtime=>scopes.map(scope=>({nodeId:w.id,runtime,scope})))),results=[],errors=[],failedJobs=new Set();let partial=false,index=0;
  await Promise.all(Array.from({length:Math.min(2,jobs.length)},async()=>{while(index<jobs.length&&ticket===version&&active()){const job=jobs[index++];try{const result=await api(`${endpoint(job.nodeId)}?${new URLSearchParams({runtime:job.runtime,scope:job.scope})}`);results.push(...(result.items||[]).map(item=>({...item,nodeId:job.nodeId})));partial||=result.partial===true;}catch(e){failedJobs.add(`${job.nodeId}/${job.runtime}/${job.scope}`);errors.push(`${workerName(job.nodeId)}: ${t(e.message)}`);}}}));
  if(ticket!==version||!active())return;loading=false;
  if(quiet)results.push(...items.filter(item=>failedJobs.has(`${item.nodeId}/${item.runtime}/${device.value==='all'?(item.origin==='managed'?'group':'all'):scopes[0]}`)&&!results.some(r=>key(r)===key(item))));
  items=[...new Map(results.map(item=>[key(item),item])).values()].sort((a,b)=>String(b.modifiedAt||b.createdAt||'').localeCompare(String(a.modifiedAt||a.createdAt||''))||key(a).localeCompare(key(b)));
  note.textContent=errors.length?[t('Some devices could not be read.'),...new Set(errors)].join(' '):t(partial?'Showing recent sessions. Updates automatically.':items.length?'':'No sessions in this filter. Create one using the top-right button.');
  if(selected){const next=items.find(item=>key(item)===key(selected));if(next){selected={...selected,...next};if(quiet&&!dialog.open)void read(selected,{quiet:true});}else resetDetail();}renderList();
  // A mutation/focus refresh arriving during a read must run after that older snapshot settles.
  if(pendingRefresh)void load({quiet:true});
 }
 /** History scrolls above a persistent footer, so quiet refreshes never discard a takeover draft. */
 const scroll=el('div','native-session-scroll');
 async function read(item,{quiet=false}={}){const ticket=++detailVersion;selected=item;renderList();if(!quiet){onPreview?.();takeover.detach();scroll.replaceChildren(el('p','workspace-note',t('Loading…')));content.replaceChildren(scroll);detailSignature='';}
  try{const id=nativeId(item),readable=id&&item.hasHistory!==false,value=readable?{...item,...await api(`${endpoint(item.nodeId)}?${new URLSearchParams({runtime:item.runtime,sessionId:id})}`),id:item.id,entryId:item.entryId,nodeId:item.nodeId,sessionId:id,title:item.title}:item;if(ticket!==detailVersion||!active()||key(selected)!==key(item))return;selected=value;const signature=JSON.stringify(value);if(quiet&&signature===detailSignature)return;detailSignature=signature;const top=scroll.scrollTop,atBottom=scroll.scrollHeight-scroll.scrollTop-scroll.clientHeight<40;
   const history=el('div','native-history');history.append(el('h2','native-title',value.title||value.id));
   for(const m of value.messages||[]){const row=chatRow(m.role,m.text,value.runtime,m.timestamp);row.dataset.role=m.role;if(m.role==='user')row.dataset.text=m.text.trim();history.append(row);}
   if(value.notice||!value.messages?.length)history.append(el('p','workspace-note',t(value.notice||(value.canReopen?'This session has not started. Open it to begin chatting.':!readable?'Native session ID has not been linked yet. Existing history is unchanged.':'No text preview is available for this session.'))));
   if(value.partial)history.append(el('p','workspace-note',t('Only recent readable content is shown. Full history is available in the CLI.')));
   const historyAt=Date.now();scroll.replaceChildren(history,takeover.feed);if(!content.contains(scroll))content.replaceChildren(scroll);
   takeover.attach(value,{readable,historyAt,history});
   renderSide(value,id,readable);
   if(quiet&&!atBottom)scroll.scrollTop=top;else scroll.scrollTop=scroll.scrollHeight;
  }catch(e){if(ticket===detailVersion){if(quiet)note.textContent=t(e.message);else{scroll.replaceChildren(el('p','global-error',t(e.message)));content.replaceChildren(scroll);}}}
 }
 /** Same row/bubble structure as the group chat, so both views share one visual language. */
 function chatRow(role,text,runtime,at,extra){const agent=role!=='user',row=el('article',`chat-row ${agent?'agent':'human'} native-chat-row`);if(agent){const avatar=el('span','chat-avatar');avatar.append(agentIconEl(runtime));row.append(avatar);}
  const col=el('div','chat-col'),header=el('div','chat-message-header'),name=el('div','chat-name',agent?names[runtime]||t('Assistant'):t('Me'));name.translate=false;header.append(name);if(at){const stamp=el('time','',time(at));stamp.dateTime=at;header.append(stamp);}col.append(header);
  const bubble=el('div','chat-bubble'),body=simplifiedCliOutput(text||'');if(agent){const md=renderMarkdown(body);md.classList?.add('markdown-body');bubble.append(md);}else bubble.append(el('div','chat-message-text',body));if(extra)bubble.append(extra);col.append(bubble);row.append(col);return row;}
 function renderSide(value,id,readable){
  side.replaceChildren();const head=el('div','native-side-head'),title=el('h2','native-side-title',t('Session details')),badge=el('span',`native-side-badge ${takeover.isOn(value)?'is-live':''}`,t(takeover.isOn(value)?'Taken over':'Read-only'));head.append(title,badge);side.append(head);
  const card=(heading,rows)=>{const section=el('section','native-side-card');section.append(el('h3','',t(heading)));const list=el('dl','native-session-meta');for(const[label,text,copy]of rows){const term=el('dt','',t(label)),data=el('dd','');const valueText=el('span','native-meta-value',text);valueText.translate=false;data.append(valueText);if(copy){const b=button('',async()=>{try{await navigator.clipboard.writeText(copy);b.classList.add('is-copied');b.title=t('Copied');setTimeout(()=>{b.classList.remove('is-copied');b.title=t('Copy');},1500);}catch{}},'icon-button native-copy');b.title=t('Copy');b.setAttribute('aria-label',t('Copy {label}',{label:t(label)}));b.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>';data.append(b);data.classList.add('has-copy');}list.append(term,data);}section.append(list);side.append(section);};
  const agentLine=el('span','native-agent-line');agentLine.append(agentIconEl(value.runtime),el('span','',names[value.runtime]||value.runtime));
  card('Runtime',[['Device',workerName(value.nodeId)],['Agent tool',names[value.runtime]]]);
  side.querySelector('.native-side-card:last-of-type dd:nth-of-type(2) .native-meta-value')?.replaceChildren(agentLine);
  card('Native session',[['Session ID',id||t('Not available yet'),id||null],['Working folder',value.workspace||t('Choose a folder when opening'),value.workspace||null]]);
  const actions=el('section','native-side-card native-side-actions');actions.append(el('h3','',t('Continue')));
  actions.append(el('p','native-side-hint',t(takeover.isOn(value)?'Messages sent below resume this exact native session on its device.':'Read-only preview. Take over at the bottom to continue here, or open iTerm.')));
  if(value.canReopen)actions.append(button('Open unstarted session',()=>openForm(value),'primary'));else if(readable&&value.canResume!==false)actions.append(button('Continue in iTerm',()=>openForm(value),'secondary native-side-button'));
  side.append(actions);
 }
 const takeover=createTakeover();
 const IMAGE_CLIS=new Set(['codex','claude']),openTools=new Set();
 const phaseLabel=turn=>turn.status==='queued'?'Waiting for the device…':turn.status==='stopping'?'Stopping…':turn.phase==='starting'||turn.status==='starting'?'Starting the CLI…':turn.phase==='tool'?'Running a tool':turn.phase==='waiting'||turn.status==='waiting_user'?'Waiting':turn.phase==='replying'?'Replying…':turn.phase==='working'?'Working…':'Thinking…';
 const valueText=value=>typeof value==='string'?value:value==null?'':JSON.stringify(value,null,2);
 /** The group-chat live-scene projection orders text, messages, logs and merged tool states for one turn. */
 function processBlock(turn,{open=false}={}){
  const model=liveSceneRows(turn.events||[],{status:turn.status}),tools=model.rows.filter(r=>r.kind==='tool').length,live=['queued','starting','running','waiting_user','stopping'].includes(turn.status);
  const box=el('details','native-turn-process');box.open=open;box.dataset.turn=turn.id;
  const summary=el('summary','');summary.append(el('span','native-process-title',t('Run process')),el('span','native-process-count',t('{count} tool calls',{count:tools})));
  if(live)summary.append(el('span','native-process-phase',`${t(phaseLabel(turn))}${turn.phase==='tool'&&turn.toolName?` · ${turn.toolName}`:''}`));
  box.append(summary);const body=el('div','native-process-body');
  for(const row of model.rows){
   if(row.kind==='tool'){const item=row.item,card=el('details',`live-scene-event is-tool native-process-tool is-${item.status||'call'}`);card.dataset.key=row.key;const openKey=`${turn.id}:${row.key}`;card.open=openTools.has(openKey);card.addEventListener('toggle',()=>card.open?openTools.add(openKey):openTools.delete(openKey));
    const head=el('summary','');const name=el('span','live-scene-tool-name',valueText(item.name||item.command||item.tool||item.title||item.type||t('Tool')).slice(0,160));name.translate=false;head.append(name,el('span','live-scene-tool-state',t(toolStatusLabel(item,turn.status))));card.append(head);
    for(const[label,value]of[['Arguments',item.input??item.arguments??item.parameters],['Changes',item.changes],['Output',item.aggregatedOutput??item.output??item.results??item.result],['Error',item.error]]){if(value===undefined||value===null||value==='')continue;card.append(el('h4','',t(label)),el('pre','',stripAnsi(valueText(value))));}
    if(item.exitCode!=null)card.append(el('small','',t('Exit code {exitCode}',{exitCode:item.exitCode})));body.append(card);}
   else{const card=el('section',`live-scene-event is-${row.kind}`);card.append(el('header','',t(row.kind==='log'||row.kind==='error'?'Runtime event':'Agent output')));card.append(el('pre','',row.kind==='text'||row.kind==='message'?simplifiedCliOutput(stripAnsi(row.text)):stripAnsi(row.text)));body.append(card);}
  }
  if(!model.rows.length)body.append(el('p','live-scene-empty',t('Waiting for recorded execution events…')));
  box.append(body);return box;
 }
 /** Takeover reuses the group-chat composer behaviour: Enter sends, Shift+Enter breaks lines, paste/drag/attach uploads files, an unconfirmed send retries the same message ID. */
 function createTakeover(){
  const on=new Set(JSON.parse(sessionStorage.getItem('agent-workbench.native-takeover')||'[]')),drafts=JSON.parse(sessionStorage.getItem('agent-workbench.native-takeover-drafts')||'{}');
  const save=()=>{try{sessionStorage.setItem('agent-workbench.native-takeover',JSON.stringify([...on]));sessionStorage.setItem('agent-workbench.native-takeover-drafts',JSON.stringify(drafts));}catch{}};
  const feed=el('div','native-takeover-feed'),shell=el('div','chat-composer-shell native-session-footer'),urls=new Map(),openProcesses=new Set();
  let current=null,turns=[],poll=null,sending=false,historyAt=0,historyEl=null,supported=true,fetchTicket=0,uploads=0,residentState='closed',message='';
  const k=()=>current?`${current.nodeId}/${current.runtime}/${current.sessionId}`:'';
  const isOn=value=>on.has(`${value.nodeId}/${value.runtime}/${value.sessionId}`);
  const activeTurn=()=>turns.find(x=>['queued','starting','running','waiting_user','stopping'].includes(x.status));
  const turnsUrl=()=>`${endpoint(current.nodeId)}/turns`;
  const draft=()=>drafts[k()]||={text:'',attachments:[]};
  const fileUrl=(nodeId,item)=>{const id=`${nodeId}:${item.id}`;if(!urls.has(id))urls.set(id,api(`${endpoint(nodeId)}/attachments/${encodeURIComponent(item.id)}`,{blob:true}).then(blob=>URL.createObjectURL(blob)).catch(e=>{urls.delete(id);throw e;}));return urls.get(id);};
  function attachmentCard(item,remove){const card=el('div',`attachment-card${item.mime?.startsWith('image/')?'':' attachment-file-card'}`);card.title=item.name;
   if(item.mime?.startsWith('image/')){const img=el('img');img.alt=item.name;void fileUrl(current.nodeId,item).then(url=>{img.src=url;}).catch(()=>{});card.append(img);}else card.append(el('span','attachment-name',item.name));
   if(remove){const x=button('×',remove,'attachment-remove');x.setAttribute('aria-label',t('Remove attachment'));card.append(x);}return card;}
  function detach(){current=null;turns=[];historyEl=null;feed.replaceChildren();shell.remove();clearInterval(poll);poll=null;}
  function attach(value,{readable,historyAt:at,history}){const same=current&&k()===`${value.nodeId}/${value.runtime}/${value.sessionId}`;current=value;historyAt=at;historyEl=history;if(!same){turns=[];feed.replaceChildren();}
   const worker=getData().workers?.find(w=>w.id===value.nodeId);supported=worker?.capabilities?.nativeTurns===2;
   const eligible=readable&&value.canResume!==false&&!value.canReopen&&Boolean(value.workspace);
   if(!eligible){shell.remove();return;}
   content.append(shell);render();void refresh();
  }
  /** Turns already in native history keep their process next to the matching reply; others render as their own rows. */
  function renderFeed(){feed.replaceChildren();for(const old of historyEl?.querySelectorAll('.native-turn-process')||[])old.remove();
   const rows=[...(historyEl?.querySelectorAll('.native-chat-row')||[])],used=new Set();
   for(const turn of turns){
    const live=['queued','starting','running','waiting_user','stopping'].includes(turn.status);
    if(turn.status==='succeeded'&&Date.parse(turn.endedAt||0)<=historyAt&&turn.prompt.trim()){
     const index=rows.findIndex((row,i)=>!used.has(i)&&row.dataset.role==='user'&&row.dataset.text===turn.prompt.trim());
     if(index>=0){used.add(index);let anchor=rows[index];for(let i=index+1;i<rows.length&&rows[i].dataset.role!=='user';i++)anchor=rows[i];const block=processBlock(turn,{open:openProcesses.has(turn.id)});block.addEventListener('toggle',()=>block.open?openProcesses.add(turn.id):openProcesses.delete(turn.id));anchor.after(block);continue;}
    }
    let files=null;if(turn.attachments?.length){files=el('div','chat-attachments native-turn-files');for(const item of turn.attachments)files.append(attachmentCard(item));}
    feed.append(chatRow('user',turn.prompt,current.runtime,turn.createdAt,files));
    const meta=el('div','native-turn-state');
    if(live){const dots=el('span','native-turn-live');dots.setAttribute('aria-hidden','true');meta.append(dots,el('span','',`${t(phaseLabel(turn))}${turn.phase==='tool'&&turn.toolName?` · ${turn.toolName}`:''}`),button('Stop',()=>stop(turn),'secondary compact'));}
    else if(turn.status!=='succeeded')meta.append(el('span','native-turn-error',`${t(turn.status==='interrupted'?'Interrupted':'Failed')}${turn.error?` · ${t(turn.error)}`:''}`));
    const extra=el('div','native-turn-extra');const block=processBlock(turn,{open:live||openProcesses.has(turn.id)});block.addEventListener('toggle',()=>{if(!live)block.open?openProcesses.add(turn.id):openProcesses.delete(turn.id);});
    if(turn.events?.length||live)extra.append(block);if(meta.childElementCount)extra.append(meta);
    feed.append(chatRow('assistant',turn.text||'',current.runtime,null,extra));
   }}
  function render(){
   if(!current)return;const value=current,taken=isOn(value);shell.replaceChildren();renderFeed();
   if(!taken){const bar=el('div','native-takeover-bar');const copy=el('div','native-takeover-copy');copy.append(el('strong','',t('Read-only preview')),el('span','',t(supported?'Take over to keep chatting in this exact native session here.':'Upgrade this Worker to take over native sessions')));const b=button('Take over session',()=>{on.add(k());save();render();renderSide(value,value.sessionId,true);input.focus();},'primary native-takeover-button');b.disabled=!supported;bar.append(copy,b);shell.append(bar);return;}
   const d=draft(),busy=Boolean(activeTurn());
   const form=el('form','chat-composer native-takeover-form'),barRow=el('div','chat-input-bar'),field=el('div','chat-input-field'),note=el('p','workspace-note native-takeover-note'),tray=el('div','chat-attachments native-takeover-tray');
   input.placeholder=t('Message {tool}; replies continue this native session',{tool:names[value.runtime]||value.runtime});if(input.value!==d.text)input.value=d.text||'';
   note.textContent=message||(d.pending?t('Sending is not yet confirmed; clicking Send retries the same message without dispatching twice.'):'');note.hidden=!note.textContent;
   for(const item of d.attachments||[])tray.append(attachmentCard(item,()=>{if(d.pending)return;d.attachments=d.attachments.filter(a=>a.id!==item.id);save();render();}));
   if(uploads)tray.append(el('span','attachment-uploading',t('Uploading attachments…')));tray.hidden=!tray.childElementCount;
   sendButton.disabled=sending||busy||uploads>0;sendButton.textContent=t(sending?'Sending…':d.pending?'Retry send':'Send');input.disabled=sending;attachButton.disabled=sending||Boolean(d.pending);
   field.append(tray,attachButton,input);barRow.append(field,sendButton);
   const release=button('End takeover',()=>void endTakeover(value),'secondary compact native-release');release.disabled=busy;
   const status=el('div','native-takeover-status');status.append(el('span',`native-takeover-dot${residentState==='open'?' is-resident':''}`),el('span','',t(busy?'This session is replying…':residentState==='open'?'Taken over · CLI is resident; messages continue this native session':'Taken over · the next message starts the CLI')),release);
   if(!IMAGE_CLIS.has(value.runtime))status.append(el('span','native-takeover-limit',t('{tool} cannot receive images here; files are passed as paths',{tool:names[value.runtime]})));
   form.append(status,note,barRow);form.addEventListener('submit',e=>{e.preventDefault();void submit();});shell.append(form);resize();
  }
  async function endTakeover(value){on.delete(k());save();try{await api(`${endpoint(value.nodeId)}/takeover/release`,{method:'POST',json:{runtime:value.runtime,sessionId:value.sessionId}});}catch(error){message=t(error.message);}residentState='closed';render();renderSide(value,value.sessionId,true);}
  const input=el('textarea');input.rows=1;input.setAttribute('aria-label',t('Chat message'));
  const sendButton=el('button','primary',t('Send'));sendButton.type='submit';
  const fileInput=el('input');fileInput.type='file';fileInput.multiple=true;fileInput.hidden=true;document.body.append(fileInput);
  const attachButton=el('button','native-attach');attachButton.type='button';attachButton.title=t('Upload an image or file');attachButton.setAttribute('aria-label',t('Upload file'));attachButton.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m8 12 6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l8-8M7 13l7-7"/></svg>';
  attachButton.addEventListener('click',()=>fileInput.click());fileInput.addEventListener('change',()=>{void upload(fileInput.files);fileInput.value='';});
  /** Same limits as the group chat: at most 6 files per message, 20 MB each; images only for CLIs with image input. */
  async function upload(list){if(!current||sending)return;const id=k(),nodeId=current.nodeId,runtime=current.runtime,d=draft(),files=[...list];if(d.pending)return;message='';
   if((d.attachments?.length||0)+uploads+files.length>6){message=t('At most 6 attachments per message');render();return;}
   if(files.some(f=>!f.size||f.size>20*1024*1024)){message=t('Attachments cannot be empty; each file is limited to 20 MB');render();return;}
   if(!IMAGE_CLIS.has(runtime)&&files.some(f=>f.type.startsWith('image/'))){message=t('{tool} cannot receive images here; files are passed as paths',{tool:names[runtime]});render();return;}
   uploads+=files.length;render();
   for(const file of files){try{const item=await api(`${endpoint(nodeId)}/attachments`,{method:'POST',body:file,headers:{'Content-Type':'application/octet-stream','X-File-Name':encodeURIComponent(file.name||'pasted-image.png')}});if(!IMAGE_CLIS.has(runtime)&&item.mime.startsWith('image/'))throw Error('This CLI cannot receive images in a takeover; send files or use iTerm');(d.attachments||=[]).push({id:item.id,name:item.name,mime:item.mime,size:item.size});save();}catch(error){message=t(error.message);}finally{uploads--;if(k()===id)render();}}}
  input.addEventListener('paste',e=>{const files=[...(e.clipboardData?.files||[])];if(files.length){e.preventDefault();void upload(files);}});
  shell.addEventListener('dragover',e=>{if(e.dataTransfer?.types.includes('Files')){e.preventDefault();shell.classList.add('is-dragging');}});
  shell.addEventListener('dragleave',()=>shell.classList.remove('is-dragging'));
  shell.addEventListener('drop',e=>{shell.classList.remove('is-dragging');if(e.dataTransfer?.files.length&&current&&isOn(current)){e.preventDefault();void upload(e.dataTransfer.files);}});
  const resize=()=>{input.style.height='auto';input.style.height=`${Math.min(120,Math.max(40,input.scrollHeight))}px`;};
  input.addEventListener('input',()=>{draft().text=input.value;save();resize();});
  input.addEventListener('keydown',e=>{if(window.matchMedia('(max-width: 1000px)').matches)return;if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&!sendButton.disabled){e.preventDefault();input.form?.requestSubmit();}});
  async function submit(){if(!current||sending||activeTurn()||uploads)return;const id=k(),d=draft();if(!d.pending&&!input.value.trim()&&!d.attachments?.length)return;message='';
   d.pending||={clientTurnId:crypto.randomUUID(),text:input.value,attachmentIds:(d.attachments||[]).map(a=>a.id)};save();sending=true;render();
   try{const turn=await api(turnsUrl(),{method:'POST',json:{runtime:current.runtime,sessionId:current.sessionId,...d.pending}});drafts[id]={text:'',attachments:[]};input.value='';if(k()===id)turns=[...turns.filter(x=>x.id!==turn.id),turn];}
   catch(error){if(!error.isNetworkError)delete d.pending;message=t(error.message);}
   finally{sending=false;save();if(k()===id){render();schedule();scroll.scrollTop=scroll.scrollHeight;}}}
  async function stop(turn){try{const next=await api(`${turnsUrl()}/${encodeURIComponent(turn.id)}/stop`,{method:'POST',json:{}});turns=turns.map(x=>x.id===next.id?next:x);render();}catch(error){message=t(error.message);render();}}
  async function refresh(){if(!current)return;const ticket=++fetchTicket,id=k();try{const result=await api(`${turnsUrl()}?${new URLSearchParams({runtime:current.runtime,sessionId:current.sessionId})}`);if(ticket!==fetchTicket||k()!==id)return;const wasActive=Boolean(activeTurn()),bottom=scroll.scrollHeight-scroll.scrollTop-scroll.clientHeight<80;supported=result.supported!==false;residentState=result.process||'closed';turns=result.items||[];render();if(wasActive&&!activeTurn()&&selected)void read(selected,{quiet:true});schedule();if(bottom)scroll.scrollTop=scroll.scrollHeight;}catch(error){message=t(error.message);}}
  function schedule(){clearInterval(poll);poll=null;if(current&&activeTurn())poll=setInterval(()=>{if(!document.hidden)void refresh();},1000);}
  return {feed,attach,detach,isOn,refresh};
 }
 const dialog=el('dialog','settings-edit-dialog native-session-dialog');dialog.id='native-session-dialog';document.body.append(dialog);
 const picker=el('dialog','settings-edit-dialog native-file-picker');picker.id='native-file-picker';document.body.append(picker);let pickerVersion=0;
 /** Metadata-only browsing: selecting a file returns its parent folder, never its contents or a CLI prompt. */
 function openFilePicker({nodeId,path,locked,onUse}){
  picker.replaceChildren();const heading=el('div','dialog-heading');heading.append(el('h2','',t('Select file or folder')),closeButton(()=>picker.close()));
  const toolbar=el('div','native-picker-toolbar'),location=el('div','native-picker-path'),rows=el('div','native-picker-list'),message=el('p','native-picker-note'),selection=el('div','native-picker-selection'),actions=el('div','native-picker-actions');let current=null,chosen=null,parent=null,nextOffset=0;
  location.translate=false;selection.translate=false;message.setAttribute('role','status');
  const use=button('Use',()=>{if(!chosen||locked&&chosen.workspace!==locked)return;onUse(chosen.workspace);picker.close();},'primary');
  const select=item=>{chosen=item;selection.textContent=item?.path||'';use.disabled=!item||Boolean(locked&&item.workspace!==locked);message.textContent=t(locked&&item?.workspace!==locked?'An existing session keeps its original working folder.':item?.type==='file'?'Only the containing folder is used; the file is not read.':'Select an item, then choose Use.');for(const row of rows.querySelectorAll('[data-path]'))row.setAttribute('aria-pressed',String(row.dataset.path===item?.path));};
  const up=button('Parent folder',()=>browse(parent)),roots=button('Allowed folders',()=>browse(null)),more=button('Load more',()=>browse(current,nextOffset,true));toolbar.append(up,roots);more.hidden=true;
  async function browse(target,offset=0,append=false){const ticket=++pickerVersion;use.disabled=true;more.disabled=true;message.textContent=t('Loading…');if(!append)rows.replaceChildren();
   try{const result=await api(`${endpoint(nodeId)}/folders?${new URLSearchParams({...target?{path:target}:{},offset:String(offset)})}`);if(ticket!==pickerVersion||!picker.open)return;current=result.path;parent=result.parent;up.disabled=!parent;location.textContent=current||t('Allowed folders');nextOffset=result.nextOffset||0;more.hidden=!result.hasMore;
    for(const item of result.entries||(result.folders||[]).map(f=>({...f,type:'folder',workspace:f.path}))){const row=el('div','native-picker-row'),pick=button('',()=>select(item),'native-picker-item');pick.dataset.path=item.path;pick.setAttribute('aria-label',t('Select {name}',{name:item.name}));const icon=el('span','native-picker-glyph');icon.setAttribute('aria-hidden','true');icon.innerHTML=item.type==='folder'?'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 6h7l2 3h9v11H3Z"/></svg>':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M6 3h8l4 4v14H6Z"/><path d="M14 3v5h4M9 12h6m-6 4h6"/></svg>';const name=el('span','',item.name);name.translate=false;pick.append(icon,name);pick.title=item.path;row.append(pick);
     if(item.type==='folder'){pick.addEventListener('dblclick',()=>browse(item.path));const enter=button('›',()=>browse(item.path),'icon-button native-picker-enter');enter.setAttribute('aria-label',t('Open folder {name}',{name:item.name}));row.append(enter);}rows.append(row);
    }select(append&&chosen?chosen:current?{path:current,workspace:current,type:'folder'}:null);
   }catch(error){if(ticket===pickerVersion){chosen=null;message.textContent=t(error.message);use.disabled=true;}}finally{if(ticket===pickerVersion)more.disabled=false;}
  }
  actions.append(button('Cancel',()=>picker.close()),use);picker.append(heading,toolbar,location,rows,more,selection,message,actions);
  const closeWithParent=()=>picker.close();dialog.addEventListener('close',closeWithParent);picker.addEventListener('close',()=>{pickerVersion++;dialog.removeEventListener('close',closeWithParent);},{once:true});picker.showModal();void browse(path||null);
 }
 function openForm(session=null,defaults={}){populate();dialog.replaceChildren();const heading=el('div','dialog-heading');heading.append(el('h2','',t(session?.canReopen?'Open unstarted session':session?'Continue native session':'New native session')),closeButton(()=>dialog.close()));dialog.append(heading);
  const form=el('form','native-session-form'),d=el('select'),r=el('select'),folder=el('input'),all=el('input'),title=el('input');d.required=r.required=folder.required=title.required=true;title.type='text';title.maxLength=120;title.placeholder=t('Give this session a title');title.value=session?.title||'';title.readOnly=Boolean(session);folder.type='text';folder.value=session?.workspace||'';folder.placeholder=t('Select a working folder');all.type='checkbox';all.id='native-allow-all';all.checked=false;
  const field=(label,input,full=false)=>{const l=el('label',`native-field${full?' native-full':''}`,t(label));input.setAttribute('aria-label',t(label));l.append(input);form.append(l);return l;};
  options(d,(getData().workers||[]).map(w=>[w.id,`${w.name||w.id}${w.online?'':` · ${t('Offline')}`}`]));if(session?.nodeId)d.value=session.nodeId;else if(defaults.nodeId)d.value=defaults.nodeId;else if(workers()[0])d.value=workers()[0].id;
  const updateTools=()=>{options(r,(getData().workers?.find(w=>w.id===d.value)?.runtimes||[]).filter(x=>x.available&&x.supported!==false&&names[x.type]).map(x=>[x.type,names[x.type]]));};updateTools();if(session?.runtime)r.value=session.runtime;else if(defaults.runtime)r.value=defaults.runtime;else if(tool.value!=='all'&&[...r.options].some(o=>o.value===tool.value))r.value=tool.value;d.disabled=r.disabled=Boolean(session);if(session?.workspace)folder.readOnly=true;
  field('Session title',title,true);field('Device',d);field('Agent tool',r);const folderField=field('Working folder',folder,true),pathRow=el('div','native-workspace-row');
  const feedback=el('p','native-form-feedback native-full'),launch=el('div','native-launch-result native-full');feedback.setAttribute('role','status');
  const browseButton=button('Select file or folder',()=>openFilePicker({nodeId:d.value,path:folder.value,locked:session?.workspace||null,onUse:path=>{folder.value=path;folder.dispatchEvent(new Event('change',{bubbles:true}));}}));pathRow.append(folder,browseButton);folderField.append(pathRow);
  if(session?.workspace)form.append(el('p','workspace-note native-full',t('An existing session keeps its original working folder.')));
  const permissions=el('label','native-permissions native-full');permissions.append(all,el('span','',t('Allow all operations (bypass native permission prompts)')));form.append(permissions,el('p','workspace-note native-full',t('Default uses native permissions. A related group chat waits while this terminal owns its folder; closing the CLI returns it automatically.')));
  const submit=el('button','primary',t('Prepare iTerm launch')),actions=el('div','native-session-actions native-full');submit.type='submit';actions.append(submit);form.append(feedback,actions,launch);dialog.append(form);
  d.addEventListener('change',()=>{updateTools();folder.value='';launch.replaceChildren();});
  let operationId=null,lastInput='',prepared=null,opened=false;
  const releaseUnused=async()=>{if(!prepared||opened)return;const previous=prepared;prepared=null;operationId=null;lastInput='';await api(`/api/native-sessions/${encodeURIComponent(previous.nodeId)}/terminal`,{method:'POST',json:{action:'release',operationId:previous.operationId}});};
  const discard=()=>{launch.replaceChildren();submit.disabled=true;return releaseUnused().catch(error=>{feedback.textContent=t(error.message);}).finally(()=>{submit.disabled=false;});};
  for(const input of[d,r,folder,all,title])input.addEventListener('change',discard);
  dialog.addEventListener('close',()=>{void discard().then(()=>load({quiet:true}));},{once:true});
  form.addEventListener('submit',async e=>{e.preventDefault();if(!title.value.trim()){title.focus();feedback.textContent=t('Enter a session title.');return;}submit.disabled=true;for(const input of[d,r,folder,all,title,browseButton])input.disabled=true;feedback.textContent=t('Preparing…');launch.replaceChildren();
   const input={runtime:r.value,sessionId:session&&!session.canReopen?nativeId(session):null,...(session?.entryId?{entryId:session.entryId}:{}),title:title.value.trim(),workspace:folder.value.trim(),allowAll:all.checked,useLocalSshKey:true},signature=JSON.stringify([d.value,input]);if(signature!==lastInput){operationId=crypto.randomUUID();lastInput=signature;}
   try{const result=await api(`/api/native-sessions/${encodeURIComponent(d.value)}/terminal`,{method:'POST',json:{...input,operationId}});prepared={nodeId:d.value,operationId};opened=false;if(!dialog.open||!dialog.contains(form)){await releaseUnused();return;}feedback.textContent=t('Ready. Open iTerm to start or resume the native CLI.');const a=el('a','primary',t('Open iTerm'));a.href=result.url;a.addEventListener('click',()=>{opened=true;});launch.append(a,button('Copy terminal command',async()=>{await navigator.clipboard.writeText(result.command);opened=true;feedback.textContent=t('Copied');}));void load({quiet:true});}catch(error){feedback.textContent=t(error.message);}finally{submit.disabled=false;d.disabled=r.disabled=Boolean(session);folder.disabled=all.disabled=title.disabled=browseButton.disabled=false;}
  });dialog.showModal();
 }
 /** Segmented buttons share one mode transition; selecting the active side does not reload history. */
 const switches=[...mode.querySelectorAll('button[data-mode]')];
 function selectMode(value){if(!['groups','sessions'].includes(value)||value===modeValue)return;modeValue=value;for(const control of switches)control.setAttribute('aria-pressed',String(control.dataset.mode===value));document.body.dataset.navigationMode=value;if(active())populate();else{version++;detailVersion++;loading=pendingRefresh=false;dialog.close();}onModeChange();if(active())void load();}
 for(const control of switches)control.addEventListener('click',()=>selectMode(control.dataset.mode));
 mode.addEventListener('keydown',event=>{const index=event.key==='ArrowLeft'||event.key==='Home'?0:event.key==='ArrowRight'||event.key==='End'?1:null;if(index===null)return;event.preventDefault();switches[index].focus();selectMode(switches[index].dataset.mode);});
 device.addEventListener('change',()=>load());tool.addEventListener('change',()=>load());
 const refresh=()=>{if(active()&&!document.hidden&&!dialog.open&&document.body.dataset.workspaceView!=='settings')void load({quiet:true});};
 window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);
 // Only the visible Sessions page polls; returning from iTerm also refreshes immediately.
 setInterval(()=>{if(Date.now()-lastRefresh>=30000)refresh();},30000);
 list.hidden=filters.hidden=note.hidden=content.hidden=side.hidden=true;
 return {active,openNew:(defaults={})=>openForm(null,defaults),sync(){const changed=populate(),visible=active();list.hidden=filters.hidden=note.hidden=side.hidden=!visible;content.hidden=!visible||document.body.dataset.workspaceView==='settings';if(visible&&document.body.dataset.workspaceView!=='settings'){document.querySelector('#workspace-title').textContent=t('Native sessions');document.querySelector('#show-project-form').setAttribute('aria-label',t('New native session'));if(changed)refresh();}else document.querySelector('#show-project-form').setAttribute('aria-label',t('New project'));},refresh};
}
