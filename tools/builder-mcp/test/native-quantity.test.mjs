import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { Workspace } from "../workspace.mjs";

test("native quantities follow product groups and variants, clamp stock, retain focus, and add exact quantities through the shared cart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ezkart-quantities-"));
  await writeFile(
    join(directory, "catalog.json"),
    JSON.stringify({
      demoCheckout: true,
      currency: "IDR",
      products: [
        {
          id: "lamp",
          name: "Lamp",
          type: "physical",
          price: 100000,
          stock: 12,
          variants: [
            { id: "basic", name: "Basic", price: 100000, stock: 5 },
            { id: "dock", name: "Dock", price: 125000, stock: 2 },
            { id: "empty", name: "Sold out", price: 150000, stock: 0 },
          ],
        },
      ],
    }),
  );
  const ws = await new Workspace(directory).init();
  await ws.create({ id: "quantity", name: "Quantities", productIds: ["lamp"] });
  await ws.start();
  const b = await chromium.launch(),
    p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  const url = ws.url + "/cart/admin/?page=sites&edit=quantity.ezkart.site";
  const call = (method, args = {}) =>
    p.evaluate(({ method, args }) => EzkartBuilder[method](args), {
      method,
      args,
    });
  const bound = (id, part, group = "shared") => ({
    id,
    type: "commerce",
    productId: "lamp",
    group,
    part,
    optionLayout: "cards",
    label:
      part === "availability"
        ? "Ready to ship"
        : part === "quantity"
          ? "How many lamps"
          : "Choose a package",
    props: {
      fontFamily: "Manrope, Arial, sans-serif",
      color: "#172a3c",
      maxWidth: "400px",
      marginBottom: "15px",
    },
  });
  try {
    await p.goto(url);
    await p.waitForFunction(() => globalThis.EzkartBuilder);
    for (const [id, part, group] of [
      ["options", "options"],
      ["count", "quantity"],
      ["mirror", "quantity"],
      ["stock", "availability"],
      ["buy", "add"],
      ["independent", "quantity", "independent"],
    ])
      await call("nativeInsert", {
        section: "blank",
        node: bound(id, part, group),
      });
    await p.locator("#native-count").click();
    const field = p.locator('[data-commerce-setting="part"]');
    await field.evaluate((el) => {
      for (let n = el.parentElement; n; n = n.parentElement)
        if (n.tagName === "DETAILS") n.open = true;
    });
    assert.equal(await field.inputValue(), "quantity");
    await field.selectOption("availability", { force: true });
    assert.equal(
      (await call("nativeInspect")).find((n) => n.id === "count").part,
      "availability",
    );
    await call("undo");
    assert.equal(
      (await call("nativeInspect")).find((n) => n.id === "count").part,
      "quantity",
    );
    await call("save");
    await p.reload();
    await p.waitForFunction(() => globalThis.EzkartBuilder);
    assert.equal(
      (await call("nativeInspect")).find((n) => n.id === "count").part,
      "quantity",
    );
    const html = await call("previewHtml");
    assert.match(
      html,
      /font-family:'Manrope';src:url\('data:font\/woff2;base64,/,
    );
    await p.route("**/quantity-export", (route) =>
      route.fulfill({ body: html, contentType: "text/html" }),
    );
    await p.goto(ws.url + "/quantity-export");
    await p.evaluate(() => document.fonts.ready);
    const input = p.locator("#native-count input"),
      plus = p.locator('#native-count [data-commerce-step="1"]');
    assert.equal(
      await p.locator('#native-count [data-commerce-step="-1"]').isDisabled(),
      true,
    );
    await plus.click();
    assert.equal(await input.inputValue(), "2");
    assert.equal(await p.locator("#native-mirror input").inputValue(), "2");
    assert.equal(
      await p.locator("#native-independent input").inputValue(),
      "1",
    );
    assert.equal(
      await plus.evaluate((n) => n === document.activeElement),
      true,
    );
    await input.fill("999");
    await input.press("Tab");
    assert.equal(await input.inputValue(), "5");
    assert.equal(await plus.isDisabled(), true);
    await input.fill("-4");
    await input.press("Tab");
    assert.equal(await input.inputValue(), "1");
    await input.fill("2.8");
    await input.press("Tab");
    assert.equal(await input.inputValue(), "2");
    await p.locator('#native-options input[value="dock"]').check();
    assert.equal(await input.inputValue(), "1");
    await plus.click();
    assert.equal(await input.inputValue(), "2");
    assert.equal(await plus.isDisabled(), true);
    assert.equal(
      await input.evaluate((n) => n === document.activeElement),
      true,
    );
    await p.locator("#native-buy button").click();
    assert.equal(
      await p.locator("[data-ezkart-cart-subtotal]").innerText(),
      "Rp250.000",
    );
    assert.equal(await p.locator("[data-ezkart-cart-row]").count(), 1);
    await p.keyboard.press("Escape");
    await p.locator("[data-ezkart-cart-layer]").waitFor({ state: "hidden" });
    await p.locator("#native-buy button").click();
    assert.equal(
      await p.locator("[data-ezkart-cart-subtotal]").innerText(),
      "Rp250.000",
    );
    assert.match(
      await p.locator("[data-ezkart-cart-items]").innerText(),
      /quantity or option is unavailable/,
    );
    await p.keyboard.press("Escape");
    await p.locator("[data-ezkart-cart-layer]").waitFor({ state: "hidden" });
    await p.locator('#native-options input[value="empty"]').check();
    assert.equal(await input.isDisabled(), true);
    assert.equal(await p.locator("#native-buy button").isDisabled(), true);
    assert.equal(await p.locator("#native-stock").innerText(), "Sold out");
    await p.locator('#native-options input[value="basic"]').check();
    assert.equal(await input.inputValue(), "2");
    assert.equal(await p.locator("#native-stock").innerText(), "Ready to ship");
    await p.locator("#native-buy button").click();
    assert.equal(
      await p.locator("[data-ezkart-cart-subtotal]").innerText(),
      "Rp450.000",
    );
    assert.equal(await p.locator("[data-ezkart-cart-row]").count(), 2);
  } finally {
    await b.close();
    await ws.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
