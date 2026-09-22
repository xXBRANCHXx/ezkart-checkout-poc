import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
async function prepareMap(page) {
  const control = { requests: [], pending: [], hold: false, fail: false };
  const sdk = await readFile(join(root, "cart/vendor/maplibre/maplibre-gl.js"), "utf8");
  await page.route("**/vendor/maplibre/maplibre-gl.js?*", (route) => route.fulfill({ contentType: "text/javascript", body: sdk + "\nmaplibregl.Map = class extends maplibregl.Map { constructor(options) { super(options); window.deliveryMapUnderTest = this; } };" }));
  await page.route("**/tracking-map-style.json?*", (route) => route.fulfill({ json: { version: 8, sources: {}, layers: [{ id: "background", type: "background", paint: { "background-color": "#eef1f4" } }] } }));
  await page.route("**/api/tracking-route.php?*", async (route) => {
    const stage = new URL(route.request().url()).searchParams.get("stage");
    const tracking = stage ? await page.evaluate(() => window.ezkartTrackingSandbox.read().tracking) : {
      latest_location: { latitude: -6.2441792, longitude: 106.783529 },
      locations: { destination: { latitude: -6.28927, longitude: 106.77492000000007 } },
    };
    const from = tracking.latest_location || tracking.locations.origin;
    const to = tracking.locations[tracking.stage === "returning" ? "origin" : "destination"];
    const data = { ok: true, route: { type: "LineString", from, to, coordinates: [[from.longitude, from.latitude], [to.longitude, to.latitude]] } };
    control.requests.push(data.route);
    if (control.hold) await new Promise((resolve) => control.pending.push(resolve));
    await route.fulfill(control.fail ? { status: 503, json: { ok: false } } : { json: data });
  });
  return control;
}
async function setup(overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), "ezkart-checkout-test-"));
  const capture = join(directory, "calls.jsonl");
  const env = {
    ...process.env,
    EZKART_TEST_CAPTURE: capture,
    EZKART_SANDBOX_ADMIN_PASSWORD: "fixture-admin-password",
    EZKART_ADMIN_SESSION_STORAGE: join(directory, "sessions"),
    EZKART_CUSTOMER_SESSION_STORAGE: join(directory, "customer-sessions"),
    EZKART_SUPABASE_URL: "https://auth.ezkart.test",
    EZKART_SUPABASE_PUBLISHABLE_KEY: "fixture-publishable-key",
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
    customerCookie(email = "checkout@example.com", id = "fixture-google-customer", expiresIn = 3600) {
      const account = Buffer.from(JSON.stringify({ id, email })).toString("base64");
      const sid = this.cli(`require ${JSON.stringify(join(root, "cart/api/customer-auth.php"))}; ez_customer_session(); $_SESSION['customer_auth']=['user'=>json_decode(base64_decode('${account}'),true),'access_token'=>str_repeat('x',64),'refresh_token'=>'fixture-refresh','expires_at'=>time()+${expiresIn},'signed_in_at'=>time()]; echo session_id(); session_write_close();`);
      return { name: "ezkart_customer", value: sid, domain: "127.0.0.1", path: "/cart", httpOnly: true, sameSite: "Lax" };
    },
    adminCookie(changes = {}) {
      const token = "fixture." + Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600, aal: "aal1" })).toString("base64url") + ".fixture-signature";
      const data = Buffer.from(JSON.stringify({ authenticated: true, authentication_method: "supabase", authenticated_until: Math.floor(Date.now() / 1000) + 3600, signed_in_at: Math.floor(Date.now() / 1000), supabase_access_token: token, supabase_refresh_token: "fixture-admin-refresh", mfa_enabled: false, legacy_data_access: false, admin_user: { id: "fixture-google-customer", email: "checkout@example.com" }, ...changes })).toString("base64");
      const sid = this.cli(`define('EZ_CUSTOMER_SESSION_BRIDGE', true); require ${JSON.stringify(join(root, "cart/admin/index.php"))}; $_SESSION=json_decode(base64_decode('${data}'),true); echo session_id(); session_write_close();`);
      return { name: "ezkart_admin", value: sid, domain: "127.0.0.1", path: "/cart/admin", httpOnly: true, sameSite: "Lax" };
    },
    async tracking(id, { refresh = false, cookie } = {}) {
      cookie ||= this.defaultCustomerCookie ||= this.customerCookie();
      return this.request(`/cart/api/status.php?order=${encodeURIComponent(id)}&tracking=1${refresh ? "" : "&refresh=0"}`, undefined, { Cookie: `${cookie.name}=${cookie.value}` });
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
  const paid = (await app.tracking(id)).data;
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
    (await app.tracking(id)).data
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
    (await app.tracking(id)).data
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
  const paid = await app.tracking(id);
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
      if (value) await page.locator(`#customer-form [name="${name}"]`).fill(value);
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
      await page.locator('#customer-form [name="fullName"]').getAttribute("class"),
      "invalid",
    );
    for (const [name, value] of Object.entries(input.customer))
      if (value) await page.locator(`#customer-form [name="${name}"]`).fill(value);
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
    await page.context().addCookies([app.customerCookie()]);
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
    if (value) await page.locator(`#customer-form [name="${name}"]`).fill(value);
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
    (await app.tracking(id)).data
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

function trackingResponse(id, status = "in_transit", extra = {}) {
  return {
    success: true, id: "test-shipment-" + id, status,
    origin: { contact_name: "Private warehouse", address: "Private origin address", coordinate: { latitude: -6.2253114, longitude: 106.7993735 } },
    destination: { contact_name: "Private customer", address: "Private destination address", coordinate: { latitude: -6.28927, longitude: 106.77492000000007 } },
    courier: {
      tracking_id: "test-tracking", waybill_id: "TEST-AWB", company: "jne", type: "reg",
      driver_phone: "PRIVATE-PHONE", link: "https://track.biteship.com/fixture",
      history: [
        { status: "picked", updated_at: "2026-09-20T10:00:00+07:00", note: "Package collected from seller." },
        { status: "inTransit", updated_at: "2026-09-20T12:00:00+07:00", note: "Arrived at the Jakarta sorting facility.", coordinate: { latitude: -6.2441792, longitude: 106.783529 }, location_name: "Jakarta sorting facility" },
      ],
    },
    ...extra,
  };
}
async function saveTrackingResponse(app, payload) {
  await writeFile(join(app.directory, "tracking-response.json"), typeof payload === "string" ? payload : JSON.stringify(payload));
}
function expireTrackingCache(app, id) {
  app.cli(`$o=ez_load_order('${id}'); $o['tracking_requested_at']=0; ez_save_order($o);`);
}
async function shippingEvent(app, id, status, extra = {}) {
  return app.request("/cart/api/biteship-webhook.php?environment=sandbox", { event: "order.status", order_id: "test-shipment-" + id, status, ...extra }, { Authorization: "Bearer " + app.env.EZKART_BITESHIP_SANDBOX_WEBHOOK_TOKEN });
}

test("tracking follows seller processing and pickup, caches provider reads, and keeps customer output bounded", async (t) => {
  const app = await setup(); t.after(() => app.close());
  const id = (await app.request("/cart/api/start.php", input)).data.order_id;
  const tracking = () => app.tracking(id, { refresh: true });
  assert.equal((await tracking()).data.tracking.stage, "awaiting_payment");
  await notify(app, id);
  let data = (await tracking()).data;
  assert.equal(data.tracking.stage, "processing");
  assert.equal(data.tracking.seller_accepted, false);
  app.cli(`ez_accept_paid_order('${id}');`);
  assert.equal((await tracking()).data.tracking.seller_accepted, true);
  assert.equal((await app.calls()).length, 2, "No tracking requests before a shipment exists.");
  app.cli(`ez_arrange_paid_order_pickup('${id}');`);
  data = (await app.tracking(id)).data;
  assert.equal(data.tracking.stage, "awaiting_pickup");
  assert.equal(data.tracking.progress, 2, "A waybill does not mean the courier collected the package.");
  const response = trackingResponse(id, "inTransit");
  await saveTrackingResponse(app, response);
  data = (await tracking()).data;
  assert.equal(data.tracking.stage, "in_transit");
  assert.equal(data.tracking.history.length, 2);
  assert.equal(data.tracking.history[1].status, "in_transit");
  assert.equal(data.tracking.waybill_id, "TEST-AWB");
  assert.equal(data.tracking.locations.origin.latitude, -6.2253114);
  for (const privateValue of ["PRIVATE-PHONE", "Private origin address", "Private destination address", "biteship_test.fixture"])
    assert.equal(JSON.stringify(data).includes(privateValue), false);
  const requests = (await app.calls()).filter((call) => call.url.includes("/v1/orders/"));
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, "GET");
  assert.ok(requests[0].headers.includes("Authorization: biteship_test.fixture"));
  for (let i = 0; i < 3; i++) await tracking();
  assert.equal((await app.calls()).filter((call) => call.url.includes("/v1/orders/")).length, 1);
  await saveTrackingResponse(app, "unavailable"); expireTrackingCache(app, id);
  data = (await tracking()).data;
  assert.equal(data.status, "PAID");
  assert.equal(data.tracking.stage, "in_transit");
  assert.equal(data.tracking.unavailable, true);
  await tracking();
  assert.equal((await app.calls()).filter((call) => call.url.includes("/v1/orders/")).length, 2, "Failed requests are throttled too.");
  response.id = "wrong-shipment";
  await saveTrackingResponse(app, response); expireTrackingCache(app, id);
  assert.equal((await tracking()).data.tracking.unavailable, true, "Mismatched responses cannot overwrite an order.");
  response.id = "test-shipment-" + id;
  response.courier.link = "javascript:alert(1)";
  response.origin.coordinate.latitude = 100;
  await saveTrackingResponse(app, response); expireTrackingCache(app, id);
  data = (await tracking()).data;
  assert.equal(data.tracking.unavailable, false);
  assert.equal(data.tracking.link, "");
  assert.equal(data.tracking.locations.origin, null);
  assert.equal((await app.tracking("bad")).status, 404);
});

test("courier events handle aliases, retries, delayed events, delivery exceptions and returns", async (t) => {
  const app = await setup(); t.after(() => app.close());
  const id = (await app.request("/cart/api/start.php", input)).data.order_id;
  await notify(app, id); app.cli(`ez_accept_paid_order('${id}'); ez_arrange_paid_order_pickup('${id}');`);
  const status = async () => (await app.tracking(id)).data;
  for (const [event, stage] of [["pickingUp", "awaiting_pickup"], ["picked", "in_transit"], ["droppingOff", "out_for_delivery"], ["onHold", "attention"], ["droppingOff", "out_for_delivery"], ["delivered", "delivered"], ["returnInTransit", "returning"], ["returned", "returned"]]) {
    assert.equal((await shippingEvent(app, id, event)).status, 200);
    assert.equal((await status()).tracking.stage, stage, event);
    const count = (await status()).tracking.history.length;
    await shippingEvent(app, id, event);
    assert.equal((await status()).tracking.history.length, count, "Duplicate callbacks do not add history.");
    assert.equal((await status()).status, "PAID");
  }
  await shippingEvent(app, id, "picked", { updated_at: "2020-01-01T00:00:00Z" });
  assert.equal((await status()).tracking.stage, "returned");
  await shippingEvent(app, id, "return_in_transit");
  assert.equal((await status()).tracking.stage, "returned", "An un-timestamped retry cannot undo a completed return.");
  const before = (await status()).tracking.shipment_status;
  await app.request("/cart/api/biteship-webhook.php?environment=sandbox", { event: "order.price", order_id: "test-shipment-" + id, status: "confirmed", price: 19000 }, { Authorization: "Bearer " + app.env.EZKART_BITESHIP_SANDBOX_WEBHOOK_TOKEN });
  assert.equal((await status()).tracking.shipment_status, before, "A price event cannot reset shipping progress.");
  assert.equal((await status()).tracking.progress < 4, true);
  for (const event of ["cancelled", "courierNotFound", "rejected", "disposed", "on_hold", "new_provider_status"]) {
    app.cli(`$o=ez_load_order('${id}'); unset($o['biteship_status_at'], $o['biteship_last_status_event_hash']); $o['biteship_status']='confirmed'; ez_save_order($o);`);
    await shippingEvent(app, id, event);
    assert.equal((await status()).tracking.stage, event === "cancelled" ? "cancelled" : event === "new_provider_status" ? "shipment_update" : "attention");
  }
});

