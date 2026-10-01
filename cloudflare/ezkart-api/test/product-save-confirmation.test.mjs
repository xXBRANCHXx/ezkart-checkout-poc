import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setupCommerceFixture} from './commerce-fixture.mjs';

async function editable(f) {
  const imageUploadIds=[];
  for (let n=1;n<=3;n++) {
    const id='media_tea_'+n;imageUploadIds.push(id);
    await f.db.prepare("INSERT INTO media_uploads(id,seller_id,r2_key,mime_type,size_bytes,created_by_auth_user_id,created_at) VALUES (?,'seller_alice',?,'image/png',1,'alice','now')").bind(id,id).run();
  }
  return {...(await f.merchant('/v1/catalog')).products.find(product=>product.id==='tea'),imageUploadIds};
}
const publicView = async f => {
  const response=await f.mf.dispatchFetch('https://api.fixture.test/v1/storefront/view?product=tea');
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  return (await response.json()).products[0];
};

test('product receipts confirm exact repeated base and variant prices at the final transaction revision; public reads stay current',async t=>{
  const f=await setupCommerceFixture(t),original=await editable(f),path='/v1/products/tea',confirmation=path+'/confirmation';
  assert.equal((await f.merchant(confirmation)).status,404);
  const first=await f.merchant(path,{...original,price:31500,saveId:randomUUID()});
  assert.equal(first.status,200,first.error);assert.equal(first.product.price,31500);
  const receipt1=await f.merchant(confirmation);assert.equal(receipt1.status,200);
  assert.equal(receipt1.product.revision,first.product.revision);assert.equal(receipt1.product.price,31500);
  assert.equal((await publicView(f)).choices[0].price,31500);
  let current=first.product;
  for (const price of [42500,55000]) {
    const saveId=randomUUID();
    const second=await f.merchant(path,{...current,imageUploadIds:original.imageUploadIds,saveId,options:[{name:'Size',values:['Small','Large']}],variants:[
      {id:'tea-small',name:'Small',sku:'TEA-SMALL',price,stock:4,weightGrams:100,options:[{option:'Size',value:'Small'}]},
      {id:'tea-large',name:'Large',sku:'TEA-LARGE',price:price+1000,stock:6,weightGrams:100,options:[{option:'Size',value:'Large'}]},
    ]});
    assert.equal(second.status,200,second.error);current=second.product;
    const receipt=await f.merchant(confirmation);assert.equal(receipt.status,200,receipt.error);
    assert.equal(receipt.saveId,saveId);assert.equal(receipt.product.price,price);
    assert.equal(receipt.product.revision,current.revision);
    const stored=await f.db.prepare("SELECT payload_json FROM seller_events WHERE json_extract(payload_json,'$.saveId')=?").bind(saveId).first();
    assert.equal(JSON.parse(stored.payload_json).savedRevision,current.revision,'Receipt includes revision advances from every variant write');
    assert.deepEqual((await publicView(f)).choices.map(choice=>choice.price),[price,price+1000]);
  }
  const token=await f.merchantToken();
  assert.equal((await f.mf.dispatchFetch('https://api.fixture.test'+confirmation)).status,401);
  assert.equal((await f.merchant(confirmation,undefined,{seller:'bob'})).status,404);
  assert.equal((await f.merchant(confirmation,{}, {method:'PUT'})).status,404,'Confirmation is read-only');
  const response=await f.mf.dispatchFetch('https://api.fixture.test'+confirmation,{headers:{authorization:'Bearer '+token}});
  assert.equal(response.headers.get('cache-control'),'no-store');
  // A sale or later edit invalidates the old receipt; it cannot authorize stock replay.
  await f.db.prepare("UPDATE products SET stock_quantity=9 WHERE id='tea'").run();
  assert.equal((await f.merchant(confirmation)).status,404);
  const stale=await f.merchant(path,{...current,imageUploadIds:original.imageUploadIds,price:99999,saveId:randomUUID()});
  assert.equal(stale.status,409);assert.equal(stale.code,'catalog_revision_conflict');
  assert.equal((await publicView(f)).choices[0].price,55000);
});

test('invalid or rolled-back product writes never create a successful save receipt',async t=>{
  const f=await setupCommerceFixture(t),original=await editable(f),path='/v1/products/tea',confirmation=path+'/confirmation';
  for (const saveId of [null,{},'old-save','x'.repeat(100)]) assert.equal((await f.merchant(path,{...original,price:42500,saveId})).status,422);
  const saveId=randomUUID();
  const conflict=await f.merchant(path,{...original,price:42500,sku:'SKU-mug',saveId});
  assert.equal(conflict.status,409,conflict.error);
  assert.equal((await f.merchant(confirmation)).status,404);
  assert.equal((await f.db.prepare("SELECT COUNT(*) n FROM seller_events WHERE json_extract(payload_json,'$.saveId')=?").bind(saveId).first()).n,0,'A failed transaction rolls back its receipt');
  assert.equal((await publicView(f)).choices[0].price,20000);
  const legacy=await f.merchant(path,{...original,price:31500});assert.equal(legacy.status,200,legacy.error);
  assert.equal(legacy.product.price,31500,'Existing clients can save without a receipt ID');
});
