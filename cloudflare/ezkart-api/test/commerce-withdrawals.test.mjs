import test from 'node:test';
import assert from 'node:assert/strict';
import {setupEarningsFixture,key} from './earnings-fixture.mjs';
import {applyCommerceSchema} from './commerce-schema.mjs';
import {setupCommerceFixture} from './commerce-fixture.mjs';

const path='/internal/commerce/finance/withdrawals';
const actor=()=>({id:'alice',email:'alice@example.test',proofExpiresAt:new Date(Date.now()+550000).toISOString()});
const scope=(f,extra={})=>({environment:f.environment,seller:'seller_alice',actor:actor(),...extra});
const request=(f,extra={})=>({...scope(f),requestKey:key(),amount:'250000',bank:{code:'CENAIDJA',accountNumber:'001234567890',channel:'BI_FAST'},...extra});
const count=async(f,table)=>(await f.db.prepare('SELECT COUNT(*) AS n FROM '+table).first()).n;
async function funded(t,options={}){
  const f=await setupEarningsFixture(t,options);await f.product('withdrawal',10,'seller_alice',400000);
  const p=await f.payment({items:[{productId:'withdrawal',quantity:2,expectedPrice:400000,expectedWeightGrams:100}]});
  await f.settle(p);await f.deliver(p);return {...f,p};
}
const cancel=(f,id,requestKey=key())=>f.call(path+'/'+id+'/cancel',scope(f,{requestKey}));
const detail=(f,id,extra={})=>f.call(path+'/'+id+'/read',scope(f,extra));

test('a withdrawal reserves original delivered and settled earnings, freezes bank details, and cancels with balanced journals',async t=>{
  const f=await funded(t),before=await f.earnings(),input=request(f),r=await f.call(path,input);
  assert.equal(r.status,200,r.error);assert.equal(r.providerCalls,0);assert.equal(r.withdrawal.state,'reserved');assert.equal(r.withdrawal.bank.accountSuffix,'7890');
  assert.equal(r.withdrawal.bankVerified,false);assert.equal(r.withdrawal.payoutConfirmed,false);
  assert(!JSON.stringify(r).includes(input.bank.accountNumber));
  const stored=await f.db.prepare('SELECT * FROM commerce_withdrawals WHERE id=?').bind(r.withdrawal.id).first();
  assert.equal(stored.bank_account,input.bank.accountNumber);assert.equal(stored.partner_reference,'EZK-PAYOUT-S-'+r.withdrawal.id.slice(3));
  assert.equal(JSON.parse(stored.funds_json).eligibleAmount,before.availableEarnings);
  const after=await f.earnings();assert.equal(after.availableEarnings,String(BigInt(before.availableEarnings)-250000n));assert.equal(after.reservedWithdrawals,'250000');
  let summary=await f.summary();assert.equal(summary.accounts.seller_withdrawal_reserved,'-250000');assert.equal(summary.balanced,true);
  assert.equal(summary.accounts.provider_cash_seller,String(BigInt(before.availableEarnings)));
  const cancelled=await cancel(f,r.withdrawal.id);assert.equal(cancelled.status,200,cancelled.error);assert.equal(cancelled.withdrawal.state,'cancelled');
  assert.equal((await f.earnings()).availableEarnings,before.availableEarnings);assert.equal((await f.earnings()).reservedWithdrawals,'0');
  summary=await f.summary();assert.equal(summary.accounts.seller_withdrawal_reserved,'0');assert.equal(summary.balanced,true);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM commerce_jobs WHERE kind LIKE '%withdraw%' OR kind LIKE '%payout%'").first()).n,0);
});

test('concurrent distinct withdrawals cannot spend the same earnings and exact lost-acknowledgement retries do not reserve twice',async t=>{
  const f=await funded(t),inputs=[request(f,{amount:'500000'}),request(f,{amount:'500000'})];
  const results=await Promise.all(inputs.map(x=>f.call(path,x)));assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  assert.equal(await count(f,'commerce_withdrawals'),1);assert.equal((await f.earnings()).reservedWithdrawals,'500000');
  const index=results.findIndex(r=>r.status===200),saved=results[index].withdrawal;
  const retries=await Promise.all([f.call(path,inputs[index]),f.call(path,inputs[index])]);
  assert(retries.every(r=>r.status===200&&r.replayed&&r.withdrawal.id===saved.id));
  for(const changed of [{amount:'250000'},{bank:{...inputs[index].bank,accountNumber:'001234567891'}},{bank:{...inputs[index].bank,channel:'ONLINE'}}])
    assert.equal((await f.call(path,{...inputs[index],...changed})).status,409);
  const cancellationKey=key(),cancels=await Promise.all([cancel(f,saved.id,cancellationKey),cancel(f,saved.id,cancellationKey)]);
  assert(cancels.every(r=>r.status===200));assert.equal(await count(f,'commerce_withdrawal_cancellations'),1);
  assert.equal((await f.call(path,inputs[index])).withdrawal.state,'cancelled');assert.equal((await f.earnings()).reservedWithdrawals,'0');
  assert.equal((await f.journals()).items.filter(j=>j.kind==='withdrawal_reserve').length,1);
  assert.equal((await f.journals()).items.filter(j=>j.kind==='withdrawal_cancel').length,1);
});

