import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {Workspace,repoRoot} from '../workspace.mjs';

test('MCP edits survive project switching and restart; undo, validation and export share the builder',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'ezkart-mcp-test-'));
 let client;
 const connect=async()=>{client=new Client({name:'integration-test',version:'1'});await client.connect(new StdioClientTransport({command:process.execPath,args:[join(repoRoot,'tools/builder-mcp/server.mjs')],env:{...process.env,EZKART_WORKSPACE:directory}}));};
 const call=async(name,args={})=>{const result=await client.callTool({name,arguments:args});assert.ok(!result.isError,JSON.stringify(result));return JSON.parse(result.content[0].text);};
 try{
  await writeFile(join(directory,'catalog.json'),JSON.stringify({products:[{id:'owned-product',name:'Merchant product',type:'physical',status:'active',stock:4,price:10000}]}));
  await connect();const availableTools=(await client.listTools()).tools;assert.equal(availableTools.length,29);assert.ok(availableTools.some(tool=>tool.name==='template_products'));
  await call('project_create',{id:'first',name:'First',productIds:['owned-product']});
  await call('section_add',{component:'hero-split',id:'hero',content:{title:'One main heading',body:'Editable content'}});
  await call('section_remove',{id:'blank'});
  await call('element_update',{id:'hero-title',text:'Changed heading'});
  await call('undo');assert.equal((await call('page_inspect')).sections[0].elements[0].fields[0].text,'One main heading');
  await call('redo');assert.equal((await call('page_inspect')).sections[0].elements[0].fields[0].text,'Changed heading');
  await call('element_update',{id:'hero-title',autoHeight:false,layout:{height:10}});
  assert.equal((await call('page_inspect')).sections[0].elements[0].layout.height,10);
  await call('element_update',{id:'hero-title',autoHeight:true});
  await call('section_update',{id:'hero',spacing:{top:17,left:23},device:'mobile'});
  await call('project_create',{id:'second',name:'Second'});
  await call('project_open',{id:'first'});
  await call('device_set',{device:'mobile'});
  let state=await call('page_inspect');assert.equal(state.sections[0].spacing.top,17);assert.equal(state.sections[0].spacing.left,23);
  const invalid=await client.callTool({name:'element_update',arguments:{id:'hero-title',src:'javascript:alert(1)'}});assert.equal(invalid.isError,true);
  const blocked=await client.callTool({name:'page_export',arguments:{}});assert.equal(blocked.isError,true);
  await call('section_add',{component:'product-collection',id:'shop',productId:'owned-product'});
  const exported=await call('page_export');const html=await readFile(exported.path,'utf8');assert.match(html,/Changed heading/);assert.match(html,/data-ezkart-auto-height/);assert.doesNotMatch(html,/data-sq-element=/);
  await client.close();await connect();await call('project_open',{id:'first'});state=await call('page_inspect');assert.equal(state.sections[0].elements[0].fields[0].text,'Changed heading');
 }finally{await client?.close();await rm(directory,{recursive:true,force:true});}
});

