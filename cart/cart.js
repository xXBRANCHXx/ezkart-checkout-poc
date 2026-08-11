(() => {
  "use strict";

  const PRODUCTS = {
    granola: { name: "Granola Madu Nusantara", price: 58000, weight: 320 },
    coffee: { name: "Kopi Susu Concentrate", price: 79000, weight: 650 },
    sambal: { name: "Sambal Roa Signature", price: 46000, weight: 260 },
  };

  const state = {
    cart: {},
    customer: {},
    shipping: null,
    payment: null,
    step: "cart",
  };

  const rupiah = (value) => new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value);

  const el = (id) => document.getElementById(id);
  const itemCount = () => Object.values(state.cart).reduce((sum, quantity) => sum + quantity, 0);
  const subtotal = () => Object.entries(state.cart).reduce(
    (sum, [id, quantity]) => sum + PRODUCTS[id].price * quantity,
    0
  );
  const weight = () => Object.entries(state.cart).reduce(
    (sum, [id, quantity]) => sum + PRODUCTS[id].weight * quantity,
    0
  );
  const shippingPrice = () => state.shipping?.price || 0;
  const total = () => subtotal() + shippingPrice();
  const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
  let midtransLoader = null;

  function ensureMidtransSnap() {
    if (window.snap && typeof window.snap.pay === "function") return Promise.resolve();
    if (midtransLoader) return midtransLoader;
    midtransLoader = (async () => {
      const response = await fetch("api/checkout-config.php", { headers: { Accept: "application/json" }, cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.client_key || !String(payload.snap_url).startsWith("https://app.sandbox.midtrans.com/")) {
        throw new Error(payload.error || "Midtrans Sandbox belum dikonfigurasi.");
      }
      await new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = payload.snap_url;
        script.dataset.clientKey = payload.client_key;
        script.async = true;
        script.onload = resolve;
        script.onerror = () => reject(new Error("Midtrans Snap tidak dapat dimuat."));
        document.head.append(script);
      });
      if (!window.snap || typeof window.snap.pay !== "function") throw new Error("Midtrans Snap belum siap.");
    })().catch((error) => {
      midtransLoader = null;
      throw error;
    });
    return midtransLoader;
  }

  function showToast(message) {
    const toast = el("toast");
    toast.textContent = message;
    toast.classList.add("visible");
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => toast.classList.remove("visible"), 2200);
  }

  function setStep(step) {
    state.step = step;
    document.querySelectorAll("[data-panel]").forEach((panel) => {
      panel.classList.toggle("active", panel.dataset.panel === step);
    });

    const steps = ["cart", "details", "payment", "complete"];
    const activeIndex = steps.indexOf(step);
    document.querySelectorAll("[data-progress]").forEach((item, index) => {
      item.classList.toggle("active", index === activeIndex);
      item.classList.toggle("done", index < activeIndex);
      item.setAttribute("aria-current", index === activeIndex ? "step" : "false");
    });

    el("cart-summary").classList.toggle("summary-hidden", step === "complete");
    document.querySelector(".checkout-content").classList.toggle("content-wide", step === "complete");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function renderCart() {
    const count = itemCount();
    el("header-count").textContent = count;
    el("summary-count").textContent = `${count} item`;
    el("empty-cart").hidden = count > 0;
    el("summary-totals").hidden = count === 0;
    el("checkout-button").disabled = count === 0;

    el("cart-items").innerHTML = Object.entries(state.cart)
      .filter(([, quantity]) => quantity > 0)
      .map(([id, quantity]) => {
        const product = PRODUCTS[id];
        return `
          <div class="cart-row" data-cart-id="${id}">
            <div><b>${product.name}</b><small>${rupiah(product.price)} · ${product.weight} g</small></div>
            <div class="quantity-control" aria-label="Jumlah ${product.name}">
              <button type="button" data-quantity="minus" aria-label="Kurangi ${product.name}">−</button>
              <span>${quantity}</span>
              <button type="button" data-quantity="plus" aria-label="Tambah ${product.name}">+</button>
            </div>
            <strong>${rupiah(product.price * quantity)}</strong>
          </div>`;
      }).join("");

    el("subtotal").textContent = rupiah(subtotal());
    el("shipping-total").textContent = state.shipping ? rupiah(shippingPrice()) : "Belum dipilih";
    el("grand-total").textContent = rupiah(total());
  }

  function changeQuantity(id, change) {
    state.cart[id] = Math.max(0, Math.min(9, (state.cart[id] || 0) + change));
    if (!state.cart[id]) delete state.cart[id];
    state.shipping = null;
    state.payment = null;
    renderCart();
    if (change > 0) showToast(`${PRODUCTS[id].name} ditambahkan`);
  }

  function validateForm(form) {
    let valid = true;
    const values = Object.fromEntries(new FormData(form).entries());
    form.querySelectorAll("[required]").forEach((field) => {
      let message = "";
      const value = field.value.trim();
      if (!value) message = "Kolom ini wajib diisi.";
      if (field.name === "email" && value && !/^\S+@\S+\.\S+$/.test(value)) message = "Masukkan alamat email yang valid.";
      if (field.name === "phone" && value && !/^(?:\+62|62|0)8[1-9][0-9]{6,12}$/.test(value.replace(/[\s-]/g, ""))) {
        message = "Masukkan nomor WhatsApp Indonesia yang valid.";
      }
      if (field.name === "postalCode" && value && !/^\d{5}$/.test(value)) message = "Kode pos harus terdiri dari 5 angka.";
      const error = field.parentElement.querySelector(".field-error");
      if (error) error.textContent = message;
      field.classList.toggle("invalid", Boolean(message));
      if (message) valid = false;
    });
    return { valid, values };
  }

  async function buildShippingQuotes() {
    state.shipping = null;
    state.payment = null;
    el("payment-section").classList.add("locked");
    el("pay-button").disabled = true;
    el("quote-location").textContent = `${state.customer.location} · ${(weight() / 1000).toFixed(2)} kg`;
    el("shipping-options").innerHTML = '<div class="quote-state"><span></span><b>Meminta tarif Biteship Test…</b><small>Tarif dihitung dari kode pos dan berat keranjang.</small></div>';
    try {
      const response = await fetch("api/rates.php", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ cart: state.cart, postal_code: state.customer.postalCode }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Biteship error (${response.status}).`);
      const quotes = Array.isArray(payload.quotes) ? payload.quotes.filter((quote) => quote && quote.id && Number(quote.price) > 0) : [];
      if (!quotes.length) throw new Error("Biteship tidak menemukan layanan untuk rute ini.");
      const provider = el("shipping-provider");
      if (provider) provider.textContent = payload.provider || "Biteship Test";
      el("shipping-options").innerHTML = quotes.map((quote, index) => `
        <label class="shipping-option">
          <input type="radio" name="shipping" value="${escapeHtml(quote.id)}" ${index === 0 ? "checked" : ""} />
          <span class="courier-mark">${escapeHtml(String(quote.courier).slice(0, 3).toUpperCase())}</span>
          <span><b>${escapeHtml(quote.courier)} ${escapeHtml(quote.service)}</b><small>Estimasi tiba ${escapeHtml(quote.days)}</small></span>
          <strong>${rupiah(Number(quote.price))}</strong>
          <i aria-hidden="true"></i>
        </label>
      `).join("");
      selectShipping(quotes[0]);
      el("shipping-options").querySelectorAll("input").forEach((input) => {
        input.addEventListener("change", () => selectShipping(quotes.find((quote) => quote.id === input.value)));
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Tarif Biteship tidak tersedia.";
      el("shipping-options").innerHTML = `<div class="quote-state error"><b>Tarif pengiriman belum tersedia</b><small>${escapeHtml(message)}</small><button type="button" data-retry-rates>Coba lagi</button></div>`;
      el("shipping-options").querySelector("[data-retry-rates]")?.addEventListener("click", buildShippingQuotes);
      showToast(message);
      renderCart();
      return false;
    }
  }

  function selectShipping(quote) {
    state.shipping = quote;
    state.payment = "Midtrans Snap Sandbox";
    el("payment-section").classList.remove("locked");
    el("pay-button").disabled = false;
    renderCart();
  }

  async function startMidtransSnap() {
    if (!state.shipping || !state.payment) return;
    const button = el("pay-button");
    const originalLabel = button.innerHTML;
    button.disabled = true;
    button.textContent = "Membuka Midtrans Snap…";
    try {
      await ensureMidtransSnap();
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
      if (!response.ok) throw new Error(payload.error || `Midtrans error (${response.status}).`);
      const snapToken = String(payload.snap_token || "");
      const orderId = String(payload.order_id || "");
      if (!snapToken || !/^EZK-MIDTRANS-[A-Z0-9-]+$/.test(orderId)) {
        throw new Error("Midtrans tidak mengembalikan token Snap sandbox yang valid.");
      }
      const returnUrl = `return.php?order=${encodeURIComponent(orderId)}`;
      button.textContent = "Menunggu pembayaran Midtrans…";
      window.snap.pay(snapToken, {
        onSuccess: () => window.location.assign(returnUrl),
        onPending: () => window.location.assign(returnUrl),
        onError: () => {
          showToast("Pembayaran Midtrans tidak berhasil.");
          button.disabled = false;
          button.innerHTML = originalLabel;
        },
        onClose: () => {
          showToast("Jendela pembayaran ditutup.");
          button.disabled = false;
          button.innerHTML = originalLabel;
        },
      });
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Tidak dapat membuka Midtrans Snap.");
      button.disabled = false;
      button.innerHTML = originalLabel;
    }
  }

  document.querySelectorAll(".add-product").forEach((button) => {
    button.addEventListener("click", () => changeQuantity(button.closest("[data-product-id]").dataset.productId, 1));
  });

  el("cart-items").addEventListener("click", (event) => {
    const button = event.target.closest("[data-quantity]");
    if (!button) return;
    const id = button.closest("[data-cart-id]").dataset.cartId;
    changeQuantity(id, button.dataset.quantity === "plus" ? 1 : -1);
  });

  el("checkout-button").addEventListener("click", () => {
    if (itemCount()) setStep("details");
  });

  el("cart-shortcut").addEventListener("click", () => {
    if (state.step !== "cart") setStep("cart");
    el("cart-summary").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  document.querySelectorAll("[data-go]").forEach((button) => {
    button.addEventListener("click", () => setStep(button.dataset.go));
  });

  el("customer-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const result = validateForm(event.currentTarget);
    if (!result.valid) {
      event.currentTarget.querySelector(".invalid")?.focus();
      return;
    }
    state.customer = result.values;
    setStep("payment");
    await buildShippingQuotes();
  });

  el("pay-button").addEventListener("click", startMidtransSnap);

  el("reset-demo").addEventListener("click", () => {
    state.cart = {};
    state.customer = {};
    state.shipping = null;
    state.payment = null;
    el("customer-form").reset();
    renderCart();
    setStep("cart");
  });

  const requestedProducts = (new URLSearchParams(window.location.search).get("products") || "")
    .split(",")
    .map((id) => id.trim())
    .filter((id, index, values) => PRODUCTS[id] && values.indexOf(id) === index);
  requestedProducts.forEach((id) => { state.cart[id] = 1; });
  renderCart();
})();
