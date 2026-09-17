/* Catalog-bound elements shared by the editor and its ordinary HTML exporter. */
(() => {
  function mount(root, products, editing = false) {
    const previous = root.__commerce;
    previous?.abort.abort();
    const abort = new AbortController();
    const selections = previous?.selections || new Map();
    const quantities = previous?.quantities || new Map();
    root.__commerce = { abort, selections, quantities };
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
    const quantityKey = (c, variant) => `${key(c)}:${variant || ""}`;
    const quantity = (c, variant, maximum = Number.MAX_SAFE_INTEGER) =>
      Math.min(
        Math.max(1, maximum),
        quantities.get(quantityKey(c, variant)) || 1,
      );
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
      if (["set-price", "set-add"].includes(c.part)) {
        const items = (c.productIds || []).map((id) => {
          const product = catalog.get(id);
          if (!product) return null;
          const variants = (product.variants || []).filter((v) => !v.hidden),
            selection =
              variants.find(
                (v) => v.id === selections.get(key({ ...c, productId: id })),
              ) ||
              variants[0] ||
              product;
          return { product, selection };
        });
        const complete = items.length > 0 && items.every(Boolean),
          currency = items.find(Boolean)?.product.currency || "IDR";
        const sameCurrency =
          complete &&
          items.every(
            ({ product }) => (product.currency || "IDR") === currency,
          );
        const available =
          sameCurrency &&
          items.every(
            ({ product, selection }) =>
              product.type !== "physical" ||
              Number(selection.stock ?? product.stock) > 0,
          );
        if (c.part === "set-price") {
          node.textContent = sameCurrency
            ? (c.prefix || "") +
              money(
                items.reduce(
                  (sum, item) =>
                    sum +
                    Number(item.selection.price ?? item.product.price ?? 0),
                  0,
                ),
                items[0].product,
              ) +
              (c.suffix || "")
            : "Products unavailable";
          node.setAttribute("aria-live", "polite");
        } else {
          const button = element(
            "button",
            available ? c.label || "Add selected products" : "Set unavailable",
            "sq-native-commerce-button",
          );
          button.type = "button";
          button.disabled = !available;
          button.dataset.commerceSet = "";
          if (available && c.showPrice) {
            const price = money(
              items.reduce(
                (sum, item) =>
                  sum + Number(item.selection.price ?? item.product.price ?? 0),
                0,
              ),
              items[0].product,
            );
            button.append(
              element("span", price, "sq-native-commerce-button-price"),
            );
          }
          node.replaceChildren(button);
          node.__commerceSet = complete
            ? items.map(({ product, selection }) => ({
                productId: product.id,
                variantId: selection === product ? "" : selection.id,
              }))
            : [];
        }
        return;
      }
      if (!product) {
        if (c.part === "add") {
          const button = element(
            "button",
            "Choose a product",
            "sq-native-commerce-button",
          );
          button.type = "button";
          button.disabled = true;
          node.replaceChildren(button);
        } else
          node.replaceChildren(
            element(
              "p",
              c.part === "price" ? "—" : "Connect a product in Products.",
            ),
          );
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
      const fixed =
        c.variantId &&
        ["image", "price", "title", "description", "add"].includes(c.part);
      const selected = fixed
        ? variants.find((v) => v.id === c.variantId)
        : variants.find((v) => v.id === selections.get(key(c))) ||
          variants[0] ||
          product;
      if (!selected) {
        delete node.dataset.commerceVariant;
        if (c.part === "add") {
          const button = element(
            "button",
            "Variant unavailable",
            "sq-native-commerce-button",
          );
          button.type = "button";
          button.disabled = true;
          node.replaceChildren(button);
        } else
          node.textContent = c.part === "price" ? "—" : "Variant unavailable";
        return;
      }
      if (!fixed) selections.set(key(c), selected.id);
      const available =
        product.type !== "physical" ||
        Number(selected.stock ?? product.stock) > 0;
      const selectedImage =
        selected.image || product.images?.[0] || product.image;
      node.dataset.commerceVariant =
        selected.id === product.id ? "" : selected.id;
      node.dataset.commerceMaximum = String(
        product.type === "physical"
          ? Math.max(
              0,
              Math.floor(Number(selected.stock ?? product.stock) || 0),
            )
          : Number.MAX_SAFE_INTEGER,
      );
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
      } else if (c.part === "quantity") {
        let field = node.querySelector(".sq-native-commerce-quantity");
        if (!field) {
          field = element("div", null, "sq-native-commerce-quantity");
          field.setAttribute("role", "group");
          const decrease = element("button", "−"),
            input = element("input"),
            increase = element("button", "+");
          for (const [button, step, label] of [
            [decrease, -1, "Decrease quantity"],
            [increase, 1, "Increase quantity"],
          ]) {
            button.type = "button";
            button.dataset.commerceStep = step;
            button.setAttribute("aria-label", label);
          }
          input.type = "number";
          input.min = "1";
          input.step = "1";
          input.inputMode = "numeric";
          input.dataset.commerceQuantity = "";
          field.append(decrease, input, increase);
          node.replaceChildren(field);
        }
        field.setAttribute("aria-label", c.label || "Quantity");
        const input = field.querySelector("input"),
          maximum = Number(node.dataset.commerceMaximum),
          value = quantity(c, node.dataset.commerceVariant, maximum);
        quantities.set(quantityKey(c, node.dataset.commerceVariant), value);
        input.setAttribute("aria-label", c.label || "Quantity");
        input.max = String(Math.max(1, maximum));
        input.value = value;
        input.disabled = !available;
        field.querySelector('[data-commerce-step="-1"]').disabled =
          !available || value <= 1;
        field.querySelector('[data-commerce-step="1"]').disabled =
          !available || value >= maximum;
      } else if (c.part === "availability") {
        node.textContent = available ? c.label || "In stock" : "Sold out";
        node.setAttribute("aria-live", "polite");
      } else if (c.part === "options" || !c.part) {
        const field = element("fieldset", null, "sq-native-commerce-options");
        field.dataset.layout = c.optionLayout || "compact";
        const legend = element("legend", c.label || "Choose an option");
        field.append(legend);
        if (
          c.optionLayout === "select" ||
          (variants.length > 6 &&
            !["detailed", "cards", "swatches"].includes(c.optionLayout))
        ) {
          const select = element("select", null, "sq-native-commerce-select");
          select.dataset.commerceOption = "";
          select.setAttribute("aria-label", c.label || "Choose an option");
          (variants.length ? variants : [product]).forEach((variant) => {
            const soldOut =
              product.type === "physical" &&
              Number(variant.stock ?? product.stock) <= 0;
            const option = element(
              "option",
              variantName(variant) + (soldOut ? " — Sold out" : ""),
            );
            option.value = variant.id;
            option.selected = variant.id === selected.id;
            select.append(option);
          });
          field.append(select);
          node.replaceChildren(field);
          return;
        }
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
          const swatch =
            c.optionLayout === "swatches" && c.variantColors?.[variant.id];
          if (swatch && /^#[0-9a-f]{6}$/i.test(swatch)) {
            content.classList.add("sq-native-commerce-swatch");
            content.style.backgroundColor = swatch;
            content.setAttribute("aria-hidden", "true");
            label.title = variantName(variant);
          } else content.append(element("strong", variantName(variant)));
          if (["detailed", "cards"].includes(c.optionLayout)) {
            if (c.optionLayout === "detailed" && variant.description)
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
          ) {
            input.setAttribute(
              "aria-label",
              variantName(variant) + " — Sold out",
            );
            label.dataset.soldOut = "true";
            if (!swatch) content.append(element("small", "Sold out"));
          }
          label.append(input, content);
          list.append(label);
        });
        field.append(list);
        if (c.optionLayout === "swatches") {
          const value = element(
            "span",
            variantName(selected) + (!available ? " — Sold out" : ""),
            "sq-native-commerce-selection",
          );
          value.setAttribute("aria-live", "polite");
          field.append(value);
        }
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
              : c.part === "product-name"
                ? product.name
                : variantName(selected);
        node.textContent = (c.prefix || "") + (text || "") + (c.suffix || "");
        if (c.part === "price") node.setAttribute("aria-live", "polite");
      }
    }
    nodes.forEach(render);
    function changeQuantity(owner, value) {
      const c = config(owner),
        maximum = Number(owner.dataset.commerceMaximum);
      value = Number.isFinite(value) ? Math.trunc(value) : 1;
      quantities.set(
        quantityKey(c, owner.dataset.commerceVariant),
        Math.min(Math.max(1, maximum), Math.max(1, value)),
      );
      nodes
        .filter(
          (node) =>
            config(node).part === "quantity" && key(config(node)) === key(c),
        )
        .forEach(render);
    }
    if (!editing)
      document.dispatchEvent(
        new CustomEvent("ezkart:commerce", { detail: { action: "refresh" } }),
      );
    root.addEventListener(
      "change",
      (event) => {
        if (event.target.matches("[data-commerce-quantity]")) {
          changeQuantity(
            event.target.closest('[data-native-type="commerce"]'),
            Number(event.target.value),
          );
          return;
        }
        const input = event.target.closest("[data-commerce-option]");
        if (!input) return;
        const owner = input.closest('[data-native-type="commerce"]'),
          c = config(owner);
        selections.set(key(c), input.value);
        const selectionLabel = owner.querySelector(
          ".sq-native-commerce-selection",
        );
        if (selectionLabel) {
          const product = catalog.get(c.productId);
          const variant =
            product?.variants?.find((v) => v.id === input.value) || product;
          if (variant)
            selectionLabel.textContent =
              (variant.name ||
                (variant.options || [])
                  .map((option) => option.value)
                  .filter(Boolean)
                  .join(" / ") ||
                product.name) +
              (product.type === "physical" &&
              Number(variant.stock ?? product.stock) <= 0
                ? " — Sold out"
                : "");
        }
        nodes
          .filter(
            (node) =>
              key(config(node)) === key(c) ||
              (["set-price", "set-add"].includes(config(node).part) &&
                config(node).group === c.group),
          )
          .forEach((node) => {
            if (node !== owner) render(node);
          });
      },
      { signal: abort.signal },
    );
    root.addEventListener(
      "click",
      (event) => {
        const step = event.target.closest("[data-commerce-step]");
        if (step) {
          if (editing && !event.altKey) return;
          event.preventDefault();
          const owner = step.closest('[data-native-type="commerce"]');
          changeQuantity(
            owner,
            Number(owner.querySelector("input").value) +
              Number(step.dataset.commerceStep),
          );
          if (step.disabled)
            owner.querySelector("input").focus({ preventScroll: true });
          return;
        }
        const button = event.target.closest(
          "[data-commerce-add],[data-commerce-cart],[data-commerce-set]",
        );
        if (!button || (editing && !event.altKey)) return;
        event.preventDefault();
        const node = button.closest('[data-native-type="commerce"]'),
          c = config(node);
        node.closest("dialog[open]")?.close();
        document.dispatchEvent(
          new CustomEvent("ezkart:commerce", {
            detail: {
              items: node.__commerceSet,
              action: button.hasAttribute("data-commerce-set")
                ? "add-set"
                : button.hasAttribute("data-commerce-cart")
                  ? "cart"
                  : "add",
              productId: c.productId,
              variantId: node.dataset.commerceVariant || "",
              quantity: quantity(
                c,
                node.dataset.commerceVariant,
                Number(node.dataset.commerceMaximum),
              ),
            },
          }),
        );
      },
      { signal: abort.signal },
    );
  }
  globalThis.EzkartCommerce = { mount };
})();
