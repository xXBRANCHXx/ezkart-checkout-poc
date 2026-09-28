import {commerceEnvironment} from './commerce-orders.js';
import {withdrawalEvidenceDate as date,withdrawalEvidenceText as text,withdrawalEvidenceJSON as wire,withdrawalEvidenceHash as hash} from './commerce-withdrawal-inquiries.js';
import {parseFinancialEvidenceJSON} from './financial-evidence-json.js';

const fail=(message,status=422)=>{throw new Response(message,{status});};
const fields=(input,allowed)=>{if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!allowed.includes(k)))fail('Treasury status parameters are invalid');};
const evidenceFields=['environment','credentialFingerprint','operation','externalId','requestedAt','observedAt','requestBody','responseBody'];
function scope(env,environment){commerceEnvironment(env,environment);if(!['test','beta'].includes(env.APP_ENVIRONMENT))fail('Treasury observations are not enabled on this deployment',503);}
const grant=(env,id,environment)=>env.DB.prepare("SELECT * FROM commerce_treasury_bank_grants WHERE intent_id=? AND stage='payment' AND commerce_environment=?").bind(id,environment).first();

async function validate(g,e){
  fields(e,evidenceFields);
  const original=JSON.parse(g.request_body);
  if(Object.keys(e).length!==8||evidenceFields.some(k=>typeof e[k]!=='string')||e.environment!==g.commerce_environment
    ||e.credentialFingerprint!==g.credential_fingerprint||e.operation!=='transactions-status'||!/^[0-9]{32}$/.test(e.externalId)
    ||e.requestBody!==wire({partnerReferenceNo:original.partnerReferenceNo})||new TextEncoder().encode(e.responseBody).length>16000)
    fail('Status evidence differs from the original payment',409);
  const sent=date(e.requestedAt),observed=date(e.observedAt);
  if(sent>observed||Date.parse(sent)<Date.parse(g.created_at)-300000||Date.parse(observed)>Date.parse(sent)+300000
    ||Date.parse(observed)>Date.now()+300000)fail('Status observation time is invalid');
  let r;try{r=parseFinancialEvidenceJSON(e.responseBody);}catch{fail('Status JSON is invalid or ambiguous');}
  if(!r||typeof r!=='object'||Array.isArray(r)||typeof r.responseCode!=='string'||!/^200[0-9]{4}$/.test(r.responseCode)
    ||!['00','03','04','05','06'].includes(r.latestTransactionStatus))fail('Provider status was not confirmed');
  if(r.partnerReferenceNo!==original.partnerReferenceNo||r.amount?.value!==original.amount.value||r.amount?.currency!=='IDR')
    fail('Status response does not match the original reference and amount',409);
  const type=text(r.transactionType,32),description=r.latestTransactionDesc===undefined||r.latestTransactionDesc===''?'':text(r.latestTransactionDesc,32);
  const refunds=r.refundHistory===undefined?[]:r.refundHistory;
  if(!Array.isArray(refunds)||refunds.length>1000)fail('Status refund context is invalid');
  // Refund details are preserved as provider context, never interpreted as a bank
  // payout reversal or authorization to cancel/release the reservation.
  const processed=date(r.transactionDate);
  if(Date.parse(processed)<Date.parse(g.created_at)-300000||Date.parse(processed)>Date.parse(observed)+300000)fail('Status transaction time is invalid');
  const evidence=JSON.stringify(Object.fromEntries(evidenceFields.map(k=>[k,e[k]])));
  const digest=await hash('ezkart.doku.treasury-status.v1\n'+wire([g.intent_id,g.confirmation_id,...evidenceFields.map(k=>e[k])]));
  const id='trystatus_'+(await hash(wire([g.commerce_environment,g.client_id,sent.slice(0,10),e.externalId]))).slice(0,40);
  return {id,digest,evidence,sent,observed,processed,type,description,code:r.latestTransactionStatus,refunds:refunds.length};
}

