import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { Workspace, repoRoot } from "../workspace.mjs";

test("products can be placed and changed independently, including beside an existing collection", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ezkart-product-placement-")),
    ws = await new Workspace(dir).init();
  await writeFile(
    join(dir, "catalog.json"),
    JSON.stringify({
      products: [
        {
          id: "syrup",
          media: [{ id: "product-photo" }],
          name: "ZERO Syrup 50–550 ml — Better than ordinary syrup",
          type: "physical",
          price: 42000,
          stock: 10,
          weightGrams: 500,
          options: [
            { name: "Flavor", values: ["Plain original", "Vanilla bean"] },
            { name: "Size", values: ["250 ml", "550 ml"] },
          ],
          variants: [
            {
              id: "syrup-250",
              price: 42000,
              stock: 10,
              options: [
                { option: "Flavor", value: "Plain original" },
                { option: "Size", value: "250 ml" },
              ],
            },
            {
              id: "syrup-550",
              price: 80000,
              stock: 10,
              options: [
                { option: "Flavor", value: "Vanilla bean" },
                { option: "Size", value: "550 ml" },
              ],
            },
          ],
        },
        {
          id: "coffee",
          name: "Coffee beans",
          type: "physical",
          price: 95000,
          stock: 10,
          weightGrams: 250,
        },
      ],
    }),
  );
  await ws.create({
    id: "placement",
    name: "Product placement",
    productIds: ["syrup"],
  });
  await ws.start();
  const browser = await chromium.launch(),
    page = await browser.newPage({
      viewport: { width: 1600, height: 1100 },
      reducedMotion: "reduce",
    }),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.setDefaultTimeout(5000);
  await page.route(
    (url) => url.searchParams.get("cloud") === "/v1/media/product-photo",
    (route) =>
      route.fulfill({
        path: join(repoRoot, "cart/admin/assets/products/kopi-susu.webp"),
      }),
  );
  const invoke = (method, args = {}) =>
    page.evaluate(({ method, args }) => EzkartBuilder[method](args), {
      method,
      args,
    });
  try {
    await page.goto(
      ws.url + "/cart/admin/?page=sites&edit=placement.ezkart.site",
    );
    await page.waitForFunction(() => globalThis.EzkartBuilder);
    await invoke("addSection", {
      component: "product-collection",
      id: "collection",
    });
    const collection = page.locator(
      "[data-section-id=collection] [data-sq-product-grid]",
    );
    assert.equal(
      await collection.locator("[data-product-card]:visible").count(),
      1,
    );
    await page.locator("[data-sq-tab=products]").click();
    await page.locator("[data-sq-place-product=coffee]").click();
    assert.equal(
      await collection.locator("[data-product-card]:visible").count(),
      1,
      "A new product elsewhere does not change the existing collection",
    );
    assert.equal(
      await collection.locator("[data-product-card=syrup]").isVisible(),
      true,
    );
    let cards = (await invoke("nativeInspect")).filter(
      (n) => n.type === "product",
    );
    assert.equal(cards.length, 1);
    assert.equal(cards[0].productId, "coffee");
    const firstId = cards[0].id;
    const panel = page.locator("[data-sq-native-inspector]");
    assert.equal(
      await panel.locator("[data-native-product-controls]").isVisible(),
      true,
    );
    await panel.locator("[data-native-product-id]").selectOption("syrup");
    assert.equal(
      (await invoke("nativeInspect", { id: firstId })).productId,
      "syrup",
    );
    // The ordinary Add panel has one version of each basic element.
    await page.locator("[data-sq-tab=add]").click();
    const add = page.locator("[data-sq-panel=add]");
    assert.equal(
      await add.getByRole("button", { name: /^Heading / }).count(),
      1,
    );
    assert.equal(
      await add.locator("[data-sq-library-group=sections]").first().isVisible(),
      false,
    );
    await add.locator("[data-sq-block-search]").fill("blank");
    assert.equal(
      await add.locator("[data-sq-add-block=blank]").isVisible(),
      true,
      "Search reaches hidden categories",
    );
    await add.locator("[data-sq-add-block=blank]").click();
    await page.locator("[data-sq-tab=products]").click();
    await page.locator("[data-sq-place-product=coffee]").click();
    cards = (await invoke("nativeInspect")).filter((n) => n.type === "product");
    assert.deepEqual(
      cards.map((n) => n.productId),
      ["syrup", "coffee"],
    );
    assert.notEqual(
      cards[0].parent,
      cards[1].parent,
      "Cards can live in different areas",
    );
    const secondId = cards[1].id;
    await collection.locator("h3").first().click();
    await page
      .locator("[data-sq-block-product-list] input[value=coffee]")
      .check();
    await page
      .locator("[data-sq-block-product-list] input[value=syrup]")
      .uncheck();
    assert.equal(
      await collection.locator("[data-product-card=syrup]").isVisible(),
      false,
    );
    assert.equal(
      await collection.locator("[data-product-card=coffee]").isVisible(),
      true,
    );
    assert.deepEqual(
      (await invoke("nativeInspect"))
        .filter((n) => n.type === "product")
        .map((n) => n.productId),
      ["syrup", "coffee"],
      "Collection choices leave individual cards unchanged",
    );
    await invoke("undo");
    await invoke("undo");
    assert.equal(
      await collection.locator("[data-product-card=coffee]").isVisible(),
      false,
      "Undo restores this collection’s choices",
    );
    await invoke("nativeUpdate", { id: firstId, props: { width: "240px" } });
    await invoke("settle");
    const first = page.locator(`[data-native-id="${firstId}"]`);
    const geometry = await first.evaluate((n) => {
      const article = n.querySelector("article"),
        title = n.querySelector("h3"),
        price = n.querySelector("footer b"),
        button = n.querySelector("footer button");
      return {
        width: n.clientWidth,
        scroll: n.scrollWidth,
        titleScroll: title.scrollHeight,
        titleHeight: title.clientHeight,
        priceBottom: price.getBoundingClientRect().bottom,
        buttonTop: button.getBoundingClientRect().top,
        article: article.clientWidth,
        photoWidth: n.querySelector(".product-art img").clientWidth,
      };
    });
    assert.equal(geometry.width, 240);
    assert.equal(geometry.scroll, 240);
    assert.ok(geometry.photoWidth >= 230, "The photo fills the card width");
    assert.ok(
      geometry.titleScroll <= geometry.titleHeight + 1,
      "Product title is fully readable",
    );
    assert.ok(
      geometry.priceBottom <= geometry.buttonTop,
      "Price and purchase button stack in narrow cards",
    );
    await first.locator("h3").click();
    await first.locator("h3").click();
    assert.equal(
      await panel.locator("[data-native-product-id]").inputValue(),
      "syrup",
      "Repeated clicks keep the same product selected",
    );
    await panel.locator("[data-native-solid-color]").fill("#c8ffee");
    await panel.locator("[data-native-apply-fill]").click();
    assert.equal(
      await first.evaluate((n) => getComputedStyle(n).backgroundColor),
      "rgb(200, 255, 238)",
    );
    assert.equal(
      await panel.locator("[data-native-prop=backgroundColor]").count(),
      0,
      "One background editor owns the fill",
    );
    await invoke("save");
    await page.reload();
    await page.waitForFunction(() => globalThis.EzkartBuilder);
    cards = (await invoke("nativeInspect")).filter((n) => n.type === "product");
    assert.deepEqual(
      cards.map((n) => n.productId),
      ["syrup", "coffee"],
    );
    assert.equal(
      await page.locator("[data-sq-place-product=coffee]").count(),
      1,
      "Catalog Add controls survive reload",
    );
    assert.equal(
      await collection.locator("[data-product-card=coffee]").isVisible(),
      false,
    );
    const html = await invoke("exportHtml");
    await page.route("**/placement-export", (route) =>
      route.fulfill({ body: html, contentType: "text/html" }),
    );
    await page.goto(ws.url + "/placement-export");
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1100 });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth),
        width,
        `Export fits ${width}px`,
      );
      assert.equal(
        await page
          .locator(`[data-native-id="${firstId}"] [data-product-card=syrup]`)
          .isVisible(),
        true,
      );
      assert.equal(
        await page
          .locator(`[data-native-id="${secondId}"] [data-product-card=coffee]`)
          .isVisible(),
        true,
      );
    }
    await page
      .locator(`[data-native-id="${secondId}"] [data-ezkart-add=coffee]`)
      .click();
    assert.match(
      await page.locator(".ezkart-cart-items").textContent(),
      /Coffee beans/,
    );
    assert.doesNotMatch(
      await page.locator(".ezkart-cart-items").textContent(),
      /ZERO Syrup/,
    );
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await ws.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

