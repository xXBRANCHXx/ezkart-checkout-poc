import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { Workspace, repoRoot } from "../workspace.mjs";

async function fixture(run, products = []) {
  const dir = await mkdtemp(join(tmpdir(), "ezkart-layout-polish-"));
  const ws = await new Workspace(dir).init();
  await writeFile(join(dir, "catalog.json"), JSON.stringify({ products }));
  await ws.create({
    id: "polish",
    name: "Layout polish",
    productIds: products.map((p) => p.id),
  });
  await ws.start();
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1100 },
    reducedMotion: "reduce",
  });
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const invoke = (method, args = {}) =>
    page.evaluate(({ method, args }) => EzkartBuilder[method](args), {
      method,
      args,
    });
  await page.route(
    (url) => url.searchParams.get("cloud") === "/v1/media/product-photo",
    (r) =>
      r.fulfill({
        path: join(repoRoot, "cart/admin/assets/products/kopi-susu.webp"),
      }),
  );
  try {
    await page.goto(ws.url + "/cart/admin/?page=sites&edit=polish.ezkart.site");
    await page.waitForFunction(() => globalThis.EzkartBuilder);
    await run({ page, invoke, ws });
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await ws.stop();
    await rm(dir, { recursive: true, force: true });
  }
}

const syrup = {
  id: "syrup",
  name: "ZERO Syrup 50–550 ml Better than Stevia Syrup Nol Gula Sugar-Free",
  media: [{ id: "product-photo" }],
  type: "physical",
  price: 42500,
  stock: 10,
  weightGrams: 500,
  options: [
    { name: "Flavor", values: ["Plain", "Vanilla"] },
    { name: "Size", values: ["250ml", "550ml"] },
  ],
  variants: [
    {
      id: "plain",
      price: 42500,
      stock: 10,
      options: [
        { option: "Flavor", value: "Plain" },
        { option: "Size", value: "250ml" },
      ],
    },
    {
      id: "vanilla",
      price: 80000,
      stock: 10,
      options: [
        { option: "Flavor", value: "Vanilla" },
        { option: "Size", value: "550ml" },
      ],
    },
  ],
};

const checkProductBounds = async (grid) => {
  const g = await grid.evaluate((n) => {
    const box = n.getBoundingClientRect(),
      card = n.querySelector("[data-product-card]:not([hidden])");
    return {
      bottom: box.bottom,
      right: box.right,
      cardBottom: card.getBoundingClientRect().bottom,
      footerBottom: card.querySelector("footer").getBoundingClientRect().bottom,
      scroll: n.scrollWidth,
      width: n.clientWidth,
      columns: getComputedStyle(n)
        .gridTemplateColumns.split(" ")
        .filter((v) => parseFloat(v) > 0).length,
    };
  });
  assert.ok(
    g.cardBottom <= g.bottom + 1,
    `Card ends at ${g.cardBottom}, selection at ${g.bottom}`,
  );
  assert.ok(
    g.footerBottom <= g.bottom + 1,
    "All purchase controls stay inside the selection",
  );
  assert.ok(g.scroll <= g.width + 1, "No horizontal clipping");
  return g;
};

