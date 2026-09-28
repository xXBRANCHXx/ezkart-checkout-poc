(() => {
 'use strict';const toast=document.querySelector('[data-onboarding-topbar]'),bell=document.querySelector('[data-notification-bell]');if(!toast||!bell)return;
 const config=JSON.parse(bell.dataset.notificationBell);if(!config.enabled||!config.store)return;let busy=false,ended=false;
 async function refresh(){if(busy||ended||document.hidden)return;busy=true;try{const r=await fetch('/cart/admin/?cloud='+encodeURIComponent('/v1/commerce/notifications/onboarding'),{cache:'no-store',headers:{'X-Ezkart-CSRF':config.csrf,'X-Ezkart-Notification-Account':config.account,'X-Ezkart-Notification-Store':config.store}});if([401,403,409].includes(r.status)){ended=true;toast.hidden=true;return;}const d=await r.json();if(r.ok&&d.ok){toast.hidden=!d.owner||d.complete;toast.querySelector('span').textContent='Finish seller setup';}}catch{/* Preserve the last confirmed state; never infer completion from a failed request. */}finally{busy=false;}}
 void refresh();setInterval(refresh,45000);window.addEventListener('ezkart:onboarding-changed',refresh);document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh();});
})();
