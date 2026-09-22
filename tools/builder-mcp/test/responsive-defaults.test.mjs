import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {Workspace} from '../workspace.mjs';

async function fixture(run) {
  const dir=await mkdtemp(join(tmpdir(),'ezkart-auto-layout-'));
  const ws=await new Workspace(dir).init();
  await writeFile(join(dir,'catalog.json'),JSON.stringify({products:[{id:'coffee',name:'Coffee beans',type:'physical',price:95000,stock:10}]}));
  await ws.create({id:'responsive-defaults',name:'Responsive defaults'});await ws.start();
  const browser=await chromium.launch();
  const page=await browser.newPage({viewport:{width:1894,height:1050},reducedMotion:'reduce'});
  page.setDefaultTimeout(6000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const call=(method,args={})=>page.evaluate(({method,args})=>EzkartBuilder[method](args),{method,args});
  const insert=node=>call('nativeInsert',{section:'blank',node});
  const device=async device=>{await page.locator(`[data-sq-device=${device}]`).click();await call('settle');};
  const render=await browser.newPage({viewport:{width:390,height:1050},reducedMotion:'reduce'});
  let html='';await render.route('**/responsive-defaults-export',route=>route.fulfill({body:html,contentType:'text/html'}));
  const exported=async()=>{html=await call('previewHtml');await render.goto(ws.url+'/responsive-defaults-export');await render.evaluate(()=>document.fonts.ready);return render;};
  try {
    await page.goto(ws.url+'/cart/admin/?page=sites&edit=responsive-defaults.ezkart.site');
    await page.waitForFunction(()=>globalThis.EzkartBuilder);await call('settle');
    await run({page,render,call,insert,device,exported});
    assert.deepEqual(errors,[]);
  } finally {await browser.close();await ws.stop();await rm(dir,{recursive:true,force:true});}
}
const element=(page,id)=>page.locator(`.sq-page-preview [data-native-id="${id}"]`);
const geometry=(page,id)=>element(page,id).evaluate(node=>{
  const rect=node.getBoundingClientRect(),parent=node.parentElement.getBoundingClientRect(),css=getComputedStyle(node);
  return {left:rect.left-parent.left,right:rect.right-parent.left,top:rect.top-parent.top,bottom:rect.bottom-parent.top,
    parentWidth:parent.width,parentHeight:parent.height,width:rect.width,height:rect.height,
    offset:css.left,fit:css.objectFit,display:css.display,scrollWidth:node.scrollWidth,clientWidth:node.clientWidth};
});
async function assertContained(page,id) {
  const g=await geometry(page,id);
  assert.notEqual(g.display,'none',id+' remains visible');
  assert.ok(g.width>0 && g.height>0,id+' has a visible size');
  assert.ok(g.left>=-1 && g.right<=g.parentWidth+1,id+' fits horizontally: '+JSON.stringify(g));
  assert.ok(g.top>=-1 && g.bottom<=g.parentHeight+1,id+' fits vertically: '+JSON.stringify(g));
  return g;
}

test('existing desktop placement reflows on smaller screens through dragging, history, preview and reopening',()=>fixture(async({page,call,insert,device,exported})=>{
  await call('updateSection',{id:'blank',gradient:{kind:'linear',from:'#ff8430',to:'#f82177',base:'#fff8f0',opacity:100,angle:105}});
  // An existing upload has shared desktop offsets, with no new auto-layout flag.
  await insert({id:'hero-image',type:'image',src:'/cart/admin/assets/products/kopi-susu.webp',alt:'Coffee',props:{position:'relative',left:'800px',top:'60px',width:'360px',height:'360px',objectFit:'contain'}});
  await call('navigation',{layout:'studio',brand:'Your brand',links:[{label:'Shop',href:'#blank'}]});
  await page.locator('[data-sq-navigation-overlay]').locator('..').click();
  const image=element(page,'hero-image');await image.evaluate(n=>n.decode());
  if(await page.locator('.sq-builder-sidebar.sq-panel-pinned').count())await page.locator('[data-sq-tab].active').click();
  await call('settle');
  const before=await call('nativeInspect',{id:'hero-image'});
  await image.click();
  const box=await image.boundingBox();
  await page.keyboard.down('Alt');
  await page.mouse.move(box.x+40,box.y+40);await page.mouse.down();
  await page.mouse.move(box.x+95,box.y+65,{steps:8});await page.mouse.up();await page.keyboard.up('Alt');await call('settle');
  const moved=await call('nativeInspect',{id:'hero-image'});
  assert.ok(parseFloat(moved.props.left)>800,'Desktop drag stores the desktop placement');
  await call('undo');assert.deepEqual(await call('nativeInspect',{id:'hero-image'}),before);
  await call('redo');assert.deepEqual(await call('nativeInspect',{id:'hero-image'}),moved);
  await image.click();
  const desktop=await geometry(page,'hero-image');
  for(const size of ['tablet','mobile']) {
    await device(size);await assertContained(page,'hero-image');
    assert.equal((await geometry(page,'hero-image')).offset,'0px','Desktop offset is not inherited');
    assert.equal(await page.locator('[data-native-prop=left]').inputValue(),'auto','Inspector shows the automatic placement');
  }
  await device('desktop');assert.deepEqual(await geometry(page,'hero-image'),desktop,'The desktop design stays unchanged');
  await call('save');await page.reload();await page.waitForFunction(()=>globalThis.EzkartBuilder);await call('settle');
  await page.setViewportSize({width:941,height:1024});await device('mobile');await assertContained(page,'hero-image');
  await page.screenshot({path:'/tmp/ezkart-responsive-defaults-editor.png',animations:'disabled'});
  await page.locator('[data-sq-preview]').click();await page.locator('[data-sq-preview-device=mobile]').click();
  const frame=await page.locator('[data-sq-live-preview-frame]').elementHandle().then(n=>n.contentFrame());
  await element(frame,'hero-image').waitFor();await frame.evaluate(()=>document.fonts.ready);
  await assertContained(frame,'hero-image');
  await page.screenshot({path:'/tmp/ezkart-responsive-defaults-preview.png',animations:'disabled'});
  await page.locator('[data-sq-preview-close]').click();
  const render=await exported();
  for(const width of [320,390,600,601,768,900]) {
    await render.setViewportSize({width,height:1050});await render.evaluate(()=>new Promise(requestAnimationFrame));
    const g=await assertContained(render,'hero-image');assert.ok(Math.abs(g.width-g.height)<1,'A resized image frame stays square');assert.equal(g.fit,'contain');
    assert.equal(await render.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  }
}));

test('automatic text, media, controls and products stay in order and allow the section to grow',()=>fixture(async({page,call,insert,device,exported})=>{
  const defaults=await page.evaluate(()=>EzkartNative.defaults);
  const types=[
    {id:'heading',type:'heading',text:'A heading with room to wrap'},
    {id:'text',type:'text',text:'Averylongunbrokenwordthatmustnotpushthepageoutsideitsmobileviewport. '.repeat(4)},
    {id:'image',type:'image',src:'/cart/admin/assets/products/kopi-susu.webp'},
    {id:'video',type:'video',poster:'/cart/admin/assets/products/kopi-susu.webp',controls:true},
    {id:'button',type:'button',text:'A longer action customers can still read'},
    {id:'icon',type:'icon',icon:'arrow-right'},
    {id:'product',type:'product',productId:'coffee'},
    {id:'accordion',type:'accordion',children:[{id:'summary',type:'summary',text:'Delivery information',props:defaults.summary},{id:'answer',type:'text',text:'We deliver to your address.',props:defaults.text}]},
  ];
  for(const node of types)await insert({...node,props:{...defaults[node.type],width:node.type==='icon'?'24px':'520px',...(node.type==='image'?{height:'auto',objectFit:'contain'}:{}),...(node.type==='video'?{height:'292.5px'}:{}),position:'relative',left:'740px',top:'80px'}});
  await call('nativeUpdate',{id:'blank',props:{height:'600px',overflow:'hidden'}});
  await device('mobile');
  let bottom=-1;
  for(const node of types) {const g=await assertContained(page,node.id);assert.ok(g.top>=bottom-1,node.type+' follows the previous element');bottom=g.bottom;}
  assert.ok(await element(page,'blank').evaluate(n=>n.offsetHeight)>600,'Content grows beyond the desktop frame');
  const render=await exported();
  for(const width of [320,390,768]) {
    await render.setViewportSize({width,height:1050});await render.evaluate(()=>new Promise(requestAnimationFrame));
    for(const node of types)await assertContained(render,node.id);
    for(const id of ['heading','text','button'])assert.ok(await element(render,id).evaluate(n=>n.scrollWidth<=n.clientWidth+1),id+' wraps without clipping');
    assert.ok(await element(render,'button').evaluate(n=>n.offsetHeight)>=44,'Actions retain a touch target');
    assert.equal(await render.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  }
  await element(render,'summary').click();assert.equal(await element(render,'answer').isVisible(),true,'Accordion interaction survives reflow');
}));

test('authored breakpoint layouts, intentional visibility and template internals take precedence',()=>fixture(async({page,call,insert,device,exported})=>{
  await insert({id:'blank',type:'container',props:{position:'relative',minHeight:'600px',paddingLeft:'20px',paddingRight:'20px'},children:[
    {id:'authored',type:'text',text:'Authored composition',props:{position:'absolute',left:'50px',top:'120px',width:'200px'}},
    {id:'responsive',type:'image',autoLayout:true,src:'/cart/admin/assets/products/kopi-susu.webp',props:{position:'absolute',left:'900px',top:'40px',width:'360px',height:'360px'},responsive:[
      {max:900,props:{position:'relative',left:'15px',top:'10px',width:'180px'}},
      {device:'mobile',max:600,props:{left:'25px',top:'20px',width:'160px',display:'none'}},
    ]},
    {id:'hidden',type:'text',autoLayout:true,text:'Toggle target',collapsed:true,props:{width:'100px'}},
    {id:'scaled',type:'container',autoLayout:true,fit:{max:900,width:1000,height:200,extra:0},props:{width:'1000px',height:'200px'},children:[{id:'scaled-child',type:'text',text:'Scaled artwork',props:{position:'absolute',left:'600px',top:'100px'}}]},
  ]});
  await device('tablet');
  assert.equal((await geometry(page,'authored')).offset,'50px','Authored template internals do not get automatic reflow');
  assert.equal((await geometry(page,'responsive')).offset,'15px');
  assert.equal(await element(page,'responsive').evaluate(n=>n.offsetWidth),180);
  await device('mobile');
  assert.equal(await element(page,'responsive').isVisible(),false,'Explicit mobile hiding wins');
  assert.equal(await element(page,'hidden').isVisible(),false,'Initially hidden elements stay hidden');
  assert.equal((await geometry(page,'scaled-child')).offset,'600px','Scale-to-fit internals retain authored coordinates');
  await device('desktop');assert.equal((await geometry(page,'responsive')).offset,'900px');
  const render=await exported();
  assert.equal(await element(render,'responsive').isVisible(),false);
  assert.equal(await element(render,'hidden').isVisible(),false);
  await render.setViewportSize({width:768,height:1050});await render.evaluate(()=>new Promise(requestAnimationFrame));
  assert.equal((await geometry(render,'responsive')).offset,'15px');
}));
