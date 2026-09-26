import {commerceHash} from './commerce-orders.js';
import {reviewCursor,readReviewCursor} from './commerce-reviews.js';
import {notificationsEnabled} from './notification-policy.js';
export const notificationGroups=['payment_confirmed','payment_pending','payment_failed','payment_review','shipping','returns','messages','weekly_activity'];
export const defaultNotificationPreferences=()=>Object.fromEntries(notificationGroups.map(key=>[key,{inApp:key!=='weekly_activity',email:false}]));
const fail=(message,status=422)=>{throw new Response(message,{status});};
const fields=(input,allowed)=>{if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!allowed.includes(key)))fail('Settings request is invalid');};
const text=(value,max,required=false,multiline=false)=>{if(typeof value!=='string'||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)||(!multiline&&/[\r\n\t]/.test(value))||(required&&!value.trim()))fail('Check the store details and try again');return value.trim();};
export function publicStoreProfile(row){
  let saved={};try{saved=JSON.parse(row.settings_json||'{}').businessProfile||{};}catch{}
  const string=(key,max)=>typeof saved[key]==='string'?saved[key].slice(0,max):'';
  return {name:row.name,businessType:['online_merchant','retailer','manufacturer','service_provider'].includes(saved.businessType)?saved.businessType:'online_merchant',
    supportEmail:string('supportEmail',160),supportPhone:string('supportPhone',16),description:string('description',1000),
    timezone:['Asia/Jakarta','Asia/Makassar','Asia/Jayapura'].includes(saved.timezone)?saved.timezone:'Asia/Jakarta',dateFormat:['long','numeric','iso'].includes(saved.dateFormat)?saved.dateFormat:'long'};
}
export async function settingsActor(env,actor){
  const row=await env.DB.prepare(`SELECT s.*,m.role FROM seller_memberships m JOIN sellers s ON s.id=m.seller_id WHERE m.seller_id=? AND m.auth_user_id=? AND s.status='active'`).bind(actor.sellerId,actor.id).first();
  if(!row)fail('Your store membership is no longer available',403);return row;
}
export async function merchantSettings(env,actor){
  const seller=await settingsActor(env,actor),[profile,prefs]=await env.DB.batch([
    env.DB.prepare('SELECT * FROM commerce_store_settings WHERE seller_id=?').bind(seller.id),
    env.DB.prepare('SELECT * FROM commerce_notification_preferences WHERE seller_id=? AND auth_user_id=?').bind(seller.id,actor.id),
  ]);
  await settingsActor(env,actor);
  const p=profile.results[0],n=prefs.results[0];
  return {storeId:seller.id,profile:{revision:p?.revision||0,values:p?JSON.parse(p.profile_json):publicStoreProfile(seller),updatedAt:p?.updated_at||null},
    notifications:{revision:n?.revision||0,values:n?JSON.parse(n.preferences_json):defaultNotificationPreferences(),updatedAt:n?.updated_at||null},
    canEditProfile:seller.role!=='viewer',canEditNotifications:true,currency:'IDR',country:'ID',plan:seller.plan,
    // Email delivery requires a separately configured and verified provider.
    delivery:{inAppEnabled:notificationsEnabled(env),emailEnabled:false}};
}
function profileValues(input){
  fields(input,['name','businessType','supportEmail','supportPhone','description','timezone','dateFormat']);
  const value={name:text(input.name,120,true),businessType:input.businessType,supportEmail:text(input.supportEmail,160).toLowerCase(),
    supportPhone:text(input.supportPhone,32).replace(/[\s().-]/g,''),description:text(input.description,1000,false,true),timezone:input.timezone,dateFormat:input.dateFormat};
  if(value.supportPhone.startsWith('08'))value.supportPhone='+62'+value.supportPhone.slice(1);
  if(value.supportPhone.startsWith('62'))value.supportPhone='+'+value.supportPhone;
  if((value.supportPhone&&!/^\+[1-9][0-9]{7,14}$/.test(value.supportPhone))||(value.supportEmail&&!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value.supportEmail)))fail('Enter a valid support email and international phone number');
  if(!['online_merchant','retailer','manufacturer','service_provider'].includes(value.businessType)||!['Asia/Jakarta','Asia/Makassar','Asia/Jayapura'].includes(value.timezone)||!['long','numeric','iso'].includes(value.dateFormat))fail('Choose a supported business type and date format');
  return value;
}
function preferenceValues(input){
  fields(input,notificationGroups);if(Object.keys(input).length!==notificationGroups.length)fail('Choose every notification preference');
  const result={};for(const key of notificationGroups){fields(input[key],['inApp','email']);if(typeof input[key].inApp!=='boolean'||typeof input[key].email!=='boolean')fail('Choose both notification channels');result[key]={inApp:input[key].inApp,email:input[key].email};}return result;
}
export async function saveMerchantSettings(env,actor,input){
  fields(input,['kind','revision','requestKey','values']);
  if(!['profile','notifications'].includes(input.kind)||!Number.isSafeInteger(input.revision)||input.revision<0||input.revision>=Number.MAX_SAFE_INTEGER||typeof input.requestKey!=='string'||!/^[a-f0-9]{32}$/.test(input.requestKey))fail('Settings save reference is invalid');
  const seller=await settingsActor(env,actor);
  const values=input.kind==='profile'?profileValues(input.values):preferenceValues(input.values),hash=await commerceHash({sellerId:seller.id,...input}),now=new Date().toISOString();
  const saved=()=>env.DB.prepare('SELECT * FROM commerce_settings_changes WHERE actor_id=? AND request_key=?').bind(actor.id,input.requestKey).first();
  const result=async(receipt,replayed)=>{if(receipt.request_hash!==hash)fail('This reference was already used for different settings',409);return {receipt:{storeId:receipt.seller_id,requestKey:receipt.request_key,kind:receipt.kind,revision:receipt.revision,values:JSON.parse(receipt.data_json),createdAt:receipt.created_at,replayed},...await merchantSettings(env,actor)};};
  const old=await saved();if(old)return result(old,true);
  if(input.kind==='profile'&&seller.role==='viewer')fail('Your store role cannot change store details',403);
  try{await env.DB.prepare(`INSERT INTO commerce_settings_changes(seller_id,kind,subject,actor_id,request_key,request_hash,expected_revision,revision,data_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`)
    .bind(seller.id,input.kind,input.kind==='profile'?'store':actor.id,actor.id,input.requestKey,hash,input.revision,input.revision+1,JSON.stringify(values),now).run();}
  catch(error){const raced=await saved();if(raced)return result(raced,true);const detail=String(error)+' '+String(error.cause||'');
    if(/settings_revision_conflict|UNIQUE constraint failed/.test(detail))fail('These settings changed. Compare the saved version before saving your draft.',409);
    if(/settings_rate_limited/.test(detail))fail('Too many settings changes. Try again later.',429);
    if(/settings_forbidden/.test(detail))fail('Your store role changed. Reload this page.',403);throw error;}
  return result(await saved(),false);
}
export async function settingsHistory(env,actor,url){
  await settingsActor(env,actor);for(const key of url.searchParams.keys())if(!['kind','cursor'].includes(key)||url.searchParams.getAll(key).length!==1)fail('Settings history reference is invalid');
  const kind=url.searchParams.get('kind');if(!['profile','notifications'].includes(kind))fail('Choose the settings history to view');
  const subject=kind==='profile'?'store':actor.id,scope=await commerceHash({actor:actor.id,seller:actor.sellerId,kind}),cursor=url.searchParams.has('cursor')?readReviewCursor(url.searchParams.get('cursor'),scope):null;
  if(cursor&&(!Number.isSafeInteger(cursor.cap)||!Number.isSafeInteger(cursor.before)||cursor.cap<cursor.before||cursor.before<1))fail('Settings history page is invalid');
  const latest=await env.DB.prepare('SELECT COALESCE(MAX(revision),0) AS revision FROM commerce_settings_changes WHERE seller_id=? AND kind=? AND subject=?').bind(actor.sellerId,kind,subject).first();
  const cap=cursor?.cap??latest.revision,before=cursor?.before??cap+1;
  const rows=await env.DB.prepare('SELECT revision,actor_id,data_json,created_at FROM commerce_settings_changes WHERE seller_id=? AND kind=? AND subject=? AND revision<=? AND revision<? ORDER BY revision DESC LIMIT 21').bind(actor.sellerId,kind,subject,cap,before).all();
  await settingsActor(env,actor);const items=rows.results.slice(0,20);
  return {items:items.map(r=>({revision:r.revision,actor:r.actor_id===actor.id?'you':'store_member',values:JSON.parse(r.data_json),createdAt:r.created_at})),nextCursor:rows.results.length>20?reviewCursor({v:1,scope,cap,before:items.at(-1).revision}):null};
}
