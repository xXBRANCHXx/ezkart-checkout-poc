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
  const clickGutter = async (id) => {
    await show(id);
    const point = await section(id).evaluate((n) => {
      const r = n.getBoundingClientRect(),
        p = n.parentElement.getBoundingClientRect();
      return { x: p.left + 8, y: r.top + 45, sectionLeft: r.left };
    });
    assert.ok(
      point.x < point.sectionLeft,
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
      await clickGutter("journey");
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
      const html = await invoke("exportHtml");
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
