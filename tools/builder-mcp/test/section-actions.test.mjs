import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { Workspace } from "../workspace.mjs";

async function fixture(run) {
  const dir = await mkdtemp(join(tmpdir(), "ezkart-sections-")),
    ws = await new Workspace(dir).init();
  await ws.create({ id: "sections", name: "Section editing" });
  await ws.start();
  const browser = await chromium.launch(),
    page = await browser.newPage({
      viewport: { width: 1600, height: 1100 },
      reducedMotion: "reduce",
    }),
    errors = [];
  page.setDefaultTimeout(5000);
  page.on("pageerror", (e) => errors.push(e.message));
  const invoke = (method, args = {}) =>
    page.evaluate(({ method, args }) => EzkartBuilder[method](args), {
      method,
      args,
    });
  const section = (id) =>
    page.locator('.sq-page-preview > [data-section-id="' + id + '"]');
  const addNative = async (id, name) => {
    await invoke("addSection", { component: "blank", id });
    await invoke("nativeInsert", {
      section: id,
      node: {
        id,
        type: "container",
        name,
        props: {
          display: "block",
          width: "70%",
          marginLeft: "auto",
          marginRight: "auto",
          minHeight: "320px",
          paddingTop: "32px",
          paddingRight: "32px",
          paddingBottom: "32px",
          paddingLeft: "32px",
          backgroundColor: "#ffffff",
        },
        children: [
          {
            id: id + "-heading",
            type: "heading",
            text: name,
            props: { fontSize: "32px" },
          },
          {
            id: id + "-copy",
            type: "text",
            text: "Content inside this section.",
          },
        ],
      },
    });
  };
  const show = async (id) => {
    await section(id).evaluate((n) =>
      n.scrollIntoView({ block: "start", behavior: "instant" }),
    );
    await invoke("settle");
  };
  const clickGutter = async (id, { insideSection = false } = {}) => {
    await show(id);
    const point = await section(id).evaluate((n) => {
      const r = n.getBoundingClientRect(),
        p = n.parentElement.getBoundingClientRect();
      return {
        x: p.left + 8,
        y: r.top + 45,
        sectionLeft: r.left,
        contentLeft: r.left + parseFloat(getComputedStyle(n).paddingLeft),
      };
    });
    assert.ok(
      point.x < (insideSection ? point.contentLeft : point.sectionLeft),
      "Click is outside the section’s content box",
    );
    await page.mouse.click(point.x, point.y);
    await invoke("settle");
  };
  try {
    await page.goto(
      ws.url + "/cart/admin/?page=sites&edit=sections.ezkart.site",
    );
    await page.waitForFunction(() => globalThis.EzkartBuilder);
    await run({ page, invoke, ws, section, addNative, show, clickGutter });
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await ws.stop();
    await rm(dir, { recursive: true, force: true });
  }
}

test("tablet-width editors fit every canvas beside the inspector and keep resizing reachable", async () =>
  fixture(async ({ page, invoke }) => {
    await invoke("nativeInsert", { section: "blank", node: {
      id: "blank", type: "container", props: { minHeight: "600px" },
      children: [{ id: "wide-heading", type: "heading", text: "Edit this text",
        props: { width: "100%", height: "196px", position: "relative", top: "140px", fontSize: "48px" } }],
    } });
    const heading = page.locator('[data-native-id="wide-heading"]');
    const inspector = page.locator('.sq-inspector');
    const root = page.locator('[data-sq-preview-root]');
    for (const width of [941, 768, 1120]) {
      await page.setViewportSize({ width, height: 904 });
      for (const device of ["desktop", "tablet", "mobile"]) {
        await invoke("setDevice", { device });
        await invoke("settle");
        await heading.click({ position: { x: 12, y: 12 } });
        await invoke("settle");
        const pageBox = await root.boundingBox(), panelBox = await inspector.boundingBox();
        assert.ok(pageBox.x + pageBox.width <= panelBox.x,
          `${device} canvas stays entirely beside the inspector at ${width}px: ${JSON.stringify({ pageBox, panelBox })}`);
        assert.ok(pageBox.x >= 52, "The canvas stays to the right of the tool rail");
        const zoom = await page.locator('[data-sq-zoom-slider]').boundingBox();
        assert.ok(zoom.x >= 52 && zoom.x + zoom.width <= panelBox.x,
          "Zoom controls remain beside the inspector too");
        const grid = await page.locator('.sq-grid-quick-toggle').boundingBox();
        assert.ok(grid.y + grid.height <= 904, "Footer controls stay fully inside the viewport");
        assert.equal(await page.evaluate(() => {
          const node = document.querySelector("[data-sq-element-resize]");
          const r = node.getBoundingClientRect();
          return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === node;
        }), true, "The resize handle receives pointer input with the inspector open");
        const before = await heading.boundingBox();
        // The overlay is recreated on animation frames; read its geometry in one
        // browser operation so a detached Playwright handle cannot return null.
        const grip = await page.evaluate(() => {
          const r = document.querySelector("[data-sq-element-resize]").getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        });
        await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
        await page.mouse.down();
        await page.mouse.move(grip.x + grip.width / 2 - 45, grip.y + grip.height / 2 - 25, { steps: 5 });
        await page.mouse.up();
        await invoke("settle");
        const after = await heading.boundingBox();
        assert.ok(after.width < before.width - 15 && after.height < before.height - 10,
          `The text box shrinks in ${device} mode at ${width}px: ${JSON.stringify({before, after, grip})}`);
        await invoke("undo");
        await page.locator('[data-sq-close-inspector]').click();
        await invoke("settle");
        const closed = await root.boundingBox();
        assert.ok(closed.width >= pageBox.width, "Closing the inspector gives the canvas its space back");
      }
    }
  }));

