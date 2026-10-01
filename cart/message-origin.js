// Carry references only. The Messages API resolves ownership and saved names.
export function mountMessageOrigin(root=document,{pageId,contactOrigin}={}){
 let source;try{source=new URL(location.href==='about:srcdoc'?root.baseURI:location.href);}catch{return;}
 const page=typeof pageId==='string'&&/^[a-z0-9-]{1,96}$/.test(pageId)?pageId:source.pathname.match(/\/[a-z0-9-]+\/shop\/([a-z0-9-]+)$/)?.[1]||source.pathname.match(/\/v1\/public\/landing-pages\/[a-z0-9-]+\/([a-z0-9-]+)$/)?.[1];
 if(!page)return;
 const visit=source.searchParams.get('tracking_visit');
 const decorate=value=>{try{const url=new URL(value,source);if((url.origin!==source.origin&&url.origin!==contactOrigin)||url.pathname!=='/cart/messages.php')return value;url.searchParams.set('page',page);if(/^[a-f0-9]{64}$/.test(visit||''))url.searchParams.set('tracking_visit',visit);return url.href;}catch{return value;}};
 const update=()=>{for(const node of root.querySelectorAll('[data-ezkart-contact-url]'))node.dataset.ezkartContactUrl=decorate(node.dataset.ezkartContactUrl);for(const node of root.querySelectorAll('a[href]'))node.href=decorate(node.getAttribute('href'));};
 update();root.addEventListener('click',update,true);
}
if(typeof document!=='undefined')mountMessageOrigin(document);
