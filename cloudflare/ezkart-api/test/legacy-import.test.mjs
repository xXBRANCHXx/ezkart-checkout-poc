import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,stat,rm,chmod,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {setupCommerceFixture} from './commerce-fixture.mjs';
import {buildLegacyPlan,legacyImportStatement,legacyImportSql,sha256,strictJson,stableJson,sourceFromPlan} from '../../../tools/commerce/legacy-order-audit.mjs';
import {main,registrySql} from '../../../tools/commerce/legacy-import.mjs';

const scope = sha256('test|alice').slice(0,24);
const registry = () => ({deployment:'test',environment:'sandbox',sellers:[{id:'seller_alice'},{id:'seller_bob'}],
  memberships:[{seller_id:'seller_alice',auth_user_id:'alice',role:'owner',created_at:'now'}],
  products:[{id:'tea',seller_id:'seller_alice',sku:'SKU-tea'}],variants:[]});
function order(n,extra={}) {
  return {order_id:'EZK-S-'+String(n).padStart(24,'0'),commerce_environment:'sandbox',seller_id:'seller_alice',shop:scope,
    status:'PENDING',subtotal:40000,shipping_price:0,total:40000,items:[{id:'SKU-tea',name:"Thé d'Indonésie",price:20000,quantity:2}],
    customer:{name:'Fixture Buyer',email:'buyer@example.test',phone:'081234567890',address:'Fixture only'},customer_auth_user_id:'buyer_fixture',
    payment_provider:'doku',payment_request_id:'original-request-'+n,payment_reference:'',payment_expires_at:'2026-09-25T04:00:00+00:00',
    shipping_skipped:true,paid_at:'',created_at:'2026-09-25T02:00:00+00:00',updated_at:'2026-09-25T02:00:01+00:00',...extra};
}
function source(orders) {
  return {format:'ezkart-private-legacy-source-v1',deployment:'test',environment:'sandbox',sourceDirectory:'fixture-orders',
    entries:orders.map(o=>({filename:sha256(o.order_id)+'.json',source:JSON.stringify(o,null,2)+'\n'}))};
}
async function fixture(t) {
  const f=await setupCommerceFixture(t);
  const sql=(await readFile(new URL('../migrations/0017_legacy_order_import.sql',import.meta.url),'utf8')).replace(/--[^\n]*/g,'');
  const triggers=[...sql.matchAll(/CREATE TRIGGER[\s\S]*?END;/g)].map(m=>m[0]);
  for(const statement of [...sql.replace(/CREATE TRIGGER[\s\S]*?END;/g,'').split(';').filter(s=>s.trim()),...triggers])await f.db.prepare(statement).run();
  f.stage=async plan=>{const s=legacyImportStatement(plan);return f.db.prepare(s.sql).bind(...s.params).run();};
  f.count=async table=>(await f.db.prepare('SELECT COUNT(*) AS n FROM '+table).first()).n;
  return f;
}

test('audit preserves exact historical bytes and separates stored, inferred, demo and unresolved ownership',()=>{
  const original=source([order(1),order(2,{seller_id:undefined}),order(3,{seller_id:undefined,shop:'ezkart-demo',status:'PAID',paid_at:'2026-09-25T02:00:01+00:00',
    payment_reference:'reported-paid-reference',payment_notification_verified:true,items:[{id:'EZK-DEMO-GRANOLA',name:'Demo',price:20000,quantity:2}]}),order(4,{seller_id:undefined,shop:'unknown-shop'})]);
  const plan=buildLegacyPlan(original,registry()),entries=plan.manifest.records;
  assert.deepEqual(entries.map(e=>e.assessment.basis),['stored_seller','historical_shop','sandbox_demo','unresolved']);
  assert.equal(entries[1].assessment.evidence.anchorSourceHash,entries[0].sourceHash);
  assert.equal(entries[2].assessment.sellerId,''); assert.equal(entries[3].assessment.sellerId,'');
  assert.ok(entries[2].assessment.issues.includes('historical_payment_requires_reconciliation'));
  assert.equal(plan.manifest.summary.paidTotal,40000); assert.equal(plan.manifest.summary.total,160000);
  assert.equal(plan.manifest.summary.customerAccountsRecorded,4);
  for(const entry of entries)assert.equal(entry.source,original.entries.find(e=>e.filename===entry.filename).source);
  assert.equal(buildLegacyPlan({...original,exportedAt:'a later export',entries:[...original.entries].reverse()},registry()).hash,plan.hash);
  assert.equal(buildLegacyPlan(sourceFromPlan(plan),registry()).hash,plan.hash);
});

