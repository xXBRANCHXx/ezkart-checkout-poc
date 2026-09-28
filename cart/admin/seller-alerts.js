(() => {
 'use strict';
 const bell=document.querySelector('[data-notification-bell]');if(!bell)return;
 const config=JSON.parse(bell.dataset.notificationBell),detail=document.querySelector('[data-seller-alert-detail]'),inbox=document.querySelector('[data-notification-workspace]'),grid=document.querySelector('[data-project-grid]');
 if(!config.enabled||!config.store)return;
 let items=[],busy=false,notice='';const storageKey='ezkart:alert-rescan:'+config.account+':'+config.store;let pending;
 try{pending=JSON.parse(sessionStorage.getItem(storageKey)||'null');}catch{}
 const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
 const link=(text,href)=>{const a=el('a',text);a.href=href;return a;};
 async function api(action,body){const r=await fetch('/cart/admin/?cloud='+encodeURIComponent('/v1/commerce/notifications/'+action),{method:body?'POST':'GET',cache:'no-store',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Ezkart-CSRF':config.csrf,'X-Ezkart-Notification-Account':config.account,'X-Ezkart-Notification-Store':config.store},body:body?JSON.stringify(body):undefined});const d=await r.json();if(!r.ok||!d.ok){const e=Error(d.error||'Alerts could not be loaded.');e.status=r.status;throw e;}return d;}
 function clock(a){const n=el('p',undefined,'seller-alert-countdown');n.dataset.alertDeadline=a.deadlineAt;return n;}
 function tick(){document.querySelectorAll('[data-alert-deadline]').forEach(n=>{const minutes=Math.ceil((Date.parse(n.dataset.alertDeadline)-Date.now())/60000);n.textContent=minutes>0?`${Math.floor(minutes/1440)}d ${Math.floor(minutes%1440/60)}h ${minutes%60}m remaining to request a re-scan`:'Deadline reached · awaiting human review';});}
 function card(a,full=false){const c=el('article',undefined,'seller-alert');c.append(el('h2',a.name+' — temporarily unavailable'),el('p',a.reason),clock(a));
  if(full){c.append(el('p','This page is hidden from visitors until the issue is resolved. You can still edit it. Existing orders remain available.'));
   for(const f of a.findings||[])c.append(el('blockquote',f.quote),el('p',f.explanation));
   c.append(el('p',a.remainingRescans+' of 3 re-scan requests remaining. The five-day deadline does not reset. Expiry sends the case to human review; it does not delete your page.'));
   if(a.state==='rescan_queued')c.append(el('p','Re-scan requested. Waiting for a reviewer; the page remains unavailable.'));
   if(a.state==='human_review')c.append(el('p','Human review is required. The page stays unavailable until the review is settled.'));
   const actions=el('div',undefined,'seller-alert-actions'),b=el('button',pending?.id===a.id?'Retry re-scan request':'Request re-scan','action-button');b.type='button';b.disabled=busy||(!a.canRescan&&pending?.id!==a.id)|| (!!pending&&pending.id!==a.id);b.addEventListener('click',()=>rescan(a));actions.append(link('Edit page',a.editHref),b);c.append(actions);
   if(!a.canRescan&&a.state==='changes_required')c.append(el('p','Save the corrected page, then refresh this alert to request a re-scan.'));
  }else c.append(link('View reason and resolve',a.href));return c;
 }
 let warningBox;if(inbox){warningBox=el('section');warningBox.setAttribute('aria-label','Alerts requiring action');inbox.querySelector('[data-notice-inbox]').prepend(warningBox);inbox.querySelector('[data-notice-refresh]')?.addEventListener('click',load);}
 function decorate(){if(!grid)return;grid.querySelectorAll('[data-project-card]').forEach(c=>{const a=items.find(a=>a.pageId===String(c.dataset.siteUrl||'').replace(/\.ezkart\.site$/, ''));c.classList.toggle('has-content-alert',!!a);const old=c.querySelector('.seller-alert');if(a&&!old){c.append(card(a));const status=c.querySelector('.project-status');if(status)status.textContent='Temporarily unavailable';}else if(!a&&old){old.remove();}});tick();}
 function render(){if(warningBox)warningBox.replaceChildren(...items.map(a=>card(a)));if(detail){const id=new URL(location.href).searchParams.get('alert'),selected=id?items.filter(a=>a.id===id):items;detail.replaceChildren();if(notice)detail.append(el('p',notice));if(!selected.length)detail.append(el('p',id?'This alert is resolved or is not available for your store.':'No unresolved alerts.'));selected.forEach(a=>detail.append(card(a,true)));const refresh=el('button','Refresh','action-button');refresh.type='button';refresh.disabled=busy;refresh.onclick=load;detail.append(refresh);}decorate();tick();}
 async function load(){try{items=(await api('alerts')).items||[];render();}catch(e){const target=detail||warningBox;if(target){target.replaceChildren(el('p',e.message));const retry=el('button','Retry loading alerts','action-button');retry.onclick=load;target.append(retry);}}}
 async function rescan(a){if(busy)return;try{if(!pending){pending={id:a.id,expectedRevision:a.revision,requestKey:crypto.randomUUID().replaceAll('-','')};sessionStorage.setItem(storageKey,JSON.stringify(pending));}}catch{pending=null;notice='Enable session storage to preserve your original request safely.';render();return;}busy=true;render();try{const result=await api('alert-rescan',pending);sessionStorage.removeItem(storageKey);pending=null;items=result.items;notice='Re-scan requested. A reviewer will check your saved changes.';}catch(e){notice=e.message;if(e.status>=400&&e.status<500&&![401,403,408,429].includes(e.status)){sessionStorage.removeItem(storageKey);pending=null;}}finally{busy=false;render();}}
 if(grid)new MutationObserver(()=>decorate()).observe(grid,{childList:true});
 void load();setInterval(tick,30000);
})();
