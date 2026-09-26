import {campaignDeliveryFixture} from './campaign-delivery-fixture.mjs';
import {publicationKey} from './campaign-publication-fixture.mjs';
export const automationBase='/v1/commerce/marketing/automations',automationKey=publicationKey;
export async function automationFixture(t,options={}){
  const f=await campaignDeliveryFixture(t,{...options,bindings:{COMMERCE_MARKETING_AUTOMATIONS:'enabled',...options.bindings}});
  const {plannedAt,archived,...copy}=f.values,values={...copy,trigger:'paid',delayMinutes:0,cooldownDays:7};
  const save=(input={},options={})=>f.merchant(automationBase,{id:null,revision:0,requestKey:publicationKey(),values,...input},{method:'POST',...options});
  const action=(rule,kind,requestKey=publicationKey(),options={})=>f.merchant(automationBase+'/'+rule.id+'/action',{revision:rule.revision,kind,requestKey},{method:'POST',...options});
  const events=async()=>(await f.db.prepare('SELECT * FROM commerce_marketing_events ORDER BY sequence').all()).results;
  return {...f,env:{APP_ENVIRONMENT:'test',COMMERCE_STORAGE:'d1',...f.env},automationValues:values,save,action,events};
}
