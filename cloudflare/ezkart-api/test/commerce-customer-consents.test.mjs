import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {setupCommerceFixture} from './commerce-fixture.mjs';
import {customerConsents} from '../src/commerce-customer-consents.js';

const path='/internal/commerce/customer-consents',buyer={id:'verified-buyer',email:'buyer@example.test'},key=()=>randomBytes(16).toString('hex');
const input=(action,fields={},customer=buyer)=>({environment:'sandbox',customer,action,...fields});
const wording=(name='alice',email=buyer.email)=>`I agree to receive promotional emails from ${name} at ${email}. I can stop these emails in Email preferences at any time. This choice does not affect order and delivery updates.`;
const choice=(revision=0,allow=true,fields={})=>input('save',{sellerId:'seller_alice',email:buyer.email,revision,allow,requestKey:key(),policyVersion:'email-promotions-v1',statement:wording(),...fields});
async function fixture(t,guest=false){
  const f=await setupCommerceFixture(t);await f.db.prepare("UPDATE products SET stock_quantity=1000 WHERE id='tea'").run();
  const made=await f.create(f.input({customer:{name:'Buyer',email:buyer.email,phone:'081234567890',...(!guest?{authUserId:buyer.id}:{})}}));assert.equal(made.status,200,made.error);
  return {...f,order:made.order,consent:data=>f.call(path,data)};
}

test('only a signed verified buyer can claim guest orders and set store/email-specific consent',async t=>{
  const f=await fixture(t,true),empty=await f.consent(input('list'));assert.deepEqual(empty.items,[]);
  assert.equal((await f.merchant(path,choice(),{method:'POST'})).status,401);
  assert.equal((await f.consent(input('list',{orderId:f.order.id},{id:'intruder',email:'other@example.test'}))).status,404);
  const list=await f.consent(input('list',{orderId:f.order.id}));assert.equal(list.status,200,list.error);assert.equal(list.items[0].state,'not_recorded');assert.equal(list.items[0].canGrant,true);
  const saved=await f.consent(choice());assert.equal(saved.status,200,saved.error);assert.equal(saved.preference.state,'granted');assert.equal(saved.preference.email,buyer.email);
  assert.equal((await f.consent(input('list',{orderId:f.order.id},{id:'same-email-other-account',email:buyer.email}))).status,404);
  const changedEmail=await f.consent(input('list',{orderId:f.order.id},{...buyer,email:'new@example.test'}));assert.equal(changedEmail.status,200,changedEmail.error);
  assert.equal(changedEmail.items.find(x=>x.email===buyer.email).state,'granted');
  assert.equal((await f.consent({...choice(),customer:{id:'same-email-other-account',email:buyer.email}})).status,404);
  assert.equal((await f.consent(choice(0,true,{sellerId:'seller_bob'}))).status,404);
  assert.equal((await f.consent(choice(0,true,{email:'recipient@example.test'}))).status,403);
  assert.equal((await f.consent({...choice(),environment:'production'})).status,403);
  for(const patch of [{actor:'alice'},{channel:'whatsapp'},{allow:'true'},{revision:-1},{policyVersion:'invented'},{requestKey:'x'}])assert.equal((await f.consent({...choice(1),...patch})).status,422);
  assert.equal((await f.consent({...input('list'),customer:{...buyer,role:'owner'}})).status,422);
  assert.equal((await f.call(path+'?seller=other',input('list'))).status,422);
});

test('replays never restore withdrawn permission and concurrent/stale changes preserve exactly one revision',async t=>{
  const f=await fixture(t),grant=choice(),first=await f.consent(grant);assert.equal(first.status,200,first.error);
  const replay=await f.consent(grant);assert.equal(replay.receipt.replayed,true);
  assert.equal((await f.consent({...grant,allow:false})).status,409);
  const races=await Promise.all([f.consent(choice(1,false)),f.consent(choice(1,false))]);assert.deepEqual(races.map(r=>r.status).sort(),[200,409]);
  const oldReply=await f.consent(grant);assert.equal(oldReply.receipt.state,'granted');assert.equal(oldReply.preference.state,'withdrawn');assert.equal(oldReply.preference.revision,2);
  const concurrent=choice(2,true),both=await Promise.all([f.consent(concurrent),f.consent(concurrent)]);assert(both.every(r=>r.status===200),JSON.stringify(both));
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM commerce_customer_consent_changes').first()).n,3);
  await assert.rejects(f.db.prepare('UPDATE commerce_customer_consents SET allowed=0').run(),/consent_receipt_required/);
  await assert.rejects(f.db.prepare('DELETE FROM commerce_customer_consents').run(),/consent_receipt_required/);
  await assert.rejects(f.db.prepare("UPDATE commerce_customer_consent_changes SET statement='changed'").run(),/consent_history_immutable/);
  await assert.rejects(f.db.prepare('DELETE FROM commerce_customer_consent_changes').run(),/consent_history_immutable/);
});

test('previous email permissions can be withdrawn after an account email change but cannot be granted again',async t=>{
  const f=await fixture(t);assert.equal((await f.consent(choice())).status,200);
  const newer={...buyer,email:'new@example.test'},list=await f.consent(input('list',{},newer));assert.equal(list.items.length,2);
  assert.equal(list.items.find(x=>x.email===buyer.email).canGrant,false);assert.equal(list.items.find(x=>x.email===newer.email).state,'not_recorded');
  const withdrawal={...choice(1,false),customer:newer};assert.equal((await f.consent(withdrawal)).status,200);
  assert.equal((await f.consent({...choice(2,true),customer:newer})).status,403);
  assert.equal((await f.consent({...choice(0,true,{email:newer.email,statement:wording('alice',newer.email)}),customer:newer})).status,200);
  const other={id:'unrelated-account',email:buyer.email};assert.equal((await f.consent(input('history',{sellerId:'seller_alice',email:buyer.email},other))).status,404);
  const states=(await f.consent(input('list',{},newer))).items;assert.equal(states.find(x=>x.email===buyer.email).state,'withdrawn');assert.equal(states.find(x=>x.email===newer.email).state,'granted');
});

