/* Catalog-bound elements shared by the editor and its ordinary HTML exporter. */
(() => {
  function mount(root, products, editing = false) {
    const previous = root.__commerce;
    previous?.abort.abort();
    const abort = new AbortController();
    const selections = previous?.selections || new Map();
    root.__commerce = { abort, selections };
    const nodes = [...root.querySelectorAll('[data-native-type="commerce"]')];
    const catalog = new Map(products.map((product) => [product.id, product]));
    const config = (node) =>
      JSON.parse(node.dataset.sqNative || node.dataset.nativeCommerce || "{}");
    const money = (value, product) =>
      !product.currency || product.currency === "IDR"
        ? "Rp" + new Intl.NumberFormat("id-ID").format(Number(value) || 0)
        : new Intl.NumberFormat(product.locale || "en-US", {
            style: "currency",
            currency: product.currency || "IDR",
            maximumFractionDigits: Number.isInteger(Number(value)) ? 0 : 2,
          }).format(Number(value) || 0);
    const key = (c) => `${c.productId}:${c.group || c.id}`;
    const element = (tag, text, className) => {
      const node = document.createElement(tag);
      if (text != null) node.textContent = text;
      if (className) node.className = className;
      return node;
    };
    function render(node) {
      const c = config(node),
        product = catalog.get(c.productId);
      node.dataset.nativeCommerce = JSON.stringify(c);
      node.dataset.commercePart = c.part || "options";
      if (c.part === "cart") {
        const button = element(
          "button",
          c.label || "Cart",
          "sq-native-commerce-button",
        );
        button.type = "button";
        button.dataset.commerceCart = "";
        button.dataset.ezkartCartOpen = "";
        const count = element("span", "0", "sq-native-commerce-count");
        count.dataset.ezkartCartCount = "";
        button.append(count);
        node.replaceChildren(button);
        return;
      }
      if (!product) {
        node.replaceChildren(element("p", "Choose a product in the sidebar."));
        return;
      }
      const variantName = (variant) =>
        variant.name ||
        (variant.options || [])
          .map((option) => option.value)
          .filter(Boolean)
          .join(" / ") ||
        product.name;
      const variants = (product.variants || []).filter((v) => !v.hidden);
      const selected =
        variants.find((v) => v.id === selections.get(key(c))) ||
        variants[0] ||
        product;
      selections.set(key(c), selected.id);
      const available =
        product.type !== "physical" ||
        Number(selected.stock ?? product.stock) > 0;
      const selectedImage =
        selected.image || product.images?.[0] || product.image;
      node.dataset.commerceVariant =
        selected.id === product.id ? "" : selected.id;
      if (c.part === "image") {
        if (!selectedImage) {
          node.replaceChildren(element("span", "No product photo"));
          return;
        }
        let img = node.querySelector("img");
        if (!img) {
          img = element("img");
          img.loading = c.loading || "lazy";
          node.replaceChildren(img);
        }
        if (img.getAttribute("src") !== selectedImage) img.src = selectedImage;
        img.alt = `${product.name}${selected !== product ? " — " + variantName(selected) : ""}`;
      } else if (c.part === "options" || !c.part) {
        const field = element("fieldset", null, "sq-native-commerce-options");
        field.dataset.layout = c.optionLayout || "compact";
        const legend = element("legend", c.label || "Choose an option");
        field.append(legend);
        const list = element("div", null, "sq-native-commerce-choices");
        (variants.length ? variants : [product]).forEach((variant) => {
          const label = element("label"),
            input = element("input");
          input.type = "radio";
          input.name = `commerce-${c.id}`;
          input.value = variant.id;
          input.checked = variant.id === selected.id;
          input.dataset.commerceOption = "";
          input.setAttribute("aria-label", variantName(variant));
          const content = element("span", null, "sq-native-commerce-choice");
          content.append(element("strong", variantName(variant)));
          if (c.optionLayout === "detailed") {
            if (variant.description)
              content.append(element("small", variant.description));
            content.append(
              element(
                "small",
                money(variant.price, product) + (c.priceSuffix || ""),
              ),
            );
          }
          if (
            product.type === "physical" &&
            Number(variant.stock ?? product.stock) <= 0
          )
            content.append(element("small", "Sold out"));
          label.append(input, content);
          list.append(label);
        });
        field.append(list);
        node.replaceChildren(field);
      } else if (c.part === "add") {
        const button = element(
          "button",
          available ? c.label || "Add to cart" : "Sold out",
          "sq-native-commerce-button",
        );
        button.type = "button";
        button.disabled = !available;
        button.dataset.commerceAdd = "";
        if (c.showPrice)
          button.append(element("span", money(selected.price, product)));
        node.replaceChildren(button);
      } else {
        const text =
          c.part === "price"
            ? money(selected.price, product)
            : c.part === "description"
              ? selected.description || product.description
              : variantName(selected);
        node.textContent = (c.prefix || "") + (text || "") + (c.suffix || "");
        if (c.part === "price") node.setAttribute("aria-live", "polite");
      }
    }
    nodes.forEach(render);
    if (!editing)
      document.dispatchEvent(
        new CustomEvent("ezkart:commerce", { detail: { action: "refresh" } }),
      );
    root.addEventListener(
      "change",
      (event) => {
        const input = event.target.closest("[data-commerce-option]");
        if (!input) return;
        const owner = input.closest('[data-native-type="commerce"]'),
          c = config(owner);
        selections.set(key(c), input.value);
        nodes
          .filter((node) => key(config(node)) === key(c))
          .forEach((node) => {
            if (node !== owner) render(node);
          });
      },
      { signal: abort.signal },
    );
    root.addEventListener(
      "click",
      (event) => {
        const button = event.target.closest(
          "[data-commerce-add],[data-commerce-cart]",
        );
        if (!button || (editing && !event.altKey)) return;
        event.preventDefault();
        const node = button.closest('[data-native-type="commerce"]'),
          c = config(node);
        document.dispatchEvent(
          new CustomEvent("ezkart:commerce", {
            detail: {
              action: button.hasAttribute("data-commerce-cart")
                ? "cart"
                : "add",
              productId: c.productId,
              variantId: node.dataset.commerceVariant || "",
            },
          }),
        );
      },
      { signal: abort.signal },
    );
  }
  globalThis.EzkartCommerce = { mount };
})();