test("automatic payment polling does not flash the button; a manual click joins a pending check", async (t) => {
  const { chromium } = await import("../builder-mcp/node_modules/playwright/index.mjs");
  const app = await setup({ EZKART_DOKU_SANDBOX_PAYMENT_FLOW: "" }); t.after(() => app.close());
  const id = (await app.request("/cart/api/start.php", { ...input, shipping_id: "" })).data.order_id;
  app.cli(`$o=ez_load_order('${id}'); $o['payment_details']['expires_at']='2020-01-01T00:00:00Z'; ez_save_order($o);`);
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage();
  await page.clock.install();
  await page.goto(app.base + `/cart/payment.php?order=${id}`);
  await page.waitForFunction(() => document.querySelector("#payment").dataset.state === "EXPIRED");
  await page.evaluate(() => {
    window.buttonMutations = [];
    new MutationObserver((changes) => window.buttonMutations.push(...changes.map((change) => change.attributeName))).observe(document.querySelector("#check-payment"), { attributes: true, attributeFilter: ["disabled", "aria-busy"] });
  });
  let release, intercepted;
  const pending = new Promise((resolve) => { intercepted = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  let requests = 0;
  await page.route("**/api/status.php*", async (route) => { requests++; intercepted(); await gate; await route.continue(); });
  await page.clock.fastForward(5001);
  await pending;
  assert.equal(await page.locator("#check-payment").isEnabled(), true);
  assert.deepEqual(await page.evaluate(() => window.buttonMutations), []);
  await page.locator("#check-payment").click();
  assert.equal(await page.locator("#check-payment").isDisabled(), true);
  assert.equal(requests, 1);
  release();
  await page.waitForFunction(() => !document.querySelector("#check-payment").disabled);
  assert.match(await page.locator("#check-message").textContent(), /No payment confirmation/);
  assert.equal(requests, 1);
});

test("customer tracking UI follows fulfillment, preserves updates on failure, and conditionally displays maps on desktop and mobile", async (t) => {
  const { chromium } = await import("../builder-mcp/node_modules/playwright/index.mjs");
  const app = await setup(); t.after(() => app.close());
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  for (const width of [1280, 390]) {
    const id = (await app.request("/cart/api/start.php", input)).data.order_id;
    await notify(app, id);
    const page = await browser.newPage({ viewport: { width, height: 960 }, hasTouch: width === 390 });
    const errors = []; page.on("pageerror", (error) => errors.push(error.message));
    // Exercise the real vendored renderer with local basemap/route data.
    const routes = await prepareMap(page);
    await page.clock.install();
    await page.context().addCookies([app.customerCookie()]);
    await page.goto(app.base + `/cart/return.php?order=${id}&shop=test-shop`);
    await page.getByRole("heading", { name: "Your order is with the seller", exact: true }).waitFor();
    assert.equal(await page.locator("#delivery-map-section").isVisible(), false);
    assert.equal(await page.locator("#courier-tracking-link").isVisible(), false);
    assert.equal(await page.locator("#refresh-tracking, #return-icon").count(), 0);
    app.cli(`ez_accept_paid_order('${id}');`);
    await page.clock.fastForward(15001);
    await page.getByRole("heading", { name: "The seller is preparing your order", exact: true }).waitFor();
    app.cli(`ez_arrange_paid_order_pickup('${id}');`);
    const response = trackingResponse(id, "confirmed");
    response.courier.history = [];
    response.origin.coordinate = response.destination.coordinate = null;
    await saveTrackingResponse(app, response);
    await page.clock.fastForward(15001);
    await page.getByRole("heading", { name: "Your order is awaiting pickup", exact: true }).waitFor();
    assert.match(await page.locator('[aria-current="step"]').textContent(), /Awaiting pickup/);
    assert.equal(await page.locator("#package-map-frame").isVisible(), false);
    assert.equal(await page.locator("#package-location-empty").isVisible(), true);
    const inTransit = trackingResponse(id);
    inTransit.courier.type = "instant";
    inTransit.courier.history[1].note = '<img src=x onerror="window.injected=true"> Sorting facility update';
    inTransit.courier.history[1].location_name = '<img src=x onerror="window.injected=true"> Sorting facility';
    await saveTrackingResponse(app, inTransit); expireTrackingCache(app, id);
    await page.clock.fastForward(15001);
    await page.getByRole("heading", { name: "Your order is on the way", exact: true }).waitFor();
    assert.match(await page.locator("#tracking-history").textContent(), /Sorting facility update/);
    assert.equal(await page.locator("#tracking-history img").count(), 0);
    assert.equal(await page.locator("#courier-tracking-link").textContent(), "View courier live tracking ↗");
    assert.equal(await page.locator("#courier-tracking-link").getAttribute("rel"), "noopener noreferrer");
    await page.locator("#delivery-map").scrollIntoViewIfNeeded();
    await page.locator('.shipment-pin-truck').waitFor();
    assert.equal(await page.locator('.shipment-pin-truck').count(), 1);
    assert.equal(await page.locator('.shipment-pin-destination').count(), 1);
    assert.equal(await page.locator('#delivery-map img').count(), 0, "Provider labels cannot inject HTML.");
    assert.equal(await page.evaluate(() => window.injected), undefined);
    const centered = await page.evaluate(() => {
      const map = document.querySelector('#delivery-map').getBoundingClientRect(), pin = document.querySelector('.shipment-pin-truck').getBoundingClientRect();
      return Math.abs(map.x + map.width / 2 - pin.x - pin.width / 2) < 3 && Math.abs(map.y + map.height / 2 - pin.y - pin.height / 2) < 3;
    });
    assert.equal(centered, true, "The truck stays at the reported package location.");
    assert.match(await page.locator("#delivery-map-section").textContent(), /Last reported location/);
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('[aria-current="step"] .step-dot')).backgroundColor), "rgb(24, 43, 69)");
    assert.equal(await page.evaluate(() => deliveryMapUnderTest.scrollZoom.isEnabled() && deliveryMapUnderTest.touchZoomRotate.isEnabled()), true);
    assert.equal(await page.evaluate(() => deliveryMapUnderTest.getZoom()), 15);
    await page.getByRole("button", { name: "Zoom in", exact: true }).click();
    assert.equal(await page.evaluate(() => deliveryMapUnderTest.getZoom()), 16);
    await page.getByRole("button", { name: "Zoom out", exact: true }).click();
    assert.equal(await page.evaluate(() => deliveryMapUnderTest.getZoom()), 15);
    assert.ok((await page.locator("#delivery-map").boundingBox()).height >= 400);
    await page.waitForFunction(() => deliveryMapUnderTest.getSource("delivery-route").serialize().data.geometry?.type === "LineString");
    assert.match(await page.locator("#map-route-note").textContent(), /Suggested road route/);
    const requests = routes.requests;
    assert.equal(requests.length, 1);
    assert.equal(requests[0].from.latitude, -6.2441792);
    assert.equal(requests[0].from.longitude, 106.783529);
    await page.evaluate(() => { deliveryMapUnderTest.setZoom(17); deliveryMapUnderTest.setCenter([106.78, -6.25]); });
    const viewport = await page.evaluate(() => ({ zoom: deliveryMapUnderTest.getZoom(), center: deliveryMapUnderTest.getCenter() }));
    inTransit.courier.history[1].updated_at = "2026-09-20T12:05:00+07:00";
    await saveTrackingResponse(app, inTransit); expireTrackingCache(app, id);
    await page.clock.fastForward(15001);
    await page.waitForFunction(() => document.querySelector("#package-location-time").textContent.includes("12:05"));
    assert.deepEqual(await page.evaluate(() => ({ zoom: deliveryMapUnderTest.getZoom(), center: deliveryMapUnderTest.getCenter() })), viewport);
    assert.equal(routes.requests.length, 1, "Polling doesn't recalculate an unchanged route.");
    const google = new URL(await page.locator("#google-maps-link").getAttribute("href"));
    assert.equal(google.origin, "https://www.google.com");
    assert.equal(google.searchParams.get("query"), "-6.2441792,106.783529");
    await page.locator("#map-route-toggle").click();
    assert.equal(await page.locator('.shipment-pin-pickup').count(), 1);
    await page.locator("#map-recenter").click();
    assert.equal(await page.locator('.shipment-pin-truck').count(), 1);
    assert.equal(await page.evaluate(() => deliveryMapUnderTest.getZoom()), 15);
    if (process.env.EZKART_TEST_SCREENSHOTS) await page.screenshot({ path: join(process.env.EZKART_TEST_SCREENSHOTS, `tracking-${width}.png`), fullPage: true });
    await page.route("**/api/status.php*", (route) => route.fulfill({ status: 503, contentType: "application/json", body: '{"ok":false}' }));
    await page.clock.fastForward(15001);
    await page.locator("#tracking-notice").waitFor({ state: "visible" });
    assert.equal(await page.locator("#return-title").textContent(), "Your order is on the way");
    await page.unroute("**/api/status.php*");
    await shippingEvent(app, id, "delivered");
    await page.clock.fastForward(30001);
    await page.getByRole("heading", { name: "Your order has been delivered", exact: true }).waitFor();
    assert.match(await page.locator('[aria-current="step"]').textContent(), /Delivered/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    assert.deepEqual(errors, []);
    await page.close();
  }
});

test("road routing authenticates owners, caches results and failures, and enforces free-provider limits", async (t) => {
  const app = await setup(); t.after(() => app.close());
  const id = (await app.request("/cart/api/start.php", input)).data.order_id;
  await notify(app, id); app.cli(`ez_accept_paid_order('${id}'); ez_arrange_paid_order_pickup('${id}');`);
  await saveTrackingResponse(app, trackingResponse(id));
  await app.tracking(id, { refresh: true });
  const cookie = app.customerCookie();
  const headers = { Cookie: `${cookie.name}=${cookie.value}` };
  const url = `/cart/api/tracking-route.php?order=${id}`;
  const sample = stage => `/cart/api/tracking-route.php?sandbox=1&stage=${stage}`;
  const route = path => app.request(path, undefined, headers);
  const callsBefore = (await app.calls()).length;
  assert.equal((await app.request(url)).status, 401);
  assert.equal((await app.request(url, {}, headers)).status, 405);
  const other = app.customerCookie("another@example.com", "another-user");
  assert.equal((await app.request(url, undefined, { Cookie: `${other.name}=${other.value}` })).status, 404);
  assert.equal((await route(sample("unknown"))).status, 404);
  assert.equal((await app.calls()).length, callsBefore);
  const first = await route(url + "&from=0,0&url=https://untrusted.example");
  assert.equal(first.status, 200);
  assert.equal(first.data.route.from.latitude, -6.2441792);
  assert.equal(first.data.route.to.latitude, -6.28927);
  assert.deepEqual(await route(url), first);
  let calls = (await app.calls()).slice(callsBefore);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /^https:\/\/routing\.openstreetmap\.de\/routed-car\/route\/v1\/driving\/106\.7835290,-6\.2441792;106\.7749200,-6\.2892700\?/);
  assert.ok(calls[0].headers.includes("Referer: https://test.ezkart.id/"));
  assert.equal(calls[0].body, "");
  assert.equal(calls[0].url.includes(id), false);
  const directory = app.cli("echo dirname(ez_order_directory('sandbox')) . '/tracking-routes';");
  const allowance = join(directory, "requests.lock");
  const setUsage = (count, last = 0) => writeFile(allowance, JSON.stringify({ day: new Date().toISOString().slice(0, 10), count, last }));
  await setUsage(100);
  assert.equal((await route(sample("pickup"))).status, 503);
  assert.deepEqual(await route(url), first, "Cached routes remain available at the daily limit.");
  await setUsage(1, Date.now() / 1000);
  assert.equal((await route(sample("pickup"))).status, 503, "Uncached requests cannot exceed one per second.");
  assert.equal((await app.calls()).length, callsBefore + 1);
  await setUsage(1);
  assert.equal((await route(sample("pickup"))).status, 200);
  await setUsage(2);
  await writeFile(join(app.directory, "route-response.json"), JSON.stringify({ code: "Ok", routes: [{ geometry: { type: "LineString", coordinates: [[106, -6], [999, -6]] } }] }));
  assert.equal((await route(sample("returning"))).status, 503, "Invalid provider geometry is rejected.");
  assert.equal((await route(sample("returning"))).status, 503, "Failures are cached too.");
  for (const stage of ["pending", "paid", "processing", "delivered", "returned", "cancelled", "no-map"]) {
    assert.deepEqual(await route(sample(stage)), { status: 200, data: { ok: true, route: null } });
  }
  calls = (await app.calls()).slice(callsBefore);
  assert.equal(calls.length, 3);
  assert.ok(calls.every(call => call.url.startsWith("https://routing.openstreetmap.de/")), "Routing cannot refresh Biteship or write to a provider.");
});

test("customer address proxy requires customer identity and CSRF and reuses verified Google sessions without sharing tokens", async t => {
  const app = await setup({ EZKART_CLOUDFLARE_API_URL: "https://ezkart-api-test.fixture.workers.dev" }); t.after(() => app.close());
  const endpoint = "/cart/admin/customer-addresses.php";
  assert.equal((await app.request(endpoint)).data.authenticated, false);
  assert.equal((await app.request(endpoint, {})).status, 401);
  const cookie = app.customerCookie(); const headers = { Cookie: `${cookie.name}=${cookie.value}` };
  const first = await app.request(endpoint, undefined, headers);
  assert.equal(first.status, 200); assert.equal(first.data.authenticated, true); assert.equal(first.data.book.addresses.length, 0);
  const address = { label: "Home", address: "Jalan Teluk Betung 12", location: "Jakarta", postalCode: "10230", fullName: "Checkout Tester", phone: "081234567890", note: "", coordinate: { latitude: -6.1957601, longitude: 106.8214547 } };
  const payload = { action: "save", address, revision: 0 };
  assert.equal((await app.request(endpoint, payload, headers)).status, 403);
  assert.equal((await app.request(endpoint, payload, { ...headers, "X-Ezkart-CSRF": first.data.csrf, Origin: "https://wrong.example" })).status, 403);
  const saved = await app.request(endpoint, payload, { ...headers, "X-Ezkart-CSRF": first.data.csrf });
  assert.equal(saved.status, 200); assert.ok(saved.data.book.addresses[0].preview_id);
  assert.equal(JSON.stringify(saved.data).includes("access_token"), false);
  const preview = await app.request("/cart/api/tracking-route.php?sandbox=1&stage=transit&place=" + saved.data.book.addresses[0].preview_id, undefined, headers);
  assert.deepEqual(preview.data.route.to, address.coordinate);
  const { chromium } = await import("../builder-mcp/node_modules/playwright/index.mjs");
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage(); await page.context().addCookies([app.adminCookie()]);
  await page.goto(app.base + "/cart/tracking-sandbox.php?stage=processing");
  await page.locator("#tracking-content").waitFor({ state: "visible" });
  const bridged = await page.request.get(app.base + endpoint);
  assert.equal(bridged.status(), 200); assert.equal((await bridged.json()).book.addresses.length, 1);
  const session = (await page.context().cookies()).find(c => c.name === "ezkart_customer");
  assert.equal(app.cli(`require ${JSON.stringify(join(root, "cart/api/customer-auth.php"))}; session_id('${session.value}'); ez_customer_session(); echo isset($_SESSION['customer_auth']['access_token']) ? 'token' : 'no-token'; session_write_close();`), "no-token");
  const wrongAdmin = app.adminCookie({ admin_user: { id: "different-account", email: "different@example.com" } });
  await page.context().addCookies([wrongAdmin]);
  assert.equal((await page.request.get(app.base + endpoint)).status(), 401);
  assert.equal(app.cli(`require ${JSON.stringify(join(root, "cart/api/customer-auth.php"))}; echo ez_customer_next('/cart/?shop=test-shop&return=https://bad.example');`), "/cart/?shop=test-shop");
});