test('all native compositions, navigation changes, responsive export, FAQ reflow and desktop panel fit',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'ezkart-browser-test-'));const ws=await new Workspace(directory).init();await ws.create({id:'review',name:'Review'});await ws.start();
 const browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',error=>errors.push(error.message));
 try{
  await page.goto(ws.url+'/cart/admin/?page=sites&edit=review.ezkart.site');await page.waitForFunction(()=>globalThis.EzkartBuilder);
  const invoke=(method,args={})=>page.evaluate(({method,args})=>EzkartBuilder[method](args),{method,args});
  const library=await invoke('components');assert.equal(library.sections.length,24);assert.equal(library.navigation.length,5);
  const uneditable=await page.evaluate(()=>Object.keys(EzkartShowcaseData.templates).flatMap(id=>{
   const holder=document.createElement('div');holder.innerHTML=EzkartComponents.create(id,{sectionId:'coverage'});const walker=document.createTreeWalker(holder,NodeFilter.SHOW_TEXT),missing=[];
   while(walker.nextNode()){const node=walker.currentNode;if(node.textContent.trim()&&!node.parentElement.closest('[data-sq-element],svg,dialog'))missing.push({component:id,text:node.textContent.trim().slice(0,80)});}return missing;
  }));assert.deepEqual(uneditable,[], 'Every visible reference text must belong to an editable native element');

  for(const {id} of library.sections)await invoke('addSection',{component:id,id,content:{title:'A long editable heading for layout checks',body:'A paragraph that wraps naturally across the canvas. '.repeat(4)}});
  for(const device of ['desktop','tablet','mobile']){await invoke('setDevice',{device});await invoke('settle');const audit=await invoke('audit');assert.deepEqual(audit.issues.filter(issue=>issue.type==='overflow'),[]);}
  await invoke('setDevice',{device:'desktop'});
  for(const {id} of library.navigation){await invoke('navigation',{layout:id,brand:'Test store',links:[{label:'Shop',href:'#product-collection'},{label:'About',href:'#story-split'},{label:'FAQ',href:'#faq-list'}]});const links=await page.locator('[data-section-id=navigation] > [data-sq-element-type=navigation] > a').allTextContents();assert.equal(links.length,3);const navHeight=await page.locator('.sq-authored-navigation').evaluate(n=>n.offsetHeight);assert.ok(['masthead','shop'].includes(id)?navHeight>=140:navHeight<100,`incorrect ${id} navigation height: ${navHeight}`);}
  await invoke('navigation',{layout:'split',brand:'Test store'});await invoke('navigation',{layout:'studio'});assert.equal(await page.locator('[data-section-id=navigation] > [data-sq-element-type=navigation] > a').count(),3);
  await page.locator('[data-sq-tab=add]').click();await page.waitForTimeout(250);
  const geometry=await page.evaluate(()=>{const sidebar=document.querySelector('.sq-builder-sidebar').getBoundingClientRect(),canvas=document.querySelector('.sq-canvas-scroll').getBoundingClientRect(),frame=document.querySelector('.sq-device-frame').getBoundingClientRect();return {sidebar:sidebar.right,canvas:canvas.left,frame:frame.right,right:canvas.right};});assert.ok(geometry.sidebar<=geometry.canvas+1);assert.ok(geometry.frame<=geometry.right+1);
  await invoke('navigation',{layout:'studio',sticky:true});
  await invoke('updateSection',{id:'faq-list',background:'#242822',color:'#ffffff'});
  const html=await invoke('previewHtml');await page.route('**/export',route=>route.fulfill({body:html,contentType:'text/html'}));await page.goto(ws.url+'/export');await page.evaluate(()=>document.fonts.ready);
  for(const width of [320,390,600,768,900,1120,1440,1920]){
   await page.setViewportSize({width,height:1000});await page.waitForTimeout(100);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width,`horizontal overflow at ${width}`);
   const section=page.locator('[data-ezkart-section=faq-list]');const before=await section.evaluate(s=>s.offsetHeight);await section.locator('details').first().evaluate(d=>d.open=true);await page.waitForTimeout(100);const after=await section.evaluate(s=>s.offsetHeight);assert.ok(after>before,`FAQ did not grow at ${width}`);await section.locator('details').first().evaluate(d=>d.open=false);await page.waitForTimeout(100);
   assert.equal(await section.evaluate(s=>getComputedStyle(s).backgroundColor),'rgb(36, 40, 34)');
  }
  assert.deepEqual(errors,[]);
 }finally{await browser.close();await ws.stop();await rm(directory,{recursive:true,force:true});}
});

test('workspace rejects traversal and cross-origin writes',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'ezkart-workspace-test-'));const ws=await new Workspace(directory).init();await ws.create({id:'safe',name:'Safe'});await ws.start();
 try{await assert.rejects(ws.read('../outside'));await assert.rejects(ws.create({id:'safe',name:'Duplicate'}));
  assert.equal((await fetch(ws.url+'/cart/admin/?cloud=/v1/landing-pages/safe',{method:'PUT',body:'{}'})).status,403);
  assert.equal((await fetch(ws.url+'/cart/admin/?cloud=/v1/landing-pages/safe',{headers:{Origin:'https://unrelated.example'}})).status,403);
 }finally{await ws.stop();await rm(directory,{recursive:true,force:true});}
});

