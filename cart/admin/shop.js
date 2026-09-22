(() => {
  "use strict";
  if (!document.querySelector("[data-shop-admin]")) return;
  const sf = window.EzkartStorefront, { escape: esc, money } = sf, byId = id => document.getElementById(id);
  const form = byId("shop-appearance-form"), fields = form.elements;
  const mediaBase = document.body.dataset.adminCloudMediaBase || "";
  let store = null, products = [], mode = "shop", images = { logoId: "", backgroundId: "" }, previewImages = {}, dirty = false, busy = false;
  const status = (message, error = false) => { const node = byId("shop-admin-status"); node.textContent = message; node.dataset.error = String(error); };
  async function request(method, path, body) {
    if (document.body.dataset.adminCloudEnabled !== "true") throw new Error("Sign in with Google to set up your shop and save its appearance.");
    const response = await fetch(`./?cloud=${encodeURIComponent(path)}`, { method, cache: "no-store", credentials: "same-origin", headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json", "X-Ezkart-Csrf": document.body.dataset.adminCsrfToken } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.error || "Your shop could not be saved. Please try again.");
    return data;
  }
  function appearance() { return { ...images, enabled: fields.enabled.checked, name: fields.name.value.trim(), accent: fields.accent.value, button: fields.button.value, background: fields.background.value, animation: fields.animation.value }; }
  const publicImage = path => path ? `${mediaBase}${path}` : "";
  function renderPreview() {
    const value = appearance(), target = byId("shop-preview");
    const logoUrl = previewImages.logoId || publicImage(images.logoId ? `/v1/public/media/${images.logoId}` : "");
    const backgroundUrl = previewImages.backgroundId || publicImage(images.backgroundId ? `/v1/public/media/${images.backgroundId}` : "");
    sf.appearance({ ...value, backgroundUrl }, target);
    for (const [key, nodeId] of [["logoId", "shop-logo-preview"], ["backgroundId", "shop-background-preview"]]) {
      const url = key === "logoId" ? logoUrl : backgroundUrl, image = byId(nodeId);
      image.hidden = !url; if (url) image.src = url;
      document.querySelector(`[data-remove-image="${key}"]`).hidden = !images[key];
    }
    const selected = products.find(p => p.id === byId("shop-preview-product").value) || products[0];
    const visible = mode === "shop" ? products.slice(0, 4) : selected ? [selected] : [];
    const card = product => {
      const media = product.media?.[0]?.id, url = media ? `${mediaBase}/v1/public/media/${media}` : "";
      const choice = product.variants?.find(v => !v.hidden && v.stock > 0) || product.variants?.find(v => !v.hidden);
      return `<article class="shop-preview-card shop-product"><div class="shop-preview-media">${url ? `<img src="${esc(url)}" alt="">` : "◇"}</div><div class="shop-preview-card-copy"><b>${esc(product.name)}</b><small>${choice ? `${esc(choice.name)} · ` : ""}${money(choice?.price ?? product.price)}</small>${mode === "shop" ? '<span class="shop-preview-button">Add to bag</span>' : '<small>Quantity: 1</small>'}</div></article>`;
    };
    target.innerHTML = `<div class="shop-preview-head">${logoUrl ? `<img src="${esc(logoUrl)}" alt="">` : `<span class="shop-preview-avatar">${esc((value.name || "S").charAt(0))}</span>`}<strong>${esc(value.name || "Your store")}</strong></div><div class="shop-preview-body"><div class="shop-preview-heading"><b>${mode === "shop" ? "Shop all products" : "Review your cart"}</b><p>${mode === "shop" ? "Choose your items and check out together." : "Check your items before continuing."}</p></div>${visible.length ? `<div class="shop-preview-grid">${visible.map(card).join("")}</div>` : '<div class="shop-preview-heading"><p>Create a product to see it here.</p></div>'}${mode === "checkout" && selected ? `<div class="shop-preview-order"><p><b>Your order</b><span>${money((selected.variants?.find(v => !v.hidden && v.stock > 0) || selected.variants?.find(v => !v.hidden))?.price ?? selected.price)}</span></p><p>Delivery calculated at checkout</p><span class="shop-preview-button">Continue to checkout</span></div>` : ""}</div>`;
  }
  function updateLinks() {
    const url = new URL(sf.shopUrl(store), location.origin).href;
    byId("shop-public-url").value = url; byId("shop-copy-link").disabled = !store.enabled;
    byId("shop-open-link").hidden = !store.enabled; byId("shop-open-link").href = url;
    byId("shop-publish-status").textContent = store.enabled ? "Your shop is enabled. Share this link anywhere." : "Your shop is disabled. Product checkout links still work.";
    byId("shop-product-links").innerHTML = products.length ? products.map(product => {
      const url = new URL(`/cart/?product=${encodeURIComponent(product.id)}`, location.origin).href;
      return `<article class="shop-product-link"><div><b>${esc(product.name)}</b><small>${product.type === "physical" ? "Uses your shared checkout appearance" : "Online checkout currently supports physical products"}</small></div><div><a class="action-button" href="${esc(url)}" target="_blank" rel="noopener">Open ↗</a><button type="button" class="action-button" data-copy-product="${esc(url)}">Copy checkout link</button></div></article>`;
    }).join("") : '<p class="shop-field-note">Your active products will appear here. <a href="?page=product-new&new=1">Create a product</a> to get started.</p>';
  }
  async function copy(value) {
    try { await navigator.clipboard.writeText(value); status("Link copied. Connect it to a button or share it directly."); }
    catch { status("Copy is unavailable in this browser. Open the link and copy its address.", true); }
  }
  async function load() {
    byId("shop-settings").disabled = true; byId("shop-admin-retry").hidden = true; status("Loading your shop…");
    try {
      const [settings, catalog] = await Promise.all([request("GET", "/v1/storefront"), request("GET", "/v1/catalog")]);
      store = settings.store; products = catalog.products.filter(product => product.status === "active");
      for (const key of ["name", "accent", "button", "background", "animation"]) fields[key].value = store[key];
      fields.enabled.checked = store.enabled; images = { logoId: store.logoId, backgroundId: store.backgroundId }; previewImages = {};
      byId("shop-preview-product").innerHTML = products.map(product => `<option value="${esc(product.id)}">${esc(product.name)}</option>`).join("");
      dirty = false; renderPreview(); updateLinks(); byId("shop-settings").disabled = false; status("Appearance saved across all your checkout links.");
    } catch (error) { status(error.message, true); byId("shop-admin-retry").hidden = false; }
  }
  form.addEventListener("input", event => { if (event.target.type === "file" || event.target.id === "shop-preview-product") return; dirty = true; renderPreview(); status("Unsaved changes"); });
  document.querySelectorAll("[data-preview-mode]").forEach(button => button.addEventListener("click", () => {
    mode = button.dataset.previewMode;
    document.querySelectorAll("[data-preview-mode]").forEach(node => node.setAttribute("aria-pressed", String(node === button)));
    document.querySelector(".shop-preview-product").hidden = mode !== "checkout"; renderPreview();
  }));
  byId("shop-preview-product").addEventListener("change", renderPreview);
  document.querySelectorAll("[data-shop-upload]").forEach(input => input.addEventListener("change", async () => {
    const file = input.files?.[0]; if (!file) return;
    if (file.size > 2097152 || !["image/png", "image/jpeg", "image/webp", "image/avif"].includes(file.type)) { status("Choose a PNG, JPG, WebP, or AVIF image up to 2 MB.", true); input.value = ""; return; }
    busy = true; byId("shop-settings").disabled = true; status("Uploading image…");
    try {
      const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error("The image could not be read.")); reader.readAsDataURL(file); });
      const data = await request("POST", "/v1/media", { dataUrl });
      const key = input.dataset.shopUpload; images[key] = data.media.id; previewImages[key] = dataUrl;
      dirty = true; renderPreview(); status("Image ready. Save changes to use it on your pages.");
    } catch (error) { status(error.message, true); }
    finally { busy = false; byId("shop-settings").disabled = false; input.value = ""; }
  }));
  document.querySelectorAll("[data-remove-image]").forEach(button => button.addEventListener("click", () => { images[button.dataset.removeImage] = ""; delete previewImages[button.dataset.removeImage]; dirty = true; renderPreview(); status("Unsaved changes"); }));
  form.addEventListener("submit", async event => {
    event.preventDefault(); if (busy) return;
    const payload = appearance(); busy = true; byId("shop-settings").disabled = true; status("Saving changes…");
    try { store = (await request("PUT", "/v1/storefront", payload)).store; dirty = false; updateLinks(); status("Saved. Your shop and product checkouts now share this appearance."); }
    catch (error) { status(error.message, true); }
    finally { busy = false; byId("shop-settings").disabled = false; }
  });
  byId("shop-copy-link").addEventListener("click", () => copy(byId("shop-public-url").value));
  byId("shop-product-links").addEventListener("click", event => { const button = event.target.closest("[data-copy-product]"); if (button) void copy(button.dataset.copyProduct); });
  byId("shop-admin-retry").addEventListener("click", load);
  window.addEventListener("beforeunload", event => { if (dirty || busy) { event.preventDefault(); event.returnValue = ""; } });
  void load();
})();