test('simultaneous identical requests produce one reservation and one exact journal',async t=>{
  const f=await funded(t),input=request(f),r=await Promise.all(Array.from({length:4},()=>f.call(path,input)));
  assert(r.every(x=>x.status===200));assert.equal(new Set(r.map(x=>x.withdrawal.id)).size,1);
  assert.equal(await count(f,'commerce_withdrawals'),1);assert.equal((await f.earnings()).reservedWithdrawals,'250000');assert.equal((await f.summary()).balanced,true);
});

test('lookup by the original request key recovers owner-protected bank details without another reservation',async t=>{
  const f=await funded(t),input=request(f),saved=await f.call(path,input);assert.equal(saved.status,200,saved.error);
  const lookup=extra=>f.call(path+'/lookup',scope(f,{requestKey:input.requestKey,...extra})),before=await f.summary();
  const found=await lookup();assert.equal(found.status,200,found.error);assert.equal(found.withdrawal.id,saved.withdrawal.id);
  assert.equal(found.withdrawal.bank.accountNumber,input.bank.accountNumber);assert.equal(found.originalOwner,true);
  assert.equal((await lookup({requestKey:key()})).status,404);
  assert.equal((await lookup({seller:'seller_bob',actor:{...actor(),id:'bob'}})).status,404);
  assert.equal((await lookup({environment:'production'})).status,403);
  assert.equal((await lookup({actor:{...actor(),proofExpiresAt:new Date(Date.now()-1000).toISOString()}})).status,401);
  assert.equal((await lookup({requestKey:'bad'})).status,422);assert.equal((await lookup({amount:'250000'})).status,422);
  assert.equal((await f.merchant(path+'/lookup',scope(f,{requestKey:input.requestKey}),{method:'POST'})).status,401);
  assert.deepEqual(await f.summary(),before);assert.equal(await count(f,'commerce_withdrawals'),1);
  await cancel(f,saved.withdrawal.id);assert.equal((await lookup()).withdrawal.state,'cancelled');
});

test('refund holds and newer provider evidence cannot be bypassed by reservations or cancellation',async t=>{
  const f=await funded(t),r=await f.call(path,request(f));assert.equal(r.status,200,r.error);
  const refund=await f.refund(f.p);let current=await detail(f,r.withdrawal.id);
  assert.equal(current.funds.reservableEarnings,'0');assert.equal(current.funds.reservationShortfall,'250000');
  assert.equal((await f.call(path,request(f))).status,409);assert((await f.earnings()).holds.includes('withdrawal_reservation_shortfall'));
  assert.equal((await cancel(f,r.withdrawal.id)).status,200);assert.equal((await f.earnings()).availableEarnings,'0');
  await f.refundAction(refund.id,'decline');assert.equal((await f.earnings()).availableEarnings,'756250');
  await f.collect(f.p,f.legs(f.p)); // New original provider observations invalidate the previous settlement immediately.
  assert.equal((await f.position(f.p)).reconciled,false);assert.equal((await f.call(path,request(f))).status,409);
  assert.equal(await count(f,'commerce_withdrawals'),1);assert.equal((await f.summary()).balanced,true);
});

test('a correction below already reserved earnings exposes the shortfall without releasing the reservation or creating bank delivery',async t=>{
  const f=await funded(t),r=await f.call(path,request(f,{amount:'750000'}));assert.equal(r.status,200,r.error);
  await f.settle(f.p,{fee:20000});const current=await detail(f,r.withdrawal.id);
  assert.equal(current.funds.reservationShortfall,'11250');assert.equal(current.withdrawal.state,'reserved');assert.equal(current.withdrawal.payoutConfirmed,false);
  assert.equal((await f.call(path,request(f))).status,409);assert.equal((await f.earnings()).withdrawalReservationShortfall,'11250');
  assert.equal((await cancel(f,r.withdrawal.id)).status,200);assert.equal((await f.earnings()).availableEarnings,'738750');assert.equal((await f.summary()).balanced,true);
});

