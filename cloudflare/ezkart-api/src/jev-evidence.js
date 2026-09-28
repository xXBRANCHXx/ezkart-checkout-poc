import {decodeHTML} from 'entities';
import {landingPageLinks} from './landing-page-hosting.js';
// Raw evidence lives in private R2. The bounded model projection records every omission.
export const JEV_EVIDENCE_LIMITS={sourceBytes:240000,images:32,imageBytes:2097152,totalImageBytes:12582912,resources:80,fetchBytes:2097152};
const utf8=new TextEncoder();
export const evidenceHash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',typeof value==='string'?utf8.encode(value):value))).map(x=>x.toString(16).padStart(2,'0')).join('');
const bytes=s=>utf8.encode(s).length;
const b64=a=>{let s='';for(let i=0;i<a.length;i+=32768)s+=String.fromCharCode(...a.subarray(i,i+32768));return btoa(s);};
export const imageDataUrl=(mime,a)=>`data:${mime};base64,${b64(a)}`;
const imageMime=a=>a[0]===137&&a[1]===80&&a[2]===78&&a[3]===71?'image/png':a[0]===255&&a[1]===216&&a[2]===255?'image/jpeg':String.fromCharCode(...a.subarray(0,4))==='RIFF'&&String.fromCharCode(...a.subarray(8,12))==='WEBP'?'image/webp':null;
const clip=(s,max)=>{if(bytes(s)<=max)return s;let n=Math.min(s.length,max);while(bytes(s.slice(0,n))>max)n=Math.floor(n*.95);return s.slice(0,n);};
// No arbitrary URL fetching, authenticated requests, redirects or external-page crawling.
// Ezkart static assets and these existing public image CDNs are the supported fetch surface.
export function evidenceFetchAllowed(u){
 if(u.protocol!=='https:'||u.username||u.password||(u.port&&u.port!=='443'))return false;
 if(['ezkart.id','test.ezkart.id'].includes(u.hostname))return /^\/(assets|cart\/(assets|vendor|admin\/templates))\//.test(u.pathname)&&!u.search;
 return ['images.unsplash.com','images.pexels.com','cdn.jsdelivr.net','cdnjs.cloudflare.com','fonts.googleapis.com','fonts.gstatic.com'].includes(u.hostname);
}
async function boundedFetch(url,transport){
 const u=new URL(url);if(!evidenceFetchAllowed(u))throw Error('External resource host/path is not supported for automatic collection.');
 const response=await transport(u.href,{redirect:'manual',credentials:'omit',headers:{accept:'image/png,image/jpeg,image/webp,text/css,application/javascript,text/plain;q=0.8'},signal:AbortSignal.timeout(5000)});
 if(response.status!==200||Number(response.headers.get('content-length')||0)>JEV_EVIDENCE_LIMITS.fetchBytes)throw Error('Resource is unavailable, redirected or too large.');
 const reader=response.body.getReader(),parts=[];let total=0;for(;;){const {value,done}=await reader.read();if(done)break;total+=value.length;if(total>JEV_EVIDENCE_LIMITS.fetchBytes){await reader.cancel();throw Error('Resource exceeds the evidence size limit.');}parts.push(value);}
 const data=new Uint8Array(total);let off=0;for(const p of parts){data.set(p,off);off+=p.length;}return {data,type:response.headers.get('content-type')||''};
}
export async function collectJevEvidence(env,p,seller,pageId,reviewId,transport=fetch){
 const started=Date.now(),html=String(p.value.publishedHtml||''),prefix=`sellers/${seller.id}/jev-evidence/${reviewId}/`,links=landingPageLinks({id:pageId},seller),base=(env.APP_ENVIRONMENT==='production'?'https://ezkart.id':'https://test.ezkart.id')+links.publicPath;
 const snapshot={evidenceVersion:2,name:String(p.value.name||'').slice(0,80),page:{storeSlug:seller.pageSlug||seller.slug,pageSlug:pageId,url:base,revision:p.revision},sources:[],images:[],resources:[],coverage:{textOnly:true,truncated:false,unreviewedMedia:false,missing:[],sourceBytes:0,originalHtmlBytes:bytes(html),imagesIncluded:0,imagesDiscovered:0,codeInspectedAsSource:true,runtimeExecuted:false},raw:{key:prefix+'published.html',sha256:await evidenceHash(html),bytes:bytes(html)}};
 await env.PRIVATE_ASSETS.put(snapshot.raw.key,html,{httpMetadata:{contentType:'text/plain'},customMetadata:{revision:p.revision,sha256:snapshot.raw.sha256}});
 const gap=(kind,reason)=>{if(snapshot.coverage.missing.length<100)snapshot.coverage.missing.push({kind,reason});};
 const addSource=(id,kind,label,text)=>{const remaining=JEV_EVIDENCE_LIMITS.sourceBytes-snapshot.coverage.sourceBytes,value=clip(String(text),Math.max(0,remaining));if(value.length!==String(text).length){snapshot.coverage.truncated=true;gap(kind,`${label} exceeds the model text allowance; the original is retained in evidence.`);}if(value){snapshot.sources.push({id,kind,label,text:value});snapshot.coverage.sourceBytes+=bytes(value);}};
 const references=[],seen=new Set(),visible=[],stack=[],voids=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);let hasExecutable=false;
 const discover=(raw,kind,where)=>{if(!raw)return;let value=decodeHTML(raw);if(/^https:\/\//.test(where)&&!value.startsWith('data:')){try{value=new URL(value,where).href;}catch{}}if(!value.startsWith('data:')&&value.length>2048){gap('resource','Resource URL exceeds 2,048 characters; full source is retained.');snapshot.coverage.truncated=true;value=value.slice(0,2048);kind='link';}const k=kind+'\n'+value;if(seen.has(k))return;seen.add(k);if(references.length>=JEV_EVIDENCE_LIMITS.resources){gap('resource','Resource discovery limit exceeded.');snapshot.coverage.truncated=true;return;}references.push({raw:value,kind,where});};
 const cssRefs=(css,where)=>{for(const m of css.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gis))discover(m[2],'asset',where);for(const m of css.matchAll(/@import\s+['"]([^'"]+)['"]/gi))discover(m[1],'code',where);};
 await new HTMLRewriter().on('*',{element(e){
  const tag=e.tagName,blocked=stack.some(x=>x.blocked)||['head','script','style','template','noscript'].includes(tag)||e.hasAttribute('hidden')||e.getAttribute('aria-hidden')==='true'||/(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(e.getAttribute('style')||'');
  if(['div','p','section','article','header','footer','li','h1','h2','h3','pre','br','tr'].includes(tag)&&!blocked)visible.push('\n');
  if(!voids.has(tag)){const item={blocked};stack.push(item);e.onEndTag(()=>{const at=stack.indexOf(item);if(at>=0)stack.splice(at);if(['p','pre','div','section','li','tr'].includes(tag)&&!blocked)visible.push('\n');});}
  if(tag==='style'||tag==='link'&&/stylesheet/i.test(e.getAttribute('rel')||''))gap('rendering','Stylesheet source is captured, but computed layout/visibility and generated content were not rendered.');
  if(tag==='script'&&(e.getAttribute('type')||'').toLowerCase()!=='application/ld+json')hasExecutable=true;
  for(const [name,value] of e.attributes){if(/^on/i.test(name))hasExecutable=true;if(name==='style')cssRefs(value,'inline style');}
  if(['img','source','video','audio','iframe','embed','object','input'].includes(tag)){
   const source=e.getAttribute('src')||e.getAttribute('data');if(source)discover(source,['img','input'].includes(tag)?'image':tag==='source'?'asset':'media',tag);
   if(e.getAttribute('poster'))discover(e.getAttribute('poster'),'image','video poster');
   const srcset=e.getAttribute('srcset');if(srcset){if(srcset.startsWith('data:'))gap('image','Inline data srcset could not be separated reliably.');else for(const part of srcset.split(','))discover(part.trim().split(/\s+/)[0],'image','srcset');}
   if(['video','audio','iframe','embed','object'].includes(tag)){snapshot.coverage.unreviewedMedia=true;gap('media',`${tag} bytes/interactive content are not inspected by this static image-and-source review.`);}
  }
  if(tag==='canvas'||tag==='svg'){snapshot.coverage.unreviewedMedia=true;gap('rendering',`${tag} source is retained but its rendered pixels were not captured.`);}
  if(tag==='script'&&e.getAttribute('src'))discover(e.getAttribute('src'),'code','script');
  if(tag==='link'&&e.getAttribute('href'))discover(e.getAttribute('href'),/stylesheet/i.test(e.getAttribute('rel')||'')?'code':'asset','link');
  if(tag==='a'&&e.getAttribute('href'))discover(e.getAttribute('href'),'link','anchor');
  if(tag==='form'&&e.getAttribute('action'))discover(e.getAttribute('action'),'link','form action');
 },text(t){if(!stack.some(x=>x.blocked))visible.push(t.text);}}).transform(new Response(html)).text();
 for(const style of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi))cssRefs(style[1],'style block');
 if(hasExecutable)gap('runtime','JavaScript and event-handler source is supplied, but runtime behaviour was not executed.');
 addSource('page:1','visible_text','Page text (spacing and line breaks preserved)',decodeHTML(visible.join('')));
 const domains=await env.DB.prepare("SELECT hostname,public_path FROM custom_domains WHERE seller_id=? AND page_id=? AND state='active' LIMIT 20").bind(seller.id,pageId).all();snapshot.page.customUrls=(domains.results||[]).map(d=>'https://'+d.hostname+d.public_path);
 addSource('page:url','page_address','Published URL and slugs',JSON.stringify(snapshot.page,null,2));
 // Preserve every character of published source except image bodies, which have their own immutable copies.
 const codeHtml=html.replace(/data:image\/(?:png|jpeg|webp|avif|gif|svg\+xml);base64,[A-Za-z0-9+/=]+/gi,(value)=>{discover(value,'image','inline data');return `[image data retained separately: ${value.slice(0,value.indexOf(','))}]`;});
 addSource('page:html','published_code','Published HTML, CSS, JavaScript, comments and attributes',codeHtml);
 let imageBytes=0;
 for(let i=0;i<references.length;i++){
  const ref=references[i],entry={id:'resource:'+String(i+1),kind:ref.kind,where:ref.where,url:ref.raw.startsWith('data:')?'inline data':ref.raw,status:'unreviewed'};snapshot.resources.push(entry);
  if(ref.kind==='link'){try{const u=new URL(ref.raw,base);entry.url=u.href;entry.status='url_recorded';}catch{entry.status='invalid_url';}continue;}
  if(ref.kind==='media'){entry.reason='Audio, video and embedded documents require human review.';continue;}
  try{
   if(Date.now()-started>12000)throw Error('Collection time allowance reached; this resource remains unreviewed.');
   let loaded;
   if(ref.raw.startsWith('data:')){
    const match=/^data:(image\/(?:png|jpeg|webp|svg\+xml|gif|avif));base64,([A-Za-z0-9+/=]+)$/i.exec(ref.raw);if(!match)throw Error('Inline image encoding is unsupported; source retained.');
    if(match[2].length>Math.ceil(JEV_EVIDENCE_LIMITS.imageBytes*4/3)+4)throw Error('Inline image exceeds image size limit.');
    loaded={data:Uint8Array.from(atob(match[2]),ch=>ch.charCodeAt(0)),type:match[1]};
   }else{
    const u=new URL(ref.raw,base);entry.url=u.href;
    const media=/^\/v1\/(?:public\/)?media\/([a-zA-Z0-9_-]+)$/.exec(u.pathname);
    if(media&&['ezkart.id','test.ezkart.id',new URL(env.JEV_PUBLIC_API_ORIGIN||base).hostname,'ezkart-api-beta.vincentbranch23.workers.dev','ezkart-api-test.vincentbranch23.workers.dev',...String(env.ALLOWED_ORIGINS||'').split(',').filter(Boolean).map(x=>{try{return new URL(x).hostname;}catch{return '';}})].includes(u.hostname)){
     const m=await env.DB.prepare('SELECT r2_key,mime_type FROM media_uploads WHERE id=? AND seller_id=?').bind(media[1],seller.id).first();if(!m)throw Error('Image is not an owned store upload.');
     const object=await env.PUBLIC_ASSETS.get(m.r2_key);if(!object||object.size>JEV_EVIDENCE_LIMITS.imageBytes)throw Error('Store image is missing or too large.');loaded={data:new Uint8Array(await object.arrayBuffer()),type:m.mime_type};
    }else loaded=await boundedFetch(u.href,transport);
   }
   const mime=imageMime(loaded.data);
   if(mime){
    if((mime==='image/webp'&&new TextDecoder().decode(loaded.data.subarray(0,100)).includes('ANIM'))||(mime==='image/png'&&new TextDecoder().decode(loaded.data.subarray(0,500)).includes('acTL'))){snapshot.coverage.unreviewedMedia=true;gap('animation','Only a static image is supplied; animation frames require human review.');}
    snapshot.coverage.imagesDiscovered++;
    if(snapshot.images.length>=JEV_EVIDENCE_LIMITS.images||imageBytes+loaded.data.length>JEV_EVIDENCE_LIMITS.totalImageBytes)throw Error('Image count/total bytes exceed the model image allowance.');
    const digest=await evidenceHash(loaded.data),prior=snapshot.images.find(im=>im.sha256===digest);if(prior){entry.status='included';entry.imageId=prior.id;continue;}
    const id='image:'+String(snapshot.images.length+1),key=prefix+id.replace(':','-');await env.PRIVATE_ASSETS.put(key,loaded.data,{httpMetadata:{contentType:mime},customMetadata:{sha256:digest,revision:p.revision}});
    snapshot.images.push({id,key,mimeType:mime,bytes:loaded.data.length,sha256:digest,url:entry.url});imageBytes+=loaded.data.length;entry.status='included';entry.imageId=id;
   }else if(ref.kind==='code'||/text\/css|javascript|image\/svg\+xml/.test(loaded.type)){
    const code=new TextDecoder().decode(loaded.data),key=prefix+entry.id.replace(':','-');await env.PRIVATE_ASSETS.put(key,loaded.data,{httpMetadata:{contentType:'text/plain'}});entry.sha256=await evidenceHash(loaded.data);entry.bytes=loaded.data.length;entry.status='source_included';entry.key=key;
    addSource(entry.id,'external_code',`Resource source: ${entry.url}`,code);if(/css/.test(loaded.type)||/\.css(?:\?|$)/.test(entry.url))cssRefs(code,entry.url);
    if(/svg/.test(loaded.type)){snapshot.coverage.unreviewedMedia=true;gap('rendering','SVG source was captured; rendered pixels were not.');}
   }else throw Error('Resource format is not supported as image or source code.');
  }catch(e){entry.reason=String(e.message||'Resource could not be captured.').slice(0,240);gap(ref.kind,`${entry.url.slice(0,180)}: ${entry.reason}`);if(['image','asset'].includes(ref.kind))snapshot.coverage.unreviewedMedia=true;}
 }
 addSource('page:resources','resource_manifest','All discovered URLs and resource collection results',JSON.stringify(snapshot.resources.map(({key,...r})=>r),null,2));
 snapshot.coverage.imagesIncluded=snapshot.images.length;snapshot.coverage.textOnly=snapshot.images.length===0;
 return snapshot;
}
export async function loadJevImage(env,snapshot,imageId){
 const image=snapshot.images?.find(x=>x.id===imageId);if(!image)throw Error('jev_image_missing');const object=await env.PRIVATE_ASSETS.get(image.key);if(!object||object.size!==image.bytes)throw Error('jev_image_changed');const data=new Uint8Array(await object.arrayBuffer());if(await evidenceHash(data)!==image.sha256)throw Error('jev_image_changed');return {...image,dataUrl:imageDataUrl(image.mimeType,data)};
}
export async function hydrateJevEvidence(env,snapshot){return {...snapshot,images:await Promise.all((snapshot.images||[]).map(x=>loadJevImage(env,snapshot,x.id)))};}
