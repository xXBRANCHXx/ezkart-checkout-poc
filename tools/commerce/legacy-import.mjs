#!/usr/bin/env node
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {parseArgs} from 'node:util';
import {readFile,writeFile,mkdir,lstat,realpath,mkdtemp,rm} from 'node:fs/promises';
import {dirname,resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {buildLegacyPlan,sourceFromPlan,stableJson,sha256,legacyImportSql,strictJson} from './legacy-order-audit.mjs';

const execute = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const worker = join(root, 'cloudflare/ezkart-api');
process.umask(0o077);
const fail = message => { throw new Error(message); };
// Fixed repository, binding and TEST environment. This CLI cannot initialize or
// mutate production and does not need any new public or merchant API surface.
async function query(sql, sqlFile = '') {
  let output;
  try {
    output = await execute(process.execPath, [join(worker,'node_modules/wrangler/bin/wrangler.js'), 'd1','execute','DB','--env','test','--remote',
      ...(sqlFile ? ['--file',sqlFile] : ['--command',sql]), '--json'], {cwd:worker, maxBuffer:8_000_000, timeout:120000});
  } catch {
    fail('TEST D1 did not confirm the request. Inspect the private Wrangler log, then verify this same manifest before retrying.');
  }
  // Wrangler file imports can print spinner text even with --json. A write is
  // confirmed by its exact durable receipt below, never by parsing this output.
  if (sqlFile) return [];
  let response;
  try { response = JSON.parse(output.stdout); } catch { fail('TEST D1 returned an unreadable response; verify the same manifest before retrying.'); }
  if (!Array.isArray(response) || response.some(r => r.success !== true)) fail('TEST D1 did not confirm every query.');
  return response.flatMap(r => r.results || []);
}

export const registrySql = `SELECT json_object('deployment','test','environment','sandbox',
  'sellers',json((SELECT json_group_array(json_object('id',id,'status',status)) FROM (SELECT id,status FROM sellers ORDER BY id))),
  'memberships',json((SELECT json_group_array(json_object('seller_id',seller_id,'auth_user_id',auth_user_id,'role',role,'created_at',created_at)) FROM (SELECT * FROM seller_memberships ORDER BY seller_id,created_at,auth_user_id))),
  'products',json((SELECT json_group_array(json_object('id',id,'seller_id',seller_id,'sku',sku,'stock_quantity',stock_quantity,'revision',revision)) FROM (SELECT * FROM products ORDER BY seller_id,id))),
  'variants',json((SELECT json_group_array(json_object('id',id,'seller_id',seller_id,'product_id',product_id,'sku',sku,'stock_quantity',stock_quantity)) FROM (SELECT * FROM product_variants ORDER BY seller_id,product_id,id))),
  'baseline',json_object('orders',(SELECT COUNT(*) FROM orders),'customers',(SELECT COUNT(*) FROM customers),
    'reservations',(SELECT COUNT(*) FROM inventory_reservations),'captures',(SELECT COUNT(*) FROM commerce_payment_captures),
    'shipments',(SELECT COUNT(*) FROM commerce_shipments),'jobs',(SELECT COUNT(*) FROM commerce_jobs))) AS registry`;

async function registry(runQuery) { return JSON.parse((await runQuery(registrySql))[0].registry); }
const effects = registry => ({...registry.baseline,
  inventoryHash:sha256(stableJson({products:registry.products,variants:registry.variants}))});
async function readPrivate(path) {
  const resolved = resolve(path), stat = await lstat(resolved);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2_000_000 || (stat.mode & 0o077) || stat.uid !== process.getuid()) fail('Input must be a private, owned regular file of at most 2 MB');
  if ((await realpath(resolved)).startsWith(root + '/')) fail('Keep customer migration data outside the repository and public web root');
  const bytes = await readFile(resolved);
  let source;
  try { source = new TextDecoder('utf-8',{fatal:true}).decode(bytes); } catch { fail('Private input must contain valid UTF-8'); }
  return strictJson(source);
}
async function privateOutput(path, value) {
  const dir = dirname(resolve(path));
  const stat = await lstat(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) || stat.uid !== process.getuid() || (await realpath(dir)).startsWith(root + '/')) fail('Output requires an owned mode-700 directory outside the repository');
  await writeFile(path, value, {mode:0o600,flag:'wx'});
}
function checkedPlan(plan, expected) {
  if (!/^[a-f0-9]{64}$/.test(expected || '') || plan.hash !== expected || plan.id !== 'legacy_' + expected
    || sha256(stableJson(plan.manifest)) !== expected) fail('Supply --expect with the reviewed manifest digest');
}
async function existingReceipt(plan, runQuery) {
  const rows = await runQuery(`SELECT manifest_hash,manifest_json FROM commerce_legacy_import_batches WHERE id='${plan.id}'`);
  if (!rows.length) return null;
  if (rows.length !== 1 || rows[0].manifest_hash !== plan.hash || rows[0].manifest_json !== stableJson(plan.manifest)) fail('Stored import receipt does not match the reviewed manifest');
  const entries = await runQuery(`SELECT s.id,s.filename,s.source_hash,s.source_json,e.seller_id,e.disposition,e.ownership_basis,e.assessment_json
    FROM commerce_legacy_import_entries e JOIN commerce_legacy_sources s ON s.id=e.source_id WHERE e.batch_id='${plan.id}' ORDER BY s.id`);
  if (entries.length !== plan.manifest.records.length) fail('Stored import record count does not match');
  const byId = new Map(entries.map(r => [r.id,r]));
  for (const record of plan.manifest.records) {
    const row = byId.get(record.sourceId);
    if (!row || row.source_hash !== record.sourceHash || sha256(row.source_json) !== record.sourceHash
      || row.source_json !== record.source || row.filename !== record.filename
      || (row.seller_id || '') !== record.assessment.sellerId || row.disposition !== record.assessment.disposition
      || row.ownership_basis !== record.assessment.basis || row.assessment_json !== stableJson(record.assessment)) fail('Stored source bytes or ownership assessment do not match');
  }
  return {id:plan.id,hash:plan.hash,verified:true,summary:plan.manifest.summary};
}

