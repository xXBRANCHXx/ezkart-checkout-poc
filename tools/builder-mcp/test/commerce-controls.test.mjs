import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { Workspace } from "../workspace.mjs";

test("separate product controls share variants, preserve independent products, and survive inspector edits, undo, reopen and export", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ezkart-commerce-"));
  const products = [
    {
      id: "soda",
      name: "Demo soda",
      description: "A six-pack",
      type: "physical",
      currency: "USD",
      price: 24,
      stock: 12,
      variants: [
        { id: "citrus", name: "Citrus", price: 24, stock: 12 },
        { id: "orange", name: "Orange", price: 26, stock: 12 },
        { id: "empty", name: "Sold-out flavor", price: 28, stock: 0 },
      ],
    },
    {
      id: "tea",
      name: "A different product with a long name",
      type: "physical",
      price: 45000,
      currency: "IDR",
      stock: 5,
    },
  ];
  await writeFile(
    join(directory, "catalog.json"),
    JSON.stringify({
      products,
      currency: "USD",
      locale: "en-US",
      demoCheckout: true,
    }),
  );
  const ws = await new Workspace(directory).init();
  await ws.create({
    id: "controls",
    name: "Product controls",
    productIds: ["soda", "tea"],
  });
  await ws.start();
  const browser = await chromium.launch(),
    page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const invoke = (method, args = {}) =>
    page.evaluate(({ method, args }) => EzkartBuilder[method](args), {
      method,
      args,
    });
  try {
    const url = ws.url + "/cart/admin/?page=sites&edit=controls.ezkart.site";
    await page.goto(url);
    await page.waitForFunction(() => globalThis.EzkartBuilder);
    const node = (id, part, group = "shared", productId = "soda") => ({
      id,
      type: "commerce",
      part,
      group,
      productId,
      props: { fontSize: "16px", width: "100%" },
      label: part === "add" ? "Add a pack" : undefined,
    });
    await invoke("nativeInsert", {
      section: "blank",
      node: {
        id: "layout",
        type: "container",
        props: {
          display: "grid",
          gap: "20px",
          paddingLeft: "24px",
          paddingRight: "24px",
        },
        children: [
          node("options", "options"),
          node("price", "price"),
          node("repeated", "options"),
          node("buy", "add"),
          node("independent", "price", "independent"),
          node("other", "title", "shared", "tea"),
        ],
      },
    });
    await page.locator("[data-native-id=price]").click();
    const panel = page.locator("[data-sq-native-inspector]");
    await panel.locator("[data-commerce-setting=prefix]").fill("Pack: ");
    await panel
      .locator("[data-commerce-setting=prefix]")
      .dispatchEvent("change");
    assert.equal(
      (await invoke("nativeInspect", { id: "price" })).prefix,
      "Pack: ",
    );
    await invoke("undo");
    assert.equal(
      (await invoke("nativeInspect", { id: "price" })).prefix,
      undefined,
    );
    await invoke("redo");
    await invoke("nativeUpdate", { id: "price", suffix: " USD" });
    await invoke("save");
    await page.reload();
    await page.waitForFunction(() => globalThis.EzkartBuilder);
    assert.equal(
      (await invoke("nativeInspect", { id: "price" })).suffix,
      " USD",
    );
    const html = await invoke("previewHtml");
    assert.ok(!html.includes('"digitalFile"'));
    const preview = await browser.newPage({
      viewport: { width: 390, height: 900 },
      reducedMotion: "reduce",
    });
    preview.on("pageerror", (e) => errors.push(e.message));
    await preview.route("http://storefront.test/", (route) =>
      route.fulfill({ body: html, contentType: "text/html" }),
    );
    await preview.goto("http://storefront.test/");
    await preview.locator("#native-options input[value=orange]").check();
    assert.equal(
      await preview.locator("#native-price").innerText(),
      "Pack: $26 USD",
    );
    assert.equal(
      await preview.locator("#native-repeated input[value=orange]").isChecked(),
      true,
    );
    assert.equal(
      await preview.locator("#native-independent").innerText(),
      "$24",
    );
    assert.match(
      await preview.locator("#native-other").innerText(),
      /different product/,
    );
    await preview.locator("#native-buy button").click();
    assert.match(
      await preview.locator(".ezkart-cart-row").innerText(),
      /Orange/,
    );
    assert.equal(
      await preview.locator("[data-ezkart-cart-subtotal]").innerText(),
      "$26",
    );
    await preview.locator("[data-ezkart-cart-go]").click();
    assert.match(
      await preview.locator("[data-ezkart-cart-items]").innerText(),
      /No order was placed/,
    );
    await preview.keyboard.press("Escape");
    await preview
      .locator("[data-ezkart-cart-layer]")
      .waitFor({ state: "hidden" });
    await preview.locator("#native-options input[value=empty]").check();
    assert.equal(
      await preview.locator("#native-buy button").isDisabled(),
      true,
    );
    assert.equal(
      await preview.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await ws.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test("native sticky navigation remains clickable above later sections and conditional fixed bars really hide", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ezkart-native-sticky-"));
  const ws = await new Workspace(directory).init();
  await ws.create({ id: "sticky", name: "Native sticky controls" });
  await ws.start();
  const browser = await chromium.launch(),
    page = await browser.newPage({
      viewport: { width: 1500, height: 1000 },
      reducedMotion: "reduce",
    });
  const invoke = (method, args = {}) =>
    page.evaluate(({ method, args }) => EzkartBuilder[method](args), {
      method,
      args,
    });
  try {
    await page.goto(ws.url + "/cart/admin/?page=sites&edit=sticky.ezkart.site");
    await page.waitForFunction(() => globalThis.EzkartBuilder);
    const nodes = [
      {
        id: "navigation",
        type: "container",
        props: {
          position: "sticky",
          top: "0px",
          zIndex: "100",
          height: "70px",
          backgroundColor: "#eee",
        },
        children: [
          {
            id: "navigation-link",
            type: "button",
            tag: "a",
            text: "Questions",
            action: { type: "link", target: "#native-story" },
            props: { display: "block", height: "70px", width: "200px" },
          },
        ],
      },
      {
        id: "hero",
        type: "container",
        props: { height: "1000px", backgroundColor: "#fdd" },
      },
      {
        id: "story",
        type: "container",
        props: { height: "1500px", backgroundColor: "#ddd" },
      },
      {
        id: "bar",
        type: "container",
        props: {
          position: "fixed",
          bottom: "0px",
          top: "auto",
          left: "0px",
          right: "0px",
          display: "block",
          height: "64px",
          width: "100%",
          backgroundColor: "#333",
          color: "#fff",
          marginTop: "0px",
          marginBottom: "0px",
          marginLeft: "0px",
          marginRight: "0px",
        },
        scrollVisibility: { after: "hero", hideWhile: [] },
        children: [{ id: "bar-copy", type: "text", text: "Purchase controls" }],
      },
    ];
    for (const node of nodes) {
      await invoke("addSection", { component: "blank", id: node.id });
      await invoke("nativeInsert", { section: node.id, node });
    }
    await invoke("removeSection", { id: "blank" });
    await invoke("updateSection", { id: "story", background: "#ffffff" });
    assert.equal(
      await page
        .locator("#native-story")
        .evaluate((n) => getComputedStyle(n).backgroundColor),
      "rgb(255, 255, 255)",
    );
    assert.equal(
      (await invoke("nativeInspect", { id: "story" })).props.backgroundColor,
      "#ffffff",
    );
    await invoke("undo");
    assert.equal(
      (await invoke("nativeInspect", { id: "story" })).props.backgroundColor,
      "#ddd",
    );
    await invoke("updateSection", {
      id: "story",
      gradient: { kind: "linear", from: "#ff0000", to: "#0000ff", angle: 90 },
    });
    assert.equal(
      (await invoke("nativeInspect", { id: "story" })).fill.layers.length,
      1,
    );
    await invoke("undo");
    const html = await invoke("previewHtml");
    await page.route("**/sticky-export", (r) =>
      r.fulfill({ body: html, contentType: "text/html" }),
    );
    await page.setViewportSize({ width: 390, height: 1000 });
    await page.goto(ws.url + "/sticky-export");
    assert.equal(await page.locator("#native-bar").isVisible(), false);
    await page.evaluate(() => scrollTo({ top: 1200, behavior: "instant" }));
    await page.waitForFunction(() =>
      document.querySelector("#native-bar").matches(":popover-open"),
    );
    assert.equal(
      await page.evaluate(() =>
        Boolean(
          document.elementFromPoint(50, 35)?.closest("#native-navigation"),
        ),
      ),
      true,
    );
    const bar = await page.locator("#native-bar").boundingBox();
    assert.ok(bar.y >= 0 && bar.y + bar.height <= 1000);
    await page.evaluate(() => {
      document.body.classList.add("ezkart-cart-open");
      document.dispatchEvent(new Event("ezkart:cart-visibility"));
    });
    await page.locator("#native-bar").waitFor({ state: "hidden" });
    await page.evaluate(() => {
      document.body.classList.remove("ezkart-cart-open");
      scrollTo({ top: 0, behavior: "instant" });
      document.dispatchEvent(new Event("ezkart:cart-visibility"));
    });
    assert.equal(await page.locator("#native-bar").isVisible(), false);
  } finally {
    await browser.close();
    await ws.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
