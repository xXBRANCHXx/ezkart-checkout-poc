#!/usr/bin/env node
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {digitalStorageReportStatement,digitalStorageWarnings} from '../../cloudflare/ezkart-api/src/digital-file-maintenance.js';

const worker=resolve(dirname(fileURLToPath(import.meta.url)),'../../cloudflare/ezkart-api'),execute=promisify(execFile);
async function query(sql){
  try{
    const result=await execute(process.execPath,[join(worker,'node_modules/wrangler/bin/wrangler.js'),'d1','execute','DB','--env','test','--remote','--command',sql,'--json'],{cwd:worker,maxBuffer:1000000,timeout:120000});
    const data=JSON.parse(result.stdout);if(!Array.isArray(data)||data.length!==1||data[0].success!==true)throw Error();
    return data[0].results;
  }catch{throw Error('TEST storage inspection was not confirmed. Inspect the private Wrangler log; no mutation was requested.');}
}
export async function main(args=[],runQuery=query,now=new Date().toISOString()){
  if(args.length>1||args.length===1&&args[0]!=='--fail-on-warning')throw Error('Usage: node tools/commerce/digital-storage-report.mjs [--fail-on-warning] (read-only TEST only)');
  const rows=await runQuery(digitalStorageReportStatement(now));
  if(!Array.isArray(rows)||rows.length!==1||typeof rows[0].report!=='string')throw Error('TEST storage report was incomplete.');
  const report=JSON.parse(rows[0].report),warnings=digitalStorageWarnings(report);
  return {deployment:'test',environment:'sandbox',readOnly:true,...report,warnings,
    storageBasis:'D1 upload records; excludes unrecorded multipart uploads and R2 billing overhead.',
    exitCode:args.includes('--fail-on-warning')&&warnings.length?2:0};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const result=await main(process.argv.slice(2));console.log(JSON.stringify(result,null,2));process.exitCode=result.exitCode;}
  catch(error){console.error(error.message);process.exitCode=1;}
}
