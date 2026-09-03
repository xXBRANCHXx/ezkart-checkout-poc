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
  let paymentLoader = null;

  function showToast(message) {
    const toast = byId("toast");
    toast.textContent = friendlyError(message);
    toast.classList.add("visible");
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => toast.classList.remove("visible"), 2600);
  }

  function applyMerchantBrand() {
    const params = new URLSearchParams(window.location.search);
    const stored = (() => {
      try {
        return JSON.parse(sessionStorage.getItem("ezkart.checkout.brand") || "{}");
      } catch (_) {
        return {};
      }
    })();
    const name = String(params.get("brand") || stored.name || "Store").trim().slice(0, 80) || "Store";
    const requestedLogo = String(params.get("logo") || stored.logo || "").trim();
    let logo = "";

    try {
      const url = new URL(requestedLogo);
      if (["https:", "http:"].includes(url.protocol) && requestedLogo.length <= 1800) logo = url.href;
    } catch (_) {}

    try {
      sessionStorage.setItem("ezkart.checkout.brand", JSON.stringify({ name, logo }));
    } catch (_) {}

    byId("merchant-name").textContent = name;
    byId("merchant-avatar").textContent = name.charAt(0).toUpperCase();
    const image = byId("merchant-logo");
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
    document.title = `Checkout for ${name} · Ezkart`;
  }

  function requestedCart() {
    const params = new URLSearchParams(window.location.search);
    const requested = {};
    (params.get("cart") || "").split(",").forEach((entry) => {
      const match = entry.trim().match(/^([a-z0-9][a-z0-9_-]{2,95}(?:~[a-z0-9][a-z0-9_-]{2,95})?):(\d+)$/i);
      if (match) {
        const quantity = Number(match[2]);
        requested[match[1]] = Number.isSafeInteger(quantity) && quantity > 0 ? quantity : 1;
      }
    });
    if (!Object.keys(requested).length) {
      (params.get("products") || "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean)
        .forEach((id) => { requested[id] = 1; });
    }
    return requested;
  }

  async function loadCatalog() {
    const requested = requestedCart();
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
      state.loaded = true;
      byId("catalog-loading").hidden = true;
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
      if (ids.some((id) => !state.products[id])) {
        throw new Error("A selected product is no longer available.");
      }

      state.cart = Object.fromEntries(ids.map((id) => {
        const stock = Math.max(0, Number(state.products[id].stock ?? Number.MAX_SAFE_INTEGER));
        const quantity = Math.min(requested[id], stock);
        return [id, quantity];
      }).filter(([, quantity]) => quantity > 0));
      state.loaded = true;
      byId("catalog-loading").hidden = true;
      renderCart();
    } catch (error) {
      byId("catalog-loading").hidden = true;
      byId("catalog-error").hidden = false;
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

  function renderTotals() {
    byId("cart-subtotal").textContent = money(subtotal());
    byId("shipping-total").textContent = state.shipping
      ? money(shippingPrice())
      : state.step === "confirm" ? "Calculated next" : "Not selected";
    byId("grand-total").textContent = money(total());
    if (state.shipping) byId("pay-button").textContent = `Pay ${money(total())}`;
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
    const entries = cartEntries();
    byId("cart-items").hidden = !state.loaded || !entries.length;
    byId("empty-cart").hidden = !state.loaded || Boolean(entries.length);
    byId("to-checkout").disabled = !entries.length;

    byId("cart-items").innerHTML = entries.map(([id, quantity]) => {
      const product = state.products[id];
      const stock = Math.max(0, Number(product.stock ?? Number.MAX_SAFE_INTEGER));
      const details = Number(product.weight) > 0 ? `${Number(product.weight)} g` : "Ready to ship";

      return `<article class="cart-item" data-cart-id="${escapeHtml(id)}">
        <div class="cart-item-media">${productImage(product)}</div>
        <div class="cart-item-copy">
          <h2>${escapeHtml(productTitle(product))}</h2>
          ${product.variant_name ? `<p class="cart-item-variant">${escapeHtml(product.variant_name)}</p>` : ""}
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

  function resetDelivery() {
    state.shipping = null;
    byId("pay-button").disabled = true;
    byId("pay-button").textContent = "Choose a delivery method";
    byId("shipping-options").innerHTML = '<div class="quote-state"><span class="delivery-illustration" aria-hidden="true"></span><b>Delivery options will appear here</b><small>Rates are calculated for your destination and order weight.</small></div>';
    byId("quote-location").textContent = "Enter your address to see available options.";
  }

  function changeQuantity(id, change) {
    const product = state.products[id];
    if (!product) return;
    const maximum = Math.max(0, Number(product.stock ?? Number.MAX_SAFE_INTEGER));
    state.cart[id] = Math.max(0, Math.min(maximum, (state.cart[id] || 0) + change));
    if (!state.cart[id]) delete state.cart[id];
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
    form.querySelectorAll("[required]").forEach((field) => {
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
        body: JSON.stringify({ cart: state.cart, postal_code: state.customer.postalCode }),
      });
      const payload = await response.json().catch(() => ({}));
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
      const message = friendlyError(
        error instanceof Error ? error.message : "",
        "Delivery options are unavailable.",
      );
      byId("shipping-options").innerHTML = `<div class="quote-state error"><b>Couldn’t load delivery options</b><small>${escapeHtml(message)}</small><button type="button" data-retry-rates>Try again</button></div>`;
      byId("shipping-options").querySelector("[data-retry-rates]")?.addEventListener("click", buildShippingQuotes);
      showToast(message);
    } finally {
      button.disabled = false;
      button.textContent = "Update delivery options";
      renderTotals();
    }
  }

  function selectShipping(quote) {
    if (!quote) return;
    state.shipping = quote;
    byId("pay-button").disabled = false;
    renderTotals();
  }

  async function ensurePaymentWindow() {
    if (window.snap?.pay) return;
    if (paymentLoader) return paymentLoader;
    paymentLoader = (async () => {
      const response = await fetch("api/checkout-config.php", {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({}));
      const expected = payload.environment === "production"
        ? "https://app.midtrans.com/snap/snap.js"
        : "https://app.sandbox.midtrans.com/snap/snap.js";
      if (!response.ok || !payload.client_key || payload.snap_url !== expected) {
        throw new Error(payload.error || "Secure payment is not configured.");
      }
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
    })().catch((error) => {
      paymentLoader = null;
      throw error;
    });
    return paymentLoader;
  }

  async function startPayment() {
    if (!state.shipping || !itemCount()) return;
    const button = byId("pay-button");
    const original = button.textContent;
    button.disabled = true;
    button.textContent = "Opening secure payment…";

    try {
      await ensurePaymentWindow();
      const response = await fetch("api/start.php", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          cart: state.cart,
          customer: state.customer,
          shipping_id: state.shipping.id,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Payment could not start.");
      const token = String(payload.snap_token || "");
      const orderId = String(payload.order_id || "");
      if (!token || !/^EZK-MIDTRANS-[A-Z0-9-]+$/.test(orderId)) {
        throw new Error("The payment service returned an invalid session.");
      }

      const returnUrl = `return.php?order=${encodeURIComponent(orderId)}`;
      window.snap.pay(token, {
        onSuccess: () => window.location.assign(returnUrl),
        onPending: () => window.location.assign(returnUrl),
        onError: () => {
          showToast("Payment was not completed.");
          button.disabled = false;
          button.textContent = original;
        },
        onClose: () => {
          showToast("Payment window closed. Your cart is still here.");
          button.disabled = false;
          button.textContent = original;
        },
      });
    } catch (error) {
      showToast(friendlyError(
        error instanceof Error ? error.message : "",
        "Payment could not start.",
      ));
      button.disabled = false;
      button.textContent = original;
    }
  }

  const returnToStore = () => {
    if (window.history.length > 1) window.history.back();
    else window.location.assign("../");
  };

  byId("cart-items").addEventListener("click", (event) => {
    const row = event.target.closest("[data-cart-id]");
    if (!row) return;
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
    event.target.classList.remove("invalid");
    const error = event.target.parentElement.querySelector(".field-error");
    if (error) error.textContent = "";
  });
  byId("pay-button").addEventListener("click", startPayment);
  byId("retry-catalog").addEventListener("click", loadCatalog);
  byId("back-to-store").addEventListener("click", returnToStore);
  byId("empty-back-to-store").addEventListener("click", returnToStore);
  byId("merchant-home").addEventListener("click", returnToStore);

  byId("year").textContent = new Date().getFullYear();
  applyMerchantBrand();
  loadCatalog();
})();
