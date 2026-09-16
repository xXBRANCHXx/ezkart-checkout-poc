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
test("Rona starts empty, preserves edits, adapts real catalog products and exports no fictional claims", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "ezkart-rona-")),
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
  await ws.create({ id: "rona", name: "Rona" });
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
  const edit = async (id = "rona") => {
    await p.goto(
      ws.url + "/cart/admin/?page=sites&edit=" + id + ".ezkart.site",
    );
    await p.waitForFunction(() => globalThis.EzkartBuilder);
    await call("settle");
  };
  await edit();
  await call("applyTemplate", {
    templateId: "rona",
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
  await p.locator("[data-native-id=template-product-choose]").click();
  await p.locator('[data-template-slot="0"]').waitFor({ state: "visible" });
  await call("nativeUpdate", {
    id: "hero-title",
    text: "My own headline",
    props: { color: "#123456" },
  });
  await call("save");
  await call("connectTemplateProducts", { productIds: ["p1", "p2", "p3"] });
  await call("save");
  await edit();
  assert.equal(
    (await call("nativeInspect", { id: "hero-title" })).text,
    "My own headline",
  );
  assert.equal(
    (await call("nativeInspect", { id: "hero-title" })).props.color,
    "#123456",
  );
  let html = await call("exportHtml");
  assert.doesNotMatch(
    html,
    /Handuk Mandi|Handuk Tangan|Set Berdua|70 × 140|500 gsm|100% katun|Checkout simulasi|pembelian adalah simulasi|Your demo cart|Complete demo checkout/,
  );
  assert.match(html, /Review cart/);
  await p.route("**/merchant-export*", (r) =>
    r.fulfill({ body: html, contentType: "text/html" }),
  );
  await p.goto(ws.url + "/merchant-export");
  for (const width of [320, 390, 620, 768, 1024, 1440, 1920]) {
    await p.setViewportSize({ width, height: 1000 });
    assert.equal(
      await p.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      "Layout at " + width,
    );
  }
  assert.equal(await p.locator("#native-card-hand-photo").count(), 0);
  await p.locator("#native-card-bath-options select").selectOption("v1");
  assert.match(await p.locator("#native-card-bath-price").innerText(), /20.50/);
  await p.locator("#native-card-hand-options input[value=p2-large]").check();
  assert.match(await p.locator("#native-card-hand-price").innerText(), /25.75/);
  assert.match(await p.locator("#native-card-bath-price").innerText(), /20.50/);
  assert.equal(
    await p.locator("#native-card-set-add button").isDisabled(),
    true,
  );
  await p.locator("#native-card-hand-add button").click();
  assert.match(
    await p.locator("[data-ezkart-cart-items]").innerText(),
    /Large/,
  );
  await p.keyboard.press("Escape");
  await p.locator("#native-size-tab-hand").click();
  assert.equal(await p.locator("#native-size-panel-hand").isVisible(), true);
  for (const ids of [["p2"], ["p1", "p2"], []]) {
    const id = "count-" + ids.length;
    await ws.create({ id, name: id });
    await edit(id);
    await call("applyTemplate", {
      templateId: "rona",
      productIds: ids,
      brandName:
        "AReallyLongUnbrokenMerchantNameThatNeedsToWrapOnSmallScreensWithoutClipping",
    });
    const count = (await call("nativeInspect")).length;
    await call("undo");
    assert.equal((await call("nativeInspect")).length, 0);
    await call("redo");
    assert.equal((await call("nativeInspect")).length, count);
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
      assert.equal(
        await p.locator("[data-native-id=rona-size-guide]").count(),
        0,
      );
      assert.equal(
        await p.locator("[data-native-id=rona-material]").count(),
        0,
      );
    }
  }
  const pack = await inspectPackage("rona");
  assert(pack.bytes < 50_000_000);
  assert(
    pack.files.some((f) =>
      f.path.endsWith("rona/preview/approved-recipe.json"),
    ),
  );
});
