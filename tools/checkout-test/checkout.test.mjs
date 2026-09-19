import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const php = process.env.PHP_BINARY || "php";
const fixture = join(root, "tools/checkout-test/provider-fixture.php");
const input = {
  cart: { granola: 2 },
  shop: "test-shop",
  shipping_id: "jne-reg",
  total: 1,
  customer: {
    fullName: "Checkout Tester",
    email: "checkout@example.com",
    phone: "081234567890",
    location: "Jakarta Selatan",
    address: "Jalan Test Nomor 12",
    postalCode: "12345",
    note: "",
  },
};
const secret = "fixture-doku-sandbox-secret";
const signature = (body, headers, target, key = secret) =>
  "HMACSHA256=" +
  createHmac("sha256", key)
    .update(
      `Client-Id:${headers["Client-Id"]}\nRequest-Id:${headers["Request-Id"]}\nRequest-Timestamp:${headers["Request-Timestamp"]}\nRequest-Target:${target}\nDigest:${createHash("sha256").update(body).digest("base64")}`,
    )
    .digest("base64");
async function setup(overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), "ezkart-checkout-test-"));
  const capture = join(directory, "calls.jsonl");
  const env = {
    ...process.env,
    EZKART_TEST_CAPTURE: capture,
    EZKART_SANDBOX_ADMIN_PASSWORD: "fixture-admin-password",
    EZKART_ADMIN_SESSION_STORAGE: join(directory, "sessions"),
    EZKART_DEPLOYMENT_ENVIRONMENT: "test",
    EZKART_COMMERCE_ENVIRONMENT: "sandbox",
    EZKART_ORDER_STORAGE: join(directory, "orders"),
    EZKART_EXECUTIVE_STORAGE: join(directory, "executive"),
    EZKART_DOKU_SANDBOX_CLIENT_ID: "MCH-SANDBOX-TEST",
    EZKART_DOKU_SANDBOX_SECRET_KEY: secret,
    // Keep the original hosted integration covered as an explicit legacy configuration.
    EZKART_DOKU_SANDBOX_PAYMENT_FLOW: "hosted",
    EZKART_DOKU_PRODUCTION_PAYMENT_FLOW: "hosted",
    EZKART_DOKU_PRODUCTION_CLIENT_ID: "MCH-PRODUCTION-TEST",
    EZKART_DOKU_PRODUCTION_SECRET_KEY: "fixture-doku-production-secret",
    EZKART_BITESHIP_SANDBOX_API_KEY: "biteship_test.fixture",
    EZKART_BITESHIP_PRODUCTION_API_KEY: "biteship_live.fixture",
    EZKART_BITESHIP_SANDBOX_WEBHOOK_TOKEN:
      "sandbox-webhook-fixture-32-characters",
    EZKART_BITESHIP_PRODUCTION_WEBHOOK_TOKEN:
      "production-webhook-fixture-32-characters",
    EZKART_BITESHIP_ORIGIN_POSTAL_CODE: "12345",
    EZKART_BITESHIP_ORIGIN_CONTACT_NAME: "Test Warehouse",
    EZKART_BITESHIP_ORIGIN_CONTACT_PHONE: "081234567890",
    EZKART_BITESHIP_ORIGIN_ADDRESS: "Jalan Warehouse Nomor 1",
    ...overrides,
  };
  const probe = createServer();
  await new Promise((r) => probe.listen(0, "127.0.0.1", r));
  const port = probe.address().port;
  await new Promise((r) => probe.close(r));
  const child = spawn(
    php,
    [
      "-n",
      "-d",
      `auto_prepend_file=${fixture}`,
      "-S",
      `127.0.0.1:${port}`,
      "-t",
      root,
    ],
    { env, stdio: ["ignore", "pipe", "pipe"] },
  );
  let logs = "";
  child.stderr.on("data", (x) => (logs += x));
  child.stdout.on("data", (x) => (logs += x));
  child.on("error", (x) => (logs += x));
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      await fetch(base + "/cart/index.html");
      break;
    } catch {
      if (attempt === 99) throw new Error(logs);
      await new Promise((r) => setTimeout(r, 25));
    }
  }
  return {
    env,
    base,
    directory,
    async close() {
      child.kill();
      await new Promise((r) => child.once("exit", r));
      await rm(directory, { recursive: true, force: true });
    },
    async calls() {
      return (await readFile(capture, "utf8").catch(() => ""))
        .trim()
        .split("\n")
        .filter(Boolean)
        .map(JSON.parse);
    },
    async request(path, data, headers = {}) {
      const r = await fetch(base + path, {
        method: data === undefined ? "GET" : "POST",
        headers: { "Content-Type": "application/json", ...headers },
        ...(data === undefined
          ? {}
          : { body: typeof data === "string" ? data : JSON.stringify(data) }),
      });
      return { status: r.status, data: await r.json() };
    },
    cli(code, extraEnv = {}) {
      const result = spawnSync(
        php,
        [
          "-n",
          "-r",
          `require ${JSON.stringify(fixture)}; require ${JSON.stringify(join(root, "cart/api/bootstrap.php"))}; ${code}`,
        ],
        { env: { ...env, ...extraEnv }, encoding: "utf8" },
      );
      assert.equal(result.status, 0, result.stderr + result.stdout);
      return result.stdout.trim();
    },
  };
}
async function notify(app, id, status = "SUCCESS", changes = {}, options = {}) {
  const payload = {
    order: { invoice_number: id, amount: 134000, ...changes },
    transaction: { status, original_request_id: "doku-channel-reference" },
    channel: { id: "VIRTUAL_ACCOUNT_BCA" },
    ...(options.virtualAccount
      ? {
          virtual_account_info: {
            virtual_account_number: options.virtualAccount,
          },
        }
      : {}),
  };
  const body = JSON.stringify(payload);
  const target = options.target || "/cart/api/doku-webhook.php";
  const headers = {
    "Client-Id": "MCH-SANDBOX-TEST",
    "Request-Id": "notification-fixture",
    "Request-Timestamp": "2020-08-11T08:45:42Z",
    ...options.headers,
  };
  headers.Signature = signature(
    body,
    headers,
    target,
    options.secret || secret,
  );
  return app.request(
    options.path || target,
    options.tamper ? body + " " : body,
    headers,
  );
}

