(() => {
  "use strict";

  const state = {
    products: {},
    cart: {},
    customer: {},
    shipping: null,
    step: "confirm",
    loaded: false,
  };

  const el = (id) => document.getElementById(id);
  const money = (value) => new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);
  const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character]);
  const cartEntries = () => Object.entries(state.cart).filter(([id, quantity]) => state.products[id] && quantity > 0);
  const itemCount = () => cartEntries().reduce((sum, [, quantity]) => sum + quantity, 0);
  const subtotal = () => cartEntries().reduce((sum, [id, quantity]) => sum + state.products[id].price * quantity, 0);
  const shippingPrice = () => Number(state.shipping?.price) || 0;
  const total = () => subtotal() + shippingPrice();
  let snapLoader = null;

  function showToast(message) {
    const toast = el("toast");
    toast.textContent = message;
    toast.classList.add("visible");
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => toast.classList.remove("visible"), 2400);
  }

  function applyMerchantBrand() {
    const params = new URLSearchParams(window.location.search);
    const stored = (() => {
      try { return JSON.parse(sessionStorage.getItem("ezkart.checkout.brand") || "{}"); }
      catch (_) { return {}; }
    })();
    const name = String(params.get("brand") || stored.name || "Store").trim().slice(0, 80) || "Store";
    const requestedLogo = String(params.get("logo") || stored.logo || "").trim();
    let logo = "";
    try {
      const url = new URL(requestedLogo);
      if (["https:", "http:"].includes(url.protocol) && requestedLogo.length <= 1800) logo = url.href;
    } catch (_) {}
    try { sessionStorage.setItem("ezkart.checkout.brand", JSON.stringify({ name, logo })); } catch (_) {}
    el("merchant-name").textContent = name;
    const image = el("merchant-logo");
    if (logo) {
      image.src = logo;
      image.alt = `${name} logo`;
      image.hidden = false;
      el("merchant-name").hidden = true;
    }
    document.title = `${name} checkout`;
  }

  function requestedCart() {
    const params = new URLSearchParams(window.location.search);
    const cart = {};
    (params.get("cart") || "").split(",").forEach((entry) => {
      const match = entry.trim().match(/^([a-z0-9][a-z0-9_-]{2,95}(?:~[a-z0-9][a-z0-9_-]{2,95})?):(\d+)$/i);
      if (match) cart[match[1]] = Math.max(1, Math.min(9, Number(match[2]) || 1));
    });
    if (!Object.keys(cart).length) {
      (params.get("products") || "").split(",").map((id) => id.trim()).filter(Boolean).forEach((id) => { cart[id] = 1; });
    }
    return cart;
  }

  async function loadCatalog() {
    const requested = requestedCart();
    const ids = Object.keys(requested);
    state.loaded = false;
    el("catalog-loading").hidden = false;
    el("catalog-error").hidden = true;
    el("cart-items").hidden = true;
    el("empty-cart").hidden = true;
    el("to-checkout").disabled = true;
    if (!ids.length) {
      state.products = {};
      state.cart = {};
      state.loaded = true;
      el("catalog-loading").hidden = true;
      renderCart();
      return;
    }
    try {
      const response = await fetch(`api/catalog.php?products=${encodeURIComponent(ids.join(","))}`, {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "The selected products are unavailable.");
      const products = Array.isArray(payload.products) ? payload.products : [];
      state.products = Object.fromEntries(products.map((product) => [product.id, product]));
      if (ids.some((id) => !state.products[id])) throw new Error("A selected product is no longer available.");
      let remainingCapacity = 9;
      state.cart = Object.fromEntries(ids.map((id) => {
        const stock = Math.max(0, Number(state.products[id].stock ?? 9));
        const quantity = Math.min(requested[id], stock, remainingCapacity);
        remainingCapacity -= quantity;
        return [id, quantity];
      }).filter(([, quantity]) => quantity > 0));
      state.loaded = true;
      el("catalog-loading").hidden = true;
      renderCart();
    } catch (error) {
      el("catalog-loading").hidden = true;
      el("catalog-error").hidden = false;
      el("catalog-error-message").textContent = error instanceof Error ? error.message : "Please try again.";
    }
  }

  function productImage(product) {
    return product.image_url
      ? `<img src="${escapeHtml(product.image_url)}" alt="${escapeHtml(product.image_alt || product.name)}" />`
      : '<span class="product-placeholder" aria-hidden="true">EZ</span>';
  }

  function renderTotals() {
    el("cart-subtotal").textContent = money(subtotal());
    el("checkout-subtotal").textContent = money(subtotal());
    el("shipping-total").textContent = state.shipping ? money(shippingPrice()) : "Not selected";
    el("grand-total").textContent = money(total());
    if (state.shipping) el("pay-button").textContent = `Pay ${money(total())}`;
  }

  function renderCart() {
    const entries = cartEntries();
    const count = itemCount();
    el("cart-items").hidden = !state.loaded || !entries.length;
    el("empty-cart").hidden = !state.loaded || Boolean(entries.length);
    el("to-checkout").disabled = !entries.length;
    el("cart-count").textContent = `${count} ${count === 1 ? "item" : "items"}`;

    el("cart-items").innerHTML = entries.map(([id, quantity]) => {
      const product = state.products[id];
      const remaining = Number(product.stock ?? 9);
      return `<article class="cart-item" data-cart-id="${escapeHtml(id)}">
        <div class="cart-item-media">${productImage(product)}</div>
        <div class="cart-item-copy">
          <h2>${escapeHtml(product.product_name || product.name)}</h2>
          ${product.variant_name ? `<p class="cart-item-variant">${escapeHtml(product.variant_name)}</p>` : ""}
          <p class="cart-item-meta">${escapeHtml([product.sku, Number(product.weight) > 0 ? `${Number(product.weight)} g` : ""].filter(Boolean).join(" · ") || "Ready to ship")}</p>
          <div class="item-controls">
            <div class="quantity-control" aria-label="Quantity for ${escapeHtml(product.name)}">
              <button type="button" data-quantity="minus" aria-label="Decrease quantity">−</button>
              <output>${quantity}</output>
              <button type="button" data-quantity="plus" aria-label="Increase quantity" ${quantity >= Math.min(remaining, 9) || count >= 9 ? "disabled" : ""}>+</button>
            </div>
            <button class="remove-item" type="button" data-remove>Remove</button>
          </div>
        </div>
        <strong class="cart-item-price">${money(product.price * quantity)}</strong>
      </article>`;
    }).join("");
    renderTotals();
  }

  function changeQuantity(id, change) {
    const product = state.products[id];
    if (!product) return;
    const otherItems = itemCount() - (state.cart[id] || 0);
    const maximum = Math.min(9 - otherItems, Math.max(0, Number(product.stock ?? 9)));
    state.cart[id] = Math.max(0, Math.min(maximum, (state.cart[id] || 0) + change));
    if (!state.cart[id]) delete state.cart[id];
    state.shipping = null;
    renderCart();
  }

  function setStep(step) {
    if (!["confirm", "checkout"].includes(step)) return;
    state.step = step;
    document.querySelectorAll("[data-panel]").forEach((panel) => panel.classList.toggle("active", panel.dataset.panel === step));
    const heading = document.querySelector(`[data-panel="${step}"] h1`);
    window.scrollTo({ top: 0, behavior: "smooth" });
    heading?.setAttribute("tabindex", "-1");
    heading?.focus({ preventScroll: true });
  }

  function validateForm(form) {
    let valid = true;
    const values = Object.fromEntries(new FormData(form).entries());
    form.querySelectorAll("[required]").forEach((field) => {
      const value = field.value.trim();
      let message = value ? "" : "This field is required.";
      if (field.name === "email" && value && !/^\S+@\S+\.\S+$/.test(value)) message = "Enter a valid email address.";
      if (field.name === "phone" && value && !/^(?:\+62|62|0)8[1-9][0-9]{6,12}$/.test(value.replace(/[\s-]/g, ""))) message = "Enter a valid Indonesian WhatsApp number.";
      if (field.name === "postalCode" && value && !/^\d{5}$/.test(value)) message = "Enter a five-digit postcode.";
      field.classList.toggle("invalid", Boolean(message));
      const error = field.parentElement.querySelector(".field-error");
      if (error) error.textContent = message;
      if (message) valid = false;
    });
    return { valid, values };
  }

  async function buildShippingQuotes() {
    const rateButton = el("get-rates");
    state.shipping = null;
    el("pay-button").disabled = true;
    el("pay-button").textContent = "Select a delivery option";
    el("quote-location").textContent = `${state.customer.location} · ${state.customer.postalCode}`;
    el("shipping-options").innerHTML = '<div class="quote-state"><i aria-hidden="true"></i><b>Finding delivery options</b><small>Live rates are based on your postcode and the total package weight.</small></div>';
    rateButton.disabled = true;
    rateButton.textContent = "Loading delivery options…";
    renderTotals();
    try {
      const response = await fetch("api/rates.php", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ cart: state.cart, postal_code: state.customer.postalCode }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Delivery rates are unavailable.");
      const quotes = Array.isArray(payload.quotes) ? payload.quotes.filter((quote) => quote?.id && Number(quote.price) > 0) : [];
      if (!quotes.length) throw new Error("No courier service is available for this route.");
      el("shipping-provider").textContent = payload.provider || "Biteship";
      el("shipping-options").innerHTML = quotes.map((quote, index) => `<label class="shipping-option">
        <input type="radio" name="shipping" value="${escapeHtml(quote.id)}" ${index === 0 ? "checked" : ""} />
        <span class="courier-mark">${escapeHtml(String(quote.courier).slice(0, 3).toUpperCase())}</span>
        <span><b>${escapeHtml(quote.courier)} ${escapeHtml(quote.service)}</b><small>${escapeHtml(quote.days || "ETA from courier")}</small></span>
        <strong>${money(quote.price)}</strong><i aria-hidden="true"></i>
      </label>`).join("");
      selectShipping(quotes[0]);
      el("shipping-options").querySelectorAll("input").forEach((input) => input.addEventListener("change", () => selectShipping(quotes.find((quote) => quote.id === input.value))));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Delivery rates are unavailable.";
      el("shipping-options").innerHTML = `<div class="quote-state error"><b>Couldn’t load delivery options</b><small>${escapeHtml(message)}</small><button type="button" data-retry-rates>Try again</button></div>`;
      el("shipping-options").querySelector("[data-retry-rates]")?.addEventListener("click", buildShippingQuotes);
      showToast(message);
    } finally {
      rateButton.disabled = false;
      rateButton.textContent = "Update delivery options";
      renderTotals();
    }
  }

  function selectShipping(quote) {
    if (!quote) return;
    state.shipping = quote;
    el("pay-button").disabled = false;
    renderTotals();
  }

  async function ensureSnap() {
    if (window.snap?.pay) return;
    if (snapLoader) return snapLoader;
    snapLoader = (async () => {
      const response = await fetch("api/checkout-config.php", { headers: { Accept: "application/json" }, cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      const expected = payload.environment === "production" ? "https://app.midtrans.com/snap/snap.js" : "https://app.sandbox.midtrans.com/snap/snap.js";
      if (!response.ok || !payload.client_key || payload.snap_url !== expected) throw new Error(payload.error || "Secure payment is not configured.");
      await new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = payload.snap_url;
        script.dataset.clientKey = payload.client_key;
        script.async = true;
        script.onload = resolve;
        script.onerror = () => reject(new Error("The secure payment window could not load."));
        document.head.append(script);
      });
      if (!window.snap?.pay) throw new Error("The secure payment window is not ready.");
    })().catch((error) => { snapLoader = null; throw error; });
    return snapLoader;
  }

  async function startPayment() {
    if (!state.shipping || !itemCount()) return;
    const button = el("pay-button");
    const original = button.textContent;
    button.disabled = true;
    button.textContent = "Opening secure payment…";
    try {
      await ensureSnap();
      const response = await fetch("api/start.php", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ cart: state.cart, customer: state.customer, shipping_id: state.shipping.id }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Payment could not start.");
      const token = String(payload.snap_token || "");
      const orderId = String(payload.order_id || "");
      if (!token || !/^EZK-MIDTRANS-[A-Z0-9-]+$/.test(orderId)) throw new Error("The payment provider returned an invalid session.");
      const returnUrl = `return.php?order=${encodeURIComponent(orderId)}`;
      window.snap.pay(token, {
        onSuccess: () => window.location.assign(returnUrl),
        onPending: () => window.location.assign(returnUrl),
        onError: () => { showToast("Payment was not completed."); button.disabled = false; button.textContent = original; },
        onClose: () => { showToast("Payment window closed. Your cart is still here."); button.disabled = false; button.textContent = original; },
      });
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Payment could not start.");
      button.disabled = false;
      button.textContent = original;
    }
  }

  const returnToStore = () => {
    if (window.history.length > 1) window.history.back();
    else window.location.assign("../");
  };

  el("cart-items").addEventListener("click", (event) => {
    const row = event.target.closest("[data-cart-id]");
    if (!row) return;
    if (event.target.closest("[data-remove]")) changeQuantity(row.dataset.cartId, -(state.cart[row.dataset.cartId] || 0));
    const quantity = event.target.closest("[data-quantity]");
    if (quantity) changeQuantity(row.dataset.cartId, quantity.dataset.quantity === "plus" ? 1 : -1);
  });
  el("to-checkout").addEventListener("click", () => { if (itemCount()) setStep("checkout"); });
  document.querySelectorAll("[data-go]").forEach((button) => button.addEventListener("click", () => setStep(button.dataset.go)));
  el("customer-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const result = validateForm(event.currentTarget);
    if (!result.valid) { event.currentTarget.querySelector(".invalid")?.focus(); return; }
    state.customer = result.values;
    await buildShippingQuotes();
  });
  el("pay-button").addEventListener("click", startPayment);
  el("retry-catalog").addEventListener("click", loadCatalog);
  el("back-to-store").addEventListener("click", returnToStore);
  el("merchant-home").addEventListener("click", returnToStore);

  el("year").textContent = new Date().getFullYear();
  applyMerchantBrand();
  loadCatalog();
})();
