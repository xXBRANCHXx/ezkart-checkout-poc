import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright";
import { Workspace } from "../workspace.mjs";
import { inspectPackage } from "../../templates/package.mjs";
const products = [
  {
    id: "first",
    name: "A long merchant product name with real specifications and several different available options",
    description: "Actual description of the merchant product.",
    type: "physical",
    currency: "USD",
    price: 19.5,
    stock: 8,
    status: "active",
    media: [{ id: "first" }],
    variants: Array.from({ length: 8 }, (_, i) => ({
      id: "v" + i,
      name: "Choice " + (i + 1),
      price: 19.5 + i,
      stock: i === 7 ? 0 : 8,
    })),
  },
  {
    id: "second",
    name: "Second product without a photograph",
    description: "",
    type: "physical",
    currency: "USD",
    price: 20.25,
    stock: 8,
    status: "active",
    media: [],
    variants: [
      { id: "small", name: "Small", price: 20.25, stock: 8 },
      { id: "large", name: "Large", price: 25.75, stock: 3 },
    ],
  },
  {
    id: "empty",
    name: "Sold-out product",
    description: "",
    type: "physical",
    currency: "USD",
    price: 10,
    stock: 0,
    status: "active",
    media: [],
    variants: [],
  },
];
test("Soft Signal applies empty, adapts its model studio to real catalog data, preserves edits and gates output", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "ezkart-soft-signal-"));
  await writeFile(
    join(dir, "catalog.json"),
    JSON.stringify({
      products,
      demoCheckout: false,
      currency: "USD",
      locale: "en-US",
      mediaBase: "https://media.example.test",
    }),
  );
  const ws = await new Workspace(dir).init();
  await ws.create({ id: "soft", name: "Soft Signal" });
  await ws.start();
  const b = await chromium.launch(),
    p = await b.newPage({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: "reduce",
    }),
    errors = [];
  p.setDefaultTimeout(10000);
  t.after(async () => {
    await b.close();
    await ws.stop();
    await rm(dir, { recursive: true, force: true });
    assert.deepEqual(errors, []);
  });
  p.on("pageerror", (e) => errors.push(e.message));
  await p.route("**/v1/public/media/**", (r) =>
    r.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="600" height="600" fill="#ddd"/></svg>',
    }),
  );
  const call = (method, args = {}) =>
    p.evaluate(({ method, args }) => EzkartBuilder[method](args), {
      method,
      args,
    });
  const edit = async (id = "soft") => {
    await p.goto(
      ws.url + "/cart/admin/?page=sites&edit=" + id + ".ezkart.site",
    );
    await p.waitForFunction(() => globalThis.EzkartBuilder);
    await call("settle");
  };
  let html = "";
  await p.route("**/merchant-export*", (r) =>
    r.fulfill({ body: html, contentType: "text/html" }),
  );
  await edit();
  assert((await call("templates")).some((t) => t.id === "soft-signal"));
  await call("applyTemplate", {
    templateId: "soft-signal",
    productIds: [],
    brandName: "My store",
  });
  assert.equal(
    await p
      .locator("[data-native-id=template-product-empty-title]")
      .innerText(),
    "Add your product",
  );
  await assert.rejects(call("publish"), /Add one of your products/);
  await assert.rejects(call("exportHtml"), /Add one of your products/);
  html = await call("previewHtml");
  assert(html.includes("Add your product"));
  await p.locator("[data-native-id=template-product-choose]").click();
  await p.locator('[data-template-slot="0"]').waitFor({ state: "visible" });
  await call("nativeUpdate", {
    id: "hero-title",
    text: "My own headline",
    props: { color: "#f4dba1" },
  });
  await call("nativeUpdate", {
    id: "soft-signal-about",
    props: { backgroundColor: "#f6eedf" },
  });
  await call("save");
  await call("connectTemplateProducts", { productIds: ["first", "second"] });
  await call("save");
  await edit();
  assert.equal(
    (await call("nativeInspect", { id: "hero-title" })).text,
    "My own headline",
  );
  assert.equal(
    (await call("nativeInspect", { id: "soft-signal-about" })).props
      .backgroundColor,
    "#f6eedf",
  );
  html = await call("exportHtml");
  assert.equal(
    /The Signal|The Carry|Ember|2700K|27 cm|charging dock|fictional brand|fictional review|Your demo cart|Complete demo checkout|No order was placed/.test(
      html
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ""),
    ),
    false,
    "merchant markup contains no fictional product or demo notices",
  );
  assert.match(html, /Review cart/);
  await p.goto(ws.url + "/merchant-export");
  for (const width of [320, 390, 540, 680, 768, 900, 1024, 1440, 1920]) {
    await p.setViewportSize({ width, height: 1000 });
    assert.equal(
      await p.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      "width " + width,
    );
  }
  await p.locator("#native-options-signal select").selectOption("v1");
  assert.match(await p.locator("#native-price-signal").innerText(), /20.50/);
  await p.locator('#native-quantity-signal [data-commerce-step="1"]').click();
  await p.locator("#native-model-signal").focus();
  await p.keyboard.press("ArrowRight");
  assert.equal(await p.locator("#native-info-carry").isVisible(), true);
  assert.equal(await p.locator("#native-gallery-carry").count(), 0);
  assert.equal(await p.locator("#native-photo-dialog-carry").count(), 0);
  assert.equal(await p.locator("#native-description-carry").count(), 0);
  const shop = await p.locator("#native-studio").boundingBox(),
    info = await p.locator("#native-info-carry").boundingBox();
  assert(
    Math.abs(shop.width - info.width) < 2,
    "missing-image model uses the full studio width",
  );
  assert.equal(
    await p.locator("#native-quantity-carry input").inputValue(),
    "1",
  );
  await p.locator("#native-options-carry select").selectOption("large");
  assert.match(
    await p.locator("#native-comparison-price-carry").innerText(),
    /25.75/,
  );
  await p.locator("#native-add-carry button").click();
  assert.match(
    await p.locator("[data-ezkart-cart-subtotal]").innerText(),
    /25.75/,
  );
  await p.keyboard.press("Escape");
  await p.locator("[data-ezkart-cart-layer]").waitFor({ state: "hidden" });
  await p.locator("#native-choose-signal").click();
  assert.equal(await p.locator("#native-info-signal").isVisible(), true);
  assert.equal(
    await p.locator("#native-quantity-signal input").inputValue(),
    "2",
  );
  await p.locator("#native-zoom-signal").click();
  assert.equal(
    await p.locator("#native-photo-dialog-signal").isVisible(),
    true,
  );
  await p.keyboard.press("Escape");
  await p.locator("#native-add-signal button").click();
  assert.match(
    await p.locator("[data-ezkart-cart-subtotal]").innerText(),
    /66.75/,
  );
  await p.keyboard.press("Escape");
  await p.locator("[data-ezkart-cart-layer]").waitFor({ state: "hidden" });
  await p.locator("#native-options-signal select").selectOption("v7");
  assert.equal(await p.locator("#native-add-signal button").isDisabled(), true);
  assert.equal(
    await p.locator("#native-quantity-signal input").isDisabled(),
    true,
  );
  await p.locator("#native-mood-low").click();
  assert.equal(
    await p
      .locator("#native-mood-photo")
      .evaluate((n) => getComputedStyle(n).filter),
    "brightness(0.66)",
  );
  await p.locator("#native-footer-privacy").click();
  assert.equal(await p.locator("#native-policy-privacy").isVisible(), true);
  await p.keyboard.press("Escape");
  assert.equal(
    await p.evaluate(() => document.activeElement.id),
    "native-footer-privacy",
  );
  for (const ids of [["second"], ["empty", "second"], [], ["empty"]]) {
    const id = "case-" + (ids.join("-") || "blank");
    await ws.create({ id, name: id });
    await edit(id);
    await call("applyTemplate", {
      templateId: "soft-signal",
      productIds: ids,
      brandName:
        "AnExtremelyLongUnbrokenMerchantNameThatStillNeedsToFitInTheNavigationOnAPhone",
    });
    const count = (await call("nativeInspect")).length;
    await call("undo");
    assert.equal((await call("nativeInspect")).length, 0);
    await call("redo");
    assert.equal((await call("nativeInspect")).length, count);
    if (!ids.length || (ids.length === 1 && ids[0] === "empty")) {
      await assert.rejects(call("exportHtml"), /Add one|stock|available/i);
      html = await call("previewHtml");
    } else html = await call("exportHtml");
    await p.goto(ws.url + "/merchant-export");
    for (const width of [320, 390, 768, 1440, 1920]) {
      await p.setViewportSize({ width, height: 1000 });
      assert.equal(
        await p.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
        "sparse " + ids + " at " + width,
      );
    }
    if (ids.length < 2) {
      assert.equal(await p.locator("#native-model-tabs").count(), 0);
      assert.equal(
        await p.locator("[data-native-id=soft-signal-compare]").count(),
        0,
      );
    }
    if (ids.length === 2) {
      assert.equal(await p.locator("#native-info-carry").isVisible(), true);
      assert.equal(
        await p.locator("#native-add-carry button").isDisabled(),
        false,
      );
      assert.equal(await p.locator("#native-info-signal").isVisible(), false);
    }
  }
  const pack = await inspectPackage("soft-signal");
  assert(pack.bytes < 50_000_000);
  assert(pack.files.some((f) => f.path.endsWith("/manrope.woff2")));
  assert.equal(pack.sections, 9);
});
