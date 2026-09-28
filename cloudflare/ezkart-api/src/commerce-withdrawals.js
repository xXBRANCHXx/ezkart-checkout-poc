import {requireSellerOnboarding,savedOnboardingBank,onboardingFailure} from './seller-onboarding.js';
import {commerceHash} from './commerce-orders.js';
import {walletOwner} from './commerce-wallet-enrollment.js';
import {withdrawalStatusSummaries} from './commerce-withdrawal-status.js';
import {payoutSummaries} from './commerce-payouts.js';

const fail=(message,status=422)=>{throw new Response(message,{status});};
const fields=(input,allowed)=>{if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!allowed.includes(k)))fail('Withdrawal parameters are invalid');};
const requestKey=value=>{if(typeof value!=='string'||!/^[a-f0-9]{32}$/.test(value))fail('Withdrawal request reference is invalid');};
const base=['environment','seller','actor'];
const rowSQL=`SELECT w.*,c.created_at AS cancelled_at,c.request_key AS cancellation_key,c.owner_auth_id AS cancelled_by,
  g.created_at AS inquiry_started_at,r.inquiry_digest,r.beneficiary_name,
  a.id AS confirmation_id,a.created_at AS confirmed_at,a.proof_expires_at AS confirmation_expires_at,
  pg.created_at AS payment_started_at,pr.recorded_at AS payment_recorded_at
  FROM commerce_withdrawals w LEFT JOIN commerce_withdrawal_cancellations c ON c.withdrawal_id=w.id
  LEFT JOIN commerce_withdrawal_inquiry_grants g ON g.withdrawal_id=w.id
  LEFT JOIN commerce_withdrawal_inquiry_receipts r ON r.withdrawal_id=w.id
  LEFT JOIN commerce_withdrawal_confirmations a ON a.sequence=(SELECT MAX(x.sequence) FROM commerce_withdrawal_confirmations x WHERE x.withdrawal_id=w.id)
  LEFT JOIN commerce_withdrawal_payment_grants pg ON pg.withdrawal_id=w.id
  LEFT JOIN commerce_withdrawal_payment_receipts pr ON pr.withdrawal_id=w.id`;
export async function authorizeWithdrawalOwner(env,input){
  if(!['test','beta'].includes(env.APP_ENVIRONMENT))fail('Withdrawals are not enabled on this deployment',503);
  return walletOwner(env,input);
}
function bank(input){
  fields(input,['code','accountNumber','channel']);
  if(typeof input.code!=='string'||!/^[A-Z0-9]{4,16}$/.test(input.code)
    ||typeof input.accountNumber!=='string'||!/^[0-9]{1,22}$/.test(input.accountNumber)
    ||!['BI_FAST','ONLINE'].includes(input.channel))fail('The bank destination is invalid');
}
const view=row=>({id:row.id,sequence:row.sequence,amount:String(row.amount),currency:'IDR',state:row.cancelled_at?'cancelled':'reserved',
  bank:{code:row.bank_code,accountSuffix:row.bank_account.slice(-4),channel:row.channel,beneficiaryName:row.beneficiary_name||null},
  createdAt:row.created_at,cancelledAt:row.cancelled_at,bankVerified:!!row.inquiry_digest,payoutConfirmed:false,
  inquiry:{state:row.inquiry_digest?'verified':row.inquiry_started_at?'review':'not_requested',digest:row.inquiry_digest||null},
  confirmation:row.confirmation_id?{id:row.confirmation_id,confirmedAt:row.confirmed_at,proofExpiresAt:row.confirmation_expires_at}:null,
  canCancel:!row.cancelled_at&&!row.payment_started_at,
  payment:{state:row.payment_recorded_at?'response_recorded':row.payment_started_at?'review':'not_started',
    startedAt:row.payment_started_at||null,recordedAt:row.payment_recorded_at||null}});
const read=(env,id,input)=>env.DB.prepare(rowSQL+' WHERE w.id=? AND w.seller_id=? AND w.commerce_environment=?')
  .bind(id,input.seller,input.environment).first();
