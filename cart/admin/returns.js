(() => {
  const states={requested:'Awaiting review',approved:'Awaiting arrival',receiving:'Partly received',inspected:'Inspection complete',declined:'Declined',withdrawn:'Withdrawn',closed:'Intake closed'};
  const reasons={damaged:'Damaged item',wrong_item:'Wrong item',not_as_described:'Not as described',changed_mind:'Changed mind',delivery_failed:'Courier return',other:'Other reason'};
  const actions={approve:'Approve return',decline:'Decline request',withdraw:'Withdraw request',inspect:'Record inspection',close:'Close remaining intake'};
  const newKey=()=>crypto.randomUUID().replaceAll('-','');
  const el=(tag,text,className='')=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=String(text);if(className)node.className=className;return node;};
  const date=value=>window.EzkartAdminFormat.date(value);
  const path=id=>'/v1/returns'+(id?'/'+encodeURIComponent(id):'');
  const orderPath=id=>'/v1/returns/orders/'+encodeURIComponent(id);
  const quantities=values=>{const dl=el('dl',undefined,'returns-counts');for(const [label,value] of values){const pair=el('div');pair.append(el('dt',label),el('dd',value));dl.append(pair);}return dl;};
  function mount({request}) {
    const root=document.querySelector('[data-returns]');if(!root)return;
    const api=(method,target,body)=>request(method,target,body,{timeoutMs:method==='GET'?15000:30000});
    const q=selector=>root.querySelector(selector),dialog=q('[data-return-dialog]'),form=q('[data-return-form]');form.id='return-operation';
    let sellerId='',canCreate=false,cursor=null,listVersion=0,detailVersion=0,formVersion=0,selectedId='',detail=null;
    let mode='',overview=null,operationDetail=null,requestKey='',busy=false,loading=false,blocked=false,uncertain=null,recoveredLines=null;
    const message=(selector,text)=>{q(selector).textContent=text||'';q(selector).hidden=!text;};
    const status=text=>{q('[data-return-status]').textContent=text;};
    const pendingKey=()=> 'ezkart.return.pending.'+sellerId;
    const forgetPending=()=>{try{sessionStorage.removeItem(pendingKey());}catch{ /* A repeated confirmation is safe if storage cannot be cleared. */ }};
    function controls(){
      const locked=busy||Boolean(uncertain),ready=!loading&&!blocked;
      q('[data-return-new]').disabled=!canCreate||locked;
      q('[data-return-reload]').disabled=!selectedId||locked;
      q('[data-return-form-reload]').disabled=locked||loading;
      q('[data-return-form-reload]').hidden=mode==='new'&&!overview;
      root.querySelectorAll('[data-return-close]').forEach(button=>button.disabled=locked);
      q('[data-return-lookup]').querySelectorAll('input,button').forEach(node=>node.disabled=locked||loading);
      form.querySelectorAll('input,textarea,select').forEach(node=>node.disabled=locked||loading||node.dataset.unavailable==='true');
      let valid=false;
      if(mode==='new')valid=overview?.canCreate&&form.elements.note.value.trim().length>=3&&[...form.querySelectorAll('[data-return-quantity]')].some(input=>Number(input.value)>0);
      else if(mode==='inspect')valid=operationDetail?.canInspect&&form.elements.privateNote.value.trim().length>=3&&form.elements.confirmed.checked&&[...form.querySelectorAll('[data-return-received]')].some(input=>Number(input.value)>0);
      else valid=operationDetail?.['can'+mode[0]?.toUpperCase()+mode.slice(1)]&&(!['approve','decline','close'].includes(mode)||form.elements.message.value.trim().length>=3);
      q('[data-return-save]').disabled=busy||(!uncertain&&(!ready||!valid));
      q('[data-return-save]').textContent=uncertain?'Retry confirmation':mode==='new'?'Submit return':actions[mode]||'Save';
      q('[data-return-actions]').querySelectorAll('button').forEach(button=>button.disabled=locked);
      q('[data-return-list]').querySelectorAll('button').forEach(button=>button.disabled=locked);
    }
    async function list(more=false){
      const version=++listVersion;q('[data-return-more]').disabled=true;message('[data-return-list-status]','Loading returns…');
      try{const data=await api('GET',path()+'?state='+q('[data-return-filter]').value+'&limit=25'+(more&&cursor?'&cursor='+encodeURIComponent(cursor):''));if(version!==listVersion)return false;
        sellerId=data.sellerId;canCreate=data.canCreate;cursor=data.nextCursor;if(!more)q('[data-return-list]').replaceChildren();
        for(const item of data.items){const li=el('li'),button=el('button',undefined,'returns-case-button');button.type='button';button.dataset.returnOpen=item.id;
          button.setAttribute('aria-pressed',String(selectedId===item.id));button.append(el('span',states[item.state]||item.state,'returns-state'),el('b',item.customerName||'Customer'),el('small',item.orderId),el('small',`${item.received} of ${item.quantity} units received · ${reasons[item.reason]||item.reason}`));
          button.addEventListener('click',()=>{if(!busy&&!uncertain)void loadDetail(item.id);});li.append(button);q('[data-return-list]').append(li);}
        message('[data-return-list-status]',q('[data-return-list]').children.length?'':'No returns match this view.');q('[data-return-more]').hidden=!cursor;
        if(!data.enabled)status('Returns will be available when order processing is enabled for this store.');else if(!canCreate)status('You can review returns. Your account cannot change them.');
        controls();return true;
      }catch(error){if(version===listVersion)message('[data-return-list-status]',error.message+' Use Refresh to try again.');return false;}
      finally{if(version===listVersion)q('[data-return-more]').disabled=false;}
    }
    function renderDetail(data){
      q('[data-return-title]').textContent=states[data.state]||data.state;q('[data-return-subtitle]').textContent=data.order.id+' · '+data.order.customerName;
      const content=q('[data-return-detail]');content.replaceChildren(el('h3',reasons[data.reason]),el('p',data.customerNote));
      content.append(el('p',data.state==='inspected'?'Inspection is complete. A refund decision is still separate from this stock record.':'Receiving a return records goods and stock. It does not issue a refund.','returns-help'));
      const items=el('div',undefined,'returns-items');for(const item of data.items){const card=el('article',undefined,'returns-item');card.append(el('b',item.title),el('small',item.sku),quantities([['Requested',item.quantity],['Received',item.received],['Restocked',item.restocked],['Kept out of stock',item.received-item.restocked]]));
        if(item.current)card.append(el('small',`Current inventory: ${item.current.title} · ${item.current.sku} · ${item.current.onHand} on hand${item.current.hidden?' · Hidden option':''}${item.current.status==='archived'?' · Archived':''}`));
        else card.append(el('small','Original option is unavailable. Received units can be recorded, but cannot be restocked to a different option.'));items.append(card);}
      content.append(el('h3','Original items'),items,el('h3','Return history'));const timeline=el('ol',undefined,'returns-timeline');
      const requested=el('li');requested.append(el('b','Return requested'),el('time',date(data.createdAt)),el('code',data.id));timeline.append(requested);
      const history=actionsList=>{for(const action of actionsList){const entry=el('li');entry.append(el('b',actions[action.kind]||action.kind),el('time',date(action.createdAt)+' · '+action.actor));
        if(action.message)entry.append(el('p',action.message));if(action.privateNote)entry.append(el('p','Private note: '+action.privateNote));
        for(const line of action.receipt?.items||[])entry.append(el('p',`${line.title}: ${line.received} received, ${line.restocked} restocked, ${line.received-line.restocked} kept out of stock.`));
        entry.append(el('code',action.id));timeline.append(entry);}};
      history(data.actions);content.append(timeline);
      if(data.historyCursor){let before=data.historyCursor;const more=el('button','Load older history','ui-button');more.type='button';more.addEventListener('click',async()=>{more.disabled=true;try{const older=await api('GET',path(data.id)+'?before='+encodeURIComponent(before));if(!more.isConnected)return;history(older.actions);before=older.historyCursor;more.hidden=!before;more.textContent='Load older history';}catch(error){more.textContent='Could not load history. Retry';}finally{more.disabled=false;}});content.append(more);}
      q('[data-return-actions]').replaceChildren();
      for(const [kind,label] of Object.entries(actions)){if(!data['can'+kind[0].toUpperCase()+kind.slice(1)])continue;const button=el('button',label,'ui-button'+(['approve','inspect'].includes(kind)?' primary':''));button.type='button';button.dataset.returnAction=kind;button.addEventListener('click',()=>begin(kind));q('[data-return-actions]').append(button);}
      root.querySelectorAll('[data-return-open]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.returnOpen===data.id)));controls();
    }
    async function loadDetail(id){
      const version=++detailVersion;selectedId=id;detail=null;message('[data-return-error]','');q('[data-return-title]').textContent='Loading return…';q('[data-return-actions]').replaceChildren();controls();
      try{const data=await api('GET',path(id));if(version!==detailVersion)return false;detail=data;renderDetail(data);return true;}
      catch(error){if(version===detailVersion){q('[data-return-title]').textContent='Return could not be loaded';q('[data-return-detail]').replaceChildren();message('[data-return-error]',error.message+' Use Reload to try again.');}return false;}
    }
    function inputRow(item,inspect,preserved={}){
      const row=el('article',undefined,'returns-item');row.dataset.returnLine=item.orderItemId;row.append(el('b',item.title),el('small',item.sku));
      row.append(el('small',inspect?`${item.remaining} units still expected. ${item.current?item.current.onHand+' on hand now.':'Original option unavailable; keep received units out of stock.'}`:`${item.availableToReturn} of ${item.ordered} units available to return.`));
      const fields=el('div',undefined,'returns-line-inputs');
      const number=(labelText,attribute,max,value,unavailable=false)=>{const label=el('label',labelText),input=el('input');input.type='number';input.min='0';input.max=String(max);input.step='1';input.inputMode='numeric';input.value=String(value??0);input.setAttribute(attribute,'');input.setAttribute('aria-label',labelText+' — '+item.title);if(unavailable)input.dataset.unavailable='true';label.append(input);fields.append(label);return input;};
      if(!inspect)number('Return quantity','data-return-quantity',item.availableToReturn,preserved.quantity);
      else{const received=number('Received now','data-return-received',item.remaining,preserved.received),restocked=number('Restock now','data-return-restocked',item.remaining,preserved.restocked,!item.current),output=el('output');
        const recalculate=()=>{restocked.max=String(Number(received.value)||0);output.textContent=`${Math.max(0,(Number(received.value)||0)-(Number(restocked.value)||0))} kept out of stock`;};received.addEventListener('input',recalculate);restocked.addEventListener('input',recalculate);recalculate();fields.append(output);}
      row.append(fields);return row;
    }
    const readLines=()=>Object.fromEntries([...form.querySelectorAll('[data-return-line]')].map(row=>[row.dataset.returnLine,{quantity:row.querySelector('[data-return-quantity]')?.value,received:row.querySelector('[data-return-received]')?.value,restocked:row.querySelector('[data-return-restocked]')?.value}]));
    function formDisplay(preserved={}){
      const isNew=mode==='new',inspect=mode==='inspect';q('[data-return-lookup]').hidden=!isNew;q('[data-return-request-fields]').hidden=!isNew;q('[data-return-message-field]').hidden=isNew;
      q('[data-return-private-field]').hidden=!inspect;q('[data-return-confirm-field]').hidden=!inspect;
      q('#return-dialog-title').textContent=isNew?'Open a return':actions[mode];
      q('[data-return-form-context]').textContent=isNew?(overview?overview.order.id+' · '+overview.order.customerName:'Find the original order to choose items.'):(operationDetail.order.id+' · '+operationDetail.order.customerName);
      const lines=isNew?overview?.items||[]:inspect?operationDetail.items.filter(item=>item.remaining>0):[];
      q('[data-return-form-lines]').replaceChildren(...lines.map(item=>inputRow(item,inspect,preserved[item.orderItemId])));
      form.elements.message.required=['approve','decline','close'].includes(mode);form.elements.privateNote.required=inspect;form.elements.note.required=isNew;
      q('[data-return-form-help]').textContent=isNew?(overview?.reason||'Choose only the items the customer intends to return. Stock stays unchanged until an inspection is recorded.'):
        inspect?'Count the units physically received today. Restock only saleable units. Leave items that have not arrived at zero. A refund is a separate action.':
        mode==='approve'?'Give the customer clear return instructions, including the delivery address and any agreed deadline. Approval does not book a courier or send a refund.':
        mode==='close'?'This stops intake of the remaining units. Received units and their stock history are preserved. Explain why intake is ending.':'Explain the decision for the customer. The return history will be preserved.';
      controls();
    }
    function begin(kind){
      if(busy||uncertain||kind!=='new'&&!detail)return;
      ++formVersion;mode=kind;overview=null;operationDetail=detail;requestKey=newKey();blocked=false;recoveredLines=null;form.reset();q('[data-return-lookup]').reset();message('[data-return-form-error]','');form.hidden=false;formDisplay();dialog.showModal();
      if(kind==='new')q('[data-return-lookup] input').focus();else (form.querySelector('textarea:not([disabled])')||q('[data-return-save]')).focus();
    }
    async function refreshForm(orderId=''){
      if(busy||uncertain)return;const version=++formVersion,preserved=recoveredLines||readLines();loading=true;blocked=true;form.elements.confirmed.checked=false;controls();message('[data-return-form-error]','');
      try{if(mode==='new'){const data=await api('GET',orderPath(orderId||overview?.order.id||''));if(version!==formVersion||!dialog.open)return;overview=data;}
        else{const data=await api('GET',path(operationDetail.id));if(version!==formVersion||!dialog.open)return;operationDetail=data;detail=data;renderDetail(data);}
        blocked=false;requestKey=newKey();recoveredLines=null;form.hidden=false;formDisplay(preserved);
      }catch(error){if(version===formVersion)message('[data-return-form-error]',error.message+' Your entries are still here. Reload to try again.');}
      finally{if(version===formVersion){loading=false;controls();}}
    }
    function prepare(){
      if(!form.reportValidity())return null;
      if(mode==='new')return {sellerId,mode,orderId:overview.order.id,target:orderPath(overview.order.id),body:{requestKey,orderRevision:overview.order.revision,reason:form.elements.reason.value,note:form.elements.note.value.trim(),
        items:Object.entries(readLines()).filter(([,item])=>Number(item.quantity)>0).map(([orderItemId,item])=>({orderItemId,quantity:Number(item.quantity)}))}};
      const body={requestKey,revision:operationDetail.revision,orderRevision:operationDetail.order.revision,kind:mode,message:form.elements.message.value.trim()};
      if(mode==='inspect'){body.privateNote=form.elements.privateNote.value.trim();body.confirmed=form.elements.confirmed.checked;body.items=Object.entries(readLines()).filter(([,item])=>Number(item.received)>0).map(([orderItemId,item])=>({orderItemId,received:Number(item.received),restocked:Number(item.restocked),productRevision:Number(item.restocked)>0?operationDetail.items.find(line=>line.orderItemId===orderItemId).current.revision:null}));}
      return {sellerId,mode,orderId:operationDetail.order.id,returnId:operationDetail.id,target:path(operationDetail.id),body};
    }
    async function save(){
      if(busy||q('[data-return-save]').disabled)return;const pending=uncertain||prepare();if(!pending)return;
      try{sessionStorage.setItem(pendingKey(),JSON.stringify(pending));}catch{message('[data-return-form-error]','Your browser could not preserve the confirmation request. Allow site storage and try again.');return;}
      busy=true;controls();message('[data-return-form-error]','');let saved;
      try{saved=await api('POST',pending.target,pending.body);}
      catch(error){if(!error.status||error.status<400||error.status>=500||(uncertain&&[401,403,404].includes(error.status))){uncertain=pending;message('[data-return-form-error]',error.message+' Confirmation is unavailable. Retry this same request to check whether it was saved.');}
        else{uncertain=null;forgetPending();blocked=true;message('[data-return-form-error]',error.message+' Reload details and review the entries before continuing.');}
      }finally{busy=false;controls();}
      if(!saved)return;
      uncertain=null;forgetPending();dialog.close();++formVersion;controls();const id=saved.id||saved.receipt.returnId;
      status((pending.mode==='inspect'?'Inspection recorded. No refund was issued.':'Return updated.')+' Reference '+(saved.receipt?.id||saved.id)+'.');
      await Promise.all([list(),loadDetail(id)]);
    }
    function recoverPending(){
      let pending;try{pending=JSON.parse(sessionStorage.getItem(pendingKey())||'null');}catch{return;}
      if(!pending||pending.sellerId!==sellerId||!/^\/v1\/returns\/(?:orders\/EZK-[SP]-[A-F0-9]{24}|ret_[a-f0-9]{32})$/.test(pending.target)||!pending.body?.requestKey)return;
      uncertain=pending;mode=pending.mode;blocked=false;q('#return-dialog-title').textContent='Confirm the previous return update';q('[data-return-form-context]').textContent=pending.orderId;
      if(mode==='new')overview={order:{id:pending.orderId}};else operationDetail={id:pending.returnId,order:{id:pending.orderId},items:[]};
      recoveredLines=Object.fromEntries((pending.body.items||[]).map(item=>[item.orderItemId,item]));
      for(const field of ['note','message','privateNote','reason'])if(pending.body[field])form.elements[field].value=pending.body[field];
      form.hidden=true;q('[data-return-lookup]').hidden=true;q('[data-return-form-help]').textContent='This tab has an update whose result has not been confirmed. Retry it before recording another change. The same request cannot restore stock twice.';
      message('[data-return-form-error]','The previous confirmation was interrupted.');dialog.showModal();controls();
    }
    q('[data-return-new]').addEventListener('click',()=>begin('new'));q('[data-return-refresh]').addEventListener('click',()=>void list());q('[data-return-more]').addEventListener('click',()=>void list(true));q('[data-return-filter]').addEventListener('change',()=>void list());
    q('[data-return-reload]').addEventListener('click',()=>void loadDetail(selectedId));q('[data-return-form-reload]').addEventListener('click',()=>void refreshForm());
    q('[data-return-lookup]').addEventListener('submit',event=>{event.preventDefault();const id=event.currentTarget.elements.order.value.trim().toUpperCase();if(!/^EZK-[SP]-[A-F0-9]{24}$/.test(id)){message('[data-return-form-error]','Enter the complete order reference.');return;}void refreshForm(id);});
    form.addEventListener('input',controls);form.addEventListener('change',controls);form.addEventListener('submit',event=>{event.preventDefault();void save();});
    root.querySelectorAll('[data-return-close]').forEach(button=>button.addEventListener('click',()=>{if(!busy&&!uncertain){++formVersion;loading=false;dialog.close();}}));
    dialog.addEventListener('cancel',event=>{if(busy||uncertain)event.preventDefault();else{++formVersion;loading=false;}});
    window.addEventListener('beforeunload',event=>{if(busy||uncertain){event.preventDefault();event.returnValue='';}});
    status('Return requests and inspection records for your store.');void list().then(ok=>{if(ok)recoverPending();});
  }
  globalThis.EzkartReturns={mount};
})();