test('negative allocations reduce reservable earnings and settlement without complete delivery is unavailable',async t=>{
  const f=await setupEarningsFixture(t);await f.product('close',10,'seller_alice',266158);
  const p=await f.payment({items:[{productId:'close',quantity:1,expectedPrice:266158,expectedWeightGrams:100}]});await f.settle(p,{fee:500});
  assert.equal((await f.call(path,request(f))).status,409);await f.deliver(p);assert.equal((await f.earnings()).availableEarnings,'251100');
  await f.product('tiny',10,'seller_alice',1000);await f.payment({items:[{productId:'tiny',quantity:4,expectedPrice:1000,expectedWeightGrams:100}]});
  // One small positive pending capture is not spendable, regardless of its gross payment.
  assert.equal((await f.earnings()).availableEarnings,'251100');
  for(let i=0;i<4;i++)await f.payment({items:[{productId:'tiny',quantity:1,expectedPrice:1000,expectedWeightGrams:100}]});
  assert.equal((await f.earnings()).negativeAllocations,'1200');assert.equal((await f.earnings()).availableEarnings,'249900');
  assert.equal((await f.call(path,request(f))).status,409);assert.equal(await count(f,'commerce_withdrawals'),0);
});

test('failed reservation and cancellation postings roll back every source and recover with the same original request',async t=>{
  const f=await funded(t),input=request(f),before=await f.earnings();
  await f.db.prepare("CREATE TRIGGER fixture_fail_withdrawal BEFORE INSERT ON commerce_financial_entries WHEN NEW.account='seller_withdrawal_reserved' BEGIN SELECT RAISE(ABORT,'fixture_withdrawal_failure'); END").run();
  assert.equal((await f.call(path,input)).status,500);assert.equal(await count(f,'commerce_withdrawals'),0);assert.equal((await f.earnings()).availableEarnings,before.availableEarnings);
  await f.db.prepare('DROP TRIGGER fixture_fail_withdrawal').run();const saved=await f.call(path,input);assert.equal(saved.status,200,saved.error);
  await f.db.prepare("CREATE TRIGGER fixture_fail_withdrawal BEFORE INSERT ON commerce_financial_entries WHEN NEW.account='seller_available' AND NEW.amount<0 BEGIN SELECT RAISE(ABORT,'fixture_withdrawal_failure'); END").run();
  const cancellationKey=key();assert.equal((await cancel(f,saved.withdrawal.id,cancellationKey)).status,500);assert.equal(await count(f,'commerce_withdrawal_cancellations'),0);assert.equal((await f.earnings()).reservedWithdrawals,'250000');
  await f.db.prepare('DROP TRIGGER fixture_fail_withdrawal').run();assert.equal((await cancel(f,saved.withdrawal.id,cancellationKey)).status,200);assert.equal((await f.earnings()).availableEarnings,before.availableEarnings);
  assert.equal((await f.summary()).balanced,true);
});