test("short pages end at their sections, and page background never edits the section above it", async () =>
  fixture(async ({ page, invoke, section, show }) => {
    await page.setViewportSize({ width: 941, height: 904 });
    await invoke("settle");
    const root = page.locator("[data-sq-preview-root]");
    const bounds = await root.evaluate((node) => ({
      pageBottom: node.getBoundingClientRect().bottom,
      sectionBottom: node.querySelector(":scope > [data-sq-block]").getBoundingClientRect().bottom,
    }));
    assert.ok(Math.abs(bounds.pageBottom - bounds.sectionBottom) < 1,
      "A blank page has no automatic area masquerading as another section");

    // Deliberately added page space remains editable through page settings.
    await page.locator("[data-sq-page-height-handle]").focus();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    const clickPageBackground = async () => {
      await root.evaluate(node => node.scrollIntoView({ block: "end", behavior: "instant" }));
      const box = await root.boundingBox();
      await page.mouse.click(box.x + 20, box.y + box.height - 10);
      await invoke("settle");
    };
    await clickPageBackground();
    assert.equal(await page.locator('.sq-builder-sidebar.sq-panel-pinned [data-sq-panel="brand"]').isVisible(), true);
    assert.equal(await root.locator("[data-sq-block].selected").count(), 0);
    const pageColor = page.locator('[data-sq-brand-color="page"]');
    await pageColor.fill("#ffeedd");
    await pageColor.dispatchEvent("input");
    await pageColor.dispatchEvent("change");
    const background = (id) => section(id).evaluate(node => getComputedStyle(node).backgroundColor);
    assert.equal(await background("blank"), "rgb(255, 255, 255)");
    assert.equal(await root.evaluate(node => getComputedStyle(node).backgroundColor), "rgb(255, 238, 221)");
    await page.locator('[data-sq-tab="brand"]').click();

    await invoke("addSection", { component: "blank", id: "second" });
    const manager = page.locator('[data-sq-background-manager="section"]');
    const selectSection = async (id) => {
      await show(id);
      const box = await section(id).boundingBox();
      await page.mouse.click(box.x + box.width / 2, box.y + 60);
      await invoke("settle");
      assert.equal(await manager.getAttribute("data-sq-target-section"), id);
      assert.equal(await section(id).evaluate(node => node.classList.contains("selected")), true);
    };
    const setColor = async (color) => {
      const input = manager.locator("[data-sq-section-background-color]");
      await input.fill(color);
      await input.dispatchEvent("input");
      await input.dispatchEvent("change");
    };
    await selectSection("blank");
    await setColor("#d2ffe6");
    await selectSection("second");
    await setColor("#cce6ff");
    assert.equal(await background("blank"), "rgb(210, 255, 230)");
    assert.equal(await background("second"), "rgb(204, 230, 255)");
    await page.locator("[data-sq-close-inspector]").click();
    await clickPageBackground();
    await page.locator('[data-sq-tab="brand"]').focus();
    await page.keyboard.press("Delete");
    assert.equal(await root.locator(":scope > [data-sq-block]").count(), 2,
      "Page background selection cannot delete the previous section");
    await invoke("save");
    await page.reload();
    await page.waitForFunction(() => globalThis.EzkartBuilder);
    await invoke("settle");
    await selectSection("second");
    assert.equal(await background("blank"), "rgb(210, 255, 230)");
    assert.equal(await background("second"), "rgb(204, 230, 255)");
    assert.equal(await root.evaluate(node => node.style.getPropertyValue("--sq-page-extra-height")), "80px");
  }));

