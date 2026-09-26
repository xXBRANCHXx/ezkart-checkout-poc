import {readFile} from 'node:fs/promises';

// Catalog fixtures need the same review/order schema as deployed reads. Plan
// limits and legacy-import rehearsal have separate fixtures and migrations.
export const commerceMigrations=['0001_core.sql','0002_cloud_catalog.sql','0003_subscription_plan_billing.sql','0004_yearly_subscription_plans.sql',
  '0008_seller_page_addresses.sql','0009_commerce_orders.sql','0010_catalog_revisions.sql','0011_inventory_adjustments.sql',
  '0012_stock_review_recovery.sql','0013_returns_and_inspection.sql','0014_checkout_payment_sessions.sql','0015_central_fulfillment.sql',
  '0016_seller_shipping_settings.sql','0018_commerce_order_reads.sql','0019_analytics_exports.sql','0020_customer_workspace.sql','0021_customer_consents.sql','0022_purchase_reviews.sql','0023_capture_financial_journal.sql','0024_wallet_enrollment.sql','0025_provider_financial_evidence.sql','0026_commerce_messages.sql','0027_message_access_indexes.sql','0028_merchant_settings.sql','0029_commerce_notifications.sql','0030_commerce_email_delivery.sql','0031_buyer_notification_preferences.sql','0032_email_investigation.sql','0033_marketing_campaigns.sql','0034_campaign_unsubscribe.sql','0035_campaign_publication.sql','0036_campaign_email_delivery.sql'];
export async function applyCommerceSchema(db,after=0,through=Infinity){
  for(const name of commerceMigrations.filter(name=>Number(name.slice(0,4))>after&&Number(name.slice(0,4))<=through)){
    const source=(await readFile(new URL('../migrations/'+name,import.meta.url),'utf8')).replace(/--[^\n]*/g,'');
    const triggers=[...source.matchAll(/CREATE TRIGGER[\s\S]*?END;/g)].map(match=>match[0]);
    for(const statement of [...source.replace(/CREATE TRIGGER[\s\S]*?END;/g,'').split(';').filter(value=>value.trim()),...triggers])await db.prepare(statement).run();
  }
}
