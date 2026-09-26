import {commerceHash} from './commerce-orders.js';
import {commerceReadEnvironment} from './commerce-order-reads.js';

const fail=(message='This campaign link is unavailable.',status=404)=>{throw new Response(message,{status});};
const hex=bytes=>Array.from(bytes,v=>v.toString(16).padStart(2,'0')).join('');
export const campaignVisitHash=(token,environment)=>commerceHash({purpose:'campaign_visit',token,environment});
export const campaignLinkUrl=(environment,code)=>'https://'+(environment==='sandbox'?'test.ezkart.id':'ezkart.id')+'/cart/campaign.php?c='+code;
export async function campaignMailLink(env,publicationId){
  const row=await env.DB.prepare('SELECT code FROM commerce_campaign_links WHERE publication_id=?').bind(publicationId).first();
  if(!row)fail('The published campaign link is unavailable.',503);return campaignLinkUrl(commerceReadEnvironment(env),row.code);
}
export async function campaignLink(env,request){
  const url=new URL(request.url),mode=commerceReadEnvironment(env);
  if(!['GET','HEAD'].includes(request.method))fail('Method not allowed.',405);
  if([...url.searchParams.keys()].length!==1||!url.searchParams.has('c')||!/^[a-f0-9]{64}$/.test(url.searchParams.get('c')))fail();
  const read=()=>env.DB.prepare('SELECT * FROM commerce_campaign_visit_sources WHERE code=? AND commerce_environment=?').bind(url.searchParams.get('c'),mode).first();
  const source=await read();if(!source)fail();
  const view={storeId:source.seller_id,environment:mode,visit:null,expiresAt:null};if(request.method==='HEAD')return view;
  const token=hex(crypto.getRandomValues(new Uint8Array(32))),hash=await campaignVisitHash(token,mode),created=new Date().toISOString(),expires=new Date(Date.parse(created)+7*86400000).toISOString();
  const saved=()=>env.DB.prepare('SELECT token_hash FROM commerce_campaign_visits WHERE token_hash=?').bind(hash).first();
  try{
    await env.DB.prepare(`INSERT INTO commerce_campaign_visits(token_hash,publication_id,seller_id,commerce_environment,created_at,expires_at) VALUES(?,?,?,?,?,?)`)
      .bind(hash,source.publication_id,source.seller_id,mode,created,expires).run();
  }catch(error){
    if(await saved()){if(!await read())fail();return {...view,visit:token,expiresAt:expires};}
    const detail=String(error)+' '+String(error.cause||'');if(detail.includes('campaign_visit_unavailable'))fail();
    if(!detail.includes('campaign_visit_rate'))throw error;
    const bucket=created.slice(0,13)+':00:00.000Z';
    // A protection limit drops measurement, never the customer's store visit.
    // Its aggregate is separate so reports can show the coverage limitation.
    await env.DB.batch([
      env.DB.prepare('UPDATE commerce_campaign_visit_buckets SET limited=limited+1,updated_at=MAX(updated_at,?) WHERE publication_id=? AND bucket=?').bind(created,source.publication_id,bucket),
      env.DB.prepare(`INSERT INTO commerce_campaign_visit_buckets(publication_id,seller_id,commerce_environment,bucket,recorded,limited,updated_at)
        SELECT ?,?,?,?,0,1,? WHERE NOT EXISTS(SELECT 1 FROM commerce_campaign_visit_buckets WHERE publication_id=? AND bucket=?)`).bind(source.publication_id,source.seller_id,mode,bucket,created,source.publication_id,bucket)
    ]);
    if(!await read())fail();return view;
  }
  if(!await read())fail();return {...view,visit:token,expiresAt:expires};
}
export async function cleanupCampaignVisits(env){
  await env.DB.prepare("DELETE FROM commerce_campaign_visits WHERE rowid IN (SELECT rowid FROM commerce_campaign_visits WHERE expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') ORDER BY expires_at LIMIT 5000)").run();
}
