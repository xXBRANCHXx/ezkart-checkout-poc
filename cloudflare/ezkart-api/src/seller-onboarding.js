import {walletOwner} from './commerce-wallet-enrollment.js';
import {commerceHash} from './commerce-orders.js';
const fail=(message,status=422)=>{throw new Response(message,{status});};
const fields=(value,allowed)=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!allowed.includes(k)))fail('Onboarding parameters are invalid.');};
const read=(env,table,seller)=>env.DB.prepare('SELECT * FROM '+table+' WHERE seller_id=?').bind(seller).first();
// Owner-approved 18+ policy, evaluated by calendar date in Indonesia (UTC+7).
export function declaredSellerAge(value,now=Date.now()){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))fail('Enter your date of birth.');
 const birth=new Date(value+'T00:00:00.000Z');
 if(!Number.isFinite(birth.getTime())||birth.toISOString().slice(0,10)!==value)fail('Enter a valid date of birth.');
 const today=new Date(now+7*3600000).toISOString().slice(0,10);
 const age=Number(today.slice(0,4))-Number(value.slice(0,4))-(today.slice(5)<value.slice(5)?1:0);
 if(age<0||age>120)fail('Enter a valid date of birth.');return age;
}
export function onboardingFailure(error){
 const text=String(error);
 if(/seller_onboarding_required/.test(text))fail('Complete seller onboarding, including verified identity, saved bank and confirmed pickup/return pins, before starting new money actions.',409);
 if(/onboarding_bank_changed/.test(text))fail('Your saved bank changed. Cancel this unsent withdrawal and create a request for the current bank.',409);
 if(/onboarding_revision_conflict|onboarding_shipping_changed/.test(text))fail('Your saved details changed. Refresh onboarding before saving again.',409);
 if(/onboarding_owner_required/.test(text))fail('Only the current owner can complete onboarding.',403);
 if(/onboarding_proof_expired/.test(text))fail('Unlock Wallet again before saving sensitive details.',401);
 throw error;
}
export async function requireSellerOnboarding(env,seller,environment){
 if(environment!=='production')return;
 if(!await read(env,'seller_onboarding_ready',seller))onboardingFailure(Error('seller_onboarding_required'));
}
export async function savedOnboardingBank(env,input,revision){
 const bank=await read(env,'seller_onboarding_current_bank',input.seller);
 if(!bank||bank.owner_auth_id!==input.actor.id||bank.revision!==revision)onboardingFailure(Error('onboarding_bank_changed'));
 return {code:bank.bank_code,accountNumber:bank.account_number,channel:bank.channel};
}
async function snapshot(env,input){
 const [storedProfile,storedBank,shipping,policy,ready,wallet,user]=await Promise.all([
  read(env,'seller_onboarding_current',input.seller),read(env,'seller_onboarding_current_bank',input.seller),read(env,'seller_shipping_settings',input.seller),
  env.DB.prepare('SELECT * FROM seller_onboarding_policy WHERE id=1').first(),read(env,'seller_onboarding_ready',input.seller),
  env.DB.prepare(`SELECT e.id,p.profile_id,j.state FROM commerce_wallet_enrollments e JOIN commerce_jobs j ON j.id=e.job_id LEFT JOIN commerce_wallet_provider_profiles p ON p.enrollment_id=e.id WHERE e.seller_id=? AND e.commerce_environment=?`).bind(input.seller,input.environment).first(),
  env.DB.prepare('SELECT email FROM app_users WHERE auth_user_id=?').bind(input.actor.id).first(),
 ]);
 // A store may gain another owner. Revision counters remain usable without
 // exposing or copying the previous owner's personal declarations or bank.
 const profile=storedProfile?.owner_auth_id===input.actor.id?storedProfile:null,bank=storedBank?.owner_auth_id===input.actor.id?storedBank:null;
 const email=input.actor.email.toLowerCase(),emailChanged=!!profile&&(profile.verified_email!==email||profile.verified_email!==user?.email?.toLowerCase());
 const identity=profile?await env.DB.prepare(`SELECT i.provider_reference FROM seller_authenticated_identity i WHERE i.seller_id=? AND i.owner_auth_id=? AND i.profile_revision=? AND i.verified_age>=? AND i.policy_version=? AND length(trim(i.provider_reference,char(9)||char(10)||char(11)||char(12)||char(13)||' '))>0 AND i.expires_at>?`).bind(input.seller,input.actor.id,profile.identity_revision,policy.minimum_age,policy.policy_version,new Date().toISOString()).first():null;
 const config=shipping?JSON.parse(shipping.configuration_json):{addresses:[]};
 const pickup=config.addresses.find(a=>a.id===config.pickupAddressId),returns=config.addresses.find(a=>a.id===config.returnAddressId);
 const pins=!!pickup?.coordinate&&!!returns?.coordinate;
 return {seller:input.seller,email,emailVerified:true,profileRevision:storedProfile?.revision||0,bankRevision:storedBank?.revision||0,
  profile:profile?{revision:profile.revision,identityRevision:profile.identity_revision,legalName:profile.legal_name,birthDate:profile.declared_birth_date,phone:profile.phone,confirmedShippingRevision:profile.confirmed_shipping_revision}:null,
  bank:bank?{revision:bank.revision,code:bank.bank_code,accountSuffix:bank.account_number.slice(-4),channel:bank.channel}:null,
  shipping:{revision:shipping?.revision||0,pickup:pickup?{label:pickup.label,address:pickup.address,location:pickup.location,coordinate:pickup.coordinate||null}:null,returns:returns?{label:returns.label,address:returns.address,location:returns.location,coordinate:returns.coordinate||null}:null,pinsPresent:pins,confirmed:!!profile&&profile.confirmed_shipping_revision===shipping?.revision&&pins},
  identity:{status:identity?'verified':'pending_authenticated_verification',minimumAge:policy.minimum_age,policyVersion:policy.policy_version},
  ready:!!ready&&ready.owner_auth_id===input.actor.id&&ready.revision===profile?.revision&&ready.bank_revision===bank?.revision&&!!identity&&pins&&profile.confirmed_shipping_revision===shipping?.revision&&!emailChanged,wallet:wallet?{id:wallet.id,status:wallet.profile_id?'confirmed':wallet.state==='uncertain'?'review':wallet.state}:null,
  requirements:[...(!profile?['legal_name_phone']:[]),...(emailChanged?['refresh_legal_profile']:[]),...(!bank?['saved_bank']:[]),...(!pins||profile?.confirmed_shipping_revision!==shipping?.revision?['confirmed_pickup_return_pins']:[]),...(!policy.minimum_age?['age_policy']:[]),...(!identity?['authenticated_identity_verification']:[])],providerCalls:0};
}
export async function sellerOnboarding(env,input){
 fields(input,['environment','seller','actor','action','revision','requestKey','legalName','birthDate','phone','bank','shippingRevision']);
 await walletOwner(env,input);
 if(input.action==='read')return snapshot(env,input);
 if(!['profile','bank','confirm_pins'].includes(input.action)||!Number.isSafeInteger(input.revision)||input.revision<0||!/^[a-f0-9]{32}$/.test(input.requestKey||''))fail('Refresh onboarding before saving.');
 const current=await read(env,'seller_onboarding_current',input.seller),now=new Date().toISOString();
 let values,table,sql;
 if(input.action==='bank'){
  fields(input.bank,['code','accountNumber','channel']);
  if(!/^[A-Z0-9]{4,16}$/.test(input.bank.code||'')||!/^[0-9]{1,22}$/.test(input.bank.accountNumber||'')||!['BI_FAST','ONLINE'].includes(input.bank.channel))fail('Choose a valid bank and account number.');
  values=[input.bank.code,input.bank.accountNumber,input.bank.channel];table='seller_onboarding_banks';
  sql='INSERT INTO seller_onboarding_banks(seller_id,revision,request_key,request_hash,owner_auth_id,bank_code,account_number,channel,proof_expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)';
 }else{
  let name=input.legalName,birthDate=input.birthDate,phone=input.phone,pins=current?.owner_auth_id===input.actor.id?current.confirmed_shipping_revision:null;
  if(pins&&(await read(env,'seller_shipping_settings',input.seller))?.revision!==pins)pins=null;
  if(input.action==='confirm_pins'){
   if(!current||current.owner_auth_id!==input.actor.id)fail('Save your own full legal name and phone first.',409);
   const state=await snapshot(env,input);if(!state.shipping.pinsPresent||state.shipping.revision!==input.shippingRevision)fail('Save pickup and return addresses with map pins, then refresh onboarding.',409);
   name=current.legal_name;birthDate=current.declared_birth_date;phone=current.phone;pins=input.shippingRevision;
  }
  if(typeof name!=='string'||name.trim().length<2||name.length>128||/[\u0000-\u001f\u007f]/.test(name)||typeof phone!=='string'||!/^\+?\d{8,15}$/.test(phone))fail('Enter your full legal name and a valid phone number.');
  if(declaredSellerAge(birthDate)<18)fail('Sellers must be at least 18 years old under Ezkart’s seller policy.');
  const identityRevision=current && current.owner_auth_id===input.actor.id && current.legal_name===name.trim() && current.declared_birth_date===birthDate ? current.identity_revision : input.revision+1;
  values=[identityRevision,name.trim(),birthDate,input.actor.email.toLowerCase(),phone,pins];table='seller_onboarding_profiles';
  sql='INSERT INTO seller_onboarding_profiles(seller_id,revision,request_key,request_hash,owner_auth_id,identity_revision,legal_name,declared_birth_date,verified_email,phone,confirmed_shipping_revision,proof_expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)';
 }
 const hash=await commerceHash({action:input.action,revision:input.revision,owner:input.actor.id,values});
 const previous=()=>env.DB.prepare('SELECT request_hash FROM '+table+' WHERE seller_id=? AND request_key=?').bind(input.seller,input.requestKey).first();
 let replay=await previous();
 if(replay){if(replay.request_hash!==hash)fail('This save reference was already used for different details.',409);return snapshot(env,input);}
 try{await env.DB.prepare(sql).bind(input.seller,input.revision+1,input.requestKey,hash,input.actor.id,...values,input.actor.proofExpiresAt,now).run();}
 catch(error){replay=await previous();if(replay?.request_hash===hash)return snapshot(env,input);onboardingFailure(error);}
 return snapshot(env,input);
}