test('owner, recent verification, store/environment isolation and immutable SQL source guards cover every reservation action',async t=>{
  const f=await funded(t),input=request(f),r=await f.call(path,input);assert.equal(r.status,200,r.error);
  assert.equal((await detail(f,r.withdrawal.id,{seller:'seller_bob',actor:{...actor(),id:'bob'}})).status,404);
  assert.equal((await detail(f,r.withdrawal.id,{environment:'production'})).status,403);
  for(const proofExpiresAt of [new Date(Date.now()-1).toISOString(),new Date(Date.now()+700000).toISOString(),'tomorrow']){
    const bad={...actor(),proofExpiresAt};assert.equal((await detail(f,r.withdrawal.id,{actor:bad})).status,401);
    assert.equal((await f.call(path,request(f,{actor:bad}))).status,401);
    assert.equal((await f.call(path+'/'+r.withdrawal.id+'/cancel',scope(f,{actor:bad,requestKey:key()}))).status,401);
  }
  for(const sql of ["UPDATE commerce_withdrawals SET amount=300000",'DELETE FROM commerce_withdrawals','INSERT OR REPLACE INTO commerce_withdrawals SELECT * FROM commerce_withdrawals'])await assert.rejects(f.db.prepare(sql).run(),/withdrawal_immutable/);
  await f.db.prepare("UPDATE seller_memberships SET role='viewer' WHERE seller_id='seller_alice'").run();
  assert.equal((await detail(f,r.withdrawal.id)).status,403);assert.equal((await cancel(f,r.withdrawal.id)).status,403);
  await assert.rejects(f.db.prepare("INSERT INTO commerce_withdrawal_cancellations VALUES(?,?,'alice',?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))").bind(r.withdrawal.id,key(),actor().proofExpiresAt).run(),/withdrawal_owner_changed/);
  await f.db.prepare("INSERT INTO app_users(id,auth_user_id,created_at,updated_at) VALUES ('new_owner','new_owner','now','now')").run();
  await f.db.prepare("UPDATE seller_memberships SET role='owner',auth_user_id='new_owner' WHERE seller_id='seller_alice'").run();
  const newOwner={...actor(),id:'new_owner'};assert.equal((await detail(f,r.withdrawal.id,{actor:newOwner})).status,200);
  assert.equal((await f.call(path,{...input,actor:newOwner})).status,409);
  const cancelled=await f.call(path+'/'+r.withdrawal.id+'/cancel',scope(f,{actor:newOwner,requestKey:key()}));assert.equal(cancelled.status,200,cancelled.error);
  for(const sql of ['DELETE FROM commerce_withdrawal_cancellations',"UPDATE commerce_withdrawal_cancellations SET request_key='a'",'INSERT OR REPLACE INTO commerce_withdrawal_cancellations SELECT * FROM commerce_withdrawal_cancellations'])await assert.rejects(f.db.prepare(sql).run(),/withdrawal_cancellation_immutable/);
});

test('exact money, bank fields, strict JSON and private authentication reject unsupported requests without provider traffic',async t=>{
  const f=await funded(t),input=request(f);
  for(const amount of [250000,'249999','250000.00','2.5e5','0250000','-250000','9007199254740992'])assert.equal((await f.call(path,{...input,amount})).status,422);
  assert.equal((await f.call(path,{...input,amount:'9007199254740991'})).status,409);
  for(const bank of [{...input.bank,accountNumber:123456},{...input.bank,accountNumber:'123 456'},{...input.bank,code:'cenaidja'},{...input.bank,channel:'AUTO'},{...input.bank,fee:0}])assert.equal((await f.call(path,{...input,bank})).status,422);
  for(const extra of [{available:999999999},{confirmed:true},{bankVerified:true},{fee:0},{providerUrl:'https://example.test'}])assert.equal((await f.call(path,{...input,...extra})).status,422);
  assert.equal((await f.merchant(path,input,{method:'POST'})).status,401);assert.equal((await f.call(path)).status,404);
  assert.equal((await f.call(path+'?override=1',input)).status,404);
  const duplicate=JSON.stringify(input).replace('"amount":"250000"','"amount":"250000","amount":"500000"');
  const response=await f.mf.dispatchFetch('https://api.fixture.test'+path,{method:'POST',headers:f.headers(path,'POST',duplicate),body:duplicate});assert.equal(response.status,422);
  assert.equal(await count(f,'commerce_withdrawals'),0);
});

test('database guards recheck current funds, proof and owner even when a caller bypasses the service preflight',async t=>{
  const f=await funded(t),r=await f.call(path,request(f));assert.equal(r.status,200,r.error);
  const original=await f.db.prepare('SELECT * FROM commerce_withdrawals WHERE id=?').bind(r.withdrawal.id).first();
  const funds=await f.db.prepare("SELECT source_json FROM commerce_withdrawal_funds WHERE seller_id='seller_alice' AND commerce_environment='sandbox'").first();
  const attempt=async overrides=>{
    const id='wd_'+key()+key().slice(0,8),row={...original,id,partner_reference:'EZK-PAYOUT-S-'+id.slice(3),request_key:key(),funds_json:funds.source_json,...overrides};
    delete row.sequence;delete row.created_at;const columns=Object.keys(row);
    return f.db.prepare('INSERT INTO commerce_withdrawals('+columns.join(',')+",created_at) VALUES("+columns.map(()=>'?').join(',')+",strftime('%Y-%m-%dT%H:%M:%fZ','now'))").bind(...Object.values(row)).run();
  };
  await assert.rejects(attempt({amount:600000}),/withdrawal_funds_unavailable/);
  await assert.rejects(attempt({funds_json:JSON.stringify({...JSON.parse(funds.source_json),eligibleAmount:'999999999'})}),/withdrawal_funds_unavailable/);
  await assert.rejects(attempt({proof_expires_at:new Date(Date.now()-1000).toISOString()}),/withdrawal_proof_expired/);
  await assert.rejects(attempt({proof_expires_at:new Date(Date.now()+700000).toISOString()}),/withdrawal_proof_expired/);
  await assert.rejects(attempt({owner_auth_id:'bob'}),/withdrawal_owner_changed/);
  const otherWallet=await f.db.prepare("SELECT id FROM commerce_wallet_enrollments WHERE seller_id='seller_bob'").first();
  await assert.rejects(attempt({enrollment_id:otherWallet.id}),/withdrawal_wallet_mismatch/);
  await assert.rejects(f.db.prepare("INSERT INTO commerce_withdrawal_cancellations VALUES(?,?,'alice',?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))").bind(r.withdrawal.id,key(),new Date(Date.now()-1000).toISOString()).run(),/withdrawal_proof_expired/);
  assert.equal(await count(f,'commerce_withdrawals'),1);assert.equal(await count(f,'commerce_withdrawal_cancellations'),0);assert.equal((await f.earnings()).reservedWithdrawals,'250000');assert.equal((await f.summary()).balanced,true);
});

