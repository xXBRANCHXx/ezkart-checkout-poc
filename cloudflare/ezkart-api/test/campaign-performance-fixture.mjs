import assert from 'node:assert/strict';
import {campaignLink} from '../src/campaign-attribution.js';
export async function performanceJourney(f,campaign){
  await f.product('performance-tea',1000);
  const visit=()=>campaignLink(f.env,new Request('https://fixture.test/v1/public/campaign-link?c='+campaign.link.code));
  const checkout=async(token,extra={})=>{
    const input=f.input({items:[{productId:'performance-tea',quantity:1,expectedPrice:20000,expectedWeightGrams:100}],...extra});
    if(token)input.checkout.campaignVisit=token;
    const result=await f.create(input);assert.equal(result.status,200,result.error);return result.order;
  };
  return {...f,campaign,visit,checkout};
}
