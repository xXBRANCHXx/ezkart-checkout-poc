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
test("Lintas supports product-free drafts, preserved edits, real independent variants and sparse responsive collections", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "ezkart-lintas-")),
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
      viewport: { width: 1440, height: 1000 },
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
  const edit = async (id) => {
    await p.goto(ws.url + `/cart/admin/?page=sites&edit=${id}.ezkart.site`);
    await p.waitForFunction(() => globalThis.EzkartBuilder);
    await call("settle");
  };
  await edit("start");
  await p.locator("[data-open-page-creator]").first().click();
  const form = p.locator("[data-page-creator-form]");
  await form.locator("[name=page_name]").fill("Lintas merchant");
  await form
    .locator('.sq-template-choice:has(input[value="lintas"])')
    .click();
  await form.locator("[name=template_brand]").fill("Merchant Store");
  await form.locator("[data-create-page]").click();
  await p.waitForURL("**edit=lintas-merchant.ezkart.site");
  await p.waitForFunction(() => globalThis.EzkartBuilder);
  await call("settle");
  await call("nativeUpdate", {
    id: "hero-title",
    text: "My edited headline",
    props: { color: "#123456" },
  });
  await call("save");
  assert.deepEqual((await ws.read("lintas-merchant")).products, []);
  await assert.rejects(call("publish"), /Add one of your products/);
  await call("connectTemplateProducts", { productIds: ["p1", "p2", "p3"] });
  await call("save");
  await edit("lintas-merchant");
  assert.equal(
    (await call("nativeInspect", { id: "hero-title" })).text,
    "My edited headline",
  );
  assert.equal(
    (await call("nativeInspect", { id: "hero-title" })).props.color,
    "#123456",
  );
  let html = await call("exportHtml");
  assert.doesNotMatch(
    html,
    /Hari Tote|Saku Sling|Teman Pouch|38 × 32|Kanvas katun|Foto menampilkan|Checkout simulasi/,
  );
  await p.route("**/merchant-export*", (r) =>
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
      "Three products at " + width,
    );
  }
  await p.locator("#native-filter-pelengkap").click();
  assert.equal(await p.locator("#native-card-tote").isVisible(), false);
  assert.equal(await p.locator("#native-card-pouch").isVisible(), true);
  assert.match(p.url(), /koleksi=soldout/);
  await p.reload();
  assert.equal(await p.locator("#native-card-tote").isVisible(), false);
  await p.locator("#native-filter-semua").click();
  await p.locator("#native-card-pouch-title").click();
  assert.equal(
    await p.locator("#native-detail-pouch-add button").isDisabled(),
    true,
  );
  await p.keyboard.press("Escape");
  await p.locator("#native-card-tote-title").click();
  await p.locator("#native-detail-tote-options select").selectOption("v1");
  assert.match(
    await p.locator("#native-detail-tote-price").innerText(),
    /20.50/,
  );
  await p.keyboard.press("Escape");
  assert.equal(
    await p
      .locator("#native-card-tote-title")
      .evaluate((n) => n === document.activeElement),
    true,
  );
  await p.locator("#native-card-sling-title").click();
  assert.equal(await p.locator("#native-detail-sling-image").count(), 0);
  await p.locator("#native-detail-sling-options input[value=p2-large]").check();
  assert.match(
    await p.locator("#native-detail-sling-price").innerText(),
    /25.75/,
  );
  await p.locator("#native-detail-sling-add button").click();
  assert.match(
    await p.locator("[data-ezkart-cart-items]").innerText(),
    /Large/,
  );
  await p.keyboard.press("Escape");
  await p.keyboard.press("Escape");
  await p.locator("#native-card-tote-title").click();
  assert.match(
    await p.locator("#native-detail-tote-price").innerText(),
    /20.50/,
  );
  await p.keyboard.press("Escape");
  await p.setViewportSize({ width: 390, height: 1000 });
  await p.locator("#native-compare-tab-sling").click();
  assert.equal(await p.locator("#native-compare-tote").isVisible(), false);
  assert.equal(await p.locator("#native-compare-sling").isVisible(), true);
  await p.locator("#native-compare-sling-view").click();
  assert.equal(
    await p.locator("dialog[data-native-id=detail-sling]").isVisible(),
    true,
  );
  await p.keyboard.press("Escape");
  for (const ids of [["p1", "p2"], ["p2"], []]) {
    const id = "count-" + ids.length;
    await ws.create({ id, name: id });
    await edit(id);
    await call("applyTemplate", {
      templateId: "lintas",
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
    if (!ids.length)
      await assert.rejects(call("publish"), /Add one of your products/);
    html = await call(ids.length ? "exportHtml" : "previewHtml");
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
    if (ids.length < 2) {
      assert.equal(await p.locator("#native-lintas-size").count(), 0);
      assert.equal(await p.locator("#native-lintas-story").count(), 0);
      assert.equal(await p.locator("#native-hero-image").count(), 1);
      if (ids.length) {
        await p.locator("#native-card-tote-title").click();
        assert.equal(await p.locator("#native-detail-tote-image").count(), 0);
        assert.equal(
          await p.locator("#native-detail-tote-add button").isEnabled(),
          true,
        );
      } else
        assert.equal(
          await p.locator("#native-template-product-empty-title").innerText(),
          "Add your product",
        );
    }
  }
  const pack = await inspectPackage("lintas");
  assert(pack.bytes < 50_000_000);
  assert(
    pack.files.some((f) =>
      f.path.endsWith("lintas/preview/approved-recipe.json"),
    ),
  );
  assert(
    pack.files.some((f) => f.path.endsWith("lintas/design/hero-1536.webp")),
  );
});
