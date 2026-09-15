import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { Workspace } from "../workspace.mjs";

async function fixture(run) {
  const dir = await mkdtemp(join(tmpdir(), "ezkart-grid-"));
  const ws = await new Workspace(dir).init();
  await ws.create({ id: "grid", name: "Grid editing" });
  await ws.start();
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1100 },
    reducedMotion: "reduce",
  });
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const invoke = (method, args = {}) =>
    page.evaluate(({ method, args }) => EzkartBuilder[method](args), {
      method,
      args,
    });
  const settle = async () => {
    await page
      .locator(".sq-device-frame")
      .evaluate(async (node) =>
        Promise.all(
          node.getAnimations().map((animation) => animation.finished),
        ),
      );
    await invoke("settle");
  };
  const select = async (node) => {
    await node.scrollIntoViewIfNeeded();
    await node.click();
    await settle();
  };
  const drag = async (node, cell, resizing = false, alt = false) => {
    const handle = page.locator(
      resizing ? "[data-sq-element-resize]" : "[data-sq-element-move]",
    );
    await handle.scrollIntoViewIfNeeded();
    const start = await node.boundingBox(),
      target = await cell.boundingBox(),
      grip = await handle.boundingBox();
    const targetX = target.x + (resizing ? target.width : 0),
      targetY = target.y + (resizing ? target.height : 0);
    const dx = targetX - start.x - (resizing ? start.width : 0) + 3;
    const dy = targetY - start.y - (resizing ? start.height : 0) + 3;
    if (alt) await page.keyboard.down("Alt");
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      grip.x + grip.width / 2 + dx,
      grip.y + grip.height / 2 + dy,
      { steps: 4 },
    );
    const during = await node.boundingBox();
    const overlay = await page.locator(".sq-element-overlay").boundingBox();
    assert.ok(
      Math.abs(during.x - overlay.x) < 1 &&
        Math.abs(during.width - overlay.width) < 1,
      "Selection follows the element during dragging",
    );
    await page.mouse.up();
    if (alt) await page.keyboard.up("Alt");
    await settle();
    const end = await node.boundingBox(),
      actualCell = await cell.boundingBox();
    const errorX =
      end.x +
      (resizing ? end.width : 0) -
      actualCell.x -
      (resizing ? actualCell.width : 0);
    const errorY =
      end.y +
      (resizing ? end.height : 0) -
      actualCell.y -
      (resizing ? actualCell.height : 0);
    if (alt)
      assert.ok(
        Math.abs(errorX) > 1,
        "Alt allows a position between grid lines",
      );
    else {
      assert.ok(
        Math.abs(errorX) < 1,
        `Horizontal edge snaps to the visible cell: ${errorX}`,
      );
      assert.ok(
        Math.abs(errorY) < 1,
        `Vertical edge snaps to the visible cell: ${errorY}`,
      );
    }
  };
  try {
    await page.goto(ws.url + "/cart/admin/?page=sites&edit=grid.ezkart.site");
    await page.waitForFunction(() => globalThis.EzkartBuilder);
    await run({ page, invoke, settle, select, drag, ws });
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await ws.stop();
    await rm(dir, { recursive: true, force: true });
  }
}

