(() => {
  'use strict';
  const root = document.querySelector('[data-notification-workspace]');
  if (!root) return;
  const config = JSON.parse(root.dataset.config), q = selector => root.querySelector(selector);
  const labels = {payment_confirmed:'Payment confirmed',payment_pending:'Payment pending',payment_failed:'Payment unsuccessful',payment_review:'Payment review',shipping:'Shipping',returns:'Returns',messages:'Messages',weekly_activity:'Weekly activity'};
  const sourceLabels = {'notification.order_state':'Payment update','notification.payment_pending':'Pending payment reminder','notification.payment_review':'Payment review','notification.stock_recovered':'Stock review resolved','notification.shipment_updated':'Shipping update','notification.return_updated':'Return update','notification.message_received':'New message','notification.weekly_activity':'Weekly activity'};
  const form = q('[data-notice-filters]'), processForm = q('[data-notice-process-filters]');
  let stopped = false, enabled = false, view = 'inbox', items = [], cursor = null, processing = [], processCursor = null;
  let listVersion = 0, processVersion = 0, statsVersion = 0, listBusy = false, processBusy = false, readBusy = false, pendingRead = null, latestStats = null;
  let applied = {q:'',category:'',state:'all'}, processState = 'attention';
  const confirmedReads = new Map();
  const text = (selector, value) => {const element=q(selector); if(element){element.textContent=value; element.hidden=!value;}};
  function node(tag, value = '', className = '') {const element=document.createElement(tag); element.textContent=value; if(className)element.className=className; return element;}
  const date = value => config.merchant && window.EzkartAdminFormat ? window.EzkartAdminFormat.date(value) : new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
  const count = value => Number(value || 0).toLocaleString();
  function emitStats(data) {window.dispatchEvent(new CustomEvent('ezkart:notification-stats',{detail:data}));}
  function loseAccess(message) {
    stopped=true; ++listVersion; ++processVersion; ++statsVersion; items=[]; processing=[]; pendingRead=null;
    q('[data-notice-private]').replaceChildren(); text('[data-notice-count]','Sign in again'); text('[data-notice-total]',''); text('[data-notice-live]',''); text('[data-notice-held]','');
    text('[data-notice-error]',message); q('[data-notice-signin]').hidden=false; q('[data-notice-refresh]').disabled=true; emitStats({unread:0,enabled:false});
  }
  async function api(path = '', body) {
    if(stopped)throw new Error('Reload your sign-in to continue.');
    const headers={'Accept':'application/json','X-Ezkart-CSRF':config.csrf};
    if(config.merchant){headers['X-Ezkart-Notification-Account']=config.account; headers['X-Ezkart-Notification-Store']=config.store;}
    else headers['X-Ezkart-Customer-Session']=config.version;
    if(body!==undefined)headers['Content-Type']='application/json';
    const target=config.merchant?'/cart/admin/?cloud='+encodeURIComponent('/v1/commerce/notifications'+path):'/cart/admin/customer-notifications.php?path='+encodeURIComponent(path);
    const response=await fetch(target,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body),cache:'no-store',credentials:'same-origin'});
    let data; try{data=await response.json();}catch{data={error:'Notification confirmation is unavailable. Try again.'};}
    if(!response.ok||!data.ok){const error=Object.assign(new Error(data.error||'Notifications could not be loaded. Try again.'),{status:response.status});
      if([401,403].includes(response.status)||['notification_session_changed','customer_session_changed'].includes(data.code))loseAccess(error.message);
      throw error;
    }
    return data;
  }
  function deliveryState(value) {
    enabled=config.enabled&&value;
    text('[data-notice-held]',enabled?'':'New notification delivery is not enabled yet. Saved updates remain available; marking them read will be available when delivery is enabled.');
    controls();
  }
  function controls() {
    if(stopped)return;
    q('[data-notice-mark]').disabled=!enabled||listBusy||readBusy||Boolean(pendingRead)||!items.some(item=>!item.readAt);
    q('[data-notice-mark]').textContent=items.filter(item=>!item.readAt).length>50?'Mark first 50 shown as read':'Mark shown as read';
    q('[data-notice-read-retry]').hidden=!pendingRead||readBusy;
    q('[data-notice-more]').disabled=listBusy;
    q('[data-notice-process-more]')?.toggleAttribute('disabled',processBusy);
    for(const button of root.querySelectorAll('[data-notice-read]'))button.disabled=!enabled||readBusy||Boolean(pendingRead);
    q('[data-notice-inbox]').setAttribute('aria-busy',String(listBusy));
    q('[data-notice-processing]')?.setAttribute('aria-busy',String(processBusy));
  }
  function empty(list, title, body) {const li=node('li','','notice-empty'); li.append(node('strong',title),node('p',body)); list.append(li);}
  function render() {
    const list=q('[data-notice-list]'); list.replaceChildren();
    for(const item of items){const li=node('li','','notice-card'); li.dataset.notificationId=item.id; li.dataset.unread=String(!item.readAt);
      const heading=node('div','','notice-card-header'); heading.append(node('span',labels[item.category]||'Update','notice-category')); if(!item.readAt)heading.append(node('span','Unread','notice-unread'));
      li.append(heading,node('h2',item.title),node('p',item.body,'notice-body'));
      const meta=node('p',(config.merchant?'':item.storeName+' · ')+date(item.createdAt),'notice-meta');li.append(meta);
      if(item.category==='weekly_activity'&&item.data?.products?.length){const detail=node('div','','notice-details');detail.append(node('p','Products without a paid order during this period'));
        const products=node('ul'); for(const product of item.data.products)products.append(node('li',product.name)); detail.append(products);
        if(item.data.withoutOrders>item.data.products.length)detail.append(node('p','Plus '+count(item.data.withoutOrders-item.data.products.length)+' more.'));li.append(detail);
      }
      const actions=node('div','','notice-card-footer'), link=node('a',item.category==='messages'?'Open conversation':item.category==='weekly_activity'?'View products':item.category==='returns'&&config.merchant?'View return':'View order');
      // Destinations are private, same-origin routes constructed by the API.
      if(typeof item.href==='string'&&/^\/cart\/(?:admin\/\?|messages\.php\?|return\.php\?|$)/.test(item.href)){link.href=item.href;actions.append(link);}
      if(!item.readAt){const button=node('button','Mark as read');button.type='button';button.dataset.noticeRead=String(item.id);button.addEventListener('click',()=>void markRead([item.id]));actions.append(button);}
      else actions.append(node('span','Read','notice-meta'));
      li.append(actions); if(item.emailStatus==='not_connected')li.append(node('p','Email requested · service not connected','notice-meta'));list.append(li);
    }
    if(!items.length)empty(list,'You’re all caught up',applied.q||applied.category||applied.state!=='all'?'No updates match these filters.':'New updates will appear here when they are delivered.');
    text('[data-notice-result]',count(items.length)+(items.length===1?' notification shown':' notifications shown'));q('[data-notice-more]').hidden=!cursor;controls();
  }
  async function load(more = false) {
    const version=++listVersion, filters=more?applied:{q:form.elements.q.value.trim(),category:form.elements.category.value,state:form.elements.state.value};
    listBusy=true;controls();text('[data-notice-error]','');
    const query=new URLSearchParams(filters);if(more&&cursor)query.set('cursor',cursor);
    try{const data=await api('?'+query);if(stopped||version!==listVersion)return;
      const received=data.items.map(item=>confirmedReads.has(item.id)?{...item,readAt:item.readAt||confirmedReads.get(item.id)}:item).filter(item=>filters.state!=='unread'||!item.readAt);
      applied=filters;items=more?[...items,...received.filter(item=>!items.some(old=>old.id===item.id))]:received;cursor=data.nextCursor;
      deliveryState(data.enabled);render();if(!more)text('[data-notice-live]','');
    }catch(error){if(!stopped&&version===listVersion)text('[data-notice-error]',error.message+(items.length?' Previously loaded updates are still shown.':''));}
    finally{if(version===listVersion){listBusy=false;controls();}}
  }
  async function stats(quiet = false) {
    const version=++statsVersion;
    try{const data=await api('/stats');if(stopped||version!==statsVersion)return;
      if(quiet&&latestStats&&data.total>latestStats.total)text('[data-notice-live]','New updates are available. Refresh to see them.');
      latestStats=data;deliveryState(data.enabled);text('[data-notice-count]',count(data.unread)+' unread');text('[data-notice-total]',count(data.total)+' total updates');emitStats(data);
    }catch(error){if(!stopped&&version===statsVersion){text('[data-notice-count]',quiet?'Unread count unavailable':'Could not load unread count');if(!quiet)text('[data-notice-error]',error.message);}}
  }
  async function markRead(ids) {
    if(!enabled||readBusy||stopped)return;
    pendingRead=pendingRead||ids;const original=[...pendingRead];readBusy=true;controls();text('[data-notice-read-error]','');
    try{await api('/read',{ids:original});if(stopped)return;pendingRead=null;
      const at=new Date().toISOString();for(const id of original)confirmedReads.set(id,at);items=items.map(item=>original.includes(item.id)?{...item,readAt:item.readAt||at}:item);
      if(applied.state==='unread')items=items.filter(item=>!item.readAt);
      render();text('[data-notice-live]',count(original.length)+(original.length===1?' notification marked as read.':' notifications marked as read.'));await stats();
    }catch(error){if(!stopped){if(error.status&&error.status<500){pendingRead=null;text('[data-notice-read-error]',error.message+' Refresh before trying again.');}
      else text('[data-notice-read-error]',error.message+' Retry to confirm the same read update.');}}
    finally{readBusy=false;controls();}
  }
  function renderProcessing() {
    const list=q('[data-notice-process-list]');list.replaceChildren();
    const states={queued:'Queued',running:'Processing',retry:'Retry scheduled',uncertain:'Checking saved result',dead:'Needs operator review',succeeded:'Processed'};
    const suppressed={not_actionable:'No alert was needed for this update.',obsolete:'The order changed before this reminder was delivered.',store_closed:'Delivery was skipped because the store is closed.'};
    for(const item of processing){const li=node('li','','notice-card');li.dataset.notificationJob=item.id;
      const heading=node('div','','notice-card-header');heading.append(node('span',sourceLabels[item.kind]||'Store update','notice-category'),node('span',states[item.state]||item.state,'notice-meta'));li.append(heading);
      li.append(node('h2',item.orderId||sourceLabels[item.kind]||'Store update'),node('p',date(item.createdAt)+' · '+count(item.attempts)+(item.attempts===1?' processing attempt':' processing attempts'),'notice-meta'));
      if(item.suppression)li.append(node('p',suppressed[item.suppression]||'Delivery skipped.','notice-body'));
      else if(item.state==='succeeded'||item.deliveredInApp>0||item.emailWaiting>0)li.append(node('p',count(item.deliveredInApp)+(item.deliveredInApp===1?' in-app inbox reached':' in-app inboxes reached')+(item.emailWaiting?' · '+count(item.emailWaiting)+(item.emailWaiting===1?' email request awaiting a connected service':' email requests awaiting a connected service'):'.'),'notice-body'));
      if(item.message)li.append(node('p',item.message,'notice-body'));
      if(['retry','uncertain'].includes(item.state))li.append(node('p','Next check: '+date(item.nextAttemptAt),'notice-meta'));
      if(item.orderId){const link=node('a','View order');link.href='/cart/admin/?page=orders&order='+encodeURIComponent(item.orderId);li.append(link);}list.append(li);
    }
    if(!processing.length)empty(list,'No delivery activity to show','Try another delivery state to see processed or queued updates.');
    text('[data-notice-process-result]',count(processing.length)+(processing.length===1?' delivery update shown':' delivery updates shown'));q('[data-notice-process-more]').hidden=!processCursor;controls();
  }
  async function loadProcessing(more = false) {
    if(!config.merchant)return;const version=++processVersion,state=more?processState:processForm.elements.state.value;
    processBusy=true;controls();text('[data-notice-error]','');const query=new URLSearchParams({state});if(more&&processCursor)query.set('cursor',processCursor);
    try{const data=await api('/processing?'+query);if(stopped||version!==processVersion)return;
      processState=state;processing=more?[...processing,...data.items.filter(item=>!processing.some(old=>old.id===item.id))]:data.items;processCursor=data.nextCursor;deliveryState(data.enabled);renderProcessing();
    }catch(error){if(!stopped&&version===processVersion)text('[data-notice-error]',error.message+(processing.length?' Previously loaded delivery activity is still shown.':''));}
    finally{if(version===processVersion){processBusy=false;controls();}}
  }
  function updateURL() {
    const url=new URL(location.href);for(const key of ['q','category','state']){const value=form.elements[key].value;if(value&&value!=='all')url.searchParams.set(key,value);else url.searchParams.delete(key);}
    if(view==='processing'){url.searchParams.set('view','processing');url.searchParams.set('delivery',processForm.elements.state.value);}else{url.searchParams.delete('view');url.searchParams.delete('delivery');}
    if(url.href!==location.href)history.pushState(null,'',url);
  }
  function showView(next, fetchData = true) {
    view=config.merchant&&next==='processing'?'processing':'inbox';q('[data-notice-inbox]').hidden=view!=='inbox';if(config.merchant)q('[data-notice-processing]').hidden=view!=='processing';
    for(const button of root.querySelectorAll('[data-notice-view]'))button.setAttribute('aria-pressed',String(button.dataset.noticeView===view));
    if(fetchData)void(view==='processing'?loadProcessing():load());
  }
  function restoreURL() {
    const params=new URL(location.href).searchParams;
    form.elements.q.value=(params.get('q')||'').slice(0,120);form.elements.category.value=Object.hasOwn(labels,params.get('category'))?params.get('category'):'';
    form.elements.state.value=['all','unread','read'].includes(params.get('state'))?params.get('state'):'all';
    if(processForm)processForm.elements.state.value=['attention','queued','succeeded','all'].includes(params.get('delivery'))?params.get('delivery'):'attention';
    showView(params.get('view'));for(const select of root.querySelectorAll('select'))select.dispatchEvent(new Event('change',{bubbles:true}));
  }
  form.addEventListener('submit',event=>{event.preventDefault();updateURL();void load();});
  processForm?.addEventListener('submit',event=>{event.preventDefault();updateURL();void loadProcessing();});
  for(const button of root.querySelectorAll('[data-notice-view]'))button.addEventListener('click',()=>{showView(button.dataset.noticeView);updateURL();});
  q('[data-notice-more]').addEventListener('click',()=>void load(true));q('[data-notice-process-more]')?.addEventListener('click',()=>void loadProcessing(true));
  q('[data-notice-mark]').addEventListener('click',()=>void markRead(items.filter(item=>!item.readAt).slice(0,50).map(item=>item.id)));
  q('[data-notice-read-retry]').addEventListener('click',()=>void markRead(pendingRead));
  q('[data-notice-refresh]').addEventListener('click',()=>{void stats();void(view==='processing'?loadProcessing():load());});
  window.addEventListener('popstate',()=>{if(!stopped)restoreURL();});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!stopped)void stats(true);});
  setInterval(()=>{if(!document.hidden&&!stopped)void stats(true);},30000);
  if(!config.account||(config.merchant&&!config.store)){loseAccess('Open your store with Google sign-in to read its notifications.');return;}
  if(!config.merchant&&!config.enabled){deliveryState(false);text('[data-notice-count]','Notifications are not available yet');text('[data-notice-result]','');q('[data-notice-private]').hidden=true;q('[data-notice-refresh]').disabled=true;stopped=true;return;}
  restoreURL();void stats();
})();
