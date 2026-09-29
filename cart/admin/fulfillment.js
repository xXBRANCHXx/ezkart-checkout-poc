(() => {
  const labels={awaiting_payment:'Awaiting payment',awaiting_acceptance:'Awaiting acceptance',awaiting_pickup_arrangement:'Ready for pickup',pickup_requested:'Pickup requested',queued:'Request queued',confirmed:'Pickup confirmed',scheduled:'Pickup scheduled',allocated:'Courier assigned',picking_up:'Courier heading to pickup',picked:'Picked up',in_transit:'On the way',dropping_off:'Out for delivery',delivered:'Delivered',return_in_transit:'Returning to sender',returned:'Returned to sender',cancelled:'Pickup cancelled',disposed:'Disposed by courier',on_hold:'Courier hold',rejected:'Courier rejected',courier_not_found:'Courier unavailable',stock_review:'Stock review',not_required:'Delivery not required'};
  const actions={accept:'Accept order',pickup:'Arrange pickup',cancel_pickup:'Cancel pickup',refresh:'Refresh tracking'};
  const jobLabels={'shipment.create':'Pickup request','shipment.cancel':'Pickup cancellation','shipment.refresh':'Tracking refresh'};
  const attention=new Set(['on_hold','rejected','courier_not_found','stock_review','return_in_transit','returned','disposed']);
  const el=(tag,text,className='')=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=String(text);if(className)node.className=className;return node;};
  const dataEl=(tag,text)=>{const node=el(tag,text);node.translate=false;return node;};
  const button=(text,click,primary=false)=>{const node=el('button',text,'ui-button'+(primary?' primary':''));node.type='button';node.addEventListener('click',click);return node;};
  const money=value=>new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(value);
  const date=value=>window.EzkartAdminFormat.date(value);
  const badge=(state,review=false)=>el('span',review?'Needs review':labels[state]||state,'fulfillment-badge'+(review||attention.has(state)?' attention':state==='delivered'?' good':''));
  const path=id=>'/v1/fulfillment'+(id?'/'+encodeURIComponent(id):'');
  const external=(title,url)=>{let parsed;try{parsed=new URL(url);}catch{return null;}if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.port)return null;const a=el('a',title,'ui-button');a.href=parsed.href;a.target='_blank';a.rel='noopener noreferrer';return a;};
  const actionAvailable=(data,kind)=>data?.[{accept:'canAccept',pickup:'canPickup',cancel_pickup:'canCancel',refresh:'canRefresh'}[kind]]===true;
  function mount({request}) {
    const root=document.querySelector('[data-fulfillment]');if(!root)return;
    const q=selector=>root.querySelector(selector),dialog=q('[data-fulfillment-dialog]'),form=q('[data-fulfillment-form]');
    const api=(method,target,body)=>request(method,target,body,{timeoutMs:method==='GET'?15000:30000});
    let sellerId='',selectedId='',detail=null,cursor=null,listVersion=0,detailVersion=0,historyVersion=0,enabled=false;
    let mode='',review=null,busy=false,blocked=false,pending={},storageReady=true,recovered=false;
    const message=(selector,text)=>{q(selector).textContent=text||'';q(selector).hidden=!text;};
    const status=text=>{q('[data-fulfillment-status]').textContent=text;};
    const storageKey=()=> 'ezkart.fulfillment.pending.'+sellerId;
    function savePending(next){
      const encoded=JSON.stringify(next);sessionStorage.setItem(storageKey(),encoded);
      if(sessionStorage.getItem(storageKey())!==encoded)throw Error('The browser could not save this request. Enable session storage before continuing.');pending=next;
    }
    function recover(){
      if(recovered||!sellerId)return;recovered=true;
      try{const encoded=sessionStorage.getItem(storageKey());if(encoded){const saved=JSON.parse(encoded);if(!saved||typeof saved!=='object'||Array.isArray(saved))throw Error('Invalid saved requests');
        for(const [id,value] of Object.entries(saved))if(/^EZK-[SP]-[A-F0-9]{24}$/.test(id)&&value&&Object.hasOwn(actions,value.kind)&&Number.isSafeInteger(value.revision)&&/^[a-f0-9]{32}$/.test(value.requestKey)&&typeof value.note==='string')pending[id]=value;
      }}catch{storageReady=false;status('Saved requests could not be read. Restore browser session storage before changing fulfillment.');}
    }
    function recoveryNotice(){
      const box=q('[data-fulfillment-recovery]');box.replaceChildren();box.hidden=!Object.keys(pending).length;
      if(!box.hidden){box.append(el('p','Some requests still need confirmation. Reopen them to check the original action safely.'));
        for(const id of Object.keys(pending))box.append(button(actions[pending[id].kind]+' · '+id.slice(-6),()=>void loadDetail(id,true).then(ok=>{if(ok)begin(pending[id].kind);})));}
    }
    function controls(){
      q('[data-fulfillment-reload]').disabled=!selectedId||busy;
      root.querySelectorAll('[data-fulfillment-action]').forEach(b=>b.disabled=busy||!storageReady);
      const saved=review&&pending[review.order.id];
      form.elements.note.disabled=busy||Boolean(saved);
      q('[data-fulfillment-confirm]').disabled=busy||!storageReady||(!saved&&(blocked||!actionAvailable(review,mode)||(mode==='cancel_pickup'&&form.elements.note.value.trim().length<5)));
      q('[data-fulfillment-confirm]').textContent=busy?'Saving…':saved?'Check original request':actions[mode]||'Confirm';
      root.querySelectorAll('[data-fulfillment-close]').forEach(b=>b.disabled=busy);
      q('[data-fulfillment-recovery]').querySelectorAll('button').forEach(b=>b.disabled=busy);
    }
    async function list(more=false){
      const version=++listVersion;q('[data-fulfillment-more]').disabled=true;message('[data-fulfillment-list-status]','Loading orders…');
      try{const query=new URLSearchParams({state:q('[data-fulfillment-filter]').value,q:q('[data-fulfillment-search]').elements.q.value.trim(),limit:'25'});if(more&&cursor)query.set('cursor',cursor);
        const data=await api('GET',path()+'?'+query);if(version!==listVersion)return false;
        sellerId=data.sellerId;enabled=data.enabled;cursor=data.nextCursor;recover();if(!more)q('[data-fulfillment-list]').replaceChildren();
        for(const item of data.items){const li=el('li'),b=el('button',undefined,'fulfillment-order');b.type='button';b.dataset.fulfillmentOpen=item.id;b.setAttribute('aria-pressed',String(item.id===selectedId));
          b.append(badge(item.fulfillmentState,item.review),el('b',item.customerName||'Customer'),el('small',item.id),el('small',money(item.total)+' · '+date(item.createdAt)));
          b.addEventListener('click',()=>{if(!busy)void loadDetail(item.id,true);});li.append(b);q('[data-fulfillment-list]').append(li);}
        message('[data-fulfillment-list-status]',q('[data-fulfillment-list]').children.length?'':'No orders match this view.');q('[data-fulfillment-more]').hidden=!cursor;
        if(storageReady)status(!enabled?'Fulfillment will be available when central order processing is enabled for this store.':data.courierWritesEnabled===false?'Courier booking and cancellation are paused. You can review orders and refresh existing tracking.':data.canWrite?'Only paid orders with allocated stock can be prepared for delivery.':'You can review shipments. Your account cannot change fulfillment.');
        recoveryNotice();controls();return true;
      }catch(error){if(version===listVersion)message('[data-fulfillment-list-status]',error.message+' Use Refresh to try again.');return false;}
      finally{if(version===listVersion)q('[data-fulfillment-more]').disabled=false;}
    }
    function addressCard(title,contact,address){
      const card=el('article',undefined,'fulfillment-card');card.append(el('h3',title),el('b',contact.name||'Contact unavailable'),el('p',address.address||'Address unavailable'));
      card.append(el('small',[address.location,address.postalCode].filter(Boolean).join(' · ')),el('small',contact.phone||'Phone unavailable'));
      if(contact.email)card.append(el('small',contact.email));if(address.note)card.append(el('p','Note: '+address.note));return card;
    }
    function addresses(order){
      const shipping=order.snapshot.shipping,origin=shipping.origin||{},destination=shipping.destination||{},box=el('div',undefined,'fulfillment-addresses');
      box.append(addressCard('Pickup',{name:origin.origin_contact_name,phone:origin.origin_contact_phone,email:origin.origin_contact_email},
        {address:origin.origin_address,postalCode:origin.origin_postal_code,note:origin.origin_note}),addressCard('Deliver to',order.customer,destination));return box;
    }
    function items(order){
      const box=el('div',undefined,'fulfillment-items');for(const item of order.items){const row=el('div',undefined,'fulfillment-item'),info=el('div');
        info.append(dataEl('b',item.title),el('small',[item.fulfillment.variantName,item.sku].filter(Boolean).join(' · ')),el('small',`${item.quantity} × ${money(item.price)} · ${item.fulfillment.weightGrams} g each`));row.append(info,el('span',money(item.price*item.quantity)));box.append(row);}return box;
    }
    function renderHistory(target,events,shipments){
      for(const event of events){const sequence=shipments.find(s=>s.id===event.shipmentId)?.sequence;const li=el('li');
        li.append(el('b',event.kind==='price'?'Courier fee update':event.kind==='waybill'?'Waybill update':labels[event.status]||event.status),
          el('time',event.updatedAt?date(event.updatedAt):'Received '+date(event.receivedAt)+' · Courier time unavailable'),el('small',`Shipment ${sequence||'—'} · ${event.source==='webhook'?'Courier notification':event.source==='refresh'?'Tracking refresh':'Pickup response'}`));
        if(event.note)li.append(el('p',event.note));if(event.locationName)li.append(el('p',event.locationName));if(event.waybillId)li.append(el('small','Waybill: '+event.waybillId));if(event.price!==undefined)li.append(el('small','Reported courier fee: '+money(event.price)));
        if(event.history?.length){const details=el('details'),summary=el('summary',`${event.history.length} dated courier scans`),scans=el('ol',undefined,'fulfillment-timeline');details.append(summary,scans);
          for(const scan of [...event.history].reverse()){const entry=el('li');entry.append(el('b',labels[scan.status]||scan.status),el('time',date(scan.updatedAt)));if(scan.note)entry.append(el('p',scan.note));if(scan.locationName)entry.append(el('small',scan.locationName));scans.append(entry);}li.append(details);}
        target.append(li);
      }
    }
    function renderDetail(data){
      const order=data.order,shipping=order.snapshot.shipping,content=q('[data-fulfillment-detail]');content.replaceChildren();historyVersion++;
      q('[data-fulfillment-title]').textContent=order.customer.name||'Order details';q('[data-fulfillment-subtitle]').textContent=order.id+' · '+date(order.createdAt);
      const overview=el('div',undefined,'fulfillment-overview');overview.append(badge(order.fulfillmentState),el('span','Payment: '+order.state.replaceAll('_',' '),'fulfillment-badge'));content.append(overview);
      if(data.courierWritesEnabled===false)content.append(el('p','Courier booking and cancellation are paused. Existing tracking remains available.','fulfillment-warning'));
      if(order.paymentReview||order.fulfillmentReview){const warning=el('div',undefined,'fulfillment-warning');warning.append(el('b','This order needs review'),el('p',order.paymentReview?'Payment requires review before a pickup can be arranged.':'Courier events conflict with an earlier cancelled shipment. Review all shipment attempts before proceeding.'));content.append(warning);}
      if(data.pickupIssue)content.append(el('p',data.pickupIssue,'fulfillment-warning'));
      if(order.acceptedAt)content.append(el('p','Accepted '+date(order.acceptedAt)));
      if(data.refreshAvailableAt&&Date.parse(data.refreshAvailableAt)>Date.now())content.append(el('p','Another courier refresh can be requested after '+date(data.refreshAvailableAt)+'. Reload this page to see incoming updates.','fulfillment-help'));
      content.append(el('h3','Items to prepare'),items(order));
      const totals=el('dl',undefined,'fulfillment-totals');for(const [label,value] of [['Products',order.subtotal],['Delivery paid by customer',order.shippingAmount],['Order total',order.total]]){const pair=el('div');pair.append(el('dt',label),el('dd',money(value)));totals.append(pair);}content.append(totals);
      if(!shipping.skipped){content.append(el('h3','Saved delivery details'),addresses(order),el('p',[shipping.quote?.courier||shipping.courierCode,shipping.quote?.service||shipping.serviceCode].filter(Boolean).join(' · '),'fulfillment-help'));}
      if(data.shipments.length){content.append(el('h3','Shipments'));for(const shipment of data.shipments){const card=el('details',undefined,'fulfillment-card fulfillment-shipment'),summary=el('summary');card.open=shipment===data.shipments[0];summary.append(el('b','Shipment '+shipment.sequence),badge(shipment.state));card.append(summary,
          el('p','Pickup reference: '+shipment.reference,'fulfillment-reference'),el('small',shipment.providerId?'Courier order: '+shipment.providerId:'Waiting for courier confirmation'));
          if(shipment.tracking.waybillId)card.append(el('p','Waybill: '+shipment.tracking.waybillId));
          if(shipment.statusAt)card.append(el('small','Courier status time: '+date(shipment.statusAt)));else if(shipment.statusReceivedAt)card.append(el('small','Status received '+date(shipment.statusReceivedAt)+' · Courier time unavailable'));
          if(shipment.actualPrice!==null)card.append(el('p','Reported courier fee: '+money(shipment.actualPrice)+' · Difference from checkout: '+money(shipment.actualPrice-order.shippingAmount)));
          const links=el('div',undefined,'fulfillment-tracking');for(const [label,url] of [['Open courier tracking',shipment.tracking.link],['Delivery proof',shipment.tracking.proofLink]]){const a=external(label,url);if(a)links.append(a);}card.append(links);content.append(card);}
        content.append(el('p','Cancelling a pickup changes the courier request. Refunds and returned stock are handled separately.','fulfillment-help'));
      }
      const active=data.jobs.filter(j=>j.state!=='succeeded');if(active.length){content.append(el('h3','Courier operations'));for(const job of active){const warning=el('div',undefined,['uncertain','dead'].includes(job.state)?'fulfillment-warning':'fulfillment-help');
          warning.append(el('b',jobLabels[job.kind]+' · '+({queued:'Queued',running:'In progress',retry:'Waiting to retry',uncertain:job.exhausted?'Needs operator review':'Awaiting reconciliation',dead:'Needs operator review'}[job.state]||job.state)));
          warning.append(el('p',job.error||'Your courier request is saved and waiting to be processed.'));if(['uncertain','dead'].includes(job.state))warning.append(el('small','Reference: '+job.id));content.append(warning);}}
      content.append(el('h3','Shipment history'));const timeline=el('ol',undefined,'fulfillment-timeline');renderHistory(timeline,data.history,data.shipments);content.append(timeline);
      if(!data.history.length)timeline.append(el('li','Courier updates will appear after pickup is requested.'));
      if(data.historyCursor){let before=data.historyCursor;const version=historyVersion,more=button('Load older history',async()=>{more.disabled=true;try{const older=await api('GET',path(order.id)+'?before='+encodeURIComponent(before));if(version!==historyVersion)return;renderHistory(timeline,older.history,data.shipments);before=older.historyCursor;more.hidden=!before;more.textContent='Load older history';}catch{more.textContent='Could not load history. Retry';}finally{more.disabled=false;}});content.append(more);}
      const buttons=q('[data-fulfillment-actions]');buttons.replaceChildren();
      if(pending[order.id]){const b=button('Check original '+actions[pending[order.id].kind].toLowerCase()+' request',()=>begin(pending[order.id].kind),true);b.dataset.fulfillmentAction='recover';buttons.append(b);}
      else for(const [kind,label] of Object.entries(actions)){if(!actionAvailable(data,kind))continue;const b=button(label,()=>begin(kind),['accept','pickup'].includes(kind));b.dataset.fulfillmentAction=kind;buttons.append(b);}
      root.querySelectorAll('[data-fulfillment-open]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.fulfillmentOpen===order.id)));controls();
    }
    async function loadDetail(id,focus=false){
      const version=++detailVersion;selectedId=id;detail=null;q('[data-fulfillment-actions]').replaceChildren();q('[data-fulfillment-title]').textContent='Loading order…';message('[data-fulfillment-error]','');controls();
      try{const data=await api('GET',path(id));if(version!==detailVersion)return false;detail=data;renderDetail(data);if(focus){q('[data-fulfillment-title]').focus({preventScroll:true});if(matchMedia('(max-width:750px)').matches)q('[data-fulfillment-title]').scrollIntoView({block:'start',behavior:'smooth'});}return true;}
      catch(error){if(version===detailVersion){q('[data-fulfillment-title]').textContent='Order could not be loaded';q('[data-fulfillment-detail]').replaceChildren();message('[data-fulfillment-error]',error.message+' Use Reload to try again.');}return false;}
    }
    function begin(kind){
      if(busy||!detail)return;review=detail;mode=kind;blocked=false;const saved=pending[review.order.id];
      q('#fulfillment-dialog-title').textContent=actions[kind];q('[data-fulfillment-context]').textContent=review.order.id+' · '+review.order.customer.name;
      form.elements.note.value=saved?.note||'';q('[data-fulfillment-note-field]').hidden=kind!=='cancel_pickup';
      const preview=q('[data-fulfillment-preview]');preview.replaceChildren();if(kind==='pickup')preview.append(addresses(review.order),items(review.order));
      else if(kind==='accept')preview.append(items(review.order));else preview.append(el('p','Shipment '+(review.shipments[0]?.sequence||'')+' · '+(review.shipments[0]?.reference||'')));
      q('[data-fulfillment-help]').textContent={accept:'Confirm that you can prepare these paid items. Arrange pickup when the package is ready.',pickup:'The courier will collect from this saved pickup address. Confirm the package is ready and both addresses are correct.',cancel_pickup:'The courier must confirm cancellation. The order remains paid and its stock stays allocated.',refresh:'Request the latest status, waybill, and fee from the courier.'}[kind];
      message('[data-fulfillment-form-error]',saved?'The previous response was not confirmed. Check the original request to recover its result.':'');dialog.showModal();controls();
    }
    async function submit(event){
      event.preventDefault();if(busy||!review||!storageReady)return;const id=review.order.id,prior=pending[id];
      if(!prior&&(!actionAvailable(review,mode)||blocked||(mode==='cancel_pickup'&&form.elements.note.value.trim().length<5)))return;
      const body=prior||{kind:mode,note:mode==='cancel_pickup'?form.elements.note.value.trim():'',revision:review.order.revision,requestKey:crypto.randomUUID().replaceAll('-','')};
      try{savePending({...pending,[id]:body});}catch{message('[data-fulfillment-form-error]','The browser could not save this request. Enable session storage before continuing.');return;}
      busy=true;controls();message('[data-fulfillment-form-error]','');
      try{const saved=await api('POST',path(id),body);if(saved.receipt?.orderId!==id||saved.receipt?.kind!==body.kind||saved.receipt?.revision!==body.revision+1)throw Error('The saved action receipt is incomplete.');const next={...pending};delete next[id];try{savePending(next);}catch{pending=next;}
        dialog.close();status(actions[body.kind]+' saved. Courier changes appear after the provider confirms them.');await list();await loadDetail(id);}
      catch(error){const definite=!prior&&[400,401,403,404,409,422].includes(error.status);
        if(definite){const next={...pending};delete next[id];try{savePending(next);}catch{pending=next;}blocked=true;message('[data-fulfillment-form-error]',error.message+' Close this review and reload the order before continuing.');}
        else message('[data-fulfillment-form-error]','The response could not be confirmed. Check the original request; its details are saved for recovery.');
      }finally{busy=false;recoveryNotice();controls();}
    }
    form.addEventListener('submit',submit);form.elements.note.addEventListener('input',controls);
    root.querySelectorAll('[data-fulfillment-close]').forEach(b=>b.addEventListener('click',()=>{if(!busy)dialog.close();}));dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
    dialog.addEventListener('close',()=>{if(detail)renderDetail(detail);});
    q('[data-fulfillment-search]').addEventListener('submit',event=>{event.preventDefault();void list();});q('[data-fulfillment-filter]').addEventListener('change',()=>void list());
    q('[data-fulfillment-more]').addEventListener('click',()=>void list(true));q('[data-fulfillment-refresh]').addEventListener('click',()=>void list());q('[data-fulfillment-reload]').addEventListener('click',()=>void loadDetail(selectedId));
    void list().then(()=>{const id=new URLSearchParams(location.search).get('order');if(/^EZK-[SP]-[A-F0-9]{24}$/.test(id||''))void loadDetail(id);});
    // Refresh saved state while an operation is running, without sending another courier request.
    setInterval(()=>{if(!document.hidden&&!dialog.open&&!busy&&detail?.jobs.some(j=>['queued','running','retry','uncertain'].includes(j.state)))void loadDetail(selectedId);},15000);
  }
  globalThis.EzkartFulfillment={mount};
})();
