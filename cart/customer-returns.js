(() => {
  const root=document.querySelector('[data-customer-returns]');if(!root)return;
  const q=selector=>root.querySelector(selector),form=q('[data-cr-form]'),withdraw=q('[data-cr-withdraw-form]');
  const states={requested:'Awaiting review',approved:'Approved · follow the store’s instructions',receiving:'Items partly received',inspected:'Inspection complete',declined:'Request declined',withdrawn:'Request withdrawn',closed:'Return intake closed'};
  const reasons={damaged:'Damaged item',wrong_item:'Wrong item',not_as_described:'Not as described',changed_mind:'Changed mind',delivery_failed:'Courier return',other:'Other reason'};
  const actionLabels={approve:'Store approved the return',decline:'Store declined the request',withdraw:'Request withdrawn',inspect:'Store inspected received items',close:'Store closed remaining intake'};
  const el=(tag,text,className='')=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=String(text);if(className)node.className=className;return node;};
  const key=()=>crypto.randomUUID().replaceAll('-','');
  const date=value=>new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Jakarta'}).format(new Date(value))+' WIB';
  const storageKey='ezkart.customer.return.'+root.dataset.account+'.'+root.dataset.order;
  let overview=null,detail=null,selectedId='',cursor=null,readVersion=0,detailVersion=0,requestKey=key(),busy=false,loading=false,blocked=false,uncertain=null,csrf=root.dataset.csrf;
  const error=text=>{q('[data-cr-error]').textContent=text||'';q('[data-cr-error]').hidden=!text;};
  const status=text=>{q('[data-cr-status]').textContent=text;};
  async function api(method,returnId='',body=null,after='',before=''){
    const url='admin/customer-returns.php?order='+encodeURIComponent(root.dataset.order)+(returnId?'&return='+encodeURIComponent(returnId):'')+(after?'&cursor='+encodeURIComponent(after):'')+(before?'&before='+encodeURIComponent(before):'');
    const response=await fetch(url,{method,credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json',...(body?{'Content-Type':'application/json','X-Ezkart-Csrf':csrf}:{})},body:body?JSON.stringify(body):null,signal:AbortSignal.timeout(method==='GET'?20000:50000)});
    let data;try{data=await response.json();}catch{data={};}
    if(!response.ok||data.ok!==true){const failure=Error(data.error||'The return result could not be read.');failure.status=response.status;throw failure;}
    if(data.csrf)csrf=data.csrf;return data;
  }
  function controls(){
    const locked=busy||Boolean(uncertain);
    root.querySelectorAll('button,input,textarea,select').forEach(node=>node.disabled=locked);
    q('[data-cr-new]').disabled=locked||loading||blocked||!overview?.canCreate;
    q('[data-cr-refresh]').disabled=locked||loading;q('[data-cr-more]').disabled=locked||loading;
    q('[data-cr-submit]').disabled=locked||loading||blocked||!overview?.canCreate||form.elements.note.value.trim().length<3||![...form.querySelectorAll('[data-cr-quantity]')].some(input=>Number(input.value)>0);
    q('[data-cr-withdraw-confirm]').disabled=locked||loading||blocked||!detail?.canWithdraw;
    q('[data-cr-retry]').hidden=!uncertain;q('[data-cr-retry]').disabled=busy;
  }
  function renderItems(){
    const values=Object.fromEntries([...form.querySelectorAll('[data-cr-quantity]')].map(input=>[input.dataset.crQuantity,input.value]));
    q('[data-cr-items]').replaceChildren(...overview.items.map(item=>{const row=el('div',undefined,'cr-item');row.append(el('b',item.title),el('small',`${item.sku} · ${item.availableToReturn} of ${item.ordered} units available to return`));
      const label=el('label','Return quantity'),input=el('input');input.type='number';input.min='0';input.max=String(item.availableToReturn);input.step='1';input.inputMode='numeric';input.value=values[item.orderItemId]||'0';input.dataset.crQuantity=item.orderItemId;input.setAttribute('aria-label','Return quantity — '+item.title);label.append(input);row.append(label);return row;}));
  }
  async function load(more=false){
    if(busy||uncertain)return false;const version=++readVersion;loading=true;controls();error('');
    try{const data=await api('GET','',null,more?cursor:'');if(version!==readVersion)return false;overview=data;cursor=data.nextCursor;
      if(!more)q('[data-cr-list]').replaceChildren();for(const item of data.returns){const li=el('li'),button=el('button');button.type='button';button.dataset.crOpen=item.id;button.append(el('b',states[item.state]),el('small',`${reasons[item.reason]} · ${date(item.createdAt)}`));button.addEventListener('click',()=>void show(item.id));li.append(button);q('[data-cr-list]').append(li);}
      q('[data-cr-more]').hidden=!cursor;status(data.reason||(q('[data-cr-list]').children.length?'Select a request to see its status and the store’s instructions.':'No return requests yet.'));renderItems();blocked=false;requestKey=key();return true;
    }catch(failure){if(version===readVersion){blocked=true;error(failure.message+' Use Refresh returns to try again.');}return false;}
    finally{if(version===readVersion){loading=false;controls();}}
  }
  async function show(id){
    if(busy||uncertain)return;const version=++detailVersion;selectedId=id;detail=null;withdraw.hidden=true;controls();error('');const target=q('[data-cr-detail]');target.hidden=false;target.replaceChildren(el('p','Loading return…'));
    try{const data=await api('GET',id);if(version!==detailVersion)return;detail=data;
      target.replaceChildren(el('h3',states[data.state]),el('p',reasons[data.reason]+': '+data.customerNote));
      for(const item of data.items)target.append(el('p',`${item.title} · ${item.sku}\n${item.received} of ${item.quantity} requested units received by the store.`));
      target.append(el('p','The return and inspection status does not confirm a refund. Check payment updates separately.','cr-help'));
      const history=el('div');target.append(history);const appendHistory=actions=>{for(const action of actions){const entry=el('article',undefined,'cr-history');entry.append(el('b',actionLabels[action.kind]||action.kind),el('time',date(action.createdAt)));if(action.message)entry.append(el('p',action.message));history.append(entry);}};appendHistory(data.actions);
      if(data.historyCursor){let before=data.historyCursor;const more=el('button','Load older updates','copy-button');more.type='button';more.addEventListener('click',async()=>{more.disabled=true;try{const older=await api('GET',id,null,'',before);if(!more.isConnected)return;appendHistory(older.actions);before=older.historyCursor;more.hidden=!before;more.textContent='Load older updates';}catch{more.textContent='Could not load updates. Retry';}finally{more.disabled=false;}});target.append(more);}
      if(data.canWithdraw){const button=el('button','Withdraw request','copy-button');button.type='button';button.dataset.crWithdraw='';button.addEventListener('click',()=>{withdraw.hidden=false;form.hidden=true;withdraw.reset();blocked=false;requestKey=key();controls();withdraw.scrollIntoView({block:'nearest',behavior:'smooth'});});target.append(button);}controls();
    }catch(failure){if(version===detailVersion){target.replaceChildren(el('p',failure.message));const retry=el('button','Reload this return','copy-button');retry.type='button';retry.addEventListener('click',()=>void show(id));target.append(retry);}}
  }
  function forget(){try{sessionStorage.removeItem(storageKey);}catch{ /* Replaying a retained request is safe. */ }}
  async function send(pending){
    if(busy)return;try{sessionStorage.setItem(storageKey,JSON.stringify(pending));}catch{error('Your browser could not preserve the confirmation request. Allow site storage and try again.');return;}
    busy=true;controls();error('');let result;
    try{result=await api('POST',pending.returnId,pending.body);}
    catch(failure){if(!failure.status||failure.status<400||failure.status>=500||(uncertain&&[401,403,404].includes(failure.status))){uncertain=pending;error(failure.message+' Retry confirmation to check the same request.');}
      else{uncertain=null;forget();blocked=true;error(failure.message+' Refresh returns before trying again.');}}
    finally{busy=false;controls();}
    if(!result)return;uncertain=null;forget();form.hidden=true;withdraw.hidden=true;form.reset();await load();await show(result.id||pending.returnId);status(pending.returnId?'Your request was withdrawn.':'Your return request was sent. The store will review it.');controls();
  }
  function recover(){
    let pending;try{pending=JSON.parse(sessionStorage.getItem(storageKey)||'null');}catch{return;}
    if(!pending?.body?.requestKey||typeof pending.returnId!=='string'||(pending.returnId&&!/^ret_[a-f0-9]{32}$/.test(pending.returnId)))return;
    uncertain=pending;status('The previous return update has not been confirmed.');error('Retry confirmation before sending another request. Your original request key will be reused.');controls();
  }
  q('[data-cr-new]').addEventListener('click',()=>{form.hidden=false;withdraw.hidden=true;requestKey=key();blocked=false;controls();form.scrollIntoView({block:'nearest',behavior:'smooth'});});
  q('[data-cr-cancel]').addEventListener('click',()=>{if(!busy&&!uncertain)form.hidden=true;});q('[data-cr-withdraw-cancel]').addEventListener('click',()=>{if(!busy&&!uncertain)withdraw.hidden=true;});
  q('[data-cr-refresh]').addEventListener('click',async()=>{if(await load()&&selectedId)await show(selectedId);});q('[data-cr-more]').addEventListener('click',()=>void load(true));
  q('[data-cr-retry]').addEventListener('click',()=>{if(uncertain)void send(uncertain);});form.addEventListener('input',controls);
  form.addEventListener('submit',event=>{event.preventDefault();if(q('[data-cr-submit]').disabled||!form.reportValidity())return;
    void send({returnId:'',body:{requestKey,orderRevision:overview.order.revision,reason:form.elements.reason.value,note:form.elements.note.value.trim(),items:[...form.querySelectorAll('[data-cr-quantity]')].filter(input=>Number(input.value)>0).map(input=>({orderItemId:input.dataset.crQuantity,quantity:Number(input.value)}))}});});
  withdraw.addEventListener('submit',event=>{event.preventDefault();if(q('[data-cr-withdraw-confirm]').disabled)return;void send({returnId:detail.id,body:{requestKey,revision:detail.revision,orderRevision:detail.order.revision,kind:'withdraw',message:withdraw.elements.message.value.trim()}});});
  window.addEventListener('beforeunload',event=>{if(busy||uncertain){event.preventDefault();event.returnValue='';}});
  void load().then(recover);
})();
