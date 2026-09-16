import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { Workspace } from "../workspace.mjs";

test("the shared floating cart remains reachable above purchase bars and preserves quantity and focus", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ezkart-cart-pattern-"));
  await writeFile(
    join(directory, "catalog.json"),
    JSON.stringify({
      currency: "USD",
      locale: "en-US",
      demoCheckout: true,
      products: [
        {
          id: "soda",
          name: "Demo soda",
          currency: "USD",
          type: "physical",
          price: 24,
          stock: 3,
        },
      ],
    }),
  );
  const ws = await new Workspace(directory).init();
  await ws.create({ id: "cart", name: "Shared cart", productIds: ["soda"] });
  await ws.start();
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1500, height: 1000 },
    reducedMotion: "reduce",
  });
  const invoke = (method, args = {}) =>
    page.evaluate(({ method, args }) => EzkartBuilder[method](args), {
      method,
      args,
    });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto(ws.url + "/cart/admin/?page=sites&edit=cart.ezkart.site");
    await page.waitForFunction(() => globalThis.EzkartBuilder);
    for (const node of [
      { id: "hero", type: "container", props: { height: "1100px" } },
      {
        id: "story",
        type: "container",
        props: { height: "1700px", paddingTop: "600px" },
        children: [
          {
            id: "inline-add",
            type: "commerce",
            part: "add",
            productId: "soda",
            props: { width: "100%" },
          },
        ],
      },
      {
        id: "purchase",
        type: "container",
        props: {
          position: "fixed",
          left: "0px",
          right: "0px",
          bottom: "0px",
          top: "auto",
          width: "100%",
          height: "76px",
          marginTop: "0px",
          marginBottom: "0px",
          marginLeft: "0px",
          marginRight: "0px",
          display: "flex",
          alignItems: "center",
          backgroundColor: "#efe94f",
        },
        scrollVisibility: { after: "hero", hideWhile: [] },
        children: [
          {
            id: "add",
            type: "commerce",
            part: "add",
            productId: "soda",
            label: "Add a pack",
          },
        ],
      },
    ]) {
      await invoke("addSection", { component: "blank", id: node.id });
      await invoke("nativeInsert", { section: node.id, node });
    }
    await invoke("removeSection", { id: "blank" });
    const html = await invoke("previewHtml");
    await page.route("**/cart-pattern-export", (route) =>
      route.fulfill({ body: html, contentType: "text/html" }),
    );
    await page.goto(ws.url + "/cart-pattern-export");
    const cart = page.locator(".ezkart-cart-trigger");
    assert.equal(await cart.count(), 1);
    assert.equal(await cart.locator("svg").count(), 1);
    assert.equal(
      await cart.evaluate((n) => getComputedStyle(n).backgroundColor),
      "rgb(255, 255, 255)",
    );
    await cart.click();
    assert.match(
      await page.locator("[data-ezkart-cart-items]").innerText(),
      /Your cart is empty/,
    );
    assert.equal(
      await page.locator("[data-ezkart-cart-go]").isDisabled(),
      true,
    );
    await page.keyboard.press("Escape");
    await page.locator("[data-ezkart-cart-layer]").waitFor({ state: "hidden" });
    assert.equal(
      await cart.evaluate((n) => n === document.activeElement),
      true,
    );
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(() => scrollTo({ top: 1200, behavior: "instant" }));
      await page.waitForFunction(() =>
        document.querySelector("#native-purchase").matches(":popover-open"),
      );
      await page.waitForFunction(
        () =>
          document.querySelector(".ezkart-cart-trigger").getBoundingClientRect()
            .bottom <=
          document.querySelector("#native-purchase").getBoundingClientRect()
            .top -
            10,
      );
      assert.equal(
        await cart.evaluate((n) => {
          const r = n.getBoundingClientRect();
          return n.contains(
            document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
          );
        }),
        true,
        `Cart is covered at ${width}px`,
      );
      const bounds = await cart.boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
    }
    await page.locator("#native-add button").click();
    await page.locator("#native-purchase").waitFor({ state: "hidden" });
    await page.locator('[data-ezkart-cart-quantity="1"]').click();
    assert.equal(
      await cart.locator("[data-ezkart-cart-count]").innerText(),
      "2",
    );
    assert.equal(
      await page.locator("[data-ezkart-cart-subtotal]").innerText(),
      "$48",
    );
    await page.keyboard.press("Escape");
    await page.locator("[data-ezkart-cart-layer]").waitFor({ state: "hidden" });
    await cart.click();
    assert.equal(
      await page.locator("[data-ezkart-cart-subtotal]").innerText(),
      "$48",
    );
    await page.locator('[data-ezkart-cart-quantity="-1"]').click();
    await page.locator('[data-ezkart-cart-quantity="-1"]').click();
    assert.match(
      await page.locator("[data-ezkart-cart-items]").innerText(),
      /Your cart is empty/,
    );
    await page.keyboard.press("Escape");
    await page.locator("[data-ezkart-cart-layer]").waitFor({ state: "hidden" });
    await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
    await page.waitForFunction(
      () =>
        document.querySelector(".ezkart-cart-trigger").getBoundingClientRect()
          .bottom >=
        innerHeight - 21,
    );
    // Ordinary purchase controls must remain clickable when they cross the corner.
    await page.locator("#native-purchase").evaluate((n) => (n.hidden = true));
    await page
      .locator("#native-inline-add")
      .evaluate((n) =>
        scrollTo({
          top: scrollY + n.getBoundingClientRect().top - innerHeight + 70,
          behavior: "instant",
        }),
      );
    await page.waitForFunction(
      () =>
        document.querySelector(".ezkart-cart-trigger").getBoundingClientRect()
          .bottom <=
        document.querySelector("#native-inline-add").getBoundingClientRect()
          .top -
          10,
    );
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await ws.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
