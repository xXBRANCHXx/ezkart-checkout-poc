import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {setupCentralFixture} from './central-fixture.mjs';
import {browser,pageFor} from './review-workspace-fixture.mjs';
import {refundEvidenceFixture} from '../../cloudflare/ezkart-api/test/refund-evidence-fixture.mjs';

test('buyer and merchant refund review shows original delivery and inspection evidence with working return links at both widths',async t=>{
  const buyer='fixture-google-customer',f=await refundEvidenceFixture(await setupCentralFixture(t),{buyer}),b=await browser(t),directory='/tmp/ezkart-refund-evidence-ui-01a0d643';await mkdir(directory,{recursive:true});
  const merchantCookie=f.app.adminCookie({supabase_access_token:await f.merchantToken('alice','alice@example.test'),admin_user:{id:'alice',email:'alice@example.test'}}),buyerCookie=f.app.customerCookie('checkout@example.com',buyer,3600,await f.merchantToken(buyer,'checkout@example.com'));
  const grant=await f.grant();await f.part(grant,1);await f.deliver();const returned=await f.openReturn();await f.returnAction(returned,'approve');await f.returnAction(returned,'inspect',{confirmed:true,privateNote:'Private warehouse bin 77',items:[{orderItemId:f.tea.id,received:1,restocked:0}]});
  const count=async table=>(await f.db.prepare('SELECT COUNT(*) AS n FROM '+table).first()).n,before={refunds:await count('commerce_refunds'),actions:await count('commerce_refund_actions'),journal:await count('commerce_financial_entries')};
  for(const width of [1360,390])for(const merchant of [true,false]){
    const p=await pageFor(b,f,width,merchant?merchantCookie:buyerCookie),errors=[];p.on('pageerror',e=>errors.push(e.message));
    await p.goto(f.app.base+(merchant?'/cart/admin/?page=refunds&refund='+f.refund.id:'/cart/return.php?order='+f.order.id+'&refund='+f.refund.id));
    const evidence=p.locator('[data-refund-evidence]');await evidence.getByRole('heading',{name:'Purchase and delivery',exact:true}).waitFor();
    await evidence.getByText(/Original payment:.*confirmed/).waitFor();await evidence.getByText(/Verified complete download/).waitFor();await evidence.getByText('A complete download has not been verified.',{exact:true}).waitFor();await evidence.getByText(/Courier delivery recorded/).waitFor();
    await evidence.getByText('tea: 1 of 2 return units received and inspected.',{exact:true}).waitFor();await evidence.getByText('A received return does not confirm that a refund was paid.',{exact:true}).waitFor();
    assert(!await evidence.textContent().then(text=>text.includes('Private warehouse')));assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await evidence.screenshot({path:directory+'/'+(merchant?'merchant':'buyer')+'-'+width+'.png'});
    if(merchant){await evidence.getByRole('link',{name:'View return',exact:true}).click();await p.locator('[data-return-detail]').getByText('Inspect these original units.',{exact:true}).waitFor();assert.equal(new URL(p.url()).searchParams.get('return'),returned);}
    assert.deepEqual(errors,[]);await p.context().close();
  }
  assert.deepEqual({refunds:await count('commerce_refunds'),actions:await count('commerce_refund_actions'),journal:await count('commerce_financial_entries')},before);assert.equal((await f.providerCalls()).length,0);
});
