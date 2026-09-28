(() => {
  "use strict";

  const state = {
    products: {},
    cart: {},
    customer: {},
    deliveryCoordinate: null,
    shipping: null,
    shippingRequired: true,
    environmentShippingRequired: true,
    hasPhysical: true,
    step: "confirm",
    loaded: false,
    shop: "store",
    returnUrl: "",
    durableCheckout: false,
    pendingCheckout: null,
    paymentBusy: false,
    paymentChoices: [],
    paymentChoice: "",
    hostedPaymentMethods: [],
    recoveryError: "",
  };

  const params = new URLSearchParams(window.location.search);
  const hostedEntry = params.has("product") || params.has("store");
  let hostedStore = null, hostedProduct = null, productOpened = false;

  const byId = (id) => document.getElementById(id);
  const money = (value) => new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);
  const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character]);
  const friendlyError = (value, fallback) => {
    const message = String(value || fallback || "Something went wrong.");
    return message
      .replace(/midtrans|doku|xendit|stripe|paypal/gi, "payment service")
      .replace(/biteship/gi, "delivery service");
  };
  const cartEntries = () => Object.entries(state.cart)
    .filter(([id, quantity]) => state.products[id] && quantity > 0);
  const itemCount = () => cartEntries()
    .reduce((sum, [, quantity]) => sum + quantity, 0);
  const subtotal = () => cartEntries()
    .reduce((sum, [id, quantity]) => sum + state.products[id].price * quantity, 0);
  const shippingPrice = () => Number(state.shipping?.price) || 0;
  const total = () => subtotal() + shippingPrice();

  const validSelectionId = (value) => /^[a-z0-9][a-z0-9_-]{2,95}(?:~[a-z0-9][a-z0-9_-]{2,95})?$/i.test(value);
  const safeShopScope = (value) => {
    const scope = String(value || "").trim();
    return /^[a-z0-9][a-z0-9_-]{5,79}$/i.test(scope) ? scope.toLowerCase() : "";
  };
  const brandScope = (value) => String(value || "store")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "store";
  const safeReturnUrl = (value) => {
    const requested = String(value || "").trim();
    if (!requested) return "";
    try {
      const url = new URL(requested, window.location.href);
      const checkoutPath = new URL(".", window.location.href).pathname;
      if (!["https:", "http:"].includes(url.protocol)) return "";
      if (url.origin === window.location.origin && url.pathname.startsWith(checkoutPath)) return "";
      return url.href;
    } catch (_) {
      return "";
    }
  };
  const cartStorageKey = () => `ezkart.checkout.cart.v1:${state.shop}`;
  const shopStorageKey = () => `ezkart.checkout.shop.v1:${state.shop}`;
  const readStoredCart = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(cartStorageKey()) || "{}");
      return Object.fromEntries(Object.entries(saved).filter(([id, quantity]) => (
        validSelectionId(id) && Number.isSafeInteger(quantity) && quantity > 0
      )));
    } catch (_) {
      return {};
    }
  };
  const saveCart = () => {
    try {
      localStorage.setItem(cartStorageKey(), JSON.stringify(state.cart));
    } catch (_) {}
  };
  const readStoredShop = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(shopStorageKey()) || "{}");
      return saved && typeof saved === "object" ? saved : {};
    } catch (_) {
      return {};
    }
  };
  const saveShop = (shop) => {
    try {
      localStorage.setItem(shopStorageKey(), JSON.stringify(shop));
    } catch (_) {}
  };

  function showToast(message) {
    const toast = byId("toast");
    toast.textContent = friendlyError(message);
    toast.classList.add("visible");
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => toast.classList.remove("visible"), 2600);
  }

  function applyMerchantBrand() {
    const legacyStored = (() => {
      try {
        return JSON.parse(sessionStorage.getItem("ezkart.checkout.brand") || "{}");
      } catch (_) {
        return {};
      }
    })();
    const requestedName = String(hostedStore?.name || params.get("brand") || "").trim();
    state.shop = hostedStore?.cartScope || safeShopScope(params.get("shop")) || brandScope(requestedName || legacyStored.name);
    const stored = readStoredShop();
    const name = String(requestedName || stored.name || legacyStored.name || "Store").trim().slice(0, 80) || "Store";
    const requestedLogo = String(hostedStore ? hostedStore.logoUrl : params.get("logo") || stored.logo || legacyStored.logo || "").trim();
    let logo = "";

    try {
      const url = new URL(requestedLogo);
      if (["https:", "http:"].includes(url.protocol) && requestedLogo.length <= 1800) logo = url.href;
    } catch (_) {}

    const explicitReturn = safeReturnUrl(params.get("return"));
    const referringPage = safeReturnUrl(document.referrer);
    const storedReturn = safeReturnUrl(stored.returnUrl);
    const shopReturn = hostedStore?.enabled ? new URL(window.EzkartStorefront.shopUrl(hostedStore), location.origin).href : "";
    state.returnUrl = hostedEntry && shopReturn ? shopReturn : explicitReturn || referringPage || storedReturn || shopReturn;
    const shop = { name, logo, returnUrl: state.returnUrl };
    // Keep the current visit in navigation, but never remember it in branding
    // for later shopping sessions. Checkout recovery retains its original body.
    try { const remembered = new URL(shop.returnUrl); remembered.searchParams.delete('campaign_visit'); shop.returnUrl = remembered.href; } catch (_) {}
    saveShop(shop);
    try { sessionStorage.setItem("ezkart.checkout.brand", JSON.stringify({ ...shop, scope: state.shop })); } catch (_) {}

    const messageLink = byId("merchant-message");
    if (messageLink) {
      const product = params.get('product');
      const context = product && hostedStore ? 'product=' + encodeURIComponent(product) : hostedStore?.enabled ? 'store=' + encodeURIComponent(hostedStore.id) : '';
      messageLink.hidden = !context; messageLink.href = '/cart/messages.php' + (context ? '?' + context : '');
    }
    byId("merchant-name").textContent = name;
    byId("merchant-avatar").textContent = name.charAt(0).toUpperCase();
    const image = byId("merchant-logo");
    image.hidden = true;
    byId("merchant-avatar").hidden = false;
    if (logo) {
      image.src = logo;
      image.alt = `${name} logo`;
      image.hidden = false;
      byId("merchant-avatar").hidden = true;
      image.addEventListener("error", () => {
        image.hidden = true;
        byId("merchant-avatar").hidden = false;
      }, { once: true });
    }
    document.title = `Checkout for ${name} · Ezpay`;
  }

  function requestedCart() {
    const requested = {};
    const parseEntries = (value, defaultQuantity = null) => String(value || "").split(",").forEach((entry) => {
      const match = entry.trim().match(/^([a-z0-9][a-z0-9_-]{2,95}(?:~[a-z0-9][a-z0-9_-]{2,95})?):(\d+)$/i);
      if (match) {
        const quantity = Number(match[2]);
        requested[match[1]] = Number.isSafeInteger(quantity) && quantity > 0 ? quantity : 1;
      } else if (defaultQuantity !== null && validSelectionId(entry.trim())) {
        requested[entry.trim()] = defaultQuantity;
      }
    });
    if (params.has("add")) {
      parseEntries(params.get("add"), 1);
      return { mode: "merge", items: requested };
    }
    if (params.has("cart")) {
      parseEntries(params.get("cart"));
      return { mode: "replace", items: requested };
    }
    if (params.has("products")) {
      parseEntries(params.get("products"), 1);
      return { mode: "replace", items: requested };
    }
    return { mode: "stored", items: {} };
  }

  function cleanAddParameter() {
    if (!params.has("add")) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("add");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }

  async function loadCatalog() {
    if (state.pendingCheckout || state.recoveryError) { renderRecovery(); return; }
    document.querySelector('.checkout-layout').classList.remove('is-paused');
    document.querySelector('.order-summary').hidden=false;
    (byId('catalog-error-title')||byId('catalog-error').querySelector('b')).textContent='We couldn’t load your cart';
    byId('catalog-error').setAttribute('role','alert');
    if (hostedEntry && !hostedStore) {
      try {
        const data = await window.EzkartStorefront.load(params.has("product") ? { product: params.get("product"), ...(params.has("store") ? { store: params.get("store") } : {}) } : { store: params.get("store"), mode: "checkout" });
        hostedStore = data.store;
        hostedProduct = data.products?.[0] || null;
        window.EzkartStorefront.appearance(hostedStore);
        window.EzkartStorefront.support(hostedStore,byId('store-support'),{description:false});
        applyMerchantBrand();
      } catch (error) {
        byId("catalog-loading").hidden = true;
        byId("catalog-error").hidden = false;
        byId("catalog-error-message").textContent = error.message;
        return;
      }
    }
    const request = requestedCart();
    const saved = readStoredCart();
    const requested = request.mode === "merge"
      ? Object.fromEntries([...new Set([...Object.keys(saved), ...Object.keys(request.items)])].map((id) => [
        id,
        (saved[id] || 0) + (request.items[id] || 0),
      ]))
      : request.mode === "replace" ? request.items : saved;
    if (hostedProduct && !productOpened) {
      const choice = hostedProduct.choices.find(item => item.available);
      if (!choice) {
        byId("catalog-loading").hidden = true;
        byId("catalog-error").hidden = false;
        byId("catalog-error-message").textContent = hostedProduct.type === "subscription" ? "Online checkout is not available for this product yet." : "This product is currently unavailable.";
        hostedStore = null;
        return;
      }
      if (!Object.keys(requested).some(id => id === hostedProduct.id || id.startsWith(`${hostedProduct.id}~`))) requested[choice.id] = 1;
    }
    const ids = Object.keys(requested);
    state.loaded = false;
    byId("catalog-loading").hidden = false;
    byId("catalog-error").hidden = true;
    byId("cart-items").hidden = true;
    byId("empty-cart").hidden = true;
    byId("to-checkout").disabled = true;

    if (!ids.length) {
      state.products = {};
      state.cart = {};
      saveCart();
      state.loaded = true;
      byId("catalog-loading").hidden = true;
      renderCart();
      return;
    }

    try {
      const [response, configResponse] = await Promise.all([
        fetch(`api/catalog.php?products=${encodeURIComponent(ids.join(","))}`, {
          headers: { Accept: "application/json" },
          cache: "no-store",
        }),
        fetch("api/checkout-config.php", {
          headers: { Accept: "application/json" },
          cache: "no-store",
        }),
      ]);
      const config = await configResponse.json().catch(() => ({}));
      if (!configResponse.ok || !["sandbox", "production"].includes(config.environment)
          || config.shipping_required !== (config.environment === "production")) {
        throw Object.assign(new Error(typeof config.error === "string" ? config.error : "Checkout settings could not load. Please try again."),
          {checkoutPaused:configResponse.status===503&&config.code==='checkout_paused'});
      }
      state.environmentShippingRequired = config.shipping_required;
      state.durableCheckout = config.durable_checkout === true;
      if (config.payment_choices !== undefined && (!Array.isArray(config.payment_choices)
          || config.payment_choices.length > 3 || config.payment_choices.some(value => !["bca_va", "doku_checkout", "shopeepay"].includes(value))
          || new Set(config.payment_choices).size !== config.payment_choices.length)) throw new Error("Payment options could not load. Please try again.");
      const choices = state.durableCheckout ? config.payment_choices || [] : [];
      const hostedMethods = config.hosted_payment_methods || [];
      if ((choices.includes("doku_checkout") || choices.includes("shopeepay")) && (!Array.isArray(hostedMethods) || !hostedMethods.length
          || hostedMethods.some(value => !["QRIS", "CREDIT_CARD", "EMONEY_SHOPEEPAY"].includes(value)))) throw new Error("Payment options could not load. Please try again.");
      if ((choices.includes("shopeepay") && !hostedMethods.includes("EMONEY_SHOPEEPAY"))
          || (choices.includes("doku_checkout") && !hostedMethods.some(method => ["QRIS", "CREDIT_CARD"].includes(method)))) throw new Error("Payment options could not load. Please try again.");
      state.paymentChoices = choices;
      state.hostedPaymentMethods = hostedMethods;
      if (!choices.includes(state.paymentChoice)) state.paymentChoice = choices.includes("bca_va") ? "bca_va" : choices[0] || "";
      renderPaymentChoices();
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "The selected products are unavailable.");

      const products = Array.isArray(payload.products) ? payload.products : [];
      state.products = Object.fromEntries(products.map((product) => [product.id, product]));
      if (ids.some((id) => !state.products[id])) {
        throw new Error("A selected product is no longer available.");
      }
      if (!hostedStore && !hostedEntry && products[0]?.seller_id && products[0].seller_id !== "demo") {
        try {
          const data = await window.EzkartStorefront.load({ store: products[0].seller_id, mode: "checkout" });
          // Keep existing website cart scopes and return destinations working.
          hostedStore = { ...data.store, cartScope: state.shop };
          window.EzkartStorefront.appearance(hostedStore);
          window.EzkartStorefront.support(hostedStore,byId('store-support'),{description:false});
          applyMerchantBrand();
        } catch (_) { /* Existing checkout links remain usable during an appearance-service outage. */ }
      }
      if (hostedStore && products.some(product => product.seller_id !== hostedStore.id)) throw new Error("Products from different stores need separate carts.");

      state.cart = Object.fromEntries(ids.map((id) => {
        const stock = Math.min(10000, Math.max(0, Number(state.products[id].stock ?? 10000)));
        const quantity = Math.min(requested[id], stock);
        return [id, quantity];
      }).filter(([, quantity]) => quantity > 0));
      saveCart();
      productOpened = true;
      cleanAddParameter();
      // A handoff is consumed once; reloads must keep subsequent quantity edits.
      if (hostedStore) {
        const url = new URL(location.href);
        for (const key of ["cart", "products", "add"]) { params.delete(key); url.searchParams.delete(key); }
        history.replaceState({}, "", url);
      }
      state.loaded = true;
      byId("catalog-loading").hidden = true;
      resetDelivery();
      renderCart();
    } catch (error) {
      byId("catalog-loading").hidden = true;
      byId("catalog-error").hidden = false;
      if(error?.checkoutPaused){
        (byId('catalog-error-title')||byId('catalog-error').querySelector('b')).textContent='Checkout is paused';
        byId('catalog-error').setAttribute('role','status');
        document.querySelector('.order-summary').hidden=true;
        document.querySelector('.checkout-layout').classList.add('is-paused');
      }
      byId("catalog-error-message").textContent = friendlyError(
        error instanceof Error ? error.message : "",
        "Please try again.",
      );
      renderSummary();
    }
  }

  function productImage(product) {
    return product.image_url
      ? `<img src="${escapeHtml(product.image_url)}" alt="${escapeHtml(product.image_alt || product.name)}" />`
      : '<span class="product-placeholder" aria-hidden="true">EZ</span>';
  }

  function productTitle(product) {
    return product.product_name || product.name;
  }
  const fileSize = size => size < 1048576 ? Math.ceil(size / 1024) + ' KB' : new Intl.NumberFormat('en', {maximumFractionDigits:1}).format(size / 1048576) + ' MB';

  function renderPaymentChoices() {
    const section = byId("payment-choice-section"), list = byId("payment-choices");
    section.hidden = !state.paymentChoices.length;
    list.replaceChildren(...state.paymentChoices.map(choice => {
      const label = document.createElement("label"); label.className = "checkout-payment-choice";
      const radio = document.createElement("input"); radio.type = "radio"; radio.name = "paymentChoice";
      radio.value = choice; radio.checked = choice === state.paymentChoice;
      radio.addEventListener("change", () => { if (!state.pendingCheckout) state.paymentChoice = choice; });
      const details = document.createElement("span"), title = document.createElement("b"), description = document.createElement("small");
      title.textContent = choice === "bca_va" ? "BCA Virtual Account" : choice === "shopeepay" ? "ShopeePay" : state.hostedPaymentMethods.filter(method => method !== "EMONEY_SHOPEEPAY").map(method => method === "QRIS" ? "QRIS" : "Debit or credit card").join(" / ");
      description.textContent = choice === "bca_va" ? "Pay from myBCA, BCA mobile, KlikBCA or an ATM." : choice === "shopeepay" ? "Pay with ShopeePay in DOKU’s secure payment window." : "Opens DOKU’s secure payment window. Your order stays here.";
      if (choice === "doku_checkout" && state.hostedPaymentMethods.includes("QRIS")) description.textContent += " QRIS also accepts ShopeePay.";
      details.append(title, description); label.append(radio, details); return label;
    }));
  }

  function renderTotals() {
    byId("cart-subtotal").textContent = money(subtotal());
    byId("shipping-total").textContent = !state.hasPhysical ? "No shipping needed" : !state.shippingRequired ? "Skipped in sandbox" : state.shipping
      ? money(shippingPrice())
      : state.step === "confirm" ? "Calculated next" : "Not selected";
    byId("grand-total").textContent = money(total());
    if (state.pendingCheckout) {
      byId("pay-button").textContent = state.paymentBusy ? "Recovering your payment…" : "Resume saved payment";
      byId("pay-button").disabled = state.paymentBusy || !!state.recoveryError;
    } else if (state.shipping || !state.shippingRequired) byId("pay-button").textContent = `Pay ${money(total())}`;
  }

  function renderSummary() {
    const entries = cartEntries();
    const count = itemCount();
    byId("cart-count").textContent = `${count} ${count === 1 ? "item" : "items"}`;
    byId("summary-items").innerHTML = entries.map(([id, quantity]) => {
      const product = state.products[id];
      return `<article class="summary-item">
        <div class="summary-item-media">${productImage(product)}<em>${quantity}</em></div>
        <div><b>${escapeHtml(productTitle(product))}</b><small>${escapeHtml(product.variant_name || "Standard")}</small></div>
        <strong>${money(product.price * quantity)}</strong>
      </article>`;
    }).join("");
    renderTotals();
  }

  function renderCart() {
    syncDelivery();
    const entries = cartEntries();
    byId("cart-items").hidden = !state.loaded || !entries.length;
    byId("empty-cart").hidden = !state.loaded || Boolean(entries.length);
    byId("to-checkout").disabled = !entries.length;

    byId("cart-items").innerHTML = entries.map(([id, quantity]) => {
      const product = state.products[id];
      const stock = Math.min(10000, Math.max(0, Number(product.stock ?? 10000)));
      const details = product.type === 'digital' ? `Digital download · ${fileSize(product.digital_file.size)} · Version ${product.digital_file.version}` : Number(product.weight) > 0 ? `${Number(product.weight)} g` : "Ready to ship";

      return `<article class="cart-item" data-cart-id="${escapeHtml(id)}">
        <div class="cart-item-media">${productImage(product)}</div>
        <div class="cart-item-copy">
          <h2>${escapeHtml(productTitle(product))}</h2>
          ${product.variant_name ? `<p class="cart-item-variant">${escapeHtml(product.variant_name)}</p>` : ""}
          ${hostedProduct && (product.product_id || id.split("~")[0]) === hostedProduct.id && hostedProduct.choices.length > 1 ? '<button type="button" class="product-options-edit" data-product-options aria-haspopup="dialog">Change options <span aria-hidden="true">›</span></button>' : ""}
          <p>${escapeHtml(details)}</p>
          <div class="item-controls">
            <div class="quantity-control" aria-label="Quantity for ${escapeHtml(productTitle(product))}">
              <button type="button" data-quantity="minus" aria-label="Decrease quantity">−</button>
              <output aria-label="Quantity">${quantity}</output>
              <button type="button" data-quantity="plus" aria-label="Increase quantity" ${quantity >= stock ? "disabled" : ""}>+</button>
            </div>
            <button class="remove-item" type="button" data-remove>Remove</button>
          </div>
        </div>
        <strong class="cart-item-price">${money(product.price * quantity)}</strong>
      </article>`;
    }).join("");
    renderSummary();
  }

  function syncDelivery() {
    const entries = cartEntries();
    state.hasPhysical = !entries.length || entries.some(([id]) => state.products[id].type !== 'digital');
    const hasDigital = entries.some(([id]) => state.products[id].type === 'digital');
    state.shippingRequired = state.hasPhysical && state.environmentShippingRequired;
    byId('checkout-address-section').hidden = !state.hasPhysical;
    for (const field of byId('checkout-address-section').querySelectorAll('input[name],textarea[name]')) field.disabled = !state.hasPhysical;
    byId('digital-download-note').hidden = !hasDigital;
    byId('checkout-account-note').hidden = !state.hasPhysical;
    byId('get-rates').hidden = !state.shippingRequired;
    byId('delivery-method').hidden = !state.shippingRequired;
    document.querySelector('[data-progress-step="checkout"] b').textContent = state.shippingRequired ? 'Delivery' : 'Details';
  }

  function resetDelivery() {
    syncDelivery();
    state.quoteVersion = (state.quoteVersion || 0) + 1;
    state.shipping = null;
    byId("get-rates").disabled = false;
    byId("get-rates").textContent = "Update delivery options";
    byId("pay-button").disabled = state.shippingRequired || !itemCount();
    byId("pay-button").textContent = state.shippingRequired ? "Choose a delivery method" : `Pay ${money(total())}`;
    byId("shipping-options").innerHTML = '<div class="quote-state"><span class="delivery-illustration" aria-hidden="true"></span><b>Delivery options will appear here</b><small>Rates are calculated for your destination and order weight.</small></div>';
    byId("quote-location").textContent = "Enter your address to see available options.";
  }

  function changeQuantity(id, change) {
    const product = state.products[id];
    if (!product) return;
    const maximum = Math.min(10000, Math.max(0, Number(product.stock ?? 10000)));
    state.cart[id] = Math.max(0, Math.min(maximum, (state.cart[id] || 0) + change));
    if (!state.cart[id]) delete state.cart[id];
    saveCart();
    resetDelivery();
    renderCart();
  }

  function setStep(step) {
    if (!["confirm", "checkout"].includes(step)) return;
    state.step = step;
    document.querySelectorAll("[data-panel]").forEach((panel) => {
      panel.classList.toggle("active", panel.dataset.panel === step);
    });
    document.querySelectorAll("[data-progress-step]").forEach((item) => {
      item.classList.toggle("active", item.dataset.progressStep === step);
      item.classList.toggle("complete", step === "checkout" && item.dataset.progressStep === "confirm");
      if (item.dataset.progressStep === step) item.setAttribute("aria-current", "step");
      else item.removeAttribute("aria-current");
    });
    byId("to-checkout").hidden = step !== "confirm";
    byId("pay-button").hidden = step !== "checkout";
    renderTotals();
    const heading = document.querySelector(`[data-panel="${step}"] h1`);
    heading?.setAttribute("tabindex", "-1");
    heading?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function validateForm(form) {
    let valid = true;
    const values = Object.fromEntries(new FormData(form).entries());
    delete values.paymentChoice;
    form.querySelectorAll("[required]").forEach((field) => {
      if (field.disabled) { field.classList.remove('invalid'); field.parentElement.querySelector('.field-error').textContent = ''; return; }
      const value = field.value.trim();
      let message = value ? "" : "This field is required.";
      if (field.name === "email" && value && !/^\S+@\S+\.\S+$/.test(value)) {
        message = "Enter a valid email address.";
      }
      if (field.name === "phone" && value && !/^(?:\+62|62|0)8[1-9][0-9]{6,12}$/.test(value.replace(/[\s-]/g, ""))) {
        message = "Enter a valid Indonesian WhatsApp number.";
      }
      if (field.name === "postalCode" && value && !/^\d{5}$/.test(value)) {
        message = "Enter a five-digit postcode.";
      }
      field.classList.toggle("invalid", Boolean(message));
      const error = field.parentElement.querySelector(".field-error");
      if (error) error.textContent = message;
      if (message) valid = false;
    });
    return { valid, values };
  }

  async function buildShippingQuotes() {
    if (!state.shippingRequired) return;
    const version = state.quoteVersion = (state.quoteVersion || 0) + 1;
    const button = byId("get-rates");
    state.shipping = null;
    byId("pay-button").disabled = true;
    byId("pay-button").textContent = "Choose a delivery method";
    byId("quote-location").textContent = `${state.customer.location} · ${state.customer.postalCode}`;
    byId("shipping-options").innerHTML = '<div class="quote-state"><i aria-hidden="true"></i><b>Finding delivery options</b><small>We’re checking services available for your address.</small></div>';
    button.disabled = true;
    button.textContent = "Finding delivery options…";
    renderTotals();

    try {
      const response = await fetch("api/rates.php", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ cart: state.cart, postal_code: state.customer.postalCode, ...(state.deliveryCoordinate ? {coordinate:state.deliveryCoordinate} : {}) }),
      });
      const payload = await response.json().catch(() => ({}));
      if (version !== state.quoteVersion) return;
      if (!response.ok) throw new Error(payload.error || "Delivery options are unavailable.");
      const quotes = Array.isArray(payload.quotes)
        ? payload.quotes.filter((quote) => quote?.id && Number(quote.price) > 0)
        : [];
      if (!quotes.length) throw new Error("No delivery service is available for this route.");

      byId("shipping-options").innerHTML = quotes.map((quote, index) => `<label class="shipping-option">
        <input type="radio" name="shipping" value="${escapeHtml(quote.id)}" ${index === 0 ? "checked" : ""} />
        <span class="courier-mark">${escapeHtml(String(quote.courier).slice(0, 3).toUpperCase())}</span>
        <span><b>${escapeHtml(quote.courier)} ${escapeHtml(quote.service)}</b><small>${escapeHtml(friendlyError(quote.days, "Estimated arrival shown by courier"))}</small></span>
        <strong>${money(quote.price)}</strong>
        <i aria-hidden="true"></i>
      </label>`).join("");
      selectShipping(quotes[0]);
      byId("shipping-options").querySelectorAll("input").forEach((input) => {
        input.addEventListener("change", () => {
          selectShipping(quotes.find((quote) => quote.id === input.value));
        });
      });
    } catch (error) {
      if (version !== state.quoteVersion) return;
      const message = friendlyError(
        error instanceof Error ? error.message : "",
        "Delivery options are unavailable.",
      );
      byId("shipping-options").innerHTML = `<div class="quote-state error"><b>Couldn’t load delivery options</b><small>${escapeHtml(message)}</small><button type="button" data-retry-rates>Try again</button></div>`;
      byId("shipping-options").querySelector("[data-retry-rates]")?.addEventListener("click", buildShippingQuotes);
      showToast(message);
    } finally {
      if (version === state.quoteVersion) {
        button.disabled = false;
        button.textContent = "Update delivery options";
        renderTotals();
      }
    }
  }

  function selectShipping(quote) {
    if (!quote) return;
    state.shipping = quote;
    byId("pay-button").disabled = false;
    renderTotals();
  }

  async function startPayment() {
    if (state.paymentBusy) return;
    if (state.recoveryError) { showToast(state.recoveryError); return; }
    if (state.pendingCheckout) { await recoverCheckout(); return; }
    if ((state.shippingRequired && !state.shipping) || !state.loaded || !itemCount() || byId("pay-button").disabled) return;
    const form = byId("customer-form");
    const result = validateForm(form);
    if (!result.valid) {
      form.querySelector(".invalid")?.focus();
      return;
    }
    state.customer = result.values;
    const button = byId("pay-button");
    const original = button.textContent;
    button.disabled = true;
    button.textContent = "Opening secure payment…";

    try {
      const body = {
        cart: state.cart, shop: state.shop,
        customer: { ...state.customer, ...(state.hasPhysical && state.deliveryCoordinate ? { coordinate: state.deliveryCoordinate } : {}) },
        shipping_id: state.shipping?.id || "",
      };
      if (state.durableCheckout) {
        const campaignVisit = window.EzkartStorefront.campaignVisit(hostedStore);
        if (campaignVisit) body.campaign_visit = campaignVisit;
        if (state.paymentChoices.length) {
          if (!state.paymentChoices.includes(state.paymentChoice)) throw new Error("Choose an available payment method.");
          body.payment_choice = state.paymentChoice;
        }
        body.checkout_key = [...crypto.getRandomValues(new Uint8Array(16))].map(value => value.toString(16).padStart(2, "0")).join("");
        body.expected_prices = Object.fromEntries(cartEntries().map(([id]) => [id, Number(state.products[id].price)]));
        const files = cartEntries().filter(([id]) => state.products[id].type === 'digital');
        if (files.length) body.expected_file_versions = Object.fromEntries(files.map(([id]) => [id, state.products[id].digital_file.id]));
        body.expected_total = total();
        const attempt = {body: JSON.stringify(body), uncertain: false};
        window.EzkartCheckoutAttempt.save(attempt);
        state.pendingCheckout = attempt;
        await recoverCheckout();
        return;
      }
      const response = await fetch("api/start.php", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Payment could not start.");
      const orderId = String(payload.order_id || "");
      if (payload.provider === "doku" && payload.payment_flow === "direct_bca"
          && payload.environment === "sandbox" && /^EZK-S-[A-F0-9]{24}$/.test(orderId)) {
        // Construct the route locally; a provider response cannot choose a redirect host.
        window.location.assign("payment.php?order=" + encodeURIComponent(orderId));
        return;
      }
      const paymentUrl = new URL(String(payload.payment_url || ""));
      const hosts = payload.environment === "production" ? ["jokul.doku.com"] : ["sandbox.doku.com", "staging.doku.com"];
      if (payload.provider !== "doku" || !["sandbox", "production"].includes(payload.environment)
          || !/^EZK-[SP]-[A-F0-9]{24}$/.test(orderId) || paymentUrl.protocol !== "https:"
          || !hosts.includes(paymentUrl.hostname) || paymentUrl.username || paymentUrl.password || paymentUrl.port
          || !/^\/(?:checkout-link(?:-v2)?\/|checkout\/link\/).+/.test(paymentUrl.pathname)) {
        throw new Error("The payment service returned an invalid session.");
      }
      window.location.assign(paymentUrl.href);
    } catch (error) {
      showToast(friendlyError(
        error instanceof Error ? error.message : "",
        "Payment could not start.",
      ));
      button.disabled = false;
      button.textContent = original;
    }
  }

  function renderRecovery(message = "") {
    const active = !!state.pendingCheckout || !!state.recoveryError;
    byId("checkout-recovery").hidden = !active;
    document.querySelector(".checkout-layout").classList.toggle("is-recovering", active);
    document.querySelector(".order-summary").hidden = active;
    document.querySelectorAll("[data-panel]").forEach(panel => { panel.hidden = active; });
    const saved = state.pendingCheckout ? JSON.parse(state.pendingCheckout.body) : null;
    byId("recovery-total").hidden = !saved;
    byId("recovery-total").textContent = saved ? `Saved checkout total: ${money(saved.expected_total)}` : "";
    byId("recover-checkout").disabled = state.paymentBusy || !!state.recoveryError;
    byId("recover-checkout").textContent = state.paymentBusy ? "Checking your payment…" : state.pendingCheckout?.orderId ? "Continue payment" : "Recover payment";
    byId("recovery-message").textContent = message || state.recoveryError;
    byId("recovery-message").hidden = !byId("recovery-message").textContent;
    renderTotals();
  }

  async function recoverCheckout() {
    if (state.paymentBusy || !state.pendingCheckout) return;
    const attempt = state.pendingCheckout;
    if (/^EZK-[SP]-[A-F0-9]{24}$/.test(attempt.orderId || "")) {
      window.location.assign("payment.php?order=" + encodeURIComponent(attempt.orderId)); return;
    }
    const previouslyUncertain = attempt.uncertain === true;
    state.paymentBusy = true; renderRecovery();
    try {
      // Persist uncertainty BEFORE sending. Reloads and a lost response must reuse exactly these bytes.
      attempt.uncertain = true;
      window.EzkartCheckoutAttempt.save(attempt);
      const response = await fetch("api/start.php", {method: "POST", headers: {"Content-Type": "application/json", Accept: "application/json"},
        body: attempt.body, signal: AbortSignal.timeout(75000)});
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) {
        if (!previouslyUncertain && response.status === 422 && data.checkout_rejected === true) {
          window.EzkartCheckoutAttempt.clear(); state.pendingCheckout = null;
          throw new Error(data.error || "Review your checkout details before paying.");
        }
        throw new Error(data.error || "We couldn’t confirm payment setup. Use Recover payment to check the same attempt.");
      }
      if (data.durable_checkout !== true || data.provider !== "doku" || !["sandbox", "production"].includes(data.environment)
          || !new RegExp("^EZK-" + (data.environment === "sandbox" ? "S" : "P") + "-[A-F0-9]{24}$").test(data.order_id || "")) {
        throw new Error("We couldn’t confirm the original payment. Recover this attempt before starting another order.");
      }
      attempt.orderId = data.order_id;
      window.EzkartCheckoutAttempt.save(attempt);
      window.location.assign("payment.php?order=" + encodeURIComponent(data.order_id));
    } catch (error) {
      const message = friendlyError(error instanceof Error ? error.message : "", "We couldn’t confirm payment setup. Recover this same attempt.");
      if (!state.pendingCheckout) showToast(message);
      renderRecovery(message);
      if (state.pendingCheckout) byId("recovery-title").focus({preventScroll: true});
    } finally {
      state.paymentBusy = false;
      if (!state.pendingCheckout) {
        byId("pay-button").disabled = state.shippingRequired && !state.shipping;
        await loadCatalog();
      }
      byId("recover-checkout").disabled = !!state.recoveryError;
      byId("recover-checkout").textContent = state.pendingCheckout?.orderId ? "Continue payment" : "Recover payment";
      renderTotals();
    }
  }

  const returnToStore = () => {
    if (state.returnUrl) window.location.assign(state.returnUrl);
    else if (window.history.length > 1) window.history.back();
    else window.location.assign("../");
  };

  byId("cart-items").addEventListener("click", (event) => {
    const row = event.target.closest("[data-cart-id]");
    if (!row) return;
    if (event.target.closest("[data-product-options]")) {
      const oldId = row.dataset.cartId;
      window.EzkartProductOptions.open({
        product: hostedProduct, selectedId: oldId, quantity: state.cart[oldId], cart: state.cart,
        onApply: async choice => {
          const nextCart = { ...state.cart };
          if (choice.id !== oldId) {
            nextCart[choice.id] = (nextCart[choice.id] || 0) + nextCart[oldId];
            delete nextCart[oldId];
          }
          // Recheck stock and prices before changing the customer's saved cart.
          const response = await fetch(`api/catalog.php?products=${encodeURIComponent(Object.keys(nextCart).join(","))}`, {
            headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(15000),
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok || !Array.isArray(payload.products)) throw new Error(payload.error || "We couldn't check this option. Your cart hasn't changed. Please try again.");
          const products = Object.fromEntries(payload.products.map(product => [product.id, product]));
          if (Object.entries(nextCart).some(([id, count]) => !products[id] || products[id].seller_id !== hostedStore.id || Math.min(10000, Number(products[id].stock ?? 10000)) < count)) {
            throw new Error("That quantity is no longer available. Your cart hasn't changed. Choose another option or reduce the quantity in your cart.");
          }
          if (Number(products[choice.id].price) !== Number(choice.price)) {
            choice.price = Number(products[choice.id].price);
            return { error: "The price has changed. Review the updated total before confirming." };
          }
          state.products = products;
          state.cart = nextCart;
          saveCart(); resetDelivery(); renderCart();
          return {};
        },
        onApplied: choice => byId("cart-items").querySelector(`[data-cart-id="${CSS.escape(choice.id)}"] [data-product-options]`)?.focus(),
      });
      return;
    }
    if (event.target.closest("[data-remove]")) {
      changeQuantity(row.dataset.cartId, -(state.cart[row.dataset.cartId] || 0));
      return;
    }
    const quantity = event.target.closest("[data-quantity]");
    if (quantity) {
      changeQuantity(row.dataset.cartId, quantity.dataset.quantity === "plus" ? 1 : -1);
    }
  });
  byId("to-checkout").addEventListener("click", () => {
    if (itemCount()) setStep("checkout");
  });
  document.querySelectorAll("[data-go]").forEach((button) => {
    button.addEventListener("click", () => setStep(button.dataset.go));
  });
  byId("customer-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!state.shippingRequired) {
      await startPayment();
      return;
    }
    const result = validateForm(event.currentTarget);
    if (!result.valid) {
      event.currentTarget.querySelector(".invalid")?.focus();
      return;
    }
    state.customer = result.values;
    await buildShippingQuotes();
  });
  byId("customer-form").addEventListener("input", (event) => {
    if (!event.target.matches("input, textarea")) return;
    if (["address", "location", "postalCode"].includes(event.target.name)) { state.deliveryCoordinate = null; resetDelivery(); renderTotals(); }
    event.target.classList.remove("invalid");
    const error = event.target.parentElement.querySelector(".field-error");
    if (error) error.textContent = "";
  });
  byId("pay-button").addEventListener("click", startPayment);
  byId("recover-checkout").addEventListener("click", recoverCheckout);
  byId("retry-catalog").addEventListener("click", loadCatalog);
  byId("back-to-store").addEventListener("click", returnToStore);
  byId("empty-back-to-store").addEventListener("click", returnToStore);
  byId("merchant-home").addEventListener("click", returnToStore);

  window.ezkartAddressBook(byId("checkout-address-book"), {
    current: () => ({ ...Object.fromEntries(new FormData(byId("customer-form")).entries()), coordinate: state.deliveryCoordinate }),
    onAccount: ({ authenticated, email }) => {
      const field = byId("customer-form").elements.email;
      if (authenticated && !field.value) field.value = email;
      byId("checkout-account-note").textContent = authenticated
        ? `Signed in as ${email}. Use this email at checkout to track your order.`
        : "To track your order later, sign in with Google using your checkout email.";
    },
    onUse: (address, { automatic }) => {
      if (!address) return;
      const form = byId("customer-form");
      if (automatic && ["address", "location", "postalCode"].some(key => form.elements[key].value.trim())) return;
      for (const key of ["address", "location", "postalCode", "note", "fullName", "phone"]) {
        if (automatic && form.elements[key].value.trim()) continue;
        if (["fullName", "phone"].includes(key) && !address[key]) continue;
        form.elements[key].value = address[key] || "";
        form.elements[key].dispatchEvent(new Event("input", { bubbles: true }));
      }
      state.customer = Object.fromEntries(new FormData(form).entries());
      state.deliveryCoordinate = address.coordinate || null;
      resetDelivery(); renderTotals();
    },
  });

  byId("year").textContent = new Date().getFullYear();
  applyMerchantBrand();
  try { state.pendingCheckout = window.EzkartCheckoutAttempt.read(); }
  catch (error) { state.recoveryError = error.message || "Saved payment details are unavailable. Recover your previous order before starting another payment."; }
  renderRecovery();
  loadCatalog();
})();
