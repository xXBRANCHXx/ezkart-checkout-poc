import {commerceEnvironment} from './commerce-orders.js';

const fail=(message,status=422)=>{throw new Response(message,{status});};
const identifier=/^[A-Za-z0-9][A-Za-z0-9_-]{2,95}$/;
function fields(input,allowed){if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!allowed.includes(key)))fail('Financial parameters are invalid');}
function limit(value,maximum=100){if(!Number.isInteger(value)||value<1||value>maximum)fail('Financial page size is invalid');return value;}
function query(url,allowed){
  const input={};for(const [key,value] of url.searchParams){if(!allowed.includes(key)||key in input)fail('Financial parameters are invalid');input[key]=value;}
  return input;
}
function scope(env,input){commerceEnvironment(env,input.environment);if(!identifier.test(input.seller||''))fail('Store is invalid');return [input.seller,input.environment];}

// Catch up real immutable capture records in a bounded transaction. There are no
// amounts or fee overrides in this operation, and it cannot create payments.
export async function reconcileCaptureJournals(env,input){
  fields(input,['environment','limit']);commerceEnvironment(env,input.environment);const batchSize=limit(input.limit??50);
  const result=await env.DB.batch([
    env.DB.prepare(`INSERT INTO commerce_financial_journals
      (id,seller_id,order_id,capture_id,commerce_environment,currency,kind,allocation_state,source_json,lines_json,occurred_at,posted_at)
      SELECT 'financial_'||c.capture_id,c.seller_id,c.order_id,c.capture_id,c.commerce_environment,c.currency,'capture',c.allocation_state,c.source_json,c.lines_json,c.occurred_at,?
      FROM commerce_capture_accounting c WHERE c.commerce_environment=?
        AND NOT EXISTS (SELECT 1 FROM commerce_financial_journals j WHERE j.capture_id=c.capture_id AND j.kind='capture')
      ORDER BY c.capture_id LIMIT ? ON CONFLICT(capture_id) WHERE kind='capture' DO NOTHING`).bind(new Date().toISOString(),input.environment,batchSize),
    env.DB.prepare(`SELECT COUNT(*) AS remaining FROM commerce_payment_captures c WHERE c.commerce_environment=?
      AND NOT EXISTS (SELECT 1 FROM commerce_financial_journals j WHERE j.capture_id=c.id AND j.kind='capture')`).bind(input.environment),
  ]);
  return {remaining:result[1].results[0].remaining,complete:result[1].results[0].remaining===0};
}

export async function financialJournalSummary(env,url){
  const input=query(url,['seller','environment']),values=scope(env,input);
  const result=await env.DB.batch([
    env.DB.prepare(`SELECT COUNT(*) AS captures,COUNT(j.sequence) AS posted,
      COALESCE(SUM(j.allocation_state='unallocated'),0) AS unallocated,COALESCE(SUM(j.allocation_state='duplicate'),0) AS additional,
      CAST(COALESCE(SUM(c.amount),0) AS TEXT) AS captured
      FROM commerce_payment_captures c LEFT JOIN commerce_financial_journals j ON j.capture_id=c.id AND j.kind='capture'
      WHERE c.seller_id=? AND c.commerce_environment=?`).bind(...values),
    env.DB.prepare(`SELECT e.account,CAST(SUM(e.amount) AS TEXT) AS amount FROM commerce_financial_entries e
      JOIN commerce_financial_journals j ON j.sequence=e.journal_sequence WHERE j.seller_id=? AND j.commerce_environment=? GROUP BY e.account`).bind(...values),
    env.DB.prepare(`SELECT COUNT(*) AS invalid FROM commerce_financial_journals j WHERE j.seller_id=? AND j.commerce_environment=?
      AND ((SELECT COUNT(*) FROM commerce_financial_entries e WHERE e.journal_sequence=j.sequence)!=json_array_length(j.lines_json)
        OR (SELECT COALESCE(SUM(e.amount),1) FROM commerce_financial_entries e WHERE e.journal_sequence=j.sequence)!=0)`).bind(...values),
    env.DB.prepare(`SELECT r.state,COUNT(*) AS count FROM commerce_settlement_assessments a
      JOIN commerce_settlement_results r ON r.assessment_sequence=a.sequence
      WHERE a.seller_id=? AND a.commerce_environment=? AND NOT EXISTS(
        SELECT 1 FROM commerce_settlement_assessments newer WHERE newer.capture_id=a.capture_id AND newer.sequence>a.sequence)
      GROUP BY r.state`).bind(...values),
  ]);
  const row=result[0].results[0],accounts=Object.fromEntries(result[1].results.map(row=>[row.account,row.amount]));
  const settlementAccounting={assessed:0,settled:0,voided:0,unresolved:0};
  for(const state of result[3].results){settlementAccounting[state.state]=state.count;settlementAccounting.assessed+=state.count;}
  return {currency:'IDR',captures:row.captures,posted:row.posted,unposted:row.captures-row.posted,unallocated:row.unallocated,
    additionalPayments:row.additional,capturedGross:row.captured,accounts,
    accountingComplete:row.captures===row.posted&&result[2].results[0].invalid===0,
    balanced:result[2].results[0].invalid===0,
    // These are saved interpretations, not a current spendable balance. Protected
    // actions must also check each order's latest provider evidence and holds.
    settlementAccounting,availableToWithdraw:null,settlementConnected:settlementAccounting.assessed>0};
}

export async function financialJournalList(env,url){
  const input=query(url,['seller','environment','limit','before','cap']),values=scope(env,input);
  if(input.limit!==undefined&&!/^[1-9][0-9]?$/.test(input.limit))fail('Financial page size is invalid');
  const size=input.limit===undefined?20:limit(Number(input.limit),50);
  for(const key of ['before','cap'])if(input[key]!==undefined&&(!/^[1-9][0-9]{0,15}$/.test(input[key])||!Number.isSafeInteger(Number(input[key]))))fail('Financial page reference is invalid');
  const cap=input.cap===undefined?(await env.DB.prepare('SELECT COALESCE(MAX(sequence),0) AS cap FROM commerce_financial_journals WHERE seller_id=? AND commerce_environment=?').bind(...values).first()).cap:Number(input.cap);
  const data=await env.DB.prepare(`SELECT sequence,id,order_id,capture_id,kind,allocation_state,source_json,lines_json,occurred_at,posted_at
    FROM commerce_financial_journals WHERE seller_id=? AND commerce_environment=? AND sequence<=? AND sequence<? ORDER BY sequence DESC LIMIT ?`)
    .bind(...values,cap,input.before===undefined?Number.MAX_SAFE_INTEGER:Number(input.before),size+1).all();
  const rows=data.results.slice(0,size);
  return {items:rows.map(row=>({sequence:row.sequence,id:row.id,orderId:row.order_id,captureId:row.capture_id,kind:row.kind,
    allocationState:row.allocation_state,source:JSON.parse(row.source_json),entries:JSON.parse(row.lines_json).map(line=>({...line,amount:String(line.amount)})),
    occurredAt:row.occurred_at,postedAt:row.posted_at})),cap,nextBefore:data.results.length>size?rows.at(-1).sequence:null};
}
