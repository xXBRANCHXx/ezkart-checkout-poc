'use strict';
// No fetch handler: this worker never caches private pages, tokens or messages.
self.addEventListener('push',event=>{
 let data;try{data=event.data?.json();}catch{return;}
 let url;try{url=new URL(data?.url,self.location.origin);}catch{return;}
 if(url.origin!==self.location.origin||url.pathname!=='/cart/messages.php'||!/^conv_[a-f0-9]{32}$/.test(url.searchParams.get('conversation')||'')||[...url.searchParams.keys()].some(k=>k!=='conversation'))return;
 event.waitUntil(self.registration.showNotification('New message from your store',{body:'Open Messages to read your reply.',tag:/^notice_[a-f0-9]{32}$/.test(data.tag||'')?data.tag:undefined,data:{url:url.href}}));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();let url;try{url=new URL(event.notification.data?.url,self.location.origin);}catch{return;}
 if(url.origin!==self.location.origin||url.pathname!=='/cart/messages.php'||!/^conv_[a-f0-9]{32}$/.test(url.searchParams.get('conversation')||'')||[...url.searchParams.keys()].some(k=>k!=='conversation'))return;
 event.waitUntil((async()=>{for(const client of await self.clients.matchAll({type:'window',includeUncontrolled:true})){const current=new URL(client.url);if(current.origin===url.origin&&current.pathname==='/cart/messages.php'){await client.navigate(url.href);return client.focus();}}return self.clients.openWindow(url.href);})());
});
