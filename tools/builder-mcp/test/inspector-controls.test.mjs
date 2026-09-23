import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { Workspace } from "../workspace.mjs";

test("appearance controls preserve responsive designs, show resolved defaults and edit without CSS", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ezkart-controls-"));
  const ws = await new Workspace(dir).init();
  await writeFile(join(dir, "catalog.json"), JSON.stringify({ products: [{ id: "coffee", name: "Coffee", type: "physical", price: 45000, stock: 10 }] }));
  await ws.create({ id: "controls", name: "Appearance controls" });
  await ws.start();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, reducedMotion: "reduce" });
  page.setDefaultTimeout(7000);
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  const call = (method, args = {}) => page.evaluate(({ method, args }) => EzkartBuilder[method](args), { method, args });
  const panel = page.locator("[data-sq-native-inspector]");
  const artifacts = process.env.EZKART_INSPECTOR_ARTIFACTS;
  const config = id => call("nativeInspect", { id });
  const open = async group => {
    const detail = panel.locator(`[data-native-group=${group}]`);
    if (await detail.getAttribute("open") === null) await detail.locator(":scope > summary").click();
  };
  const edit = async (key, value) => {
    const field = panel.locator(`[data-style-number=${key}]`);
    await field.fill(String(value)); await field.press("Tab");
    await call("settle");
  };
  const choose = async (selector, value) => {
    const input = panel.locator(selector);
    const { id, title } = await input.evaluate((n, value) => ({
      id: n._sqBuilderSelect.menu.id,
      title: [...n.options].find(o => typeof value === "string" ? o.value === value : o.label === value.label)?.textContent,
    }), value);
    assert.ok(title, `Option exists: ${selector} ${JSON.stringify(value)}`);
    await page.locator(`[aria-controls="${id}"]`).click();
    await page.locator(`#${id}`).getByRole("option", { name: title, exact: true }).click();
  };
  const select = async id => { await page.locator(`[data-native-id="${id}"]`).click(); await call("settle"); };
  try {
    if (artifacts) await mkdir(artifacts, { recursive: true });
    await page.goto(ws.url + "/cart/admin/?page=sites&edit=controls.ezkart.site");
    await page.waitForFunction(() => globalThis.EzkartBuilder);
    await call("nativeInsert", { section: "blank", node: {
      id: "card", type: "container", name: "Product details", props: { textAlign: "center", fontFamily: "Georgia, serif", paddingTop: "20px" }, children: [
        { id: "title", type: "heading", text: "Made for your space", props: { fontSize: "clamp(28px, 4.5vw, 72px)", paddingTop: "55px", letterSpacing: "-.065em", width: "80%" } },
        { id: "details", type: "text", name: "Delivery information", text: "Ships in two days." },
        { id: "button", type: "button", text: "Show details" },
      ],
    } });
    await select("title");
    const before = await config("title");
    await open("Typography");
    assert.equal(await panel.locator('[data-style-choice=textAlign] option:checked').textContent(), "Center (default)");
    assert.match(await panel.locator('[data-sq-font-picker]').textContent(), /Georgia \(default\)/);
    assert.equal(await panel.locator('[data-style-unit=fontSize]').inputValue(), "fluid");
    assert.equal(await panel.locator('[data-fluid-part="0"]').inputValue(), "28");
    assert.equal(await panel.locator('[data-fluid-part="2"]').inputValue(), "72");
    assert.equal(Number(await panel.locator('[data-style-number=letterSpacing]').inputValue()), -0.065);
    assert.equal(await panel.locator('[data-style-unit=letterSpacing]').inputValue(), "em");
    await open("Size");
    assert.equal(await panel.locator('[data-style-number=width]').inputValue(), "80");
    assert.equal(await panel.locator('[data-style-unit=width]').inputValue(), "%");
    assert.deepEqual(await config("title"), before, "Opening controls must not flatten responsive or relative values");
    if (artifacts) {
      await panel.locator('[data-style-field=fontSize]').scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(artifacts, "responsive-font.png") });
    }

    await panel.locator('[data-fluid-part="2"]').fill("84");
    await panel.locator('[data-fluid-part="2"]').press("Tab");
    assert.equal((await config("title")).props.fontSize, "clamp(28px, 4.5vw, 84px)");
    await choose('[data-style-unit=fontSize]', "px");
    assert.match((await config("title")).props.fontSize, /px$/);
    await call("undo"); await select("title");
    assert.equal((await config("title")).props.fontSize, "clamp(28px, 4.5vw, 84px)");
    await call("redo"); await select("title");
    const slider = panel.locator('[data-style-slider=fontSize]');
    await slider.focus(); await slider.press("Home"); await slider.press("ArrowRight");
    assert.equal((await config("title")).props.fontSize, "9px", "Keyboard slider changes font size without typing");
    await edit("fontSize", 48);
    await choose('[data-style-choice=textAlign]', "left");
    assert.equal(await page.locator('[data-native-id=title]').evaluate(n => getComputedStyle(n).textAlign), "left");
    await choose('[data-style-choice=textAlign]', "");
    assert.equal(await panel.locator('[data-style-choice=textAlign] option:checked').textContent(), "Center (default)");

    await open("Spacing");
    assert.equal(await panel.locator('[data-style-number=paddingRight]').inputValue(), "0");
    await panel.locator('[data-style-link=padding]').check();
    await edit("paddingTop", 16);
    const padded = (await config("title")).props;
    for (const side of ["Top", "Right", "Bottom", "Left"]) assert.equal(padded[`padding${side}`], "16px");
    await call("undo"); await select("title");
    assert.equal((await config("title")).props.paddingTop, "55px");
    assert.equal((await config("title")).props.paddingRight, undefined, "Linked spacing is one undo step");

    await open("Surface");
    await choose('[data-style-choice=boxShadow]', { label: "Soft" });
    await edit("opacity", 75);
    assert.equal((await config("title")).props.opacity, "0.75");
    assert.notEqual(await page.locator('[data-native-id=title]').evaluate(n => getComputedStyle(n).boxShadow), "none");
    await panel.locator('[data-style-reset=opacity]').click();
    assert.equal((await config("title")).props.opacity, undefined);
    const border = panel.locator('[data-style-all-sides] [data-style-number=borderTopWidth]');
    await border.fill("2"); await border.press("Tab");
    const outlined = (await config("title")).props;
    for (const side of ["Top", "Right", "Bottom", "Left"]) {
      assert.equal(outlined[`border${side}Width`], "2px");
      assert.equal(outlined[`border${side}Style`], "solid");
    }

    await select("button");
    const actions = panel.locator('[data-native-action-type]').locator('xpath=ancestor::details[1]');
    if (await actions.getAttribute("open") === null) await actions.locator(':scope > summary').click();
    assert.equal(await panel.locator('[data-native-action-target]').isVisible(), false);
    await choose('[data-native-action-type]', "toggle");
    await choose('[data-native-action-picker]', { label: "Delivery information" });
    await panel.locator('[data-native-action-apply]').click();
    assert.equal((await config("button")).action.target, "details");
    await choose('[data-native-action-type]', "link");
    await panel.locator('[data-native-action-target]').fill("#native-details");
    await panel.locator('[data-native-action-apply]').click();
    assert.equal(await page.locator('[data-native-id=button]').getAttribute("href"), "#native-details");
    await choose('[data-native-action-type]', "");
    await panel.locator('[data-native-action-apply]').click();
    assert.equal((await config("button")).action, null);
    assert.equal(await page.locator('[data-native-id=button]').getAttribute("href"), null);

    await panel.locator('[data-native-parent]').click();
    await open("Layout");
    await choose('[data-style-choice=display]', "grid");
    await choose('[data-style-choice=gridTemplateColumns]', { label: "2 equal columns" });
    assert.equal((await config("card")).props.gridTemplateColumns, "repeat(2, minmax(0, 1fr))");
    await choose('[data-style-choice=display]', "block");
    assert.equal(await panel.locator('[data-style-field=gridTemplateColumns]').isVisible(), false);

    await call("nativeInsert", { section: "blank", node: { id: "fluid-title", type: "heading", text: "Container-sized title", props: { fontSize: "clamp(24px, 4.2cqw, 80px)" } } });
    await select("fluid-title");
    await open("Typography");
    assert.equal(await panel.locator('[data-style-unit=fontSize]').inputValue(), "fluid");
    const containerScale = panel.getByRole("spinbutton", { name: "Responsive font size: container width" });
    await containerScale.fill("5"); await containerScale.press("Tab");
    assert.equal((await config("fluid-title")).props.fontSize, "clamp(24px, 5cqw, 80px)");

    for (const node of [
      { id: "picture", type: "image", src: ws.url + "/cart/admin/assets/products/kopi-susu.webp", props: { width: "120px", height: "80px" } },
      { id: "symbol", type: "icon", icon: "arrow-right" },
      { id: "movie", type: "video", props: { width: "160px", height: "90px" } },
      { id: "offer", type: "product", productId: "coffee" },
      { id: "answer", type: "accordion", children: [{ id: "question", type: "summary", text: "Delivery?" }] },
    ]) {
      await call("nativeInsert", { section: "blank", node });
      await page.locator(`[data-native-id="${node.id}"]`).click({ position: { x: 4, y: 4 } });
      if (node.type === "accordion") await panel.locator('[data-native-parent]').click();
      await open("Size");
      assert.equal(await panel.locator('[data-style-field=objectFit]').isVisible(), ["image", "video"].includes(node.type), `${node.type} has the appropriate size controls`);
      if (node.type === "icon") {
        assert.equal(await panel.locator('[data-native-group=Typography] > summary').textContent(), "Icon color");
        assert.equal(await panel.locator('[data-style-field=fontSize]').isVisible(), false);
        const options = panel.locator('[data-native-icon-options]');
        if (await options.getAttribute("open") === null) await options.locator(':scope > summary').click();
        await choose('[data-icon-paint=iconFill]', "custom");
        await panel.locator('[data-icon-color=iconFill]').fill("#c74130");
        await panel.locator('[data-icon-color=iconFill]').dispatchEvent("change");
        assert.equal((await config(node.id)).iconFill, "#c74130");
      }
      if (node.type !== "product") {
        if (await panel.locator('[data-style-unit=width]').inputValue() !== "px") await choose('[data-style-unit=width]', "px");
        await edit("width", 140);
        assert.equal((await config(node.id)).props.width, "140px");
      }
    }
    await call("save");
    const saved = await call("nativeInspect");
    await page.reload(); await page.waitForFunction(() => globalThis.EzkartBuilder);
    assert.deepEqual(await call("nativeInspect"), saved);
    for (const width of [1600, 941, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await call("settle");
      const close = page.locator('[data-sq-close-inspector]');
      if (await close.isVisible()) await close.click();
      await select("title");
      for (const group of ["Typography", "Size", "Spacing", "Layout", "Surface"]) {
        await open(group);
        const field = panel.locator(`[data-native-group=${group}]`);
        await field.scrollIntoViewIfNeeded();
        const overflow = await panel.evaluate(n => n.scrollWidth - n.clientWidth);
        assert.ok(overflow <= 1, `${group} panel must fit at ${width}px (overflow ${overflow})`);
        if (artifacts) await page.screenshot({ path: join(artifacts, `${width}-${group}.png`) });
      }
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser.close(); await ws.stop(); await rm(dir, { recursive: true, force: true });
  }
});
