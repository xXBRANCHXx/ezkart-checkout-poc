import assert from 'node:assert/strict';
import {publicationBase,publicationKey} from './campaign-publication-fixture.mjs';
export async function prepareAttributionCampaign(f,{publish=true}={}){
  const store=await f.merchant('/v1/storefront',{enabled:true,name:'Alice tea',accent:'#334155',button:'#111827',background:'#f7f8fa',logoId:'',backgroundId:'',animation:'none'});
  assert.equal(store.status,200,store.error);
  const draft=await f.merchant(publicationBase,{id:f.id,revision:1,requestKey:publicationKey(),values:{...f.values,buttonLabel:'Explore the store'}},{method:'POST'});
  assert.equal(draft.status,200,draft.error);
  const buyer=await f.addBuyer(1);
  if(!publish)return {buyer};
  const result=await f.publish({...f.intent(),revision:2});assert.equal(result.status,200,result.error);
  const link=await f.db.prepare('SELECT * FROM commerce_campaign_links WHERE publication_id=?').bind(result.publication.id).first();
  assert(link);return {buyer,publication:result.publication,link,path:'/v1/public/campaign-link?c='+link.code};
}
