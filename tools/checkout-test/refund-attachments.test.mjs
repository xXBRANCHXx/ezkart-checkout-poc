import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {setupCentralFixture} from './central-fixture.mjs';
import {browser,pageFor} from './review-workspace-fixture.mjs';
import {refundEvidenceFixture} from '../../cloudflare/ezkart-api/test/refund-evidence-fixture.mjs';

const buyer='fixture-google-customer',png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8x8AAAAASUVORK5CYII=','base64');
async function fixture(t){
  const f=await refundEvidenceFixture(await setupCentralFixture(t),{buyer}),b=await browser(t);
  const merchantCookie=f.app.adminCookie({supabase_access_token:await f.merchantToken('alice','alice@example.test'),admin_user:{id:'alice',email:'alice@example.test'}});
  const buyerCookie=f.app.customerCookie('checkout@example.com',buyer,3600,await f.merchantToken(buyer,'checkout@example.com'));
  const open=async(merchant,width=390)=>{const p=await pageFor(b,f,width,merchant?merchantCookie:buyerCookie);p.on('dialog',dialog=>void dialog.accept());
    await p.goto(f.app.base+(merchant?'/cart/admin/?page=refunds&refund='+f.refund.id:'/cart/return.php?order='+f.order.id+'&refund='+f.refund.id));
    await p.getByRole('heading',{name:'Supporting files',exact:true}).waitFor();return p;};
  const input=(caption='Original photo')=>({filename:'Bukti café.png',caption,dataUrl:'data:image/png;base64,'+png.toString('base64')});
  const upload=async(caption)=>{const result=await f.merchant(f.path+'/'+f.refund.id+'/evidence',input(caption),{seller:buyer,method:'POST'});assert.equal(result.status,200,result.error);return result.refund;};
  return {...f,b,open,input,upload,buyerCookie,merchantCookie};
}

test('both refund screens upload and download exact originals, recover lost replies and fit desktop/mobile',async t=>{
  const f=await fixture(t),directory='/tmp/ezkart-refund-attachments-ui-01a0d643';await mkdir(directory,{recursive:true});
  const pdf=Buffer.alloc(5242880,32);pdf.write('%PDF-1.7\n');pdf.write('\n%%EOF',pdf.length-6);
  for(const width of [1360,390])for(const merchant of [false,true]){
    const p=await f.open(merchant,width),errors=[];p.on('pageerror',e=>errors.push(e.message));
    const original=width===390&&!merchant?{name:'Inspection.pdf',mimeType:'application/pdf',buffer:pdf}:{name:'Bukti café.png',mimeType:'image/png',buffer:png};
    const caption=(merchant?'Store':'Buyer')+' '+width+' original <img src=x onerror=alert(1)>',form=p.locator('[data-refund-file-form]');
    await form.getByLabel('Evidence file',{exact:true}).setInputFiles(original);await form.getByLabel('File description (optional)',{exact:true}).fill(caption);
    const target=(merchant?'/v1/commerce/refunds':f.path)+'/'+f.refund.id+'/evidence';f.control.drop=target;
    await form.getByRole('button',{name:'Add or retry evidence',exact:true}).click();await p.locator('[data-refund-error]').getByText(/confirmation was interrupted/).waitFor();
    const first=f.control.calls.filter(c=>c.path===target&&c.body).at(-1).body;await p.reload();await p.locator('[data-refund-attachments]').getByText(caption,{exact:true}).waitFor();
    const next=p.locator('[data-refund-file-form]');await next.getByLabel('Evidence file',{exact:true}).setInputFiles(original);await next.getByLabel('File description (optional)',{exact:true}).fill(caption);await next.getByRole('button',{name:'Add or retry evidence',exact:true}).click();
    await p.getByText('The original evidence file was saved.',{exact:true}).waitFor();assert.deepEqual(f.control.calls.filter(c=>c.path===target&&c.body).at(-1).body,first);
    const row=p.locator('[data-refund-attachments] article').filter({hasText:caption});assert.equal(await row.count(),1);
    const download=p.waitForEvent('download');await row.getByRole('button',{name:'Download original: '+original.name,exact:true}).click();const file=await download;
    assert.equal(file.suggestedFilename(),original.name);assert.deepEqual(await readFile(await file.path()),original.buffer);
    assert.equal(await p.locator('img[onerror]').count(),0);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await p.locator('[data-refund-attachments]').screenshot({path:directory+'/'+(merchant?'merchant':'buyer')+'-'+width+'.png'});assert.deepEqual(errors,[]);await p.context().close();
  }
  assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM commerce_refund_attachments').first()).n,4);assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM commerce_refund_actions').first()).n,0);assert.equal((await f.providerCalls()).length,0);
});

test('a decision cannot skip evidence added after the merchant opened the case',async t=>{
  const f=await fixture(t),p=await f.open(true),detail=p.locator('[data-refund-detail]');
  await f.upload('New original buyer evidence');await detail.getByLabel('Message for the buyer',{exact:true}).fill('Reviewing the originally loaded request.');await detail.getByRole('button',{name:'Approve request',exact:true}).click();
  await p.getByText('The supporting files changed. Reload and review them before deciding.',{exact:true}).waitFor();assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM commerce_refund_actions').first()).n,0);
  await p.getByRole('button',{name:'Review changes',exact:true}).click();await detail.getByText('New original buyer evidence',{exact:true}).waitFor();
  await detail.getByLabel('Message for the buyer',{exact:true}).fill('The new supporting file has been reviewed.');await detail.getByRole('button',{name:'Approve request',exact:true}).click();await p.getByText('Your refund request was saved.',{exact:true}).waitFor();
  assert.equal((await f.db.prepare('SELECT evidence_version FROM commerce_refund_actions').first()).evidence_version,2);assert.equal((await f.view()).paymentConfirmed,false);
});

test('private file responses are withheld when buyer or merchant authentication changes during the download',async t=>{
  const f=await fixture(t);await f.upload('Private original');
  for(const merchant of [false,true]){
    const p=await f.open(merchant),file=(await f.view()).attachments[0],target=(merchant?'/v1/commerce/refunds':f.path)+'/'+f.refund.id+'/evidence/'+file.id;
    f.control.afterResponse=async path=>{if(path!==target)return;f.control.afterResponse=null;
      if(merchant)f.app.cli(`define('EZ_CUSTOMER_SESSION_BRIDGE',true); session_id('${f.merchantCookie.value}'); require '${process.cwd()}/cart/admin/index.php'; $_SESSION['admin_user']=['id'=>'bob','email'=>'bob@example.test']; $_SESSION['csrf_token']='changed'; session_write_close();`);
      else f.app.cli(`require '${process.cwd()}/cart/api/customer-auth.php'; session_id('${f.buyerCookie.value}'); ez_customer_session(); $_SESSION['customer_auth']['version']='changed'; session_write_close();`);
    };
    let downloads=0;p.on('download',()=>downloads++);await p.getByRole('button',{name:'Download original: '+file.filename,exact:true}).click();await p.getByRole('button',{name:'Reload sign-in',exact:true}).waitFor();
    assert.equal(downloads,0);assert.equal(await p.locator('[data-refund-detail]').isVisible(),false);await p.context().close();
  }
  assert.equal((await fetch(f.app.base+'/cart/api/refund-media.php')).status,404);
});
