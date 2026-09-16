import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { Workspace } from "../workspace.mjs";

test("Templates start without products; connecting products preserves edits and publishing requires current stock", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "ezkart-template-draft-"));
  const ws = await new Workspace(dir).init();
  let products = [];
  const catalog = () =>
    writeFile(
      join(dir, "catalog.json"),
      JSON.stringify({ products, demoCheckout: true }),
    );
  await catalog();
  await ws.create({ id: "start", name: "Start" });
  await ws.start();
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  t.after(async () => {
    await browser.close();
    await ws.stop();
    await rm(dir, { recursive: true, force: true });
    assert.deepEqual(errors, []);
  });
  const call = (method, args = {}) =>
    page.evaluate(({ method, args }) => EzkartBuilder[method](args), {
      method,
      args,
    });
  await page.goto(ws.url + "/cart/admin/?page=sites&edit=start.ezkart.site");
  await page.waitForFunction(() => globalThis.EzkartBuilder);
  await page.locator("[data-open-page-creator]").first().click();
  const form = page.locator("[data-page-creator-form]");
  await form.locator("[name=page_name]").fill("Draft Takar");
  await form
    .locator(".sq-template-choice")
    .filter({ hasText: "Takar" })
    .click();
  assert.equal(await form.locator("[name=template_product]").count(), 0);
  await form.locator("[data-create-page]").click();
  await page.waitForURL("**edit=draft-takar.ezkart.site");
  await page.waitForFunction(() => globalThis.EzkartBuilder);
  await call("settle");
  assert.equal(
    (await call("nativeInspect", { id: "hero-image" })).type,
    "image",
  );
  assert.match(
    (await call("nativeInspect", { id: "hero-image" })).src,
    /takar\/design\//,
  );
  await call("nativeUpdate", {
    id: "hero-title",
    text: "My edited headline",
    props: { color: "#123456" },
  });
  await call("save");
  assert.deepEqual((await ws.read("draft-takar")).products, []);
  await assert.rejects(call("publish"), /Add one of your products/);
  assert.equal((await ws.read("draft-takar")).status, "draft");
  assert.equal(
    await page.locator("[data-template-page-products]").isVisible(),
    true,
  );

  products = [
    {
      id: "owned-one",
      name: "Actual first product",
      type: "physical",
      status: "active",
      stock: 0,
      price: 12000,
      variants: [],
    },
    {
      id: "owned-two",
      name: "Actual second product",
      type: "physical",
      status: "active",
      stock: 0,
      price: 18000,
      variants: [],
    },
  ];
  await catalog();
  await page.reload();
  await page.waitForFunction(() => globalThis.EzkartBuilder);
  await call("settle");
  await page.locator("[data-sq-tab=products]").click();
  await page.locator('[data-template-slot="0"]').selectOption("owned-one");
  await page.locator('[data-template-slot="1"]').selectOption("owned-two");
  await page.locator(".sq-template-product-form button").click();
  await page.waitForFunction(() => {
    try {
      return (
        EzkartBuilder.nativeInspect({ id: "card-tomat-add" }).productId ===
        "owned-two"
      );
    } catch {
      return false;
    }
  });
  assert.equal(
    (await call("nativeInspect", { id: "hero-title" })).text,
    "My edited headline",
  );
  assert.equal(
    (await call("nativeInspect", { id: "hero-title" })).props.color,
    "#123456",
  );
  assert.equal(
    (await call("nativeInspect", { id: "card-bawang-name" })).text,
    "Actual first product",
  );
  await call("save");
  await page.reload();
  await page.waitForFunction(() => globalThis.EzkartBuilder);
  await call("settle");
  assert.equal(
    (await call("nativeInspect", { id: "hero-title" })).text,
    "My edited headline",
  );
  await assert.rejects(call("publish"), /Add stock/);
  await assert.rejects(call("exportHtml"), /Add stock/);
  assert.equal((await ws.read("draft-takar")).status, "draft");

  // Stock changes after the editor loads must be rechecked, including visible variants.
  products[0].variants = [
    { id: "hidden", name: "Hidden", stock: 10, hidden: true },
    { id: "visible", name: "Visible", stock: 0 },
  ];
  await catalog();
  await assert.rejects(call("publish"), /Add stock/);
  await assert.rejects(call("exportHtml"), /Add stock/);
  products[0].variants[1].stock = 2;
  await catalog();
  assert.match(await call("exportHtml"), /<!doctype html>/i);
  assert.equal((await call("publish")).published, true);
  assert.equal((await ws.read("draft-takar")).status, "published");
  await call("connectTemplateProducts", { productIds: [] });
  assert.equal(
    (await call("nativeInspect", { id: "hero-title" })).text,
    "My edited headline",
  );
  await assert.rejects(call("publish"), /Add one of your products/);
  await call("undo");
  assert.equal(
    (await call("nativeInspect", { id: "card-bawang-add" })).productId,
    "owned-one",
  );
  await call("redo");
  assert.equal(
    (await call("nativeInspect", { id: "template-product-empty-title" })).text,
    "Add your product",
  );
  await call("save"); // A blocked publication must not prevent draft edits from saving.

  // The other templates also work with no selected products through the CLI path.
  for (const templateId of ["pith", "sela", "lintas"]) {
    await ws.create({ id: templateId, name: templateId });
    await page.goto(
      ws.url + `/cart/admin/?page=sites&edit=${templateId}.ezkart.site`,
    );
    await page.waitForFunction(() => globalThis.EzkartBuilder);
    await call("applyTemplate", {
      templateId,
      productIds: [],
      brandName: "My store",
    });
    await call("save");
    assert.deepEqual((await ws.read(templateId)).products, []);
    await assert.rejects(call("publish"), /Add one of your products/);
    await assert.rejects(
      call("exportHtml"),
      /before copying or exporting code/,
    );
    await page.locator("[data-native-id=template-product-choose]").click();
    assert.equal(
      await page.locator('[data-template-slot="0"]').isVisible(),
      true,
    );
    await call("connectTemplateProducts", { productIds: ["owned-one"] });
    assert.equal(
      (await call("nativeInspect"))
        .filter((n) => n.type === "commerce")
        .every((n) => !String(n.productId).startsWith("template-product-")),
      true,
    );
  }
});