test('paginated consent history retains the original statement and stable revision boundary',async t=>{
  const f=await fixture(t);for(let n=0;n<44;n++)assert.equal((await f.consent(choice(n,n%2===0))).status,200);
  const query=input('history',{sellerId:'seller_alice',email:buyer.email}),first=await f.consent(query);assert.equal(first.items.length,20);
  await f.db.prepare("UPDATE sellers SET name='Renamed store' WHERE id='seller_alice'").run();assert.equal((await f.consent(choice(44,true))).status,409);
  assert.equal((await f.consent(choice(44,true,{statement:wording('Renamed store')}))).status,200);
  const items=[...first.items];let cursor=first.nextCursor;while(cursor){const next=await f.consent({...query,cursor});assert.equal(next.status,200,next.error);items.push(...next.items);cursor=next.nextCursor;}
  assert.deepEqual(items.map(r=>r.revision),Array.from({length:44},(_,i)=>44-i));assert(items.every(r=>r.statement.includes('alice')&&!r.statement.includes('Renamed')));
  assert.equal((await f.consent({...query,cursor:first.nextCursor,customer:{...buyer,email:'changed@example.test'}})).status,200,'History stays accessible after email changes');
  assert.equal((await f.consent({...query,cursor:'garbage'})).status,422);
  assert(!JSON.stringify(items).match(/auth_user_id|request_key|request_hash/));
});

test('inactive stores cannot receive grants and durable buyer ownership is rechecked inside the write',async t=>{
  const f=await fixture(t);assert.equal((await f.consent(choice())).status,200);
  await f.db.prepare("UPDATE sellers SET status='suspended' WHERE id='seller_alice'").run();
  assert.equal((await f.consent(input('list'))).items[0].canGrant,false);assert.equal((await f.consent(choice(1,true))).status,409);
  assert.equal((await f.consent(choice(1,false))).status,200);
  await f.db.prepare("UPDATE sellers SET status='active' WHERE id='seller_alice'").run();
  const db={prepare(sql){const prepared=f.db.prepare(sql);return {bind(...values){const bound=prepared.bind(...values);if(sql.startsWith('INSERT INTO commerce_customer_consent_changes'))return {async run(){await f.db.prepare("UPDATE sellers SET status='suspended' WHERE id='seller_alice'").run();return bound.run();}};return bound;}};}};
  await assert.rejects(customerConsents({DB:db,APP_ENVIRONMENT:'test'},choice(2,true)),error=>error.status===409);
  assert.equal((await f.consent(input('list'))).items[0].state,'withdrawn');
});

test('merchant readouts and immutable CSV use the matching order owner and address, never customer master consent',async t=>{
  const f=await fixture(t),base='/v1/commerce/customers';let list=await f.merchant(base),id=list.items[0].id;
  await f.db.prepare("UPDATE customers SET consent_json=?,auth_user_id='other-identity' WHERE id=?").bind(JSON.stringify({email:true}),id).run();
  assert.equal((await f.merchant(base+'/'+id)).customer.marketingConsent,'not_recorded');
  await f.consent(choice());assert.equal((await f.merchant(base+'/'+id)).customer.marketingConsent,'granted');
  const create=await f.merchant(base+'/exports',{requestKey:key(),filters:{},cohort:list.cohort},{method:'POST'});assert.equal(create.status,200,create.error);
  await f.consent(choice(1,false));assert.equal((await f.merchant(base+'/'+id)).customer.marketingConsent,'withdrawn');
  const rows=await f.merchant(base+'/exports/'+create.export.id);assert.equal(rows.rows[0].cells.at(-1),'Email allowed','An export remains a historical snapshot');
  const latest=await f.create(f.input({customer:{name:'Another buyer',email:buyer.email,phone:'081234567890',authUserId:'other-identity'}}));assert.equal(latest.status,200,latest.error);
  assert.equal((await f.merchant(base+'/'+id)).customer.marketingConsent,'not_recorded');
  const out=JSON.stringify(await f.merchant(base+'/'+id));assert(!out.includes('verified-buyer'));assert(!out.includes('other-identity'));
});

test('buyer store list pages through every owned store and rejects a cursor from another account',async t=>{
  const f=await fixture(t);
  for(let n=0;n<28;n++){
    const seller='seller_store'+String(n).padStart(2,'0');await f.db.prepare("INSERT INTO sellers(id,slug,name,created_at,updated_at) VALUES(?,?,?,'now','now')").bind(seller,'store'+n,'Store '+n).run();await f.product('product'+n,10,seller);
    const made=await f.create(f.input({sellerId:seller,customer:{name:'Buyer',email:buyer.email,phone:'081234567890',authUserId:buyer.id},items:[{productId:'product'+n,quantity:1,expectedPrice:20000,expectedWeightGrams:100}]}));assert.equal(made.status,200,made.error);
  }
  const a=await f.consent(input('list'));assert.equal(a.items.length,25);const b=await f.consent(input('list',{cursor:a.nextCursor}));assert.equal(b.items.length,4);assert.equal(b.nextCursor,null);assert.equal(new Set([...a.items,...b.items].map(x=>x.sellerId)).size,29);
  assert.equal((await f.consent(input('list',{cursor:a.nextCursor},{id:'another-buyer',email:buyer.email}))).status,422);
  assert.equal((await f.consent(input('list',{cursor:a.nextCursor},{...buyer,email:'changed@example.test'}))).status,422);
});
