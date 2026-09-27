import {commerceHash,commerceStorageEnabled} from './commerce-orders.js';
import {currentCommerceEnvironment,customerOrderSeller} from './commerce-access.js';

export const reviewFail=(message,status=422)=>{throw new Response(message,{status});};
export const reviewId=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{2,95}$/.test(value);
export const reviewMediaId=value=>typeof value==='string'&&/^rphoto_[a-f0-9]{32}$/.test(value);
export const reviewMode=currentCommerceEnvironment;
export function reviewFields(input,allowed){
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!allowed.includes(k)))reviewFail('Review request is invalid');
}
export function reviewText(value,max,label,{required=false,multiline=false}={}){
  if(typeof value!=='string'||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
    ||(!multiline&&/[\r\n\t]/.test(value))||(required&&!value.trim()))reviewFail(`${label} is invalid`);
  return value.trim();
}
export function reviewParameters(url,allowed){
  for(const name of url.searchParams.keys())if(!allowed.includes(name)||url.searchParams.getAll(name).length!==1)reviewFail('Review filters are invalid');
  const raw=url.searchParams.get('limit')??'20';
  if(!/^[1-9][0-9]?$/.test(raw)||Number(raw)>50)reviewFail('Choose between 1 and 50 reviews per page');
  return Number(raw);
}
export const reviewCursor=value=>btoa(JSON.stringify(value)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
export function readReviewCursor(value,scope){
  let data;
  try{if(typeof value!=='string'||!/^[A-Za-z0-9_-]{1,1800}$/.test(value))throw Error();data=JSON.parse(atob(value.replaceAll('-','+').replaceAll('_','/')));}catch{reviewFail('Review page reference is invalid');}
  if(data?.v!==1||data.scope!==scope)reviewFail('Review page belongs to another view');
  return data;
}
export const eligibleReviewSql=`i.product_id IS NOT NULL AND o.checkout_state IN ('paid','partially_refunded','refunded')
  AND EXISTS(SELECT 1 FROM commerce_payment_captures c WHERE c.order_id=o.id AND c.capture_kind='order_payment' AND c.amount=o.total_amount)
  AND ((i.product_type='physical'
    AND (EXISTS(SELECT 1 FROM inventory_reservations h WHERE h.order_item_id=i.id AND h.state='committed')
      OR EXISTS(SELECT 1 FROM commerce_stock_allocations x WHERE x.order_item_id=i.id))
    AND EXISTS(SELECT 1 FROM commerce_shipments s WHERE s.order_id=o.id AND s.commerce_environment=o.commerce_environment
      AND s.provider_id IS NOT NULL AND s.provider_account_hash IS NOT NULL AND s.delivered_at IS NOT NULL))
  OR (i.product_type='digital' AND EXISTS(SELECT 1 FROM commerce_digital_deliveries d
    JOIN commerce_digital_entitlements e ON e.order_item_id=d.order_item_id
    JOIN commerce_payment_captures c ON c.id=e.capture_id AND c.order_id=o.id AND c.capture_kind='order_payment' AND c.amount=o.total_amount
    WHERE d.order_item_id=i.id AND d.evidence_version=1)))`;
export const reviewSelect=`SELECT r.*,p.title AS product_title,i.order_id,i.title AS purchased_title,
  json_extract(i.fulfillment_snapshot_json,'$.variantName') AS option_name
  FROM product_reviews r JOIN products p ON p.id=r.product_id AND p.seller_id=r.seller_id
  LEFT JOIN order_items i ON i.id=r.order_item_id AND i.seller_id=r.seller_id`;
export async function reviewRecord(env,id){
  if(!reviewId(id))reviewFail('Review not found',404);
  return env.DB.prepare(reviewSelect+" WHERE r.id=? AND r.commerce_environment IN (?, 'legacy')").bind(id,reviewMode(env)).first();
}
export function reviewView(row,{publicView=false}={}){
  if(!row)return null;
  const replyCurrent=row.reply_content_revision===row.content_revision;
  const view={id:row.id,productId:row.product_id,productName:row.purchased_title||row.product_title||'',option:row.option_name||'',
    rating:row.rating,title:row.title,body:row.body,publicName:row.public_name,verifiedPurchase:row.review_source==='purchase',
    photos:JSON.parse(row.media_json),createdAt:row.created_at,updatedAt:row.updated_at,
    reply:replyCurrent&&row.reply_body?{body:row.reply_body,createdAt:row.replied_at}:null};
  if(!publicView)Object.assign(view,{revision:row.revision,contentRevision:row.content_revision,orderItemId:row.order_item_id,orderId:row.order_id||null,
    state:row.buyer_state==='withdrawn'?'withdrawn':row.moderation_state==='visible'?'published':row.moderation_state,
    buyerState:row.buyer_state,moderation:{state:row.moderation_state,reason:row.moderation_reason,note:row.moderation_note,updatedAt:row.moderated_at},
    savedReply:{body:row.reply_body,contentRevision:row.reply_content_revision,updatedAt:row.replied_at,current:replyCurrent}});
  return view;
}
export async function buyerReviewLine(env,user,orderId,itemId){
  const sellerId=await customerOrderSeller(env,user,orderId);
  if(!reviewId(itemId))reviewFail('Purchase item not found',404);
  const line=await env.DB.prepare(`SELECT i.*,o.customer_id,(${eligibleReviewSql}) AS eligible
    FROM order_items i JOIN orders o ON o.id=i.order_id WHERE i.id=? AND i.order_id=? AND i.seller_id=?`)
    .bind(itemId,orderId,sellerId).first();
  if(!line)reviewFail('Purchase item not found',404);
  return line;
}
export async function buyerReviews(env,user,orderId,url){
  reviewParameters(url,[]);
  const sellerId=await customerOrderSeller(env,user,orderId);
  const [lines,rows]=await env.DB.batch([
    env.DB.prepare(`SELECT i.*,(${eligibleReviewSql}) AS eligible FROM order_items i JOIN orders o ON o.id=i.order_id
      WHERE i.order_id=? AND i.seller_id=? ORDER BY i.id`).bind(orderId,sellerId),
    env.DB.prepare(reviewSelect+" WHERE i.order_id=? AND r.seller_id=? AND r.commerce_environment IN (?, 'legacy')")
      .bind(orderId,sellerId,reviewMode(env)),
  ]);
  const enabled=commerceStorageEnabled(env);
  return {orderId,enabled,items:lines.results.map(line=>{
    const row=rows.results.find(r=>r.order_item_id===line.id),owned=!row||(row.review_source==='purchase'&&row.owner_auth_user_id===user.id),canPublish=enabled&&owned&&Boolean(line.eligible);
    return {orderItemId:line.id,productId:line.product_id,title:line.title,option:JSON.parse(line.fulfillment_snapshot_json).variantName||'',
      canPublish,canWithdraw:enabled&&owned&&row?.buyer_state==='published',review:reviewView(row),
      reason:canPublish?'':!enabled?'Reviews will open when central checkout is enabled.':!owned?'This is a historical review and cannot be edited from this account.':
        line.product_type==='digital'?'Reviews open after payment and a complete, verified download.':line.product_type!=='physical'?'Reviews are currently unavailable for this item.':'Reviews open after verified payment and courier delivery.'};
  })};
}
export function reviewWritable(env){if(!commerceStorageEnabled(env))reviewFail('Review changes are not enabled',503);}
function changeIdentity(input){
  if(typeof input.requestKey!=='string'||!/^[a-f0-9]{32}$/.test(input.requestKey)||!Number.isSafeInteger(input.revision)||input.revision<0||input.revision>=Number.MAX_SAFE_INTEGER)reviewFail('Review change reference is invalid');
}
function snapshot(row){
  return row?{rating:row.rating,title:row.title,body:row.body,publicName:row.public_name,contentRevision:row.content_revision,media:JSON.parse(row.media_json),
    buyerState:row.buyer_state,moderationState:row.moderation_state,moderationReason:row.moderation_reason,moderationNote:row.moderation_note,moderatedAt:row.moderated_at,
    reply:row.reply_body,replyContentRevision:row.reply_content_revision,repliedAt:row.replied_at}:
    {contentRevision:0,media:[],buyerState:'published',moderationState:'visible',moderationReason:'',moderationNote:'',moderatedAt:null,reply:'',replyContentRevision:0,repliedAt:null};
}
const savedChange=(env,actor,key)=>env.DB.prepare('SELECT * FROM commerce_review_changes WHERE actor_kind=? AND actor_auth_user_id=? AND commerce_environment=? AND request_key=?')
  .bind(actor.kind,actor.id,reviewMode(env),key).first();
async function changeResult(env,receipt,hash,replayed){
  if(receipt.request_hash!==hash)reviewFail('This request was already used for a different review change',409);
  return {receipt:{reviewId:receipt.review_id,revision:receipt.revision,kind:receipt.kind,createdAt:receipt.created_at,replayed},review:reviewView(await reviewRecord(env,receipt.review_id))};
}
async function persistChange(env,actor,identity,input,data,hash){
  const now=new Date().toISOString();
  try{await env.DB.prepare(`INSERT INTO commerce_review_changes(review_id,seller_id,commerce_environment,product_id,customer_id,order_item_id,owner_auth_user_id,
    actor_kind,actor_auth_user_id,kind,request_key,request_hash,expected_revision,revision,data_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(identity.id,identity.seller_id,reviewMode(env),identity.product_id,identity.customer_id,identity.order_item_id,identity.owner_auth_user_id,
      actor.kind,actor.id,input.kind,input.requestKey,hash,input.revision,input.revision+1,JSON.stringify(data),now).run();
  }catch(error){
    const raced=await savedChange(env,actor,input.requestKey);if(raced)return changeResult(env,raced,hash,true);
    const detail=String(error)+' '+String(error.cause||'');
    if(/review_revision_conflict|UNIQUE constraint failed: product_reviews/.test(detail))reviewFail('This review changed. Reload it and review your draft before saving again.',409);
    if(/review_actor_forbidden/.test(detail))reviewFail('You cannot change this review',403);
    if(/review_owner_required|review_missing/.test(detail))reviewFail('Review not found',404);
    if(/review_purchase_required/.test(detail))reviewFail('Verified payment and delivery are required before publishing a review',409);
    if(/review_photo_invalid/.test(detail))reviewFail('A review photo expired or is unavailable. Upload it again before publishing.',409);
    throw error;
  }
  return changeResult(env,await savedChange(env,actor,input.requestKey),hash,false);
}
export async function saveBuyerReview(env,user,orderId,input){
  reviewWritable(env);
  reviewFields(input,['orderItemId','kind','revision','requestKey',...(input?.kind==='publish'?['rating','title','body','publicName','photos']:[])]);
  if(!['publish','withdraw'].includes(input.kind))reviewFail('Review action is invalid');
  changeIdentity(input);
  const line=await buyerReviewLine(env,user,orderId,input.orderItemId),mode=reviewMode(env),actor={kind:'buyer',id:user.id};
  const id=(await env.DB.prepare('SELECT id FROM product_reviews WHERE seller_id=? AND order_item_id=?').bind(line.seller_id,line.id).first())?.id
    ||'review_'+(await commerceHash({seller:line.seller_id,mode,item:line.id})).slice(0,32);
  const row=await reviewRecord(env,id),data=snapshot(row),hash=await commerceHash({orderId,...input}),old=await savedChange(env,actor,input.requestKey);
  if(old)return changeResult(env,old,hash,true);
  if(row&&(row.review_source!=='purchase'||row.owner_auth_user_id!==user.id))reviewFail('This historical review cannot be edited from this account',403);
  if((row?.revision||0)!==input.revision)reviewFail('This review changed. Reload it and review your draft before saving again.',409);
  if(input.kind==='publish'){
    if(!line.eligible)reviewFail('Verified payment and delivery are required before publishing a review',409);
    if(!Number.isInteger(input.rating)||input.rating<1||input.rating>5)reviewFail('Choose a rating between 1 and 5');
    if(!Array.isArray(input.photos)||input.photos.length>6||new Set(input.photos).size!==input.photos.length||input.photos.some(id=>!reviewMediaId(id)))reviewFail('Choose up to six review photos');
    Object.assign(data,{rating:input.rating,title:reviewText(input.title,120,'Review title'),body:reviewText(input.body,3000,'Review text',{multiline:true}),
      publicName:reviewText(input.publicName,50,'Public name',{required:true}),media:input.photos,contentRevision:data.contentRevision+1,buyerState:'published'});
  }else{
    if(!row)reviewFail('Review not found',404);
    if(row.buyer_state==='withdrawn')reviewFail('This review is already withdrawn',409);
    data.buyerState='withdrawn';
  }
  return persistChange(env,actor,{id,seller_id:line.seller_id,product_id:line.product_id,customer_id:line.customer_id,order_item_id:line.id,owner_auth_user_id:user.id},input,data,hash);
}
export async function merchantReview(env,actor,id){
  const row=await reviewRecord(env,id);
  if(!row||row.seller_id!==actor.sellerId)reviewFail('Review not found',404);
  return {review:reviewView(row),canWrite:commerceStorageEnabled(env)&&actor.role!=='viewer'};
}
export async function saveMerchantReview(env,actor,id,input){
  reviewWritable(env);
  if(actor.role==='viewer')reviewFail('You cannot change reviews',403);
  const fields={reply:['body'],hide:['reason','note'],restore:[],approve:[]}[input?.kind];
  if(!fields)reviewFail('Review action is invalid');
  reviewFields(input,['kind','revision','requestKey',...fields]);changeIdentity(input);
  const row=await reviewRecord(env,id);
  if(!row||row.seller_id!==actor.sellerId)reviewFail('Review not found',404);
  const writer={...actor,kind:'merchant'},hash=await commerceHash({id,...input}),old=await savedChange(env,writer,input.requestKey);
  if(old)return changeResult(env,old,hash,true);
  if(row.revision!==input.revision)reviewFail('This review changed. Reload it before replying or moderating.',409);
  const data=snapshot(row),now=new Date().toISOString();
  if(input.kind==='reply')Object.assign(data,{reply:reviewText(input.body,2000,'Store reply',{multiline:true}),replyContentRevision:row.content_revision,repliedAt:now});
  else{
    if(input.kind==='hide'){
      if(!['personal_information','abuse','spam','unrelated','duplicate'].includes(input.reason))reviewFail('Choose a moderation reason');
      const note=reviewText(input.note,1000,'Explanation for the buyer',{required:true,multiline:true});
      if(note.length<10)reviewFail('Explain the moderation decision in at least 10 characters');
      Object.assign(data,{moderationState:'hidden',moderationReason:input.reason,moderationNote:note,moderatedAt:now});
    }else{
      if(row.moderation_state!==(input.kind==='restore'?'hidden':'pending'))reviewFail('This review does not need that moderation action',409);
      Object.assign(data,{moderationState:'visible',moderationReason:'',moderationNote:'',moderatedAt:now});
    }
  }
  return persistChange(env,writer,row,input,data,hash);
}
export async function reviewHistory(env,actor,id,url,orderId=''){
  const limit=reviewParameters(url,['limit','cursor']),row=await reviewRecord(env,id);
  if(!row)reviewFail('Review not found',404);
  if(actor.kind==='buyer'){
    await customerOrderSeller(env,actor,orderId);
    if(row.order_id!==orderId||row.owner_auth_user_id!==actor.id)reviewFail('Review not found',404);
  }else if(row.seller_id!==actor.sellerId)reviewFail('Review not found',404);
  const scope=await commerceHash({mode:reviewMode(env),id,actor:actor.id,kind:actor.kind,view:'history'}),raw=url.searchParams.get('cursor'),cursor=raw?readReviewCursor(raw,scope):null;
  if(cursor&&(!Number.isSafeInteger(cursor.cap)||!Number.isSafeInteger(cursor.before)||cursor.before<1||cursor.cap<cursor.before||cursor.cap>row.revision))reviewFail('Review history reference is invalid');
  const cap=cursor?.cap??row.revision,before=cursor?.before??cap+1;
  const rows=await env.DB.prepare(`SELECT revision,kind,actor_kind,data_json,created_at FROM commerce_review_changes WHERE review_id=? AND commerce_environment=?
    AND revision<=? AND revision<? ORDER BY revision DESC LIMIT ?`).bind(id,reviewMode(env),cap,before,limit+1).all(),items=rows.results.slice(0,limit);
  return {items:items.map(r=>({revision:r.revision,kind:r.kind,actor:r.actor_kind,content:JSON.parse(r.data_json),createdAt:r.created_at})),
    nextCursor:rows.results.length>limit?reviewCursor({v:1,scope,cap,before:items.at(-1).revision}):null};
}
