import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

test("Worker publication rules parse real purchase elements and require an owned, active, available product", async (t) => {
  const bundle = await build({
    stdin: {
      contents: `import {validatePublication} from './src/landing-publication.js'; export default {async fetch(request){const data=await request.json();return Response.json({error:await validatePublication(data)});}}`,
      resolveDir: new URL("..", import.meta.url).pathname,
    },
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
  });
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: bundle.outputFiles[0].text,
      compatibilityDate: "2026-08-11",
    }),
  );
  t.after(() => mf.dispose());
  const node = (id = "mine", part = "add") =>
    `<div data-native-commerce='${JSON.stringify({ type: "commerce", part, productId: id })}'><button data-commerce-add>Add to cart</button></div>`;
  const item = {
    id: "mine",
    name: "Merchant product",
    status: "active",
    type: "physical",
    stock: 3,
  };
  const check = async (html, products = [item], preview = html) => {
    const r = await mf.dispatchFetch("http://worker.test/", {
      method: "POST",
      body: JSON.stringify({ html, state: { preview }, products }),
    });
    assert.equal(r.status, 200);
    return (await r.json()).error;
  };
  assert.match(
    await check(
      `<div data-native-commerce='{"type":"commerce","part":"add","productId":"mine"}'></div>`,
    ),
    /Add one of your products/,
  );
  assert.equal(await check(node()), "");
  assert.match(
    await check("<h1>Free website</h1>"),
    /Add one of your products/,
  );
  assert.match(
    await check(node("another-sellers-product")),
    /Add one of your products/,
  );
  assert.match(await check(node(), []), /Add one of your products/);
  assert.match(
    await check(node(), [{ ...item, status: "archived" }]),
    /Add stock/,
  );
  assert.match(await check(node(), [{ ...item, stock: 0 }]), /Add stock/);
  assert.match(
    await check(node(), [
      {
        ...item,
        stock: 99,
        variants: [
          { id: "hidden", hidden: true, stock: 5 },
          { id: "empty", stock: 0 },
        ],
      },
    ]),
    /Add stock/,
  );
  assert.equal(
    await check(node(), [
      {
        ...item,
        stock: 0,
        variants: [
          { id: "empty", stock: 0 },
          { id: "full", stock: 2 },
        ],
      },
    ]),
    "",
  );
  assert.match(
    await check(node("template-product-1")),
    /Add one of your products/,
  );
  assert.match(await check(node("mine", "image")), /Add one of your products/);
  assert.match(await check(node("mine", "cart")), /Add one of your products/);
  for (const html of [
    `<!--${node()}-->`,
    `<script>${JSON.stringify(node())}</script>`,
    `<template>${node()}</template>`,
    `<div hidden>${node()}</div>`,
    `<div style="display: none !important">${node()}</div>`,
    `<div data-sq-native='{"props":{"display":"none"}}'>${node()}</div>`,
  ])
    assert.match(await check(html), /Add one of your products/);
  assert.match(
    await check(node(), [item], "<h1>Removed from the draft</h1>"),
    /Add one of your products/,
  );
  const set = `<div data-native-commerce='{"type":"commerce","part":"set-add","productIds":["mine","second"]}'><button data-commerce-set>Add both</button></div>`;
  assert.match(
    await check(set, [item, { ...item, id: "second", stock: 0 }]),
    /Add stock/,
  );
  assert.equal(
    await check(set, [item, { ...item, id: "second", stock: 1 }]),
    "",
  );
  // One available individual product is enough even when another card is sold out.
  assert.equal(
    await check(node() + node("second"), [
      item,
      { ...item, id: "second", stock: 0 },
    ]),
    "",
  );
  assert.equal(
    await check(
      '<button data-ezkart-add="mine">Buy</button>',
      [item],
      '<article data-product-card="mine"><footer><button>Buy</button></footer></article>',
    ),
    "",
  );
  assert.equal(
    await check(node(), [{ ...item, type: "digital", stock: null }]),
    "",
  );
});

