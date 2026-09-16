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
test("Takar applies real product collections with independent choices, editable history, useful sparse layouts and no fictional recipes", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "ezkart-takar-")),
    ws = await new Workspace(dir).init();
  await writeFile(
    join(dir, "catalog.json"),
    JSON.stringify({
      products,
      demoCheckout: true,
      currency: "USD",
      locale: "en-US",
      mediaBase: "https://media.example.test",
    }),
  );
  await ws.create({ id: "start", name: "Start" });
  await ws.start();
  const b = await chromium.launch(),
    p = await b.newPage({
      viewport: { width: 1600, height: 1100 },
      reducedMotion: "reduce",
    }),
    errors = [];
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
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="600" height="600" fill="#eee"/></svg>',
    }),
  );
  const call = (method, args = {}) =>
    p.evaluate(({ method, args }) => EzkartBuilder[method](args), {
      method,
      args,
    });
  await p.goto(ws.url + "/cart/admin/?page=sites&edit=start.ezkart.site");
  await p.waitForFunction(() => globalThis.EzkartBuilder);
  await p.locator("[data-open-page-creator]").first().click();
  const form = p.locator("[data-page-creator-form]");
  await form.locator("[name=page_name]").fill("Takar merchant");
  await form
    .locator(".sq-template-choice")
    .filter({ hasText: "Takar" })
    .click();
  await form.locator("[name=template_brand]").fill("Merchant Store");
  await form.locator("[data-create-page]").click();
  await p.waitForURL("**edit=takar-merchant.ezkart.site");
  await p.waitForFunction(() => globalThis.EzkartBuilder);
  await call("settle");
  await call("connectTemplateProducts", { productIds: ["p1", "p2", "p3"] });
  await call("save");
  await p.reload();
  await p.waitForFunction(() => globalThis.EzkartBuilder);
  assert.equal(
    (await call("nativeInspect", { id: "nav-brand-name" })).text,
    "Merchant Store",
  );
  assert.deepEqual((await ws.read("takar-merchant")).products, [
    "p1",
    "p2",
    "p3",
  ]);
  let html = await call("exportHtml");
  assert.doesNotMatch(
    html,
    /Sambal Bawang|Bawang Renyah|Nasi hangat|Cabai merah|Toko konsep|ingredients-720|1 porsi|sesuai selera/,
  );
  await p.route("**/merchant-export", (r) =>
    r.fulfill({ body: html, contentType: "text/html" }),
  );
  await p.goto(ws.url + "/merchant-export");
  for (const width of [320, 390, 560, 768, 1024, 1440, 1920]) {
    await p.setViewportSize({ width, height: 1000 });
    assert.equal(
      await p.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      "Layout " + width,
    );
  }
  await p.locator("#native-hero-options select").selectOption("v1");
  assert.match(
    await p.locator("#native-closing-pair-add").innerText(),
    /40.75/,
  );
  assert.equal(
    await p.locator("#native-card-renyah-add button").isDisabled(),
    true,
  );
  await p
    .locator("#native-card-tomat-options label")
    .filter({ hasText: "Large" })
    .click();
  assert.match(
    await p.locator("#native-closing-pair-add").innerText(),
    /46.25/,
  );
  await p.locator("#native-card-tomat-name").click();
  assert.equal(
    await p
      .locator("#native-detail-tomat-options input[value=p2-large]")
      .isChecked(),
    true,
  );
  assert.match(
    await p.locator("#native-detail-tomat-price").innerText(),
    /25.75/,
  );
  await p.keyboard.press("Escape");
  await p.locator("#native-recipe-tab-noodles").click();
  assert.equal(await p.locator("#native-recipe-noodles-image").count(), 0);
  await p.locator("#native-recipe-noodles-add button").click();
  assert.match(
    await p.locator("[data-ezkart-cart-items]").innerText(),
    /A second product/,
  );
  assert.match(
    await p.locator("[data-ezkart-cart-items]").innerText(),
    /Large/,
  );
  await p.keyboard.press("Escape");
  await p.locator("#native-card-bawang-name").click();
  assert.match(
    await p.locator("#native-detail-bawang-price").innerText(),
    /20.50/,
  );
  await p.keyboard.press("Escape");
  for (const ids of [["p1", "p2"], ["p2"]]) {
    const id = "count-" + ids.length;
    await ws.create({ id, name: id });
    await p.goto(ws.url + `/cart/admin/?page=sites&edit=${id}.ezkart.site`);
    await p.waitForFunction(() => globalThis.EzkartBuilder);
    await call("applyTemplate", {
      templateId: "takar",
      productIds: ids,
      brandName:
        "AReallyLongUnbrokenMerchantNameThatNeedsToWrapOnSmallScreensWithoutClipping",
    });
    await call("save");
    const count = (await call("nativeInspect")).length;
    await call("undo");
    assert.equal((await call("nativeInspect")).length, 0);
    await call("redo");
    assert.equal((await call("nativeInspect")).length, count);
    html = await call("exportHtml");
    await p.goto(ws.url + "/merchant-export");
    for (const width of [320, 390, 768, 1440, 1920]) {
      await p.setViewportSize({ width, height: 1000 });
      assert.equal(
        await p.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
        "Sparse " + ids.length + " at " + width,
      );
    }
    if (ids.length === 1) {
      assert.equal(await p.locator("#native-takar-recipes").count(), 0);
      assert.equal(await p.locator("#native-takar-story").count(), 0);
      assert.equal(await p.locator("#native-hero-image").count(), 1);
      assert.equal(
        await p.locator("#native-closing-single-add button").isEnabled(),
        true,
      );
      await p.locator("#native-card-bawang-name").click();
      assert.equal(await p.locator("#native-detail-bawang-image").count(), 0);
      assert.equal(
        await p.locator("#native-detail-bawang-add button").isEnabled(),
        true,
      );
    }
  }
});
test("Takar keeps approved preview assets separate and packages below 50 MB", async () => {
  const p = await inspectPackage("takar");
  assert(p.bytes < 50_000_000);
  assert(
    p.files.some((f) => f.path.endsWith("takar/preview/approved-recipe.json")),
  );
  assert(p.files.some((f) => f.path.endsWith("dm-sans.woff2")));
});
