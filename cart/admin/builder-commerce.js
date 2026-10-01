/* Catalog-bound elements shared by the editor and its ordinary HTML exporter. */
(() => {
  function mount(root, products, editing = false) {
    const previous = root.__commerce;
    previous?.abort.abort();
    const abort = new AbortController();
    const selections = previous?.selections || new Map();
    const quantities = previous?.quantities || new Map();
    // Default variants still supply price/stock; photos follow explicit choices.
    const chosenVariants = previous?.chosenVariants || new Map();
    root.__commerce = { abort, selections, quantities, chosenVariants };
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
      if (!fixed) {
        if (chosenVariants.get(key(c)) !== selected.id) chosenVariants.delete(key(c));
        selections.set(key(c), selected.id);
      }
      const available =
        product.type !== "physical" ||
        Number(selected.stock ?? product.stock) > 0;
      const coverImage = product.images?.[0] || product.image;
      const showVariantImage = fixed || chosenVariants.get(key(c)) === selected.id;
      const selectedImage = (showVariantImage && selected.image) || coverImage || selected.image;
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
        node.dataset.ezkartProductImages = JSON.stringify([...(product.images || []), ...variants.map(variant => variant.image).filter(Boolean)]);
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
        img.alt = `${product.name}${selected !== product && ((showVariantImage && selected.image) || !coverImage) ? " — " + variantName(selected) : ""}`;
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
        if (input.value) chosenVariants.set(key(c), input.value);
        else chosenVariants.delete(key(c));
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
    root.addEventListener("ezkart:select-choose", event => {
      const input = event.target.closest("[data-commerce-option]");
      if (input && chosenVariants.get(key(config(input.closest('[data-native-type="commerce"]')))) !== input.value) input.dispatchEvent(new Event("change", {bubbles:true}));
    }, {signal:abort.signal});
    // Editor selection stops bubbling clicks; observe a confirmed radio choice
    // before that handler, including confirmation of the checked default.
    root.addEventListener("click", event => {
      const option = event.target.closest('[data-commerce-option][type="radio"]');
      if (!option?.checked) return;
      const choiceKey = key(config(option.closest('[data-native-type="commerce"]')));
      if (chosenVariants.get(choiceKey) !== option.value) option.dispatchEvent(new Event("change", {bubbles:true}));
    }, {signal:abort.signal,capture:true});
    root.addEventListener("keydown", event => {
      const option = event.target.closest('[data-commerce-option][type="radio"]');
      if (event.key === " " && option?.checked && !event.repeat) {
        const choiceKey = key(config(option.closest('[data-native-type="commerce"]')));
        if (chosenVariants.get(choiceKey) !== option.value) option.dispatchEvent(new Event("change", {bubbles:true}));
      }
    }, {signal:abort.signal,capture:true});
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

/* The same accessible photo gallery is serialized into ordinary page exports. */
(() => {
  function mount(root, editing = false) {
    if (!root || root.__productImages) return;
    root.__productImages = true;
    const labels = { 'Enlarge product photo': 'Perbesar foto produk', 'Product photo': 'Foto produk', 'Close photo': 'Tutup foto', 'Previous photo': 'Foto sebelumnya', 'Next photo': 'Foto berikutnya', 'Zoom in': 'Perbesar', 'Reset zoom': 'Atur ulang zoom', 'Photo': 'Foto', 'Photo unavailable': 'Foto tidak tersedia' };
    const label = text => globalThis.EzkartLanguage?.t(text) || (/^id\b/.test(document.documentElement.lang) ? labels[text] : text);
    const selector = '[data-product-card] > .product-art,[data-native-type="commerce"][data-commerce-part="image"]';
    let dialog, stage, full, status, zoomButton, previousButton, nextButton, trigger, activeHistory = '', historyClosing = false, pendingArt;
    let photos = [], index = 0, scale = 1, pan = { x: 0, y: 0 }, gesture, pinch, pinched = false, lastTap, lastPointerType = 'mouse';
    const pointers = new Map();
    const prepare = () => {
      root.querySelectorAll('[data-ezkart-photo-trigger]').forEach(art => {
        if (art.matches(selector) && art.querySelector('img')) return;
        ['role', 'tabindex', 'aria-label', 'aria-haspopup', 'data-ezkart-photo-trigger'].forEach(name => art.removeAttribute(name));
      });
      root.querySelectorAll(selector).forEach(art => {
        if (!art.querySelector('img')) return;
        art.setAttribute('data-ezkart-photo-trigger', ''); art.setAttribute('role', 'button'); art.tabIndex = 0;
        art.setAttribute('aria-label', label('Enlarge product photo')); art.setAttribute('aria-haspopup', 'dialog');
      });
    };
    const imageUrl = value => {
      if (typeof value !== 'string' || !value.trim()) return '';
      try {
        const url = new URL(value, location.href);
        return /^(https?:|blob:)$/.test(url.protocol) || /^data:image\/(png|jpe?g|webp|gif|avif);/i.test(value) ? url.href : '';
      } catch (_) { return ''; }
    };
    const galleryFor = art => {
      const photo = art.querySelector('img'), card = art.closest('[data-product-card]');
      const candidates = [photo?.currentSrc || photo?.src];
      try { candidates.push(...JSON.parse((card || art).dataset.ezkartProductImages || '[]')); } catch (_) {}
      try { candidates.push(...JSON.parse(card?.querySelector('[data-ezkart-variants]')?.dataset.ezkartVariants || '[]').map(variant => variant.image)); } catch (_) {}
      return [...new Set(candidates.map(imageUrl).filter(Boolean))].map(src => ({ src, alt: photo?.alt || '' }));
    };
    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
    const transform = () => {
      const maxX = Math.max(0, (full.clientWidth * scale - stage.clientWidth) / 2);
      const maxY = Math.max(0, (full.clientHeight * scale - stage.clientHeight) / 2);
      pan.x = clamp(pan.x, -maxX, maxX); pan.y = clamp(pan.y, -maxY, maxY);
      full.style.transform = `translate(${pan.x}px,${pan.y}px) scale(${scale})`;
      dialog.dataset.photoZoom = String(scale);
      zoomButton.setAttribute('aria-label', label(scale > 1.01 ? 'Reset zoom' : 'Zoom in'));
      zoomButton.title = zoomButton.getAttribute('aria-label');
      zoomButton.setAttribute('aria-pressed', String(scale > 1.01));
      zoomButton.querySelector('path').setAttribute('d', (scale > 1.01 ? '' : 'M10 5v10') + 'M5 10h10M16 16l5 5M17 10a7 7 0 1 0-14 0 7 7 0 0 0 14 0');
    };
    const reset = () => { scale = 1; pan = { x: 0, y: 0 }; pointers.clear(); gesture = pinch = lastTap = null; pinched = false; transform(); };
    const toggleZoom = point => {
      const rect = stage.getBoundingClientRect();
      if (scale > 1.01) { scale = 1; pan = { x: 0, y: 0 }; }
      else { scale = 2.5; pan = point ? { x: (point.x - rect.left - rect.width / 2) * (1 - scale), y: (point.y - rect.top - rect.height / 2) * (1 - scale) } : { x: 0, y: 0 }; }
      transform();
    };
    const show = next => {
      index = (next + photos.length) % photos.length; reset();
      full.hidden = false; full.src = photos[index].src; full.alt = photos[index].alt;
      status.textContent = label('Photo') + ' ' + (index + 1) + ' / ' + photos.length;
      previousButton.hidden = nextButton.hidden = photos.length < 2;
    };
    const finish = () => {
      pointers.clear(); gesture = pinch = null;
      if (dialog?.open) dialog.close();
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
    const close = () => {
      if (!dialog?.open) return;
      finish();
      if (activeHistory && history.state?.ezkartProductPhoto === activeHistory) { historyClosing = true; history.back(); }
      activeHistory = '';
    };
    addEventListener('popstate', () => {
      historyClosing = false;
      if (activeHistory && history.state?.ezkartProductPhoto !== activeHistory) { activeHistory = ''; finish(); }
      if (pendingArt?.isConnected) { const art = pendingArt; pendingArt = null; open(art); }
    });
    const iconButton = (name, path, attribute) => {
      const button = document.createElement('button'); button.type = 'button'; button.setAttribute(attribute, '');
      button.setAttribute('aria-label', label(name)); button.title = label(name);
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
      const shape = document.createElementNS(svg.namespaceURI, 'path'); shape.setAttribute('d', path); svg.append(shape); button.append(svg);
      return button;
    };
    const create = () => {
      dialog = document.createElement('dialog'); dialog.className = 'sq-product-image-dialog';
      const header = document.createElement('header'), footer = document.createElement('footer');
      zoomButton = iconButton('Zoom in', 'M10 5v10M5 10h10M16 16l5 5M17 10a7 7 0 1 0-14 0 7 7 0 0 0 14 0', 'data-photo-zoom');
      const closeButton = iconButton('Close photo', 'm6 6 12 12M6 18 18 6', 'data-photo-close');
      const closeText = document.createElement('span'); closeText.textContent = label('Close photo'); closeButton.append(closeText);
      header.append(zoomButton, closeButton); closeButton.addEventListener('click', close); zoomButton.addEventListener('click', () => toggleZoom());
      stage = document.createElement('div'); stage.className = 'sq-product-image-stage';
      full = document.createElement('img'); full.draggable = false; full.decoding = 'async'; stage.append(full);
      full.addEventListener('load', () => { full.hidden = false; status.textContent = label('Photo') + ' ' + (index + 1) + ' / ' + photos.length; transform(); }); full.addEventListener('error', () => { full.hidden = true; status.textContent = label('Photo unavailable') + ' · ' + (index + 1) + ' / ' + photos.length; });
      previousButton = iconButton('Previous photo', 'm15 5-7 7 7 7', 'data-photo-previous'); nextButton = iconButton('Next photo', 'm9 5 7 7-7 7', 'data-photo-next');
      previousButton.addEventListener('click', () => show(index - 1)); nextButton.addEventListener('click', () => show(index + 1));
      status = document.createElement('span'); status.className = 'sq-product-image-count'; status.setAttribute('role', 'status');
      footer.append(previousButton, status, nextButton); dialog.append(header, stage, footer); document.body.append(dialog);
      dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
      dialog.addEventListener('keydown', event => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); event.stopPropagation(); show(index + (event.key === 'ArrowRight' ? 1 : -1)); }
      });
      stage.addEventListener('dblclick', event => { if (lastPointerType === 'mouse') { event.preventDefault(); toggleZoom({ x: event.clientX, y: event.clientY }); } });
      stage.addEventListener('pointerdown', event => {
        if (event.button !== 0 || !dialog.open) return;
        event.preventDefault(); lastPointerType = event.pointerType; stage.setPointerCapture(event.pointerId);
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (pointers.size === 1) { gesture = { x: event.clientX, y: event.clientY, pan: { ...pan }, time: Date.now(), type: event.pointerType }; pinched = false; }
        if (pointers.size === 2) {
          const [a, b] = [...pointers.values()]; pinched = true;
          pinch = { distance: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)), midpoint: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, scale, pan: { ...pan } };
        }
      });
      stage.addEventListener('pointermove', event => {
        if (!pointers.has(event.pointerId)) return;
        event.preventDefault(); pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (pointers.size >= 2 && pinch) {
          const [a, b] = [...pointers.values()], mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, rect = stage.getBoundingClientRect();
          scale = clamp(pinch.scale * Math.hypot(b.x - a.x, b.y - a.y) / pinch.distance, 1, 4);
          pan = { x: mid.x - rect.left - rect.width / 2 - (pinch.midpoint.x - rect.left - rect.width / 2 - pinch.pan.x) * scale / pinch.scale, y: mid.y - rect.top - rect.height / 2 - (pinch.midpoint.y - rect.top - rect.height / 2 - pinch.pan.y) * scale / pinch.scale };
          transform();
        } else if (gesture && scale > 1.01) { pan = { x: gesture.pan.x + event.clientX - gesture.x, y: gesture.pan.y + event.clientY - gesture.y }; transform(); }
      });
      const endPointer = event => {
        if (!pointers.has(event.pointerId)) return;
        pointers.delete(event.pointerId);
        if (pointers.size === 1) { const [point] = pointers.values(); gesture = { ...gesture, x: point.x, y: point.y, pan: { ...pan } }; pinch = null; return; }
        if (pointers.size || !gesture) return;
        const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y, elapsed = Date.now() - gesture.time;
        if (event.type !== 'pointercancel' && !pinched) {
          if (scale <= 1.01 && elapsed < 900 && Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.3) show(index + (dx < 0 ? 1 : -1));
          else if (gesture.type === 'touch' && Math.hypot(dx, dy) < 12 && elapsed < 350) {
            const point = { x: event.clientX, y: event.clientY }, now = Date.now();
            if (lastTap && now - lastTap.time < 350 && Math.hypot(point.x - lastTap.x, point.y - lastTap.y) < 30) { toggleZoom(point); lastTap = null; }
            else lastTap = { ...point, time: now };
          }
        }
        gesture = pinch = null;
      };
      stage.addEventListener('pointerup', endPointer); stage.addEventListener('pointercancel', endPointer);
      addEventListener('resize', () => { if (dialog.open) transform(); });
    };
    function open(art) {
      if (historyClosing) { pendingArt = art; return; }
      photos = galleryFor(art); if (!photos.length) return;
      if (!dialog) create(); trigger = art;
      dialog.setAttribute('aria-label', label('Product photo') + (photos[0].alt ? ': ' + photos[0].alt : ''));
      dialog.showModal(); show(0); dialog.querySelector('[data-photo-close]').focus();
      activeHistory = 'photo-' + Date.now() + '-' + Math.random().toString(36).slice(2);
      try { history.pushState({ ...history.state, ezkartProductPhoto: activeHistory }, ''); } catch (_) { activeHistory = ''; }
    }
    root.addEventListener('click', event => {
      let art = event.target.closest(selector);
      if (!art && editing && event.altKey) {
        art = [...event.target.closest('.sq-product-grid,[data-commerce-part="image"]')?.querySelectorAll('.product-art') || []].find(photo => {
          const rect = photo.getBoundingClientRect(); return event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
        });
      }
      if (!art || !root.contains(art) || !art.querySelector('img') || (editing && !root.querySelector('[data-image-page]') && !event.altKey)) return;
      event.preventDefault(); event.stopImmediatePropagation(); open(art);
    }, true);
    root.addEventListener('keydown', event => {
      const art = event.target.closest(selector); if (!art || !['Enter', ' '].includes(event.key)) return;
      event.preventDefault(); event.stopImmediatePropagation(); open(art);
    }, true);
    new MutationObserver(prepare).observe(root, { childList: true, subtree: true }); prepare();
  }
  globalThis.EzkartProductImages = { mount };
})();
