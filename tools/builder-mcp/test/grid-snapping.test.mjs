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
    const snapping = await page.locator('[data-sq-snap-to-grid]').isChecked();
    const hint = page.locator('[data-sq-drag-snap-hint]');
    assert.equal(await hint.isVisible(), false, 'The drag hint is hidden at rest');
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
    assert.equal(await hint.isVisible(), true);
    assert.equal(await hint.textContent(), !snapping ? 'Snapping off' : alt ? 'Snapping off (Alt)' : 'Hold Alt to disable snapping');
    const overlay = await page.locator(".sq-element-overlay").boundingBox();
    assert.ok(
      Math.abs(during.x - overlay.x) < 1 &&
        Math.abs(during.width - overlay.width) < 1,
      "Selection follows the element during dragging",
    );
    await page.mouse.up();
    assert.equal(await hint.isVisible(), false, 'Releasing the pointer hides the hint');
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
    if (alt || !snapping)
      assert.ok(
        Math.abs(errorX) > 1,
        "Disabled snapping allows a position between grid lines",
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
    const desktopProps = config => ({ ...config.props, ...config.responsive?.find(rule => rule.device === "desktop")?.props });
    const before = await invoke("nativeInspect", { id: "box" });
    await drag(node, grid.locator("i").nth(12 * 3 + 2));
    const moved = await invoke("nativeInspect", { id: "box" });
    assert.notEqual(desktopProps(moved).left, desktopProps(before).left);
    await invoke("undo");
    assert.equal(
      desktopProps(await invoke("nativeInspect", { id: "box" })).left,
      desktopProps(before).left,
    );
    await invoke("redo");
    assert.equal(
      desktopProps(await invoke("nativeInspect", { id: "box" })).left,
      desktopProps(moved).left,
    );
    await select(node);
    await drag(node, grid.locator("i").nth(12 * 7 + 4), true);
    const resized = await invoke("nativeInspect", { id: "box" });
    await page.locator("[data-sq-element-move]").focus();
    await page.keyboard.press("ArrowRight");
    assert.equal(
      parseFloat(desktopProps(await invoke("nativeInspect", { id: "box" })).left),
      parseFloat(desktopProps(resized).left) + 1,
      "Native keyboard movement saves native position",
    );
    await invoke("undo");
    await invoke("save");
    await page.reload();
    await page.waitForFunction(() => globalThis.EzkartBuilder);
    await settle();
    assert.deepEqual(
      await invoke("nativeInspect", { id: "box" }),
      resized,
    );
    await invoke("removeSection", { id: "blank" });
    const html = await invoke("previewHtml");
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
      desktopProps(resized).left,
    );
    assert.equal(
      await node.evaluate((n) => getComputedStyle(n).width),
      desktopProps(resized).width,
    );
  }));

