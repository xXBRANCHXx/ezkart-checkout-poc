import {commerceHash,commerceEnvironment,commerceStorageEnabled} from './commerce-orders.js';

const fail=(message,status=422)=>{throw new Response(message,{status});};
// Provider availability is still determined by the live rates response.
export const shippingCouriers=[['jne','JNE'],['sicepat','SiCepat'],['jnt','J&T Express'],['tiki','TIKI'],['anteraja','Anteraja'],['ninja','Ninja Xpress'],['lion','Lion Parcel'],['pos','Pos Indonesia'],['idexpress','ID Express'],['sap','SAP Express'],['wahana','Wahana'],['jntcargo','J&T Cargo'],['gojek','GoSend'],['grab','GrabExpress']].map(([code,name])=>({code,name,requiresPin:['gojek','grab'].includes(code)}));
const defaults=()=>({addresses:[],pickupAddressId:'',returnAddressId:'',couriers:['jne','sicepat','jnt']});
const field=(value,name,max,min=0)=>{
  if(typeof value!=='string'||value.trim().length<min||value.length>max||/[\u0000-\u001f\u007f]/.test(value))fail(`${name} is invalid`);
  return value.trim();
};
const addressId=value=>{if(typeof value!=='string'||!/^addr_[a-f0-9]{32}$/.test(value))fail('Address identity is invalid');return value;};
export function shippingConfiguration(value){
  if(!value||!Array.isArray(value.addresses)||value.addresses.length>10)fail('Save up to 10 addresses');
  const addresses=value.addresses.map(address=>{
    if(!address||typeof address!=='object')fail('Address is invalid');
    const result={id:addressId(address.id),label:field(address.label,'Address label',50,2),name:field(address.name,'Contact name',100,2),
      phone:field(address.phone,'Contact phone',20,8),email:field(address.email??'','Contact email',120),organization:field(address.organization??'','Organization',100),
      address:field(address.address,'Street address',300,5),location:field(address.location,'City or district',120,3),postalCode:field(address.postalCode,'Postcode',5,5),note:field(address.note??'','Pickup instructions',120)};
    if(!/^\+?\d{8,15}$/.test(result.phone))fail('Enter a valid contact phone');
    if(result.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email))fail('Enter a valid contact email');
    if(!/^[1-9]\d{4}$/.test(result.postalCode))fail('Enter a five-digit Indonesian postcode');
    if((result.address+', '+result.location).length>300)fail('Keep the street address and city together within 300 characters');
    if(address.coordinate!==undefined&&address.coordinate!==null){
      const {latitude,longitude}=address.coordinate;
      if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||latitude < -11.1||latitude>6.1||longitude<94.8||longitude>141.1)fail('Choose a pickup pin within Indonesia');
      result.coordinate={latitude,longitude};
    }
    return result;
  });
  if(new Set(addresses.map(a=>a.id)).size!==addresses.length)fail('Address identities must be unique');
  if(!Array.isArray(value.couriers)||!value.couriers.length||value.couriers.length>shippingCouriers.length||new Set(value.couriers).size!==value.couriers.length
    ||value.couriers.some(code=>!shippingCouriers.some(c=>c.code===code)))fail('Choose at least one available courier');
  const pickupAddressId=value.pickupAddressId,returnAddressId=value.returnAddressId;
  if(typeof pickupAddressId!=='string'||typeof returnAddressId!=='string'||(addresses.length
    ?![pickupAddressId,returnAddressId].every(id=>addresses.some(a=>a.id===id)):pickupAddressId!==''||returnAddressId!==''))fail('Choose saved pickup and return addresses');
  const pickup=addresses.find(a=>a.id===pickupAddressId);
  if(pickup&&!pickup.coordinate&&value.couriers.some(code=>shippingCouriers.some(c=>c.code===code&&c.requiresPin)))fail('Add a pickup pin before enabling instant couriers');
  return {addresses,pickupAddressId,returnAddressId,couriers:[...value.couriers].sort()};
}
const view=row=>({revision:row?.revision||0,configuration:row?JSON.parse(row.configuration_json):defaults(),updatedAt:row?.updated_at||null});
async function read(env,sellerId){
  if(!await env.DB.prepare("SELECT id FROM sellers WHERE id=? AND status='active'").bind(sellerId).first())fail('Store not found',404);
  return view(await env.DB.prepare('SELECT * FROM seller_shipping_settings WHERE seller_id=?').bind(sellerId).first());
}
export async function merchantShippingSettings(env,actor){
  const settings=await read(env,actor.sellerId);
  const history=await env.DB.prepare('SELECT revision,actor_auth_user_id,created_at FROM seller_shipping_changes WHERE seller_id=? ORDER BY revision DESC LIMIT 10').bind(actor.sellerId).all();
  return {sellerId:actor.sellerId,canWrite:actor.role!=='viewer',checkoutEnabled:commerceStorageEnabled(env),settings,couriers:shippingCouriers,
    recentChanges:history.results.map(row=>({revision:row.revision,byYou:row.actor_auth_user_id===actor.id,createdAt:row.created_at}))};
}
export async function saveShippingSettings(env,actor,input){
  if(actor.role==='viewer')fail('Your account cannot change shipping settings',403);
  if(!input||!Number.isSafeInteger(input.revision)||input.revision<0||typeof input.requestKey!=='string'||! /^[a-f0-9]{32}$/.test(input.requestKey))fail('Reload shipping settings before saving');
  const configuration=shippingConfiguration(input.configuration),hash=await commerceHash({revision:input.revision,configuration});
  const previous=()=>env.DB.prepare('SELECT * FROM seller_shipping_changes WHERE seller_id=? AND request_key=?').bind(actor.sellerId,input.requestKey).first();
  const replay=row=>{
    if(row.request_hash!==hash)fail('This save request was already used for different settings',409);
    return {sellerId:row.seller_id,requestKey:row.request_key,revision:row.revision,createdAt:row.created_at};
  };
  let row=await previous();if(row)return replay(row);
  const now=new Date().toISOString();
  try{await env.DB.prepare(`INSERT INTO seller_shipping_changes(seller_id,request_key,request_hash,expected_revision,revision,actor_auth_user_id,configuration_json,created_at) VALUES(?,?,?,?,?,?,?,?)`)
    .bind(actor.sellerId,input.requestKey,hash,input.revision,input.revision+1,actor.id,JSON.stringify(configuration),now).run();}
  catch(error){row=await previous();if(row)return replay(row);const message=String(error?.message)+' '+String(error?.cause?.message);
    if(message.includes('shipping_actor_forbidden'))fail('Your account cannot change shipping settings',403);
    if(message.includes('shipping_revision_conflict'))fail('Shipping settings changed in another session. Reload the saved version before saving again.',409);throw error;}
  return {sellerId:actor.sellerId,requestKey:input.requestKey,revision:input.revision+1,createdAt:now};
}
export function shippingOrigin(address){
  return {origin_contact_name:address.name,origin_contact_phone:address.phone,origin_contact_email:address.email,
    origin_address:address.address+', '+address.location,origin_postal_code:address.postalCode,origin_note:address.note,
    shipper_organization:address.organization,...(address.coordinate?{coordinate:address.coordinate}:{})};
}
export async function checkoutShippingSettings(env,sellerId,environment){
  commerceEnvironment(env,environment);
  const {revision,configuration}=await read(env,sellerId),pickup=configuration.addresses.find(a=>a.id===configuration.pickupAddressId),returns=configuration.addresses.find(a=>a.id===configuration.returnAddressId);
  if(!pickup||!returns)fail('This store has not set up its pickup and return addresses yet',409);
  return {settingsRevision:revision,pickupAddressId:pickup.id,returnAddressId:returns.id,origin:shippingOrigin(pickup),returnAddress:returns,couriers:configuration.couriers};
}
export async function validateShippingSettings(env,sellerId,environment,shipping){
  if(shipping.skipped)return;
  const expected=await checkoutShippingSettings(env,sellerId,environment);
  if(shipping.settingsRevision!==expected.settingsRevision||shipping.pickupAddressId!==expected.pickupAddressId||shipping.returnAddressId!==expected.returnAddressId
    ||await commerceHash(shipping.origin)!==await commerceHash(expected.origin)||await commerceHash(shipping.returnAddress)!==await commerceHash(expected.returnAddress)
    ||!expected.couriers.includes(shipping.courierCode))fail('Shipping settings changed. Refresh delivery options before paying.',409);
  const pinRequired=['gojek','grab'].includes(shipping.courierCode)||['instant','instant_car','instant_bike','same_day'].includes(shipping.serviceCode);
  if(pinRequired&&(!shipping.origin.coordinate||!shipping.destination?.coordinate))fail('This service requires pickup and delivery pins');
}
