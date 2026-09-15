import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { Workspace } from "../workspace.mjs";
test("native inspector creates editable word gradients, layered button fills, nested layout, responsive export and interactions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ezkart-native-test-"));
  const ws = await new Workspace(directory).init();
  await ws.create({ id: "native", name: "Native controls" });
  await ws.start();
  const browser = await chromium.launch(),
    page = await browser.newPage({
      viewport: { width: 1600, height: 1000 },
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
    await page.goto(ws.url + "/cart/admin/?page=sites&edit=native.ezkart.site");
    await page.waitForFunction(() => globalThis.EzkartBuilder);
    await page.locator("[data-sq-tab=add]").click();
    await page.locator("[data-sq-add-element=native-heading]").click();
    let nodes = await invoke("nativeInspect");
    const heading = nodes.find((n) => n.type === "heading");
    assert.ok(heading, "Add panel creates a native heading");
    await page.locator(`[data-native-id="${heading.id}"]`).click();
    const panel = page.locator("[data-sq-native-inspector]");
    await panel.locator("[data-native-text]").fill("Made for your brand.");
    await panel.locator("[data-native-text]").dispatchEvent("change");
    await panel.locator("[data-native-text]").evaluate((n) => {
      n.focus();
      n.setSelectionRange(14, 19);
      n.dispatchEvent(new Event("select"));
    });
    await panel.locator("[data-native-word-type]").selectOption("gradient");
    await panel.locator("[data-native-apply-word-style]").click();
    let config = await invoke("nativeInspect", { id: heading.id });
    assert.equal(config.marks[0].start, 14);
    assert.equal(config.marks[0].gradient.length, 1);
    await panel
      .locator("[data-native-text]")
      .fill("Made for your brand. Today.");
    await panel.locator("[data-native-text]").dispatchEvent("change");
    assert.equal(
      (await invoke("nativeInspect", { id: heading.id })).marks[0].start,
      14,
    );
    await invoke("undo");
    await invoke("nativeInsert", {
      section: "blank",
      node: {
        id: "row",
        type: "container",
        props: {
          display: "flex",
          gap: "24px",
          paddingTop: "32px",
          paddingBottom: "48px",
        },
        responsive: [
          { max: 700, props: { flexDirection: "column", paddingTop: "17px" } },
        ],
        children: [
          {
            id: "gradient-button",
            type: "button",
            tag: "button",
            text: "Open panel",
            props: {
              paddingTop: "14px",
              paddingBottom: "14px",
              paddingLeft: "24px",
              paddingRight: "24px",
              color: "#fff",
            },
            action: { type: "toggle", target: "extra" },
          },
          {
            id: "extra",
            type: "container",
            collapsed: true,
            children: [
              { id: "extra-text", type: "text", text: "Expanded content" },
            ],
          },
          {
            id: "questions-native",
            type: "accordion",
            children: [
              { id: "summary-native", type: "summary", text: "A question" },
              {
                id: "answer-native",
                type: "text",
                text: "An editable answer.",
              },
            ],
          },
        ],
      },
    });
    await page.locator("[data-native-id=gradient-button]").click();
    await panel.locator("[data-native-fill-type]").selectOption("gradient");
    await panel.locator("[data-native-add-stop]").click();
    await panel.locator("[data-native-apply-fill]").click();
    await panel.locator("[data-native-layers] > summary").click();
    await panel.locator("[data-native-layer-add]").click();
    assert.equal(
      (await invoke("nativeInspect", { id: "gradient-button" })).fill.layers
        .length,
      1,
      "Adding a layer previews the change until Apply",
    );
    await panel.locator("[data-native-gradient-x]").fill("20");
    await panel.locator("[data-native-apply-fill]").click();
    config = await invoke("nativeInspect", { id: "gradient-button" });
    assert.equal(config.fill.layers.length, 2);
    assert.equal(config.fill.layers[0].stops.length, 3);
    assert.equal(config.fill.layers[1].x, 20);
    const resize = page.locator("[data-sq-element-resize]");
    const rect = await resize.boundingBox();
    const originalWidth = await page
      .locator("[data-native-id=gradient-button]")
      .evaluate((n) => n.offsetWidth);
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      rect.x + rect.width / 2 + 30,
      rect.y + rect.height / 2 + 5,
    );
    await page.mouse.up();
    assert.ok(
      parseFloat(
        (await invoke("nativeInspect", { id: "gradient-button" })).props.width,
      ) > originalWidth,
    );
    await invoke("undo");
    await page.locator("[data-native-id=gradient-button]").click();
    await page.locator("[data-sq-overlay-duplicate]").click();
    nodes = await invoke("nativeInspect");
    assert.equal(
      new Set(nodes.map((n) => n.id)).size,
      nodes.length,
      "Duplicate creates distinct native IDs",
    );
    await invoke("undo");
    await invoke("nativeMove", {
      id: heading.id,
      parent: "row",
      before: "gradient-button",
    });
    assert.equal(
      (await invoke("nativeInspect")).find((n) => n.id === heading.id).parent,
      "row",
    );
    await invoke("undo");
    const before = await invoke("nativeInspect");
    await assert.rejects(
      invoke("nativeUpdate", {
        id: "row",
        props: { width: "10px; color:red" },
      }),
    );
    assert.deepEqual(
      await invoke("nativeInspect"),
      before,
      "Invalid changes are atomic",
    );
    await invoke("save");
    await page.reload();
    await page.waitForFunction(() => globalThis.EzkartBuilder);
    assert.equal(
      (await invoke("nativeInspect", { id: heading.id })).marks.length,
      1,
    );
    assert.equal(
      (await invoke("nativeInspect", { id: "gradient-button" })).fill.layers
        .length,
      2,
    );
    const html = await invoke("exportHtml");
    assert.doesNotMatch(
      html,
      /<[^>]+class="[^"]*sq-(?:reference|flow)|data-sq-native=/,
    );
    await page.route("**/native-output", (r) =>
      r.fulfill({ body: html, contentType: "text/html" }),
    );
    await page.goto(ws.url + "/native-output");
    await page.evaluate(() => document.fonts.ready);
    const button = page.locator("[data-native-id=gradient-button]");
    assert.match(
      await button.evaluate((n) => getComputedStyle(n).backgroundImage),
      /radial-gradient/,
    );
    await button.click();
    assert.equal(
      await page.locator("[data-native-id=extra]").evaluate((n) => n.hidden),
      false,
    );
    await page.keyboard.press("Escape");
    assert.equal(
      await page.locator("[data-native-id=extra]").evaluate((n) => n.hidden),
      true,
    );
    await page.locator("[data-native-id=summary-native]").click();
    assert.equal(
      await page
        .locator("[data-native-id=questions-native]")
        .evaluate((n) => n.open),
      true,
    );
    await page.setViewportSize({ width: 390, height: 1000 });
    assert.equal(
      await page
        .locator("[data-native-id=row]")
        .evaluate((n) => getComputedStyle(n).paddingTop),
      "17px",
    );
    assert.equal(
      await page
        .locator("[data-native-id=row]")
        .evaluate((n) => getComputedStyle(n).flexDirection),
      "column",
    );
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth),
      390,
    );
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await ws.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test("Ezkart reference uses editable primitives and preserves measured layout, mobile navigation, states and captioned video", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ezkart-native-reference-"));
  const ws = await new Workspace(directory).init();
  await ws.create({ id: "reference", name: "Native reference" });
  await ws.start();
  const browser = await chromium.launch(),
    page = await browser.newPage({
      viewport: { width: 1600, height: 1000 },
      reducedMotion: "reduce",
    });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    const { readFile } = await import("node:fs/promises");
    const recipe = JSON.parse(
      await readFile(
        new URL("../examples/ezkart-native.json", import.meta.url),
        "utf8",
      ),
    );
    await page.goto(
      ws.url + "/cart/admin/?page=sites&edit=reference.ezkart.site",
    );
    await page.waitForFunction(() => globalThis.EzkartBuilder);
    await page.evaluate(async (recipe) => {
      for (const node of recipe) {
        await EzkartBuilder.addSection({ component: "blank", id: node.id });
        EzkartBuilder.nativeInsert({ section: node.id, node });
      }
      await EzkartBuilder.removeSection({ id: "blank" });
    }, recipe);
    await page.locator("[data-sq-tab=layers]").click();
    await page.locator("[data-sq-layer][data-section-id=top]").click();
    await page.locator("[data-sq-toolbar-duplicate]").click();
    let nodes = await page.evaluate(() => EzkartBuilder.nativeInspect());
    assert.equal(
      new Set(nodes.map((n) => n.id)).size,
      nodes.length,
      "Copying a section remaps every native ID",
    );
    await page.evaluate(() => EzkartBuilder.undo());
    assert.equal(
      await page
        .locator("[data-native-id=element-105]")
        .evaluate((n) => getComputedStyle(n).fontWeight),
      "400",
      "Dashboard typography must not override editable canvas values",
    );
    const html = await page.evaluate(() => EzkartBuilder.exportHtml());
    await page.route("**/reference-output", (r) =>
      r.fulfill({ body: html, contentType: "text/html" }),
    );
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(ws.url + "/reference-output");
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(100);
    assert.equal(
      await page.locator(".sq-reference,.sq-flow,iframe,.sq-free-code").count(),
      0,
    );
    assert.ok((await page.locator(".sq-native").count()) > 500);
    assert.equal(await page.locator("h1 .sq-native-run").count(), 1);
    const expected = [
      79, 1316.640625, 977.796875, 1282.40625, 1236.40625, 939.34375, 597,
      594.078125, 287,
    ];
    const heights = await page
      .locator(".sq-native-section")
      .evaluateAll((nodes) =>
        nodes.map((n) => n.getBoundingClientRect().height),
      );
    heights.forEach((height, i) =>
      assert.ok(
        Math.abs(height - expected[i]) < 1,
        `Section ${i} height ${height}, expected ${expected[i]}`,
      ),
    );
    await page.locator("[data-native-action*=preview-mobile]").click();
    assert.equal(
      await page
        .locator("[data-native-id=element-301]")
        .evaluate((n) => n.offsetWidth),
      300,
    );
    await page.locator("[data-native-action*=preview-desktop]").click();
    await page.locator("[data-native-action*=video-dialog]").click();
    assert.equal(await page.locator("dialog").evaluate((n) => n.open), true);
    await page
      .locator("dialog video")
      .evaluate((video) => (video.textTracks[0].mode = "hidden"));
    await page.waitForFunction(
      () =>
        document.querySelector("dialog video").textTracks[0].cues?.length === 4,
    );
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 390, height: 1000 });
    await page.evaluate(() => scrollTo(0, 0));
    await page.locator('[aria-label="Buka navigasi"]').click();
    assert.equal(
      await page.locator("#mobile-nav").evaluate((n) => n.hidden),
      false,
    );
    assert.ok(
      (await page.locator("#mobile-nav").evaluate((n) => n.offsetHeight)) > 200,
    );
    await page.locator("#mobile-nav a").first().click();
    assert.equal(
      await page.locator("#mobile-nav").evaluate((n) => n.hidden),
      true,
    );
    await page.locator("[data-native-action*=preview-mobile]").click();
    assert.equal(
      await page
        .locator("[data-native-id=element-301]")
        .evaluate((n) => n.offsetWidth),
      250,
    );
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth),
      390,
    );
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await ws.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
