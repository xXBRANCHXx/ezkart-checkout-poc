import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { Workspace } from "../workspace.mjs";

test("blank-page editing supports direct dragging, inline text, resize, history and reopening", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ezkart-blank-workflow-"));
  const ws = await new Workspace(dir).init();
  await ws.start();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1894, height: 1000 }, reducedMotion: "reduce" });
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  const call = (method, args = {}) => page.evaluate(({ method, args }) => EzkartBuilder[method](args), { method, args });
  try {
    await page.goto(ws.url + "/cart/admin/?page=sites");
    await page.locator("[data-library-create-card]").click();
    const form = page.locator("[data-library-page-form]");
    await form.locator("[name=page_name]").fill("Blank workflow");
    await form.locator("button[value=default]").click();
    await page.waitForURL("**edit=blank-workflow.ezkart.site");
    await page.waitForFunction(() => globalThis.EzkartBuilder);
    await call("settle");
    const section = page.locator('.sq-page-preview > [data-section-id="blank"]');
    const before = await section.evaluate(n => ({ height: n.offsetHeight, padding: getComputedStyle(n).padding }));
    const add = async type => {
      await page.locator("[data-sq-tab=add]").click();
      await page.locator(`[data-sq-add-element=native-${type}]`).click();
      const nodes = await call("nativeInspect");
      const node = nodes.filter(n => n.type === type).at(-1);
      assert.ok(node, `The Add panel inserts a ${type}`);
      if (await page.locator(".sq-builder-sidebar.sq-panel-pinned").count()) await page.locator("[data-sq-tab=add]").click();
      await page.mouse.move(1000, 90);
      await call("settle");
      return node.id;
    };
    const headingId = await add("heading");
    const heading = page.locator(`[data-native-id="${headingId}"]`);
    assert.deepEqual(await section.evaluate(n => ({ height: n.offsetHeight, padding: getComputedStyle(n).padding })), before,
      "Adding the first element preserves the section's height and spacing");
    assert.equal(await heading.getAttribute("contenteditable"), "false");
    const drag = async (node, dx = 100, dy = 55) => {
      await node.scrollIntoViewIfNeeded();
      const start = await node.boundingBox();
      assert.ok(start.width > 20 && start.height > 20, "The element has a usable drag target");
      await page.mouse.move(start.x + Math.min(start.width / 2, 80), start.y + Math.min(start.height / 2, 25));
      await page.mouse.down();
      await page.mouse.move(start.x + Math.min(start.width / 2, 80) + dx, start.y + Math.min(start.height / 2, 25) + dy, { steps: 8 });
      await page.mouse.up();
      await call("settle");
      const end = await node.boundingBox();
      assert.ok(end.x > start.x + 30 && end.y > start.y + 20,
        `Dragging the element itself moves it in both directions: ${JSON.stringify({ start, end })}`);
    };
    await drag(heading);
    const sharedProps = config => config.props || {};
    const moved = sharedProps(await call("nativeInspect", { id: headingId }));
    assert.ok(parseFloat(moved.left) > 0 && parseFloat(moved.top) > 0);
    await call("undo");
    assert.equal(sharedProps(await call("nativeInspect", { id: headingId })).left, undefined);
    await call("redo");
    assert.deepEqual(sharedProps(await call("nativeInspect", { id: headingId })), moved);
    await heading.click();
    await page.locator("[data-native-text]").fill("Edited from settings");
    await heading.click();
    assert.equal((await call("nativeInspect", { id: headingId })).text, "Edited from settings",
      "Returning to the canvas commits the inspector field");
    await page.keyboard.press("Enter");
    assert.equal(await heading.getAttribute("contenteditable"), "true");
    await page.keyboard.press("Escape");
    await heading.dblclick();
    assert.equal(await heading.getAttribute("contenteditable"), "true");
    await heading.fill("A heading I can move");
    await page.keyboard.press("Escape");
    assert.equal(await heading.getAttribute("contenteditable"), "false");
    assert.equal((await call("nativeInspect", { id: headingId })).text, "A heading I can move");
    await drag(heading, 65, 35);
    await heading.click();
    const grip = await page.locator("[data-sq-element-resize]").boundingBox();
    const size = await heading.boundingBox();
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip.x + grip.width / 2 + 70, grip.y + grip.height / 2 + 25, { steps: 5 });
    await page.mouse.up();
    await call("settle");
    assert.ok((await heading.boundingBox()).width > size.width + 30);
    const paragraphId = await add("text");
    await drag(page.locator(`[data-native-id="${paragraphId}"]`), 100, 55);
    const buttonId = await add("button");
    await drag(page.locator(`[data-native-id="${buttonId}"]`), 100, 55);
    const imageId = await add("image");
    const image = page.locator(`[data-native-id="${imageId}"]`);
    await drag(image, 100, 55);
    const source = page.locator("[data-native-src]");
    await source.fill(ws.url + "/cart/admin/assets/products/kopi-susu.webp");
    await source.dispatchEvent("change");
    await image.evaluate(node => node.decode());
    const beforeImageMove = await call("nativeInspect");
    await drag(image, 65, 35);
    assert.ok(await image.evaluate(node => {
      const owner = node.closest('[data-sq-block]');
      return node.getBoundingClientRect().bottom <= owner.getBoundingClientRect().bottom;
    }), "A blank section grows to keep a moved image inside the page");
    const afterImageMove = await call("nativeInspect");
    await call("undo");
    assert.deepEqual(await call("nativeInspect"), beforeImageMove,
      "One undo restores both the image and the section's height");
    await call("redo");
    assert.deepEqual(await call("nativeInspect"), afterImageMove);
    await call("save");
    const saved = await call("nativeInspect");
    await page.reload();
    await page.waitForFunction(() => globalThis.EzkartBuilder);
    await call("settle");
    assert.deepEqual(await call("nativeInspect"), saved);
    for (const width of [941, 390]) {
      await page.setViewportSize({ width, height: 904 });
      await call("setDevice", { device: width === 390 ? "mobile" : "desktop" });
      await call("settle");
      const closeInspector = page.locator("[data-sq-close-inspector]");
      if (await closeInspector.isVisible()) await closeInspector.click();
      await heading.scrollIntoViewIfNeeded();
      await heading.click();
      assert.equal(await page.locator("[data-sq-native-inspector]").isVisible(), true);
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await ws.stop();
    await rm(dir, { recursive: true, force: true });
  }
});
