import {t,dateLocale} from './i18n.js';
import {simplifiedCliOutput} from './output-language.js';
import {agentIconEl} from './role-icons.js';

const names={codex:'Codex',claude:'Claude Code',grok:'Grok',agy:'Agy'};
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
const button=(text,fn,cls='secondary')=>{const n=el('button',cls,t(text));n.type='button';n.addEventListener('click',fn);return n;};

/** The session view only reads native history and prepares terminal links; it never submits a chat turn. */
export function createNativeSessionUI({api,getData,onModeChange,onPreview}){
 const mode=document.querySelector('#navigation-mode'),list=el('nav','project-list native-session-list'),content=el('section','native-session-content panel'),side=el('section','native-session-sidebar');
 list.id='native-session-list';content.id='native-session-content';side.id='native-session-sidebar';
 document.querySelector('#project-list').after(list);document.querySelector('main.workspace').append(content);document.querySelector('#node-sidebar').append(side);
 const filters=el('div','native-session-filters'),device=el('select'),tool=el('select');device.setAttribute('aria-label',t('Session device'));tool.setAttribute('aria-label',t('Agent tool'));filters.append(device,tool,button('Refresh sessions',()=>load()));list.before(filters);
 const note=el('p','workspace-note');list.before(note);note.classList.add('native-session-note');
 let selected=null,items=[],version=0,lastCatalog='',loading=false,modeValue='groups';
 const active=()=>modeValue==='sessions';
 const endpoint=()=>`/api/native-sessions/${encodeURIComponent(device.value)}`;
 function options(select,values){const old=select.value;select.replaceChildren(...values.map(([value,label])=>{const o=el('option','',label);o.value=value;return o;}));if(values.some(([v])=>v===old))select.value=old;}
 function populate(){const workers=getData().workers||[],signature=JSON.stringify(workers.map(w=>[w.id,w.name,w.online,w.runtimes]));if(signature===lastCatalog)return;const oldDevice=device.value,oldTool=tool.value;lastCatalog=signature;options(device,workers.map(w=>[w.id,`${w.name||w.id}${w.online?'':` · ${t('Offline')}`}`]));tools();if(oldDevice&&(device.value!==oldDevice||tool.value!==oldTool)){version++;items=[];resetDetail();renderList();note.textContent=t('Refresh sessions');}}
 function tools(){const w=getData().workers?.find(w=>w.id===device.value);options(tool,(w?.runtimes||[]).filter(r=>r.available&&r.supported!==false&&names[r.type]).map(r=>[r.type,names[r.type]]));}
 function resetDetail(){selected=null;content.replaceChildren(el('div','native-empty',t('Select a native session to view its details.')));side.replaceChildren(el('h2','',t('Session details')),el('p','workspace-note',t('Read-only preview. Continue chatting in iTerm.')));}
 function renderList(){list.replaceChildren();for(const item of items){const b=el('button',`project-item${selected?.id===item.id?' active':''}`);b.type='button';const copy=el('span','project-item-copy');const title=el('strong','',item.title||item.id);title.translate=false;copy.append(title,el('small','',`${names[item.runtime]} · ${new Date(item.modifiedAt).toLocaleString(dateLocale())}`));b.append(agentIconEl(item.runtime),copy);b.addEventListener('click',()=>read(item));list.append(b);}}
 async function load(){const ticket=++version;items=[];resetDetail();renderList();if(!active())return;loading=true;note.textContent=t('Loading native sessions…');
  try{if(!device.value||!tool.value)throw Error(t('No available Agent tool on this device.'));const result=await api(`${endpoint()}?runtime=${encodeURIComponent(tool.value)}`);if(ticket!==version||!active())return;items=result.items||[];note.textContent=t(result.partial?'Showing recent sessions; refresh to discover changes.':items.length?'Native histories stay on their original devices.':'No native sessions found. Use + to start one.');renderList();}catch(e){if(ticket===version)note.textContent=e.message;}finally{if(ticket===version)loading=false;}
 }
 async function read(item){const ticket=++version;selected=item;renderList();onPreview?.();content.replaceChildren(el('p','workspace-note',t('Loading…')));
  try{const value=await api(`${endpoint()}?${new URLSearchParams({runtime:tool.value,sessionId:item.id})}`);if(ticket!==version||!active())return;selected=value;content.replaceChildren();
   content.append(el('h2','native-title',simplifiedCliOutput(value.title||value.id)));
   for(const m of value.messages||[]){const card=el('article',`native-history-message ${m.role}`);card.append(el('strong','',t(m.role==='user'?'User':'Assistant')),el('pre','',simplifiedCliOutput(m.text)));content.append(card);}
   if(value.notice||!value.messages?.length)content.append(el('p','workspace-note',t(value.notice||'No text preview is available for this session.')));
   if(value.partial)content.append(el('p','workspace-note',t('Only recent readable content is shown. Full history is available in the CLI.')));
   side.replaceChildren(el('h2','',t('Session details')));const details=el('dl','native-session-meta');for(const[label,text]of[['Device',device.selectedOptions[0]?.text],['Agent tool',names[value.runtime]],['Session ID',value.id],['Working folder',value.workspace||t('Choose a folder when opening')]]){const term=el('dt','',t(label)),data=el('dd','',text);data.translate=false;details.append(term,data);}side.append(details,el('p','workspace-note',t('Read-only preview. Continue chatting in iTerm.')),button('Continue in iTerm',()=>openForm(value),'primary'));
  }catch(e){if(ticket===version)content.replaceChildren(el('p','global-error',e.message));}
 }
 const dialog=el('dialog','settings-edit-dialog native-session-dialog');dialog.id='native-session-dialog';document.body.append(dialog);
 function openForm(session=null){populate();dialog.replaceChildren();const heading=el('div','dialog-heading'),close=button('Close',()=>dialog.close(),'icon-button');close.dataset.close='';heading.append(el('h2','',t(session?'Continue native session':'New native session')),close);dialog.append(heading);
  const form=el('form','form-grid'),d=el('select'),r=el('select'),folder=el('input'),all=el('input');d.required=r.required=folder.required=true;folder.type='text';folder.value=session?.workspace||'';folder.placeholder=t('Select a working folder');all.type='checkbox';all.id='native-allow-all';all.checked=false;
  const field=(label,input)=>{const l=el('label','',t(label));l.append(input);form.append(l);};
  options(d,(getData().workers||[]).map(w=>[w.id,`${w.name||w.id}${w.online?'':` · ${t('Offline')}`}`]));d.value=device.value;
  const updateTools=()=>{options(r,(getData().workers?.find(w=>w.id===d.value)?.runtimes||[]).filter(x=>x.available&&x.supported!==false&&names[x.type]).map(x=>[x.type,names[x.type]]));};updateTools();r.value=tool.value;d.disabled=r.disabled=Boolean(session);if(session?.workspace)folder.readOnly=true;
  field('Device',d);field('Agent tool',r);field('Working folder',folder);
  const folders=el('div','native-folder-browser'),feedback=el('p','workspace-note'),launch=el('div','native-launch-result');
  const browse=async path=>{try{const result=await api(`/api/native-sessions/${encodeURIComponent(d.value)}/folders?${new URLSearchParams(path?{path}:{})}`);folders.replaceChildren();if(result.parent)folders.append(button('Parent folder',()=>browse(result.parent)));if(result.path)folders.append(button('Use this folder',()=>{folder.value=result.path;folders.replaceChildren();}));for(const item of result.folders||[])folders.append(button(item.name,()=>browse(item.path)));}catch(e){feedback.textContent=e.message;}};
  const browseButton=button('Browse folders',()=>browse(folder.value||null));browseButton.disabled=Boolean(session?.workspace);form.append(browseButton,folders);
  const permissions=el('label','checkbox-row');permissions.append(all,document.createTextNode(t('Allow all operations (bypass native permission prompts)')));form.append(permissions,el('p','workspace-note',t('Default uses native permissions. A related group chat waits while this terminal owns its folder; closing the CLI returns it automatically.')));
  const submit=el('button','primary',t('Prepare iTerm launch'));submit.type='submit';form.append(feedback,submit,launch);dialog.append(form);
  d.addEventListener('change',()=>{updateTools();folder.value='';folders.replaceChildren();launch.replaceChildren();});
  let operationId=null,lastInput='',prepared=null,opened=false;
  const releaseUnused=async()=>{if(!prepared||opened)return;const previous=prepared;prepared=null;operationId=null;lastInput='';await api(`/api/native-sessions/${encodeURIComponent(previous.nodeId)}/terminal`,{method:'POST',json:{action:'release',operationId:previous.operationId}});};
  const discard=()=>{launch.replaceChildren();submit.disabled=true;void releaseUnused().catch(error=>{feedback.textContent=error.message;}).finally(()=>{submit.disabled=false;});};
  for(const input of[d,r,folder,all])input.addEventListener('change',discard);
  dialog.addEventListener('close',discard,{once:true});
  form.addEventListener('submit',async e=>{e.preventDefault();submit.disabled=true;for(const input of[d,r,folder,all,browseButton])input.disabled=true;feedback.textContent=t('Preparing…');launch.replaceChildren();
   const input={runtime:r.value,sessionId:session?.id||null,workspace:folder.value.trim(),allowAll:all.checked,useLocalSshKey:true},signature=JSON.stringify([d.value,input]);if(signature!==lastInput){operationId=crypto.randomUUID();lastInput=signature;}
   try{const result=await api(`/api/native-sessions/${encodeURIComponent(d.value)}/terminal`,{method:'POST',json:{...input,operationId}});prepared={nodeId:d.value,operationId};opened=false;if(!dialog.open||!dialog.contains(form)){await releaseUnused();return;}feedback.textContent=t('Ready. Open iTerm to start or resume the native CLI.');const a=el('a','primary',t('Open iTerm'));a.href=result.url;a.addEventListener('click',()=>{opened=true;});launch.append(a,button('Copy terminal command',async()=>{await navigator.clipboard.writeText(result.command);opened=true;feedback.textContent=t('Copied');}));}catch(error){feedback.textContent=error.message;}finally{submit.disabled=false;d.disabled=r.disabled=Boolean(session);folder.disabled=all.disabled=false;browseButton.disabled=Boolean(session?.workspace);}
  });dialog.showModal();
 }
 /** Segmented buttons share one mode transition; selecting the active side does not reload history. */
 const switches=[...mode.querySelectorAll('button[data-mode]')];
 function selectMode(value){if(!['groups','sessions'].includes(value)||value===modeValue)return;modeValue=value;for(const control of switches)control.setAttribute('aria-pressed',String(control.dataset.mode===value));document.body.dataset.navigationMode=value;onModeChange();if(active()){populate();void load();}else{version++;dialog.close();}}
 for(const control of switches)control.addEventListener('click',()=>selectMode(control.dataset.mode));
 mode.addEventListener('keydown',event=>{const index=event.key==='ArrowLeft'||event.key==='Home'?0:event.key==='ArrowRight'||event.key==='End'?1:null;if(index===null)return;event.preventDefault();switches[index].focus();selectMode(switches[index].dataset.mode);});
 device.addEventListener('change',()=>{tools();void load();});tool.addEventListener('change',()=>load());
 list.hidden=filters.hidden=note.hidden=content.hidden=side.hidden=true;
 return {active,openNew:()=>openForm(),sync(){populate();const visible=active();list.hidden=filters.hidden=note.hidden=side.hidden=!visible;content.hidden=!visible||document.body.dataset.workspaceView==='settings';if(visible&&document.body.dataset.workspaceView!=='settings'){document.querySelector('#workspace-title').textContent=t('Native sessions');document.querySelector('#show-project-form').setAttribute('aria-label',t('New native session'));}else document.querySelector('#show-project-form').setAttribute('aria-label',t('New project'));},refresh:()=>{if(active()&&!loading)void load();}};
}