test('reference sections stay editable, preserve device-specific sizing, and export working navigation and media',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'ezkart-flow-test-'));const ws=await new Workspace(directory).init();await ws.create({id:'reference',name:'Reference'});await ws.start();
 const browser=await chromium.launch(),page=await browser.newPage({viewport:{width:1600,height:1000},reducedMotion:'reduce'});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(ws.url+'/cart/admin/?page=sites&edit=reference.ezkart.site');await page.waitForFunction(()=>globalThis.EzkartBuilder);
  const invoke=(method,args={})=>page.evaluate(({method,args})=>EzkartBuilder[method](args),{method,args});
  for(const [component,id] of [['brand-navigation','navigation'],['centered-showcase','top'],['device-showcase','landing-pages'],['film-showcase','in-motion'],['support-questions','questions']])await invoke('addSection',{component,id});await invoke('removeSection',{id:'blank'});
  const field=(await invoke('inspect')).sections.find(s=>s.id==='top').elements.find(e=>e.type==='heading');
  assert.equal(field.fields.length,3);await invoke('updateElement',{id:field.id,text:'A new first line.',field:0});await invoke('undo');assert.equal((await invoke('inspect')).sections.find(s=>s.id==='top').elements.find(e=>e.id===field.id).fields[0].text,field.fields[0].text);
  await invoke('updateElement',{id:field.id,layout:{x:18,width:1000},device:'desktop'});
  await page.locator(`[data-sq-element-id="${field.id}"]`).click();await page.locator('[data-sq-overlay-duplicate]').click();assert.equal(await page.locator('#top h1').count(),2);await invoke('undo');
  await invoke('setDevice',{device:'mobile'});assert.equal(await page.locator('#top h1').evaluate(n=>n.style.getPropertyValue('--sq-flow-width')),'');await invoke('setDevice',{device:'desktop'});await invoke('save');
  await page.reload();await page.waitForFunction(()=>globalThis.EzkartBuilder);await invoke('settle');assert.equal((await invoke('inspect')).sections.find(s=>s.id==='top').elements.find(e=>e.id===field.id).layout.x,18);
  const html=await invoke('previewHtml');assert.match(html,/@container ezkart-page/);assert.match(html,/data:font\/woff2;base64/);assert.doesNotMatch(html,/<iframe/);
  await page.route('**/flow-export',r=>r.fulfill({body:html,contentType:'text/html'}));await page.setViewportSize({width:1440,height:1000});await page.goto(ws.url+'/flow-export');await page.evaluate(()=>document.fonts.ready);
  assert.equal(await page.locator('#top h1').evaluate(n=>n.offsetWidth),1000);assert.equal(await page.locator('[data-ezkart-cart-open]').count(),0);assert.equal(await page.evaluate(()=>[...document.fonts].every(f=>f.status==='loaded')),true);
  await page.locator('.ezm-watch-button').click();assert.equal(await page.locator('.ezm-film-dialog').evaluate(n=>n.open),true);await page.keyboard.press('Escape');assert.equal(await page.locator('.ezm-film-dialog').evaluate(n=>n.open),false);
  await page.locator('.ezm-device-switch [data-device=mobile]').click();assert.equal(await page.locator('.ezm-responsive-preview').getAttribute('data-preview-device'),'mobile');
  await page.setViewportSize({width:390,height:1000});assert.ok(await page.locator('#top h1').evaluate(n=>n.offsetWidth)<=390);await page.evaluate(()=>scrollTo(0,0));await page.locator('.ezm-menu-toggle').click();assert.equal(await page.locator('.ezm-menu-toggle').getAttribute('aria-expanded'),'true');await page.keyboard.press('Escape');assert.equal(await page.locator('.ezm-menu-toggle').getAttribute('aria-expanded'),'false');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),390);assert.deepEqual(errors,[]);
 }finally{await browser.close();await ws.stop();await rm(directory,{recursive:true,force:true});}
});

