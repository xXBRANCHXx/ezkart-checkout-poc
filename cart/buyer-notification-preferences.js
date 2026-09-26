(() => {
  'use strict';
  window.EzkartBuyerNotificationPreferences={mount(root,config,api){
    const panel=root.querySelector('[data-buyer-preferences]');if(!panel)return null;
    const q=selector=>panel.querySelector(selector),form=q('[data-buyer-pref-form]'),compare=q('[data-buyer-pref-comparison]'),history=q('[data-buyer-pref-history-dialog]');
    const labels={payment_confirmed:'Payment confirmed',payment_pending:'Payment reminders',payment_failed:'Payment unsuccessful',shipping:'Shipping updates',returns:'Returns',messages:'Store messages'};
    const paths=Object.keys(labels).flatMap(key=>[key+'.inApp',key+'.email']),copy=value=>JSON.parse(JSON.stringify(value));
    const value=(data,path)=>{const [group,channel]=path.split('.');return data[group][channel];},put=(data,path,on)=>{const [group,channel]=path.split('.');data[group][channel]=on;};
    const valid=data=>data&&typeof data==='object'&&!Array.isArray(data)&&Object.keys(data).length===6&&Object.keys(labels).every(key=>data[key]&&Object.keys(data[key]).length===2&&typeof data[key].inApp==='boolean'&&typeof data[key].email==='boolean');
    const same=(a,b)=>paths.every(path=>value(a,path)===value(b,path)),dirty=()=>base&&!same(base,draft),title=path=>labels[path.split('.')[0]]+' · '+(path.endsWith('.email')?'Email':'In-app');
    const date=stamp=>new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(stamp));
    const node=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
    const key=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),v=>v.toString(16).padStart(2,'0')).join('');
    const storageKey='ezkart.buyer-notifications.v1:'+config.environment+':'+config.account;
    let active=false,loaded=false,dead=false,busy=false,ready=true,base=null,draft=null,revision=0,pending=null,latest=null,merged=null,error='',message='';
    let historyVersion=0,historyBusy=false,historyCursor=null,historyStarted=false;
    function persist(){sessionStorage.setItem(storageKey,JSON.stringify({version:1,base,draft,revision,pending}));}
    function fill(){if(draft)for(const path of paths)form.elements.namedItem(path).checked=value(draft,path);}
    function controls(){
      if(dead)return;form.querySelector('fieldset').disabled=!loaded||busy||Boolean(pending)||!ready;
      q('[data-buyer-pref-save]').disabled=!loaded||busy||Boolean(pending)||!ready||!dirty();q('[data-buyer-pref-save]').textContent=latest?'Compare saved changes':'Save preferences';
      q('[data-buyer-pref-retry]').hidden=!pending;q('[data-buyer-pref-retry]').disabled=busy||!ready;
      q('[data-buyer-pref-compare]').disabled=!loaded||busy||Boolean(pending)||!ready;q('[data-buyer-pref-history]').disabled=!loaded||busy;
      q('[data-buyer-pref-status]').textContent=busy?'Checking saved preferences…':pending?'Your previous save needs confirmation. Retry the original save to check it.':latest?'Saved preferences changed. Compare them with your draft before saving.':message||(dirty()?'You have unsaved changes.':'Your saved preferences are shown.');
      q('[data-buyer-pref-error]').textContent=error;q('[data-buyer-pref-error]').hidden=!error;
    }
    function remember(){try{persist();}catch{ready=false;error='This browser could not preserve your save. Allow session storage before saving, and keep this tab open.';}controls();}
    function check(result){if(result.accountId!==config.account||!valid(result.values)||!Number.isSafeInteger(result.revision)||result.revision<0)throw Error('Your saved preferences could not be verified. Reload to try again.');
      q('[data-buyer-pref-delivery]').hidden=false;q('[data-buyer-pref-delivery]').textContent=(result.delivery?.inAppEnabled?'In-app choices apply to new updates.':'In-app delivery is not enabled yet. Your choices are saved for when it is available.')+' '+(result.delivery?.emailEnabled?'Email goes to your currently confirmed account address.':'Email delivery is not connected yet. Your email choices are saved.');return result;
    }
    function use(result){base=copy(result.values);draft=copy(result.values);revision=result.revision;latest=null;}
    async function activate(){
      active=true;if(dead||busy||loaded)return;busy=true;error='';controls();q('[data-buyer-pref-load]').hidden=true;
      try{const result=check(await api('/preferences'));if(dead)return;use(result);
        try{const raw=sessionStorage.getItem(storageKey);if(raw){const stored=JSON.parse(raw);
          if(stored.version!==1||!valid(stored.base)||!valid(stored.draft)||!Number.isSafeInteger(stored.revision)||stored.revision<0||stored.pending&&(!valid(stored.pending.values)||!same(stored.pending.values,stored.draft)||stored.pending.revision!==stored.revision||!/^[a-f0-9]{32}$/.test(stored.pending.requestKey)))throw Error('This tab has an unreadable saved draft. Preserve any changes you need before clearing its session storage.');
          if(stored.pending||!same(stored.base,stored.draft)){base=stored.base;draft=stored.draft;revision=stored.revision;pending=stored.pending||null;if(!pending&&result.revision!==revision)latest=copy(result);}
        }persist();}catch(e){ready=false;error=e.message||'This browser could not preserve your preferences.';}
        loaded=true;fill();
      }catch(e){if(!dead){error=e.message;q('[data-buyer-pref-load]').hidden=false;}}
      finally{busy=false;controls();}
    }
    async function getLatest(){latest=copy(check(await api('/preferences')));return latest;}
    function openCompare(){
      if(dead||!active||!latest)return;merged=copy(latest.values);const rows=q('[data-buyer-pref-comparison-rows]');rows.replaceChildren();
      for(const path of paths){const mine=value(draft,path),old=value(base,path),saved=value(latest.values,path),mineChanged=mine!==old,savedChanged=saved!==old;
        if(!mineChanged&&!savedChanged)continue;if(mineChanged&&!savedChanged)put(merged,path,mine);
        const row=node('div');row.className='buyer-pref-compare-row';row.append(node('h3',title(path)),node('p','Your draft: '+(mine?'On':'Off')+' · Latest saved: '+(saved?'On':'Off')));
        if(mineChanged&&savedChanged&&mine!==saved){const label=node('label','Use for '+title(path)),select=node('select');select.setAttribute('aria-label','Use for '+title(path));select.append(new Option('Latest saved value','saved'),new Option('My draft value','draft'));select.addEventListener('change',()=>put(merged,path,select.value==='draft'?mine:saved));label.append(select);row.append(label);}
        else row.append(node('small',mineChanged&&!savedChanged?'Your change will be kept.':'The latest saved value will be kept.'));rows.append(row);
      }
      if(!rows.children.length)rows.append(node('p','Your draft already matches the saved preferences.'));compare.showModal();
    }
    async function review(){if(dead||busy||pending||!ready)return;busy=true;error='';controls();try{await getLatest();openCompare();}catch(e){if(!dead)error=e.message;}finally{busy=false;controls();}}
    async function save(){
      if(dead||busy||!ready||!loaded)return;const retry=Boolean(pending);busy=true;error='';message='';let sent=false;
      try{
        if(!pending){pending={revision,requestKey:key(),values:copy(draft)};try{persist();}catch{pending=null;ready=false;throw Error('This browser could not preserve the save. Allow session storage before saving.');}}
        controls();sent=true;const result=await api('/preferences',pending);if(dead)return;const receipt=result.receipt;
        if(!receipt||receipt.requestKey!==pending.requestKey||receipt.revision!==pending.revision+1||!valid(receipt.values)||!same(receipt.values,pending.values)||result.revision<receipt.revision)throw Error('The result did not confirm this save. Retry the original save to recover it.');
        check(result);pending=null;use(result);message=result.revision>receipt.revision?'Your original save was confirmed. Newer saved preferences are now shown.':'Notification preferences saved.';persist();fill();
      }catch(e){if(dead)return;error=e.message;
        if(sent&&((!retry&&[400,413,415,422,429].includes(e.status))||e.code==='buyer_notification_revision_conflict')){pending=null;try{persist();}catch{ready=false;}
          if(e.code==='buyer_notification_revision_conflict')try{await getLatest();openCompare();}catch(read){error+=' '+read.message;}
        }
      }finally{busy=false;controls();}
    }
    function apply(saved){if(dead||!latest||!merged)return;const result=copy(latest),chosen=copy(saved?latest.values:merged);use(result);draft=chosen;merged=null;error='';message=saved?'Saved preferences loaded.':'Compared choices are ready. Save to apply them.';remember();fill();compare.close();q(dirty()?'[data-buyer-pref-save]':'[data-buyer-pref-compare]').focus();}
    async function loadHistory(){
      if(dead||historyBusy)return;historyBusy=true;const version=historyVersion;q('[data-buyer-pref-history-more]').disabled=true;q('[data-buyer-pref-history-retry]').hidden=true;q('[data-buyer-pref-history-status]').textContent='Loading history…';
      try{const result=await api('/preferences/history'+(historyCursor?'?cursor='+encodeURIComponent(historyCursor):''));if(dead||version!==historyVersion)return;
        if(!Array.isArray(result.items)||result.items.some(item=>!valid(item.values)||!Number.isSafeInteger(item.revision)||item.revision<1))throw Error('Preference history could not be verified. Try again.');
        const list=q('[data-buyer-pref-history-items]');for(const item of result.items){const li=node('li'),details=node('details');details.append(node('summary','Version '+item.revision+' · '+date(item.createdAt)));const dl=node('dl');for(const path of paths)dl.append(node('dt',title(path)),node('dd',value(item.values,path)?'On':'Off'));details.append(dl);li.append(details);list.append(li);}
        historyCursor=result.nextCursor;historyStarted=true;q('[data-buyer-pref-history-more]').hidden=!historyCursor;q('[data-buyer-pref-history-status]').textContent=list.children.length?list.children.length+' saved changes shown.':'No saved changes yet.';
      }catch(e){if(!dead&&version===historyVersion){q('[data-buyer-pref-history-status]').textContent=e.message;q('[data-buyer-pref-history-retry]').hidden=false;}}
      finally{historyBusy=false;if(!dead){q('[data-buyer-pref-history-more]').disabled=false;if(version!==historyVersion&&history.open)void loadHistory();}}
    }
    form.addEventListener('change',()=>{if(dead||!loaded||busy||pending||!ready)return;for(const path of paths)put(draft,path,form.elements.namedItem(path).checked);error='';message='';remember();});
    form.addEventListener('submit',event=>{event.preventDefault();if(!dirty()||pending)return;void(latest?review():save());});
    q('[data-buyer-pref-retry]').addEventListener('click',()=>void save());q('[data-buyer-pref-compare]').addEventListener('click',()=>void review());q('[data-buyer-pref-load]').addEventListener('click',()=>void activate());
    q('[data-buyer-pref-apply]').addEventListener('click',()=>apply(false));q('[data-buyer-pref-use-saved]').addEventListener('click',()=>apply(true));
    q('[data-buyer-pref-history]').addEventListener('click',()=>{historyVersion++;historyCursor=null;historyStarted=false;q('[data-buyer-pref-history-items]').replaceChildren();history.showModal();void loadHistory();});
    q('[data-buyer-pref-history-more]').addEventListener('click',()=>{if(historyCursor)void loadHistory();});q('[data-buyer-pref-history-retry]').addEventListener('click',()=>{if(!historyStarted||historyCursor)void loadHistory();});
    panel.querySelectorAll('[data-buyer-pref-close]').forEach(button=>button.addEventListener('click',()=>button.closest('dialog').close()));
    window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
    window.addEventListener('beforeunload',event=>{if(!dead&&!ready&&dirty()){event.preventDefault();event.returnValue='';}});
    return {activate,refresh:async()=>{if(!loaded)return activate();return review();},deactivate(){active=false;historyVersion++;compare.close();history.close();},destroy(){dead=true;active=false;historyVersion++;compare.close();history.close();panel.replaceChildren();}};
  }};
})();
