import {commerceEnvironment,commerceHash} from './commerce-orders.js';
import {parseFinancialEvidenceJSON,FinancialJsonNumber} from './financial-evidence-json.js';

const fail=(message,status=422)=>{throw new Response(message,{status});};
const fields=(input,allowed)=>{if(!input||typeof input!=='object'||Array.isArray(input)||input instanceof FinancialJsonNumber||Object.keys(input).some(key=>!allowed.includes(key)))fail('Provider evidence parameters are invalid');};
const scope=(env,input)=>{commerceEnvironment(env,input.environment);if(typeof input.seller!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{2,95}$/.test(input.seller))fail('Provider evidence store is invalid');};
const text=(value,max,empty=false)=>{if(typeof value!=='string'||[...value].length>max||/[\x00-\x1f\x7f]/.test(value)||(!empty&&!value.trim()))fail('Provider evidence fields are invalid');return value;};
const account=value=>{if(typeof value!=='string'||!/^[0-9]{1,10}$/.test(value))fail('Provider account number is invalid');return value;};
function money(value,negative=false){
  const raw=value instanceof FinancialJsonNumber?value.value:value;
  if(typeof raw!=='string')fail('Provider money must be exact');
  const match=/^(-?)(0|[1-9][0-9]{0,18})(?:\.0{1,2})?$/.exec(raw);
  if(!match||(!negative&&match[1])||BigInt(match[2])>9223372036854775807n)fail('Provider money is invalid');
  return match[2]==='0'?'0':match[1]+match[2];
}
function date(value){
  if(typeof value!=='string')fail('Provider evidence date is invalid');
  const match=/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-](?:(?:0\d|1[0-3]):[0-5]\d|14:00))$/.exec(value);
  if(!match)fail('Provider evidence date is invalid');
  const local=Date.parse(match[1]+'Z'),instant=Date.parse(match[1]+match[3]);
  if(!Number.isFinite(local)||!Number.isFinite(instant)||new Date(local).toISOString().slice(0,19)!==match[1])fail('Provider evidence date is invalid');
  const utc=new Date(instant).toISOString();if(!/^\d{4}-/.test(utc))fail('Provider evidence date is outside the supported range');
  return utc.slice(0,19)+'.'+(match[2]||'').padEnd(6,'0')+'Z';
}
function parse(raw){try{return parseFinancialEvidenceJSON(raw);}catch{fail('Provider JSON is invalid or ambiguous');}}
function query(url,allowed){const result={};for(const [key,value] of url.searchParams){if(!allowed.includes(key)||key in result)fail('Provider evidence query is invalid');result[key]=value;}return result;}
export async function providerFinancialMapping(env,input){
  scope(env,input);
  const row=await env.DB.prepare(`SELECT e.id,e.seller_id,e.commerce_environment,p.profile_id,p.cash_account,p.pending_account,b.credential_fingerprint
    FROM commerce_wallet_enrollments e JOIN commerce_wallet_provider_profiles p ON p.enrollment_id=e.id JOIN commerce_wallet_provider_bindings b ON b.enrollment_id=e.id
    WHERE e.seller_id=? AND e.commerce_environment=?`).bind(input.seller,input.environment).first();
  if(!row)fail('A confirmed seller wallet is required before provider evidence can be recorded',409);return row;
}
export async function providerFinancialAccount(env,url){
  const row=await providerFinancialMapping(env,query(url,['seller','environment']));
  return {enrollmentId:row.id,seller:row.seller_id,environment:row.commerce_environment,profileId:row.profile_id,
    cashAccount:row.cash_account,pendingAccount:row.pending_account,credentialFingerprint:row.credential_fingerprint};
}
function balances(row,request,response){
  fields(request,['profileId']);
  if(request.profileId!==row.profile_id||response.profileId!==row.profile_id||!Array.isArray(response.accounts)||response.accounts.length>10)fail('Provider balance response does not match the seller wallet');
  const accounts=[],seen=new Set(),types=new Set();
  for(const entry of response.accounts){
    const number=account(entry?.accountNo instanceof FinancialJsonNumber?entry.accountNo.value:entry?.accountNo);if(seen.has(number))fail('Provider account response is ambiguous');seen.add(number);
    if(['DOKU_MERCHANT_POINT','DOKU_SYSTEM_POINT'].includes(entry.type)&&entry.currency==='POINT')continue;
    const expected=entry.type==='DOKU_MERCHANT_IDR'?row.cash_account:entry.type==='DOKU_MERCHANT_PENDING_IDR'?row.pending_account:null;
    if(!expected||expected!==number||entry.currency!=='IDR'||types.has(entry.type))fail('Provider accounts changed from the confirmed wallet');
    types.add(entry.type);accounts.push({type:entry.type,accountNo:number,currency:'IDR',available:money(entry.balance?.available,true),reserved:money(entry.balance?.reserved,true)});
  }
  if(accounts.length!==2)fail('Both confirmed IDR accounts are required');
  accounts.sort((a,b)=>a.type.localeCompare(b.type));
  return {profileId:row.profile_id,accounts};
}
function history(row,request,response,observedAt){
  fields(request,['accountNo','fromDateTime','toDateTime','pageSize','pageNumber']);
  const number=account(request.accountNo);
  if(![row.cash_account,row.pending_account].includes(number))fail('Provider history does not belong to this seller wallet');
  if(typeof request.pageSize!=='string'||!/^[1-9][0-9]?$/.test(request.pageSize)||Number(request.pageSize)>20
    ||typeof request.pageNumber!=='string'||!/^(0|[1-9][0-9]{0,2})$/.test(request.pageNumber))fail('Provider history page is invalid');
  const from=date(request.fromDateTime),to=date(request.toDateTime),size=Number(request.pageSize);
  if(to<=from||Date.parse(to)-Date.parse(from)>31*86400000||Date.parse(to)>Date.parse(observedAt)+60000)fail('Provider history window is invalid');
  if(!Array.isArray(response.detailData)||response.detailData.length>size)fail('Provider history page is invalid');
  let previous=null;
  const items=response.detailData.map(entry=>{
    if(!entry||entry.currency!=='IDR'||!['CREDIT','DEBIT'].includes(entry.mutationType)||!['SUCCESS','PENDING','FAILED','VOID'].includes(entry.status))fail('Provider transaction is invalid');
    const at=date(entry.dateTime),type=text(entry.transactionType,32);
    if(!/^[A-Z][A-Z0-9_]*$/.test(type)||at<from||at>to||(previous!==null&&at>previous))fail('Provider transaction ordering or scope is invalid');previous=at;
    return {accountNo:number,referenceNo:text(entry.referenceNo,64),partnerReferenceNo:entry.partnerReferenceNo==null?null:text(entry.partnerReferenceNo,64,true),
      transactionType:type,mutationType:entry.mutationType,amount:money(entry.amount),currency:'IDR',status:entry.status,dateTime:at,
      channel:text(entry.channel??'',64,true),remark:text(entry.remark??'',256,true)};
  });
  return {accountNo:number,from,to,page:Number(request.pageNumber),pageSize:size,items,exhausted:items.length<size};
}
export async function recordProviderFinancialEvidence(env,input){
  fields(input,['seller','environment','evidence']);const row=await providerFinancialMapping(env,input),e=input.evidence;
  fields(e,['environment','credentialFingerprint','operation','externalId','requestedAt','observedAt','requestBody','responseBody']);
  if(e.environment!==input.environment||e.credentialFingerprint!==row.credential_fingerprint)fail('Provider evidence credentials do not match the confirmed seller wallet',409);
  if(!['balance-inquiries','transaction-history-list'].includes(e.operation)||typeof e.externalId!=='string'||!/^[0-9]{32}$/.test(e.externalId))fail('Provider evidence request identity is invalid');
  const requested=date(e.requestedAt),observed=date(e.observedAt);
  if(observed<requested||Date.parse(observed)>Date.now()+60000||Date.parse(observed)-Date.parse(requested)>300000)fail('Provider observation times are invalid');
  const request=parse(e.requestBody),response=parse(e.responseBody);
  if(!response||typeof response.responseCode!=='string'||!/^200[0-9]{4}$/.test(response.responseCode))fail('Provider response was not successful');
  const normalized=e.operation==='balance-inquiries'?balances(row,request,response):history(row,request,response,observed),hash=await commerceHash(input);
  const id='fobs_'+hash.slice(0,40),day=requested.slice(0,10);
  const replay=()=>env.DB.prepare(`SELECT id,sequence,evidence_hash FROM commerce_provider_financial_observations WHERE credential_fingerprint=? AND provider_day=? AND external_id=?`)
    .bind(e.credentialFingerprint,day,e.externalId).first();
  const existing=await replay();
  if(existing){if(existing.evidence_hash!==hash)fail('This provider request already has different evidence',409);return {id:existing.id,sequence:existing.sequence,replayed:true};}
  try{
    const result=await env.DB.prepare(`INSERT INTO commerce_provider_financial_observations
      (id,enrollment_id,seller_id,commerce_environment,credential_fingerprint,operation,external_id,provider_day,request_json,response_json,normalized_json,evidence_hash,requested_at,observed_at,received_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING sequence`).bind(id,row.id,input.seller,input.environment,e.credentialFingerprint,e.operation,e.externalId,day,e.requestBody,e.responseBody,
        JSON.stringify(normalized),hash,requested,observed,new Date().toISOString()).first();
    return {id,sequence:result.sequence,replayed:false};
  }catch(error){const saved=await replay();if(saved?.evidence_hash===hash)return {id:saved.id,sequence:saved.sequence,replayed:true};if(saved)fail('This provider request already has different evidence',409);throw error;}
}
export async function providerFinancialEvidenceList(env,url){
  const input=query(url,['seller','environment','limit','before','cap']);scope(env,input);
  if(input.limit!==undefined&&(!/^[1-9][0-9]?$/.test(input.limit)||Number(input.limit)>20))fail('Provider evidence page size is invalid');
  for(const field of ['before','cap'])if(input[field]!==undefined&&(!/^[1-9][0-9]{0,15}$/.test(input[field])||!Number.isSafeInteger(Number(input[field]))))fail('Provider evidence page reference is invalid');
  const cap=input.cap===undefined?(await env.DB.prepare('SELECT COALESCE(MAX(sequence),0) AS cap FROM commerce_provider_financial_observations WHERE seller_id=? AND commerce_environment=?').bind(input.seller,input.environment).first()).cap:Number(input.cap),size=Number(input.limit||10);
  const result=await env.DB.prepare(`SELECT sequence,id,operation,requested_at,observed_at,received_at,normalized_json FROM commerce_provider_financial_observations
    WHERE seller_id=? AND commerce_environment=? AND sequence<=? AND sequence<? ORDER BY sequence DESC LIMIT ?`).bind(input.seller,input.environment,cap,Number(input.before||Number.MAX_SAFE_INTEGER),size+1).all();
  const rows=result.results.slice(0,size);
  return {items:rows.map(row=>({id:row.id,sequence:row.sequence,operation:row.operation,requestedAt:row.requested_at,observedAt:row.observed_at,receivedAt:row.received_at,data:JSON.parse(row.normalized_json)})),
    cap,nextBefore:result.results.length>size?rows.at(-1).sequence:null,settlementVerified:false,availableToWithdraw:null};
}