test('withdrawal history fixes its cohort, shows current cancellations and excludes full destinations or provider credentials',async t=>{
  const f=await funded(t),ids=[];
  for(let i=0;i<3;i++){const r=await f.call(path,request(f));assert.equal(r.status,200,r.error);ids.push(r.withdrawal.id);}
  const first=await f.call(path+'/list',scope(f,{limit:1}));assert.equal(first.status,200,first.error);assert(first.nextBefore);
  await cancel(f,ids[0]);const later=await f.call(path,request(f));assert.equal(later.status,200,later.error);
  const next=await f.call(path+'/list',scope(f,{cap:first.cap,before:first.nextBefore,limit:50}));assert.equal(next.status,200,next.error);
  assert.equal(next.items.length,2);assert.equal(next.items.find(r=>r.id===ids[0]).state,'cancelled');assert(!next.items.some(r=>r.id===later.withdrawal.id));
  assert(!/001234567890|wallet_|credential|funds_json|owner_auth_id|SAC-/.test(JSON.stringify(next)));
  const foreign=await f.call(path+'/list',scope(f,{seller:'seller_bob',actor:{...actor(),id:'bob'}}));assert.equal(foreign.status,200,foreign.error);assert.deepEqual(foreign.items,[]);
});

test('the populated upgrade preserves original journals, earnings and wallet evidence before creating a reservation',async t=>{
  const f=await funded(t,{through:54});
  const tables=['commerce_financial_journals','commerce_financial_entries','commerce_earnings_assessments','commerce_wallet_enrollments','commerce_wallet_provider_profiles'];
  const before=await Promise.all(tables.map(name=>f.db.prepare('SELECT * FROM '+name).all()));await applyCommerceSchema(f.db,54);
  for(let i=0;i<tables.length;i++)assert.deepEqual(await f.db.prepare('SELECT * FROM '+tables[i]).all().then(r=>r.results),before[i].results);
  assert.equal((await f.db.prepare('PRAGMA foreign_key_check').all()).results.length,0);
  const r=await f.call(path,request(f));assert.equal(r.status,200,r.error);assert.equal((await f.earnings()).availableEarnings,'506250');assert.equal((await f.summary()).balanced,true);
});

test('beta uses production references, while a missing confirmed wallet cannot create a reservation',async t=>{
  const f=await funded(t,{bindings:{APP_ENVIRONMENT:'beta'}}),input=request(f);delete input.bank;input.bankRevision=1;const r=await f.call(path,input);assert.equal(r.status,200,r.error);
  const saved=await f.db.prepare('SELECT partner_reference FROM commerce_withdrawals WHERE id=?').bind(r.withdrawal.id).first();assert.match(saved.partner_reference,/^EZK-PAYOUT-P-/);
  const missing=await setupCommerceFixture(t);missing.environment='sandbox';const noWallet=await missing.call(path,request(missing));assert.equal(noWallet.status,409);assert.equal(await count(missing,'commerce_withdrawals'),0);
  const main=await setupCommerceFixture(t,{bindings:{APP_ENVIRONMENT:'production'}});main.environment='production';
  assert.equal((await main.call(path,request(main))).status,503);assert.equal(await count(main,'commerce_withdrawals'),0);
});