test("saved addresses fill checkout, invalidate quotes, and support three named addresses, defaults and edits on desktop/mobile", async t => {
  const app = await setup({ EZKART_CLOUDFLARE_API_URL: "https://ezkart-api-test.fixture.workers.dev", EZKART_COMMERCE_ENVIRONMENT: "production" }); t.after(() => app.close());
  const { chromium } = await import("../builder-mcp/node_modules/playwright/index.mjs");
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  for (const width of [1280, 390]) {
    const home = { id: "saved-home", label: "Home", address: "Jalan Home Nomor 12", location: "Jakarta", postalCode: "10230", fullName: "Checkout Tester", phone: "081234567890", note: "Reception", coordinate: null };
    await writeFile(join(app.directory, "address-book.json"), JSON.stringify({ addresses: [home], default_id: home.id, revision: 1, limit: 3 }));
    const page = await browser.newPage({ viewport: { width, height: 950 } });
    const errors = []; page.on("pageerror", e => errors.push(e.message));
    await page.context().addCookies([app.customerCookie()]);
    await page.goto(app.base + "/cart/?shop=test-shop&cart=granola:1");
    await page.locator('#customer-form [name="address"]').waitFor({ state: "attached" });
    await page.waitForFunction(() => document.querySelector('#customer-form [name="address"]').value === "Jalan Home Nomor 12");
    await page.locator("#to-checkout").click();
    assert.equal(await page.locator('#customer-form [name="email"]').inputValue(), "checkout@example.com");
    await page.locator("#get-rates").click();
    await page.locator('#shipping-options input[name="shipping"]').first().waitFor();
    assert.equal(await page.locator('#shipping-options input[name="shipping"]').first().isChecked(), true);
    assert.equal(await page.locator('#pay-button').isDisabled(), false);
    await page.getByRole("button", { name: "Add address", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "Save delivery address" });
    await editor.getByLabel("Address name", { exact: true }).fill("Office");
    await editor.getByLabel("Full address", { exact: true }).fill("Jalan Office Nomor 18");
    await editor.getByLabel("Postcode", { exact: true }).fill("12345");
    await editor.getByRole("button", { name: "Save address", exact: true }).click();
    await editor.waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "Use address", exact: true }).click();
    assert.equal(await page.locator('#customer-form [name="address"]').inputValue(), "Jalan Office Nomor 18");
    assert.equal(await page.locator('#pay-button').isDisabled(), true);
    assert.equal(await page.locator('#shipping-options input[name="shipping"]').count(), 0);
    let releaseRates;
    const heldRates = new Promise(resolve => { releaseRates = resolve; });
    await page.route('**/api/rates.php', async route => {
      const response = await route.fetch();
      await heldRates;
      await route.fulfill({ response });
    });
    const pendingRates = page.waitForRequest('**/api/rates.php');
    await page.locator('#get-rates').click(); await pendingRates;
    await page.getByLabel('Saved address', { exact: true }).selectOption(home.id);
    await page.getByRole('button', { name: 'Use address', exact: true }).click();
    releaseRates(); await page.waitForLoadState('networkidle');
    assert.equal(await page.locator('#pay-button').isDisabled(), true, 'A quote for the previous address cannot restore payment.');
    assert.equal(await page.locator('#shipping-options input[name="shipping"]').count(), 0);
    await page.unroute('**/api/rates.php');
    await page.getByLabel('Saved address', { exact: true }).selectOption({ label: 'Office' });
    await page.getByRole('button', { name: 'Use address', exact: true }).click();
    await page.getByRole("button", { name: "Set as default", exact: true }).click();
    await page.getByRole("button", { name: "Default address", exact: true }).waitFor();
    const other = await browser.newPage(); await other.context().addCookies([app.customerCookie()]);
    await other.goto(app.base + "/cart/?shop=test-shop&cart=granola:1");
    await other.waitForFunction(() => document.querySelector('#customer-form [name="address"]').value === "Jalan Office Nomor 18");
    await other.close();
    await page.getByRole("button", { name: "Add address", exact: true }).click();
    await editor.getByLabel("Address name", { exact: true }).fill("Family");
    await editor.getByRole("button", { name: "Save address", exact: true }).click();
    await editor.waitFor({ state: "hidden" });
    assert.equal(await page.getByRole("button", { name: "Add address", exact: true }).isDisabled(), true);
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await editor.getByLabel("Address name", { exact: true }).fill("Parents");
    await editor.getByRole("button", { name: "Save address", exact: true }).click();
    await editor.waitFor({ state: "hidden" });
    assert.match(await page.getByLabel("Saved address", { exact: true }).textContent(), /Parents/);
    await page.getByRole("button", { name: "Remove", exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.address-book-count').textContent === '2 / 3');
    assert.equal(await page.getByRole("button", { name: "Add address", exact: true }).isDisabled(), false);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []); await page.close();
  }
});

test("checkout Google popup keeps typed delivery details and loads saved addresses after sign-in", async t => {
  const app = await setup({ EZKART_CLOUDFLARE_API_URL: "https://ezkart-api-test.fixture.workers.dev" }); t.after(() => app.close());
  const { chromium } = await import("../builder-mcp/node_modules/playwright/index.mjs");
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage();
  await page.context().route("https://auth.ezkart.test/auth/v1/authorize?*", route => route.fulfill({ contentType: "text/html", body: "<h1>Google chooser fixture</h1>" }));
  await page.goto(app.base + "/cart/?shop=test-shop&cart=granola:1");
  await page.locator("#to-checkout").click();
  await page.locator('#customer-form [name="address"]').fill("Keep this typed street address");
  const opened = page.waitForEvent("popup"); await page.getByRole("button", { name: "Sign in with Google", exact: true }).click();
  const popup = await opened; await popup.getByRole("heading", { name: "Google chooser fixture" }).waitFor();
  const callback = new URL(new URL(popup.url()).searchParams.get("redirect_to"));
  await popup.goto(app.base + callback.pathname + callback.search + "&code=fixture-code").catch(error => { if (!popup.isClosed()) throw error; });
  await page.getByRole("button", { name: "Add address", exact: true }).waitFor();
  assert.equal(await page.locator('#customer-form [name="address"]').inputValue(), "Keep this typed street address");
  assert.match(page.url(), /cart\/\?shop=test-shop&cart=granola:1/);
});

test("Plus Code decoding and locality recovery match Google's published reference cases", async t => {
  const app = await setup(); t.after(() => app.close());
  const result = app.cli(`
    require ${JSON.stringify(join(root, 'cart/api/plus-code.php'))};
    $count = 0;
    foreach (file(${JSON.stringify(join(root, 'tools/checkout-test/fixtures/plus-codes/decoding.csv'))}) as $line) {
      if (str_starts_with(trim($line), '#') || trim($line) === '') continue;
      $p = explode(',', trim($line)); $actual = ez_plus_code_center($p[0]);
      if (abs($actual['latitude'] - ((float)$p[2] + (float)$p[4]) / 2) > 1e-9 || abs($actual['longitude'] - ((float)$p[3] + (float)$p[5]) / 2) > 1e-9) throw new RuntimeException('Decode mismatch: ' . $p[0]);
      $count++;
    }
    foreach (file(${JSON.stringify(join(root, 'tools/checkout-test/fixtures/plus-codes/short-code.csv'))}) as $line) {
      if (str_starts_with(trim($line), '#') || trim($line) === '') continue;
      $p = explode(',', trim($line)); if ($p[4] === 'S') continue;
      $expected = ez_plus_code_center($p[0]); $actual = ez_plus_code_recover($p[3], ['latitude'=>(float)$p[1], 'longitude'=>(float)$p[2]]);
      if (abs($actual['latitude'] - $expected['latitude']) > 1e-9 || abs($actual['longitude'] - $expected['longitude']) > 1e-9) throw new RuntimeException('Recovery mismatch: ' . $p[0]);
      $count++;
    }
    echo $count;
  `);
  assert.ok(Number(result) > 430, result);
});

test("pasted coordinates and Indonesian Plus Code addresses resolve to pins and session-bound routes", async t => {
  const app = await setup(); t.after(() => app.close());
  const cookie = app.customerCookie(); const auth = { Cookie: `${cookie.name}=${cookie.value}` };
  const html = await (await fetch(app.base + '/cart/tracking-sandbox.php?stage=transit', { headers: auth })).text();
  const headers = { ...auth, 'X-Ezkart-CSRF': html.match(/name="csrf_token" value="([a-f0-9]+)"/)[1] };
  const address = '6967+894, Jalan Pasar Kembang, Sosromenduran, Kota Yogyakarta, Daerah Istimewa Yogyakarta 55271, Indonesia';
  const explicit = address + ' (lat: -7.7892387, lng: 110.3634648)';
  const search = address => app.request('/cart/api/tracking-address.php', { address }, headers);
  for (const query of [explicit, '-7.7892387, 110.3634648', 'longitude: 110.3634648, latitude: -7.7892387']) {
    const r = await search(query); assert.equal(r.status, 200);
    assert.deepEqual(r.data.results[0].coordinate, { latitude: -7.7892387, longitude: 110.3634648 });
    assert.equal(r.data.results[0].resolved, true);
    assert.doesNotMatch(r.data.results[0].address_line, /lat:|lng:/);
  }
  const full = await search('6P4G6967+894');
  assert.ok(Math.abs(full.data.results[0].coordinate.latitude + 7.7892375) < 1e-9);
  assert.ok(Math.abs(full.data.results[0].coordinate.longitude - 110.363453125) < 1e-9);
  for (const query of ['lat: 91, lng: 110', 'lat: -7, lng: 181', 'lat: NaN, lng: 110', 'lat: -7', '6967+894', '696+894, Yogyakarta']) assert.equal((await search(query)).status, 422, query);
  assert.equal((await app.calls()).length, 0, 'Explicit pins and invalid inputs do not call a geocoder.');
  await writeFile(join(app.directory, 'address-response.json'), JSON.stringify({ features: [{ geometry: { type: 'Point', coordinates: [110.364, -7.79] }, properties: { name: 'Locality reference', district: 'Sosromenduran', city: 'Yogyakarta', countrycode: 'ID', type: 'house' } }] }));
  const short = await search(address);
  assert.equal(short.status, 200); assert.equal(short.data.results.length, 1);
  assert.ok(Math.abs(short.data.results[0].coordinate.latitude + 7.7892375) < 1e-9);
  assert.ok(Math.abs(short.data.results[0].coordinate.longitude - 110.363453125) < 1e-9);
  assert.equal(short.data.results[0].postalCode, '55271');
  const call = (await app.calls())[0];
  assert.equal(new URL(call.url).searchParams.get('q'), 'Jalan Pasar Kembang Sosromenduran Yogyakarta Yogyakarta');
  assert.equal((await search(address)).status, 200);
  assert.equal((await app.calls()).length, 1, 'Locality lookups retain the shared cache and rate limit.');
  const route = await app.request('/cart/api/tracking-route.php?sandbox=1&stage=transit&place=' + short.data.results[0].id, undefined, auth);
  assert.equal(route.status, 200); assert.deepEqual(route.data.route.to, short.data.results[0].coordinate);
});

test("address search serves signed-in address creation in either checkout mode with CSRF protection", async t => {
  for (const mode of ['sandbox', 'production']) {
    const app = await setup({ EZKART_COMMERCE_ENVIRONMENT: mode, EZKART_CLOUDFLARE_API_URL: 'https://ezkart-api-test.fixture.workers.dev' });
    try {
      const cookie = app.customerCookie(), auth = { Cookie: `${cookie.name}=${cookie.value}` };
      const csrf = (await app.request('/cart/admin/customer-addresses.php', undefined, auth)).data.csrf;
      const headers = { ...auth, 'X-Ezkart-CSRF': csrf }, endpoint = '/cart/api/address-search.php';
      const address = '6P4G6967+894, Jalan Pasar Kembang, Kota Yogyakarta 55271';
      assert.equal((await app.request(endpoint, { address })).status, 401);
      assert.equal((await app.request(endpoint, { address }, auth)).status, 403);
      assert.equal((await app.request(endpoint, { address }, { ...headers, Origin: 'https://wrong.example' })).status, 403);
      for (const address of ['', 'ab', 'x'.repeat(501), [], 'lat: 91, lng: 110']) assert.equal((await app.request(endpoint, { address }, headers)).status, 422);
      const result = await app.request(endpoint, { address }, headers);
      assert.equal(result.status, 200); assert.equal(result.data.results[0].coordinate.latitude, -7.7892375);
      assert.equal((await app.calls()).some(c => /biteship|doku|photon/.test(c.url)), false);
      assert.equal(app.cli(`require ${JSON.stringify(join(root, 'cart/api/customer-auth.php'))}; echo ez_customer_next('/cart/addresses.php?new=1&return=https://wrong.example');`), '/cart/addresses.php?new=1');
    } finally { await app.close(); }
  }
});

