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
  const campaignVisit = store => {
    const query = new URLSearchParams(location.search), value = query.get('campaign_visit');
    return store && query.getAll('store').length === 1 && query.get('store') === store.id && query.getAll('campaign_visit').length === 1 && /^[a-f0-9]{64}$/.test(value || '') ? value : '';
  };
  const shopUrl = store => `/shop/?store=${encodeURIComponent(store.id)}` + (campaignVisit(store) ? '&campaign_visit=' + campaignVisit(store) : '');
  const checkoutUrl = (store, cart) => {
    const url = new URL("/cart/", location.origin);
    url.searchParams.set("store", store.id);
    url.searchParams.set("shop", store.cartScope);
    if (campaignVisit(store)) url.searchParams.set('campaign_visit', campaignVisit(store));
    if (cart) url.searchParams.set("cart", Object.entries(cart).map(([id, count]) => `${id}:${count}`).join(","));
    return url.href;
  };
  function support(store,target,{description=true}={}) {
    if(!target)return;target.replaceChildren();
    const email=typeof store.supportEmail==='string'&&/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(store.supportEmail)?store.supportEmail:'',phone=/^\+[1-9][0-9]{7,14}$/.test(store.supportPhone||'')?store.supportPhone:'';
    const copy=description&&typeof store.description==='string'?store.description:'';
    target.hidden=!email&&!phone&&!copy;if(target.hidden)return;
    const heading=document.createElement('h2');heading.textContent='About '+store.name;target.append(heading);
    if(copy){const p=document.createElement('p');p.textContent=copy;target.append(p);}
    for(const [value,href] of [[email,'mailto:'+encodeURIComponent(email)],[phone,'tel:'+phone]])if(value){const a=document.createElement('a');a.textContent=value;a.href=href;target.append(a);}
  }
  window.EzkartStorefront = { escape, money, imageUrl, appearance, load, cartKey, readCart, saveCart, shopUrl, checkoutUrl, support, campaignVisit };
})();
