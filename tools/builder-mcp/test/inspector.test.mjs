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
    await panel.locator("[data-native-breakpoint]").selectOption("base");
    const field = (name) => panel.locator(`[data-native-${name}]`);
    const config = () => invoke("nativeInspect", { id: "headline" });
    assert.equal(
      await page.locator("[data-sq-inspector-title]").textContent(),
      "Heading",
    );
    assert.equal(await field("solid-controls").isVisible(), true);
    assert.equal(await field("gradient-controls").isVisible(), false);
    assert.equal(await field("apply-word-style").isDisabled(), true);
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
    assert.equal(await field("apply-word-style").isEnabled(), true);
    await field("apply-word-style").click();
    assert.equal(
      (await config()).marks[0].color,
      await field("word-color-value").inputValue(),
    );
    await field("word-color").fill("#112233");
    await field("apply-word-style").click();
    assert.equal(
      (await config()).marks.length,
      1,
      "Restyling the same words replaces their previous mark",
    );
    assert.equal((await config()).marks[0].color, "#112233");
    await page.locator("[data-native-id=other]").click();
    assert.equal(
      await field("apply-word-style").isDisabled(),
      true,
      "Selection cannot leak to another element",
    );
    await page.locator("[data-native-id=headline]").click();
    await field("word-styles").locator("button").click();
    assert.equal(await field("apply-word-style").isEnabled(), true);
    await field("word-type").selectOption("gradient");
    await panel.locator("[data-word-gradient-kind]").selectOption("radial");
    await field("apply-word-style").click();
    assert.equal((await config()).marks[0].gradient[0].kind, "radial");
    await field("clear-marks").click();
    assert.deepEqual((await config()).marks, []);
    assert.equal(await field("clear-marks").isVisible(), false);
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

