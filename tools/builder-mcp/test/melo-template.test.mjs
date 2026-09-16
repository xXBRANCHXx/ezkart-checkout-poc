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
    id: "p1",
    name: "A very long merchant product name with real sizes and specifications that should wrap on the narrowest phone screen",
    description: "<p>Actual merchant product description.</p>",
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
    id: "p2",
    name: "A second product without a photo",
    description: "",
    type: "physical",
    currency: "USD",
    price: 20.25,
    stock: 8,
    status: "active",
    media: [],
    variants: [
      { id: "p2-small", name: "Small", price: 20.25, stock: 8 },
      { id: "p2-large", name: "Large", price: 25.75, stock: 8 },
    ],
  },
  {
    id: "p3",
    name: "Sold-out third product",
    description: "",
    type: "physical",
    currency: "USD",
    price: 30,
    stock: 0,
    status: "active",
    media: [{ id: "third" }],
    variants: [],
  },
];
test("Melo starts empty, preserves merchant edits and adapts independent products, dialogs and filters", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "ezkart-melo-")),
    ws = await new Workspace(dir).init();
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
  await ws.create({ id: "melo", name: "Melo" });
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
  const edit = async (id = "melo") => {
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
  assert((await call("templates")).some((t) => t.id === "melo"));
  await call("applyTemplate", {
    templateId: "melo",
    productIds: [],
    brandName: "My Store",
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
    id: "hero-first",
    text: "My own headline",
    props: { color: "#123456" },
  });
  await call("nativeUpdate", { id: "product-grid", props: { gap: "37px" } });
  await call("save");
  await call("connectTemplateProducts", { productIds: ["p1", "p2", "p3"] });
  await call("save");
  await edit();
  assert.equal(
    (await call("nativeInspect", { id: "hero-first" })).text,
    "My own headline",
  );
  assert.equal(
    (await call("nativeInspect", { id: "hero-first" })).props.color,
    "#123456",
  );
  assert.equal(
    (await call("nativeInspect", { id: "product-grid" })).props.gap,
    "37px",
  );
  html = await call("exportHtml");
  assert.doesNotMatch(
    html,
    /Kit Mekar|Kit Alun|Kit Teduh|punch needle|Benang akrilik|±12 cm|2–3 hari|dalam 7 hari|usia 14|Checkout simulasi|Your demo cart|Complete demo checkout/,
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
      "Layout " + width,
    );
  }
  assert.equal(await p.locator("#native-photo-alun").count(), 0);
  await p.locator("#native-filter-mat").click();
  assert.equal(await p.locator("#product-mekar").isVisible(), false);
  assert.equal(await p.locator("#product-teduh").isVisible(), true);
  assert.match(p.url(), /availability=soldout/);
  await p.locator("#native-hero-shop").click();
  assert.equal(await p.locator("#product-mekar").isVisible(), true);
  assert.match(p.url(), /availability=all/);
  await p.locator("#native-options-mekar select").selectOption("v1");
  assert.match(await p.locator("#native-buy-mekar-price").innerText(), /20.50/);
  await p.locator("#native-options-alun select").selectOption("p2-large");
  assert.match(await p.locator("#native-buy-alun-price").innerText(), /25.75/);
  assert.match(await p.locator("#native-buy-mekar-price").innerText(), /20.50/);
  assert.equal(
    await p.locator("#native-buy-teduh-add button").isDisabled(),
    true,
  );
  await p.locator("#native-details-mekar").click();
  assert.equal(
    await p.locator("#native-dialog-options-mekar select").inputValue(),
    "v1",
  );
  assert.match(
    await p.locator("#native-dialog-description-mekar").innerText(),
    /Actual merchant/,
  );
  await p.locator("#native-dialog-options-mekar select").selectOption("v7");
  assert.equal(
    await p.locator("#native-dialog-buy-mekar-add button").isDisabled(),
    true,
  );
  await p.keyboard.press("Escape");
  assert.equal(
    await p.locator("#native-buy-mekar-add button").isDisabled(),
    true,
  );
  await p.locator("#native-details-alun").click();
  assert.equal(await p.locator("#native-dialog-image-alun").count(), 0);
  assert.equal(await p.locator("#native-dialog-description-alun").count(), 0);
  await p.locator("#native-dialog-buy-alun-add button").click();
  assert.match(await p.locator(".ezkart-cart-row").innerText(), /Large/);
  assert.match(
    await p.locator("[data-ezkart-cart-subtotal]").innerText(),
    /25.75/,
  );
  await p.keyboard.press("Escape");
  await p.locator("[data-ezkart-cart-layer]").waitFor({ state: "hidden" });
  await p.locator("#native-kit-tab-full").focus();
  await p.keyboard.press("ArrowRight");
  assert.equal(await p.locator("#native-kit-panel-refill").isVisible(), true);
  assert.match(
    await p.locator("#native-kit-title-refill").innerText(),
    /second product/,
  );
  await p.locator("#native-compare-link-refill").click();
  assert.equal(new URL(p.url()).hash, "#product-alun");
  for (const ids of [["p2"], ["p1", "p2"], [], ["p3"]]) {
    const id = "sparse-" + (ids.join("-") || "empty");
    await ws.create({ id, name: id });
    await edit(id);
    await call("applyTemplate", {
      templateId: "melo",
      productIds: ids,
      brandName:
        "AReallyLongUnbrokenMerchantNameThatNeedsToWrapOnSmallScreensWithoutClipping",
    });
    const count = (await call("nativeInspect")).length;
    await call("undo");
    assert.equal((await call("nativeInspect")).length, 0);
    await call("redo");
    assert.equal((await call("nativeInspect")).length, count);
    if (!ids.length || ids[0] === "p3") {
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
        "Sparse " + ids.join(",") + " at " + width,
      );
    }
    if (ids.length < 2)
      assert.equal(await p.locator("#native-kit-tabs").count(), 0);
    if (!ids.length)
      assert.equal(await p.locator("[data-native-id=melo-unbox]").count(), 0);
    if (ids.length === 1) {
      assert.equal(await p.locator("#product-alun").count(), 0);
      assert.equal(await p.locator("#product-teduh").count(), 0);
    }
  }
  const pack = await inspectPackage("melo");
  assert(pack.bytes < 50_000_000);
  assert(
    pack.files.some((f) =>
      f.path.endsWith("melo/preview/approved-recipe.json"),
    ),
  );
});