test('audit rejects lost amounts, duplicate JSON keys/references, wrong filenames/environments and malformed dates',()=>{
  for(const extra of [{total:40001},{subtotal:40001,total:40001},{total:'40000'},{total:1e30},
    {items:[{id:'SKU-tea',name:'Tea',price:20000,quantity:1.5}]}, {commerce_environment:'production'},
    {created_at:'2026-09-25'}, {created_at:'2026-02-30T00:00:00Z'}, {updated_at:'2026-09-24T00:00:00Z'},
    {items:[{id:'SKU-tea',name:'Tea',price:20000,quantity:2},{id:'EZK-SHIPPING',name:'Delivery',price:1,quantity:1}]}]) {
    assert.throws(()=>buildLegacyPlan(source([order(1,extra)]),registry()));
  }
  assert.throws(()=>strictJson('{"total":1,"to\\u0074al":2}'),/duplicate/);
  assert.throws(()=>strictJson('{"customer":{"email":"first","email":"second"}}'),/duplicate/);
  assert.deepEqual(strictJson('{"x":[{"escaped\\\"key":"a\\\\b"},-12.4e+2,null,true]}'),JSON.parse('{"x":[{"escaped\\\"key":"a\\\\b"},-12.4e+2,null,true]}'));
  const wrong=source([order(1)]);wrong.entries[0].filename='a'.repeat(64)+'.json';assert.throws(()=>buildLegacyPlan(wrong,registry()),/Filename/);
  assert.throws(()=>buildLegacyPlan(source([order(1),order(1)]),registry()),/Duplicate order/);
  for(const field of ['payment_reference','payment_request_id','midtrans_transaction_id'])assert.throws(()=>buildLegacyPlan(source([order(1,{[field]:'same'}),order(2,{[field]:'same'})]),registry()),/Duplicate provider/);
  const opaque=buildLegacyPlan(source([order(1,{payment_expires_at:'20260925110000'})]),registry());
  assert.ok(opaque.manifest.records[0].assessment.issues.includes('payment_expiry_timezone_unrecorded'));
  assert.equal(JSON.parse(opaque.manifest.records[0].source).payment_expires_at,'20260925110000');
  const large=buildLegacyPlan(source([order(1,{historical_extra:"'".repeat(55000)})]),registry());
  assert.throws(()=>legacyImportSql(large),/100 KB/);
});

test('ownerless history needs an original seller anchor, unchanged owner scope and unambiguous product evidence',()=>{
  const ownerless=order(2,{seller_id:undefined});
  assert.equal(buildLegacyPlan(source([ownerless]),registry()).manifest.summary.unresolvedOrders,1);
  const ambiguous=registry();ambiguous.products.push({id:'other',seller_id:'seller_alice',sku:'SKU-tea'});
  assert.equal(buildLegacyPlan(source([order(1),ownerless]),ambiguous).manifest.summary.unresolvedOrders,1);
  const otherSeller=registry();otherSeller.products.push({id:'other',seller_id:'seller_bob',sku:'SKU-tea'});
  assert.equal(buildLegacyPlan(source([order(1),ownerless]),otherSeller).manifest.summary.unresolvedOrders,1);
  const changed=registry();changed.memberships[0].auth_user_id='new_owner';
  assert.equal(buildLegacyPlan(source([order(1),ownerless]),changed).manifest.summary.unresolvedOrders,1);
  const missing=registry();missing.products=[];
  const result=buildLegacyPlan(source([order(1),ownerless]),missing);
  assert.equal(result.manifest.summary.sellerOrders,1);assert.equal(result.manifest.summary.unresolvedOrders,1);
  assert.ok(result.manifest.records[0].assessment.issues.includes('historical_product_unlinked'));
  const gone=order(3,{product_snapshots:{'SKU-tea':{product_id:'deleted_product'}}});
  assert.equal(buildLegacyPlan(source([gone]),registry()).manifest.records[0].assessment.itemLinks[0].basis,'missing');
  const contradictory=source([order(1),order(3,{seller_id:'seller_bob'}),ownerless]);
  assert.equal(buildLegacyPlan(contradictory,registry()).manifest.summary.unresolvedOrders,1);
});

