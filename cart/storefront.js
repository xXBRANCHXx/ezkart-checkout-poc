(() => {
  "use strict";
  const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const money = value => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(value) || 0);
  const textColor = color => {
    const values = color.slice(1).match(/../g).map(v => parseInt(v, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
    return values[0] * .2126 + values[1] * .7152 + values[2] * .0722 > .179 ? "#111827" : "#ffffff";
  };
  const imageUrl = value => { try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) ? url.href : ""; } catch { return ""; } };
  function appearance(store, target = document.body) {
    for (const key of ["accent", "button", "background"]) {
      const value = /^#[0-9a-f]{6}$/i.test(store[key]) ? store[key] : "#f7f8fa";
      target.style.setProperty(`--store-${key}`, value);
      target.style.setProperty(`--store-on-${key}`, textColor(value));
    }
    const background = /^data:image\/(?:jpeg|png|webp|avif);base64,[a-zA-Z0-9+/=]+$/.test(store.backgroundUrl || "") ? store.backgroundUrl : imageUrl(store.backgroundUrl);
    target.style.setProperty("--store-image", background ? `url(${JSON.stringify(background)})` : "none");
    target.dataset.storeAnimation = ["fade", "rise"].includes(store.animation) ? store.animation : "none";
    target.classList.add("branded-surface");
  }
  async function load(query) {
    const response = await fetch(`/cart/api/storefront.php?${new URLSearchParams(query)}`, { cache: "no-store", headers: { Accept: "application/json" } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok || !data.store) throw new Error(data.error || "The shop could not be loaded. Please try again.");
    return data;
  }
  const cartKey = store => `ezkart.checkout.cart.v1:${store.cartScope}`;
  const readCart = store => { try { const value = JSON.parse(localStorage.getItem(cartKey(store)) || "{}"); return value && typeof value === "object" && !Array.isArray(value) ? value : {}; } catch { return {}; } };
  const saveCart = (store, cart) => { try { localStorage.setItem(cartKey(store), JSON.stringify(cart)); } catch {} };
  const shopUrl = store => `/shop/?store=${encodeURIComponent(store.id)}`;
  const checkoutUrl = (store, cart) => {
    const url = new URL("/cart/", location.origin);
    url.searchParams.set("store", store.id);
    url.searchParams.set("shop", store.cartScope);
    if (cart) url.searchParams.set("cart", Object.entries(cart).map(([id, count]) => `${id}:${count}`).join(","));
    return url.href;
  };
  window.EzkartStorefront = { escape, money, imageUrl, appearance, load, cartKey, readCart, saveCart, shopUrl, checkoutUrl };
})();
