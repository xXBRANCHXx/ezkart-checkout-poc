// Financial fixtures complete the same owner-declared onboarding flow as merchants.
// No fabricated identity evidence and no bypass of production readiness gates.
import {sellerOnboarding} from '../src/seller-onboarding.js';
import {saveShippingSettings} from '../src/shipping-settings.js';
export async function seedDeclaredOnboarding(db,seller='alice'){
 const env={DB:db,APP_ENVIRONMENT:'beta'},id='seller_'+seller,actor={id:seller,email:seller+'@example.test',proofExpiresAt:new Date(Date.now()+550000).toISOString()};
 await db.prepare('UPDATE app_users SET email=? WHERE auth_user_id=?').bind(actor.email,seller).run();
 const existing=await db.prepare('SELECT * FROM seller_shipping_settings WHERE seller_id=?').bind(id).first();
 let config=existing?JSON.parse(existing.configuration_json):null;
 if(!config){const address={id:'addr_'+'a'.repeat(32),label:'Fixture warehouse',name:'Fixture owner',phone:'081234567890',email:'',organization:'',address:'Jalan Fixture Warehouse 18',location:'Jakarta',postalCode:'54321',note:'',coordinate:{latitude:-6.2,longitude:106.8}};config={addresses:[address],pickupAddressId:address.id,returnAddressId:address.id,couriers:['jne']};await saveShippingSettings(env,{sellerId:id,id:seller,role:'owner'},{revision:0,requestKey:crypto.randomUUID().replaceAll('-',''),configuration:config});}
 const shipping=await db.prepare('SELECT revision FROM seller_shipping_settings WHERE seller_id=?').bind(id).first();
 const base={environment:'production',seller:id,actor};
 await sellerOnboarding(env,{...base,action:'profile',revision:0,requestKey:crypto.randomUUID().replaceAll('-',''),legalName:'Fixture '+seller,ageConfirmed:true,birthDate:'1990-01-01',phone:'081234567890'});
 await sellerOnboarding(env,{...base,action:'bank',revision:0,requestKey:crypto.randomUUID().replaceAll('-',''),bank:{code:'CENAIDJA',accountNumber:'001234567890',channel:'BI_FAST'}});
 await sellerOnboarding(env,{...base,action:'confirm_pins',revision:1,requestKey:crypto.randomUUID().replaceAll('-',''),shippingRevision:shipping.revision});
}
