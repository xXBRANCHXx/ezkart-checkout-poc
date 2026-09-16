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
      hasFilters = availability.some(Boolean) && availability.some((v) => !v);
    Object.assign(data, {
      productCount: products.length,
      hasSingleProduct: products.length === 1,
      hasCollectionSets: products.length > 1,
      hasCollectionTabs: products.length > 2,
      hasCollectionFilters: hasFilters,
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
      selectedIds.length < minProducts ||
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
    const data = collectionContext(selected, brandName);
    const recipe = materialize(await json(template.recipeUrl), data);
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
              node.productIds.some((id) => !selectedIds.includes(id))
            : !selectedIds.includes(node.productId)),
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
        preview: root.innerHTML,
        previewClass: root.className,
        previewStyle: root.getAttribute("style"),
        products: selectedIds,
        selectedSection: recipe[0].id,
        spacing: "[]",
      },
    };
  }
  function attach(form, getProducts) {
    const host = form?.querySelector("[data-template-picker]");
    if (!host) return;
    const options = document.createElement("div");
    options.className = "sq-template-options";
    const title = document.createElement("legend");
    title.textContent = "Choose a starting point";
    const fieldset = document.createElement("fieldset");
    fieldset.className = "sq-template-picker";
    fieldset.append(title, options);
    host.append(fieldset);
    const add = (id, name, description, template) => {
      const label = document.createElement("label");
      label.className = "sq-template-choice";
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "template_id";
      input.value = id;
      input.checked = !id;
      const card = document.createElement("span");
      card.className = "sq-template-card";
      if (template) {
        const img = document.createElement("img");
        img.src = template.thumbnailUrl;
        img.alt = "";
        img.loading = "lazy";
        card.append(img);
      } else {
        const visual = document.createElement("span");
        visual.className = "sq-template-blank";
        visual.textContent = "+";
        card.append(visual);
      }
      const strong = document.createElement("strong");
      strong.textContent = name;
      const detail = document.createElement("small");
      detail.textContent = description;
      card.append(strong, detail);
      label.append(input, card);
      options.append(label);
    };
    add("", "Blank page", "Start with an empty canvas.");
    const settings = document.createElement("div");
    settings.className = "sq-template-settings";
    settings.hidden = true;
    settings.innerHTML =
      '<label><span>Store name</span><input name="template_brand" maxlength="80" autocomplete="organization" placeholder="Your store name"></label><label><span>Featured product</span><select name="template_product"><option value="">Choose a product</option></select></label><fieldset data-template-additional hidden><legend>More products</legend><div data-template-product-list></div><p data-template-product-help></p></fieldset><p>Your product, photos and prices replace the demo content. Every section stays editable.</p><button type="button" data-template-preview>Preview design</button>';
    const brand = settings.querySelector("input"),
      product = settings.querySelector("select");
    brand.value = document.body.dataset.adminCheckoutBrand || "";
    const populateProducts = () => {
      const previous = product.value;
      product.replaceChildren(new Option("Choose a product", ""));
      getProducts()
        .filter((p) => p.status !== "archived")
        .forEach((p) => product.add(new Option(p.name, p.id)));
      product.value = previous;
      if (product.options.length === 2) product.selectedIndex = 1;
    };
    populateProducts();
    const empty = document.createElement("p");
    empty.textContent =
      "Add a product to your catalog to use a template. You can start with a blank page now.";
    empty.hidden = product.options.length > 1;
    settings.append(empty);
    host.append(settings);
    const additional = settings.querySelector("[data-template-additional]"),
      extraList = settings.querySelector("[data-template-product-list]");
    const populateAdditional = () => {
      const template = templates.find(
          (t) => t.id === form.elements.template_id.value,
        ),
        max = template?.requirements.maxProducts || 1,
        checked = new Set(
          [...extraList.querySelectorAll("input:checked")].map((n) => n.value),
        );
      additional.hidden = max <= 1;
      extraList.replaceChildren(
        ...getProducts()
          .filter((p) => p.status !== "archived" && p.id !== product.value)
          .map((p) => {
            const label = document.createElement("label"),
              input = document.createElement("input");
            input.type = "checkbox";
            input.name = "template_products";
            input.value = p.id;
            input.checked = checked.has(p.id);
            input.disabled = max <= 1;
            label.append(input, document.createTextNode(p.name));
            return label;
          }),
      );
      additional.querySelector("[data-template-product-help]").textContent =
        `Optional: choose up to ${Math.max(0, max - 1)} more products. Each keeps its own variants and price.`;
      const inputs = [...extraList.querySelectorAll("input")],
        count = inputs.filter((n) => n.checked).length;
      inputs.forEach(
        (n) => (n.disabled = max <= 1 || (!n.checked && count >= max - 1)),
      );
    };
    extraList.addEventListener("change", () => {
      const max =
        templates.find((t) => t.id === form.elements.template_id.value)
          ?.requirements.maxProducts || 1;
      const inputs = [...extraList.querySelectorAll("input")],
        count = inputs.filter((n) => n.checked).length;
      inputs.forEach((n) => (n.disabled = !n.checked && count >= max - 1));
    });
    product.addEventListener("change", populateAdditional);
    let templates = [];
    const sync = () => {
      const selected = form.elements.template_id.value;
      settings.hidden = !selected;
      brand.required = product.required = Boolean(selected);
      brand.disabled = product.disabled = !selected;
      const products = form.querySelector("[data-creator-products]");
      const optional = products?.closest("details") || products;
      if (optional) optional.hidden = Boolean(selected);
    };
    options.addEventListener("change", () => {
      populateProducts();
      populateAdditional();
      sync();
    });
    form.addEventListener("reset", () => setTimeout(sync));
    sync();
    list()
      .then((items) => {
        templates = items;
        items.forEach((item) =>
          add(item.id, item.name, item.description, item),
        );
      })
      .catch(() => {
        const note = document.createElement("p");
        note.textContent =
          "Templates are unavailable right now. You can still create a blank page.";
        host.append(note);
      });
    settings
      .querySelector("[data-template-preview]")
      .addEventListener("click", () => {
        const template = templates.find(
          (item) => item.id === form.elements.template_id.value,
        );
        if (!template) return;
        const dialog = document.createElement("dialog");
        dialog.className = "sq-template-preview";
        const header = document.createElement("header"),
          heading = document.createElement("h2");
        heading.textContent = template.name;
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
          img.alt = `${template.name} ${["desktop", "mobile", "footer"][index] || "design"} preview`;
          dialog.append(img);
        });
        dialog.addEventListener("close", () => {
          dialog.remove();
          settings.querySelector("button").focus();
        });
        document.body.append(dialog);
        dialog.showModal();
      });
  }
  async function fromForm(form, products) {
    const templateId = form?.elements.template_id?.value;
    if (!templateId) return null;
    return prepare({
      templateId,
      productIds: [
        form.elements.template_product.value,
        ...[
          ...form.querySelectorAll(
            '[name="template_products"]:checked:not(:disabled)',
          ),
        ].map((n) => n.value),
      ],
      brandName: form.elements.template_brand.value,
      products,
    });
  }
  globalThis.EzkartTemplates = Object.freeze({
    list,
    prepare,
    attach,
    fromForm,
  });
})();
