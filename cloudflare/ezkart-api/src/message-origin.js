import {commerceHash} from './commerce-orders.js';
import {currentCommerceEnvironment as mode} from './commerce-access.js';
import {messageFields,messageFail} from './commerce-messages.js';

// Names never come from browser claims, referrers or UTM strings. A visit proves
// a tracking link was resolved, not that a person viewed an ad on that platform.
export async function verifiedMessageOrigin(env,actor,sellerId,input){
 if(input===undefined)return null;
 if(actor.kind!=='buyer')messageFail('Only customer links can supply a message origin');
 messageFields(input,['pageId','trackingVisit']);
 if(input.pageId!==undefined&&(typeof input.pageId!=='string'||!/^[a-z0-9-]{1,96}$/.test(input.pageId)))messageFail('Landing page reference is invalid');
 if(input.trackingVisit!==undefined&&(typeof input.trackingVisit!=='string'||!/^[a-f0-9]{64}$/.test(input.trackingVisit)))messageFail('Tracking visit reference is invalid');
 if(input.trackingVisit){
  const hash=await commerceHash('tracking:'+mode(env)+':'+input.trackingVisit);
  const row=await env.DB.prepare(`SELECT p.page_id,p.name AS page_name,s.name AS platform,c.name AS campaign,c.id AS campaign_id FROM tracking_visits v
   JOIN tracking_sources s ON s.id=v.source_id JOIN tracking_campaigns c ON c.id=s.campaign_id
   JOIN tracking_pages p ON p.campaign_id=c.id AND p.page_id=s.page_id
   WHERE v.token_hash=? AND v.expires_at>? AND c.ended_at IS NULL AND c.seller_id=? AND c.commerce_environment=?`).bind(hash,new Date().toISOString(),sellerId,mode(env)).first();
  if(row&&(!input.pageId||row.page_id===input.pageId))return {pageId:row.page_id,pageName:row.page_name,platform:row.platform,campaign:row.campaign,campaignId:row.campaign_id,verifiedTrackingLink:true};
 }
 if(!input.pageId||!env.PRIVATE_ASSETS)return null;
 const saved=await env.PRIVATE_ASSETS.get(`sellers/${sellerId}/landing-pages/${input.pageId}.json`);
 if(!saved)return null;
 let page;try{page=await saved.json();}catch{return null;}
 if(page.id!==input.pageId||page.status!=='published'||!page.publishedHtml||typeof page.name!=='string')return null;
 return {pageId:page.id,pageName:page.name.slice(0,160),platform:null,campaign:null,verifiedTrackingLink:false};
}
