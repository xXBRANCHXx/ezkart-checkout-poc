(() => {
 'use strict';
 const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
 const button=(text,fn)=>{const n=el('button',text,'preference-secondary ui-button');n.type='button';n.addEventListener('click',fn);return n;};
 const date=v=>v?new Date(v).toLocaleString('en-GB',{timeZone:'Asia/Jakarta'})+' WIB':'—';
 function mount(root,api,merchant=false){
  if(!root||root.dataset.mounted)return;root.dataset.mounted='1';
  const list=root.querySelector('[data-subscription-list]'),status=root.querySelector('[data-subscription-status]'),more=root.querySelector('[data-subscription-more]');let cursor=null,busy=false;
  const show=s=>{
   const card=el('article',undefined,'preference-card commerce-order-card');card.append(el('h2',s.terms.productTitle+' · '+s.terms.planName),el('p',s.terms.storeName+(merchant?' · '+s.email:'')),el('p',`IDR ${s.terms.amount.toLocaleString('id-ID')} / ${s.terms.interval} ${s.terms.unit} · ${s.state.replaceAll('_',' ')}`),el('p',s.access.allowed?'Paid access until '+date(s.access.until):'No current paid access'));
   const details=el('details'),summary=el('summary','Original terms and recent billing periods');details.append(summary,el('p',s.consent.statement),el('p','Saved '+date(s.consent.at)));
   for(const p of s.periods)details.append(el('p',`Period ${p.number+1}: ${p.state} · ${date(p.startsAt)} – ${date(p.endsAt)}`));card.append(details);
   if(!s.cancelledAt){const cancel=button('Cancel future renewals',()=>{cancel.hidden=true;const confirmation=el('div');const confirm=button('Confirm cancellation',async()=>{confirm.disabled=true;try{await api('cancel',{id:s.id,confirm:true});await load();}catch(e){status.textContent=e.message;confirm.disabled=false;}});confirmation.append(el('p','Paid access will remain until its paid period ends.'),confirm,button('Keep subscription',()=>{cancel.hidden=false;confirmation.remove();}));card.append(confirmation);});card.append(cancel);}else card.append(el('p','Cancelled '+date(s.cancelledAt)));
   list.append(card);
  };
  async function load(append=false){if(busy)return;busy=true;status.textContent='Loading subscriptions…';try{const data=await api('list',append&&cursor?{cursor}:{});if(!append)list.replaceChildren();data.items.forEach(show);cursor=data.nextCursor;more.hidden=!cursor;status.textContent=list.children.length?'Recurring billing is awaiting provider setup.':'No subscriptions saved.';}catch(e){status.textContent=e.message;}finally{busy=false;}}
  more.addEventListener('click',()=>void load(true));root.querySelector('[data-subscription-refresh]').addEventListener('click',()=>void load());void load();
  if(!merchant){const params=new URLSearchParams(location.search),plan=Object.fromEntries(['sellerId','productId','variantId'].map(k=>[k,params.get(k)]));if(Object.values(plan).every(Boolean))void(async()=>{
    try{
     const storageKey='ezkart-subscription-request:'+root.dataset.version+':'+JSON.stringify(plan);
     const pending=JSON.parse(localStorage.getItem(storageKey)||'null');
     const offer=pending?{statement:pending.statement}:await api('quote',plan),host=root.querySelector('[data-subscription-offer]'),form=el('form',undefined,'preference-card'),label=el('label',undefined,'preference-choice'),check=el('input');
     check.type='checkbox';check.required=true;check.checked=!!pending;check.disabled=!!pending;label.append(check,el('span',offer.statement));
     const save=el('button',pending?'Retry saved request':'Save subscription request','preference-primary');save.type='submit';form.append(el('h2','Review this plan'),label,save);host.append(form);
     let payload=pending;
     form.addEventListener('submit',async e=>{e.preventDefault();save.disabled=true;try{
      payload||={...plan,termsHash:offer.termsHash,statement:offer.statement,consentVersion:offer.consentVersion,consent:check.checked,requestKey:Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('')};
      localStorage.setItem(storageKey,JSON.stringify(payload));check.disabled=true;
      await api('enroll',payload);localStorage.removeItem(storageKey);host.replaceChildren(el('p','Request saved. No charge was authorized.'));await load();
     }catch(error){status.textContent=error.message;save.textContent='Retry saved request';save.disabled=false;}});
    }catch(e){status.textContent=e.message;}

   })();}
 }
 const root=document.querySelector('[data-customer-subscriptions]');
 if(root)mount(root,async(action,fields={})=>{const response=await fetch('/cart/admin/customer-subscriptions.php'+(action==='list'&&fields.cursor?'?'+new URLSearchParams(fields):''),{method:action==='list'?'GET':'POST',cache:'no-store',headers:{'Content-Type':'application/json','X-Ezkart-CSRF':root.dataset.csrf,'X-Ezkart-Customer-Session':root.dataset.version},...(action==='list'?{}:{body:JSON.stringify({action,...fields})})});const data=await response.json();if(!response.ok||data.ok===false)throw Error(data.error||'Subscriptions could not be loaded.');return data;});
 globalThis.EzkartSubscriptions={mountMerchant:({request})=>mount(document.querySelector('[data-merchant-subscriptions]'),(action,fields={})=>action==='list'?request('GET','/v1/commerce/subscriptions'+(fields.cursor?'?'+new URLSearchParams(fields):'')):request('POST','/v1/commerce/subscriptions/'+fields.id+'/cancel',{confirm:true}),true)};
})();
