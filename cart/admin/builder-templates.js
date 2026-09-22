/* Templates instantiate the same typed elements used on a blank canvas. */
(() => {
  const base = new URL("templates/", document.currentScript.src);
  let catalogPromise;
  const json = async (url) => {
    const response = await fetch(url);
    if (!response.ok)
      throw Error("Templates could not be loaded. Please try again.");
    return response.json();
  };
  const asset = (path, root = base) => {
    const url = new URL(path, root);
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname))
      throw Error("Invalid template asset.");
    return url.href;
  };
  const list = () =>
    (catalogPromise ||= json(new URL("index.json", base))
      .then(async (index) => {
        if (index.schemaVersion !== 1)
          throw Error("Unsupported template catalog.");
        return Promise.all(
          index.templates.map(async (item) => {
            const url = asset(item.manifest),
              manifest = await json(url);
            if (manifest.id !== item.id || manifest.schemaVersion !== 1)
              throw Error("Invalid template.");
            return {
              ...manifest,
              recipeUrl: asset(manifest.recipe, url),
              thumbnailUrl: asset(manifest.thumbnail, url),
              previewUrls: manifest.previews.map((path) => asset(path, url)),
            };
          }),
        );
      })
      .catch((error) => {
        catalogPromise = null;
        throw error;
      }));
  const plainText = (value) => {
    const source = new DOMParser().parseFromString(
      String(value || ""),
      "text/html",
    );
    source.querySelectorAll("script,style").forEach((node) => node.remove());
    source.querySelectorAll("br").forEach((node) => node.replaceWith("\n"));
    source.querySelectorAll("p,li,div").forEach((node) => node.append("\n"));
    return source.body.textContent.trim();
  };
  function context(product, brandName) {
    if (!product?.id || product.status === "archived")
      throw Error("Choose an active product from your catalog.");
    brandName = String(brandName || "").trim();
    if (!brandName || brandName.length > 80)
      throw Error("Enter your store name (up to 80 characters).");
    const productName = String(product.name || "").trim();
    if (!productName)
      throw Error("Give this product a name in your catalog first.");
    const images = [
      ...new Set(
        [
          ...(product.images || []),
          product.image,
          ...(product.variants || [])
            .filter((v) => !v.hidden)
            .map((v) => v.image),
        ]
          .filter(Boolean)
          .map((url) => new URL(url, location.href).href),
      ),
    ];
    return {
      productId: product.id,
      productName,
      brandName,
      shopContentColumn: images.length ? "2" : "1",
      hasDetailsNavigation: Boolean(
        plainText(product.description) || images[1],
      ),
      description: plainText(product.description),
      image: images[0] || "",
      image2: images[1] || "",
      image3: images[2] || "",
      hasImage: images.length > 0,
      hasVariants: (product.variants || []).filter((v) => !v.hidden).length > 1,
      optionLayout:
        (product.variants || []).filter((v) => !v.hidden).length > 6
          ? "select"
          : "detailed",
      colorOptionLayout:
        (product.variants || []).filter((v) => !v.hidden).length > 6
          ? "select"
          : "swatches",
      heroColumns: images.length
        ? "minmax(0,1.03fr) minmax(0,1fr)"
        : "minmax(0,1fr)",
      shopColumns: images.length
        ? "minmax(0,1fr) minmax(0,1fr)"
        : "minmax(0,1fr)",
      headlineSize:
        productName.length > 45
          ? "clamp(42px,4.5cqw,78px)"
          : productName.length > 20
            ? "clamp(54px,6cqw,100px)"
            : "clamp(70px,9cqw,150px)",
      mobileHeadlineSize:
        productName.length > 45
          ? "clamp(36px,10cqw,65px)"
          : "clamp(48px,14cqw,90px)",
      wordmarkSize: `clamp(48px,${Math.min(43, 150 / brandName.length).toFixed(2)}cqw,620px)`,
      mobileWordmarkSize: `clamp(32px,${Math.min(43, 150 / brandName.length).toFixed(2)}cqw,300px)`,
    };
  }
  function collectionContext(products, brandName) {
    const slots = products.map((p) => context(p, brandName)),
      data = { ...slots[0] };
    const available = (p) => {
      const variants = (p.variants || []).filter((v) => !v.hidden);
      return (
        p.type !== "physical" ||
        (variants.length
          ? variants.some((v) => Number(v.stock ?? p.stock) > 0)
          : Number(p.stock) > 0)
      );
    };
    const availability = products.map(available),
      hasFilters = availability.some(Boolean) && availability.some((v) => !v),
      initialProduct = Math.max(0, availability.findIndex(Boolean));
    Object.assign(data, {
      productCount: products.length,
      hasSingleProduct: products.length === 1,
      hasCollectionSets: products.length > 1,
      hasCollectionTabs: products.length > 2,
      hasCollectionFilters: hasFilters,
      collectionInitialProduct: `product${initialProduct + 1}`,
      collectionInitialShopColumns: slots[initialProduct].shopColumns,
      allProductsLabel: `Semua · ${products.length}`,
      availableProductsLabel: `Tersedia · ${availability.filter(Boolean).length}`,
      soldOutProductsLabel: `Habis · ${availability.filter((v) => !v).length}`,
      collectionColumns: `repeat(${Math.min(4, products.length)},minmax(0,1fr))`,
      collectionMobileColumns: `repeat(${Math.min(2, products.length)},minmax(0,1fr))`,
      collectionMaxWidth: products.length === 1 ? "480px" : "100%",
      collectionHeadline: `Pilihan dari\n${data.brandName}.`,
      collectionHeadlineMarks: [
        { start: 13, end: 13 + data.brandName.length, color: "#a74432" },
      ],
      collectionHeadlineSize:
        data.brandName.length > 30
          ? "clamp(38px,4vw,60px)"
          : "clamp(48px,4.5vw,68px)",
      collectionHeadlineMobileSize:
        data.brandName.length > 30
          ? "clamp(30px,7.8vw,42px)"
          : "clamp(40px,9.8vw,60px)",
      collectionBrandSize:
        data.brandName.length > 25
          ? "22px"
          : data.brandName.length > 14
            ? "28px"
            : "39px",
      collectionHeroColumns: data.hasImage
        ? "minmax(0,.88fr) minmax(0,1.2fr)"
        : "minmax(0,1fr)",
      collectionStoryColumns: data.hasImage
        ? "minmax(0,1.15fr) minmax(0,1fr)"
        : "minmax(0,1fr)",
      collectionIntroduction: `${products.length} produk. Pilih yang kamu perlukan.`,
      collectionCopyright: `© ${new Date().getFullYear()} ${data.brandName}.`,
      hasCollectionDescriptions: slots.some((p) => Boolean(p.description)),
    });
    for (let i = 0; i < 4; i++) {
      const p = slots[i],
        prefix = `product${i + 1}`;
      data[prefix + "Exists"] = Boolean(p);
      data[prefix + "InitialDisplay"] = i === initialProduct ? "flex" : "none";
      for (const [key, value] of Object.entries(
        p ||
          Object.fromEntries(
            Object.entries(slots[0]).map(([key, value]) => [
              key,
              typeof value === "boolean" ? false : "",
            ]),
          ),
      ))
        data[prefix + key[0].toUpperCase() + key.slice(1)] = value;
      data[prefix + "ShopColumns"] ||= "minmax(0,1fr)";
      data[prefix + "Filters"] = p
        ? {
            [availability[i] ? "soldout" : "available"]: {
              props: { display: "none" },
            },
          }
        : {};
      data[prefix + "OpenLabel"] = p ? `Lihat ${p.productName}` : "";
    }
    data.collectionSetupLayouts = {};
    data.collectionSetupVisualStates = {};
    const sets = [
      [0, 1],
      [1, 2],
      [2, 3],
    ];
    sets.forEach((indices, index) => {
      const items = indices.map((i) => slots[i]).filter(Boolean),
        prefix = `set${index + 1}`;
      data[prefix + "Exists"] = items.length === 2;
      data[prefix + "HasImage"] =
        items.length === 2 && Boolean(items[0]?.hasImage);
      const name = ["work", "write", "small"][index],
        hasImage = Boolean(items[0]?.hasImage);
      data.collectionSetupLayouts[name] = {
        props: {
          gridTemplateColumns: hasImage
            ? "minmax(0,1.15fr) minmax(0,1fr)"
            : "minmax(0,1fr)",
        },
        responsive: [
          { max: 700, props: { gridTemplateColumns: "minmax(0,1fr)" } },
        ],
      };
      data.collectionSetupVisualStates[name] = {
        props: { display: hasImage ? "flex" : "none" },
      };
      data[prefix + "ProductIds"] = items.map((p) => p.productId);
      data[prefix + "FirstHasImage"] = Boolean(items[0]?.hasImage);
      data[prefix + "Title"] = items.map((p) => p.productName).join(" + ");
      data[prefix + "Image"] =
        items[0]?.image2 || products[indices[0]]?.images?.[0] || "";
    });
    return data;
  }
  function materialize(value, data, depth = 0) {
    if (depth > 64) throw Error("Template is too deeply nested.");
    if (Array.isArray(value))
      return value
        .map((v) => materialize(v, data, depth + 1))
        .filter((v) => v !== null);
    if (!value || typeof value !== "object") return value;
    if (value.$asset) return asset(value.$asset);
    const get = (key) => {
      if (!Object.hasOwn(data, key))
        throw Error("Unknown template data field.");
      return data[key];
    };
    if (value.$when && !get(value.$when)) return null;
    if (Object.hasOwn(value, "$bind")) return get(value.$bind);
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      if (["__proto__", "constructor", "prototype"].includes(key))
        throw Error("Invalid template property.");
      if (key !== "$when") result[key] = materialize(item, data, depth + 1);
    }
    return result;
  }
  // An empty shop slot is still ordinary, editable native content.
  function emptyProductCard(slot, theme) {
    const font = theme.bodyFont || "Arial, sans-serif";
    const text = (id, value, props = {}) => ({
      id,
      type: "text",
      name: value,
      text: value,
      props: {
        fontFamily: font,
        fontSize: "14px",
        lineHeight: "1.6",
        color: "#53616a",
        marginTop: "0px",
        marginBottom: "0px",
        overflowWrap: "anywhere",
        ...props,
      },
    });
    return {
      ...slot,
      name: "Empty product card",
      props: {
        ...slot.props,
        display: "flex",
        flexDirection: "column",
        gap: "16px",
        width: "100%",
        maxWidth: "480px",
        paddingTop: "28px",
        paddingRight: "24px",
        paddingBottom: "28px",
        paddingLeft: "24px",
        borderTopWidth: "1px",
        borderTopStyle: "dashed",
        borderTopColor: "#cbd2db",
        borderRightWidth: "1px",
        borderRightStyle: "dashed",
        borderRightColor: "#cbd2db",
        borderBottomWidth: "1px",
        borderBottomStyle: "dashed",
        borderBottomColor: "#cbd2db",
        borderLeftWidth: "1px",
        borderLeftStyle: "dashed",
        borderLeftColor: "#cbd2db",
        borderRadius: "12px",
        backgroundColor: "#ffffff",
        color: "#222b36",
      },
      children: [
        {
          id: "template-product-empty-icon",
          type: "icon",
          name: "Product placeholder",
          icon: "package",
          label: "",
          props: { width: "36px", height: "36px", color: "#64748b" },
        },
        text("template-product-empty-title", "Add your product", {
          fontSize: "20px",
          fontWeight: "600",
          color: "#222b36",
        }),
        text(
          "template-product-empty-description",
          "Choose a product from your catalog. Add stock before publishing or exporting this page.",
        ),
        {
          id: "template-product-choose",
          type: "button",
          tag: "button",
          name: "Choose a product",
          text: "Choose a product",
          label: "Choose a product",
          props: {
            fontFamily: font,
            fontSize: "14px",
            fontWeight: "500",
            minHeight: "44px",
            width: "100%",
            paddingTop: "12px",
            paddingBottom: "12px",
            paddingLeft: "16px",
            paddingRight: "16px",
            borderRadius: "6px",
            backgroundColor: "#222b36",
            color: "#ffffff",
          },
        },
      ],
    };
  }
  async function prepare({
    templateId,
    productId,
    productIds,
    brandName,
    products,
  }) {
    const template = (await list()).find((item) => item.id === templateId);
    if (!template) throw Error("Choose an available template.");
    const selectedIds = productIds ?? (productId ? [productId] : []);
    const { minProducts = 1, maxProducts = 1 } = template.requirements;
    if (
      !Array.isArray(selectedIds) ||
      (selectedIds.length > 0 && selectedIds.length < minProducts) ||
      selectedIds.length > maxProducts ||
      new Set(selectedIds).size !== selectedIds.length
    )
      throw Error(
        `Choose ${minProducts === maxProducts ? minProducts : `${minProducts}–${maxProducts}`} different catalog products.`,
      );
    const selected = selectedIds.map((id) => products.find((p) => p.id === id));
    if (
      new Set(
        selected.map(
          (p) => p?.currency || document.body.dataset.adminCurrency || "IDR",
        ),
      ).size > 1
    )
      throw Error("Choose products using the same currency.");
    const data = collectionContext(
      selected.length
        ? selected
        : [
            {
              id: "template-product-1",
              name: "Your product",
              type: "physical",
              stock: 0,
              description: "",
              images: [],
              variants: [],
            },
          ],
      String(brandName || "").trim() || template.name,
    );
    data.hasProducts = selectedIds.length > 0;
    if (!data.hasProducts) {
      data.productCount = 0;
      data.collectionIntroduction =
        "Tambahkan produk pertamamu untuk mulai berjualan.";
      data.allProductsLabel = "Semua · 0";
    }
    const recipe = materialize(await json(template.recipeUrl), data);
    if (!selectedIds.length) {
      let found = false;
      const empty = (nodes) =>
        nodes.forEach((node, i) => {
          if (node.id === template.productSlot) {
            nodes[i] = emptyProductCard(node, template.theme);
            found = true;
          } else if (node.children) empty(node.children);
        });
      empty(recipe);
      if (!found)
        throw Error(
          "This template needs a product section before it can be used.",
        );
    }
    const ids = new Set(),
      commerce = [];
    const check = (node) => {
      if (ids.has(node.id)) throw Error("Duplicate template element.");
      ids.add(node.id);
      if (["product", "commerce"].includes(node.type)) commerce.push(node);
      (node.children || []).forEach(check);
    };
    recipe.forEach((node) => {
      EzkartNative.validate(node);
      check(node);
    });
    if (
      commerce.some(
        (node) =>
          node.part !== "cart" &&
          (["set-price", "set-add"].includes(node.part)
            ? !node.productIds?.length ||
              node.productIds.some(
                (id) =>
                  !selectedIds.includes(id) &&
                  !(selectedIds.length === 0 && id === "template-product-1"),
              )
            : !selectedIds.includes(node.productId) &&
              !(
                selectedIds.length === 0 &&
                node.productId === "template-product-1"
              )),
      )
    )
      throw Error("Template product binding is invalid.");
    const root = document.createElement("div");
    root.className = "sq-page-preview theme-coral radius-soft layout-rich";
    for (const node of recipe) {
      const element = EzkartNative.create(node);
      element.classList.add("sq-page-block", "sq-native-section");
      element.dataset.sqBlock = "";
      element.dataset.sectionId = node.id;
      element.removeAttribute("data-sq-element");
      root.append(element);
    }
    const variables = {
      accent: "--site-accent",
      page: "--site-page",
      ink: "--site-ink",
      surface: "--site-surface",
      headingFont: "--site-heading-font",
      bodyFont: "--site-body-font",
      buttonBackground: "--button-primary-bg",
      buttonText: "--button-primary-fg",
    };
    for (const [key, variable] of Object.entries(variables))
      if (template.theme[key])
        root.style.setProperty(variable, template.theme[key]);
    root.style.setProperty(
      "--button-primary-radius",
      `${template.theme.radius || 0}px`,
    );
    root.style.setProperty("--button-primary-shadow", "none");
    return {
      template,
      recipe,
      state: {
        version: 6,
        template: {
          id: template.id,
          brandName: data.brandName,
          productIds: selectedIds,
          baseline: recipe,
        },
        preview: root.innerHTML,
        previewClass: root.className,
        previewStyle: root.getAttribute("style"),
        products: selectedIds,
        selectedSection: recipe[0].id,
        spacing: "[]",
      },
    };
  }
  function attach(form, getProducts, { templatesOnly = false } = {}) {
    const host = form?.querySelector("[data-template-picker]");
    if (!host) return;
    const options = document.createElement("div");
    options.className = "sq-template-options";
    const title = document.createElement("legend");
    title.textContent = templatesOnly ? "Choose a template" : "Choose a starting point";
    const fieldset = document.createElement("fieldset");
    fieldset.className = "sq-template-picker";
    fieldset.append(title, options);
    host.append(fieldset);
    const showPreview = (template, trigger) => {
      const dialog = document.createElement("dialog");
      dialog.className = "sq-template-preview";
      dialog.setAttribute("aria-label", `${template.styleLabel || template.name} preview`);
      const header = document.createElement("header"),
        heading = document.createElement("h2");
      heading.textContent = template.styleLabel || template.name;
      const close = document.createElement("button");
      close.type = "button";
      close.textContent = "Close preview";
      close.addEventListener("click", () => dialog.close());
      header.append(heading, close);
      const caption = document.createElement("p");
      caption.textContent = template.previewLabel;
      dialog.append(header, caption);
      template.previewUrls.forEach((url, index) => {
        const img = document.createElement("img");
        img.src = url;
        img.alt = `${template.styleLabel || template.name} ${index === 0 ? "desktop" : index === 1 ? "mobile" : "page detail"} preview`;
        img.loading = "lazy";
        dialog.append(img);
      });
      dialog.addEventListener("close", () => {
        dialog.remove();
        trigger.focus({ preventScroll: true });
      });
      document.body.append(dialog);
      dialog.showModal();
    };
    const add = (id, style, template) => {
      const item = document.createElement("div");
      item.className = "sq-template-item";
      const label = document.createElement("label");
      label.className = "sq-template-choice";
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "template_id";
      input.value = id;
      input.defaultChecked = !id;
      const card = document.createElement("span");
      card.className = "sq-template-card";
      if (template) {
        const img = document.createElement("img");
        img.src = template.thumbnailUrl;
        img.alt = "";
        img.loading = "lazy";
        img.width = 1440;
        img.height = 1000;
        card.append(img);
      } else {
        const visual = document.createElement("span");
        visual.className = "sq-template-blank";
        visual.textContent = "+";
        visual.setAttribute("aria-hidden", "true");
        card.append(visual);
      }
      const caption = document.createElement("span");
      caption.className = "sq-template-style";
      caption.textContent = style;
      card.append(caption);
      label.append(input, card);
      item.append(label);
      if (template) {
        const preview = document.createElement("button");
        preview.type = "button";
        preview.className = "sq-template-quick-preview";
        preview.textContent = "Preview";
        preview.setAttribute("aria-label", `Preview ${style}`);
        preview.addEventListener("click", () => showPreview(template, preview));
        item.append(preview);
      }
      options.append(item);
    };
    if (!templatesOnly) add("", "Blank page");
    let templates = [];
    list()
      .then((items) => {
        templates = items;
        items.forEach((item) =>
          add(item.id, item.styleLabel || item.description || item.name, item),
        );
      })
      .catch(() => {
        const note = document.createElement("p");
        note.setAttribute("role", "alert");
        note.textContent = templatesOnly
          ? "Templates are unavailable right now. Reload the editor to try again."
          : "Templates are unavailable right now. You can still create a blank page.";
        host.append(note);
      });
    if (templatesOnly) return;
    const settings = document.createElement("div");
    settings.className = "sq-template-settings";
    settings.hidden = true;
    settings.innerHTML =
      '<label><span>Store name</span><input name="template_brand" maxlength="80" autocomplete="organization" placeholder="Your store name"></label><p>Your page starts with an empty product card. Design first, then choose your products in the editor. At least one product with stock is required to publish or export code.</p><button type="button" data-template-preview>Preview design</button>';
    const brand = settings.querySelector("input");
    (form.querySelector("[data-template-settings]") || host).append(settings);
    const sync = () => {
      const selected = form.elements.template_id.value;
      settings.hidden = !selected;
      brand.required = false;
      brand.disabled = !selected;
      const products = form.querySelector("[data-creator-products]");
      const optional = products?.closest("details") || products;
      if (optional) optional.hidden = Boolean(selected);
    };
    options.addEventListener("change", () => {
      sync();
    });
    form.addEventListener("reset", () => setTimeout(sync));
    sync();
    settings
      .querySelector("[data-template-preview]")
      .addEventListener("click", () => {
        const template = templates.find(
          (item) => item.id === form.elements.template_id.value,
        );
        if (!template) return;
        showPreview(template, settings.querySelector("[data-template-preview]"));
      });
  }
  async function fromForm(form, products) {
    const templateId = form?.elements.template_id?.value;
    if (!templateId) return null;
    return prepare({
      templateId,
      productIds: [],
      brandName: form.elements.template_brand.value,
      products,
    });
  }
  // Refresh catalog bindings while keeping edits to text, spacing, colors and layout.
  function reconnect(root, previous, prepared) {
    const old = new Map(),
      next = new Map();
    const index = (nodes, map, parent = null) =>
      nodes.forEach((node) => {
        map.set(node.id, { ...node, parent });
        index(node.children || [], map, node.id);
      });
    index(previous.baseline || [], old);
    index(prepared.recipe, next);
    const find = (id) =>
      root.querySelector(`[data-native-id="${CSS.escape(id)}"]`);
    const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const merge = (current, before, after) => {
      if (equal(current, before)) return structuredClone(after);
      if (
        !current ||
        !before ||
        !after ||
        Array.isArray(current) ||
        typeof current !== "object"
      )
        return current;
      const result = { ...current };
      for (const key of new Set([
        ...Object.keys(before),
        ...Object.keys(after),
      ])) {
        if (equal(current[key], before[key])) {
          if (after[key] === undefined) delete result[key];
          else result[key] = structuredClone(after[key]);
        } else if (after[key] !== undefined)
          result[key] = merge(current[key], before[key], after[key]);
      }
      return result;
    };
    for (const [id] of old) if (!next.has(id)) find(id)?.remove();
    const insert = (nodes, parent) => {
      nodes.forEach((node, position) => {
        let element = find(node.id);
        if (!element && old.has(node.id)) return; // Keep a merchant's deleted element deleted.
        const { children, ...config } = node;
        if (element) {
          const {
            children: ignored,
            parent: ignoredParent,
            ...before
          } = old.get(node.id) || {};
          const merged = merge(EzkartNative.read(element), before, config);
          // Product choices are explicitly being changed in this operation.
          if (config.productId) merged.productId = config.productId;
          if (config.productIds) merged.productIds = config.productIds;
          const replacement = EzkartNative.create(merged);
          if (children) replacement.append(...element.children);
          if (element.matches(".sq-native-section")) {
            replacement.classList.add("sq-page-block", "sq-native-section");
            replacement.dataset.sqBlock = "";
            replacement.dataset.sectionId = node.id;
            replacement.removeAttribute("data-sq-element");
          }
          element.replaceWith(replacement);
          element = replacement;
        } else {
          element = EzkartNative.create(config);
          if (parent === root) {
            element.classList.add("sq-page-block", "sq-native-section");
            element.dataset.sqBlock = "";
            element.dataset.sectionId = node.id;
            element.removeAttribute("data-sq-element");
          }
          const anchor = nodes
            .slice(position + 1)
            .map((n) => find(n.id))
            .find((n) => n?.parentElement === parent);
          parent.insertBefore(element, anchor || null);
        }
        if (children) insert(children, element);
      });
    };
    insert(prepared.recipe, root);
  }
  async function productForm(host, metadata, products, onApply) {
    const render = Symbol();
    host.templateRender = render;
    host.replaceChildren();
    host.hidden = !metadata;
    if (!metadata) return;
    const template = (await list()).find((item) => item.id === metadata.id);
    if (!template || !host.isConnected || host.templateRender !== render)
      return;
    const form = document.createElement("form");
    form.className = "sq-template-product-form";
    const heading = document.createElement("h3");
    heading.textContent = "Template products";
    const note = document.createElement("p");
    note.textContent =
      "Connect your products here. Your design edits and template photos stay in place.";
    form.append(heading, note);
    const selects = [];
    for (let i = 0; i < template.requirements.maxProducts; i++) {
      const label = document.createElement("label"),
        title = document.createElement("span"),
        select = document.createElement("select");
      title.textContent =
        i === 0 ? "Featured product" : `Product ${i + 1} (optional)`;
      select.setAttribute("data-template-slot", String(i));
      select.append(new Option(i === 0 ? "Choose a product" : "None", ""));
      products
        .filter((p) => p.status !== "archived")
        .forEach((p) => select.append(new Option(p.name, p.id)));
      select.value = metadata.productIds[i] || "";
      label.append(title, select);
      form.append(label);
      selects.push(select);
    }
    const button = document.createElement("button");
    button.type = "submit";
    button.textContent = "Use these products";
    const status = document.createElement("p");
    status.setAttribute("role", "status");
    form.append(button, status);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      button.disabled = true;
      const restoreFocus = form.contains(document.activeElement);
      try {
        const productIds = selects
          .map((select) => select.value)
          .filter(Boolean);
        await onApply(productIds);
        const currentStatus = host.querySelector('[role="status"]') || status;
        currentStatus.textContent = productIds.length
          ? "Products connected."
          : "Saved as a draft. Add a product with stock before publishing or exporting.";
        if (restoreFocus) host.querySelector('button[type="submit"]')?.focus();
      } catch (error) {
        status.textContent = error.message;
      } finally {
        button.disabled = false;
      }
    });
    host.replaceChildren(form);
  }
  globalThis.EzkartTemplates = Object.freeze({
    list,
    prepare,
    attach,
    fromForm,
    reconnect,
    productForm,
  });
})();