test("side margins select the adjacent section; closing and reopening never edits the previous background", async () =>
  fixture(
    async ({ page, invoke, ws, section, addNative, show, clickGutter }) => {
      await addNative("first", "First section");
      await addNative("second", "Second section");
      await invoke("removeSection", { id: "blank" });
      const panel = page.locator("[data-sq-native-inspector]");
      const setColor = async (color) => {
        await panel.locator("[data-native-solid-color]").fill(color);
        await panel.locator("[data-native-apply-fill]").click();
      };
      const background = (id) =>
        section(id).evaluate((n) => getComputedStyle(n).backgroundColor);
      await clickGutter("first");
      assert.equal(
        await page.locator("[data-sq-inspector-title]").textContent(),
        "First section",
      );
      await setColor("#d2ffe6");
      await page.locator("[data-sq-close-inspector]").click();
      await clickGutter("second");
      assert.equal(
        await page.locator("[data-sq-inspector-title]").textContent(),
        "Second section",
      );
      assert.equal(
        await page.locator("[data-sq-inspector-context]").textContent(),
        "Selected section",
      );
      await setColor("#e8cfff");
      assert.equal(await background("first"), "rgb(210, 255, 230)");
      assert.equal(await background("second"), "rgb(232, 207, 255)");
      await page.locator("[data-sq-close-inspector]").click();
      await clickGutter("first");
      assert.equal(
        await panel.locator("[data-native-solid-color]").inputValue(),
        "#d2ffe6",
      );
      // Closing the inspector clears its selection; the same heading can reopen it.
      const heading = section("second").locator("[data-native-type=heading]");
      await heading.click();
      await page.locator("[data-sq-close-inspector]").click();
      await heading.click();
      assert.equal(await panel.isVisible(), true);
      assert.equal(
        await panel.locator("[data-native-text]").inputValue(),
        "Second section",
      );
      // Parent navigation from an element also keeps the owning section current.
      await panel.locator("[data-native-parent]").click();
      assert.equal(
        await page.locator("[data-sq-inspector-title]").textContent(),
        "Second section",
      );
      assert.equal(
        await panel.locator("[data-native-solid-color]").inputValue(),
        "#e8cfff",
      );
      // Existing flow compositions use the same side-margin selection rule.
      await invoke("addSection", {
        component: "journey-timeline",
        id: "journey",
      });
      await clickGutter("journey", { insideSection: true });
      const manager = page.locator("[data-sq-background-manager=section]");
      assert.equal(await manager.isVisible(), true);
      assert.equal(
        await manager.getAttribute("data-sq-target-section"),
        "journey",
      );
      const color = manager.locator("[data-sq-section-background-color]");
      await color.fill("#cce6ff");
      await color.dispatchEvent("input");
      await color.dispatchEvent("change");
      assert.equal(await background("journey"), "rgb(204, 230, 255)");
      await page.locator("[data-sq-close-inspector]").click();
      await clickGutter("first");
      await setColor("#ffdecf");
      assert.equal(await background("journey"), "rgb(204, 230, 255)");
      assert.equal(await background("second"), "rgb(232, 207, 255)");
      await invoke("undo");
      assert.equal(await background("first"), "rgb(210, 255, 230)");
      await invoke("redo");
      assert.equal(await background("first"), "rgb(255, 222, 207)");
      await invoke("save");
      await page.reload();
      await page.waitForFunction(() => globalThis.EzkartBuilder);
      await invoke("settle");
      for (const [id, expected] of [
        ["first", "rgb(255, 222, 207)"],
        ["second", "rgb(232, 207, 255)"],
        ["journey", "rgb(204, 230, 255)"],
      ])
        assert.equal(await background(id), expected);
    },
  ));

