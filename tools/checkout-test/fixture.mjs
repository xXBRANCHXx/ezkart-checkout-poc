import assert from "node:assert/strict";
import {spawn, spawnSync} from "node:child_process";
import {mkdtemp, readFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {createServer} from "node:net";
const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const php = process.env.PHP_BINARY || "php";
const fixture = join(root, "tools/checkout-test/provider-fixture.php");
const secret = "fixture-doku-sandbox-secret";
export async function setup(overrides = {}) {
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
    customerCookie(email = "checkout@example.com", id = "fixture-google-customer", expiresIn = 3600, accessToken = '') {
      const account = Buffer.from(JSON.stringify({ id, email, accessToken })).toString("base64");
      const sid = this.cli(`require ${JSON.stringify(join(root, "cart/api/customer-auth.php"))}; ez_customer_session(); $account=json_decode(base64_decode('${account}'),true); $_SESSION['customer_auth']=['user'=>['id'=>$account['id'],'email'=>$account['email']],'access_token'=>$account['accessToken']?:str_repeat('x',64),'refresh_token'=>'fixture-refresh','expires_at'=>time()+${expiresIn},'signed_in_at'=>time()]; echo session_id(); session_write_close();`);
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
