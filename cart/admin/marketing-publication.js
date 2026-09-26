(() => {
  'use strict';
  window.EzkartCampaignDelivery = function(root,host){
    const q=s=>root.querySelector(s),panel=q('[data-campaign-delivery]'),tray=q('[data-campaign-delivery-recovery]');
    const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);return n;};
    const button=(text,run)=>{const b=el('button',text);b.type='button';b.className='ui-button';b.addEventListener('click',run);return b;};
    const clone=x=>JSON.parse(JSON.stringify(x)),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),integer=n=>Number.isSafeInteger(n)&&n>=0;
    const campaignId=x=>typeof x==='string'&&/^cmp_[a-f0-9]{32}$/.test(x),publicationId=x=>typeof x==='string'&&/^cpub_[a-f0-9]{32}$/.test(x);
    const key=x=>typeof x==='string'&&/^[a-f0-9]{32}$/.test(x),random=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');
    const labels={queued:'Queued',sending:'Sending',retry:'Retry scheduled',uncertain:'Submission unconfirmed',needs_review:'Needs review',cancelled:'Cancelled',skipped:'Not sent',submitted:'Submitted',delivered:'Delivered',delayed:'Delivery delayed',failed:'Delivery failed',bounced:'Bounced',complained:'Complaint received',suppressed:'Suppressed'};
    const reasons={before_activation:'Scheduled before delivery was connected',stale:'The scheduled send time has passed',cancelled:'Campaign cancelled',store_closed:'Store unavailable',access_removed:'Store or customer access changed',shop_disabled:'The store button is unavailable',preference_off:'Email permission withdrawn',consent_changed:'Email permission changed after publication',identity_invalid:'Verified account email unavailable',address_changed:'Account email changed',suppressed:'Address blocked by earlier delivery evidence',test_recipient:'Address is outside the TEST recipient list',provider_changed:'Delivery connection changed',retry_window_expired:'The original retry window has ended'};
    const totals={submitted:'Submitted',delivered:'Delivered',skipped:'Not sent',uncertain:'Unconfirmed',failed:'Failed',bounced:'Bounced',complained:'Complaints',suppressed:'Suppressed',delayed:'Delayed',needsReview:'Needs review'};
    const states=new Map();let workspace=null,scope=null,active=null,corrupt=false,storageError='',review=null,listing=null,stopped=false,rendered='';
    const alive=()=>!stopped&&host.alive(),context=()=>host.context();
    const current=()=>active?states.get(active):null;
    const get=id=>{if(!states.has(id))states.set(id,{id,pub:null,loaded:false,reading:false,busy:false,seq:0,pending:null,error:'',message:''});return states.get(id);};
    const validPublication=(p,id)=>p===null||p&&publicationId(p.id)&&p.campaignId===id&&integer(p.campaignRevision)&&p.campaignRevision>=1&&integer(p.revision)
      &&host.validValues(p.values)&&typeof p.storeName==='string'&&p.storeName.length<=160&&['scheduledAt','createdAt','updatedAt'].every(k=>host.iso(p[k]))
      &&typeof p.cancelled==='boolean'&&typeof p.canReschedule==='boolean'&&integer(p.candidateCount)&&p.candidateCount>0
      &&p.summary&&['recipients','queued','cancelled','attention','processing'].every(k=>integer(p.summary[k])&&p.summary[k]<=p.candidateCount)&&p.summary.recipients===p.candidateCount
      &&p.deliverySummary&&Object.keys(totals).every(k=>integer(p.deliverySummary[k])&&p.deliverySummary[k]<=p.candidateCount);
    function validPending(p,id){
      if(!host.exactKeys(p,['kind','body','publicationId','values','name'])||!['publish','reschedule','cancel'].includes(p.kind)||typeof p.name!=='string'||p.name.length>120)return false;
      const b=p.body;if(!b||!key(b.requestKey)||!integer(b.revision)||b.revision>=Number.MAX_SAFE_INTEGER)return false;
      if(p.kind==='publish')return host.exactKeys(b,['revision','requestKey','scheduledAt'])&&b.revision>=1&&p.publicationId===null&&host.validValues(p.values)&&!p.values.archived&&p.values.name===p.name&&(b.scheduledAt===null||host.iso(b.scheduledAt));
      return host.exactKeys(b,['kind','revision','requestKey','scheduledAt'])&&b.kind===p.kind&&publicationId(p.publicationId)&&p.values===null&&(p.kind==='cancel'?b.scheduledAt===null:host.iso(b.scheduledAt));
    }
    function persist(){
      if(!scope||corrupt||!alive())return false;
      try{
        const entries=[...states.values()].filter(s=>s.pending).map(s=>({id:s.id,pending:s.pending}));if(entries.length>50)throw Error('Confirm an existing delivery action before starting another.');
        sessionStorage.setItem(scope,JSON.stringify({version:1,account:host.account,store:host.store,environment:workspace.environment,entries}));storageError='';return true;
      }catch{storageError='This browser cannot preserve delivery actions. Allow session storage, then check storage before continuing.';return false;}
    }
    function restore(){
      try{
        const raw=sessionStorage.getItem(scope);if(raw){const v=JSON.parse(raw);
          if(!host.exactKeys(v,['version','account','store','environment','entries'])||v.version!==1||v.account!==host.account||v.store!==host.store||v.environment!==workspace.environment||!Array.isArray(v.entries)||v.entries.length>50)throw Error();
          const ids=new Set();for(const e of v.entries){if(!host.exactKeys(e,['id','pending'])||!campaignId(e.id)||ids.has(e.id)||!validPending(e.pending,e.id))throw Error();ids.add(e.id);}
          for(const e of v.entries)get(e.id).pending=e.pending;
        }
        persist();
      }catch{corrupt=true;storageError='The saved delivery action could not be verified. Keep this tab open and reload after checking its browser storage. No new delivery action can start.';}
    }
    function notify(){if(!alive())return;render();host.changed();}
    function recovery(){
      tray.replaceChildren();const pending=[...states.values()].filter(s=>s.pending);tray.hidden=!pending.length&&!storageError;if(tray.hidden)return;
      tray.append(el('h2','Delivery actions to confirm'),el('p',storageError||'An earlier action needs confirmation. Open its campaign to retry the original request.'));
      const actions=el('div');actions.className='marketing-actions';
      for(const s of pending)actions.append(button(s.pending.name+' · Confirm '+(s.pending.kind==='publish'?'publication':s.pending.kind==='cancel'?'cancellation':'schedule'),()=>void host.open(s.id)));
      if(storageError)actions.append(button(corrupt?'Reload delivery actions':'Check delivery storage',()=>{if(corrupt)location.reload();else{persist();notify();}}));tray.append(actions);
    }
    panel.innerHTML='<header class="marketing-dialog-heading"><div><h2 id="campaign-delivery-title">Campaign delivery</h2><p data-delivery-status role="status" tabindex="-1"></p></div><button type="button" class="ui-button" data-delivery-refresh>Refresh delivery</button></header><p class="marketing-error" data-delivery-error role="alert" hidden></p><div class="marketing-delivery-totals" data-delivery-totals></div><p class="marketing-muted" data-delivery-note></p><div class="marketing-actions" data-delivery-actions></div><details data-delivery-copy hidden><summary>Published email and audience</summary><div data-delivery-copy-body></div></details>';
    const dialog=el('dialog');dialog.className='marketing-dialog marketing-publication-dialog';dialog.setAttribute('aria-labelledby','campaign-publish-title');
    dialog.innerHTML='<div class="marketing-dialog-heading"><h2 id="campaign-publish-title" data-delivery-review-title></h2><button class="ui-button" type="button" data-delivery-review-close>Keep current campaign</button></div><p data-delivery-review-status role="status"></p><div data-delivery-review-copy></div><form data-delivery-review-form><fieldset data-delivery-time-options><legend>When should this campaign send?</legend><label class="marketing-check"><input type="radio" name="timing" value="now" checked>As soon as it is ready</label><label class="marketing-check"><input type="radio" name="timing" value="later">Schedule for later</label><label data-delivery-time-label hidden>Send date and time<input type="datetime-local" name="scheduledAt" min="2000-01-01T00:00" max="2099-12-31T23:59"><small data-delivery-zone></small></label></fieldset><label class="marketing-check marketing-delivery-confirm"><input type="checkbox" name="confirmed" required><span data-delivery-confirm-label>I have reviewed this email and its audience.</span></label><p class="marketing-error" data-delivery-review-error role="alert" hidden></p><div class="marketing-actions"><button type="submit" class="ui-button primary" data-delivery-confirm disabled>Confirm publication</button></div></form>';
    const listDialog=el('dialog');listDialog.className='marketing-dialog';listDialog.setAttribute('aria-labelledby','campaign-delivery-list-title');
    listDialog.innerHTML='<div class="marketing-dialog-heading"><h2 id="campaign-delivery-list-title"></h2><button type="button" class="ui-button" data-delivery-list-close>Close details</button></div><p class="marketing-muted" data-delivery-list-note></p><p data-delivery-list-status role="status"></p><ol data-delivery-list-items></ol><div class="marketing-actions"><button type="button" class="ui-button" data-delivery-list-more hidden>Load more</button><button type="button" class="ui-button" data-delivery-list-retry hidden>Try details again</button><button type="button" class="ui-button" data-delivery-list-refresh>Refresh details</button></div>';
    root.append(dialog,listDialog);const dq=s=>dialog.querySelector(s),lq=s=>listDialog.querySelector(s),rf=dq('form');
    const path=(s,suffix)=>'/campaigns/'+s.id+'/'+suffix;
    function copy(target,p){
      target.replaceChildren();const v=p.values,dl=el('dl');dl.className='marketing-delivery-copy';
      for(const [name,value] of [['Campaign',v.name],['Store',p.storeName||workspace.storeName],['Subject',v.subject],['Inbox preview',v.preheader],['Heading',v.heading],['Message',v.body],['Store button',v.buttonLabel||'No button']])dl.append(el('dt',name),el('dd',value||'Not provided'));
      const filters=Object.entries(v.audience).filter(([k,value])=>value&&!(k==='activity'&&value==='all')).map(([k,value])=>(host.labels['audience.'+k]||k)+': '+value);
      dl.append(el('dt','Audience'),el('dd',filters.length?filters.join('\n'):'All customers with email permission'));target.append(dl);
    }
    function render(){
      if(!alive()||!workspace)return;recovery();const c=context(),s=current();panel.hidden=!c;if(!c){rendered='';return;}
      // Background workspace reads and typing in a draft must not replace the
      // focused delivery controls or the element a dialog returns focus to.
      const version=JSON.stringify([active,c.dirty,c.saving,c.draftPending,c.values.archived,workspace.canEdit,workspace.deliveryAvailable,workspace.timezone,storageError,s?.pub,s?.loaded,s?.reading,s?.busy,s?.pending,s?.error,s?.message]);
      if(version===rendered)return;rendered=version;
      const actions=q('[data-delivery-actions]'),summary=q('[data-delivery-totals]');actions.replaceChildren();summary.replaceChildren();
      q('[data-delivery-refresh]').disabled=!s||s.reading||s.busy;q('[data-delivery-copy]').hidden=!s?.pub;
      let message='Save this draft to review and publish it.',note='Saving or editing a draft does not send email.';
      if(s){const p=s.pub;
        if(s.pending)message=s.busy?'Confirming the original delivery action…':'An earlier delivery action needs confirmation. Retry the original action before making another change.';
        else if(s.reading)message='Checking campaign delivery…';
        else if(p)message=p.cancelled?'Campaign cancelled.':Date.parse(p.scheduledAt)>Date.now()?'Scheduled for '+host.date(p.scheduledAt)+'.':'Published for '+host.date(p.scheduledAt)+'.';
        else if(s.loaded)message=workspace.deliveryAvailable?'This campaign has not been published.':'Campaign delivery is not connected. You can keep editing this draft.';
        if(s.message&&!s.pending&&!s.reading)message=s.message;
        if(p){
          note='The published email and recipient list are fixed. Draft edits and archiving do not change or cancel this publication. Delivery totals update when refreshed and may overlap later bounces or complaints.';
          const counts=[['Recipients',p.candidateCount],['Queued',p.summary.queued],['Sending',p.summary.processing],['Cancelled',p.summary.cancelled],...Object.entries(totals).map(([k,label])=>[label,p.deliverySummary[k]])];
          for(const [label,n] of counts){if(n===0&&!['Recipients','Queued','Submitted','Delivered'].includes(label))continue;const cell=el('div');cell.append(el('b',n),el('span',label));summary.append(cell);}copy(q('[data-delivery-copy-body]'),p);
          actions.append(button('View recipients',()=>openList('recipients')),button('Delivery history',()=>openList('publication-history')));
          if(workspace.canEdit&&!p.cancelled){const reschedule=button('Change send time',()=>void openReview('reschedule')),cancel=button('Cancel remaining sends',()=>void openReview('cancel'));reschedule.disabled=!p.canReschedule||s.busy||Boolean(s.pending)||Boolean(storageError);cancel.disabled=s.busy||Boolean(s.pending)||Boolean(storageError);actions.append(reschedule,cancel);}
        }else{
          const publish=button('Review and publish',()=>void openReview('publish'));publish.classList.add('primary');publish.disabled=!s.loaded||s.reading||s.busy||Boolean(s.pending)||!workspace.deliveryAvailable||!workspace.canEdit||Boolean(storageError)||c.dirty||c.saving||c.draftPending||c.values.archived;
          actions.append(publish);if(c.dirty||c.draftPending)note='Save and confirm your draft changes before reviewing delivery.';else if(c.values.archived)note='Restore this archived draft before publishing it.';
        }
        if(s.pending){const retry=button('Retry original delivery action',()=>void submit(s));retry.classList.add('primary');retry.disabled=s.busy||Boolean(storageError);actions.append(retry);}
      }
      q('[data-delivery-status]').textContent=message;q('[data-delivery-note]').textContent=note;
      const error=q('[data-delivery-error]');error.textContent=storageError||s?.error||'';error.hidden=!error.textContent;
    }
    async function read(s){
      if(!s||!alive())return null;const seq=++s.seq;s.reading=true;s.error='';s.message='';render();
      try{const result=await host.api(path(s,'publication'));if(!alive()||seq!==s.seq)return null;if(!validPublication(result.publication,s.id))throw Error('The saved publication could not be verified. Refresh delivery to try again.');s.pub=result.publication;s.loaded=true;return s.pub;}
      catch(error){if(alive()&&seq===s.seq)s.error=error.message;throw error;}
      finally{if(seq===s.seq){s.reading=false;render();}}
    }
    q('[data-delivery-refresh]').addEventListener('click',()=>{const s=current();if(s&&!s.busy)void read(s).catch(()=>{});});
    function close(){dialog.close();listDialog.close();review=null;listing=null;}
    dq('[data-delivery-review-close]').addEventListener('click',()=>dialog.close());dialog.addEventListener('close',()=>{review=null;});
    lq('[data-delivery-list-close]').addEventListener('click',()=>listDialog.close());listDialog.addEventListener('close',()=>{listing=null;});
    function timing(){
      if(!review)return;const later=rf.elements.timing.value==='later';dq('[data-delivery-time-label]').hidden=!later;rf.elements.scheduledAt.required=later;
      dq('[data-delivery-confirm]').disabled=!review.ready||!rf.elements.confirmed.checked;dq('[data-delivery-confirm]').textContent=review.kind==='cancel'?'Confirm cancellation':review.kind==='reschedule'?'Confirm new send time':later?'Schedule campaign':'Publish campaign';
    }
    const reviewLocal=(stamp,v)=>new Date(Date.parse(stamp)+v.offset).toISOString().slice(0,16);
    const reviewUtc=(value,v)=>new Date(Date.parse(value+'Z')-v.offset).toISOString();
    rf.addEventListener('change',event=>{if(event.target.name!=='confirmed')rf.elements.confirmed.checked=false;timing();});
    async function openReview(kind){
      const c=context(),s=current();if(!c||!s||s.pending||s.busy||!workspace.canEdit||storageError)return;
      if(kind==='publish'&&(!workspace.deliveryAvailable||c.dirty||c.saving||c.draftPending||c.values.archived))return;
      close();const v=review={kind,id:s.id,ready:false,snapshot:clone(c)};rf.reset();dq('[data-delivery-review-copy]').replaceChildren();dq('[data-delivery-review-error]').hidden=true;
      dq('[data-delivery-review-title]').textContent=kind==='cancel'?'Cancel remaining sends?':kind==='reschedule'?'Change campaign send time':'Review campaign publication';
      dq('[data-delivery-review-status]').textContent='Checking the saved campaign…';dq('[data-delivery-time-options]').hidden=kind==='cancel';
      rf.elements.timing[0].closest('label').hidden=kind==='reschedule';rf.elements.timing.value=kind==='reschedule'?'later':'now';
      dq('[data-delivery-confirm-label]').textContent=kind==='cancel'?'Stop remaining sends from this campaign.':'I have reviewed this email and its audience.';
      dq('[data-delivery-zone]').textContent='Store timezone: '+workspace.timezone;timing();dialog.showModal();
      try{
        const fresh=await host.api('/workspace');if(!alive()||review!==v||active!==s.id)return;host.workspace(fresh);
        if(!workspace.canEdit||kind==='publish'&&!workspace.deliveryAvailable)throw Error('Campaign delivery or your store access changed. Close this review and refresh the workspace.');
        v.offset=({'Asia/Jakarta':7,'Asia/Makassar':8,'Asia/Jayapura':9}[workspace.timezone])*3600000;
        dq('[data-delivery-zone]').textContent='Store timezone: '+workspace.timezone;
        const [p,result]=await Promise.all([read(s),kind==='publish'?host.api('/campaigns/'+s.id):Promise.resolve(null)]);
        if(!alive()||review!==v||active!==s.id)return;
        if(kind==='publish'){
          if(p)throw Error('This campaign already has a publication. Close this review to view its delivery record.');
          const row=result.campaign;if(!host.validRow(row)||row.id!==s.id||row.revision!==v.snapshot.revision||!same(row.values,v.snapshot.values))throw Error('The saved draft changed. Close this review and use Review saved version before publishing.');
          if(!row.values.subject||!row.values.heading||!row.values.body||row.values.buttonLabel&&!workspace.shopEnabled)throw Error('Complete the subject, heading and message. Enable your store before including its button.');
          v.row=row;copy(dq('[data-delivery-review-copy]'),row);const audience=await host.api('/audience',{filters:row.values.audience});
          if(!alive()||review!==v||active!==s.id)return;if(!audience.summary||!integer(audience.summary.granted))throw Error('The current audience could not be verified. Close this review and try again.');
          if(!audience.summary.granted)throw Error('No customers currently have email permission for this audience. Review the audience before publishing.');
          dq('[data-delivery-review-status]').textContent=`${audience.summary.granted} matching customers have email permission. The final recipient list is set when you confirm, and permission is checked again before sending. This publishes saved version ${row.revision}.`;
          if(row.values.plannedAt&&Date.parse(row.values.plannedAt)>Date.now()+60000){rf.elements.timing.value='later';rf.elements.scheduledAt.value=reviewLocal(row.values.plannedAt,v);}
        }else{
          if(!p||p.cancelled||kind==='reschedule'&&!p.canReschedule)throw Error(kind==='cancel'?'There are no remaining sends to cancel. Refresh delivery.':'Processing has started or the campaign changed. Refresh delivery before changing its schedule.');
          v.publication=p;copy(dq('[data-delivery-review-copy]'),p);
          dq('[data-delivery-review-status]').textContent=kind==='cancel'?'This stops remaining sends. Emails already submitted or currently in flight cannot be recalled. An unconfirmed submission will still need review.':'Choose a future send time. The published email and recipient list stay the same. Scheduling closes when recipient processing starts.';
          rf.elements.scheduledAt.value=reviewLocal(p.scheduledAt,v);
        }
        if(!rf.elements.scheduledAt.value)rf.elements.scheduledAt.value=reviewLocal(new Date(Date.now()+3600000).toISOString(),v);rf.elements.confirmed.checked=false;v.ready=true;timing();
      }catch(error){if(alive()&&review===v){dq('[data-delivery-review-status]').textContent=error.message;v.ready=false;timing();}}
    }
    rf.addEventListener('submit',event=>{
      event.preventDefault();const v=review,s=current();if(!v?.ready||!s||s.id!==v.id||s.pending||s.busy||!rf.reportValidity()||!rf.elements.confirmed.checked||!workspace.canEdit||storageError)return;
      const c=context();if(v.kind==='publish'&&(!c||c.dirty||c.saving||c.draftPending||c.revision!==v.row.revision||!same(c.values,v.row.values)))return;
      try{
        let scheduledAt=null;if(v.kind==='reschedule'||v.kind==='publish'&&rf.elements.timing.value==='later'){
          scheduledAt=reviewUtc(rf.elements.scheduledAt.value,v);
          if(!host.iso(scheduledAt)||reviewLocal(scheduledAt,v)!==rf.elements.scheduledAt.value||Date.parse(scheduledAt)<Date.now()+60000||Date.parse(scheduledAt)>Date.now()+366*86400000)throw Error('Choose a send time at least one minute ahead and within the next year.');
        }
        const body=v.kind==='publish'?{revision:v.row.revision,requestKey:random(),scheduledAt}:{kind:v.kind,revision:v.publication.revision,requestKey:random(),scheduledAt};
        s.pending={kind:v.kind,body,publicationId:v.publication?.id||null,values:v.kind==='publish'?clone(v.row.values):null,name:v.kind==='publish'?v.row.values.name:v.publication.values.name};
        if(!persist()){notify();return;}dialog.close();notify();void submit(s);
      }catch(error){dq('[data-delivery-review-error]').textContent=error.message;dq('[data-delivery-review-error]').hidden=false;}
    });
    async function submit(s){
      if(!alive()||!s.pending||s.busy||corrupt)return;if(!persist()){notify();return;}
      const pending=clone(s.pending),b=pending.body;s.busy=true;s.error='';notify();
      try{
        const result=await host.api(path(s,pending.kind==='publish'?'publish':'publication-action'),b),r=result.receipt,p=result.publication;
        if(!validPublication(p,s.id)||!p||!r||r.requestKey!==b.requestKey||!host.iso(r.createdAt)||typeof r.replayed!=='boolean')throw Error('The delivery response could not be verified. Retry the original delivery action.');
        if(pending.kind==='publish'){
          if(r.id!==p.id||r.campaignId!==s.id||r.campaignRevision!==b.revision||p.campaignRevision!==b.revision||r.createdAt!==p.createdAt||!same(p.values,pending.values)||!host.iso(r.scheduledAt)||b.scheduledAt!==null&&r.scheduledAt!==b.scheduledAt||b.scheduledAt===null&&r.scheduledAt!==r.createdAt)throw Error('The publication receipt did not match. Retry the original delivery action.');
        }else if(r.id!==pending.publicationId||p.id!==pending.publicationId||r.kind!==pending.kind||r.revision!==b.revision+1||p.revision<r.revision||r.scheduledAt!==b.scheduledAt||r.createdAt<p.createdAt||r.createdAt>p.updatedAt||pending.kind==='cancel'&&!p.cancelled||pending.kind==='reschedule'&&p.revision===r.revision&&p.scheduledAt!==b.scheduledAt)throw Error('The schedule receipt did not match. Retry the original delivery action.');
        s.pub=p;s.loaded=true;s.pending=null;s.message=p.revision>(pending.kind==='publish'?0:r.revision)?'Original action confirmed. A newer delivery state is shown.':pending.kind==='publish'?'Campaign publication confirmed.':pending.kind==='cancel'?'Campaign cancellation confirmed.':'New send time confirmed.';persist();void host.refresh();
      }catch(error){
        s.error=error.message;
        const definite=[400,413,415,422].includes(error.status)||['campaign_publication_changed','campaign_already_published','campaign_publication_conflict','campaign_processing_started','campaign_publication_reference'].includes(error.code);
        if(alive()&&definite){s.pending=null;persist();try{await read(s);}catch{}s.error=error.message+' Review the current campaign before confirming a new action.';}
      }finally{s.busy=false;notify();if(alive()&&active===s.id&&!dialog.open&&!listDialog.open)q('[data-delivery-status]').focus({preventScroll:true});}
    }
    function openList(kind){
      const s=current();if(!s?.pub||!alive())return;dialog.close();listing={id:s.id,kind,cursor:null,started:false,busy:false,seen:new Set()};
      lq('#campaign-delivery-list-title').textContent=kind==='recipients'?'Campaign recipients':'Delivery history';lq('[data-delivery-list-items]').replaceChildren();
      lq('[data-delivery-list-note]').textContent=kind==='recipients'?'This is the fixed publication audience. Submitted means the email service accepted the message; delivered means the recipient mail server accepted it. Neither confirms it was read. Refresh to see newer outcomes.':'Publication, schedule changes and cancellation are recorded here. Draft edits have their own saved history.';
      listDialog.showModal();void loadList();
    }
    async function loadList(){
      const v=listing;if(!v||v.busy||v.started&&!v.cursor)return;v.busy=true;lq('[data-delivery-list-retry]').hidden=true;lq('[data-delivery-list-more]').disabled=true;lq('[data-delivery-list-status]').textContent='Loading campaign details…';
      try{
        const result=await host.api('/campaigns/'+v.id+'/'+v.kind+(v.cursor?'?cursor='+encodeURIComponent(v.cursor):''));if(!alive()||listing!==v)return;
        if(!Array.isArray(result.items)||result.items.length>25||result.nextCursor!==null&&typeof result.nextCursor!=='string')throw Error('The campaign details could not be verified.');
        const rows=[];for(const item of result.items){const li=el('li');
          if(v.kind==='recipients'){
            if(!integer(item.id)||item.id<1||typeof item.name!=='string'||typeof item.email!=='string'||!item.delivery||!Object.hasOwn(labels,item.delivery.state)||typeof item.delivery.needsReview!=='boolean')throw Error('The recipient status could not be verified.');
            if(v.seen.has(item.id))continue;li.dataset.record=String(item.id);li.append(el('b',item.name||'Customer'),el('span',item.email),el('strong',labels[item.delivery.state]));
            if(item.delivery.reason)li.append(el('span',reasons[item.delivery.reason]||'Delivery stopped after an eligibility check.'));
            if(item.delivery.needsReview)li.append(el('span','Needs review: an earlier submission or processing result is unresolved.'));
            for(const [k,label] of [['submittedAt','Submission confirmed'],['deliveredAt','Delivered'],['checkedAt','Delivery status checked'],['resolvedAt','Submission confirmed after review']])if(item.delivery[k]){if(!host.iso(item.delivery[k]))throw Error('The delivery time could not be verified.');li.append(el('small',label+': '+host.date(item.delivery[k])));}
          }else{
            if(!integer(item.revision)||!['publish','reschedule','cancel'].includes(item.kind)||!host.iso(item.createdAt)||item.scheduledAt!==null&&!host.iso(item.scheduledAt))throw Error('The delivery history could not be verified.');
            if(v.seen.has(item.revision))continue;li.dataset.record=String(item.revision);li.append(el('b',{publish:'Published',reschedule:'Send time changed',cancel:'Remaining sends cancelled'}[item.kind]),el('span',(item.actor==='you'?'You':'Store member')+' · '+host.date(item.createdAt)));
            if(item.scheduledAt)li.append(el('span','Send time: '+host.date(item.scheduledAt)));
          }rows.push(li);
        }
        const list=lq('[data-delivery-list-items]');for(const row of rows){v.seen.add(Number(row.dataset.record));list.append(row);}v.cursor=result.nextCursor;v.started=true;
        const n=list.children.length,noun=v.kind==='recipients'?(n===1?'recipient':'recipients'):(n===1?'delivery change':'delivery changes');
        lq('[data-delivery-list-more]').hidden=!v.cursor;lq('[data-delivery-list-status]').textContent=`${n} ${noun} shown.`;
      }catch(error){if(alive()&&listing===v){lq('[data-delivery-list-status]').textContent=error.message;lq('[data-delivery-list-retry]').hidden=false;}}
      finally{v.busy=false;if(alive()&&listing===v)lq('[data-delivery-list-more]').disabled=false;}
    }
    lq('[data-delivery-list-more]').addEventListener('click',()=>void loadList());lq('[data-delivery-list-retry]').addEventListener('click',()=>void loadList());
    lq('[data-delivery-list-refresh]').addEventListener('click',()=>{if(listing)openList(listing.kind);});
    return {
      configure(data){workspace=data;if(!scope){scope=`ezkart.marketing-publication.v1:${host.account}:${host.store}:${data.environment}`;restore();}render();},
      update(){const c=context(),id=c?.id||null;if(active!==id){active=id;close();if(id){const s=get(id);if(!s.loaded&&!s.reading&&!s.error)void read(s).catch(()=>{});}}render();},
      refresh(){const s=current();if(s&&!s.reading&&!s.busy)void read(s).catch(()=>{});},
      pendingFor(id){return Boolean(states.get(id)?.pending);},
      close,
      stop(){stopped=true;close();},
      unprotected(){return Boolean(storageError)&&[...states.values()].some(s=>s.pending);}
    };
  };
})();
