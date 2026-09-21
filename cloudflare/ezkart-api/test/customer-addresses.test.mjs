import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
test("customer addresses verify identity, isolate owners, enforce limits and reject concurrent overwrites", async t => {
  const key = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const publicKey = { ...await crypto.subtle.exportKey("jwk", key.publicKey), kid: "address-test", alg: "ES256", use: "sig" };
  const bundle = await build({ entryPoints: [new URL("../src/index.js", import.meta.url).pathname], bundle: true, write: false, format: "esm", platform: "neutral" });
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: "2026-08-11", d1Databases: ["DB"], bindings: { APP_ENVIRONMENT: "test", SUPABASE_URL: "https://auth.fixture.test" }, outboundService: async request => {
    assert.equal(request.url, "https://auth.fixture.test/auth/v1/.well-known/jwks.json");
    return new Response(JSON.stringify({ keys: [publicKey] }), { headers: { "content-type": "application/json" } });
  } }));
  t.after(() => mf.dispose());
  const db = await mf.getD1Database("DB");
  await db.prepare(await readFile(new URL("../migrations/0006_customer_addresses.sql", import.meta.url), "utf8")).run();
  async function token(id, changes = {}) {
    const h = Buffer.from(JSON.stringify({ alg: "ES256", kid: publicKey.kid })).toString("base64url");
    const p = Buffer.from(JSON.stringify({ iss: "https://auth.fixture.test/auth/v1", sub: id, aud: "authenticated", exp: Math.floor(Date.now()/1000)+3600, email: "same@example.test", ...changes })).toString("base64url");
    const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key.privateKey, new TextEncoder().encode(`${h}.${p}`));
    return `${h}.${p}.${Buffer.from(sig).toString("base64url")}`;
  }
  const alice = await token("alice"), bob = await token("bob");
  async function call(access, body) {
    const response = await mf.dispatchFetch("https://api.fixture.test/v1/customer/addresses", { method: body ? "POST" : "GET", headers: { ...(access ? { authorization: `Bearer ${access}` } : {}), "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, ...await response.json() };
  }
  assert.equal((await call("")).status, 401);
  assert.equal((await call(await token("alice", { exp: 1 }))).status, 401);
  assert.equal((await call(alice.slice(0,-10)+"aaaaaaaaaa")).status, 401);
  const address = { label: "Home", address: "Jalan Example Nomor 12", location: "Jakarta", postalCode: "10230", fullName: "Example Buyer", phone: "081234567890", note: "Reception", coordinate: { latitude: -6.1957601, longitude: 106.8214547 } };
  let r = await call(alice, { action: "save", revision: 0, address, owner: "bob" });
  assert.equal(r.status, 200); const first = r.book.addresses[0]; assert.equal(r.book.default_id, first.id);
  assert.equal((await call(bob)).book.addresses.length, 0);
  assert.equal((await call(bob, { action: "delete", id: first.id, revision: 0 })).status, 404);
  r = await call(alice, { action: "save", revision: 1, address: { ...address, label: "Office" }, make_default: true });
  const second = r.book.addresses[1]; assert.equal(r.book.default_id, second.id);
  const concurrent = await Promise.all(["Family", "Other"].map(label => call(alice, { action: "save", revision: 2, address: { ...address, label } })));
  assert.deepEqual(concurrent.map(r => r.status).sort(), [200,409]);
  r = await call(alice); assert.equal(r.book.addresses.length, 3); assert.equal(r.book.revision, 3);
  assert.equal((await call(alice, { action: "save", revision: 3, address })).status, 409);
  assert.equal((await call(alice, { action: "save", id: first.id, revision: 3, address: { ...address, postalCode: "bad" } })).status, 422);
  r = await call(alice, { action: "save", id: first.id, revision: 3, address: { ...address, address: "Jalan Changed Nomor 8" } });
  assert.equal(r.book.addresses[0].coordinate, null);
  r = await call(alice, { action: "default", id: first.id, revision: 4 }); assert.equal(r.book.default_id, first.id);
  r = await call(alice, { action: "delete", id: first.id, revision: 5 }); assert.equal(r.book.default_id, second.id);
  assert.equal((await call(alice, { action: "delete", id: second.id, revision: 5 })).status, 409);
  assert.equal((await call(alice)).book.addresses.length, 2);
  assert.deepEqual((await call(await token("alice", { email: "changed@example.test" }))).book, (await call(alice)).book);
  const before = (await call(alice)).book;
  const pin = { latitude: -7.7894, longitude: 110.3635 };
  assert.equal((await call(bob, { action: "pin", id: second.id, revision: 0, coordinate: pin })).status, 404);
  for (const coordinate of [null, {}, { latitude: 0, longitude: 0 }, { latitude: 91, longitude: 110 }, { latitude: -7, longitude: 181 }, { latitude: "-7", longitude: 110 }]) {
    assert.equal((await call(alice, { action: "pin", id: second.id, revision: before.revision, coordinate })).status, 422);
  }
  const pinned = await call(alice, { action: "pin", id: second.id, revision: before.revision, coordinate: pin, address: { label: "Ignored" }, make_default: true });
  assert.equal(pinned.status, 200);
  assert.deepEqual(pinned.book.addresses, before.addresses.map(a => a.id === second.id ? { ...a, coordinate: pin } : a));
  assert.equal(pinned.book.default_id, before.default_id);
  assert.equal((await call(alice, { action: "pin", id: second.id, revision: before.revision, coordinate: pin })).status, 409);
  await assert.rejects(db.prepare("INSERT INTO customer_address_books (auth_user_id,addresses_json,updated_at) VALUES ('limit','[{},{},{},{}]','now')").run(), /CHECK constraint/);
  assert.equal(await db.prepare("SELECT name FROM sqlite_master WHERE name = 'seller_memberships'").first(), null);
});
