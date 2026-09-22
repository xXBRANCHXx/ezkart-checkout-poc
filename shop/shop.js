(() => {
  "use strict";
  const sf = window.EzkartStorefront, { escape: esc, money } = sf;
  const byId = id => document.getElementById(id);
  let store, products = [], selections = new Map(), cart = {};
  function toast(message) { const node = byId("shop-toast"); node.textContent = message; node.classList.add("visible"); clearTimeout(toast.timer); toast.timer = setTimeout(() => node.classList.remove("visible"), 2600); }
  function renderCart() {
    sf.saveCart(store, cart);
    const entries = Object.entries(cart), count = entries.reduce((sum, [, qty]) => sum + qty, 0);
    byId("shop-count").textContent = count;
    byId("cart-count").textContent = `${count} ${count === 1 ? "item" : "items"}`;
    byId("shop-subtotal").textContent = money(entries.reduce((sum, [id, qty]) => sum + selections.get(id).choice.price * qty, 0));
    byId("shop-checkout").disabled = !count;
    byId("shop-cart").innerHTML = entries.length ? entries.map(([id, qty]) => {
      const { product, choice } = selections.get(id);
      return `<div class="shop-cart-line" data-selection="${esc(id)}"><div><b>${esc(product.name)}</b><small>${esc(choice.name)}</small></div><strong>${money(choice.price * qty)}</strong><div class="quantity-control"><button type="button" data-change="-1" aria-label="Decrease ${esc(product.name)} quantity">−</button><output>${qty}</output><button type="button" data-change="1" aria-label="Increase ${esc(product.name)} quantity" ${qty >= choice.stock ? "disabled" : ""}>+</button></div></div>`;
    }).join("") : '<p class="shop-cart-empty">Your cart is empty. Add something you love.</p>';
  }
  function updateCard(card) {
    const product = products.find(p => p.id === card.dataset.product);
    const choice = product.choices.find(c => c.id === card.querySelector("select")?.value) || product.choices[0];
    card.querySelector("[data-price]").textContent = choice ? money(choice.price) : "Unavailable";
    const button = card.querySelector("[data-add]");
    button.disabled = !choice?.available;
    button.textContent = choice?.available ? "Add to cart" : choice?.stock === 0 && product.type === "physical" ? "Sold out" : "Unavailable";
    const input = card.querySelector("input"); input.max = choice?.stock || 1; input.disabled = !choice?.available; input.value = 1;
    const media = card.querySelector(".shop-product-media");
    media.innerHTML = choice?.imageUrl || product.imageUrl ? `<img src="${esc(choice?.imageUrl || product.imageUrl)}" alt="${esc(product.name)}" loading="lazy">` : '<span aria-hidden="true">◇</span>';
  }
  async function load() {
    byId("shop-loading").hidden = false; byId("shop-error").hidden = true; byId("shop-content").hidden = true; byId("shop-empty").hidden = true;
    try {
      const data = await sf.load({ store: new URLSearchParams(location.search).get("store") || "" });
      store = data.store; products = data.products; sf.appearance(store);
      document.title = `${store.name} · Shop`;
      byId("shop-name").textContent = store.name; byId("shop-avatar").textContent = store.name.charAt(0).toUpperCase();
      byId("shop-home").href = sf.shopUrl(store);
      const logo = byId("shop-logo"); logo.hidden = !store.logoUrl; byId("shop-avatar").hidden = !!store.logoUrl;
      if (store.logoUrl) { logo.src = store.logoUrl; logo.alt = `${store.name} logo`; logo.onerror = () => { logo.hidden = true; byId("shop-avatar").hidden = false; }; }
      selections = new Map(products.flatMap(product => product.choices.map(choice => [choice.id, { product, choice }])));
      const saved = sf.readCart(store);
      cart = Object.fromEntries(Object.entries(saved).filter(([id, qty]) => selections.get(id)?.choice.available && Number.isSafeInteger(qty) && qty > 0).map(([id, qty]) => [id, Math.min(qty, selections.get(id).choice.stock)]));
      byId("shop-products").innerHTML = products.map(product => `<article class="shop-product" data-product="${esc(product.id)}"><div class="shop-product-media"></div><div class="shop-product-copy"><h2>${esc(product.name)}</h2><p class="shop-product-description">${esc(product.description?.slice(0, 220))}</p><strong class="shop-product-price" data-price></strong>${product.choices.length && (product.choices.length > 1 || product.choices[0]?.name !== "Standard") ? `<label class="product-choice-label">Option<select aria-label="Option for ${esc(product.name)}">${product.choices.map(choice => `<option value="${esc(choice.id)}" ${choice.id === (product.choices.find(c => c.available) || product.choices[0])?.id ? "selected" : ""}>${esc(choice.name)}${!choice.available ? " — unavailable" : ""}</option>`).join("")}</select></label>` : ""}${product.type !== "physical" ? '<p class="shop-unavailable">Online checkout is not available for this product yet.</p>' : ""}<div class="shop-product-actions"><input type="number" min="1" step="1" value="1" aria-label="Quantity for ${esc(product.name)}"><button class="shop-add" type="button" data-add>Add to cart</button></div></div></article>`).join("");
      document.querySelectorAll(".shop-product").forEach(updateCard);
      renderCart();
      byId("shop-content").hidden = !products.length; byId("shop-empty").hidden = !!products.length;
      if (JSON.stringify(saved) !== JSON.stringify(cart)) toast("Your cart was updated to match current availability.");
    } catch (error) { byId("shop-error").hidden = false; byId("shop-error-message").textContent = error.message; }
    finally { byId("shop-loading").hidden = true; }
  }
  byId("shop-products").addEventListener("change", event => { if (event.target.matches("select")) updateCard(event.target.closest(".shop-product")); });
  byId("shop-products").addEventListener("click", event => {
    if (!event.target.closest("[data-add]")) return;
    const card = event.target.closest(".shop-product"), product = products.find(p => p.id === card.dataset.product);
    const choice = product.choices.find(c => c.id === card.querySelector("select")?.value) || product.choices[0];
    const qty = Number(card.querySelector("input").value);
    if (!choice?.available || !Number.isSafeInteger(qty) || qty < 1 || qty + (cart[choice.id] || 0) > choice.stock) { toast("Choose a quantity within the available stock."); return; }
    cart[choice.id] = (cart[choice.id] || 0) + qty; renderCart(); toast(`${product.name} added to your cart`);
  });
  byId("shop-cart").addEventListener("click", event => {
    const button = event.target.closest("[data-change]"); if (!button) return;
    const id = button.closest("[data-selection]").dataset.selection;
    const next = (cart[id] || 0) + Number(button.dataset.change);
    if (next > selections.get(id).choice.stock) return;
    if (next > 0) cart[id] = next; else delete cart[id]; renderCart();
  });
  byId("shop-checkout").addEventListener("click", () => { if (Object.keys(cart).length) location.assign(sf.checkoutUrl(store, cart)); });
  byId("shop-retry").addEventListener("click", load);
  window.addEventListener("pageshow", event => { if (event.persisted) void load(); });
  void load();
})();
