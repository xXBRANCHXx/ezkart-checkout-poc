import {commerceEnvironment} from './commerce-orders.js';

const fail=(message,status)=>{throw new Response(message,{status});};
const orderIdValid=id=>typeof id==='string'&&/^EZK-[SP]-[A-F0-9]{24}$/.test(id);
export const currentCommerceEnvironment=env=>commerceEnvironment(env,env.APP_ENVIRONMENT==='test'?'sandbox':'production');

// Only the signed PHP service may invoke this function. Its customer object
// must come from the verified Google session, never a submitted email address.
export async function claimCommerceOrder(env,orderId,input){
  const environment=commerceEnvironment(env,input.environment),customer=input.customer;
  if(!orderIdValid(orderId))fail('Order not found',404);
  if(!customer||typeof customer.id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{2,95}$/.test(customer.id)
    ||typeof customer.email!=='string'||customer.email.length>160||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email))fail('Verified customer identity is invalid',422);
  const email=customer.email.trim().toLowerCase();
  const order=await env.DB.prepare(`SELECT o.seller_id,o.customer_snapshot_json,a.auth_user_id AS owner_auth_id FROM orders o
    LEFT JOIN commerce_order_owners a ON a.order_id=o.id WHERE o.id=? AND o.commerce_environment=? AND o.commerce_version=1`).bind(orderId,environment).first();
  if(!order)fail('Order not found',404);
  // Once a guest checkout is claimed, its permanent account binding is the
  // authority. A later verified email change must not undo that ownership.
  if(order.owner_auth_id!==null){
    if(order.owner_auth_id!==customer.id)fail('Order not found',404);
    return {orderId,sellerId:order.seller_id,authUserId:customer.id};
  }
  const original=JSON.parse(order.customer_snapshot_json);
  if(original.authUserId?original.authUserId!==customer.id:String(original.email||'').trim().toLowerCase()!==email)fail('Order not found',404);
  await env.DB.prepare(`INSERT INTO commerce_order_owners(order_id,seller_id,auth_user_id,verified_email,method,created_at)
    VALUES (?,?,?,?,?,?) ON CONFLICT(order_id) DO NOTHING`).bind(orderId,order.seller_id,customer.id,email,original.authUserId?'checkout_identity':'verified_email',new Date().toISOString()).run();
  const owner=await env.DB.prepare('SELECT auth_user_id FROM commerce_order_owners WHERE order_id=?').bind(orderId).first();
  if(owner?.auth_user_id!==customer.id)fail('Order not found',404);
  return {orderId,sellerId:order.seller_id,authUserId:customer.id};
}

export async function customerOrderSeller(env,user,orderId){
  if(!orderIdValid(orderId))fail('Order not found',404);
  const row=await env.DB.prepare(`SELECT o.seller_id FROM orders o LEFT JOIN commerce_order_owners a ON a.order_id=o.id
    WHERE o.id=? AND o.commerce_environment=? AND o.commerce_version=1
      AND COALESCE(a.auth_user_id,NULLIF(json_extract(o.customer_snapshot_json,'$.authUserId'),''))=?`)
    .bind(orderId,currentCommerceEnvironment(env),user.id).first();
  if(!row)fail('Order not found',404);
  return row.seller_id;
}
