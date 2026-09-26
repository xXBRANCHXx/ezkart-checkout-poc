(() => {
  'use strict';
  const root=document.querySelector('[data-marketing]');if(!root)return;
  const account=document.body.dataset.adminReviewAccount,store=root.dataset.store,csrf=document.body.dataset.adminCsrfToken;
  const q=s=>root.querySelector(s),form=q('[data-marketing-form]'),field=name=>form.elements.namedItem(name);
  const clone=value=>JSON.parse(JSON.stringify(value)),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);return n;};
  const button=(label,run)=>{const b=el('button',label);b.type='button';b.className='ui-button';b.addEventListener('click',run);return b;};
  const random=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,'0')).join('');
  const filterKeys=['q','activity','minSpend','minOrders','maxOrders','lastFrom','lastTo','location','tag'];
  const valueKeys=['name','subject','preheader','heading','body','buttonLabel','plannedAt','audience','archived'];
  const limits={name:120,subject:160,preheader:200,heading:160,body:6000,buttonLabel:60};
  const labels={name:'Campaign name',subject:'Email subject',preheader:'Inbox preview text',heading:'Email heading',body:'Email message',buttonLabel:'Store button label',plannedAt:'Planned date and time',archived:'Archived',
    'audience.q':'Customer search','audience.activity':'Customer group','audience.minSpend':'Minimum customer value','audience.minOrders':'Minimum orders','audience.maxOrders':'Maximum orders','audience.lastFrom':'Last order from','audience.lastTo':'Last order through','audience.location':'Delivery location','audience.tag':'Customer tag'};
  const permission={granted:'Permission recorded',withdrawn:'Permission withdrawn',not_recorded:'No permission recorded'};
  const campaignId=id=>typeof id==='string'&&/^cmp_[a-f0-9]{32}$/.test(id);
  const iso=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
  const exactKeys=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k));
  const validValues=v=>exactKeys(v,valueKeys)&&Object.entries(limits).every(([k,max])=>typeof v[k]==='string'&&v[k].length<=max)
    &&typeof v.archived==='boolean'&&(v.plannedAt===null||iso(v.plannedAt))&&exactKeys(v.audience,filterKeys)
    &&filterKeys.every(k=>typeof v.audience[k]==='string'&&v.audience[k].length<=(k==='q'?120:k==='location'?100:32))
    &&['all','high_value','one_order','repeat','no_paid'].includes(v.audience.activity);
  const validRow=row=>campaignId(row?.id)&&Number.isSafeInteger(row.revision)&&row.revision>=1&&validValues(row.values)&&iso(row.createdAt)&&iso(row.updatedAt);
  const empty=()=>({name:'',subject:'',preheader:'',heading:'',body:'',buttonLabel:'Explore the store',plannedAt:null,audience:Object.fromEntries(filterKeys.map(k=>[k,k==='activity'?'all':''])),archived:false});
  const normalize=v=>({...Object.fromEntries(Object.keys(limits).map(k=>[k,v[k].replaceAll('\r\n','\n').trim()])),plannedAt:v.plannedAt,
    audience:Object.fromEntries(filterKeys.map(k=>[k,k==='tag'?v.audience[k].trim().normalize('NFC').toLowerCase():v.audience[k].trim()])),archived:v.archived});
  const flat=v=>Object.fromEntries(valueKeys.flatMap(k=>k==='audience'?filterKeys.map(f=>['audience.'+f,v.audience[f]]):[[k,v[k]]]));
  const put=(values,path,value)=>{const parts=path.split('.');if(parts.length===2)values[parts[0]][parts[1]]=value;else values[path]=value;};
  const states=new Map();let workspace=null,current=null,dead=false,storageGood=true,storageCorrupt=false,storageError='',loaded=false,navVersion=0,loadBusy=false,comparison=null;
  let view='list',listVersion=0,listBusy=false,listItems=[],listCursor=null,listParams=null;
  const preview=q('[data-marketing-preview-dialog]'),compare=q('[data-marketing-comparison]'),audience=q('[data-marketing-audience-dialog]'),history=q('[data-marketing-history-dialog]'),discard=q('[data-marketing-discard-dialog]');
  let audienceView=null,historyView=null,delivery=null,reports=null,performanceReports=null;
  const offset=()=>({'Asia/Jakarta':7,'Asia/Makassar':8,'Asia/Jayapura':9}[workspace.timezone])*3600000;
  const localTime=stamp=>stamp?new Date(Date.parse(stamp)+offset()).toISOString().slice(0,16):'';
  const utcTime=value=>value?new Date(Date.parse(value+'Z')-offset()).toISOString():null;
  const date=value=>value?new Intl.DateTimeFormat('en-GB',{timeZone:workspace.timezone,dateStyle:'medium',timeStyle:'short'}).format(new Date(value)):'Not planned';
  const show=(path,value)=>path==='plannedAt'?date(value):typeof value==='boolean'?(value?'Yes':'No'):value||'Not provided';
  const dirty=s=>!same(s.base,s.draft),storageKey=()=>`ezkart.marketing.v1:${account}:${store}:${workspace.environment}`;
  function stop(message){
    if(dead)return;delivery?.stop();reports?.stop();performanceReports?.stop();dead=true;navVersion++;listVersion++;for(const d of [preview,compare,audience,history,discard])d.close();
    root.replaceChildren(el('p',message));const a=el('a','Reload sign-in');a.href='?page=marketing';root.append(a);
  }
  async function api(path,body){
    const response=await fetch('./?cloud='+encodeURIComponent('/v1/commerce/marketing'+path),{method:body===undefined?'GET':'POST',cache:'no-store',signal:AbortSignal.timeout(20000),
      headers:{Accept:'application/json','Content-Type':'application/json','X-Ezkart-CSRF':csrf,'X-Ezkart-Marketing-Account':account,'X-Ezkart-Marketing-Store':store},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const result=await response.json().catch(()=>({}));
    if([401,403].includes(response.status)||result.code==='marketing_session_changed')stop(result.error||'Your access changed. Reload this page.');
    if(dead||!response.ok||result.ok!==true)throw Object.assign(Error(result.error||'The result was not confirmed. Try again.'),{status:response.status,code:result.code});return result;
  }
  function persist(){
    if(!workspace||dead)return;
    const entries=[...states.values()].filter(s=>dirty(s)||s.pending||!s.id).map(s=>({key:s.key,id:s.id,base:s.base,draft:s.draft,revision:s.revision,pending:s.pending}));
    if(entries.length>50)throw Error('This tab has 50 unfinished drafts. Save existing drafts before starting another.');
    sessionStorage.setItem(storageKey(),JSON.stringify({version:1,account,store,environment:workspace.environment,active:current?.key||null,entries}));
  }
  function remember(){
    if(storageCorrupt){controls();return false;}
    try{persist();storageGood=true;storageError='';}catch(error){storageGood=false;storageError=error.message?.startsWith('This tab has')?error.message:'This browser could not preserve your draft and save reference. Allow session storage before saving. Copy any changes before closing this tab.';}
    controls();renderLocal();return storageGood;
  }
  function renderLocal(){
    if(dead)return;const items=q('[data-marketing-local-items]');items.replaceChildren();
    for(const s of states.values())if(dirty(s)||s.pending||!s.id)items.append(button((s.draft.name||'Unnamed campaign')+(s.pending?' · Save needs confirmation':' · Unsaved draft'),()=>void openCampaign(s.key)));
    q('[data-marketing-local]').hidden=!items.children.length;
  }
  function state(key,id,values,revision){return {key,id,base:clone(values),draft:clone(values),revision,pending:null,latest:null,busy:false,error:'',message:''};}
  function restore(){
    const raw=sessionStorage.getItem(storageKey());if(!raw)return null;const old=JSON.parse(raw);
    if(!exactKeys(old,['version','account','store','environment','active','entries'])||old.version!==1||old.account!==account||old.store!==store||old.environment!==workspace.environment
      ||!Array.isArray(old.entries)||old.entries.length>50||old.active!==null&&!/^(cmp_|new_)[a-f0-9]{32}$/.test(old.active))throw Error('The browser draft could not be verified. Keep this tab open and copy your changes before clearing its session storage.');
    for(const entry of old.entries){
      const p=entry?.pending;
      if(!exactKeys(entry,['key','id','base','draft','revision','pending'])||!validValues(entry.base)||!validValues(entry.draft)||!Number.isSafeInteger(entry.revision)||entry.revision<0
        ||entry.id!==null&&!campaignId(entry.id)||!(entry.id?entry.key===entry.id:typeof entry.key==='string'&&/^new_[a-f0-9]{32}$/.test(entry.key))||states.has(entry.key)
        ||(entry.id?entry.revision<1:entry.revision!==0)
        ||p!==null&&(!exactKeys(p,['id','revision','requestKey','values'])||p.id!==entry.id||p.revision!==entry.revision||typeof p.requestKey!=='string'||!/^[a-f0-9]{32}$/.test(p.requestKey)
          ||!validValues(p.values)||!same(p.values,normalize(entry.draft))||!p.values.name))throw Error('The browser draft or pending save could not be verified. Keep this tab open and copy your changes before clearing its session storage.');
      states.set(entry.key,{...state(entry.key,entry.id,entry.base,entry.revision),draft:entry.draft,pending:p});
    }
    if(old.active?.startsWith('new_')&&!states.has(old.active))throw Error('The saved new campaign is missing from this tab.');return old.active;
  }
  function applyRow(s,row){s.id=row.id;s.key=row.id;s.base=clone(row.values);s.draft=clone(row.values);s.revision=row.revision;s.latest=null;s.pending=null;s.error='';}
  function fill(){
    if(!current||dead)return;for(const [path,value] of Object.entries(flat(current.draft))){const input=field(path);if(!input)continue;if(input.type==='checkbox')input.checked=value;else input.value=path==='plannedAt'?localTime(value):value;}
    field('segment').value='';field('archived').disabled=!current.id;q('[data-marketing-editor]').hidden=false;
    q('[data-marketing-editor-title]').textContent=current.id?'Campaign draft':'New campaign';controls();
  }
  function controls(){
    if(dead||!current)return;const s=current,editable=workspace?.canEdit===true;
    const deliveryPending=delivery?.pendingFor(s.id);
    form.querySelector('fieldset').disabled=!editable||s.busy||Boolean(s.pending)||deliveryPending;
    q('[data-marketing-save]').disabled=!editable||s.busy||Boolean(s.pending)||!storageGood||!s.draft.name.trim()||!dirty(s)||deliveryPending;
    q('[data-marketing-save]').textContent=s.latest?'Compare saved changes':'Save draft';
    q('[data-marketing-retry]').hidden=!s.pending;q('[data-marketing-retry]').disabled=s.busy||!storageGood;
    q('[data-marketing-compare-saved]').disabled=!s.id||s.busy||Boolean(s.pending);
    q('[data-marketing-history]').disabled=!s.id;q('[data-marketing-audience]').disabled=!workspace?.audienceAvailable;
    q('[data-marketing-discard-new]').hidden=Boolean(s.id);q('[data-marketing-discard-new]').disabled=s.busy||Boolean(s.pending)||storageCorrupt;
    q('[data-marketing-storage-retry]').hidden=storageGood;
    q('[data-marketing-storage-retry]').textContent=storageCorrupt?'Reload browser drafts':'Check browser storage';
    q('[data-marketing-editor-meta]').textContent=s.id?`Saved version ${s.revision} · ${s.draft.archived?'Archived draft':'Draft'}`:'This draft is kept in this browser tab until you save it.';
    q('[data-marketing-save-status]').textContent=s.busy?'Checking the saved campaign…':s.pending?'A previous save needs confirmation. Retry the original save to check its result.':s.latest?'A newer version is saved. Compare it with your changes before saving.':!editable?'Your role can view campaigns but cannot change them.':s.message||(dirty(s)?'You have unsaved changes.':'Your draft matches the saved version.');
    const error=q('[data-marketing-save-error]');error.textContent=storageError||s.error;error.hidden=!error.textContent;delivery?.update();
  }
  function captureForm(){
    if(!current||current.pending||current.busy||!workspace.canEdit||delivery?.pendingFor(current.id))return;
    const draft=current.draft;for(const path of Object.keys(flat(draft))){const input=field(path);let value=input.type==='checkbox'?input.checked:input.value;
      if(path==='plannedAt')value=input.value===localTime(draft.plannedAt)?draft.plannedAt:utcTime(input.value);put(draft,path,value);}
    current.message='';current.error='';remember();
  }
  form.addEventListener('input',event=>{if(event.target.name!=='segment')captureForm();});
  form.addEventListener('change',event=>{if(event.target.name!=='segment')captureForm();});
  field('segment').addEventListener('change',()=>{const s=workspace.segments.find(s=>s.id===field('segment').value);if(!s||!current||current.pending||current.busy)return;current.draft.audience=clone(s.filters);fill();current.message=`Filters copied from ${s.name}. Save the draft to keep this audience.`;remember();});
  async function openCampaign(id,focus=true){
    const version=++navVersion;closeDialogs();q('[data-marketing-status]').textContent='Opening campaign…';
    try{let s=states.get(id);
      if(id.startsWith('new_')){if(!s)throw Error('This unsaved campaign is no longer in this tab.');}
      else{const row=(await api('/campaigns/'+id)).campaign;if(version!==navVersion||dead)return;if(!validRow(row)||row.id!==id)throw Error('The saved campaign could not be verified.');
        if(!s){s=state(id,id,row.values,row.revision);states.set(id,s);}else if(!s.pending&&!dirty(s))applyRow(s,row);else if(!s.pending&&s.revision!==row.revision)s.latest=row;}
      if(version!==navVersion||dead)return;current=s;fill();remember();delivery?.refresh();q('[data-marketing-status]').textContent='Campaign ready.';
      if(focus){q('[data-marketing-editor-title]').focus();q('[data-marketing-editor]').scrollIntoView({block:'start',behavior:'instant'});}return true;
    }catch(error){if(!dead&&version===navVersion)q('[data-marketing-status]').textContent=error.message;return false;}
  }
  function newCampaign(){
    if(!workspace?.canEdit||dead)return;
    if([...states.values()].filter(s=>dirty(s)||s.pending||!s.id).length>=50){q('[data-marketing-status]').textContent='This tab has 50 unfinished drafts. Save or discard an existing draft before starting another.';return;}
    navVersion++;closeDialogs();const id='new_'+random(),s=state(id,null,empty(),0);states.set(id,s);current=s;fill();remember();
    q('[data-marketing-status]').textContent='New draft ready.';
    q('[data-marketing-editor-title]').focus();q('[data-marketing-editor]').scrollIntoView({block:'start',behavior:'instant'});
  }
  function closeDialogs(){delivery?.close();for(const d of [preview,compare,audience,history,discard])d.close();audienceView=null;historyView=null;comparison=null;}
  q('[data-marketing-close]').addEventListener('click',()=>{navVersion++;closeDialogs();current=null;q('[data-marketing-editor]').hidden=true;remember();q('[data-marketing-new]').focus();});
  root.querySelectorAll('[data-marketing-dialog-close]').forEach(b=>b.addEventListener('click',()=>b.closest('dialog').close()));
  audience.addEventListener('close',()=>{audienceView=null;});history.addEventListener('close',()=>{historyView=null;});compare.addEventListener('close',()=>{comparison=null;});
  q('[data-marketing-new]').addEventListener('click',newCampaign);
  q('[data-marketing-discard-new]').addEventListener('click',()=>{if(current&&!current.id&&!current.pending&&!current.busy&&!storageCorrupt)discard.showModal();});
  q('[data-marketing-confirm-discard]').addEventListener('click',()=>{if(!current||current.id||current.pending||current.busy||storageCorrupt)return;states.delete(current.key);current=null;navVersion++;discard.close();q('[data-marketing-editor]').hidden=true;remember();q('[data-marketing-status]').textContent='The unsaved draft was discarded.';q('[data-marketing-new]').focus();});
  q('[data-marketing-storage-retry]').addEventListener('click',()=>{if(storageCorrupt)location.reload();else remember();});
  function openCompare(s){
    if(dead||s!==current||!s.latest||s.pending)return;comparison={state:s,row:clone(s.latest),values:clone(s.latest.values)};
    const before=flat(s.base),mine=flat(s.draft),saved=flat(s.latest.values),rows=q('[data-marketing-comparison-rows]');rows.replaceChildren();let changes=0;
    q('[data-marketing-comparison-note]').textContent='Review your draft and the latest saved version. Fields you did not edit keep the saved value. Nothing is saved until you apply the comparison and save the draft.';
    for(const path of Object.keys(mine)){
      const a=mine[path]!==before[path],b=saved[path]!==before[path];if(a&&!b)put(comparison.values,path,mine[path]);if(!a&&!b)continue;changes++;
      const row=el('div');row.className='marketing-comparison-row';row.append(el('h3',labels[path]));const cells=el('div');cells.className='marketing-comparison-values';
      for(const [label,value] of [['Your draft',mine[path]],['Latest saved',saved[path]]]){const cell=el('div');cell.append(el('b',label),el('span',show(path,value)));cells.append(cell);}row.append(cells);
      if(a&&b&&mine[path]!==saved[path]){const label=el('label','Use for '+labels[path]),select=el('select');select.name='merge-'+path;select.setAttribute('aria-label','Use for '+labels[path]);select.append(new Option('Latest saved value','saved'),new Option('My draft value','draft'));
        select.addEventListener('change',()=>{if(comparison)put(comparison.values,path,select.value==='draft'?mine[path]:saved[path]);});label.append(select);row.append(label);
      }else row.append(el('small',a?'Your change will be kept.':'The saved change will be kept.'));rows.append(row);
    }
    if(!changes)rows.append(el('p','There are no differences to compare.'));compare.showModal();
  }
  for(const [selector,useMine] of [['[data-marketing-use-merged]',true],['[data-marketing-use-saved]',false]])q(selector).addEventListener('click',()=>{
    if(!comparison)return;const {state:s,row,values}=comparison;if(s!==current||s.pending)return;applyRow(s,row);if(useMine)s.draft=values;compare.close();fill();remember();
  });
  async function reviewSaved(){const s=current;if(!s?.id||s.busy||s.pending)return;s.busy=true;s.error='';controls();try{const row=(await api('/campaigns/'+s.id)).campaign;if(!validRow(row)||row.id!==s.id)throw Error('The saved version could not be verified.');s.latest=row;openCompare(s);}catch(error){s.error=error.message;}finally{s.busy=false;controls();}}
  q('[data-marketing-compare-saved]').addEventListener('click',()=>void reviewSaved());
  async function save(){
    const s=current;if(!s||s.busy||!storageGood||dead||delivery?.pendingFor(s.id))return;
    if(s.latest&&!s.pending){openCompare(s);return;}
    if(!s.pending){if(!workspace.canEdit||!form.reportValidity())return;const values=normalize(s.draft);if(!values.name)return;s.pending={id:s.id,revision:s.revision,requestKey:random(),values};if(!remember())return;}
    const pending=clone(s.pending);s.busy=true;s.error='';controls();
    try{const result=await api('/campaigns',pending),r=result.receipt,row=result.campaign;
      if(r?.requestKey!==pending.requestKey||r.revision!==pending.revision+1||!campaignId(r.id)||pending.id&&r.id!==pending.id||!same(r.values,pending.values)
        ||!validRow(row)||row.id!==r.id||row.revision<r.revision||row.revision===r.revision&&!same(row.values,r.values))throw Error('The save response could not be verified. Retry the original save.');
      const oldKey=s.key;applyRow(s,row);states.delete(oldKey);states.set(s.key,s);s.message=row.revision>r.revision?'Original save confirmed. A newer saved version is shown.':'Campaign draft saved.';
      if(s===current)fill();remember();void refreshLibrary();
    }catch(error){s.error=error.message;
      if(!dead&&error.code==='campaign_revision_conflict'){s.pending=null;remember();try{const row=(await api('/campaigns/'+s.id)).campaign;if(!validRow(row)||row.id!==s.id)throw Error('The saved version could not be verified.');s.latest=row;openCompare(s);}catch(readError){s.error=readError.message;}}
      else if(!dead&&[400,413,415,422].includes(error.status)){s.pending=null;remember();}
    }finally{s.busy=false;controls();}
  }
  form.addEventListener('submit',event=>{event.preventDefault();void save();});q('[data-marketing-retry]').addEventListener('click',()=>void save());
  const html=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  q('[data-marketing-preview]').addEventListener('click',()=>{
    if(!current||dead)return;const v=current.draft;q('[data-marketing-preview-subject]').textContent=v.subject||'No subject yet';
    const body=v.body.split(/\n\s*\n/).map(p=>`<p style="margin:0 0 20px;white-space:pre-wrap;overflow-wrap:anywhere">${html(p)}</p>`).join('');
    preview.querySelector('iframe').srcdoc=`<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"></head><body style="margin:0;background:#f4f6f9;padding:24px 14px;font:15px/1.7 Arial,sans-serif;color:#253346"><div style="max-width:540px;margin:auto;background:white;border-radius:12px;padding:28px;box-sizing:border-box;overflow-wrap:anywhere"><p style="font-size:12px;color:#67778d;margin:0 0 28px">${html(workspace.storeName)}</p>${v.preheader?`<p style="font-size:12px;color:#67778d">${html(v.preheader)}</p>`:''}<h1 style="font-size:26px;line-height:1.3;margin:0 0 22px">${html(v.heading||'Your email heading')}</h1>${body||'<p>Your message will appear here.</p>'}${v.buttonLabel?`<span style="display:inline-block;padding:12px 22px;border-radius:7px;background:#253346;color:white;margin:4px 0 24px">${html(v.buttonLabel)}</span>`:''}<hr style="border:0;border-top:1px solid #e7ecf2;margin:22px 0"><p style="font-size:11px;color:#748196">You are receiving this email because you chose to hear from ${html(workspace.storeName)}.<br><span style="text-decoration:underline">Unsubscribe from promotional emails</span></p></div></body></html>`;
    preview.showModal();
  });
  function params(){const f=q('[data-marketing-filters]'),p=new URLSearchParams({state:f.elements.state.value});if(f.elements.q.value.trim())p.set('q',f.elements.q.value.trim());if(view==='calendar')p.set('month',f.elements.month.value);return p;}
  function renderLibrary(){
    const list=q('[data-marketing-list]');list.replaceChildren();q('[data-marketing-calendar]').hidden=view!=='calendar';list.hidden=view!=='list';
    if(view==='list')for(const row of listItems){const article=el('article');article.className='marketing-campaign-card';const pill=el('span',row.publication?(row.publication.cancelled?'Cancelled':Date.parse(row.publication.scheduledAt)>Date.now()?'Scheduled':'Published')+(row.values.archived?' · Archived':''):row.values.archived?'Archived':row.values.plannedAt?'Planned draft':'Draft');pill.className='marketing-pill'+(row.values.plannedAt&&!row.values.archived?' planned':'');
      article.append(pill,el('h3',row.values.name));const subject=el('p',row.values.subject||'No email subject yet');subject.className='marketing-muted';const plan=el('p',row.publication?'Send time: '+date(row.publication.scheduledAt):row.values.plannedAt?date(row.values.plannedAt):'No date planned');plan.className='marketing-muted';article.append(subject,plan);
      const actions=el('div');actions.className='marketing-actions';actions.append(button(workspace.canEdit?'Edit draft':'View draft',()=>void openCampaign(row.id)));article.append(actions);list.append(article);}
    else renderCalendar();
    q('[data-marketing-more]').hidden=!listCursor;q('[data-marketing-list-status]').textContent=listItems.length?`${listItems.length} ${view==='calendar'?(listItems.length===1?'calendar entry':'calendar entries'):(listItems.length===1?'campaign':'campaigns')} shown${listCursor?' · More available':''}.`:view==='calendar'?'No campaigns match this month.':'No campaigns match. Create a draft to get started.';
  }
  function renderCalendar(){
    const calendar=q('[data-marketing-calendar]');calendar.replaceChildren();const month=listParams?.get('month');if(!/^20\d{2}-(?:0[1-9]|1[0-2])$/.test(month||''))return;
    for(const day of ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']){const n=el('div',day);n.className='marketing-calendar-label';calendar.append(n);}
    const first=new Date(month+'-01T00:00:00Z'),start=first.getTime()-((first.getUTCDay()+6)%7)*86400000,today=localTime(new Date().toISOString()).slice(0,10),groups=new Map();
    for(const row of listItems){const d=localTime(row.publication?.scheduledAt||row.values.plannedAt).slice(0,10);if(!groups.has(d))groups.set(d,[]);groups.get(d).push(row);}
    for(let i=0;i<42;i++){const d=new Date(start+i*86400000),stamp=d.toISOString().slice(0,10),items=groups.get(stamp)||[],cell=el('div');cell.className='marketing-calendar-day'+(stamp.slice(0,7)!==month?' is-outside':'')+(stamp===today?' is-today':'')+(!items.length?' is-empty':'');
      cell.append(el('span',new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',day:'numeric',month:'short'}).format(d)));
      for(const row of items.sort((a,b)=>(a.publication?.scheduledAt||a.values.plannedAt).localeCompare(b.publication?.scheduledAt||b.values.plannedAt))){const b=button(localTime(row.publication?.scheduledAt||row.values.plannedAt).slice(11)+' · '+row.values.name+(row.publication?(row.publication.cancelled?' (cancelled)':' (published)'):'')+(row.values.archived?' (archived)':''),()=>void openCampaign(row.id));b.className='';cell.append(b);}calendar.append(cell);}
  }
  async function loadList(reset=false){
    if(dead||!workspace)return;
    if(!reset&&(listBusy||!listCursor))return;const version=++listVersion;listBusy=true;q('[data-marketing-list-retry]').hidden=true;q('[data-marketing-more]').disabled=true;
    if(reset){listParams=params();listCursor=null;listItems=[];renderLibrary();}const p=new URLSearchParams(listParams);if(listCursor)p.set('cursor',listCursor);
    q('[data-marketing-list-status]').textContent='Loading campaigns…';
    try{const result=await api('/campaigns?'+p);if(dead||version!==listVersion)return;if(!Array.isArray(result.items)||!result.items.every(validRow))throw Error('The campaign list could not be verified.');
      const ids=new Set(listItems.map(x=>x.id));listItems.push(...result.items.filter(r=>!ids.has(r.id)));listCursor=result.nextCursor;renderLibrary();
    }catch(error){if(!dead&&version===listVersion){q('[data-marketing-list-status]').textContent=error.message;q('[data-marketing-list-retry]').hidden=false;}}
    finally{if(!dead&&version===listVersion){listBusy=false;q('[data-marketing-more]').disabled=false;}}
  }
  function meta(data){
    if(data.storeId!==store||!['sandbox','production'].includes(data.environment)||workspace&&data.environment!==workspace.environment)throw Error('The campaign workspace changed. Reload this page.');workspace=data;
    for(const [k,v] of Object.entries({...data.summary,archived:data.summary.total-data.summary.active})){const n=q(`[data-marketing-count="${k}"]`);if(n)n.textContent=String(v);}
    q('[data-marketing-new]').disabled=!data.canEdit;q('[data-marketing-delivery]').textContent=data.deliveryAvailable?'Campaign email delivery is connected.':data.emailServiceConnected?'Campaign email delivery is not connected. You can save and plan drafts.':'Email delivery is not connected yet. You can save drafts and plan your calendar.';
    q('[data-marketing-audience-availability]').textContent=data.audienceAvailable?'Audience previews show current customer records and recorded email permissions.':'Customer audience previews will be available when customer records are connected.';
    q('[data-marketing-timezone]').textContent='Store timezone: '+data.timezone;q('[data-marketing-shop]').href=data.shopUrl;q('[data-marketing-shop-state]').textContent=data.shopEnabled?'':' · Your store is not published yet.';
    const segment=field('segment'),selected=segment.value;segment.replaceChildren(new Option('Choose a saved segment',''));for(const s of data.segments)segment.append(new Option(s.name,s.id));segment.value=selected;delivery?.configure(data);reports?.configure(data);performanceReports?.configure(data);controls();
  }
  async function refreshLibrary(){if(dead)return;try{meta(await api('/workspace'));if(!dead)await loadList(true);}catch(error){if(!dead)q('[data-marketing-status]').textContent=error.message;}}
  async function load(){
    if(loadBusy||dead)return;loadBusy=true;q('[data-marketing-status]').textContent='Loading your campaigns…';
    try{meta(await api('/workspace'));let opened=true;if(!loaded){q('[data-marketing-filters]').elements.month.value=localTime(new Date().toISOString()).slice(0,7);
        let active=null;try{active=restore();}catch(error){storageGood=false;storageCorrupt=true;storageError=error.message||'The browser draft could not be restored.';}loaded=true;renderLocal();
        if(active)opened=await openCampaign(active,false);}
      await loadList(true);if(!dead&&opened)q('[data-marketing-status]').textContent=storageError||'Drafts and your planning calendar are ready.';
    }catch(error){if(!dead)q('[data-marketing-status]').textContent=error.message;}finally{loadBusy=false;}
  }
  q('[data-marketing-refresh]').addEventListener('click',()=>void load());q('[data-marketing-filters]').addEventListener('submit',event=>{event.preventDefault();void loadList(true);});
  q('[data-marketing-more]').addEventListener('click',()=>void loadList());q('[data-marketing-list-retry]').addEventListener('click',()=>void loadList(!listItems.length));
  root.querySelectorAll('[data-marketing-view]').forEach(b=>b.addEventListener('click',()=>{view=b.dataset.marketingView;root.querySelectorAll('[data-marketing-view]').forEach(n=>n.setAttribute('aria-pressed',String(n===b)));q('[data-marketing-month-label]').hidden=view!=='calendar';q('[data-marketing-calendar-note]').hidden=view!=='calendar';void loadList(true);}));
  q('[data-marketing-audience]').addEventListener('click',()=>{if(!current||!workspace.audienceAvailable)return;audienceView={filters:clone(normalize(current.draft).audience),cursor:null,started:false,busy:false};q('[data-marketing-audience-items]').replaceChildren();q('[data-marketing-audience-totals]').replaceChildren();audience.showModal();void loadAudience();});
  async function loadAudience(){
    const v=audienceView;if(!v||v.busy||v.started&&!v.cursor)return;v.busy=true;q('[data-marketing-audience-retry]').hidden=true;q('[data-marketing-audience-more]').disabled=true;q('[data-marketing-audience-status]').textContent='Checking your audience…';
    try{const result=await api('/audience',{filters:v.filters,...(v.cursor?{cursor:v.cursor}:{})});if(dead||audienceView!==v)return;
      const totals=q('[data-marketing-audience-totals]');totals.replaceChildren();for(const [name,label] of [['matching','Matching customers'],['granted','Permission recorded'],['withdrawn','Withdrawn'],['unrecorded','Not recorded']]){const n=el('div');n.append(el('b',result.summary[name]),el('span',label));totals.append(n);}
      const list=q('[data-marketing-audience-items]');for(const item of result.items){const li=el('li');li.append(el('b',item.name||'Customer'),el('span',item.email),el('span',`${item.orders} orders · ${permission[item.permission]}`));list.append(li);}
      v.cursor=result.nextCursor;v.started=true;q('[data-marketing-audience-more]').hidden=!v.cursor;q('[data-marketing-audience-status]').textContent=list.children.length?`${list.children.length} matching customers shown.`:'No customers match these filters.';
    }catch(error){if(!dead&&audienceView===v){q('[data-marketing-audience-status]').textContent=error.message;q('[data-marketing-audience-retry]').hidden=false;}}
    finally{v.busy=false;if(!dead&&audienceView===v)q('[data-marketing-audience-more]').disabled=false;}
  }
  q('[data-marketing-audience-more]').addEventListener('click',()=>void loadAudience());q('[data-marketing-audience-retry]').addEventListener('click',()=>void loadAudience());
  q('[data-marketing-history]').addEventListener('click',()=>{if(!current?.id)return;historyView={id:current.id,cursor:null,started:false,busy:false};q('[data-marketing-history-items]').replaceChildren();history.showModal();void loadHistory();});
  async function loadHistory(){
    const v=historyView;if(!v||v.busy||v.started&&!v.cursor)return;v.busy=true;q('[data-marketing-history-retry]').hidden=true;q('[data-marketing-history-more]').disabled=true;q('[data-marketing-history-status]').textContent='Loading saved changes…';
    try{const result=await api('/campaigns/'+v.id+'/history'+(v.cursor?'?cursor='+encodeURIComponent(v.cursor):''));if(dead||historyView!==v)return;
      const list=q('[data-marketing-history-items]');for(const item of result.items){const li=el('li'),details=el('details');details.append(el('summary',`Version ${item.revision} · ${item.actor==='you'?'You':'Store member'} · ${date(item.createdAt)}`));const dl=el('dl');for(const [path,value] of Object.entries(flat(item.values)))dl.append(el('dt',labels[path]),el('dd',show(path,value)));details.append(dl);li.append(details);list.append(li);}
      v.cursor=result.nextCursor;v.started=true;q('[data-marketing-history-more]').hidden=!v.cursor;q('[data-marketing-history-status]').textContent=`${list.children.length} saved changes shown.`;
    }catch(error){if(!dead&&historyView===v){q('[data-marketing-history-status]').textContent=error.message;q('[data-marketing-history-retry]').hidden=false;}}
    finally{v.busy=false;if(!dead&&historyView===v)q('[data-marketing-history-more]').disabled=false;}
  }
  q('[data-marketing-history-more]').addEventListener('click',()=>void loadHistory());q('[data-marketing-history-retry]').addEventListener('click',()=>void loadHistory());
  window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
  window.addEventListener('beforeunload',event=>{if(!storageGood&&[...states.values()].some(s=>dirty(s)||s.pending)||delivery?.unprotected()||reports?.unprotected()||performanceReports?.unprotected()){event.preventDefault();event.returnValue='';}});
  reports=window.EzkartCampaignReports(root,{account,store,api,iso,exactKeys,alive:()=>!dead,open:openCampaign});
  performanceReports=window.EzkartCampaignReports(root,{account,store,api,iso,exactKeys,alive:()=>!dead,open:openCampaign},true);
  const reportKind=q('[data-campaign-report-kind]');
  function selectReport(){const kind=reportKind.value==='performance'?'performance':'delivery';q('[data-campaign-reports]').hidden=kind!=='delivery';q('[data-campaign-performance]').hidden=kind!=='performance';if(kind==='performance')performanceReports.activate();else reports.activate();}
  reportKind.value=new URLSearchParams(location.search).get('campaign-report')==='performance'?'performance':'delivery';selectReport();
  reportKind.addEventListener('change',()=>{const url=new URL(location.href);url.searchParams.set('campaign-report',reportKind.value);window.history.replaceState({},'',url);selectReport();});
  delivery=window.EzkartCampaignDelivery(root,{account,store,api,iso,exactKeys,validValues,validRow,labels,date,localTime,utcTime,alive:()=>!dead,
    context:()=>current?{id:current.id,revision:current.revision,values:clone(current.base),dirty:dirty(current),saving:current.busy,draftPending:Boolean(current.pending)}:null,
    changed:controls,open:openCampaign,refresh:refreshLibrary,workspace:meta});
  void load();
})();