test("Authenticated page saves allow empty drafts and reject publish bypasses against seller-owned D1 stock", async (t) => {
  const keys = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const jwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
  jwk.kid = "test-key";
  jwk.alg = "ES256";
  const encode = (value) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned =
    encode({ alg: "ES256", kid: "test-key" }) +
    "." +
    encode({
      iss: "https://auth.example.test/auth/v1",
      sub: "test-user",
      aud: "authenticated",
      exp: Math.floor(Date.now() / 1000) + 600,
    });
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    keys.privateKey,
    new TextEncoder().encode(unsigned),
  );
  const token = unsigned + "." + Buffer.from(signature).toString("base64url");
  const bundle = await build({
    entryPoints: [new URL("../src/index.js", import.meta.url).pathname],
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
  });
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: bundle.outputFiles[0].text,
      compatibilityDate: "2026-08-11",
      bindings: { SUPABASE_URL: "https://auth.example.test" },
      d1Databases: ["DB"],
      r2Buckets: ["PRIVATE_ASSETS"],
      outboundService: () => Response.json({ keys: [jwk] }),
    }),
  );
  t.after(() => mf.dispose());
  const db = await mf.getD1Database("DB");
  await db.batch([
    db.prepare(
      "CREATE TABLE sellers (id TEXT, slug TEXT, name TEXT, plan TEXT, status TEXT)",
    ),
    db.prepare(
      "CREATE TABLE seller_memberships (seller_id TEXT, auth_user_id TEXT, role TEXT, created_at TEXT)",
    ),
    db.prepare(
      "CREATE TABLE products (id TEXT, seller_id TEXT, title TEXT, status TEXT, type TEXT, stock_quantity INTEGER, price_amount INTEGER, metadata_json TEXT)",
    ),
    db.prepare(
      "CREATE TABLE product_variants (id TEXT, seller_id TEXT, product_id TEXT, name TEXT, stock_quantity INTEGER, options_json TEXT)",
    ),
    db.prepare(
      "INSERT INTO sellers VALUES ('mine','mine','Store','free','active')",
    ),
    db.prepare(
      "INSERT INTO seller_memberships VALUES ('mine','test-user','owner','2026-01-01')",
    ),
    db.prepare(
      "INSERT INTO products VALUES ('owned','mine','My product','active','physical',0,10000,'{}')",
    ),
    db.prepare(
      "INSERT INTO products VALUES ('foreign','someone-else','Other product','active','physical',99,10000,'{}')",
    ),
  ]);
  const save = async (data) => {
    const r = await mf.dispatchFetch(
      "http://worker.test/v1/landing-pages/my-page",
      {
        method: "PUT",
        headers: {
          authorization: "Bearer " + token,
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "My page", ...data }),
      },
    );
    return { status: r.status, body: await r.json() };
  };
  const buy = (id) =>
    `<div data-native-commerce='{"type":"commerce","part":"add","productId":"${id}"}'><button data-commerce-add>Buy</button></div>`;
  const published = (id) => ({
    status: "published",
    products: [id],
    state: { preview: buy(id) },
    publishedHtml: buy(id),
    customProducts: [{ id, stock: 999, status: "active" }],
  });
  const initial = await save({
    status: "draft",
    products: [],
    state: { preview: "<h1>Draft without products</h1>" },
  });
  assert.equal(initial.status, 200, JSON.stringify(initial.body));
  assert.equal((await save(published("foreign"))).status, 422);
  assert.equal((await save(published("owned"))).status, 422);
  assert.equal(
    (
      await save({
        status: "published",
        products: ["owned"],
        publishedHtml: "<h1>No product</h1>",
      })
    ).status,
    422,
  );
  await db
    .prepare("UPDATE products SET stock_quantity=2 WHERE id='owned'")
    .run();
  assert.equal((await save(published("owned"))).status, 200);
  // Replacing published HTML without sending a status must still run the gate.
  assert.equal(
    (
      await save({
        publishedHtml: "<h1>Free hosting attempt</h1>",
        state: { preview: "<h1>No product</h1>" },
      })
    ).status,
    422,
  );
  await db
    .prepare("UPDATE products SET stock_quantity=0 WHERE id='owned'")
    .run();
  assert.equal((await save(published("owned"))).status, 422);
  // Working on a sold-out page remains possible; autosave cannot replace its publication.
  assert.equal(
    (await save({ state: { preview: "<h1>My next draft</h1>" }, products: [] }))
      .status,
    200,
  );
  const object = await (
    await mf.getR2Bucket("PRIVATE_ASSETS")
  ).get("sellers/mine/landing-pages/my-page.json");
  const stored = JSON.parse(await object.text());
  assert.equal(stored.publishedHtml, buy("owned"));
  assert.equal(stored.state.preview, "<h1>My next draft</h1>");
});
