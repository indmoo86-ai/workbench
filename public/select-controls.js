import {t,onLanguageChange} from './i18n.js';

/** Keep native fields as the form/state authority; one delegated popup also covers dynamically created selects. */
export function installSelectControls(){
  if(!HTMLElement.prototype.showPopover)return;
  let current=null,serial=0;
  const eligible=node=>node instanceof HTMLSelectElement&&!node.multiple&&node.size<=1;
  const usable=select=>select.isConnected&&!select.matches(':disabled')&&select.getClientRects().length&&!select.closest('[hidden]');
  const disabled=option=>option.disabled||option.parentElement?.disabled;
  const element=(tag,cls,text)=>{const el=document.createElement(tag);el.className=cls;if(text!==undefined)el.textContent=text;return el;};
  function close(focus=false){
    const c=current;if(!c)return;current=null;c.observer.disconnect();c.menu.hidePopover();c.menu.remove();c.select.classList.remove('wb-select-open');
    for(const [key,value] of c.attributes)if(value===null)c.select.removeAttribute(key);else c.select.setAttribute(key,value);
    if(focus&&usable(c.select))c.select.focus({preventScroll:true});
  }
  function place(){
    const c=current;if(!c)return;if(!usable(c.select)||c.dialog&&!c.dialog.open){close();return;}
    const rect=c.select.getBoundingClientRect(),viewport=window.visualViewport;
    const left=viewport?.offsetLeft||0,top=viewport?.offsetTop||0,width=viewport?.width||innerWidth,height=viewport?.height||innerHeight;
    if(rect.bottom<top||rect.top>top+height){close();return;}
    const below=top+height-rect.bottom-16,above=rect.top-top-16,up=below<200&&above>below;
    c.menu.style.width=`${Math.min(Math.max(rect.width,200),width-24)}px`;
    c.menu.style.maxHeight=`${Math.max(40,Math.min(360,up?above:below))}px`;
    c.menu.style.left=`${Math.max(left+12,Math.min(rect.left,left+width-c.menu.offsetWidth-12))}px`;
    c.menu.style.top=`${Math.max(top+8,up?rect.top-c.menu.offsetHeight-8:rect.bottom+8)}px`;
  }
  function activate(option,scroll=true){
    const c=current;if(!c)return;c.active=option;
    for(const row of c.list.querySelectorAll('[role=option]'))row.classList.toggle('is-active',row.option===option);
    const row=[...c.list.querySelectorAll('[role=option]')].find(row=>row.option===option);
    for(const target of [c.select,c.search].filter(Boolean)){if(row)target.setAttribute('aria-activedescendant',row.id);else target.removeAttribute('aria-activedescendant');}
    if(scroll)row?.scrollIntoView({block:'nearest'});
  }
  function choose(option){
    const c=current;if(!c||!usable(c.select)||!c.select.contains(option)||disabled(option))return;
    const index=Array.from(c.select.options).indexOf(option),changed=c.select.selectedIndex!==index,select=c.select;
    select.selectedIndex=index;close(true);
    if(changed){select.dispatchEvent(new Event('input',{bubbles:true}));select.dispatchEvent(new Event('change',{bubbles:true}));}
  }
  function render(){
    const c=current;if(!c)return;if(!usable(c.select)){close();return;}
    const query=(c.search?.value||'').trim().toLocaleLowerCase();c.list.replaceChildren();
    c.options=Array.from(c.select.options).filter(option=>!option.hidden&&!option.parentElement.hidden&&(!query||option.label.toLocaleLowerCase().includes(query)));
    let group=null;
    for(const option of c.options){
      const parent=option.parentElement;
      if(parent.tagName==='OPTGROUP'&&parent!==group){c.list.append(element('div','wb-select-group',parent.label));group=parent;}
      const row=element('div','wb-select-option',option.label);row.id=`${c.list.id}-${option.index}`;row.option=option;row.role='option';row.setAttribute('aria-selected',String(option.selected));row.setAttribute('aria-disabled',String(Boolean(disabled(option))));
      if(option.selected)row.append(element('span','wb-select-check','✓'));
      row.addEventListener('pointermove',()=>{if(!disabled(option))activate(option,false);});row.addEventListener('click',()=>choose(option));c.list.append(row);
    }
    if(!c.options.length)c.list.append(element('div','wb-select-empty',t('No matching options')));
    const enabled=c.options.filter(o=>!disabled(o));activate(enabled.includes(c.active)?c.active:enabled.find(o=>o.selected)||enabled[0],false);place();
  }
  function open(select,query=''){
    close();if(!usable(select))return;
    const menu=element('div','wb-select-menu');menu.setAttribute('popover','manual');menu.setAttribute('translate','no');
    // Option rows keep the combobox focused until click commits; pointer scrolling remains native on touch screens.
    menu.addEventListener('mousedown',event=>{if(!(event.target instanceof HTMLInputElement))event.preventDefault();});
    const list=element('div','wb-select-list');list.id=`wb-select-list-${++serial}`;list.role='listbox';
    const label=select.getAttribute('aria-label')||(select.getAttribute('aria-labelledby')||'').split(' ').map(id=>document.getElementById(id)?.textContent||'').join(' ').trim()||[...(select.labels?.[0]?.childNodes||[])].filter(n=>n.nodeType===3).map(n=>n.textContent).join('').trim()||t('Choose an option');list.setAttribute('aria-label',label);
    const attributes=new Map(['aria-expanded','aria-controls','aria-activedescendant'].map(key=>[key,select.getAttribute(key)]));
    const searchable=select.options.length>8||/model/i.test(select.name+' '+select.id),dialog=select.closest('dialog');let search=null;
    if(searchable){search=element('input','wb-select-search');search.type='search';search.placeholder=t('Search options…');search.setAttribute('aria-label',t('Search options…'));search.autocomplete='off';search.role='combobox';search.setAttribute('aria-controls',list.id);search.setAttribute('aria-expanded','true');search.setAttribute('aria-autocomplete','list');search.value=query;search.addEventListener('input',render);menu.append(search);}
    menu.append(list);(dialog||document.body).append(menu);
    // Observe only while open: streaming chat updates must not cause a permanent selector scan or polling loop.
    const observer=new MutationObserver(records=>{if(!current)return;if(!usable(select)||dialog&&!dialog.open){close();return;}if(records.some(r=>r.target===select||select.contains(r.target)))render();else if(records.some(r=>r.target instanceof Element&&r.target.contains(select)))place();});
    current={select,menu,list,search,dialog,attributes,observer,active:null,options:[],typed:query,typedAt:Date.now()};
    select.classList.add('wb-select-open');select.setAttribute('aria-expanded','true');select.setAttribute('aria-controls',list.id);menu.showPopover();render();
    observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['disabled','hidden','selected','label','value','open','style','class']});
    (search||select).focus({preventScroll:true});activate(current?.active);
  }
  document.addEventListener('pointerdown',event=>{
    if(eligible(event.target)&&!event.target.matches(':disabled')){event.preventDefault();event.target.focus({preventScroll:true});return;}
    if(current&&!current.menu.contains(event.target))close();
  },true);
  document.addEventListener('mousedown',event=>{if(eligible(event.target))event.preventDefault();},true);
  document.addEventListener('click',event=>{if(!eligible(event.target)||event.target.matches(':disabled'))return;event.preventDefault();if(current?.select===event.target)close(true);else open(event.target);},true);
  document.addEventListener('keydown',event=>{
    if(event.isComposing||event.keyCode===229)return;
    if(!current){if(!eligible(event.target)||event.target.matches(':disabled'))return;if(['ArrowDown','ArrowUp','Enter',' '].includes(event.key)){event.preventDefault();event.stopPropagation();open(event.target);}return;}
    if(event.target!==current.select&&!current.menu.contains(event.target))return;
    const c=current,enabled=c.options.filter(o=>!disabled(o)),index=enabled.indexOf(c.active);
    if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();close(true);return;}
    if(event.key==='Tab'){close(true);return;}
    if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)&&!(event.target===c.search&&['Home','End'].includes(event.key))){event.preventDefault();event.stopPropagation();const next=event.key==='Home'?0:event.key==='End'?enabled.length-1:Math.max(0,Math.min(enabled.length-1,index+(event.key==='ArrowDown'?1:-1)));activate(enabled[next]);return;}
    if(event.key==='Enter'||event.key===' '&&event.target!==c.search){event.preventDefault();event.stopPropagation();if(c.active)choose(c.active);return;}
    if(event.target===c.select&&event.key.length===1&&!event.ctrlKey&&!event.metaKey&&!event.altKey){event.preventDefault();const at=Date.now();c.typed=(at-c.typedAt<700?c.typed:'')+event.key.toLocaleLowerCase();c.typedAt=at;activate(enabled.find(o=>o.label.toLocaleLowerCase().startsWith(c.typed))||c.active);}
  },true);
  document.addEventListener('focusin',event=>{if(current&&event.target!==current.select&&!current.menu.contains(event.target))close();});
  document.addEventListener('reset',()=>close(),true);
  document.addEventListener('change',event=>{if(current?.select===event.target)render();},true);
  document.addEventListener('scroll',event=>{if(current&&!current.menu.contains(event.target))place();},true);
  window.addEventListener('resize',place);window.visualViewport?.addEventListener('resize',place);window.visualViewport?.addEventListener('scroll',place);
  onLanguageChange(()=>close());
}
