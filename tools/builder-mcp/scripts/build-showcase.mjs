// Rebuild native, editable sections from the user-owned Ezkart marketing reference.
import {chromium} from 'playwright';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {repoRoot} from '../workspace.mjs';
const browser=await chromium.launch();const page=await browser.newPage();
const sourceDirectory=process.argv[2];
const readSource=async name=>sourceDirectory?readFile(join(sourceDirectory,name),'utf8'):fetch(new URL(name,'https://ezkart.id/')).then(response=>{if(!response.ok)throw Error(`Reference ${name}: ${response.status}`);return response.text();});
const [html,css,captions]=await Promise.all([readSource('index.html'),readSource('styles.css'),readSource(sourceDirectory?'overview-id.vtt':'assets/marketing/overview-id.vtt')]);
await page.setContent(html.replace(/<script\b[\s\S]*?<\/script>/g,'').replace(/<link\b[^>]*>/g,''));
const result=await page.evaluate(({css,captions})=>{
 const sheet=new CSSStyleSheet();sheet.replaceSync(css.replace(/background:\s*var\(--gradient\)/g,'background-image:var(--gradient)'));
 const prefix='.sq-page-preview';
 const rename=selector=>selector.replace(/\.([a-zA-Z_][\w-]*)/g,(_,name)=>'.ezm-'+name);
 const scope=selector=>{
  selector=rename(selector.trim()).replace(/>\s*span\b/g,'> span:not(.sq-inline-text)');
  if(selector.includes('html[lang="en"]'))return null;
  selector=selector.replace(/html\[lang="id"\]\s*/g,'');
  if(selector===':root'||selector==='body')return prefix+' .sq-reference';
  if(/^html(?:\b|\.)/.test(selector))return null;
  if(selector.startsWith('body '))selector=selector.slice(5);
  return prefix+(selector.includes('.ezm-')||selector.includes('.sq-reference')?' ':' :where(.sq-reference) ')+selector;
 };
 const rules=items=>[...items].map(rule=>{
  if(rule.type===CSSRule.FONT_FACE_RULE)return '';
  if(rule.type===CSSRule.KEYFRAMES_RULE)return '';
  if(rule.cssRules&&!rule.selectorText){const width=/\b(?:min|max)-width:/.test(rule.conditionText||'');return `${width?'@container ezkart-page':'@media'} ${rule.conditionText}{${rules(rule.cssRules)}}`;}
  if(!rule.selectorText)return '';
  const selectors=rule.selectorText.split(',').map(scope).filter(Boolean);if(!selectors.length)return '';
  let body=rule.style.cssText.replace(/([\d.])vw\b/g,'$1cqw').replace(/url\(["']?(assets\/[^)"']+)["']?\)/g,(_,url)=>`url("https://ezkart.id/${url}")`);
  return selectors.join(',')+'{'+body+'}';
 }).join('\n');
 const definitions=[
  ['brand-navigation','Brand navigation','Navigation','Brand, primary links, language links, and an action.','header.site-header','navigation','.nav-wrap > .brand,.nav-wrap > .desktop-nav,.nav-wrap > .language-switch,.nav-wrap > .nav-cta,.mobile-nav'],
  ['centered-showcase','Centered showcase','Hero','A centered headline with a large product or app demonstration.','.hero','top','.hero-copy > *, .hero-stage, .platform-strip'],
  ['feature-showcase','Feature showcase','Story','A focused introduction beside a detailed product demonstration.','#builders','builders',':scope > *'],
  ['device-showcase','Device showcase','Media','A wide preview with desktop and mobile controls.','#landing-pages','landing-pages','.section-heading > *, .page-showcase, .page-benefits'],
  ['film-showcase','Product film','Media','A large video, supporting copy, and a clear playback control.','#in-motion','in-motion','.section-heading > *, .film-shell, .film-caption'],
  ['journey-timeline','Journey timeline','Story','Introductory copy beside a sequence of connected steps.','#how-it-works','how-it-works',':scope > .journey-intro, .journey-step'],
  ['support-questions','Support questions','Details','A clear introduction and an expandable list of answers.','#questions','questions','.faq-layout > *'],
  ['contact-invitation','Contact invitation','Footer','A centered invitation with contact actions.','#get-started','get-started','.closing-content > *'],
  ['brand-footer','Brand footer','Footer','Brand information, practical links, and contact details.','footer.site-footer','footer','.footer-brand, .footer-links, .footer-bottom']
 ];
 const templates={};
 for(const [id,name,category,description,selector,originalId,units] of definitions){
  const source=document.querySelector(selector).cloneNode(true);source.classList.add('sq-reference','sq-flow','sq-page-block');source.setAttribute('lang','id');source.dataset.sqBlock='';source.dataset.sqComposition=id;source.dataset.sqSectionName=name;source.dataset.sectionId=originalId;source.id=originalId;
  if(id==='film-showcase')source.append(document.querySelector('.film-dialog').cloneNode(true));
  let nodes=[...source.querySelectorAll(units)];if(!nodes.length)nodes=[...source.children].filter(n=>!n.matches('[aria-hidden=true]'));
  nodes=nodes.filter(node=>!nodes.some(parent=>parent!==node&&parent.contains(node)));
  nodes.forEach((node,i)=>{node.dataset.sqElement='';node.dataset.sqElementType=node.matches('h1,h2,h3')?'heading':node.matches('p')?'text':node.querySelector('video')?'video':node.matches('a,button')?'button':'content';node.dataset.sqElementId=originalId+'-'+(i+1);node.classList.add('sq-flow-element');
   const walker=document.createTreeWalker(node,NodeFilter.SHOW_TEXT);const textNodes=[];while(walker.nextNode())if(walker.currentNode.textContent.trim()&&!walker.currentNode.parentElement.closest('svg,style,script'))textNodes.push(walker.currentNode);
   for(const text of textNodes){const parent=text.parentElement;if([...parent.childNodes].every(n=>n.nodeType===Node.TEXT_NODE)){parent.dataset.sqFlowText='';continue;}const span=document.createElement('span');span.dataset.sqFlowText='';span.className='sq-inline-text';text.replaceWith(span);span.append(text);}
  });
  [source,...source.querySelectorAll('*')].forEach(node=>{
   node.className?.baseVal===undefined&&[...node.classList].forEach(name=>{if(!name.startsWith('sq-')){node.classList.remove(name);node.classList.add('ezm-'+name);}});
   if(node.matches('svg'))node.setAttribute('class',[...node.classList].map(c=>c.startsWith('ezm-')?c:'ezm-'+c).join(' '));
   for(const attr of ['src','poster','data-src'])if(node.hasAttribute(attr))node.setAttribute(attr,new URL(node.getAttribute(attr),'https://ezkart.id/').href);
   if(node.matches('track')){node.removeAttribute('src');node.dataset.ezmCaptions=captions;}
   if(node.matches('a[href]')&&!/^(#|mailto:|tel:)/.test(node.getAttribute('href')))node.href=new URL(node.getAttribute('href'),'https://ezkart.id/').href;
   if(node.matches('.ezm-reveal'))node.classList.add('ezm-is-visible');
  });
  source.querySelectorAll('.ezm-stage-halo,.ezm-closing-glow').forEach(n=>n.setAttribute('aria-hidden','true'));
  templates[id]=source.outerHTML;
 }
 return {css:rules(sheet.cssRules),templates,definitions:definitions.map(([id,name,category,description,,,,])=>({id,name,category,description,preview:id}))};
},{css,captions});await browser.close();
const prelude=`/* Native sections adapted from the user-owned https://ezkart.id, retrieved 2026-09-14. */\n`;
await writeFile(join(repoRoot,'cart/admin/builder-showcase.css'),prelude+result.css+'\n');
await writeFile(join(repoRoot,'cart/admin/builder-showcase-data.js'),prelude+`globalThis.EzkartShowcaseData=${JSON.stringify({definitions:result.definitions,templates:result.templates})};\n`);
console.log('Prepared',result.definitions.length,'editable reference sections.');