test("address forms locate pasted coordinates and Plus Codes on desktop and mobile", async t => {
  const app = await setup({ EZKART_CLOUDFLARE_API_URL: 'https://ezkart-api-test.fixture.workers.dev' }); t.after(() => app.close());
  const { chromium } = await import('../builder-mcp/node_modules/playwright/index.mjs');
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const raw = '6967+894, Jalan Pasar Kembang, Sosromenduran, Kota Yogyakarta, Daerah Istimewa Yogyakarta 55271, Indonesia (lat: -7.7892387, lng: 110.3634648)';
  await writeFile(join(app.directory, 'address-response.json'), JSON.stringify({ features: [{ geometry: { type: 'Point', coordinates: [110.364, -7.79] }, properties: { name: 'Locality reference', district: 'Sosromenduran', city: 'Yogyakarta', countrycode: 'ID', type: 'house' } }] }));
  for (const width of [1280, 390]) {
    const home = { id: 'existing-home', label: 'Home', address: raw, location: 'YOGYAKARTA', postalCode: '55271', coordinate: null };
    await writeFile(join(app.directory, 'address-book.json'), JSON.stringify({ addresses: [home], default_id: home.id, revision: 1, limit: 3 }));
    const page = await browser.newPage({ viewport: { width, height: 950 } }); await prepareMap(page);
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.context().addCookies([app.customerCookie()]);
    await page.goto(app.base + '/cart/addresses.php');
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.locator('.address-picker-loading').waitFor({ state: 'hidden' });
    await page.waitForFunction(() => Math.abs(window.deliveryMapUnderTest?.getCenter().lat + 7.7892387) < 1e-9);
    assert.doesNotMatch(await page.getByLabel('Full address', { exact: true }).inputValue(), /lat:|lng:/);
    await page.getByRole('button', { name: 'Save address', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    const stored = JSON.parse(await readFile(join(app.directory, 'address-book.json'), 'utf8'));
    assert.deepEqual(stored.addresses[0].coordinate, { latitude: -7.7892387, longitude: 110.3634648 });
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByLabel('Find your address', { exact: true }).fill(raw.split(' (lat:')[0]);
    await page.getByRole('button', { name: 'Find address', exact: true }).click();
    await page.waitForFunction(() => Math.abs(window.deliveryMapUnderTest.getCenter().lat + 7.7892375) < 1e-9);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal(JSON.parse(await readFile(join(app.directory, 'address-book.json'), 'utf8')).revision, 2);
    await page.goto(app.base + '/cart/?shop=test-shop&cart=granola:1');
    await page.waitForFunction(() => document.querySelector('#customer-form [name="address"]').value.startsWith('6967+894'));
    assert.doesNotMatch(await page.locator('#customer-form [name="address"]').inputValue(), /lat:|lng:/);
    assert.deepEqual(errors, []); await page.close();
  }
});

test("sandbox address search authenticates, validates, caches, and binds route previews to its session", async (t) => {
  const app = await setup(); t.after(() => app.close());
  const cookie = app.customerCookie();
  const auth = { Cookie: `${cookie.name}=${cookie.value}` };
  const html = await (await fetch(app.base + "/cart/tracking-sandbox.php?stage=transit", { headers: auth })).text();
  const csrf = html.match(/name="csrf_token" value="([a-f0-9]+)"/)[1];
  const headers = { ...auth, "X-Ezkart-CSRF": csrf };
  const endpoint = "/cart/api/tracking-address.php";
  assert.equal((await app.request(endpoint, { address: "Jakarta" })).status, 401);
  assert.equal((await app.request(endpoint, { address: "Jakarta" }, auth)).status, 403);
  assert.equal((await app.request(endpoint, { address: "Jakarta" }, { ...headers, Origin: "https://another.example" })).status, 403);
  for (const address of ["", "ab", "x".repeat(501), ["Jakarta"]]) assert.equal((await app.request(endpoint, { address }, headers)).status, 422);
  assert.deepEqual(await app.calls(), []);
  const oldCacheDirectory = app.cli("$d = dirname(ez_order_directory('sandbox')) . '/tracking-addresses'; mkdir($d, 0700, true); echo $d;");
  await writeFile(join(oldCacheDirectory, createHash('sha256').update('jalan teluk betung 12, jakarta').digest('hex') + '.json'), JSON.stringify({ until: Math.floor(Date.now()/1000) + 86400, results: [] }));
  const first = await app.request(endpoint, { address: "Jalan Teluk Betung 12, Jakarta" }, headers);
  assert.equal(first.status, 200); assert.equal(first.data.results.length, 2);
  const place = first.data.results[0];
  assert.equal(place.address_line, 'Example delivery building, Jalan Teluk Betung 12', 'Legacy cached results refresh to include checkout address fields.');
  assert.match(place.id, /^[a-f0-9]{24}$/);
  assert.equal(place.kind, "Building match");
  assert.deepEqual(place.coordinate, { latitude: -6.1957601, longitude: 106.8214547 });
  const cached = await app.request(endpoint, { address: "Jalan Teluk Betung 12, Jakarta" }, headers);
  assert.deepEqual(cached.data.results.map(({ id, ...p }) => p), first.data.results.map(({ id, ...p }) => p));
  const calls = await app.calls(); assert.equal(calls.length, 1);
  const provider = new URL(calls[0].url); assert.equal(provider.hostname, "photon.komoot.io");
  assert.equal(provider.searchParams.get("q"), "Jalan Teluk Betung 12, Jakarta");
  assert.equal(provider.searchParams.get("countrycode"), "ID");
  const routeUrl = "/cart/api/tracking-route.php?sandbox=1&stage=transit&place=" + place.id;
  const route = await app.request(routeUrl, undefined, auth);
  assert.equal(route.status, 200); assert.deepEqual(route.data.route.to, place.coordinate);
  assert.equal(route.data.route.from.latitude, -6.2441792);
  const other = app.customerCookie("other@example.com", "other-user");
  assert.equal((await app.request(routeUrl, undefined, { Cookie: `${other.name}=${other.value}` })).status, 422);
  assert.equal((await app.request(routeUrl + "wrong", undefined, auth)).status, 422);
  const directory = app.cli("echo dirname(ez_order_directory('sandbox')) . '/tracking-addresses';");
  const usage = (count, last = 0) => writeFile(join(directory, "requests.lock"), JSON.stringify({ day: new Date().toISOString().slice(0,10), count, last }));
  await usage(100);
  assert.equal((await app.request(endpoint, { address: "Other street" }, headers)).status, 503);
  assert.equal((await app.request(endpoint, { address: "Jalan Teluk Betung 12, Jakarta" }, headers)).status, 200);
  await usage(1, Date.now()/1000);
  assert.equal((await app.request(endpoint, { address: "Other street" }, headers)).status, 503);
  await usage(1);
  await writeFile(join(app.directory, "address-response.json"), JSON.stringify({ features: [
    { geometry: { type: "Point", coordinates: [999, -6] }, properties: { name: "Invalid", countrycode: "ID" } },
    { geometry: { type: "Point", coordinates: [106, -6] }, properties: { name: "Wrong country", countrycode: "DE" } },
  ] }));
  assert.deepEqual((await app.request(endpoint, { address: "Other street" }, headers)).data.results, []);
  await usage(2);
  await writeFile(join(app.directory, "address-response.json"), "invalid provider response");
  assert.equal((await app.request(endpoint, { address: "Third street" }, headers)).status, 503);
  assert.equal((await app.request(endpoint, { address: "Third street" }, headers)).status, 503);
  assert.equal((await app.calls()).filter(call => call.url.includes("photon.komoot.io")).length, 3);
  assert.equal(app.cli("echo count(glob(ez_order_directory() . '/*.json') ?: []);"), "0");
  for (const overrides of [{ EZKART_DEPLOYMENT_ENVIRONMENT: "production" }, { EZKART_COMMERCE_ENVIRONMENT: "production" }]) {
    const blocked = await setup(overrides);
    try { assert.equal((await blocked.request(endpoint, { address: "Jakarta" })).status, 404); }
    finally { await blocked.close(); }
  }
});

test("tracking only previews saved destinations and never offers address or pin editing", async t => {
  const app = await setup({ EZKART_CLOUDFLARE_API_URL: 'https://ezkart-api-test.fixture.workers.dev' }); t.after(() => app.close());
  const address = { id: 'office', label: 'Office', address: 'Jalan Teluk Betung 12', location: 'Jakarta', postalCode: '10230', coordinate: { latitude: -6.1957601, longitude: 106.8214547 } };
  await writeFile(join(app.directory, 'address-book.json'), JSON.stringify({ addresses: [address], default_id: address.id, revision: 1, limit: 3 }));
  const { chromium } = await import('../builder-mcp/node_modules/playwright/index.mjs');
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 950 } }); const routes = await prepareMap(page);
    await page.context().addCookies([app.customerCookie()]);
    await page.goto(app.base + '/cart/tracking-sandbox.php?stage=transit');
    await page.waitForFunction(() => window.ezkartTrackingSandbox?.place()?.id === 'saved-office');
    assert.equal(await page.locator('.address-book-dialog, #sandbox-address-form, #map-pin-editor').count(), 0);
    assert.equal(await page.getByRole('button', { name: /Adjust delivery pin|Save.*address|Add address|Choose on map/ }).count(), 0);
    const reported = await page.evaluate(() => window.ezkartTrackingSandbox.read().tracking.latest_location);
    await page.getByRole('button', { name: 'Show delivery pin', exact: true }).click();
    await page.waitForFunction(() => window.deliveryMapUnderTest?.getCenter().lat === -6.1957601);
    await page.waitForFunction(() => document.getElementById('map-route-note').textContent.startsWith('Suggested'));
    assert.deepEqual(routes.requests.at(-1).to, address.coordinate);
    assert.deepEqual(await page.evaluate(() => window.ezkartTrackingSandbox.read().tracking.latest_location), reported);
    await page.getByLabel('Preview destination', { exact: true }).selectOption('');
    assert.equal(await page.evaluate(() => window.ezkartTrackingSandbox.read().tracking.locations.destination.latitude), -6.28927);
    await page.getByLabel('Preview destination', { exact: true }).selectOption('office');
    await page.locator('#sandbox-stage').selectOption('delivered');
    assert.equal(await page.evaluate(() => window.ezkartTrackingSandbox.read().tracking.latest_location.latitude), address.coordinate.latitude);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await page.close();
  }
});

test("checkout address creation searches, positions and saves the address and pin together", async t => {
  const app = await setup({ EZKART_CLOUDFLARE_API_URL: 'https://ezkart-api-test.fixture.workers.dev' }); t.after(() => app.close());
  const { chromium } = await import('../builder-mcp/node_modules/playwright/index.mjs');
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage(); await prepareMap(page);
  await page.context().addCookies([app.customerCookie()]);
  await page.goto(app.base + '/cart/?shop=test-shop&cart=granola:1');
  await page.locator('#to-checkout').click();
  await page.getByRole('button', { name: 'Add address', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Save delivery address' });
  await editor.getByLabel('Find your address', { exact: true }).fill('Jalan Teluk Betung 12, Jakarta');
  await editor.getByRole('button', { name: 'Find address', exact: true }).click();
  await editor.locator('.address-picker-results button').first().waitFor();
  assert.equal(await editor.locator('.address-picker-results img').count(), 0);
  await editor.getByRole('button', { name: /Example delivery building/ }).click();
  await editor.locator('.address-picker-loading').waitFor({ state: 'hidden' });
  assert.equal(await editor.getByLabel('Full address', { exact: true }).inputValue(), 'Example delivery building, Jalan Teluk Betung 12');
  await editor.getByLabel('Address name', { exact: true }).fill('Office');
  await editor.getByLabel('Postcode', { exact: true }).fill('10230');
  assert.equal((await app.calls()).filter(c => c.url.endsWith('/v1/customer/addresses') && c.method === 'POST').length, 0);
  await editor.getByRole('button', { name: 'Save address', exact: true }).click();
  await editor.waitFor({ state: 'hidden' });
  const stored = JSON.parse(await readFile(join(app.directory, 'address-book.json'), 'utf8'));
  assert.deepEqual(stored.addresses[0].coordinate, { latitude: -6.1957601, longitude: 106.8214547 });
  assert.equal(await page.locator('#customer-form [name="address"]').inputValue(), stored.addresses[0].address);
  const writes = (await app.calls()).filter(c => c.url.endsWith('/v1/customer/addresses') && c.method === 'POST');
  assert.equal(writes.length, 1); assert.deepEqual(JSON.parse(writes[0].body).address.coordinate, stored.addresses[0].coordinate);
  const other = await browser.newPage(); await prepareMap(other);
  await other.context().addCookies([app.customerCookie()]);
  await other.goto(app.base + '/cart/tracking-sandbox.php?stage=transit');
  await other.waitForFunction(() => window.ezkartTrackingSandbox?.place()?.id.startsWith('saved-'));
  assert.equal(await other.getByLabel('Preview destination', { exact: true }).locator('option:checked').textContent(), 'Office · Default');
  assert.equal(await other.evaluate(() => window.ezkartTrackingSandbox.read().tracking.locations.destination.latitude), -6.1957601);
});

test("customer-positioned pins validate identity and coordinates without a geocoder and bind preview routes", async t => {
  const app = await setup(); t.after(() => app.close());
  const cookie = app.customerCookie(), auth = { Cookie: `${cookie.name}=${cookie.value}` };
  const html = await (await fetch(app.base + '/cart/tracking-sandbox.php?stage=transit', { headers: auth })).text();
  const headers = { ...auth, 'X-Ezkart-CSRF': html.match(/name="csrf_token" value="([a-f0-9]+)"/)[1] };
  const endpoint = '/cart/api/tracking-address.php';
  const coordinate = { latitude: -7.7894, longitude: 110.3635 };
  const body = { action: 'pin', address: 'Station entrance, Yogyakarta', coordinate };
  assert.equal((await app.request(endpoint, body)).status, 401);
  assert.equal((await app.request(endpoint, body, auth)).status, 403);
  assert.equal((await app.request(endpoint, body, { ...headers, Origin: 'https://wrong.example' })).status, 403);
  for (const coordinate of [null, {}, [1, 2], { latitude: 91, longitude: 110 }, { latitude: -7, longitude: -181 }, { latitude: 0, longitude: 0 }, { latitude: 'NaN', longitude: 110 }]) {
    assert.equal((await app.request(endpoint, { ...body, coordinate }, headers)).status, 422);
  }
  assert.equal((await app.request(endpoint, { ...body, place: 'unknown' }, headers)).status, 422);
  const place = (await app.request(endpoint, body, headers)).data.results[0];
  const adjusted = (await app.request(endpoint, { action: 'pin', place: place.id, coordinate: { ...coordinate, latitude: -7.7895 } }, headers)).data.results[0];
  assert.notEqual(adjusted.id, place.id); assert.equal(adjusted.address, body.address);
  assert.deepEqual(await app.calls(), [], 'Pin confirmation does not spend geocoder requests.');
  const otherCookie = app.customerCookie('other@example.com', 'other-user');
  const otherAuth = { Cookie: `${otherCookie.name}=${otherCookie.value}` };
  const otherHtml = await (await fetch(app.base + '/cart/tracking-sandbox.php', { headers: otherAuth })).text();
  const otherHeaders = { ...otherAuth, 'X-Ezkart-CSRF': otherHtml.match(/name="csrf_token" value="([a-f0-9]+)"/)[1] };
  assert.equal((await app.request(endpoint, { ...body, place: place.id }, otherHeaders)).status, 422);
  const route = await app.request('/cart/api/tracking-route.php?sandbox=1&stage=transit&place=' + adjusted.id, undefined, auth);
  assert.deepEqual(route.data.route.to, adjusted.coordinate);
  assert.equal(route.data.route.from.latitude, -6.2441792);
  app.cli(`require ${JSON.stringify(join(root, 'cart/api/customer-auth.php'))}; session_id('${cookie.value}'); ez_customer_session(); $_SESSION['tracking_preview_places']['${place.id}']['until']=time()-1; session_write_close();`);
  assert.equal((await app.request(endpoint, { ...body, place: place.id }, headers)).status, 422);
});

test("address maps open immediately, auto-locate pasted details and remain optional on desktop/mobile", async t => {
  const app = await setup({ EZKART_CLOUDFLARE_API_URL: 'https://ezkart-api-test.fixture.workers.dev' }); t.after(() => app.close());
  const { chromium } = await import('../builder-mcp/node_modules/playwright/index.mjs');
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const raw = 'Jalan Pasar Kembang, Kota Yogyakarta (lat: -7.7892387, lng: 110.3634648)';
  for (const width of [1280, 390]) {
    await writeFile(join(app.directory, 'address-book.json'), JSON.stringify({ addresses: [], default_id: '', revision: 0, limit: 3 }));
    const page = await browser.newPage({ viewport: { width, height: 950 } }); await prepareMap(page);
    await page.context().addCookies([app.customerCookie()]);
    await page.goto(app.base + '/cart/addresses.php?new=1');
    const editor = page.getByRole('dialog');
    await editor.locator('.address-picker-frame').waitFor();
    await editor.locator('.address-picker-loading').waitFor({ state: 'hidden' });
    assert.equal(await editor.getByRole('button', { name: 'Choose on map', exact: true }).count(), 0);
    assert.equal(await editor.locator('.address-picker-pin').isVisible(), false, 'The default country view is not a chosen location.');
    await editor.getByRole('button', { name: 'Zoom in', exact: true }).click();
    assert.equal(await editor.locator('.address-picker-pin').isVisible(), false);
    await editor.getByLabel('Full address', { exact: true }).fill(raw);
    await editor.getByLabel('District / city', { exact: true }).fill('Yogyakarta');
    await editor.getByLabel('Postcode', { exact: true }).fill('55271');
    await page.waitForFunction(() => Math.abs(deliveryMapUnderTest.getCenter().lat + 7.7892387) < 1e-9 && deliveryMapUnderTest.getZoom() === 17);
    assert.equal(await editor.getByLabel('Full address', { exact: true }).inputValue(), raw, 'Automatic lookup preserves the customer’s written details.');
    assert.equal(await editor.locator('.address-picker-pin').isVisible(), true);
    await editor.getByRole('button', { name: 'Save address', exact: true }).click();
    await editor.waitFor({ state: 'hidden' });
    let stored = JSON.parse(await readFile(join(app.directory, 'address-book.json'), 'utf8'));
    assert.deepEqual(stored.addresses[0].coordinate, { latitude: -7.7892387, longitude: 110.3634648 });
    assert.doesNotMatch(stored.addresses[0].address, /lat:|lng:/);
    await page.getByRole('button', { name: 'Add address', exact: true }).click();
    await editor.locator('.address-picker-loading').waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => deliveryMapUnderTest.getZoom()), 4, 'A new draft does not inherit another address’s pin.');
    await page.route('**/api/address-search.php', route => route.fulfill({ json: { ok: true, results: [] } }));
    await editor.getByLabel('Full address', { exact: true }).fill('Unnamed building beside the station');
    await editor.getByLabel('District / city', { exact: true }).fill('Yogyakarta');
    await editor.getByLabel('Postcode', { exact: true }).fill('55271');
    await editor.locator('.address-picker-status').filter({ hasText: 'No match found' }).waitFor();
    await editor.getByRole('button', { name: 'Save address', exact: true }).click();
    await editor.waitFor({ state: 'hidden' });
    stored = JSON.parse(await readFile(join(app.directory, 'address-book.json'), 'utf8'));
    assert.equal(stored.addresses[1].coordinate, null, 'An address can be saved without locating or adjusting a pin.');
    await page.close();
  }
});

