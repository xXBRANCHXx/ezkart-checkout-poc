import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright";
import { Workspace, repoRoot } from "../workspace.mjs";

test("Product purchase code selects a specific variant, preserves custom content, and works in the shared drawer and plain HTML", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "ezkart-snippet-")),
    ws = await new Workspace(dir).init();
  const product = {
    id: "owned-product",
    name: "A merchant product",
    status: "active",
    type: "physical",
    price: 12000,
    stock: 0,
    variants: [
      { id: "small-option", name: "Small", price: 12000, stock: 0 },
      { id: "large-option", name: "Large", price: 18000, stock: 5 },
    ],
  };
  const saveCatalog = () =>
    writeFile(
      join(dir, "catalog.json"),
      JSON.stringify({
        products: [product],
        storageScope: "merchant-one",
        demoCheckout: true,
      }),
    );
  await saveCatalog();
  await ws.create({ id: "store", name: "Store" });
  await ws.start();
  const b = await chromium.launch(),
    context = await b.newContext({
      permissions: ["clipboard-read", "clipboard-write"],
    }),
    p = await context.newPage({ viewport: { width: 1200, height: 900 } }),
    errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  t.after(async () => {
    await b.close();
    await ws.stop();
    await rm(dir, { recursive: true, force: true });
    assert.deepEqual(errors, []);
  });
  const pages = await readFile(join(repoRoot, "cart/admin/pages.php"), "utf8"),
    index = await readFile(join(repoRoot, "cart/admin/index.php"), "utf8");
  const content = pages
    .split("<?php break; case 'products': ?>")[1]
    .split("<?php break; case 'sites':")[0]
    .replace(
      /<\?= ez_admin_icon\('([^']+)'\) \?>/g,
      '<svg class="icon"><use href="#icon-$1"></use></svg>',
    )
    .replace(/<\?[\s\S]*?\?>/g, "");
  await p.route(
    (u) =>
      u.pathname === "/cart/admin/" &&
      u.searchParams.get("page") === "products",
    (r) =>
      r.fulfill({
        contentType: "text/html",
        body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="admin.css"><link rel="stylesheet" href="catalog.css"></head><body class="page-products" data-admin-cloud-enabled="true" data-admin-storage-scope="merchant-one" data-admin-csrf-token="${ws.csrf}"><svg style="display:none">${(index.match(/<symbol\b[\s\S]*?<\/symbol>/g) || []).join("")}</svg>${content}<script src="admin.js"></script></body></html>`,
      }),
  );
  await p.goto(ws.url + "/cart/admin/?page=products");
  await p.locator("[data-product-more]").click();
  await p.locator(".product-cart-code").click();
  const dialog = p.locator(".product-embed-dialog");
  assert.equal(
    await dialog.locator("[data-embed-variant]").inputValue(),
    "large-option",
  );
  assert.equal(
    await dialog
      .locator("option[value=small-option]")
      .evaluate((n) => n.disabled),
    true,
  );
  await dialog.locator("[data-embed-quantity]").fill("2");
  await dialog.locator("[data-embed-text]").fill("Choose <this>");
  await dialog.locator("[data-embed-copy]").click();
  await dialog
    .locator("[data-embed-status]")
    .filter({ hasText: "Code copied." })
    .waitFor();
  const snippet = await p.evaluate(() => navigator.clipboard.readText());
  assert.match(snippet, /data-ezkart-variant="large-option"/);
  assert.match(snippet, /Choose &lt;this&gt;/);
  assert.match(snippet, /data-ezkart-quantity="2"/);
  await dialog.locator("[data-embed-quantity]").fill("6");
  assert.equal(await dialog.locator("[data-embed-copy]").isDisabled(), true);
  await p.setViewportSize({ width: 390, height: 900 });
  assert.equal(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
  await dialog.locator("[data-embed-close]").click();
  await p.goto(ws.url + "/cart/admin/?page=sites&edit=store.ezkart.site");
  await p.waitForFunction(() => globalThis.EzkartBuilder);
  await p.evaluate(() =>
    EzkartBuilder.applyTemplate({
      templateId: "pith",
      productIds: ["owned-product"],
      brandName: "Merchant",
    }),
  );
  const html = await p.evaluate(() => EzkartBuilder.exportHtml());
  await p.route("**/storefront", (r) =>
    r.fulfill({ contentType: "text/html", body: html }),
  );
  await p.goto(ws.url + "/storefront");
  // Custom content is added after runtime mount; delegated controls still work.
  await p.evaluate((snippet) => {
    const div = document.createElement("div");
    div.innerHTML = snippet;
    const a = div.firstElementChild;
    a.id = "custom-purchase";
    a.innerHTML = "<strong>Keep my custom label</strong>";
    document.body.prepend(a);
  }, snippet);
  await p.locator("#custom-purchase").click();
  assert.equal(
    await p.locator("[data-ezkart-cart-subtotal]").innerText(),
    "Rp36.000",
  );
  assert.match(
    await p.locator("[data-ezkart-cart-items]").innerText(),
    /Large/,
  );
  assert.equal(
    await p.locator("#custom-purchase strong").innerText(),
    "Keep my custom label",
  );
  assert.equal(
    await p.evaluate(() =>
      EzkartCart.add({ productId: "owned-product", variantId: "small-option" }),
    ),
    false,
  );
  assert.equal(
    await p.evaluate(() =>
      EzkartCart.add({
        productId: "owned-product",
        variantId: "invalid-option",
      }),
    ),
    false,
  );
  assert.equal(
    await p.evaluate(() =>
      EzkartCart.add({
        productId: "owned-product",
        variantId: "large-option",
        quantity: 4,
      }),
    ),
    false,
  );
  assert.equal(
    await p.locator("[data-ezkart-cart-subtotal]").innerText(),
    "Rp36.000",
  );
  // No Ezkart JavaScript is required on an external HTML page: the link merges into hosted cart.
  const cart = await readFile(join(repoRoot, "cart/index.html"), "utf8");
  // Serve the checkout's current dependencies; this workspace only serves builder assets.
  for (const asset of ["storefront.js", "storefront.css", "address-picker.js", "customer-addresses.js", "customer-addresses.css"]) {
    await p.route(`**/cart/${asset}*`, async route => route.fulfill({ contentType: asset.endsWith(".css") ? "text/css" : "text/javascript", body: await readFile(join(repoRoot, "cart", asset), "utf8") }));
  }
  await p.route("**/cart/api/checkout-config.php", route => route.fulfill({ json: { ok: true, environment: "sandbox", shipping_required: false } }));
  await p.route("**/cart/api/customer-session.php*", route => route.fulfill({ json: { ok: true, authenticated: false } }));
  await p.route(
    (u) => u.pathname === "/cart/",
    (r) => r.fulfill({ contentType: "text/html", body: cart }),
  );
  await p.route("**/cart/cart.js*", async (r) =>
    r.fulfill({
      contentType: "text/javascript",
      body: await readFile(join(repoRoot, "cart/cart.js"), "utf8"),
    }),
  );
  await p.route("**/cart/cart.css*", async (r) =>
    r.fulfill({
      contentType: "text/css",
      body: await readFile(join(repoRoot, "cart/cart.css"), "utf8"),
    }),
  );
  await p.route("**/cart/api/catalog.php*", (r) =>
    r.fulfill({
      json: {
        ok: true,
        products: [
          {
            id: "owned-product~large-option",
            name: product.name,
            variant_name: "Large",
            price: 18000,
            stock: 5,
            type: "physical",
          },
        ],
      },
    }),
  );
  await p.route("**/external-page", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: "<!doctype html><html><body>" + snippet + "</body></html>",
    }),
  );
  await p.goto(ws.url + "/external-page");
  await p.locator("a").click();
  await p.locator("#cart-items .cart-item").waitFor();
  assert.match(await p.locator("#cart-items").innerText(), /Large/);
  assert.match(await p.locator("#cart-subtotal").innerText(), /36\.000/);
  await p.reload();
  assert.match(await p.locator("#cart-subtotal").innerText(), /36\.000/); // Reload does not add again.
  // Copy checks current stock even when the settings dialog was opened earlier.
  await p.goto(ws.url + "/cart/admin/?page=products");
  await p.locator("[data-product-more]").click();
  await p.locator(".product-cart-code").click();
  product.variants[1].stock = 0;
  await saveCatalog();
  await dialog.locator("[data-embed-copy]").click();
  await dialog
    .locator("[data-embed-status]")
    .filter({ hasText: "no longer available" })
    .waitFor();
  assert.equal(await dialog.locator("[data-embed-code]").inputValue(), "");
  assert.match(
    await dialog.locator("[data-embed-status]").innerText(),
    /no longer available/,
  );
});
