(() => {
  'use strict';
  const root=document.querySelector('[data-merchant-settings]');if(!root)return;
  const account=document.body.dataset.adminReviewAccount,store=root.dataset.store,csrf=document.body.dataset.adminCsrfToken;
  const q=s=>root.querySelector(s),copy=value=>JSON.parse(JSON.stringify(value)),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);return n;};
  const key=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,'0')).join('');
  const profileFields=['name','businessType','supportEmail','supportPhone','description','timezone','dateFormat'];
  const groupLabels={payment_confirmed:'Payment confirmed',payment_pending:'Payment pending',payment_failed:'Payment failed or expired',payment_review:'Payment and stock review',shipping:'Shipping updates',returns:'Returns and refunds',messages:'Buyer messages',weekly_activity:'Weekly catalog activity'};
  const fieldLabels={name:'Store name',businessType:'Business type',supportEmail:'Support email',supportPhone:'Support phone',description:'Store description',timezone:'Display timezone',dateFormat:'Date format'};
  const label=path=>fieldLabels[path]||`${groupLabels[path.split('.')[0]]}: ${path.endsWith('.email')?'email':'in-app'}`;
  const flat=values=>Object.fromEntries(Object.entries(values).flatMap(([k,v])=>v&&typeof v==='object'?Object.entries(v).map(([channel,on])=>[k+'.'+channel,on]):[[k,v]]));
  const put=(values,path,value)=>{const [group,channel]=path.split('.');if(channel)values[group][channel]=value;else values[group]=value;};
  const show=value=>typeof value==='boolean'?(value?'On':'Off'):value||'Not provided';
  const states=Object.fromEntries(['profile','notifications'].map(kind=>[kind,{kind,form:q(`[data-settings-form="${kind}"]`),base:null,draft:null,pending:null,latest:null,revision:0,busy:false,ready:true,error:'',message:''}]));
  const compare=q('[data-settings-compare]'),history=q('[data-settings-history-dialog]');
  let data=null,dead=false,comparison=null,historyKind=null,historyCursor=null,historyBusy=false,historyVersion=0,historyStarted=false;
  function storageKey(s){return 'ezkart.settings.v1:'+account+':'+store+':'+s.kind;}
  function persist(s){sessionStorage.setItem(storageKey(s),JSON.stringify({version:1,base:s.base,draft:s.draft,revision:s.revision,pending:s.pending}));}
  function validValues(kind,value){
    if(!value||typeof value!=='object'||Array.isArray(value))return false;
    return kind==='profile'?profileFields.every(k=>typeof value[k]==='string')&&Object.keys(value).length===7:
      Object.keys(value).length===8&&Object.keys(groupLabels).every(k=>typeof value[k]?.inApp==='boolean'&&typeof value[k]?.email==='boolean'&&Object.keys(value[k]).length===2);
  }
  const dirty=s=>s.base&&!same(s.base,s.draft),editable=s=>data&&(s.kind==='profile'?data.canEditProfile:data.canEditNotifications);
  function shutDown(message){
    if(dead)return;dead=true;compare.close();history.close();root.replaceChildren(el('p',message));const link=el('a','Reload sign-in');link.href='?page=settings';root.append(link);
  }
  async function api(path='',body){
    const response=await fetch('./?cloud='+encodeURIComponent('/v1/commerce/settings'+path),{method:body===undefined?'GET':'POST',cache:'no-store',
      headers:{'Accept':'application/json','Content-Type':'application/json','X-Ezkart-CSRF':csrf,'X-Ezkart-Settings-Account':account,'X-Ezkart-Settings-Store':store},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const result=await response.json().catch(()=>({}));
    if(response.status===401||response.status===403||result.code==='settings_session_changed')shutDown(result.error||'Your access changed. Reload this page.');
    if(dead||!response.ok||!result.ok)throw Object.assign(new Error(result.error||'The result was not confirmed. Retry the original save.'),{status:response.status});
    return result;
  }
  function meta(result){
    if(result.storeId!==store||!validValues('profile',result.profile?.values)||!validValues('notifications',result.notifications?.values))throw Error('The saved settings could not be verified. Reload to try again.');
    data=result;window.EzkartAdminFormat.update(result.profile.values);
    document.querySelectorAll('[data-merchant-store-name]').forEach(n=>{n.textContent=result.profile.values.name;n.title=result.profile.values.name;});
    q('[data-settings-plan]').value=result.plan==='advanced'?'Advanced':'Basic';
    q('[data-settings-delivery]').textContent=[result.delivery?.inAppEnabled?'In-app choices apply to your store notifications.':'In-app notification delivery is being set up. Your choices are saved for when it is available.',
      result.delivery?.emailEnabled?'Email choices apply to your verified account email.':'Email delivery is not connected yet. Your email choices will apply when it is available.'].join(' ');
  }
  function fill(s){for(const [name,value] of Object.entries(flat(s.draft))){const n=s.form.elements.namedItem(name);if(!n)continue;if(n.type==='checkbox')n.checked=value;else n.value=value;}}
  function controls(s){
    if(dead)return;
    s.form.querySelector('fieldset').disabled=!data||!editable(s)||s.busy||Boolean(s.pending);
    const save=s.form.querySelector('[data-settings-save]');save.disabled=!editable(s)||s.busy||!s.ready||!dirty(s)||Boolean(s.pending);
    save.textContent=s.latest?'Compare saved changes':s.kind==='profile'?'Save store details':'Save notification preferences';
    const retry=s.form.querySelector('[data-settings-retry]');retry.hidden=!s.pending;retry.disabled=s.busy||!s.ready;
    s.form.querySelector('[data-settings-refresh]').disabled=!data||s.busy||Boolean(s.pending);
    s.form.querySelector('[data-settings-history]').disabled=!data||s.busy;
    s.form.querySelector('[data-settings-form-status]').textContent=s.busy?'Checking saved settings…':s.pending?'A previous save needs confirmation. Retry it to check the result.':s.latest?'Saved settings have changed. Compare them with your draft before saving.':!editable(s)?'You can view store details. Your role cannot change them.':s.message|| (dirty(s)?'You have unsaved changes.':s.revision?'Saved '+window.EzkartAdminFormat.date(data[s.kind].updatedAt):'No changes saved yet.');
    const error=s.form.querySelector('[data-settings-form-error]');error.textContent=s.error;error.hidden=!s.error;
  }
  function remember(s){try{persist(s);}catch{s.ready=false;s.error='This browser could not preserve your save. Allow session storage, or copy your changes before reloading.';}controls(s);}
  function use(s,saved){s.base=copy(saved.values);s.draft=copy(saved.values);s.revision=saved.revision;s.latest=null;s.message='';}
  function restore(s,saved){
    use(s,saved);const raw=sessionStorage.getItem(storageKey(s));if(!raw)return;
    const old=JSON.parse(raw);
    if(old.version!==1||!validValues(s.kind,old.base)||!validValues(s.kind,old.draft)||!Number.isSafeInteger(old.revision)||old.revision<0
      ||old.pending&&(!validValues(s.kind,old.pending.values)||old.pending.kind!==s.kind||old.pending.revision!==old.revision||!/^[a-f0-9]{32}$/.test(old.pending.requestKey)))throw Error('This tab has an unreadable saved draft. Copy any changes you need and clear its session storage before saving.');
    if(old.pending||!same(old.base,old.draft)){
      s.base=old.base;s.draft=old.draft;s.revision=old.revision;s.pending=old.pending||null;
      if(!s.pending&&saved.revision!==s.revision)s.latest=copy(saved);
    }
  }
  async function load(){
    q('[data-settings-load]').hidden=true;q('[data-settings-status]').textContent='Loading saved settings…';
    try{const result=await api();meta(result);for(const s of Object.values(states)){
      try{s.ready=true;s.error='';restore(s,result[s.kind]);persist(s);}catch(error){s.ready=false;s.error=error.message||'This browser could not preserve your changes.';}
      fill(s);controls(s);
    }q('[data-settings-status]').textContent='Store details and personal notification choices save separately.';
    }catch(error){if(!dead){q('[data-settings-status]').textContent=error.message;q('[data-settings-load]').hidden=false;}}
  }
  async function latest(s){const result=await api();meta(result);s.latest=copy(result[s.kind]);return s.latest;}
  function openCompare(s){
    if(dead||!s.latest)return;comparison={state:s,merged:copy(s.latest.values),revision:s.latest.revision};
    const before=flat(s.base),mine=flat(s.draft),saved=flat(s.latest.values),rows=q('[data-settings-comparison]');rows.replaceChildren();
    q('[data-settings-compare-description]').textContent=s.latest.revision===s.revision?'Review your draft against the saved version. Nothing is saved until you use these changes and save the form.':'Someone saved a newer version. Unchanged fields keep the latest saved values. Choose which version to use for conflicting edits.';
    let count=0;
    for(const path of Object.keys(mine)){
      const mineChanged=mine[path]!==before[path],savedChanged=saved[path]!==before[path];
      if(mineChanged&&!savedChanged)put(comparison.merged,path,mine[path]);
      if(!mineChanged&&!savedChanged)continue;count++;
      const row=el('div');row.className='settings-comparison-row';row.append(el('h3',label(path)));const values=el('div');values.className='settings-comparison-values';
      for(const [title,value] of [['Your draft',mine[path]],['Latest saved',saved[path]]]){const cell=el('div');cell.append(el('b',title),el('span',show(value)));values.append(cell);}row.append(values);
      if(mineChanged&&savedChanged&&mine[path]!==saved[path]){
        const l=el('label','Use for '+label(path)),select=el('select');select.name='merge-'+path;select.setAttribute('aria-label','Use for '+label(path));select.append(new Option('Latest saved value','saved'),new Option('My draft value','draft'));
        select.addEventListener('change',()=>put(comparison.merged,path,select.value==='draft'?mine[path]:saved[path]));l.append(select);row.append(l);
      }else row.append(el('small',mineChanged&&!savedChanged?'Your change will be kept.':'The latest saved value will be kept.'));
      rows.append(row);
    }
    if(!count)rows.append(el('p','Your draft already matches the saved settings.'));
    compare.showModal();
  }
  async function review(s){
    if(s.busy||s.pending||dead)return;s.busy=true;s.error='';controls(s);
    try{await latest(s);openCompare(s);}catch(error){if(!dead)s.error=error.message;}finally{s.busy=false;controls(s);}
  }
  async function save(s){
    if(s.busy||!s.ready||dead)return;
    const retry=Boolean(s.pending);s.busy=true;s.error='';s.message='';let sent=false;
    try{
      if(!s.pending){s.pending={kind:s.kind,revision:s.revision,requestKey:key(),values:copy(s.draft)};try{persist(s);}catch{ s.pending=null;s.ready=false;throw Error('This browser could not preserve the save. Allow session storage before saving.');}}
      controls(s);sent=true;const result=await api('',s.pending),receipt=result.receipt;
      if(!receipt||receipt.storeId!==store||receipt.requestKey!==s.pending.requestKey||receipt.kind!==s.kind||receipt.revision!==s.pending.revision+1||!validValues(s.kind,receipt.values)||result[s.kind]?.revision<receipt.revision)throw Error('The server did not confirm this save. Retry the original save to recover it.');
      meta(result);s.pending=null;use(s,result[s.kind]);
      s.message=result[s.kind].revision>receipt.revision?'Your original save was confirmed. Newer saved changes are now shown.':s.kind==='profile'?'Store details saved.':'Notification preferences saved.';
      persist(s);fill(s);
    }catch(error){
      if(dead)return;s.error=error.message;
      if(sent&&!retry&&[400,409,413,415,422,429].includes(error.status)){
        s.pending=null;try{persist(s);}catch{s.ready=false;}
        if(error.status===409)try{await latest(s);openCompare(s);}catch(readError){s.error+=' '+readError.message;}
      }
    }finally{s.busy=false;controls(s);}
  }
  for(const s of Object.values(states)){
    function changed(){
      if(!s.base||s.pending||s.busy)return;
      for(const name of Object.keys(flat(s.draft))){const n=s.form.elements.namedItem(name);put(s.draft,name,n.type==='checkbox'?n.checked:n.value);}
      s.message='';s.error='';remember(s);
    }
    s.form.addEventListener('input',changed);s.form.addEventListener('change',changed);
    s.form.addEventListener('submit',event=>{event.preventDefault();if(!editable(s)||!dirty(s)||s.pending||!s.form.reportValidity())return;if(s.latest)void review(s);else void save(s);});
    s.form.querySelector('[data-settings-retry]').addEventListener('click',()=>void save(s));
    s.form.querySelector('[data-settings-refresh]').addEventListener('click',()=>void review(s));
    s.form.querySelector('[data-settings-history]').addEventListener('click',()=>{historyKind=s.kind;historyCursor=null;historyStarted=false;historyVersion++;q('[data-settings-history-items]').replaceChildren();q('#settings-history-title').textContent=s.kind==='profile'?'Store details history':'My notification preference history';history.showModal();void loadHistory();});
  }
  function applyComparison(useSaved){
    if(!comparison)return;const s=comparison.state,merged=useSaved?s.latest.values:comparison.merged;
    s.base=copy(s.latest.values);s.draft=copy(merged);s.revision=comparison.revision;s.latest=null;s.message=useSaved?'Saved settings loaded.':dirty(s)?'Compared changes are ready. Save this form to apply them.':'Your draft matches the saved settings.';s.error='';
    remember(s);fill(s);compare.close();s.form.querySelector(dirty(s)?'[data-settings-save]':'[data-settings-refresh]').focus();comparison=null;
  }
  q('[data-settings-apply]').addEventListener('click',()=>applyComparison(false));q('[data-settings-use-saved]').addEventListener('click',()=>applyComparison(true));
  root.querySelectorAll('[data-settings-close]').forEach(n=>n.addEventListener('click',()=>n.closest('dialog').close()));
  async function loadHistory(){
    if(historyBusy||dead)return;historyBusy=true;const version=historyVersion,kind=historyKind;
    q('[data-settings-history-more]').disabled=true;q('[data-settings-history-retry]').hidden=true;q('[data-settings-history-status]').textContent='Loading history…';
    try{
      const result=await api('/history?'+new URLSearchParams({kind,...(historyCursor?{cursor:historyCursor}:{})}));
      if(version!==historyVersion||dead)return;const list=q('[data-settings-history-items]');
      for(const item of result.items){const li=el('li'),details=el('details');details.append(el('summary',`Version ${item.revision} · ${item.actor==='you'?'You':'Store member'} · ${window.EzkartAdminFormat.date(item.createdAt)}`));
        const dl=el('dl');for(const [path,value] of Object.entries(flat(item.values)))dl.append(el('dt',label(path)),el('dd',show(value)));details.append(dl);li.append(details);list.append(li);}
      historyCursor=result.nextCursor;historyStarted=true;q('[data-settings-history-more]').hidden=!historyCursor;q('[data-settings-history-status]').textContent=list.children.length?`${list.children.length} saved changes shown.`:'No saved changes yet.';
    }catch(error){if(!dead&&version===historyVersion){q('[data-settings-history-status]').textContent=error.message;q('[data-settings-history-retry]').hidden=false;}}
    finally{historyBusy=false;if(!dead){q('[data-settings-history-more]').disabled=false;if(version!==historyVersion&&history.open)void loadHistory();}}
  }
  q('[data-settings-history-more]').addEventListener('click',()=>{if(historyCursor)void loadHistory();});q('[data-settings-history-retry]').addEventListener('click',()=>{if(!historyStarted||historyCursor)void loadHistory();});
  q('[data-settings-load]').addEventListener('click',()=>void load());
  window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
  window.addEventListener('beforeunload',event=>{if(Object.values(states).some(s=>!s.ready&&dirty(s))){event.preventDefault();event.returnValue='';}});
  void load();
})();