test("native elements snap to their own section grid, including nested scaling, resize, history and export", async () =>
  fixture(async ({ page, invoke, settle, select, drag, ws }) => {
    assert.equal(
      await page
        .locator("[data-sq-grid-toggle]")
        .first()
        .getAttribute("aria-pressed"),
      "true",
    );
    await invoke("addSection", { component: "blank", id: "native" });
    await invoke("nativeInsert", {
      section: "native",
      node: {
        id: "native",
        type: "container",
        props: {
          display: "block",
          position: "relative",
          minHeight: "720px",
          paddingTop: "40px",
          paddingBottom: "40px",
          paddingLeft: "40px",
          paddingRight: "40px",
        },
        children: [
          {
            id: "nested",
            type: "container",
            props: {
              width: "700px",
              height: "500px",
              position: "relative",
              transform: "scale(0.8)",
              transformOrigin: "0 0",
            },
            children: [
              {
                id: "box",
                type: "button",
                text: "Move me",
                props: {
                  position: "absolute",
                  left: "17px",
                  top: "13px",
                  width: "180px",
                  height: "80px",
                  backgroundColor: "#d9ece4",
                },
              },
            ],
          },
        ],
      },
    });
    const node = page.locator("[data-native-id=box]");
    await select(node);
    const grid = page.locator(
      "[data-section-id=native] > .sq-layout-grid-overlay",
    );
    assert.equal(await grid.count(), 1);
    assert.equal(
      await page
        .locator("[data-section-id=blank] > .sq-layout-grid-overlay")
        .count(),
      0,
      "No grid in the previous section",
    );
    const before = await invoke("nativeInspect", { id: "box" });
    await drag(node, grid.locator("i").nth(12 * 3 + 2));
    const moved = await invoke("nativeInspect", { id: "box" });
    assert.notEqual(moved.props.left, before.props.left);
    await invoke("undo");
    assert.equal(
      (await invoke("nativeInspect", { id: "box" })).props.left,
      before.props.left,
    );
    await invoke("redo");
    assert.equal(
      (await invoke("nativeInspect", { id: "box" })).props.left,
      moved.props.left,
    );
    await select(node);
    await drag(node, grid.locator("i").nth(12 * 7 + 4), true);
    const resized = await invoke("nativeInspect", { id: "box" });
    await page.locator("[data-sq-element-move]").focus();
    await page.keyboard.press("ArrowRight");
    assert.equal(
      parseFloat((await invoke("nativeInspect", { id: "box" })).props.left),
      parseFloat(resized.props.left) + 1,
      "Native keyboard movement saves native position",
    );
    await invoke("undo");
    await invoke("save");
    await page.reload();
    await page.waitForFunction(() => globalThis.EzkartBuilder);
    await settle();
    assert.deepEqual(
      (await invoke("nativeInspect", { id: "box" })).props,
      resized.props,
    );
    await invoke("removeSection", { id: "blank" });
    const html = await invoke("exportHtml");
    await page.route("**/grid-export", (route) =>
      route.fulfill({ body: html, contentType: "text/html" }),
    );
    await page.goto(ws.url + "/grid-export");
    assert.equal(
      await page.locator(".sq-layout-grid-overlay,.sq-element-overlay").count(),
      0,
    );
    assert.equal(
      await node.evaluate((n) => getComputedStyle(n).left),
      resized.props.left,
    );
    assert.equal(
      await node.evaluate((n) => getComputedStyle(n).width),
      resized.props.width,
    );
  }));

test("flow elements use the visible grid at each device size and hidden guides stay hidden after reopening", async () =>
  fixture(async ({ page, invoke, settle, select, drag }) => {
    await invoke("addSection", {
      component: "feature-showcase",
      id: "feature",
    });
    const node = page.locator("#feature > .ezm-section-copy");
    await select(node);
    const grid = page.locator("#feature > .sq-layout-grid-overlay");
    await drag(node, grid.locator("i").nth(12 * 7 + 1));
    const id = await node.getAttribute("data-sq-element-id");
    const saved = (await invoke("inspect")).sections
      .find((s) => s.id === "feature")
      .elements.find((e) => e.id === id).layout;
    await invoke("undo");
    assert.equal(await node.getAttribute("data-flow-desktop"), null);
    await invoke("redo");
    assert.equal(
      JSON.parse(await node.getAttribute("data-flow-desktop")).x,
      saved.x,
    );
    await page.locator(".sq-grid-quick-toggle").click();
    assert.equal(
      await page.locator(".sq-grid-quick-toggle").getAttribute("aria-pressed"),
      "false",
    );
    await invoke("save");
    await page.reload();
    await page.waitForFunction(() => globalThis.EzkartBuilder);
    await settle();
    assert.equal(
      await page.locator(".sq-grid-quick-toggle").getAttribute("aria-pressed"),
      "false",
    );
    await select(node);
    const handle = page.locator("[data-sq-element-move]");
    await handle.scrollIntoViewIfNeeded();
    const grip = await handle.boundingBox();
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    assert.equal(
      await grid.count(),
      1,
      "Dragging reveals guides even when the persistent grid is hidden",
    );
    await page.mouse.up();
    await page.locator(".sq-grid-quick-toggle").click();
    await invoke("setDevice", { device: "mobile" });
    await settle();
    await select(node);
    await drag(node, grid.locator("i").nth(12 * 3));
    assert.ok(await node.getAttribute("data-flow-mobile"));
    assert.equal(
      JSON.parse(await node.getAttribute("data-flow-desktop")).x,
      saved.x,
      "Mobile movement leaves the desktop position intact",
    );
    await drag(node, grid.locator("i").nth(12 * 4), false, true);
  }));
