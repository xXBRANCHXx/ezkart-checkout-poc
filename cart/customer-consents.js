(() => {
  'use strict';
  const root=document.querySelector('[data-customer-consents]');if(!root)return;
  const q=selector=>root.querySelector(selector),list=q('[data-consent-list]'),refresh=q('[data-consent-refresh]'),more=q('[data-consent-more]');
  if(!list)return;
  const endpoint='/cart/admin/customer-consents.php',pending=new Map();let cursor=null,busy=false,version=0,ended=false;
  const el=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;};
  const button=(text,fn)=>{const node=el('button',text,'preference-secondary');node.type='button';node.addEventListener('click',fn);return node;};
  const date=value=>value?new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Jakarta'}).format(new Date(value))+' WIB':'';
  const key=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');
  const errorText=value=>{q('[data-consent-error]').textContent=value;q('[data-consent-error]').hidden=!value;};
  function controls(){refresh.disabled=!ended&&(busy||pending.size>0);more.disabled=busy||pending.size>0;list.querySelectorAll('[data-consent-action]').forEach(n=>{n.disabled=busy||n.closest('[data-consent-card]').dataset.locked==='true';});}
  function changed(message){ended=true;version++;pending.clear();list.replaceChildren();q('[data-consent-account]').textContent='';q('[data-consent-status]').textContent='Sign-in needs to be checked.';more.hidden=true;refresh.textContent='Reload sign-in';errorText(message||'Your sign-in changed. Reload this page.');controls();}
  async function api(query={},body){
    const params=new URLSearchParams(query),response=await fetch(endpoint+(params.size?'?'+params:''),{method:body?'POST':'GET',cache:'no-store',signal:AbortSignal.timeout(25000),
      headers:{'Content-Type':'application/json','X-Ezkart-CSRF':root.dataset.csrf,'X-Ezkart-Customer-Session':root.dataset.version},...(body?{body:JSON.stringify(body)}:{})});
    let data;try{data=await response.json();}catch{throw Error('The response was interrupted.');}
    if(!response.ok||!data.ok){const error=new Error(data.error||'Your preferences could not be confirmed.');error.status=response.status;error.code=data.code;
      if(data.code==='customer_session_changed'||response.status===401)changed(error.message);throw error;}
    return data;
  }
  function history(item){
    const details=el('details',undefined,'preference-history'),summary=el('summary','Preference history'),status=el('p',''),rows=el('ol'),next=button('Load older changes',()=>load(loaded));
    let loaded=false,loading=false,nextCursor=null;next.hidden=true;details.append(summary,status,rows,next);
    async function load(append=false){
      if(loading||ended)return;loading=true;next.disabled=true;status.textContent='Loading history…';
      try{const data=await api({action:'history',seller:item.sellerId,email:item.email,...(append?{cursor:nextCursor}:{})});if(!details.isConnected||ended)return;
        if(!Array.isArray(data.items))throw Error('Preference history was incomplete.');if(!append)rows.replaceChildren();
        for(const change of data.items){const li=el('li'),title=el('strong',change.state==='granted'?'Email permission granted':'Email permission withdrawn');li.append(title,el('time',date(change.createdAt)),el('p',change.statement));if(change.source==='email_unsubscribe')li.append(el('small','From an unsubscribe link'));rows.append(li);}
        nextCursor=data.nextCursor;next.hidden=!nextCursor;next.textContent='Load older changes';loaded=true;status.textContent=rows.children.length?'Choices recorded by you.':'No preference changes recorded.';
      }catch(error){if(details.isConnected&&!ended){status.textContent=error.message;next.hidden=false;next.textContent=loaded?'Retry older changes':'Retry history';}}
      finally{loading=false;next.disabled=false;}
    }
    details.addEventListener('toggle',()=>{if(details.open&&!loaded){if(!item.revision){loaded=true;status.textContent='No preference changes recorded.';}else void load();}});
    return details;
  }
  function card(item){
    const node=el('section',undefined,'preference-card');node.dataset.consentCard='';node.dataset.seller=item.sellerId;node.dataset.email=item.email;
    const heading=el('header'),store=el('h2',item.storeName),badge=el('span',{granted:'Allowed',withdrawn:'Stopped',not_recorded:'No permission recorded'}[item.state],'preference-badge');badge.dataset.state=item.state;
    heading.append(store,badge);node.append(heading,el('p',item.email,'preference-email'));
    if(item.updatedAt)node.append(el('p','Last changed '+date(item.updatedAt),'preference-time'));
    const actions=el('div',undefined,'preference-actions'),status=el('p','', 'preference-save-status');status.setAttribute('role','status');status.dataset.consentSaveStatus='';
    if(item.state==='granted'){
      node.append(el('p','This store has your permission to send promotional emails to this address.'));
      const stop=button('Stop promotional emails',()=>save(false));stop.dataset.consentAction='';actions.append(stop);
    }else if(item.canGrant){
      const form=el('form'),label=el('label',undefined,'preference-choice'),check=document.createElement('input');check.type='checkbox';check.required=true;check.name='allow';check.dataset.consentAction='';
      label.append(check,el('span',item.statement));form.append(label);const submit=el('button','Save email preference','preference-primary');submit.type='submit';submit.dataset.consentAction='';form.append(submit);
      form.addEventListener('submit',event=>{event.preventDefault();if(check.checked)void save(true);});actions.append(form);
    }else node.append(el('p','New permission can only be granted for your currently verified email and an active store.','preference-time'));
    const retry=button('Retry confirmation',()=>save());retry.hidden=true;retry.dataset.consentRetry='';actions.append(retry);
    const reload=button('Reload saved preferences',()=>loadList());reload.hidden=true;actions.append(reload);
    node.append(actions,status,history(item));
    async function save(allow){
      if(ended||busy||!node.isConnected)return;
      const ref=JSON.stringify([item.sellerId,item.email]);let task=pending.get(ref);
      if(task?.running)return;
      if(!task){if(typeof allow!=='boolean')return;task={body:{sellerId:item.sellerId,email:item.email,revision:item.revision,allow,requestKey:key(),policyVersion:item.policyVersion,statement:item.statement},running:false};pending.set(ref,task);}
      task.running=true;node.dataset.locked='true';retry.hidden=true;retry.disabled=true;reload.hidden=true;controls();status.textContent='Saving your choice…';
      try{const data=await api({},task.body);if(ended||!node.isConnected)return;
        if(data.preference?.sellerId!==item.sellerId||data.preference?.email!==item.email||!Number.isSafeInteger(data.preference?.revision)||!['granted','withdrawn'].includes(data.preference?.state))throw Error('The saved preference response was incomplete.');
        pending.delete(ref);const replacement=card(data.preference);node.replaceWith(replacement);
        replacement.querySelector('[data-consent-save-status]').textContent=data.preference.revision>data.receipt.revision?'Your request was confirmed. Showing your more recent saved choice.':'Saved. '+(data.preference.state==='granted'?'Promotional emails are allowed.':'Promotional emails are stopped.');
      }catch(error){if(!node.isConnected||ended)return;
        if([400,403,404,409,413,422].includes(error.status)){pending.delete(ref);reload.hidden=false;status.textContent=error.message+' Reload your saved preferences before choosing again.';}
        else{retry.hidden=false;status.textContent=error.message+' Keep this page open and retry confirmation. Your original choice is kept.';}
      }finally{task.running=false;retry.disabled=false;controls();}
    }
    return node;
  }
  async function loadList(append=false){
    if(ended){location.reload();return;}if(busy||pending.size)return;const current=++version;busy=true;controls();errorText('');q('[data-consent-status]').textContent='Loading your preferences…';
    try{const data=await api({...(!append&&root.dataset.order?{order:root.dataset.order}:{}),...(append?{cursor}:{})});if(current!==version||ended)return;
      if(!Array.isArray(data.items)||typeof data.email!=='string')throw Error('The preference list was incomplete.');
      if(!append)list.replaceChildren();for(const item of data.items)list.append(card(item));cursor=data.nextCursor;more.hidden=!cursor;
      q('[data-consent-account]').textContent='Verified email: '+data.email;q('[data-consent-status]').textContent=list.children.length?'Your preferences are up to date.':'No stores are linked to this account yet. Open a signed-in order to add its store.';
    }catch(error){if(current===version&&!ended){errorText(error.message);q('[data-consent-status]').textContent='Preferences could not be refreshed. Retry when ready.';}}
    finally{if(current===version){busy=false;controls();}}
  }
  refresh.addEventListener('click',()=>loadList());more.addEventListener('click',()=>loadList(true));
  window.addEventListener('beforeunload',event=>{if(pending.size){event.preventDefault();event.returnValue='';}});
  window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
  async function checkSession(){
    if(ended)return;
    try{const response=await fetch('/cart/api/customer-session.php',{cache:'no-store',signal:AbortSignal.timeout(12000)}),data=await response.json();
      if(response.ok&&(!data.authenticated||data.version!==root.dataset.version))changed('Your sign-in changed. Reload this page.');
    }catch{/* The next preference request also checks the session before reading or writing. */}
  }
  window.addEventListener('focus',checkSession);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)void checkSession();});
  void loadList();
})();