test('D1 staging is atomic, concurrent replay-safe, byte-preserving and creates no operational or financial effects',async t=>{
  const f=await fixture(t),raw=source([order(1),order(2,{seller_id:undefined}),order(3,{seller_id:undefined,shop:'ezkart-demo',status:'PAID',paid_at:'2026-09-25T02:00:01Z',payment_reference:'paid-only-in-source',items:[{id:'EZK-DEMO-COFFEE',name:'Demo',price:40000,quantity:1}]})]);
  const plan=buildLegacyPlan(raw,registry()),before=JSON.parse((await f.db.prepare(registrySql).first()).registry);
  const results=await Promise.all([f.stage(plan),f.stage(plan),f.stage(plan)]);
  assert.ok(results.every(r=>r.success));assert.equal(await f.count('commerce_legacy_import_batches'),1);assert.equal(await f.count('commerce_legacy_sources'),3);assert.equal(await f.count('commerce_legacy_import_entries'),3);
  const after=JSON.parse((await f.db.prepare(registrySql).first()).registry);assert.deepEqual(after,before);
  for(const table of ['orders','order_items','customers','commerce_payment_captures','inventory_reservations','commerce_jobs','commerce_shipments'])assert.equal(await f.count(table),0,table);
  const sources=await f.db.prepare('SELECT source_json,source_hash FROM commerce_legacy_sources ORDER BY order_id').all();
  sources.results.forEach((r,i)=>{assert.equal(r.source_json,raw.entries[i].source);assert.equal(r.source_hash,sha256(raw.entries[i].source));});
  for(const table of ['commerce_legacy_import_batches','commerce_legacy_sources','commerce_legacy_import_entries']) {
    await assert.rejects(f.db.prepare('DELETE FROM '+table).run(),/legacy_immutable/);
  }
  await assert.rejects(f.db.prepare("UPDATE commerce_legacy_sources SET source_json='{}'").run(),/legacy_immutable/);
  // A lost-response replay stays valid after a later catalog/owner change.
  await f.db.prepare("UPDATE products SET sku='NEW-SKU' WHERE id='tea'").run();
  await f.db.prepare("UPDATE seller_memberships SET role='viewer' WHERE auth_user_id='alice'").run();
  await f.stage(plan);assert.equal(await f.count('commerce_legacy_import_batches'),1);
});

test('D1 refuses changed ownership/catalog and rolls back every imported record in the batch',async t=>{
  const f=await fixture(t),plan=buildLegacyPlan(source([order(1),order(2,{seller_id:undefined})]),registry());
  await f.db.prepare("UPDATE products SET sku='NEW-SKU' WHERE id='tea'").run();
  await assert.rejects(f.stage(plan),/legacy_product_changed/);
  assert.equal(await f.count('commerce_legacy_import_batches'),0);assert.equal(await f.count('commerce_legacy_sources'),0);assert.equal(await f.count('commerce_legacy_import_entries'),0);
  await f.db.prepare("UPDATE products SET sku='SKU-tea' WHERE id='tea'").run();
  await f.db.prepare("UPDATE seller_memberships SET role='viewer' WHERE auth_user_id='alice'").run();
  await assert.rejects(f.stage(plan),/legacy_owner_changed/);
  assert.equal(await f.count('commerce_legacy_sources'),0);
});

