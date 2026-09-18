import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { Workspace } from "../workspace.mjs";

test("the editor Preview renders current edits, local media and commerce at every size and opens a working tab", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ezkart-live-preview-"));
  const media = createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "image/svg+xml" });
    res.end(
      '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#ffe250"/></svg>',
    );
  });
  await new Promise((resolve) => media.listen(0, "127.0.0.1", resolve));
  const mediaBase = `http://127.0.0.1:${media.address().port}`;
  await writeFile(
    join(directory, "catalog.json"),
    JSON.stringify({
      mediaBase,
      currency: "USD",
      locale: "en-US",
      demoCheckout: true,
      products: [
        {
          id: "soda",
          name: "Demo soda",
          type: "physical",
          currency: "USD",
          price: 24,
          stock: 12,
          media: [{ id: "can" }],
          variants: [
            { id: "citrus", name: "Citrus", price: 24, stock: 12 },
            { id: "orange", name: "Orange", price: 26, stock: 12 },
          ],
        },
      ],
    }),
  );
  const ws = await new Workspace(directory).init();
  await ws.create({
    id: "preview",
    name: "Preview test",
    productIds: ["soda"],
  });
  await ws.start();
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
    reducedMotion: "reduce",
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  const invoke = (method, args = {}) =>
    page.evaluate(({ method, args }) => EzkartBuilder[method](args), {
      method,
      args,
    });
  const openPreview = async () => {
    const response = page.waitForResponse(
      (r) => new URL(r.url()).pathname === "/cart/admin/page-preview.php",
    );
    await page.locator("[data-sq-preview]").click();
    assert.equal(
      (await response).status(),
      200,
      "Preview must load its real renderer route",
    );
    const frame = await page
      .locator("[data-sq-live-preview-frame]")
      .elementHandle()
      .then((el) => el.contentFrame());
    await frame.locator("#native-headline").waitFor();
    return frame;
  };
  try {
    await page.goto(
      ws.url + "/cart/admin/?page=sites&edit=preview.ezkart.site",
    );
    await page.waitForFunction(() => globalThis.EzkartBuilder);
    await invoke("nativeInsert", {
      section: "blank",
      node: {
        id: "content",
        type: "container",
        props: {
          display: "grid",
          gap: "16px",
          paddingTop: "24px",
          paddingBottom: "24px",
          paddingLeft: "24px",
          paddingRight: "24px",
        },
        children: [
          {
            id: "headline",
            type: "heading",
            tag: "h1",
            text: "Original headline",
            props: { fontFamily: "Anton, sans-serif", fontSize: "48px" },
          },
          ...["image", "options", "price", "add"].map((part) => ({
            id: part,
            type: "commerce",
            part,
            productId: "soda",
            group: "shared",
            props: { width: "100%", maxWidth: "280px" },
          })),
        ],
      },
    });
    await invoke("save");
    await page.locator("[data-native-id=headline]").click();
    const field = page.locator("[data-sq-native-inspector] [data-native-text]");
    await field.fill("Take a Thip");
    await field.dispatchEvent("change");
    let frame = await openPreview();
    assert.equal(
      await frame.locator("#native-headline").innerText(),
      "Take a Thip",
    );
    await frame.waitForFunction(() =>
      [...document.images].every((img) => img.complete && img.naturalWidth > 0),
    );
    await frame.evaluate(() => document.fonts.ready);
    assert.ok(
      await frame.evaluate(() =>
        [...document.fonts].some(
          (font) =>
            font.family.replaceAll('"', "") === "Anton" &&
            font.status === "loaded",
        ),
      ),
      JSON.stringify(
        await frame.evaluate(() =>
          [...document.fonts].map((font) => ({
            family: font.family,
            status: font.status,
          })),
        ),
      ),
    );
    assert.equal(
      await frame.evaluate(() => {
        try {
          return Boolean(parent.document);
        } catch {
          return false;
        }
      }),
      false,
      "Preview must remain isolated from the editor",
    );
    for (const [device, width] of [
      ["mobile", 390],
      ["tablet", 768],
      ["desktop", 1440],
    ]) {
      await page.locator(`[data-sq-preview-device=${device}]`).click();
      await frame.waitForFunction((width) => innerWidth === width, width);
      assert.equal(
        await frame.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
    }
    await frame.locator("#native-options input[value=orange]").check();
    assert.equal(await frame.locator("#native-price").innerText(), "$26");
    await frame.locator("#native-add button").click();
    assert.match(await frame.locator(".ezkart-cart-row").innerText(), /Orange/);
    await frame.locator("[data-ezkart-cart-go]").click();
    assert.match(
      await frame.locator("[data-ezkart-cart-items]").innerText(),
      /No order was placed/,
    );
    const popupPromise = page.context().waitForEvent("page");
    await page.locator("[data-sq-preview-new-tab]").click();
    const popup = await popupPromise;
    await popup.locator("#native-headline").waitFor();
    assert.equal(
      await popup.locator("#native-headline").innerText(),
      "Take a Thip",
    );
    await popup.waitForFunction(() =>
      [...document.images].every((img) => img.complete && img.naturalWidth > 0),
    );
    await popup.close();
    await page.locator("[data-sq-preview-close]").click();
    await field.fill("A second edit");
    await field.dispatchEvent("change");
    frame = await openPreview();
    assert.equal(
      await frame.locator("#native-headline").innerText(),
      "A second edit",
      "Reopening Preview must regenerate the current draft",
    );
    await page.locator("[data-sq-preview-close]").click();
    await invoke("save");
    await page.reload();
    await page.waitForFunction(() => globalThis.EzkartBuilder);
    frame = await openPreview();
    assert.equal(
      await frame.locator("#native-headline").innerText(),
      "A second edit",
    );
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await ws.stop();
    await new Promise((resolve) => media.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

test("saving a new edit waits for an in-flight library preview and refreshes its source version", { timeout: 30000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "ezkart-preview-race-"));
  const ws = await new Workspace(directory).init();
  await ws.create({ id: "preview-race", name: "Preview race" });
  await ws.start();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  const call = (method, args = {}) => page.evaluate(({ method, args }) => EzkartBuilder[method](args), { method, args });
  let releasePreview, held = false, saves = 0;
  const conflicts = [];
  const previewStarted = new Promise(resolve => { releasePreview = resolve; });
  page.on("request", request => {
    if (request.method() === "PUT" && new URL(request.url()).searchParams.get("cloud") === "/v1/landing-pages/preview-race") saves++;
  });
  page.on("response", response => { if (response.status() === 409) conflicts.push(response.url()); });
  await page.route(url => url.searchParams.get("cloud") === "/v1/landing-pages/preview-race/preview", async route => {
    if (!held) { held = true; releasePreview(route); }
    else await route.continue();
  });
  try {
    await page.goto(ws.url + "/cart/admin/?page=sites&edit=preview-race.ezkart.site");
    await page.waitForFunction(() => globalThis.EzkartBuilder);
    await call("nativeInsert", { section: "blank", node: { id: "race-heading", type: "heading", text: "First version" } });
    await call("save");
    const pendingPreview = await previewStarted;
    await page.locator("[data-native-id=race-heading]").click();
    await page.locator("[data-native-text]").fill("Latest saved version");
    await page.locator("[data-native-text]").press("Tab");
    const savesBefore = saves;
    const saving = call("save");
    await call("settle");
    assert.equal(saves, savesBefore, "The new save must not invalidate a preview already being uploaded");
    await pendingPreview.continue();
    await saving;
    const saved = await ws.read("preview-race");
    const nextPreview = await page.waitForResponse(response => new URL(response.url()).searchParams.get("cloud") === "/v1/landing-pages/preview-race/preview" && response.request().postDataJSON()?.sourceUpdatedAt === saved.updatedAt);
    assert.equal(nextPreview.status(), 200);
    assert.deepEqual(conflicts, []);
    assert.match(saved.state.preview, /Latest saved version/);
  } finally {
    await browser.close();
    await ws.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
