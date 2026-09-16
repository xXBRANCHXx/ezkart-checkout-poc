import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { Workspace } from "../workspace.mjs";

test("fixed variants preserve prices and stock independently; semantic table headers remain editable", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ezkart-fixed-"));
  await writeFile(
    join(dir, "catalog.json"),
    JSON.stringify({
      demoCheckout: true,
      products: [
        {
          id: "pack",
          name: "Document pack",
          type: "physical",
          stock: 4,
          price: 100,
          variants: [
            { id: "solo", name: "One business", stock: 4, price: 100 },
            { id: "team", name: "Team", stock: 3, price: 200 },
            { id: "sold", name: "Sold out", stock: 0, price: 300 },
            {
              id: "hidden",
              name: "Hidden",
              hidden: true,
              stock: 4,
              price: 400,
            },
          ],
        },
        { id: "other", name: "Other", stock: 4, price: 50, type: "physical" },
      ],
    }),
  );
  const ws = await new Workspace(dir).init();
  await ws.create({
    id: "fixed",
    name: "Fixed",
    productIds: ["pack", "other"],
  });
  await ws.start();
  const browser = await chromium.launch(),
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const call = (method, args = {}) =>
    page.evaluate(({ method, args }) => EzkartBuilder[method](args), {
      method,
      args,
    });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto(ws.url + "/cart/admin/?page=sites&edit=fixed.ezkart.site");
    await page.waitForFunction(() => globalThis.EzkartBuilder);
    const c = (id, part, variantId = "") => ({
      id,
      type: "commerce",
      part,
      variantId,
      productId: "pack",
      group: "shop",
      props: { width: "100%", fontSize: "14px" },
    });
    await call("nativeInsert", {
      section: "blank",
      node: {
        id: "layout",
        type: "container",
        props: { display: "flex", flexDirection: "column", gap: "20px" },
        children: [
          c("options", "options"),
          c("normal-price", "price"),
          c("solo-price", "price", "solo"),
          c("team-price", "price", "team"),
          c("team-add", "add", "team"),
          c("sold-add", "add", "sold"),
          c("missing-add", "add", "missing"),
          c("hidden-add", "add", "hidden"),
          {
            id: "table-scroll",
            type: "container",
            props: { display: "block", overflowX: "auto", width: "100%" },
            children: [
              {
                id: "comparison",
                type: "container",
                tag: "table",
                label: "Compare licenses",
                props: {
                  display: "table",
                  tableLayout: "fixed",
                  borderCollapse: "collapse",
                  width: "100%",
                  minWidth: "525px",
                },
                children: [
                  {
                    id: "table-head",
                    type: "container",
                    tag: "thead",
                    props: { display: "table-header-group" },
                    children: [
                      {
                        id: "head-row",
                        type: "container",
                        tag: "tr",
                        props: { display: "table-row" },
                        children: [
                          {
                            id: "header-label",
                            type: "text",
                            tag: "th",
                            tableScope: "col",
                            text: "License",
                            props: {
                              display: "table-cell",
                              paddingTop: "16px",
                              paddingBottom: "16px",
                            },
                          },
                          {
                            id: "header-team",
                            type: "text",
                            tag: "th",
                            tableScope: "col",
                            text: "Team",
                            props: { display: "table-cell" },
                          },
                        ],
                      },
                    ],
                  },
                  {
                    id: "table-body",
                    type: "container",
                    tag: "tbody",
                    props: { display: "table-row-group" },
                    children: [
                      {
                        id: "body-row",
                        type: "container",
                        tag: "tr",
                        props: { display: "table-row" },
                        children: [
                          {
                            id: "row-users",
                            type: "text",
                            tag: "th",
                            tableScope: "row",
                            text: "Users",
                            props: { display: "table-cell" },
                          },
                          {
                            id: "users-value",
                            type: "text",
                            tag: "td",
                            text: "5",
                            props: { display: "table-cell" },
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    await page.locator("[data-native-id=team-price]").click();
    const panel = page.locator("[data-sq-native-inspector]");
    assert.equal(
      await panel.locator("[data-commerce-setting=variantId]").inputValue(),
      "team",
    );
    await panel
      .locator("[data-commerce-setting=variantId]")
      .selectOption("solo");
    assert.equal(
      (await call("nativeInspect", { id: "team-price" })).variantId,
      "solo",
    );
    await call("undo");
    assert.equal(
      (await call("nativeInspect", { id: "team-price" })).variantId,
      "team",
    );
    await page.locator("[data-native-id=row-users]").click();
    await panel
      .locator("[data-native-structure]")
      .evaluate((n) => (n.open = true));
    await panel
      .locator("[data-native-table-scope]")
      .selectOption("col", { force: true });
    assert.equal(
      await page.locator("[data-native-id=row-users]").getAttribute("scope"),
      "col",
    );
    await call("undo");
    await call("save");
    await page.reload();
    await page.waitForFunction(() => globalThis.EzkartBuilder);
    assert.equal(
      (await call("nativeInspect", { id: "team-price" })).variantId,
      "team",
    );
    assert.equal(
      await page.locator("[data-native-id=row-users]").getAttribute("scope"),
      "row",
    );
    const html = await call("previewHtml"),
      preview = await browser.newPage({
        viewport: { width: 320, height: 900 },
      });
    preview.on("pageerror", (e) => errors.push(e.message));
    await preview.route("http://fixed.test/", (r) =>
      r.fulfill({ body: html, contentType: "text/html" }),
    );
    await preview.goto("http://fixed.test/");
    await preview
      .getByRole("radio", { name: "One business", exact: true })
      .check();
    assert.equal(
      await preview.locator("#native-team-price").innerText(),
      "Rp200",
    );
    assert.equal(
      await preview.locator("#native-solo-price").innerText(),
      "Rp100",
    );
    await preview.getByRole("radio", { name: "Team", exact: true }).check();
    assert.equal(
      await preview.locator("#native-normal-price").innerText(),
      "Rp200",
    );
    assert.equal(
      await preview.locator("#native-solo-price").innerText(),
      "Rp100",
    );
    for (const id of ["sold", "missing", "hidden"])
      assert.equal(
        await preview.locator("#native-" + id + "-add button").isDisabled(),
        true,
      );
    await preview.locator("#native-team-add button").click();
    assert.match(await preview.locator(".ezkart-cart-row").innerText(), /Team/);
    assert.equal(
      await preview.locator("[data-ezkart-cart-subtotal]").innerText(),
      "Rp200",
    );
    await preview.keyboard.press("Escape");
    await preview
      .locator("[data-ezkart-cart-layer]")
      .waitFor({ state: "hidden" });
    assert.equal(
      await preview
        .getByRole("columnheader", { name: "Team", exact: true })
        .count(),
      1,
    );
    assert.equal(
      await preview
        .getByRole("rowheader", { name: "Users", exact: true })
        .count(),
      1,
    );
    assert.equal(
      await preview
        .locator("html")
        .evaluate((n) => n.scrollWidth <= innerWidth),
      true,
    );
    assert.equal(
      await preview
        .locator("#native-table-scroll")
        .evaluate((n) => n.scrollWidth > n.clientWidth),
      true,
    );
    await preview.locator("#native-table-scroll").focus();
    await preview.keyboard.press("ArrowRight");
    await preview.waitForTimeout(200);
    assert.ok(
      await preview
        .locator("#native-table-scroll")
        .evaluate((n) => n.scrollLeft > 0),
    );
    await page.locator("[data-native-id=team-price]").click();
    await panel.locator("[data-native-product-id]").selectOption("other");
    assert.equal(
      (await call("nativeInspect", { id: "team-price" })).variantId,
      undefined,
    );
    const issue = await page.evaluate(() =>
      EzkartPublish.check(
        [["pack::sold"]],
        [
          {
            id: "pack",
            stock: 5,
            type: "physical",
            variants: [
              { id: "solo", stock: 5 },
              { id: "sold", stock: 0 },
            ],
          },
        ],
      ),
    );
    assert.match(issue, /stock/);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await ws.stop();
    await rm(dir, { recursive: true, force: true });
  }
});