test('source revisions remain separate and SQL file import preserves quotes, Unicode and original customer fields',async t=>{
  const f=await fixture(t),original=source([order(1),order(2,{seller_id:undefined})]);
  const first=buildLegacyPlan(original,registry());
  await f.db.prepare(legacyImportSql(first)).run();
  const second=buildLegacyPlan(source([order(1),order(2,{seller_id:undefined,status:'PAID',payment_reference:'later-notification',paid_at:'2026-09-25T02:00:02Z',updated_at:'2026-09-25T02:00:02Z'})]),registry());
  await f.stage(second);
  assert.equal(await f.count('commerce_legacy_import_batches'),2);assert.equal(await f.count('commerce_legacy_sources'),3);assert.equal(await f.count('commerce_legacy_import_entries'),4);
  assert.equal(await f.count('commerce_payment_captures'),0);assert.equal(await f.stock(),10);
  const before=await f.db.prepare('SELECT source_json FROM commerce_legacy_sources WHERE id=?').bind(first.manifest.records[0].sourceId).first();
  assert.equal(before.source_json,original.entries[0].source);
  const corrupt=structuredClone(second);corrupt.manifest.records[0].assessment.total++;
  corrupt.hash=sha256(stableJson(corrupt.manifest));corrupt.id='legacy_'+corrupt.hash;
  await assert.rejects(f.stage(corrupt),/legacy_invalid_source/);
  assert.equal(await f.count('commerce_legacy_import_batches'),2);
});

test('a new earlier owner or competing SKU cannot race the recorded historical ownership proof',async t=>{
  const f=await fixture(t),plan=buildLegacyPlan(source([order(1),order(2,{seller_id:undefined})]),registry());
  await f.db.prepare("INSERT INTO seller_memberships(seller_id,auth_user_id,role,created_at) VALUES ('seller_alice','bob','owner','earlier')").run();
  await assert.rejects(f.stage(plan),/legacy_owner_changed/);assert.equal(await f.count('commerce_legacy_sources'),0);
  await f.db.prepare("DELETE FROM seller_memberships WHERE seller_id='seller_alice' AND auth_user_id='bob'").run();
  await f.db.prepare("UPDATE products SET sku='SKU-tea' WHERE id='private'").run();
  await assert.rejects(f.stage(plan),/legacy_product_changed/);assert.equal(await f.count('commerce_legacy_sources'),0);
  await f.db.prepare("UPDATE products SET sku='SKU-private' WHERE id='private'").run();
  await f.db.prepare("INSERT INTO product_variants(id,seller_id,product_id,name,sku,price_amount,stock_quantity,weight_grams,sort_order,created_at,updated_at) VALUES ('competing','seller_alice','mug','Other product','SKU-tea',20000,10,100,1,'now','now')").run();
  await assert.rejects(f.stage(plan),/legacy_product_changed/);assert.equal(await f.count('commerce_legacy_sources'),0);
});

test('receipts reject orphan sources, altered assessments, false totals and cross-batch provider reuse',async t=>{
  const f=await fixture(t),first=buildLegacyPlan(source([order(1,{payment_reference:'original-provider-reference'})]),registry());
  const record=first.manifest.records[0];
  await assert.rejects(f.db.prepare('INSERT INTO commerce_legacy_sources(id,commerce_environment,order_id,source_hash,filename,source_json,created_at) VALUES (?,?,?,?,?,?,?)')
    .bind(record.sourceId,'sandbox',record.assessment.orderId,record.sourceHash,record.filename,record.source,'now').run(),/legacy_source_without_receipt/);
  await f.stage(first);
  const other=buildLegacyPlan(source([order(2,{payment_reference:'original-provider-reference'})]),registry());
  await assert.rejects(f.stage(other),/legacy_provider_reference_conflict/);
  assert.equal(await f.count('commerce_legacy_import_batches'),1);assert.equal(await f.count('commerce_legacy_sources'),1);
  await assert.rejects(f.db.prepare('INSERT INTO commerce_legacy_import_entries(batch_id,source_id,seller_id,disposition,ownership_basis,assessment_json) VALUES (?,?,?,?,?,?)')
    .bind(first.id,record.sourceId,'seller_bob','seller','stored_seller',stableJson(record.assessment)).run(),/legacy_assessment_without_receipt/);
  const corrupt=buildLegacyPlan(source([order(3)]),registry());corrupt.manifest.summary.paidTotal++;
  corrupt.hash=sha256(stableJson(corrupt.manifest));corrupt.id='legacy_'+corrupt.hash;
  await assert.rejects(f.stage(corrupt),/legacy_summary_mismatch/);
  assert.equal(await f.count('commerce_legacy_import_batches'),1);
});