test("snapping preference persists independently of grid visibility and the hint only appears during a drag", async () =>
  fixture(async ({ page, invoke, settle, select, drag }) => {
    await invoke('nativeInsert', {
      section: 'blank',
      node: {
        id: 'snap-preference', type: 'container',
        props: { position: 'relative', minHeight: '720px', paddingTop: '40px', paddingRight: '40px', paddingBottom: '40px', paddingLeft: '40px' },
        children: [{
          id: 'free-box', type: 'button', text: 'Drag me',
          props: { position: 'absolute', left: '17px', top: '13px', width: '180px', height: '80px', backgroundColor: '#d9ece4' },
        }],
      },
    });
    const node = page.locator('[data-native-id="free-box"]');
    const hint = page.locator('[data-sq-drag-snap-hint]');
    const grid = page.locator('[data-section-id="blank"] > .sq-layout-grid-overlay');
    const settings = page.getByRole('button', { name: 'Grid settings', exact: true });
    const snapping = page.getByRole('checkbox', { name: 'Snap to grid', exact: true });
    const visibility = page.getByRole('checkbox', { name: 'Show grid', exact: true });
    const close = page.getByRole('button', { name: 'Close grid settings', exact: true });
    await select(node);
    assert.equal(await hint.isVisible(), false);
    await settings.click();
    assert.equal(await snapping.isChecked(), true);
    assert.equal(await page.locator('#sq-grid-settings').getByText(/Hold Alt/).count(), 0);
    await snapping.uncheck();
    assert.equal(await visibility.isChecked(), true, 'Snapping can be off while the grid is visible');
    if (process.env.EZKART_GRID_SCREENSHOTS) await page.screenshot({ path: join(process.env.EZKART_GRID_SCREENSHOTS, 'grid-settings.png') });
    await close.click();
    await drag(node, grid.locator('i').nth(12 * 3 + 2));
    const moved = await invoke('nativeInspect', { id: 'free-box' });
    await invoke('undo');
    assert.notDeepEqual(await invoke('nativeInspect', { id: 'free-box' }), moved);
    await invoke('redo');
    assert.deepEqual(await invoke('nativeInspect', { id: 'free-box' }), moved);
    await select(node);
    await drag(node, grid.locator('i').nth(12 * 7 + 4), true);
    const resized = await invoke('nativeInspect', { id: 'free-box' });
    await invoke('save');
    await page.reload();
    await page.waitForFunction(() => globalThis.EzkartBuilder);
    await settle();
    assert.deepEqual(await invoke('nativeInspect', { id: 'free-box' }), resized);
    await settings.click();
    assert.equal(await snapping.isChecked(), false, 'Reopening remembers the snapping preference');
    await visibility.uncheck();
    assert.equal(await snapping.isChecked(), false);
    await visibility.check();
    await snapping.check();
    await close.click();
    await select(node);
    await drag(node, grid.locator('i').nth(12 * 2 + 1));

    for (const width of [1600, 900]) {
      await page.setViewportSize({ width, height: 1000 });
      await select(node);
      const start = await node.boundingBox();
      await page.mouse.move(start.x + 20, start.y + 20);
      await page.mouse.down();
      assert.equal(await hint.isVisible(), false, 'A click does not show a drag hint');
      await page.mouse.move(start.x + 43, start.y + 39, { steps: 4 });
      assert.equal(await hint.textContent(), 'Hold Alt to disable snapping');
      assert.equal(await hint.isVisible(), true, 'Dragging the object directly shows the hint');
      await page.keyboard.down('Alt');
      assert.equal(await hint.textContent(), 'Snapping off (Alt)');
      await page.mouse.move(start.x + 49, start.y + 46);
      const free = await node.boundingBox();
      assert.ok(Math.abs(free.x - start.x - 29) < 1 && Math.abs(free.y - start.y - 26) < 1, 'Alt follows the pointer between grid lines');
      await page.keyboard.up('Alt');
      assert.equal(await hint.textContent(), 'Hold Alt to disable snapping');
      const box = await hint.boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= width && box.y >= 0 && box.y + box.height <= 1000, 'The drag hint fits the viewport');
      if (process.env.EZKART_GRID_SCREENSHOTS) await page.screenshot({ path: join(process.env.EZKART_GRID_SCREENSHOTS, `drag-hint-${width}.png`) });
      await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointercancel')));
      assert.equal(await hint.isVisible(), false, 'Cancelling a drag hides the hint');
      await page.mouse.up();
      await page.keyboard.press('Alt');
      assert.equal(await hint.isVisible(), false, 'Alt at rest cannot bring the hint back');
      await settle();
    }
  }));

