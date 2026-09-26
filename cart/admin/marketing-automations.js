window.EzkartMarketingAutomations=(root,options)=>{
  'use strict';
  const host=root.querySelector('[data-automations]'),q=s=>host.querySelector(s),form=q('[data-auto-form]'),field=name=>form.elements.namedItem(name);
  const clone=x=>structuredClone(x),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),key=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('');
  const el=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
  const button=(label,fn)=>{const node=el('button',label);node.type='button';node.className='ui-button';node.addEventListener('click',fn);return node;};
  const filters=['q','activity','minSpend','minOrders','maxOrders','lastFrom','lastTo','location','tag'];
  const limits={name:120,subject:160,preheader:200,heading:160,body:6000,buttonLabel:60};
  const fields=[...Object.keys(limits),'audience','trigger','delayMinutes','cooldownDays'];
  const triggers={welcome:'New email permission',paid:'After a verified payment',expired:'After a checkout expires',winback:'After a period without a purchase'};
  const notes={welcome:'A new permission grant can qualify. Each rule welcomes an account and address at most once.',paid:'Only a verified primary payment qualifies. Refunds or a changed order stop a waiting message.',expired:'The checkout must still be expired without a payment. A later payment stops this follow-up.',winback:'Wait at least one day after a verified purchase. A newer purchase for that account stops the older follow-up.'};
  const labels={name:'Automation name',subject:'Email subject',preheader:'Inbox preview text',heading:'Email heading',body:'Email message',buttonLabel:'Store button label',trigger:'Trigger',delayMinutes:'Wait in minutes',cooldownDays:'Minimum days between messages',
    'audience.q':'Customer search','audience.activity':'Customer group','audience.minSpend':'Minimum customer value','audience.minOrders':'Minimum orders','audience.maxOrders':'Maximum orders','audience.lastFrom':'Last order from','audience.lastTo':'Last order through','audience.location':'Delivery location','audience.tag':'Customer tag'};
  const reasons={paused:'Rule paused or replaced',store_closed:'Store unavailable',access_removed:'Store or customer access changed',preference_off:'Permission withdrawn',consent_changed:'Permission version changed',shop_disabled:'Store button unavailable',order_changed:'Order changed',superseded:'A newer purchase was recorded',audience_changed:'Customer filters no longer match',frequency:'Repeat interval or welcome limit',stale:'Delivery window elapsed',invalid:'Source evidence needs review',cancelled:'Publication cancelled',suppressed:'Email address suppressed',identity_invalid:'Verified account unavailable',address_changed:'Verified email changed',test_recipient:'Outside the TEST recipient list',provider_changed:'Email connection changed',retry_window_expired:'Retry window expired',before_activation:'Before email activation'};
  const actionNames={save:'Save',activate:'Activation',pause:'Pause',archive:'Archive',restore:'Restore'};
  const id=value=>typeof value==='string'&&/^auto_[a-f0-9]{32}$/.test(value),requestKey=value=>typeof value==='string'&&/^[a-f0-9]{32}$/.test(value);
  const validValues=v=>options.exactKeys(v,fields)&&Object.entries(limits).every(([k,n])=>typeof v[k]==='string'&&v[k].length<=n)
    &&Object.hasOwn(triggers,v.trigger)&&Number.isSafeInteger(v.delayMinutes)&&v.delayMinutes>=0&&v.delayMinutes<=525600&&Number.isSafeInteger(v.cooldownDays)&&v.cooldownDays>=1&&v.cooldownDays<=90
    &&options.exactKeys(v.audience,filters)&&filters.every(k=>typeof v.audience[k]==='string'&&v.audience[k].length<=(k==='q'?120:k==='location'?100:32))&&['all','high_value','one_order','repeat','no_paid'].includes(v.audience.activity);
  const validRow=r=>id(r?.id)&&Number.isSafeInteger(r.revision)&&r.revision>=1&&['paused','active','archived'].includes(r.state)&&validValues(r.values)&&options.iso(r.createdAt)&&options.iso(r.updatedAt);
  const empty=()=>({...Object.fromEntries(Object.keys(limits).map(k=>[k,''])),audience:Object.fromEntries(filters.map(k=>[k,k==='activity'?'all':''])),trigger:'welcome',delayMinutes:0,cooldownDays:7});
  const flat=v=>Object.fromEntries(fields.flatMap(k=>k==='audience'?filters.map(f=>['audience.'+f,v.audience[f]]):[[k,v[k]]]));
  const put=(v,k,value)=>k.startsWith('audience.')?v.audience[k.slice(9)]=value:v[k]=value;
  const normal=v=>({...v,...Object.fromEntries(Object.keys(limits).map(k=>[k,v[k].replaceAll('\r\n','\n').trim()])),audience:Object.fromEntries(filters.map(k=>[k,k==='tag'?v.audience[k].trim().normalize('NFC').toLowerCase():v.audience[k].trim()]))});
  const dirty=s=>!s.base||!same(s.base.values,s.draft),path=s=>'/automations/'+s.id;
  const entries=new Map();let workspace=null,current=null,stopped=false,storageGood=true,storageCorrupt=false,started=false,available=false,canEdit=false;
  let nav=0,listVersion=0,listBusy=false,listItems=[],listCursor=null,listParams=null,activity=null,history=null,comparison=null,audience=null,activation=null;
  const alive=()=>!stopped&&options.alive(),storageKey=()=>`ezkart.automations.v1:${options.account}:${options.store}:${workspace.environment}`;
  const date=v=>v?new Intl.DateTimeFormat('en-GB',{timeZone:workspace.timezone,dateStyle:'medium',timeStyle:'short'}).format(new Date(v)):'Not checked yet';
  const stamp=s=>s[0].toUpperCase()+s.slice(1).replaceAll('_',' ');
  const dialogs=['confirm','compare-dialog','audience-dialog','discard-dialog'].map(name=>q('[data-auto-'+name+']'));
  function closeDialogs(){for(const d of dialogs)d.close();comparison=null;audience=null;activation=null;}
  function localList(){
    if(!alive())return;const list=q('[data-auto-local]');list.replaceChildren();
    for(const s of entries.values())if(dirty(s)||s.pending.length)list.append(button((s.draft.name||'Unnamed automation')+(s.pending.length?' · Request needs confirmation':' · Unsaved draft'),()=>void open(s.key)));
    q('[data-auto-recovery]').hidden=!list.children.length;
  }
  function remember(){
    if(!alive()||!workspace)return false;
    try{
      if(storageCorrupt)throw Error('The saved automation drafts could not be verified. Keep this tab open and copy changes before clearing its session storage.');
      const saved=[...entries.values()].filter(s=>dirty(s)||s.pending.length).map(s=>({key:s.key,id:s.id,base:s.base,draft:s.draft,pending:s.pending}));
      sessionStorage.setItem(storageKey(),JSON.stringify({version:1,account:options.account,store:options.store,environment:workspace.environment,active:current?.key||null,entries:saved}));
      storageGood=true;q('[data-auto-storage]').hidden=true;
    }catch(error){storageGood=false;q('[data-auto-storage]').hidden=false;q('[data-auto-storage]').textContent=error.message?.startsWith('The saved automation')?error.message:'This tab could not preserve automation drafts and request references. Enable session storage before saving or activating. Keep this tab open until pending pauses are confirmed.';}
    q('[data-auto-storage-retry]').hidden=storageGood;localList();controls();return storageGood;
  }
  function restore(){
    const raw=sessionStorage.getItem(storageKey());if(!raw)return null;const data=JSON.parse(raw);
    if(!options.exactKeys(data,['version','account','store','environment','active','entries'])||data.version!==1||data.account!==options.account||data.store!==options.store||data.environment!==workspace.environment
      ||!Array.isArray(data.entries)||data.entries.length>20||data.active!==null&&!/^(auto_|new_)[a-f0-9]{32}$/.test(data.active))throw Error('Invalid automation drafts');
    const loaded=new Map();
    for(const e of data.entries){
      if(!options.exactKeys(e,['key','id','base','draft','pending'])||!validValues(e.draft)||e.id!==null&&!id(e.id)||e.base!==null&&(!validRow(e.base)||e.base.id!==e.id)
        ||(e.id?e.key!==e.id||!e.base:!/^new_[a-f0-9]{32}$/.test(e.key)||e.base!==null)||loaded.has(e.key)||!Array.isArray(e.pending)||e.pending.length>3)throw Error('Invalid automation entry');
      for(const p of e.pending){
        if(!options.exactKeys(p,['kind','body'])||!Object.hasOwn(actionNames,p.kind)||!requestKey(p.body?.requestKey)||!Number.isSafeInteger(p.body.revision)||p.body.revision<0
          ||!options.exactKeys(p.body,p.kind==='save'?['id','revision','requestKey','values']:['revision','kind','requestKey'])
          ||p.kind==='save'&&(p.body.id!==e.id||!validValues(p.body.values)||!same(p.body.values,normal(e.draft)))
          ||p.kind!=='save'&&(!e.id||p.body.kind!==p.kind))throw Error('Invalid automation request');
      }
      if(new Set(e.pending.map(p=>p.body.requestKey)).size!==e.pending.length)throw Error('Duplicate automation request');
      loaded.set(e.key,{...e,busy:false,error:'',message:''});
    }
    if(data.active?.startsWith('new_')&&!loaded.has(data.active))throw Error('Missing automation draft');
    for(const [k,v] of loaded)entries.set(k,v);return data.active;
  }
  function accept(s,row,preserve=false){
    const old=s.key;s.id=row.id;s.key=row.id;s.base=clone(row);s.latest=null;if(!preserve)s.draft=clone(row.values);entries.delete(old);entries.set(s.key,s);
  }
  function controls(){
    if(!alive())return;q('[data-auto-new]').disabled=!workspace||!canEdit;
    if(!current)return;const s=current,saved=s.latest||s.base,paused=!saved||saved.state==='paused',pending=s.pending.length>0,editable=canEdit&&paused&&!pending&&!s.busy;
    form.querySelector('fieldset').disabled=!editable;
    q('[data-auto-save]').disabled=!editable||!storageGood||!dirty(s)||!s.draft.name.trim()||Boolean(s.latest&&s.latest.revision!==s.base?.revision);
    q('[data-auto-review]').disabled=!canEdit||!available||!s.id||!paused||dirty(s)||pending||s.busy||!storageGood||Boolean(s.latest&&s.latest.revision!==s.base?.revision);
    q('[data-auto-pause]').hidden=!s.id||saved.state==='archived';q('[data-auto-pause]').disabled=!canEdit||s.busy||s.pending.some(p=>p.kind==='pause');
    q('[data-auto-archive]').hidden=!s.id||!paused;q('[data-auto-archive]').disabled=!canEdit||pending||s.busy||dirty(s)||!storageGood;
    q('[data-auto-restore]').hidden=saved?.state!=='archived';q('[data-auto-restore]').disabled=!canEdit||pending||s.busy||!storageGood;
    q('[data-auto-discard]').hidden=Boolean(s.id);q('[data-auto-discard]').disabled=s.busy||pending||storageCorrupt;
    q('[data-auto-compare]').disabled=!s.id||pending||s.busy;q('[data-auto-audience]').disabled=!workspace.audienceAvailable||s.busy;
    q('[data-auto-meta]').textContent=saved?`${stamp(saved.state)} · Saved version ${saved.revision}`+(s.latest&&s.latest.revision!==s.base.revision?' · Your draft uses an earlier version':''):'New paused draft';
    q('[data-auto-status]').textContent=s.busy?'Checking the automation request…':s.message||(pending?'A request needs confirmation. Retry the original reference.':!canEdit?'Your role can view automations.':!paused?'Pause this rule before editing its message and filters.':dirty(s)?'You have unsaved changes.':'The draft matches the saved version.');
    q('[data-auto-error]').textContent=s.error||'';q('[data-auto-error]').hidden=!s.error;
    const list=q('[data-auto-pending]');list.replaceChildren();for(const p of s.pending){const b=button('Retry original '+actionNames[p.kind].toLowerCase(),()=>void send(s,p));b.disabled=s.busy||(!storageGood&&p.kind!=='pause');list.append(b);}
  }
  function fill(){
    if(!current||!alive())return;const v=current.draft;
    for(const [k,value] of Object.entries(flat(v)))if(field(k))field(k).value=value;
    const unit=v.delayMinutes>0&&v.delayMinutes%1440===0?1440:v.delayMinutes>0&&v.delayMinutes%60===0?60:1;
    field('delayUnit').value=String(unit);field('delayAmount').value=String(v.delayMinutes/unit);field('segment').value='';
    q('[data-auto-trigger-note]').textContent=notes[v.trigger];q('[data-auto-repeat-label]').hidden=v.trigger==='welcome';
    q('[data-auto-editor]').hidden=false;q('#auto-editor-title').textContent=v.name||'New automation';controls();
  }
  function capture(){
    if(!current||current.busy||current.pending.length||!canEdit||current.base&&current.base.state!=='paused')return;
    const v=current.draft;for(const k of Object.keys(limits))v[k]=field(k).value;for(const k of filters)v.audience[k]=field('audience.'+k).value;
    v.trigger=field('trigger').value;v.delayMinutes=Number(field('delayAmount').value)*Number(field('delayUnit').value);v.cooldownDays=Number(field('cooldownDays').value);
    if(!Number.isSafeInteger(v.delayMinutes))v.delayMinutes=0;if(!Number.isSafeInteger(v.cooldownDays)||v.cooldownDays<1)v.cooldownDays=1;
    current.error='';current.message='';q('[data-auto-trigger-note]').textContent=notes[v.trigger];q('[data-auto-repeat-label]').hidden=v.trigger==='welcome';remember();
  }
  form.addEventListener('input',event=>{if(event.target.name!=='segment')capture();});form.addEventListener('change',event=>{if(event.target.name!=='segment')capture();});
  field('trigger').addEventListener('change',()=>{if(current?.draft.trigger==='winback'&&current.draft.delayMinutes<1440){current.draft.delayMinutes=1440;fill();remember();}});
  field('segment').addEventListener('change',()=>{const segment=workspace?.segments.find(s=>s.id===field('segment').value);if(!segment||!current||form.querySelector('fieldset').disabled)return;current.draft.audience=clone(segment.filters);fill();remember();});
  async function open(k,focus=true){
    const version=++nav;closeDialogs();activity=null;history=null;q('[data-auto-results]').hidden=true;
    try{
      let s=entries.get(k),detail=null;
      if(id(k)){detail=await options.api('/automations/'+k);if(!alive()||version!==nav)return;if(!validRow(detail.automation)||detail.automation.id!==k)throw Error('The saved automation could not be verified.');
        if(!s){s={key:k,id:k,base:clone(detail.automation),draft:clone(detail.automation.values),pending:[],busy:false,error:'',message:''};entries.set(k,s);}else if(!dirty(s)&&!s.pending.length)accept(s,detail.automation);else s.latest=detail.automation;}
      if(!s)throw Error('This draft is no longer in this tab.');if(!alive()||version!==nav)return;current=s;fill();remember();if(detail)showResults(detail,s);
      if(focus){q('#auto-editor-title').focus();q('[data-auto-editor]').scrollIntoView({block:'start',behavior:'instant'});}
    }catch(error){if(alive()&&version===nav)q('[data-auto-list-status]').textContent=error.message;}
  }
  q('[data-auto-new]').addEventListener('click',()=>{
    if(!canEdit||!alive())return;if([...entries.values()].filter(s=>dirty(s)||s.pending.length).length>=20){q('[data-auto-list-status]').textContent='Finish an existing draft before adding another. This tab keeps up to 20 unfinished automations.';return;}
    nav++;closeDialogs();const k='new_'+key();current={key:k,id:null,base:null,draft:empty(),pending:[],busy:false,error:'',message:''};entries.set(k,current);activity=null;history=null;q('[data-auto-results]').hidden=true;fill();remember();q('#auto-editor-title').focus();
  });
  q('[data-auto-close]').addEventListener('click',()=>{nav++;closeDialogs();current=null;activity=null;history=null;q('[data-auto-editor]').hidden=true;remember();q('[data-auto-new]').focus();});
  q('[data-auto-discard]').addEventListener('click',()=>{if(current&&!current.id&&!current.busy&&!current.pending.length&&!storageCorrupt)q('[data-auto-discard-dialog]').showModal();});
  q('[data-auto-discard-close]').addEventListener('click',()=>q('[data-auto-discard-dialog]').close());
  q('[data-auto-discard-go]').addEventListener('click',()=>{if(!current||current.id||current.busy||current.pending.length||storageCorrupt)return;entries.delete(current.key);current=null;nav++;closeDialogs();q('[data-auto-editor]').hidden=true;remember();q('[data-auto-new]').focus();});
  async function send(s,intent){
    if(!alive()||s.busy)return;s.busy=true;s.error='';controls();
    try{
      const data=await options.api(intent.kind==='save'?'/automations':path(s)+'/action',intent.body);if(!alive())return;
      const r=data.receipt,row=data.automation;
      if(!validRow(row)||r?.requestKey!==intent.body.requestKey||r.kind!==intent.kind||r.revision!==intent.body.revision+1||r.id!==row.id||row.revision<r.revision
        ||s.id&&row.id!==s.id||intent.kind==='save'&&!same(r.values,intent.body.values))throw Error('The response could not be verified. Retry the original automation request.');
      const preserve=intent.kind==='save'?!same(row.values,intent.body.values):dirty(s);
      s.pending=s.pending.filter(p=>p!==intent);accept(s,row,preserve);s.message=`${actionNames[intent.kind]} confirmed. Current state: ${row.state}.`;
      if(preserve&&intent.kind==='save')s.message+=' Another version is now saved; review it before saving your copy again.';
      remember();if(current===s)fill();await loadList(true);if(alive()&&current===s)await refreshResults(s);
    }catch(error){
      if(!alive())return;s.error=error.message;
      if([400,404,409,410,413,415,422,429].includes(error.status)){s.pending=s.pending.filter(p=>p!==intent);s.message=error.status===409?'The saved automation changed. Review the saved version before another change.':'';}
      remember();
    }finally{s.busy=false;if(alive()){remember();controls();}}
  }
  function intent(s,kind,revision=s.base?.revision||0){
    if(s.busy||!canEdit||kind!=='pause'&&s.pending.length)return null;
    const p={kind,body:kind==='save'?{id:s.id,revision,requestKey:key(),values:normal(clone(s.draft))}:{revision,kind,requestKey:key()}};s.pending.push(p);
    if(!remember()&&kind!=='pause'){s.pending=s.pending.filter(v=>v!==p);controls();return null;}return p;
  }
  form.addEventListener('submit',event=>{event.preventDefault();if(!current||q('[data-auto-save]').disabled||!form.reportValidity())return;capture();const p=intent(current,'save');if(p)void send(current,p);});
  async function pause(){
    const s=current;if(!s?.id||s.busy||!canEdit||s.pending.some(p=>p.kind==='pause'))return;s.busy=true;controls();
    try{const data=await options.api(path(s));if(!alive())return;if(!validRow(data.automation)||data.automation.id!==s.id)throw Error('The saved automation could not be verified.');
      if(data.automation.state==='archived'){accept(s,data.automation,dirty(s));s.message='The rule is archived and cannot activate.';return;}
      accept(s,data.automation,dirty(s));
      s.busy=false;const p=intent(s,'pause',data.automation.revision);if(p)await send(s,p);
    }catch(error){if(alive())s.error=error.message;}finally{s.busy=false;if(alive()){remember();if(current===s)fill();}}
  }
  q('[data-auto-pause]').addEventListener('click',()=>void pause());
  for(const kind of ['archive','restore'])q('[data-auto-'+kind+']').addEventListener('click',()=>{if(!current||q('[data-auto-'+kind+']').disabled)return;const p=intent(current,kind);if(p)void send(current,p);});
  function messageCopy(parent,values){
    const dl=el('dl');dl.className='marketing-delivery-copy';const all=flat(values);
    for(const k of ['name','trigger','delayMinutes','cooldownDays',...Object.keys(all).filter(k=>!['name','trigger','delayMinutes','cooldownDays'].includes(k))]){
      const v=all[k],display=k==='trigger'?triggers[v]:k==='delayMinutes'?v===0?'After the next processing check':v+' minutes':k==='cooldownDays'&&values.trigger==='welcome'?'Once per contact':v===''?'Not provided':String(v);
      dl.append(el('dt',k==='delayMinutes'?'Wait before sending':labels[k]),el('dd',display));
    }parent.append(dl);
  }
  q('[data-auto-review]').addEventListener('click',()=>{
    if(!current||q('[data-auto-review]').disabled)return;const v=current.base.values;
    if(!v.subject||!v.heading||!v.body){current.error='Save an email subject, heading and message before activation.';controls();return;}
    activation={s:current,revision:current.base.revision};q('[data-auto-confirm-copy]').replaceChildren();messageCopy(q('[data-auto-confirm-copy]'),v);q('[data-auto-confirm]').showModal();
  });
  q('[data-auto-confirm-close]').addEventListener('click',()=>q('[data-auto-confirm]').close());
  q('[data-auto-confirm-go]').addEventListener('click',()=>{const a=activation;if(!a||a.s!==current||a.revision!==current.base.revision||q('[data-auto-review]').disabled)return;q('[data-auto-confirm]').close();activation=null;const p=intent(current,'activate');if(p)void send(current,p);});
  q('[data-auto-compare]').addEventListener('click',()=>void compare());
  async function compare(){
    const s=current;if(!s?.id||s.busy||s.pending.length)return;s.busy=true;controls();
    try{const row=(await options.api(path(s))).automation;if(!alive()||current!==s)return;if(!validRow(row)||row.id!==s.id)throw Error('The saved automation could not be verified.');
      comparison={s,row,values:clone(row.values)};const before=flat(s.base.values),mine=flat(s.draft),saved=flat(row.values),list=q('[data-auto-compare-copy]');list.replaceChildren();
      for(const k of Object.keys(mine)){const a=mine[k]!==before[k],b=saved[k]!==before[k];if(a&&!b)put(comparison.values,k,mine[k]);if(!a&&!b)continue;
        const cell=el('div');cell.className='marketing-comparison-row';cell.append(el('h3',labels[k]),el('p','Your draft: '+String(mine[k])),el('p','Latest saved: '+String(saved[k])));
        if(a&&b&&mine[k]!==saved[k]){const label=el('label','Use for '+labels[k]),select=el('select');select.name='automation-merge-'+k;select.append(new Option('Latest saved value','saved'),new Option('My draft value','draft'));select.addEventListener('change',()=>{if(comparison?.s===s)put(comparison.values,k,select.value==='draft'?mine[k]:saved[k]);});label.append(select);cell.append(label);}list.append(cell);
      }
      if(!list.children.length)list.append(el('p','There are no copy or filter differences. Saved state: '+row.state+'.'));
      q('[data-auto-use-merged]').disabled=row.state!=='paused';q('[data-auto-compare-dialog]').showModal();
    }catch(error){if(alive()&&current===s)s.error=error.message;}finally{s.busy=false;controls();}
  }
  q('[data-auto-compare-close]').addEventListener('click',()=>q('[data-auto-compare-dialog]').close());
  for(const [selector,merged] of [['use-saved',false],['use-merged',true]])q('[data-auto-'+selector+']').addEventListener('click',()=>{const c=comparison;if(!c||c.s!==current||current.pending.length||merged&&c.row.state!=='paused')return;accept(current,c.row);if(merged)current.draft=clone(c.values);q('[data-auto-compare-dialog]').close();comparison=null;fill();remember();void refreshResults(current);});
  async function loadList(reset=false){
    if(!alive()||!workspace||listBusy&&!reset)return;const version=reset?++listVersion:listVersion;
    if(reset){listItems=[];listCursor=null;listParams=new URLSearchParams(new FormData(q('[data-auto-filters]')));}else if(!listCursor)return;
    const params=new URLSearchParams(listParams);if(listCursor)params.set('cursor',listCursor);listBusy=true;q('[data-auto-more]').disabled=true;q('[data-auto-list-status]').textContent='Loading automations…';
    try{const data=await options.api('/automations?'+params);if(!alive()||version!==listVersion)return;
      if(data.storeId!==options.store||data.environment!==workspace.environment||!Array.isArray(data.items)||!data.items.every(validRow))throw Error('The automation list could not be verified.');
      available=data.processingAvailable===true;canEdit=data.canEdit===true;const existing=new Set(listItems.map(r=>r.id));listItems.push(...data.items.filter(r=>!existing.has(r.id)));listCursor=data.nextCursor;
      q('[data-auto-availability]').textContent=available?'New activity can be processed. Pause a rule to stop its waiting messages.':'Automation processing is held. You can prepare paused drafts. Messages already queued remain subject to the campaign sending hold and their rule’s pause state.';
      q('[data-auto-totals]').textContent=`${data.summary.active} active · ${data.summary.paused} paused · ${data.summary.archived} archived`;
      const list=q('[data-auto-list]');list.replaceChildren();for(const row of listItems){const card=el('article');card.className='marketing-campaign-card';const pill=el('span',stamp(row.state));pill.className='marketing-pill';card.append(pill,el('h3',row.values.name),el('p',triggers[row.values.trigger]),el('p','Version '+row.revision+' · '+date(row.updatedAt)),button('Open automation',()=>void open(row.id)));list.append(card);}
      q('[data-auto-list-status]').textContent=listItems.length?`${listItems.length} automations shown.`:'No automations match. Start with a paused draft.';q('[data-auto-more]').hidden=!listCursor;controls();
    }catch(error){if(alive()&&version===listVersion)q('[data-auto-list-status]').textContent=error.message;}finally{if(alive()&&version===listVersion){listBusy=false;q('[data-auto-more]').disabled=false;}}
  }
  q('[data-auto-filters]').addEventListener('submit',event=>{event.preventDefault();void loadList(true);});q('[data-auto-more]').addEventListener('click',()=>void loadList());
  q('[data-auto-refresh]').addEventListener('click',()=>{void loadList(true);if(current?.id)void refreshResults(current);});
  function showResults(data,s){
    if(!alive()||s!==current)return;q('[data-auto-results]').hidden=false;const list=q('[data-auto-summary]');list.replaceChildren();
    for(const [k,label] of Object.entries({enrolled:'Qualifying events',waiting:'Waiting',stopping:'Stopping',published:'Published',submitted:'Submitted',delivered:'Delivered',skipped:'Skipped or cancelled',needsReview:'Needs review'})){
      const card=el('article');card.append(el('span',label),el('strong',String(data.summary[k])));list.append(card);
    }
    q('[data-auto-checked]').textContent='Last completed event scan: '+date(data.lastCheckedAt);const issues=q('[data-auto-issues]');issues.replaceChildren();
    for(const issue of data.processingIssues){const p=el('p',issue.code==='rate_limited'?'The store’s publication limit was reached. Waiting activity is preserved. Next check after '+date(issue.retryAfter)+'.':'This rule needs an operator review. Waiting activity is preserved. Next check after '+date(issue.retryAfter)+'.');p.className='marketing-error';issues.append(p);}
    void loadActivity(true);if(q('[data-auto-history]').open)void loadHistory(true);
  }
  async function refreshResults(s){
    try{const data=await options.api(path(s));if(!alive()||current!==s)return;if(!validRow(data.automation)||data.automation.id!==s.id)throw Error('The saved automation could not be verified.');
      available=data.processingAvailable===true;if(!dirty(s)&&!s.pending.length){accept(s,data.automation);fill();remember();}else{s.latest=data.automation;controls();}showResults(data,s);
    }catch(error){if(alive()&&current===s){s.error=error.message;controls();}}
  }
  async function loadActivity(reset=false){
    const s=current;if(!s?.id||!alive())return;if(reset){activity={id:s.id,filter:q('[data-auto-activity-filter]').value,cursor:null,busy:false};q('[data-auto-activity]').replaceChildren();}
    const v=activity;if(!v||v.id!==s.id||v.busy||!reset&&!v.cursor)return;v.busy=true;q('[data-auto-activity-more]').disabled=true;
    try{const params=new URLSearchParams({status:v.filter});if(v.cursor)params.set('cursor',v.cursor);const data=await options.api(path(s)+'/activity?'+params);if(!alive()||v!==activity||current!==s)return;
      const list=q('[data-auto-activity]');for(const row of data.items){const li=el('li');li.append(el('strong',row.name||row.email),el('span',row.email),el('span',stamp(row.state)+(row.needsReview?' · Needs review':'')),el('small','Rule version '+row.ruleRevision+' · Due '+date(row.dueAt)));
        if(row.reason)li.append(el('span',reasons[row.reason]||'Delivery eligibility changed'));if(row.campaignId)li.append(button('View message',()=>void options.openCampaign(row.campaignId)));list.append(li);}
      v.cursor=data.nextCursor;q('[data-auto-activity-more]').hidden=!v.cursor;q('[data-auto-activity-status]').textContent=list.children.length?list.children.length+' events shown. Outcomes are live; refresh for the latest.':'No qualifying activity in this view.';
    }catch(error){if(alive()&&v===activity)q('[data-auto-activity-status]').textContent=error.message;}finally{v.busy=false;if(alive()&&v===activity)q('[data-auto-activity-more]').disabled=false;}
  }
  q('[data-auto-activity-refresh]').addEventListener('click',()=>{if(current?.id)void refreshResults(current);});q('[data-auto-activity-filter]').addEventListener('change',()=>void loadActivity(true));q('[data-auto-activity-more]').addEventListener('click',()=>void loadActivity());
  async function loadHistory(reset=false){
    const s=current;if(!s?.id||!alive())return;if(reset){history={id:s.id,cursor:null,busy:false};q('[data-auto-history-items]').replaceChildren();}const v=history;if(!v||v.id!==s.id||v.busy||!reset&&!v.cursor)return;v.busy=true;
    try{const data=await options.api(path(s)+'/history'+(v.cursor?'?cursor='+encodeURIComponent(v.cursor):''));if(!alive()||v!==history||current!==s)return;
      const list=q('[data-auto-history-items]');for(const row of data.items){const li=el('li'),details=el('details');details.append(el('summary',`Version ${row.revision} · ${actionNames[row.kind]} · ${stamp(row.state)} · ${date(row.createdAt)}`));messageCopy(details,row.values);li.append(details);list.append(li);}
      v.cursor=data.nextCursor;q('[data-auto-history-more]').hidden=!v.cursor;q('[data-auto-history-status]').textContent=list.children.length+' saved changes shown.';
    }catch(error){if(alive()&&v===history)q('[data-auto-history-status]').textContent=error.message;}finally{v.busy=false;}
  }
  q('[data-auto-history]').addEventListener('toggle',()=>{if(q('[data-auto-history]').open)void loadHistory(true);});q('[data-auto-history-more]').addEventListener('click',()=>void loadHistory());
  q('[data-auto-audience]').addEventListener('click',()=>{if(!current||!workspace.audienceAvailable)return;audience={filters:clone(current.draft.audience),cursor:null,busy:false};q('[data-auto-audience-items]').replaceChildren();q('[data-auto-audience-dialog]').showModal();void loadAudience(true);});
  async function loadAudience(first=false){
    const v=audience;if(!v||v.busy||!first&&!v.cursor)return;v.busy=true;
    try{const data=await options.api('/audience',{filters:v.filters,...(v.cursor?{cursor:v.cursor}:{})});if(!alive()||v!==audience)return;const list=q('[data-auto-audience-items]');
      for(const row of data.items){const li=el('li');li.append(el('strong',row.name||row.email),el('span',row.email),el('small',row.permission==='granted'?'Permission recorded':row.permission==='withdrawn'?'Permission withdrawn':'No permission recorded'));list.append(li);}
      v.cursor=data.nextCursor;q('[data-auto-audience-more]').hidden=!v.cursor;q('[data-auto-audience-status]').textContent=`${data.summary.matching} current matches · ${data.summary.granted} with recorded email permission.`;
    }catch(error){if(alive()&&v===audience)q('[data-auto-audience-status]').textContent=error.message;}finally{v.busy=false;}
  }
  q('[data-auto-audience-more]').addEventListener('click',()=>void loadAudience());q('[data-auto-audience-close]').addEventListener('click',()=>{q('[data-auto-audience-dialog]').close();audience=null;});
  q('[data-auto-storage-retry]').addEventListener('click',()=>{if(storageCorrupt)location.reload();else remember();});
  return {
    configure(data){
      if(!alive())return;if(workspace&&workspace.environment!==data.environment){this.stop();return;}workspace=data;canEdit=data.canEdit===true;
      const select=field('segment');select.replaceChildren(new Option('Choose a saved segment',''));for(const segment of data.segments)select.append(new Option(segment.name,segment.id));
      if(!started){started=true;let active=null;try{active=restore();}catch{storageCorrupt=true;storageGood=false;remember();}const originalNav=nav;void loadList(true).then(()=>{if(alive()&&active&&nav===originalNav)void open(active,false);});localList();}controls();
    },
    open,
    stop(){closeDialogs();stopped=true;nav++;listVersion++;},
    unprotected:()=>!storageGood&&[...entries.values()].some(s=>dirty(s)||s.pending.length)
  };
};