test("late automatic address results cannot replace newer text or a customer-positioned pin", async t => {
  const app = await setup({ EZKART_CLOUDFLARE_API_URL: 'https://ezkart-api-test.fixture.workers.dev' }); t.after(() => app.close());
  const { chromium } = await import('../builder-mcp/node_modules/playwright/index.mjs');
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage(); await prepareMap(page);
  await page.context().addCookies([app.customerCookie()]);
  await page.goto(app.base + '/cart/addresses.php?new=1');
  const editor = page.getByRole('dialog');
  const pending = [];
  await page.route('**/api/address-search.php', async route => {
    await new Promise(resolve => pending.push(resolve));
    await route.fulfill({ json: { ok: true, results: [{ name: 'Old result', address_line: 'Old street 12', coordinate: { latitude: -6, longitude: 106 } }] } });
  });
  await editor.getByLabel('Full address', { exact: true }).fill('Old street 12');
  await editor.getByLabel('District / city', { exact: true }).fill('Yogyakarta');
  await editor.getByLabel('Postcode', { exact: true }).fill('55271');
  await page.waitForRequest('**/api/address-search.php');
  await editor.getByLabel('Full address', { exact: true }).fill('New street 34');
  pending.shift()();
  await page.waitForRequest('**/api/address-search.php');
  const desired = { latitude: -7.7894, longitude: 110.3635 };
  await page.evaluate(p => deliveryMapUnderTest.jumpTo({ center: [p.longitude, p.latitude], zoom: 17 }), desired);
  pending.shift()(); await page.unrouteAll({ behavior: 'wait' });
  assert.equal(await editor.getByLabel('Full address', { exact: true }).inputValue(), 'New street 34');
  await editor.locator('.address-picker-status').filter({ hasText: 'Pin adjusted' }).waitFor();
  await editor.getByRole('button', { name: 'Save address', exact: true }).click();
  await editor.waitFor({ state: 'hidden' });
  const stored = JSON.parse(await readFile(join(app.directory, 'address-book.json'), 'utf8'));
  assert.deepEqual(stored.addresses[0].coordinate, desired);
});

test("closing an address draft ignores stale search results and map failures keep the form usable", async t => {
  const app = await setup({ EZKART_CLOUDFLARE_API_URL: 'https://ezkart-api-test.fixture.workers.dev' }); t.after(() => app.close());
  const { chromium } = await import('../builder-mcp/node_modules/playwright/index.mjs');
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 950 } });
  await page.context().addCookies([app.customerCookie()]);
  await page.route('**/vendor/maplibre/maplibre-gl.js?*', route => route.abort());
  await page.goto(app.base + '/cart/addresses.php?new=1');
  const editor = page.getByRole('dialog');
  let release;
  const held = new Promise(resolve => { release = resolve; });
  await page.route('**/api/address-search.php', async route => { await held; await route.fulfill({ json: { ok: true, results: [{ resolved: true, name: 'Old result', address_line: 'Old street 12', coordinate: { latitude: -7.7894, longitude: 110.3635 } }] } }); });
  await editor.getByLabel('Find your address', { exact: true }).fill('Old street 12');
  const search = page.waitForRequest('**/api/address-search.php');
  await editor.getByLabel('Find your address', { exact: true }).press('Enter'); await search;
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Add address', exact: true }).click();
  release(); await page.unrouteAll({ behavior: 'wait' });
  assert.equal(await editor.getByLabel('Full address', { exact: true }).inputValue(), '');
  assert.equal(await editor.locator('.address-picker-frame').isVisible(), true);
  await page.route('**/vendor/maplibre/maplibre-gl.js?*', route => route.abort());
  await editor.getByLabel('Find your address', { exact: true }).fill('6P4G6967+894, Jalan Pasar Kembang, Kota Yogyakarta 55271');
  await editor.getByRole('button', { name: 'Find address', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.address-book-form [name=postalCode]').value === '55271');
  await editor.locator('.address-picker-loading').filter({ hasText: 'map is unavailable' }).waitFor();
  await editor.getByLabel('Full address', { exact: true }).fill('A different entrance at Jalan Example 12');
  await editor.getByRole('button', { name: 'Save address', exact: true }).click();
  await editor.waitFor({ state: 'hidden' });
  const stored = JSON.parse(await readFile(join(app.directory, 'address-book.json'), 'utf8'));
  assert.equal(stored.addresses.length, 1);
  assert.equal(stored.addresses[0].coordinate, null, 'Changing the written address clears the previous result’s pin.');
});

test("address editing supports pointer and touch pins, cancel, conflict review and checkout without duplicates", async t => {
  const app = await setup({ EZKART_CLOUDFLARE_API_URL: 'https://ezkart-api-test.fixture.workers.dev' }); t.after(() => app.close());
  const { chromium } = await import('../builder-mcp/node_modules/playwright/index.mjs');
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const original = { latitude: -7.7892387, longitude: 110.3634648 };
  for (const width of [1280, 390]) {
    const station = { id: 'saved-station', label: 'Station', fullName: 'Checkout Tester', phone: '081234567890', address: '6P4G6967+894, Jalan Pasar Kembang (lat: -7.7892387, lng: 110.3634648)', location: 'Yogyakarta', postalCode: '55271', note: 'Front entrance', coordinate: null };
    const book = { addresses: [station, { ...station, id: 'saved-office', label: 'Office' }, { ...station, id: 'saved-family', label: 'Family' }], default_id: station.id, revision: 1, limit: 3 };
    await writeFile(join(app.directory, 'address-book.json'), JSON.stringify(book));
    const page = await browser.newPage({ viewport: { width, height: 950 }, hasTouch: width === 390 }); await prepareMap(page);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.context().addCookies([app.customerCookie()]);
    await page.goto(app.base + '/cart/addresses.php');
    const editor = page.getByRole('dialog');
    async function openEdit() {
      await page.getByRole('button', { name: 'Edit', exact: true }).click();
      await editor.locator('.address-picker-loading').waitFor({ state: 'hidden' });
      await editor.locator('.address-picker-map').scrollIntoViewIfNeeded();
    }
    async function moveSouth() {
      const box = await editor.locator('.address-picker-map').boundingBox();
      const x = box.x + box.width / 2, y = box.y + box.height / 2 + 15;
      const start = await page.evaluate(() => deliveryMapUnderTest.getCenter().lat);
      if (width === 390) {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
        for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - i * 6 }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await cdp.detach();
      } else {
        await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x, y - 48, { steps: 8 }); await page.mouse.up();
      }
      await page.waitForFunction(lat => deliveryMapUnderTest.getCenter().lat < lat, start);
      await page.waitForFunction(() => !deliveryMapUnderTest.isMoving());
    }
    await openEdit(); await moveSouth();
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal(JSON.parse(await readFile(join(app.directory, 'address-book.json'), 'utf8')).revision, 1);
    await openEdit(); await moveSouth();
    book.revision++; book.addresses[0].note = 'Use the east entrance';
    await writeFile(join(app.directory, 'address-book.json'), JSON.stringify(book));
    await editor.getByRole('button', { name: 'Save address', exact: true }).click();
    await editor.locator('.address-book-error').filter({ hasText: 'changed in another tab' }).waitFor();
    assert.equal(await editor.getByRole('button', { name: 'Save address', exact: true }).isDisabled(), true);
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
    await openEdit(); await moveSouth();
    const desired = await page.evaluate(() => { const p = deliveryMapUnderTest.getCenter(); return { latitude: p.lat, longitude: p.lng }; });
    await editor.getByRole('button', { name: 'Save address', exact: true }).click();
    await editor.waitFor({ state: 'hidden' });
    const stored = JSON.parse(await readFile(join(app.directory, 'address-book.json'), 'utf8'));
    assert.equal(stored.addresses.length, 3); assert.equal(stored.default_id, station.id);
    assert.deepEqual(stored.addresses[0].coordinate, desired); assert.ok(desired.latitude < original.latitude);
    assert.equal(stored.addresses[0].note, 'Use the east entrance'); assert.equal(stored.addresses[0].phone, station.phone);
    assert.equal(stored.addresses[1].coordinate, null);
    await page.reload(); await openEdit();
    const reloaded = await page.evaluate(() => deliveryMapUnderTest.getCenter().lat);
    assert.equal(reloaded, desired.latitude, 'Saved pin wins over the old full Plus Code.');
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.goto(app.base + '/cart/?shop=test-shop&cart=granola:1');
    await page.waitForFunction(() => document.querySelector('#customer-form [name="address"]').value.startsWith('6P4G'));
    await page.locator('#to-checkout').click();
    const starts = [];
    await page.route('**/api/start.php', route => { starts.push(route.request().postDataJSON()); return route.fulfill({ status: 503, json: { ok: false, error: 'Fixture: do not open payment.' } }); });
    await page.locator('#pay-button').click(); await page.waitForFunction(() => !document.getElementById('pay-button').disabled);
    assert.deepEqual(starts[0].customer.coordinate, desired);
    await page.locator('#customer-form [name="address"]').fill('A different delivery street 25');
    await page.locator('#pay-button').click(); await page.waitForFunction(() => !document.getElementById('pay-button').disabled);
    assert.equal('coordinate' in starts[1].customer, false);
    assert.deepEqual(errors, []); await page.close();
  }
});

test("unmatched addresses can be positioned during creation and failed saves retain the draft", async t => {
  const app = await setup({ EZKART_CLOUDFLARE_API_URL: 'https://ezkart-api-test.fixture.workers.dev' }); t.after(() => app.close());
  await writeFile(join(app.directory, 'address-response.json'), JSON.stringify({ features: [] }));
  const { chromium } = await import('../builder-mcp/node_modules/playwright/index.mjs');
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 950 } }); await prepareMap(page);
  await page.context().addCookies([app.customerCookie()]);
  await page.goto(app.base + '/cart/addresses.php?new=1');
  const editor = page.getByRole('dialog');
  await editor.getByLabel('Find your address', { exact: true }).fill('Unnamed entrance beside the station');
  await editor.getByRole('button', { name: 'Find address', exact: true }).click();
  await editor.locator('.address-picker-status').filter({ hasText: 'No match found' }).waitFor();
  assert.equal(await editor.getByRole('button', { name: 'Choose on map', exact: true }).count(), 0);
  await editor.locator('.address-picker-loading').waitFor({ state: 'hidden' });
  const zoom = await page.evaluate(() => deliveryMapUnderTest.getZoom());
  await editor.getByRole('button', { name: 'Zoom in', exact: true }).click();
  assert.equal(await page.evaluate(() => deliveryMapUnderTest.getZoom()), zoom + 1);
  await editor.getByLabel('Full address', { exact: true }).fill('Unnamed entrance beside the station');
  await editor.getByLabel('District / city', { exact: true }).fill('Yogyakarta');
  await editor.getByLabel('Postcode', { exact: true }).fill('55271');
  await page.evaluate(() => deliveryMapUnderTest.jumpTo({ center: [110.3635, -7.7894], zoom: 17 }));
  await page.route('**/admin/customer-addresses.php', route => route.request().method() === 'POST' ? route.fulfill({ status: 503, json: { ok: false, error: 'Please try again.' } }) : route.continue());
  await editor.getByRole('button', { name: 'Save address', exact: true }).click();
  await editor.locator('.address-book-error').filter({ hasText: 'Please try again.' }).waitFor();
  assert.equal(await editor.getByLabel('Full address', { exact: true }).inputValue(), 'Unnamed entrance beside the station');
  await page.unroute('**/admin/customer-addresses.php');
  await editor.getByRole('button', { name: 'Save address', exact: true }).click();
  await editor.waitFor({ state: 'hidden' });
  assert.deepEqual(JSON.parse(await readFile(join(app.directory, 'address-book.json'), 'utf8')).addresses[0].coordinate, { latitude: -7.7894, longitude: 110.3635 });
});