test("flow elements use the visible grid at each device size and hidden guides stay hidden after reopening", async () =>
  fixture(async ({ page, invoke, settle, select, drag }) => {
    await invoke("addSection", {
      component: "feature-showcase",
      id: "feature",
    });
    const node = page.locator("#feature > .ezm-section-copy");
    await select(node);
    const positionBeforeTabs = await node.getAttribute("data-flow-desktop");
    await page.locator('[data-sq-element-tab="content"]').focus();
    await page.keyboard.press("ArrowRight");
    assert.equal(
      await page
        .locator('[data-sq-element-tab="style"]')
        .getAttribute("aria-selected"),
      "true",
    );
    assert.equal(
      await node.getAttribute("data-flow-desktop"),
      positionBeforeTabs,
      "Keyboard tab navigation must not move the selected element",
    );
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
    await page.getByRole('button', { name: 'Grid settings', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Snap to grid', exact: true }).uncheck();
    await page.getByRole('button', { name: 'Close grid settings', exact: true }).click();
    await drag(node, grid.locator('i').nth(12 * 3));
    await drag(node, grid.locator('i').nth(12 * 6 + 5), true);
  }));

test('older grid elements support free dragging, resizing, responsive persistence and export', async () =>
  fixture(async ({ page, invoke, settle, select, drag, ws }) => {
    await invoke('addElement', { section: 'blank', type: 'image', id: 'legacy-image' });
    await invoke('updateElement', { id: 'legacy-image', layout: { x: 2, y: 2, width: 3, height: 3 } });
    const node = page.locator('[data-sq-element-id="legacy-image"]');
    assert.equal(await node.evaluate(n => n.classList.contains('sq-native')), false);
    await select(node);
    const grid = page.locator('[data-section-id="blank"] > .sq-layout-grid-overlay');
    await drag(node, grid.locator('i').nth(12 * 2 + 3));
    await drag(node, grid.locator('i').nth(12 * 3 + 2), false, true);
    const position = await node.getAttribute('data-flow-desktop');
    await invoke('undo');
    assert.equal(await node.getAttribute('data-flow-desktop'), null);
    await invoke('redo');
    assert.equal(await node.getAttribute('data-flow-desktop'), position);
    await select(node);
    await page.getByRole('button', { name: 'Grid settings', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Snap to grid', exact: true }).uncheck();
    await page.getByRole('button', { name: 'Close grid settings', exact: true }).click();
    const start = await node.boundingBox();
    await page.mouse.move(start.x + 20, start.y + 20);
    await page.mouse.down();
    await page.mouse.move(start.x + 37, start.y + 43, { steps: 4 });
    assert.equal(await page.locator('[data-sq-drag-snap-hint]').textContent(), 'Snapping off');
    const during = await node.boundingBox();
    assert.ok(Math.abs(during.x - start.x - 17) < 1 && Math.abs(during.y - start.y - 23) < 1, JSON.stringify({start, during}));
    await page.mouse.up();
    await settle();
    await drag(node, grid.locator('i').nth(12 * 3 + 5), true);
    const resized = await node.getAttribute('data-flow-desktop');
    await invoke('setDevice', { device: 'mobile' });
    assert.equal(await node.evaluate(n => n.style.getPropertyValue('--sq-flow-width')), '');
    await invoke('setDevice', { device: 'desktop' });
    await invoke('save');
    await page.reload();
    await page.waitForFunction(() => globalThis.EzkartBuilder);
    await settle();
    assert.equal(await node.getAttribute('data-flow-desktop'), resized);
    await select(node);
    await page.getByRole('button', { name: 'Grid settings', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Snap to grid', exact: true }).check();
    await page.getByRole('button', { name: 'Close grid settings', exact: true }).click();
    await drag(node, grid.locator('i').nth(12 * 2 + 1));
    await drag(node, grid.locator('i').nth(12 * 3 + 4), true);
    const saved = JSON.parse(await node.getAttribute('data-flow-desktop'));
    const bounds = await node.boundingBox(), sectionBounds = await page.locator('.sq-page-preview > [data-section-id="blank"]').boundingBox();
    assert.ok(bounds.y + bounds.height <= sectionBounds.y + sectionBounds.height + 1, 'The section grows to keep freely positioned content visible');
    if (process.env.EZKART_GRID_SCREENSHOTS) await page.screenshot({ path: join(process.env.EZKART_GRID_SCREENSHOTS, 'legacy-grid.png') });
    const html = await invoke('previewHtml');
    assert.doesNotMatch(html, /data-sq-drag-snap-hint/);
    await page.route('**/legacy-grid-export', route => route.fulfill({ body: html, contentType: 'text/html' }));
    await page.goto(ws.url + '/legacy-grid-export');
    const exported = page.locator('[data-ezkart-element="legacy-image"]');
    const appearance = await exported.evaluate(n => ({ width: n.getBoundingClientRect().width, height: n.getBoundingClientRect().height, translate: getComputedStyle(n).translate }));
    assert.ok(Math.abs(appearance.width - saved.width) < 1);
    assert.ok(Math.abs(appearance.height - saved.height) < 1);
    const [x, y] = appearance.translate.split(' ').map(parseFloat);
    assert.ok(Math.abs(x - saved.x) < 0.01 && Math.abs((y || 0) - saved.y) < 0.01);
    await page.setViewportSize({ width: 390, height: 900 });
    assert.equal(await exported.evaluate(n => getComputedStyle(n).translate), '0px');
  }));

test("grid settings change the rendered snap cells, persist across devices and stay below content", async () =>
  fixture(async ({ page, invoke, settle, select, drag }) => {
    await invoke("nativeInsert", {
      section: "blank",
      node: {
        id: "blank",
        type: "container",
        props: {
          minHeight: "700px",
          backgroundColor: "#f7f0d8",
          paddingTop: "40px",
          paddingLeft: "40px",
          paddingRight: "40px",
        },
        children: [
          {
            id: "content",
            type: "button",
            text: "Content above the grid",
            props: {
              width: "300px",
              height: "120px",
              backgroundColor: "#153e70",
              color: "#fff",
            },
          },
        ],
      },
    });
    const node = page.locator("[data-native-id=content]");
    await select(node);
    const grid = page.locator(
      "[data-section-id=blank] > .sq-layout-grid-overlay",
    );
    const paintOrder = async (content, guides) => {
      // Hit testing reflects paint order when guides temporarily accept events.
      await guides.evaluate((n) =>
        n.style.setProperty("pointer-events", "auto", "important"),
      );
      const top = await content.evaluate((n) => {
        const r = n.getBoundingClientRect();
        return n.contains(
          document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2),
        );
      });
      assert.ok(top, "Content paints above the grid");
      await guides.evaluate((n) => n.style.removeProperty("pointer-events"));
    };
    await paintOrder(node, grid);
    const button = page.getByRole("button", {
      name: "Grid settings",
      exact: true,
    });
    const panel = page.getByRole("dialog", {
      name: "Grid settings",
      exact: true,
    });
    await button.click();
    assert.ok(await panel.isVisible());
    const set = async (selector, value) => {
      const input = panel.locator(selector);
      await input.fill(String(value));
      await input.dispatchEvent("change");
      await settle();
    };
    const density = panel.locator("[data-sq-grid-density]");
    await density.focus();
    await page.keyboard.press("ArrowRight");
    assert.equal(
      await grid.evaluate(
        (n) => getComputedStyle(n).gridTemplateColumns.split(" ").length,
      ),
      16,
    );
    await set("[data-sq-grid-cell-width]", 150);
    assert.equal(
      await panel.locator("[data-sq-grid-density-output]").textContent(),
      "Custom",
    );
    await set("[data-sq-grid-cell-height]", 38);
    await set("[data-sq-page-column-gap]", 20);
    const geometry = () =>
      grid.evaluate((n) => {
        const s = getComputedStyle(n);
        return {
          columns: s.gridTemplateColumns,
          rows: s.gridTemplateRows,
          gap: s.gap,
        };
      });
    const saved = await geometry();
    const sectionBox = await page
      .locator("[data-sq-block][data-section-id=blank]")
      .boundingBox();
    const gridBox = await grid.boundingBox();
    assert.ok(
      gridBox.y + gridBox.height <= sectionBox.y + sectionBox.height + 1,
      "The grid stays inside its section",
    );
    assert.equal(saved.gap, "20px");
    assert.ok(Math.abs(parseFloat(saved.rows) - 38) < 0.1);
    await invoke("undo");
    assert.equal((await geometry()).gap, "10px");
    await invoke("redo");
    await page.keyboard.press("Escape");
    assert.equal(await panel.isVisible(), false);
    await select(node);
    const columns = saved.columns.split(" ").length;
    await drag(node, grid.locator("i").nth(columns * 3 + 1));
    await invoke("save");
    await page.reload();
    await page.waitForFunction(() => globalThis.EzkartBuilder);
    await select(node);
    assert.deepEqual(await geometry(), saved);
    await invoke("setDevice", { device: "mobile" });
    await settle();
    assert.ok(Math.abs(parseFloat((await geometry()).rows) - 24) < 0.1);
    assert.equal((await geometry()).gap, "20px");
    await invoke("setDevice", { device: "desktop" });
    await settle();
    await button.click();
    await panel.getByRole("button", { name: "Reset grid" }).click();
    assert.ok(Math.abs(parseFloat((await geometry()).rows) - 24) < 0.1);
    assert.equal((await geometry()).gap, "10px");
    assert.equal(
      await page
        .locator("[data-sq-block][data-section-id=blank]")
        .evaluate((n) => getComputedStyle(n).paddingLeft),
      "40px",
      "Resetting the grid preserves section padding",
    );
    await panel.getByRole("button", { name: "Close grid settings" }).click();

    await invoke("addSection", {
      component: "feature-showcase",
      id: "flow-layer",
    });
    const copy = page.locator("#flow-layer .ezm-section-copy");
    await select(copy);
    await paintOrder(
      copy,
      page.locator("#flow-layer > .sq-layout-grid-overlay"),
    );

    await invoke("addSection", { component: "blank", id: "gradient-layer" });
    await invoke("updateSection", {
      id: "gradient-layer",
      gradient: { kind: "linear", from: "#ffe0bb", to: "#bbcaff" },
    });
    await invoke("addElement", {
      section: "gradient-layer",
      type: "button",
      id: "above-gradient",
    });
    await invoke("updateElement", {
      id: "above-gradient",
      text: "Above grid and gradient",
      layout: { x: 1, y: 1, width: 4, height: 2 },
    });
    const fluidContent = page.locator('[data-sq-element-id="above-gradient"]');
    await select(fluidContent);
    const fluidGrid = page.locator(
      '[data-section-id="gradient-layer"] > .sq-layout-grid-overlay',
    );
    await paintOrder(fluidContent, fluidGrid);
    await fluidGrid.evaluate((n) =>
      n.style.setProperty("pointer-events", "auto", "important"),
    );
    const empty = fluidGrid.locator("i").nth(10);
    assert.ok(
      await empty.evaluate((n) => {
        const r = n.getBoundingClientRect();
        return (
          document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === n
        );
      }),
      "Grid remains visible above the section gradient in empty space",
    );
  }));
