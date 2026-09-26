(() => {
  'use strict';
  const bell=document.querySelector('[data-notification-bell]');if(!bell)return;
  const badge=bell.querySelector('[data-notification-badge]'),config=JSON.parse(bell.dataset.notificationBell);
  let busy=false,stopped=false,version=0;
  function show(data){const total=Number(data?.unread)||0;badge.textContent=total>99?'99+':String(total);badge.hidden=total===0;bell.setAttribute('aria-label',total?'Notifications, '+total+' unread':'Notifications');}
  window.addEventListener('ezkart:notification-stats',event=>{++version;show(event.detail);});
  async function poll(){if(busy||stopped||document.hidden)return;const current=++version;busy=true;
    try{const response=await fetch('/cart/admin/?cloud='+encodeURIComponent('/v1/commerce/notifications/stats'),{cache:'no-store',credentials:'same-origin',headers:{Accept:'application/json','X-Ezkart-CSRF':config.csrf,'X-Ezkart-Notification-Account':config.account,'X-Ezkart-Notification-Store':config.store}});
      if([401,403,409].includes(response.status)){stopped=true;show(null);return;}const data=await response.json();if(response.ok&&data.ok&&current===version)show(data);
    }catch{/* Keep the previous count until it can be refreshed. */}finally{busy=false;}
  }
  if(!config.account||!config.store||!config.enabled||document.querySelector('[data-notification-workspace]'))return;
  void poll();setInterval(()=>void poll(),45000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)void poll();});
})();