test("sandbox checkout, signed callbacks, merchant acceptance, idempotent pickup and shipping webhook", async (t) => {
  const app = await setup();
  t.after(() => app.close());
  const config = await app.request("/cart/api/checkout-config.php");
  assert.deepEqual(config.data, {
    ok: true,
    environment: "sandbox",
    provider: "doku",
    shipping_required: false,
  });
  const started = await app.request("/cart/api/start.php", input);
  assert.equal(started.status, 201);
  assert.equal(started.data.payment_total, 134000);
  assert.match(started.data.order_id, /^EZK-S-[A-F0-9]{24}$/);
  assert.match(started.data.payment_url, /^https:\/\/staging\.doku\.com\//);
  const id = started.data.order_id;
  const calls = await app.calls();
  assert.equal(calls.length, 2);
  assert.ok(calls[0].headers.includes("Authorization: biteship_test.fixture"));
  const request = calls[1];
  assert.equal(request.url, "https://api-sandbox.doku.com/checkout/v1/payment");
  const headers = Object.fromEntries(
    request.headers.map((h) => h.split(/: (.*)/s).slice(0, 2)),
  );
  assert.equal(
    headers.Signature,
    signature(request.body, headers, "/checkout/v1/payment"),
  );
  const payload = JSON.parse(request.body);
  assert.deepEqual(payload.payment.payment_method_types, [
    "VIRTUAL_ACCOUNT_BCA",
  ]);
  assert.equal(
    payload.order.amount,
    payload.order.line_items.reduce((n, x) => n + x.price * x.quantity, 0),
  );
  assert.equal(payload.customer.phone, "6281234567890");
  assert.equal(
    new URL(payload.order.callback_url).searchParams.get("shop"),
    "test-shop",
  );
  assert.equal(
    payload.additional_info.override_notification_url,
    "https://test.ezkart.id/cart/api/doku-webhook.php",
  );
  // Browser return claims cannot confirm a payment.
  await fetch(app.base + `/cart/return.php?order=${id}&status=SUCCESS`);
  assert.equal(
    (await app.request(`/cart/api/status.php?order=${id}`)).data.status,
    "PENDING",
  );
  for (const options of [
    { tamper: true },
    { secret: "wrong-key" },
    { headers: { "Client-Id": "WRONG-MERCHANT" } },
    { path: "/cart/api/callback.php" },
  ])
    assert.equal((await notify(app, id, "SUCCESS", {}, options)).status, 400);
  for (const amount of [1, 134000.1, "134000foo", -134000, null])
    assert.equal((await notify(app, id, "SUCCESS", { amount })).status, 400);
  assert.equal(
    (await notify(app, id, "SUCCESS", { currency: "USD" })).status,
    400,
  );
  assert.equal((await notify(app, id, "FAILED")).status, 200);
  assert.equal(
    (await app.request(`/cart/api/status.php?order=${id}`)).data.status,
    "PENDING",
  );
  assert.equal((await notify(app, id)).status, 200);
  const paid = (await app.request(`/cart/api/status.php?order=${id}`)).data;
  assert.equal(paid.status, "PAID");
  assert.equal(paid.fulfillment_status, "AWAITING_ACCEPTANCE");
  assert.equal((await app.calls()).length, 2);
  const commandId = JSON.stringify(id);
  assert.equal(
    app.cli(
      `try { ez_arrange_paid_order_pickup(${commandId}); } catch (RuntimeException $e) { echo $e->getMessage(); }`,
    ),
    "Accept this order before arranging pickup.",
  );
  app.cli(`ez_accept_paid_order(${commandId});`);
  await notify(app, id);
  await notify(app, id, "FAILED");
  await notify(app, id, "PENDING");
  assert.equal(
    (await app.request(`/cart/api/status.php?order=${id}`)).data
      .fulfillment_status,
    "AWAITING_PICKUP_ARRANGEMENT",
  );
  app.cli(
    `ez_arrange_paid_order_pickup(${commandId}); ez_arrange_paid_order_pickup(${commandId});`,
  );
  const shipments = (await app.calls()).filter((x) =>
    x.url.endsWith("/v1/orders"),
  );
  assert.equal(shipments.length, 1);
  const shipment = JSON.parse(shipments[0].body);
  assert.equal(shipment.reference_id, id);
  assert.equal(shipment.metadata.environment, "sandbox");
  assert.equal(shipment.items[0].quantity, 2);
  assert.equal(shipment.items.length, 1);
  const event = {
    event: "order.waybill_id",
    order_id: "test-shipment-" + id,
    courier_waybill_id: "UPDATED-TEST-AWB",
  };
  assert.equal(
    (
      await app.request(
        "/cart/api/biteship-webhook.php?environment=sandbox",
        event,
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await app.request(
        "/cart/api/biteship-webhook.php?environment=sandbox",
        event,
        {
          Authorization:
            "Bearer " + app.env.EZKART_BITESHIP_SANDBOX_WEBHOOK_TOKEN,
        },
      )
    ).data.matched,
    true,
  );
  assert.equal(
    (await app.request(`/cart/api/status.php?order=${id}`)).data
      .biteship_waybill_id,
    "UPDATED-TEST-AWB",
  );
});

test("sandbox payment skips rates and fulfillment without Biteship configuration", async (t) => {
  const app = await setup({
    EZKART_BITESHIP_SANDBOX_API_KEY: "REPLACE_MISSING",
    EZKART_BITESHIP_ORIGIN_POSTAL_CODE: "REPLACE_MISSING",
  });
  t.after(() => app.close());
  assert.equal(
    (await app.request("/cart/api/checkout-config.php")).data.shipping_required,
    false,
  );
  const { shipping_id, ...withoutShipping } = input;
  const started = await app.request("/cart/api/start.php", withoutShipping);
  assert.equal(started.status, 201);
  assert.equal(started.data.payment_total, 116000);
  const id = started.data.order_id;
  const calls = await app.calls();
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    "https://api-sandbox.doku.com/checkout/v1/payment",
  );
  const payload = JSON.parse(calls[0].body);
  assert.equal(payload.order.amount, 116000);
  assert.equal(payload.order.line_items.length, 1);
  assert.equal(
    (await notify(app, id, "SUCCESS", { amount: 116000 })).status,
    200,
  );
  const order = JSON.parse(
    app.cli(`echo json_encode(ez_load_order('${id}'));`),
  );
  assert.equal(order.shipping_skipped, true);
  assert.equal(order.shipping_price, 0);
  assert.equal(order.shipping, null);
  assert.equal(order.fulfillment_status, "NOT_REQUIRED");
  assert.equal(order.fulfillment_deadline_at, "");
  app.cli(`ez_accept_paid_order('${id}');`);
  assert.match(
    app.cli(
      `try { ez_arrange_paid_order_pickup('${id}'); } catch (RuntimeException $e) { echo $e->getMessage(); }`,
    ),
    /Delivery is skipped/,
  );
  assert.match(
    app.cli(
      `try { ez_create_biteship_order(ez_load_order('${id}')); } catch (RuntimeException $e) { echo $e->getMessage(); }`,
    ),
    /Delivery is skipped/,
  );
  assert.equal((await app.calls()).length, 1);
});

test("production requires shipping and live slots and rejects sandbox provider events", async (t) => {
  const app = await setup({
    EZKART_DEPLOYMENT_ENVIRONMENT: "production",
    EZKART_COMMERCE_ENVIRONMENT: "production",
  });
  t.after(() => app.close());
  assert.equal(
    (await app.request("/cart/api/checkout-config.php")).data.shipping_required,
    true,
  );
  const { shipping_id, ...withoutShipping } = input;
  const rejected = await app.request("/cart/api/start.php", {
    ...withoutShipping,
    environment: "sandbox",
    shipping_skipped: true,
    shipping_price: 0,
  });
  assert.equal(rejected.status, 422);
  assert.match(rejected.data.error, /shipping service/);
  assert.equal((await app.calls()).length, 0);
  const started = await app.request("/cart/api/start.php", input);
  assert.equal(started.status, 201);
  assert.match(started.data.order_id, /^EZK-P-/);
  assert.match(started.data.payment_url, /^https:\/\/jokul.doku.com\//);
  const calls = await app.calls();
  assert.ok(calls[0].headers.includes("Authorization: biteship_live.fixture"));
  assert.equal(calls[1].url, "https://api.doku.com/checkout/v1/payment");
  assert.match(calls[1].headers.join("\n"), /MCH-PRODUCTION-TEST/);
  assert.equal((await notify(app, started.data.order_id)).status, 400);
  assert.equal(
    (
      await notify(
        app,
        started.data.order_id,
        "SUCCESS",
        {},
        {
          headers: { "Client-Id": "MCH-PRODUCTION-TEST" },
          secret: "fixture-doku-production-secret",
        },
      )
    ).status,
    200,
  );
  const sandboxId = "EZK-S-" + "A".repeat(24);
  app.cli(
    `ez_save_order(['order_id'=>'${sandboxId}','status'=>'PAID','commerce_environment'=>'sandbox','payment_provider'=>'doku','total'=>134000]);`,
  );
  assert.equal((await notify(app, sandboxId)).status, 400);
  assert.match(
    app.cli(
      `try { ez_create_biteship_order(ez_load_order('${sandboxId}')); } catch (RuntimeException $e) { echo $e->getMessage(); }`,
    ),
    /Sandbox orders cannot be fulfilled/,
  );
  assert.notEqual(
    app.cli(`echo ez_order_path('${sandboxId}');`),
    app.cli(`echo ez_order_path('${started.data.order_id}');`),
  );
});

test("invalid mode, live key in sandbox, absent DOKU slots, and provider errors fail closed", async (t) => {
  for (const overrides of [
    { EZKART_COMMERCE_ENVIRONMENT: "typo" },
    { EZKART_DEPLOYMENT_ENVIRONMENT: "production", EZKART_COMMERCE_ENVIRONMENT: "sandbox" },
    { EZKART_BITESHIP_SANDBOX_API_KEY: "biteship_live.wrong" },
    { EZKART_DOKU_SANDBOX_CLIENT_ID: "REPLACE_MISSING" },
  ]) {
    const app = await setup(overrides);
    try {
      assert.equal(
        (await app.request("/cart/api/start.php", input)).status,
        503,
      );
      assert.equal((await app.calls()).length, 0);
    } finally {
      await app.close();
    }
  }
  const app = await setup({ EZKART_TEST_DOKU_FAILURE: "1" });
  t.after(() => app.close());
  assert.equal((await app.request("/cart/api/start.php", input)).status, 503);
  assert.equal(
    (await app.calls()).filter((x) => x.url.endsWith("/v1/orders")).length,
    0,
  );
  assert.equal(
    (
      await app.request("/cart/api/start.php", input, {
        Origin: "https://attacker.example",
      })
    ).status,
    403,
  );
  assert.equal((await app.request("/cart/api/start.php")).status, 405);
});

test("Biteship installation probes succeed without allowing unauthenticated events", async (t) => {
  const app = await setup({ EZKART_BITESHIP_SANDBOX_WEBHOOK_TOKEN: "" });
  t.after(() => app.close());
  const path = "/cart/api/biteship-webhook.php?environment=sandbox";
  for (const body of ["", "{}", " { \n } "])
    assert.deepEqual(await app.request(path, body), {
      status: 200,
      data: { ok: true, matched: false },
    });
  for (const body of [
    "null",
    "[]",
    '{"event":null}',
    { event: "order.status", order_id: "test", status: "delivered" },
  ])
    assert.equal((await app.request(path, body)).status, 401);
  assert.equal((await app.request(path)).status, 405);
  assert.equal(
    (
      await app.request(
        "/cart/api/biteship-webhook.php?environment=invalid",
        {},
      )
    ).status,
    400,
  );
  assert.equal((await app.request(path, " ".repeat(262145))).status, 400);
  assert.equal(
    app.cli("echo count(glob(ez_order_directory() . '/*.json') ?: []);"),
    "0",
  );
  assert.deepEqual(await app.calls(), []);
});

test("payment URLs reject lookalike hosts, credentials and cross-environment targets", async (t) => {
  const app = await setup();
  t.after(() => app.close());
  for (const url of [
    "https://sandbox.doku.com.attacker.example/checkout-link-v2/test",
    "https://staging.doku.com.attacker.example/checkout-link-v2/test",
    "https://user@sandbox.doku.com/checkout-link-v2/test",
    "https://user@staging.doku.com/checkout-link-v2/test",
    "http://sandbox.doku.com/checkout-link-v2/test",
    "https://jokul.doku.com/checkout-link-v2/test",
    "https://sandbox.doku.com:8443/checkout-link-v2/test",
    "https://sandbox.doku.com/unknown",
  ])
    assert.equal(
      app.cli(
        `echo ez_doku_payment_url_valid(${JSON.stringify(url)}, 'sandbox') ? 'yes' : 'no';`,
      ),
      "no",
    );
  for (const host of ["sandbox.doku.com", "staging.doku.com"])
    for (const path of [
      "/checkout-link/test",
      "/checkout-link-v2/test",
      "/checkout/link/test",
    ])
      assert.equal(
        app.cli(
          `echo ez_doku_payment_url_valid('https://${host}${path}', 'sandbox') ? 'yes' : 'no';`,
        ),
        "yes",
      );
  for (const host of ["sandbox.doku.com", "staging.doku.com"])
    assert.equal(
      app.cli(
        `echo ez_doku_payment_url_valid('https://${host}/checkout-link-v2/test', 'production') ? 'yes' : 'no';`,
      ),
      "no",
    );
});

test("direct BCA API keeps checkout on Ezkart and binds signed confirmation to the account", async (t) => {
  const app = await setup({ EZKART_DOKU_SANDBOX_PAYMENT_FLOW: "" });
  t.after(() => app.close());
  const started = await app.request("/cart/api/start.php", {
    ...input,
    shipping_id: "",
  });
  assert.equal(started.status, 201);
  assert.equal(started.data.payment_flow, "direct_bca");
  assert.equal(new URL(started.data.payment_url).pathname, "/cart/payment.php");
  const id = started.data.order_id;
  const calls = await app.calls();
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    "https://api-sandbox.doku.com/bca-virtual-account/v2/payment-code",
  );
  const headers = Object.fromEntries(
    calls[0].headers.map((h) => h.split(/: (.*)/s).slice(0, 2)),
  );
  assert.equal(
    headers.Signature,
    signature(calls[0].body, headers, "/bca-virtual-account/v2/payment-code"),
  );
  const payload = JSON.parse(calls[0].body);
  assert.equal(payload.order.amount, 116000);
  assert.equal(payload.virtual_account_info.billing_type, "FIX_BILL");
  assert.equal(payload.virtual_account_info.reusable_status, false);
  const before = await app.request(
    "/cart/api/status.php?order=" + id + "&status=PAID",
  );
  assert.equal(before.data.status, "PENDING");
  assert.equal(before.data.payment_details.account_number, "1900800000999999");
  assert.equal(before.data.items.length, 1);
  assert.equal(before.data.items[0].quantity, 2);
  assert.equal(before.data.shipping_skipped, true);
  assert.equal(before.data.total, 116000);
  assert.equal("customer" in before.data, false);
  assert.equal(JSON.stringify(before.data).includes(secret), false);
  assert.equal(
    (await notify(app, id, "SUCCESS", { amount: 116000 })).status,
    400,
  );
  assert.equal(
    (
      await notify(
        app,
        id,
        "SUCCESS",
        { amount: 116000 },
        { virtualAccount: "1900800000000001" },
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await notify(
        app,
        id,
        "SUCCESS",
        { amount: 1 },
        { virtualAccount: "1900800000999999" },
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await notify(
        app,
        id,
        "SUCCESS",
        { amount: 116000 },
        { virtualAccount: "1900800000999999", tamper: true },
      )
    ).status,
    400,
  );
  assert.equal(
    (await app.request("/cart/api/status.php?order=" + id)).data.status,
    "PENDING",
  );
  for (let retry = 0; retry < 2; retry++)
    assert.equal(
      (
        await notify(
          app,
          id,
          "SUCCESS",
          { amount: 116000 },
          { virtualAccount: "1900800000999999" },
        )
      ).status,
      200,
    );
  const paid = await app.request("/cart/api/status.php?order=" + id);
  assert.equal(paid.data.status, "PAID");
  assert.equal(paid.data.fulfillment_status, "NOT_REQUIRED");
  assert.equal(
    (
      await notify(
        app,
        id,
        "FAILED",
        { amount: 116000 },
        { virtualAccount: "1900800000999999" },
      )
    ).status,
    200,
  );
  assert.equal(
    (await app.request("/cart/api/status.php?order=" + id)).data.status,
    "PAID",
  );
});

test("direct BCA rejects mismatched or unusable provider details and cannot use production", async (t) => {
  for (const variant of [
    "invoice",
    "amount",
    "currency",
    "number",
    "expiry",
    "expired",
    "local_expiry",
  ]) {
    const app = await setup({
      EZKART_DOKU_SANDBOX_PAYMENT_FLOW: "",
      EZKART_TEST_DIRECT_RESPONSE: variant,
    });
    try {
      const result = await app.request("/cart/api/start.php", {
        ...input,
        shipping_id: "",
      });
      assert.equal(
        result.status,
        variant === "local_expiry" ? 201 : 503,
        variant,
      );
    } finally {
      await app.close();
    }
  }
  const app = await setup({
    EZKART_DEPLOYMENT_ENVIRONMENT: "production",
    EZKART_COMMERCE_ENVIRONMENT: "production",
    EZKART_DOKU_PRODUCTION_PAYMENT_FLOW: "",
  });
  t.after(() => app.close());
  assert.equal((await app.request("/cart/api/start.php", input)).status, 503);
  assert.equal(
    (await app.calls()).length,
    0,
    "Production must stop before provider or paid rate requests.",
  );
});

test("own payment UI: checkout, copy, reload, expiry, recovery and confirmed payment on desktop and mobile", async (t) => {
  const { chromium } = await import(
    "../builder-mcp/node_modules/playwright/index.mjs"
  );
  const app = await setup({ EZKART_DOKU_SANDBOX_PAYMENT_FLOW: "" });
  t.after(() => app.close());
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  for (const width of [1280, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 960 },
      permissions: ["clipboard-read", "clipboard-write"],
    });
    const page = await context.newPage();
    const errors = [],
      external = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (/doku\.com/.test(request.url())) external.push(request.url());
    });
    await page.goto(app.base + "/cart/?shop=test-shop&cart=granola:2");
    await page.locator("#to-checkout").click();
    for (const [name, value] of Object.entries(input.customer))
      if (value) await page.locator(`[name="${name}"]`).fill(value);
    await page.locator("#pay-button").click();
    await page.waitForURL(/\/cart\/payment\.php\?order=EZK-S-/);
    await page.locator("#transfer-details").waitFor({ state: "visible" });
    const id = new URL(page.url()).searchParams.get("order");
    assert.equal(new URL(page.url()).origin, app.base);
    assert.equal(
      await page.locator("#account-number").inputValue(),
      "1900 8000 0099 9999",
    );
    assert.match(
      await page.locator("#payment-amount").textContent(),
      /116\.000/,
    );
    assert.equal(
      (await page
        .locator(".brand")
        .evaluate((el) => el.getBoundingClientRect().width)) <= 112,
      true,
    );
    await page.locator('[data-copy="account"]').click();
    assert.equal(
      await page.evaluate(() => navigator.clipboard.readText()),
      "1900800000999999",
    );
    await page.locator('[data-copy="amount"]').click();
    assert.equal(
      await page.evaluate(() => navigator.clipboard.readText()),
      "116000",
    );
    await page.locator("#check-payment").click();
    await page.waitForFunction(() =>
      document
        .querySelector("#check-message")
        .textContent.includes("No payment"),
    );
    assert.equal(
      await page.locator("#payment").getAttribute("data-state"),
      "PENDING",
    );
    if (process.env.EZKART_TEST_SCREENSHOTS)
      await page.screenshot({
        path: join(process.env.EZKART_TEST_SCREENSHOTS, `payment-${width}.png`),
        fullPage: true,
      });
    const creates = (await app.calls()).length;
    await page.reload();
    await page.locator("#transfer-details").waitFor({ state: "visible" });
    assert.equal(
      (await app.calls()).length,
      creates,
      "Reload must not create another payment.",
    );
    await page.route("**/api/status.php*", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: '{"ok":false}',
      }),
    );
    await page.locator("#check-payment").click();
    await page.locator("#page-notice").waitFor({ state: "visible" });
    assert.equal(
      await page.locator("#payment").getAttribute("data-state"),
      "PENDING",
    );
    await page.unroute("**/api/status.php*");
    app.cli(
      `$o=ez_load_order('${id}'); $o['payment_details']['expires_at']='2020-01-01T00:00:00Z'; ez_save_order($o);`,
    );
    await page.locator("#check-payment").click();
    await page.waitForFunction(
      () => document.querySelector("#payment").dataset.state === "EXPIRED",
    );
    assert.equal(await page.locator("#transfer-details").isVisible(), false);
    assert.equal(
      (
        await notify(
          app,
          id,
          "SUCCESS",
          { amount: 116000 },
          { virtualAccount: "1900800000999999" },
        )
      ).status,
      200,
    );
    await page.locator("#check-payment").click();
    await page
      .getByRole("heading", { name: "Payment received", exact: true })
      .waitFor();
    assert.equal(await page.locator("#check-payment").isVisible(), false);
    assert.equal(await page.locator("#order-link").isVisible(), true);
    assert.equal(
      await page.evaluate(() =>
        localStorage.getItem("ezkart.checkout.cart.v1:test-shop"),
      ),
      null,
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
    );
    assert.deepEqual(errors, []);
    assert.deepEqual(
      external,
      [],
      "Customers must never load DOKU hosted pages or scripts.",
    );
    await context.close();
  }
});