test('offline CLI produces reviewable private artifacts, rejects public inputs, overwrites and production options',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'ezkart-legacy-cli-test-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const sourcePath=join(directory,'source.json'),registryPath=join(directory,'registry.json'),out=join(directory,'plan');
  await writeFile(sourcePath,JSON.stringify(source([order(1)])),{mode:0o600});await writeFile(registryPath,JSON.stringify(registry()),{mode:0o600});
  const args=['plan','--source',sourcePath,'--registry',registryPath,'--output',out];
  const result=await main(args);assert.equal(result.staged,false);
  assert.equal((await stat(out)).mode&0o777,0o700);
  for(const file of ['manifest.json','import.sql','report.json'])assert.equal((await stat(join(out,file))).mode&0o777,0o600);
  const saved=JSON.parse(await readFile(join(out,'manifest.json'),'utf8'));assert.equal(saved.hash,result.hash);
  await assert.rejects(main(args),/EEXIST/);
  await assert.rejects(main([...args,'--environment','production']),/Unknown option/);
  await writeFile(join(directory,'public.json'),'{}');await chmod(join(directory,'public.json'),0o644);
  await assert.rejects(main(['plan','--source',join(directory,'public.json'),'--registry',registryPath,'--output',join(directory,'bad')]),/Input must be a private/);
  await symlink(sourcePath,join(directory,'link.json'));
  await assert.rejects(main(['plan','--source',join(directory,'link.json'),'--registry',registryPath,'--output',join(directory,'bad')]),/Input must be a private/);
  await writeFile(join(directory,'invalid-utf8.json'),Buffer.from([0xff,0xfe]),{mode:0o600});
  await assert.rejects(main(['plan','--source',join(directory,'invalid-utf8.json'),'--registry',registryPath,'--output',join(directory,'bad')]),/valid UTF-8/);
});

test('CLI recovers a committed import after a lost response, verifies exact receipts and never resubmits during recovery',async t=>{
  const f=await fixture(t),plan=buildLegacyPlan(source([order(1),order(2,{seller_id:undefined})]),registry());
  const directory=await mkdtemp(join(tmpdir(),'ezkart-legacy-recovery-test-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const path=join(directory,'plan.json');await writeFile(path,stableJson(plan),{mode:0o600});
  const args=['stage','--plan',path,'--expect',plan.hash];let writes=0;
  const lost=async(sql,file)=>{
    if(file){writes++;await f.db.prepare(await readFile(file,'utf8')).run();throw Error('Connection closed after commit');}
    return (await f.db.prepare(sql).all()).results;
  };
  const receipt=await main(args,lost);
  assert.equal(receipt.verified,true);assert.equal(receipt.unconfirmedWriteRecovered,true);assert.equal(receipt.commerceAndInventoryUnchanged,true);assert.equal(writes,1);
  const replay=await main(args,lost);assert.equal(replay.replayed,true);assert.equal(writes,1);
  const other=buildLegacyPlan(source([order(3)]),registry()),otherPath=join(directory,'other.json');await writeFile(otherPath,stableJson(other),{mode:0o600});
  await assert.rejects(main(['stage','--plan',otherPath,'--expect',other.hash],async(sql,file)=>{
    if(file){writes++;throw Error('Connection failed before commit');}
    return (await f.db.prepare(sql).all()).results;
  }),/no confirmed receipt/);
  assert.equal(writes,2);assert.equal(await f.count('commerce_legacy_import_batches'),1);
  const altered=async(sql,file)=>{
    const rows=await lost(sql,file);
    if(sql.startsWith('SELECT s.id'))return rows.map((r,i)=>i? r : {...r,source_json:r.source_json+' '});
    return rows;
  };
  await assert.rejects(main(['verify','--plan',path,'--expect',plan.hash],altered),/source bytes/);
  assert.equal(writes,2);
});
