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
  await connect();assert.equal((await client.listTools()).tools.length,21);
  await call('project_create',{id:'first',name:'First'});
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
  const library=await invoke('components');assert.equal(library.sections.length,15);assert.equal(library.navigation.length,5);
  for(const {id} of library.sections)await invoke('addSection',{component:id,id,content:{title:'A long editable heading for layout checks',body:'A paragraph that wraps naturally across the canvas. '.repeat(4)}});
  for(const device of ['desktop','tablet','mobile']){await invoke('setDevice',{device});await invoke('settle');const audit=await invoke('audit');assert.deepEqual(audit.issues.filter(issue=>issue.type==='overflow'),[]);}
  await invoke('setDevice',{device:'desktop'});
  for(const {id} of library.navigation){await invoke('navigation',{layout:id,brand:'Test store',links:[{label:'Shop',href:'#product-collection'},{label:'About',href:'#story-split'},{label:'FAQ',href:'#faq-list'}]});const links=await page.locator('[data-section-id=navigation] > [data-sq-element-type=navigation] > a').allTextContents();assert.equal(links.length,3);const navHeight=await page.locator('.sq-authored-navigation').evaluate(n=>n.offsetHeight);assert.ok(['masthead','shop'].includes(id)?navHeight>=140:navHeight<100,`incorrect ${id} navigation height: ${navHeight}`);}
  await invoke('navigation',{layout:'split',brand:'Test store'});await invoke('navigation',{layout:'studio'});assert.equal(await page.locator('[data-section-id=navigation] > [data-sq-element-type=navigation] > a').count(),3);
  await page.locator('[data-sq-tab=add]').click();await page.waitForTimeout(250);
  const geometry=await page.evaluate(()=>{const sidebar=document.querySelector('.sq-builder-sidebar').getBoundingClientRect(),canvas=document.querySelector('.sq-canvas-scroll').getBoundingClientRect(),frame=document.querySelector('.sq-device-frame').getBoundingClientRect();return {sidebar:sidebar.right,canvas:canvas.left,frame:frame.right,right:canvas.right};});assert.ok(geometry.sidebar<=geometry.canvas+1);assert.ok(geometry.frame<=geometry.right+1);
  await invoke('updateSection',{id:'faq-list',background:'#242822',color:'#ffffff'});
  const html=await invoke('exportHtml');await page.route('**/export',route=>route.fulfill({body:html,contentType:'text/html'}));await page.goto(ws.url+'/export');await page.evaluate(()=>document.fonts.ready);
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