test("existing product blocks fit after resizing, reflow narrow columns, and preserve bounds on reload and export", async () =>
  fixture(
    async ({ page, invoke, ws }) => {
      assert.equal(
        await page
          .locator("[data-sq-grid-toggle]")
          .first()
          .getAttribute("aria-pressed"),
        "true",
      );
      await invoke("addSection", {
        component: "product-collection",
        id: "collection",
      });
      await invoke("removeSection", { id: "blank" });
      const grid = page.locator(
        "[data-section-id=collection] [data-sq-product-grid]",
      );
      const id = await grid.getAttribute("data-sq-element-id");
      await invoke("updateElement", {
        id,
        layout: { x: 1, y: 1, width: 4, height: 3 },
        autoHeight: false,
      });
      await grid.locator("h3").click();
      assert.equal(
        await page.locator("[data-sq-auto-height-control]").isVisible(),
        false,
      );
      assert.equal(
        await page.locator("[data-sq-inspector-title]").textContent(),
        "Product card",
      );
      assert.equal(
        (await checkProductBounds(grid)).columns,
        1,
        "Two-column preference stacks in a narrow block",
      );
      assert.equal(
        await grid.locator("[contenteditable=true]").count(),
        0,
        "Catalog product details are not disconnected editable text",
      );
      // Resize with the actual handle, including an attempted height smaller than the card.
      const before = await grid.boundingBox();
      const handle = page.locator(".sq-element-resize");
      await handle.scrollIntoViewIfNeeded();
      const box = await handle.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + 120, box.y - 100, { steps: 8 });
      await page.mouse.up();
      await invoke("settle");
      assert.ok(
        (await grid.boundingBox()).width > before.width,
        "Drag changes width",
      );
      await checkProductBounds(grid);
      // Content placed below the card is pushed down when the card grows.
      const layout = (await invoke("inspect")).sections[0].elements.find(
        (e) => e.id === id,
      ).layout;
      await invoke("addElement", {
        section: "collection",
        type: "text",
        id: "below-products",
      });
      await invoke("updateElement", {
        id: "below-products",
        layout: { x: 1, y: layout.y + layout.height, width: 4, height: 3 },
      });
      await invoke("updateElement", { id, layout: { ...layout, width: 12 } });
      const below = page.locator("[data-sq-element-id=below-products]");
      assert.ok(
        (await below.boundingBox()).y >=
          (await grid.boundingBox()).y + (await grid.boundingBox()).height - 1,
        "Following content moves below a growing card",
      );
      await grid.locator("h3").click();
      // Canvas tools retain their screen size at different zoom levels.
      const heights = [];
      for (const zoom of [40, 100]) {
        await page.locator("[data-sq-zoom-slider]").fill(String(zoom));
        await page.locator("[data-sq-zoom-slider]").dispatchEvent("input");
        heights.push(
          (await page.locator(".sq-element-toolbar").boundingBox()).height,
        );
      }
      assert.ok(
        Math.abs(heights[0] - heights[1]) < 1,
        "Toolbar does not shrink with the canvas",
      );
      for (const device of ["mobile", "tablet", "desktop"]) {
        await invoke("setDevice", { device });
        await invoke("updateElement", {
          id,
          device,
          layout: {
            x: 1,
            y: 1,
            width: device === "desktop" ? 4 : 12,
            height: 3,
          },
          autoHeight: false,
        });
        await invoke("settle");
        await checkProductBounds(grid);
      }
      await invoke("save");
      await page.reload();
      await page.waitForFunction(() => globalThis.EzkartBuilder);
      await invoke("settle");
      await checkProductBounds(grid);
      const html = await invoke("exportHtml");
      await page.route("**/polish-export", (r) =>
        r.fulfill({ body: html, contentType: "text/html" }),
      );
      await page.goto(ws.url + "/polish-export");
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 1100 });
        await page.evaluate(async () => {
          await document.fonts.ready;
          for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
        });
        await checkProductBounds(
          page.locator('[data-ezkart-element="' + id + '"]'),
        );
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth),
          width,
        );
      }
    },
    [syrup],
  ));

