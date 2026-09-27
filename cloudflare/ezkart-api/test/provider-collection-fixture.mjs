import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {setupCommerceFixture} from './commerce-fixture.mjs';
import {seedRoutingWallets} from './payment-routing-fixture.mjs';

export const collectionPath='/internal/commerce/finance/provider-collections';
export async function setupCollectionFixture(t,options={}){
  const f=await setupCommerceFixture(t,options),environment=options.bindings?.APP_ENVIRONMENT==='beta'?'production':'sandbox';
  const enrollments=await seedRoutingWallets(f,{environment});
  const epoch=Date.now()-60000,from=new Date(epoch-3600000).toISOString(),to=new Date(epoch-1000).toISOString();let tick=0;
  const ref=()=>Array.from(randomBytes(32),n=>n%10).join('');
  const time=()=>new Date(epoch+tick++).toISOString();
  const row=(reference='group',changes={})=>({referenceNo:reference,transactionType:'SETTLEMENT_FEE',mutationType:'DEBIT',amount:'9007199254740993',currency:'IDR',status:'SUCCESS',dateTime:from,...changes});
  async function record(operation,request,response,{seller='seller_alice',...extra}={}){
    const at=time(),input={seller,environment,evidence:{environment,credentialFingerprint:'a'.repeat(64),operation,externalId:ref(),requestedAt:at,observedAt:at,
      requestBody:JSON.stringify(request),responseBody:JSON.stringify(response),...extra}};
    const result=await f.call('/internal/commerce/finance/provider-evidence',input);assert.equal(result.status,200,result.error);return result.id;
  }
  const balance=(amount='0',extra={})=>{
    const user=extra.seller==='seller_bob'?'bob':'alice',n=user==='bob'?'2':'1';
    return record('balance-inquiries',{profileId:'SAC-'+user},{responseCode:'2000000',profileId:'SAC-'+user,accounts:[
      {type:'DOKU_MERCHANT_IDR',accountNo:'201000000'+n,currency:'IDR',balance:{available:amount,reserved:'0'}},
      {type:'DOKU_MERCHANT_PENDING_IDR',accountNo:'203000000'+n,currency:'IDR',balance:{available:'0',reserved:'0'}}]},extra);
  };
  const history=(items=[],request={},extra={})=>record('transaction-history-list',{accountNo:'2010000001',fromDateTime:from,toDateTime:to,pageSize:'20',pageNumber:'0',...request},{responseCode:'2000000',detailData:items},extra);
  async function sources({cash=[[]],pending=[[]],after='0'}={}){
    const ids=[await balance()];
    for(const [account,pages] of [['2010000001',cash],['2030000001',pending]])for(const [i,items] of pages.entries())ids.push(await history(items,{accountNo:account,pageNumber:String(i)}));
    ids.push(await balance(after));return ids;
  }
  const input=(observationIds,extra={})=>({seller:'seller_alice',environment,observationIds,...extra});
  const seal=ids=>f.call(collectionPath,input(ids));
  const list=(suffix='')=>f.call(collectionPath+'?seller=seller_alice&environment='+environment+suffix);
  const rawInsert=(ids)=>f.db.prepare(`INSERT INTO commerce_provider_financial_collections(id,enrollment_id,seller_id,commerce_environment,credential_fingerprint,observation_ids_json,proof_hash,recorded_at) VALUES(?,?,?,?,?,?,?,?)`)
    .bind('fcol_'+randomBytes(20).toString('hex'),enrollments.alice,'seller_alice',environment,'a'.repeat(64),JSON.stringify(ids),randomBytes(32).toString('hex'),new Date().toISOString()).run();
  return {...f,environment,enrollments,from,to,row,record,balance,history,sources,input,seal,list,rawInsert};
}
