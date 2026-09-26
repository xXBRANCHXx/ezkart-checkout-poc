import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {browser} from './review-workspace-fixture.mjs';
import {campaignEmailPayload} from '../../cloudflare/ezkart-api/src/campaign-email-template.js';
import {campaignEmailConfiguration} from '../../cloudflare/ezkart-api/src/email-provider.js';
import {campaignMailConfiguration,campaignMailSource,campaignMailId,campaignMailLink} from '../../cloudflare/ezkart-api/test/campaign-email-fixture.mjs';

test('actual campaign email renders on desktop and mobile without scripts, remote resources or clipping, with keyboard-accessible owned links',async t=>{
  const b=await browser(t),context=await b.newContext({javaScriptEnabled:false}),page=await context.newPage(),requests=[];
  page.on('request',r=>requests.push(r.url()));const source=campaignMailSource(),screens='/tmp/ezkart-campaign-mail-ui-01a0d643';await mkdir(screens,{recursive:true});
  for(const width of [1360,390]){
    await page.setViewportSize({width,height:900});
    const mail=JSON.parse(campaignEmailPayload(campaignEmailConfiguration(campaignMailConfiguration()),source,'alice@example.test',campaignMailId,campaignMailLink));
    await page.setContent(mail.html);assert.equal(await page.locator('h1').textContent(),source.values.heading);assert.equal(await page.locator('script,img,iframe,form').count(),0);
    assert.equal(await page.getByRole('link',{name:source.values.buttonLabel,exact:true}).getAttribute('href'),'https://test.ezkart.id/shop/?store=seller_alice');
    const unsubscribe=page.getByRole('link',{name:'Stop promotional emails from '+source.storeName,exact:true});assert.equal(await unsubscribe.getAttribute('href'),campaignMailLink);
    await page.keyboard.press('Tab');assert.equal(await page.locator(':focus').textContent(),source.values.buttonLabel);await page.keyboard.press('Tab');assert.equal(await page.locator(':focus').getAttribute('href'),campaignMailLink);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:screens+'/campaign-'+width+'.png',fullPage:true});
    if(width===390)await writeFile(screens+'/campaign.html',mail.html);
  }
  source.values.heading='<script>alert(1)</script>';source.storeName='<img src=x onerror=alert(1)> & Tea';source.values.body='🍵'.repeat(3000);source.values.buttonLabel='Store'.repeat(12);
  await page.setContent(JSON.parse(campaignEmailPayload(campaignEmailConfiguration(campaignMailConfiguration()),source,'alice@example.test',campaignMailId,campaignMailLink)).html);
  assert.equal(await page.locator('h1').textContent(),source.values.heading);assert.equal(await page.locator('img,script').count(),0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(requests,[]);
  source.values.buttonLabel='';source.shopEnabled=false;await page.setContent(JSON.parse(campaignEmailPayload(campaignEmailConfiguration(campaignMailConfiguration()),source,'alice@example.test',campaignMailId,campaignMailLink)).html);
  assert.equal(await page.getByRole('link').count(),1);assert.equal(await page.getByRole('link').getAttribute('href'),campaignMailLink);await context.close();
});