test("browser checkout redirects to DOKU and shows only server-confirmed payment", async (t) => {
  const { chromium } = await import(
    "../builder-mcp/node_modules/playwright/index.mjs"
  );
  const app = await setup({
    EZKART_BITESHIP_SANDBOX_API_KEY: "REPLACE_MISSING",
    EZKART_BITESHIP_ORIGIN_POSTAL_CODE: "REPLACE_MISSING",
  });
  t.after(() => app.close());
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  for (const width of [1280, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
    });
    const page = await context.newPage();
    const errors = [];
    const rateRequests = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => {
      if (r.url().includes("/api/rates.php")) rateRequests.push(r.url());
    });
    await page.route("https://staging.doku.com/**", (r) =>
      r.fulfill({
        contentType: "text/html",
        body: "<h1>DOKU sandbox fixture</h1>",
      }),
    );
    await page.goto(app.base + "/cart/?shop=test-shop&cart=granola:2");
    await page.locator("#to-checkout").click();
    assert.equal(await page.locator("#get-rates").isVisible(), false);
    assert.equal(await page.locator("#delivery-method").isVisible(), false);
    assert.equal(await page.locator("#pay-button").isEnabled(), true);
    assert.equal(
      await page.locator("#shipping-total").textContent(),
      "Skipped in sandbox",
    );
    await page.locator("#pay-button").click();
    assert.equal(
      await page.locator('[name="fullName"]').getAttribute("class"),
      "invalid",
    );
    for (const [name, value] of Object.entries(input.customer))
      if (value) await page.locator(`[name="${name}"]`).fill(value);
    if (process.env.EZKART_TEST_SCREENSHOTS)
      await page.screenshot({
        path: join(
          process.env.EZKART_TEST_SCREENSHOTS,
          `checkout-${width}.png`,
        ),
        fullPage: true,
      });
    await page.locator("#pay-button").click();
    await page.waitForURL("https://staging.doku.com/checkout-link-v2/fixture");
    const created = (await app.calls())
      .filter((x) => x.url.includes("api-sandbox.doku.com"))
      .at(-1);
    const id = JSON.parse(created.body).order.invoice_number;
    assert.equal(JSON.parse(created.body).order.amount, 116000);
    assert.deepEqual(rateRequests, []);
    assert.equal(
      (await notify(app, id, "SUCCESS", { amount: 116000 })).status,
      200,
    );
    await page.goto(app.base + `/cart/return.php?order=${id}&shop=test-shop`);
    await page
      .getByRole("heading", { name: "Payment confirmed", exact: true })
      .waitFor();
    assert.equal(
      await page.locator("#return-status").textContent(),
      "PAID (test)",
    );
    assert.equal(
      await page.locator("#return-fulfillment").textContent(),
      "Delivery skipped (sandbox)",
    );
    assert.match(
      await page.locator("#return-message").textContent(),
      /Delivery was skipped/,
    );
    assert.equal(
      await page.evaluate(() =>
        localStorage.getItem("ezkart.checkout.cart.v1:test-shop"),
      ),
      null,
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
    );
    assert.deepEqual(errors, []);
    await context.close();
  }
});

