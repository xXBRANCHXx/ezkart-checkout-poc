import {emailFixtureConfiguration} from './email-fixture.mjs';
export const campaignMailConfiguration=()=>({...emailFixtureConfiguration(),COMMERCE_CAMPAIGN_SEND:'enabled'});
export const campaignMailId='campmail_'+'a'.repeat(32);
export const campaignMailLink='https://test.ezkart.id/cart/unsubscribe.php?t='+'b'.repeat(64);
export const campaignMailKey='ezkart_campaign/sandbox/'+campaignMailId;
export const campaignMailSource=()=>({sellerId:'seller_alice',storeName:'Jasmine & Co',shopEnabled:true,values:{name:'Autumn tea collection',subject:'Make time for a cup',preheader:'A small moment for yourself',heading:'Your everyday ritual',body:'Fresh tea for slow mornings.\n\nPacked with care.',buttonLabel:'Explore the store',plannedAt:null,
  audience:{q:'',activity:'all',minSpend:'',minOrders:'',maxOrders:'',lastFrom:'',lastTo:'',location:'',tag:''},archived:false}});