test("section controls stay above content and add a blank section directly after the hovered section", async () =>
  fixture(
    async ({ page, invoke, ws, section, addNative, show, clickGutter }) => {
      await addNative("first", "First section");
      await addNative("second", "Second section");
      await invoke("addSection", { component: "hero-split", id: "grid" });
      await invoke("addSection", { component: "journey-timeline", id: "flow" });
      await invoke("removeSection", { id: "blank" });
      const tools = page.locator("[data-sq-section-tools]"),
        handle = tools.locator("[data-sq-section-height-handle]");
      assert.equal(
        await tools.locator("button").count(),
        2,
        "Only resize and Add section are present",
      );
      assert.equal(
        await tools.getByRole("button", { name: /background/i }).count(),
        0,
      );
      const hover = async (id) => {
        await show(id);
        const r = await section(id).boundingBox();
        await page.mouse.move(r.x + 12, r.y + 50);
        await page.waitForFunction(
          (id) =>
            document.querySelector("[data-sq-section-tools]").dataset
              .sectionId === id,
          id,
        );
      };
      // Shared controls cross a section boundary, above the following section.
      await clickGutter("second");
      await hover("first");
      assert.equal(
        await tools.evaluate((n) => {
          const r = n.getBoundingClientRect();
          return n.contains(
            document.elementFromPoint(r.right - 25, r.top + r.height / 2),
          );
        }),
        true,
      );
      const pinned = await page
        .locator(".sq-builder-sidebar")
        .getAttribute("class");
      await tools.locator("[data-sq-canvas-add-section]").click();
      await invoke("settle");
      let sections = (await invoke("inspect")).sections,
        added = sections[1].id;
      assert.match(added, /^blank-/);
      assert.equal(sections[0].id, "first");
      assert.equal(sections[2].id, "second");
      assert.equal(sections[1].elements.length, 0);
      assert.equal(
        await page.locator(".sq-builder-sidebar").getAttribute("class"),
        pinned,
        "Adding on the canvas does not open a sidebar",
      );
      await invoke("undo");
      assert.equal(
        (await invoke("inspect")).sections.some((s) => s.id === added),
        false,
      );
      await invoke("redo");
      assert.equal((await invoke("inspect")).sections[1].id, added);
      // Resize the blank grid section with the actual arrow and pointer capture.
      await hover(added);
      const before = (await section(added).boundingBox()).height,
        rect = await handle.boundingBox();
      await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
      await page.mouse.down();
      await page.mouse.move(
        rect.x + rect.width / 2,
        rect.y + rect.height / 2 + 90,
        { steps: 6 },
      );
      await page.mouse.up();
      await invoke("settle");
      assert.ok((await section(added).boundingBox()).height > before + 50);
      // Native and older flow sections also expose a working height control.
      for (const id of ["first", "flow"]) {
        await hover(id);
        const before = await section(id).evaluate((n) => n.offsetHeight);
        await handle.focus();
        await page.keyboard.press("ArrowDown");
        await invoke("settle");
        assert.ok(
          (await section(id).evaluate((n) => n.offsetHeight)) > before,
          "Resize " + id,
        );
      }
      await invoke("setDevice", { device: "mobile" });
      await hover("first");
      const mobileBefore = await section("first").evaluate(
        (n) => n.offsetHeight,
      );
      await handle.focus();
      await page.keyboard.press("ArrowDown");
      await invoke("settle");
      assert.ok(
        (await section("first").evaluate((n) => n.offsetHeight)) > mobileBefore,
      );
      const snapshot = await invoke("snapshot");
      assert.doesNotMatch(
        JSON.stringify(snapshot),
        /sq-canvas-section-tools|data-sq-canvas-add-section/,
      );
      await invoke("save");
      await page.reload();
      await page.waitForFunction(() => globalThis.EzkartBuilder);
      await invoke("settle");
      assert.equal((await invoke("inspect")).sections[1].id, added);
      const html = await invoke("previewHtml");
      assert.doesNotMatch(
        html,
        /data-sq-canvas-add-section|data-sq-section-tools/,
      );
      await page.route("**/section-export", (r) =>
        r.fulfill({ body: html, contentType: "text/html" }),
      );
      await page.goto(ws.url + "/section-export");
      for (const width of [390, 768, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.evaluate(async () => {
          await document.fonts.ready;
          await new Promise(requestAnimationFrame);
        });
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth),
          width,
        );
      }
    },
  ));