test("production browser checkout still requires a delivery quote before payment", async (t) => {
  const { chromium } = await import(
    "../builder-mcp/node_modules/playwright/index.mjs"
  );
  const app = await setup({
    EZKART_DEPLOYMENT_ENVIRONMENT: "production",
    EZKART_COMMERCE_ENVIRONMENT: "production",
  });
  t.after(() => app.close());
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  await page.route("https://jokul.doku.com/**", (r) =>
    r.fulfill({ body: "Production payment fixture" }),
  );
  await page.goto(app.base + "/cart/?shop=test-shop&cart=granola:2");
  await page.locator("#to-checkout").click();
  assert.equal(await page.locator("#get-rates").isVisible(), true);
  assert.equal(await page.locator("#delivery-method").isVisible(), true);
  assert.equal(await page.locator("#pay-button").isEnabled(), false);
  for (const [name, value] of Object.entries(input.customer))
    if (value) await page.locator(`[name="${name}"]`).fill(value);
  await page.locator("#get-rates").click();
  await page.locator('input[name="shipping"]').waitFor();
  await page.locator("#pay-button").click();
  await page.waitForURL("https://jokul.doku.com/checkout-link-v2/fixture");
  const calls = await app.calls();
  assert.equal(
    calls.filter((c) => c.url.endsWith("/rates/couriers")).length,
    2,
  );
  assert.equal(JSON.parse(calls.at(-1).body).order.amount, 134000);
});

