(() => {
  'use strict';
  const script=document.currentScript,phase=script?.dataset.phase||'landing';
  let url;try{url=new URL(location.href==='about:srcdoc'?document.baseURI:location.href);if(phase==='checkout'){const back=new URL(url.searchParams.get('return')||'',url.origin);if(back.origin!==url.origin||!/^\/[a-z0-9-]+\/shop\/[a-z0-9-]+$/.test(back.pathname))return;url=back;}}catch{return;}
  const visit=url.searchParams.get('tracking_visit');if(!/^[a-f0-9]{64}$/.test(visit||''))return;
  const random=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),v=>v.toString(16).padStart(2,'0')).join('');
  const documentId=random(),endpoint=new URL('/cart/api/campaign-event.php',url.origin).href;
  let elapsed=0,last=performance.now(),depth=0,visible=document.visibilityState==='visible';
  const tick=()=>{const now=performance.now();if(visible)elapsed+=Math.min(now-last,15000);last=now;};
  const send=(kind,properties={})=>{tick();const body=JSON.stringify({visit,id:random(),kind,documentId,elapsedMs:Math.round(elapsed),properties:{...properties,phase}});fetch(endpoint,{method:'POST',headers:{'Content-Type':'text/plain'},body,credentials:'omit',keepalive:true}).catch(()=>{});};
  window.EzkartCampaignTracker={visit,send};
  if(phase==='landing')send('page_view',{viewportWidth:innerWidth,viewportHeight:innerHeight,loadMs:Math.round(performance.now())});
  else send('checkout_start');
  setInterval(()=>{tick();if(document.visibilityState==='visible')send('engagement');},15000);
  document.addEventListener('visibilitychange',()=>{tick();visible=document.visibilityState==='visible';if(!visible)send('engagement');});
  addEventListener('pagehide',()=>send('page_exit'));
  addEventListener('scroll',()=>{const height=document.documentElement.scrollHeight-innerHeight,percent=height>0?Math.floor(scrollY/height*4)*25:100;if(percent>depth){depth=percent;send('scroll_depth',{depth});}},{passive:true});
  document.addEventListener('ezkart:commerce',event=>{if(['add','add-set'].includes(event.detail?.action))send('add_to_cart',{productId:event.detail.productId,variantId:event.detail.variantId});});
  document.addEventListener('click',event=>{const node=event.target.closest?.('[data-product-card],[data-native-commerce],[data-sq-native],[data-ezkart-add],[data-commerce-add],[data-commerce-set]');if(node)send('product_interaction',{productId:node.dataset.ezkartAdd||node.dataset.productId});},true);
  document.addEventListener('change',event=>{if(event.target.closest?.('[data-native-commerce],[data-product-card],[data-sq-native]'))send('variant_selected');},true);
})();
