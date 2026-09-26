import assert from 'node:assert/strict';
import {publicationBase,publicationKey as key} from './campaign-publication-fixture.mjs';

// Historical fixtures retain all publication/candidate/seal/job guards. Their
// timestamps model existing history without changing the runtime publish limits.
export async function historicalCampaign(f,createdAt,{values=f.values}={}){
  const draft=await f.merchant(publicationBase,{id:null,revision:0,requestKey:key(),values},{method:'POST'});assert.equal(draft.status,200,JSON.stringify(draft));
  const id='cpub_'+key(),campaignId=draft.campaign.id,source=await f.db.prepare('SELECT * FROM commerce_campaign_publications ORDER BY rowid LIMIT 1').first();assert(source);
  await f.db.batch([
    f.db.prepare(`INSERT INTO commerce_campaign_publications(id,campaign_id,seller_id,commerce_environment,actor_id,request_key,request_hash,campaign_revision,data_json,store_name,shop_enabled,order_cap,scheduled_at,created_at)
      SELECT ?,?,seller_id,commerce_environment,actor_id,?,?,1,?,store_name,shop_enabled,order_cap,?,? FROM commerce_campaign_publications WHERE id=?`)
      .bind(id,campaignId,key(),'a'.repeat(64),JSON.stringify(values),createdAt,createdAt,source.id),
    f.db.prepare(`INSERT INTO commerce_campaign_candidates(publication_id,customer_id,order_id,auth_user_id,email,name,consent_revision,created_at)
      SELECT ?,customer_id,order_id,auth_user_id,email,name,consent_revision,? FROM commerce_campaign_candidates WHERE publication_id=?`).bind(id,createdAt,source.id),
    f.db.prepare('INSERT INTO commerce_campaign_seals VALUES (?,?,?)').bind(id,(await f.db.prepare('SELECT candidate_count FROM commerce_campaign_seals WHERE publication_id=?').bind(source.id).first()).candidate_count,createdAt)
  ]);return {id,campaignId};
}
