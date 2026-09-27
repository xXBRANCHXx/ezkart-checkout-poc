(() => {
  'use strict';
  const root=document.querySelector('[data-refunds]');if(!root)return;
  const q=s=>root.querySelector(s),merchant=root.dataset.audience==='merchant',support=root.dataset.audience==='support',form=q('[data-refund-form]'),list=q('[data-refund-list]'),detail=q('[data-refund-detail]');
  const el=(tag,text,cls='')=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
  const button=(text,fn)=>{const n=el('button',text);n.type='button';n.addEventListener('click',fn);return n;};
  const money=n=>'Rp'+Number(n).toLocaleString('id-ID'),date=s=>new Date(s).toLocaleString('en-GB',{timeZone:'Asia/Jakarta'});
  const base=support?'/v1/support/refunds':merchant?'/v1/commerce/refunds':'/v1/customer/orders/'+root.dataset.order+'/refunds';
  const orderPath=id=>merchant?base+'/orders/'+id:base,casePath=id=>base+'/'+id;
  const scope=JSON.stringify([root.dataset.audience,root.dataset.account,root.dataset.store,root.dataset.order]),storageKey='ezkart.refunds.pending.v1:'+scope;
  let pending=null,busy=false,loading=false,ended=false,damaged=false,rejected=false,enabled=true,cursor=null,generation=0,overview=null,dirty=false;
  const checksum=async record=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([record.v,record.scope,record.path,record.body]))))].map(n=>n.toString(16).padStart(2,'0')).join('');
  const notice=text=>q('[data-refund-status]').textContent=text;
  const error=text=>{q('[data-refund-error]').textContent=text;q('[data-refund-error]').hidden=!text;};
  function controls(){
    root.querySelectorAll('button,input,select,textarea').forEach(n=>n.disabled=busy||loading||ended||Boolean(pending)||damaged);
    q('[data-refund-refresh]').disabled=!ended&&(busy||loading||Boolean(pending)||dirty);
    q('[data-refund-new]').disabled=busy||loading||ended||Boolean(pending)||damaged||dirty||!enabled;
    root.querySelectorAll('[data-refund-retry]').forEach(n=>n.disabled=busy||ended||damaged);
    root.querySelectorAll('[data-refund-review-changes]').forEach(n=>n.disabled=busy||ended||damaged);
    list.querySelectorAll('button').forEach(n=>n.disabled=busy||loading||ended||Boolean(pending)||dirty);
    q('[data-refund-filter]').disabled=busy||loading||ended||Boolean(pending)||dirty;
    root.querySelectorAll('[data-refund-detail-reload]').forEach(n=>n.disabled=busy||loading||ended||Boolean(pending)||dirty);
    root.querySelectorAll('[data-refund-discard]').forEach(n=>n.hidden=!dirty);
    if(overview&&!overview.canCreate)q('[data-refund-submit]').disabled=true;
  }
  function end(text){ended=true;generation++;list.replaceChildren();detail.replaceChildren();detail.hidden=true;form.hidden=true;q('[data-refund-lookup]').hidden=true;q('[data-refund-recovery]').replaceChildren();q('[data-refund-refresh]').textContent='Reload sign-in';error(text);controls();}
  async function readPending(){
    const raw=localStorage.getItem(storageKey);if(raw===null)return null;
    const value=JSON.parse(raw),path=typeof value?.path==='string'?value.path:'';
    const validPath=support?/^\/v1\/support\/refunds\/ref_[a-f0-9]{32}\/dispute$/.test(path):merchant?/^\/v1\/commerce\/refunds\/(?:orders\/EZK-[SP]-[A-F0-9]{24}|ref_[a-f0-9]{32}(?:\/dispute)?)$/.test(path):path===base||new RegExp('^'+base+'/ref_[a-f0-9]{32}(?:/dispute)?$').test(path);
    if(value?.v!==1||value.scope!==scope||!validPath||typeof value.body!=='string'||value.body.length>16000)throw Error('Saved retry data is damaged.');
    const body=JSON.parse(value.body);if(!/^[A-Za-z0-9_-]{16,100}$/.test(body?.requestKey||'')||(!body.kind&&(!Array.isArray(body.items)||body.items.some(i=>!i||!Number.isSafeInteger(i.amount)||i.amount<1))))throw Error('Saved retry data is damaged.');
    if(value.checksum!==await checksum(value)||localStorage.getItem(storageKey)!==raw)throw Error('Saved retry data is damaged or changed.');
    return value;
  }
  function recovery(){
    const box=q('[data-refund-recovery]');box.replaceChildren();box.hidden=!pending;if(!pending)return;
    const body=JSON.parse(pending.body);box.append(el('h3','Confirm your saved request'),el('p',body.kind?'Saved action: '+(reviewLabels[body.kind?.replace(/^review_/,'')]||body.kind):money(body.items.reduce((sum,i)=>sum+i.amount,body.shippingAmount||0))+' requested'),el('p','Your original details are saved. Retry confirmation to check the result.'));
    const retry=button('Retry confirmation',()=>void send());retry.dataset.refundRetry='';box.append(retry);
    if(rejected){const review=button('Review changes',()=>void reviewChanges());review.dataset.refundReviewChanges='';box.append(review);}controls();
  }
  async function api(path,body,binary=false){
    let url,headers={'Content-Type':'application/json','X-Ezkart-CSRF':root.dataset.csrf};
    if(merchant||support){url='/cart/admin/?cloud='+encodeURIComponent(path);headers['X-Ezkart-Refund-Account']=root.dataset.account;headers['X-Ezkart-Refund-Store']=root.dataset.store;}
    else{const parsed=new URL(path,location.origin),[id,action,attachment]=parsed.pathname.slice(base.length).replace(/^\//,'').split('/');url='/cart/admin/customer-refunds.php?'+new URLSearchParams({order:root.dataset.order,...(id?{refund:id}:{}),...(action==='evidence'?{evidence:attachment||'upload'}:action==='dispute'?{dispute:'1'}:{}),...Object.fromEntries(parsed.searchParams)});headers['X-Ezkart-Customer-Session']=root.dataset.version;}
    const response=await fetch(url,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',headers,signal:AbortSignal.timeout(35000),...(body===undefined?{}:{body})});
    if(binary&&response.ok)return {bytes:await response.arrayBuffer(),mime:response.headers.get('content-type'),sha256:response.headers.get('x-ezkart-file-sha256')};
    let data;try{data=await response.json();}catch{throw Error('The response was interrupted. Retry confirmation.');}
    if(!response.ok||data.ok!==true){const e=Error(data.error||'The refund result could not be confirmed.');e.status=response.status;if([401,403].includes(e.status)){end(e.message);if(support&&data.code==='support_verification_required')q('[data-refund-refresh]').textContent='Reload to verify';}throw e;}return data;
  }
  async function load(append=false){
    if(ended)return;const version=++generation;loading=true;controls();
    try{const data=await api(base+'?'+new URLSearchParams({state:q('[data-refund-filter]').value,...(append&&cursor?{cursor}:{})}));if(ended||version!==generation)return;
      if(!append)list.replaceChildren();for(const r of data.refunds){const card=button('',()=>void show(r.id));card.className='refund-case';card.append(el('b',r.stateLabel),el('small',(r.storeName?r.storeName+' · ':'')+r.orderId+' · '+date(r.createdAt)),el('strong',money(r.amount)));card.dataset.refundCase=r.id;list.append(card);}
      cursor=data.nextCursor;enabled=data.enabled;q('[data-refund-more]').hidden=!cursor;
      notice(data.enabled?(support?(list.children.length?'The review queue is up to date.':'No reviews in this view.'):(list.children.length?'Your refund requests are up to date.':'No refund requests yet.')):'Refund requests will open when order processing is enabled.');
      if(!merchant&&!support)overview=data;
    }catch(e){if(!ended)error(e.message);}finally{if(version===generation){loading=false;controls();}}
  }
  function renderForm(data,draft){
    overview=data;dirty=true;form.hidden=false;q('[data-refund-lookup]').hidden=true;detail.hidden=true;
    q('[data-refund-order]').textContent=data.order.id;form.elements.reason.value=draft?.reason||'not_received';form.elements.note.value=draft?.note||'';
    const amounts=q('[data-refund-amounts]');amounts.replaceChildren();
    for(const item of [...data.items.map(i=>({...i,key:i.orderItemId,label:i.title+(i.variant?' — '+i.variant:'')})),{key:'shipping',label:'Shipping',...data.shipping}]){
      const row=el('div',undefined,'refund-amount'),text=el('div'),label=el('label','Requested amount for '+item.label),input=el('input');
      text.append(el('b',item.label),el('small',money(item.availableAmount)+' remaining from '+money(item.paidAmount)));input.type='number';input.min='0';input.max=String(item.availableAmount);input.step='1';input.inputMode='numeric';input.dataset.refundAmount=item.key;
      input.value=String(item.key==='shipping'?(draft?.shippingAmount||0):(draft?.items?.find(i=>i.orderItemId===item.key)?.amount||0));label.append(input);row.append(text,label);amounts.append(row);
    }
    error(data.reason||'');total();controls();form.elements.reason.dispatchEvent(new Event('change',{bubbles:true}));
  }
  function total(){const n=[...form.querySelectorAll('[data-refund-amount]')].reduce((sum,input)=>sum+Number(input.value||0),0);q('[data-refund-total]').textContent='Requested total: '+money(n);}
  async function begin(orderId=root.dataset.order,draft){
    if(ended||pending||busy||support)return;
    if(!orderId){q('[data-refund-lookup]').hidden=false;q('[data-refund-lookup] input').focus();return;}
    loading=true;controls();error('');try{const data=await api(orderPath(orderId));if(!ended)renderForm(data,draft);}catch(e){if(!ended)error(e.message);}finally{loading=false;controls();}
  }
  function renderEvidence(r){
    const facts=r.evidence;if(!facts)return;
    const box=el('section',undefined,'refund-evidence');box.dataset.refundEvidence='';box.append(el('h4','Purchase and delivery'));
    box.append(el('p',facts.payment?'Original payment: '+money(facts.payment.amount)+' confirmed · '+date(facts.payment.confirmedAt):'Original payment evidence is unavailable.'));
    if(facts.paymentReview)box.append(el('p','This payment needs a support review.'));
    if(facts.fulfillmentReview)box.append(el('p','The shipment history needs a support review.'));
    if(r.items.some(i=>i.type==='physical')||r.shippingAmount>0)box.append(el('p',facts.courierDeliveredAt?'Courier delivery recorded · '+date(facts.courierDeliveredAt):facts.shippingSkipped?'Shipping was skipped in sandbox. No courier delivery is confirmed.':'Courier delivery has not been confirmed.'));
    for(const item of r.items.filter(i=>i.type==='digital')){
      const line=el('article');line.append(el('b',item.title+(item.variant?' — '+item.variant:'')));
      if(item.download){line.append(el('p','Purchased file: '+item.download.filename+' · version '+item.download.version+' · '+new Intl.NumberFormat().format(item.download.size)+' bytes'));
        line.append(el('p',item.download.confirmedAt?'Verified complete download · '+date(item.download.confirmedAt):'A complete download has not been verified.'));
      }else line.append(el('p','Original file evidence is unavailable. A complete download has not been verified.'));
      box.append(line);
    }
    if(facts.returns.length){box.append(el('h4','Returns for these items'));const states={requested:'Awaiting store review',approved:'Approved',declined:'Declined',withdrawn:'Withdrawn',receiving:'Partly received',inspected:'Inspected',closed:'Closed'};
      for(const returned of facts.returns){const line=el('article');line.append(el('b',states[returned.state]||'Return update'),el('p','Return requested · '+date(returned.createdAt)));
        for(const item of returned.items){const original=r.items.find(i=>i.orderItemId===item.orderItemId);line.append(el('p',(original?.title||'Purchased item')+': '+item.received+' of '+item.quantity+' return units received and inspected.'));}
        if(merchant){const link=el('a','View return');link.href='?page=returns&return='+encodeURIComponent(returned.id);line.append(link);}box.append(line);
      }
      if(facts.moreReturns)box.append(el('p','Showing the 20 most recent related returns. More history is available in Returns.'));
      box.append(el('p','A received return does not confirm that a refund was paid.'));
    }
    detail.append(box);
  }
  function renderDetail(r){
    detail.hidden=false;detail.replaceChildren();detail.append(el('h3',r.stateLabel),el('p',r.orderId),el('strong',money(r.amount)),el('p','Reason: '+([...form.elements.reason.options].find(o=>o.value===r.reason)?.textContent||r.reason)),el('p',r.note));
    if(merchant){const orderLink=el('a','View original order');orderLink.href='?page=orders&order='+encodeURIComponent(r.orderId);detail.append(orderLink);}
    const lines=el('ul',undefined,'refund-lines');for(const i of r.items)lines.append(el('li',i.title+(i.variant?' — '+i.variant:'')+': '+money(i.amount)+' requested from '+money(i.quantity*i.price)));if(r.shippingAmount)lines.append(el('li','Shipping: '+money(r.shippingAmount)));detail.append(lines);
    if(r.state==='approved')detail.append(el('p','This refund request is approved. The refund has not been paid. Refund processing is not available yet.'));
    renderEvidence(r);
    renderAttachments(r);
    const history=el('div',undefined,'refund-history');history.append(el('h4','Request history'),el('p','Requested · '+date(r.createdAt)));
    for(const a of r.history){const row=el('article');row.append(el('b',a.actor+' · '+({approve:'Approved',decline:'Declined',withdraw:'Withdrawn'}[a.kind])),el('time',date(a.createdAt)),el('p',a.message));history.append(row);}detail.append(history);
    renderDispute(r);
    const available=['approve','decline','withdraw'].filter(kind=>r['can'+kind[0].toUpperCase()+kind.slice(1)]);
    if(available.length){const decision=el('form',undefined,'refund-decision'),label=el('label',merchant?'Message for the buyer':'Why are you withdrawing?'),note=el('textarea');note.name='message';note.required=true;note.minLength=3;note.maxLength=2000;note.rows=3;label.append(note);decision.append(label);
      if(merchant&&r.canApprove)decision.append(el('p','Approval records your decision. Refund processing is not available yet.'));
      const actions=el('div',undefined,'refund-buttons');for(const kind of available){const action=el('button',({approve:'Approve request',decline:'Decline request',withdraw:'Withdraw request'}[kind]));action.type='submit';action.dataset.kind=kind;actions.append(action);}decision.append(actions);
      decision.addEventListener('input',()=>{dirty=true;controls();});decision.addEventListener('submit',e=>{e.preventDefault();const kind=e.submitter?.dataset.kind;if(!kind||!decision.reportValidity())return;
        if(otherDraft(decision)){error('Save or clear your other draft before deciding.');return;}
        void persistAndSend(casePath(r.id),{requestKey:crypto.randomUUID().replaceAll('-',''),revision:r.revision,orderRevision:r.orderRevision,evidenceVersion:r.evidenceVersion,kind,message:note.value});});detail.append(decision);
    }
    const reload=button('Reload request',()=>void show(r.id)),footer=el('div',undefined,'refund-buttons');reload.dataset.refundDetailReload='';footer.append(reload);
    {const discard=button('Discard draft',()=>{dirty=false;renderDetail(r);});discard.dataset.refundDiscard='';footer.append(discard);}detail.append(footer);controls();
  }
  const reviewLabels={open:'Request Ezkart review',reply:'Send information',ask_buyer:'Ask buyer for information',ask_store:'Ask store for information',approve:'Approve refund request',decline:'Decline refund request',withdraw:'Withdraw Ezkart review',reopen:'Reopen Ezkart review'};
  const reviewEvents={reply:'Added information',ask_buyer:'Requested buyer information',ask_store:'Requested store information',approve:'Approved refund request',decline:'Declined refund request',withdraw:'Withdrew review',reopen:'Reopened review'};
  const otherDraft=except=>[...detail.querySelectorAll('form')].filter(f=>f!==except).some(f=>[...f.querySelectorAll('textarea,input[type=file]')].some(n=>Boolean(n.value)));
  function renderDispute(r){
    const d=r.dispute;if(!d&&!r.canRequestReview)return;
    const box=el('section',undefined,'refund-evidence refund-review');box.dataset.refundReview='';box.append(el('h4','Ezkart review'));
    if(d){
      box.append(el('p',d.stateLabel),el('p',d.openedBy+' requested review · '+date(d.createdAt)),el('p',d.message));
      if(d.active)box.append(el('p','The affected earnings remain held while this review is open. The original store decision remains in the request history.'));
      const history=el('div',undefined,'refund-history');history.dataset.reviewHistory='';
      const row=a=>{const n=el('article');n.append(el('b',a.actor+' · '+reviewEvents[a.kind]),el('time',date(a.createdAt)),el('p',a.message));return n;};
      for(const a of d.actions)history.append(row(a));box.append(history);
      let before=d.olderBefore;
      if(before){const older=button('Load earlier review updates',()=>void(async()=>{
        if(busy||loading||pending||dirty||ended)return;busy=true;controls();error('');try{const data=await api(casePath(r.id)+'/dispute?before='+before);if(ended)return;
          history.prepend(...data.disputeHistory.actions.map(row));before=data.disputeHistory.olderBefore;older.hidden=!before;
        }catch(e){if(!ended)error(e.message);}finally{busy=false;controls();}
      })());older.dataset.refundDetailReload='';box.append(older);}
      if(d.requiresVerification){const link=el('a','Verify your authenticator to update this review');link.href='?page=support-refunds&refund='+encodeURIComponent(r.id)+'#review-verification';box.append(link);}
    }else box.append(el('p','Ask Ezkart to review the original purchase, supporting files and store decision. Explain what needs reviewing.'));
    const kinds=d?[...(d.canReply?['reply']:[]),...(d.canDecide?['ask_buyer','ask_store','approve','decline']:[]),...(d.canWithdraw?['withdraw']:[]),...(d.canReopen?['reopen']:[])]:['open'];
    if(kinds.length){const review=el('form'),label=el('label',d?'Information for this review':'Why should Ezkart review this request?'),note=el('textarea');review.dataset.reviewForm='';
      note.name='message';note.rows=4;note.required=true;note.minLength=3;note.maxLength=2000;label.append(note);review.append(label);
      review.append(el('p','Your message is retained with the case and visible to the buyer, store and authorized Ezkart reviewers.'));
      if(d?.canDecide)review.append(el('p','A decision applies to the original requested '+money(r.amount)+'. Approval does not send money. Review the purchase, delivery and all supporting files before deciding.'));
      const actions=el('div',undefined,'refund-buttons');for(const kind of kinds){const b=el('button',reviewLabels[kind]);b.type='submit';b.dataset.kind=kind;actions.append(b);}review.append(actions);
      review.addEventListener('input',()=>{dirty=true;controls();});review.addEventListener('submit',event=>{
        event.preventDefault();const kind=event.submitter?.dataset.kind;if(!kinds.includes(kind)||!review.reportValidity())return;
        if(otherDraft(review)){error('Save or clear your other draft before updating the review.');return;}
        void persistAndSend(casePath(r.id)+'/dispute',{requestKey:crypto.randomUUID().replaceAll('-',''),kind:'review_'+kind,revision:d?.revision||0,refundRevision:r.revision,orderRevision:r.orderRevision,evidenceVersion:r.evidenceVersion,message:note.value});
      });box.append(review);
    }
    detail.append(box);
  }
  async function downloadAttachment(r,file){
    if(busy||loading||pending||ended)return;busy=true;controls();error('');
    try{const response=await api(casePath(r.id)+'/evidence/'+file.id,undefined,true);if(ended)return;
      const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',response.bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
      if(response.bytes.byteLength!==file.size||response.mime!==file.mime||hash!==file.sha256||response.sha256!==file.sha256)throw Error('The original file could not be verified. Reload before trying again.');
      const url=URL.createObjectURL(new Blob([response.bytes],{type:file.mime})),link=el('a');link.href=url;link.download=file.filename;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);notice('The original file is ready to save.');
    }catch(e){if(!ended)error(e.message);}finally{busy=false;controls();}
  }
  function renderAttachments(r){
    const box=el('section',undefined,'refund-evidence');box.dataset.refundAttachments='';box.append(el('h4','Supporting files'),el('p','Files are private to this purchase’s buyer, store and authorized Ezkart reviewers. Originals and descriptions are retained with the request. Evidence added later does not change an earlier decision.'));
    const files=r.attachments||[];
    if(!files.length)box.append(el('p','No supporting files yet.'));
    for(const file of files){const row=el('article');row.append(el('b',file.filename),el('p',file.actor+' · '+date(file.createdAt)+' · '+new Intl.NumberFormat().format(file.size)+' bytes'));
      if(file.caption)row.append(el('p',file.caption));
      if(file.state==='ready'){const download=button('Download original: '+file.filename,()=>void downloadAttachment(r,file));row.append(download);}
      else row.append(el('p','Upload not confirmed. The original uploader can resume by selecting the same file and description.'));
      box.append(row);
    }
    if(r.canUploadEvidence){
      const upload=el('form');upload.dataset.refundFileForm='';const fileLabel=el('label','Evidence file'),fileInput=el('input'),captionLabel=el('label','File description (optional)'),caption=el('textarea');
      fileInput.type='file';fileInput.name='file';fileInput.accept='.jpg,.jpeg,.png,.webp,.pdf';fileInput.required=true;fileLabel.append(fileInput);caption.name='caption';caption.maxLength=500;caption.rows=2;captionLabel.append(caption);
      const add=el('button','Add or retry evidence');add.type='submit';const clear=button('Clear selected evidence',()=>{upload.reset();dirty=otherDraft(upload);error('');controls();}),buttons=el('div',undefined,'refund-buttons');buttons.append(add,clear);
      upload.append(fileLabel,captionLabel,el('p','JPG, PNG, WebP or PDF, up to 5 MiB each. Up to 10 files per side. Include only information relevant to this request. Files are kept exactly as supplied, including embedded metadata.'),buttons);
      upload.addEventListener('input',()=>{dirty=true;controls();});
      upload.addEventListener('submit',event=>{event.preventDefault();void (async()=>{
        if(busy||loading||pending||ended||!upload.reportValidity())return;
        if(otherDraft(upload)){error('Save or clear your other draft before adding evidence.');return;}
        const file=fileInput.files[0],mime=/\.jpe?g$/i.test(file.name)?'image/jpeg':/\.png$/i.test(file.name)?'image/png':/\.webp$/i.test(file.name)?'image/webp':/\.pdf$/i.test(file.name)?'application/pdf':'';
        if(!mime||file.size<1||file.size>5242880){error('Choose a JPG, PNG, WebP or PDF file up to 5 MiB.');return;}
        busy=true;controls();error('');notice('Saving the original evidence file…');
        try{const dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('The selected file could not be read.'));reader.readAsDataURL(new Blob([file],{type:mime}));});
          if(ended)return;const data=await api(casePath(r.id)+'/evidence',JSON.stringify({filename:file.name,caption:caption.value,dataUrl}));if(ended)return;
          if(!data.refund?.id)throw Error('The evidence result was incomplete.');dirty=false;renderDetail(data.refund);notice('The original evidence file was saved.');
        }catch(e){if(!ended){error(e.message+' If confirmation was interrupted, reload this request or retry the same file and description.');notice('Evidence confirmation needs checking.');}}
        finally{busy=false;controls();}
      })();});box.append(upload);
    }
    detail.append(box);
  }
  async function show(id){
    if(pending||busy||ended)return;loading=true;controls();error('');try{const data=await api(casePath(id));if(ended)return;dirty=false;form.hidden=true;q('[data-refund-lookup]').hidden=true;renderDetail(data.refund);}catch(e){if(!ended)error(e.message);}finally{loading=false;controls();}
  }
  async function locked(work){
    if(!navigator.locks){error('This browser cannot protect saved refund requests. Use a current browser to continue.');return;}
    await navigator.locks.request(storageKey,{ifAvailable:true},async lock=>{if(!lock){error('Another tab is confirming a refund request. Wait for it to finish.');return;}await work();});
  }
  async function persistAndSend(path,body){
    if(busy||pending||ended||damaged)return;
    await locked(async()=>{
      try{const existing=await readPending();if(existing){pending=existing;recovery();error('Confirm the earlier saved request before submitting another.');return;}
        const record={v:1,scope,path,body:JSON.stringify(body)};record.checksum=await checksum(record);const serialized=JSON.stringify(record);localStorage.setItem(storageKey,serialized);
        if(localStorage.getItem(storageKey)!==serialized)throw Error('Browser storage did not retain the request. Nothing was submitted.');pending=record;rejected=false;recovery();await deliver();
      }catch(e){if(!ended)error(e.message||'The request could not be saved in this browser. Nothing was submitted.');}finally{controls();}
    });
  }
  async function send(){if(!pending||busy||ended||damaged)return;await locked(deliver);}
  async function deliver(){
    const original=pending;busy=true;rejected=false;recovery();controls();error('');
    try{
      const stored=await readPending();if(stored&&JSON.stringify(stored)!==JSON.stringify(original))throw Error('Another saved request needs to be checked first. Reload this page.');
      const data=await api(original.path,original.body);if(ended)return;
      if(!data.refund?.id)throw Error('The saved refund response was incomplete. Retry confirmation.');
      if(stored)localStorage.removeItem(storageKey);
      if(localStorage.getItem(storageKey)!==null)throw Error('The result is saved, but browser recovery could not be cleared. Retry confirmation.');
      pending=null;dirty=false;rejected=false;form.hidden=true;q('[data-refund-lookup]').hidden=true;recovery();renderDetail(data.refund);await load();notice('Your refund request was saved.');
    }catch(e){if(!ended){rejected=[400,405,409,413,415,422,429].includes(e.status);error(e.message);recovery();}}
    finally{busy=false;controls();}
  }
  async function reviewChanges(){
    if(!pending||busy||ended||!rejected)return;const original=pending,body=JSON.parse(original.body);
    try{if(JSON.stringify(await readPending())!==JSON.stringify(original))throw Error('The saved retry changed. Reload this page.');localStorage.removeItem(storageKey);if(localStorage.getItem(storageKey)!==null)throw Error('Browser recovery could not be cleared.');}
    catch(e){error(e.message);return;}
    pending=null;rejected=false;dirty=false;recovery();error('');
    if(body.kind)await show(original.path.match(/ref_[a-f0-9]{32}/)?.[0]);else await begin(merchant?original.path.split('/').at(-1):root.dataset.order,body);
  }
  form.addEventListener('input',()=>{dirty=true;total();controls();});
  form.addEventListener('submit',e=>{e.preventDefault();if(!overview?.canCreate||!form.reportValidity())return;
    const inputs=[...form.querySelectorAll('[data-refund-amount]')],items=inputs.filter(i=>i.dataset.refundAmount!=='shipping'&&Number(i.value)>0).map(i=>({orderItemId:i.dataset.refundAmount,amount:Number(i.value)}));
    const shippingAmount=Number(inputs.find(i=>i.dataset.refundAmount==='shipping').value||0);
    if(items.length===0&&shippingAmount===0){error('Enter at least one amount to request.');return;}
    void persistAndSend(orderPath(overview.order.id),{requestKey:crypto.randomUUID().replaceAll('-',''),orderRevision:overview.order.revision,reason:form.elements.reason.value,note:form.elements.note.value,items,shippingAmount});
  });
  q('[data-refund-new]').addEventListener('click',()=>void begin());
  q('[data-refund-cancel]').addEventListener('click',()=>{dirty=false;form.hidden=true;error('');controls();});
  q('[data-refund-lookup]').addEventListener('submit',e=>{e.preventDefault();const id=e.currentTarget.elements.order.value.trim();if(!/^EZK-[SP]-[A-F0-9]{24}$/.test(id)){error('Enter a valid order reference.');return;}void begin(id);});
  q('[data-refund-refresh]').addEventListener('click',()=>{if(ended)location.reload();else{error('');void load();}});
  q('[data-refund-filter]').addEventListener('change',()=>void load());q('[data-refund-more]').addEventListener('click',()=>void load(true));
  addEventListener('beforeunload',e=>{if(dirty&&!pending){e.preventDefault();e.returnValue='';}});
  addEventListener('storage',async e=>{if(e.key!==storageKey||busy||ended)return;try{pending=await readPending();recovery();controls();}catch{damaged=true;error('Saved retry data could not be read. Reload and review your request history before continuing.');controls();}});
  void (async()=>{loading=true;controls();try{pending=await readPending();recovery();}catch{damaged=true;error('Saved retry data could not be read. Review your request history and contact support before submitting again.');}
    await load();if(!pending&&!ended){const id=new URL(location.href).searchParams.get('refund');if(/^ref_[a-f0-9]{32}$/.test(id||''))void show(id);}})();
})();
