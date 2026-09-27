#!/usr/bin/env node
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {commerceOperationsStatement,commerceOperationsWarnings} from '../../cloudflare/ezkart-api/src/commerce-operations-report.js';

const worker=resolve(dirname(fileURLToPath(import.meta.url)),'../../cloudflare/ezkart-api'),execute=promisify(execFile);
const databases={test:'2595f8c1-3e25-422f-9197-91d50a90e131',beta:'27bb47cf-c0f0-463c-94e3-44b9b27edcf4'};
async function query(sql,deployment){
  try{
    const result=await execute(process.execPath,[join(worker,'node_modules/wrangler/bin/wrangler.js'),'d1','execute',databases[deployment],
      '--env',deployment,'--remote','--command',sql,'--json'],{cwd:worker,maxBuffer:1000000,timeout:120000});
    const data=JSON.parse(result.stdout);
    if(!Array.isArray(data)||data.length!==1||data[0].success!==true||data[0].meta?.rows_written!==0)throw Error();
    return data[0].results;
  }catch{throw Error('The operations inspection was not confirmed. No retry, lease claim or provider action was requested.');}
}
export async function main(args=[],runQuery=query,now=new Date().toISOString()){
  let deployment=null,failOnWarning=false;
  for(const arg of args){
    if(/^--deployment=(test|beta)$/.test(arg)&&deployment===null){deployment=arg.split('=')[1];continue;}
    if(arg==='--fail-on-warning'&&!failOnWarning){failOnWarning=true;continue;}
    throw Error('Usage: node tools/commerce/operations-report.mjs --deployment=test|beta [--fail-on-warning] (read-only)');
  }
  if(!deployment)throw Error('Choose an explicit workbench deployment: --deployment=test or --deployment=beta.');
  const environment=deployment==='test'?'sandbox':'production';
  const rows=await runQuery(commerceOperationsStatement(environment,now),deployment);
  if(!Array.isArray(rows)||rows.length!==1||typeof rows[0].report!=='string')throw Error('The operations report is incomplete.');
  let report;
  try{report=JSON.parse(rows[0].report);}catch{throw Error('The operations report is incomplete.');}
  if(report.environment!==environment||report.observedAt!==now)throw Error('The operations report scope did not match.');
  const warnings=commerceOperationsWarnings(report);
  return {...report,deployment,readOnly:true,launchReadinessAssessed:false,settlementAssessed:false,warnings,
    exitCode:failOnWarning&&warnings.length?2:0};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const result=await main(process.argv.slice(2));console.log(JSON.stringify(result,null,2));process.exitCode=result.exitCode;}
  catch(error){console.error(error.message);process.exitCode=1;}
}