async function outcomes(env,items){
  const results=await payoutSummaries(env,items.filter(w=>w.payment.startedAt).map(w=>w.id));
  for(const w of items){
    w.payment.outcome=results.get(w.id)||null;
    if(w.payment.outcome){w.state=w.payment.outcome.state;w.payoutConfirmed=w.payment.outcome.payoutConfirmed;}
  }
  return items;
}
const currentView=async(env,row)=>(await outcomes(env,[view(row)]))[0];
export function withdrawalFailure(error){
  if(/withdrawal_funds_unavailable/.test(String(error)))fail('Current earnings cannot cover this withdrawal. Refresh Wallet.',409);
  if(/withdrawal_owner_changed|withdrawal_proof_expired/.test(String(error)))fail('Your Wallet authorization changed. Verify your identity again.',409);
  if(/withdrawal_wallet_mismatch/.test(String(error)))fail('A confirmed seller payment account is required.',409);
  if(/withdrawal_cancelled/.test(String(error)))fail('This withdrawal was cancelled. Refresh its status.',409);
  if(/withdrawal_payment_started/.test(String(error)))fail('This withdrawal has entered payment processing and cannot be cancelled. Its outcome needs reconciliation.',409);
  onboardingFailure(error);
}

// The SQL statement reads current funds, validates ownership/proof, freezes the
// intent and posts its balanced reservation journal in the same transaction.
export async function reserveWithdrawal(env,input){
  fields(input,[...base,'requestKey','amount','bank','bankRevision']);await authorizeWithdrawalOwner(env,input);requestKey(input.requestKey);
  if(input.environment==='production' && input.bank)fail('Withdrawals use your bank saved during onboarding. Refresh Wallet.');
  const requestedRevision=input.bankRevision;
  if(requestedRevision!==undefined){if(!Number.isSafeInteger(requestedRevision)||requestedRevision<1)fail('Saved bank revision is invalid.');}
  else if(input.environment==='production')fail('Save a bank during onboarding before withdrawing.',409);
  if(typeof input.amount!=='string'||!/^[1-9][0-9]{5,15}$/.test(input.amount)
    ||BigInt(input.amount)<250000n||BigInt(input.amount)>9007199254740991n)fail('Withdrawal amount must be whole rupiah, at least Rp250,000 and within the ledger limit.');
  const suffix=(await commerceHash({seller:input.seller,environment:input.environment,requestKey:input.requestKey})).slice(0,40),id='wd_'+suffix;
  const match=row=>row.owner_auth_id===input.actor.id&&String(row.amount)===input.amount&&(requestedRevision!==undefined ? row.bank_revision===requestedRevision : row.bank_code===input.bank?.code && row.bank_account===input.bank?.accountNumber && row.channel===input.bank?.channel);
  const replay=async row=>{if(!match(row))fail('This withdrawal reference already has different details.',409);return {withdrawal:await currentView(env,row),replayed:true,providerCalls:0};};
  const prior=await read(env,id,input);if(prior)return replay(prior);
  await requireSellerOnboarding(env,input.seller,input.environment);
  if(requestedRevision!==undefined)input={...input,bank:await savedOnboardingBank(env,input,requestedRevision)};
  bank(input.bank);
  const wallet=await env.DB.prepare(`SELECT p.enrollment_id FROM commerce_wallet_enrollments e JOIN commerce_wallet_provider_profiles p ON p.enrollment_id=e.id
    WHERE e.seller_id=? AND e.commerce_environment=? AND p.commerce_environment=e.commerce_environment`).bind(input.seller,input.environment).first();
  if(!wallet)fail('A confirmed seller payment account is required.',409);
  try{
    await env.DB.prepare(`INSERT INTO commerce_withdrawals(id,seller_id,commerce_environment,request_key,owner_auth_id,proof_expires_at,
      enrollment_id,amount,bank_code,bank_account,channel,partner_reference,bank_revision,funds_json,created_at)
      SELECT ?,?,?,?,?,?,?,CAST(? AS INTEGER),?,?,?,?,?,f.source_json,strftime('%Y-%m-%dT%H:%M:%fZ','now')
      FROM commerce_withdrawal_funds f WHERE f.seller_id=? AND f.commerce_environment=?`)
      .bind(id,input.seller,input.environment,input.requestKey,input.actor.id,input.actor.proofExpiresAt,wallet.enrollment_id,input.amount,
        input.bank.code,input.bank.accountNumber,input.bank.channel,'EZK-PAYOUT-'+(input.environment==='sandbox'?'S':'P')+'-'+suffix,requestedRevision??null,input.seller,input.environment).run();
  }catch(error){const saved=await read(env,id,input);if(saved)return replay(saved);withdrawalFailure(error);}
  const saved=await read(env,id,input);if(!saved)fail('Withdrawal could not be reserved. Refresh Wallet.',409);
  return {withdrawal:view(saved),replayed:false,providerCalls:0};
}

