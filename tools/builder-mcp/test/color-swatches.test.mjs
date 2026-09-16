import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { Workspace } from "../workspace.mjs";

test("color swatches support keyboard selection, stock, independent products, and editable persistent colors", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ezkart-swatches-"));
  const products = [
    {
      id: "towel",
      name: "Towel",
      type: "physical",
      currency: "IDR",
      price: 79000,
      stock: 8,
      variants: [
        { id: "peach", name: "Peach", price: 79000, stock: 8 },
        { id: "sage", name: "Sage", price: 89000, stock: 4 },
        { id: "cream", name: "Cream", price: 90000, stock: 0 },
      ],
    },
    {
      id: "other",
      name: "Other product",
      type: "physical",
      currency: "IDR",
      price: 45000,
      stock: 5,
    },
  ];
  await writeFile(
    join(dir, "catalog.json"),
    JSON.stringify({
      products,
      demoCheckout: true,
      currency: "IDR",
      locale: "id-ID",
    }),
  );
  const ws = await new Workspace(dir).init();
  await ws.create({
    id: "swatches",
    name: "Swatches",
    productIds: ["towel", "other"],
  });
  await ws.start();
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const call = (method, args = {}) =>
    page.evaluate(({ method, args }) => EzkartBuilder[method](args), {
      method,
      args,
    });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto(
      ws.url + "/cart/admin/?page=sites&edit=swatches.ezkart.site",
    );
    await page.waitForFunction(() => globalThis.EzkartBuilder);
    const control = (id, part, productId = "towel") => ({
      id,
      type: "commerce",
      part,
      productId,
      group: "shop",
      props: { width: "100%", fontSize: "14px" },
    });
    await call("nativeInsert", {
      section: "blank",
      node: {
        id: "layout",
        type: "container",
        props: {
          display: "grid",
          gap: "16px",
          paddingLeft: "24px",
          paddingRight: "24px",
        },
        children: [
          {
            ...control("choices", "options"),
            optionLayout: "swatches",
            label: "Towel color",
            variantColors: {
              peach: "#dda385",
              sage: "#a5b19a",
              cream: "#eeeecc",
            },
          },
          control("price", "price"),
          control("buy", "add"),
          control("other-price", "price", "other"),
        ],
      },
    });
    await assert.rejects(
      () =>
        call("nativeUpdate", {
          id: "choices",
          variantColors: { peach: "url(javascript:alert(1))" },
        }),
      /six-digit hex/,
    );
    await page.locator("[data-native-id=choices]").click();
    const panel = page.locator("[data-sq-native-inspector]");
    assert.equal(
      await panel.locator("[data-commerce-setting=optionLayout]").inputValue(),
      "swatches",
    );
    const color = panel.getByLabel("Peach swatch color", { exact: true });
    await color.fill("#dd9988");
    await color.dispatchEvent("change");
    assert.equal(
      (await call("nativeInspect", { id: "choices" })).variantColors.peach,
      "#dd9988",
    );
    await call("undo");
    assert.equal(
      (await call("nativeInspect", { id: "choices" })).variantColors.peach,
      "#dda385",
    );
    await call("redo");
    await call("save");
    await page.reload();
    await page.waitForFunction(() => globalThis.EzkartBuilder);
    assert.equal(
      (await call("nativeInspect", { id: "choices" })).variantColors.peach,
      "#dd9988",
    );
    const html = await call("previewHtml");
    const preview = await browser.newPage({
      viewport: { width: 390, height: 900 },
    });
    preview.on("pageerror", (e) => errors.push(e.message));
    await preview.route("http://swatches.test/", (r) =>
      r.fulfill({ body: html, contentType: "text/html" }),
    );
    await preview.goto("http://swatches.test/");
    const peach = preview.getByRole("radio", { name: "Peach", exact: true });
    await peach.focus();
    await preview.keyboard.press("ArrowRight");
    assert.equal(
      await preview
        .getByRole("radio", { name: "Sage", exact: true })
        .isChecked(),
      true,
    );
    assert.equal(
      await preview
        .locator("#native-choices .sq-native-commerce-selection")
        .innerText(),
      "Sage",
    );
    assert.equal(
      await preview.locator("#native-price").innerText(),
      "Rp89.000",
    );
    assert.equal(
      await preview.locator("#native-other-price").innerText(),
      "Rp45.000",
    );
    await preview.locator("#native-buy button").click();
    assert.match(await preview.locator(".ezkart-cart-row").innerText(), /Sage/);
    await preview.keyboard.press("Escape");
    await preview.getByRole("radio", { name: "Sage", exact: true }).focus();
    await preview.keyboard.press("ArrowRight");
    assert.equal(
      await preview.locator("#native-buy button").isDisabled(),
      true,
    );
    assert.equal(
      await preview
        .locator("#native-choices .sq-native-commerce-selection")
        .innerText(),
      "Cream — Sold out",
    );
    assert.equal(
      await preview
        .getByRole("radio", { name: "Cream — Sold out", exact: true })
        .isChecked(),
      true,
    );
    assert.ok(
      await preview
        .locator("[data-layout=swatches] label")
        .evaluateAll((ns) =>
          ns.every(
            (n) =>
              n.getBoundingClientRect().width >= 44 &&
              n.getBoundingClientRect().height >= 44,
          ),
        ),
    );
    assert.ok(
      await preview
        .locator("html")
        .evaluate((n) => n.scrollWidth <= innerWidth),
    );
    await page.locator("[data-native-id=choices]").click();
    await panel
      .locator("[data-native-variant-colors] label")
      .first()
      .getByRole("button", { name: "Use name" })
      .click();
    assert.equal(
      (await call("nativeInspect", { id: "choices" })).variantColors.peach,
      undefined,
    );
    assert.equal(
      await page.locator("[data-native-id=choices] strong").first().innerText(),
      "Peach",
    );
    await panel.locator("[data-native-product-id]").selectOption("other");
    assert.equal(
      (await call("nativeInspect", { id: "choices" })).variantColors,
      undefined,
    );
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await ws.stop();
    await rm(dir, { recursive: true, force: true });
  }
});
