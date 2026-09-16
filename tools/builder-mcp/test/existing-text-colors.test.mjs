import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { Workspace } from "../workspace.mjs";

test("existing hero text exposes its actual gradient in Style and preserves composition through editing, undo and export", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ezkart-existing-word-colors-")),
    ws = await new Workspace(dir).init();
  await ws.create({ id: "existing", name: "Existing text" });
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
  const panel = page.locator("[data-sq-native-inspector]"),
    heading = page.locator(".ezm-hero h1"),
    phrase = heading.locator(".ezm-gradient-text");
  const gradient = () =>
    phrase.evaluate(
      (n) => getComputedStyle(n.querySelector("span") || n).backgroundImage,
    );
  const geometry = () =>
    heading.evaluate((n) => ({
      width: n.offsetWidth,
      height: n.offsetHeight,
      breaks: n.querySelectorAll("br").length,
      text: n.textContent,
    }));
  try {
    await page.goto(
      ws.url + "/cart/admin/?page=sites&edit=existing.ezkart.site",
    );
    await page.waitForFunction(() => globalThis.EzkartBuilder);
    await invoke("addSection", { component: "centered-showcase", id: "hero" });
    await invoke("removeSection", { id: "blank" });
    await invoke("settle");
    const originalMarkup = await heading.innerHTML(),
      originalGradient = await gradient(),
      originalGeometry = await geometry();
    await phrase.click();
    assert.equal(
      await gradient(),
      originalGradient,
      "Focusing editable text must not erase its gradient",
    );
    assert.equal(
      await heading.innerHTML(),
      originalMarkup,
      "Selection and inspection do not rewrite existing text",
    );
    assert.equal(
      await page.locator("[data-sq-element-panel=style]").isVisible(),
      true,
    );
    const savedPhrase = panel
      .locator("[data-native-word-styles] button")
      .filter({ hasText: "milikmu." });
    assert.equal(await savedPhrase.isVisible(), true);
    assert.match(await savedPhrase.textContent(), /Edit gradient/);
    assert.equal(
      await panel.locator("[data-native-fill-section]").isVisible(),
      false,
      "Only the shared word editor appears inside the existing Style panel",
    );
    assert.equal(
      await panel.locator("[data-native-word-editor]").isVisible(),
      false,
      "No unrelated solid picker appears before choosing a phrase",
    );
    // The default text color does not replace the custom gradient.
    await page.locator("[data-sq-element-color-hex=color]").fill("#112233");
    await page.locator("[data-sq-element-color-hex=color]").blur();
    assert.equal(await gradient(), originalGradient);
    await savedPhrase.click();
    assert.equal(
      await panel.locator("[data-native-word-type]").inputValue(),
      "gradient",
    );
    assert.equal(
      await panel
        .locator("[data-native-word-preview]")
        .evaluate((n) => getComputedStyle(n).backgroundImage),
      originalGradient,
    );
    assert.equal(
      await panel
        .locator("[data-word-gradient-stops] [data-stop-color]")
        .count(),
      3,
    );
    await panel
      .locator("[data-word-gradient-stops] [data-stop-color]")
      .first()
      .fill("#00aa88");
    await panel.locator("[data-word-gradient-angle]").fill("75");
    await panel.locator("[data-native-apply-word-style]").click();
    const changedGradient = await gradient();
    assert.match(changedGradient, /75deg/);
    assert.match(changedGradient, /rgb\(0, 170, 136\)/);
    assert.deepEqual(
      await geometry(),
      originalGeometry,
      "Word painting preserves the authored line breaks and dimensions",
    );
    await invoke("undo");
    assert.equal(await gradient(), originalGradient);
    await invoke("redo");
    assert.equal(await gradient(), changedGradient);
    await invoke("save");
    await page.reload();
    await page.waitForFunction(() => globalThis.EzkartBuilder);
    await phrase.click();
    await savedPhrase.click();
    assert.equal(
      await panel
        .locator("[data-native-word-preview]")
        .evaluate((n) => getComputedStyle(n).backgroundImage),
      changedGradient,
    );
    // Reuse the same panel for a normal primitive and then return to existing text.
    await invoke("addSection", { component: "blank", id: "new-area" });
    await invoke("nativeInsert", {
      section: "new-area",
      node: { id: "new-text", type: "text", text: "Another paragraph" },
    });
    await page.locator("[data-native-id=new-text]").click();
    assert.equal(await panel.locator("[data-native-text]").isVisible(), true);
    await phrase.click();
    assert.equal(await savedPhrase.isVisible(), true);
    assert.equal(await panel.locator("[data-native-text]").isVisible(), false);
    const html = await invoke("previewHtml");
    await page.route("**/existing-export", (r) =>
      r.fulfill({ body: html, contentType: "text/html" }),
    );
    await page.goto(ws.url + "/existing-export");
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1100 });
      assert.equal(await gradient(), changedGradient);
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth),
        width,
      );
      assert.equal(
        await heading.locator("br").count(),
        originalGeometry.breaks,
      );
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await ws.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

test("ordinary existing text uses canvas selection for word gradients and preserves bold markup", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ezkart-text-range-")),
    ws = await new Workspace(dir).init();
  await ws.create({ id: "plain", name: "Plain text" });
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
  try {
    await page.goto(ws.url + "/cart/admin/?page=sites&edit=plain.ezkart.site");
    await page.waitForFunction(() => globalThis.EzkartBuilder);
    await invoke("addSection", {
      component: "hero-split",
      id: "plain",
      content: { title: "Plain bold words" },
    });
    const title = page.locator(
      "[data-sq-element-id=plain-title] :is(h1,h2,h3)",
    );
    await title.evaluate(
      (n) => (n.innerHTML = "Plain <strong>bold</strong> words"),
    );
    await title.click();
    const weight = await title
      .locator("strong")
      .evaluate((n) => getComputedStyle(n).fontWeight);
    await title.evaluate((n) => {
      const range = document.createRange();
      range.setStart(n.firstChild, 0);
      range.setEnd(n.querySelector("strong").firstChild, 4);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    });
    const panel = page.locator("[data-sq-native-inspector]");
    await page.waitForFunction(
      () =>
        document.querySelector("[data-native-word-editor]").hidden === false,
    );
    assert.match(
      await panel.locator("[data-native-rich-range]").textContent(),
      /Plain bold/,
    );
    await panel.locator("[data-native-word-type]").selectOption("gradient");
    await panel.locator("[data-native-apply-word-style]").click();
    assert.equal(await title.locator("strong").textContent(), "bold");
    assert.equal(
      await title
        .locator("strong")
        .evaluate((n) => getComputedStyle(n).fontWeight),
      weight,
    );
    assert.equal(await title.textContent(), "Plain bold words");
    const phrase = panel
      .locator("[data-native-word-styles] button")
      .filter({ hasText: "Plain bold" });
    assert.equal(await phrase.isVisible(), true);
    await phrase.click();
    await panel.locator("[data-native-word-type]").selectOption("solid");
    await panel.locator("[data-native-word-color-value]").fill("#007744");
    await panel.locator("[data-native-apply-word-style]").click();
    assert.equal(
      await title
        .locator("strong span")
        .evaluate((n) => getComputedStyle(n).color),
      "rgb(0, 119, 68)",
    );
    await panel.locator("[data-native-reset-word-style]").click();
    assert.equal(await title.locator("[data-sq-word-run]").count(), 0);
    assert.equal(await title.locator("strong").textContent(), "bold");
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await ws.stop();
    await rm(dir, { recursive: true, force: true });
  }
});
