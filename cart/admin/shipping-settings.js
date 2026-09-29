(() => {
  const el=(tag,text,cls='')=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
  const dataEl=(tag,text)=>{const node=el(tag,text);node.translate=false;return node;};
  const button=(text,click)=>{const n=el('button',text,'ui-button');n.type='button';n.addEventListener('click',click);return n;};
  const copy=value=>structuredClone(value),key=()=>crypto.randomUUID().replaceAll('-','');
  const date=value=>window.EzkartAdminFormat.date(value);
  function mount({request}){
    const root=document.querySelector('[data-shipping-settings]');if(!root)return;
    const q=selector=>root.querySelector(selector),form=q('[data-shipping-address-form]'),editor=q('[data-shipping-address-dialog]'),review=q('[data-shipping-review]');
    let data=null,draft=null,pending=null,busy=false,storageReady=true,recovered=false,editingId='',mode='',removeId='',picker=null;
    const api=(method,body)=>request(method,'/v1/shipping-settings',body,{timeoutMs:method==='GET'?15000:30000});
    const message=(selector,text)=>{q(selector).textContent=text||'';q(selector).hidden=!text;};
    const storageKey=()=> 'ezkart.shipping.pending.'+data.sellerId;
    const dirty=()=>Boolean(data&&JSON.stringify(draft)!==JSON.stringify(data.settings.configuration));
    const locked=()=>busy||!data?.canWrite||Boolean(pending);
    function persist(value){if(value===null)sessionStorage.removeItem(storageKey());else{const encoded=JSON.stringify(value);sessionStorage.setItem(storageKey(),encoded);if(sessionStorage.getItem(storageKey())!==encoded)throw Error('Browser session storage is unavailable.');}pending=value;}
    function recover(){if(recovered)return;recovered=true;try{const raw=sessionStorage.getItem(storageKey());if(raw){const saved=JSON.parse(raw);if(!saved||!Number.isSafeInteger(saved.revision)||!/^[a-f0-9]{32}$/.test(saved.requestKey)||!Array.isArray(saved.configuration?.addresses))throw Error('Invalid saved request');pending=saved;}}
      catch{storageReady=false;message('[data-shipping-error]','This browser could not read its saved requests. Restore session storage before saving shipping settings.');}}
    function controls(){
      q('[data-shipping-save]').disabled=locked()||!dirty()||!storageReady;
      q('[data-shipping-add]').disabled=locked()||!draft||draft.addresses.length>=10;
      q('[data-shipping-couriers]').disabled=locked();
      for(const selector of ['[data-shipping-pickup]','[data-shipping-return]'])q(selector).disabled=locked()||!draft?.addresses.length;
      root.querySelectorAll('[data-shipping-edit],[data-shipping-remove]').forEach(b=>b.disabled=locked());
      q('[data-shipping-reload]').disabled=busy||Boolean(pending);
      q('[data-shipping-recovery]').hidden=!pending;q('[data-shipping-retry]').disabled=busy||!data?.canWrite||!storageReady;
      q('[data-shipping-confirm]').disabled=busy||(mode==='save'&&(!data?.canWrite||!storageReady));
      review.querySelectorAll('[data-shipping-review-close]').forEach(b=>b.disabled=busy);
    }
    function card(address,actions=false){
      const item=el('article',undefined,'shipping-address-card'),tags=el('div',undefined,'shipping-address-tags');
      if(address.id===draft.pickupAddressId)tags.append(el('span','Pickup'));if(address.id===draft.returnAddressId)tags.append(el('span','Returns'));if(address.coordinate)tags.append(el('span','Pin saved'));
      item.append(dataEl('h3',address.label),tags,dataEl('b',address.name),dataEl('p',address.address+', '+address.location+' '+address.postalCode),el('p',address.phone));
      if(address.email)item.append(el('p',address.email));if(address.note)item.append(el('small',address.note));
      if(actions){const row=el('div',undefined,'shipping-address-actions'),edit=button('Edit address',()=>openAddress(address)),remove=button('Remove',()=>openReview('remove',address.id));edit.dataset.shippingEdit=address.id;remove.dataset.shippingRemove=address.id;edit.setAttribute('aria-label','Edit '+address.label);remove.setAttribute('aria-label','Remove '+address.label);row.append(edit,remove);item.append(row);}return item;
    }
    function render(){
      const addresses=q('[data-shipping-addresses]');addresses.replaceChildren();
      for(const address of draft.addresses)addresses.append(card(address,true));
      if(!draft.addresses.length)addresses.append(el('p','Add your first address to set up pickup and returns.','shipping-empty'));
      for(const [selector,value] of [['[data-shipping-pickup]',draft.pickupAddressId],['[data-shipping-return]',draft.returnAddressId]]){const select=q(selector);select.replaceChildren();if(!draft.addresses.length)select.append(new Option('Add an address first',''));for(const a of draft.addresses)select.append(new Option(a.label,a.id));select.value=value;}
      const couriers=q('[data-shipping-couriers]');couriers.querySelectorAll('label').forEach(n=>n.remove());
      for(const courier of data.couriers){const label=el('label'),input=el('input'),text=el('span');input.type='checkbox';input.value=courier.code;input.checked=draft.couriers.includes(courier.code);text.append(el('b',courier.name));if(courier.requiresPin)text.append(el('small','Pickup pin required'));label.append(input,text);couriers.append(label);input.addEventListener('change',()=>{draft.couriers=[...couriers.querySelectorAll('input:checked')].map(n=>n.value).sort();status();controls();});}
      const history=q('[data-shipping-history]');history.replaceChildren();for(const change of data.recentChanges){const li=el('li');li.append(el('b',change.byYou?'Saved by you':'Saved by a team member'),el('small',date(change.createdAt)));history.append(li);}if(!data.recentChanges.length)history.append(el('li','No saved changes yet.'));
      status();controls();
    }
    function status(){if(!data)return;q('[data-shipping-status]').textContent=!data.canWrite?'You can review these settings. Your account cannot change them.':pending?'A previous save needs confirmation.':dirty()?'You have unsaved shipping changes.':!data.checkoutEnabled?'Addresses and couriers are saved here. They will be used when central order processing is enabled.':draft.addresses.length?'Shipping settings are saved. New orders use these addresses and couriers.':'Physical checkout needs a pickup and return address.';}
    async function load(){busy=true;controls();try{data=await api('GET');recover();draft=copy(data.settings.configuration);render();return true;}catch(error){message('[data-shipping-error]',error.message+' Use Reload saved settings to try again.');return false;}finally{busy=false;controls();}}
    function openAddress(address){if(locked())return;editingId=address?.id||'addr_'+key();form.reset();for(const field of ['label','name','phone','email','organization','address','location','postalCode','note'])form.elements[field].value=address?.[field]||'';
      q('#shipping-address-title').textContent=address?'Edit address':'Add address';message('[data-shipping-address-error]','');editor.showModal();
      if(!picker){const container=q('[data-shipping-map]');picker=window.ezkartAddressPicker(container,{csrf:()=>document.body.dataset.adminCsrfToken,endpoint:'./?cloud='+encodeURIComponent('/v1/shipping-address-search'),onPlace:()=>{},addressText:()=>[form.elements.address.value,form.elements.location.value,form.elements.postalCode.value,'Indonesia'].filter(Boolean).join(', ')});container.querySelector('.address-picker-heading strong').textContent='Pickup or return location';container.querySelector('.address-picker-map').setAttribute('aria-label','Position your pickup or return entrance');}
      picker.reset(address||{});form.elements.label.focus();
    }
    function closeAddress(){picker?.close();editor.close();}
    form.addEventListener('submit',event=>{event.preventDefault();if(locked()||!form.reportValidity())return;const values=Object.fromEntries(new FormData(form)),address={id:editingId};for(const [name,value] of Object.entries(values))address[name]=String(value).trim();address.phone=address.phone.replace(/[\s()-]/g,'');
      if(!/^\+?\d{8,15}$/.test(address.phone)){message('[data-shipping-address-error]','Enter a valid contact phone number.');return;}
      const {coordinate,confirmed}=picker.read();if(confirmed&&coordinate){if(coordinate.latitude < -11.1||coordinate.latitude>6.1||coordinate.longitude<94.8||coordinate.longitude>141.1){message('[data-shipping-address-error]','Choose a location within Indonesia.');return;}address.coordinate=coordinate;}
      const index=draft.addresses.findIndex(a=>a.id===editingId);if(index>=0)draft.addresses[index]=address;else draft.addresses.push(address);
      if(!draft.pickupAddressId)draft.pickupAddressId=editingId;if(!draft.returnAddressId)draft.returnAddressId=editingId;closeAddress();render();q('[data-shipping-save]').focus();});
    for(const name of ['address','location','postalCode'])form.elements[name].addEventListener('input',()=>picker?.addressChanged());
    q('[data-shipping-clear-pin]').addEventListener('click',()=>{picker?.clear();message('[data-shipping-address-error]','');});
    q('[data-shipping-confirm-pin]').addEventListener('click',()=>message('[data-shipping-address-error]',picker?.confirm()?'':'Wait for the map to load, then find or position your entrance before confirming the pin.'));
    root.querySelectorAll('[data-shipping-address-close]').forEach(b=>b.addEventListener('click',closeAddress));editor.addEventListener('cancel',()=>picker?.close());
    function openReview(nextMode,id=''){
      if(busy)return;mode=nextMode;removeId=id;message('[data-shipping-review-error]','');const preview=q('[data-shipping-preview]');preview.replaceChildren();
      const config=pending?.configuration||draft;
      q('#shipping-review-title').textContent=mode==='remove'?'Remove saved address?':mode==='reload'?'Reload saved settings?':pending?'Confirm the original save':'Review shipping changes';
      q('[data-shipping-confirm]').textContent=mode==='remove'?'Remove from changes':mode==='reload'?'Discard changes and reload':pending?'Check original save':'Save shipping settings';
      if(mode==='remove')preview.append(el('p','Remove '+draft.addresses.find(a=>a.id===id).label+' from your address book? This change will be applied when you save shipping settings.'));
      else if(mode==='reload')preview.append(el('p','Your unsaved changes will be discarded and replaced with the latest saved settings.'));
      else{if(!config.addresses.length)preview.append(el('p','Removing every address will prevent new physical checkouts. Existing orders keep their original addresses.','shipping-notice'));
        preview.append(el('h3','Address book'),el('p',config.addresses.length?config.addresses.map(a=>a.label).join(', '):'No saved locations'));
        for(const a of config.addresses.filter(a=>a.id!==config.pickupAddressId&&a.id!==config.returnAddressId)){preview.append(card(a));}
        for(const [title,addressId] of [['Pickup address',config.pickupAddressId],['Return address',config.returnAddressId]]){preview.append(el('h3',title));const a=config.addresses.find(a=>a.id===addressId);preview.append(a?card(a):el('p','No address selected'));}
        preview.append(el('h3','Enabled couriers'),el('p',config.couriers.map(code=>data.couriers.find(c=>c.code===code)?.name||code).join(', ')||'Choose at least one courier'),el('p','Existing orders retain their saved pickup and return details.','shipping-help'));
      }review.showModal();controls();
    }
    async function save(){
      let uncertain=Boolean(pending);busy=true;controls();
      try{if(!pending)persist({requestKey:key(),revision:data.settings.revision,configuration:copy(draft)});
        const result=await api('PUT',pending),receipt=result.receipt;
        if(!receipt||receipt.sellerId!==data.sellerId||receipt.requestKey!==pending.requestKey||receipt.revision!==pending.revision+1)throw Error('The server did not confirm this save. Check the original save to recover it.');
        data.settings={revision:receipt.revision,configuration:copy(pending.configuration),updatedAt:receipt.createdAt};draft=copy(pending.configuration);
        persist(null);review.close();message('[data-shipping-error]','');status();await load();
      }catch(error){if(!pending)storageReady=false;
        // A definite first rejection permits edits. Once a response has been lost,
        // only its matching receipt can resolve the original operation.
        if(!uncertain&&pending&&[400,403,409,422].includes(error.status)){try{persist(null);}catch{storageReady=false;}}
        message('[data-shipping-review-error]',error.message);status();
      }finally{busy=false;controls();}
    }
    q('[data-shipping-confirm]').addEventListener('click',()=>{if(busy)return;if(mode==='reload'){review.close();void load();}
      else if(mode==='remove'){draft.addresses=draft.addresses.filter(a=>a.id!==removeId);if(draft.pickupAddressId===removeId)draft.pickupAddressId=draft.addresses[0]?.id||'';if(draft.returnAddressId===removeId)draft.returnAddressId=draft.addresses[0]?.id||'';review.close();render();}
      else void save();});
    root.querySelectorAll('[data-shipping-review-close]').forEach(b=>b.addEventListener('click',()=>{if(!busy)review.close();}));review.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
    q('[data-shipping-save]').addEventListener('click',()=>openReview('save'));q('[data-shipping-retry]').addEventListener('click',()=>openReview('save'));
    q('[data-shipping-add]').addEventListener('click',()=>openAddress(null));q('[data-shipping-reload]').addEventListener('click',()=>dirty()?openReview('reload'):void load());
    for(const [selector,field] of [['[data-shipping-pickup]','pickupAddressId'],['[data-shipping-return]','returnAddressId']])q(selector).addEventListener('change',event=>{draft[field]=event.target.value;render();});
    window.addEventListener('beforeunload',event=>{if(dirty()&&!pending){event.preventDefault();event.returnValue='';}});
    void load();
  }
  window.EzkartShippingSettings={mount};
})();