test("merchant dashboard displays DOKU orders and accepts and arranges pickup through its UI", async (t) => {
  const { chromium } = await import(
    "../builder-mcp/node_modules/playwright/index.mjs"
  );
  const app = await setup();
  t.after(() => app.close());
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const started = await app.request("/cart/api/start.php", input);
  const id = started.data.order_id;
  await notify(app, id);
  const page = await browser.newPage();
  await page.goto(app.base + "/cart/admin/");
  await page.getByText("Use emergency admin password").click();
  await page.locator("#password").fill("fixture-admin-password");
  await page.getByRole("button", { name: "Enter dashboard" }).click();
  await page.goto(app.base + "/cart/admin/?page=orders");
  const row = page.getByRole("button", {
    name: "#" + id.replace("EZK-", ""),
    exact: true,
  });
  await row.click();
  await page.getByRole("button", { name: "Accept order", exact: true }).click();
  await row.click();
  await page
    .getByRole("button", { name: "Arrange pickup", exact: true })
    .click();
  assert.equal(
    (await app.request(`/cart/api/status.php?order=${id}`)).data
      .fulfillment_status,
    "CONFIRMED",
  );
  await page.goto(app.base + "/cart/admin/?page=integrations");
  assert.match(await page.locator("body").innerText(), /DOKU/);
  assert.equal(
    await page
      .getByRole("link", { name: "View configuration status" })
      .getAttribute("href"),
    "../api/health.php",
  );
});