export async function main(args, runQuery = query) {
  const {values,positionals} = parseArgs({args,allowPositionals:true,options:{source:{type:'string'},registry:{type:'string'},output:{type:'string'},plan:{type:'string'},expect:{type:'string'}}});
  const command = positionals[0];
  if (positionals.length !== 1 || !['registry','plan','stage','verify'].includes(command)) fail('Usage: legacy-import.mjs registry --output FILE | plan --source FILE --registry FILE --output DIR | stage|verify --plan FILE --expect SHA256');
  const allowed = {registry:['output'],plan:['source','registry','output'],stage:['plan','expect'],verify:['plan','expect']}[command];
  if (Object.keys(values).some(k => !allowed.includes(k)) || allowed.some(k => !values[k])) fail('Supply exactly the documented arguments for this command');
  if (command === 'registry') {
    const result = await registry(runQuery);
    await privateOutput(values.output, stableJson(result) + '\n');
    return {deployment:'test',saved:true,sellers:result.sellers.length,baseline:effects(result)};
  }
  if (command === 'plan') {
    const plan = buildLegacyPlan(await readPrivate(values.source),await readPrivate(values.registry));
    const sql = legacyImportSql(plan);
    // A newly created directory prevents silently replacing a reviewed plan.
    const path = resolve(values.output), parent = await realpath(dirname(path));
    if (parent === root || parent.startsWith(root + '/')) fail('Keep migration artifacts outside the repository');
    await mkdir(path,{mode:0o700});
    await privateOutput(join(path,'manifest.json'),stableJson(plan) + '\n');
    await privateOutput(join(path,'import.sql'),sql);
    await privateOutput(join(path,'report.json'),stableJson({id:plan.id,hash:plan.hash,summary:plan.manifest.summary}) + '\n');
    return {id:plan.id,hash:plan.hash,summary:plan.manifest.summary,staged:false};
  }
  const plan = await readPrivate(values.plan); checkedPlan(plan,values.expect);
  const existing = await existingReceipt(plan,runQuery);
  if (command === 'verify') {
    if (!existing) fail('This import has no stored receipt');
    return existing;
  }
  if (existing) return {...existing,replayed:true};
  const before = await registry(runQuery);
  const current = buildLegacyPlan(sourceFromPlan(plan),before);
  if (current.hash !== plan.hash) fail('Ownership or product evidence changed. Create and review a fresh plan before staging');
  const temp = await mkdtemp(join(tmpdir(),'ezkart-legacy-stage-'));
  let unconfirmedWrite = false;
  try {
    const sqlFile = join(temp,'import.sql'); await writeFile(sqlFile,legacyImportSql(plan),{mode:0o600,flag:'wx'});
    try { await runQuery('',sqlFile); } catch { unconfirmedWrite = true; }
  } finally { await rm(temp,{recursive:true,force:true}); }
  // A timeout can follow a committed import. Read its original receipt before
  // reporting a failure; never resend a mutation as part of this recovery.
  const receipt = await existingReceipt(plan,runQuery);
  if (!receipt) fail('Import has no confirmed receipt; retry verification with the same manifest');
  const after = await registry(runQuery);
  if (stableJson(effects(before)) !== stableJson(effects(after))) fail('Import receipt is confirmed, but commerce/inventory changed during verification. Review the concurrent change before cutover');
  return {...receipt,replayed:false,unconfirmedWriteRecovered:unconfirmedWrite,commerceAndInventoryUnchanged:true};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await main(process.argv.slice(2)),null,2)); }
  catch (error) { console.error('Legacy import: ' + error.message); process.exitCode = 1; }
}
