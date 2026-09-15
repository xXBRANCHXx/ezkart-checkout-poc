import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { Workspace } from "../workspace.mjs";

test("sidebar guides fill and word editing, validates drafts, and preserves undo and saved settings", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ezkart-inspector-test-"));
  const ws = await new Workspace(directory).init();
  await ws.create({ id: "inspector", name: "Inspector" });
  await ws.start();
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const invoke = (method, args = {}) =>
    page.evaluate(({ method, args }) => EzkartBuilder[method](args), {
      method,
      args,
    });
  try {
    await page.goto(
      ws.url + "/cart/admin/?page=sites&edit=inspector.ezkart.site",
    );
    await page.waitForFunction(() => globalThis.EzkartBuilder);
    await invoke("nativeInsert", {
      section: "blank",
      node: {
        id: "headline",
        type: "heading",
        text: "Made for your brand.",
        props: { fontSize: "48px", paddingTop: "30px", paddingBottom: "30px" },
      },
    });
    await invoke("nativeInsert", {
      section: "blank",
      node: { id: "other", type: "text", text: "Another element" },
    });
    await page.locator("[data-native-id=headline]").click();
    const panel = page.locator("[data-sq-native-inspector]");
    const field = (name) => panel.locator(`[data-native-${name}]`);
    const config = () => invoke("nativeInspect", { id: "headline" });
    assert.equal(
      await page.locator("[data-sq-inspector-title]").textContent(),
      "Heading",
    );
    assert.equal(await field("solid-controls").isVisible(), true);
    assert.equal(await field("gradient-controls").isVisible(), false);
    assert.equal(await field("apply-word-color").isDisabled(), true);
    await field("solid-color").fill("invalid-color");
    assert.equal(await field("apply-fill").isDisabled(), true);
    await field("solid-color").fill("#123456");
    assert.equal(await field("solid-picker").inputValue(), "#123456");
    await field("apply-fill").click();
    assert.equal((await config()).props.backgroundColor, "#123456");
    assert.equal(
      await page
        .locator("[data-native-id=headline]")
        .evaluate((n) => getComputedStyle(n).backgroundColor),
      "rgb(18, 52, 86)",
    );
    await invoke("undo");
    assert.equal((await config()).props.backgroundColor, undefined);
    await page.locator("[data-native-id=headline]").click();
    await field("fill-type").selectOption("gradient");
    assert.equal(await field("radial-controls").isVisible(), false);
    await field("gradient-kind").selectOption("radial");
    assert.equal(await field("linear-controls").isVisible(), false);
    assert.equal(await field("radial-controls").isVisible(), true);
    await field("gradient-x").fill("25");
    await field("gradient-y").fill("75");
    await field("gradient-shape").selectOption("circle");
    assert.equal(
      (await config()).fill?.layers?.length || 0,
      0,
      "Preview does not change the element before Apply",
    );
    const positions = panel.locator("[data-stop-position]");
    await positions.last().fill("101");
    assert.equal(await field("apply-fill").isDisabled(), true);
    await positions.last().fill("100");
    await field("add-stop").click();
    await panel.locator("[data-stop-color]").last().fill("#ff000080");
    await field("apply-fill").click();
    const fill = (await config()).fill;
    assert.deepEqual(
      fill.layers[0].stops.map((s) => s.position),
      [0, 50, 100],
    );
    assert.equal(fill.layers[0].stops[1].color, "#ff000080");
    assert.equal(fill.layers[0].x, 25);
    assert.equal(fill.layers[0].y, 75);
    assert.equal(fill.layers[0].shape, "circle");
    // Reproduce the cramped screenshot at narrow panel widths with real editor CSS.
    for (const width of [280, 295, 320]) {
      await panel.evaluate((n, width) => {
        n.style.width = `${width}px`;
      }, width);
      assert.equal(
        await panel.evaluate((n) => n.scrollWidth <= n.clientWidth),
        true,
        `Panel overflow at ${width}px`,
      );
      assert.equal(
        await positions.last().evaluate((n) => n.clientWidth >= 60),
        true,
        "100% remains readable",
      );
      assert.equal(
        await panel
          .locator("[data-stop-color]")
          .first()
          .evaluate((n) => n.clientWidth >= 95),
        true,
        "Hex colors remain readable",
      );
    }
    await panel.evaluate((n) => n.style.removeProperty("width"));
    await panel.locator(".sq-native-stop button").last().click();
    assert.equal(
      await panel.locator(".sq-native-stop button").first().isDisabled(),
      true,
    );
    await field("apply-fill").click();
    const highlight = async () =>
      field("text").evaluate((n) => {
        n.focus();
        n.setSelectionRange(14, 19);
        n.dispatchEvent(new Event("select"));
      });
    await highlight();
    assert.equal(await field("word-controls").getAttribute("open"), "");
    assert.equal(await field("apply-word-color").isEnabled(), true);
    await field("apply-word-color").click();
    assert.equal((await config()).marks[0].color, "#f44b34");
    await field("word-color").fill("#112233");
    await field("apply-word-color").click();
    assert.equal(
      (await config()).marks.length,
      1,
      "Restyling the same words replaces their previous mark",
    );
    assert.equal((await config()).marks[0].color, "#112233");
    await page.locator("[data-native-id=other]").click();
    assert.equal(
      await field("apply-word-color").isDisabled(),
      true,
      "Selection cannot leak to another element",
    );
    await page.locator("[data-native-id=headline]").click();
    await field("word-styles").locator("button").click();
    assert.equal(await field("apply-word-gradient").isEnabled(), true);
    await field("apply-word-gradient").click();
    assert.equal((await config()).marks[0].gradient[0].kind, "radial");
    await field("clear-marks").click();
    assert.deepEqual((await config()).marks, []);
    assert.equal(await field("clear-marks").isDisabled(), true);
    await invoke("undo");
    assert.equal((await config()).marks.length, 1);
    await page.locator("[data-native-id=headline]").click();
    await field("advanced").locator(":scope > summary").click();
    await field("responsive").locator(":scope > summary").click();
    await field("new-breakpoint").fill("768");
    await field("add-breakpoint").click();
    assert.equal(await field("breakpoint").inputValue(), ":768");
    await field("solid-color").fill("#abcdef");
    await field("apply-fill").click();
    assert.equal(
      (await config()).responsive[0].props.backgroundColor,
      "#abcdef",
    );
    assert.equal(
      (await config()).fill.layers[0].kind,
      "radial",
      "Screen-size override preserves the base fill",
    );
    await invoke("save");
    await page.reload();
    await page.waitForFunction(() => globalThis.EzkartBuilder);
    assert.equal(
      (await config()).responsive[0].props.backgroundColor,
      "#abcdef",
    );
    assert.equal((await config()).marks.length, 1);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await ws.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
