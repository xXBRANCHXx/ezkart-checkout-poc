import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { repoRoot } from '../workspace.mjs';

test('Settings store logo upload, replacement, removal and failure recovery update only admin avatars', async t => {
  const browser=await chromium.launch();
  t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:941,height:1024}});
  page.setDefaultTimeout(6000);
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const partial=(await readFile(join(repoRoot,'cart/admin/profile-logo.php'),'utf8')).replace(/<\?=[\s\S]*?\?>/g,'BV');
  const index=await readFile(join(repoRoot,'cart/admin/index.php'),'utf8');
  const header=index.match(/<header class="topbar">[\s\S]*?<\/header>/)[0]
    .replace(/<\?= ez_admin_icon\('([^']+)'(?:, '([^']+)')?\) \?>/g,(_,name,extra)=>'<svg class="icon '+(extra||'')+'"><use href="#icon-'+name+'"></use></svg>')
    .replace(/<\?=[\s\S]*?\?>/g,'BV');
  const icons=(index.match(/<symbol\b[\s\S]*?<\/symbol>/g)||[]).join('');
  const files=Object.fromEntries(await Promise.all(['admin.css','admin-ui.css','profile-logo.css','profile-logo.js'].map(async name=>[name,await readFile(join(repoRoot,'cart/admin',name),'utf8')])));
  let profile={logoId:'',canEdit:true}, failSave=false,failLoad=false,serial=0;
  const uploads=new Map(),writes=[];
  await page.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.searchParams.get('cloud');
    if(path) {
      if(request.method()!=='GET') {
        assert.equal(request.headers()['x-ezkart-csrf'],'fixture-csrf');
        writes.push({path,body:request.postDataJSON()});
      }
      if(path==='/v1/admin-profile') {
        if(failLoad && request.method()==='GET')return route.fulfill({status:503,json:{ok:false,error:'Logo service unavailable. Try again.'}});
        if(request.method()==='PUT') {
          if(failSave)return route.fulfill({status:503,json:{ok:false,error:'Could not save the logo. Try again.'}});
          profile={...profile,logoId:request.postDataJSON().logoId};
        }
        return route.fulfill({json:{ok:true,profile}});
      }
      if(path==='/v1/media') {
        const id='media_'+(++serial);
        uploads.set(id,request.postDataJSON().dataUrl);
        return route.fulfill({status:201,json:{ok:true,media:{id}}});
      }
      if(path.startsWith('/v1/media/')) {
        const data=uploads.get(path.split('/').at(-1));
        return route.fulfill(data?{contentType:'image/png',body:Buffer.from(data.split(',')[1],'base64')}:{status:404});
      }
      throw Error('Unexpected API route '+path);
    }
    const name=url.pathname.split('/').at(-1);
    if(files[name])return route.fulfill({contentType:name.endsWith('.css')?'text/css':'text/javascript',body:files[name]});
    if(url.pathname.includes('/assets/'))return route.fulfill({status:404});
    const settings=url.searchParams.get('page')==='settings';
    return route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="admin.css"><link rel="stylesheet" href="admin-ui.css"><link rel="stylesheet" href="profile-logo.css"></head><body class="dashboard-page page-settings" data-admin-cloud-enabled="true" data-admin-csrf-token="fixture-csrf"><svg style="display:none">${icons}</svg>${header}<main class="page-canvas admin-page page-settings"><header class="page-heading"><div><h1>Settings</h1><p>Manage your store, notifications, and security.</p></div></header>${settings?'<section class="surface settings-section"><header class="surface-header"><div><h2>Store profile</h2><p>Identity shown across the admin workspace.</p></div></header>'+partial+'</section>':''}<img id="landing-logo" alt="Separate landing-page logo" src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs="></main><script src="profile-logo.js"></script></body></html>`});
  });
  await page.goto('http://profile.test/cart/admin/?page=settings');
  const input=page.locator('[data-profile-logo-upload]'),status=page.locator('[data-profile-logo-status]');
  await page.waitForFunction(()=>!document.querySelector('[data-profile-logo-upload]').disabled);
  assert.equal(await page.locator('#account-menu [data-admin-profile-fallback]').isVisible(),true);
  const landingSource=await page.locator('#landing-logo').getAttribute('src');
  const image=await page.evaluate(()=>{
    const canvas=document.createElement('canvas');canvas.width=180;canvas.height=80;
    const context=canvas.getContext('2d');context.fillStyle='#233e32';context.fillRect(0,0,180,80);
    context.fillStyle='#fff';context.font='bold 52px sans-serif';context.textAlign='center';context.fillText('BV',90,59);
    return canvas.toDataURL('image/png');
  });
  const file={name:'store-logo.png',mimeType:'image/png',buffer:Buffer.from(image.split(',')[1],'base64')};
  await input.setInputFiles(file);
  await page.waitForFunction(()=>document.querySelector('[data-profile-logo-status]').textContent==='Store logo saved.');
  assert.equal(profile.logoId,'media_1');
  await page.locator('#account-menu [data-admin-profile-image]').waitFor({state:'visible'});
  assert.equal(await page.locator('#account-menu [data-admin-profile-fallback]').isVisible(),false);
  assert.equal(await page.locator('[data-profile-logo-upload-label]').innerText(),'Replace logo');
  await page.locator('[data-profile-logo-editor] [data-admin-profile-image]').waitFor({state:'visible'});
  const shape=await page.evaluate(async src=>{
    const img=new Image();img.src=src;await img.decode();
    const canvas=document.createElement('canvas');canvas.width=canvas.height=512;
    const context=canvas.getContext('2d');context.drawImage(img,0,0);
    return [img.naturalWidth,img.naturalHeight,context.getImageData(0,0,1,1).data[3],context.getImageData(256,256,1,1).data[3]];
  },uploads.get('media_1'));
  assert.deepEqual(shape,[512,512,0,255],'Uploaded logo uses a padded square without stretching');
  for(const width of [1600,941,390]) {
    await page.setViewportSize({width,height:1024});
    const bounds=await page.locator('[data-profile-logo-editor]').boundingBox();
    assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width);
    assert.equal(await page.locator('[data-admin-profile-image]:visible').count(),width===390?1:2, String(width));
    if(width===941)await page.screenshot({path:'/tmp/ezkart-store-logo-settings.png'});
    if(width===390)await page.screenshot({path:'/tmp/ezkart-store-logo-mobile.png'});
  }
  await page.setViewportSize({width:941,height:1024});
  await page.goto('http://profile.test/cart/admin/?page=dashboard');
  await page.locator('#account-menu [data-admin-profile-image]').waitFor({state:'visible'});
  await page.locator('#account-menu').click();
  await input.waitFor({state:'visible'});
  await page.waitForFunction(()=>!document.querySelector('[data-profile-logo-upload]').disabled);
  assert.equal(profile.logoId,'media_1','Navigation retains the server-saved logo');

  const writesBeforeInvalid=writes.length;
  await input.setInputFiles({name:'invalid.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg/>')});
  await page.waitForFunction(()=>document.querySelector('[data-profile-logo-status]').dataset.error==='true');
  assert.match(await status.innerText(),/Choose a PNG/);
  assert.equal(writes.length,writesBeforeInvalid);
  await input.setInputFiles({name:'broken.png',mimeType:'image/png',buffer:Buffer.from('not an image')});
  await page.waitForFunction(()=>document.querySelector('[data-profile-logo-status]').textContent.includes('could not be opened'));
  assert.equal(writes.length,writesBeforeInvalid);
  failSave=true;
  await input.setInputFiles(file);
  await page.waitForFunction(()=>document.querySelector('[data-profile-logo-status]').textContent.includes('Could not save'));
  assert.equal(profile.logoId,'media_1');
  assert.match(await page.locator('#account-menu [data-admin-profile-image]').getAttribute('src'),/media_1/);
  failSave=false;
  await input.setInputFiles(file);
  await page.waitForFunction(()=>document.querySelector('[data-profile-logo-status]').textContent==='Store logo saved.');
  assert.equal(profile.logoId,'media_3');
  assert.equal(await page.locator('#landing-logo').getAttribute('src'),landingSource);

  failLoad=true;
  await page.reload();
  await page.locator('[data-profile-logo-retry]').waitFor({state:'visible'});
  assert.equal(await input.isDisabled(),true);
  failLoad=false;
  await page.locator('[data-profile-logo-retry]').click();
  await page.waitForFunction(()=>!document.querySelector('[data-profile-logo-upload]').disabled);
  await page.locator('[data-profile-logo-remove]').click();
  await page.waitForFunction(()=>document.querySelector('[data-profile-logo-status]').textContent.includes('Logo removed'));
  assert.equal(profile.logoId,'');
  assert.equal(await page.locator('#account-menu [data-admin-profile-fallback]').isVisible(),true);
  await page.reload();
  await page.waitForFunction(()=>!document.querySelector('[data-profile-logo-upload]').disabled);
  assert.equal(await page.locator('#account-menu [data-admin-profile-fallback]').isVisible(),true);
  assert.equal(await page.locator('[data-profile-logo-remove]').isVisible(),false);
  assert.ok(writes.every(write=>['/v1/media','/v1/admin-profile'].includes(write.path)),'No landing page or storefront branding is written');
  assert.deepEqual(errors,[]);
});
