import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {prepareCampaignUnsubscribe} from '../src/campaign-unsubscribe.js';
export const unsubscribeBuyer={id:'fixture-google-customer',email:'buyer@example.test'},unsubscribeKey=()=>randomBytes(16).toString('hex');
export const unsubscribeEnvironment=f=>({DB:f.db,APP_ENVIRONMENT:'test',COMMERCE_STORAGE:'d1'});
export async function grantCampaignConsent(f,{buyer=unsubscribeBuyer,sellerId='seller_alice',revision=0,allow=true,name='alice'}={}){
 const input={environment:'sandbox',customer:buyer,action:'save',sellerId,email:buyer.email,revision,allow,requestKey:unsubscribeKey(),policyVersion:'email-promotions-v1',
  statement:`I agree to receive promotional emails from ${name} at ${buyer.email}. I can stop these emails in Email preferences at any time. This choice does not affect order and delivery updates.`};
 const result=await f.call('/internal/commerce/customer-consents',input);assert.equal(result.status,200,result.error);return {input,result};
}
export async function prepareUnsubscribeFixture(f,{buyer=unsubscribeBuyer,sellerId='seller_alice',revision=1,reference='campaign-'+unsubscribeKey()}={}){
 const link=await prepareCampaignUnsubscribe(unsubscribeEnvironment(f),{sellerId,authUserId:buyer.id,email:buyer.email,reference,consentRevision:revision});
 return {...link,token:new URL(link.url).searchParams.get('t'),path:'/v1/public/campaign-unsubscribe'+new URL(link.url).search};
}
export async function unsubscribeFixtureOrder(f,buyer=unsubscribeBuyer,options={}){
 const made=await f.create(f.input({customer:{name:'Email recipient',email:buyer.email,phone:'081234567890',authUserId:buyer.id},...options}));assert.equal(made.status,200,made.error);return made.order;
}
