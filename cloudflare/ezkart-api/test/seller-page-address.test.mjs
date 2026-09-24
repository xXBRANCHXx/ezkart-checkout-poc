import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Miniflare, convertV4MiniflareOptions} from 'miniflare';
import {businessSlug, sellerPageAddress, sellerByPageAddress} from '../src/seller-page-address.js';

test('Business page addresses reserve unique stable names concurrently and keep legacy owners', async t => {
  const mf = new Miniflare(convertV4MiniflareOptions({modules:true, script:'export default {fetch(){return new Response("ok")}}', compatibilityDate:'2026-08-11', d1Databases:['DB']}));
  t.after(()=>mf.dispose());
  const db = await mf.getD1Database('DB'), env = {DB:db};
  await db.prepare("CREATE TABLE sellers (id TEXT PRIMARY KEY, slug TEXT UNIQUE, name TEXT, status TEXT, settings_json TEXT DEFAULT '{}')").run();
  await db.prepare(await readFile(new URL('../migrations/0008_seller_page_addresses.sql', import.meta.url), 'utf8')).run();
  for (const [id, slug, name, settings] of [
    ['first','first-1234567890','Account name', {storefront:{name:'Kópi Senja'}}],
    ['second','second-1234567890','Kopi Senja', {}],
    ['legacy','reserved-name','Existing account', {}],
    ['third','third-1234567890','Reserved name', {}],
  ]) await db.prepare("INSERT INTO sellers VALUES (?, ?, ?, 'active', ?)").bind(id, slug, name, JSON.stringify(settings)).run();
  const addresses = await Promise.all(['first','second','first','second'].map(id=>sellerPageAddress(env,{id})));
  assert.equal(addresses[0].pageSlug, addresses[2].pageSlug);
  assert.equal(addresses[1].pageSlug, addresses[3].pageSlug);
  assert.deepEqual(addresses.slice(0,2).map(row=>row.pageSlug).sort(), ['kopi-senja','kopi-senja-2']);
  assert.equal((await sellerPageAddress(env,{id:'third'})).pageSlug,'reserved-name-2');
  assert.equal((await sellerByPageAddress(env,'reserved-name')).id,'legacy');
  assert.equal((await sellerByPageAddress(env,'first-1234567890')).pageSlug,addresses[0].pageSlug);
  await db.prepare("UPDATE sellers SET name='New name', settings_json='{}' WHERE id='first'").run();
  assert.equal((await sellerPageAddress(env,{id:'first'})).pageSlug,addresses[0].pageSlug);
  await db.prepare("UPDATE sellers SET status='suspended' WHERE id='first'").run();
  assert.equal(await sellerByPageAddress(env,addresses[0].pageSlug),null);
  assert.equal(await sellerByPageAddress(env,'first-1234567890'),null);
  assert.equal(businessSlug('  Cafe / & Bakery '),'cafe-bakery');
  assert.equal(businessSlug('☕'),'store');
});
