(() => {
  const labels={creating:'Creating',pending:'Pending',paid:'Paid',failed:'Failed',expired:'Expired',cancelled:'Cancelled',partially_refunded:'Partially refunded',refunded:'Refunded',
    'needs-processing':'Needs processing',processing:'Being processed',shipped:'Shipped',delivered:'Delivered',attention:'Needs review','not-required':'Delivery not required'};
  const activityLabels={'checkout.created':'Order created','payment.instructions':'Payment instructions saved','payment.succeeded':'Payment confirmed','payment.failed':'Payment attempt failed',
    'checkout.expired':'Checkout expired','checkout.cancelled':'Checkout cancelled','fulfillment.accept':'Order accepted','fulfillment.pickup':'Pickup requested','fulfillment.cancel_pickup':'Pickup cancellation requested','fulfillment.refresh':'Tracking refresh requested'};
  const money=value=>new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(typeof value==='string'?BigInt(value):value);
  const date=value=>window.EzkartAdminFormat.date(value);
  const el=(tag,text,className='')=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);if(className)n.className=className;return n;};
  const button=(label,action)=>{const n=el('button',label,'ui-button');n.type='button';n.addEventListener('click',action);return n;};
  const badge=state=>el('span',labels[state]||state||'Awaiting payment','commerce-order-badge'+(['paid','delivered'].includes(state)?' good':state==='attention'?' attention':''));
  const link=(label,view,id)=>{const a=el('a',label,'ui-button');a.href='?'+new URLSearchParams({page:view,order:id});return a;};
  const reference=/^EZK-[SP]-[A-F0-9]{24}$/;
  const base='/v1/commerce/orders',fields=['q','state','queue','from','to'];
  function mount({request}){
    const root=document.querySelector('[data-commerce-orders]');if(!root)return;
    const q=s=>root.querySelector(s),form=q('[data-orders-filters]'),rows=q('[data-orders-rows]'),detail=q('[data-orders-detail]'),globalSearch=document.getElementById('global-search');
    const api=path=>request('GET',path,undefined,{timeoutMs:15000});
    let listVersion=0,detailVersion=0,selected='',cursor=null,next=null,previous=null,loading=false,loaded=false,filters={};
    const formFilters=()=>Object.fromEntries(fields.map(field=>[field,form.elements[field].value.trim()]));
    const message=(selector,text)=>{q(selector).textContent=text;q(selector).hidden=!text;};
    const pageControls=()=>{q('[data-orders-previous]').disabled=loading||!previous;q('[data-orders-next]').disabled=loading||!next;rows.setAttribute('aria-busy',String(loading));};
    function urlUpdate(push=false){
      const url=new URL(location.href);url.searchParams.delete('fulfillment');for(const field of fields){const value=filters[field];if(value&&value!=='all')url.searchParams.set(field,value);else url.searchParams.delete(field);}
      if(cursor)url.searchParams.set('cursor',cursor);else url.searchParams.delete('cursor');
      if(selected)url.searchParams.set('order',selected);else url.searchParams.delete('order');
      history[push?'pushState':'replaceState']({},'',url);
    }
    function readUrl(){
      const query=new URLSearchParams(location.search);
      for(const field of fields){form.elements[field].value=query.get(field)||(field==='state'||field==='queue'?'all':'');form.elements[field].dispatchEvent(new Event('change',{bubbles:true}));}
      // Dashboard links use the older fulfillment parameter for the same queue.
      if(!query.has('queue')&&query.has('fulfillment')){form.elements.queue.value=query.get('fulfillment');form.elements.queue.dispatchEvent(new Event('change',{bubbles:true}));}
      filters=formFilters();if(globalSearch)globalSearch.value=filters.q;
      cursor=query.get('cursor')||null;next=null;previous=null;rows.replaceChildren();loaded=false;return query.get('order');
    }
    function closeDetail(update=true){
      detailVersion++;selected='';detail.hidden=true;q('[data-orders-detail-content]').replaceChildren();
      rows.querySelectorAll('button').forEach(b=>b.setAttribute('aria-expanded','false'));if(update)urlUpdate();
    }
    function renderRows(items){
      rows.replaceChildren();
      for(const item of items){const row=el('tr'),orderCell=el('td'),open=button(item.id,()=>void loadDetail(item.id,true));open.className='order-link';open.dataset.orderOpen=item.id;
        open.setAttribute('aria-expanded',String(selected===item.id));open.setAttribute('aria-controls','commerce-order-detail-title');orderCell.append(open);
        const customer=el('td');customer.append(el('b',item.customerName||'Customer'),el('small',item.customerEmail));
        const products=el('td');products.append(el('b',item.firstItem||'Order items'),el('small',`${item.unitCount||0} units · ${item.itemCount} items`));
        const payment=el('td');payment.append(badge(item.state));if(item.additionalAmount>0)payment.append(el('small','Additional payment requires review'));
        const fulfillment=el('td');fulfillment.append(badge(item.queue));row.append(orderCell,customer,products,payment,fulfillment,el('td',money(item.total)),el('td',date(item.createdAt)));rows.append(row);
      }
    }
    async function loadList({reset=false,push=false,applyFilters=false,targetCursor=cursor}={}){
      const version=++listVersion;if(reset){if(applyFilters)filters=formFilters();cursor=null;targetCursor=null;previous=null;next=null;rows.replaceChildren();loaded=false;}
      loading=true;pageControls();message('[data-orders-list-status]',loaded?'Updating orders…':'Loading orders…');
      const query=new URLSearchParams({limit:'25'});for(const field of fields){const value=filters[field];if(value)query.set(field,value);}if(targetCursor)query.set('cursor',targetCursor);
      try{const data=await api(base+'?'+query);if(version!==listVersion)return;
        if(!Array.isArray(data.items)||!data.summary||typeof data.pageCursor!=='string')throw Error('The order response was incomplete.');
        for(const node of root.querySelectorAll('[data-orders-total]')){const key=node.dataset.ordersTotal;node.textContent=key==='confirmedAmount'?money(data.summary[key]):Number(data.summary[key]).toLocaleString();}
        document.querySelectorAll('[data-order-total]').forEach(n=>n.textContent=data.summary.total.toLocaleString());
        message('[data-orders-availability]',data.enabled&&root.dataset.preview!=='1'?'':'Order processing is not enabled for this store yet.');
        next=data.nextCursor;previous=data.previousCursor;cursor=data.pageCursor;renderRows(data.items);loaded=true;
        message('[data-orders-list-status]',data.items.length?'':data.matching===0?'No orders match these filters.':'No more orders in this view. Refresh to include status changes.');
        q('[data-orders-count]').textContent=`${data.items.length} shown · ${data.matching.toLocaleString()} matching orders`;
        urlUpdate(push);
      }catch(error){if(version===listVersion){message('[data-orders-list-status]',`${error.message} Use Refresh orders to try again.${loaded?' Previously loaded orders are still shown.':''}`);if(!loaded)q('[data-orders-count]').textContent='';}}
      finally{if(version===listVersion){loading=false;pageControls();}}
    }
    function addressCard(title,contact,address){
      const card=el('article',undefined,'commerce-order-card');card.append(el('h3',title),el('b',contact?.name||'Contact unavailable'));
      for(const value of [contact?.email,contact?.phone,address?.address,[address?.location,address?.postalCode].filter(Boolean).join(' · '),address?.note])if(value)card.append(el('p',value));
      return card;
    }
    function historySection(kind,data,id,version){
      const section=el('section'),title=kind==='captures'?'Verified payments':'Order activity',list=el('ol',undefined,'commerce-order-history');section.append(el('h3',title),list);
      function append(items){for(const entry of items){const li=el('li');li.append(el('b',kind==='captures'?`${money(entry.amount)} · ${entry.kind==='duplicate_payment'?'Additional payment — review required':'Order payment'}`:activityLabels[entry.type]||entry.type.replaceAll(/[._]/g,' ')),el('time',(kind==='captures'?'Verified ':'Recorded ')+date(entry.createdAt)));
          if(kind==='captures')li.append(el('small','DOKU reference: '+entry.reference));else li.append(el('small','Order revision '+entry.revision));list.append(li);}}
      append(data.items);if(!data.items.length)list.append(el('li',kind==='captures'?'No verified payments recorded.':'No activity recorded.'));
      let cursor=data.nextCursor;if(cursor){const more=button('Load older '+(kind==='captures'?'payments':'activity'),async()=>{more.disabled=true;try{const older=await api(base+'/'+id+'/'+kind+'?cursor='+encodeURIComponent(cursor));if(version!==detailVersion)return;append(older.items);cursor=older.nextCursor;more.hidden=!cursor;more.textContent='Load older '+(kind==='captures'?'payments':'activity');}catch{if(version===detailVersion)more.textContent='Could not load history. Retry';}finally{more.disabled=false;}});section.append(more);}
      return section;
    }
    function renderDetail(data,version){
      const order=data.order,content=q('[data-orders-detail-content]');content.replaceChildren();
      q('#commerce-order-detail-title').textContent=order.snapshot.customer.name||'Order details';q('[data-orders-reference]').textContent=order.id+' · '+date(order.createdAt);
      const badges=el('div',undefined,'commerce-order-buttons');badges.append(badge(order.state),badge(order.queue));content.append(badges);
      if(order.review)content.append(el('p','Review the payment, stock and delivery records before continuing fulfillment.','commerce-orders-notice'));
      const items=el('section');items.append(el('h3','Ordered items'));for(const item of order.items){const row=el('div',undefined,'commerce-order-line'),info=el('div');info.append(el('b',item.title),el('small',[item.variantName,item.sku].filter(Boolean).join(' · ')),el('small',`${item.quantity} × ${money(item.price)}`));row.append(info,el('b',money(item.quantity*item.price)));items.append(row);}content.append(items);
      const totals=el('dl',undefined,'commerce-order-totals');for(const [label,value] of [['Products',order.subtotal],['Shipping',order.shippingAmount],['Order total',order.total],['Confirmed order payment',order.confirmedAmount],['Additional payments',order.additionalAmount]]){const pair=el('div');pair.append(el('dt',label),el('dd',money(value)));totals.append(pair);}content.append(totals);
      if(order.expiresAt)content.append(el('small','Payment expiry: '+date(order.expiresAt)));
      const addresses=el('div',undefined,'commerce-order-columns');addresses.append(addressCard('Customer',order.snapshot.customer,order.snapshot.destination));
      if(!order.shippingSkipped&&order.shippingKind!=='none'){addresses.append(addressCard('Saved pickup',order.snapshot.origin,order.snapshot.origin));if(order.snapshot.returnAddress)addresses.append(addressCard('Saved return address',order.snapshot.returnAddress,order.snapshot.returnAddress));}
      content.append(addresses,el('p',order.shippingKind==='none'?'This order contains digital files and does not require a courier.':order.shippingSkipped?'Delivery skipped for this sandbox order.':[order.snapshot.courier,order.snapshot.service].filter(Boolean).join(' · ')));
      const inventory=el('p');inventory.textContent=data.inventory.map(s=>`${s.quantity} units ${s.state==='committed'?'deducted from stock':s.state==='reserved'?'reserved':s.state==='released'?'released':s.state}`).join(' · ');if(data.inventory.length)content.append(inventory);
      if(data.operations.length){const pending=el('div',undefined,'commerce-order-card');pending.append(el('h3','Processing updates'));
        for(const operation of data.operations){const name=operation.kind.startsWith('payment.')?'Payment request':operation.kind.startsWith('shipment.')?'Courier request':'Notification';pending.append(el('p',`${name}: ${operation.state.replaceAll('_',' ')}${operation.count>1?' ('+operation.count+')':''}`));}content.append(pending);}
      const actions=el('div',undefined,'commerce-order-buttons');actions.append(link('Open fulfillment','fulfillment',order.id),link('Open returns','returns',order.id));
      if(JSON.parse(document.body.dataset.adminProfile||'{}')?.canEdit)actions.append(link('Message buyer','messages',order.id));
      if(order.fulfillmentState==='stock_review'){const a=el('a','Review stock','ui-button');a.href='?page=inventory&review='+encodeURIComponent(order.id);actions.append(a);}
      content.append(actions,historySection('captures',data.captures,order.id,version),historySection('activity',data.activity,order.id,version));
    }
    async function loadDetail(id,focus=false){
      if(!reference.test(id||''))return;const version=++detailVersion;selected=id;detail.hidden=false;q('[data-orders-detail-content]').replaceChildren();
      q('#commerce-order-detail-title').textContent='Order details';q('[data-orders-reference]').textContent=id;message('[data-orders-detail-status]','Loading order…');urlUpdate(focus);
      rows.querySelectorAll('[data-order-open]').forEach(n=>n.setAttribute('aria-expanded',String(n.dataset.orderOpen===id)));
      if(focus){q('#commerce-order-detail-title').focus({preventScroll:true});detail.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'instant':'smooth'});}
      try{const data=await api(base+'/'+id);if(version!==detailVersion)return;renderDetail(data,version);message('[data-orders-detail-status]','');}
      catch(error){if(version===detailVersion)message('[data-orders-detail-status]',error.message+' Use Reload details to try again.');}
    }
    form.addEventListener('submit',event=>{event.preventDefault();if(globalSearch)globalSearch.value=form.elements.q.value;closeDetail(false);void loadList({reset:true,push:true,applyFilters:true});});
    q('[data-orders-clear]').addEventListener('click',()=>{form.reset();if(globalSearch)globalSearch.value='';for(const field of ['state','queue'])form.elements[field].dispatchEvent(new Event('change',{bubbles:true}));closeDetail(false);void loadList({reset:true,push:true,applyFilters:true});});
    q('[data-orders-refresh]').addEventListener('click',()=>void loadList({reset:true}));
    q('[data-orders-next]').addEventListener('click',()=>{if(loading||!next)return;void loadList({targetCursor:next,push:true});});
    q('[data-orders-previous]').addEventListener('click',()=>{if(loading||!previous)return;void loadList({targetCursor:previous,push:true});});
    q('[data-orders-detail-reload]').addEventListener('click',()=>void loadDetail(selected));
    q('[data-orders-detail-close]').addEventListener('click',()=>{const id=selected;closeDetail();rows.querySelector(`[data-order-open="${id}"]`)?.focus();});
    addEventListener('popstate',()=>{closeDetail(false);const id=readUrl();void loadList();if(reference.test(id||''))void loadDetail(id);});
    const id=readUrl();
    if(globalSearch){globalSearch.placeholder='Search orders · press Enter';globalSearch.value=form.elements.q.value;globalSearch.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();form.elements.q.value=globalSearch.value;form.requestSubmit();}});}
    void loadList();if(reference.test(id||''))void loadDetail(id);
  }
  globalThis.EzkartCommerceOrders={mount};
})();
