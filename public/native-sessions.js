import {t,dateLocale} from './i18n.js';
import {simplifiedCliOutput} from './output-language.js';
import {agentIconEl,setActionIcon} from './role-icons.js';

const names={codex:'Codex',claude:'Claude Code',grok:'Grok',agy:'Agy'};
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
const button=(text,fn,cls='secondary')=>{const n=el('button',cls,t(text));n.type='button';n.addEventListener('click',fn);return n;};
const closeButton=fn=>{const n=button('',fn,'icon-button native-close');setActionIcon(n,'close','Close');n.dataset.close='';return n;};

/** The session view only reads native history and prepares terminal links; it never submits a chat turn. */
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
 function populate(){const signature=JSON.stringify((getData().workers||[]).map(w=>[w.id,w.name,w.online,w.nodeKind,w.runtimes?.map(r=>[r.type,r.available,r.supported])]));if(signature===lastCatalog)return false;lastCatalog=signature;options(device,[['created',t('Created sessions')],['group',t('Group chats')],['local',t('Local machine')],['cloud',t('Servers')],['other',t('Other devices')]]);options(tool,[['all',t('All Agents')],...Object.entries(names)]);return true;}
 function workers(){return(getData().workers||[]).filter(w=>['created','group'].includes(device.value)||(device.value==='other'?!['local','cloud'].includes(w.nodeKind):w.nodeKind===device.value));}
 function resetDetail(){detailVersion++;selected=null;detailSignature='';content.replaceChildren(el('div','native-empty',t('Select a native session to view its details.')));side.replaceChildren(el('h2','',t('Session details')),el('p','workspace-note',t('Read-only preview. Continue chatting in iTerm.')));}
 function renderList(){const signature=JSON.stringify([key(selected),items]);if(signature===listSignature)return;listSignature=signature;const scroll=list.scrollTop;list.replaceChildren();for(const item of items){const b=el('button',`project-item${key(selected)===key(item)?' active':''}`);b.type='button';b.title=`${item.title||item.id}\n${workerName(item.nodeId)}`;const copy=el('span','project-item-copy');const title=el('strong','',item.title||item.id);title.translate=false;copy.append(title,el('small','',`${names[item.runtime]} · ${time(item.modifiedAt||item.createdAt)}`));b.append(agentIconEl(item.runtime),copy);b.addEventListener('click',()=>read(item));list.append(b);}list.scrollTop=scroll;}
 /** Fetch at most two device catalogues at a time; one unavailable device must not hide the others. */
 async function load({quiet=false}={}){if(!active())return;if(quiet&&loading){pendingRefresh=true;return;}pendingRefresh=false;const ticket=++version;loading=true;lastRefresh=Date.now();if(!quiet){items=[];resetDetail();renderList();note.textContent=t('Loading native sessions…');}
  const scope=['created','group'].includes(device.value)?device.value:'all',jobs=workers().flatMap(w=>(tool.value==='all'?Object.keys(names):[tool.value]).filter(runtime=>scope==='created'||w.runtimes?.some(r=>r.type===runtime&&r.available&&r.supported!==false)).map(runtime=>({nodeId:w.id,runtime}))),results=[],errors=[],failedJobs=new Set();let partial=false,index=0;
  await Promise.all(Array.from({length:Math.min(2,jobs.length)},async()=>{while(index<jobs.length&&ticket===version&&active()){const job=jobs[index++];try{const result=await api(`${endpoint(job.nodeId)}?${new URLSearchParams({runtime:job.runtime,scope})}`);results.push(...(result.items||[]).map(item=>({...item,nodeId:job.nodeId})));partial||=result.partial===true;}catch(e){failedJobs.add(`${job.nodeId}/${job.runtime}`);errors.push(`${workerName(job.nodeId)}: ${t(e.message)}`);}}}));
  if(ticket!==version||!active())return;loading=false;
  if(quiet)results.push(...items.filter(item=>failedJobs.has(`${item.nodeId}/${item.runtime}`)&&!results.some(r=>key(r)===key(item))));
  items=[...new Map(results.map(item=>[key(item),item])).values()].sort((a,b)=>String(b.modifiedAt||b.createdAt||'').localeCompare(String(a.modifiedAt||a.createdAt||''))||key(a).localeCompare(key(b)));
  note.textContent=errors.length?[t('Some devices could not be read.'),...new Set(errors)].join(' '):t(partial?'Showing recent sessions. Updates automatically.':items.length?'':'No sessions in this filter. Create one using the top-right button.');
  if(selected){const next=items.find(item=>key(item)===key(selected));if(next){selected={...selected,...next};if(quiet&&!dialog.open)void read(selected,{quiet:true});}else resetDetail();}renderList();
  // A mutation/focus refresh arriving during a read must run after that older snapshot settles.
  if(pendingRefresh)void load({quiet:true});
 }
 async function read(item,{quiet=false}={}){const ticket=++detailVersion;selected=item;renderList();if(!quiet){onPreview?.();content.replaceChildren(el('p','workspace-note',t('Loading…')));detailSignature='';}
  try{const id=nativeId(item),readable=id&&item.hasHistory!==false,value=readable?{...item,...await api(`${endpoint(item.nodeId)}?${new URLSearchParams({runtime:item.runtime,sessionId:id})}`),id:item.id,entryId:item.entryId,nodeId:item.nodeId,sessionId:id,title:item.title}:item;if(ticket!==detailVersion||!active()||key(selected)!==key(item))return;selected=value;const signature=JSON.stringify(value);if(quiet&&signature===detailSignature)return;detailSignature=signature;const scroll=content.scrollTop;content.replaceChildren();
   content.append(el('h2','native-title',value.title||value.id));
   for(const m of value.messages||[]){const card=el('article',`native-history-message ${m.role}`);card.append(el('strong','',t(m.role==='user'?'User':'Assistant')),el('pre','',simplifiedCliOutput(m.text)));content.append(card);}
   if(value.notice||!value.messages?.length)content.append(el('p','workspace-note',t(value.notice||(value.canReopen?'This session has not started. Open it to begin chatting.':!readable?'Native session ID has not been linked yet. Existing history is unchanged.':'No text preview is available for this session.'))));
   if(value.partial)content.append(el('p','workspace-note',t('Only recent readable content is shown. Full history is available in the CLI.')));
   side.replaceChildren(el('h2','',t('Session details')));const details=el('dl','native-session-meta');for(const[label,text]of[['Device',workerName(value.nodeId)],['Agent tool',names[value.runtime]],['Session ID',id||t('Not available yet')],['Working folder',value.workspace||t('Choose a folder when opening')]]){const term=el('dt','',t(label)),data=el('dd','',text);data.translate=false;details.append(term,data);}side.append(details,el('p','workspace-note',t('Read-only preview. Continue chatting in iTerm.')));if(value.canReopen)side.append(button('Open unstarted session',()=>openForm(value),'primary'));else if(readable&&value.canResume!==false)side.append(button('Continue in iTerm',()=>openForm(value),'primary'));if(quiet)content.scrollTop=scroll;
  }catch(e){if(ticket===detailVersion){if(quiet)note.textContent=t(e.message);else content.replaceChildren(el('p','global-error',t(e.message)));}}
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