test('catalog photos keep a square aspect ratio instead of the admin thumbnail flex basis',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'ezkart-photo-test-'));const ws=await new Workspace(directory).init();await ws.start();
 await writeFile(join(directory,'catalog.json'),JSON.stringify({mediaBase:ws.url+'/preview-media',products:[{id:'custom-photo',name:'Photo regression fixture',type:'physical',price:10000,stock:3,weightGrams:100,media:[{id:'photo'}]}]}));await ws.create({id:'photos',name:'Photos',productIds:['custom-photo']});
 const browser=await chromium.launch(),page=await browser.newPage({viewport:{width:1440,height:1000}});
 try{
  await page.route('**/preview-media/**',r=>r.fulfill({body:'<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#f44b34"/></svg>',contentType:'image/svg+xml'}));await page.goto(ws.url+'/cart/admin/?page=sites&edit=photos.ezkart.site');await page.waitForFunction(()=>globalThis.EzkartBuilder);
  await page.evaluate(async()=>{await EzkartBuilder.addSection({component:'product-collection',id:'products'});await EzkartBuilder.removeSection({id:'blank'});});
  const check=async()=>{const size=await page.locator('.sq-product-grid .product-art').evaluate(n=>({width:n.offsetWidth,height:n.offsetHeight,flex:getComputedStyle(n).flexBasis}));assert.ok(size.width>100);assert.ok(Math.abs(size.width-size.height)<2);assert.notEqual(size.flex,'36px');};
  await check();const html=await page.evaluate(()=>EzkartBuilder.previewHtml());await page.route('**/photo-export',r=>r.fulfill({body:html,contentType:'text/html'}));await page.goto(ws.url+'/photo-export');await check();
 }finally{await browser.close();await ws.stop();await rm(directory,{recursive:true,force:true});}
});