test("checkout validates delivery pins and passes the chosen destination to Biteship booking and tracking", async t => {
  const app = await setup(); t.after(() => app.close());
  for (const coordinate of [{ latitude: 91, longitude: 110 }, { latitude: -7, longitude: 181 }, {}, { latitude: 0, longitude: 0 }]) {
    assert.equal((await app.request('/cart/api/start.php', { ...input, customer: { ...input.customer, coordinate } })).status, 422);
  }
  const coordinate = { latitude: -7.7894, longitude: 110.3635 };
  const start = await app.request('/cart/api/start.php', { ...input, customer: { ...input.customer, coordinate } });
  assert.equal(start.status, 201);
  const id = start.data.order_id;
  await notify(app, id); app.cli(`ez_accept_paid_order('${id}'); ez_arrange_paid_order_pickup('${id}');`);
  const shipment = (await app.calls()).find(call => call.url.endsWith('/v1/orders'));
  assert.deepEqual(JSON.parse(shipment.body).destination_coordinate, coordinate);
  await saveTrackingResponse(app, trackingResponse(id));
  const tracking = (await app.tracking(id, { refresh: true })).data.tracking;
  assert.deepEqual(tracking.locations.destination, coordinate);
  assert.notDeepEqual(tracking.latest_location, coordinate, 'Choosing a destination never invents a courier location.');
});

test("road routes ignore stale results, use return destinations, and clear after delivery", async (t) => {
  const { chromium } = await import("../builder-mcp/node_modules/playwright/index.mjs");
  const app = await setup(); t.after(() => app.close());
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage();
  const routes = await prepareMap(page);
  await page.context().addCookies([app.customerCookie()]);
  await page.goto(app.base + "/cart/tracking-sandbox.php?stage=transit");
  await page.locator("#delivery-map").scrollIntoViewIfNeeded();
  await page.waitForFunction(() => window.deliveryMapUnderTest?.getSource("delivery-route")?.serialize().data.geometry?.type === "LineString");
  routes.hold = true;
  await page.locator("#sandbox-stage").selectOption("returning");
  await page.waitForFunction(() => document.querySelector("#map-route-note").textContent.startsWith("Finding"));
  for (let i = 0; i < 100 && !routes.pending.length; i++) await new Promise(r => setTimeout(r, 20));
  assert.equal(routes.pending.length, 1);
  assert.equal(routes.requests[1].to.latitude, -6.2253114);
  assert.equal(routes.requests[1].to.longitude, 106.7993735);
  const routeData = () => page.evaluate(() => deliveryMapUnderTest.getSource("delivery-route").serialize().data);
  assert.deepEqual((await routeData()).features, []);
  await page.locator("#sandbox-stage").selectOption("delivered");
  const response = page.waitForResponse("**/api/tracking-route.php?*");
  routes.pending[0](); await response;
  await page.waitForFunction(() => document.querySelector("#return-title").textContent.includes("delivered"));
  assert.deepEqual((await routeData()).features, [], "An old route cannot reappear after delivery.");
  assert.equal(await page.locator(".shipment-pin-truck").count(), 0);
  assert.equal(await page.locator(".shipment-pin-destination").count(), 1);
  assert.equal(await page.locator("#map-route-summary").isVisible(), false);
  await page.locator("#sandbox-stage").selectOption("cancelled");
  assert.equal(await page.locator(".shipment-pin-truck").count(), 1);
  assert.doesNotMatch(await page.locator("#delivery-map").textContent(), /Delivered/);
  assert.deepEqual((await routeData()).features, []);
  await page.locator("#sandbox-stage").selectOption("no-map");
  assert.equal(await page.locator(".shipment-pin").count(), 0);
  assert.equal(await page.locator("#google-maps-link").isVisible(), false);
});

test("tracking remains usable when the map SDK is blocked or road routing fails", async (t) => {
  const { chromium } = await import("../builder-mcp/node_modules/playwright/index.mjs");
  const app = await setup(); t.after(() => app.close());
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  for (const failure of ["blocked", "no-route"]) {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.context().addCookies([app.customerCookie()]);
    const routes = await prepareMap(page);
    routes.fail = true;
    if (failure === "blocked") await page.route("**/vendor/maplibre/maplibre-gl.js?*", route => route.abort());
    await page.goto(app.base + "/cart/tracking-sandbox.php?stage=transit");
    await page.locator("#delivery-map-section").scrollIntoViewIfNeeded();
    if (failure === "no-route") {
      await page.waitForFunction(() => document.querySelector("#map-route-note").textContent.startsWith("Road route unavailable"));
      assert.equal(await page.locator(".shipment-pin-truck").count(), 1);
      assert.deepEqual(await page.evaluate(() => deliveryMapUnderTest.getSource("delivery-route").serialize().data.features), [], "No fabricated straight-line route is substituted.");
    } else {
      await page.locator("#map-notice").waitFor();
      assert.equal(await page.locator("#package-map-frame").isVisible(), false);
    }
    assert.equal(await page.locator("#return-title").textContent(), "Your order is on the way");
    assert.match(await page.locator("#tracking-history").textContent(), /Jakarta sorting facility/);
    assert.equal(await page.locator("#google-maps-link").isVisible(), true);
    assert.deepEqual(errors, []);
    await page.close();
  }
});

test("a courier webhook arriving during tracking refresh wins over the stale provider snapshot", async (t) => {
  const app = await setup(); t.after(() => app.close());
  const id = (await app.request("/cart/api/start.php", input)).data.order_id;
  await notify(app, id); app.cli(`ez_accept_paid_order('${id}'); ez_arrange_paid_order_pickup('${id}');`);
  await saveTrackingResponse(app, trackingResponse(id, "confirmed"));
  await writeFile(join(app.directory, "tracking-concurrent-event.json"), JSON.stringify({ event: "order.status", order_id: "test-shipment-" + id, status: "delivered", courier_waybill_id: "LATEST-WAYBILL" }));
  const data = (await app.tracking(id, { refresh: true })).data;
  assert.equal(data.status, "PAID");
  assert.equal(data.tracking.stage, "delivered");
  assert.equal(data.tracking.waybill_id, "LATEST-WAYBILL");
});

test("interactive tracking walkthrough uses the customer renderer without orders or payment/shipping calls and is sandbox-only", async (t) => {
  const { chromium } = await import("../builder-mcp/node_modules/playwright/index.mjs");
  const app = await setup(); t.after(() => app.close());
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 960 } });
    const errors = [], apiCalls = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => { if (request.url().startsWith(app.base + "/cart/api/")) apiCalls.push(request.url()); });
    await prepareMap(page);
    await page.clock.install();
    await page.context().addCookies([app.customerCookie()]);
    await page.goto(app.base + "/cart/tracking-sandbox.php");
    await page.getByRole("heading", { name: "The seller is preparing your order", exact: true }).waitFor();
    assert.match(await page.locator(".sandbox-controls").textContent(), /Simulated order data/);
    assert.equal(await page.locator("#delivery-map-section").isVisible(), false);
    await page.locator("#sandbox-next").click();
    await page.getByRole("heading", { name: "Your order is awaiting pickup", exact: true }).waitFor();
    assert.equal(await page.locator("#package-location-empty").isVisible(), true);
    await page.locator("#map-route-toggle").click();
    await page.locator("#delivery-map").scrollIntoViewIfNeeded();
    await page.locator(".shipment-pin-destination").waitFor();
    assert.equal(await page.locator(".shipment-pin-pickup").count(), 1);
    assert.equal(await page.locator(".shipment-pin-truck").count(), 0, "Booking never invents a package location.");
    assert.equal(await page.locator("#courier-tracking-link").isVisible(), false, "No fabricated live courier tracking URL.");
    await page.locator("#sandbox-stage").selectOption("unavailable");
    await page.locator("#tracking-notice").waitFor({ state: "visible" });
    assert.equal(await page.locator("#return-title").textContent(), "Your order is on the way");
    await page.locator("#sandbox-stage").selectOption("no-map");
    assert.equal(await page.locator("#package-map-frame").isVisible(), false);
    assert.equal(await page.locator("#package-location-empty").isVisible(), true);
    await page.locator("#sandbox-stage").selectOption("returned");
    await page.getByRole("heading", { name: "Your order was returned to the seller", exact: true }).waitFor();
    await page.reload();
    await page.getByRole("heading", { name: "Your order was returned to the seller", exact: true }).waitFor();
    await page.locator("#sandbox-play").click();
    assert.equal(await page.locator("#sandbox-stage").inputValue(), "pending");
    for (const stage of ["paid", "processing", "pickup", "picked", "transit", "delivery", "delivered"]) {
      await page.clock.runFor(5001);
      assert.equal(await page.locator("#sandbox-stage").inputValue(), stage);
    }
    assert.equal(await page.locator("#sandbox-play").textContent(), "Run walkthrough");
    assert.equal(await page.locator("#sandbox-next").isDisabled(), true);
    await page.locator("#sandbox-reset").click();
    assert.equal(await page.locator("#sandbox-stage").inputValue(), "pending");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    assert.ok(apiCalls.every(url => new URL(url).pathname === "/cart/api/tracking-route.php"));
    assert.deepEqual(errors, []);
    await page.close();
  }
  assert.deepEqual(await app.calls(), []);
  assert.equal(app.cli("echo count(glob(ez_order_directory() . '/*.json') ?: []);"), "0");
  const normal = await fetch(app.base + "/cart/return.php?order=EZK-S-000000000000000000000001&stage=delivered&preview=sandbox");
  assert.equal((await normal.text()).includes('id="tracking-sandbox-data"'), false);
  for (const overrides of [
    { EZKART_DEPLOYMENT_ENVIRONMENT: "production", EZKART_COMMERCE_ENVIRONMENT: "production" },
    { EZKART_DEPLOYMENT_ENVIRONMENT: "test", EZKART_COMMERCE_ENVIRONMENT: "production" },
  ]) {
    const blocked = await setup(overrides);
    try {
      assert.equal((await fetch(blocked.base + "/cart/tracking-sandbox.php")).status, 404);
      const cookie = blocked.customerCookie();
      assert.equal((await blocked.request("/cart/api/tracking-route.php?sandbox=1&stage=transit", undefined, { Cookie: `${cookie.name}=${cookie.value}` })).status, 404);
    }
    finally { await blocked.close(); }
  }
});

async function beginCustomerLogin(page, next = "/cart/tracking-sandbox.php") {
  await page.goto(page.context()._ezkartBase + "/cart/login.php?next=" + encodeURIComponent(next));
  const csrf = await page.locator('#tracking-signin [name="csrf_token"]').inputValue();
  const response = await page.request.post(page.context()._ezkartBase + "/cart/login.php", {
    form: { action: "google", csrf_token: csrf, next }, maxRedirects: 0,
  });
  assert.equal(response.status(), 303);
  const authorize = new URL(response.headers().location);
  assert.equal(authorize.origin, "https://auth.ezkart.test");
  assert.equal(authorize.searchParams.get("provider"), "google");
  assert.equal(authorize.searchParams.get("code_challenge_method"), "s256");
  const callback = new URL(authorize.searchParams.get("redirect_to"));
  assert.equal(callback.origin, "https://test.ezkart.id");
  assert.equal(callback.pathname, "/cart/admin/customer-auth.php");
  return { authorize, callback: callback.pathname + callback.search + "&code=fixture-code" };
}

test("customer Google login uses PKCE, checks identity and order ownership, and keeps shipment data private", async (t) => {
  const { chromium } = await import("../builder-mcp/node_modules/playwright/index.mjs");
  const app = await setup(); t.after(() => app.close());
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const context = await browser.newContext(); context._ezkartBase = app.base;
  const page = await context.newPage();
  const id = (await app.request("/cart/api/start.php", input)).data.order_id;
  await notify(app, id); app.cli(`ez_accept_paid_order('${id}'); ez_arrange_paid_order_pickup('${id}');`);
  const path = `/cart/return.php?order=${id}&shop=test-shop`;
  const anonymous = await fetch(app.base + path, { redirect: "manual" });
  assert.equal(anonymous.status, 200);
  const locked = await anonymous.text();
  assert.ok(locked.includes('id="tracking-auth-dialog"'));
  assert.equal(locked.includes('id="tracking-content"'), false);
  assert.equal((await app.request(`/cart/api/status.php?order=${id}&tracking=1`)).status, 401);
  const payment = (await app.request(`/cart/api/status.php?order=${id}`)).data;
  assert.equal(payment.status, "PAID");
  for (const key of ["tracking", "biteship_waybill_id", "biteship_order_id", "fulfillment_status", "customer_name", "customer_auth_user_id"]) assert.equal(key in payment, false);
  await page.goto(app.base + "/cart/login.php?next=" + encodeURIComponent(path));
  const invalid = await page.request.post(app.base + "/cart/login.php", { form: { action: "google", csrf_token: "wrong", next: path }, maxRedirects: 0 });
  assert.equal(invalid.status(), 403);
  const flow = await beginCustomerLogin(page, path);
  const before = (await context.cookies()).find((cookie) => cookie.name === "ezkart_customer");
  const result = await page.request.get(app.base + flow.callback, { maxRedirects: 0 });
  assert.equal(result.status(), 303);
  assert.equal(result.headers().location, path);
  const cookie = (await context.cookies()).find((cookie) => cookie.name === "ezkart_customer");
  assert.equal(cookie.httpOnly, true); assert.equal(cookie.sameSite, "Lax"); assert.equal(cookie.path, "/cart");
  assert.notEqual(cookie.value, before.value, "Regenerate the session after login.");
  assert.equal((await context.cookies()).some((cookie) => cookie.name === "ezkart_admin"), false);
  const calls = (await app.calls()).filter((call) => call.url.includes("auth.ezkart.test"));
  const exchange = JSON.parse(calls[0].body);
  assert.equal(exchange.auth_code, "fixture-code");
  assert.equal(createHash("sha256").update(exchange.code_verifier).digest("base64url"), flow.authorize.searchParams.get("code_challenge"));
  assert.ok(calls[1].url.endsWith("/user"), "Verify identity through Supabase, not browser-provided metadata.");
  const tracking = await page.request.get(app.base + `/cart/api/status.php?order=${id}&tracking=1&refresh=0`);
  assert.equal(tracking.status(), 200); assert.equal((await tracking.json()).tracking.stage, "awaiting_pickup");
  assert.equal(app.cli(`echo ez_load_order('${id}')['customer_auth_user_id'];`), "fixture-google-customer");
  const mismatchedEmail = app.customerCookie("other@example.com", "other-google-account");
  const sameEmailDifferentId = app.customerCookie("checkout@example.com", "another-google-account");
  for (const other of [mismatchedEmail, sameEmailDifferentId]) {
    const denied = await app.tracking(id, { cookie: other });
    assert.deepEqual(denied, { status: 404, data: { ok: false, error: "Order not found." } });
  }
  assert.equal((await app.tracking(id, { cookie: app.customerCookie("updated@example.com") })).status, 200, "Account ownership remains attached to the immutable user ID.");
  await page.request.get(app.base + flow.callback, { maxRedirects: 0 });
  assert.equal((await app.calls()).filter((call) => call.url.includes("grant_type=pkce")).length, 1, "The callback cannot be replayed.");
  // Signed-in checkout binds the authenticated account even when shipping contact information differs.
  const created = await page.request.post(app.base + "/cart/api/start.php", { data: { ...input, customer_auth_user_id: "attacker", customer: { ...input.customer, email: "recipient@example.com" } } });
  assert.equal(created.status(), 201);
  const createdId = (await created.json()).order_id;
  assert.equal(app.cli(`echo ez_load_order('${createdId}')['customer_auth_user_id'];`), "fixture-google-customer");
  await page.goto(app.base + path);
  await page.locator("#tracking-content").waitFor({ state: "visible" });
  assert.equal((await page.content()).includes("fixture-refresh-token"), false);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByRole("button", { name: "Sign in to track", exact: true }).waitFor();
  assert.equal((await page.request.get(app.base + `/cart/api/status.php?order=${id}&tracking=1`)).status(), 401);
  assert.ok((await app.calls()).some((call) => call.url.endsWith("logout?scope=local")));
});

