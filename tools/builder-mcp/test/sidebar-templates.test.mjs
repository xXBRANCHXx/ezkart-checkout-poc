import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { Workspace } from "../workspace.mjs";

const screenshots = process.env.EZKART_TEMPLATE_SCREENSHOTS;
async function fixture(t, width = 1600) {
  const dir = await mkdtemp(join(tmpdir(), "ezkart-sidebar-templates-"));
  const ws = await new Workspace(dir).init();
  await ws.create({ id: "original", name: "Original page" });
  await ws.start();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: "reduce" });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  t.after(async () => {
    await browser.close();
    await ws.stop();
    await rm(dir, { recursive: true, force: true });
    assert.deepEqual(errors, []);
  });
  const call = (method, args = {}) => page.evaluate(({ method, args }) => EzkartBuilder[method](args), { method, args });
  await page.goto(ws.url + "/cart/admin/?page=sites&edit=original.ezkart.site");
  await page.waitForFunction(() => globalThis.EzkartBuilder);
  await call("nativeInsert", { section: "blank", node: { id: "original-heading", type: "heading", text: "Keep my original work" } });
  await call("save");
  const gallery = page.locator("#builder-templates-dialog");
  const dialog = page.locator("#template-apply-dialog");
  const open = async (id = "takar") => {
    await page.getByRole("button", { name: "Templates", exact: true }).click();
    await gallery.locator(`.sq-template-choice:has(input[value="${id}"])`).click();
    await gallery.getByRole("button", { name: "Use template", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector("[data-template-capacity]").textContent.startsWith("Checking"));
  };
  const choose = value => dialog.locator(`label:has(input[value="${value}"])`).click();
  const submit = () => dialog.locator("[data-template-apply-submit]").click();
  const shot = async name => {
    if (!screenshots) return;
    await mkdir(screenshots, { recursive: true });
    await page.screenshot({ path: join(screenshots, `${name}.png`) });
  };
  return { ws, page, call, gallery, dialog, open, choose, submit, shot };
}

test("sidebar gallery previews templates; replacement is confirmed, undoable and saved on the same page", async t => {
  const { ws, page, call, gallery, dialog, open, choose, submit, shot } = await fixture(t);
  await page.getByRole("button", { name: "Templates", exact: true }).click();
  await gallery.locator('input[value="takar"]').waitFor({ state: "attached" });
  assert.equal(await gallery.locator(".sq-template-choice").count(), (await call("templates")).length);
  assert.equal(await gallery.locator('input[value=""]').count(), 0);
  assert.equal(await gallery.locator(".sq-template-options").evaluate(n => getComputedStyle(n).gridTemplateColumns.split(" ").length), 4);
  await gallery.locator('.sq-template-item:has(input[value="takar"])').hover();
  await gallery.locator('.sq-template-item:has(input[value="takar"]) .sq-template-quick-preview').click();
  await page.locator(".sq-template-preview").waitFor({ state: "visible" });
  await page.keyboard.press("Escape");
  assert.equal(await gallery.isVisible(), true);
  await shot("desktop-gallery");
  await gallery.getByRole("button", { name: "Cancel", exact: true }).click();
  await open();
  await choose("replace");
  await shot("desktop-replace");
  assert.equal((await call("nativeInspect", { id: "original-heading" })).text, "Keep my original work");
  await page.keyboard.press("Escape");
  assert.equal(await dialog.isVisible(), false);
  assert.equal((await ws.read("original")).state.template, null);
  await gallery.getByRole("button", { name: "Use template", exact: true }).click();
  await choose("replace");
  await submit();
  await dialog.waitFor({ state: "hidden" });
  assert.equal((await ws.list()).length, 1);
  let saved = await ws.read("original");
  assert.equal(saved.state.template.id, "takar");
  assert.equal(saved.name, "Original page");
  assert.equal(saved.url, "original.ezkart.site");
  assert.deepEqual(saved.products, []);
  assert.equal((await call("nativeInspect", { id: "template-product-empty-title" })).text, "Add your product");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  assert.equal((await call("nativeInspect", { id: "original-heading" })).text, "Keep my original work");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await call("save");
  await page.reload();
  await page.waitForFunction(() => globalThis.EzkartBuilder);
  await call("settle");
  assert.equal((await call("nativeInspect", { id: "template-product-empty-title" })).text, "Add your product");
  await shot("replaced-canvas");
  await assert.rejects(call("publish"), /Add one of your products/);
});

test("new template draft preserves the current page and works in a narrow editor", async t => {
  const { ws, page, call, dialog, open, submit, shot } = await fixture(t, 900);
  await call("nativeUpdate", { id: "original-heading", text: "My latest design edit" });
  await open("sela");
  assert.equal(await dialog.locator('input[value="new"]').isChecked(), true);
  await dialog.locator('[name="page_name"]').fill("Fresh store");
  assert.equal(await dialog.locator('[name="slug"]').inputValue(), "fresh-store");
  await page.setViewportSize({ width: 390, height: 844 });
  await shot("mobile-new-draft");
  assert.ok(await dialog.evaluate(n => n.scrollWidth <= n.clientWidth));
  const submitBox = await dialog.locator("[data-template-apply-submit]").boundingBox();
  assert.ok(submitBox.x >= 0 && submitBox.x + submitBox.width <= 390 && submitBox.y + submitBox.height <= 844);
  await page.setViewportSize({ width: 900, height: 1000 });
  await submit();
  await page.waitForURL("**edit=fresh-store.ezkart.site");
  await call("settle");
  assert.equal((await ws.list()).length, 2);
  const original = await ws.read("original");
  assert.match(original.state.preview, /My latest design edit/);
  assert.equal(original.state.template, null);
  const draft = await ws.read("fresh-store");
  assert.equal(draft.state.template.id, "sela");
  assert.equal(draft.status, "draft");
  assert.deepEqual(draft.products, []);
  await page.reload();
  await page.waitForFunction(() => globalThis.EzkartBuilder);
  assert.equal((await call("nativeInspect", { id: "template-product-empty-title" })).text, "Add your product");
});

