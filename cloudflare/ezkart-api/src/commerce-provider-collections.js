import {commerceEnvironment,commerceHash} from './commerce-orders.js';
import {providerFinancialMapping} from './commerce-provider-evidence.js';

const fail=(message,status=422)=>{throw new Response(message,{status});};
const types=['DOKU_MERCHANT_IDR','DOKU_MERCHANT_PENDING_IDR'];
const fields=(input,allowed)=>{if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!allowed.includes(key)))fail('Provider collection parameters are invalid');};
function query(url,allowed){const input={};for(const [key,value] of url.searchParams){if(!allowed.includes(key)||key in input)fail('Provider collection query is invalid');input[key]=value;}return input;}
function scope(env,input){commerceEnvironment(env,input.environment);if(typeof input.seller!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{2,95}$/.test(input.seller))fail('Provider collection store is invalid');}

// All inputs here come from immutable, independently validated observations.
// The caller supplies only their IDs; no completeness, balance or money override.
function validateSources(mapping,rows){
  for(let i=0;i<rows.length;i++){
    const row=rows[i],previous=rows[i-1];
    if(row.enrollment_id!==mapping.id||row.seller_id!==mapping.seller_id||row.commerce_environment!==mapping.commerce_environment
      ||row.credential_fingerprint!==mapping.credential_fingerprint)fail('Provider collection observations belong to another wallet',409);
    if(previous&&(row.sequence<=previous.sequence||row.requested_at<previous.observed_at))fail('Provider collection observations are not sequential');
    if(row.operation!==(i===0||i===rows.length-1?'balance-inquiries':'transaction-history-list'))fail('Provider collection requires balances around both account histories');
  }
  const first=rows[1].data,accounts=new Map([[mapping.cash_account,[]],[mapping.pending_account,[]]]);
  if(first.to>rows[0].requested_at)fail('Provider collection requires a completed history window');
  for(const row of rows.slice(1,-1)){
    const data=row.data,pages=accounts.get(data.accountNo);
    if(!pages||data.from!==first.from||data.to!==first.to||data.pageSize!==first.pageSize)fail('Provider collection history scope changed');
    if(pages.length>=40||data.page!==pages.length||pages.at(-1)?.exhausted)fail('Provider collection history pages are missing or out of order');
    pages.push(data);
  }
  for(const pages of accounts.values()){
    if(!pages.length)fail('Provider collection requires both account histories');
    const seen=new Map();let previous=null;
    for(const page of pages)for(const item of page.items){
      const key=JSON.stringify(item);
      // Identical legs inside a page may be genuine. Across offset pages they
      // make coverage ambiguous; preserve the observations but refuse to seal.
      if(seen.has(key)&&seen.get(key)!==page.page)fail('Provider collection history pages overlap');
      if(previous!==null&&item.dateTime>previous)fail('Provider collection history order changed');
      seen.set(key,page.page);previous=item.dateTime;
    }
  }
}

const select=`SELECT c.*,b.requested_at AS started_at,a.observed_at AS finished_at,
  b.normalized_json AS balance_before,a.normalized_json AS balance_after,
  json_extract(h.normalized_json,'$.from') AS from_at,json_extract(h.normalized_json,'$.to') AS to_at,
  json_extract(h.normalized_json,'$.pageSize') AS page_size
  FROM commerce_provider_financial_collections c
  JOIN commerce_provider_collection_observations bm ON bm.collection_sequence=c.sequence AND bm.position=0
  JOIN commerce_provider_financial_observations b ON b.sequence=bm.observation_sequence
  JOIN commerce_provider_collection_observations am ON am.collection_sequence=c.sequence AND am.role='balance_after'
  JOIN commerce_provider_financial_observations a ON a.sequence=am.observation_sequence
  JOIN commerce_provider_collection_observations hm ON hm.collection_sequence=c.sequence AND hm.position=1
  JOIN commerce_provider_financial_observations h ON h.sequence=hm.observation_sequence`;

