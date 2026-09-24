import { test } from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {sellerPageAddress} from "../src/seller-page-address.js";
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
  // Native elements saved with outerHTML use double-quoted, entity-encoded
  // attributes. The Worker must read those just as the browser does.
  const serialized = (id = "mine", quote = "&quot;") =>
    `<div data-native-commerce="${JSON.stringify({ type: "commerce", part: "add", productId: id }).replaceAll("&", "&amp;").replaceAll('"', quote)}"><button data-commerce-add>Buy</button></div>`;
  for (const quote of ["&quot;", "&#34;", "&#x22;"]) {
    assert.equal(await check(serialized("mine", quote)), "");
    assert.match(await check(serialized("foreign", quote)), /Add one of your products/);
    assert.match(await check(serialized("mine", quote), [{ ...item, stock: 0 }]), /Add stock/);
  }
  // Decode once: an ampersand in a real ID must not become a second entity.
  assert.equal(await check(serialized("mine&amp;"), [{ ...item, id: "mine&amp;" }]), "");
  assert.match(await check(serialized("mine&amp;"), [{ ...item, id: "mine&" }]), /Add one of your products/);
  const variants = [
    {
      ...item,
      variants: [
        { id: "full", stock: 4 },
        { id: "empty", stock: 0 },
        { id: "hidden", hidden: true, stock: 4 },
      ],
    },
  ];
  const fixed = (id) =>
    `<div data-native-commerce='${JSON.stringify({ type: "commerce", part: "add", productId: "mine", variantId: id })}'><button data-commerce-add>Buy</button></div>`;
  assert.equal(await check(fixed("full"), variants), "");
  for (const id of ["empty", "hidden", "missing"])
    assert.match(await check(fixed(id), variants), /Add stock/);
  assert.match(
    await check(fixed("full"), variants, fixed("empty")),
    /Add one of your products/,
  );
  assert.match(
    await check(
      '<button data-ezkart-add="mine" data-ezkart-variant="empty">Buy</button>',
      variants,
      node(),
    ),
    /Add stock/,
  );
  assert.equal(
    await check(
      '<button data-ezkart-add="mine" data-ezkart-variant="full">Buy</button>',
      variants,
      node(),
    ),
    "",
  );

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
    `<div data-sq-native="{&quot;props&quot;:{&quot;display&quot;:&quot;none&quot;}}">${serialized()}</div>`,
    `<div style="display&colon;none">${serialized()}</div>`,
    `<div aria-hidden="tr&#117;e">${serialized()}</div>`,
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
      "CREATE TABLE sellers (id TEXT PRIMARY KEY, slug TEXT, name TEXT, plan TEXT, status TEXT, settings_json TEXT DEFAULT '{}')",
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
      "INSERT INTO sellers VALUES ('mine','mine-0123456789','Store','free','active','{}')",
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
  await db.prepare(await readFile(new URL('../migrations/0008_seller_page_addresses.sql', import.meta.url), 'utf8')).run();
  const save = async (data, minimal = false) => {
    const r = await mf.dispatchFetch(
      "http://worker.test/v1/landing-pages/my-page",
      {
        method: "PUT",
        headers: {
          authorization: "Bearer " + token,
          "content-type": "application/json",
          ...(minimal ? {prefer: 'return=minimal'} : {}),
        },
        body: JSON.stringify({ name: "My page", ...data }),
      },
    );
    return { status: r.status, body: await r.json(), preference: r.headers.get('preference-applied') };
  };
  const exportPage = async (html, state = { preview: html }) =>
    mf.dispatchFetch("http://worker.test/v1/landing-pages/my-page/export", {
      method: "POST",
      headers: {
        authorization: "Bearer " + token,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        html,
        state,
        customProducts: [{ id: "owned", stock: 999 }],
      }),
    });
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
  assert.equal(initial.body.page.state.preview, '<h1>Draft without products</h1>', 'Existing callers still receive the full page');
  const artworkState={preview:'<img src="data:image/png;base64,'+'A'.repeat(2500000)+'">'};
  const receipt=await save({state:artworkState},true);
  assert.equal(receipt.status,200);
  assert.equal(receipt.preference,'return=minimal');
  assert.equal(receipt.body.page.state,undefined);
  assert.equal(receipt.body.page.publishedHtml,undefined);
  assert.ok(JSON.stringify(receipt.body).length<1000);
  const savedDraft=await (await mf.getR2Bucket('PRIVATE_ASSETS')).get('sellers/mine/landing-pages/my-page.json');
  assert.deepEqual((await savedDraft.json()).state,artworkState,'The receipt follows the durable write');
  const publicUrl = 'http://worker.test/v1/public/landing-pages/store/my-page';
  assert.equal(initial.body.page.publicPath, '/store/shop/my-page');
  assert.equal(initial.body.page.previewPath, '/store/shop/my-page/preview');
  assert.equal((await mf.dispatchFetch(publicUrl)).status, 404, 'Drafts are private');
  assert.equal((await exportPage("<h1>Empty</h1>")).status, 422);
  assert.equal((await exportPage(buy("foreign"))).status, 422);
  assert.equal((await exportPage(buy("owned"))).status, 422);
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
  assert.equal((await exportPage(buy("owned"))).status, 200);
  assert.equal(
    (await exportPage(buy("owned"), { preview: "<h1>Not on page</h1>" }))
      .status,
    422,
  );
  const publicationReceipt=await save(published('owned'),true);
  assert.equal(publicationReceipt.status,200);
  assert.equal(publicationReceipt.body.page.status,'published');
  assert.ok(publicationReceipt.body.page.publishedAt);
  assert.equal(publicationReceipt.body.page.publishedHtml,undefined);
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
  assert.equal((await exportPage(buy("owned"))).status, 422);
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
  const live = await mf.dispatchFetch(publicUrl);
  assert.equal(live.status, 200, 'Published pages load without authentication');
  assert.equal(await live.text(), buy('owned'), 'Only the published snapshot is public');
  assert.match(live.headers.get('cache-control'), /no-store/);
  const legacyPublic = await mf.dispatchFetch(publicUrl.replace('/store/', '/mine-0123456789/'));
  assert.equal(legacyPublic.status, 200);
  assert.equal(legacyPublic.headers.get('x-ezkart-public-path'), '/store/shop/my-page');
  assert.match(live.headers.get('content-security-policy'), /sandbox allow-scripts/);
  assert.doesNotMatch(live.headers.get('content-security-policy'), /allow-same-origin/);
  assert.equal((await mf.dispatchFetch(publicUrl.replace('/store/', '/another-store/'))).status, 404);
  await db.prepare("UPDATE sellers SET status='suspended' WHERE id='mine'").run();
  assert.equal((await mf.dispatchFetch(publicUrl)).status, 404);
  await db.prepare("UPDATE sellers SET status='active' WHERE id='mine'").run();
  await save({status:'draft'});
  assert.equal((await mf.dispatchFetch(publicUrl)).status, 404, 'Unpublishing revokes the public link');
  await db.prepare("UPDATE products SET stock_quantity=2 WHERE id='owned'").run();
  assert.equal((await save(published('owned'))).status, 200);
  assert.equal((await mf.dispatchFetch(publicUrl)).status, 200);
  stored.updatedAt = (await (await mf.dispatchFetch('http://worker.test/v1/landing-pages/my-page', {headers:{authorization:'Bearer '+token}})).json()).page.updatedAt;
  const bucket = await mf.getR2Bucket('PRIVATE_ASSETS');
  const auth = {authorization: 'Bearer ' + token};
  const editorUrl = 'http://worker.test/v1/landing-pages/my-page/editor';
  const editorResponse = await mf.dispatchFetch(editorUrl, {headers: auth});
  assert.equal(editorResponse.status, 200);
  assert.equal(editorResponse.headers.get('cache-control'), 'no-store');
  const {editor} = await editorResponse.json();
  const editable = JSON.parse(editor.parts.map(part => typeof part === 'string' ? part : editor.images[part]).join(''));
  assert.deepEqual(editable.state, {preview: buy("owned")});
  assert.equal(editable.publishedHtml, undefined);
  assert.equal((await mf.dispatchFetch(editorUrl)).status, 401);
  assert.equal((await mf.dispatchFetch(editorUrl.replace('/my-page/', '/someone-elses-page/'), {headers:auth})).status, 404);
  const list = () => mf.dispatchFetch('http://worker.test/v1/landing-pages', {headers: auth});
  const listed = (await (await list()).json()).pages;
  assert.equal(listed[0].name, 'My page');
  assert.equal(listed[0].publicPath, '/store/shop/my-page');
  assert.equal(listed[0].state, undefined);
  // A legacy project gets its derived summary on the first read.
  await bucket.delete('sellers/mine/landing-page-summaries/my-page.json');
  assert.equal((await list()).status, 200);
  assert.ok(await bucket.head('sellers/mine/landing-page-summaries/my-page.json'));
  const previewUrl = 'http://worker.test/v1/landing-pages/my-page/preview';
  const savedPreview = await mf.dispatchFetch(previewUrl, {method: 'PUT', headers: {...auth, 'content-type': 'application/json'}, body: JSON.stringify({sourceUpdatedAt: stored.updatedAt, html: '<!doctype html><div class="sq-page-preview">Visible first screen</div><style id="ezkart-library-preview-style">.paused{animation:none}</style><script>largeUnusedCode()</script>'})});
  assert.equal(savedPreview.status, 200);
  const preview = await mf.dispatchFetch(previewUrl, {headers: auth});
  assert.equal(preview.status, 200);
  assert.doesNotMatch(await preview.text(), /largeUnusedCode|<script/);
  assert.match(preview.headers.get('cache-control'), /private/);
  const cachedPreview = await mf.dispatchFetch(previewUrl, {headers: {...auth, 'if-none-match': preview.headers.get('etag')}});
  assert.equal(cachedPreview.status, 304);
  assert.equal(await cachedPreview.text(), '');
  assert.equal((await mf.dispatchFetch(previewUrl)).status, 401);
  const viewUrl = 'http://worker.test/v1/landing-pages/my-page/view';
  assert.equal((await mf.dispatchFetch(viewUrl)).status, 401);
  const view = await mf.dispatchFetch(viewUrl, {headers:auth});
  assert.equal(view.status, 200);
  assert.equal(view.headers.get('x-ezkart-preview-path'), '/store/shop/my-page/preview');
  assert.equal((await mf.dispatchFetch(viewUrl,{headers:{...auth,'x-ezkart-preview-store':'other'}})).status,404);
  assert.equal((await mf.dispatchFetch(viewUrl,{headers:{...auth,'x-ezkart-preview-store':'store'}})).status,200);
  const viewHtml = await view.text();
  assert.match(viewHtml, /<script>largeUnusedCode/);
  assert.doesNotMatch(viewHtml, /ezkart-library-preview-style/);
  assert.match(view.headers.get('cache-control'), /no-store/);
  assert.match(view.headers.get('content-security-policy'), /sandbox allow-scripts/);
  assert.doesNotMatch(view.headers.get('content-security-policy'), /allow-same-origin/);
  assert.equal((await mf.dispatchFetch(viewUrl.replace('my-page', 'foreign-page'), {headers:auth})).status, 404);
  await db.batch([
    db.prepare("INSERT INTO sellers VALUES ('other','other','Store','free','active','{}')"),
    db.prepare("INSERT INTO seller_memberships VALUES ('other','other-user','owner','2026-01-01')"),
  ]);
  const otherAddress = await sellerPageAddress({DB:db}, {id:'other'});
  assert.equal(otherAddress.pageSlug, 'store-2', 'Only duplicate business names receive a readable number');
  await db.prepare("UPDATE sellers SET name='New name' WHERE id='other'").run();
  assert.equal((await sellerPageAddress({DB:db}, {id:'other'})).pageSlug, 'store-2', 'Existing links stay stable when names change');
  const otherUnsigned = encode({alg:'ES256',kid:'test-key'}) + '.' + encode({iss:'https://auth.example.test/auth/v1',sub:'other-user',aud:'authenticated',exp:Math.floor(Date.now()/1000)+600});
  const otherSignature = await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},keys.privateKey,new TextEncoder().encode(otherUnsigned));
  const otherToken = otherUnsigned + '.' + Buffer.from(otherSignature).toString('base64url');
  assert.equal((await mf.dispatchFetch(viewUrl,{headers:{authorization:'Bearer '+otherToken}})).status,404,'Another signed-in seller cannot read this draft');
  assert.equal((await mf.dispatchFetch(publicUrl.replace('/store/','/other/'))).status,404,'Page names are scoped to the store');
  // An otherwise valid preview must disappear when its parent page is gone.
  await bucket.delete('sellers/mine/landing-pages/my-page.json');
  assert.equal((await mf.dispatchFetch(previewUrl, {headers: auth})).status, 404);
  assert.equal((await (await list()).json()).pages.length, 0);
  assert.equal((await mf.dispatchFetch(viewUrl, {headers:auth})).status, 404);
  assert.equal((await mf.dispatchFetch(publicUrl)).status, 404);
});
