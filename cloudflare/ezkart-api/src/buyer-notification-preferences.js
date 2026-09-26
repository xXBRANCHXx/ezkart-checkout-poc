import {commerceHash} from './commerce-orders.js';
import {currentCommerceEnvironment} from './commerce-access.js';
import {reviewCursor,readReviewCursor} from './commerce-reviews.js';
import {notificationsEnabled} from './notification-policy.js';
import {emailConfiguration} from './email-provider.js';

export const buyerNotificationGroups=['payment_confirmed','payment_pending','payment_failed','shipping','returns','messages'];
export const defaultBuyerNotificationPreferences=()=>Object.fromEntries(buyerNotificationGroups.map(key=>[key,{inApp:true,email:false}]));
const fail=(message,status=422,code)=>{throw new Response(message,{status,...(code?{headers:{'x-ezkart-error-code':code}}:{})});};
function identity(actor){if(actor?.kind!=='buyer'||typeof actor.id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{2,95}$/.test(actor.id))fail('Sign in to manage notification preferences',401);return actor.id;}
function fields(input,allowed){if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!allowed.includes(key)))fail('Notification preferences are invalid');}
function values(input){
  fields(input,buyerNotificationGroups);if(Object.keys(input).length!==buyerNotificationGroups.length)fail('Choose every notification preference');
  const result={};for(const key of buyerNotificationGroups){fields(input[key],['inApp','email']);if(typeof input[key].inApp!=='boolean'||typeof input[key].email!=='boolean')fail('Choose both notification channels');result[key]={inApp:input[key].inApp,email:input[key].email};}return result;
}

export async function buyerNotificationPreferences(env,actor){
  const id=identity(actor),row=await env.DB.prepare('SELECT revision,preferences_json,updated_at FROM commerce_buyer_notification_preferences WHERE auth_user_id=?').bind(id).first();
  return {accountId:id,revision:row?.revision||0,values:row?JSON.parse(row.preferences_json):defaultBuyerNotificationPreferences(),updatedAt:row?.updated_at||null,
    delivery:{inAppEnabled:notificationsEnabled(env),emailEnabled:emailConfiguration(env).ready}};
}

export async function saveBuyerNotificationPreferences(env,actor,input){
  const id=identity(actor);fields(input,['revision','requestKey','values']);
  if(!Number.isSafeInteger(input.revision)||input.revision<0||input.revision>=Number.MAX_SAFE_INTEGER||typeof input.requestKey!=='string'||!/^[a-f0-9]{32}$/.test(input.requestKey))fail('Notification preference save reference is invalid');
  const validated=values(input.values),hash=await commerceHash({accountId:id,environment:currentCommerceEnvironment(env),...input});
  const saved=()=>env.DB.prepare('SELECT * FROM commerce_buyer_notification_changes WHERE auth_user_id=? AND request_key=?').bind(id,input.requestKey).first();
  const result=async(receipt,replayed)=>{
    if(!receipt)throw new Error('Buyer preference receipt is missing');
    if(receipt.request_hash!==hash)fail('This save reference already has different preferences',409,'buyer_notification_reference_conflict');
    return {...await buyerNotificationPreferences(env,actor),receipt:{requestKey:receipt.request_key,revision:receipt.revision,values:JSON.parse(receipt.data_json),createdAt:receipt.created_at,replayed}};
  };
  const prior=await saved();if(prior)return result(prior,true);
  try{await env.DB.prepare(`INSERT INTO commerce_buyer_notification_changes(auth_user_id,request_key,request_hash,expected_revision,revision,data_json,created_at) VALUES(?,?,?,?,?,?,?)`)
    .bind(id,input.requestKey,hash,input.revision,input.revision+1,JSON.stringify(validated),new Date().toISOString()).run();}
  catch(error){const raced=await saved();if(raced)return result(raced,true);const detail=String(error)+' '+String(error.cause||'');
    if(/buyer_notification_revision_conflict|UNIQUE constraint failed/.test(detail))fail('Your preferences changed. Compare the saved version before saving this draft.',409,'buyer_notification_revision_conflict');
    if(/buyer_notification_rate_limited/.test(detail))fail('Too many preference changes. Try again later.',429);throw error;}
  return result(await saved(),false);
}

export async function buyerNotificationPreferenceHistory(env,actor,url){
  const id=identity(actor);for(const key of url.searchParams.keys())if(key!=='cursor'||url.searchParams.getAll(key).length!==1)fail('Preference history reference is invalid');
  const scope=await commerceHash({accountId:id,environment:currentCommerceEnvironment(env),view:'buyer_notification_preferences'}),cursor=url.searchParams.has('cursor')?readReviewCursor(url.searchParams.get('cursor'),scope):null;
  if(cursor&&(!Number.isSafeInteger(cursor.cap)||!Number.isSafeInteger(cursor.before)||cursor.cap<cursor.before||cursor.before<1))fail('Preference history page is invalid');
  const latest=await env.DB.prepare('SELECT COALESCE(MAX(revision),0) AS revision FROM commerce_buyer_notification_changes WHERE auth_user_id=?').bind(id).first(),cap=cursor?.cap??latest.revision,before=cursor?.before??cap+1;
  const rows=await env.DB.prepare('SELECT revision,data_json,created_at FROM commerce_buyer_notification_changes WHERE auth_user_id=? AND revision<=? AND revision<? ORDER BY revision DESC LIMIT 21').bind(id,cap,before).all(),items=rows.results.slice(0,20);
  return {items:items.map(row=>({revision:row.revision,values:JSON.parse(row.data_json),createdAt:row.created_at})),nextCursor:rows.results.length>20?reviewCursor({v:1,scope,cap,before:items.at(-1).revision}):null};
}
