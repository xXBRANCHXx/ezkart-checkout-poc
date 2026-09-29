(() => {
 const root=document.querySelector('[data-onboarding]');if(!root)return;
 const status=root.querySelector('[data-onboarding-status]'),profile=root.querySelector('[data-onboarding-profile]'),bank=root.querySelector('[data-onboarding-bank]');let state=null,banks=[],busy=false,step=null;
 const t=value=>window.EzkartLanguage?.t(value)||value;
 function showStep(next){step=next;root.querySelectorAll("[data-onboarding-panel]").forEach(n=>n.hidden=n.dataset.onboardingPanel!==next);root.querySelectorAll("[data-onboarding-step]").forEach(n=>{if(n.dataset.onboardingStep===next)n.setAttribute("aria-current","step");else n.removeAttribute("aria-current");});}
 function stepControls(){const done={profile:!!state.profile&&!state.requirements.includes("refresh_legal_profile"),addresses:state.shipping.confirmed,bank:!!state.bank};root.querySelectorAll("[data-onboarding-step]").forEach(n=>{const id=n.dataset.onboardingStep;n.disabled=busy||(id!=="profile"&&!done.profile)||(id==="bank"&&!done.addresses);root.querySelector(`[data-step-status="${id}"]`).textContent=done[id]?t("Saved"):"";});root.querySelector("[data-onboarding-finish]").hidden=!(state.ready||state.sellingReady);if(!step)showStep(!done.profile?"profile":!done.addresses?"addresses":"bank");}
 root.querySelectorAll("[data-onboarding-step]").forEach(n=>n.addEventListener("click",()=>showStep(n.dataset.onboardingStep)));
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
  profile.elements.ageConfirmed.checked=false;
  profile.elements.legalName.value=state.profile?.legalName||'';profile.elements.birthDate.value=state.profile?.birthDate||'';profile.elements.phone.value=state.profile?.phone||'';profile.elements.email.value=state.email;
  const choice=bank.elements.code.value;bank.elements.code.replaceChildren(new Option('Choose your bank',''),...banks.map(b=>new Option(b.name,b.code)));bank.elements.code.value=choice;channels();
  text('[data-onboarding-bank-summary]',state.bank?`${state.bank.code} · account ending ${state.bank.accountSuffix} · saved version ${state.bank.revision}`:'No bank saved.');
  text('[data-onboarding-addresses]',['pickup','returns'].map(k=>{const a=state.shipping[k];return(k==='pickup'?'Pickup: ':'Return: ')+(a?`${a.address}, ${a.location}. ${a.coordinate?'Map pin saved.':'Map pin missing.'}`:'No address saved.');}).join(' '));
  root.querySelector('[data-onboarding-confirm-pins]').disabled=!state.shipping.pinsPresent||!state.profile||state.shipping.confirmed;
  text('[data-onboarding-age]',state.age.years===null?'Save your date of birth to record your age declaration.':`Saved seller-declared age: ${state.age.years} as of ${state.age.asOfDate}. Minimum seller age: ${state.age.minimumAge}.`);
  text('[data-onboarding-wallet]',state.wallet?'Existing Wallet setup: '+state.wallet.status+'. Its original registration is preserved.':'Complete your legal details and address pins to prepare your DOKU seller wallet. With two-step enabled, you can save your bank before your first withdrawal.');
  status.textContent=t(state.ready?'Your details are saved. Your store is ready.':state.sellingReady?'You’re ready to sell. Add your bank before withdrawing.':'Complete each step to get your store ready.');
  stepControls();

 }
 async function run(fn){if(busy)return;busy=true;root.querySelectorAll('button').forEach(b=>b.disabled=true);try{await fn();}catch(e){status.textContent=e.message;}finally{busy=false;root.querySelectorAll('button').forEach(b=>b.disabled=false);if(state)stepControls();if(state)root.querySelector('[data-onboarding-confirm-pins]').disabled=!state.shipping.pinsPresent||!state.profile||state.shipping.confirmed;}}
 profile.addEventListener('submit',e=>{e.preventDefault();void run(async()=>{await call('profile',{revision:state?.profileRevision||0,requestKey:key(),legalName:profile.elements.legalName.value,birthDate:profile.elements.birthDate.value,ageConfirmed:profile.elements.ageConfirmed.checked,phone:profile.elements.phone.value});showStep("addresses");});});
 bank.addEventListener('submit',e=>{e.preventDefault();void run(async()=>{await call('bank',{revision:state?.bankRevision||0,requestKey:key(),bank:{code:bank.elements.code.value,accountNumber:bank.elements.accountNumber.value,channel:bank.elements.channel.value}});bank.elements.accountNumber.value='';});});
 bank.elements.code.addEventListener('change',channels);
 root.querySelector('[data-onboarding-confirm-pins]').addEventListener('click',()=>run(async()=>{await call('confirm_pins',{revision:state.profile.revision,requestKey:key(),shippingRevision:state.shipping.revision});showStep('bank');}));
 root.querySelector('[data-onboarding-refresh]').addEventListener('click',()=>run(()=>call('read')));
 void run(()=>call('read'));
})();