for (const kind of ["native", "native-fixed", "authored", "reference"])
  test(`${kind} navigation stays above content and its mobile menu works in editor and export`, async () =>
    fixture(async ({ page, invoke, ws }) => {
      let nav, toggle, menu;
      if (kind.startsWith("native")) {
        await invoke("nativeInsert", {
          section: "blank",
          node: {
            id: "blank",
            type: "container",
            tag: "header",
            props: {
              display: "flex",
              position: kind === "native-fixed" ? "fixed" : "sticky",
              top: "0px",
              height: "80px",
              backgroundColor: "#fff",
              alignItems: "center",
              paddingLeft: "24px",
              zIndex: "20",
            },
            children: [
              {
                id: "toggle",
                type: "button",
                tag: "button",
                text: "Menu",
                action: { type: "toggle", target: "menu" },
              },
              {
                id: "menu",
                type: "container",
                tag: "nav",
                collapsed: true,
                props: {
                  position: "absolute",
                  top: "100%",
                  left: "0px",
                  width: "100%",
                  backgroundColor: "#fff",
                  paddingTop: "20px",
                  paddingBottom: "20px",
                },
                children: [
                  {
                    id: "menu-link",
                    type: "button",
                    tag: "a",
                    text: "Browse products",
                    action: { type: "link", target: "#content" },
                  },
                ],
              },
            ],
          },
        });
        nav = page.locator("header[data-native-id=blank]");
        toggle = page.locator("[data-native-id=toggle]");
        menu = page.locator("[data-native-id=menu]");
      } else if (kind === "authored") {
        await invoke("navigation", {
          layout: "studio",
          sticky: true,
          brand: "My shop",
          links: [{ label: "Browse products", href: "#content" }],
        });
        nav = page.locator(".sq-authored-navigation");
        toggle = nav.locator(".sq-nav-menu-toggle");
        menu = nav.locator(".sq-nav-mobile-menu");
      } else {
        await invoke("addSection", {
          component: "brand-navigation",
          id: "navigation",
        });
        nav = page.locator(".ezm-site-header");
        toggle = nav.locator(".ezm-menu-toggle");
        menu = nav.locator(".ezm-mobile-nav");
      }
      await invoke("addSection", { component: "blank", id: "content" });
      await invoke("nativeInsert", {
        section: "content",
        node: {
          id: "content",
          type: "container",
          props: {
            position: "relative",
            height: "2400px",
            backgroundColor: "#abd7cd",
            zIndex: "99999",
          },
          children: [
            {
              id: "content-title",
              type: "heading",
              text: "Page content",
              props: {
                position: "relative",
                zIndex: "99999",
                fontSize: "64px",
              },
            },
          ],
        },
      });
      if (!kind.startsWith("native"))
        await invoke("removeSection", { id: "blank" });
      await invoke("setDevice", { device: "mobile" });
      await invoke("settle");
      const above = async (locator) =>
        locator.evaluate((n) => {
          const r = n.getBoundingClientRect(),
            x = r.left + r.width / 2,
            y = r.top + Math.min(20, r.height / 2);
          return {
            top: r.top,
            visible: n.contains(document.elementFromPoint(x, y)),
            hit: document.elementFromPoint(x, y)?.outerHTML.slice(0, 200),
          };
        });
      await page
        .locator(".sq-canvas-scroll")
        .evaluate((n) => (n.scrollTop = 450));
      await invoke("settle");
      let result = await above(nav);
      assert.ok(
        result.visible,
        "Header is above content after scrolling: " + JSON.stringify(result),
      );
      await toggle.click(
        kind.startsWith("native") ? { modifiers: ["Alt"] } : {},
      );
      assert.equal(await menu.isVisible(), true);
      result = await above(menu);
      assert.ok(
        result.visible,
        "Menu is above the next section: " + JSON.stringify(result),
      );
      await page.keyboard.press("Escape");
      assert.equal(await menu.isVisible(), false, "Escape closes the menu");
      await invoke("save");
      await page.reload();
      await page.waitForFunction(() => globalThis.EzkartBuilder);
      await invoke("settle");
      const html = await invoke("exportHtml");
      await page.route("**/navigation-export", (r) =>
        r.fulfill({ body: html, contentType: "text/html" }),
      );
      await page.goto(ws.url + "/navigation-export");
      for (const width of [390, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate(async () => {
          scrollTo(0, 450);
          for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
        });
        result = await above(nav);
        assert.ok(
          result.visible,
          `Exported header remains above content at ${width}: ` +
            JSON.stringify(result),
        );
        assert.ok(
          result.top >= -1 && result.top <= 1,
          "Header stays at the top",
        );
        if (width === 390) {
          await toggle.click();
          assert.equal(await menu.isVisible(), true);
          assert.ok((await above(menu)).visible);
          await page.keyboard.press("Escape");
          assert.equal(await menu.isVisible(), false);
        }
      }
    }));
