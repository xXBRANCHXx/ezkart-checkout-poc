(() => {
 const root=document.querySelector('[data-onboarding]');if(!root)return;
 const status=root.querySelector('[data-onboarding-status]'),profile=root.querySelector('[data-onboarding-profile]'),bank=root.querySelector('[data-onboarding-bank]');let state=null,banks=[],busy=false;
 const key=()=>crypto.randomUUID().replaceAll('-','');
 const text=(selector,value)=>root.querySelector(selector).textContent=value;
 async function call(action,payload={},retry=true){
  let response;try{response=await fetch('./?wallet=onboarding_'+action,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-Ezkart-Csrf':document.body.dataset.adminCsrfToken,'X-Ezkart-Wallet-Account':root.dataset.account,'X-Ezkart-Wallet-Store':root.dataset.store},body:JSON.stringify(payload)});}catch(error){if(retry&&action!=='read')return call(action,payload,false);throw Error('Connection interrupted. Refresh saved details to check whether this revision was saved.');}
  if(response.status===401||response.status===403){root.hidden=true;location.replace('?page=wallet');throw Error('Unlock Wallet again to view personal details.');}
  if(response.status>=500&&retry&&action!=='read')return call(action,payload,false);
  const data=await response.json();if(!response.ok||!data.ok)throw Error(data.error||'Could not save onboarding details.');state=data.onboarding;window.dispatchEvent(new Event('ezkart:onboarding-changed'));banks=data.banks||banks;render();
 }
 function channels(){const available=banks.find(b=>b.code===bank.elements.code.value)?.channels||[];bank.elements.channel.replaceChildren(...available.map(value=>new Option(value==='BI_FAST'?'BI-FAST':'Online bank transfer',value)));}
 function render(){
  profile.elements.legalName.value=state.profile?.legalName||'';profile.elements.birthDate.value=state.profile?.birthDate||'';profile.elements.phone.value=state.profile?.phone||'';profile.elements.email.value=state.email;
  const choice=bank.elements.code.value;bank.elements.code.replaceChildren(new Option('Choose your bank',''),...banks.map(b=>new Option(b.name,b.code)));bank.elements.code.value=choice;channels();
  text('[data-onboarding-bank-summary]',state.bank?`${state.bank.code} · account ending ${state.bank.accountSuffix} · saved version ${state.bank.revision}`:'No bank saved.');
  text('[data-onboarding-addresses]',['pickup','returns'].map(k=>{const a=state.shipping[k];return(k==='pickup'?'Pickup: ':'Return: ')+(a?`${a.address}, ${a.location}. ${a.coordinate?'Map pin saved.':'Map pin missing.'}`:'No address saved.');}).join(' '));
  root.querySelector('[data-onboarding-confirm-pins]').disabled=!state.shipping.pinsPresent||!state.profile||state.shipping.confirmed;
  text('[data-onboarding-age]',state.age.years===null?'Save your date of birth to record your age declaration.':`Saved seller-declared age: ${state.age.years} as of ${state.age.asOfDate}. Minimum seller age: ${state.age.minimumAge}.`);
  text('[data-onboarding-wallet]',state.wallet?'Existing Wallet setup: '+state.wallet.status+'. Its original registration is preserved.':'A DOKU seller wallet can be prepared after all onboarding requirements are met.');
  const missing={legal_name_phone:'legal details',refresh_legal_profile:'save legal details again using your current verified email',saved_bank:'saved bank',confirmed_pickup_return_pins:'confirmed pickup and return pins',age_policy:'seller age policy',age_declaration:'seller-declared age meeting the 18+ policy'};
  status.textContent=state.ready?'Onboarding requirements met. Open Wallet setup to prepare your one seller Sub-Account, or check its existing registration.':('Still needed: '+(state.requirements.length?state.requirements.map(r=>missing[r]||r).join(', '):'refresh your saved details and check the required details')+'.');
 }
 async function run(fn){if(busy)return;busy=true;root.querySelectorAll('button').forEach(b=>b.disabled=true);try{await fn();}catch(e){status.textContent=e.message;}finally{busy=false;root.querySelectorAll('button').forEach(b=>b.disabled=false);if(state)root.querySelector('[data-onboarding-confirm-pins]').disabled=!state.shipping.pinsPresent||!state.profile||state.shipping.confirmed;}}
 profile.addEventListener('submit',e=>{e.preventDefault();void run(()=>call('profile',{revision:state?.profileRevision||0,requestKey:key(),legalName:profile.elements.legalName.value,birthDate:profile.elements.birthDate.value,phone:profile.elements.phone.value}));});
 bank.addEventListener('submit',e=>{e.preventDefault();void run(async()=>{await call('bank',{revision:state?.bankRevision||0,requestKey:key(),bank:{code:bank.elements.code.value,accountNumber:bank.elements.accountNumber.value,channel:bank.elements.channel.value}});bank.elements.accountNumber.value='';});});
 bank.elements.code.addEventListener('change',channels);
 root.querySelector('[data-onboarding-confirm-pins]').addEventListener('click',()=>run(()=>call('confirm_pins',{revision:state.profile.revision,requestKey:key(),shippingRevision:state.shipping.revision})));
 root.querySelector('[data-onboarding-refresh]').addEventListener('click',()=>run(()=>call('read')));
 void run(()=>call('read'));
})();
