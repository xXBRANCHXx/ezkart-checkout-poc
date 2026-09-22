import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { Workspace } from "../workspace.mjs";

test("setting help explains every field, loads pictures, preserves edits and works with keyboard and narrow screens", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ezkart-help-"));
  const ws = await new Workspace(dir).init();
  await ws.create({ id: "help", name: "Setting help" });
  await ws.start();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const call = (method, args = {}) => page.evaluate(({ method, args }) => EzkartBuilder[method](args), { method, args });
  const artifacts = process.env.EZKART_HELP_ARTIFACTS;
  if (artifacts) await mkdir(artifacts, { recursive: true });
  try {
    await page.goto(ws.url + "/cart/admin/?page=sites&edit=help.ezkart.site");
    await page.waitForFunction(() => globalThis.EzkartBuilder);
    await call("nativeInsert", { section: "blank", node: { id: "help-heading", type: "heading", text: "Common questions" } });
    await page.locator('[data-native-id="help-heading"]').click();
    const panel = page.locator("[data-sq-native-inspector]");
    await panel.locator("[data-native-advanced] > summary").click();
    await panel.locator("[data-native-structure] > summary").click();
    await panel.locator("[data-native-state-controls] > summary").click();
    await panel.locator('[data-native-group="Position"] > summary').click();
    const before = await call("nativeInspect");
    const keys = await page.evaluate(() => Object.keys(EzkartBuilderHelp.topics));
    assert.equal(keys.length, 29);
    const dialog = page.locator(".sq-setting-help-dialog");
    const checked = [];
    for (const key of keys) {
      const info = panel.locator(`[data-setting-help="${key}"]`);
      assert.equal(await info.count(), 1, `${key} has one info button`);
      if (!(await info.isVisible())) {
        assert.ok(["table-scope", "open"].includes(key), "Only table headers and accordions need a different selection");
        continue;
      }
      await info.click();
      assert.equal(await dialog.isVisible(), true);
      assert.equal(await dialog.locator("ol > li").count(), 3);
      assert.equal(await dialog.locator("#sq-setting-help-example").isVisible(), false);
      const toggle = dialog.getByRole("button", { name: "See example" });
      await toggle.click();
      await dialog.locator("img").evaluate(img => img.decode());
      assert.equal(await dialog.locator("img").evaluate(img => img.naturalWidth), 960);
      assert.ok((await dialog.locator("figcaption").textContent()).length > 35);
      // These keys normally delete, undo, or move the selected canvas element.
      for (const key of ["Delete", "Backspace", "ArrowDown", "Control+z"]) await page.keyboard.press(key);
      await page.keyboard.press("Escape");
      assert.equal(await dialog.isVisible(), false);
      assert.equal(await info.evaluate(node => node === document.activeElement), true);
      checked.push(key);
    }
    assert.equal(checked.length, 27);
    assert.deepEqual(await call("nativeInspect"), before, "Help leaves the canvas and history unchanged");
    assert.equal(await panel.locator("[data-native-collapsed]").isChecked(), false, "Checkbox help never toggles the setting");

    // Normal field editing and accessible-label relocation still work.
    await panel.locator("[data-native-name]").fill("Shipping FAQ");
    await panel.locator("[data-native-name]").blur();
    await panel.locator("[data-native-alt]").fill("Common shipping questions");
    await panel.locator("[data-native-alt]").blur();
    const updated = await call("nativeInspect", { id: "help-heading" });
    assert.equal(updated.name, "Shipping FAQ");
    assert.equal(updated.label, "Common shipping questions");
    await call("nativeInsert", { section: "blank", node: { id: "help-image", type: "image", src: ws.url + "/cart/admin/assets/products/kopi-susu.webp", alt: "Coffee bottle" } });
    await page.locator('[data-native-id="help-image"]').click();
    assert.equal(await panel.locator('[data-native-content] [data-setting-help="alt"]').count(), 1);
    assert.match(await panel.locator("[data-native-alt]").evaluate(input => input.labels[0].textContent), /Image description/);
    await page.locator('[data-native-id="help-heading"]').click();
    assert.equal(await panel.locator('[data-native-structure] [data-setting-help="alt"]').count(), 1);

    for (const width of [1440, 941, 390, 320]) {
      await page.setViewportSize({ width, height: 904 });
      await call("settle");
      const closeInspector = page.locator("[data-sq-close-inspector]");
      if (await closeInspector.isVisible()) await closeInspector.click();
      await page.locator('[data-native-id="help-heading"]').scrollIntoViewIfNeeded();
      await page.locator('[data-native-id="help-heading"]').click();
      for (const selector of ["[data-native-advanced]", '[data-native-group="Position"]']) {
        const details = panel.locator(selector);
        if (!(await details.evaluate(node => node.open))) await details.locator(":scope > summary").click();
      }
      const info = panel.locator('[data-setting-help="position"]');
      await info.scrollIntoViewIfNeeded();
      if (artifacts) await page.screenshot({ path: join(artifacts, `inspector-${width}.png`) });
      await info.focus();
      await page.keyboard.press("Enter");
      assert.equal(await dialog.isVisible(), true);
      const toggle = dialog.getByRole("button", { name: "See example" });
      await toggle.focus();
      await page.keyboard.press("Space");
      await dialog.locator("img").evaluate(img => img.decode());
      const box = await dialog.boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= width, `Dialog fits at ${width}px`);
      assert.equal(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1), true);
      if (artifacts) await page.screenshot({ path: join(artifacts, `example-${width}.png`) });
      await dialog.getByRole("button", { name: "Hide example" }).click();
      assert.equal(await dialog.locator("#sq-setting-help-example").isVisible(), false);
      // Native modal focus stays within the help controls.
      for (let i = 0; i < 3; i++) await page.keyboard.press("Tab");
      assert.equal(await dialog.evaluate(node => node.contains(document.activeElement)), true);
      await dialog.getByRole("button", { name: "Close setting help" }).click();
      assert.equal(await info.evaluate(node => node === document.activeElement), true);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await call("nativeInsert", { section: "blank", node: { id: "help-accordion", type: "accordion", children: [{ id: "help-question", type: "summary", text: "Shipping" }, { id: "help-answer", type: "text", text: "Orders ship in 2–3 days." }] } });
    await page.locator('[data-native-id="help-question"]').click();
    await panel.locator("[data-native-parent]").click();
    await panel.locator('[data-setting-help="open"]').click();
    await dialog.getByRole("button", { name: "See example" }).click();
    await dialog.locator("img").evaluate(img => img.decode());
    await page.keyboard.press("Escape");
    await call("nativeInsert", { section: "blank", node: { id: "help-table", type: "container", tag: "table", children: [{ id: "help-row", type: "container", tag: "tr", children: [{ id: "help-cell", type: "text", tag: "th", text: "Price" }] }] } });
    await page.locator('[data-native-id="help-cell"]').click();
    await panel.locator('[data-setting-help="table-scope"]').click();
    await dialog.getByRole("button", { name: "See example" }).click();
    await dialog.locator("img").evaluate(img => img.decode());
    await page.keyboard.press("Escape");
    await call("save");
    const saved = await call("nativeInspect");
    await page.reload();
    await page.waitForFunction(() => globalThis.EzkartBuilder);
    assert.deepEqual(await call("nativeInspect"), saved);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await ws.stop();
    await rm(dir, { recursive: true, force: true });
  }
});
