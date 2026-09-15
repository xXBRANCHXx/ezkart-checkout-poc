import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { Workspace } from "../workspace.mjs";

const product = {
  id: "merchant-product",
  name: "A merchant product with a long name and several distinct options",
  description:
    "<p>Actual catalog description.</p><p>Useful product details.</p>",
  status: "active",
  type: "physical",
  price: 13500,
  stock: 100,
  media: [{ id: "photo-one" }, { id: "photo-two" }, { id: "photo-three" }],
  variants: Array.from({ length: 8 }, (_, i) => ({
    id: `variant-${i}`,
    name: `Option ${i + 1}`,
    price: 12500 + i * 1000,
    stock: i === 7 ? 0 : 10,
  })),
};
async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), "ezkart-templates-"));
  const ws = await new Workspace(dir).init();
  await writeFile(
    join(dir, "catalog.json"),
    JSON.stringify({
      products: [
        product,
        {
          id: "sparse",
          name: "AnUnbrokenProductNameThatMustWrapWithoutClippingOrHidingThePurchaseAction",
          price: 19.5,
          type: "physical",
          stock: 0,
          status: "active",
          media: [],
          description: "",
        },
      ],
      storageScope: "template-tests",
      mediaBase: "https://template-media.example.test",
      demoCheckout: true,
    }),
  );
  await ws.create({ id: "source", name: "Existing page" });
  await ws.start();
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
    reducedMotion: "reduce",
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/v1/public/media/**", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="#e0e1dd"/><rect x="210" y="150" width="180" height="500" rx="20" fill="#fff"/></svg>',
    }),
  );
  t.after(async () => {
    await browser.close();
    await ws.stop();
    await rm(dir, { recursive: true, force: true });
    assert.deepEqual(errors, []);
  });
  const invoke = (method, args = {}) =>
    page.evaluate(({ method, args }) => EzkartBuilder[method](args), {
      method,
      args,
    });
  const open = async (id = "source") => {
    await page.goto(`${ws.url}/cart/admin/?page=sites&edit=${id}.ezkart.site`);
    await page.waitForFunction(() => globalThis.EzkartBuilder);
    await invoke("settle");
  };
  await open();
  return { ws, page, invoke, open };
}
test("New page applies PITH with merchant content, preserves the original page, and remains editable after save/reopen", async (t) => {
  const { ws, page, invoke, open } = await setup(t);
  await invoke("nativeInsert", {
    section: "blank",
    node: {
      id: "blank",
      type: "container",
      name: "Original",
      children: [
        { id: "original-title", type: "heading", text: "Keep this page" },
      ],
    },
  });
  await invoke("save");
  const original = await ws.read("source");
  await page.locator("[data-open-page-creator]").first().click();
  const form = page.locator("[data-page-creator-form]");
  await form.locator("[name=page_name]").fill("Merchant launch");
  await form.locator(".sq-template-choice").filter({ hasText: "PITH" }).click();
  await form.locator("[name=template_brand]").fill("Merchant Studio");
  await form.locator("[name=template_product]").selectOption(product.id);
  await form.locator("[data-template-preview]").click();
  await page.locator(".sq-template-preview").waitFor();
  await page.keyboard.press("Escape");
  assert.equal(
    await form
      .locator("[data-template-preview]")
      .evaluate((n) => n === document.activeElement),
    true,
  );
  await form.locator("[data-create-page]").click();
  await page
    .waitForURL("**edit=merchant-launch.ezkart.site", { timeout: 5000 })
    .catch(async (e) => {
      console.log(
        "Page creation failed:",
        await page.locator(".toast").allTextContents(),
        await form.evaluate((n) => [
          n.checkValidity(),
          ...Array.from(n.elements)
            .filter((e) => e.willValidate && !e.validity.valid)
            .map((e) => [e.name, e.validationMessage]),
        ]),
        page.url(),
      );
      throw e;
    });
  await invoke("settle");
  assert.equal(
    (await invoke("nativeInspect", { id: "hero-headline" })).text,
    product.name,
  );
  assert.equal(
    (await invoke("nativeInspect", { id: "brand-wordmark" })).text,
    "Merchant Studio",
  );
  assert.equal(
    (await invoke("nativeInspect", { id: "story-first" })).text,
    "Actual catalog description.\nUseful product details.",
  );
  const originalAfter = await ws.read("source");
  assert.equal(originalAfter.state.preview, original.state.preview);
  const heading = page.locator("[data-native-id=hero-headline]");
  await heading.click();
  const text = page.locator("[data-sq-native-inspector] [data-native-text]");
  await text.fill("Edited through the sidebar");
  await text.dispatchEvent("change");
  assert.equal(
    (await invoke("nativeInspect", { id: "hero-headline" })).text,
    "Edited through the sidebar",
  );
  await invoke("undo");
  await invoke("nativeUpdate", {
    id: "story",
    props: { backgroundColor: "#e4eee8" },
  });
  await invoke("undo");
  await invoke("save");
  await open("merchant-launch");
  assert.equal(
    (await invoke("nativeInspect", { id: "hero-headline" })).text,
    product.name,
  );
  const html = await invoke("exportHtml");
  assert.doesNotMatch(
    html,
    /pith-dry|Take a Thip|grapefruit-1000|Six 250 ml|6 × 250 ml|127\.0\.0\.1:46322/i,
  );
  await page.route("**/template-export", (r) =>
    r.fulfill({ contentType: "text/html", body: html }),
  );
  await page.goto(ws.url + "/template-export");
  for (const width of [320, 390, 480, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => document.fonts.ready);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      `No page overflow at ${width}`,
    );
    assert.equal(await page.locator("h1").count(), 1);
    assert.equal(
      await page.locator("[data-native-id=hero-add] button").isVisible(),
      true,
    );
  }
  await page.setViewportSize({ width: 390, height: 900 });
  await page.evaluate(() => scrollTo(0, 0));
  await page.locator("[data-native-id=nav-menu]").click();
  await page.locator("[data-native-id=mobile-shop]").click();
  assert.equal(
    await page.locator("[data-native-id=mobile-menu]").isVisible(),
    false,
  );
  const choices = page.locator("[data-native-id=hero-flavor] select");
  assert.equal(await choices.locator("option").count(), 8);
  await choices.selectOption("variant-3");
  assert.match(
    await page.locator("[data-native-id=hero-price]").innerText(),
    /15[.,]500/,
  );
  assert.equal(
    await page.locator("[data-native-id=shop-flavors] select").inputValue(),
    "variant-3",
  );
  await page.locator("[data-native-id=hero-add] button").click();
  assert.match(
    await page.locator("[data-ezkart-cart-items]").innerText(),
    /Option 4/,
  );
  await page.keyboard.press("Escape");
  await choices.selectOption("variant-7");
  assert.equal(
    await page.locator("[data-native-id=hero-add] button").isDisabled(),
    true,
  );
  assert.equal(
    await page.locator("[data-native-id=shop-add] button").isDisabled(),
    true,
  );
});
test("CLI template application handles sparse products, rejects invalid bindings without mutation, and supports undo", async (t) => {
  const { page, invoke } = await setup(t);
  assert.equal((await invoke("templates"))[0].id, "pith");
  await assert.rejects(
    invoke("applyTemplate", {
      templateId: "pith",
      productId: "unknown",
      brandName: "Store",
    }),
    /catalog/,
  );
  assert.equal((await invoke("nativeInspect")).length, 0);
  await invoke("applyTemplate", {
    templateId: "pith",
    productId: "sparse",
    brandName: "A very long merchant store name",
  });
  assert.equal(
    (await invoke("nativeInspect")).some((n) => n.id === "story"),
    false,
  );
  await assert.rejects(
    invoke("applyTemplate", {
      templateId: "pith",
      productId: "sparse",
      brandName: "Store",
    }),
    /blank page/,
  );
  await invoke("undo");
  assert.equal((await invoke("nativeInspect")).length, 0);
  await invoke("redo");
  const html = await invoke("exportHtml");
  await page.route("**/sparse-export", (r) =>
    r.fulfill({ contentType: "text/html", body: html }),
  );
  await page.goto(new URL(page.url()).origin + "/sparse-export");
  for (const width of [320, 390, 768, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      `Sparse product wraps at ${width}`,
    );
  }
  assert.equal(await page.locator("img").count(), 0);
  assert.equal(
    await page.locator("[data-native-id=hero-add] button").isDisabled(),
    true,
  );
  const dead = await page
    .locator('a[href^="#"]')
    .evaluateAll((nodes) =>
      nodes
        .map((n) => n.getAttribute("href"))
        .filter((h) => h.length > 1 && !document.getElementById(h.slice(1))),
    );
  assert.deepEqual(dead, []);
});
test("Library creates a template page with the same native mechanism", async (t) => {
  const { ws, page } = await setup(t);
  await page.goto(ws.url + "/cart/admin/?page=sites");
  await page.locator("[data-library-create-card]").first().click();
  const form = page.locator("[data-library-page-form]");
  await form.locator("[name=page_name]").fill("Library launch");
  await form.locator(".sq-template-choice").filter({ hasText: "PITH" }).click();
  await form.locator("[name=template_brand]").fill("Merchant");
  await form.locator("[name=template_product]").selectOption("sparse");
  await form.locator("button[value=default]").click();
  await page.waitForURL("**edit=library-launch.ezkart.site");
  await page.waitForFunction(() => globalThis.EzkartBuilder);
  assert.equal(
    await page.locator("[data-native-id=hero-headline]").textContent(),
    "AnUnbrokenProductNameThatMustWrapWithoutClippingOrHidingThePurchaseAction",
  );
  assert.equal((await ws.read("library-launch")).products[0], "sparse");
});

test("Local library previews persist and show the actual applied design", async (t) => {
  const { ws, invoke, page } = await setup(t);
  await invoke("applyTemplate", {
    templateId: "pith",
    productId: "sparse",
    brandName: "Merchant",
  });
  await invoke("save");
  await page.waitForResponse(
    (response) =>
      response.request().method() === "PUT" &&
      response.url().includes("preview"),
  );
  const saved = await ws.read("source");
  assert.equal(saved.previewVersion, "2");
  const response = await fetch(
    ws.url +
      "/cart/admin/?cloud=" +
      encodeURIComponent("/v1/landing-pages/source/preview"),
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/html/);
  assert.match(await response.text(), /AnUnbrokenProductName/);
});