test("section backgrounds cover both page edges and preserve content spacing in the editor and export", async () =>
  fixture(async ({ page, invoke, ws, section, clickGutter }) => {
    for (const [component, id] of [
      ["feature-showcase", "feature"],
      ["journey-timeline", "journey"],
      ["brand-footer", "footer"],
    ])
      await invoke("addSection", { component, id });
    await invoke("removeSection", { id: "blank" });

    const checkBounds = async () => {
      const deviceFrame = page.locator(".sq-device-frame");
      if (await deviceFrame.count())
        await deviceFrame.evaluate(async (node) => {
          await Promise.all(
            node.getAnimations().map((animation) => animation.finished),
          );
        });
      const measurements = await page
        .locator(".sq-page-preview")
        .evaluate((root) => {
          const pageRect = root.getBoundingClientRect();
          const scale = pageRect.width / root.offsetWidth;
          return {
            width: root.offsetWidth,
            sections: [...root.querySelectorAll(":scope > .sq-reference")].map(
              (section) => {
                const rect = section.getBoundingClientRect();
                const content = section
                  .querySelector(
                    ":scope > .ezm-section-copy, :scope > .ezm-journey-intro, :scope > .ezm-footer-top",
                  )
                  .getBoundingClientRect();
                const fill = section
                  .querySelector(
                    ":scope > .sq-gradient-layer:not([hidden]), :scope > .sq-section-background",
                  )
                  ?.getBoundingClientRect();
                return {
                  name: section.dataset.sqSectionName,
                  left: (rect.left - pageRect.left) / scale,
                  right: (rect.right - pageRect.right) / scale,
                  contentLeft: (content.left - pageRect.left) / scale,
                  innerWidth:
                    section.clientWidth -
                    parseFloat(getComputedStyle(section).paddingLeft) -
                    parseFloat(getComputedStyle(section).paddingRight),
                  fillLeft: fill ? (fill.left - pageRect.left) / scale : 0,
                  fillRight: fill ? (fill.right - pageRect.right) / scale : 0,
                };
              },
            ),
          };
        });
      const { width } = measurements;
      const gutter =
        width <= 580
          ? 20
          : width <= 1100
            ? 32
            : Math.max(48, (width - 1200) / 2);
      for (const s of measurements.sections) {
        for (const key of ["left", "right", "fillLeft", "fillRight"])
          assert.ok(
            Math.abs(s[key]) < 1,
            `${s.name} ${key} reaches the page edge at ${width}px: ${s[key]}`,
          );
        assert.ok(
          Math.abs(s.contentLeft - gutter) < 1,
          `${s.name} content keeps its ${gutter}px inset at ${width}px`,
        );
        assert.ok(
          Math.abs(s.innerWidth - (width - gutter * 2)) < 1,
          `${s.name} content width is preserved at ${width}px`,
        );
      }
    };

    await checkBounds();
    // Selecting an empty side inset targets the full section directly.
    await clickGutter("feature", { insideSection: true });
    const manager = page.locator("[data-sq-background-manager=section]");
    assert.equal(
      await manager.getAttribute("data-sq-target-section"),
      "feature",
    );
    const color = manager.locator("[data-sq-section-background-color]");
    await color.fill("#e2efe8");
    await color.dispatchEvent("input");
    await color.dispatchEvent("change");
    await invoke("updateSection", {
      id: "journey",
      gradient: { kind: "linear", from: "#e1ebf3", to: "#e5e1f3", angle: 90 },
    });
    await clickGutter("footer", { insideSection: true });
    await manager.locator("[data-sq-section-background-type=image]").click();
    await manager
      .locator("[data-sq-background-url]")
      .fill(ws.url + "/cart/admin/assets/products/kopi-susu.webp");
    await manager.locator("[data-sq-background-apply]").click();
    await page.waitForFunction(
      () =>
        document.querySelector("#footer > .sq-section-background img")
          ?.naturalWidth > 0,
    );
    for (const device of ["mobile", "tablet", "desktop"]) {
      await invoke("setDevice", { device });
      await invoke("settle");
      await checkBounds();
    }
    await invoke("save");
    await page.reload();
    await page.waitForFunction(() => globalThis.EzkartBuilder);
    await invoke("settle");
    await checkBounds();
    assert.equal(
      await section("feature").evaluate(
        (n) => getComputedStyle(n).backgroundColor,
      ),
      "rgb(226, 239, 232)",
    );
    assert.match(
      await section("journey")
        .locator(".sq-gradient-surface")
        .evaluate((n) => getComputedStyle(n).backgroundImage),
      /linear-gradient\(90deg/,
    );

    const html = await invoke("previewHtml");
    await page.route("**/background-export", (r) =>
      r.fulfill({ body: html, contentType: "text/html" }),
    );
    await page.goto(ws.url + "/background-export");
    for (const width of [320, 390, 580, 768, 1100, 1440, 1920]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(async () => {
        await document.fonts.ready;
        // ResizeObserver and scheduled responsive layout run after the first frame.
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
      });
      await checkBounds();
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth),
        width,
        `No horizontal overflow at ${width}px`,
      );
    }
  }));
