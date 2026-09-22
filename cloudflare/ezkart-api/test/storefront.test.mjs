import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

test("one seller shop shares authoritative products and appearance, protects writes and owned images", async t => {
  const key = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const publicKey = { ...await crypto.subtle.exportKey("jwk", key.publicKey), kid: "shop-test", alg: "ES256", use: "sig" };
  const bundle = await build({ entryPoints: [new URL("../src/index.js", import.meta.url).pathname], bundle: true, write: false, format: "esm", platform: "neutral" });
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: "2026-08-11", d1Databases: ["DB"], r2Buckets: ["PUBLIC_ASSETS", "PRIVATE_ASSETS"], bindings: { APP_ENVIRONMENT: "test", SUPABASE_URL: "https://auth.fixture.test" }, outboundService: async () => Response.json({ keys: [publicKey] }) }));
  t.after(() => mf.dispose());
  const db = await mf.getD1Database("DB");
  for (const migration of ["0001_core.sql", "0002_cloud_catalog.sql"]) {
    const sql = await readFile(new URL(`../migrations/${migration}`, import.meta.url), "utf8");
    for (const statement of sql.replace(/--[^\n]*/g, "").split(";").filter(value => value.trim())) await db.prepare(statement).run();
  }
  for (const id of ["alice", "bob"]) {
    await db.prepare("INSERT INTO app_users(id,auth_user_id,created_at,updated_at) VALUES (?,?, 'now','now')").bind(id,id).run();
    await db.prepare("INSERT INTO sellers(id,slug,name,status,settings_json,created_at,updated_at) VALUES (?,?,?,'active',?, 'now','now')").bind(`seller_${id}`,id,`${id}'s store`,JSON.stringify({ privateSetting: "never expose" })).run();
    await db.prepare("INSERT INTO seller_memberships(seller_id,auth_user_id,role,created_at) VALUES (?,?,'owner','now')").bind(`seller_${id}`,id).run();
  }
  async function token(id) {
    const h = Buffer.from(JSON.stringify({ alg: "ES256", kid: publicKey.kid })).toString("base64url");
    const p = Buffer.from(JSON.stringify({ iss: "https://auth.fixture.test/auth/v1", sub: id, aud: "authenticated", exp: Math.floor(Date.now()/1000)+3600 })).toString("base64url");
    const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key.privateKey, new TextEncoder().encode(`${h}.${p}`));
    return `${h}.${p}.${Buffer.from(sig).toString("base64url")}`;
  }
  const alice = await token("alice"), bob = await token("bob");
  async function call(path, access = "", body) {
    const response = await mf.dispatchFetch(`https://api.fixture.test${path}`, { method: body ? "PUT" : "GET", headers: { ...(access ? { authorization: `Bearer ${access}` } : {}), "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, ...await response.json() };
  }
  for (const [id, seller] of [["tea", "alice"], ["mug", "alice"], ["other", "bob"]]) {
    await db.prepare("INSERT INTO products(id,seller_id,type,status,title,price_amount,stock_quantity,weight_grams,created_at,updated_at) VALUES (?,?,'physical','active',?,12000,8,100,'now','now')").bind(id,`seller_${seller}`,id).run();
  }
  for (const [id, hidden, stock] of [["green", false, 8], ["secret", true, 4], ["empty", false, 0]]) {
    await db.prepare("INSERT INTO product_variants(id,seller_id,product_id,name,options_json,sku,price_amount,stock_quantity,weight_grams,sort_order,created_at,updated_at) VALUES (?,'seller_alice','tea',?,?,?,15000,?,100,?,'now','now')").bind(id,id,JSON.stringify({ hidden }),id,stock,{green:1,secret:2,empty:3}[id]).run();
  }
  for (const [id,seller] of [["logo_alice","alice"],["logo_bob","bob"]]) {
    await db.prepare("INSERT INTO media_uploads(id,seller_id,r2_key,mime_type,size_bytes,created_by_auth_user_id,created_at) VALUES (?,?,?,'image/png',1,?,'2000-01-01')").bind(id,`seller_${seller}`,id,seller).run();
    await (await mf.getR2Bucket("PUBLIC_ASSETS")).put(id, "fixture");
  }
  assert.equal((await call("/v1/storefront")).status,401);
  let result = await call("/v1/storefront",alice);
  assert.equal(result.store.enabled,false);
  assert.equal(result.store.cartScope,createHash("sha256").update("test|alice").digest("hex").slice(0,24));
  assert.equal((await call("/v1/storefront/view?store=seller_alice")).status,404);
  assert.equal((await call("/v1/storefront/view?product=tea")).status,200,"Product checkouts work before enabling the shop");
  const appearance = { enabled:true,name:"Leaf & Clay",accent:"#123456",button:"#111827",background:"#f8f7f2",logoId:"logo_alice",backgroundId:"",animation:"rise" };
  assert.equal((await call("/v1/storefront",alice,{...appearance,logoId:"logo_bob"})).status,422);
  assert.equal((await call("/v1/storefront",alice,{...appearance,accent:"red; background:url(https://bad.test)"})).status,422);
  assert.equal((await call("/v1/storefront",alice,{...appearance,animation:"<script>"})).status,422);
  result = await call("/v1/storefront",alice,appearance); assert.equal(result.status,200);
  assert.equal((await call("/v1/storefront",bob)).store.enabled,false);
  result = await call("/v1/storefront/view?store=seller_alice");
  assert.deepEqual(result.products.map(p=>p.id).sort(),["mug","tea"]);
  const tea = result.products.find(p=>p.id==="tea");
  assert.deepEqual(tea.choices.map(c=>c.id),["tea~green","tea~empty"]);
  assert.equal(tea.choices[1].available,false);
  assert.equal(JSON.stringify(result).includes("never expose"),false);
  assert.equal(JSON.parse((await db.prepare("SELECT settings_json FROM sellers WHERE id='seller_alice'").first()).settings_json).privateSetting,"never expose");
  assert.equal((await mf.dispatchFetch("https://api.fixture.test/v1/public/media/logo_alice")).status,200);
  assert.equal((await mf.dispatchFetch("https://api.fixture.test/v1/public/media/logo_bob")).status,404);
  await (await mf.getWorker()).scheduled({ cron: "17 * * * *" });
  assert.ok(await db.prepare("SELECT id FROM media_uploads WHERE id='logo_alice'").first(), "A saved appearance image survives scheduled abandoned-upload cleanup");
  assert.equal(await db.prepare("SELECT id FROM media_uploads WHERE id='logo_bob'").first(), null, "An unreferenced old upload is still collected");
  await call("/v1/storefront",alice,{...appearance,name:"New name"});
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM sellers WHERE id='seller_alice'").first()).count,1);
  await db.prepare("UPDATE product_variants SET price_amount=22000,stock_quantity=2 WHERE id='green'").run();
  result = await call("/v1/storefront/view?product=tea");
  assert.equal(result.store.name,"New name"); assert.equal(result.products[0].choices[0].price,22000); assert.equal(result.products[0].choices[0].stock,2);
  assert.equal((await call("/v1/storefront/view?product=other&store=seller_alice")).status,404);
  await db.prepare("UPDATE products SET status='archived' WHERE id='mug'").run();
  assert.equal((await call("/v1/storefront/view?store=seller_alice")).products.length,1);
  assert.equal((await call("/v1/storefront/view?product=mug")).status,404);
  await db.prepare("UPDATE product_variants SET options_json='{\"hidden\":true}' WHERE product_id='tea'").run();
  assert.equal((await call("/v1/storefront/view?product=tea")).products[0].choices.length,0);
  assert.equal((await call("/v1/storefront/products?ids=tea")).products.length,0,"A bare product ID cannot bypass hidden variants");
  await call("/v1/storefront",alice,{...appearance,enabled:false});
  assert.equal((await call("/v1/storefront/view?store=seller_alice")).status,404);
  assert.equal((await call("/v1/storefront/view?store=seller_alice&mode=checkout")).products.length,0);
  await db.prepare("UPDATE seller_memberships SET role='viewer' WHERE auth_user_id='alice'").run();
  assert.equal((await call("/v1/storefront",alice,appearance)).status,403);
  await db.prepare("UPDATE sellers SET status='suspended' WHERE id='seller_alice'").run();
  assert.equal((await call("/v1/storefront/view?product=tea")).status,404);
});