test("Google login rejects unverified identities, enforces existing MFA and keeps redirects local", async (t) => {
  const { chromium } = await import("../builder-mcp/node_modules/playwright/index.mjs");
  const app = await setup(); t.after(() => app.close());
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  for (const user of [{ email_confirmed_at: null }, { identities: [{ provider: "email" }], user_metadata: { provider: "google", email_verified: true } }]) {
    await writeFile(join(app.directory, "auth-response.json"), JSON.stringify({ user }));
    const context = await browser.newContext(); context._ezkartBase = app.base;
    const page = await context.newPage();
    const flow = await beginCustomerLogin(page);
    await page.goto(app.base + flow.callback);
    await page.locator('#auth-message').waitFor({ state: "visible" });
    assert.match(await page.locator('#auth-message').textContent(), /verified Google account/);
    assert.equal((await page.request.get(app.base + "/cart/api/status.php?order=bad&tracking=1")).status(), 401);
    await context.close();
  }
  await writeFile(join(app.directory, "auth-response.json"), JSON.stringify({ user: { factors: [{ id: "fixture-totp", factor_type: "totp", status: "verified" }] } }));
  const context = await browser.newContext(); context._ezkartBase = app.base;
  const page = await context.newPage();
  const flow = await beginCustomerLogin(page);
  await page.goto(app.base + flow.callback);
  await page.getByRole("heading", { name: "Enter your verification code", exact: true }).waitFor();
  assert.equal((await page.request.get(app.base + "/cart/api/status.php?order=bad&tracking=1")).status(), 401);
  await page.locator("#customer-mfa").fill("000000");
  await page.getByRole("button", { name: "Verify and track order", exact: true }).click();
  assert.equal((await page.request.get(app.base + "/cart/api/status.php?order=bad&tracking=1")).status(), 401);
  await page.locator("#customer-mfa").fill("123456");
  await page.getByRole("button", { name: "Verify and track order", exact: true }).click();
  assert.equal(await page.locator('[role="alert"]:visible').count(), 0, await page.locator("body").innerText());
  await page.getByRole("heading", { name: "The seller is preparing your order", exact: true }).waitFor();
  assert.equal((await page.request.get(app.base + "/cart/api/status.php?order=bad&tracking=1")).status(), 404);
  assert.equal(app.cli(`require ${JSON.stringify(join(root, "cart/api/customer-auth.php"))}; foreach (['https://evil.test/cart/return.php', '//evil.test/cart/return.php', 'javascript:/cart/return.php', '/cart/admin/', '/cart/return.php?order=bad&next=https://evil.test'] as $next) echo ez_customer_next($next)."\\n";`), Array(5).fill("/cart/return.php").join("\n"));
  // The native Google form must navigate to the configured external authorize endpoint under the page CSP.
  // Playwright does not intercept later URLs in a server redirect chain; .test is deliberately non-routable.
  const publicPage = await browser.newPage();
  const cspErrors = [];
  publicPage.on("console", (message) => { if (/form-action|Content Security Policy/.test(message.text())) cspErrors.push(message.text()); });
  await publicPage.goto(app.base + "/cart/login.php?next=%2Fcart%2Ftracking-sandbox.php");
  const external = publicPage.waitForRequest((request) => request.url().startsWith("https://auth.ezkart.test/auth/v1/authorize?"));
  await publicPage.evaluate(() => { window.open = () => null; });
  await publicPage.getByRole("button", { name: "Sign in to track" }).click();
  assert.equal((await external).method(), "GET");
  assert.deepEqual(cspErrors, []);
});

test("expired customer sessions refresh safely, and guest orders are claimed only by the matching verified email", async (t) => {
  const app = await setup(); t.after(() => app.close());
  const id = (await app.request("/cart/api/start.php", input)).data.order_id;
  assert.equal((await app.tracking(id, { cookie: app.customerCookie("not-customer@example.com", "wrong") })).status, 404);
  assert.equal(app.cli(`echo ez_load_order('${id}')['customer_auth_user_id'];`), "");
  const cookie = app.customerCookie("checkout@example.com", "fixture-google-customer", -1);
  assert.equal((await app.tracking(id, { cookie })).status, 200);
  assert.ok((await app.calls()).some((call) => call.url.endsWith("grant_type=refresh_token")));
  await writeFile(join(app.directory, "auth-response.json"), JSON.stringify({ refresh_error: 503 }));
  const expired = app.customerCookie("checkout@example.com", "fixture-google-customer", -1);
  assert.equal((await app.tracking(id, { cookie: expired })).status, 500);
  const unexpired = app.customerCookie("checkout@example.com", "fixture-google-customer", 60);
  assert.equal((await app.tracking(id, { cookie: unexpired })).status, 200);
  await writeFile(join(app.directory, "auth-response.json"), JSON.stringify({ refresh_error: 401 }));
  assert.equal((await app.tracking(id, { cookie: expired })).status, 401);
  const calls = (await app.calls()).length;
  assert.equal((await app.tracking(id, { cookie: expired })).status, 401);
  assert.equal((await app.calls()).length, calls, "Rejected sessions do not retry the invalid refresh token.");
});

test("latest package location uses reported scans and confirmed stops, never route interpolation", async (t) => {
  const app = await setup(); t.after(() => app.close());
  const id = (await app.request("/cart/api/start.php", input)).data.order_id;
  await notify(app, id); app.cli(`ez_accept_paid_order('${id}'); ez_arrange_paid_order_pickup('${id}');`);
  const response = trackingResponse(id);
  delete response.courier.history[1].coordinate;
  await saveTrackingResponse(app, response);
  let tracking = (await app.tracking(id, { refresh: true })).data.tracking;
  assert.equal(tracking.latest_location, null, "Origin and destination do not locate a package in transit.");
  response.courier.history[1].coordinate = { latitude: 95, longitude: 106.7 };
  await saveTrackingResponse(app, response); expireTrackingCache(app, id);
  assert.equal((await app.tracking(id, { refresh: true })).data.tracking.latest_location, null);
  response.courier.history[1].coordinate = { latitude: -6.2441792, longitude: 106.783529 };
  await saveTrackingResponse(app, response); expireTrackingCache(app, id);
  tracking = (await app.tracking(id, { refresh: true })).data.tracking;
  assert.deepEqual(tracking.latest_location, { latitude: -6.2441792, longitude: 106.783529, label: "Jakarta sorting facility", updated_at: "2026-09-20T05:00:00+00:00", source: "courier_scan" });
  delete response.courier.history[1].coordinate;
  await saveTrackingResponse(app, response); expireTrackingCache(app, id);
  assert.equal((await app.tracking(id, { refresh: true })).data.tracking.latest_location.source, "courier_scan", "A duplicate note without coordinates retains the known scan location.");
  await shippingEvent(app, id, "delivered");
  assert.equal((await app.tracking(id)).data.tracking.latest_location.source, "confirmed_stop");
});

test("tracking stays in place while Google opens in a popup, then loads only after verified completion", async (t) => {
  const { chromium } = await import("../builder-mcp/node_modules/playwright/index.mjs");
  const app = await setup(); t.after(() => app.close());
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    const errors = [], requests = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => requests.push(new URL(request.url()).pathname));
    await context.route("https://maps.googleapis.com/**", (route) => route.abort());
    // A real Google popup may sever its opener. The parent must still detect the verified session.
    await context.route("https://auth.ezkart.test/**", (route) => route.fulfill({ headers: { "Cross-Origin-Opener-Policy": "same-origin" }, contentType: "text/html", body: "<h1>Google account chooser fixture</h1>" }));
    const path = "/cart/tracking-sandbox.php?stage=transit";
    await page.goto(app.base + path);
    await page.getByRole("button", { name: "Sign in to track", exact: true }).waitFor();
    assert.equal(page.url(), app.base + path);
    assert.equal(await page.locator("#tracking-sandbox-data").count(), 0);
    assert.equal(requests.some((path) => path.endsWith("/api/status.php")), false);
    assert.equal((await page.locator("body").textContent()).includes("Your updates."), false);
    if (process.env.EZKART_TEST_SCREENSHOTS) await page.screenshot({ path: join(process.env.EZKART_TEST_SCREENSHOTS, `tracking-gate-${width}.png`), fullPage: true });
    const opened = page.waitForEvent("popup");
    await page.getByRole("button", { name: "Sign in to track", exact: true }).click();
    const popup = await opened;
    await popup.getByRole("heading", { name: "Google account chooser fixture" }).waitFor();
    assert.equal(page.url(), app.base + path);
    assert.equal(await page.locator("#tracking-content").count(), 0);
    const authorize = new URL(popup.url());
    const callback = new URL(authorize.searchParams.get("redirect_to"));
    await popup.goto(app.base + callback.pathname + callback.search + "&code=fixture-code").catch((error) => { if (!popup.isClosed()) throw error; });
    await page.getByRole("heading", { name: "Your order is on the way", exact: true }).waitFor();
    assert.equal(page.url(), app.base + path);
    assert.equal(await page.locator("#tracking-auth-dialog").count(), 0);
    assert.equal(await page.locator("#sandbox-stage").inputValue(), "transit");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    // Stale polls from the pre-login session cannot overwrite the regenerated authenticated cookie.
    const stale = await fetch(app.base + "/cart/api/customer-session.php", { headers: { Cookie: "ezkart_customer=missing-stale-session" } });
    assert.equal(stale.headers.get("set-cookie"), null);
    assert.deepEqual(errors, []);
    await context.close();
  }
});

test("cancelled Google popups recover on the tracking page without losing the order link", async (t) => {
  const { chromium } = await import("../builder-mcp/node_modules/playwright/index.mjs");
  const app = await setup(); t.after(() => app.close());
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage();
  await page.context().route("https://auth.ezkart.test/**", (route) => route.fulfill({ contentType: "text/html", body: "<h1>Google fixture</h1>" }));
  const path = "/cart/tracking-sandbox.php?stage=processing";
  await page.goto(app.base + path);
  const opened = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Sign in to track" }).click();
  const popup = await opened;
  await popup.getByRole("heading", { name: "Google fixture" }).waitFor();
  const callback = new URL(new URL(popup.url()).searchParams.get("redirect_to"));
  await popup.goto(app.base + callback.pathname + callback.search + "&error=access_denied").catch((error) => { if (!popup.isClosed()) throw error; });
  await page.waitForFunction(() => document.getElementById("auth-message").textContent.includes("cancelled"));
  assert.equal(page.url(), app.base + path);
  assert.equal(await page.getByRole("button", { name: "Sign in to track" }).isEnabled(), true);
  assert.equal((await page.request.get(app.base + "/cart/api/customer-session.php")).status(), 200);
  const again = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Sign in to track" }).click();
  await (await again).getByRole("heading", { name: "Google fixture" }).waitFor();
});

test("an existing Google login automatically opens tracking without copying refresh tokens or granting merchant permissions", async (t) => {
  const { chromium } = await import("../builder-mcp/node_modules/playwright/index.mjs");
  const app = await setup(); t.after(() => app.close());
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const context = await browser.newContext();
  await context.addCookies([app.adminCookie({ authenticated_until: Math.floor(Date.now() / 1000) - 1 })]);
  const page = await context.newPage();
  const requests = []; page.on("request", (r) => requests.push(r.url()));
  await page.goto(app.base + "/cart/tracking-sandbox.php?stage=processing");
  await page.getByRole("heading", { name: "The seller is preparing your order", exact: true }).waitFor();
  assert.equal(requests.some((url) => url.includes("/auth/v1/authorize")), false);
  assert.ok((await app.calls()).some((call) => call.url.endsWith("grant_type=refresh_token")), "Refresh the existing source session under its lock.");
  const cookie = (await context.cookies()).find((c) => c.name === "ezkart_customer");
  const raw = await readFile(join(app.env.EZKART_CUSTOMER_SESSION_STORAGE, "sess_" + cookie.value), "utf8");
  assert.ok(raw.includes("existing_google"));
  for (const secret of ["fixture-admin-refresh", "supabase_access_token", "supabase_refresh_token", "legacy_data_access"]) assert.equal(raw.includes(secret), false);
  const id = (await app.request("/cart/api/start.php", input)).data.order_id;
  assert.equal((await page.request.get(app.base + `/cart/api/status.php?order=${id}&tracking=1&refresh=0`)).status(), 200);
  const wrong = (await app.request("/cart/api/start.php", { ...input, customer: { ...input.customer, email: "someone-else@example.com" } })).data.order_id;
  assert.equal((await page.request.get(app.base + `/cart/api/status.php?order=${wrong}&tracking=1&refresh=0`)).status(), 404);
  // A source-session refresh happens under the existing admin lock and remains automatic.
  app.cli(`$p=getenv('EZKART_CUSTOMER_SESSION_STORAGE').'/sess_${cookie.value}'; $s=file_get_contents($p); $s=preg_replace('/"expires_at";i:\\d+;/', '"expires_at";i:1;', $s); file_put_contents($p,$s);`);
  await page.reload();
  await page.getByRole("heading", { name: "The seller is preparing your order", exact: true }).waitFor();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByRole("button", { name: "Sign in to track", exact: true }).waitFor();
  await page.reload();
  await page.getByRole("button", { name: "Sign in to track", exact: true }).waitFor();
  assert.equal((await page.request.get(app.base + `/cart/api/status.php?order=${id}&tracking=1`)).status(), 401, "Explicit sign-out must not be undone by the existing login.");
  assert.equal((await app.calls()).some((call) => call.url.includes("logout?scope=local")), false, "Signing out of a borrowed customer session does not revoke the merchant refresh token.");
});

