(() => {
  const labels = {opening:'Opening balance',catalog_create:'Product created',catalog_edit:'Product edited',catalog_delete:'Product removed',catalog_duplicate:'Product duplicated',payment:'Payment confirmed',late_payment_allocation:'Late payment stock allocated',return_restock:'Return restocked',count:'Physical count',received:'Stock received',damaged:'Damaged stock',lost:'Lost stock',correction:'Record corrected',alert:'Alert threshold changed'};
  const modes = {
    count:['New count','Enter the total physically counted for each item. Leave uncounted items blank.'],
    received:['Units received','Enter saleable units physically received. They will be added to current stock.'],
    damaged:['Units damaged','Enter units that can no longer be sold, and explain the damage in the note.'],
    lost:['Units lost','Enter missing units and explain the loss in the note.'],
    correction:['Correct total','Enter the corrected total on hand and explain why the record was wrong.'],
    alert:['Alert at','Enter the available-stock level that should trigger a low-stock alert. Stock quantities stay the same.'],
  };
  const el = (tag, text, className = '') => {const node=document.createElement(tag);if(text!==undefined)node.textContent=String(text);if(className)node.className=className;return node;};
  const dataEl=(tag,text)=>{const node=el(tag,text);node.translate=false;return node;};
  const key = row => row.productId+'~'+row.variantId;
  const newKey = () => crypto.randomUUID().replaceAll('-','');
  const fmt = value => Number(value).toLocaleString();
  const counted = (value, noun) => `${fmt(value)} ${noun}${value === 1 ? '' : 's'}`;
  const time=value=>window.EzkartAdminFormat.date(value);
  async function mini(root,request) {
    const version=(root.inventoryReadVersion||0)+1;root.inventoryReadVersion=version;
    const target=root.querySelector('[data-inventory-summary-rows]'),status=root.querySelector('[data-inventory-summary-status]');
    try {
      const [zero,low]=await Promise.all([request('GET','/v1/inventory?limit=5&level=zero'),request('GET','/v1/inventory?limit=5&level=low')]);
      if(root.inventoryReadVersion!==version)return;
      const total=zero.summary.skuCount+low.summary.skuCount;
      status.textContent=total?`${counted(total,'SKU')} ${total===1?'is':'are'} at or below their alert threshold.`:'No items with low stock. Open inventory to review all quantities.';
      target.replaceChildren(...[...zero.items,...low.items].slice(0,5).map(row=>{const item=el('div',undefined,'inv-mini-row'),copy=el('div'),link=dataEl('a',row.title);link.href='?page=inventory&q='+encodeURIComponent(row.sku||row.title);copy.append(link,el('small',`${row.sku} · alert at ${fmt(row.reorderPoint)}`));item.append(copy,el('strong',`${fmt(row.available)} available`,row.available<=0?'inv-zero':'inv-low'));return item;}));
    } catch(error) {if(root.inventoryReadVersion===version)status.textContent=error.message||'Inventory could not be loaded.';}
  }
  async function workspace(root,request) {
    const q = selector => root.querySelector(selector), filters=q('[data-inv-filters]'),kind=q('[data-inv-kind]'),note=q('[data-inv-note]'),dialog=q('[data-inv-review-dialog]');
    let rows=[],nextCursor=null,historyCursor=null,historyProduct='',historyVariant=null,readVersion=0,historyVersion=0;
    let canEdit=false,busy=false,draftRevision=0,requestKey=newKey(),queue=new Map(),dirty=false,saveTimer=0,saveChain=Promise.resolve(true),draftBlocked=false,uncertain=null;
    const status = text => {q('[data-inv-status]').textContent=text;};
    const error = value => {const box=q('[data-inv-error]');box.hidden=!value;box.querySelector('span').textContent=value||'';};
    const draftStatus = text => {q('[data-inv-draft-status]').textContent=text;};
    const payload = () => ({requestKey,kind:kind.value,note:note.value.trim(),items:[...queue.values()]});
    const after = item => kind.value==='alert'?item.quantity:kind.value==='received'?item.beforeQuantity+item.quantity:['damaged','lost'].includes(kind.value)?item.beforeQuantity-item.quantity:item.quantity;
    function controls() {
      kind.disabled=!canEdit||queue.size>0||busy||Boolean(uncertain);
      note.disabled=!canEdit||busy||Boolean(uncertain);
      q('[data-inv-review]').disabled=!canEdit||!queue.size||busy||draftBlocked||Boolean(uncertain);
      q('[data-inv-mobile-review]').disabled=q('[data-inv-review]').disabled;
      q('[data-inv-mobile-review]').textContent=`Review ${counted(queue.size,'change')}`;
      q('[data-inv-discard]').disabled=!canEdit||(!queue.size&&!draftRevision)||busy||Boolean(uncertain);
      q('[data-inv-selected-count]').textContent=String(queue.size);
      q('[data-inv-selected-label]').textContent=queue.size===1?'selected item':'selected items';
      q('[data-inv-input-label]').textContent=modes[kind.value][0];
      q('[data-inv-kind-help]').textContent=modes[kind.value][1];
      root.querySelectorAll('[data-inv-value]').forEach(input=>{input.disabled=!canEdit||busy||Boolean(uncertain);input.min=['received','damaged','lost'].includes(kind.value)?'1':'0';});
      root.querySelectorAll('[data-inv-remove]').forEach(button=>{button.disabled=busy||Boolean(uncertain);});
    }
    function selection() {
      q('[data-inv-selection]').replaceChildren(...[...queue.values()].map(item=>{const row=el('li'),copy=el('span',`${item.label||item.productId}: ${item.quantity}`),remove=el('button','×');remove.type='button';remove.dataset.invRemove='';remove.setAttribute('aria-label','Remove '+(item.label||item.productId));remove.addEventListener('click',()=>{queue.delete(key(item));changed();renderRows();});row.append(copy,remove);return row;}));
      controls();
    }
    function changed() {if(busy||uncertain)return;dirty=true;selection();clearTimeout(saveTimer);draftStatus('Saving count draft…');saveTimer=setTimeout(()=>void saveDraft(),550);}
    function saveDraft() {
      clearTimeout(saveTimer);
      saveChain=saveChain.then(async()=>{
        if(draftBlocked)return false;if(!dirty)return true;
        const current=payload(),sent=JSON.stringify(current);
        try {const data=await request('PUT','/v1/inventory/draft',{revision:draftRevision,payload:current});draftRevision=data.draft.revision;
          dirty=JSON.stringify(payload())!==sent;draftStatus('Count draft saved to your account.');return true;
        } catch(err){if(err.code==='inventory_draft_conflict')draftBlocked=true;error(err.message);draftStatus('Draft needs attention. Your entries are still here.');controls();return false;}
      });return saveChain;
    }
    function renderRows() {
      const fragment=document.createDocumentFragment();
      for(const row of rows){
        const tr=el('tr');tr.dataset.inventoryKey=row.key;const name=el('td'),link=el('button',undefined,'inv-item-link');link.type='button';link.append(dataEl('b',row.title));link.addEventListener('click',()=>{historyProduct=row.productId;historyVariant=row.variantId;q('[data-inv-history-filter]').textContent='History: '+row.title;void loadHistory();});name.append(link,el('small',row.sku));
        if(row.hidden||row.status==='archived')name.append(el('span',row.status==='archived'?'Archived product':'Hidden option','inv-badge'));
        const available=el('td',fmt(row.available),row.available<=0?'inv-zero':row.available<=row.reorderPoint?'inv-low':'');
        const cell=el('td'),input=el('input');input.type='number';input.max='1000000000';input.step='1';input.placeholder='—';input.dataset.invValue=row.key;input.setAttribute('aria-label',modes[kind.value][0]+' for '+row.title);input.value=queue.get(row.key)?.quantity??'';
        input.addEventListener('input',()=>{if(busy||uncertain)return;const value=Number(input.value);if(input.value===''){queue.delete(row.key);changed();return;}
          if(!input.checkValidity()||!Number.isSafeInteger(value)){queue.delete(row.key);changed();input.reportValidity();return;}
          if(!queue.has(row.key)&&queue.size>=100){input.value='';error('Save this batch before selecting more than 100 items.');return;}
          const original=queue.get(row.key);queue.set(row.key,{productId:row.productId,variantId:row.variantId,revision:original?.revision??row.revision,quantity:value,label:row.title,beforeQuantity:original?.beforeQuantity??row.onHand,beforeAlert:original?.beforeAlert??row.reorderPoint});changed();});
        cell.append(input);tr.append(name,el('td',fmt(row.onHand)),el('td',fmt(row.reserved)),available,el('td',fmt(row.reorderPoint)),cell);
        [...tr.children].forEach((td,index)=>{td.dataset.label=['Product / SKU','On hand','Reserved','Available','Alert at',modes[kind.value][0]][index];});fragment.append(tr);
      }
      if(!rows.length){const row=el('tr'),cell=el('td','No physical inventory matches these filters.');cell.colSpan=6;row.append(cell);fragment.append(row);}
      q('[data-inv-rows]').replaceChildren(fragment);q('[data-inv-results]').textContent=`${counted(rows.length,'item')} shown`;q('[data-inv-more]').hidden=!nextCursor;controls();
    }
    async function loadRows(more=false) {
      const version=++readVersion,params=new URLSearchParams(new FormData(filters));params.set('limit','50');if(more&&nextCursor)params.set('cursor',nextCursor);
      status('Loading current inventory…');
      try{const data=await request('GET','/v1/inventory?'+params);if(version!==readVersion)return;rows=more?[...rows,...data.items]:data.items;nextCursor=data.nextCursor;canEdit=data.canEdit;
        for(const name of ['onHand','reserved','available'])q(`[data-inv-metric="${name}"]`).textContent=fmt(data.summary[name]);
        q('[data-inv-metric="lowStock"]').textContent=fmt(data.summary.lowStock)+' / '+fmt(data.summary.outOfStock);renderRows();status(canEdit?'Select an action, then enter quantities for the items you have checked.':'You can view inventory and history. Your account cannot change stock.');
      }catch(err){if(version===readVersion){status('Inventory could not be refreshed.');error(err.message);}}
    }
    async function loadHistory(more=false){
      const version=++historyVersion,params=new URLSearchParams({limit:'30'});if(more&&historyCursor)params.set('cursor',historyCursor);if(historyProduct)params.set('product',historyProduct);if(historyVariant!==null)params.set('variant',historyVariant);
      try{const data=await request('GET','/v1/inventory/history?'+params);if(version!==historyVersion)return;const target=q('[data-inv-history-rows]');if(!more)target.replaceChildren();
        for(const item of data.items){const row=el('tr'),who=el('td'),product=el('td'),reason=el('td');who.append(el('span',time(item.createdAt)),el('small',item.actor));product.append(dataEl('b',item.title),el('small',item.sku));reason.append(el('b',labels[item.reason]||item.reason),dataEl('small',item.note),dataEl('small',item.reference));row.append(who,product,el('td',item.reason==='alert'?'Stock unchanged':`${fmt(item.before)} → ${fmt(item.after)} (${item.delta>0?'+':''}${fmt(item.delta)})`),reason);target.append(row);}
        if(!data.items.length&&!more){const row=el('tr'),cell=el('td','No inventory changes recorded yet.');cell.colSpan=4;row.append(cell);target.append(row);}historyCursor=data.nextCursor;q('[data-inv-history-more]').hidden=!historyCursor;
      }catch(err){error(err.message);}
    }
    async function loadDraft(){const data=await request('GET','/v1/inventory/draft');draftRevision=data.draft?.revision||0;const saved=data.draft?.payload;requestKey=saved?.requestKey||newKey();kind.value=saved?.kind||'count';note.value=saved?.note||'';queue=new Map((saved?.items||[]).map(item=>[key(item),item]));dirty=false;draftBlocked=false;selection();renderRows();draftStatus(saved?'Saved count draft restored. Original stock versions are retained.':'Your count draft saves to your account.');}
    async function review(){error('');if(!canEdit||!queue.size||busy||draftBlocked)return;if(['damaged','lost','correction'].includes(kind.value)&&note.value.trim().length<3){error('Add a note explaining this change.');note.focus();return;}
      if([...queue.values()].some(item=>after(item)<0||after(item)>1000000000)){error('An entered change would produce an invalid stock quantity.');return;}
      if(!await saveDraft())return;
      q('[data-inv-review-note]').textContent=`${labels[kind.value]} · ${counted(queue.size,'item')}. ${note.value.trim()}`;
      q('[data-inv-review-error]').hidden=true;q('[data-inv-apply]').textContent='Apply changes';
      q('[data-inv-review-rows]').replaceChildren(...[...queue.values()].map(item=>{const row=el('tr');row.append(el('td',item.label||item.productId),el('td',fmt(kind.value==='alert'?item.beforeAlert:item.beforeQuantity)),el('td',fmt(after(item))));return row;}));dialog.showModal();}
    async function apply(){if(busy)return;busy=true;controls();dialog.querySelectorAll('button').forEach(button=>button.disabled=true);const body=uncertain||{...payload(),draftRevision};
      try{const data=await request('POST','/v1/inventory/adjustments',body);uncertain=null;queue.clear();draftRevision=0;requestKey=newKey();dirty=false;note.value='';selection();dialog.close();error('');await Promise.all([loadRows(),loadHistory(),loadDraft().catch(err=>error('Changes saved. '+err.message))]);status(`Saved ${counted(data.receipt.items.length,'inventory change')}. Reference ${data.receipt.id}.`);
      }catch(err){const message=q('[data-inv-review-error]');message.hidden=false;message.textContent=err.message;
        if(!err.status||err.status<400||err.status>=500){uncertain=body;message.textContent+=' Confirmation is unavailable. Retry this same change to check whether it was saved.';q('[data-inv-apply]').textContent='Retry confirmation';}
        else{uncertain=null;if(err.code==='inventory_draft_conflict'){draftBlocked=true;error(err.message);}if(err.code==='inventory_conflict'){message.textContent+=' Keep editing, then remove and re-enter the affected items using refreshed stock.';await loadRows();}}
      }finally{busy=false;dialog.querySelectorAll('button').forEach(button=>button.disabled=false);dialog.querySelectorAll('[data-inv-review-close]').forEach(button=>button.disabled=Boolean(uncertain));controls();}}
    filters.addEventListener('submit',event=>{event.preventDefault();void loadRows();});q('[data-inv-more]').addEventListener('click',()=>void loadRows(true));
    q('[data-inv-refresh]').addEventListener('click',()=>void loadRows());q('[data-inv-history-more]').addEventListener('click',()=>void loadHistory(true));
    q('[data-inv-history-reset]').addEventListener('click',()=>{historyProduct='';historyVariant=null;q('[data-inv-history-filter]').textContent='Latest changes across this store';void loadHistory();});
    kind.addEventListener('change',()=>{requestKey=newKey();changed();renderRows();});note.addEventListener('input',changed);
    q('[data-inv-review]').addEventListener('click',()=>void review());q('[data-inv-apply]').addEventListener('click',()=>void apply());
    q('[data-inv-mobile-review]').addEventListener('click',()=>void review());
    root.querySelectorAll('[data-inv-review-close]').forEach(button=>button.addEventListener('click',()=>{if(!busy&&!uncertain)dialog.close();}));dialog.addEventListener('cancel',event=>{if(busy||uncertain)event.preventDefault();});
    q('[data-inv-reload-draft]').addEventListener('click',async()=>{if((dirty||queue.size)&&!confirm('Reload the saved count? Entries not saved from this tab will be replaced.'))return;clearTimeout(saveTimer);await saveChain;try{await loadDraft();error('');}catch(err){error(err.message);}});
    q('[data-inv-discard]').addEventListener('click',async()=>{if(!confirm('Clear this count draft? Saved inventory history will remain.'))return;clearTimeout(saveTimer);await saveChain;
      try{const cleared=draftRevision?await request('DELETE','/v1/inventory/draft',{revision:draftRevision}):null;queue.clear();draftRevision=cleared?.draft?.revision||0;requestKey=newKey();dirty=false;draftBlocked=false;note.value='';error('');selection();renderRows();draftStatus('Count draft cleared.');}catch(err){error(err.message);}});
    const initialQuery=new URLSearchParams(location.search);if(initialQuery.get('q'))filters.elements.q.value=initialQuery.get('q');
    if(['low','zero'].includes(initialQuery.get('level')))filters.elements.level.value=initialQuery.get('level');
    try{await Promise.all([loadRows(),loadHistory(),loadDraft()]);}catch(err){error(err.message);}
    globalThis.EzkartStockReviews?.mount({request,root:q('[data-stock-reviews]'),onStockChanged:()=>Promise.all([loadRows(),loadHistory()])});
    window.addEventListener('beforeunload',event=>{if(dirty||uncertain){event.preventDefault();event.returnValue='';}});
  }
  let refreshSummary=()=>{};
  globalThis.EzkartInventory={refreshSummary:()=>refreshSummary(),mount:({request})=>{const api=(method,path,payload)=>request(method,path,payload,{timeoutMs:method==='GET'?15000:30000});const summary=document.querySelector('[data-inventory-summary]'),root=document.querySelector('[data-inventory-workspace]');if(summary){refreshSummary=()=>void mini(summary,api);refreshSummary();document.addEventListener('ezkart:cloud-catalog-changed',refreshSummary);}if(root)void workspace(root,api);}};
})();
