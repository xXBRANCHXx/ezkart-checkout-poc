(() => {
  "use strict";

  const PRODUCTS = {
    granola: { name: "Granola Madu Nusantara", price: 58000, weight: 320 },
    coffee: { name: "Kopi Susu Concentrate", price: 79000, weight: 650 },
    sambal: { name: "Sambal Roa Signature", price: 46000, weight: 260 },
  };

  const SHIPPING = [
    { id: "jne-reg", courier: "JNE", service: "REG", days: "2–3 hari", base: 15000 },
    { id: "sicepat-reg", courier: "SiCepat", service: "REG", days: "1–3 hari", base: 17000 },
    { id: "jnt-ez", courier: "J&T Express", service: "EZ", days: "2–4 hari", base: 13500 },
  ];

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

  function locationMultiplier(location) {
    const normalized = location.toLowerCase();
    if (normalized.includes("jakarta") || normalized.includes("depok")) return 1;
    if (normalized.includes("bandung")) return 1.22;
    if (normalized.includes("surabaya")) return 1.52;
    if (normalized.includes("yogyakarta") || normalized.includes("sleman")) return 1.38;
    if (normalized.includes("bali") || normalized.includes("denpasar")) return 1.72;
    return 1.3;
  }

  function buildShippingQuotes() {
    const multiplier = locationMultiplier(state.customer.location || "");
    const extraWeight = Math.max(0, Math.ceil(weight() / 1000) - 1) * 4500;
    const quotes = SHIPPING.map((option) => ({
      ...option,
      price: Math.round((option.base * multiplier + extraWeight) / 500) * 500,
    }));

    el("quote-location").textContent = `${state.customer.location} · ${(weight() / 1000).toFixed(2)} kg`;
    el("shipping-options").innerHTML = quotes.map((quote, index) => `
      <label class="shipping-option">
        <input type="radio" name="shipping" value="${quote.id}" ${index === 0 ? "checked" : ""} />
        <span class="courier-mark">${quote.courier.slice(0, 3).toUpperCase()}</span>
        <span><b>${quote.courier} ${quote.service}</b><small>Estimasi tiba ${quote.days}</small></span>
        <strong>${rupiah(quote.price)}</strong>
        <i aria-hidden="true"></i>
      </label>
    `).join("");

    selectShipping(quotes[0]);
    el("shipping-options").querySelectorAll("input").forEach((input) => {
      input.addEventListener("change", () => selectShipping(quotes.find((quote) => quote.id === input.value)));
    });
  }

  function selectShipping(quote) {
    state.shipping = quote;
    state.payment = "Duitku Sandbox";
    el("payment-section").classList.remove("locked");
    el("pay-button").disabled = false;
    renderCart();
  }

  async function startDuitkuInvoice() {
    if (!state.shipping || !state.payment) return;
    const button = el("pay-button");
    const originalLabel = button.innerHTML;
    button.disabled = true;
    button.textContent = "Membuat invoice Duitku…";
    try {
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
      if (!response.ok) throw new Error(payload.error || `Duitku error (${response.status}).`);
      const paymentUrl = String(payload.payment_url || "");
      if (!paymentUrl.startsWith("https://app-sandbox.duitku.com/")) {
        throw new Error("Duitku tidak mengembalikan payment URL sandbox yang valid.");
      }
      window.location.assign(paymentUrl);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Tidak dapat membuat invoice Duitku.");
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

  el("customer-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const result = validateForm(event.currentTarget);
    if (!result.valid) {
      event.currentTarget.querySelector(".invalid")?.focus();
      return;
    }
    state.customer = result.values;
    buildShippingQuotes();
    setStep("payment");
  });

  el("pay-button").addEventListener("click", startDuitkuInvoice);

  el("reset-demo").addEventListener("click", () => {
    state.cart = {};
    state.customer = {};
    state.shipping = null;
    state.payment = null;
    el("customer-form").reset();
    renderCart();
    setStep("cart");
  });

  renderCart();
})();
