import {settingsActor} from './merchant-settings.js';
import {commerceHash} from './commerce-orders.js';
import {collectJevEvidence} from './jev-evidence.js';
import {seedJevPageRevision} from './jev-page-state.js';
const fail=(message,status=422)=>{throw new Response(message,{status});};
async function access(env,actor){if(actor.kind!=='merchant')fail('Alert not found.',404);await settingsActor(env,actor);}
const holds=`jev_page_holds h JOIN jev_reviews original ON original.id=h.review_id JOIN jev_cases c ON c.id=original.case_id`;
export async function sellerAlertCount(env,actor){if(actor.kind!=='merchant')return 0;await access(env,actor);return (await env.DB.prepare(`SELECT COUNT(*) n FROM ${holds} WHERE h.seller_id=? AND c.evaluation_only=0`).bind(actor.sellerId).first()).n;}
export async function sellerAlerts(env,actor){
 await access(env,actor);
 const rows=await env.DB.prepare(`SELECT c.id,c.page_id,c.deadline_at,h.reason,h.created_at,r.id review_id,r.ordinal,r.revision,z.state,
 z.outcome_json,originalResult.outcome_json original_outcome
 FROM ${holds} JOIN jev_reviews r ON r.case_id=c.id AND r.ordinal=(SELECT MAX(n.ordinal) FROM jev_reviews n WHERE n.case_id=c.id)
 LEFT JOIN jev_results z ON z.review_id=r.id LEFT JOIN jev_results originalResult ON originalResult.review_id=original.id
 WHERE h.seller_id=? AND c.evaluation_only=0 ORDER BY h.sequence DESC`).bind(actor.sellerId).all();
 const items=[];
 for(const row of rows.results){
  const object=await env.PRIVATE_ASSETS.get(`sellers/${actor.sellerId}/landing-pages/${row.page_id}.json`);
  const p=object&&object.size<=16000000?await object.json():null;
  const findings=JSON.parse(row.original_outcome||'null')?.findings||[];
  const outcome=JSON.parse(row.outcome_json||'null'),needsChange=outcome?.verdict==='needs_change';
  const due=Date.parse(row.deadline_at)<=Date.now(),remaining=Math.max(0,3-row.ordinal),changed=!!object&&object.etag!==row.revision;
  items.push({id:row.id,kind:'landing_page',pageId:row.page_id,name:p?.name||row.page_id,reason:row.reason,createdAt:row.created_at,deadlineAt:row.deadline_at,
   findings:findings.map(f=>({quote:f.quote,explanation:f.explanation})),rescanCount:row.ordinal,remainingRescans:remaining,revision:object?.etag||null,
   state:due||!remaining?'human_review':!row.state?'rescan_queued':row.state==='completed'&&needsChange?'changes_required':'human_review',
   canRescan:!due&&remaining>0&&changed&&row.state==='completed'&&needsChange,
   href:'/cart/admin/?page=alerts&alert='+encodeURIComponent(row.id),editHref:'/cart/admin/?page=sites&edit='+encodeURIComponent(row.page_id+'.ezkart.site')});
 }
 await access(env,actor);return {items};
}
export async function sellerAlertRescan(env,actor,input){
 await access(env,actor);
 if(!input||Object.keys(input).some(k=>!['id','requestKey','expectedRevision'].includes(k))||!/^jcase_[a-f0-9]{32}$/.test(input.id||'')||!/^[a-f0-9]{32}$/.test(input.requestKey||'')||typeof input.expectedRevision!=='string'||input.expectedRevision.length>100)fail('Reload this alert before requesting a re-scan.');
 const hash=await commerceHash({actor:actor.id,seller:actor.sellerId,input});
 const old=await env.DB.prepare('SELECT request_hash FROM jev_reviews WHERE request_key=?').bind(input.requestKey).first();
 if(old){if(old.request_hash!==hash)fail('The original request has different details.',409);return {queued:true,...await sellerAlerts(env,actor)};}
 const alert=(await sellerAlerts(env,actor)).items.find(a=>a.id===input.id);if(!alert)fail('Alert not found.',404);
 if(!alert.canRescan)fail('Save your changes first, or wait for the current review. The deadline and three-request limit still apply.',409);
 if(alert.revision!==input.expectedRevision)fail('The page changed. Reload this alert.',409);
 const parent=await env.DB.prepare('SELECT r.*,c.store_slug FROM jev_reviews r JOIN jev_cases c ON c.id=r.case_id WHERE c.id=? AND c.seller_id=? ORDER BY r.ordinal DESC LIMIT 1').bind(input.id,actor.sellerId).first();
 const object=await env.PRIVATE_ASSETS.get(`sellers/${actor.sellerId}/landing-pages/${alert.pageId}.json`);
 if(!object||object.etag!==input.expectedRevision||object.size>16000000)fail('The saved page changed or cannot be reviewed. Reload this alert.',409);
 const rid='jev_'+crypto.randomUUID().replaceAll('-',''),p={value:await object.json(),revision:object.etag};
 const snapshot=await collectJevEvidence(env,p,{id:actor.sellerId,pageSlug:parent.store_slug},alert.pageId,rid);
 snapshot.reportReason=JSON.parse(parent.snapshot_json).reportReason||'other';
 await seedJevPageRevision(env,actor.sellerId,alert.pageId,p.revision);await access(env,actor);
 try{await env.DB.prepare(`INSERT INTO jev_reviews(id,case_id,ordinal,request_key,request_hash,revision,snapshot_json,report_text,policy_version,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).bind(rid,input.id,parent.ordinal+1,input.requestKey,hash,p.revision,JSON.stringify(snapshot),parent.report_text,parent.policy_version,actor.id,new Date().toISOString()).run();}
 catch(e){if(/jev_|UNIQUE/.test(String(e)))fail('The review changed. Reload this alert before continuing.',409);throw e;}
 return {queued:true,...await sellerAlerts(env,actor)};
}
