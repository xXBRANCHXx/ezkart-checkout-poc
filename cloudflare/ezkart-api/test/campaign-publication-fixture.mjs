import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {setupCommerceFixture} from './commerce-fixture.mjs';
import {campaignMailConfiguration,campaignMailSource} from './campaign-email-fixture.mjs';
import {grantCampaignConsent,unsubscribeFixtureOrder} from './campaign-unsubscribe-fixture.mjs';
export const publicationKey=()=>randomBytes(16).toString('hex');
export const publicationBase='/v1/commerce/marketing/campaigns';
export const publicationActor={id:'alice',sellerId:'seller_alice'};
export async function campaignPublicationFixture(t,options={}){
  const bindings={...campaignMailConfiguration(),...options.bindings},f=await setupCommerceFixture(t,{...options,bindings});
  return publicationFixtureOn(f,bindings);
}
export async function publicationFixtureOn(f,bindings=campaignMailConfiguration()){
  await f.product('campaign-tea',1000);
  const values={...campaignMailSource().values,buttonLabel:''};
  const draft=await f.merchant(publicationBase,{id:null,revision:0,requestKey:publicationKey(),values},{method:'POST'});assert.equal(draft.status,200,draft.error);
  const addBuyer=async(n,{consent=true,...extra}={})=>{
    const buyer={id:'campaign-buyer-'+n,email:'buyer'+n+'@example.test'},order=await unsubscribeFixtureOrder(f,buyer,{items:[{productId:'campaign-tea',quantity:1,expectedPrice:20000,expectedWeightGrams:100}],...extra});
    const grant=consent?await grantCampaignConsent(f,{buyer}):null;return {buyer,order,grant};
  };
  const id=draft.campaign.id,path=publicationBase+'/'+id;
  const intent=()=>({revision:1,requestKey:publicationKey(),scheduledAt:null});
  const publish=input=>f.merchant(path+'/publish',input||intent(),{method:'POST'});
  const action=(kind,revision=0,scheduledAt=null,requestKey=publicationKey())=>f.merchant(path+'/publication-action',{kind,revision,scheduledAt,requestKey},{method:'POST'});
  return {...f,bindings,env:{...bindings,DB:f.db},values,id,path,addBuyer,intent,publish,action};
}