async function summarize(env,rows){
  if(!rows.length)return [];
  const coverage=(await env.DB.prepare(`SELECT m.collection_sequence,m.account_type,COUNT(*) AS pages,
    SUM(json_array_length(o.normalized_json,'$.items')) AS rows,MAX(json_extract(o.normalized_json,'$.exhausted')) AS exhausted
    FROM commerce_provider_collection_observations m JOIN commerce_provider_financial_observations o ON o.sequence=m.observation_sequence
    WHERE m.collection_sequence IN (${rows.map(()=>'?').join(',')}) AND m.role='history_page'
    GROUP BY m.collection_sequence,m.account_type`).bind(...rows.map(row=>row.sequence)).all()).results;
  return rows.map(row=>{
    const accounts=Object.fromEntries(coverage.filter(x=>x.collection_sequence===row.sequence).map(x=>[x.account_type,{pages:x.pages,rows:x.rows,exhausted:!!x.exhausted}]));
    if(!types.every(type=>accounts[type]))fail('Provider collection coverage is unavailable',500);
    const before=JSON.parse(row.balance_before).accounts,after=JSON.parse(row.balance_after).accounts;
    return {id:row.id,sequence:row.sequence,window:{from:row.from_at,to:row.to_at},pageSize:row.page_size,
      observationIds:JSON.parse(row.observation_ids_json),coverage:accounts,pagesExhausted:types.every(type=>accounts[type].exhausted),
      balancesChanged:JSON.stringify(before)!==JSON.stringify(after),startedAt:row.started_at,finishedAt:row.finished_at,recordedAt:row.recorded_at,
      atomicSnapshot:false,settlementVerified:false,availableToWithdraw:null};
  });
}

export async function recordProviderFinancialCollection(env,input){
  fields(input,['seller','environment','observationIds']);scope(env,input);
  const ids=input.observationIds;
  if(!Array.isArray(ids)||ids.length<4||ids.length>82||ids.some(id=>typeof id!=='string'||!/^fobs_[a-f0-9]{40}$/.test(id))||new Set(ids).size!==ids.length)fail('Provider collection observation IDs are invalid');
  const mapping=await providerFinancialMapping(env,input),hash=await commerceHash({seller:input.seller,environment:input.environment,observationIds:ids}),id='fcol_'+hash.slice(0,40);
  const existing=await env.DB.prepare(select+' WHERE c.id=?').bind(id).first();
  if(existing)return {collection:(await summarize(env,[existing]))[0],replayed:true};
  const found=(await env.DB.prepare(`SELECT * FROM commerce_provider_financial_observations WHERE id IN (${ids.map(()=>'?').join(',')})`).bind(...ids).all()).results;
  if(found.length!==ids.length)fail('Provider collection observations are missing',409);
  const byId=new Map(found.map(row=>[row.id,{...row,data:JSON.parse(row.normalized_json)}])),rows=ids.map(id=>byId.get(id));
  validateSources(mapping,rows);
  const result=await env.DB.prepare(`INSERT INTO commerce_provider_financial_collections
    (id,enrollment_id,seller_id,commerce_environment,credential_fingerprint,observation_ids_json,proof_hash,recorded_at)
    SELECT ?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM commerce_provider_financial_collections WHERE id=?)`)
    .bind(id,mapping.id,input.seller,input.environment,mapping.credential_fingerprint,JSON.stringify(ids),hash,new Date().toISOString(),id).run();
  const saved=await env.DB.prepare(select+' WHERE c.id=?').bind(id).first();
  if(!saved)fail('Provider collection was not saved',500);
  return {collection:(await summarize(env,[saved]))[0],replayed:result.meta.changes===0};
}

export async function providerFinancialCollections(env,url,id=null){
  const input=query(url,id?['seller','environment']:['seller','environment','limit','before','cap']);scope(env,input);
  if(id){const row=await env.DB.prepare(select+' WHERE c.id=? AND c.seller_id=? AND c.commerce_environment=?').bind(id,input.seller,input.environment).first();
    if(!row)fail('Provider collection was not found',404);return {collection:(await summarize(env,[row]))[0]};}
  if(input.limit!==undefined&&(!/^[1-9][0-9]?$/.test(input.limit)||Number(input.limit)>20))fail('Provider collection page size is invalid');
  for(const key of ['before','cap'])if(input[key]!==undefined&&(!/^[1-9][0-9]{0,15}$/.test(input[key])||!Number.isSafeInteger(Number(input[key]))))fail('Provider collection page reference is invalid');
  const cap=input.cap===undefined?(await env.DB.prepare('SELECT COALESCE(MAX(sequence),0) AS cap FROM commerce_provider_financial_collections WHERE seller_id=? AND commerce_environment=?').bind(input.seller,input.environment).first()).cap:Number(input.cap),size=Number(input.limit||10);
  const result=await env.DB.prepare(select+' WHERE c.seller_id=? AND c.commerce_environment=? AND c.sequence<=? AND c.sequence<? ORDER BY c.sequence DESC LIMIT ?')
    .bind(input.seller,input.environment,cap,Number(input.before||Number.MAX_SAFE_INTEGER),size+1).all();
  const rows=result.results.slice(0,size);
  return {items:await summarize(env,rows),cap,nextBefore:result.results.length>size?rows.at(-1).sequence:null,atomicSnapshot:false,settlementVerified:false,availableToWithdraw:null};
}