export async function withdrawalDetail(env,id,input){
  fields(input,base);await authorizeWithdrawalOwner(env,input);
  const row=await read(env,id,input);if(!row)fail('Withdrawal was not found',404);
  const funds=await env.DB.prepare(`SELECT CAST(reservable_amount AS TEXT) AS available,CAST(reserved_amount AS TEXT) AS reserved,
    CAST(reservation_shortfall AS TEXT) AS shortfall,incomplete_captures,incomplete_journals
    FROM commerce_withdrawal_funds WHERE seller_id=? AND commerce_environment=?`).bind(input.seller,input.environment).first();
  const withdrawal=await currentView(env,row);withdrawal.bank.accountNumber=row.bank_account;
  withdrawal.payment.status=(await withdrawalStatusSummaries(env,[id])).get(id)||null;
  return {withdrawal,funds:{reservableEarnings:funds.available,reservedWithdrawals:funds.reserved,reservationShortfall:funds.shortfall,
    accountingComplete:funds.incomplete_captures===0&&funds.incomplete_journals===0},
    originalOwner:row.owner_auth_id===input.actor.id,withdrawalsEnabled:false,providerCalls:0};
}

// Recover a reservation after a lost acknowledgement without retaining bank
// details in browser storage or creating another intent.
export async function withdrawalLookup(env,input){
  fields(input,[...base,'requestKey']);await authorizeWithdrawalOwner(env,input);requestKey(input.requestKey);
  const id='wd_'+(await commerceHash({seller:input.seller,environment:input.environment,requestKey:input.requestKey})).slice(0,40);
  return withdrawalDetail(env,id,{environment:input.environment,seller:input.seller,actor:input.actor});
}

// The SQL payment fence shares this insertion transaction. Once a payment grant
// exists, timeouts and missing acknowledgements cannot authorize cancellation.
export async function cancelWithdrawal(env,id,input){
  fields(input,[...base,'requestKey']);await authorizeWithdrawalOwner(env,input);requestKey(input.requestKey);
  const row=await read(env,id,input);if(!row)fail('Withdrawal was not found',404);
  const replay=saved=>{if(saved.cancellation_key!==input.requestKey||saved.cancelled_by!==input.actor.id)fail('This withdrawal was already cancelled. Refresh its status.',409);
    return {withdrawal:view(saved),replayed:true,providerCalls:0};};
  if(row.cancelled_at)return replay(row);
  try{
    await env.DB.prepare(`INSERT INTO commerce_withdrawal_cancellations(withdrawal_id,request_key,owner_auth_id,proof_expires_at,created_at)
      VALUES(?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))`).bind(id,input.requestKey,input.actor.id,input.actor.proofExpiresAt).run();
  }catch(error){const saved=await read(env,id,input);if(saved?.cancelled_at)return replay(saved);withdrawalFailure(error);}
  return {withdrawal:view(await read(env,id,input)),replayed:false,providerCalls:0};
}

export async function withdrawalList(env,input){
  fields(input,[...base,'before','cap','limit']);await authorizeWithdrawalOwner(env,input);
  for(const k of ['before','cap'])if(input[k]!==undefined&&(!Number.isSafeInteger(input[k])||input[k]<1))fail('Withdrawal history boundary is invalid');
  if(input.limit!==undefined&&(!Number.isInteger(input.limit)||input.limit<1||input.limit>50))fail('Withdrawal history size is invalid');
  const limit=input.limit??20,cap=input.cap??(await env.DB.prepare('SELECT COALESCE(MAX(sequence),0) AS n FROM commerce_withdrawals WHERE seller_id=? AND commerce_environment=?').bind(input.seller,input.environment).first()).n;
  const rows=(await env.DB.prepare(rowSQL+' WHERE w.seller_id=? AND w.commerce_environment=? AND w.sequence<=? AND w.sequence<? ORDER BY w.sequence DESC LIMIT ?')
    .bind(input.seller,input.environment,cap,input.before??Number.MAX_SAFE_INTEGER,limit+1).all()).results;
  const items=await outcomes(env,rows.slice(0,limit).map(view)),statuses=await withdrawalStatusSummaries(env,items.map(row=>row.id));
  for(const item of items)item.payment.status=statuses.get(item.id)||null;
  return {items,cap,nextBefore:rows.length>limit?rows[limit-1].sequence:null,withdrawalsEnabled:false};
}