const bridgeSecret = "fixture-executive-bridge-secret-43-characters-minimum";
function bridgeHeaders(input, overrides = {}) {
  const body = JSON.stringify(input), timestamp = String(Math.floor(Date.now() / 1000)), nonce = randomBytes(24).toString("hex");
  return {
    "X-Executive-Time": timestamp,
    "X-Executive-Nonce": nonce,
    "X-Executive-Signature": createHmac("sha256", bridgeSecret).update(["ezkart-executive-bridge", "POST", "/cart/api/executive.php", timestamp, nonce, createHash("sha256").update(body).digest("hex")].join("\n")).digest("hex"),
    ...overrides,
  };
}
test("executive bridge requires signed requests, rejects replay, and exports only the requested environment", async t => {
  const app = await setup({EZKART_EXECUTIVE_BRIDGE_SECRET: bridgeSecret});t.after(() => app.close());
  const path = "/cart/api/executive.php", query = {action:"orders",environment:"sandbox"};
  assert.equal((await app.request(path, query)).status,401);
  assert.equal((await app.request(path, query, bridgeHeaders(query,{"X-Executive-Signature":"0".repeat(64)}))).status,403);
  const started = await app.request("/cart/api/start.php", input);assert.equal(started.status,201);
  const headers = bridgeHeaders(query);const exportResult=await app.request(path,query,headers);assert.equal(exportResult.status,200);assert.equal(exportResult.data.orders.length,1);assert.equal(exportResult.data.orders[0].seller_id,"demo");
  for(const key of ["phone","address","payment_url","payment_details","secret","raw_event_json"])assert.ok(!(key in exportResult.data.orders[0]));
  assert.equal((await app.request(path,query,headers)).status,409);
  const live={...query,environment:"production"};assert.equal((await app.request(path,live,bridgeHeaders(query))).status,403);
  assert.equal((await app.request(path,live,bridgeHeaders(live))).data.orders.length,0);
  const status={action:"status",environment:"sandbox"};assert.equal((await app.request(path,status,bridgeHeaders(status))).data.mode,"sandbox");
});
test("workbench mode switches both providers while preserving existing order environment and pinning each request", async t => {
  const app = await setup({EZKART_EXECUTIVE_BRIDGE_SECRET:bridgeSecret});t.after(()=>app.close());
  const path="/cart/api/executive.php";
  const older=await app.request("/cart/api/start.php",input);assert.equal(older.status,201);
  const stale={action:"set-mode",environment:"sandbox",target:"production",expected_mode:"production"};assert.equal((await app.request(path,stale,bridgeHeaders(stale))).status,409);
  const change={...stale,expected_mode:"sandbox"};const changed=await app.request(path,change,bridgeHeaders(change));assert.equal(changed.status,200);assert.equal(changed.data.mode,"production");
  const newer=await app.request("/cart/api/start.php",input);assert.equal(newer.status,201);assert.match(newer.data.order_id,/^EZK-P-/);assert.match(newer.data.payment_url,/jokul\.doku\.com/);
  const calls=await app.calls();assert.equal(calls.at(-1).url,"https://api.doku.com/checkout/v1/payment");assert.ok(calls.at(-2).headers.includes("Authorization: biteship_live.fixture"));
  assert.equal((await notify(app,older.data.order_id)).status,200,"Original sandbox payment still verifies after mode switch.");
  app.cli(`ez_create_biteship_order(ez_load_order('${older.data.order_id}'));`);
  assert.ok((await app.calls()).at(-1).headers.includes("Authorization: biteship_test.fixture"),"Old order keeps its sandbox shipping key.");
  const pin=app.cli(`require_once ${JSON.stringify(join(root,"cart/api/executive-bridge.php"))};$path=ez_executive_directory().'/mode.json';file_put_contents($path,json_encode(['mode'=>'sandbox']));echo ez_commerce_environment();file_put_contents($path,json_encode(['mode'=>'production']));echo ':'.ez_commerce_environment();`);assert.equal(pin,"sandbox:sandbox");
});
test("production mode remains unavailable when the payment integration is not ready; live storefront exposes no switch",async t=>{
  const app=await setup({EZKART_EXECUTIVE_BRIDGE_SECRET:bridgeSecret,EZKART_DOKU_PRODUCTION_PAYMENT_FLOW:"direct_bca"});t.after(()=>app.close());
  const input={action:"set-mode",environment:"sandbox",target:"production",expected_mode:"sandbox"};assert.equal((await app.request('/cart/api/executive.php',input,bridgeHeaders(input))).status,422);assert.equal((await app.request('/cart/api/checkout-config.php')).data.environment,'sandbox');
  const live=await setup({EZKART_DEPLOYMENT_ENVIRONMENT:'production',EZKART_COMMERCE_ENVIRONMENT:'production',EZKART_EXECUTIVE_BRIDGE_SECRET:bridgeSecret});t.after(()=>live.close());assert.equal((await live.request('/cart/api/executive.php',input,bridgeHeaders(input))).status,403);
});