test("the current server count disables new drafts at the limit while replacement still works", async t => {
  const { ws, page, dialog, open, choose, submit, shot } = await fixture(t, 900);
  // Simulate pages created in another editor after this editor loaded its initial list.
  for (let i = 1; i <= 5; i++) await ws.create({ id: `extra-${i}`, name: `Extra ${i}` });
  await open();
  assert.equal(await dialog.locator('input[value="new"]').isDisabled(), true);
  assert.equal(await dialog.locator("[data-template-apply-submit]").isDisabled(), true);
  assert.match(await dialog.locator("[data-template-capacity]").textContent(), /All 6 landing pages/);
  await shot("limit-reached");
  await choose("replace");
  await submit();
  await dialog.waitFor({ state: "hidden" });
  assert.equal((await ws.list()).length, 6);
  assert.equal((await ws.read("original")).state.template.id, "takar");
  assert.match(page.url(), /edit=original.ezkart.site/);
});

test("creation rechecks the limit and handles a last-slot server rejection without changing the current design", async t => {
  const { ws, page, call, dialog, open, submit } = await fixture(t);
  for (let i = 1; i <= 4; i++) await ws.create({ id: `extra-${i}`, name: `Extra ${i}` });
  await open();
  assert.equal(await dialog.locator('input[value="new"]').isDisabled(), false);
  await ws.create({ id: "last-slot", name: "Created in another tab" });
  await submit();
  await page.waitForFunction(() => document.querySelector('[name="destination"][value="new"]').disabled);
  assert.equal((await ws.list()).length, 6);
  assert.equal((await call("nativeInspect", { id: "original-heading" })).text, "Keep my original work");
  assert.equal(await dialog.isVisible(), true);
  await dialog.getByRole("button", { name: "Back", exact: true }).click();
  await page.locator("#builder-templates-dialog [data-creator-close]").first().click();
  // Even if the listing is stale, the server's write rejection stays in the dialog.
  await page.route(url => url.searchParams.get("cloud") === "/v1/landing-pages", async route => {
    await route.fulfill({ json: { ok: true, pages: (await ws.list()).filter(item => item.id !== "last-slot") } });
  });
  await open();
  await submit();
  await dialog.locator("[data-template-apply-error]").waitFor({ state: "visible" });
  assert.match(await dialog.locator("[data-template-apply-error]").textContent(), /Delete a project/);
  assert.equal((await ws.list()).length, 6);
  assert.equal((await call("nativeInspect", { id: "original-heading" })).text, "Keep my original work");
});

test("a failed capacity lookup can be retried and duplicate URLs cannot replace another page", async t => {
  const { ws, page, dialog, open, submit } = await fixture(t);
  const matcher = url => url.searchParams.get("cloud") === "/v1/landing-pages";
  await page.route(matcher, route => route.fulfill({ status: 503, json: { error: "Temporarily unavailable" } }));
  await open();
  assert.equal(await dialog.locator('input[value="new"]').isDisabled(), true);
  assert.equal(await dialog.locator('input[value="replace"]').isDisabled(), false);
  await page.unroute(matcher);
  await dialog.getByRole("button", { name: "Check again" }).click();
  await page.waitForFunction(() => !document.querySelector('[name="destination"][value="new"]').disabled);
  await dialog.locator('[name="slug"]').fill("original");
  await submit();
  await dialog.locator("[data-template-apply-error]").waitFor({ state: "visible" });
  assert.match(await dialog.locator("[data-template-apply-error]").textContent(), /already exists/);
  assert.equal((await ws.list()).length, 1);
  assert.equal((await ws.read("original")).state.template, null);
});

test("new drafts wait for the current project to save and repeated submission creates only one draft", async t => {
  const { ws, page, dialog, open, submit } = await fixture(t);
  const matcher = url => url.searchParams.get("cloud") === "/v1/landing-pages/original";
  await page.route(matcher, route => route.request().method() === "PUT"
    ? route.fulfill({ status: 503, json: { error: "Save temporarily unavailable" } })
    : route.continue());
  await open();
  await submit();
  await dialog.locator("[data-template-apply-error]").waitFor({ state: "visible" });
  assert.match(await dialog.locator("[data-template-apply-error]").textContent(), /current project could not be saved/);
  assert.equal((await ws.list()).length, 1);
  await page.unroute(matcher);
  await dialog.locator("form").evaluate(form => { form.requestSubmit(); form.requestSubmit(); });
  await page.waitForURL("**edit=takar.ezkart.site");
  assert.equal((await ws.list()).length, 2);
});

test("replacing a published page edits its design without replacing its published snapshot", async t => {
  const { ws, page, call, dialog, open, choose, submit } = await fixture(t);
  const original = await ws.read("original");
  await ws.write("original", { ...original, status: "published", publishedHtml: "<h1>Previously published design</h1>" });
  await page.reload();
  await page.waitForFunction(() => globalThis.EzkartBuilder);
  await open();
  await choose("replace");
  await submit();
  await dialog.waitFor({ state: "hidden" });
  const saved = await ws.read("original");
  assert.equal(saved.state.template.id, "takar");
  assert.equal(saved.status, "published");
  assert.equal(saved.publishedHtml, "<h1>Previously published design</h1>");
  assert.deepEqual(saved.products, []);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  assert.equal((await call("nativeInspect", { id: "original-heading" })).text, "Keep my original work");
});
