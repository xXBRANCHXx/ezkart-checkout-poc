import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright";
import { Workspace } from "../workspace.mjs";
import { inspectPackage } from "../../templates/package.mjs";
const products = Array.from({ length: 4 }, (_, i) => ({
  id: `product-${i + 1}`,
  name: [
    "Studio lamp with an extra long product name for a small workspace and narrow mobile screens",
    "Canvas case",
    "Notebook",
    "Desk clock",
  ][i],
  description: i === 0 ? "<p>Actual product description.</p>" : "",
  type: "physical",
  price: 10000 * (i + 1),
  stock: i === 3 ? 0 : 10,
  status: "active",
  media: i === 2 ? [] : [{ id: `photo-${i}` }],
  variants:
    i === 0
      ? Array.from({ length: 8 }, (_, j) => ({
          id: `size-${j}`,
          name: `Option ${j + 1}`,
          price: 10000 + j * 1000,
          stock: j === 7 ? 0 : 10,
        }))
      : [],
}));
test("Sela picker applies four independent catalog products; sparse catalogs recompose and contain no fictional merchandise", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "ezkart-sela-")),
    ws = await new Workspace(dir).init();
  await writeFile(
    join(dir, "catalog.json"),
    JSON.stringify({
      products,
      mediaBase: "https://photos.example.test",
      demoCheckout: true,
    }),
  );
  await ws.create({ id: "source", name: "Source" });
  await ws.start();
  const browser = await chromium.launch(),
    page = await browser.newPage({
      viewport: { width: 1600, height: 1000 },
      reducedMotion: "reduce",
    }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const call = (method, args = {}) =>
    page.evaluate(({ method, args }) => EzkartBuilder[method](args), {
      method,
      args,
    });
  await page.route("**/v1/public/media/**", (r) =>
    r.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="600" height="600" fill="#eee"/><circle cx="300" cy="300" r="150" fill="#999"/></svg>',
    }),
  );
  t.after(async () => {
    await browser.close();
    await ws.stop();
    await rm(dir, { recursive: true, force: true });
    assert.deepEqual(errors, []);
  });
  await page.goto(ws.url + "/cart/admin/?page=sites&edit=source.ezkart.site");
  await page.waitForFunction(() => globalThis.EzkartBuilder);
  await page.locator("[data-open-page-creator]").first().click();
  const form = page.locator("[data-page-creator-form]");
  await form.locator("[name=page_name]").fill("Sela merchant");
  await form.locator(".sq-template-choice").filter({ hasText: "Sela" }).click();
  await form.locator("[name=template_brand]").fill("Merchant Studio");
  await form.locator("[name=template_product]").selectOption("product-1");
  assert.deepEqual(
    await form
      .locator("[name=template_products]")
      .first()
      .evaluate((n) => ({
        opacity: getComputedStyle(n).opacity,
        position: getComputedStyle(n).position,
        width: n.getBoundingClientRect().width,
      })),
    { opacity: "1", position: "static", width: 18 },
  );
  for (const p of products.slice(1))
    await form.locator(`[name=template_products][value="${p.id}"]`).check();
  await form.locator("[data-create-page]").click();
  await page.waitForURL("**edit=sela-merchant.ezkart.site");
  await page.waitForFunction(() => globalThis.EzkartBuilder);
  await call("settle");
  assert.deepEqual(
    (await ws.read("sela-merchant")).products,
    products.map((p) => p.id),
  );
  const nodes = await call("nativeInspect");
  assert.equal(
    nodes.filter(
      (n) =>
        n.type === "commerce" &&
        n.part === "product-name" &&
        n.id.startsWith("card-"),
    ).length,
    4,
  );
  await call("save");
  await page.reload();
  await page.waitForFunction(() => globalThis.EzkartBuilder);
  assert.equal(
    (await call("nativeInspect", { id: "nav-brand-name" })).text,
    "Merchant Studio",
  );
  let html = await call("exportHtml");
  assert.doesNotMatch(
    html,
    /Riser Kayu|Beri ruang|Meja kecil|Oak natural|Toko konsep|riser-720|packaging-720|80 × 40/,
  );
  await page.route("**/merchant-export", (r) =>
    r.fulfill({ body: html, contentType: "text/html" }),
  );
  await page.goto(ws.url + "/merchant-export");
  for (const width of [320, 390, 768, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      `Layout at ${width}`,
    );
  }
  await page.locator("#native-filter-felt").click();
  assert.equal(await page.locator("#native-card-cup").isVisible(), true);
  assert.equal(await page.locator("#native-card-riser").isVisible(), false);
  await page.locator("#native-filter-all").click();
  await page.locator("#native-card-riser-details").click();
  await page
    .locator("#native-detail-riser-options select")
    .selectOption("size-3");
  assert.equal(
    await page.locator("#native-detail-riser-price").innerText(),
    "Rp13.000",
  );
  await page.keyboard.press("Escape");
  await page.locator("#native-setup-tab-write").click();
  assert.equal(
    await page.locator("#native-setup-total-write").innerText(),
    "Rp50.000",
  );
  await page.locator("#native-setup-add-write button").click();
  assert.equal(await page.locator(".ezkart-cart-row").count(), 2);
  const text = await page.locator("[data-ezkart-cart-items]").innerText();
  assert.match(text, /Canvas case/);
  assert.match(text, /Notebook/);
  assert.doesNotMatch(text, /Desk clock/);
  await page.keyboard.press("Escape");
  await page.locator("#native-setup-tab-small").click();
  assert.equal(
    await page.locator("#native-setup-add-small button").isDisabled(),
    true,
  );
  await page.locator("#native-setup-tab-work").click();
  assert.equal(
    await page.locator("#native-setup-total-work").innerText(),
    "Rp33.000",
  );
  // Prepare through the public application API for every supported cardinality.
  for (const count of [1, 2, 3]) {
    const id = `count-${count}`;
    await ws.create({ id, name: id });
    await page.goto(ws.url + `/cart/admin/?page=sites&edit=${id}.ezkart.site`);
    await page.waitForFunction(() => globalThis.EzkartBuilder);
    const chosen = products.slice(0, count).map((p) => p.id);
    await call("applyTemplate", {
      templateId: "sela",
      productIds: chosen,
      brandName: "Merchant Studio",
    });
    await call("save");
    const inspect = await call("nativeInspect");
    assert.equal(
      inspect.filter(
        (n) => n.part === "product-name" && n.id.startsWith("card-"),
      ).length,
      count,
    );
    assert.equal(
      inspect.some((n) => n.id === "sela-setup"),
      count > 1,
    );
    if (count > 1)
      assert.equal(
        await page.locator("#native-setup-add-work button").isVisible(),
        true,
      );
    await call("undo");
    assert.equal((await call("nativeInspect")).length, 0);
    await call("redo");
  }
  // Missing media/copy and an unbroken store name must keep the purchase path usable.
  await ws.create({ id: "sparse", name: "Sparse" });
  await page.goto(ws.url + "/cart/admin/?page=sites&edit=sparse.ezkart.site");
  await page.waitForFunction(() => globalThis.EzkartBuilder);
  await call("applyTemplate", {
    templateId: "sela",
    productIds: ["product-3"],
    brandName:
      "AReallyLongUnbrokenMerchantNameThatNeedsToWrapAcrossSmallScreensWithoutClipping",
  });
  html = await call("exportHtml");
  await page.goto(ws.url + "/merchant-export");
  for (const width of [320, 390, 768, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      `Sparse layout at ${width}`,
    );
  }
  assert.equal(await page.locator("#native-sela-story").count(), 0);
  assert.equal(await page.locator("#native-sela-setup").count(), 0);
  assert.equal(await page.locator("#native-sela-guide").count(), 0);
  await page.locator("#native-card-riser-details").click();
  assert.equal(
    await page.locator("#native-detail-riser-add button").isEnabled(),
    true,
  );
  assert.equal(await page.locator("#native-detail-riser-image").count(), 0);
  await page.keyboard.press("Escape");
  // Decimal currencies retain cents; mixing currencies is rejected before applying.
  const dollarProducts = products.slice(0, 2).map((p, i) => ({
    ...p,
    currency: "USD",
    price: i ? 20.25 : 19.5,
    variants: [],
  }));
  await writeFile(
    join(dir, "catalog.json"),
    JSON.stringify({
      products: [...dollarProducts, { ...products[2], currency: "IDR" }],
      currency: "USD",
      demoCheckout: true,
    }),
  );
  await ws.create({ id: "dollars", name: "Dollars" });
  await page.goto(ws.url + "/cart/admin/?page=sites&edit=dollars.ezkart.site");
  await page.waitForFunction(() => globalThis.EzkartBuilder);
  await assert.rejects(
    () =>
      call("applyTemplate", {
        templateId: "sela",
        productIds: ["product-1", "product-3"],
        brandName: "Studio",
      }),
    /same currency/,
  );
  assert.equal((await call("nativeInspect")).length, 0);
  await call("applyTemplate", {
    templateId: "sela",
    productIds: ["product-1", "product-2"],
    brandName: "Studio",
  });
  html = await call("exportHtml");
  await page.goto(ws.url + "/merchant-export");
  assert.match(
    await page.locator("#native-setup-total-work").innerText(),
    /39[.,]75/,
  );
  await page.locator("#native-setup-add-work button").click();
  assert.match(
    await page.locator("[data-ezkart-cart-subtotal]").innerText(),
    /39[.,]75/,
  );
});
test("Sela packages its approved composition, isolated preview assets and licensed font below 50 MB", async () => {
  const p = await inspectPackage("sela");
  assert(p.bytes < 50_000_000);
  assert(
    p.files.some((f) => f.path.includes("sela/preview/approved-recipe.json")),
  );
  assert(p.files.some((f) => f.path.endsWith("plus-jakarta-sans.woff2")));
});
