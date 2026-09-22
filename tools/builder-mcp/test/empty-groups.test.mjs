import {openAssets, chooseBasic} from "./asset-helpers.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { Workspace } from "../workspace.mjs";

test("empty-group guidance preserves swatches, dividers and spacers while new layout groups stay discoverable", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ezkart-empty-groups-"));
  const ws = await new Workspace(directory).init();
  await ws.create({ id: "shapes", name: "Empty groups and decorative shapes" });
  await ws.start();
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1100 },
  });
  const call = (method, args = {}) =>
    page.evaluate(({ method, args }) => EzkartBuilder[method](args), {
      method,
      args,
    });
  const guidance = (id) =>
    page.locator(`[data-native-id="${id}"]`).evaluate((node) => ({
      hint: getComputedStyle(node, "::before").content,
      outline: getComputedStyle(node).outlineStyle,
      height: node.offsetHeight,
      scrollHeight: node.scrollHeight,
    }));
  try {
    await page.goto(ws.url + "/cart/admin/?page=sites&edit=shapes.ezkart.site");
    await page.waitForFunction(() => globalThis.EzkartBuilder);
    await call("nativeInsert", {
      section: "blank",
      node: {
        id: "product-row",
        type: "container",
        props: { display: "flex", flexDirection: "column" },
        children: [
          {
            id: "color-dot",
            type: "container",
            props: {
              width: "10px",
              height: "10px",
              borderRadius: "50%",
              backgroundColor: "#727955",
            },
          },
          { id: "color-name", type: "text", text: "Lumut · Kanvas katun" },
          {
            id: "rule",
            type: "container",
            props: { width: "100%", height: "1px", backgroundColor: "#dce2e5" },
          },
          { id: "spacer", type: "container", props: { height: "24px" } },
          {
            id: "responsive-shape",
            type: "container",
            props: { width: "100%" },
            responsive: [{ max: 600, props: { height: "8px" } }],
          },
          {
            id: "state-shape",
            type: "container",
            props: { width: "100%" },
            states: { small: { props: { height: "8px" } } },
          },
          {
            id: "ratio-shape",
            type: "container",
            props: { width: "40px", aspectRatio: "1" },
          },
          { id: "narrow-group", type: "container", props: { width: "12px" } },
          {
            id: "choose",
            type: "button",
            text: "Pilih Teman Pouch",
            tag: "button",
          },
        ],
      },
    });
    for (const id of [
      "color-dot",
      "rule",
      "spacer",
      "responsive-shape",
      "state-shape",
      "ratio-shape",
      "narrow-group",
    ]) {
      const result = await guidance(id);
      assert.equal(result.hint, "none", `${id} has no empty-group copy`);
      assert.notEqual(
        result.outline,
        "dashed",
        `${id} has no editor placeholder outline`,
      );
    }
    const dot = await guidance("color-dot");
    assert.equal(dot.height, 10);
    assert.equal(
      dot.scrollHeight,
      10,
      "The dot cannot spill 96px of helper text into the product link",
    );
    assert.equal((await guidance("rule")).height, 1);
    assert.equal((await guidance("spacer")).height, 24);

    await openAssets(page);
    await chooseBasic(page,"native-container");
    const group = (await call("nativeInspect")).find(
      (node) => node.type === "container" && node.name === "Column",
    );
    assert.ok(group, "Normal Add creates an empty layout group");
    assert.match(
      (await guidance(group.id)).hint,
      /Add an element to this group/,
    );
    await call("nativeUpdate", {
      id: group.id,
      props: { minHeight: "0px", height: "10px", width: "10px" },
    });
    assert.equal((await guidance(group.id)).hint, "none");
    await call("undo");
    assert.match(
      (await guidance(group.id)).hint,
      /Add an element to this group/,
    );
    await call("save");
    await page.reload();
    await page.waitForFunction(() => globalThis.EzkartBuilder);
    await call("settle");
    assert.equal((await guidance("color-dot")).hint, "none");
    assert.match(
      (await guidance(group.id)).hint,
      /Add an element to this group/,
    );
    const html = await call("previewHtml");
    const storefront = await browser.newPage();
    await storefront.route(ws.url + "/empty-group-review", (route) =>
      route.fulfill({ body: html, contentType: "text/html" }),
    );
    await storefront.goto(ws.url + "/empty-group-review");
    for (const id of ["color-dot", group.id]) {
      assert.equal(
        await storefront
          .locator(`[data-native-id="${id}"]`)
          .evaluate((node) => getComputedStyle(node, "::before").content),
        "none",
        "Editor guidance never renders in the storefront",
      );
    }
  } finally {
    await browser.close();
    await ws.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
