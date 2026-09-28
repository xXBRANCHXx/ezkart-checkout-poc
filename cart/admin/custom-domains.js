(() => {
  'use strict';
  const root=document.querySelector('[data-domain-management]'); if(!root)return;
  const form=root.querySelector('form'),status=root.querySelector('[data-domain-status]'),list=root.querySelector('[data-domain-list]');
  let busy=false,canEdit=false;
  const element=(tag,text)=>{const el=document.createElement(tag);if(text)el.textContent=text;return el;};
  async function api(path,body){
    const response=await fetch('./?cloud='+encodeURIComponent('/v1/'+path),{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json',...(body?{'Content-Type':'application/json','X-Ezkart-Csrf':document.body.dataset.adminCsrfToken}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const data=await response.json();if(!response.ok||!data.ok)throw Error(data.error||'Domain request failed. Please try again.');return data;
  }
  function controls(){root.querySelectorAll('button,input').forEach(el=>{el.disabled=busy||(!canEdit&&!el.matches('[data-domain-refresh]'));});}
  async function load(){
    const [result,pages]=await Promise.all([api('custom-domains'),api('landing-pages')]);canEdit=result.canEdit;
    const choices=root.querySelector('[data-domain-pages]'),selected=form.elements.pageId?.value;
    choices.replaceChildren(element('legend','Published landing page'));
    for(const page of pages.pages.filter(p=>p.status==='published')){const label=element('label'),radio=element('input');radio.type='radio';radio.name='pageId';radio.value=page.id;radio.required=true;radio.checked=page.id===selected;label.append(radio,document.createTextNode(page.name||page.id));choices.append(label);}
    if(!choices.querySelector('input'))choices.append(element('p','Publish a landing page in Sites before connecting a domain.'));
    list.replaceChildren();
    for(const domain of result.domains){
      const card=element('article');card.className='domain-connection';card.append(element('h3',domain.hostname),element('p',`Status: ${domain.state}. HTTPS: ${domain.tlsStatus||'not requested'}. Page: ${domain.pageId}. Last checked: ${domain.checkedAt ? new Date(domain.checkedAt).toLocaleString() : 'never'}.`));
      if(domain.state==='active'){const link=element('a','Open domain');link.href='https://'+domain.hostname;link.target='_blank';link.rel='noopener';card.append(link);}
      if(domain.providerPending)card.append(element('p','The provider request is awaiting reconciliation. Checking again will look for the original request.'));
      if(domain.state!=='active')card.append(element('p','Ownership code expires: '+new Date(domain.challengeExpiresAt).toLocaleString()+'. Keep ownership and certificate TXT records in DNS.'));
      const table=element('table'),head=element('tr');for(const text of ['Type','DNS name','Value'])head.append(element('th',text));table.append(head);
      for(const record of domain.dns){const tr=element('tr');for(const text of [record.type,record.name,record.value])tr.append(element('td',text));table.append(tr);}card.append(table);
      for(const [action,label]of [['verify','Check DNS and HTTPS'],['renew','Generate new ownership code'],['disconnect','Disconnect domain']]){const button=element('button',label);button.type='button';button.className='ui-button';button.addEventListener('click',()=>run(async()=>{await api(`custom-domains/${domain.id}/${action}`,{});await load();status.textContent=action==='disconnect'?'Domain disconnected. Remove its DNS records when ready.':action==='renew'?'New code generated. Replace the ownership TXT record, then check again.':'Connection checked. Only an active connection serves your page.';}));card.append(button);}list.append(card);
    }
    status.textContent=!result.configured?'Domain hosting is awaiting operator setup. You can review existing connections here.':!canEdit?'Only the store owner can manage domains.':result.domains.length?'Follow the DNS instructions for each connection.':'No domains connected yet.';
  }
  async function run(fn){if(busy)return;busy=true;controls();status.textContent='Updating domain connections…';try{await fn();}catch(error){status.textContent=error.message;}finally{busy=false;controls();}}
  form.addEventListener('submit',event=>{event.preventDefault();const data=new FormData(form);void run(async()=>{await api('custom-domains',{hostname:data.get('hostname'),pageId:data.get('pageId')});await load();});});
  root.querySelector('[data-domain-refresh]').addEventListener('click',()=>run(load));
  if(document.body.dataset.adminCloudEnabled==='true')void run(load);else{status.textContent='Sign in with your store account to manage domains.';controls();}
})();
