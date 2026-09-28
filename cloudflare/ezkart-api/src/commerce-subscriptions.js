import {commerceEnvironment,commerceHash} from './commerce-orders.js';
import {reviewMode} from './commerce-reviews.js';
const fail=(message,status=422)=>{throw new Response(message,{status});};
const validId=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{2,95}$/.test(value);
const instant=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const version='subscription-consent-v1';
export const subscriptionDispatch=Object.freeze({enabled:false,reason:'flexibill_contract_pending'});
export function periodEnd(anchor,number,unit,interval){
 const start=new Date(anchor);if(!instant(anchor)||!Number.isInteger(number)||number<0||!['month','year'].includes(unit)||!Number.isInteger(interval)||interval<1)fail('Invalid subscription period');
 const months=number*interval*(unit==='year'?12:1),date=new Date(start);date.setUTCDate(1);date.setUTCMonth(start.getUTCMonth()+months);
 const last=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate();date.setUTCDate(Math.min(start.getUTCDate(),last));return date.toISOString();
}
const wording=t=>`I request ${t.productTitle} — ${t.planName} from ${t.storeName} for IDR ${t.amount} every ${t.interval} ${t.unit}${t.interval===1?'':'s'}. The first paid period starts only after an authenticated payment succeeds. I can cancel future renewals at any time; paid access ends at the end of its paid period. No payment is authorized or taken by saving this request. I must separately authorize the provider mandate before recurring billing begins.`;
async function quote(env,input){
 if(!validId(input.sellerId)||!validId(input.productId)||!validId(input.variantId))fail('Choose a saved subscription plan');
 const row=await env.DB.prepare(`SELECT p.title,p.revision,v.name,v.price_amount,v.billing_interval,v.billing_interval_count,s.name AS store_name
 FROM products p JOIN sellers s ON s.id=p.seller_id JOIN product_variants v ON v.product_id=p.id AND v.seller_id=p.seller_id
 WHERE s.id=? AND p.id=? AND v.id=? AND s.status='active' AND p.status='active' AND p.type='subscription' AND COALESCE(json_extract(v.options_json,'$.hidden'),0)=0`).bind(input.sellerId,input.productId,input.variantId).first();
 if(!row)fail('Subscription plan not found',404);
 const terms={sellerId:input.sellerId,productId:input.productId,variantId:input.variantId,productTitle:row.title,planName:row.name,storeName:row.store_name,amount:row.price_amount,currency:'IDR',unit:row.billing_interval,interval:row.billing_interval_count,revision:row.revision};
 if(!Number.isSafeInteger(terms.amount)||terms.amount<1000||!['month','year'].includes(terms.unit)||!Number.isInteger(terms.interval)||terms.interval<1||terms.interval>(terms.unit==='year'?10:120))fail('The saved plan needs valid billing terms',409);
 return {terms,termsHash:await commerceHash(terms),statement:wording(terms),consentVersion:version,dispatch:subscriptionDispatch};
}
const ownedSql=actor=>actor.kind==='merchant'?'s.seller_id=?':'s.auth_user_id=?';
async function owned(env,actor,id){
 if(typeof id!=='string'||!/^sub_[a-f0-9]{40}$/.test(id))fail('Invalid subscription reference');
 const row=await env.DB.prepare(`SELECT s.* FROM commerce_subscriptions s WHERE s.id=? AND s.commerce_environment=? AND ${ownedSql(actor)}`).bind(id,reviewMode(env),actor.id).first();if(!row)fail('Subscription not found',404);return row;
}
async function projection(env,row,now=new Date().toISOString()){
 const periods=(await env.DB.prepare(`SELECT p.id,p.period_number,p.charge_reference,p.amount,p.currency,p.starts_at,p.ends_at,
 (SELECT COUNT(*) FROM commerce_subscription_outcomes o WHERE o.period_id=p.id AND o.result='failed') AS failures,
 o.paid_at,o.starts_at AS paid_start,o.ends_at AS paid_end FROM commerce_subscription_periods p
 LEFT JOIN commerce_subscription_outcomes o ON o.period_id=p.id AND o.result='paid' WHERE p.subscription_id=? ORDER BY p.period_number DESC LIMIT 24`).bind(row.id).all()).results;
 const active=await env.DB.prepare(`SELECT o.ends_at FROM commerce_subscription_outcomes o JOIN commerce_subscription_periods p ON p.id=o.period_id
 WHERE p.subscription_id=? AND o.result='paid' AND o.starts_at<=? AND o.ends_at>? ORDER BY o.ends_at DESC LIMIT 1`).bind(row.id,now,now).first();
 const paid=periods.some(p=>p.paid_at),failed=periods.some(p=>p.failures),state=row.cancelled_at?'cancelled':active?'active':paid||failed?'past_due':'awaiting_provider';
 return {id:row.id,sellerId:row.seller_id,email:row.email,terms:JSON.parse(row.terms_json),consent:{version:row.consent_version,statement:row.consent_statement,at:row.consent_at},state,cancelledAt:row.cancelled_at,access:{allowed:!!active,until:active?.ends_at||null},dispatch:subscriptionDispatch,
 periods:periods.map(p=>({id:p.id,number:p.period_number,chargeReference:p.charge_reference,amount:p.amount,currency:p.currency,state:p.paid_at?'paid':p.failures?'failed':row.cancelled_at?'cancelled':'pending',startsAt:p.paid_start||p.starts_at,endsAt:p.paid_end||p.ends_at,paidAt:p.paid_at||null}))};
}
export async function subscriptionList(env,actor,before=''){
 if(before&&!/^sub_[a-f0-9]{40}$/.test(before))fail('Invalid subscription page');
 const rows=(await env.DB.prepare(`SELECT s.* FROM commerce_subscriptions s WHERE s.commerce_environment=? AND ${ownedSql(actor)} ${before?'AND s.id<?':''} ORDER BY s.id DESC LIMIT 26`).bind(reviewMode(env),actor.id,...(before?[before]:[])).all()).results;
 return {items:await Promise.all(rows.slice(0,25).map(r=>projection(env,r))),nextCursor:rows.length>25?rows[24].id:null,dispatch:subscriptionDispatch};
}
export async function subscriptionDetail(env,actor,id){return {subscription:await projection(env,await owned(env,actor,id))};}
export async function cancelSubscription(env,actor,id,input){
 if(!input||Object.keys(input).length!==1||input.confirm!==true)fail('Confirm cancellation');
 if(actor.kind==='merchant'&&actor.role==='viewer')fail('You cannot cancel subscriptions',403);
 await owned(env,actor,id);
 await env.DB.prepare(`UPDATE commerce_subscriptions AS s SET cancelled_at=?,cancelled_by=? WHERE id=? AND commerce_environment=? AND ${ownedSql(actor)} AND cancelled_at IS NULL`).bind(new Date().toISOString(),actor.kind+':'+actor.id,id,reviewMode(env),actor.id).run();
 return subscriptionDetail(env,actor,id);
}
export async function customerSubscriptions(env,input){
 if(!input||typeof input!=='object'||Array.isArray(input))fail('Invalid subscription request');
 const fields={list:['cursor'],detail:['id'],cancel:['id','confirm'],quote:['sellerId','productId','variantId'],enroll:['sellerId','productId','variantId','termsHash','statement','consentVersion','consent','requestKey']}[input.action];
 if(!fields||Object.keys(input).some(k=>!['customer','environment','action',...fields].includes(k))||!input.customer||Object.keys(input.customer).some(k=>!['id','email'].includes(k))||!validId(input.customer.id)||typeof input.customer.email!=='string'||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.customer.email)||input.customer.email.length>160)fail('Verified subscription identity is invalid');
 const mode=commerceEnvironment(env,input.environment),actor={kind:'customer',id:input.customer.id};
 if(input.action==='list')return subscriptionList(env,actor,input.cursor);
 if(input.action==='detail')return subscriptionDetail(env,actor,input.id);
 if(input.action==='cancel')return cancelSubscription(env,actor,input.id,{confirm:input.confirm});
 if(input.action==='quote')return quote(env,input);
 if(input.consent!==true||input.consentVersion!==version||!/^[a-f0-9]{32}$/.test(input.requestKey||''))fail('Explicit subscription consent is required');
 const requestHash=await commerceHash({...input,customer:{id:actor.id}}),id='sub_'+(await commerceHash({mode,owner:actor.id,key:input.requestKey})).slice(0,40);
 const existing=await env.DB.prepare('SELECT * FROM commerce_subscriptions WHERE id=?').bind(id).first();
 if(existing){if(existing.request_hash!==requestHash)fail('Request key already used for different terms',409);return {subscription:await projection(env,existing),replayed:true};}
 const offer=await quote(env,input);if(input.termsHash!==offer.termsHash||input.statement!==offer.statement)fail('The plan changed. Review its current terms before consenting.',409);
 const now=new Date().toISOString();
 const result=await env.DB.prepare(`INSERT INTO commerce_subscriptions(id,seller_id,commerce_environment,auth_user_id,email,product_id,variant_id,terms_json,terms_hash,consent_statement,consent_version,consent_at,request_key,request_hash,created_at)
 SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM products p JOIN sellers s ON s.id=p.seller_id WHERE p.id=? AND p.seller_id=? AND p.revision=? AND p.status='active' AND s.status='active') ON CONFLICT(id) DO NOTHING`).bind(id,input.sellerId,mode,actor.id,input.customer.email,input.productId,input.variantId,JSON.stringify(offer.terms),offer.termsHash,offer.statement,version,now,input.requestKey,requestHash,now,input.productId,input.sellerId,offer.terms.revision).run();
 const saved=await env.DB.prepare('SELECT * FROM commerce_subscriptions WHERE id=?').bind(id).first();if(!saved)fail('The plan changed. Review it again.',409);if(saved.request_hash!==requestHash)fail('Request key conflict',409);
 return {subscription:await projection(env,saved),replayed:result.meta.changes===0};
}
// Lifecycle preparation is local only: it never authorizes or dispatches a charge.
// Caller is a future scheduler, not a browser endpoint. Every insert rechecks cancellation.
export async function prepareSubscriptionPeriod(env,id,now=new Date().toISOString()){
 if(!instant(now))fail('Invalid subscription clock');
 const s=await env.DB.prepare('SELECT * FROM commerce_subscriptions WHERE id=? AND commerce_environment=?').bind(id,reviewMode(env)).first();if(!s)fail('Subscription not found',404);if(s.cancelled_at)fail('Subscription is cancelled',409);
 const latest=await env.DB.prepare(`SELECT p.*,o.paid_at,o.starts_at AS paid_start,o.ends_at AS paid_end FROM commerce_subscription_periods p LEFT JOIN commerce_subscription_outcomes o ON o.period_id=p.id AND o.result='paid' WHERE p.subscription_id=? ORDER BY p.period_number DESC LIMIT 1`).bind(id).first();
 if(latest&&!latest.paid_at)return latest;
 if(latest&&latest.paid_end>now)return latest;
 const terms=JSON.parse(s.terms_json),number=latest?latest.period_number+1:0;
 const first=latest?await env.DB.prepare(`SELECT o.starts_at FROM commerce_subscription_periods p JOIN commerce_subscription_outcomes o ON o.period_id=p.id AND o.result='paid' WHERE p.subscription_id=? AND p.period_number=0`).bind(id).first():null;
 const periodId='speriod_'+(await commerceHash({id,number})).slice(0,40),reference='EZSUB'+(await commerceHash({id,number})).slice(0,40).toUpperCase();
 try{await env.DB.prepare(`INSERT INTO commerce_subscription_periods(id,subscription_id,period_number,charge_reference,amount,currency,starts_at,ends_at,created_at) VALUES(?,?,?,?,?,'IDR',?,?,?) ON CONFLICT(subscription_id,period_number) DO NOTHING`).bind(periodId,id,number,reference,terms.amount,latest?.paid_end||null,first?periodEnd(first.starts_at,number+1,terms.unit,terms.interval):null,now).run();}catch(error){if(String(error).includes('subscription_period_unavailable'))fail('Subscription is cancelled',409);throw error;}
 return env.DB.prepare('SELECT * FROM commerce_subscription_periods WHERE id=?').bind(periodId).first();
}
// Consumes only durable provider-authenticated evidence, never a "verified" input flag.
export async function reconcileSubscriptionPayment(env,evidenceId){
 const e=await env.DB.prepare(`SELECT e.*,p.subscription_id,p.period_number,p.starts_at,p.ends_at,s.terms_json FROM commerce_subscription_payment_sources e JOIN commerce_subscription_periods p ON p.id=e.period_id JOIN commerce_subscriptions s ON s.id=p.subscription_id WHERE e.evidence_id=? AND s.commerce_environment=?`).bind(evidenceId,reviewMode(env)).first();
 if(!e)fail('Authenticated recurring payment evidence is unavailable',409);
 if(!['paid','failed'].includes(e.result)||!instant(e.dispatched_at)||e.dispatched_at>new Date().toISOString()||(e.result==='paid'&&(!instant(e.paid_at)||e.paid_at<e.dispatched_at||e.paid_at>new Date().toISOString())))fail('Recurring outcome is invalid',409);
 const terms=JSON.parse(e.terms_json),start=e.result==='paid'?(e.period_number===0?e.paid_at:e.starts_at):null,end=e.result==='paid'?(e.period_number===0?periodEnd(start,1,terms.unit,terms.interval):e.ends_at):null;
 const old=await env.DB.prepare("SELECT * FROM commerce_subscription_outcomes WHERE evidence_id=? OR (period_id=? AND result='paid') ORDER BY CASE WHEN evidence_id=? THEN 0 ELSE 1 END LIMIT 1").bind(evidenceId,e.period_id,evidenceId).first();
 if(old)return {replayed:true,state:old.result};
 try{await env.DB.prepare(`INSERT INTO commerce_subscription_outcomes(evidence_id,period_id,result,paid_at,starts_at,ends_at,recorded_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`).bind(evidenceId,e.period_id,e.result,e.result==='paid'?e.paid_at:null,start,end,new Date().toISOString()).run();}catch(error){if(String(error).includes('subscription_'))fail('Recurring outcome does not match the original charge or cancellation boundary',409);throw error;}
 return {replayed:false,state:e.result};
}
export async function dispatchSubscriptionCharge(){fail('FlexiBill registration and authenticated recurring contract are pending. No charge was dispatched.',409);}