test("existing-login bridge rejects passwords, unfinished MFA, expired identities and cross-origin requests", async (t) => {
  const { chromium } = await import("../builder-mcp/node_modules/playwright/index.mjs");
  const app = await setup(); t.after(() => app.close());
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  for (const changes of [
    { authentication_method: "password" },
    { pending_mfa: { expires_at: Math.floor(Date.now() / 1000) + 600 } },
    { admin_user: { id: "wrong-user", email: "checkout@example.com" } },
    { signed_in_at: Math.floor(Date.now() / 1000) - 2592001 },
  ]) {
    const context = await browser.newContext();
    await context.addCookies([app.adminCookie(changes)]);
    const page = await context.newPage();
    await page.goto(app.base + "/cart/tracking-sandbox.php");
    await page.getByRole("button", { name: "Sign in to track", exact: true }).waitFor();
    assert.equal((await page.request.get(app.base + "/cart/api/status.php?order=bad&tracking=1")).status(), 401);
    const csrf = await page.locator('#tracking-signin [name="csrf_token"]').inputValue();
    assert.equal((await page.request.post(app.base + "/cart/admin/customer-session.php", { headers: { Origin: "https://evil.test", "X-Ezkart-CSRF": csrf } })).status(), 403);
    assert.equal((await page.request.post(app.base + "/cart/admin/customer-session.php", { headers: { "X-Ezkart-CSRF": "wrong" } })).status(), 403);
    assert.equal((await page.request.get(app.base + "/cart/admin/customer-session.php")).status(), 405);
    await context.close();
  }
});

test("switching Google accounts waits for the new identity and existing-login reuse honors verified MFA", async (t) => {
  const { chromium } = await import("../builder-mcp/node_modules/playwright/index.mjs");
  const app = await setup(); t.after(() => app.close());
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage();
  await page.context().addCookies([app.customerCookie("previous@example.com", "previous-customer")]);
  await page.context().route("https://auth.ezkart.test/**", (route) => route.fulfill({ contentType: "text/html", body: "<h1>Choose account fixture</h1>" }));
  await page.goto(app.base + "/cart/tracking-sandbox.php?stage=processing&signin=1");
  const oldSession = await (await page.request.get(app.base + "/cart/api/customer-session.php")).json();
  assert.ok(oldSession.version, "Existing sessions receive a version before attempting an account switch.");
  const opened = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Sign in to track" }).click();
  const popup = await opened;
  await popup.getByRole("heading", { name: "Choose account fixture" }).waitFor();
  await page.waitForTimeout(1700);
  assert.equal(await page.locator("#tracking-content").count(), 0, "The previous account cannot complete the new sign-in attempt.");
  const callback = new URL(new URL(popup.url()).searchParams.get("redirect_to"));
  await popup.goto(app.base + callback.pathname + callback.search + "&code=fixture-code").catch((error) => { if (!popup.isClosed()) throw error; });
  await page.getByRole("heading", { name: "The seller is preparing your order", exact: true }).waitFor();
  assert.match(await page.locator(".customer-account").textContent(), /checkout@example.com/);
  assert.notEqual((await (await page.request.get(app.base + "/cart/api/customer-session.php")).json()).version, oldSession.version);
  const another = await browser.newPage();
  await another.context().addCookies([app.adminCookie()]);
  await writeFile(join(app.directory, "auth-response.json"), JSON.stringify({ user: { factors: [{ id: "fixture-totp", factor_type: "totp", status: "verified" }] } }));
  await another.goto(app.base + "/cart/tracking-sandbox.php");
  await another.getByRole("button", { name: "Sign in to track" }).waitFor();
  assert.equal((await another.request.get(app.base + "/cart/api/status.php?order=bad&tracking=1")).status(), 401, "An existing AAL1 session cannot bypass a provider-verified second factor.");
});

function shopFixture() {
  const store = { id: 'seller_fixture', cartScope: 'shop-fixture', enabled: true, name: 'Morning Goods', accent: '#665240', button: '#233d31', background: '#f4f0e8', logoId: '', backgroundId: '', logoPath: '', backgroundPath: '', animation: 'rise' };
  const products = [
    { id: 'shop-coffee', name: 'Roasted coffee', description: 'A smooth, everyday roast for slower mornings.', type: 'physical', imagePath: '/v1/public/media/coffee_image', choices: [
      { id: 'shop-coffee~small', name: '250 g', price: 79000, stock: 8, available: true, imagePath: '/v1/public/media/coffee_image' },
      { id: 'shop-coffee~large', name: '500 g', price: 95000, stock: 4, available: true, imagePath: '/v1/public/media/coffee_image' },
      { id: 'shop-coffee~sold', name: '1 kg', price: 170000, stock: 0, available: false, imagePath: '/v1/public/media/coffee_image' },
    ] },
    { id: 'shop-granola', name: 'Honey granola', description: 'Golden oats, roasted nuts, and a little honey.', type: 'physical', imagePath: '/v1/public/media/granola_image', choices: [{ id: 'shop-granola', name: 'Standard', price: 58000, stock: 10, available: true, imagePath: '/v1/public/media/granola_image' }] },
  ];
  const selections = products.flatMap(product => product.choices.map(choice => ({ ...choice, productId: product.id, variantId: choice.id.split('~')[1] || '', sellerId: store.id, type: 'physical', name: product.name + ' ' + choice.name, productName: product.name, variantName: choice.name, weightGrams: 300, sku: choice.id })));
  const catalog = products.map(product => ({ ...product, status: 'active', price: product.choices[0].price, stock: product.choices[0].stock, weightGrams: 300, media: [{ id: product.id === 'shop-coffee' ? 'coffee_image' : 'granola_image' }], variants: product.choices.length > 1 ? product.choices.map(choice => ({ id: choice.id.split('~')[1], name: choice.name, price: choice.price, stock: choice.stock })) : [] }));
  return { store, products, selections, catalog };
}

async function shopImages(page) {
  const coffee = await readFile(join(root, 'cart/admin/assets/products/kopi-susu.webp'));
  const granola = await readFile(join(root, 'cart/admin/assets/products/granola.webp'));
  await page.route('https://ezkart-api-test.fixture.workers.dev/v1/public/media/*', route => route.fulfill({ contentType: 'image/webp', body: route.request().url().includes('coffee') ? coffee : granola }));
}

test('shop appearance saves through merchant UI, public catalog shares a multi-product checkout and direct variant links', async t => {
  const app = await setup({ EZKART_CLOUDFLARE_API_URL: 'https://ezkart-api-test.fixture.workers.dev', EZKART_DOKU_SANDBOX_PAYMENT_FLOW: 'direct_bca' });
  const fixture = shopFixture();
  await writeFile(join(app.directory, 'storefront.json'), JSON.stringify(fixture));
  const { chromium } = await import('../builder-mcp/node_modules/playwright/index.mjs');
  const browser = await chromium.launch();
  t.after(async () => { await browser.close(); await app.close(); });
  const errors = [], page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  page.on('pageerror', e => errors.push(e.message));
  await shopImages(page);
  await page.context().addCookies([app.adminCookie()]);
  await page.goto(app.base + '/cart/admin/?page=shop');
  await page.locator('#shop-settings:not([disabled])').waitFor();
  assert.equal(await page.locator('#shop-product-links .shop-product-link').count(), 2);
  assert.equal((await page.request.put(app.base + '/cart/admin/?cloud=%2Fv1%2Fstorefront', { data: fixture.store })).status(), 403, 'A forged appearance save must fail CSRF validation');
  await page.locator('[name=name]').fill('Morning & Co.');
  await page.locator('[name=button]').fill('#264a38');
  await page.locator('[name=background]').fill('#ede8dc');
  await page.locator('[name=animation]').selectOption('fade');
  await page.locator('[data-shop-upload=logoId]').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVZkAAAAASUVORK5CYII=', 'base64') });
  await page.waitForFunction(() => document.querySelector('#shop-admin-status').textContent.includes('Image ready'));
  await page.locator('[data-preview-mode=checkout]').click();
  assert.match(await page.locator('#shop-preview').textContent(), /Review your cart/);
  await page.locator('#shop-save').click();
  await page.waitForFunction(() => document.querySelector('#shop-admin-status').textContent.startsWith('Saved.'));
  await page.reload();
  await page.locator('#shop-settings:not([disabled])').waitFor();
  assert.equal(await page.locator('[name=name]').inputValue(), 'Morning & Co.');
  assert.equal(await page.locator('[name=button]').inputValue(), '#264a38');
  assert.equal(await page.locator('#shop-logo-preview').isVisible(), true);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
  if (process.env.EZKART_TEST_SCREENSHOTS) await page.screenshot({ animations: 'disabled', path: join(process.env.EZKART_TEST_SCREENSHOTS, 'shop-admin-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  if (process.env.EZKART_TEST_SCREENSHOTS) await page.screenshot({ animations: 'disabled', path: join(process.env.EZKART_TEST_SCREENSHOTS, 'shop-admin-mobile.png'), fullPage: true });
  await page.goto(app.base + '/shop/?store=seller_fixture');
  await page.locator('#shop-content:not([hidden])').waitFor();
  assert.equal(await page.locator('.shop-product').count(), 2);
  assert.equal(await page.locator('#shop-name').textContent(), 'Morning & Co.');
  assert.equal(await page.locator('body').evaluate(n => n.style.getPropertyValue('--store-button')), '#264a38');
  const coffee = page.locator('[data-product=shop-coffee]');
  await coffee.locator('select').selectOption('shop-coffee~sold');
  assert.equal(await coffee.locator('[data-add]').isDisabled(), true);
  await coffee.locator('select').selectOption('shop-coffee~large');
  await coffee.locator('input').fill('5'); await coffee.locator('[data-add]').click();
  assert.equal(await page.locator('#shop-count').textContent(), '0');
  await coffee.locator('input').fill('2'); await coffee.locator('[data-add]').click();
  await page.locator('[data-product=shop-granola] [data-add]').click();
  assert.equal(await page.locator('#shop-count').textContent(), '3');
  assert.match(await page.locator('#shop-subtotal').textContent(), /248\.000/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  await page.evaluate(() => { document.activeElement?.blur(); scrollTo({ top: 0, behavior: 'instant' }); });
  if (process.env.EZKART_TEST_SCREENSHOTS) await page.screenshot({ animations: 'disabled', path: join(process.env.EZKART_TEST_SCREENSHOTS, 'shop-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1400, height: 1000 });
  if (process.env.EZKART_TEST_SCREENSHOTS) await page.screenshot({ animations: 'disabled', path: join(process.env.EZKART_TEST_SCREENSHOTS, 'shop-desktop.png'), fullPage: true });
  await page.locator('#shop-checkout').click();
  await page.locator('#cart-items:not([hidden])').waitFor();
  assert.equal(await page.locator('.cart-item').count(), 2);
  assert.match(await page.locator('#cart-subtotal').textContent(), /248\.000/);
  await page.locator('[data-cart-id="shop-granola"] [data-quantity=plus]').click();
  await page.reload(); await page.locator('#cart-items:not([hidden])').waitFor();
  assert.match(await page.locator('#cart-subtotal').textContent(), /306\.000/, 'Reload must preserve quantity edits after the cart handoff');
  await page.locator('#back-to-store').click(); await page.locator('#shop-content:not([hidden])').waitFor();
  assert.equal(await page.locator('#shop-count').textContent(), '4');
  await page.goto(app.base + '/cart/?product=shop-coffee'); await page.locator('[data-product-choice]').waitFor();
  assert.equal(await page.locator('#merchant-name').textContent(), 'Morning & Co.');
  await page.locator('[data-product-choice]').selectOption('shop-coffee~small');
  await page.locator('[data-cart-id="shop-coffee~small"]').waitFor();
  assert.match(await page.locator('#cart-subtotal').textContent(), /274\.000/);
  await page.reload(); await page.locator('[data-product-choice]').waitFor();
  assert.equal(await page.locator('.cart-item').count(), 2, 'Opening the product link must not add a duplicate line');
  assert.equal(await page.locator('[data-product-choice]').inputValue(), 'shop-coffee~small');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await page.locator('.checkout-content').evaluate(n => getComputedStyle(n).animationName), 'none');
  if (process.env.EZKART_TEST_SCREENSHOTS) await page.screenshot({ animations: 'disabled', path: join(process.env.EZKART_TEST_SCREENSHOTS, 'product-checkout-desktop.png'), fullPage: true });
  await page.locator('#to-checkout').click();
  for (const [name,value] of Object.entries(input.customer)) if(value) await page.locator(`#customer-form [name="${name}"]`).fill(value);
  await page.locator('#pay-button').click();
  await page.waitForURL(/\/cart\/payment\.php\?order=EZK-S-/);
  await page.locator('#transfer-details').waitFor();
  assert.match(await page.locator('#payment-amount').textContent(), /274\.000/);
  const payment = (await app.calls()).find(call => call.url.includes('/bca-virtual-account/'));
  assert.equal(JSON.parse(payment.body).order.amount,274000);
  const order = app.cli(`echo json_encode(ez_load_order('${new URL(page.url()).searchParams.get('order')}'));`);
  assert.equal(JSON.parse(order).seller_id,'seller_fixture');
  assert.deepEqual(errors, []);
});

test('shop products reuse server-validated shipping and reject tampered prices and mixed sellers', async t => {
  const app = await setup({ EZKART_CLOUDFLARE_API_URL: 'https://ezkart-api-test.fixture.workers.dev' });
  t.after(() => app.close());
  const fixture = shopFixture(); await writeFile(join(app.directory,'storefront.json'),JSON.stringify(fixture));
  const cart = { 'shop-coffee~large': 2, 'shop-granola': 1 };
  const rates = await app.request('/cart/api/rates.php',{cart,postal_code:'12345'});
  assert.equal(rates.status,200); assert.equal(rates.data.quotes[0].price,18000);
  const started = await app.request('/cart/api/start.php',{...input,cart,shop:fixture.store.cartScope,total:1});
  assert.equal(started.status,201); assert.equal(started.data.payment_total,266000);
  const shipping = (await app.calls()).find(call=>call.url.includes('/rates/couriers'));
  assert.equal(JSON.parse(shipping.body).items.reduce((sum,item)=>sum+item.quantity,0),3);
  fixture.selections.find(item=>item.id==='shop-granola').sellerId='seller_other';
  await writeFile(join(app.directory,'storefront.json'),JSON.stringify(fixture));
  assert.equal((await app.request('/cart/api/start.php',{...input,cart})).status,422);
});