test("background overrides clear gradients and preserve readable text across screen sizes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ezkart-background-context-")),
    ws = await new Workspace(dir).init();
  await ws.create({ id: "colors", name: "Colors" });
  await ws.start();
  const browser = await chromium.launch(),
    page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const invoke = (method, args = {}) =>
    page.evaluate(({ method, args }) => EzkartBuilder[method](args), {
      method,
      args,
    });
  try {
    await page.goto(ws.url + "/cart/admin/?page=sites&edit=colors.ezkart.site");
    await page.waitForFunction(() => globalThis.EzkartBuilder);
    await invoke("updateSection", {
      id: "blank",
      background: "#e2f4ff",
      spacing: { top: 24, right: 24, bottom: 24, left: 24 },
    });
    await page.locator("[data-sq-tab=add]").click();
    await page.locator("[data-sq-add-element=native-heading]").click();
    const section = page.locator("[data-sq-block][data-section-id=blank]");
    assert.equal(
      await section.evaluate((n) => getComputedStyle(n).backgroundColor),
      "rgb(226, 244, 255)",
      "Adding the first element preserves the section background",
    );
    assert.equal(
      await section.evaluate((n) => getComputedStyle(n).paddingTop),
      "24px",
    );
    await invoke("undo");
    await invoke("updateSection", {
      id: "blank",
      gradient: { kind: "linear", from: "#ff0000", to: "#0000ff", angle: 90 },
    });
    await invoke("nativeInsert", {
      section: "blank",
      node: {
        id: "heading",
        type: "heading",
        text: "Readable on every screen",
        props: { color: "#123456", fontSize: "32px" },
        fill: {
          clip: "text",
          layers: [
            {
              kind: "linear",
              angle: 90,
              stops: [
                { color: "#ff0000", position: 0 },
                { color: "#0000ff", position: 100 },
              ],
            },
          ],
        },
        responsive: [
          {
            max: 700,
            props: { backgroundColor: "#c8ffee" },
            fill: { clip: "background", layers: [] },
          },
        ],
      },
    });
    assert.match(
      await section.evaluate((n) => getComputedStyle(n).backgroundImage),
      /linear-gradient\(90deg/,
      "The section gradient survives its first element too",
    );
    await page.locator("[data-native-id=heading]").click();
    await page.locator("[data-native-id=heading]").click();
    const panel = page.locator("[data-sq-native-inspector]");
    assert.equal(
      await panel.locator("[data-native-text]").inputValue(),
      "Readable on every screen",
    );
    await panel.locator("[data-native-fill-type]").selectOption("solid");
    await panel.locator("[data-native-solid-color]").fill("#fbe7cf");
    await panel.locator("[data-native-apply-fill]").click();
    const heading = page.locator("[data-native-id=heading]");
    assert.equal(
      await heading.evaluate((n) => getComputedStyle(n).backgroundImage),
      "none",
    );
    assert.equal(
      await heading.evaluate((n) => getComputedStyle(n).color),
      "rgb(18, 52, 86)",
    );
    await invoke("undo");
    const html = await invoke("exportHtml");
    await page.route("**/colors-export", (r) =>
      r.fulfill({ body: html, contentType: "text/html" }),
    );
    await page.goto(ws.url + "/colors-export");
    await page.setViewportSize({ width: 390, height: 900 });
    assert.equal(
      await heading.evaluate((n) => getComputedStyle(n).backgroundImage),
      "none",
    );
    assert.equal(
      await heading.evaluate((n) => getComputedStyle(n).backgroundColor),
      "rgb(200, 255, 238)",
    );
    assert.equal(
      await heading.evaluate((n) => getComputedStyle(n).color),
      "rgb(18, 52, 86)",
      "Responsive fill does not inherit transparent text from the desktop gradient",
    );
  } finally {
    await browser.close();
    await ws.stop();
    await rm(dir, { recursive: true, force: true });
  }
});
