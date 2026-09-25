import {commerceHash,commerceStorageEnabled} from './commerce-orders.js';
import {reviewFail,reviewId,reviewMode,reviewParameters,reviewCursor,readReviewCursor,reviewSelect,reviewView} from './commerce-reviews.js';

export const publicReviewSql="r.status='published' AND r.buyer_state='published' AND r.moderation_state='visible'";
function filters(url,merchant){
  const value=Object.fromEntries(['rating','photos','sort',...(merchant?['state','reply','product','q']:['product'])].map(k=>[k,url.searchParams.get(k)??'']));
  value.sort||='newest';value.state||='all';value.reply||='all';
  if((value.rating&&!/^[1-5]$/.test(value.rating))||(value.photos&&!['0','1'].includes(value.photos))||!['newest','oldest'].includes(value.sort)
    ||!['all','published','hidden','pending','withdrawn'].includes(value.state)||!['all','needed','replied'].includes(value.reply)
    ||(value.product&&!reviewId(value.product))||(merchant&&(value.q.length>120||/[\u0000-\u001f]/.test(value.q))))reviewFail('Review filters are invalid');
  return value;
}
function summary(row){
  const count=row.count||0,sum=row.sum||0;
  return {count,ratingSum:sum,average:count?sum/count:null,stars:Object.fromEntries([5,4,3,2,1].map(n=>[n,row['star'+n]||0]))};
}
const summaryColumns='COUNT(*) AS count,COALESCE(SUM(r.rating),0) AS sum,'+[1,2,3,4,5].map(n=>`COALESCE(SUM(r.rating=${n}),0) AS star${n}`).join(',');
async function list(env,scopeId,url,merchant,canWrite=false){
  const limit=reviewParameters(url,['rating','photos','sort','product','limit','cursor',...(merchant?['state','reply','q']:[])]),f=filters(url,merchant),mode=reviewMode(env);
  const scope=await commerceHash({scopeId,mode,merchant,filters:f}),raw=url.searchParams.get('cursor'),cursor=raw?readReviewCursor(raw,scope):null;
  if(cursor&&(!Number.isSafeInteger(cursor.cap)||cursor.cap<0||!reviewId(cursor.id)||typeof cursor.at!=='string'||cursor.at.length>40))reviewFail('Review page reference is invalid');
  const base=`r.seller_id=? AND r.commerce_environment IN (?, 'legacy')${merchant?'':` AND r.product_id=? AND ${publicReviewSql}`}`;
  const values=merchant?[scopeId,mode]:[scopeId,mode,f.product];
  const cap=cursor?.cap??(await env.DB.prepare('SELECT COALESCE(MAX(r.rowid),0) AS cap FROM product_reviews r WHERE '+base).bind(...values).first()).cap;
  const where=[base,'r.rowid<=?'],bindings=[...values,cap];
  if(f.rating){where.push('r.rating=?');bindings.push(Number(f.rating));}
  if(f.photos){where.push('json_array_length(r.media_json)'+(f.photos==='1'?'>0':'=0'));}
  if(merchant){
    if(f.product){where.push('r.product_id=?');bindings.push(f.product);}
    if(f.q){where.push("instr(lower(r.public_name||' '||r.title||' '||r.body||' '||p.title||' '||COALESCE(i.order_id,'')),lower(?))>0");bindings.push(f.q.trim());}
    if(f.state==='withdrawn')where.push("r.buyer_state='withdrawn'");
    else if(f.state!=='all'){where.push('r.buyer_state=? AND r.moderation_state=?');bindings.push('published',f.state==='published'?'visible':f.state);}
    if(f.reply!=='all')where.push((f.reply==='needed'?'NOT ':'')+"(r.reply_body!='' AND r.reply_content_revision=r.content_revision)");
  }
  const comparison=f.sort==='oldest'?'>':'<',direction=f.sort==='oldest'?'ASC':'DESC';
  const joins=reviewSelect.slice(reviewSelect.indexOf(' FROM '));
  const result=await env.DB.batch([
    env.DB.prepare(`SELECT ${summaryColumns} FROM product_reviews r WHERE r.seller_id=? AND r.commerce_environment IN (?, 'legacy') AND r.rowid<=? AND ${publicReviewSql}${merchant?'':' AND r.product_id=?'}`)
      .bind(scopeId,mode,cap,...(merchant?[]:[f.product])),
    env.DB.prepare('SELECT COUNT(*) AS n'+joins+' WHERE '+where.join(' AND ')).bind(...bindings),
    env.DB.prepare(reviewSelect+' WHERE '+where.join(' AND ')+(cursor?` AND (r.created_at${comparison}? OR (r.created_at=? AND r.id${comparison}?))`:'')+` ORDER BY r.created_at ${direction},r.id ${direction} LIMIT ?`)
      .bind(...bindings,...(cursor?[cursor.at,cursor.at,cursor.id]:[]),limit+1),
  ]);
  const rows=result[2].results.slice(0,limit),last=rows.at(-1);
  return {summary:summary(result[0].results[0]),matching:result[1].results[0].n,items:rows.map(r=>reviewView(r,{publicView:!merchant})),
    nextCursor:result[2].results.length>limit?reviewCursor({v:1,scope,cap,at:last.created_at,id:last.id}):null,
    ...(merchant?{canWrite:canWrite&&commerceStorageEnabled(env),enabled:commerceStorageEnabled(env)}:{})};
}
export function merchantReviews(env,actor,url){return list(env,actor.sellerId,url,true,actor.role!=='viewer');}
export async function publicReviews(env,url){
  const product=url.searchParams.get('product');
  if(!reviewId(product))reviewFail('Product not found',404);
  const row=await env.DB.prepare("SELECT p.seller_id FROM products p JOIN sellers s ON s.id=p.seller_id WHERE p.id=? AND p.status='active' AND s.status='active'").bind(product).first();
  if(!row)reviewFail('Product not found',404);
  return list(env,row.seller_id,url,false);
}
