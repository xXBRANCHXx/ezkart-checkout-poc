(() => {
  'use strict';
  const root=document.querySelector('[data-message-workspace]');if(!root)return;
  const config=JSON.parse(root.dataset.config),find=s=>root.querySelector(s),all=s=>[...root.querySelectorAll(s)];
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const key=()=>[...crypto.getRandomValues(new Uint8Array(16))].map(v=>v.toString(16).padStart(2,'0')).join('');
  const scope=['ezkart.messages.v1',config.merchant?'merchant':'buyer',config.account,config.store||'',config.environment,config.version].join(':');
  const storageGet=id=>{try{return JSON.parse(sessionStorage.getItem(scope+':'+id)||'null');}catch{return null;}};
  const storagePut=(id,data)=>{try{if(data)sessionStorage.setItem(scope+':'+id,JSON.stringify(data));else sessionStorage.removeItem(scope+':'+id);}catch{throw Error('Your browser could not save the retry reference. Free some browser storage before sending.');}};
  const controller=new AbortController(),blobs=new Map();let dead=false,selected='',detail=null,draft=null,events=new Map(),older=null,listCursor=null,listRows=[],listEpoch=0,detailEpoch=0,canWrite=false,busy=false,replyBusy=false,replies=[],replyPending=storageGet('saved-reply');
  const date=value=>config.merchant&&window.EzkartAdminFormat?window.EzkartAdminFormat.date(value):new Date(value).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
  const notice=(text,error=false)=>{const node=find(error?'[data-msg-error]':'[data-msg-notice]');node.textContent=text;node.hidden=!text;};
  function invalidate(message){dead=true;controller.abort();listEpoch++;detailEpoch++;find('[data-msg-list]').replaceChildren();find('[data-msg-detail]').replaceChildren();find('[data-msg-stats]')?.replaceChildren();for(const url of blobs.values())URL.revokeObjectURL(url);blobs.clear();all('dialog[open]').forEach(d=>d.close());all('button,input,textarea,select').forEach(n=>n.disabled=true);notice(message,true);const link=find('[data-msg-signin]');link.href=location.href;link.hidden=false;}
  function endpoint(path){return config.merchant?'/cart/admin/?cloud='+encodeURIComponent('/v1/commerce/messages'+path):'/cart/admin/customer-messages.php?path='+encodeURIComponent(path);}
  async function api(path,body,photo=false){
    if(dead)throw Error('Reload your sign-in.');
    const headers={'Accept':photo?'image/*':'application/json','X-Ezkart-CSRF':config.csrf};
    if(config.merchant){headers['X-Ezkart-Message-Account']=config.account;headers['X-Ezkart-Message-Store']=config.store;}else headers['X-Ezkart-Customer-Session']=config.version;
    if(body!==undefined)headers['Content-Type']='application/json';
    const response=await fetch(endpoint(path),{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body),cache:'no-store',credentials:'same-origin',signal:controller.signal});
    if(photo&&response.ok&&/^image\/(png|jpeg|webp)$/.test(response.headers.get('content-type')||''))return response.blob();
    const data=await response.json().catch(()=>({}));
    if(response.status===401||String(data.code||'').endsWith('session_changed'))invalidate(data.error||'Your sign-in changed. Reload this page.');
    if(!response.ok||!data.ok){const error=Error(data.error||'The result was not confirmed. Try again.');error.status=response.status;throw error;}
    return data;
  }
  function saveDraft(){if(selected&&draft)storagePut(selected,draft);}
  function setLocation(id){const url=new URL(location.href);if(id)url.searchParams.set('conversation',id);else url.searchParams.delete('conversation');for(const name of ['order','product','store','page','tracking_visit'])if(!config.merchant)url.searchParams.delete(name);history.replaceState({},'',url);}
  const originLabel=c=>c.origin?`${c.origin.pageName}${c.origin.platform?' ['+c.origin.platform+']':''}${c.origin.campaign?' '+c.origin.campaign:''}`:'Source not recorded';
  function renderList(){find('[data-msg-list]').innerHTML=listRows.map(c=>`<button type="button" class="msg-thread" data-msg-thread="${esc(c.id)}" aria-current="${c.id===selected}"><span class="msg-avatar" aria-hidden="true">${esc(c.name.slice(0,1).toUpperCase())}</span><span class="msg-thread-content"><span class="msg-thread-title"><b translate="no">${esc(c.name)}</b>${c.unread?'<span class="msg-unread" aria-label="Unread messages"></span>':''}</span>${config.merchant?`<small class="msg-origin" translate="no">${esc(originLabel(c))}</small>`:''}<p translate="no">${esc(c.lastMessage||'No messages yet')}</p><small>${esc(c.state)} · ${esc(date(c.updatedAt))}</small></span></button>`).join('');find('[data-msg-more]').hidden=!listCursor;}
  function syncFolders(){const form=find('[data-msg-filters]');all('[data-msg-folder]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.msgFolder===(form.elements.unread.value==='1'?'unread':form.elements.state.value))));}
  async function loadStats(){if(!config.merchant)return;try{const s=await api('/stats');if(dead)return;const seconds=s.medianFirstResponseSeconds;const value=seconds===null?'—':seconds<60?'< 1 min':seconds<3600?Math.round(seconds/60)+' min':(seconds/3600).toFixed(1)+' hr';for(const field of ['open','needsResponse'])find(`[data-msg-count="${field}"]`).textContent=s[field];find('[data-msg-stats]').innerHTML=`<small>Resolved today</small><strong>${esc(s.resolvedToday)}</strong><small>Median first response</small><strong>${esc(value)}</strong><p>First replies · last 30 days</p>`;}catch(error){if(!dead)notice('Statistics could not be refreshed. '+error.message,true);}}
  async function loadList(more=false){
    const ticket=++listEpoch,form=find('[data-msg-filters]'),params=new URLSearchParams(new FormData(form));if(more&&listCursor)params.set('cursor',listCursor);
    find('[data-msg-list-status]').textContent='Loading conversations…';find('[data-msg-more]').disabled=true;
    try{const data=await api('?'+params);if(ticket!==listEpoch||dead)return;listRows=more?[...listRows,...data.items.filter(c=>!listRows.some(old=>old.id===c.id))]:data.items;listCursor=data.nextCursor;canWrite=data.canWrite&&config.enabled;
      renderList();find('[data-msg-list-status]').textContent=listRows.length?`${listRows.length} conversations loaded.`:'No conversations match this view.';
      find('[data-msg-new]')?.toggleAttribute('disabled',!canWrite);if(!data.enabled)notice('Messaging is not enabled yet. Conversations will appear here when it opens.');
    }catch(error){if(ticket===listEpoch&&!dead){find('[data-msg-list-status]').textContent=error.message;find('[data-msg-more]').textContent='Retry more conversations';}}
    finally{if(ticket===listEpoch&&!dead)find('[data-msg-more]').disabled=false;}
  }
  function contextMarkup(context){if(!context?.kind)return '';const url=context.kind==='order'?(config.merchant?'/cart/admin/?page=orders&order=':'/cart/return.php?order=')+encodeURIComponent(context.id):context.kind==='product'?'/cart/?product='+encodeURIComponent(context.id):'/shop/?store='+encodeURIComponent(context.id);return `<a class="msg-context" href="${esc(url)}">${esc(context.kind==='order'?'Order '+context.id:context.label||context.id)}</a>`;}
  async function loadPhotos(){const id=selected,ticket=detailEpoch;for(const node of all('[data-msg-photo]')){const photo=node.dataset.msgPhoto;if(node.querySelector('img'))continue;try{let url=blobs.get(photo);if(!url){url=URL.createObjectURL(await api('/'+id+'/media/'+photo,undefined,true));if(ticket!==detailEpoch||dead){URL.revokeObjectURL(url);return;}blobs.set(photo,url);}if(!node.isConnected)continue;const img=document.createElement('img');img.alt='Attached photo';img.src=url;node.replaceChildren(img);}catch(error){if(!dead&&node.isConnected){node.textContent='Retry photo';node.dataset.msgPhotoFailed='1';}}}}
  function renderEvents(keepPosition=false){
    const timeline=find('[data-msg-timeline]');if(!timeline)return;const bottom=timeline.scrollHeight-timeline.scrollTop-timeline.clientHeight<48,oldHeight=timeline.scrollHeight,oldTop=timeline.scrollTop;
    timeline.innerHTML=(older?'<button type="button" data-msg-older>Load older messages</button>':'')+[...events.values()].sort((a,b)=>a.id-b.id).map(e=>e.kind==='state'?`<div class="msg-event msg-state">Conversation ${esc(e.state==='open'?'reopened':e.state)} · ${esc(date(e.createdAt))}</div>`:
      `<article class="msg-event ${e.mine?'mine':''}" data-event-id="${e.id}">${contextMarkup(e.context)}<div class="msg-bubble">${esc(e.body)}${e.photos.length?`<div class="msg-photos">${e.photos.map((p,i)=>`<button type="button" class="msg-photo" data-msg-photo="${esc(p)}" aria-label="Open attached photo ${i+1}">Loading photo…</button>`).join('')}</div>`:''}</div><small>${e.mine?'You':e.sender==='merchant'?'Store':'Customer'} · ${esc(date(e.createdAt))}${e.mine&&e.id<=detail.readThrough?' · Read':''}</small></article>`).join('')||'<p class="msg-list-status">Send the first message to start the conversation.</p>';
    if(keepPosition)timeline.scrollTop=oldTop+timeline.scrollHeight-oldHeight;else if(bottom||oldHeight===0)timeline.scrollTop=timeline.scrollHeight;
    void loadPhotos();void markRead();
  }
  async function markRead(){const timeline=find('[data-msg-timeline]');if(dead||!config.enabled||!timeline||document.hidden||!timeline.getClientRects().length||timeline.scrollHeight-timeline.scrollTop-timeline.clientHeight>48||!detail?.conversation.lastEventId)return;
    const id=selected,visible=Math.max(0,...events.keys());if(!visible||visible<=Number(timeline.dataset.readThrough||0))return;timeline.dataset.readThrough=String(visible);
    try{await api('/'+id+'/read',{eventId:visible});if(id===selected){const row=listRows.find(c=>c.id===id);if(row){row.unread=false;renderList();}}}catch{if(id===selected&&timeline.isConnected)timeline.dataset.readThrough='0';}}
  function syncComposer(){
    if(!draft||!detail||!find('[data-msg-composer]'))return;
    const pending=Boolean(draft.pending),upload=Boolean(draft.upload),locked=busy||pending||upload||!detail.canWrite||!config.enabled;
    find('[data-msg-body]').disabled=locked;find('[data-msg-send]').disabled=locked;find('[data-msg-attach]').disabled=locked||draft.photos.length>=4;find('[data-msg-draft-clear]').disabled=busy||pending||upload;
    const retry=find('[data-msg-retry]');retry.hidden=!pending&&!upload;retry.disabled=busy;retry.innerHTML='<svg class="msg-icon" aria-hidden="true"><use href="#msg-icon-refresh"/></svg>'+ (upload?'Retry photo upload':'Retry confirmation');
    find('[data-msg-draft-photos]').innerHTML=draft.photos.map((p,i)=>`<span>Photo ${i+1}<button type="button" data-msg-remove="${esc(p)}" aria-label="Remove photo ${i+1}" ${locked?'disabled':''}>×</button></span>`).join('');
    find('[data-msg-draft-context]').textContent=draft.context?'About '+(draft.context.label||draft.context.id):'';
    all('[data-msg-state]').forEach(b=>b.disabled=busy||pending||upload||!canWrite);
    find('[data-msg-detail-state]').textContent=detail.conversation.state==='blocked'?'Blocked · reopen to continue messaging':detail.conversation.state==='resolved'?'Resolved · a new message reopens this conversation':'Open conversation';
    if(!detail.canWrite&&!pending&&!upload)find('[data-msg-send-status]').textContent=detail.conversation.state==='blocked'?'The store has blocked this conversation.':'Sending is unavailable for your account or this environment.';
  }
  function buildDetail(){find('[data-msg-detail]').innerHTML=`<header class="msg-conversation-head"><div class="msg-actions"><button type="button" class="msg-back" data-msg-back>← Inbox</button><div><h2 tabindex="-1" data-msg-detail-name>${esc(detail.conversation.name)}</h2><p data-msg-detail-state></p>${config.merchant?`<p class="msg-origin" translate="no">${esc(originLabel(detail.conversation))}</p>`:''}</div></div><div class="msg-actions"><button type="button" data-msg-detail-refresh><svg class="msg-icon" aria-hidden="true"><use href="#msg-icon-refresh"/></svg>Refresh conversation</button>${config.merchant?'<button type="button" data-msg-state="resolved"><svg class="msg-icon" aria-hidden="true"><use href="#msg-icon-check"/></svg>Resolve</button><button type="button" data-msg-state="open"><svg class="msg-icon" aria-hidden="true"><use href="#msg-icon-reply"/></svg>Reopen</button><button type="button" data-msg-state="blocked"><svg class="msg-icon" aria-hidden="true"><use href="#msg-icon-block"/></svg>Block</button>':''}</div></header><div class="msg-timeline" data-msg-timeline aria-label="Conversation history"></div><form class="msg-composer" data-msg-composer><span class="msg-context-draft" data-msg-draft-context></span><label>Message<textarea rows="3" maxlength="4000" data-msg-body placeholder="Write a message…"></textarea></label><div class="msg-draft-photos" data-msg-draft-photos></div><p data-msg-send-status role="status"></p><div class="msg-compose-footer"><div class="msg-actions"><button type="button" data-msg-attach><svg class="msg-icon" aria-hidden="true"><use href="#msg-icon-photo"/></svg>Attach photo</button>${config.merchant?'<button type="button" data-msg-replies><svg class="msg-icon" aria-hidden="true"><use href="#msg-icon-messages"/></svg>Saved replies</button>':''}<button type="button" data-msg-draft-clear><svg class="msg-icon" aria-hidden="true"><use href="#msg-icon-trash"/></svg>Clear draft</button></div><div class="msg-actions"><button type="button" data-msg-retry hidden>Retry confirmation</button><button type="submit" class="msg-primary" data-msg-send><svg class="msg-icon" aria-hidden="true"><use href="#msg-icon-send"/></svg>Send message</button></div><small>Up to 4 photos · JPEG, PNG or WebP · 1 MB each</small></div><input type="file" accept="image/jpeg,image/png,image/webp" data-msg-file hidden></form>`;
    find('[data-msg-body]').value=draft.body;find('[data-msg-timeline]').addEventListener('scroll',()=>void markRead(),{passive:true});syncComposer();renderEvents();find('[data-msg-timeline]').scrollTop=find('[data-msg-timeline]').scrollHeight;void markRead();
    if(draft.pending||draft.upload)find('[data-msg-send-status]').textContent='A previous request still needs confirmation. Retry it to check the original result.';
  }
  async function openConversation(id,context=null){
    if(busy)return;const ticket=++detailEpoch;selected=id;detail=null;events=new Map();older=null;draft=storageGet(id)||{body:'',photos:[],context:null,pending:null,upload:null};if(context&&!draft.pending){draft.context=context;saveDraft();}
    root.classList.add('has-conversation');setLocation(id);renderList();find('[data-msg-detail]').innerHTML='<p class="msg-list-status" role="status">Loading conversation…</p>';
    try{const data=await api('/'+id);if(ticket!==detailEpoch||dead)return;detail=data;older=data.nextCursor;data.items.forEach(e=>events.set(e.id,e));buildDetail();}
    catch(error){if(ticket===detailEpoch&&!dead){find('[data-msg-detail]').innerHTML='<div class="msg-empty"><p></p><button type="button" data-msg-detail-refresh><svg class="msg-icon" aria-hidden="true"><use href="#msg-icon-refresh"/></svg>Retry conversation</button><button type="button" data-msg-back>Back to inbox</button></div>';find('[data-msg-detail] p').textContent=error.message;}}
  }
  async function refreshDetail(more=false){if(!selected||dead)return;if(!detail)return openConversation(selected);const id=selected,ticket=detailEpoch,cursor=older;
    try{const data=await api('/'+id+(more&&cursor?'?cursor='+encodeURIComponent(cursor):''));if(ticket!==detailEpoch||dead)return;const changed=data.conversation.revision>detail.conversation.revision;if(data.conversation.revision>=detail.conversation.revision)detail=data;data.items.forEach(e=>events.set(e.id,e));if(changed){void loadStats();if(listRows.length<=30)void loadList();}if(more||events.size<=data.items.length)older=data.nextCursor;renderEvents(more);syncComposer();}
    catch(error){if(ticket===detailEpoch&&!dead)notice(error.message,true);}}
  async function confirmDraft(){
    if(busy||!selected||!draft||dead)return;busy=true;syncComposer();const id=selected;find('[data-msg-send-status]').textContent='Confirming…';
    try{
      saveDraft();
      if(draft.upload){const result=await api('/'+id+'/media',draft.upload);draft.photos.push(result.photo.id);draft.upload=null;saveDraft();find('[data-msg-send-status]').textContent='Photo attached to your draft.';}
      else if(draft.pending){const result=await api('/'+id,draft.pending);const message=draft.pending.kind==='message';draft.pending=null;if(message){draft.body='';draft.photos=[];draft.context=null;}find('[data-msg-body]').value=draft.body;try{saveDraft();}catch(error){notice(error.message,true);}find('[data-msg-send-status]').textContent=message?'Message sent.':'Conversation updated.';events.set(result.event.id,result.event);detail.conversation=result.conversation;await refreshDetail();void loadList();void loadStats();}
    }catch(error){if(!dead){if([400,403,404,409,410,413,415,422,429].includes(error.status)){draft.pending=null;draft.upload=null;try{saveDraft();}catch{}void refreshDetail();}find('[data-msg-send-status]').textContent=error.message;}}
    finally{busy=false;if(!dead)syncComposer();}
  }
  async function start(context,origin){const data=await api('',{context,...(origin?{origin}:{})});await openConversation(data.conversation.id,data.context);void loadList();}
  function resetReply(){find('[data-msg-reply-form]').reset();find('[data-msg-reply-form] [name=revision]').value='0';find('[data-msg-reply-form] [name=id]').value='';}
  function lockReplies(){all('[data-msg-reply-dialog] input,[data-msg-reply-dialog] textarea,[data-msg-reply-dialog] button').forEach(b=>{if(!b.hasAttribute('data-msg-close'))b.disabled=Boolean(replyPending)||replyBusy||!canWrite||(b.hasAttribute('data-msg-insert')&&(!selected||!draft||draft.pending||draft.upload||!detail?.canWrite));});find('[data-msg-reply-retry]').hidden=!replyPending;find('[data-msg-reply-retry]').disabled=replyBusy;}
  async function showReplies(){const dialog=find('[data-msg-reply-dialog]');if(!dialog.open)dialog.showModal();try{const result=await api('/replies');replies=result.items;find('[data-msg-reply-list]').innerHTML=replies.length?replies.map(r=>`<div class="msg-saved-reply"><b>${esc(r.title)}</b><p>${esc(r.body)}</p><div class="msg-actions"><button type="button" data-msg-insert="${esc(r.id)}" ${!selected?'disabled':''}>Insert into draft</button><button type="button" data-msg-edit="${esc(r.id)}">Edit</button><button type="button" data-msg-archive="${esc(r.id)}">Archive</button></div></div>`).join(''):'<p>No saved replies yet. Write your first one below.</p>';lockReplies();if(replyPending){const form=find('[data-msg-reply-form]');for(const k of ['title','body','id','revision'])form.elements[k].value=replyPending[k]||'';find('[data-msg-reply-error]').textContent='A previous save still needs confirmation.';}}catch(error){if(!dead)find('[data-msg-reply-error]').textContent=error.message;}}
  async function confirmReply(){if(!replyPending||replyBusy||dead)return;replyBusy=true;lockReplies();try{storagePut('saved-reply',replyPending);await api('/replies',replyPending);replyPending=null;storagePut('saved-reply',null);resetReply();find('[data-msg-reply-error]').textContent='Saved reply updated.';await showReplies();}catch(error){if(!dead){if([400,403,404,409,410,413,415,422,429].includes(error.status)){replyPending=null;storagePut('saved-reply',null);}find('[data-msg-reply-error]').textContent=error.message;}}finally{replyBusy=false;if(!dead)lockReplies();}}
  root.addEventListener('submit',async event=>{
    const form=event.target;event.preventDefault();if(dead)return;
    try{
      if(form.matches('[data-msg-filters]')){const url=new URL(location.href);for(const [k,v] of new FormData(form))url.searchParams.set(k,v);history.replaceState({},'',url);syncFolders();await loadList();}
      if(form.matches('[data-msg-composer]')&&!busy&&!draft.pending&&!draft.upload){draft.body=find('[data-msg-body]').value;if(!draft.body.trim()&&!draft.photos.length){find('[data-msg-send-status]').textContent='Write a message or attach a photo.';return;}draft.pending={kind:'message',body:draft.body,photos:draft.photos,requestKey:key(),...(draft.context?{context:{kind:draft.context.kind,id:draft.context.id}}:{})};saveDraft();await confirmDraft();}
      if(form.matches('[data-msg-new-form]')){form.querySelector('[type=submit]').disabled=true;await start({kind:'order',id:form.elements.order.value.trim()});find('[data-msg-new-dialog]').close();}
      if(form.matches('[data-msg-reply-form]')&&!replyPending&&!replyBusy){replyPending={id:form.elements.id.value,title:form.elements.title.value,body:form.elements.body.value,revision:Number(form.elements.revision.value),state:'active',requestKey:key()};storagePut('saved-reply',replyPending);await confirmReply();}
    }catch(error){if(!dead){if(form.matches('[data-msg-new-form]'))find('[data-msg-new-error]').textContent=error.message;else {notice(error.message,true);syncComposer();lockReplies();}}}finally{if(form.matches('[data-msg-new-form]'))form.querySelector('[type=submit]').disabled=false;}
  });
  root.addEventListener('input',event=>{if(event.target.matches('[data-msg-body]')&&draft&&!draft.pending){draft.body=event.target.value;try{saveDraft();}catch(error){notice(error.message,true);}}});
  root.addEventListener('change',async event=>{if(!event.target.matches('[data-msg-file]')||!draft||busy)return;const file=event.target.files[0];event.target.value='';if(!file)return;
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>1048576){find('[data-msg-send-status]').textContent='Choose a JPEG, PNG or WebP photo up to 1 MB.';return;}
    const id=selected;try{const dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('This photo could not be read.'));reader.readAsDataURL(file);});if(id!==selected)return;draft.upload={dataUrl,requestKey:key()};saveDraft();await confirmDraft();}catch(error){if(!dead)notice(error.message,true);}
  });
  root.addEventListener('click',async event=>{const button=event.target.closest('button');if(!button||button.disabled||dead)return;try{
    if(button.hasAttribute('data-msg-folder')){const form=find('[data-msg-filters]'),folder=button.dataset.msgFolder;form.elements.state.value=folder==='unread'?'all':folder;form.elements.unread.value=folder==='unread'?'1':'all';syncFolders();form.requestSubmit();}
    if(button.hasAttribute('data-msg-close'))button.closest('dialog').close();
    if(button.hasAttribute('data-msg-thread'))await openConversation(button.dataset.msgThread);
    if(button.hasAttribute('data-msg-refresh')){notice('',true);await loadList();void loadStats();if(selected)await refreshDetail();}
    if(button.hasAttribute('data-msg-more'))await loadList(true);
    if(button.hasAttribute('data-msg-back')&&!busy){root.classList.remove('has-conversation');selected='';detailEpoch++;detail=null;setLocation('');renderList();find('[data-msg-filters] input').focus();}
    if(button.hasAttribute('data-msg-detail-refresh'))await refreshDetail();
    if(button.hasAttribute('data-msg-older'))await refreshDetail(true);
    if(button.hasAttribute('data-msg-attach'))find('[data-msg-file]').click();
    if(button.hasAttribute('data-msg-retry'))await confirmDraft();
    if(button.hasAttribute('data-msg-remove')){draft.photos=draft.photos.filter(p=>p!==button.dataset.msgRemove);saveDraft();syncComposer();}
    if(button.hasAttribute('data-msg-draft-clear')){draft.body='';draft.photos=[];draft.context=null;saveDraft();find('[data-msg-body]').value='';syncComposer();}
    if(button.hasAttribute('data-msg-state')){draft.pending={kind:'state',state:button.dataset.msgState,revision:detail.conversation.revision,requestKey:key()};saveDraft();await confirmDraft();}
    if(button.hasAttribute('data-msg-new'))find('[data-msg-new-dialog]').showModal();
    if(button.hasAttribute('data-msg-replies'))await showReplies();
    if(button.hasAttribute('data-msg-reply-reset'))resetReply();
    if(button.hasAttribute('data-msg-reply-retry'))await confirmReply();
    if(button.hasAttribute('data-msg-edit')){const r=replies.find(r=>r.id===button.dataset.msgEdit),form=find('[data-msg-reply-form]');for(const k of ['id','title','body','revision'])form.elements[k].value=r[k];form.elements.title.focus();}
    if(button.hasAttribute('data-msg-archive')){const r=replies.find(r=>r.id===button.dataset.msgArchive);replyPending={...r,state:'archived',requestKey:key()};storagePut('saved-reply',replyPending);await confirmReply();}
    if(button.hasAttribute('data-msg-insert')&&draft&&!draft.pending&&!draft.upload&&!busy){const r=replies.find(r=>r.id===button.dataset.msgInsert),body=(draft.body?draft.body+'\n\n':'')+r.body;if(body.length>4000)throw Error('This reply would make your draft longer than 4,000 characters.');draft.body=body;saveDraft();find('[data-msg-body]').value=draft.body;find('[data-msg-reply-dialog]').close();find('[data-msg-body]').focus();}
    if(button.hasAttribute('data-msg-photo')){if(button.dataset.msgPhotoFailed){delete button.dataset.msgPhotoFailed;await loadPhotos();}else if(blobs.has(button.dataset.msgPhoto)){const dialog=find('[data-msg-photo-dialog]');dialog.querySelector('img').src=blobs.get(button.dataset.msgPhoto);dialog.showModal();}}
  }catch(error){if(!dead)notice(error.message,true);}});
  window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});document.addEventListener('visibilitychange',()=>{if(!document.hidden&&selected&&!busy)void refreshDetail();});
  const url=new URL(location.href);for(const name of ['q','state','unread'])if(url.searchParams.has(name))find('[data-msg-filters]').elements[name].value=url.searchParams.get(name);
  async function init(){syncFolders();await loadList();void loadStats();if(!config.enabled){notice('Messaging is not enabled yet. Your inbox will be available when it opens.');return;}
    const id=url.searchParams.get('conversation');if(/^conv_[a-f0-9]{32}$/.test(id||''))await openConversation(id);else{const kind=(config.merchant?['order']:['order','product','store']).find(k=>url.searchParams.has(k));if(kind)try{await start({kind,id:url.searchParams.get(kind)},config.merchant?undefined:{...(url.searchParams.has('page')?{pageId:url.searchParams.get('page')}:{}),...(url.searchParams.has('tracking_visit')?{trackingVisit:url.searchParams.get('tracking_visit')}:{})});}catch(error){if(!dead)notice(error.message,true);}}
    if(replyPending&&config.merchant)await showReplies();}
  void init();setInterval(()=>{if(!dead&&!document.hidden&&!busy){if(selected)void refreshDetail();if(listRows.length<=30&&!find('[data-msg-filters]').contains(document.activeElement))void loadList();}},20000);
})();