export async function saveTreasuryStatus(env,id,input){
  fields(input,['environment','evidence']);scope(env,input.environment);
  const g=await grant(env,id,input.environment);if(!g)fail('Original payment dispatch was not found',404);
  const data=await validate(g,input.evidence);
  const read=()=>env.DB.prepare('SELECT * FROM commerce_treasury_status_observations WHERE id=?').bind(data.id).first();
  const reply=replayed=>({recorded:true,replayed,statusDigest:data.digest,mayPay:false,payoutConfirmed:false});
  const replay=saved=>{if(saved.intent_id!==id||saved.evidence_json!==data.evidence||saved.evidence_digest!==data.digest)
    fail('This provider status request already has different evidence',409);return reply(true);};
  const prior=await read();if(prior)return replay(prior);
  try{
    await env.DB.prepare(`INSERT INTO commerce_treasury_status_observations(id,intent_id,commerce_environment,credential_fingerprint,client_id,
      provider_day,external_id,evidence_digest,evidence_json,transaction_type,status_code,description,refund_count,requested_at,observed_at,processed_at,recorded_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))`)
      .bind(data.id,id,input.environment,g.credential_fingerprint,g.client_id,data.sent.slice(0,10),input.evidence.externalId,data.digest,data.evidence,
        data.type,data.code,data.description,data.refunds,data.sent,data.observed,data.processed).run();
  }catch(error){const saved=await read();if(saved)return replay(saved);if(/treasury_status_|UNIQUE constraint/.test(String(error)))fail('Status receipt conflicts with original evidence',409);throw error;}
  return reply(false);
}

// Arrival order is not provider observation order. The current frontier includes
// every read which no definitely-later read has superseded. Contradictory
// overlapping reads, terminal regressions and unsupported contexts need review.
export async function treasuryStatusSummaries(env,ids){
  if(!ids.length)return new Map();
  const rows=(await env.DB.prepare(`WITH observations AS (
    SELECT *,ROW_NUMBER() OVER(PARTITION BY intent_id ORDER BY requested_at DESC,observed_at DESC,sequence DESC) AS rank,
      MAX(requested_at) OVER(PARTITION BY intent_id) AS newest_start,
      MIN(CASE WHEN status_code IN ('00','06') THEN observed_at END) OVER(PARTITION BY intent_id) AS first_terminal_end
    FROM commerce_treasury_status_observations WHERE intent_id IN (${ids.map(()=>'?').join(',')})
  ) SELECT intent_id,COUNT(*) AS count,
    MAX(CASE WHEN rank=1 THEN status_code END) AS code,MAX(observed_at) AS checked_at,
    MAX(CASE WHEN rank=1 THEN transaction_type END) AS type,
    MAX(CASE WHEN transaction_type!='PAYOUT' OR status_code NOT IN ('00','03','06') OR refund_count>0 OR lower(description) IN ('void','voided') THEN 1 ELSE 0 END) AS unsupported,
    COUNT(DISTINCT CASE WHEN status_code IN ('00','06') THEN status_code END) AS terminal_count,
    COUNT(DISTINCT CASE WHEN observed_at>=newest_start THEN transaction_type||':'||status_code END) AS frontier_count,
    MAX(CASE WHEN status_code='03' AND requested_at>first_terminal_end THEN 1 ELSE 0 END) AS regression
    FROM observations GROUP BY intent_id`).bind(...ids).all()).results;
  return new Map(rows.map(row=>{
    const reason=row.unsupported?'unsupported_outcome':row.terminal_count>1?'conflicting_terminal_results':row.regression?'terminal_regression':row.frontier_count>1?'overlapping_results':null;
    return [row.intent_id,{state:reason?'review':({'00':'reported_success','03':'reported_pending','06':'reported_failed'}[row.code]),
      reason,checkedAt:row.checked_at,observations:row.count,reconciliationRequired:true,payoutConfirmed:false}];
  }));
}

export async function treasuryStatusHistory(env,id,input){
  fields(input,['environment','before','cap','limit']);scope(env,input.environment);
  if(!await grant(env,id,input.environment))fail('Original payment dispatch was not found',404);
  for(const key of ['before','cap'])if(input[key]!==undefined&&(!Number.isSafeInteger(input[key])||input[key]<1))fail('Status history boundary is invalid');
  if(input.limit!==undefined&&(!Number.isInteger(input.limit)||input.limit<1||input.limit>50))fail('Status history size is invalid');
  const limit=input.limit??20,cap=input.cap??(await env.DB.prepare('SELECT COALESCE(MAX(sequence),0) AS n FROM commerce_treasury_status_observations WHERE intent_id=?').bind(id).first()).n;
  const rows=(await env.DB.prepare(`SELECT sequence,id,evidence_digest AS digest,evidence_json,requested_at AS requestedAt,observed_at AS observedAt,
    recorded_at AS recordedAt FROM commerce_treasury_status_observations WHERE intent_id=? AND sequence<=? AND sequence<? ORDER BY sequence DESC LIMIT ?`)
    .bind(id,cap,input.before??Number.MAX_SAFE_INTEGER,limit+1).all()).results;
  return {items:rows.slice(0,limit).map(({evidence_json,...row})=>({...row,evidence:JSON.parse(evidence_json)})),cap,nextBefore:rows.length>limit?rows[limit-1].sequence:null,
    status:(await treasuryStatusSummaries(env,[id])).get(id)||null,mayPay:false,payoutConfirmed:false};
}