test('blank-canvas primitives expose gradients, responsive type and semantic headings in the UI and export',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'ezkart-native-controls-')),ws=await new Workspace(directory).init();await ws.create({id:'native',name:'Native'});await ws.start();
 const browser=await chromium.launch(),page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const invoke=(method,args={})=>page.evaluate(({method,args})=>EzkartBuilder[method](args),{method,args});
 try{
  await page.goto(ws.url+'/cart/admin/?page=sites&edit=native.ezkart.site');await page.waitForFunction(()=>globalThis.EzkartBuilder);
  await invoke('addElement',{section:'blank',id:'title',type:'heading'});
  await invoke('updateElement',{id:'title',text:'A native title',headingLevel:'h1',style:{fontSize:'80px',alignItems:'flex-start'},autoHeight:true,layout:{x:1,y:1,width:12,height:4}});
  await invoke('updateElement',{id:'title',style:{fontSize:'36px'},device:'mobile'});
  await invoke('updateSection',{id:'blank',gradient:{kind:'linear',from:'#f44b34',to:'#ed93bc',angle:120},spacing:{top:32,left:24,right:24,bottom:32},fitHeight:true});
  await page.locator('[data-sq-section-background-type=gradient]').click();
  assert.equal(await page.locator('[data-sq-gradient=angle]').inputValue(),'120');
  await page.locator('[data-sq-gradient=kind]').selectOption('radial');
  assert.equal((await invoke('inspect')).sections[0].background.gradient.kind,'radial');
  await invoke('undo');assert.equal((await invoke('inspect')).sections[0].background.gradient.kind,'linear');await invoke('redo');
  await page.locator('[data-sq-section-background-type=solid]').click();assert.equal(await page.locator('.sq-gradient-layer').isVisible(),false);
  await page.locator('[data-sq-section-background-type=gradient]').click();assert.equal((await invoke('inspect')).sections[0].background.gradient.kind,'radial');
  await page.locator('[data-sq-gradient=kind]').selectOption('wash');
  await invoke('save');await page.reload();await page.waitForFunction(()=>globalThis.EzkartBuilder);await invoke('settle');
  assert.equal((await invoke('inspect')).sections[0].background.gradient.kind,'wash');
  await invoke('setDevice',{device:'mobile'});assert.equal(await page.locator('[data-sq-element-id=title] h1').evaluate(n=>getComputedStyle(n).fontSize),'36px');
  await page.locator('[data-sq-element-id=title]').click();await page.locator('[data-sq-element-tab=style]').click();
  assert.equal(await page.locator('[data-sq-heading-level]').inputValue(),'h1');assert.equal(await page.locator('[data-sq-element-font-size]').inputValue(),'36');
  await page.locator('[data-sq-heading-level]').selectOption('h2');assert.equal(await page.locator('[data-sq-element-id=title] h2').count(),1);await invoke('undo');
  await invoke('setDevice',{device:'desktop'});await invoke('addSection',{component:'blank',id:'dark'});await invoke('updateSection',{id:'dark',background:'#272724'});
  await invoke('addElement',{section:'blank',id:'link',type:'button'});await invoke('updateElement',{id:'link',text:'Read more',action:{type:'section',target:'dark'}});
  await invoke('addElement',{section:'dark',id:'body',type:'text'});await invoke('updateElement',{id:'body',text:'A real text block',style:{color:'#ffffff'}});
  const snapshot=await invoke('snapshot');assert.doesNotMatch(snapshot.preview,/sq-reference|sq-flow|sq-free-code|<iframe|<style|<script/);
  const html=await invoke('previewHtml');await page.route('**/native-export',r=>r.fulfill({body:html,contentType:'text/html'}));await page.goto(ws.url+'/native-export');await page.evaluate(()=>document.fonts.ready);
  assert.equal(await page.locator('#dark').count(),1);assert.equal(await page.locator('[data-ezkart-element=link] button').getAttribute('data-ezkart-target'),'dark');
  assert.equal(await page.locator('[data-ezkart-section=dark]').evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(39, 39, 36)');
  assert.equal(await page.locator('.sq-gradient-surface').evaluate(n=>getComputedStyle(n).backgroundImage.includes('radial-gradient')),true);
  for(const [width,size] of [[1440,'80px'],[390,'36px'],[320,'36px'],[901,'80px']]){await page.setViewportSize({width,height:1000});await page.waitForTimeout(100);assert.equal(await page.locator('h1').evaluate(n=>getComputedStyle(n).fontSize),size);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);}
  assert.deepEqual(errors,[]);
 }finally{await browser.close();await ws.stop();await rm(directory,{recursive:true,force:true});}
});

test('the ordinary new-page dialog accepts no products and opens a blank canvas',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'ezkart-blank-dialog-')),ws=await new Workspace(directory).init();await ws.create({id:'existing',name:'Existing'});await ws.start();
 const browser=await chromium.launch(),page=await browser.newPage({viewport:{width:1600,height:1000}});let created;
 try{
  await page.route('**/cart/admin/?cloud=*',async route=>{
   const request=route.request(),path=new URL(request.url()).searchParams.get('cloud');
   if(path!=='/v1/landing-pages/from-ui')return route.continue();
   if(request.method()==='PUT')created={...request.postDataJSON(),id:'from-ui',url:'from-ui.ezkart.site',status:'draft'};
   await route.fulfill({json:{ok:true,page:created}});
  });
  await page.goto(ws.url+'/cart/admin/?page=sites&edit=existing.ezkart.site');await page.waitForFunction(()=>globalThis.EzkartBuilder);
  await page.getByRole('button',{name:'+ New page',exact:true}).click();
  await page.locator('#page-creator-dialog [name=page_name]').fill('From UI');await page.locator('#page-creator-dialog [name=slug]').fill('from-ui');
  await page.locator('[data-create-page]').click();await page.waitForFunction(()=>EzkartBuilder.inspect().page.id==='from-ui');
  assert.deepEqual(created.products,[]);const state=await page.evaluate(()=>EzkartBuilder.inspect());assert.equal(state.sections.length,1);assert.equal(state.sections[0].elements.length,0);
 }finally{await browser.close();await ws.stop();await rm(directory,{recursive:true,force:true});}
});
