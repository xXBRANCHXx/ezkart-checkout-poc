// Isolated test-only verifier adapter. Production keeps its trusted view empty.
// Financial protocol fixtures get actual declared profiles, pinned addresses,
// bank revisions and separately authenticated fixture evidence, never a bypass.
import {sellerOnboarding} from '../src/seller-onboarding.js';
import {saveShippingSettings} from '../src/shipping-settings.js';
export async function seedVerifiedOnboarding(db,seller='alice'){
 const env={DB:db,APP_ENVIRONMENT:'beta'},id='seller_'+seller,actor={id:seller,email:seller+'@example.test',proofExpiresAt:new Date(Date.now()+550000).toISOString()};
 await db.prepare('UPDATE app_users SET email=? WHERE auth_user_id=?').bind(actor.email,seller).run();
 const existing=await db.prepare('SELECT * FROM seller_shipping_settings WHERE seller_id=?').bind(id).first();
 let config=existing?JSON.parse(existing.configuration_json):null;
 if(!config){const address={id:'addr_'+'a'.repeat(32),label:'Fixture warehouse',name:'Fixture owner',phone:'081234567890',email:'',organization:'',address:'Jalan Fixture Warehouse 18',location:'Jakarta',postalCode:'54321',note:'',coordinate:{latitude:-6.2,longitude:106.8}};config={addresses:[address],pickupAddressId:address.id,returnAddressId:address.id,couriers:['jne']};await saveShippingSettings(env,{sellerId:id,id:seller,role:'owner'},{revision:0,requestKey:crypto.randomUUID().replaceAll('-',''),configuration:config});}
 const shipping=await db.prepare('SELECT revision FROM seller_shipping_settings WHERE seller_id=?').bind(id).first();
 const base={environment:'production',seller:id,actor};
 await sellerOnboarding(env,{...base,action:'profile',revision:0,requestKey:crypto.randomUUID().replaceAll('-',''),legalName:'Fixture '+seller,birthDate:'1990-01-01',phone:'081234567890'});
 await sellerOnboarding(env,{...base,action:'bank',revision:0,requestKey:crypto.randomUUID().replaceAll('-',''),bank:{code:'CENAIDJA',accountNumber:'001234567890',channel:'BI_FAST'}});
 await sellerOnboarding(env,{...base,action:'confirm_pins',revision:1,requestKey:crypto.randomUUID().replaceAll('-',''),shippingRevision:shipping.revision});
 await db.prepare('CREATE TABLE IF NOT EXISTS fixture_authenticated_identity(seller_id TEXT,owner_auth_id TEXT,profile_revision INTEGER,verified_age INTEGER,provider_reference TEXT,policy_version TEXT,expires_at TEXT)').run();
 await db.prepare('DROP VIEW seller_authenticated_identity').run();await db.prepare('CREATE VIEW seller_authenticated_identity AS SELECT * FROM fixture_authenticated_identity').run();
 await db.prepare("INSERT INTO fixture_authenticated_identity VALUES(?,?,1,36,'isolated-fixture-reviewed-evidence','owner-18-plus-2026-09-28',?)").bind(id,seller,new Date(Date.now()+86400000).toISOString()).run();
}
