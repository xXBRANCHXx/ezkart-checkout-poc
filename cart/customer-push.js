(() => {
 'use strict';
 const root=document.querySelector('[data-message-workspace]');if(!root)return;
 const config=JSON.parse(root.dataset.config),button=root.querySelector('[data-msg-push]'),status=root.querySelector('[data-msg-push-status]');if(config.merchant||!button)return;
 let subscription=null,registration=null,publicKey=null,subscribed=false,busy=false;
 const api=async body=>{const response=await fetch('/cart/admin/customer-messages.php?path=%2Fpush',{method:body?'POST':'GET',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Ezkart-CSRF':config.csrf,'X-Ezkart-Customer-Session':config.version},...(body?{body:JSON.stringify(body)}:{})});const data=await response.json();if(!response.ok||!data.ok)throw Error(data.error||'Notifications could not be confirmed. Try again.');return data;};
 const paint=text=>{status.textContent=text;button.querySelector('[data-msg-push-label]').textContent=subscribed?'Disable notifications':'Enable notifications';button.disabled=busy||!publicKey||Notification.permission==='denied';};
 const matchingKey=sub=>{const actual=new Uint8Array(sub.options?.applicationServerKey||[]),expected=decode(publicKey);return actual.length===expected.length&&actual.every((v,i)=>v===expected[i]);};
 const decode=value=>Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
 async function init(){
  if(!config.enabled){button.disabled=true;status.textContent='Browser notifications will be available when messaging opens.';return;}
  if(!isSecureContext||!('serviceWorker' in navigator)||typeof PushManager!=='function'||typeof Notification!=='function'){button.disabled=true;status.textContent='Browser notifications are unavailable here. On iPhone or iPad, open Messages from a Home Screen web app.';return;}
  if(Notification.permission==='denied'){button.disabled=true;status.textContent='Notifications are blocked. Allow them in your browser’s site settings.';return;}
  try{const data=await api();if(!data.available){button.disabled=true;status.textContent='Browser notifications are not configured yet.';return;}publicKey=data.publicKey;
   registration=await navigator.serviceWorker.getRegistration('/cart/');subscription=await registration?.pushManager.getSubscription();
   if(subscription&&matchingKey(subscription))subscribed=(await api({action:'status',endpoint:subscription.endpoint})).subscribed;
   paint(subscribed?'Notifications are enabled for this browser.':'Get browser notifications when a store replies.');
  }catch(error){status.textContent=error.message;button.disabled=true;}
 }
 button.addEventListener('click',async()=>{
  if(busy||!publicKey)return;busy=true;paint('Confirming browser notifications…');
  try{
   if(subscribed){await api({action:'revoke',endpoint:subscription.endpoint});await subscription.unsubscribe();subscription=null;subscribed=false;paint('Notifications are disabled for this browser.');}
   else{
    // Permission is requested only in response to this explicit click.
    const permission=Notification.permission==='granted'?'granted':await Notification.requestPermission();
    if(permission!=='granted'){paint(permission==='denied'?'Notifications are blocked. Allow them in your browser’s site settings.':'Notifications were not enabled. You can try again.');return;}
    registration=await navigator.serviceWorker.register('/cart/customer-push-sw.js',{scope:'/cart/'});await navigator.serviceWorker.ready;
    subscription=await registration.pushManager.getSubscription();
    if(subscription&&!matchingKey(subscription)){await subscription.unsubscribe();subscription=null;}
    subscription ||= await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:decode(publicKey)});
    await api({action:'subscribe',subscription:subscription.toJSON()});subscribed=true;paint('Notifications are enabled for this browser.');
   }
  }catch(error){paint(error.message);}finally{busy=false;paint(status.textContent);}
 });
 void init();
})();
