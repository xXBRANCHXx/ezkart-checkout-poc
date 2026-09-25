(() => {
  const el=(tag,text,className='')=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=String(text);if(className)node.className=className;return node;};
  const fmt=value=>Number(value).toLocaleString();
  const newKey=()=>crypto.randomUUID().replaceAll('-','');
  const path=id=>'/v1/inventory/reviews'+(id?'/'+encodeURIComponent(id):'');
  function mount({request,root,onStockChanged}) {
    if(!root)return;
    const q=selector=>root.querySelector(selector),dialog=q('[data-stock-dialog]'),note=q('[data-stock-note]'),confirmed=q('[data-stock-confirm]');
    let cursor=null,listVersion=0,reviewVersion=0,review=null,selectedOrderId='',requestKey='',busy=false,loadingReview=false,uncertain=null,blocked=false;
    const message=(selector,text)=>{const node=q(selector);node.textContent=text||'';node.hidden=!text;};
    function controls(){
      note.disabled=busy||Boolean(uncertain)||!review?.canResolve;
      confirmed.disabled=note.disabled||blocked;
      q('[data-stock-apply]').disabled=busy||(!uncertain&&(!review?.canResolve||blocked||!confirmed.checked||note.value.trim().length<3));
      q('[data-stock-apply]').textContent=uncertain?'Retry confirmation':'Allocate stock and continue';
      q('[data-stock-reload]').disabled=busy||loadingReview||Boolean(uncertain);
      root.querySelectorAll('[data-stock-close]').forEach(button=>button.disabled=busy||Boolean(uncertain));
    }
    async function list(more=false){
      const version=++listVersion;message('[data-stock-status]','Loading paid orders…');q('[data-stock-more]').disabled=true;
      try{const data=await request('GET',path()+'?limit=20'+(more&&cursor?'&cursor='+encodeURIComponent(cursor):''));if(version!==listVersion)return;
        if(!more)q('[data-stock-list]').replaceChildren();cursor=data.nextCursor;
        for(const item of data.items){const row=el('li'),copy=el('div'),button=el('button','Review stock','ui-button');
          copy.append(el('b',item.id),el('small',`${item.customerName} · ${fmt(item.quantity)} units${item.paymentReview?' · Payment review required':''}`));button.type='button';button.dataset.stockOpen=item.id;button.addEventListener('click',()=>void open(item.id));row.append(copy,button);q('[data-stock-list]').append(row);}
        q('[data-stock-more]').hidden=!cursor;message('[data-stock-status]',q('[data-stock-list]').children.length?'Fulfillment is on hold for these paid orders.':'No paid orders need stock review.');return true;
      }catch(error){if(version===listVersion)message('[data-stock-status]',error.message||'Paid orders could not be loaded. Refresh to retry.');return false;}
      finally{if(version===listVersion)q('[data-stock-more]').disabled=false;}
    }
    async function open(orderId,reload=false){
      if(busy||uncertain)return;
      const version=++reviewVersion;selectedOrderId=orderId;loadingReview=true;review=null;blocked=false;confirmed.checked=false;if(!reload)note.value='';
      requestKey=newKey();message('[data-stock-error]','');message('[data-stock-warning]','');q('[data-stock-order]').textContent='Loading '+orderId+'…';q('[data-stock-lines]').replaceChildren();controls();if(!dialog.open)dialog.showModal();
      try{const data=await request('GET',path(orderId));if(version!==reviewVersion||!dialog.open)return;review=data;
        q('[data-stock-order]').textContent=data.order.id+' · '+data.order.customerName;
        message('[data-stock-warning]',data.reason);q('[data-stock-lines]').replaceChildren(...data.items.map(item=>{
          const row=el('tr'),original=el('td'),current=el('td'),needed=el('td',fmt(item.quantity)),available=el('td',item.current?fmt(item.current.available):'Unavailable');
          original.append(el('b',item.title),el('small',item.sku));
          if(item.current){current.append(el('b',item.current.title),el('small',item.current.sku),el('small',`${fmt(item.current.onHand)} on hand · ${fmt(item.current.reserved)} reserved`));if(item.current.hidden||item.current.status==='archived')current.append(el('small',item.current.hidden?'Hidden option':'Archived product'));}
          else current.append(el('b','Original option unavailable'));
          if(!item.current||item.current.available<item.quantity)available.className='inv-zero';
          row.append(original,current,needed,available);[...row.children].forEach((cell,index)=>cell.dataset.label=['Original order item','Current inventory','Needed','Available'][index]);return row;
        }));
        if(data.receipt)message('[data-stock-warning]',`Stock was allocated. Reference ${data.receipt.id}.`);
      }catch(error){if(version===reviewVersion)message('[data-stock-error]',error.message);}
      finally{if(version===reviewVersion){loadingReview=false;controls();}}
    }
    async function apply(){
      if(busy||q('[data-stock-apply]').disabled)return;
      const body=uncertain||{requestKey,revision:review.order.revision,confirmed:true,note:note.value.trim(),items:review.items.map(item=>({orderItemId:item.orderItemId,productRevision:item.current.revision}))};
      const orderId=review.order.id;busy=true;controls();message('[data-stock-error]','');
      try{const result=await request('POST',path(orderId),body);uncertain=null;dialog.close();reviewVersion++;const listed=await list();
        try{await onStockChanged();message('[data-stock-status]',`Stock allocated for ${orderId}. Reference ${result.receipt.id}. Fulfillment can continue.${listed?'':' The order list could not be refreshed. Use Refresh orders to retry.'}`);}
        catch(error){message('[data-stock-status]',`Stock was allocated for ${orderId}. Refresh inventory to see the latest quantities. ${error.message}`);}
      }catch(error){
        if(!error.status||error.status<400||error.status>=500){uncertain=body;message('[data-stock-error]',`${error.message} Confirmation is unavailable. Retry this same request to check whether stock was allocated.`);}
        else{blocked=true;message('[data-stock-error]',`${error.message} Reload the review and check it again before continuing.`);}
      }finally{busy=false;controls();}
    }
    q('[data-stock-refresh]').addEventListener('click',()=>void list());q('[data-stock-more]').addEventListener('click',()=>void list(true));
    q('[data-stock-reload]').addEventListener('click',()=>{if(selectedOrderId)void open(selectedOrderId,true);});
    note.addEventListener('input',controls);confirmed.addEventListener('change',controls);q('[data-stock-apply]').addEventListener('click',()=>void apply());
    root.querySelectorAll('[data-stock-close]').forEach(button=>button.addEventListener('click',()=>{if(!busy&&!uncertain){reviewVersion++;dialog.close();}}));
    dialog.addEventListener('cancel',event=>{if(busy||uncertain)event.preventDefault();else reviewVersion++;});
    window.addEventListener('beforeunload',event=>{if(busy||uncertain){event.preventDefault();event.returnValue='';}});
    void list();
  }
  globalThis.EzkartStockReviews={mount};
})();
