import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { Workspace } from "../workspace.mjs";

test("scoped filters and keyboard tabs preserve independent state; editable dialogs and product sets use shared catalog and cart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ezkart-choices-"));
  await writeFile(
    join(directory, "catalog.json"),
    JSON.stringify({
      demoCheckout: true,
      currency: "IDR",
      products: [
        {
          id: "desk",
          name: "Desk",
          type: "physical",
          currency: "IDR",
          price: 100000,
          stock: 3,
          variants: [
            { id: "small", name: "Small", price: 100000, stock: 3 },
            { id: "large", name: "Large", price: 150000, stock: 3 },
            { id: "empty", name: "Unavailable", price: 200000, stock: 0 },
          ],
        },
        {
          id: "mat",
          name: "Mat",
          type: "physical",
          currency: "IDR",
          price: 25000,
          stock: 3,
        },
      ],
    }),
  );
  const ws = await new Workspace(directory).init();
  await ws.create({
    id: "choices",
    name: "Choice controls",
    productIds: ["desk", "mat"],
  });
  await ws.start();
  const browser = await chromium.launch(),
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const call = (method, args = {}) =>
    page.evaluate(({ method, args }) => EzkartBuilder[method](args), {
      method,
      args,
    });
  const n = (id, type = "container", more = {}) => ({
    id,
    type,
    props: { display: "block", paddingTop: "8px", paddingBottom: "8px" },
    ...more,
  });
  const choice = (id, scope, target) =>
    n(id, "button", {
      tag: "button",
      text: target,
      action: { type: "state", scope, target },
    });
  const bound = (id, part, extra = {}) =>
    n(id, "commerce", { part, productId: "desk", group: "shared", ...extra });
  try {
    await page.goto(
      ws.url + "/cart/admin/?page=sites&edit=choices.ezkart.site",
    );
    await page.waitForFunction(() => globalThis.EzkartBuilder);
    await call("nativeInsert", {
      section: "blank",
      node: n("layout", "container", {
        props: { fontOpticalSizing: "none" },
        children: [
          n("portions", "container", {
            initialState: "one",
            children: ["one", "two"].map((target) =>
              n("portion-" + target, "button", {
                tag: "button",
                text: target,
                action: {
                  type: "state",
                  scope: "portions",
                  target,
                  disableWhenActive: true,
                },
              }),
            ),
          }),
          n("filter", "container", {
            initialState: "all",
            stateMode: "filter",
            stateParam: "material",
            children: [
              choice("all", "filter", "all"),
              choice("wood", "filter", "wood"),
              n("felt", "text", {
                text: "Felt item",
                stateScope: "filter",
                states: { wood: { props: { display: "none" } } },
              }),
            ],
          }),
          n("setup", "container", {
            initialState: "work",
            stateMode: "tabs",
            children: [
              n("tabs", "container", {
                children: [
                  choice("work", "setup", "work"),
                  choice("write", "setup", "write"),
                ],
              }),
              n("work-panel", "text", {
                text: "Work panel",
                statePanel: "work",
                stateScope: "setup",
                states: { write: { props: { display: "none" } } },
              }),
              n("write-panel", "text", {
                text: "Writing panel",
                props: { display: "none" },
                statePanel: "write",
                stateScope: "setup",
                states: { write: { props: { display: "block" } } },
              }),
            ],
          }),
          n("open", "button", {
            tag: "button",
            text: "Product details",
            action: { type: "dialog", target: "detail" },
          }),
          n("detail", "container", {
            tag: "dialog",
            label: "Desk details",
            props: { width: "360px", maxWidth: "90%" },
            children: [
              n("close", "button", {
                tag: "button",
                text: "Close",
                action: { type: "close-dialog", target: "detail" },
              }),
              bound("options", "options"),
              bound("price", "price"),
              bound("add", "add"),
            ],
          }),
          bound("set-total", "set-price", { productIds: ["desk", "mat"] }),
          bound("set-buy", "set-add", {
            productIds: ["desk", "mat"],
            label: "Add both",
            showPrice: true,
          }),
          bound("independent", "price", { group: "independent" }),
          bound("dropdown", "options", { optionLayout: "select" }),
        ],
      }),
    });
    await assert.rejects(
      () =>
        call("nativeUpdate", { id: "set-total", productIds: ["desk", "desk"] }),
      /different catalog products/,
    );
    await page.locator("[data-sq-tab=layers]").click();
    await page.locator("[data-sq-layer][data-section-id=blank]").click();
    await page.locator("[data-sq-toolbar-duplicate]").click();
    const copied = await call("nativeInspect"),
      scope = copied.find((n) => n.initialState === "work" && n.id !== "setup");
    assert.ok(scope);
    assert.deepEqual(
      copied
        .filter((n) => n.action?.scope === scope.id)
        .map((n) => n.action.target)
        .sort(),
      ["work", "write"],
    );
    assert.equal(copied.filter((n) => n.stateScope === scope.id).length, 2);
    await call("undo");
    await page.locator("[data-native-id=set-buy]").click();
    const panel = page.locator("[data-sq-native-inspector]");
    await panel
      .locator("[data-native-set-products] input[value=mat]")
      .uncheck();
    assert.deepEqual(
      (await call("nativeInspect", { id: "set-buy" })).productIds,
      ["desk"],
    );
    await call("undo");
    assert.deepEqual(
      (await call("nativeInspect", { id: "set-buy" })).productIds,
      ["desk", "mat"],
    );
    await call("save");
    await page.reload();
    await page.waitForFunction(() => globalThis.EzkartBuilder);
    await page.locator("#native-open").click({ modifiers: ["Alt"] });
    assert.equal(
      await page.locator("#native-detail").evaluate((n) => n.open),
      true,
    );
    const html = await call("exportHtml");
    const p = await browser.newPage({
      viewport: { width: 390, height: 900 },
      reducedMotion: "reduce",
    });
    p.on("pageerror", (e) => errors.push(e.message));
    await p.route("http://choices.test/**", (r) =>
      r.fulfill({ body: html, contentType: "text/html" }),
    );
    await p.goto("http://choices.test/?material=wood");
    assert.equal(
      await p
        .locator("#native-layout")
        .evaluate((n) => getComputedStyle(n).fontOpticalSizing),
      "none",
    );
    assert.equal(await p.locator("#native-portion-one").isDisabled(), true);
    await p.locator("#native-portion-two").click();
    assert.equal(await p.locator("#native-portion-two").isDisabled(), true);
    assert.equal(
      await p.evaluate(() => document.activeElement.id),
      "native-portion-one",
    );
    assert.equal(
      await p.locator("#native-portions").getAttribute("data-native-state"),
      "two",
    );
    await p.locator("#native-dropdown select").selectOption("large");
    assert.equal(await p.locator("#native-set-total").innerText(), "Rp175.000");
    assert.match(
      await p.locator("#native-set-buy button").innerText(),
      /Rp175.000/,
    );
    assert.equal(await p.locator("#native-felt").isVisible(), false);
    assert.equal(
      await p.locator("#native-detail").evaluate((n) => n.open),
      false,
    );
    await p.locator("#native-work").focus();
    await p.keyboard.press("ArrowRight");
    assert.equal(await p.locator("#native-write-panel").isVisible(), true);
    assert.equal(await p.locator("#native-felt").isVisible(), false);
    await p.locator("#native-all").click();
    assert.equal(await p.locator("#native-felt").isVisible(), true);
    assert.equal(await p.locator("#native-write-panel").isVisible(), true);
    assert.match(p.url(), /material=all/);
    await p.locator("#native-open").click();
    assert.equal(
      await p.locator("#native-detail").evaluate((n) => n.open),
      true,
    );
    await p.locator("#native-options input[value=large]").check();
    assert.equal(await p.locator("#native-price").innerText(), "Rp150.000");
    assert.equal(await p.locator("#native-set-total").innerText(), "Rp175.000");
    assert.equal(
      await p.locator("#native-independent").innerText(),
      "Rp100.000",
    );
    await p.locator("#native-add button").focus();
    await p.keyboard.press("Tab");
    assert.equal(
      await p.evaluate(() => document.activeElement.id),
      "native-close",
    );
    await p.keyboard.press("Escape");
    assert.equal(
      await p.evaluate(() => document.activeElement.id),
      "native-open",
    );
    await p.waitForFunction(() => document.body.style.overflow !== "hidden");
    await p.locator("#native-set-buy button").click();
    assert.equal(await p.locator(".ezkart-cart-row").count(), 2);
    assert.equal(
      await p.locator("[data-ezkart-cart-subtotal]").innerText(),
      "Rp175.000",
    );
    await p.keyboard.press("Escape");
    for (let i = 0; i < 2; i++) {
      await p.locator("#native-set-buy button").click();
      await p.keyboard.press("Escape");
    }
    await p.locator("#native-set-buy button").click();
    assert.equal(
      await p.locator("[data-ezkart-cart-subtotal]").innerText(),
      "Rp525.000",
    );
    assert.match(
      await p.locator("[data-ezkart-cart-items]").innerText(),
      /No items were added/,
    );
    await p.keyboard.press("Escape");
    await p.locator("#native-open").click();
    await p.locator("#native-options input[value=empty]").check();
    assert.equal(await p.locator("#native-add button").isDisabled(), true);
    await p.keyboard.press("Escape");
    assert.equal(await p.locator("#native-set-buy button").isDisabled(), true);
    await p.goto("http://choices.test/#native-detail");
    assert.equal(
      await p.locator("#native-detail").evaluate((n) => n.open),
      true,
    );
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await ws.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
