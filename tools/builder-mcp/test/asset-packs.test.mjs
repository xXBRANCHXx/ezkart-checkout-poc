import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {Workspace} from '../workspace.mjs';
import {openAssets} from './asset-helpers.mjs';

const artifacts=process.env.EZKART_PACK_ARTIFACTS;
const launchIds=['text-editorial','text-statement','text-story','bulletin-strip','bulletin-note','bulletin-checklist','accordion-ruled','accordion-cards','accordion-numbered','diagram-process','diagram-branch','diagram-cycle','code-terminal','code-object','code-recipe','review-editorial','review-cards','review-spotlight','contact-letter','contact-details','contact-card','invitation-poster','invitation-band','invitation-minimal','feature-columns','feature-stack','feature-tiles','button-solid','button-outline','button-editorial','pricing-card','pricing-compare','pricing-menu','facts-strip','facts-spotlight','facts-details','people-profile','people-team','people-note','footer-simple','footer-columns','footer-signature'];
const representatives=['text-chapter-opening','buttons-destination-row','bulletins-date-ticket','features-inside-out','reviews-rating-context','reviews-quote-ribbon','accordions-split-intro','diagrams-horizontal-handoff','pricing-session-ticket','facts-dimensions-card','people-studio-roles','contact-project-postcard','invitations-next-chapter','footers-split-dark','code-source-gutter'];
const walk=node=>[node,...(node.children||[]).flatMap(walk)];
async function record(name,value) {
  if(!artifacts)return;
  await mkdir(artifacts,{recursive:true});
  await writeFile(join(artifacts,name),JSON.stringify(value,null,2)+'\n');
}
async function shot(page,name,locator) {
  if(!artifacts)return;
  await mkdir(join(artifacts,'screenshots'),{recursive:true});
  await (locator||page).screenshot({path:join(artifacts,'screenshots',name+'.png')});
}
async function fixture(t,{earlier=[],editor=true,inspectPreviews=false}={}) {
  const dir=await mkdtemp(join(tmpdir(),'ezkart-packs-'));
  const ws=await new Workspace(dir).init();
  await writeFile(join(dir,'catalog.json'),JSON.stringify({products:[{id:'pack-product',name:'Reference test item',type:'physical',price:10000,stock:20,weightGrams:100}]}));
  await ws.create({id:'packs',name:'Native pack verification'});await ws.start();
  const browser=await chromium.launch();
  const page=await browser.newPage({viewport:{width:1600,height:1100},reducedMotion:'reduce'});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(10000);
  await page.addInitScript(earlier=>{globalThis.EzkartAssetPacks=earlier;},earlier);
  if(inspectPreviews)await page.addInitScript(()=>{
    // Capture the browser's real closed preview roots for geometry assertions.
    // Production selectors, including shadow-piercing automation, stay isolated.
    const attach=Element.prototype.attachShadow;globalThis.packPreviewRoots=new WeakMap();
    Element.prototype.attachShadow=function(options){const root=attach.call(this,options);packPreviewRoots.set(this,root);return root;};
  });
  t.after(async()=>{await browser.close();await ws.stop();await rm(dir,{recursive:true,force:true});assert.deepEqual(errors,[],'No browser page errors');});
  const call=(method,args={})=>page.evaluate(({method,args})=>EzkartBuilder[method](args),{method,args});
  if(editor) {
    await page.goto(ws.url+'/cart/admin/?page=sites&edit=packs.ezkart.site');
    await page.waitForFunction(()=>globalThis.EzkartBuilder);await call('settle');
  } else {
    await page.route('**/native-pack-check',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/cart/admin/builder-native.css"><style>body{margin:0;background:#e9eae7}#stage{margin:0 auto;width:100%;background:white;font-family:Arial,Helvetica,sans-serif}</style></head><body><main id="stage" class="sq-page-preview"></main>${['builder-native-icons','builder-native','builder-asset-packs','builder-assets'].map(file=>`<script src="/cart/admin/${file}.js"></script>`).join('')}</body></html>`}));
    await page.goto(ws.url+'/native-pack-check');
    await page.waitForFunction(()=>globalThis.EzkartAssets);
  }
  const category=async (id,library='elements')=>{
    await openAssets(page);await page.locator(`[data-sq-library-category="${library}"]`).click();
    await page.locator(`[data-sq-view-category="${id}"][data-sq-view-library="${library}"]`).click();
  };
  return {page,browser,ws,call,category};
}

test('installed collections preserve the launch catalogue, keep metadata small, and clone every recipe independently',async t=>{
  const {page}=await fixture(t,{editor:false});
  const result=await page.evaluate(()=>{
    const before=JSON.stringify(EzkartAssetPacks),seen=new Set(),failures=[],counts={},types={};
    for(const recipe of EzkartAssets.definitions) {
      counts[recipe.category]=(counts[recipe.category]||0)+1;
      try {
        const first=EzkartAssets.create(recipe.id),second=EzkartAssets.create(recipe.id);
        EzkartNative.validate(first);EzkartNative.validate(second);
        const visit=(node)=>{
          if(seen.has(node.id))throw Error('Insertion reused an ID: '+node.id);
          seen.add(node.id);types[node.type]=(types[node.type]||0)+1;
          (node.children||[]).forEach(visit);
        };
        visit(first);visit(second);
        const secondBefore=JSON.stringify(second);
        first.props.color='#010203';if(first.children?.[0])first.children[0].name='Changed only in this copy';
        if(JSON.stringify(second)!==secondBefore)throw Error('An edit mutated the other insertion');
      } catch(error){failures.push({id:recipe.id,error:error.message});}
    }
    const inspect=(node)=>{
      if(!['container','text','heading','button','accordion','summary','icon','image','video','break','product','commerce'].includes(node.type))throw Error('Non-native node');
      if(['html','script','css','render'].some(key=>Object.hasOwn(node,key)))throw Error('Opaque rendering data');
      if(node.type==='accordion'&&(node.children?.[0]?.type!=='summary'||node.children.filter(n=>n.type==='summary').length!==1))throw Error('Broken disclosure nesting');
      (node.children||[]).forEach(inspect);
    };
    for(const item of EzkartAssetPacks){EzkartNative.validate(item.node);inspect(item.node);}
    return {definitions:EzkartAssets.definitions,sections:EzkartAssets.sectionDefinitions,categories:EzkartAssets.categories,choices:EzkartAssets.choices,counts,types,failures,nodeInstances:seen.size,packRecipes:EzkartAssetPacks.length,sourceUnchanged:before===JSON.stringify(EzkartAssetPacks)};
  });
  assert.deepEqual(result.failures,[]);
  assert.equal(result.sourceUnchanged,true,'Insertions and edits never mutate the shared pack');
  assert.ok(result.packRecipes>=238);
  assert.deepEqual(result.definitions.slice(0,launchIds.length).map(item=>item.id),launchIds,'Existing IDs and order remain stable');
  assert.equal(new Set(result.definitions.map(item=>item.id)).size,result.definitions.length);
  for(const category of result.categories)assert.ok(result.counts[category.id]>=20,`${category.name} has at least 20 options; no upper limit`);
  for(const meta of [...result.definitions,...result.sections]) {
    assert.ok(Object.keys(meta).every(key=>['id','category','name','description','section','assetId'].includes(key)),'Metadata never includes node trees or factories');
    assert.ok(JSON.stringify(meta).length<1024);
  }
  for(const id of ['button-solid','heading-display','text-body','layout-grid','faq-ruled','image-landscape','video-wide','commerce-price','divider-solid','icon-heart'])assert.ok(result.choices.some(item=>item.id===id),id);
  const choices=await page.evaluate(()=>EzkartAssets.choices.map(item=>{const node=EzkartAssets.createChoice(item.id,{productId:'pack-product'});EzkartNative.validate(node);return node.id;}));
  assert.equal(new Set(choices).size,choices.length);
  await record('catalogue.json',result);
});

async function render(page,id,width,section=false) {
  await page.setViewportSize({width,height:1100});
  return page.evaluate(({id,width,section})=>{
    const stage=document.querySelector('#stage');stage.style.width=(section?width:Math.min(width,960))+'px';
    if(section)stage.innerHTML=EzkartAssets.createSection(id,'pack-section');
    else stage.replaceChildren(EzkartNative.create(EzkartAssets.create(id)));
    let sheet=document.querySelector('#pack-styles');if(!sheet){sheet=document.createElement('style');sheet.id='pack-styles';document.head.append(sheet);}
    sheet.textContent=EzkartNative.stylesheet(stage);
    stage.querySelectorAll('details').forEach(node=>node.open=true);
    const bounds=stage.getBoundingClientRect(),issues=[];
    const configs=[...stage.querySelectorAll('.sq-native')];
    for(const node of configs) {
      const box=node.getBoundingClientRect(),css=getComputedStyle(node),config=EzkartNative.read(node);
      if(!box.width&&!box.height)continue;
      const fail=reason=>issues.push({id:config.id,text:config.text?.slice(0,80),reason});
      if(box.left<bounds.left-2||box.right>bounds.right+2)fail('outside the canvas');
      if(node.clientWidth>0&&node.scrollWidth>node.clientWidth+2)fail(`horizontal overflow ${node.scrollWidth}/${node.clientWidth}`);
      if(['hidden','clip'].includes(css.overflowX)||['hidden','clip'].includes(css.overflowY))fail('clipping rule');
      if(node.matches('a,button,summary')&&box.height<43.9)fail('control below 44px');
      if(node.hasAttribute('data-native-text-field')&&node.textContent.trim()) {
        const range=document.createRange();range.selectNodeContents(node);
        for(const rect of range.getClientRects())if(rect.left<box.left-2||rect.right>box.right+2)fail('text outside its box');
        if(node.scrollHeight>node.clientHeight+3)fail('vertical text overflow');
      }
      const parent=node.parentElement;
      if(parent.matches('.sq-native')) {
        const p=parent.getBoundingClientRect();
        if(box.left<p.left-2||box.right>p.right+2||box.top<p.top-2||box.bottom>p.bottom+2)fail('child outside its parent');
      }
    }
    // Browser HTML parsing must preserve all native parents (including button
    // children and details/summary) when persisted section HTML is reopened.
    const tree=EzkartAssets.create(id),expected=[];
    const visit=(node,parent)=>{expected.push([node.type,parent]);(node.children||[]).forEach(child=>visit(child,node.type));};visit(tree,null);
    const content=section?stage.firstElementChild.firstElementChild:stage.firstElementChild;
    const actual=[content,...content.querySelectorAll('.sq-native')].map(node=>[node.dataset.nativeType,node===content?null:node.parentElement.dataset.nativeType]);
    if(JSON.stringify(expected)!==JSON.stringify(actual))issues.push({reason:'native nesting changed during rendering'});
    return {id,width,section,height:bounds.height,nodes:configs.length,issues};
  },{id,width,section});
}

test('every installed design renders without overflow or clipping at desktop and narrow widths using native CSS',async t=>{
  const {page}=await fixture(t,{editor:false});
  const ids=await page.evaluate(()=>EzkartAssetPacks.map(item=>item.id)),metrics=[];
  for(const section of [false,true])for(const width of [1440,768,520,390,320]) {
    for(const id of ids)metrics.push(await render(page,id,width,section));
    t.diagnostic(`${ids.length} native ${section?'section':'element'} layouts at ${width}px`);
  }
  await record('layout-metrics.json',metrics);
  assert.deepEqual(metrics.filter(item=>item.issues.length),[]);
  for(const id of representatives)for(const width of [1440,390,320]) {
    await render(page,id,width,true);
    await shot(page,`${id}-${width}`,page.locator('#stage'));
  }
  // Every generated disclosure is exercised, not just the FAQ category.
  await page.setViewportSize({width:390,height:1100});
  const disclosures=[];
  for(const id of ids) {
    const total=await page.evaluate(id=>{const walk=n=>[n,...(n.children||[]).flatMap(walk)];return walk(EzkartAssets.create(id)).filter(n=>n.type==='accordion').length;},id);
    if(!total)continue;
    await render(page,id,390,true);
    for(let i=0;i<total;i++) {
      const summary=page.locator('#stage summary').nth(i);
      await summary.click();assert.equal(await summary.evaluate(n=>n.parentElement.open),false);
      await summary.focus();await page.keyboard.press('Enter');assert.equal(await summary.evaluate(n=>n.parentElement.open),true);
      disclosures.push({id,index:i,mouseClosed:true,keyboardOpened:true});
    }
  }
  await record('disclosures.json',disclosures);
});

test('catalogue thumbnails use native responsive CSS with shared styles and no stored config copies',async t=>{
  const {page,category}=await fixture(t,{inspectPreviews:true});
  for(const id of representatives) {
    const categoryId=await page.evaluate(id=>EzkartAssets.definitions.find(item=>item.id===id).category,id);
    await category(categoryId);
    const card=page.locator(`[data-sq-asset="${id}"]`);await card.scrollIntoViewIfNeeded();
    await page.waitForFunction(id=>packPreviewRoots.get(document.querySelector(`[data-sq-asset="${id}"] .sq-asset-preview > div`))?.querySelector('.sq-native'),id);
    const metrics=await card.evaluate(card=>{
      const host=card.querySelector('.sq-asset-preview').firstElementChild,shadow=packPreviewRoots.get(host);
      const root=shadow.querySelector('.sq-native'),config=EzkartAssets.create(card.dataset.sqAsset);
      const firstText=shadow.querySelector('[data-native-text-field]');
      return {width:host.offsetWidth,height:host.offsetHeight,stored:shadow.querySelectorAll('[data-sq-native],[data-sq-element]').length,inert:host.inert,padding:getComputedStyle(root).paddingLeft,expectedPadding:config.responsive?.filter(r=>r.max>=520).at(-1)?.props.paddingLeft||config.props.paddingLeft,textFont:firstText&&getComputedStyle(firstText).fontFamily,sourceFont:config.props.fontFamily};
    });
    assert.equal(metrics.width,520);assert.ok(metrics.height>0);assert.equal(metrics.stored,0);assert.equal(metrics.inert,true);
    if(metrics.expectedPadding)assert.equal(metrics.padding,metrics.expectedPadding,`${id} uses its 520px container query`);
    await shot(page,`thumbnail-${id}`,card);
  }
  const shared=await page.evaluate(()=>{const roots=[...document.querySelectorAll('.sq-asset-preview > div')].map(n=>packPreviewRoots.get(n)).filter(Boolean);return roots.length>1&&roots.every(root=>root.adoptedStyleSheets[0]===roots[0].adoptedStyleSheets[0]);});
  assert.equal(shared,true,'Preview base CSS is allocated once');
  assert.equal(await page.locator('.sq-page-preview').count(),1,'Preview canvases are isolated from editor selectors');
});

const referenceRecipe={id:'reference-pack',category:'buttons',name:'Reference isolation fixture',description:'Native reference validation fixture.',node:{id:'local-root',type:'container',initialState:'start',stateParam:'view',stateMode:'tabs',props:{display:'flex',flexDirection:'column',gap:'12px'},children:[
  {id:'toggle',type:'button',tag:'button',text:'Toggle local panel',action:{type:'toggle',target:'local-panel'}},
  {id:'local-panel',type:'container',anchor:'answer',collapsed:true,children:[{id:'local-copy',type:'text',text:'local-panel'}]},
  {id:'first-tab',type:'button',tag:'button',text:'First view',action:{type:'state',target:'start',scope:'local-root'}},
  {id:'second-tab',type:'button',tag:'button',text:'Second view',action:{type:'state',target:'local-panel'}},
  {id:'start-view',type:'text',text:'First panel',statePanel:'start',states:{start:{props:{display:'block'}},'local-panel':{props:{display:'none'}}}},
  {id:'next-view',type:'text',text:'Second panel',statePanel:'local-panel',stateScope:'local-root',states:{start:{props:{display:'none'}},'local-panel':{props:{display:'block'}}}},
  {id:'jump',type:'button',tag:'a',text:'Local anchor',action:{type:'link',target:'#answer',scope:'local-root',revealState:'local-panel'}},
  {id:'implicit-jump',type:'button',tag:'a',text:'Default anchor',action:{type:'link',target:'#native-local-root'}},
  {id:'external-jump',type:'button',tag:'a',text:'External anchor',action:{type:'link',target:'#outside'}},
  {id:'external-url',type:'button',tag:'a',text:'External URL',action:{type:'link',target:'https://example.com/#answer'}},
  {id:'quantity',type:'commerce',part:'quantity',productId:'pack-product',group:'shared-product'},
  {id:'price',type:'commerce',part:'price',productId:'pack-product',group:'shared-product'},
  {id:'scroll-info',type:'text',text:'Scroll marker',scrollVisibility:{after:'local-panel',hideWhile:['local-root','outside']}}
]}};

test('future packs append without a cap and remap forward targets, anchors, groups and states independently',async t=>{
  const {page,call,browser}=await fixture(t,{earlier:[referenceRecipe]});
  const {first,second,source}=await page.evaluate(()=>({first:EzkartAssets.create('reference-pack'),second:EzkartAssets.create('reference-pack'),source:EzkartAssetPacks[0]}));
  assert.deepEqual(source,referenceRecipe,'Installing this batch preserves earlier packs');
  const firstIds=walk(first).map(n=>n.id),secondIds=walk(second).map(n=>n.id);
  assert.equal(firstIds.some(id=>secondIds.includes(id)),false);
  for(const copy of [first,second]) {
    const [toggle,panel,tab1,tab2,start,next,jump,implicit,external,url,quantity,price,scroll]=copy.children;
    assert.equal(toggle.action.target,panel.id);assert.notEqual(panel.anchor,'answer');
    assert.equal(tab1.action.scope,copy.id);assert.equal(tab2.action.scope,copy.id);
    assert.equal(tab2.action.target,'local-panel','A state value matching a node ID is still a state value');
    assert.equal(start.stateScope,copy.id);assert.equal(next.stateScope,copy.id);
    assert.deepEqual(Object.keys(start.states),['start','local-panel']);assert.equal(next.statePanel,'local-panel');
    assert.equal(jump.action.target,'#'+panel.anchor);assert.equal(jump.action.scope,copy.id);assert.equal(jump.action.revealState,'local-panel');
    assert.equal(implicit.action.target,'#native-'+copy.id);assert.equal(external.action.target,'#outside');assert.equal(url.action.target,'https://example.com/#answer');
    assert.equal(quantity.group,price.group);assert.notEqual(quantity.group,'shared-product');assert.equal(quantity.productId,'pack-product');
    assert.equal(scroll.scrollVisibility.after,panel.id);assert.deepEqual(scroll.scrollVisibility.hideWhile,[copy.id,'outside']);
    assert.equal(panel.children[0].text,'local-panel','Ordinary text is never rewritten');
  }
  assert.notEqual(first.stateParam,second.stateParam);assert.notEqual(first.children[10].group,second.children[10].group);
  assert.equal(await page.evaluate(()=>EzkartAssets.definitions.filter(n=>n.category==='buttons').length)>=21,true);
  await page.evaluate(({first,second})=>{EzkartBuilder.nativeInsert({section:'blank',node:first});EzkartBuilder.nativeInsert({section:'blank',node:second});},{first,second});
  const preview=await browser.newPage({viewport:{width:390,height:1000}});
  await preview.setContent(await call('previewHtml'));
  const a=preview.locator(`[data-native-id="${first.id}"]`),b=preview.locator(`[data-native-id="${second.id}"]`);
  await a.getByText('Toggle local panel',{exact:true}).click();
  assert.equal(await a.locator(`[data-native-id="${first.children[1].id}"]`).evaluate(n=>n.hidden),false);
  assert.equal(await b.locator(`[data-native-id="${second.children[1].id}"]`).evaluate(n=>n.hidden),true);
  await a.getByRole('tab',{name:'Second view'}).click();
  assert.equal(await a.getAttribute('data-native-state'),'local-panel');assert.equal(await b.getAttribute('data-native-state'),'start');
  assert.equal(await a.getByText('Second panel',{exact:true}).isVisible(),true);assert.equal(await b.getByText('Second panel',{exact:true}).isVisible(),false);
  assert.equal(await a.getByRole('tab',{name:'Second view'}).getAttribute('aria-controls'),'native-'+first.children[5].id);
  const quantityA=a.locator('input'),quantityB=b.locator('input');
  await a.getByRole('button',{name:/increase/i}).click();
  assert.equal(await quantityA.inputValue(),'2');assert.equal(await quantityB.inputValue(),'1');
  await preview.close();
});

test('merchants focus collections, click and drag additions, edit nested copy, undo/redo and reopen independent copies',async t=>{
  const {page,call,category,browser}=await fixture(t);
  await category('text');
  assert.equal(await page.locator('[data-sq-asset]:visible').count()>=20,true);
  await page.locator('[data-sq-asset="text-chapter-opening"]').click();await call('settle');
  let nodes=await call('nativeInspect');const first=nodes.find(n=>n.name==='Chapter opening');assert.ok(first);
  const heading=nodes.find(n=>n.text==='A place to begin');
  const leaf=page.locator(`.sq-page-preview [data-native-id="${heading.id}"]`);
  await leaf.click();await page.locator('[data-native-text]').fill('A chapter edited by the merchant');await page.locator('[data-native-text]').press('Tab');
  assert.equal((await call('nativeInspect',{id:heading.id})).text,'A chapter edited by the merchant');
  await page.locator('[data-sq-undo]').click();assert.equal((await call('nativeInspect',{id:heading.id})).text,'A place to begin');
  await page.locator('[data-sq-redo]').click();assert.equal((await call('nativeInspect',{id:heading.id})).text,'A chapter edited by the merchant');
  await category('text');await page.locator('[data-sq-asset="text-chapter-opening"]').click();await call('settle');
  nodes=await call('nativeInspect');const copies=nodes.filter(n=>n.name==='Chapter opening');assert.equal(copies.length,2);assert.notEqual(copies[0].id,copies[1].id);
  assert.equal(nodes.filter(n=>n.text==='A place to begin').length,1,'Editing the first copy leaves the next insertion untouched');
  await category('accordions');
  const target=page.locator('.sq-page-preview > [data-section-id="blank"]');
  await target.scrollIntoViewIfNeeded();
  await page.locator('[data-sq-asset="accordions-split-intro"]').dragTo(target,{targetPosition:{x:420,y:220}});await call('settle');
  nodes=await call('nativeInspect');
  const faqName=await page.evaluate(()=>EzkartAssets.definitions.find(n=>n.id==='accordions-split-intro').name);
  const inserted=nodes.find(n=>n.name===faqName);assert.ok(inserted);assert.equal(inserted.parent,'blank');
  const afterDrop=nodes;
  await page.locator('[data-sq-undo]').click();assert.equal((await call('nativeInspect')).some(n=>n.id===inserted.id),false);
  await page.locator('[data-sq-redo]').click();assert.deepEqual(await call('nativeInspect'),afterDrop);
  await category('footers','sections');await page.locator('[data-sq-add-block="asset-section-footers-policy-rail"]').click();await call('settle');
  assert.equal(await page.locator('.sq-page-preview > [data-sq-block]').count(),2);
  await shot(page,'merchant-desktop');
  await page.setViewportSize({width:941,height:1000});await category('code');
  await page.locator('[data-sq-asset="code-source-gutter"]').click();await call('settle');
  assert.ok((await call('nativeInspect')).some(n=>n.name==='Source gutter'));
  await shot(page,'merchant-narrow');
  await page.waitForFunction(()=>document.querySelector('[data-sq-save-state]').textContent==='Saved just now');
  const saved=await call('nativeInspect');await page.reload();await page.waitForFunction(()=>globalThis.EzkartBuilder);await call('settle');
  assert.deepEqual(await call('nativeInspect'),saved);assert.equal(new Set(saved.map(n=>n.id)).size,saved.length);
  const html=await call('previewHtml');assert.ok(html.includes('A chapter edited by the merchant'));
  const preview=await browser.newPage({viewport:{width:390,height:1000}});await preview.setContent(html);
  const detail=preview.locator(`[data-native-id="${inserted.id}"] details`).first();
  const initial=await detail.evaluate(n=>n.open);await detail.locator('summary').click();assert.equal(await detail.evaluate(n=>n.open),!initial);
  await detail.locator('summary').focus();await preview.keyboard.press('Enter');assert.equal(await detail.evaluate(n=>n.open),initial);
  for(const width of [390,320]) {
    await preview.setViewportSize({width,height:1000});
    const overflow=await preview.locator('.sq-page-preview .sq-native').evaluateAll(nodes=>nodes.filter(n=>n.checkVisibility()&&n.clientWidth>0&&n.scrollWidth>n.clientWidth+2).map(n=>n.dataset.nativeId));
    assert.deepEqual(overflow,[],`Saved merchant page fits ${width}px`);
    await shot(preview,`merchant-output-${width}`);
  }
  await preview.close();
});