test("saved word gradients show their actual appearance and edit independently of the element background", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ezkart-word-colors-"));
  const ws = await new Workspace(directory).init();
  await ws.create({ id: "word-colors", name: "Word colors" });
  await ws.start();
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
    reducedMotion: "reduce",
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const invoke = (method, args = {}) =>
    page.evaluate(({ method, args }) => EzkartBuilder[method](args), {
      method,
      args,
    });
  try {
    await page.goto(
      ws.url + "/cart/admin/?page=sites&edit=word-colors.ezkart.site",
    );
    await page.waitForFunction(() => globalThis.EzkartBuilder);
    const text = "Produkmu. Tempat jualan milikmu.";
    const gradient = [
      {
        kind: "linear",
        angle: 105,
        stops: [
          { color: "#fa6418", position: 0 },
          { color: "#ed1467", position: 100 },
        ],
      },
    ];
    await invoke("nativeInsert", {
      section: "blank",
      node: {
        id: "words",
        type: "heading",
        text,
        props: {
          fontSize: "48px",
          paddingTop: "30px",
          paddingBottom: "30px",
          backgroundColor: "#eeeeee",
        },
        marks: [
          { start: 0, end: 9, color: "#123456", weight: "700" },
          {
            start: text.indexOf("milikmu."),
            end: text.length,
            gradient,
            italic: true,
          },
        ],
      },
    });
    await page.locator("[data-native-id=words]").click();
    const panel = page.locator("[data-sq-native-inspector]");
    const field = (name) => panel.locator(`[data-native-${name}]`);
    const config = () => invoke("nativeInspect", { id: "words" });
    await field("word-controls").locator(":scope > summary").click();
    assert.equal(
      await field("word-editor").isVisible(),
      false,
      "No unselected solid picker is shown beside a saved gradient",
    );
    const gradientPhrase = () =>
      field("word-styles").getByRole("button", {
        name: /milikmu.*Edit gradient/,
      });
    assert.match(
      await gradientPhrase()
        .locator(".sq-word-swatch")
        .evaluate((n) => n.style.background),
      /linear-gradient\(105deg/,
    );
    await gradientPhrase().click();
    assert.equal(await field("word-solid").isVisible(), false);
    assert.equal(await field("word-gradient").isVisible(), true);
    assert.equal(
      await panel
        .getByRole("button", { name: "Color style: Gradient", exact: true })
        .isVisible(),
      true,
      "The visible custom dropdown agrees with the loaded gradient",
    );
    assert.equal(await field("word-preview").textContent(), "milikmu.");
    assert.match(
      await field("word-preview").evaluate((n) => n.style.backgroundImage),
      /linear-gradient\(105deg.*rgb\(250, 100, 24\).*rgb\(237, 20, 103\)/,
    );
    assert.equal(
      await field("fill-type").inputValue(),
      "solid",
      "Choosing a phrase leaves element controls alone",
    );
    for (const width of [280, 295, 320]) {
      await panel.evaluate((n, width) => (n.style.width = `${width}px`), width);
      assert.equal(
        await panel.evaluate((n) => n.scrollWidth <= n.clientWidth),
        true,
        `Word editor fits ${width}px`,
      );
    }
    await panel.evaluate((n) => n.style.removeProperty("width"));
    // Exercise the visible dropdown, including its keyboard behavior.
    await panel
      .getByRole("button", {
        name: "Gradient direction: Straight",
        exact: true,
      })
      .click();
    await page
      .getByRole("option", { name: "From a center", exact: true })
      .click();
    assert.equal(await panel.locator("[data-word-radial]").isVisible(), true);
    await panel.locator("[data-word-gradient-x]").fill("25");
    await panel
      .locator(".sq-word-stop [data-stop-color]")
      .first()
      .fill("#00aa88");
    await panel
      .locator(".sq-word-stop [data-stop-position]")
      .last()
      .fill("101");
    assert.equal(await field("apply-word-style").isDisabled(), true);
    await panel
      .locator(".sq-word-stop [data-stop-position]")
      .last()
      .fill("100");
    await field("apply-word-style").click();
    let saved = await config();
    assert.equal(saved.props.backgroundColor, "#eeeeee");
    assert.equal(saved.fill, undefined);
    assert.equal(saved.marks[0].color, "#123456");
    assert.equal(saved.marks[0].weight, "700");
    assert.equal(saved.marks[1].italic, true);
    assert.equal(saved.marks[1].gradient[0].x, 25);
    assert.equal(saved.marks[1].gradient[0].stops[0].color, "#00aa88");
    await invoke("save");
    await page.reload();
    await page.waitForFunction(() => globalThis.EzkartBuilder);
    await page.locator("[data-native-id=words]").click();
    await field("word-controls").locator(":scope > summary").click();
    await gradientPhrase().click();
    assert.equal(
      await panel
        .getByRole("button", { name: "Color style: Gradient", exact: true })
        .isVisible(),
      true,
    );
    assert.equal(
      await panel
        .getByRole("button", {
          name: "Gradient direction: From a center",
          exact: true,
        })
        .isVisible(),
      true,
    );
    await field("word-styles")
      .getByRole("button", { name: /Produkmu.*Edit color/ })
      .click();
    assert.equal(await field("word-color-value").inputValue(), "#123456");
    assert.equal(await field("word-gradient").isVisible(), false);
    assert.equal(
      await panel
        .getByRole("button", { name: "Color style: Solid color", exact: true })
        .isVisible(),
      true,
    );
    // A range with different existing colors must not claim to be one solid color.
    await field("text").evaluate((n) => {
      n.focus();
      n.setSelectionRange(0, n.value.length);
      n.dispatchEvent(new Event("select"));
    });
    assert.equal(await field("word-type").inputValue(), "mixed");
    assert.equal(
      await panel
        .getByRole("button", { name: "Color style: Mixed colors", exact: true })
        .isVisible(),
      true,
    );
    assert.equal(await field("word-solid").isVisible(), false);
    assert.equal(await field("apply-word-style").isDisabled(), true);
    await panel
      .getByRole("button", { name: "Color style: Mixed colors", exact: true })
      .focus();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    assert.equal(await field("word-type").inputValue(), "gradient");
    await field("reset-word-style").click();
    saved = await config();
    assert.equal(saved.marks[0].weight, "700");
    assert.equal(saved.marks.at(-1).italic, true);
    assert.equal(
      saved.marks.some((mark) => mark.color || mark.gradient),
      false,
      "Resetting colors preserves bold and italic formatting",
    );
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await ws.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
