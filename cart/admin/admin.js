(async () => {
  "use strict";

  const normalize = (value) => String(value || "").trim().toLocaleLowerCase("id-ID");
  const escapeHtml = (value) => String(value || "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '"': "&quot;",
  })[character]);

  const mfaQr = document.querySelector("[data-mfa-qr-uri]");
  if (mfaQr && typeof window.qrcode === "function") {
    try {
      const uri = String(mfaQr.dataset.mfaQrUri || "");
      if (!uri.startsWith("otpauth://totp/") || uri.length > 2048) throw new Error("Invalid authenticator URI");
      const qr = window.qrcode(0, "M");
      qr.addData(uri, "Byte");
      qr.make();
      mfaQr.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 16, scalable: true });
      mfaQr.classList.remove("mfa-qr-fallback");
      mfaQr.classList.add("is-rendered");
    } catch (_) {
      mfaQr.innerHTML = "<span>QR unavailable</span><small>Use the setup key shown here.</small>";
    }
  }

  const search = document.getElementById("order-search");
  const globalSearch = document.getElementById("global-search");
  const status = document.getElementById("status-filter");
  const cards = Array.from(document.querySelectorAll("[data-order-card]"));
  const empty = document.getElementById("empty-filter");

  function filterOrders(querySource = search) {
    if (!status || !empty) return false;
    const query = normalize(querySource?.value);
    const selectedStatus = status.value;
    let visible = 0;
    cards.forEach((card) => {
      const matchesQuery = !query || normalize(card.dataset.search).includes(query);
      const matchesStatus = selectedStatus === "all" || card.dataset.status === selectedStatus;
      card.hidden = !(matchesQuery && matchesStatus);
      if (card.hidden && card.nextElementSibling?.classList.contains("order-detail-row")) {
        card.nextElementSibling.hidden = true;
        card.querySelector("[data-order-toggle]")?.setAttribute("aria-expanded", "false");
      }
      if (!card.hidden) visible += 1;
    });
    empty.hidden = visible > 0 || cards.length === 0;
    return true;
  }

  search?.addEventListener("input", () => filterOrders(search));
  status?.addEventListener("change", () => filterOrders(search));

  function filterRows(input, target) {
    const query = normalize(input.value);
    const rows = Array.from(target.querySelectorAll("[data-search-row]"));
    rows.forEach((row) => { row.hidden = Boolean(query) && !normalize(row.dataset.searchRow).includes(query); });
  }

  document.querySelectorAll("[data-table-search]").forEach((input) => {
    const target = document.getElementById(input.dataset.tableSearch || "");
    if (target) input.addEventListener("input", () => filterRows(input, target));
  });

  globalSearch?.addEventListener("input", () => {
    if (search) {
      search.value = globalSearch.value;
      filterOrders(globalSearch);
      if (globalSearch.value.trim()) document.getElementById("recent-orders")?.scrollIntoView({ block: "center" });
      return;
    }
    const rows = Array.from(document.querySelectorAll("main [data-search-row]"));
    const query = normalize(globalSearch.value);
    rows.forEach((row) => { row.hidden = Boolean(query) && !normalize(row.dataset.searchRow).includes(query); });
  });

  document.querySelectorAll("[data-order-toggle]").forEach((button) => {
    button.addEventListener("click", () => {
      const detail = button.closest("tr")?.nextElementSibling;
      if (!detail?.classList.contains("order-detail-row")) return;
      const willOpen = detail.hidden;
      document.querySelectorAll(".order-detail-row").forEach((row) => { row.hidden = true; });
      document.querySelectorAll("[data-order-toggle]").forEach((toggle) => toggle.setAttribute("aria-expanded", "false"));
      detail.hidden = !willOpen;
      button.setAttribute("aria-expanded", String(willOpen));
      if (willOpen) detail.scrollIntoView({ block: "nearest" });
    });
  });

  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      globalSearch?.focus();
    }
    if (event.key === "Escape") globalSearch?.blur();
  });

  const sidebar = document.getElementById("sidebar");
  const menu = document.getElementById("mobile-menu");
  const backdrop = document.getElementById("sidebar-backdrop");
  const closeSidebar = () => {
    sidebar?.classList.remove("open");
    backdrop?.classList.remove("show");
  };
  menu?.addEventListener("click", () => {
    sidebar?.classList.toggle("open");
    backdrop?.classList.toggle("show");
  });
  backdrop?.addEventListener("click", closeSidebar);
  sidebar?.querySelectorAll("a").forEach((link) => link.addEventListener("click", closeSidebar));

  document.querySelectorAll(".chart-controls > div button").forEach((button) => {
    button.addEventListener("click", () => {
      button.parentElement?.querySelectorAll("button").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
    });
  });

  document.querySelectorAll(".tasks-panel input[type=checkbox]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => checkbox.closest("li")?.classList.toggle("completed", checkbox.checked));
  });

  let toastTimer;
  const showToast = (message) => {
    let toast = document.querySelector(".toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.className = "toast";
      toast.setAttribute("role", "status");
      document.body.append(toast);
    }
    toast.textContent = message;
    toast.classList.add("show");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove("show"), 2400);
  };
  document.querySelectorAll("[data-toast]").forEach((button) => {
    button.addEventListener("click", () => showToast(button.dataset.toast || "Action completed"));
  });

  document.querySelectorAll(".thread-item").forEach((thread) => {
    thread.addEventListener("click", () => {
      document.querySelectorAll(".thread-item").forEach((item) => item.classList.remove("active"));
      thread.classList.add("active");
    });
  });

  const cloudEnabled = document.body.dataset.adminCloudEnabled === "true";
  const cloudCsrfToken = document.body.dataset.adminCsrfToken || "";
  const cloudMediaBase = String(document.body.dataset.adminCloudMediaBase || "").replace(/\/$/, "");
  const landingPagePreviewVersion = "2";
  const cloudUrl = (path) => `./?cloud=${encodeURIComponent(path)}`;
  const cloudPrivateMediaUrl = (id) => cloudUrl(`/v1/media/${encodeURIComponent(id)}`);
  const cloudMediaUrl = (id) => cloudMediaBase
    ? `${cloudMediaBase}/v1/public/media/${encodeURIComponent(id)}`
    : cloudPrivateMediaUrl(id);
  const cloudRequest = async (method, path, payload = null) => {
    if (!cloudEnabled) throw new Error("Sign in with Google to access your saved products.");
    const response = await fetch(cloudUrl(path), {
      method,
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        ...(payload ? { "Content-Type": "application/json" } : {}),
        ...(method === "GET" ? {} : { "X-Ezkart-Csrf": cloudCsrfToken }),
      },
      body: payload ? JSON.stringify(payload) : null,
      cache: "no-store",
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok !== true) throw new Error(String(result.error || `Ezkart returned ${response.status}.`));
    return result;
  };
  const normalizeCloudProduct = (product) => {
    const media = Array.isArray(product?.media) ? product.media : [];
    const productMediaUrl = product?.status === "archived" ? cloudPrivateMediaUrl : cloudMediaUrl;
    const images = media.map((item) => productMediaUrl(item.id));
    return {
      ...product,
      mediaIds: media.map((item) => item.id),
      images,
      image: images[0] || "",
      variants: (Array.isArray(product?.variants) ? product.variants : []).map((variant) => ({
        ...variant,
        image: variant.imageUploadId ? productMediaUrl(variant.imageUploadId) : null,
      })),
    };
  };
  const normalizeCloudDraft = (draft) => ({
    ...draft,
    images: (Array.isArray(draft?.images) ? draft.images : []).map((item) => ({
      ...item,
      data: item.cloudId ? cloudPrivateMediaUrl(item.cloudId) : item.data || "",
    })),
    variants: (Array.isArray(draft?.variants) ? draft.variants : []).map((variant) => ({
      ...variant,
      customImage: variant.customImage?.cloudId
        ? { ...variant.customImage, data: cloudPrivateMediaUrl(variant.customImage.cloudId) }
        : variant.customImage || null,
    })),
  });
  const normalizeCloudLandingPage = (page) => {
    const id = String(page?.id || "");
    const previewUpdatedAt = page?.previewUpdatedAt || null;
    const previewSourceUpdatedAt = page?.previewSourceUpdatedAt || null;
    const previewVersion = String(page?.previewVersion || "");
    const previewIsCurrent = Boolean(id
      && previewUpdatedAt
      && previewVersion === landingPagePreviewVersion
      && previewSourceUpdatedAt === page?.updatedAt);
    return {
      ...page,
      products: Array.isArray(page?.products) ? page.products : [],
      customProducts: Array.isArray(page?.customProducts) ? page.customProducts : [],
      status: page?.status === "published" ? "published" : "draft",
      previewUpdatedAt,
      previewBytes: Math.max(0, Math.round(Number(page?.previewBytes) || 0)),
      previewSourceUpdatedAt,
      previewVersion,
      previewUrl: previewIsCurrent
        ? `${cloudUrl(`/v1/landing-pages/${encodeURIComponent(id)}/preview`)}&v=${encodeURIComponent(previewUpdatedAt)}`
        : "",
    };
  };
  const componentLimits = { count: 20, bytes: 200 * 1024 };
  const componentBytes = (value) => new TextEncoder().encode(String(value || "")).byteLength;
  const normalizeCloudComponent = (component) => ({
    id: String(component?.id || ""),
    name: String(component?.name || "Untitled component").slice(0, 80),
    description: String(component?.description || "").slice(0, 180),
    code: String(component?.code || ""),
    sizeBytes: componentBytes(component?.code || ""),
    createdAt: component?.createdAt || null,
    updatedAt: component?.updatedAt || null,
  });
  let cloudCatalogProducts = [];
  let cloudProductDrafts = [];
  let cloudLandingPages = [];
  let cloudComponents = [];
  let cloudLoadError = "";
  let cloudLandingLoadError = "";
  let cloudComponentLoadError = "";
  if (cloudEnabled) {
    const [catalogLoad, landingPageLoad, componentLoad] = await Promise.allSettled([
      cloudRequest("GET", "/v1/catalog"),
      cloudRequest("GET", "/v1/landing-pages"),
      cloudRequest("GET", "/v1/components"),
    ]);
    if (catalogLoad.status === "fulfilled") {
      cloudCatalogProducts = (Array.isArray(catalogLoad.value.products) ? catalogLoad.value.products : []).map(normalizeCloudProduct);
      cloudProductDrafts = (Array.isArray(catalogLoad.value.drafts) ? catalogLoad.value.drafts : []).map(normalizeCloudDraft);
    } else cloudLoadError = catalogLoad.reason instanceof Error ? catalogLoad.reason.message : "Saved products could not be loaded.";
    if (landingPageLoad.status === "fulfilled") cloudLandingPages = (Array.isArray(landingPageLoad.value.pages) ? landingPageLoad.value.pages : []).map(normalizeCloudLandingPage);
    else cloudLandingLoadError = landingPageLoad.reason instanceof Error ? landingPageLoad.reason.message : "Saved landing pages could not be loaded.";
    if (componentLoad.status === "fulfilled") cloudComponents = (Array.isArray(componentLoad.value.components) ? componentLoad.value.components : []).map(normalizeCloudComponent);
    else cloudComponentLoadError = componentLoad.reason instanceof Error ? componentLoad.reason.message : "Saved components could not be loaded.";
  }

  const storageScope = document.body.dataset.adminStorageScope || "anonymous";
  const mayMigrateLegacyStorage = document.body.dataset.adminMigrateLegacyStorage === "true";
  const scopedStorageKey = (key) => `${key}:${storageScope}`;
  const migrateLegacyStorage = (legacyKey, scopedKey, storage = localStorage) => {
    if (!mayMigrateLegacyStorage || storage.getItem(scopedKey) !== null) return;
    const legacyValue = storage.getItem(legacyKey);
    if (legacyValue === null) return;
    storage.setItem(scopedKey, legacyValue);
    storage.removeItem(legacyKey);
  };
  const legacyProductCatalogKey = "ezkart:catalog:v1";
  const productCatalogKey = scopedStorageKey(legacyProductCatalogKey);
  const legacyProductDraftsKey = "ezkart:product-drafts:v1";
  const productDraftsKey = scopedStorageKey(legacyProductDraftsKey);
  const legacyActiveProductDraftKey = "ezkart:product-editor:active-draft";
  const activeProductDraftKey = scopedStorageKey(legacyActiveProductDraftKey);
  const componentStorageKey = scopedStorageKey("ezkart:components:v1");
  migrateLegacyStorage(legacyProductCatalogKey, productCatalogKey);
  migrateLegacyStorage(legacyProductDraftsKey, productDraftsKey);
  migrateLegacyStorage(legacyActiveProductDraftKey, activeProductDraftKey, sessionStorage);
  const readLocalComponents = () => {
    try {
      const value = JSON.parse(localStorage.getItem(componentStorageKey) || "[]");
      return Array.isArray(value) ? value.slice(0, componentLimits.count).map(normalizeCloudComponent).filter((component) => component.id && component.code) : [];
    } catch (_) { return []; }
  };
  const writeLocalComponents = (components) => {
    try { localStorage.setItem(componentStorageKey, JSON.stringify(components.slice(0, componentLimits.count))); return true; }
    catch (_) { showToast("Component storage is full. Delete an unused component or reduce its code size."); return false; }
  };
  const readComponents = () => {
    const components = [...cloudComponents];
    readLocalComponents().forEach((component) => { if (!components.some((item) => item.id === component.id)) components.push(component); });
    return components.slice(0, componentLimits.count);
  };
  const saveReusableComponent = async (component) => {
    const normalized = normalizeCloudComponent(component);
    if (componentBytes(normalized.code) > componentLimits.bytes) throw new Error("Component code is larger than 200 KB.");
    if (cloudEnabled) {
      const result = await cloudRequest("PUT", `/v1/components/${encodeURIComponent(normalized.id)}`, normalized);
      const saved = normalizeCloudComponent(result.component);
      const index = cloudComponents.findIndex((item) => item.id === saved.id);
      if (index >= 0) cloudComponents[index] = saved; else cloudComponents.unshift(saved);
      writeLocalComponents(readLocalComponents().filter((item) => item.id !== saved.id));
      return saved;
    }
    const components = readLocalComponents();
    const index = components.findIndex((item) => item.id === normalized.id);
    if (index >= 0) components[index] = normalized; else components.unshift(normalized);
    if (!writeLocalComponents(components)) throw new Error("The component could not be saved in this browser.");
    return normalized;
  };
  const deleteReusableComponent = async (componentId) => {
    if (cloudEnabled && cloudComponents.some((component) => component.id === componentId)) await cloudRequest("DELETE", `/v1/components/${encodeURIComponent(componentId)}`);
    cloudComponents = cloudComponents.filter((component) => component.id !== componentId);
    writeLocalComponents(readLocalComponents().filter((component) => component.id !== componentId));
  };
  for (let index = localStorage.length - 1; index >= 0; index -= 1) {
    const key = localStorage.key(index) || "";
    if (key.startsWith("ezkart:landing-builder:advanced-mode") || key.startsWith("ezkart:landing-builder:v2:") || key.startsWith("ezkart:landing-builder:v3:")) {
      localStorage.removeItem(key);
    }
  }
  const readLocalCatalogProducts = () => {
    try {
      const value = JSON.parse(localStorage.getItem(productCatalogKey) || "[]");
      return Array.isArray(value) ? value.filter((product) => product && /^custom-[a-z0-9]+$/i.test(product.id || "") && typeof product.name === "string") : [];
    } catch (_) { return []; }
  };
  const readCatalogProducts = ({ includeArchived = false } = {}) => {
    const products = [...cloudCatalogProducts];
    readLocalCatalogProducts().forEach((product) => { if (!products.some((item) => item.id === product.id)) products.push(product); });
    return includeArchived ? products : products.filter((product) => product.status !== "archived");
  };
  const writeCatalogProducts = (products) => {
    try { localStorage.setItem(productCatalogKey, JSON.stringify(products)); return true; }
    catch (_) { showToast("These images exceed this browser's catalog storage. Use fewer or simpler images."); return false; }
  };
  const readLocalProductDrafts = () => {
    try {
      const value = JSON.parse(localStorage.getItem(productDraftsKey) || "[]");
      return Array.isArray(value) ? value.filter((draft) => draft && typeof draft.id === "string") : [];
    } catch (_) { return []; }
  };
  const readProductDrafts = () => {
    const drafts = [...cloudProductDrafts];
    readLocalProductDrafts().forEach((draft) => { if (!drafts.some((item) => item.id === draft.id)) drafts.push(draft); });
    return drafts;
  };
  const writeProductDrafts = (drafts) => {
    try { localStorage.setItem(productDraftsKey, JSON.stringify(drafts)); return true; }
    catch (_) { showToast("Draft storage is full. Remove unused drafts or reduce the number of images."); return false; }
  };
  const uploadCloudImage = async (dataUrl) => {
    const result = await cloudRequest("POST", "/v1/media", { dataUrl });
    return result.media;
  };
  const replaceCloudProduct = (product) => {
    const normalized = normalizeCloudProduct(product);
    const index = cloudCatalogProducts.findIndex((item) => item.id === normalized.id);
    if (index >= 0) cloudCatalogProducts[index] = normalized; else cloudCatalogProducts.unshift(normalized);
    return normalized;
  };
  const removeLocalProduct = (productId) => writeCatalogProducts(readLocalCatalogProducts().filter((item) => item.id !== productId));
  const removeLocalDraft = (draftId) => writeProductDrafts(readLocalProductDrafts().filter((item) => item.id !== draftId));
  const cloudProductPayload = async (product) => {
    const imageValues = Array.isArray(product.images) ? product.images : [];
    const imageUploadIds = [];
    for (let index = 0; index < imageValues.length; index += 1) {
      const existingId = product.mediaIds?.[index];
      if (existingId) { imageUploadIds.push(existingId); continue; }
      const source = typeof imageValues[index] === "string" ? imageValues[index] : imageValues[index]?.data;
      if (!String(source || "").startsWith("data:image/")) throw new Error("A product image is not ready for upload.");
      imageUploadIds.push((await uploadCloudImage(source)).id);
    }
    const variants = [];
    for (const variant of Array.isArray(product.variants) ? product.variants : []) {
      let imageUploadId = variant.imageUploadId || null;
      if (!imageUploadId && variant.imageSource === "variant-upload" && String(variant.image || "").startsWith("data:image/")) {
        imageUploadId = (await uploadCloudImage(variant.image)).id;
      }
      const variantPayload = { ...variant };
      delete variantPayload.image;
      delete variantPayload.customImage;
      variants.push({ ...variantPayload, imageUploadId });
    }
    const productPayload = { ...product };
    delete productPayload.images;
    delete productPayload.image;
    delete productPayload.mediaIds;
    return { ...productPayload, imageUploadIds, variants };
  };
  const saveCloudProduct = async (product) => {
    const payload = await cloudProductPayload(product);
    const result = await cloudRequest("PUT", `/v1/products/${encodeURIComponent(product.id)}`, payload);
    const saved = replaceCloudProduct(result.product);
    removeLocalProduct(product.id);
    document.dispatchEvent(new CustomEvent("ezkart:cloud-catalog-changed", { detail: { product: saved } }));
    return saved;
  };
  const cloudifyDraftSnapshot = async (snapshot) => {
    const next = structuredClone(snapshot);
    next.images = [];
    for (const image of Array.isArray(snapshot.images) ? snapshot.images : []) {
      let cloudId = image.cloudId || null;
      if (!cloudId && String(image.data || "").startsWith("data:image/")) cloudId = (await uploadCloudImage(image.data)).id;
      if (!cloudId) throw new Error("A draft image is not ready for upload.");
      next.images.push({ id: image.id, cloudId });
    }
    next.variants = [];
    for (const variant of Array.isArray(snapshot.variants) ? snapshot.variants : []) {
      let customImage = variant.customImage || null;
      if (customImage) {
        let cloudId = customImage.cloudId || null;
        if (!cloudId && String(customImage.data || "").startsWith("data:image/")) cloudId = (await uploadCloudImage(customImage.data)).id;
        if (!cloudId) throw new Error("A variant draft image is not ready for upload.");
        customImage = { cloudId };
      }
      next.variants.push({ ...variant, customImage });
    }
    return next;
  };
  const saveCloudDraft = async (snapshot) => {
    const cloudSnapshot = await cloudifyDraftSnapshot(snapshot);
    const result = await cloudRequest("PUT", `/v1/drafts/${encodeURIComponent(snapshot.id)}`, {
      productId: snapshot.productId || null,
      title: snapshot.name || "",
      snapshot: cloudSnapshot,
    });
    const normalized = normalizeCloudDraft({ ...cloudSnapshot, ...result.draft, name: snapshot.name || "" });
    const index = cloudProductDrafts.findIndex((item) => item.id === snapshot.id);
    if (index >= 0) cloudProductDrafts[index] = normalized; else cloudProductDrafts.unshift(normalized);
    removeLocalDraft(snapshot.id);
    document.dispatchEvent(new CustomEvent("ezkart:cloud-drafts-changed"));
    return normalized;
  };
  const migrateLegacyCloudData = async () => {
    if (!cloudEnabled || cloudLoadError) return;
    let migrated = 0;
    let failed = 0;
    for (const product of readLocalCatalogProducts()) {
      if (cloudCatalogProducts.some((item) => item.id === product.id)) { removeLocalProduct(product.id); continue; }
      try { await saveCloudProduct(product); migrated += 1; } catch (_) { failed += 1; }
    }
    for (const draft of readLocalProductDrafts()) {
      if (cloudProductDrafts.some((item) => item.id === draft.id)) { removeLocalDraft(draft.id); continue; }
      try { await saveCloudDraft(draft); migrated += 1; } catch (_) { failed += 1; }
    }
    if (migrated > 0) showToast(`${migrated} browser-saved item${migrated === 1 ? "" : "s"} added to your Ezkart account`);
    if (failed > 0) showToast(`${failed} item${failed === 1 ? "" : "s"} could not be synchronized yet; the browser copy was kept`);
  };
  if (cloudLoadError) showToast(`Saved products unavailable: ${cloudLoadError}`);
  else window.setTimeout(() => { void migrateLegacyCloudData(); }, 600);
  if (cloudLandingLoadError) window.setTimeout(() => showToast(`Landing pages unavailable: ${cloudLandingLoadError}`), cloudLoadError ? 2500 : 0);
  if (cloudComponentLoadError) window.setTimeout(() => showToast(`Components unavailable: ${cloudComponentLoadError}`), 3500);
  const hydrateCreatorCatalog = (form) => {
    const fieldset = form?.querySelector("[data-creator-products]");
    if (!fieldset) return;
    const products = readCatalogProducts();
    const empty = fieldset.querySelector("[data-creator-products-empty]");
    if (empty) empty.hidden = products.length > 0;
    products.forEach((product) => {
      if (fieldset.querySelector(`input[value="${CSS.escape(product.id)}"]`)) return;
      const label = document.createElement("label");
      label.dataset.sharedCatalogProduct = product.id;
      label.innerHTML = `<input type="checkbox" name="starter_products[]" value="${product.id}"><span><span class="product-art"><img src="${product.image || product.images?.[0] || ""}" alt="" loading="lazy" decoding="async"></span><b>${escapeHtml(product.name)}</b><small>${escapeHtml(formatCreatorPrice(product.price))} · ${escapeHtml(product.type || "product")}</small></span>`;
      fieldset.append(label);
    });
  };
  const readLandingSites = () => [...cloudLandingPages];
  const landingPageId = (url) => String(url || "").toLowerCase().replace(/\.ezkart\.site$/, "");
  const replaceCloudLandingPage = (page) => {
    const index = cloudLandingPages.findIndex((item) => item.id === page?.id);
    const normalized = normalizeCloudLandingPage({ ...(index >= 0 ? cloudLandingPages[index] : {}), ...page });
    if (index >= 0) cloudLandingPages[index] = { ...cloudLandingPages[index], ...normalized };
    else cloudLandingPages.unshift(normalized);
    return normalized;
  };
  const saveCloudLandingPage = async (site, changes = {}) => {
    if (!cloudEnabled) throw new Error("Sign in with Google to save landing pages to your Ezkart account.");
    const id = landingPageId(site?.url || site?.id);
    const result = await cloudRequest("PUT", `/v1/landing-pages/${encodeURIComponent(id)}`, {
      name: site.name,
      products: Array.isArray(site.products) ? site.products : [],
      customProducts: Array.isArray(site.customProducts) ? site.customProducts : [],
      ...changes,
    });
    const saved = replaceCloudLandingPage(result.page);
    document.dispatchEvent(new CustomEvent("ezkart:cloud-landing-pages-changed", { detail: { page: saved } }));
    return saved;
  };
  const loadCloudLandingPage = async (url) => {
    if (!cloudEnabled) throw new Error("Sign in with Google to load your saved landing pages.");
    const result = await cloudRequest("GET", `/v1/landing-pages/${encodeURIComponent(landingPageId(url))}`);
    return replaceCloudLandingPage(result.page);
  };
  const deleteCloudLandingPage = async (url) => {
    if (!cloudEnabled) throw new Error("Sign in with Google to delete saved landing pages.");
    const id = landingPageId(url);
    await cloudRequest("DELETE", `/v1/landing-pages/${encodeURIComponent(id)}`);
    cloudLandingPages = cloudLandingPages.filter((page) => page.id !== id);
    document.dispatchEvent(new CustomEvent("ezkart:cloud-landing-pages-changed"));
  };
  const updateLandingCountBadges = (count = readLandingSites().length) => {
    document.querySelectorAll("[data-site-count]").forEach((badge) => { badge.textContent = String(count); });
    document.querySelectorAll("[data-landing-page-summary]").forEach((target) => { target.textContent = count ? `${count} landing page${count === 1 ? "" : "s"}` : "No landing pages"; });
  };
  const formatCreatorPrice = (amount) => `Rp${new Intl.NumberFormat("id-ID").format(amount)}`;
  const compressCreatorProductImage = async (file) => {
    if (!file || !file.type.startsWith("image/")) throw new Error("Choose a PNG, JPEG, WebP, or AVIF product photo.");
    if (file.size > 2 * 1024 * 1024) throw new Error(`${file.name || "An image"} is larger than 2 MB.`);
    const objectUrl = URL.createObjectURL(file);
    try {
      const image = new Image();
      await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error("That image could not be opened.")); image.src = objectUrl; });
      const scale = Math.min(1, 640 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff"; context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/jpeg", .72);
    } finally { URL.revokeObjectURL(objectUrl); }
  };
  const compressCreatorVariantImage = async (file) => {
    if (!file || !file.type.startsWith("image/")) throw new Error("Choose a PNG, JPEG, WebP, or AVIF variant photo.");
    if (file.size > 2 * 1024 * 1024) throw new Error(`${file.name || "An image"} is larger than 2 MB.`);
    const objectUrl = URL.createObjectURL(file);
    try {
      const image = new Image();
      await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error("That image could not be opened.")); image.src = objectUrl; });
      const sourceSize = Math.min(image.naturalWidth, image.naturalHeight);
      const sourceX = Math.max(0, Math.round((image.naturalWidth - sourceSize) / 2));
      const sourceY = Math.max(0, Math.round((image.naturalHeight - sourceSize) / 2));
      const outputSize = Math.max(1, Math.min(480, sourceSize));
      const canvas = document.createElement("canvas");
      canvas.width = outputSize; canvas.height = outputSize;
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff"; context.fillRect(0, 0, outputSize, outputSize);
      context.drawImage(image, sourceX, sourceY, sourceSize, sourceSize, 0, 0, outputSize, outputSize);
      return canvas.toDataURL("image/jpeg", .68);
    } finally { URL.revokeObjectURL(objectUrl); }
  };
  const productCreateForm = document.querySelector("[data-product-create-form]");
  if (productCreateForm) {
    const q = (selector) => productCreateForm.querySelector(selector);
    const typeInput = q("[data-product-create-type]");
    const categoryInput = productCreateForm.elements.category;
    const categoryDialog = q("[data-product-category-dialog]");
    const categorySearch = q("[data-product-category-search]");
    const categoryBrowser = q("[data-product-category-browser]");
    const categoryResults = q("[data-product-category-results]");
    const categorySuggestions = q("[data-product-category-suggestions]");
    const categoryConfirm = q("[data-product-category-confirm]");
    const productTypePicker = q("[data-product-type-picker]");
    const productTypeTrigger = q("[data-product-type-trigger]");
    const productTypeMenu = q("[data-product-type-menu]");
    const mediaInput = q("[data-product-media-input]");
    const dropzone = q("[data-product-dropzone]");
    const dropzoneTitle = q("[data-product-drop-title]");
    const dropzoneHint = q("[data-product-drop-hint]");
    const gallery = q("[data-product-media-gallery]");
    const mediaEmpty = q("[data-product-media-empty]");
    const mediaCount = q("[data-product-media-count]");
    const imageRule = q("[data-product-image-rule]");
    const errorTarget = q("[data-product-create-error]");
    const descriptionCount = q("[data-description-count]");
    const liveImage = q("[data-product-live-image]");
    const liveImageStage = q("[data-product-live-image-stage]");
    const liveThumbs = q("[data-product-live-thumbs]");
    const previewImagePrevious = q("[data-product-image-prev]");
    const previewImageNext = q("[data-product-image-next]");
    const liveVariant = q("[data-product-live-variant]");
    const variantToggle = q("[data-product-variant-toggle]");
    const variantBuilder = q("[data-product-variant-builder]");
    const noVariants = q("[data-product-no-variants]");
    const optionGroups = q("[data-product-option-groups]");
    const addOptionButton = q("[data-add-option-group]");
    const variantTable = q("[data-product-variant-table]");
    const variantEmpty = q("[data-product-variant-empty]");
    const variantRows = q("[data-product-variant-rows]");
    const basePricingCard = q("[data-product-base-pricing]");
    const filterChips = q("[data-variant-filter-chips]");
    const selectedCount = q("[data-variant-selected-count]");
    const selectAllVariants = q("[data-select-all-variants]");
    const previewViewport = q("[data-product-preview-viewport]");
    const previewCard = previewViewport?.querySelector(".product-live-card");
    const draftStatus = document.querySelector("[data-product-draft-status]");
    const saveDraftButton = document.querySelector("[data-save-product-draft]");
    const submitButtons = document.querySelectorAll('[form="product-create-form"], #product-create-form button[type="submit"]');
    const allowedImageTypes = ["image/png", "image/jpeg", "image/webp", "image/avif"];
    let selectedImages = [];
    let variants = [];
    let selectedVariantIds = new Set();
    let activeVariantFilters = new Map();
    let liveOptionSelection = {};
    let previewImageIndex = 0;
    let previewUsesVariantImage = true;
    let previewAnimationId = 0;
    let previewDevice = "desktop";
    let draggingImageId = null;
    let draftTimer = 0;
    let restoringDraft = true;
    const draftQuery = new URLSearchParams(window.location.search);
    const requestedProductId = /^custom-[a-z0-9]+$/i.test(draftQuery.get("product") || "") ? draftQuery.get("product") : "";
    const editingProduct = requestedProductId ? readCatalogProducts({ includeArchived: true }).find((product) => product.id === requestedProductId) || null : null;
    let draftId = draftQuery.get("draft") || (editingProduct ? `edit-${editingProduct.id}` : sessionStorage.getItem(activeProductDraftKey)) || `draft-${globalThis.crypto?.randomUUID?.() || Date.now()}`;
    if (draftQuery.get("new") === "1") draftId = `draft-${globalThis.crypto?.randomUUID?.() || Date.now()}`;
    sessionStorage.setItem(activeProductDraftKey, draftId);
    const editorQuery = new URLSearchParams({ page: "product-new", draft: draftId });
    if (editingProduct) editorQuery.set("product", editingProduct.id);
    history.replaceState(null, "", `?${editorQuery.toString()}`);

    const currentType = () => String(typeInput?.value || "physical");
    const typeName = (type) => ({ physical: "Physical product", digital: "Digital product", subscription: "Subscription" }[type] || "Product");
    const productTypeMeta = {
      physical: { label: "Physical product" },
      digital: { label: "Digital product" },
      subscription: { label: "Subscription" },
    };
    const setProductTypeMenu = (open) => {
      if (!productTypeMenu || !productTypeTrigger) return;
      productTypeMenu.hidden = !open; productTypeTrigger.setAttribute("aria-expanded", String(open)); productTypePicker?.classList.toggle("is-open", open);
    };
    const syncProductTypePicker = () => {
      const value = currentType(); const meta = productTypeMeta[value] || productTypeMeta.physical;
      setText("[data-product-type-value]", meta.label);
      productTypeMenu?.querySelectorAll("[data-product-type-option]").forEach((button) => button.setAttribute("aria-selected", String(button.dataset.productTypeOption === value)));
    };
    const setText = (selector, value) => { const target = q(selector); if (target) target.textContent = value; };
    const showError = (message) => { if (!errorTarget) return; errorTarget.textContent = message; errorTarget.hidden = false; errorTarget.scrollIntoView({ behavior: "smooth", block: "center" }); };
    const clearError = () => { if (!errorTarget) return; errorTarget.hidden = true; errorTarget.textContent = ""; };
    const rawOptionValues = (input) => String(input?.value || "").split(",").map((value) => value.trim()).filter(Boolean).filter((value, index, values) => values.indexOf(value) === index);
    const optionValues = (input) => rawOptionValues(input).slice(0, 30);
    const compactVariantName = (name) => { const characters = [...String(name || "")]; return characters.length > 20 ? `${characters.slice(0, 19).join("")}…` : characters.join(""); };
    const categoryCatalog = {
      physical: [
        ["Food & Beverages", [
          ["Breakfast & Pantry", [["Granola & Cereal", "granola cereal oats muesli breakfast"], ["Spreads & Honey", "honey jam spread nut butter"], ["Baking Supplies", "baking flour sugar yeast cake"]]],
          ["Beverages", [["Coffee", "coffee kopi cold brew beans concentrate"], ["Tea", "tea matcha herbal leaves"], ["Syrups & Concentrates", "syrup concentrate cordial stevia drink flavor"], ["Juice & Soft Drinks", "juice soda soft drink water"]]],
          ["Snacks", [["Chips & Crackers", "chips crisps crackers snack"], ["Nuts & Dried Fruit", "nuts dried fruit trail mix"], ["Sweets & Chocolate", "candy sweets chocolate dessert"]]],
          ["Cooking & Condiments", [["Sambal & Chili Sauce", "sambal chili sauce roa spicy condiment"], ["Sauces & Seasonings", "sauce seasoning spice salt pepper"], ["Oils & Vinegar", "oil vinegar cooking"]]],
          ["Fresh & Prepared Food", [["Bakery", "bread pastry bakery cake"], ["Ready-to-Eat Meals", "meal ready food lunch dinner"], ["Frozen Food", "frozen food meat dumpling"]]],
        ]],
        ["Beauty & Personal Care", [
          ["Skincare", [["Facial Care", "face serum cleanser moisturizer acne"], ["Body Care", "body lotion scrub care"], ["Sun Care", "sunscreen sunblock spf"]]],
          ["Hair Care", [["Shampoo & Conditioner", "shampoo conditioner hair"], ["Styling & Treatment", "hair styling treatment mask oil"]]],
          ["Makeup", [["Face Makeup", "foundation powder blush makeup"], ["Lip Makeup", "lipstick lip tint balm"], ["Eye Makeup", "mascara eyeliner eyeshadow"]]],
          ["Personal Care", [["Bath & Body", "soap bath deodorant body"], ["Oral Care", "toothpaste toothbrush mouth"], ["Fragrance", "perfume fragrance cologne"]]],
        ]],
        ["Fashion", [
          ["Women's Fashion", [["Tops", "women shirt blouse top"], ["Bottoms", "women pants skirt shorts"], ["Dresses & Modest Wear", "dress hijab modest abaya"], ["Shoes", "women shoes sandals heels"], ["Accessories", "women accessory wallet purse"]]],
          ["Men's Fashion", [["Tops", "men shirt tshirt top"], ["Bottoms", "men pants shorts"], ["Outerwear", "jacket coat outerwear"], ["Shoes", "men shoes sneakers sandals"], ["Accessories", "men accessory wallet belt"]]],
          ["Kids' Fashion", [["Clothing", "kids baby clothing"], ["Shoes", "kids shoes"], ["Accessories", "kids accessory"]]],
        ]],
        ["Home & Living", [
          ["Kitchen & Dining", [["Cookware", "pan pot cookware kitchen"], ["Drinkware", "cup mug bottle drinkware"], ["Storage & Organization", "container storage organizer"]]],
          ["Home Decor", [["Decorative Objects", "decor ornament vase candle"], ["Lighting", "lamp lighting"], ["Textiles", "rug curtain cushion textile"]]],
          ["Furniture", [["Living Room", "sofa table living furniture"], ["Bedroom", "bed mattress bedroom"], ["Office", "desk chair office"]]],
          ["Household Supplies", [["Cleaning", "cleaning mop detergent"], ["Laundry", "laundry wash"], ["Home Organization", "organizer shelf storage"]]],
        ]],
        ["Electronics", [
          ["Phones & Accessories", [["Smartphones", "phone smartphone mobile"], ["Cases & Protection", "phone case screen protector"], ["Chargers & Cables", "charger cable power bank"]]],
          ["Computers & Accessories", [["Laptops & Computers", "laptop computer pc"], ["Components & Storage", "ssd ram component drive"], ["Keyboards & Mice", "keyboard mouse peripheral"]]],
          ["Audio & Cameras", [["Headphones & Speakers", "headphone earbud speaker audio"], ["Cameras", "camera photo video"], ["Camera Accessories", "tripod lens camera accessory"]]],
          ["Home Appliances", [["Kitchen Appliances", "blender cooker kitchen appliance"], ["Cooling & Air Care", "fan air purifier cooling"], ["Cleaning Appliances", "vacuum cleaning appliance"]]],
        ]],
        ["Health & Wellness", [
          ["Nutrition", [["Vitamins & Supplements", "vitamin supplement health"], ["Healthy Foods", "healthy organic food"], ["Sports Nutrition", "protein sports nutrition"]]],
          ["Fitness", [["Exercise Equipment", "fitness gym equipment"], ["Yoga & Recovery", "yoga massage recovery"], ["Fitness Wearables", "fitness tracker wearable"]]],
          ["Personal Health", [["First Aid", "first aid medical"], ["Health Monitoring", "thermometer monitor health"], ["Mobility & Support", "support brace mobility"]]],
        ]],
        ["Baby & Kids", [["Baby Care", [["Diapers & Hygiene", "diaper baby hygiene"], ["Bath & Skincare", "baby bath skincare"]]], ["Feeding", [["Bottles & Accessories", "baby bottle feeding"], ["Baby Food", "baby food formula"]]], ["Toys & Learning", [["Learning Toys", "educational learning toy"], ["Games & Play", "game toy play"]]]]],
        ["Sports & Outdoors", [["Sports Equipment", [["Team Sports", "football basketball sports"], ["Racket Sports", "badminton tennis racket"]]], ["Outdoor & Travel", [["Camping & Hiking", "camping hiking outdoor"], ["Travel Gear", "travel luggage gear"]]], ["Sportswear", [["Activewear", "activewear sports clothing"], ["Sports Shoes", "sports shoes running"]]]]],
        ["Automotive & Motorcycles", [["Car Accessories", [["Interior Accessories", "car interior accessory"], ["Car Care", "car care wash"]]], ["Motorcycle Accessories", [["Rider Gear", "helmet rider motorcycle"], ["Motorcycle Care", "motorcycle care"]]], ["Parts & Tools", [["Replacement Parts", "vehicle replacement part"], ["Tools & Equipment", "automotive tool"]]]]],
        ["Books & Stationery", [["Books", [["Fiction", "book novel fiction"], ["Non-fiction", "book guide nonfiction"], ["Children's Books", "children kids book"]]], ["Office & School", [["Writing Supplies", "pen pencil writing"], ["Paper & Notebooks", "paper notebook journal"]]], ["Art & Craft", [["Art Supplies", "paint canvas art"], ["Craft Supplies", "craft diy"]]]]],
        ["Pet Supplies", [["Food & Treats", [["Cat Food", "cat food treat"], ["Dog Food", "dog food treat"], ["Other Pet Food", "pet food"]]], ["Care & Grooming", [["Grooming", "pet grooming"], ["Health & Hygiene", "pet health hygiene"]]], ["Pet Accessories", [["Beds & Habitats", "pet bed cage habitat"], ["Toys & Walking", "pet toy leash collar"]]]]],
      ],
      digital: [
        ["Learning & Education", [["Books & Guides", [["E-books", "ebook book guide pdf"], ["Templates & Workbooks", "workbook template planner"]]], ["Online Learning", [["Courses", "course class lesson"], ["Tutorials & Workshops", "tutorial workshop training"]]]]],
        ["Creative Assets", [["Design", [["Design Templates", "canva design template"], ["Fonts & Graphics", "font icon graphic illustration"]]], ["Photo & Video", [["Stock Photography", "photo stock image"], ["Video Assets", "video footage preset lut"]]], ["Music & Audio", [["Music & Sound", "music audio sound effect"], ["Audio Presets", "audio preset sample"]]]]],
        ["Software & Tools", [["Apps & Software", [["Business Software", "software business app"], ["Creator Tools", "creator editing tool"], ["Productivity Tools", "productivity app tool"]]], ["Licenses & Keys", [["Software Licenses", "license key software"], ["Plugins & Extensions", "plugin extension addon"]]]]],
        ["Digital Access", [["Vouchers", [["Gift Cards", "gift card voucher"], ["Service Vouchers", "service voucher coupon"]]], ["Events & Membership", [["Event Tickets", "event ticket pass"], ["Membership Access", "membership access community"]]]]],
      ],
      subscription: [
        ["Software Plans", [["Business Software", [["Commerce & Operations", "commerce operations business software"], ["Finance & Administration", "finance accounting admin software"]]], ["Creator Tools", [["Design & Editing", "design editing creator"], ["Publishing & Analytics", "publishing analytics creator"]]], ["Productivity Apps", [["Personal Productivity", "productivity task notes"], ["Team Collaboration", "team collaboration project"]]]]],
        ["Content Memberships", [["Learning", [["Courses & Coaching", "course coaching learning"], ["Resource Libraries", "resource library learning"]]], ["Communities", [["Professional Communities", "professional community"], ["Interest Communities", "membership club community"]]], ["Premium Content", [["Newsletters & Publications", "newsletter publication"], ["Video & Audio Content", "video audio podcast content"]]]]],
        ["Services & Retainers", [["Business Services", [["Consulting", "consulting advisory"], ["Marketing Services", "marketing service retainer"]]], ["Creative Services", [["Design Retainers", "design creative retainer"], ["Content Production", "content production service"]]], ["Support & Maintenance", [["Technical Support", "technical support maintenance"], ["Managed Services", "managed service"]]]]],
        ["Recurring Goods", [["Food & Beverage Boxes", [["Coffee & Tea", "coffee tea subscription box"], ["Snacks & Pantry", "snack pantry food box"]]], ["Beauty & Wellness Boxes", [["Beauty Boxes", "beauty skincare box"], ["Wellness Boxes", "wellness health box"]]], ["Other Subscription Boxes", [["Hobby Boxes", "hobby collectible box"], ["Custom Recurring Box", "custom recurring subscription box"]]]]],
      ],
    };
    const categoryPath = (parts) => parts.join(" > ");
    const categoryLeaf = (path) => String(path || "").split(" > ").at(-1) || "";
    const categoryKey = (path) => normalizeCategoryText(path).replaceAll(" ", "-");
    const categoryEntries = (type = currentType()) => (categoryCatalog[type] || []).flatMap(([department, groups]) => groups.flatMap(([group, leaves]) => leaves.map(([leaf, keywords]) => ({ department, group, leaf, path: categoryPath([department, group, leaf]), keywords }))));
    const normalizeCategoryText = (value) => String(value || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();
    let categoryPending = "";
    let categoryDepartment = "";
    let categoryGroup = "";
    const optionSnapshot = () => [...(optionGroups?.children || [])].map((row) => ({ name: String(row.querySelector("[data-option-name]")?.value || "").trim(), values: optionValues(row.querySelector("[data-option-values]")) })).filter((group) => group.name && group.values.length);
    const visibleVariants = () => variants.filter((variant) => !variant.hidden);
    const selectedPreviewVariant = () => {
      if (!variantToggle?.checked || !visibleVariants().length) return null;
      const groups = optionSnapshot();
      if (!groups.length || groups.some((group) => !group.values.includes(liveOptionSelection[group.name]))) return null;
      return visibleVariants().find((variant) => variant.options?.every((option) => liveOptionSelection[option.option] === option.value)) || null;
    };
    const selectedPreviewImageVariant = () => {
      if (!variantToggle?.checked || !visibleVariants().length) return null;
      const firstGroup = optionSnapshot()[0];
      const firstValue = firstGroup ? liveOptionSelection[firstGroup.name] : "";
      if (!firstGroup || !firstGroup.values.includes(firstValue)) return null;
      return visibleVariants().find((variant) => variant.options?.some((option) => option.option === firstGroup.name && option.value === firstValue)) || null;
    };
    const imageData = async (item) => item?.data || (item?.file ? compressCreatorProductImage(item.file) : "");
    const setDropzoneState = (state = "idle") => {
      if (!dropzone) return;
      dropzone.classList.toggle("is-dragging", state === "ready"); dropzone.classList.toggle("is-uploading", state === "uploading");
      if (dropzoneTitle) dropzoneTitle.textContent = state === "ready" ? "Release to upload" : state === "uploading" ? "Preparing your images…" : "Drop images here";
      if (dropzoneHint) dropzoneHint.textContent = state === "ready" ? "They’re ready—drop them right here" : state === "uploading" ? "Optimizing them for a fast storefront" : "or click to browse your files";
    };

    const currentCategoryEntry = () => categoryEntries().find((entry) => entry.path === String(categoryInput?.value || "").trim()) || null;
    const syncCategoryField = () => {
      const value = String(categoryInput?.value || "").trim();
      const entry = currentCategoryEntry();
      const trigger = q("[data-product-category-open]");
      const valueTarget = q("[data-product-category-value]");
      const pathTarget = q("[data-product-category-path]");
      const noteTarget = q("[data-product-category-note]");
      trigger?.classList.toggle("has-value", Boolean(value));
      trigger?.classList.toggle("is-legacy", Boolean(value && !entry));
      if (valueTarget) valueTarget.textContent = entry?.leaf || value || "Choose a category";
      if (pathTarget) pathTarget.textContent = entry ? `${entry.department} · ${entry.group}` : value ? "Current custom category" : "Search or browse the catalog";
      if (noteTarget) noteTarget.textContent = entry ? "Structured category selected." : value ? "Choose a structured category to improve discovery and product setup." : "Categories keep product discovery and filtering consistent.";
    };
    const scoreCategoryEntry = (entry) => {
      const source = normalizeCategoryText(`${productCreateForm.elements.name?.value || ""} ${productCreateForm.elements.description?.value || ""}`);
      if (!source) return 0;
      const tokens = source.split(" ").filter((token) => token.length > 2);
      const labels = normalizeCategoryText(`${entry.department} ${entry.group} ${entry.leaf}`);
      const keywords = normalizeCategoryText(entry.keywords);
      return tokens.reduce((score, token) => score + (keywords.includes(token) ? 5 : 0) + (labels.includes(token) ? 3 : 0), 0);
    };
    const suggestedCategories = () => categoryEntries().map((entry, index) => ({ entry, score: scoreCategoryEntry(entry), index })).sort((a, b) => b.score - a.score || a.index - b.index).slice(0, 3).map(({ entry }) => entry);
    const choosePendingCategory = (entry) => {
      categoryPending = entry.path; categoryDepartment = entry.department; categoryGroup = entry.group;
      renderCategoryBrowser(); renderCategorySearchResults();
    };
    const categoryChoiceButton = (entry, compact = false) => {
      const button = document.createElement("button");
      button.type = "button"; button.className = "product-category-choice";
      button.classList.toggle("selected", categoryPending === entry.path);
      button.innerHTML = `<span><b>${escapeHtml(entry.leaf)}</b><small>${escapeHtml(compact ? `${entry.department} · ${entry.group}` : entry.path.replaceAll(" > ", " · "))}</small></span><span aria-hidden="true">${categoryPending === entry.path ? "✓" : "›"}</span>`;
      button.addEventListener("click", () => choosePendingCategory(entry));
      button.addEventListener("dblclick", () => { choosePendingCategory(entry); confirmCategorySelection(); });
      return button;
    };
    const renderCategorySuggestions = () => {
      if (!categorySuggestions) return;
      const suggestions = suggestedCategories();
      const hasName = Boolean(String(productCreateForm.elements.name?.value || "").trim());
      categorySuggestions.replaceChildren();
      const header = document.createElement("header"); header.innerHTML = `<b>${hasName ? "Suggested from the product name" : `Popular for ${escapeHtml(typeName(currentType()).toLowerCase())}s`}</b><small>Choose one or browse below</small>`; categorySuggestions.append(header);
      const list = document.createElement("div"); suggestions.forEach((entry) => list.append(categoryChoiceButton(entry, true))); categorySuggestions.append(list);
    };
    function renderCategoryBrowser() {
      const roots = categoryCatalog[currentType()] || [];
      if (!roots.some(([label]) => label === categoryDepartment)) categoryDepartment = roots[0]?.[0] || "";
      const root = roots.find(([label]) => label === categoryDepartment);
      if (!root?.[1].some(([label]) => label === categoryGroup)) categoryGroup = root?.[1]?.[0]?.[0] || "";
      const group = root?.[1].find(([label]) => label === categoryGroup);
      const departmentLevel = q('[data-product-category-level="0"]');
      const groupLevel = q('[data-product-category-level="1"]');
      const leafLevel = q('[data-product-category-level="2"]');
      departmentLevel?.replaceChildren(); groupLevel?.replaceChildren(); leafLevel?.replaceChildren();
      roots.forEach(([label]) => {
        const button = document.createElement("button"); button.type = "button"; button.classList.toggle("active", label === categoryDepartment); button.innerHTML = `<span>${escapeHtml(label)}</span><span aria-hidden="true">›</span>`;
        button.addEventListener("click", () => { categoryDepartment = label; categoryGroup = ""; renderCategoryBrowser(); }); departmentLevel?.append(button);
      });
      (root?.[1] || []).forEach(([label]) => {
        const button = document.createElement("button"); button.type = "button"; button.classList.toggle("active", label === categoryGroup); button.innerHTML = `<span>${escapeHtml(label)}</span><span aria-hidden="true">›</span>`;
        button.addEventListener("click", () => { categoryGroup = label; renderCategoryBrowser(); }); groupLevel?.append(button);
      });
      (group?.[1] || []).forEach(([leaf]) => {
        const entry = { department: categoryDepartment, group: categoryGroup, leaf, path: categoryPath([categoryDepartment, categoryGroup, leaf]) };
        const button = document.createElement("button"); button.type = "button"; button.classList.toggle("selected", entry.path === categoryPending); button.innerHTML = `<span>${escapeHtml(leaf)}</span><span aria-hidden="true">${entry.path === categoryPending ? "✓" : ""}</span>`;
        button.addEventListener("click", () => choosePendingCategory(entry)); button.addEventListener("dblclick", () => { choosePendingCategory(entry); confirmCategorySelection(); }); leafLevel?.append(button);
      });
      const selection = q("[data-product-category-selection]"); if (selection) selection.textContent = categoryPending || "Nothing selected yet";
      if (categoryConfirm) categoryConfirm.disabled = !categoryPending;
    }
    function renderCategorySearchResults() {
      if (!categorySearch || !categoryResults || !categoryBrowser || !categorySuggestions) return;
      const query = normalizeCategoryText(categorySearch.value);
      const searching = Boolean(query);
      categoryResults.hidden = !searching; categoryBrowser.hidden = searching; categorySuggestions.hidden = searching;
      if (!searching) { categoryResults.replaceChildren(); return; }
      const matches = categoryEntries().filter((entry) => normalizeCategoryText(`${entry.path} ${entry.keywords}`).includes(query) || query.split(" ").every((token) => normalizeCategoryText(`${entry.path} ${entry.keywords}`).includes(token))).slice(0, 12);
      categoryResults.replaceChildren();
      if (!matches.length) { const empty = document.createElement("div"); empty.className = "product-category-empty"; empty.innerHTML = `<b>No category matches “${escapeHtml(categorySearch.value.trim())}”</b><span>Try a broader product word, such as coffee, clothing, or software.</span>`; categoryResults.append(empty); return; }
      const header = document.createElement("header"); header.innerHTML = `<b>${matches.length} matching categor${matches.length === 1 ? "y" : "ies"}</b><small>Searches the full category path</small>`; categoryResults.append(header);
      const list = document.createElement("div"); matches.forEach((entry) => list.append(categoryChoiceButton(entry))); categoryResults.append(list);
    }
    const openCategoryDialog = () => {
      if (!categoryDialog) return;
      const current = currentCategoryEntry(); const suggestion = suggestedCategories()[0];
      categoryPending = current?.path || ""; categoryDepartment = current?.department || suggestion?.department || ""; categoryGroup = current?.group || suggestion?.group || "";
      if (categorySearch) categorySearch.value = "";
      renderCategorySuggestions(); renderCategoryBrowser(); renderCategorySearchResults();
      categoryDialog.hidden = false; document.documentElement.classList.add("category-dialog-open"); window.setTimeout(() => categorySearch?.focus(), 30);
    };
    const closeCategoryDialog = () => { if (categoryDialog) categoryDialog.hidden = true; document.documentElement.classList.remove("category-dialog-open"); q("[data-product-category-open]")?.focus(); };
    function confirmCategorySelection() {
      if (!categoryPending || !categoryInput) return;
      categoryInput.value = categoryPending; syncCategoryField(); clearError(); closeCategoryDialog();
      categoryInput.dispatchEvent(new Event("input", { bubbles: true }));
    }
    q("[data-product-category-open]")?.addEventListener("click", openCategoryDialog);
    q("[data-product-category-confirm]")?.addEventListener("click", confirmCategorySelection);
    q("[data-product-category-dialog]")?.querySelectorAll("[data-product-category-close]").forEach((button) => button.addEventListener("click", closeCategoryDialog));
    categorySearch?.addEventListener("input", renderCategorySearchResults);
    document.addEventListener("keydown", (event) => { if (event.key === "Escape" && categoryDialog && !categoryDialog.hidden) closeCategoryDialog(); });
    productTypeTrigger?.addEventListener("click", () => {
      const opening = Boolean(productTypeMenu?.hidden); setProductTypeMenu(opening);
      if (opening) window.setTimeout(() => productTypeMenu?.querySelector('[aria-selected="true"]')?.focus(), 0);
    });
    productTypeMenu?.querySelectorAll("[data-product-type-option]").forEach((button) => button.addEventListener("click", () => {
      if (!typeInput) return;
      typeInput.value = button.dataset.productTypeOption || "physical"; setProductTypeMenu(false); syncProductTypePicker(); typeInput.dispatchEvent(new Event("change", { bubbles: true })); productTypeTrigger?.focus();
    }));
    productTypeMenu?.addEventListener("keydown", (event) => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); const options = [...productTypeMenu.querySelectorAll("[data-product-type-option]")]; const index = options.indexOf(document.activeElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length; options[next]?.focus();
    });
    productTypeTrigger?.addEventListener("keydown", (event) => { if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return; event.preventDefault(); setProductTypeMenu(true); const options = [...productTypeMenu.querySelectorAll("[data-product-type-option]")]; (event.key === "ArrowDown" ? options[0] : options.at(-1))?.focus(); });
    document.addEventListener("pointerdown", (event) => { if (productTypePicker && !productTypePicker.contains(event.target)) setProductTypeMenu(false); });
    document.addEventListener("keydown", (event) => { if (event.key === "Escape" && productTypeMenu && !productTypeMenu.hidden) { setProductTypeMenu(false); productTypeTrigger?.focus(); } });

    const previewAvailability = (selectedVariant) => {
      const type = currentType();
      if (type === "digital") return "Available immediately after payment";
      if (type === "subscription") {
        const interval = Math.max(1, Math.round(Number(selectedVariant?.billingInterval ?? productCreateForm.elements.interval?.value) || 1));
        const unit = String(selectedVariant?.billingUnit || productCreateForm.elements.unit?.value || "month");
        return `Billed every ${interval} ${unit}${interval === 1 ? "" : "s"}`;
      }
      const stock = selectedVariant ? selectedVariant.stock : productCreateForm.elements.stock?.value;
      return `Stock: ${Math.max(0, Math.round(Number(stock) || 0))}`;
    };
    const updatePreview = (imageDirection = 0, swipeOffset = 0) => {
      const selectedVariant = selectedPreviewVariant();
      const selectedImageVariant = selectedPreviewImageVariant();
      const name = String(productCreateForm.elements.name?.value || "").trim();
      const category = String(productCreateForm.elements.category?.value || "").trim();
      const description = String(productCreateForm.elements.description?.value || "").trim();
      const price = selectedVariant ? selectedVariant.price : productCreateForm.elements.price?.value;
      setText("[data-product-live-name]", name || "Your product name");
      setText("[data-product-live-category]", categoryLeaf(category) || "Product category");
      setText("[data-product-live-description]", description || "Add a clear description so customers immediately understand what they are buying.");
      setText("[data-product-live-price]", formatCreatorPrice(Math.max(0, Math.round(Number(price) || 0))));
      setText("[data-product-live-type]", typeName(currentType()));
      setText("[data-product-live-availability]", previewAvailability(selectedVariant));
      if (descriptionCount) descriptionCount.textContent = String(productCreateForm.elements.description?.value.length || 0);
      const useCustom = Boolean(previewUsesVariantImage && selectedImageVariant?.useCustomImage && selectedImageVariant.customImage?.url);
      const variantIndex = previewUsesVariantImage && selectedImageVariant && Number.isInteger(selectedImageVariant.imageIndex) ? selectedImageVariant.imageIndex : previewImageIndex;
      const source = useCustom ? selectedImageVariant.customImage.url : selectedImages[variantIndex]?.url || selectedImages[0]?.url || "";
      if (liveImage) {
        const animationId = ++previewAnimationId;
        const existingImages = [...liveImage.querySelectorAll(":scope > img")]; const previous = existingImages.at(-1) || null;
        liveImage.getAnimations({ subtree: true }).forEach((animation) => animation.cancel());
        if (previous && existingImages.length > 1) liveImage.replaceChildren(previous);
        if (source) {
          const image = document.createElement("img"); image.src = source; image.alt = name || "Product preview"; image.draggable = false;
          if (imageDirection && previous) {
            liveImage.querySelector("span")?.remove(); image.className = "product-live-image-incoming"; liveImage.append(image);
            const outgoing = previous.animate([{ transform: `translateX(${swipeOffset}px)` }, { transform: `translateX(${-imageDirection * 105}%)` }], { duration: 280, easing: "cubic-bezier(.22,.78,.2,1)", fill: "forwards" });
            image.animate([{ transform: `translateX(${imageDirection * 105}%)` }, { transform: "translateX(0)" }], { duration: 280, easing: "cubic-bezier(.22,.78,.2,1)", fill: "forwards" });
            outgoing.finished.catch(() => {}).then(() => { if (previewAnimationId !== animationId || !image.isConnected) return; image.className = ""; liveImage.replaceChildren(image); });
          } else { liveImage.replaceChildren(image); }
        } else liveImage.innerHTML = '<span><svg class="icon" aria-hidden="true"><use href="#icon-image"></use></svg><small>Your square main image</small></span>';
      }
      liveThumbs?.querySelectorAll("button").forEach((thumb, index) => thumb.classList.toggle("active", !useCustom && index === variantIndex));
      const canNavigateImages = selectedImages.length > 1;
      if (previewImagePrevious) previewImagePrevious.hidden = !canNavigateImages;
      if (previewImageNext) previewImageNext.hidden = !canNavigateImages;
    };
    const navigatePreviewImage = (direction, swipeOffset = 0) => {
      if (selectedImages.length < 2) return;
      previewUsesVariantImage = false;
      previewImageIndex = (previewImageIndex + direction + selectedImages.length) % selectedImages.length;
      updatePreview(direction, swipeOffset);
    };

    const syncLiveVariants = () => {
      if (!liveVariant) return;
      const groups = optionSnapshot();
      const storefrontVariants = visibleVariants();
      const show = Boolean(variantToggle?.checked && storefrontVariants.length && groups.length);
      liveVariant.hidden = !show;
      liveVariant.replaceChildren();
      if (!show) { updatePreview(); return; }
      const availableValuesFor = (targetGroup) => new Set(storefrontVariants.filter((variant) => groups.every((group) => {
        if (group.name === targetGroup.name) return true;
        const selectedValue = liveOptionSelection[group.name];
        return !selectedValue || variant.options?.some((option) => option.option === group.name && option.value === selectedValue);
      })).map((variant) => variant.options?.find((option) => option.option === targetGroup.name)?.value).filter(Boolean));
      groups.forEach((group) => {
        if (!group.values.includes(liveOptionSelection[group.name]) || !availableValuesFor(group).has(liveOptionSelection[group.name])) delete liveOptionSelection[group.name];
      });
      groups.forEach((group) => {
        const available = availableValuesFor(group);
        const visibleValues = group.values.filter((value) => available.has(value));
        const section = document.createElement("section");
        section.innerHTML = `<span>${escapeHtml(group.name)}</span><div>${visibleValues.map((value) => `<button type="button" class="${liveOptionSelection[group.name] === value ? "active" : ""}" data-live-option-name="${escapeHtml(group.name)}" data-live-option-value="${escapeHtml(value)}">${escapeHtml(value)}</button>`).join("")}</div>`;
        section.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => { liveOptionSelection[button.dataset.liveOptionName] = button.dataset.liveOptionValue; previewUsesVariantImage = true; syncLiveVariants(); }));
        liveVariant.append(section);
      });
      updatePreview();
    };

    const markDraftChanged = () => {
      if (restoringDraft) return;
      if (draftStatus) { draftStatus.classList.add("is-saving"); draftStatus.innerHTML = "<i></i> Saving draft…"; }
      window.clearTimeout(draftTimer);
      draftTimer = window.setTimeout(() => saveDraft(false), 550);
    };
    const draftSnapshot = () => ({
      id: draftId,
      productId: editingProduct && cloudCatalogProducts.some((product) => product.id === editingProduct.id) ? editingProduct.id : null,
      name: String(productCreateForm.elements.name?.value || "").trim(),
      updatedAt: new Date().toISOString(),
      fields: {
        type: currentType(), category: String(productCreateForm.elements.category?.value || ""), description: String(productCreateForm.elements.description?.value || ""),
        price: String(productCreateForm.elements.price?.value || ""), stock: String(productCreateForm.elements.stock?.value || ""), weight: String(productCreateForm.elements.weight?.value || ""),
        digital_name: String(productCreateForm.elements.digital_name?.value || ""), interval: String(productCreateForm.elements.interval?.value || "1"), unit: String(productCreateForm.elements.unit?.value || "month"),
      },
      images: selectedImages.map((item) => ({ id: item.id, cloudId: item.cloudId || null, data: item.cloudId ? undefined : item.data || item.url })),
      hasVariants: Boolean(variantToggle?.checked), options: optionSnapshot(),
      variants: variants.map((variant) => ({ ...variant, customImage: variant.customImage ? { cloudId: variant.customImage.cloudId || null, data: variant.customImage.cloudId ? undefined : variant.customImage.data || variant.customImage.url } : null })),
      previewDevice,
    });
    const ensureEditorMediaCloud = async () => {
      if (!cloudEnabled) return;
      for (const image of selectedImages) {
        if (image.cloudId) continue;
        const source = image.data || image.url;
        if (!String(source || "").startsWith("data:image/")) throw new Error("A product image could not be prepared for upload.");
        image.cloudId = (await uploadCloudImage(source)).id;
      }
      for (const variant of variants) {
        if (!variant.useCustomImage || !variant.customImage || variant.customImage.cloudId) continue;
        const source = variant.customImage.data || variant.customImage.url;
        if (!String(source || "").startsWith("data:image/")) throw new Error(`A ${currentType() === "subscription" ? "plan" : "variant"} image could not be prepared for upload.`);
        variant.customImage.cloudId = (await uploadCloudImage(source)).id;
      }
    };
    let draftSavePromise = Promise.resolve();
    const saveDraft = (announce = true) => {
      window.clearTimeout(draftTimer);
      draftSavePromise = draftSavePromise.then(async () => {
        await ensureEditorMediaCloud();
        const snapshot = draftSnapshot();
        if (cloudEnabled) await saveCloudDraft(snapshot);
        else {
          const drafts = readLocalProductDrafts();
          const index = drafts.findIndex((draft) => draft.id === draftId);
          if (index >= 0) drafts[index] = snapshot; else drafts.push(snapshot);
          if (!writeProductDrafts(drafts)) throw new Error("Draft storage is full.");
        }
        if (draftStatus) { draftStatus.classList.remove("is-saving"); draftStatus.innerHTML = "<i></i> Saved"; }
        if (announce) showToast("Product draft saved");
      }).catch((error) => {
        if (draftStatus) { draftStatus.classList.remove("is-saving"); draftStatus.innerHTML = "<i></i> Save needs attention"; }
        showError(error instanceof Error ? error.message : "The draft could not be saved.");
      });
      return draftSavePromise;
    };

    const syncOptionGroupLimit = () => {
      if (!addOptionButton || !optionGroups) return;
      const full = optionGroups.children.length >= 3;
      addOptionButton.disabled = full;
      addOptionButton.title = full ? "Products can have up to 3 option groups" : "Add another option group";
    };
    const updateOptionValueCount = (row) => {
      const count = rawOptionValues(row.querySelector("[data-option-values]")).length;
      const target = row.querySelector("[data-option-value-count]");
      if (target) target.textContent = `${Math.min(count, 30)}/30 values`;
      row.classList.toggle("is-over-limit", count > 30);
    };
    const addOptionGroup = (name = "", values = "") => {
      if (!optionGroups || optionGroups.children.length >= 3) return;
      const first = optionGroups.children.length === 0;
      const row = document.createElement("div"); row.className = "product-option-group";
      row.innerHTML = `<label><span>Option name</span><input type="text" maxlength="20" placeholder="${first ? "Flavor" : "Size"}" value="${escapeHtml(name)}" data-option-name></label><label><span>Values <small data-option-value-count>0/30 values</small></span><input type="text" maxlength="1800" placeholder="${first ? "Peach, Original" : "50 ml, 250 ml"}" value="${escapeHtml(values)}" data-option-values></label><button type="button" aria-label="Remove option group">×</button>`;
      row.querySelector("[data-option-values]").addEventListener("input", () => updateOptionValueCount(row));
      row.querySelector("button").addEventListener("click", () => { row.remove(); variants = []; selectedVariantIds.clear(); activeVariantFilters.clear(); renderVariants(); syncOptionGroupLimit(); markDraftChanged(); });
      optionGroups.append(row);
      updateOptionValueCount(row);
      syncOptionGroupLimit();
    };

    const variantMatchesFilters = (variant) => [...activeVariantFilters].every(([optionName, optionValue]) => variant.options?.some((option) => option.option === optionName && option.value === optionValue));
    const selectFilteredVariants = () => {
      selectedVariantIds = activeVariantFilters.size ? new Set(visibleVariants().filter(variantMatchesFilters).map((variant) => variant.id)) : new Set();
      updateVariantSelection();
    };
    const updateVariantSelection = () => {
      variantRows?.querySelectorAll(".product-variant-row").forEach((row) => {
        const selected = selectedVariantIds.has(row.dataset.variantId);
        row.classList.toggle("selected", selected);
        const checkbox = row.querySelector("[data-variant-select]"); if (checkbox) checkbox.checked = selected;
      });
      variantRows?.querySelectorAll("[data-variant-group]").forEach((group) => {
        const ids = [...group.querySelectorAll(".product-variant-row:not(.is-hidden)")].map((row) => row.dataset.variantId).filter(Boolean);
        const selectedInGroup = ids.filter((id) => selectedVariantIds.has(id)).length;
        const checkbox = group.querySelector("[data-variant-group-select]");
        if (checkbox) {
          checkbox.checked = ids.length > 0 && selectedInGroup === ids.length;
          checkbox.indeterminate = selectedInGroup > 0 && selectedInGroup < ids.length;
        }
        group.classList.toggle("selected", ids.length > 0 && selectedInGroup === ids.length);
      });
      if (selectedCount) {
        const filterLabel = [...activeVariantFilters.values()].join(" · ");
        selectedCount.textContent = filterLabel ? `${filterLabel} · ${selectedVariantIds.size} selected` : `${selectedVariantIds.size} selected`;
      }
      const selectableVariants = visibleVariants();
      if (selectAllVariants) { selectAllVariants.checked = selectableVariants.length > 0 && selectedVariantIds.size === selectableVariants.length; selectAllVariants.indeterminate = selectedVariantIds.size > 0 && selectedVariantIds.size < selectableVariants.length; }
      filterChips?.querySelectorAll("button").forEach((chip) => {
        chip.classList.toggle("active", activeVariantFilters.get(chip.dataset.optionName) === chip.dataset.optionValue);
      });
    };
    const renderVariantFilters = () => {
      if (!filterChips) return;
      filterChips.replaceChildren();
      const groups = optionSnapshot();
      const validFilters = new Map(groups.map((group) => [group.name, new Set(group.values)]));
      activeVariantFilters = new Map([...activeVariantFilters].filter(([optionName, optionValue]) => validFilters.get(optionName)?.has(optionValue)));
      groups.forEach((group) => {
        const section = document.createElement("section");
        section.innerHTML = `<span>${escapeHtml(group.name)}</span><div>${group.values.map((value) => `<button type="button" data-option-name="${escapeHtml(group.name)}" data-option-value="${escapeHtml(value)}">${escapeHtml(value)}</button>`).join("")}</div>`;
        section.querySelectorAll("button").forEach((chip) => chip.addEventListener("click", () => {
          const optionName = chip.dataset.optionName;
          const optionValue = chip.dataset.optionValue;
          if (activeVariantFilters.get(optionName) === optionValue) activeVariantFilters.delete(optionName);
          else activeVariantFilters.set(optionName, optionValue);
          selectFilteredVariants();
        }));
        filterChips.append(section);
      });
    };
    const firstOptionMatches = (value) => {
      const group = optionSnapshot()[0];
      if (!group) return [];
      return variants.filter((variant) => variant.options?.some((option) => option.option === group.name && option.value === value));
    };
    const normalizeFirstOptionImages = () => {
      const group = optionSnapshot()[0];
      if (!group) return;
      group.values.forEach((value) => {
        const matches = firstOptionMatches(value);
        const source = matches.find((variant) => variant.useCustomImage && variant.customImage) || matches.find((variant) => Number.isInteger(variant.imageIndex)) || matches[0];
        if (!source) return;
        const customImage = source.useCustomImage && source.customImage ? source.customImage : null;
        const imageIndex = Number.isInteger(source.imageIndex) ? source.imageIndex : null;
        matches.forEach((variant) => { variant.customImage = customImage; variant.useCustomImage = Boolean(customImage); variant.imageIndex = imageIndex; });
      });
    };
    const setFirstOptionImage = (value, { customImage = null, imageIndex = null } = {}) => {
      firstOptionMatches(value).forEach((variant) => {
        variant.customImage = customImage;
        variant.useCustomImage = Boolean(customImage);
        variant.imageIndex = Number.isInteger(imageIndex) ? imageIndex : null;
      });
    };
    const variantImageSource = (variant) => variant?.useCustomImage && variant.customImage?.url
      ? variant.customImage.url
      : Number.isInteger(variant?.imageIndex)
        ? selectedImages[variant.imageIndex]?.url
        : selectedImages[0]?.url;
    const firstOptionPhotoMarkup = (variant) => {
      const currentSource = variantImageSource(variant);
      const choices = selectedImages.length ? selectedImages.map((image, index) => `<button type="button" data-main-image-index="${index}"><img src="${escapeHtml(image.url)}" alt=""><span>${index === 0 ? "Main image" : `Image ${index + 1}`}</span></button>`).join("") : '<p>Upload main images first.</p>';
      return `<div class="product-variant-photo"><div class="product-variant-photo-source"><label class="product-variant-upload" data-variant-photo-dropzone aria-label="Upload or drop an option image"><input type="file" accept="image/png,image/jpeg,image/webp,image/avif" data-variant-photo-input><span>${currentSource ? `<img src="${escapeHtml(currentSource)}" alt=""><b>${variant?.useCustomImage ? "Replace" : "Upload"}</b>` : '<svg class="icon" aria-hidden="true"><use href="#icon-image"></use></svg><b>Upload</b>'}</span></label><details class="product-variant-main-picker"><summary aria-label="Choose a photo from main images"><svg class="icon" aria-hidden="true"><use href="#icon-chevron-down"></use></svg></summary><div>${choices}</div></details></div>${variant?.useCustomImage ? '<button type="button" data-variant-photo-clear aria-label="Remove option upload">×</button>' : ""}</div>`;
    };
    const applyFirstOptionPhoto = async (value, file, dropTarget) => {
      if (!file) return;
      if (!allowedImageTypes.includes(file.type) || file.size > 2 * 1024 * 1024) {
        showError("Option photos must be PNG, JPG, WebP, or AVIF and no larger than 2 MB.");
        return;
      }
      dropTarget?.classList.remove("is-drop-ready");
      dropTarget?.classList.add("is-uploading");
      try {
        const data = await compressCreatorVariantImage(file);
        setFirstOptionImage(value, { customImage: { data, url: data } });
        clearError(); renderVariants(); markDraftChanged();
      } catch (error) {
        dropTarget?.classList.remove("is-uploading");
        showError(error instanceof Error ? error.message : "That option image could not be added.");
      }
    };
    const bindFirstOptionPhotoControls = (container, value) => {
      container.querySelectorAll("[data-main-image-index]").forEach((button) => button.addEventListener("click", () => {
        setFirstOptionImage(value, { imageIndex: Number(button.dataset.mainImageIndex) });
        button.closest("details").open = false; renderVariants(); markDraftChanged();
      }));
      const input = container.querySelector("[data-variant-photo-input]");
      const dropzone = container.querySelector("[data-variant-photo-dropzone]");
      input?.addEventListener("change", async (event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) await applyFirstOptionPhoto(value, file, dropzone); });
      if (dropzone) {
        let dragDepth = 0;
        dropzone.addEventListener("dragenter", (event) => { if (![...(event.dataTransfer?.types || [])].includes("Files")) return; event.preventDefault(); event.stopPropagation(); dragDepth += 1; dropzone.classList.add("is-drop-ready"); });
        dropzone.addEventListener("dragover", (event) => { if (![...(event.dataTransfer?.types || [])].includes("Files")) return; event.preventDefault(); event.stopPropagation(); if (event.dataTransfer) event.dataTransfer.dropEffect = "copy"; dropzone.classList.add("is-drop-ready"); });
        dropzone.addEventListener("dragleave", (event) => { event.preventDefault(); event.stopPropagation(); dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) dropzone.classList.remove("is-drop-ready"); });
        dropzone.addEventListener("drop", (event) => { event.preventDefault(); event.stopPropagation(); dragDepth = 0; dropzone.classList.remove("is-drop-ready"); const file = event.dataTransfer?.files?.[0]; if (file) void applyFirstOptionPhoto(value, file, dropzone); });
      }
      container.querySelector("[data-variant-photo-clear]")?.addEventListener("click", () => { setFirstOptionImage(value); renderVariants(); markDraftChanged(); });
    };
    const renderVariants = () => {
      normalizeFirstOptionImages();
      if (variantTable) variantTable.hidden = variants.length === 0;
      variantTable?.classList.toggle("is-physical", currentType() === "physical");
      variantTable?.classList.toggle("is-digital", currentType() === "digital");
      variantTable?.classList.toggle("is-subscription", currentType() === "subscription");
      if (variantEmpty) variantEmpty.hidden = variants.length > 0;
      if (!variantRows) return;
      selectedVariantIds = new Set([...selectedVariantIds].filter((id) => variants.some((variant) => variant.id === id && !variant.hidden)));
      variantRows.replaceChildren();
      const optionGroupsSnapshot = optionSnapshot();
      const firstGroup = optionGroupsSnapshot[0];
      const remainingGroups = optionGroupsSnapshot.slice(1);
      const variantFirstValue = (variant) => variant.options?.find((option) => option.option === firstGroup?.name)?.value || variant.options?.[0]?.value || "Other";
      const variantChildName = (variant) => {
        const values = remainingGroups.map((group) => variant.options?.find((option) => option.option === group.name)?.value).filter(Boolean);
        return values.length ? values.join(" · ") : variantFirstValue(variant);
      };
      const groupedVariants = new Map();
      (firstGroup?.values || []).forEach((value) => groupedVariants.set(value, []));
      variants.forEach((variant) => {
        const value = variantFirstValue(variant);
        if (!groupedVariants.has(value)) groupedVariants.set(value, []);
        groupedVariants.get(value).push(variant);
      });
      const attachVariantRow = (variant, groupRows) => {
        const physical = currentType() === "physical";
        const subscription = currentType() === "subscription";
        const row = document.createElement("div"); row.className = `product-variant-row${variant.hidden ? " is-hidden" : ""}`; row.dataset.variantId = variant.id;
        const billingUnit = ["month", "year"].includes(variant.billingUnit) ? variant.billingUnit : "month";
        const billingMaximum = billingUnit === "year" ? 10 : 120;
        const billingInterval = Math.max(1, Math.min(billingMaximum, Math.round(Number(variant.billingInterval) || 1)));
        row.innerHTML = `<label class="product-variant-subvariant" title="${escapeHtml(variant.name)}"><input type="checkbox" data-variant-select aria-label="Select ${escapeHtml(variant.name)}"><b>${escapeHtml(compactVariantName(variantChildName(variant)))}</b></label><label><span>Price</span><input type="number" min="1000" step="500" value="${variant.price}" data-variant-price></label><label ${physical ? "" : "hidden"}><span>Stock</span><input type="number" min="0" max="999999" value="${variant.stock}" data-variant-stock></label><label ${physical ? "" : "hidden"}><span>Weight</span><input type="number" min="1" max="50000" value="${variant.weightGrams || 500}" data-variant-weight></label><label class="product-variant-billing" ${subscription ? "" : "hidden"}><span>Billing</span><span><input type="number" min="1" max="${billingMaximum}" value="${billingInterval}" aria-label="Billing interval" data-variant-billing-interval><select aria-label="Billing period" data-variant-billing-unit><option value="month" ${billingUnit === "month" ? "selected" : ""}>Month</option><option value="year" ${billingUnit === "year" ? "selected" : ""}>Year</option></select></span></label><label><span>SKU</span><input type="text" maxlength="48" value="${escapeHtml(variant.sku)}" data-variant-sku></label><button type="button" data-variant-visibility aria-label="${variant.hidden ? "Show" : "Hide"} ${escapeHtml(variant.name)}" title="${variant.hidden ? "Show variant" : "Hide variant"}"><svg class="icon" aria-hidden="true"><use href="#icon-${variant.hidden ? "eye-off" : "eye"}"></use></svg></button>`;
        if (variant.hidden) row.querySelectorAll("input, select").forEach((control) => { control.disabled = true; });
        row.querySelector("[data-variant-select]").addEventListener("change", (event) => { activeVariantFilters.clear(); event.target.checked ? selectedVariantIds.add(variant.id) : selectedVariantIds.delete(variant.id); updateVariantSelection(); });
        row.querySelector("[data-variant-price]").addEventListener("input", (event) => { variant.price = Math.max(0, Math.round(Number(event.target.value) || 0)); updatePreview(); markDraftChanged(); });
        row.querySelector("[data-variant-stock]").addEventListener("input", (event) => { variant.stock = Math.max(0, Math.round(Number(event.target.value) || 0)); updatePreview(); markDraftChanged(); });
        row.querySelector("[data-variant-weight]").addEventListener("input", (event) => { variant.weightGrams = Math.max(0, Math.round(Number(event.target.value) || 0)); markDraftChanged(); });
        row.querySelector("[data-variant-billing-interval]")?.addEventListener("input", (event) => { const maximum = variant.billingUnit === "year" ? 10 : 120; variant.billingInterval = Math.max(1, Math.min(maximum, Math.round(Number(event.target.value) || 1))); updatePreview(); markDraftChanged(); });
        row.querySelector("[data-variant-billing-unit]")?.addEventListener("change", (event) => { variant.billingUnit = event.target.value; variant.billingInterval = Math.min(variant.billingInterval || 1, variant.billingUnit === "year" ? 10 : 120); renderVariants(); markDraftChanged(); });
        row.querySelector("[data-variant-sku]").addEventListener("input", (event) => { variant.sku = event.target.value.trim(); markDraftChanged(); });
        row.querySelector("[data-variant-visibility]").addEventListener("click", () => {
          variant.hidden = !variant.hidden;
          selectedVariantIds.delete(variant.id);
          renderVariants(); markDraftChanged();
        });
        groupRows.append(row);
      };
      groupedVariants.forEach((groupVariants, groupValue) => {
        if (!groupVariants.length) return;
        const group = document.createElement("section");
        group.className = "product-variant-group";
        group.dataset.variantGroup = groupValue;
        const groupCell = document.createElement("div");
        groupCell.className = "product-variant-group-cell";
        const groupItemLabel = currentType() === "subscription" ? "plan" : "variant";
        groupCell.innerHTML = `<input type="checkbox" data-variant-group-select aria-label="Select all ${escapeHtml(groupValue)} combinations">${firstOptionPhotoMarkup(groupVariants[0])}<span class="product-variant-group-copy"><span class="product-variant-group-name"><b title="${escapeHtml(groupValue)}">${escapeHtml(groupValue)}</b><button type="button" class="product-variant-group-remove" data-variant-group-remove aria-label="Delete ${escapeHtml(groupValue)} and its ${groupVariants.length} ${groupItemLabel}${groupVariants.length === 1 ? "" : "s"}"><svg class="icon" aria-hidden="true"><use href="#icon-trash"></use></svg></button></span></span>`;
        const groupRows = document.createElement("div");
        groupRows.className = "product-variant-group-rows";
        groupVariants.forEach((variant) => attachVariantRow(variant, groupRows));
        groupCell.querySelector("[data-variant-group-select]").addEventListener("change", (event) => {
          activeVariantFilters.clear();
          groupVariants.filter((variant) => !variant.hidden).forEach((variant) => event.target.checked ? selectedVariantIds.add(variant.id) : selectedVariantIds.delete(variant.id));
          updateVariantSelection();
        });
        groupCell.querySelector("[data-variant-group-remove]").addEventListener("click", () => {
          if (!window.confirm(`Delete “${groupValue}” and its ${groupVariants.length} ${groupItemLabel}${groupVariants.length === 1 ? "" : "s"}?`)) return;
          const firstGroupRow = optionGroups?.firstElementChild;
          const valuesInput = firstGroupRow?.querySelector("[data-option-values]");
          const remainingValues = rawOptionValues(valuesInput).filter((value) => value.localeCompare(groupValue, undefined, { sensitivity: "base" }) !== 0);
          if (valuesInput) valuesInput.value = remainingValues.join(", ");
          const removedVariantIds = new Set(groupVariants.map((variant) => variant.id));
          variants = variants.filter((variant) => !removedVariantIds.has(variant.id));
          groupVariants.forEach((variant) => selectedVariantIds.delete(variant.id));
          activeVariantFilters.delete(firstGroup?.name);
          if (firstGroup && liveOptionSelection[firstGroup.name] === groupValue) delete liveOptionSelection[firstGroup.name];
          if (firstGroupRow) updateOptionValueCount(firstGroupRow);
          renderVariants(); markDraftChanged(); showToast(`${groupValue} deleted`);
        });
        bindFirstOptionPhotoControls(groupCell, groupValue);
        group.append(groupCell, groupRows);
        variantRows.append(group);
      });
      if (firstGroup && firstGroup.values.length < 30) {
        const addGroup = document.createElement("section");
        addGroup.className = "product-variant-add-group";
        const singularName = firstGroup.name.replace(/s$/i, "") || "option";
        addGroup.innerHTML = `<button type="button" data-add-group-value><span>+</span> Add ${escapeHtml(singularName.toLowerCase())}</button>`;
        addGroup.querySelector("button").addEventListener("click", () => {
          addGroup.innerHTML = `<div class="product-variant-add-form" role="group" aria-label="Add ${escapeHtml(singularName.toLowerCase())}"><label><span>New ${escapeHtml(singularName.toLowerCase())}</span><input type="text" maxlength="60" autocomplete="off" placeholder="Enter a name"></label><div><button type="button" data-confirm-group-add>Add ${escapeHtml(singularName.toLowerCase())}</button><button type="button" data-cancel-group-add>Cancel</button></div></div>`;
          const editor = addGroup.querySelector(".product-variant-add-form");
          const input = editor.querySelector("input");
          input.focus();
          const addValue = () => {
            const value = input.value.trim();
            const valuesInput = optionGroups?.firstElementChild?.querySelector("[data-option-values]");
            const currentValues = rawOptionValues(valuesInput);
            if (!value) { input.focus(); return; }
            if (currentValues.some((item) => item.localeCompare(value, undefined, { sensitivity: "base" }) === 0)) { showError(`${value} is already in ${firstGroup.name}.`); return; }
            valuesInput.value = [...currentValues, value].join(", ");
            updateOptionValueCount(optionGroups.firstElementChild);
            generateVariants();
          };
          editor.querySelector("[data-confirm-group-add]").addEventListener("click", addValue);
          editor.querySelector("[data-cancel-group-add]").addEventListener("click", renderVariants);
          input.addEventListener("keydown", (event) => {
            if (event.key === "Enter") { event.preventDefault(); addValue(); }
            if (event.key === "Escape") { event.preventDefault(); renderVariants(); }
          });
        });
        variantRows.append(addGroup);
      }
      setText("[data-variant-group-heading]", firstGroup?.name || (currentType() === "subscription" ? "Plan" : "Option"));
      setText("[data-variant-column-title]", remainingGroups.map((group) => group.name).join(" / ") || (currentType() === "subscription" ? "Plan details" : "Variant details"));
      q("[data-variant-stock-heading]")?.toggleAttribute("hidden", currentType() !== "physical");
      q("[data-variant-weight-heading]")?.toggleAttribute("hidden", currentType() !== "physical");
      q("[data-variant-billing-heading]")?.toggleAttribute("hidden", currentType() !== "subscription");
      q("[data-product-variant-batch]")?.querySelectorAll("[data-batch-physical]").forEach((field) => { field.hidden = currentType() !== "physical"; });
      setText("[data-generate-variants-label]", variants.length ? (currentType() === "subscription" ? "Update plans" : "Update combinations") : (currentType() === "subscription" ? "Generate plans" : "Generate combinations"));
      renderVariantFilters(); updateVariantSelection(); syncLiveVariants();
    };
    const generateVariants = () => {
      clearError();
      const overLimit = [...(optionGroups?.children || [])].find((row) => rawOptionValues(row.querySelector("[data-option-values]")).length > 30);
      if (overLimit) { showError("Each option group can have up to 30 unique values."); overLimit.querySelector("[data-option-values]")?.focus(); return; }
      const groups = optionSnapshot();
      if (!groups.length) { showError(currentType() === "subscription" ? "Add at least one plan option and comma-separated values before generating plans." : "Add at least one option name and comma-separated values before generating variants."); return; }
      const combinations = groups.reduce((list, group) => list.flatMap((combination) => group.values.map((value) => [...combination, { option: group.name, value }])), [[]]);
      if (combinations.length > 100) { showError(`These options create more than 100 ${currentType() === "subscription" ? "plans" : "variants"}. Reduce the values before continuing.`); return; }
      const previous = new Map(variants.map((variant) => [variant.name, variant]));
      const previousIds = new Set(variants.map((variant) => variant.id));
      const combinationNames = new Set(combinations.map((options) => options.map((option) => option.value).join(" · ")));
      const usedSkus = new Set([...previous].filter(([name]) => combinationNames.has(name)).map(([, variant]) => String(variant.sku || "").toLowerCase()).filter(Boolean));
      let nextSkuNumber = 1;
      const allocateSku = () => {
        const prefix = currentType() === "subscription" ? "PLAN" : "VAR";
        let candidate = "";
        do { candidate = `${prefix}-${String(nextSkuNumber).padStart(3, "0")}`; nextSkuNumber += 1; } while (usedSkus.has(candidate.toLowerCase()));
        usedSkus.add(candidate.toLowerCase());
        return candidate;
      };
      const price = Math.max(1000, Math.round(Number(productCreateForm.elements.price?.value) || 75000));
      const stock = Math.max(0, Math.round(Number(productCreateForm.elements.stock?.value) || 0));
      const weightGrams = Math.max(1, Math.round(Number(productCreateForm.elements.weight?.value) || 500));
      const billingUnit = ["month", "year"].includes(productCreateForm.elements.unit?.value) ? productCreateForm.elements.unit.value : "month";
      const billingInterval = Math.max(1, Math.min(billingUnit === "year" ? 10 : 120, Math.round(Number(productCreateForm.elements.interval?.value) || 1)));
      variants = combinations.map((options, index) => {
        const name = options.map((option) => option.value).join(" · ");
        const existing = previous.get(name);
        return existing ? { ...existing, name, options } : { id: globalThis.crypto?.randomUUID?.() || `variant-${Date.now()}-${index}`, name, options, price, stock, weightGrams, billingInterval, billingUnit, sku: allocateSku(), imageIndex: null, useCustomImage: false };
      });
      activeVariantFilters.clear();
      selectedVariantIds.clear();
      renderVariants(); markDraftChanged();
      if (previous.size) {
        const added = variants.filter((variant) => !previousIds.has(variant.id)).length;
        showToast(added ? `Added ${added} new combination${added === 1 ? "" : "s"}; existing details were preserved` : "Combinations updated; existing details were preserved");
      }
    };

    const syncVariantLanguage = () => {
      const subscription = currentType() === "subscription";
      setText("[data-variant-section-title]", subscription ? "Subscription plans" : "Product variants");
      setText("[data-variant-section-description]", subscription ? "Create the plans customers can choose and set each billing schedule." : "Keep sizes, flavors, colors, or bundles inside this one product.");
      setText("[data-variant-toggle-label]", subscription ? "Has plans" : "Has variants");
      setText("[data-variant-options-title]", subscription ? "Plan options" : "Option groups");
      setText("[data-variant-options-description]", subscription ? "Up to 3 option groups and 30 values each. The first group controls plan images." : "Up to 3 option groups and 30 values each. The first group controls variant images.");
      setText("[data-generate-variants-label]", subscription ? "Generate plans" : "Generate combinations");
      setText("[data-variant-empty-title]", subscription ? "No plans yet" : "No combinations yet");
      setText("[data-variant-empty-description]", subscription ? "Add plan options, then generate the plans customers can choose." : "Add option values, then generate the sellable variants for this product.");
      setText("[data-variant-batch-description]", subscription ? "Combine plan filters to update only the matching plans." : "Combine option filters—such as 50 ml and Drops—to update only the matching variants.");
      setText("[data-variant-group-heading]", optionSnapshot()[0]?.name || (subscription ? "Plan" : "Option"));
      setText("[data-variant-column-title]", optionSnapshot().slice(1).map((group) => group.name).join(" / ") || (subscription ? "Plan details" : "Variant details"));
      setText("[data-variant-help]", subscription ? "Every plan has its own price, billing period, and SKU. Images are shared by the first option group." : "Every row remains part of this product. Physical variants carry their own stock and shipping weight. Images are shared by the first option group.");
      setText("[data-product-no-variants]", subscription ? "Only one plan? The price and billing period below will be used." : "No variants needed? The base price and stock below will be used.");
      setText("[data-base-pricing-title]", subscription ? "Price and billing" : "Price and availability");
      setText("[data-base-pricing-description]", subscription ? "Used when this subscription has one plan." : "Used as the default when the product has no variants.");
      setText("[data-product-live-action-label]", subscription ? "Get started" : "Add to cart");
      q("[data-product-live-action-icon]")?.toggleAttribute("hidden", subscription);
      selectAllVariants?.setAttribute("aria-label", subscription ? "Select all plans" : "Select all variants");
    };

    const syncVariantMode = () => {
      const enabled = Boolean(variantToggle?.checked);
      if (variantBuilder) variantBuilder.hidden = !enabled;
      if (noVariants) noVariants.hidden = enabled;
      if (basePricingCard) basePricingCard.hidden = enabled;
      if (productCreateForm.elements.price) productCreateForm.elements.price.required = !enabled;
      if (enabled && optionGroups?.children.length === 0) {
        if (currentType() === "subscription") addOptionGroup("Plan", "Basic, Pro");
        else { addOptionGroup("Flavor", "Peach, Original"); addOptionGroup("Size", "50 ml, 250 ml"); }
      }
      syncLiveVariants(); markDraftChanged();
    };
    const syncBaseBillingLimit = () => {
      const input = productCreateForm.elements.interval;
      if (!input) return;
      const maximum = productCreateForm.elements.unit?.value === "year" ? 10 : 120;
      input.max = String(maximum);
      if (Number(input.value) > maximum) input.value = String(maximum);
    };
    const syncType = () => {
      const type = currentType();
      productCreateForm.querySelectorAll("[data-product-physical]").forEach((field) => { field.hidden = type !== "physical"; });
      const digital = q("[data-product-digital]"); if (digital) digital.hidden = type !== "digital";
      const subscription = q("[data-product-subscription]"); if (subscription) subscription.hidden = type !== "subscription";
      syncBaseBillingLimit();
      if (imageRule) imageRule.querySelector("span").innerHTML = type === "physical" ? "<b>Physical products need 3–9 images.</b> The first image becomes the main catalog photo." : "<b>This product needs 1–9 images.</b> The first image becomes the main catalog photo.";
      if (type === "subscription") variants.forEach((variant) => { variant.billingInterval ||= Math.max(1, Math.round(Number(productCreateForm.elements.interval?.value) || 1)); variant.billingUnit ||= String(productCreateForm.elements.unit?.value || "month"); });
      syncVariantLanguage();
      if (variants.length) renderVariants();
      updatePreview(); markDraftChanged();
    };

    const animateGallery = (oldRects) => requestAnimationFrame(() => gallery?.querySelectorAll(".product-media-tile").forEach((tile) => {
      const old = oldRects?.get(tile.dataset.imageId); if (!old) return;
      const next = tile.getBoundingClientRect(); const x = old.left - next.left; const y = old.top - next.top;
      if (x || y) tile.animate([{ transform: `translate(${x}px, ${y}px)` }, { transform: "translate(0, 0)" }], { duration: 260, easing: "cubic-bezier(.22,.82,.22,1)" });
    }));
    const galleryRects = () => new Map([...gallery?.querySelectorAll(".product-media-tile") || []].map((tile) => [tile.dataset.imageId, tile.getBoundingClientRect()]));
    const reorderImageToIndex = (sourceId, target) => {
      const source = selectedImages.findIndex((item) => item.id === sourceId);
      if (source < 0 || target < 0 || target >= selectedImages.length || source === target) return;
      const oldRects = galleryRects(); const [moved] = selectedImages.splice(source, 1); selectedImages.splice(target, 0, moved); renderImages(oldRects);
      if (!draggingImageId) markDraftChanged();
    };
    const reorderImage = (sourceId, targetId) => reorderImageToIndex(sourceId, selectedImages.findIndex((item) => item.id === targetId));
    const gallerySlotAtPoint = (x, y) => {
      const tiles = [...gallery?.querySelectorAll(".product-media-tile") || []];
      if (!tiles.length) return -1;
      const galleryBox = gallery.getBoundingClientRect();
      if (x < galleryBox.left || x > galleryBox.right || y < galleryBox.top || y > galleryBox.bottom) return -1;
      const style = getComputedStyle(gallery); const columns = style.gridTemplateColumns.split(" ").filter(Boolean).length || 1;
      const width = tiles[0].offsetWidth; const height = tiles[0].offsetHeight;
      const columnGap = Number.parseFloat(style.columnGap) || 0; const rowGap = Number.parseFloat(style.rowGap) || 0;
      const column = Math.max(0, Math.min(columns - 1, Math.round((x - galleryBox.left - width / 2) / (width + columnGap))));
      const rows = Math.ceil(tiles.length / columns); const row = Math.max(0, Math.min(rows - 1, Math.round((y - galleryBox.top - height / 2) / (height + rowGap))));
      return Math.min(tiles.length - 1, row * columns + column);
    };
    const startMediaDrag = (event, item, tile) => {
      if (event.button !== 0 || event.target.closest("button")) return;
      event.preventDefault();
      const rect = tile.getBoundingClientRect(); const ghost = tile.cloneNode(true); ghost.classList.add("product-media-drag-ghost");
      const squareSize = Math.max(86, Math.min(150, rect.width));
      ghost.style.width = `${squareSize}px`; ghost.style.height = `${squareSize}px`;
      ghost.style.transform = `translate3d(${event.clientX - squareSize / 2}px, ${event.clientY - squareSize / 2}px, 0) rotate(0deg) scale(1.04)`;
      document.body.append(ghost);
      const oldRects = galleryRects(); draggingImageId = item.id; renderImages(oldRects);
      let x = event.clientX; let y = event.clientY; let lastX = x; let lastTime = performance.now(); let velocity = 0;
      const paint = () => { const tilt = Math.max(-8, Math.min(8, velocity * .15)); ghost.style.transform = `translate3d(${x - squareSize / 2}px, ${y - squareSize / 2}px, 0) rotate(${tilt}deg) scale(1.04)`; };
      paint();
      const move = (moveEvent) => {
        const now = performance.now(); velocity = (moveEvent.clientX - lastX) / Math.max(1, now - lastTime); lastX = moveEvent.clientX; lastTime = now; x = moveEvent.clientX; y = moveEvent.clientY; paint();
        const targetSlot = gallerySlotAtPoint(x, y); if (targetSlot >= 0) reorderImageToIndex(item.id, targetSlot);
      };
      const end = () => {
        document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", end); document.removeEventListener("pointercancel", end);
        const placeholder = gallery?.querySelector(`[data-image-id="${CSS.escape(item.id)}"]`);
        const target = placeholder?.getBoundingClientRect();
        if (!target) { draggingImageId = null; renderImages(); ghost.remove(); markDraftChanged(); return; }
        const scale = target.width / squareSize;
        const settleX = target.left - (squareSize - target.width) / 2; const settleY = target.top - (squareSize - target.height) / 2;
        ghost.classList.add("is-settling");
        ghost.style.transform = `translate3d(${settleX}px, ${settleY}px, 0) rotate(0deg) scale(${scale})`;
        window.setTimeout(() => { const oldRects = galleryRects(); draggingImageId = null; renderImages(oldRects); ghost.remove(); markDraftChanged(); }, 210);
      };
      document.addEventListener("pointermove", move); document.addEventListener("pointerup", end, { once: true }); document.addEventListener("pointercancel", end, { once: true });
    };
    const renderImages = (oldRects = null) => {
      if (mediaCount) mediaCount.textContent = `${selectedImages.length} / 9`;
      if (gallery) { gallery.hidden = selectedImages.length === 0; gallery.classList.toggle("is-reordering", Boolean(draggingImageId)); gallery.replaceChildren(); }
      if (mediaEmpty) mediaEmpty.hidden = selectedImages.length > 0;
      selectedImages.forEach((item, index) => {
        const tile = document.createElement("article"); tile.className = "product-media-tile"; tile.dataset.imageId = item.id;
        if (item.id === draggingImageId) tile.classList.add("product-media-drop-placeholder");
        tile.innerHTML = `<img src="${item.url}" alt=""><span>${index === 0 ? "Main image" : `Image ${index + 1}`}</span><div><button type="button" data-media-left aria-label="Move image left">←</button><button type="button" data-media-right aria-label="Move image right">→</button><button type="button" data-media-remove aria-label="Remove image">×</button></div>`;
        tile.querySelector("[data-media-left]").disabled = index === 0; tile.querySelector("[data-media-right]").disabled = index === selectedImages.length - 1;
        tile.querySelector("[data-media-left]").addEventListener("click", () => reorderImage(item.id, selectedImages[index - 1]?.id));
        tile.querySelector("[data-media-right]").addEventListener("click", () => reorderImage(item.id, selectedImages[index + 1]?.id));
        tile.querySelector("[data-media-remove]").addEventListener("click", () => { selectedImages.splice(index, 1); previewImageIndex = Math.min(previewImageIndex, Math.max(0, selectedImages.length - 1)); renderImages(); markDraftChanged(); });
        tile.addEventListener("pointerdown", (event) => startMediaDrag(event, item, tile)); gallery?.append(tile);
      });
      if (liveThumbs) {
        liveThumbs.hidden = selectedImages.length < 2; liveThumbs.replaceChildren();
        selectedImages.forEach((item, index) => { const button = document.createElement("button"); button.type = "button"; button.innerHTML = `<img src="${item.url}" alt="Preview image ${index + 1}">`; button.addEventListener("click", () => { const direction = index >= previewImageIndex ? 1 : -1; previewUsesVariantImage = false; previewImageIndex = index; updatePreview(direction); }); liveThumbs.append(button); });
      }
      if (!draggingImageId) { if (variants.length) renderVariants(); else updatePreview(); }
      animateGallery(oldRects);
    };
    const addImages = async (files) => {
      clearError(); const incoming = [...files];
      if (!incoming.length) { setDropzoneState("idle"); return; }
      setDropzoneState("uploading");
      const valid = incoming.filter((file) => allowedImageTypes.includes(file.type) && file.size <= 2 * 1024 * 1024).slice(0, Math.max(0, 9 - selectedImages.length));
      try {
        const data = await Promise.all(valid.map(compressCreatorProductImage));
        data.forEach((url) => selectedImages.push({ id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`, data: url, url }));
        renderImages(); markDraftChanged();
      } catch (error) { showError(error instanceof Error ? error.message : "Those images could not be added."); }
      if (mediaInput) mediaInput.value = "";
      if (valid.length !== incoming.length) showError("Some images were skipped. Use PNG, JPG, WebP, or AVIF files under 2 MB, with no more than 9 images.");
      setDropzoneState("idle");
    };

    const productSnapshot = (product) => ({
      id: draftId,
      name: product.name || "",
      fields: {
        type: product.type || "physical", category: product.category || "", description: product.description || "",
        price: String(product.price || ""), stock: String(product.stock ?? ""), weight: String(product.weightGrams ?? ""),
        digital_name: product.digitalFileName || "", interval: String(product.subscription?.interval || 1), unit: product.subscription?.unit || "month",
      },
      images: (product.images || []).map((data, index) => ({ id: `saved-${index + 1}`, cloudId: product.mediaIds?.[index] || null, data })),
      hasVariants: Array.isArray(product.variants) && product.variants.length > 0,
      options: Array.isArray(product.options) ? product.options : [],
      variants: (product.variants || []).map((variant) => {
        const galleryMatch = /^gallery-(\d+)$/.exec(String(variant.imageSource || ""));
        const useCustomImage = variant.imageSource === "variant-upload";
        return {
          ...variant,
          billingInterval: variant.billingInterval || product.subscription?.interval || 1,
          billingUnit: variant.billingUnit || product.subscription?.unit || "month",
          imageIndex: galleryMatch ? Math.max(0, Number(galleryMatch[1]) - 1) : Number.isInteger(variant.imageIndex) ? variant.imageIndex : 0,
          useCustomImage,
          customImage: useCustomImage && variant.image ? { cloudId: variant.imageUploadId || null, data: variant.image } : null,
        };
      }),
      previewDevice: "desktop",
    });
    const restoreSnapshot = (snapshot, label) => {
      productCreateForm.elements.name.value = snapshot.name || "";
      Object.entries(snapshot.fields || {}).forEach(([name, value]) => { if (productCreateForm.elements[name]) productCreateForm.elements[name].value = value; });
      selectedImages = (snapshot.images || []).filter((item) => item.data).map((item) => ({ id: item.id || `image-${Date.now()}-${Math.random()}`, cloudId: item.cloudId || null, data: item.data, url: item.data }));
      variantToggle.checked = Boolean(snapshot.hasVariants);
      const restoredOptions = [...(snapshot.options || [])];
      if (String(snapshot.fields?.type || "physical") !== "subscription") {
        const flavorIndex = restoredOptions.findIndex((group) => /^flavou?r$/i.test(String(group?.name || "").trim()));
        if (flavorIndex > 0) restoredOptions.unshift(restoredOptions.splice(flavorIndex, 1)[0]);
      }
      optionGroups?.replaceChildren(); restoredOptions.forEach((group) => addOptionGroup(group.name, (group.values || []).join(", ")));
      const optionOrder = new Map(restoredOptions.map((group, index) => [group.name, index]));
      variants = (snapshot.variants || []).map((variant) => {
        const options = [...(variant.options || [])].sort((a, b) => (optionOrder.get(a.option) ?? 99) - (optionOrder.get(b.option) ?? 99));
        return { ...variant, name: options.map((option) => option.value).join(" · ") || variant.name, options, weightGrams: variant.weightGrams || 500, billingInterval: variant.billingInterval || Number(snapshot.fields?.interval) || 1, billingUnit: variant.billingUnit || snapshot.fields?.unit || "month", customImage: variant.customImage?.data ? { cloudId: variant.customImage.cloudId || null, data: variant.customImage.data, url: variant.customImage.data } : null };
      });
      previewDevice = snapshot.previewDevice === "mobile" ? "mobile" : "desktop";
      if (draftStatus) draftStatus.innerHTML = `<i></i> ${label}`;
    };
    const restoreDraft = () => {
      const draft = readProductDrafts().find((item) => item.id === draftId);
      if (draft) { restoreSnapshot(draft, editingProduct ? "Unsaved edits restored" : "Draft restored"); return; }
      if (editingProduct) restoreSnapshot(productSnapshot(editingProduct), "Product loaded");
    };

    variantToggle?.addEventListener("change", syncVariantMode);
    addOptionButton?.addEventListener("click", () => { addOptionGroup(); markDraftChanged(); });
    q("[data-generate-variants]")?.addEventListener("click", generateVariants);
    selectAllVariants?.addEventListener("change", () => { activeVariantFilters.clear(); selectedVariantIds = selectAllVariants.checked ? new Set(visibleVariants().map((variant) => variant.id)) : new Set(); updateVariantSelection(); });
    q("[data-clear-variant-selection]")?.addEventListener("click", () => { activeVariantFilters.clear(); selectedVariantIds.clear(); updateVariantSelection(); });
    q("[data-apply-variant-batch]")?.addEventListener("click", () => {
      if (!selectedVariantIds.size) { showError(`Select at least one ${currentType() === "subscription" ? "plan" : "variant"} or use an option filter first.`); return; }
      const price = q("[data-batch-price]").value; const stock = q("[data-batch-stock]").value; const weight = q("[data-batch-weight]").value;
      if (price === "" && stock === "" && weight === "") { showError("Enter at least one batch value to apply."); return; }
      variants.filter((variant) => selectedVariantIds.has(variant.id)).forEach((variant) => { if (price !== "") variant.price = Math.max(0, Math.round(Number(price) || 0)); if (stock !== "") variant.stock = Math.max(0, Math.round(Number(stock) || 0)); if (weight !== "") variant.weightGrams = Math.max(0, Math.round(Number(weight) || 0)); });
      clearError(); renderVariants(); markDraftChanged(); showToast(`Updated ${selectedVariantIds.size} ${currentType() === "subscription" ? "plans" : "variants"}`);
    });
    q("[data-product-preview-device='desktop']")?.addEventListener("click", () => { previewDevice = "desktop"; syncPreviewDevice(); markDraftChanged(); });
    q("[data-product-preview-device='mobile']")?.addEventListener("click", () => { previewDevice = "mobile"; syncPreviewDevice(); markDraftChanged(); });
    previewImagePrevious?.addEventListener("click", () => navigatePreviewImage(-1));
    previewImageNext?.addEventListener("click", () => navigatePreviewImage(1));
    if (liveImageStage) {
      let swipeStartX = null; let swipeStartY = null; let swipePointer = null; let swipeDistance = 0; let horizontalSwipe = false;
      liveImageStage.addEventListener("pointerdown", (event) => { if (event.button !== 0 || event.target.closest("button")) return; swipeStartX = event.clientX; swipeStartY = event.clientY; swipePointer = event.pointerId; swipeDistance = 0; horizontalSwipe = false; liveImageStage.classList.add("is-swiping"); liveImageStage.setPointerCapture?.(event.pointerId); });
      liveImageStage.addEventListener("pointermove", (event) => {
        if (swipeStartX === null || (swipePointer !== null && event.pointerId !== swipePointer)) return;
        const xDistance = event.clientX - swipeStartX; const yDistance = event.clientY - swipeStartY;
        if (!horizontalSwipe && Math.abs(xDistance) > 7 && Math.abs(xDistance) > Math.abs(yDistance)) horizontalSwipe = true;
        if (!horizontalSwipe) return;
        swipeDistance = xDistance; const image = liveImage?.querySelector(":scope > img:last-of-type");
        if (image) image.style.transform = `translateX(${xDistance}px)`;
      });
      const finishSwipe = (event) => {
        if (swipeStartX === null || (swipePointer !== null && event.pointerId !== swipePointer)) return;
        const image = liveImage?.querySelector(":scope > img:last-of-type"); const distance = swipeDistance;
        swipeStartX = null; swipeStartY = null; swipePointer = null; swipeDistance = 0; liveImageStage.classList.remove("is-swiping");
        if (horizontalSwipe && Math.abs(distance) >= 38) { if (image) image.style.transform = ""; navigatePreviewImage(distance < 0 ? 1 : -1, distance); }
        else if (image) { const current = getComputedStyle(image).transform; image.style.transform = ""; image.animate([{ transform: current === "none" ? "translateX(0)" : current }, { transform: "translateX(0)" }], { duration: 180, easing: "cubic-bezier(.2,.8,.2,1)" }); }
        horizontalSwipe = false;
      };
      liveImageStage.addEventListener("pointerup", finishSwipe); liveImageStage.addEventListener("pointercancel", finishSwipe); liveImageStage.addEventListener("dragstart", (event) => event.preventDefault());
    }
    const syncDesktopPreviewScale = () => {
      if (!previewViewport || !previewCard) return;
      if (previewDevice !== "desktop") { previewCard.style.removeProperty("--desktop-preview-scale"); return; }
      const viewportStyle = getComputedStyle(previewViewport);
      const availableWidth = previewViewport.clientWidth - parseFloat(viewportStyle.paddingLeft) - parseFloat(viewportStyle.paddingRight);
      previewCard.style.setProperty("--desktop-preview-scale", String(Math.min(1, Math.max(.3, availableWidth / 1000))));
    };
    function syncPreviewDevice() {
      previewViewport?.classList.toggle("preview-mobile", previewDevice === "mobile"); previewViewport?.classList.toggle("preview-desktop", previewDevice === "desktop");
      productCreateForm.querySelectorAll("[data-product-preview-device]").forEach((button) => button.classList.toggle("active", button.dataset.productPreviewDevice === previewDevice));
      requestAnimationFrame(syncDesktopPreviewScale);
    }
    window.addEventListener("resize", syncDesktopPreviewScale);
    mediaInput?.addEventListener("change", () => addImages([...(mediaInput.files || [])]));
    let dropzoneDragDepth = 0;
    dropzone?.addEventListener("dragenter", (event) => { event.preventDefault(); dropzoneDragDepth += 1; setDropzoneState("ready"); });
    dropzone?.addEventListener("dragover", (event) => { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = "copy"; setDropzoneState("ready"); });
    dropzone?.addEventListener("dragleave", (event) => { event.preventDefault(); dropzoneDragDepth = Math.max(0, dropzoneDragDepth - 1); if (dropzoneDragDepth === 0) setDropzoneState("idle"); });
    dropzone?.addEventListener("drop", (event) => { event.preventDefault(); dropzoneDragDepth = 0; addImages([...(event.dataTransfer?.files || [])]); });
    saveDraftButton?.addEventListener("click", () => { void saveDraft(true); });
    productCreateForm.addEventListener("input", (event) => { updatePreview(); markDraftChanged(); if (event.target === productCreateForm.elements.name && categoryDialog && !categoryDialog.hidden) renderCategorySuggestions(); });
    productCreateForm.addEventListener("change", () => { updatePreview(); markDraftChanged(); });
    typeInput?.addEventListener("change", () => {
      syncType(); syncProductTypePicker(); setProductTypeMenu(false);
      const value = String(categoryInput?.value || "").trim();
      const knownCategory = Object.keys(categoryCatalog).flatMap((type) => categoryEntries(type)).some((entry) => entry.path === value);
      if (knownCategory && !currentCategoryEntry() && categoryInput) categoryInput.value = "";
      syncCategoryField();
    });
    productCreateForm.elements.unit?.addEventListener("change", syncBaseBillingLimit);
    productCreateForm.addEventListener("submit", async (event) => {
      event.preventDefault(); clearError();
      if (!productCreateForm.reportValidity()) return;
      if (!String(categoryInput?.value || "").trim()) { showError("Choose the product category that best matches what you are selling."); openCategoryDialog(); return; }
      const type = currentType(); const minimum = type === "physical" ? 3 : 1;
      const overLimit = [...(optionGroups?.children || [])].find((row) => rawOptionValues(row.querySelector("[data-option-values]")).length > 30);
      if (overLimit) { showError("Each option group can have up to 30 unique values."); overLimit.querySelector("[data-option-values]")?.focus(); return; }
      if (selectedImages.length < minimum || selectedImages.length > 9) { showError(`${typeName(type)} requires ${minimum === 3 ? "3–9" : "1–9"} images.`); return; }
      if (variantToggle.checked && !variants.length) { showError(type === "subscription" ? "Generate at least one plan, or turn off Has plans." : "Generate at least one variant, or turn off Has variants."); return; }
      const sellableVariants = visibleVariants();
      if (variantToggle.checked && !sellableVariants.length) { showError(type === "subscription" ? "Show at least one plan before publishing." : "Show at least one variant before publishing."); return; }
      if (variants.some((variant) => variant.price < 1000 || !variant.sku || (type === "physical" && variant.weightGrams < 1) || (type === "subscription" && (!variant.billingUnit || variant.billingInterval < 1)))) { showError(type === "subscription" ? "Every plan needs a valid price, SKU, and billing period." : "Every variant needs a valid price, SKU, and shipping weight."); return; }
      const firstPlan = type === "subscription" && variantToggle.checked ? sellableVariants[0] : null;
      const selectedBillingUnit = String(firstPlan?.billingUnit || productCreateForm.elements.unit.value || "month");
      const interval = Math.max(1, Math.min(selectedBillingUnit === "year" ? 10 : 120, Math.round(Number(firstPlan?.billingInterval ?? productCreateForm.elements.interval?.value) || 1)));
      submitButtons.forEach((button) => { button.disabled = true; button.dataset.originalText = button.textContent; button.textContent = editingProduct ? "Publishing changes…" : "Creating product…"; });
      try {
        await ensureEditorMediaCloud();
        const images = await Promise.all(selectedImages.map(imageData));
        const suffix = globalThis.crypto?.randomUUID?.().replace(/-/g, "").slice(0, 10) || String(Date.now());
        const product = {
          id: editingProduct?.id || `custom-${suffix}`, sku: editingProduct?.sku || `EZK-${type.slice(0, 3).toUpperCase()}-${suffix.toUpperCase()}`, name: String(productCreateForm.elements.name.value).trim(), category: String(productCreateForm.elements.category.value).trim(), categoryKey: currentCategoryEntry() ? categoryKey(productCreateForm.elements.category.value) : "", description: String(productCreateForm.elements.description.value).trim(), type,
          price: variantToggle.checked ? Math.min(...sellableVariants.map((variant) => variant.price)) : Math.round(Number(productCreateForm.elements.price.value) || 0), images, mediaIds: selectedImages.map((image) => image.cloudId), image: images[0],
          ...(type === "physical" ? { stock: variantToggle.checked ? sellableVariants.reduce((total, variant) => total + variant.stock, 0) : Math.max(0, Math.round(Number(productCreateForm.elements.stock.value) || 0)), weightGrams: variantToggle.checked ? Math.max(...sellableVariants.map((variant) => variant.weightGrams)) : Math.max(1, Math.round(Number(productCreateForm.elements.weight.value) || 0)) } : {}),
          ...(type === "digital" ? { digitalFileName: String(productCreateForm.elements.digital_name.value || "").trim() } : {}),
          ...(type === "subscription" ? { subscription: { interval, unit: selectedBillingUnit } } : {}),
          ...(variantToggle.checked ? { options: optionSnapshot(), variants: variants.map(({ customImage, useCustomImage, ...variant }) => ({ ...variant, imageUploadId: useCustomImage ? customImage?.cloudId || null : null, image: useCustomImage && customImage?.data ? customImage.data : Number.isInteger(variant.imageIndex) ? images[variant.imageIndex] || images[0] : images[0], imageSource: useCustomImage && customImage?.data ? "variant-upload" : Number.isInteger(variant.imageIndex) ? `gallery-${variant.imageIndex + 1}` : "main" })) } : {}), createdAt: editingProduct?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(),
        };
        if (cloudEnabled) await saveCloudProduct(product);
        else {
          const products = readLocalCatalogProducts();
          const productIndex = products.findIndex((item) => item.id === product.id);
          if (productIndex >= 0) products[productIndex] = product; else products.push(product);
          if (!writeCatalogProducts(products)) return;
        }
        if (cloudEnabled) {
          await cloudRequest("DELETE", `/v1/drafts/${encodeURIComponent(draftId)}`).catch(() => {});
          cloudProductDrafts = cloudProductDrafts.filter((draft) => draft.id !== draftId);
        }
        removeLocalDraft(draftId); sessionStorage.removeItem(activeProductDraftKey);
        window.opener?.postMessage({ type: editingProduct ? "ezkart:catalog-product-updated" : "ezkart:catalog-product-created", productId: product.id }, window.location.origin); window.location.href = `?page=products&${editingProduct ? "updated" : "created"}=1`;
      } catch (error) { showError(error instanceof Error ? error.message : "The product could not be created."); }
      finally { submitButtons.forEach((button) => { button.disabled = false; button.textContent = button.dataset.originalText || (editingProduct ? "Publish changes" : "Create product"); }); }
    });

    restoreDraft(); syncVariantMode(); syncType(); syncProductTypePicker(); syncCategoryField(); syncPreviewDevice(); renderImages(); restoringDraft = false; updatePreview();
  }

  const setupCreatorProducts = (form) => {
    if (!form) return { selected: () => [], reset: () => {} };
    const composer = form.querySelector("[data-creator-product-form]");
    const list = form.querySelector("[data-creator-custom-products]");
    const name = form.querySelector("[data-creator-product-name]");
    const price = form.querySelector("[data-creator-product-price]");
    const type = form.querySelector("[data-creator-product-type]");
    const weight = form.querySelector("[data-creator-product-weight]");
    const image = form.querySelector("[data-creator-product-image]");
    const imageRule = form.querySelector("[data-creator-image-rule]");
    const physicalField = form.querySelector("[data-creator-physical-field]");
    const digitalField = form.querySelector("[data-creator-digital-field]");
    const digitalName = form.querySelector("[data-creator-digital-name]");
    const subscriptionFields = form.querySelector("[data-creator-subscription-fields]");
    const subscriptionInterval = form.querySelector("[data-creator-subscription-interval]");
    const subscriptionUnit = form.querySelector("[data-creator-subscription-unit]");
    const save = form.querySelector("[data-creator-product-save]");
    let products = [];
    const typeLabel = (value) => ({ physical: "Physical", digital: "Digital download", subscription: "Subscription" }[value] || "Product");
    const clearError = () => composer?.querySelector(".creator-product-error")?.remove();
    const showError = (message) => { clearError(); const error = document.createElement("p"); error.className = "creator-product-error"; error.textContent = message; composer?.append(error); };
    const render = () => {
      if (!list) return;
      list.replaceChildren(); list.hidden = products.length === 0;
      products.forEach((product) => {
        const row = document.createElement("div"); row.className = "creator-custom-product";
        const schedule = product.type === "subscription" ? ` · every ${product.subscription.interval} ${product.subscription.unit}${product.subscription.interval > 1 ? "s" : ""}` : "";
        row.innerHTML = `<input type="checkbox" name="starter_products[]" value="${product.id}" checked hidden><img src="${product.image}" alt="" loading="lazy" decoding="async"><div><b>${escapeHtml(product.name)}</b><small>${escapeHtml(formatCreatorPrice(product.price))} · ${escapeHtml(typeLabel(product.type))}${escapeHtml(schedule)} · ${product.images.length} image${product.images.length === 1 ? "" : "s"}</small></div><button type="button" aria-label="Remove ${escapeHtml(product.name)}">×</button>`;
        row.querySelector("button").onclick = () => { products = products.filter((item) => item.id !== product.id); render(); };
        list.append(row);
      });
    };
    const syncProductType = () => {
      const productType = String(type?.value || "physical");
      if (physicalField) physicalField.hidden = productType !== "physical";
      if (digitalField) digitalField.hidden = productType !== "digital";
      if (subscriptionFields) subscriptionFields.hidden = productType !== "subscription";
      if (imageRule) imageRule.textContent = `${productType === "physical" ? "Physical products need 3–9 images" : "Add 1–9 images"}. Every image must be 2 MB or smaller.`;
    };
    const resetComposer = () => { clearError(); if (name) name.value = ""; if (image) image.value = ""; if (price) price.value = "75000"; if (weight) weight.value = "500"; if (digitalName) digitalName.value = ""; if (type) type.value = "physical"; if (subscriptionInterval) subscriptionInterval.value = "1"; if (subscriptionUnit) subscriptionUnit.value = "month"; syncProductType(); if (composer) composer.hidden = true; };
    form.querySelector("[data-creator-add-own]")?.addEventListener("click", () => { if (composer) composer.hidden = false; name?.focus(); });
    form.querySelector("[data-creator-product-cancel]")?.addEventListener("click", resetComposer);
    type?.addEventListener("change", syncProductType);
    syncProductType();
    save?.addEventListener("click", async () => {
      clearError();
      const productName = String(name?.value || "").trim();
      const productPrice = Math.max(0, Math.round(Number(price?.value) || 0));
      const productType = String(type?.value || "physical");
      const files = [...(image?.files || [])];
      const minimumImages = productType === "physical" ? 3 : 1;
      const productWeight = Math.round(Number(weight?.value) || 0);
      const interval = Math.round(Number(subscriptionInterval?.value) || 0);
      const unit = String(subscriptionUnit?.value || "month");
      if (!productName) { showError("Give the product a name."); name?.focus(); return; }
      if (productPrice < 1000) { showError("Enter a price of at least Rp1.000."); price?.focus(); return; }
      if (productType === "physical" && productWeight < 1) { showError("Physical products need a shipping weight."); weight?.focus(); return; }
      const maximumInterval = unit === "year" ? 10 : 120;
      if (productType === "subscription" && (interval < 1 || interval > maximumInterval)) { showError(`Choose a billing interval from 1 to ${maximumInterval} ${unit}s.`); subscriptionInterval?.focus(); return; }
      if (files.length < minimumImages || files.length > 9) { showError(`${typeLabel(productType)} products need ${minimumImages === 3 ? "3–9" : "1–9"} images.`); image?.focus(); return; }
      const oversized = files.find((file) => file.size > 2 * 1024 * 1024);
      if (oversized) { showError(`${oversized.name} is larger than 2 MB.`); image?.focus(); return; }
      if (products.length >= 4) { showError("You can start with up to 4 custom products. Add more inside the editor."); return; }
      save.disabled = true; save.textContent = `Preparing ${files.length} image${files.length === 1 ? "" : "s"}…`;
      try {
        const productImages = await Promise.all(files.map(compressCreatorProductImage));
        const suffix = globalThis.crypto?.randomUUID?.().replace(/-/g, "").slice(0, 10) || `${Date.now()}`;
        products.push({
          id: `custom-${suffix}`,
          name: productName,
          price: productPrice,
          type: productType,
          images: productImages,
          image: productImages[0],
          ...(productType === "physical" ? { weightGrams: productWeight } : {}),
          ...(productType === "digital" ? { digitalFileName: String(digitalName?.value || "").trim() } : {}),
          ...(productType === "subscription" ? { subscription: { interval, unit } } : {}),
        });
        render(); resetComposer(); showToast(`${productName} is ready for this landing page`);
      } catch (error) { showError(error instanceof Error ? error.message : "The product photo could not be prepared."); }
      finally { save.disabled = false; save.textContent = "Add product"; }
    });
    return {
      selected: (ids) => products.filter((product) => ids.includes(product.id)),
      reset: () => { products = []; render(); resetComposer(); },
    };
  };
  document.querySelectorAll("[data-creator-close]").forEach((button) => button.addEventListener("click", () => button.closest("dialog")?.close("cancel")));
  updateLandingCountBadges();

  const landingLibrary = document.querySelector("[data-landing-library]");
  if (landingLibrary) {
    const grid = landingLibrary.querySelector("[data-project-grid]");
    const dialog = document.getElementById("library-page-creator-dialog");
    const form = dialog?.querySelector("[data-library-page-form]");
    const makePageSlug = (value) => normalize(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
    let customSites = readLandingSites();
    let slugEdited = false;
    hydrateCreatorCatalog(form);

    const projectTone = (products = []) => products.includes("coffee") ? "coffee" : products.includes("sambal") ? "chili" : "gold";
    const projectCard = (site) => {
      const tone = projectTone(site.products);
      const href = `?page=sites&edit=${encodeURIComponent(site.url)}`;
      const fallbackPreview = `<span class="project-thumbnail-placeholder"><span><svg class="icon" aria-hidden="true"><use href="#icon-layout"></use></svg><b>${site.previewUrl ? "Loading current preview" : "Preparing preview…"}</b></span></span>`;
      const pagePreview = site.previewUrl
        ? `<span class="project-page-thumbnail"><iframe src="${escapeHtml(site.previewUrl)}" title="Current preview of ${escapeHtml(site.name)}" sandbox loading="lazy" scrolling="no" tabindex="-1"></iframe></span>${fallbackPreview}`
        : fallbackPreview;
      const card = document.createElement("article");
      card.className = "landing-project-card";
      card.dataset.projectCard = "";
      card.dataset.customSite = "true";
      card.dataset.siteName = site.name;
      card.dataset.siteUrl = site.url;
      const published = site.status === "published";
      card.innerHTML = `<a class="landing-project-card-link" href="${href}" aria-label="Open ${escapeHtml(site.name)} in the editor"><span class="landing-project-preview tone-${tone}${site.previewUrl ? " has-preview" : ""}"><span class="project-browser"><i></i><i></i><i></i><small>${escapeHtml(site.url)}</small></span>${pagePreview}</span><span class="landing-project-details"><span><span class="project-status ${published ? "live" : "draft"}"><i></i>${published ? "Published" : "Draft"}</span><h2>${escapeHtml(site.name)}</h2></span></span></a><button class="project-url-copy" type="button" data-project-copy-url aria-label="Copy https://${escapeHtml(site.url)}"><svg class="icon" aria-hidden="true"><use href="#icon-copy"></use></svg></button><button class="project-actions" type="button" data-project-menu aria-label="Project actions" aria-haspopup="menu" aria-expanded="false"><span class="project-action-dots" aria-hidden="true"><i></i><i></i><i></i></span></button>`;
      const previewFrame = card.querySelector(".project-page-thumbnail iframe");
      previewFrame?.addEventListener("load", () => card.querySelector(".landing-project-preview")?.classList.add("preview-ready"));
      const copyUrl = card.querySelector("[data-project-copy-url]");
      copyUrl?.addEventListener("click", async () => {
        const url = `https://${site.url}`;
        try { await navigator.clipboard.writeText(url); }
        catch (_) {
          const input = document.createElement("input");
          input.value = url; input.style.position = "fixed"; input.style.opacity = "0";
          document.body.append(input); input.select(); document.execCommand("copy"); input.remove();
        }
        copyUrl.classList.add("copied");
        copyUrl.setAttribute("aria-label", "URL copied");
        copyUrl.querySelector("use")?.setAttribute("href", "#icon-check-circle");
        window.setTimeout(() => {
          copyUrl.classList.remove("copied");
          copyUrl.setAttribute("aria-label", `Copy https://${site.url}`);
          copyUrl.querySelector("use")?.setAttribute("href", "#icon-copy");
        }, 1400);
      });
      return card;
    };
    const closeProjectMenu = () => {
      document.querySelector(".landing-project-menu")?.remove();
      landingLibrary.querySelectorAll("[data-project-menu]").forEach((button) => button.setAttribute("aria-expanded", "false"));
    };
    const bindProjectMenus = () => landingLibrary.querySelectorAll("[data-project-menu]").forEach((button) => {
      button.onclick = (event) => {
        event.stopPropagation(); closeProjectMenu();
        const card = button.closest("[data-project-card]");
        if (!card?.dataset.customSite) { showToast("Built-in projects stay available as starting points"); return; }
        const menu = document.createElement("div");
        menu.className = "landing-project-menu";
        menu.setAttribute("role", "menu");
        menu.innerHTML = '<button type="button" role="menuitem">Delete landing page</button>';
        button.setAttribute("aria-expanded", "true");
        const rect = button.getBoundingClientRect();
        menu.style.left = `${Math.max(8, rect.right - 160)}px`; menu.style.top = `${rect.bottom + 5}px`;
        menu.querySelector("button").onclick = async () => {
          if (!window.confirm(`Delete “${card.dataset.siteName}”? This permanently removes the landing page from your account.`)) return;
          const url = card.dataset.siteUrl;
          try {
            await deleteCloudLandingPage(url);
            customSites = readLandingSites();
            card.remove(); closeProjectMenu(); renderSummary(); showToast("Landing page deleted");
          } catch (error) { showToast(error instanceof Error ? error.message : "The landing page could not be deleted."); }
        };
        document.body.append(menu);
      };
    });
    const repairLandingPagePreviews = async () => {
      const pendingSites = customSites.filter((site) => !site.previewUrl);
      for (const site of pendingSites) {
        await new Promise((resolve) => {
          const landingId = landingPageId(site.id || site.url);
          const frame = document.createElement("iframe");
          frame.title = `Refreshing preview for ${site.name}`;
          frame.setAttribute("aria-hidden", "true");
          frame.tabIndex = -1;
          frame.style.cssText = "position:fixed;z-index:-2147483647;left:-20000px;top:0;width:1440px;height:900px;border:0;pointer-events:none;overflow:hidden;";
          let settled = false;
          const finish = async (repaired) => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timeout);
            window.removeEventListener("message", receiveRepair);
            frame.remove();
            if (repaired) {
              try {
                const updated = await loadCloudLandingPage(site.url);
                const currentCard = grid?.querySelector(`[data-project-card][data-site-url="${CSS.escape(site.url)}"]`);
                currentCard?.replaceWith(projectCard(updated));
                customSites = readLandingSites();
                bindProjectMenus();
              } catch (error) {
                console.warn("Landing page preview refreshed but the card could not reload:", error);
              }
            }
            resolve();
          };
          const receiveRepair = (event) => {
            if (event.origin !== window.location.origin || event.source !== frame.contentWindow || !event.data) return;
            if (event.data.landingPageId !== landingId) return;
            if (event.data.type === "ezkart-preview-repaired") void finish(true);
            if (event.data.type === "ezkart-preview-repair-failed") void finish(false);
          };
          const timeout = window.setTimeout(() => { void finish(false); }, 45000);
          window.addEventListener("message", receiveRepair);
          frame.addEventListener("error", () => { void finish(false); }, { once: true });
          frame.src = `?page=sites&edit=${encodeURIComponent(site.url)}&preview-repair=1`;
          document.body.append(frame);
        });
      }
    };
    const renderSummary = () => {
      const count = customSites.length;
      const remaining = Math.max(0, 6 - count);
      landingLibrary.querySelector("[data-library-count]").textContent = String(count);
      landingLibrary.querySelector("[data-library-limit]").textContent = "6";
      landingLibrary.querySelector("[data-library-progress]").style.width = `${Math.min(100, count / 6 * 100)}%`;
      landingLibrary.querySelector("[data-library-cap-copy]").textContent = remaining ? `You can create ${remaining} more project${remaining === 1 ? "" : "s"}.` : "Project limit reached. Delete a project to make space.";
      const newCard = landingLibrary.querySelector("[data-library-create-card]");
      newCard.disabled = count >= 6;
      const newCardTitle = newCard.querySelector("b");
      if (newCardTitle) newCardTitle.textContent = count ? "Create another page" : "Create your first page";
      landingLibrary.querySelector("[data-new-card-copy]").textContent = remaining ? `${remaining} project space${remaining === 1 ? "" : "s"} available` : "6-project limit reached";
      updateLandingCountBadges(count);
    };
    const openCreator = () => {
      if (customSites.length >= 6) { showToast("Delete a project before creating another"); return; }
      dialog?.showModal();
    };
    customSites.forEach((site) => grid?.insertBefore(projectCard(site), landingLibrary.querySelector("[data-library-create-card]")));
    bindProjectMenus(); renderSummary(); document.body.classList.add("cloud-landing-ready");
    window.setTimeout(() => { void repairLandingPagePreviews(); }, 500);
    landingLibrary.querySelectorAll("[data-library-create], [data-library-create-card]").forEach((button) => button.addEventListener("click", openCreator));
    document.addEventListener("click", closeProjectMenu);
    const nameInput = form?.elements.namedItem("page_name");
    const slugInput = form?.elements.namedItem("slug");
    slugInput?.addEventListener("input", () => { slugEdited = true; slugInput.value = makePageSlug(slugInput.value); });
    nameInput?.addEventListener("input", () => { if (!slugEdited && slugInput) slugInput.value = makePageSlug(nameInput.value); });
    form?.addEventListener("submit", async (event) => {
      if (event.submitter?.value === "cancel") return;
      event.preventDefault();
      const products = [...form.querySelectorAll('input[name="starter_products[]"]:checked')].map((input) => input.value);
      if (!products.length) { showToast("Select at least one starting product"); return; }
      if (!form.reportValidity()) return;
      const site = { name: String(nameInput.value).trim(), url: `${makePageSlug(slugInput.value)}.ezkart.site`, products, customProducts: [] };
      if (customSites.some((item) => item.url === site.url) || landingLibrary.querySelector(`[data-site-url="${CSS.escape(site.url)}"]`)) { showToast("A page with this URL already exists"); return; }
      try {
        await saveCloudLandingPage(site, { status: "draft" });
        window.location.href = `?page=sites&edit=${encodeURIComponent(site.url)}`;
      } catch (error) { showToast(error instanceof Error ? error.message : "The landing page could not be created."); }
    });
    dialog?.addEventListener("close", () => { if (dialog.returnValue === "cancel") { form?.reset(); slugEdited = false; } });
  }

  const productCatalogPage = document.querySelector("[data-product-catalog]");
  if (productCatalogPage) {
    const dialog = document.getElementById("product-creator-dialog");
    const form = dialog?.querySelector("[data-catalog-product-form]");
    const typeInput = form?.querySelector("[data-catalog-product-type]");
    const imageRule = form?.querySelector("[data-catalog-image-rule]");
    const errorTarget = form?.querySelector("[data-catalog-product-error]");
    const inventory = document.querySelector("[data-product-inventory]");
    const draftsPanel = document.querySelector("[data-product-drafts-panel]");
    const draftList = document.querySelector("[data-product-draft-list]");
    const catalogControls = document.querySelector("[data-product-catalog-controls]");
    const catalogCount = document.querySelector("[data-product-count]");
    const sortPicker = document.querySelector("[data-product-sort-picker]");
    const sortTrigger = document.querySelector("[data-product-sort-trigger]");
    const sortMenu = document.querySelector("[data-product-sort-menu]");
    const catalogCountNoun = document.querySelector("[data-product-count-noun]");
    const catalogCountDetail = document.querySelector("[data-product-count-detail]");
    const catalogViewKey = scopedStorageKey("ezkart:product-catalog:view");
    const catalogSortKey = scopedStorageKey("ezkart:product-catalog:sort");
    const catalogFilterKey = scopedStorageKey("ezkart:product-catalog:filter");
    const storedCatalogView = localStorage.getItem(catalogViewKey);
    const storedCatalogSort = localStorage.getItem(catalogSortKey);
    const storedCatalogFilter = localStorage.getItem(catalogFilterKey);
    let catalogView = ["grid", "list"].includes(storedCatalogView) ? storedCatalogView : "grid";
    let catalogSort = ["newest", "updated", "name", "price-high", "price-low"].includes(storedCatalogSort) ? storedCatalogSort : "newest";
    let catalogFilter = ["all", "active"].includes(storedCatalogFilter) ? storedCatalogFilter : "active";
    const sortLabels = { newest: "Newest first", updated: "Recently updated", name: "Name A–Z", "price-high": "Highest price", "price-low": "Lowest price" };
    const typeName = (type) => ({ physical: "Physical product", digital: "Digital product", subscription: "Subscription" }[type] || "Product");
    const soldLabel = (value) => {
      const count = Math.max(0, Math.round(Number(value) || 0));
      if (count >= 1000000) return `${Number((count / 1000000).toFixed(count >= 10000000 ? 0 : 1))}m sold`;
      if (count >= 1000) return `${Number((count / 1000).toFixed(count >= 10000 ? 0 : 1))}k sold`;
      return `${count} sold`;
    };
    const clearError = () => { if (errorTarget) { errorTarget.hidden = true; errorTarget.textContent = ""; } };
    const showError = (message) => { if (errorTarget) { errorTarget.textContent = message; errorTarget.hidden = false; } };
    const setSortMenu = (open) => {
      if (!sortMenu || !sortTrigger) return;
      sortMenu.hidden = !open; sortTrigger.setAttribute("aria-expanded", String(open)); sortPicker?.classList.toggle("is-open", open);
    };
    const syncCatalogControls = () => {
      productCatalogPage.classList.toggle("catalog-view-grid", catalogView === "grid");
      productCatalogPage.classList.toggle("catalog-view-list", catalogView === "list");
      catalogControls?.querySelectorAll("[data-product-view]").forEach((button) => {
        const active = button.dataset.productView === catalogView;
        button.classList.toggle("active", active); button.setAttribute("aria-pressed", String(active));
      });
      catalogControls?.querySelectorAll("[data-product-filter]").forEach((button) => {
        const active = button.dataset.productFilter === catalogFilter;
        button.classList.toggle("active", active); button.setAttribute("aria-pressed", String(active));
      });
      const label = document.querySelector("[data-product-sort-label]"); if (label) label.textContent = sortLabels[catalogSort] || sortLabels.newest;
      sortMenu?.querySelectorAll("[data-product-sort-option]").forEach((button) => button.setAttribute("aria-selected", String(button.dataset.productSortOption === catalogSort)));
    };
    const sortCatalogProducts = (products) => {
      const timestamp = (product, field) => Number.isFinite(Date.parse(String(product?.[field] || ""))) ? Date.parse(String(product[field])) : 0;
      return [...products].sort((left, right) => {
        if (catalogSort === "updated") return timestamp(right, "updatedAt") - timestamp(left, "updatedAt") || timestamp(right, "createdAt") - timestamp(left, "createdAt");
        if (catalogSort === "name") return String(left.name || "").localeCompare(String(right.name || ""), undefined, { sensitivity: "base" });
        if (catalogSort === "price-high") return (Number(right.price) || 0) - (Number(left.price) || 0);
        if (catalogSort === "price-low") return (Number(left.price) || 0) - (Number(right.price) || 0);
        return timestamp(right, "createdAt") - timestamp(left, "createdAt") || timestamp(right, "updatedAt") - timestamp(left, "updatedAt");
      });
    };
    const duplicateLocalProduct = (product) => {
      const copy = structuredClone(product);
      const suffix = globalThis.crypto?.randomUUID?.().replaceAll("-", "").slice(0, 10) || String(Date.now());
      const skuSuffix = `COPY-${suffix.toUpperCase()}`;
      const withSuffix = (value, maximum = 80) => `${String(value || "EZK").slice(0, Math.max(1, maximum - skuSuffix.length - 1))}-${skuSuffix}`;
      copy.id = `custom-${suffix}`;
      copy.name = `${String(product.name || "Product").slice(0, 153)} (Copy)`;
      copy.sku = withSuffix(product.sku);
      copy.status = "active";
      copy.variants = (Array.isArray(product.variants) ? product.variants : []).map((variant) => ({
        ...variant,
        id: `variant-${globalThis.crypto?.randomUUID?.().replaceAll("-", "") || `${Date.now()}${Math.random().toString(16).slice(2)}`}`,
        sku: withSuffix(variant.sku),
      }));
      copy.createdAt = new Date().toISOString(); copy.updatedAt = copy.createdAt;
      return copy;
    };
    const syncType = () => {
      const type = String(typeInput?.value || "physical");
      form?.querySelectorAll("[data-catalog-physical]").forEach((field) => { field.hidden = type !== "physical"; });
      const digital = form?.querySelector("[data-catalog-digital]"); if (digital) digital.hidden = type !== "digital";
      const subscription = form?.querySelector("[data-catalog-subscription]"); if (subscription) subscription.hidden = type !== "subscription";
      if (imageRule) imageRule.textContent = `${type === "physical" ? "Physical products need 3–9 images" : "Products need 1–9 images"}. Maximum 2 MB each.`;
      clearError();
    };
    const updateCatalogStats = (allProducts, visibleProducts) => {
      const stats = document.querySelectorAll(".page-products .page-stat-strip article");
      const activeProducts = allProducts.filter((product) => product.status !== "archived");
      const physicalStock = activeProducts.filter((product) => product.type === "physical").reduce((sum, product) => sum + Math.max(0, Number(product.stock) || 0), 0);
      if (stats[0]?.querySelector("strong")) stats[0].querySelector("strong").textContent = String(activeProducts.length);
      if (stats[0]?.querySelector("p")) stats[0].querySelector("p").textContent = "Published in this store";
      if (stats[1]?.querySelector("strong")) stats[1].querySelector("strong").textContent = String(physicalStock);
      if (stats[1]?.querySelector("p")) stats[1].querySelector("p").textContent = "Physical inventory only";
      if (catalogCount) catalogCount.textContent = String(visibleProducts.length);
      if (catalogCountNoun) catalogCountNoun.textContent = visibleProducts.length === 1 ? "product" : "products";
      if (catalogCountDetail) catalogCountDetail.textContent = catalogFilter === "active" ? "Active products in this store" : "All products, including archived";
    };
    const renderDrafts = () => {
      if (!draftsPanel || !draftList) return;
      const drafts = readProductDrafts().sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
      draftsPanel.hidden = drafts.length === 0; draftList.replaceChildren();
      drafts.forEach((draft) => {
        const card = document.createElement("article"); card.className = "product-draft-card";
        const image = draft.images?.[0]?.data || "";
        const when = draft.updatedAt ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(draft.updatedAt)) : "Recently saved";
        const continueQuery = new URLSearchParams({ page: "product-new", draft: draft.id });
        if (/^custom-[a-z0-9]+$/i.test(draft.productId || "")) continueQuery.set("product", draft.productId);
        card.innerHTML = `<span>${image ? `<img src="${image}" alt="" loading="lazy" decoding="async">` : '<svg class="icon" aria-hidden="true"><use href="#icon-image"></use></svg>'}</span><div><b>${escapeHtml(draft.name || "Untitled product")}</b><small>${draft.hasVariants ? `${draft.variants?.length || 0} variants` : typeName(draft.fields?.type || "physical")} · ${escapeHtml(when)}</small></div><div><a href="?${continueQuery.toString().replaceAll("&", "&amp;")}">Continue</a><button type="button" aria-label="Delete ${escapeHtml(draft.name || "untitled product")} draft">×</button></div>`;
        card.querySelector("button").addEventListener("click", () => {
          if (!window.confirm(`Delete the “${draft.name || "Untitled product"}” draft?`)) return;
          const remove = async () => {
            if (cloudEnabled && cloudProductDrafts.some((item) => item.id === draft.id)) await cloudRequest("DELETE", `/v1/drafts/${encodeURIComponent(draft.id)}`);
            cloudProductDrafts = cloudProductDrafts.filter((item) => item.id !== draft.id);
            removeLocalDraft(draft.id);
            if (sessionStorage.getItem(activeProductDraftKey) === draft.id) sessionStorage.removeItem(activeProductDraftKey);
            renderDrafts(); showToast("Product draft deleted");
          };
          void remove().catch((error) => showError(error instanceof Error ? error.message : "The draft could not be deleted."));
        });
        draftList.append(card);
      });
    };
    const closeProductActionMenus = (except = null) => {
      productCatalogPage.querySelectorAll("[data-product-action-menu]").forEach((menu) => {
        if (menu === except) return;
        menu.hidden = true;
        menu.closest(".product-more")?.querySelector("[data-product-more]")?.setAttribute("aria-expanded", "false");
      });
    };
    const setCatalogProductStatus = async (product, status) => {
      if (cloudEnabled && cloudCatalogProducts.some((item) => item.id === product.id)) {
        const result = await cloudRequest("PATCH", `/v1/products/${encodeURIComponent(product.id)}/status`, { status });
        return replaceCloudProduct(result.product);
      }
      const localProducts = readLocalCatalogProducts();
      const index = localProducts.findIndex((item) => item.id === product.id);
      if (index < 0) throw new Error("The product could not be found.");
      localProducts[index] = { ...localProducts[index], status, updatedAt: new Date().toISOString() };
      if (!writeCatalogProducts(localProducts)) throw new Error("The product status could not be saved.");
      return localProducts[index];
    };
    const renderCatalog = () => {
      const allProducts = sortCatalogProducts(readCatalogProducts({ includeArchived: true }));
      const products = catalogFilter === "active" ? allProducts.filter((product) => product.status !== "archived") : allProducts;
      productCatalogPage.querySelectorAll("[data-custom-product]").forEach((card) => card.remove());
      productCatalogPage.querySelectorAll("[data-catalog-empty]").forEach((message) => message.remove());
      inventory?.querySelectorAll("[data-custom-product]").forEach((row) => row.remove());
      products.forEach((product, productIndex) => {
        const type = ["physical", "digital", "subscription"].includes(product.type) ? product.type : "physical";
        const archived = product.status === "archived";
        const image = product.image || product.images?.[0] || "";
        const availability = type === "physical" ? `${Math.max(0, Number(product.stock) || 0)} in stock` : type === "digital" ? "Digital delivery" : `Every ${product.subscription?.interval || 1} ${product.subscription?.unit || "month"}`;
        const reviewCount = Math.max(0, Number(product.reviewCount) || 0);
        const rating = reviewCount > 0 && Number.isFinite(Number(product.rating)) ? Number(product.rating).toFixed(1) : "—";
        const card = document.createElement("article");
        card.className = `product-card${archived ? " is-archived" : ""}`; card.dataset.customProduct = product.id; card.dataset.productStatus = archived ? "archived" : "active";
        card.dataset.searchRow = normalize([product.name, product.sku, product.category, typeName(type)].join(" "));
        const imageMarkup = image ? `<img src="${image}" alt="${escapeHtml(product.name)}" loading="${productIndex < 6 ? "eager" : "lazy"}" fetchpriority="${productIndex < 2 ? "high" : "auto"}" decoding="async">` : '<svg class="icon" aria-hidden="true"><use href="#icon-image"></use></svg>';
        card.innerHTML = `<span class="product-art">${imageMarkup}<em>${product.images?.length || 1} image${(product.images?.length || 1) === 1 ? "" : "s"}</em></span><div class="product-card-body"><div class="product-card-identity"><header><span class="product-card-type">${escapeHtml(String(product.category || typeName(type)).split(" > ").at(-1))}</span><em>${archived ? "Archived" : "Active"}</em></header><h2>${escapeHtml(product.name)}</h2><p>${escapeHtml(product.sku)}</p></div><div class="product-card-commerce"><strong>${escapeHtml(formatCreatorPrice(product.price))}</strong><small>${escapeHtml(availability)}</small></div><div class="product-card-meta"><div><small>Type</small><b>${escapeHtml(typeName(type))}</b></div><div><small>Revenue</small><b>Rp0</b></div></div><footer class="product-card-actions"><div class="product-card-proof" aria-label="${rating === "—" ? "No ratings yet" : `Rated ${rating} out of 5`}; ${escapeHtml(soldLabel(product.soldCount))}"><svg class="icon" aria-hidden="true"><use href="#icon-star"></use></svg><b>${rating}</b><span>·</span><span>${escapeHtml(soldLabel(product.soldCount))}</span></div><a class="product-edit-icon" href="?page=product-new&amp;product=${encodeURIComponent(product.id)}" aria-label="Edit ${escapeHtml(product.name)}" title="Edit"><svg class="icon" aria-hidden="true"><use href="#icon-pencil"></use></svg></a><div class="product-more"><button type="button" data-product-more aria-label="More actions for ${escapeHtml(product.name)}" title="More actions" aria-haspopup="menu" aria-expanded="false"><svg class="icon" aria-hidden="true"><use href="#icon-more-vertical"></use></svg></button><div class="product-action-menu" data-product-action-menu role="menu" hidden><button class="product-duplicate" type="button" role="menuitem"><svg class="icon" aria-hidden="true"><use href="#icon-copy"></use></svg><span>Duplicate</span></button><button class="product-archive" type="button" role="menuitem"><svg class="icon" aria-hidden="true"><use href="#icon-${archived ? "eye" : "eye-off"}"></use></svg><span>${archived ? "Restore" : "Archive"}</span></button><button class="product-delete" type="button" role="menuitem"><svg class="icon" aria-hidden="true"><use href="#icon-trash"></use></svg><span>Delete</span></button></div></div></footer></div>`;
        const moreTrigger = card.querySelector("[data-product-more]");
        const actionMenu = card.querySelector("[data-product-action-menu]");
        moreTrigger.addEventListener("click", (event) => {
          event.stopPropagation();
          const opening = actionMenu.hidden;
          closeProductActionMenus(actionMenu);
          actionMenu.hidden = !opening; moreTrigger.setAttribute("aria-expanded", String(opening));
        });
        actionMenu.addEventListener("keydown", (event) => {
          const options = [...actionMenu.querySelectorAll('[role="menuitem"]')];
          if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const index = options.indexOf(document.activeElement);
          const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
          options[next]?.focus();
        });
        card.querySelector(".product-duplicate").addEventListener("click", () => {
          const duplicateButton = card.querySelector(".product-duplicate");
          const duplicateLabel = duplicateButton.querySelector("span");
          const duplicate = async () => {
            duplicateButton.disabled = true; duplicateLabel.textContent = "Duplicating…";
            let copy;
            if (cloudEnabled) {
              const result = await cloudRequest("POST", `/v1/products/${encodeURIComponent(product.id)}/duplicate`, {});
              copy = replaceCloudProduct(result.product);
            } else {
              copy = duplicateLocalProduct(product);
              if (!writeCatalogProducts([copy, ...readLocalCatalogProducts()])) throw new Error("The product copy could not be saved.");
            }
            renderCatalog(); showToast(`${product.name} duplicated`);
          };
          void duplicate().catch((error) => { duplicateButton.disabled = false; duplicateLabel.textContent = "Duplicate"; showToast(error instanceof Error ? error.message : "The product could not be duplicated."); });
        });
        card.querySelector(".product-archive").addEventListener("click", () => {
          const nextStatus = archived ? "active" : "archived";
          const archiveButton = card.querySelector(".product-archive");
          archiveButton.disabled = true;
          void setCatalogProductStatus(product, nextStatus)
            .then(() => { renderCatalog(); showToast(`${product.name} ${archived ? "restored" : "archived"}`); })
            .catch((error) => { archiveButton.disabled = false; showToast(error instanceof Error ? error.message : "The product status could not be changed."); });
        });
        card.querySelector(".product-delete").addEventListener("click", () => {
          if (!window.confirm(`Delete “${product.name}” from the catalog?`)) return;
          const remove = async () => {
            if (cloudEnabled && cloudCatalogProducts.some((item) => item.id === product.id)) await cloudRequest("DELETE", `/v1/products/${encodeURIComponent(product.id)}`);
            cloudCatalogProducts = cloudCatalogProducts.filter((item) => item.id !== product.id);
            removeLocalProduct(product.id);
            renderCatalog(); showToast(`${product.name} deleted`);
          };
          void remove().catch((error) => showError(error instanceof Error ? error.message : "The product could not be deleted."));
        });
        productCatalogPage.append(card);
        if (inventory && !archived) {
          const row = document.createElement("article"); row.dataset.customProduct = product.id;
          row.innerHTML = `<span class="product-art"><img src="${image}" alt="" loading="lazy" decoding="async"></span><div><b>${escapeHtml(product.name)}</b><small>${escapeHtml(product.sku)}</small></div><strong>${type === "physical" ? Math.max(0, Number(product.stock) || 0) : "∞"}</strong><span>${type === "physical" ? "15" : "—"}</span><em class="inventory-good">${type === "physical" ? "Healthy" : "Available"}</em>`;
          inventory.append(row);
        }
      });
      if (products.length === 0) {
        const empty = document.createElement("div");
        empty.className = "catalog-empty-note"; empty.dataset.catalogEmpty = "true";
        if (catalogFilter === "active" && allProducts.length > 0) {
          empty.innerHTML = '<b>No active products.</b><span>Your archived products are still available under All.</span><button type="button" data-view-all-products>View all products</button>';
          empty.querySelector("[data-view-all-products]").addEventListener("click", () => { catalogFilter = "all"; localStorage.setItem(catalogFilterKey, catalogFilter); renderCatalog(); });
        } else {
          empty.innerHTML = '<b>Your catalog is empty.</b><span>Create your first product to start building this store.</span><a href="?page=product-new&amp;new=1">Create product</a>';
        }
        productCatalogPage.append(empty);
      }
      updateCatalogStats(allProducts, products); syncCatalogControls(); renderDrafts();
    };
    catalogControls?.querySelectorAll("[data-product-filter]").forEach((button) => button.addEventListener("click", () => {
      catalogFilter = button.dataset.productFilter === "all" ? "all" : "active";
      localStorage.setItem(catalogFilterKey, catalogFilter); renderCatalog();
    }));
    catalogControls?.querySelectorAll("[data-product-view]").forEach((button) => button.addEventListener("click", () => {
      catalogView = button.dataset.productView === "list" ? "list" : "grid";
      localStorage.setItem(catalogViewKey, catalogView); syncCatalogControls();
    }));
    sortTrigger?.addEventListener("click", () => {
      const opening = Boolean(sortMenu?.hidden); setSortMenu(opening);
      if (opening) window.setTimeout(() => sortMenu?.querySelector('[aria-selected="true"]')?.focus(), 0);
    });
    sortMenu?.querySelectorAll("[data-product-sort-option]").forEach((button) => button.addEventListener("click", () => {
      catalogSort = button.dataset.productSortOption || "newest";
      localStorage.setItem(catalogSortKey, catalogSort); setSortMenu(false); renderCatalog(); sortTrigger?.focus();
    }));
    sortMenu?.addEventListener("keydown", (event) => {
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault(); const options = [...sortMenu.querySelectorAll("[data-product-sort-option]")]; const index = options.indexOf(document.activeElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length; options[next]?.focus();
    });
    document.addEventListener("pointerdown", (event) => {
      if (sortPicker && !sortPicker.contains(event.target)) setSortMenu(false);
      if (!event.target.closest?.(".product-more")) closeProductActionMenus();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (sortMenu && !sortMenu.hidden) { setSortMenu(false); sortTrigger?.focus(); }
      const openProductMenu = productCatalogPage.querySelector("[data-product-action-menu]:not([hidden])");
      if (openProductMenu) { const trigger = openProductMenu.closest(".product-more")?.querySelector("[data-product-more]"); closeProductActionMenus(); trigger?.focus(); }
    });
    document.querySelectorAll("[data-open-product-creator]").forEach((button) => button.addEventListener("click", () => { clearError(); dialog?.showModal(); }));
    dialog?.querySelectorAll("[data-catalog-close]").forEach((button) => button.addEventListener("click", () => dialog.close("cancel")));
    dialog?.addEventListener("close", () => { if (dialog.returnValue === "cancel") { form?.reset(); syncType(); } });
    typeInput?.addEventListener("change", syncType);
    form?.addEventListener("submit", async (event) => {
      event.preventDefault(); clearError();
      if (!form.reportValidity()) return;
      const values = new FormData(form);
      const type = String(values.get("type") || "physical");
      const files = [...(form.elements.images?.files || [])];
      const minimum = type === "physical" ? 3 : 1;
      if (files.length < minimum || files.length > 9) { showError(`${typeName(type)} requires ${minimum === 3 ? "3–9" : "1–9"} images.`); return; }
      const oversized = files.find((file) => file.size > 2 * 1024 * 1024);
      if (oversized) { showError(`${oversized.name} is larger than 2 MB.`); return; }
      const weightGrams = Math.round(Number(values.get("weight")) || 0);
      if (type === "physical" && weightGrams < 1) { showError("Physical products need a shipping weight."); return; }
      const interval = Math.round(Number(values.get("interval")) || 1);
      const unit = String(values.get("unit") || "month");
      const maximumInterval = unit === "year" ? 10 : 120;
      if (type === "subscription" && (interval < 1 || interval > maximumInterval)) { showError(`Choose a billing interval from 1 to ${maximumInterval} ${unit}s.`); return; }
      const submit = form.querySelector('button[type="submit"]'); submit.disabled = true; submit.textContent = "Preparing images…";
      try {
        const images = await Promise.all(files.map(compressCreatorProductImage));
        const suffix = globalThis.crypto?.randomUUID?.().replace(/-/g, "").slice(0, 10) || String(Date.now());
        const product = {
          id: `custom-${suffix}`,
          sku: `EZK-${type.slice(0, 3).toUpperCase()}-${suffix.toUpperCase()}`,
          name: String(values.get("name") || "").trim(),
          category: String(values.get("category") || "").trim(),
          type,
          price: Math.round(Number(values.get("price")) || 0),
          images,
          image: images[0],
          ...(type === "physical" ? { stock: Math.max(0, Math.round(Number(values.get("stock")) || 0)), weightGrams } : {}),
          ...(type === "digital" ? { digitalFileName: String(values.get("digital_name") || "").trim() } : {}),
          ...(type === "subscription" ? { subscription: { interval, unit } } : {}),
          createdAt: new Date().toISOString(),
        };
        if (cloudEnabled) await saveCloudProduct(product);
        else {
          const products = readLocalCatalogProducts(); products.push(product);
          if (!writeCatalogProducts(products)) return;
        }
        renderCatalog(); dialog.close("created"); form.reset(); syncType(); showToast(`${product.name} added to Products and Landing Pages`);
      } catch (error) { showError(error instanceof Error ? error.message : "The product could not be created."); }
      finally { submit.disabled = false; submit.textContent = "Create product"; }
    });
    document.addEventListener("ezkart:cloud-catalog-changed", renderCatalog);
    document.addEventListener("ezkart:cloud-drafts-changed", renderDrafts);
    syncType(); renderCatalog();
  }

  const sqStudio = document.querySelector(".sq-studio");
  if (sqStudio) {
    const previewRoot = sqStudio.querySelector("[data-sq-preview-root]");
    const deviceFrame = sqStudio.querySelector("[data-sq-device-frame]");
    const layerList = sqStudio.querySelector("[data-sq-layer-list]");
    const inspector = sqStudio.querySelector(".sq-inspector");
    const saveState = sqStudio.querySelector("[data-sq-save-state]");
    const undoButton = sqStudio.querySelector("[data-sq-undo]");
    const redoButton = sqStudio.querySelector("[data-sq-redo]");
    let openBuilderSelect = null;
    let builderSelectId = 0;
    const positionBuilderSelectMenu = (control) => {
      if (!control?.menu || control.menu.hidden) return;
      const rect = control.trigger.getBoundingClientRect();
      const availableBelow = window.innerHeight - rect.bottom - 12;
      const menuHeight = Math.min(control.menu.scrollHeight, 260);
      const openUp = availableBelow < Math.min(menuHeight, 150) && rect.top > availableBelow;
      control.menu.style.width = `${Math.max(rect.width, 150)}px`;
      control.menu.style.left = `${Math.min(window.innerWidth - Math.max(rect.width, 150) - 8, Math.max(8, rect.left))}px`;
      control.menu.style.top = openUp ? `${Math.max(8, rect.top - menuHeight - 6)}px` : `${rect.bottom + 6}px`;
      control.menu.classList.toggle("opens-up", openUp);
    };
    const closeBuilderSelect = (control = openBuilderSelect, { restoreFocus = false } = {}) => {
      if (!control) return;
      control.menu.hidden = true;
      control.trigger.setAttribute("aria-expanded", "false");
      control.wrapper.classList.remove("open");
      if (restoreFocus) control.trigger.focus();
      if (openBuilderSelect === control) openBuilderSelect = null;
    };
    const syncBuilderSelect = (select) => {
      const control = select?._sqBuilderSelect;
      if (!control) return;
      const options = [...select.options];
      const signature = options.map((option) => `${option.value}\u0000${option.textContent}\u0000${option.disabled}`).join("\u0001");
      if (control.signature !== signature) {
        control.signature = signature;
        control.menu.replaceChildren(...options.map((option) => {
          const item = document.createElement("button");
          item.type = "button";
          item.className = "sq-builder-select-option";
          item.dataset.value = option.value;
          item.setAttribute("role", "option");
          item.disabled = option.disabled;
          item.innerHTML = `<span>${escapeHtml(option.textContent)}</span><i aria-hidden="true">✓</i>`;
          item.addEventListener("click", () => {
            if (item.disabled) return;
            select.value = item.dataset.value;
            select.dispatchEvent(new Event("input", { bubbles: true }));
            select.dispatchEvent(new Event("change", { bubbles: true }));
            syncBuilderSelect(select);
            closeBuilderSelect(control, { restoreFocus: true });
          });
          return item;
        }));
      }
      const selected = select.selectedOptions[0] || options[0];
      control.value.textContent = selected?.textContent || "Choose an option";
      control.trigger.setAttribute("aria-label", `${control.label}: ${selected?.textContent || "Choose an option"}`);
      control.trigger.disabled = select.disabled;
      control.menu.querySelectorAll("[role=option]").forEach((item) => {
        const active = item.dataset.value === select.value;
        item.classList.toggle("selected", active);
        item.setAttribute("aria-selected", String(active));
      });
    };
    const openBuilderSelectMenu = (control, direction = 0) => {
      if (openBuilderSelect && openBuilderSelect !== control) closeBuilderSelect(openBuilderSelect);
      syncBuilderSelect(control.select);
      control.menu.hidden = false;
      control.trigger.setAttribute("aria-expanded", "true");
      control.wrapper.classList.add("open");
      openBuilderSelect = control;
      positionBuilderSelectMenu(control);
      const options = [...control.menu.querySelectorAll("[role=option]:not(:disabled)")];
      const selectedIndex = Math.max(0, options.findIndex((item) => item.classList.contains("selected")));
      const targetIndex = direction < 0 ? Math.max(0, selectedIndex - 1) : direction > 0 ? Math.min(options.length - 1, selectedIndex + 1) : selectedIndex;
      options[targetIndex]?.focus();
    };
    const enhanceBuilderSelect = (select) => {
      if (select._sqBuilderSelect || select.multiple) return;
      const wrapper = document.createElement("div");
      wrapper.className = "sq-builder-select";
      wrapper.dataset.sqBuilderSelect = "";
      const trigger = document.createElement("button");
      trigger.type = "button";
      trigger.className = "sq-builder-select-trigger";
      trigger.setAttribute("aria-haspopup", "listbox");
      trigger.setAttribute("aria-expanded", "false");
      const value = document.createElement("span");
      value.className = "sq-builder-select-value";
      trigger.append(value);
      trigger.insertAdjacentHTML("beforeend", '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="m3 4.5 3 3 3-3"/></svg>');
      const menu = document.createElement("div");
      menu.id = `sq-builder-select-menu-${++builderSelectId}`;
      menu.className = "sq-builder-select-menu";
      menu.dataset.sqBuilderSelectMenu = "";
      menu.setAttribute("role", "listbox");
      menu.hidden = true;
      trigger.setAttribute("aria-controls", menu.id);
      select.classList.add("sq-builder-native-select");
      select.tabIndex = -1;
      select.setAttribute("aria-hidden", "true");
      select.after(wrapper);
      wrapper.append(trigger);
      document.body.append(menu);
      const control = { select, wrapper, trigger, value, menu, signature: "" };
      control.label = select.getAttribute("aria-label") || select.closest("label")?.querySelector(":scope > span")?.textContent.trim() || "Choose an option";
      select._sqBuilderSelect = control;
      trigger.addEventListener("click", () => control.menu.hidden ? openBuilderSelectMenu(control) : closeBuilderSelect(control));
      trigger.addEventListener("keydown", (event) => {
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        openBuilderSelectMenu(control, event.key === "ArrowUp" || event.key === "Home" ? -1 : 1);
        if (event.key === "Home") control.menu.querySelector("[role=option]:not(:disabled)")?.focus();
        if (event.key === "End") [...control.menu.querySelectorAll("[role=option]:not(:disabled)")].at(-1)?.focus();
      });
      menu.addEventListener("keydown", (event) => {
        const options = [...menu.querySelectorAll("[role=option]:not(:disabled)")];
        const current = options.indexOf(document.activeElement);
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
          options[next]?.focus();
        }
        if (event.key === "Escape") { event.preventDefault(); closeBuilderSelect(control, { restoreFocus: true }); }
      });
      menu.addEventListener("focusout", (event) => {
        if (menu.contains(event.relatedTarget) || event.relatedTarget === trigger) return;
        closeBuilderSelect(control);
      });
      select.addEventListener("input", () => syncBuilderSelect(select));
      select.addEventListener("change", () => syncBuilderSelect(select));
      new MutationObserver(() => syncBuilderSelect(select)).observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled", "label"] });
      syncBuilderSelect(select);
    };
    const builderSelects = () => [...sqStudio.querySelectorAll(".sq-tool-panels select, .sq-inspector select")];
    const enhanceBuilderSelects = () => builderSelects().forEach(enhanceBuilderSelect);
    const syncBuilderSelects = () => { enhanceBuilderSelects(); builderSelects().forEach(syncBuilderSelect); };
    document.addEventListener("pointerdown", (event) => { if (openBuilderSelect && !openBuilderSelect.wrapper.contains(event.target) && !openBuilderSelect.menu.contains(event.target)) closeBuilderSelect(openBuilderSelect); });
    window.addEventListener("resize", () => positionBuilderSelectMenu(openBuilderSelect));
    document.addEventListener("scroll", () => positionBuilderSelectMenu(openBuilderSelect), true);
    const syncBuilderRange = (input) => {
      const minimum = Number(input.min || 0);
      const maximum = Number(input.max || 100);
      const value = Number(input.value || minimum);
      const progress = maximum === minimum ? 0 : Math.min(100, Math.max(0, ((value - minimum) / (maximum - minimum)) * 100));
      input.style.setProperty("--sq-range-progress", `${progress}%`);
    };
    const syncBuilderRanges = () => { sqStudio.querySelectorAll('input[type="range"]').forEach(syncBuilderRange); syncBuilderSelects(); };
    sqStudio.addEventListener("input", (event) => { if (event.target.matches?.('input[type="range"]')) syncBuilderRange(event.target); });
    sqStudio.addEventListener("change", (event) => { if (event.target.matches?.('input[type="range"]')) syncBuilderRange(event.target); });
    enhanceBuilderSelects();
    syncBuilderRanges();
    const colorPicker = document.createElement("div");
    colorPicker.className = "sq-color-popover";
    colorPicker.hidden = true;
    colorPicker.setAttribute("role", "dialog");
    colorPicker.setAttribute("aria-label", "Color picker");
    colorPicker.innerHTML = `<header><div><small>Color</small><b>Choose a color</b></div><button type="button" data-sq-color-close aria-label="Close">×</button></header><div class="sq-color-picker-current"><i data-sq-color-preview></i><label><span>Hex</span><input type="text" maxlength="7" spellcheck="false" data-sq-color-hex></label></div><label class="sq-color-spectrum"><span>Saturation</span><input type="range" min="0" max="100" value="100" data-sq-color-saturation></label><label class="sq-color-lightness"><span>Lightness</span><input type="range" min="0" max="100" value="50" data-sq-color-lightness></label><label class="sq-color-hue"><span>Hue</span><input type="range" min="0" max="360" value="0" data-sq-color-hue></label><section><div><b>Document colors</b><small>Page palette</small></div><div class="sq-color-swatches" data-sq-document-colors></div></section><section><div><b>Recent</b><small>Cached on this device</small></div><div class="sq-color-swatches" data-sq-recent-colors></div></section><footer><button type="button" data-sq-color-cancel>Cancel</button><button type="button" data-sq-color-apply>Apply</button></footer>`;
    document.body.append(colorPicker);
    let colorPickerTarget = null;
    let colorPickerOriginal = "#ffffff";
    let colorPickerHsl = { h: 0, s: 100, l: 50 };
    const cachedColorKey = "ezkart-builder-recent-colors";
    const readCachedColors = () => { try { const value = JSON.parse(localStorage.getItem(cachedColorKey) || "[]"); return Array.isArray(value) ? value.filter((color) => /^#[0-9a-f]{6}$/i.test(color)).slice(0, 12) : []; } catch (_) { return []; } };
    const cacheColor = (color) => { try { localStorage.setItem(cachedColorKey, JSON.stringify([color.toUpperCase(), ...readCachedColors().filter((item) => item.toLowerCase() !== color.toLowerCase())].slice(0, 12))); } catch (_) {} };
    const hexToHsl = (hex) => {
      const value = hex.replace("#", "");
      const [r, g, b] = [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16) / 255);
      const maximum = Math.max(r, g, b), minimum = Math.min(r, g, b), delta = maximum - minimum;
      let h = 0;
      if (delta) h = maximum === r ? 60 * (((g - b) / delta) % 6) : maximum === g ? 60 * ((b - r) / delta + 2) : 60 * ((r - g) / delta + 4);
      const l = (maximum + minimum) / 2;
      const s = delta ? delta / (1 - Math.abs(2 * l - 1)) : 0;
      return { h: Math.round((h + 360) % 360), s: Math.round(s * 100), l: Math.round(l * 100) };
    };
    const hslToHex = ({ h, s, l }) => {
      const saturation = s / 100, lightness = l / 100, chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
      const x = chroma * (1 - Math.abs((h / 60) % 2 - 1)), m = lightness - chroma / 2;
      const [r, g, b] = h < 60 ? [chroma, x, 0] : h < 120 ? [x, chroma, 0] : h < 180 ? [0, chroma, x] : h < 240 ? [0, x, chroma] : h < 300 ? [x, 0, chroma] : [chroma, 0, x];
      return `#${[r, g, b].map((channel) => Math.round((channel + m) * 255).toString(16).padStart(2, "0")).join("")}`;
    };
    const renderColorSwatches = (container, colors) => {
      if (!container) return;
      container.replaceChildren(...colors.map((color) => { const button = document.createElement("button"); button.type = "button"; button.style.background = color; button.dataset.sqCachedColor = color; button.title = color.toUpperCase(); button.setAttribute("aria-label", `Use ${color}`); return button; }));
    };
    const documentColors = () => {
      const computed = previewRoot ? getComputedStyle(previewRoot) : null;
      return [...new Set(["--site-accent", "--site-page", "--site-ink", "--site-surface", "--button-primary-bg", "--button-primary-fg"].map((variable) => colorToHex(computed?.getPropertyValue(variable), "#ffffff").toUpperCase()))];
    };
    const syncColorPicker = (applyToTarget = true) => {
      const color = hslToHex(colorPickerHsl);
      const hex = colorPicker.querySelector("[data-sq-color-hex]");
      const preview = colorPicker.querySelector("[data-sq-color-preview]");
      if (hex && document.activeElement !== hex) hex.value = color.toUpperCase();
      if (preview) preview.style.background = color;
      colorPicker.style.setProperty("--sq-picker-hue", String(colorPickerHsl.h));
      colorPicker.querySelector("[data-sq-color-hue]").value = String(colorPickerHsl.h);
      colorPicker.querySelector("[data-sq-color-saturation]").value = String(colorPickerHsl.s);
      colorPicker.querySelector("[data-sq-color-lightness]").value = String(colorPickerHsl.l);
      if (applyToTarget && colorPickerTarget) { colorPickerTarget.value = color; colorPickerTarget.dispatchEvent(new Event("input", { bubbles: true })); }
    };
    const closeColorPicker = (commit = true) => {
      if (!colorPickerTarget) return;
      if (!commit) { colorPickerTarget.value = colorPickerOriginal; colorPickerTarget.dispatchEvent(new Event("input", { bubbles: true })); }
      else cacheColor(colorPickerTarget.value);
      colorPickerTarget.dispatchEvent(new Event("change", { bubbles: true }));
      colorPickerTarget = null;
      colorPicker.hidden = true;
    };
    const openColorPicker = (input) => {
      if (!input || input.disabled) return;
      if (colorPickerTarget && colorPickerTarget !== input) closeColorPicker(true);
      colorPickerTarget = input;
      colorPickerOriginal = /^#[0-9a-f]{6}$/i.test(input.value) ? input.value : "#ffffff";
      colorPickerHsl = hexToHsl(colorPickerOriginal);
      renderColorSwatches(colorPicker.querySelector("[data-sq-document-colors]"), documentColors());
      renderColorSwatches(colorPicker.querySelector("[data-sq-recent-colors]"), readCachedColors().length ? readCachedColors() : documentColors().slice(0, 4));
      colorPicker.hidden = false;
      const rect = input.getBoundingClientRect();
      const width = 286;
      const preferredLeft = rect.left >= width + 20 ? rect.left - width - 10 : rect.right + 10;
      colorPicker.style.left = `${Math.max(10, Math.min(innerWidth - width - 10, preferredLeft))}px`;
      colorPicker.style.top = `${Math.max(10, Math.min(innerHeight - colorPicker.offsetHeight - 10, rect.top))}px`;
      syncColorPicker(false);
      colorPicker.querySelector("[data-sq-color-hex]")?.focus({ preventScroll: true });
    };
    sqStudio.addEventListener("pointerdown", (event) => { const input = event.target.closest?.('input[type="color"]'); if (!input) return; event.preventDefault(); input.focus({ preventScroll: true }); openColorPicker(input); }, true);
    sqStudio.addEventListener("click", (event) => { if (event.target.closest?.('input[type="color"]')) event.preventDefault(); }, true);
    colorPicker.querySelectorAll("[data-sq-color-hue], [data-sq-color-saturation], [data-sq-color-lightness]").forEach((input) => input.addEventListener("input", () => { colorPickerHsl = { h: Number(colorPicker.querySelector("[data-sq-color-hue]").value), s: Number(colorPicker.querySelector("[data-sq-color-saturation]").value), l: Number(colorPicker.querySelector("[data-sq-color-lightness]").value) }; syncColorPicker(); }));
    colorPicker.querySelector("[data-sq-color-hex]")?.addEventListener("input", (event) => { if (/^#[0-9a-f]{6}$/i.test(event.currentTarget.value)) { colorPickerHsl = hexToHsl(event.currentTarget.value); syncColorPicker(); } });
    colorPicker.addEventListener("click", (event) => { const swatch = event.target.closest("[data-sq-cached-color]"); if (!swatch) return; colorPickerHsl = hexToHsl(swatch.dataset.sqCachedColor); syncColorPicker(); });
    colorPicker.querySelector("[data-sq-color-apply]")?.addEventListener("click", () => closeColorPicker(true));
    colorPicker.querySelector("[data-sq-color-cancel]")?.addEventListener("click", () => closeColorPicker(false));
    colorPicker.querySelector("[data-sq-color-close]")?.addEventListener("click", () => closeColorPicker(true));
    colorPicker.addEventListener("keydown", (event) => { if (event.key === "Escape") { event.preventDefault(); closeColorPicker(false); colorPickerOriginal = "#ffffff"; } });
    document.addEventListener("pointerdown", (event) => { if (!colorPicker.hidden && !colorPicker.contains(event.target) && event.target !== colorPickerTarget) closeColorPicker(true); });
    const productPrices = { granola: 58000, coffee: 79000, sambal: 46000 };
    const productNames = { granola: "Granola Madu Nusantara", coffee: "Kopi Susu Concentrate", sambal: "Sambal Roa Signature" };
    const productImages = { granola: "assets/products/granola.webp", coffee: "assets/products/kopi-susu.webp", sambal: "assets/products/sambal-roa.webp" };
    const productMeta = {
      granola: { type: "physical", stock: 46, weightGrams: 320, images: ["assets/products/granola.webp"] },
      coffee: { type: "physical", stock: 28, weightGrams: 650, images: ["assets/products/kopi-susu.webp"] },
      sambal: { type: "physical", stock: 34, weightGrams: 260, images: ["assets/products/sambal-roa.webp"] },
    };
    const sectionNames = { announcement: "Announcement", navigation: "Navigation", hero: "Hero", products: "Product collection", "image-story": "Image story", benefits: "Benefits", checkout: "Checkout", shipping: "Shipping" };
    const undoStack = [];
    const redoStack = [];
    const spacingState = new Map();
    const defaultPageSpacing = { gutters: { desktop: 60, tablet: 38, mobile: 22 }, columnGap: 10 };
    const pageSpacingState = JSON.parse(JSON.stringify(defaultPageSpacing));
    const defaultGridDensity = { desktop: 3, tablet: 3, mobile: 3 };
    const gridDensityState = { ...defaultGridDensity };
    const defaultGridColumns = { desktop: 12, tablet: 12, mobile: 12 };
    const gridColumnsState = { ...defaultGridColumns };
    const defaultGridCellHeight = { desktop: 24, tablet: 24, mobile: 24 };
    const gridCellHeightState = { ...defaultGridCellHeight };
    const inlineEditSnapshots = new WeakMap();
    const directDragSuppressClicks = new WeakSet();
    let selectedSection = "announcement";
    let selectedElement = null;
    let selectedAction = null;
    let selectedImage = null;
    let selectedContent = null;
    let activeDevice = "desktop";
    let draggedSection = "";
    let draggedImage = null;
    let draggedElementId = "";
    let libraryDrag = null;
    let libraryDropPreview = null;
    let draggedImageSnapshot = null;
    let showLayoutGrid = true;
    let layoutGridDragging = false;
    let layoutGridTransient = false;
    let layoutGridTimer = 0;
    let sectionHeightResizeTarget = null;
    let sectionHeightPreviewRows = 0;
    let scheduleProductGridFit = () => {};
    let saveTimer;
    let zoom = 90;
    const requestedSiteUrl = new URLSearchParams(window.location.search).get("edit") || "";
    const previewRepairMode = new URLSearchParams(window.location.search).get("preview-repair") === "1";
    let activeSiteKey = requestedSiteUrl;
    let activeSiteDocument = null;
    let siteLoadRequest = 0;
    let cloudSavePromise = Promise.resolve(true);
    let baseSiteState = null;
    let previewSavePromise = null;
    let previewScheduleTimer = 0;
    let previewRefreshPending = false;
    let previewRetryCount = 0;
    let previewRetrySource = "";
    const refreshLandingPreviewIfDue = () => {
      if (previewSavePromise) {
        previewRefreshPending = true;
        return previewSavePromise;
      }
      if (!previewRoot || !activeSiteDocument) return Promise.resolve(false);
      const landingId = landingPageId(activeSiteDocument.id || activeSiteKey);
      if (!landingId) return Promise.resolve(false);
      const sourceUpdatedAt = String(activeSiteDocument.updatedAt || "");
      if (!sourceUpdatedAt) return Promise.resolve(false);
      if (activeSiteDocument.previewVersion === landingPagePreviewVersion
        && activeSiteDocument.previewSourceUpdatedAt === sourceUpdatedAt
        && activeSiteDocument.previewUpdatedAt) return Promise.resolve(false);
      if (previewRetrySource !== sourceUpdatedAt) {
        previewRetrySource = sourceUpdatedAt;
        previewRetryCount = 0;
      }
      previewSavePromise = (async () => {
        const result = await cloudRequest("PUT", `/v1/landing-pages/${encodeURIComponent(landingId)}/preview`, {
          html: generateHtml({ libraryPreview: true }),
          sourceUpdatedAt,
        });
        const preview = result.preview || {};
        const current = cloudLandingPages.find((page) => page.id === landingId);
        const previewChanges = {
          previewUpdatedAt: preview.updatedAt,
          previewBytes: preview.bytes,
          previewSourceUpdatedAt: preview.sourceUpdatedAt,
          previewVersion: preview.version,
        };
        if (current && preview.updatedAt) replaceCloudLandingPage({ ...current, ...previewChanges });
        if (activeSiteDocument?.id === landingId && preview.updatedAt) {
          activeSiteDocument = normalizeCloudLandingPage({ ...activeSiteDocument, ...previewChanges });
        }
        previewRetryCount = 0;
        if (previewRepairMode && window.parent !== window) {
          window.parent.postMessage({ type: "ezkart-preview-repaired", landingPageId: landingId }, window.location.origin);
        }
        return !preview.skipped;
      })().catch((error) => {
        console.warn("Landing page preview refresh failed:", error);
        const currentSource = activeSiteDocument?.id === landingId ? String(activeSiteDocument.updatedAt || "") : "";
        if (currentSource && currentSource !== sourceUpdatedAt) {
          previewRefreshPending = true;
        } else if (currentSource && previewRetryCount < 3) {
          previewRetryCount += 1;
          window.clearTimeout(previewScheduleTimer);
          previewScheduleTimer = window.setTimeout(() => { void refreshLandingPreviewIfDue(); }, 2000 * previewRetryCount);
        } else if (currentSource) {
          showToast("Page saved, but its library preview could not update. Reopen the page to retry.");
          if (previewRepairMode && window.parent !== window) {
            window.parent.postMessage({ type: "ezkart-preview-repair-failed", landingPageId: landingId }, window.location.origin);
          }
        }
        return false;
      }).finally(() => {
        previewSavePromise = null;
        if (previewRefreshPending) {
          previewRefreshPending = false;
          scheduleLandingPreviewRefresh(250);
        }
      });
      return previewSavePromise;
    };
    const scheduleLandingPreviewRefresh = (delay = 1200) => {
      window.clearTimeout(previewScheduleTimer);
      previewScheduleTimer = window.setTimeout(() => { void refreshLandingPreviewIfDue(); }, delay);
    };

    const builderSidebar = sqStudio.querySelector(".sq-builder-sidebar");
    const openSqPanel = (name, { pin = false } = {}) => {
      sqStudio.querySelectorAll("[data-sq-tab]").forEach((button) => button.classList.toggle("active", button.dataset.sqTab === name || name === "pages" && button.dataset.sqTab === "layers"));
      sqStudio.querySelectorAll("[data-sq-panel]").forEach((panel) => panel.classList.toggle("active", panel.dataset.sqPanel === name));
      sqStudio.querySelectorAll("[data-sq-structure-view]").forEach((button) => button.classList.toggle("active", button.dataset.sqStructureView === (name === "pages" ? "pages" : "sections")));
      builderSidebar?.classList.toggle("sq-panel-pinned", pin || builderSidebar.classList.contains("sq-panel-pinned"));
      if (window.matchMedia("(max-width: 720px)").matches) sqStudio.classList.add("mobile-panel-open");
    };
    sqStudio.querySelectorAll("[data-sq-tab]").forEach((button) => button.addEventListener("click", () => openSqPanel(button.dataset.sqTab, { pin: true })));
    sqStudio.querySelectorAll("[data-sq-open-panel]").forEach((button) => button.addEventListener("click", () => openSqPanel(button.dataset.sqOpenPanel, { pin: true })));
    sqStudio.querySelectorAll("[data-sq-structure-view]").forEach((button) => button.addEventListener("click", () => openSqPanel(button.dataset.sqStructureView === "pages" ? "pages" : "layers", { pin: true })));
    document.addEventListener("pointerdown", (event) => {
      if (builderSidebar?.contains(event.target) || event.target.closest?.("[data-sq-edit-button-brand], [data-sq-open-panel], [data-sq-builder-select-menu]")) return;
      builderSidebar?.classList.remove("sq-panel-pinned");
    });

    const selectedProducts = () => [...sqStudio.querySelectorAll("[data-sq-product]:checked")].map((input) => input.value);
    const previewSnapshotHtml = () => {
      if (!previewRoot) return "";
      const clone = previewRoot.cloneNode(true);
      clone.querySelectorAll(".sq-element-overlay, .sq-section-toolbar, .sq-layout-grid-overlay, .sq-section-height-handle").forEach((overlay) => overlay.remove());
      clone.querySelectorAll('.sq-free-marquee .sq-marquee-copy[aria-hidden="true"]').forEach((copy) => copy.remove());
      clone.querySelectorAll(".sq-element-selected, .sq-image-selected, .sq-element-animate").forEach((element) => element.classList.remove("sq-element-selected", "sq-image-selected", "sq-element-animate"));
      clone.querySelectorAll(".sq-image-crop-editing, .sq-direct-dragging").forEach((element) => element.classList.remove("sq-image-crop-editing", "is-cropping", "sq-direct-dragging"));
      clone.querySelectorAll(".sq-image-scroll-host").forEach((host) => host.classList.remove("sq-image-scroll-host"));
      clone.querySelectorAll(".sq-image-scroll-media").forEach((image) => { image.classList.remove("sq-image-scroll-media"); image.style.removeProperty("transform"); });
      clone.querySelectorAll("[data-sq-nav-position]").forEach((navigation) => {
        navigation.classList.remove("sq-nav-is-stuck", "sq-nav-hidden");
        navigation.style.removeProperty("--sq-nav-editor-shift");
      });
      return clone.innerHTML;
    };
    const captureState = () => ({
      preview: previewSnapshotHtml(),
      previewClass: previewRoot?.className || "",
      previewStyle: previewRoot?.getAttribute("style") || "",
      productPicker: sqStudio.querySelector(".sq-product-picker")?.innerHTML || "",
      products: selectedProducts(),
      selectedSection,
      spacing: JSON.stringify([...spacingState.entries()]),
      pageSpacing: JSON.parse(JSON.stringify(pageSpacingState)),
      gridDensity: { ...gridDensityState },
      gridColumns: { ...gridColumnsState },
      gridCellHeight: { ...gridCellHeightState },
      catalog: { prices: { ...productPrices }, names: { ...productNames }, images: { ...productImages }, meta: JSON.parse(JSON.stringify(productMeta)) },
      version: 6,
    });
    const updateHistoryButtons = () => {
      if (undoButton) undoButton.disabled = undoStack.length === 0;
      if (redoButton) redoButton.disabled = redoStack.length === 0;
    };
    const remember = (snapshot = captureState()) => {
      undoStack.push(snapshot);
      if (undoStack.length > 40) undoStack.shift();
      redoStack.length = 0;
      updateHistoryButtons();
    };
    const persistCurrentState = (changes = {}) => {
      const site = readLandingSites().find((page) => page.url === activeSiteKey);
      if (!site) return Promise.resolve(false);
      const state = captureState();
      cloudSavePromise = cloudSavePromise.catch(() => false).then(async () => {
        try {
          activeSiteDocument = await saveCloudLandingPage(site, { state, ...changes });
          scheduleLandingPreviewRefresh();
          return true;
        } catch (error) {
          if (saveState) saveState.textContent = "Save failed";
          showToast(error instanceof Error ? error.message : "The landing page could not be saved.");
          return false;
        }
      });
      return cloudSavePromise;
    };
    const markSqChanged = () => {
      if (!saveState) return;
      saveState.textContent = "Saving…";
      window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(async () => { if (await persistCurrentState()) saveState.textContent = "Saved just now"; }, 550);
    };

    const formatRupiah = (amount) => `Rp${new Intl.NumberFormat("id-ID").format(amount)}`;
    const updateProductView = () => {
      const products = selectedProducts();
      const needsShipping = products.some((product) => (productMeta[product]?.type || "physical") === "physical");
      [...(previewRoot?.classList || [])].filter((name) => name.startsWith("product-count-")).forEach((name) => previewRoot.classList.remove(name));
      previewRoot?.classList.add(`product-count-${products.length}`);
      previewRoot?.classList.toggle("products-need-shipping", needsShipping);
      previewRoot?.querySelectorAll("[data-physical-only]").forEach((element) => { element.hidden = !needsShipping; });
      sqStudio.querySelectorAll("[data-product-card]").forEach((card) => { card.hidden = !products.includes(card.dataset.productCard); });
      sqStudio.querySelectorAll("[data-product-line]").forEach((line) => { line.hidden = !products.includes(line.dataset.productLine); });
      const productVisuals = [...sqStudio.querySelectorAll("[data-product-visual]")];
      productVisuals.forEach((visual) => { visual.hidden = true; visual.classList.remove("large"); });
      productVisuals.filter((visual) => products.includes(visual.dataset.productVisual)).slice(0, 3).forEach((visual, index) => { visual.hidden = false; visual.classList.toggle("large", index === 0); });
      const total = products.reduce((sum, product) => sum + (productPrices[product] || 0), 0);
      const totalTarget = sqStudio.querySelector("[data-sq-basket-total]");
      if (totalTarget) totalTarget.textContent = formatRupiah(total);
      sqStudio.querySelectorAll("[data-sq-product-count], [data-sq-layer-product-count]").forEach((target) => { target.textContent = String(products.length); });
      scheduleProductGridFit();
    };

    const maximumFluidRows = 80;
    const layoutKey = (device = activeDevice) => `layout${device[0].toUpperCase()}${device.slice(1)}`;
    const fluidColumns = (device = activeDevice) => Math.max(2, Math.min(24, Number(gridColumnsState[device]) || 12));
    const fluidMinRowsKey = (device = activeDevice) => `sqMinRows${device[0].toUpperCase()}${device.slice(1)}`;
    const fluidMinRows = (section, device = activeDevice) => Math.max(1, Number.parseInt(section?.dataset[fluidMinRowsKey(device)] || section?.dataset.sqMinRows || section?.dataset.sqRows || "12", 10));
    const parseElementLayout = (element, device = activeDevice) => {
      const raw = element?.dataset[layoutKey(device)] || element?.dataset.layoutDesktop || "1,1,12,4";
      const [x, y, width, height] = raw.split(",").map((value) => Number.parseInt(value, 10));
      const columns = fluidColumns(device);
      const safeWidth = Math.max(1, Math.min(columns, width || columns));
      return {
        x: Math.max(1, Math.min(columns - safeWidth + 1, x || 1)),
        y: Math.max(1, y || 1),
        width: safeWidth,
        height: Math.max(1, height || 4),
      };
    };
    const setElementLayout = (element, layout, device = activeDevice) => {
      if (!element) return;
      const columns = fluidColumns(device);
      const width = Math.max(1, Math.min(columns, Number(layout.width) || 1));
      const normalized = {
        x: Math.max(1, Math.min(columns - width + 1, Number(layout.x) || 1)),
        y: Math.max(1, Math.min(maximumFluidRows, Number(layout.y) || 1)),
        width,
        height: Math.max(1, Math.min(maximumFluidRows, Number(layout.height) || 1)),
      };
      element.dataset[layoutKey(device)] = `${normalized.x},${normalized.y},${normalized.width},${normalized.height}`;
      if (device === activeDevice) {
        element.style.gridColumn = `${normalized.x} / span ${normalized.width}`;
        element.style.gridRow = `${normalized.y} / span ${normalized.height}`;
      }
      return normalized;
    };
    const elementInsetProperty = (device = activeDevice) => `--sq-inset-${device}`;
    const elementInsetFor = (element, device = activeDevice) => {
      const raw = element?.style.getPropertyValue(elementInsetProperty(device)).trim() || "0px 0px 0px 0px";
      const values = raw.split(/\s+/).map((value) => Math.max(0, Math.min(240, Number.parseFloat(value) || 0)));
      if (values.length === 1) return { top: values[0], right: values[0], bottom: values[0], left: values[0] };
      if (values.length === 2) return { top: values[0], right: values[1], bottom: values[0], left: values[1] };
      if (values.length === 3) return { top: values[0], right: values[1], bottom: values[2], left: values[1] };
      return { top: values[0], right: values[1], bottom: values[2], left: values[3] };
    };
    const setElementInset = (element, values, device = activeDevice) => {
      if (!element) return;
      const normalized = ["top", "right", "bottom", "left"].map((side) => Math.max(0, Math.min(240, Number(values[side]) || 0)));
      element.classList.add("sq-custom-inset");
      element.style.setProperty(elementInsetProperty(device), normalized.map((value) => `${value}px`).join(" "));
    };
    const productSettingKey = (setting, device = activeDevice) => `sqProduct${setting}${device[0].toUpperCase()}${device.slice(1)}`;
    const productGridSettings = (element, device = activeDevice) => ({
      columns: element?.dataset[productSettingKey("Columns", device)] || "auto",
      density: element?.dataset[productSettingKey("Density", device)] || "balanced",
    });
    const applyProductGridLayout = (element, device = activeDevice) => {
      if (element?.dataset.sqElementType !== "product-grid") return;
      const settings = productGridSettings(element, device);
      element.classList.remove("product-layout-auto", "product-layout-fixed", "product-density-compact", "product-density-balanced", "product-density-showcase");
      element.classList.add(settings.columns === "auto" ? "product-layout-auto" : "product-layout-fixed", `product-density-${settings.density}`);
      if (settings.columns === "auto") element.style.removeProperty("--sq-product-columns");
      else element.style.setProperty("--sq-product-columns", settings.columns);
    };
    const layoutsOverlap = (first, second) => !(
      first.x + first.width <= second.x ||
      second.x + second.width <= first.x ||
      first.y + first.height <= second.y ||
      second.y + second.height <= first.y
    );
    const findOpenElementLayout = (section, desired, device = activeDevice) => {
      const columns = fluidColumns(device);
      const width = Math.max(1, Math.min(columns, Number(desired.width) || 4));
      const height = Math.max(1, Math.min(maximumFluidRows, Number(desired.height) || 2));
      const minimumRows = fluidMinRows(section, device);
      const occupied = [...(section?.querySelectorAll(":scope > [data-sq-element]") || [])]
        .filter((element) => !element.classList.contains("sq-element-hidden"))
        .map((element) => parseElementLayout(element, device));
      const maximumOccupiedRow = occupied.reduce((maximum, layout) => Math.max(maximum, layout.y + layout.height - 1), minimumRows);
      const preferredX = Math.max(1, Math.round((columns - width + 2) / 2));
      const preferredY = Math.max(1, Math.round((minimumRows - height) / 2) + 1);
      const xCandidates = Array.from({ length: columns - width + 1 }, (_, index) => index + 1)
        .sort((a, b) => Math.abs(a - preferredX) - Math.abs(b - preferredX));
      const rowsToSearch = Math.min(maximumFluidRows - height + 1, Math.max(minimumRows - height + 1, maximumOccupiedRow + 2));
      const yCandidates = Array.from({ length: rowsToSearch }, (_, index) => index + 1)
        .sort((a, b) => Math.abs(a - preferredY) - Math.abs(b - preferredY));
      for (const y of yCandidates) {
        for (const x of xCandidates) {
          const candidate = { x, y, width, height };
          if (!occupied.some((layout) => layoutsOverlap(candidate, layout))) return candidate;
        }
      }
      return { x: preferredX, y: Math.min(maximumFluidRows - height + 1, maximumOccupiedRow + 1), width, height };
    };
    const gridDensityPresets = {
      1: { columns: 8, cellHeight: 42, label: "Roomy" },
      2: { columns: 10, cellHeight: 32, label: "Open" },
      3: { columns: 12, cellHeight: 24, label: "Balanced" },
      4: { columns: 16, cellHeight: 16, label: "Fine" },
      5: { columns: 20, cellHeight: 8, label: "Ultra fine" },
    };
    const gridDensityLabel = (density) => gridDensityPresets[density]?.label || "Custom";
    const matchingGridDensity = (device = activeDevice) => Number(Object.keys(gridDensityPresets).find((density) => {
      const preset = gridDensityPresets[density];
      return preset.columns === fluidColumns(device) && preset.cellHeight === gridCellHeightState[device];
    })) || 0;
    const gridBaseRowHeight = (device = activeDevice) => gridCellHeightState[device] + pageSpacingState.columnGap;
    const fluidRowHeight = (section, device = activeDevice) => {
      const base = gridBaseRowHeight(device);
      if (section?.classList.contains("sq-announcement")) return Math.max(7, Math.round(base * 10 / 34));
      if (section?.classList.contains("sq-store-nav")) return Math.max(24, Math.round(base * 36 / 34));
      if (section?.classList.contains("sq-benefit-row")) return Math.max(16, Math.round(base * (device === "mobile" ? 34 : 22) / 34));
      if (section?.classList.contains("sq-shipping-section")) return Math.max(16, Math.round(base * 22 / 34));
      if (section?.classList.contains("sq-product-section")) return Math.max(18, Math.round(base * 28 / 34));
      return base;
    };
    const updateGridGeometry = (device, { columns = fluidColumns(device), cellHeight = gridCellHeightState[device] } = {}) => {
      const nextColumns = Math.max(2, Math.min(24, Math.round(Number(columns) || 12)));
      const nextCellHeight = Math.max(6, Math.min(72, Math.round(Number(cellHeight) || 24)));
      if (nextColumns === fluidColumns(device) && nextCellHeight === gridCellHeightState[device]) return;
      const previousColumns = fluidColumns(device);
      const sections = [...(previewRoot?.querySelectorAll("[data-sq-fluid]") || [])];
      const geometry = sections.map((section) => ({
        section,
        rowHeight: fluidRowHeight(section, device),
        minimumRows: fluidMinRows(section, device),
        elements: [...section.querySelectorAll(":scope > [data-sq-element]")].map((element) => ({ element, layout: parseElementLayout(element, device) })),
      }));
      gridColumnsState[device] = nextColumns;
      gridCellHeightState[device] = nextCellHeight;
      geometry.forEach(({ section, rowHeight, minimumRows, elements }) => {
        const scale = rowHeight / fluidRowHeight(section, device);
        section.dataset[fluidMinRowsKey(device)] = String(Math.max(1, Math.min(maximumFluidRows, Math.round(minimumRows * scale))));
        elements.forEach(({ element, layout }) => {
          const left = Math.round((layout.x - 1) * nextColumns / previousColumns) + 1;
          const right = Math.round((layout.x - 1 + layout.width) * nextColumns / previousColumns);
          setElementLayout(element, {
            ...layout,
            x: left,
            width: Math.max(1, right - left + 1),
            y: Math.max(1, Math.round((layout.y - 1) * scale) + 1),
            height: Math.max(1, Math.round(layout.height * scale)),
          }, device);
        });
      });
    };
    const setGridDensity = (device, density) => {
      const nextDensity = Math.max(1, Math.min(5, Math.round(Number(density) || 3)));
      const preset = gridDensityPresets[nextDensity];
      gridDensityState[device] = nextDensity;
      updateGridGeometry(device, { columns: preset.columns, cellHeight: preset.cellHeight });
    };
    const syncSectionEdgeVariables = (section) => {
      if (!section) return;
      const computed = getComputedStyle(section);
      section.style.setProperty("--sq-section-pad-left", computed.paddingLeft || "0px");
      section.style.setProperty("--sq-section-pad-right", computed.paddingRight || "0px");
    };
    const applyFluidSection = (section) => {
      if (!section?.matches("[data-sq-fluid]")) return;
      syncSectionEdgeVariables(section);
      if (!section.dataset.sqMinRows) section.dataset.sqMinRows = section.dataset.sqRows || "12";
      let rows = fluidMinRows(section);
      section.querySelectorAll(":scope > [data-sq-element]").forEach((element) => {
        const layout = setElementLayout(element, parseElementLayout(element));
        applyProductGridLayout(element);
        rows = Math.max(rows, layout.y + layout.height - 1);
      });
      section.dataset.sqRows = String(rows);
      section.style.setProperty("--sq-fluid-rows", String(rows));
      section.style.setProperty("--sq-fluid-row-height", `${fluidRowHeight(section)}px`);
      section.style.setProperty("--sq-fluid-columns", String(fluidColumns()));
      const heightHandle = section.querySelector(":scope > .sq-section-height-handle");
      if (heightHandle) {
        const contentRows = [...section.querySelectorAll(":scope > [data-sq-element]")].reduce((maximum, element) => {
          const layout = parseElementLayout(element);
          return Math.max(maximum, layout.y + layout.height - 1);
        }, 1);
        heightHandle.setAttribute("aria-valuemin", String(contentRows));
        heightHandle.setAttribute("aria-valuenow", String(rows));
        heightHandle.setAttribute("aria-valuetext", `${rows} grid rows`);
      }
    };
    const applyFluidLayouts = () => previewRoot?.querySelectorAll("[data-sq-fluid]").forEach(applyFluidSection);
    const sectionContentRows = (section, device = activeDevice) => [...(section?.querySelectorAll(":scope > [data-sq-element]") || [])].reduce((maximum, element) => {
      const layout = parseElementLayout(element, device);
      return Math.max(maximum, layout.y + layout.height - 1);
    }, 1);
    const setSectionHeightRows = (section, value, device = activeDevice) => {
      if (!section?.matches("[data-sq-fluid]")) return 1;
      const minimum = sectionContentRows(section, device);
      const rows = Math.max(minimum, Math.min(maximumFluidRows, Math.round(Number(value) || minimum)));
      section.dataset[fluidMinRowsKey(device)] = String(rows);
      if (device === activeDevice) applyFluidSection(section);
      return rows;
    };
    const ensureSectionHeightHandle = (section) => {
      if (!section?.matches("[data-sq-fluid]")) return;
      let handle = section.querySelector(":scope > .sq-section-height-handle");
      if (!handle) {
        handle = document.createElement("button");
        handle.type = "button";
        handle.className = "sq-section-height-handle";
        handle.dataset.sqSectionHeightHandle = "";
        handle.setAttribute("role", "slider");
        handle.setAttribute("aria-orientation", "vertical");
        handle.setAttribute("aria-valuemax", String(maximumFluidRows));
        handle.innerHTML = '<span aria-hidden="true">↕</span><small>Drag section edge</small>';
        section.append(handle);
      }
      handle.draggable = false;
      handle.setAttribute("aria-label", `Resize ${String(section.dataset.sectionId || "page").replace(/-/g, " ")} section`);
      const initialMinimum = sectionContentRows(section);
      const rows = Math.max(initialMinimum, Number.parseInt(section.dataset.sqRows || section.dataset.sqMinRows || String(initialMinimum), 10));
      handle.setAttribute("aria-valuemin", String(initialMinimum));
      handle.setAttribute("aria-valuenow", String(rows));
      handle.setAttribute("aria-valuetext", `${rows} grid rows`);
      handle.onclick = (event) => event.stopPropagation();
      handle.onpointerdown = (event) => {
        event.preventDefault();
        event.stopPropagation();
        const minimum = sectionContentRows(section);
        handle.setAttribute("aria-valuemin", String(minimum));
        const snapshot = captureState();
        const startY = event.clientY;
        const startRows = Math.max(minimum, Number.parseInt(section.dataset.sqRows || String(minimum), 10));
        const sectionRect = section.getBoundingClientRect();
        const renderedScale = section.offsetWidth ? sectionRect.width / section.offsetWidth : zoom / 100;
        const logicalRowHeight = fluidRowHeight(section);
        const startHeight = sectionRect.height / Math.max(.01, renderedScale);
        const minimumHeight = Math.max(logicalRowHeight, startHeight - (startRows - minimum) * logicalRowHeight);
        const maximumHeight = minimumHeight + (maximumFluidRows - minimum) * logicalRowHeight;
        const wasDraggable = section.draggable;
        let currentRows = startRows;
        section.draggable = false;
        handle.setPointerCapture?.(event.pointerId);
        sectionHeightResizeTarget = section;
        sectionHeightPreviewRows = startRows;
        section.classList.add("sq-section-height-dragging");
        section.style.setProperty("--sq-section-drag-height", `${startHeight}px`);
        section.style.setProperty("--sq-fluid-rows", String(minimum));
        layoutGridDragging = true;
        refreshLayoutGrid();
        handle.classList.add("dragging");
        document.body.classList.add("sq-section-height-resizing");
        const move = (pointerEvent) => {
          const nextHeight = Math.max(minimumHeight, Math.min(maximumHeight, startHeight + (pointerEvent.clientY - startY) / Math.max(.01, renderedScale)));
          section.style.setProperty("--sq-section-drag-height", `${nextHeight}px`);
          currentRows = Math.max(minimum, Math.min(maximumFluidRows, minimum + Math.round((nextHeight - minimumHeight) / logicalRowHeight)));
          sectionHeightPreviewRows = currentRows;
          refreshLayoutGrid();
          if (selectedElement?.isConnected && section.contains(selectedElement)) refreshElementOverlay();
        };
        const end = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", end);
          window.removeEventListener("pointercancel", end);
          handle.classList.remove("dragging");
          section.draggable = wasDraggable;
          section.classList.remove("sq-section-height-dragging");
          section.style.removeProperty("--sq-section-drag-height");
          setSectionHeightRows(section, currentRows);
          document.body.classList.remove("sq-section-height-resizing");
          layoutGridDragging = false;
          sectionHeightResizeTarget = null;
          sectionHeightPreviewRows = 0;
          if (showLayoutGrid) refreshLayoutGrid(); else removeLayoutGrid(true);
          if (currentRows !== startRows) { remember(snapshot); markSqChanged(); }
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", end, { once: true });
        window.addEventListener("pointercancel", end, { once: true });
      };
      handle.onkeydown = (event) => {
        if (!["ArrowUp", "ArrowDown"].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        const minimum = sectionContentRows(section);
        handle.setAttribute("aria-valuemin", String(minimum));
        const snapshot = captureState();
        const current = Number.parseInt(section.dataset.sqRows || String(minimum), 10);
        const next = setSectionHeightRows(section, current + (event.key === "ArrowDown" ? 1 : -1));
        if (next !== current) { remember(snapshot); markSqChanged(); }
      };
    };
    let productGridFitFrame = 0;
    const observedProductCards = new WeakSet();
    const productCardObserver = typeof ResizeObserver === "function" ? new ResizeObserver(() => scheduleProductGridFit()) : null;
    const fitProductGridHeight = (grid) => {
      const section = grid?.closest("[data-sq-fluid]");
      const cards = [...(grid?.querySelectorAll(":scope > [data-product-card]") || [])].filter((card) => !card.hidden);
      if (!section || !cards.length) return false;
      const gridRect = grid.getBoundingClientRect();
      const renderedScale = grid.offsetWidth ? gridRect.width / grid.offsetWidth : 1;
      const contentHeight = Math.max(...cards.map((card) => (card.getBoundingClientRect().bottom - gridRect.top) / Math.max(.01, renderedScale)));
      const rowGap = Number.parseFloat(getComputedStyle(section).rowGap) || 0;
      const requiredRows = Math.max(1, Math.min(maximumFluidRows, Math.ceil((contentHeight + rowGap) / fluidRowHeight(section))));
      const layout = parseElementLayout(grid);
      if (requiredRows === layout.height) return false;
      setElementLayout(grid, { ...layout, height: requiredRows });
      return true;
    };
    scheduleProductGridFit = () => {
      window.cancelAnimationFrame(productGridFitFrame);
      productGridFitFrame = window.requestAnimationFrame(() => {
        const changedSections = new Set();
        previewRoot?.querySelectorAll("[data-sq-product-grid]").forEach((grid) => {
          grid.querySelectorAll(":scope > [data-product-card]").forEach((card) => {
            if (!observedProductCards.has(card)) { observedProductCards.add(card); productCardObserver?.observe(card); }
          });
          if (fitProductGridHeight(grid)) changedSections.add(grid.closest("[data-sq-fluid]"));
        });
        changedSections.forEach(applyFluidSection);
        if (changedSections.size && selectedElement?.matches("[data-sq-product-grid]")) {
          syncElementControls();
          refreshElementOverlay();
        }
      });
    };
    const removeLayoutGrid = (animate = false, duration = 360) => previewRoot?.querySelectorAll(".sq-layout-grid-overlay").forEach((grid) => {
      if (!animate) { grid.remove(); return; }
      grid.style.setProperty("--sq-grid-dismiss-duration", `${duration}ms`);
      grid.classList.add("is-hiding");
      window.setTimeout(() => { if (grid.classList.contains("is-hiding")) grid.remove(); }, duration);
    });
    const refreshLayoutGrid = () => {
      const visible = showLayoutGrid || layoutGridDragging || layoutGridTransient;
      if (!visible) { removeLayoutGrid(true); return; }
      const section = sectionHeightResizeTarget || selectedElement?.closest("[data-sq-fluid]") || previewRoot?.querySelector(`[data-section-id="${selectedSection}"][data-sq-fluid]`) || previewRoot?.querySelector("[data-sq-fluid]");
      if (!section) return;
      previewRoot?.querySelectorAll(".sq-layout-grid-overlay").forEach((candidate) => { if (candidate.parentElement !== section) candidate.remove(); });
      const rows = Math.max(1, section === sectionHeightResizeTarget && sectionHeightPreviewRows > 0
        ? sectionHeightPreviewRows
        : Number.parseInt(section.dataset.sqRows || section.dataset.sqMinRows || "12", 10));
      const computed = getComputedStyle(section);
      let grid = section.querySelector(":scope > .sq-layout-grid-overlay");
      if (!grid) {
        grid = document.createElement("div");
        grid.className = "sq-layout-grid-overlay";
        grid.setAttribute("aria-hidden", "true");
        section.prepend(grid);
      }
      grid.classList.remove("is-hiding");
      grid.style.left = computed.paddingLeft;
      grid.style.right = computed.paddingRight;
      grid.style.top = computed.paddingTop;
      grid.style.setProperty("--sq-grid-rows", String(rows));
      grid.style.setProperty("--sq-grid-row-height", `${fluidRowHeight(section)}px`);
      grid.style.setProperty("--sq-grid-gap", computed.columnGap || "0px");
      grid.style.setProperty("--sq-grid-columns", String(fluidColumns()));
      const cellCount = rows * fluidColumns();
      if (grid.childElementCount !== cellCount) {
        const cells = document.createDocumentFragment();
        for (let index = 0; index < cellCount; index += 1) cells.append(document.createElement("i"));
        grid.replaceChildren(cells);
      }
    };
    const revealLayoutGrid = (duration = 900) => {
      layoutGridTransient = true;
      window.clearTimeout(layoutGridTimer);
      refreshLayoutGrid();
      const hold = 100;
      layoutGridTimer = window.setTimeout(() => {
        layoutGridTransient = false;
        if (showLayoutGrid || layoutGridDragging) { refreshLayoutGrid(); return; }
        removeLayoutGrid(true, Math.max(260, duration - hold));
      }, hold);
    };
    const elementTypeName = (element) => element?.dataset.sqElementType === "component-instance"
      ? `${element.dataset.sqComponentName || "Component"} instance`
      : element?.dataset.sqElementType === "navigation" ? "Navigation bar"
      : (element?.dataset.sqElementType || "element").replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
    const reviewRating = (element) => Math.max(1, Math.min(5, Math.round(Number(element?.dataset.sqReviewRating) || 5)));
    const renderReviewStars = (element, value = reviewRating(element)) => {
      if (!element?.matches('[data-sq-element-type="review"]')) return;
      const rating = Math.max(1, Math.min(5, Math.round(Number(value) || 5)));
      element.dataset.sqReviewRating = String(rating);
      let stars = element.querySelector(":scope > .sq-review-stars");
      if (!stars) {
        stars = document.createElement("div");
        stars.className = "sq-review-stars";
        element.prepend(stars);
      }
      stars.setAttribute("role", "img");
      stars.setAttribute("aria-label", `${rating} out of 5 stars`);
      stars.innerHTML = Array.from({ length: 5 }, (_, index) => `<span aria-hidden="true" class="${index < rating ? "active" : ""}">★</span>`).join("");
    };
    const heroPieceLayout = (base, role) => {
      const headingHeight = Math.max(3, Math.round(base.height * .42));
      const descriptionHeight = Math.max(2, Math.round(base.height * .22));
      const descriptionY = base.y + 1 + headingHeight;
      const actionY = Math.min(base.y + base.height - 2, descriptionY + descriptionHeight);
      const actionWidth = Math.min(base.width, Math.max(3, Math.ceil(base.width * .44)));
      const trustWidth = Math.max(1, base.width - actionWidth);
      if (role === "eyebrow") return { x: base.x, y: base.y, width: base.width, height: 1 };
      if (role === "heading") return { x: base.x, y: base.y + 1, width: base.width, height: headingHeight };
      if (role === "text") return { x: base.x, y: descriptionY, width: base.width, height: descriptionHeight };
      if (role === "button") return { x: base.x, y: actionY, width: actionWidth, height: 2 };
      return { x: base.x + actionWidth, y: actionY, width: trustWidth, height: 2 };
    };
    const copyElementAttributes = (source, target) => {
      [...source.attributes].forEach((attribute) => target.setAttribute(attribute.name, attribute.value));
      return target;
    };
    const upgradeLegacyStructure = () => {
      previewRoot?.querySelectorAll('.sq-store-nav > [data-sq-element-type="brand"]').forEach((brand) => {
        if (brand.classList.contains("sq-site-logo")) return;
        const logo = copyElementAttributes(brand, document.createElement("div"));
        logo.className = `sq-site-logo ${brand.className}`.trim();
        logo.dataset.sqElementType = "logo";
        const image = document.createElement("img");
        image.dataset.sqLogoImage = "";
        image.alt = "";
        image.hidden = true;
        const text = document.createElement("b");
        text.dataset.sqLogoText = "";
        text.textContent = brand.textContent.trim() || "Your brand";
        logo.replaceChildren(image, text);
        brand.replaceWith(logo);
      });
      previewRoot?.querySelectorAll('.sq-hero > .sq-hero-copy[data-sq-element-type="copy"]').forEach((composite) => {
        const section = composite.closest("[data-sq-fluid]");
        if (!section) return;
        const pieces = [
          [composite.querySelector(":scope > span"), "eyebrow", "sq-hero-kicker"],
          [composite.querySelector(":scope > h1"), "heading", "sq-hero-heading"],
          [composite.querySelector(":scope > p"), "text", "sq-hero-description"],
          [composite.querySelector(":scope > div > button, :scope > button"), "button", "sq-hero-action button-primary"],
          [composite.querySelector(":scope > div > small, :scope > small"), "trust-note", "sq-hero-trust"],
        ].filter(([node]) => node);
        pieces.forEach(([node, type, className]) => {
          node.className = `${node.className} ${className}`.trim();
          node.dataset.sqElement = "";
          node.dataset.sqElementType = type;
          if (type === "button") {
            node.dataset.sqButtonRole ||= composite.dataset.sqButtonRole || "primary";
            node.dataset.sqLinkType ||= inferredActionType(node);
            node.dataset.sqLink ||= inferredActionTarget(node, node.dataset.sqLinkType);
            node.dataset.sqNewTab ||= "false";
          }
          if (composite.dataset.sqElementAnimation) {
            node.dataset.sqElementAnimation = composite.dataset.sqElementAnimation;
            node.classList.add(`element-animation-${composite.dataset.sqElementAnimation}`);
          }
          ["desktop", "tablet", "mobile"].forEach((device) => setElementLayout(node, heroPieceLayout(parseElementLayout(composite, device), type === "trust-note" ? "trust" : type), device));
          composite.before(node);
        });
        composite.remove();
        section.classList.add("sq-hero-elements");
      });
      const heroSection = previewRoot?.querySelector('[data-section-id="hero"]') || previewRoot?.querySelector(":scope > [data-sq-block]:not(.sq-store-nav):not(.sq-announcement)");
      previewRoot?.querySelectorAll(":scope > .sq-page-background").forEach((legacyLayer) => {
        if (heroSection && !heroSection.querySelector(":scope > .sq-section-background")) {
          legacyLayer.className = "sq-section-background";
          legacyLayer.dataset.sqBackgroundScope = "section";
          heroSection.dataset.sqBackgroundType = "image";
          heroSection.prepend(legacyLayer);
        } else {
          legacyLayer.remove();
        }
      });
      previewRoot?.querySelectorAll(":scope > [data-sq-block]").forEach((section) => {
        section.dataset.sqBackgroundType ||= section.querySelector(":scope > .sq-section-background img") ? "image" : "solid";
      });
    };
    const colorToHex = (value, fallback = "#ffffff") => {
      if (/^#[0-9a-f]{6}$/i.test(value || "")) return value.toLowerCase();
      const match = String(value || "").match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
      return match ? `#${match.slice(1, 4).map((part) => Number(part).toString(16).padStart(2, "0")).join("")}` : fallback;
    };
    const isTransparentColor = (value) => /transparent/i.test(String(value || "")) || /rgba\([^)]*,\s*0(?:\.0+)?\s*\)/i.test(String(value || ""));
    const codeSourceFor = (element) => element?.querySelector("template[data-sq-code-source]")?.innerHTML || "";
    const renderCodeElement = (element) => {
      const frame = element?.querySelector("iframe[data-sq-code-render]");
      if (!frame) return;
      const source = codeSourceFor(element);
      frame.onload = () => frame.contentWindow?.postMessage({ type: "ezkart-render-code", html: source }, "*");
      frame.src = `code-preview.php?render=${Date.now()}`;
    };
    const componentForId = (componentId) => readComponents().find((component) => component.id === componentId) || null;
    const syncComponentInstance = (element) => {
      if (!element?.matches('[data-sq-element-type="component-instance"]')) return;
      const main = componentForId(element.dataset.sqComponentId);
      if (!main) return;
      element.dataset.sqComponentName = main.name;
      const source = element.querySelector("template[data-sq-code-source]");
      if (source && source.innerHTML !== main.code) source.innerHTML = main.code;
      renderCodeElement(element);
    };
    const actionForElement = (element = selectedElement) => {
      if (selectedAction?.isConnected && element?.contains(selectedAction)) return selectedAction;
      if (element?.matches("button,a")) return element;
      return element?.querySelector("button,a") || null;
    };
    const applyButtonRoleToElement = (element, role = "primary") => {
      if (!element) return;
      const roleClasses = ["button-primary", "button-secondary", "button-tertiary"];
      element.dataset.sqButtonRole = role;
      if (element.dataset.sqElementType === "product-grid") {
        element.classList.remove(...roleClasses);
        element.querySelectorAll("article footer > button").forEach((button) => {
          button.classList.remove(...roleClasses);
          button.classList.add(`button-${role}`);
        });
        return;
      }
      element.classList.remove(...roleClasses);
      element.classList.add(`button-${role}`);
    };
    const imageForElement = (element = selectedElement) => {
      if (selectedImage?.isConnected && element?.contains(selectedImage)) return selectedImage;
      if (element?.matches("img")) return element;
      return element?.querySelector("img") || null;
    };
    const imageVisualHostFor = (image) => {
      const item = image?.closest("[data-sq-image-item]");
      return item && item !== image ? item : image?.parentElement || null;
    };
    const inferredActionType = (action) => {
      if (!action) return "none";
      if (action.dataset.sqLinkType) return action.dataset.sqLinkType;
      const href = action.getAttribute("href") || "";
      if (href.startsWith("#")) return "section";
      if (href.startsWith("mailto:")) return "email";
      if (href.startsWith("tel:")) return "phone";
      if (/checkout|buy now|secure checkout|add to cart/i.test(action.textContent)) return "checkout";
      return href ? "url" : "section";
    };
    const inferredActionTarget = (action, type = inferredActionType(action)) => {
      if (!action) return "";
      if (action.dataset.sqLink != null) return action.dataset.sqLink;
      const href = action.getAttribute("href") || "";
      if (type === "section") {
        if (href) return href.replace(/^#/, "");
        if (/story|made/i.test(action.textContent)) return "story";
        if (/delivery|shipping/i.test(action.textContent)) return "shipping";
        return "products";
      }
      if (type === "email") return href.replace(/^mailto:/, "");
      if (type === "phone") return href.replace(/^tel:/, "");
      return href;
    };
    const safeActionTarget = (type, rawTarget) => {
      const target = String(rawTarget || "").trim();
      if (type === "section") return /^[a-z][a-z0-9_:.-]*$/i.test(target.replace(/^#/, "")) ? target.replace(/^#/, "") : "";
      if (type === "email") return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target) ? target : "";
      if (type === "phone") return /^\+?[\d\s().-]{7,24}$/.test(target) ? target : "";
      if (type !== "url") return target;
      if (/^(https?:\/\/|\/(?!\/)|\.\.?\/)/i.test(target)) return target;
      if (/^[a-z0-9.-]+\.[a-z]{2,}(?:[/:?#]|$)/i.test(target)) return `https://${target}`;
      return "";
    };
    const imageDefaults = { blur: 0, brightness: 100, contrast: 100, saturate: 100, grayscale: 0, opacity: 100 };
    const imageCropValue = (image, key, fallback) => {
      const value = Number(image?.dataset[`sqImageCrop${key}`]);
      return Number.isFinite(value) ? value : fallback;
    };
    const imageCropZoom = (image) => Math.max(1, Math.min(3, imageCropValue(image, "Zoom", 100) / 100));
    const applyImageCrop = (image) => {
      if (!image) return;
      const x = Math.max(0, Math.min(100, imageCropValue(image, "X", 50)));
      const y = Math.max(0, Math.min(100, imageCropValue(image, "Y", 50)));
      const zoom = imageCropZoom(image);
      image.style.objectPosition = `${x}% ${y}%`;
      image.style.setProperty("--sq-image-crop-zoom", zoom.toFixed(3));
      image.classList.toggle("sq-image-crop-media", zoom !== 1 || x !== 50 || y !== 50);
    };
    const imageBlendModes = new Set(["normal", "multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn", "hard-light", "soft-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity"]);
    const imageBlendMode = (image) => imageBlendModes.has(image?.dataset.sqImageBlendMode) ? image.dataset.sqImageBlendMode : "normal";
    const imageBlendSource = (image) => image?.dataset.sqImageBlendSource === "behind" ? "behind" : "color";
    const imageBlendColor = (image) => /^#[0-9a-f]{6}$/i.test(image?.dataset.sqImageBlendColor || "") ? image.dataset.sqImageBlendColor.toLowerCase() : "";
    const defaultImageBlendColor = () => previewRoot ? colorToHex(getComputedStyle(previewRoot).getPropertyValue("--site-accent"), "#f44b34") : "#f44b34";
    const applyImageBlend = (image) => {
      if (!image) return;
      const host = imageVisualHostFor(image);
      const source = imageBlendSource(image);
      if (source === "color" && imageBlendColor(image) && imageBlendMode(image) === "normal" && image.dataset.sqImageBlendNormal !== "true") image.dataset.sqImageBlendMode = "multiply";
      const mode = imageBlendMode(image);
      if (mode !== "normal" && source === "color" && !image.hasAttribute("data-sq-image-blend-color")) image.dataset.sqImageBlendColor = defaultImageBlendColor();
      const color = imageBlendColor(image);
      const active = mode !== "normal" || (source === "color" && Boolean(color));
      image.style.mixBlendMode = mode !== "normal" && source === "color" ? mode : "";
      image.classList.toggle("sq-image-blend-media", active);
      if (!host) return;
      host.classList.toggle("sq-image-blend-host", active);
      host.classList.toggle("sq-image-blend-through", mode !== "normal" && source === "behind");
      host.style.mixBlendMode = mode !== "normal" && source === "behind" ? mode : "";
      if (source === "color" && color) host.style.setProperty("--sq-image-blend-color", color);
      else host.style.removeProperty("--sq-image-blend-color");
    };
    const imageFilterValue = (image, name) => Number(image?.dataset[`sqFilter${name[0].toUpperCase()}${name.slice(1)}`] ?? imageDefaults[name]);
    const applySelectedImageFilters = (image = imageForElement()) => {
      if (!image) return;
      image.style.filter = `blur(${imageFilterValue(image, "blur")}px) brightness(${imageFilterValue(image, "brightness")}%) contrast(${imageFilterValue(image, "contrast")}%) saturate(${imageFilterValue(image, "saturate")}%) grayscale(${imageFilterValue(image, "grayscale")}%)`;
      const host = imageVisualHostFor(image);
      if (host) host.style.opacity = imageFilterValue(image, "opacity") === 100 ? "" : String(imageFilterValue(image, "opacity") / 100);
    };
    let cropEditingImage = null;
    let activeElementPanel = "content";
    const showElementPanel = (panelName) => {
      const panels = [...sqStudio.querySelectorAll("[data-sq-element-panel]")];
      if (!panels.some((panel) => panel.dataset.sqElementPanel === panelName)) return;
      activeElementPanel = panelName;
      sqStudio.querySelectorAll("[data-sq-element-tab]").forEach((button) => {
        const active = button.dataset.sqElementTab === panelName;
        button.classList.toggle("active", active);
        button.setAttribute("aria-selected", String(active));
        button.tabIndex = active ? 0 : -1;
      });
      panels.forEach((panel) => {
        const active = panel.dataset.sqElementPanel === panelName;
        panel.hidden = !active;
        panel.classList.toggle("active", active);
      });
      requestAnimationFrame(refreshLayoutGrid);
    };
    const elementTabs = [...sqStudio.querySelectorAll("[data-sq-element-tab]")];
    elementTabs.forEach((button, index) => {
      button.addEventListener("click", () => showElementPanel(button.dataset.sqElementTab));
      button.addEventListener("keydown", (event) => {
        const movement = { ArrowLeft: -1, ArrowRight: 1, Home: -index, End: elementTabs.length - index - 1 }[event.key];
        if (movement == null) return;
        event.preventDefault();
        const target = elementTabs[(index + movement + elementTabs.length) % elementTabs.length];
        showElementPanel(target.dataset.sqElementTab);
        target.focus();
      });
    });
    showElementPanel(activeElementPanel);
    const navigationSectionFor = (element = selectedElement) => element?.dataset?.sqElementType === "navigation" ? element.closest("[data-sq-block]") : null;
    const ensureNavigationMobileMenu = (section) => {
      if (!section) return;
      const navigations = [...section.querySelectorAll(':scope > [data-sq-element-type="navigation"]')];
      const target = [...navigations].reverse().find((navigation) => navigation.querySelector(':scope > button:not(.sq-nav-menu-toggle)')) || navigations.at(-1);
      if (!target) return;
      let toggle = target.querySelector(":scope > .sq-nav-menu-toggle");
      if (!toggle) {
        toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "sq-nav-menu-toggle";
        toggle.setAttribute("aria-label", "Open navigation menu");
        toggle.setAttribute("aria-expanded", "false");
        toggle.innerHTML = "<i></i><i></i><i></i>";
      }
      const cta = target.querySelector(":scope > button:not(.sq-nav-menu-toggle)");
      if (cta) target.insertBefore(toggle, cta); else target.append(toggle);
      let menu = section.querySelector(":scope > .sq-nav-mobile-menu");
      if (!menu) {
        menu = document.createElement("nav");
        menu.className = "sq-nav-mobile-menu";
        menu.setAttribute("aria-label", "Mobile navigation");
        menu.hidden = true;
        section.append(menu);
      }
      const renderLinks = () => {
        const links = navigations.flatMap((navigation) => [...navigation.querySelectorAll(":scope > a")]);
        menu.replaceChildren(...links.map((link) => {
          const copy = link.cloneNode(true);
          copy.removeAttribute("contenteditable");
          copy.removeAttribute("data-sq-editable");
          copy.onclick = (event) => { event.preventDefault(); menu.hidden = true; toggle.setAttribute("aria-expanded", "false"); section.classList.remove("sq-nav-menu-open"); };
          return copy;
        }));
      };
      renderLinks();
      toggle.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        renderLinks();
        const open = menu.hidden;
        menu.hidden = !open;
        toggle.setAttribute("aria-expanded", String(open));
        toggle.setAttribute("aria-label", open ? "Close navigation menu" : "Open navigation menu");
        section.classList.toggle("sq-nav-menu-open", open);
      };
    };
    const navigationScrollRoot = sqStudio.querySelector(".sq-canvas-scroll");
    let editorNavigationFrame = 0;
    const syncEditorNavigation = () => {
      editorNavigationFrame = 0;
      if (!navigationScrollRoot || !previewRoot || !deviceFrame) return;
      const scrollRect = navigationScrollRoot.getBoundingClientRect();
      const renderedScale = deviceFrame.offsetWidth > 0 ? deviceFrame.getBoundingClientRect().width / deviceFrame.offsetWidth : zoom / 100;
      const scale = Number.isFinite(renderedScale) && renderedScale > 0 ? renderedScale : 1;
      previewRoot.querySelectorAll("[data-sq-nav-position]").forEach((navigation) => {
        const position = navigation.dataset.sqNavPosition || "static";
        if (position === "static") {
          navigation.classList.remove("sq-nav-is-stuck", "sq-nav-hidden");
          navigation.style.removeProperty("--sq-nav-editor-shift");
          return;
        }
        const offset = Math.max(0, Math.min(120, Number(navigation.dataset.sqNavOffset) || 0));
        const stickyTop = scrollRect.top + offset * scale;
        navigation.style.removeProperty("--sq-nav-editor-shift");
        navigation.classList.toggle("sq-nav-is-stuck", navigation.getBoundingClientRect().top <= stickyTop + 1);
        navigation.classList.remove("sq-nav-hidden");
      });
    };
    const scheduleEditorNavigation = () => {
      if (editorNavigationFrame) return;
      editorNavigationFrame = requestAnimationFrame(syncEditorNavigation);
    };
    navigationScrollRoot?.addEventListener("scroll", scheduleEditorNavigation, { passive: true });
    window.addEventListener("resize", scheduleEditorNavigation);
    const moveNavigationSectionToTop = (section) => {
      if (!section || section.parentElement !== previewRoot) return;
      const pageBackground = [...previewRoot.querySelectorAll(":scope > .sq-page-background")].at(-1) || null;
      const firstPageSection = pageBackground?.nextElementSibling || previewRoot.firstElementChild;
      if (firstPageSection === section) return;
      if (pageBackground) pageBackground.after(section); else previewRoot.prepend(section);
    };
    const applyNavigationSectionBehavior = (section) => {
      if (!section) return;
      const position = ["static", "sticky", "fixed"].includes(section.dataset.sqNavPosition) ? section.dataset.sqNavPosition : "static";
      const offsetWasCustomized = section.dataset.sqNavOffsetCustomized === "true";
      const offset = offsetWasCustomized ? Math.max(0, Math.min(120, Number(section.dataset.sqNavOffset) || 0)) : 0;
      const surfaceFallback = section.dataset.sqNavTemplate === "overlay" ? "transparent" : "solid";
      const surface = ["solid", "blur", "transparent"].includes(section.dataset.sqNavSurface) ? section.dataset.sqNavSurface : surfaceFallback;
      const opacity = Math.max(0, Math.min(100, Number(section.dataset.sqNavOpacity ?? (surface === "transparent" ? 0 : surface === "blur" ? 82 : 100))));
      const blur = Math.max(0, Math.min(32, Number(section.dataset.sqNavBlur ?? 16)));
      if (position !== "static") moveNavigationSectionToTop(section);
      section.dataset.sqNavPosition = position;
      section.dataset.sqNavOffset = String(offset);
      section.dataset.sqNavOffsetCustomized = String(offsetWasCustomized);
      section.dataset.sqNavSurface = surface;
      section.dataset.sqNavOpacity = String(opacity);
      section.dataset.sqNavBlur = String(blur);
      section.dataset.sqNavShadow ||= "true";
      section.classList.add("sq-navigation-template-section");
      section.style.setProperty("--sq-nav-offset", `${offset}px`);
      section.style.setProperty("--sq-nav-surface-opacity", `${opacity}%`);
      section.style.setProperty("--sq-nav-backdrop-blur", `${blur}px`);
      ensureNavigationMobileMenu(section);
      scheduleEditorNavigation();
    };
    const syncNavigationLayoutControls = (isNavigation) => {
      const controls = sqStudio.querySelector("[data-sq-navigation-layout-controls]");
      if (controls) controls.hidden = !isNavigation;
      if (!isNavigation) return;
      const section = navigationSectionFor();
      if (!section) return;
      applyNavigationSectionBehavior(section);
      const position = section.dataset.sqNavPosition || "static";
      sqStudio.querySelectorAll("[data-sq-navigation-position]").forEach((button) => {
        const active = button.dataset.sqNavigationPosition === position;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", String(active));
      });
      const offset = sqStudio.querySelector("[data-sq-navigation-offset]");
      const offsetOutput = sqStudio.querySelector("[data-sq-navigation-offset-output]");
      if (offset) offset.value = section.dataset.sqNavOffset || "0";
      if (offsetOutput) offsetOutput.textContent = `${section.dataset.sqNavOffset || "0"}px`;
      const hideOnScroll = sqStudio.querySelector("[data-sq-navigation-hide-scroll]");
      const shadow = sqStudio.querySelector("[data-sq-navigation-stuck-shadow]");
      if (hideOnScroll) hideOnScroll.checked = section.dataset.sqNavHideScroll === "true";
      if (shadow) shadow.checked = section.dataset.sqNavShadow !== "false";
      const surface = section.dataset.sqNavSurface || "solid";
      sqStudio.querySelectorAll("[data-sq-navigation-surface]").forEach((button) => {
        const active = button.dataset.sqNavigationSurface === surface;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", String(active));
      });
      const opacity = sqStudio.querySelector("[data-sq-navigation-opacity]");
      const opacityOutput = sqStudio.querySelector("[data-sq-navigation-opacity-output]");
      const blur = sqStudio.querySelector("[data-sq-navigation-blur]");
      const blurOutput = sqStudio.querySelector("[data-sq-navigation-blur-output]");
      if (opacity) { opacity.value = section.dataset.sqNavOpacity || "100"; opacity.disabled = surface === "transparent"; }
      if (opacityOutput) opacityOutput.textContent = `${section.dataset.sqNavOpacity || "100"}%`;
      if (blur) { blur.value = section.dataset.sqNavBlur || "16"; blur.disabled = surface !== "blur"; }
      if (blurOutput) blurOutput.textContent = `${section.dataset.sqNavBlur || "16"}px`;
    };
    const syncElementControls = () => {
      const controls = sqStudio.querySelector("[data-sq-element-controls]");
      const selectedBackground = selectedElement?.matches?.(".sq-section-background");
      const valid = selectedElement?.isConnected && (selectedBackground || selectedElement.closest(`[data-section-id="${selectedSection}"]`));
      if (controls) controls.hidden = !valid;
      inspector?.classList.toggle("element-selected", Boolean(valid));
      if (!valid) {
        const context = sqStudio.querySelector("[data-sq-inspector-context]");
        if (context) context.textContent = "Section settings";
        const productControls = sqStudio.querySelector("[data-sq-product-layout-controls]");
        if (productControls) productControls.hidden = true;
        const navigationLayoutControls = sqStudio.querySelector("[data-sq-navigation-layout-controls]");
        if (navigationLayoutControls) navigationLayoutControls.hidden = true;
        syncBuilderRanges();
        return;
      }
      const layout = parseElementLayout(selectedElement);
      const isLogo = selectedElement.dataset.sqElementType === "logo";
      const isProductGrid = selectedElement.dataset.sqElementType === "product-grid";
      const isCode = selectedElement.dataset.sqElementType === "custom-code";
      const isComponentInstance = selectedElement.dataset.sqElementType === "component-instance";
      const isMarquee = selectedElement.dataset.sqElementType === "marquee";
      const elementType = selectedElement.dataset.sqElementType || "";
      const isNavigation = elementType === "navigation";
      const isBackgroundImage = elementType === "image-background";
      const typographyControls = sqStudio.querySelector("[data-sq-typography-controls]");
      if (typographyControls) typographyControls.hidden = ["image", "image-background", "collage", "gallery", "divider", "spacer", "icon", "custom-code", "component-instance"].includes(elementType);
      const action = isProductGrid
        ? (selectedAction?.isConnected && selectedElement.contains(selectedAction) ? selectedAction : null)
        : isNavigation ? selectedAction : actionForElement();
      const image = isLogo || isProductGrid ? null : imageForElement();
      const contentName = selectedContent?.matches("h1,h2,h3") ? "Heading" : selectedContent ? "Text" : "";
      const contextualName = isBackgroundImage ? "Section background" : isLogo ? "Logo" : selectedAction && action ? "Button" : selectedImage && image ? "Image" : contentName || elementTypeName(selectedElement);
      const context = sqStudio.querySelector("[data-sq-inspector-context]");
      const title = sqStudio.querySelector("[data-sq-inspector-title]");
      if (context) context.textContent = isBackgroundImage ? "Selected background image" : "Selected element";
      if (title) title.textContent = contextualName;
      const backButton = sqStudio.querySelector("[data-sq-select-section]");
      if (backButton?.lastChild) backButton.lastChild.textContent = " Back to section";
      sqStudio.querySelectorAll("[data-sq-element-tab]").forEach((button) => { button.hidden = isBackgroundImage && ["style", "layout"].includes(button.dataset.sqElementTab); });
      const elementActions = sqStudio.querySelector("[data-sq-element-actions]");
      if (elementActions) elementActions.hidden = isBackgroundImage;
      if (isBackgroundImage && ["style", "layout"].includes(activeElementPanel)) showElementPanel("content");
      [["x", layout.x], ["y", layout.y], ["w", layout.width], ["h", layout.height]].forEach(([field, value]) => {
        const input = sqStudio.querySelector(`[data-sq-element-${field}]`);
        if (input) input.value = String(value);
      });
      const inset = elementInsetFor(selectedElement);
      sqStudio.querySelectorAll("[data-sq-element-inset]").forEach((input) => { input.value = String(inset[input.dataset.sqElementInset]); });
      const insetDevice = sqStudio.querySelector("[data-sq-element-inset-device]");
      if (insetDevice) insetDevice.textContent = activeDevice[0].toUpperCase() + activeDevice.slice(1);
      const gridDensity = sqStudio.querySelector("[data-sq-grid-density]");
      const gridDensityOutput = sqStudio.querySelector("[data-sq-grid-density-output]");
      const gridDensityDevice = sqStudio.querySelector("[data-sq-grid-density-device]");
      const gridVisibility = sqStudio.querySelector("[data-sq-show-layout-grid]");
      if (gridDensity) gridDensity.value = String(gridDensityState[activeDevice]);
      if (gridDensityOutput) gridDensityOutput.textContent = gridDensityLabel(gridDensityState[activeDevice]);
      if (gridDensityDevice) gridDensityDevice.textContent = activeDevice[0].toUpperCase() + activeDevice.slice(1);
      if (gridVisibility) gridVisibility.checked = showLayoutGrid;
      const columns = fluidColumns();
      const centeredX = Math.max(1, Math.round((columns - layout.width + 2) / 2));
      const position = layout.x === 1 ? "left" : layout.x === columns - layout.width + 1 ? "right" : layout.x === centeredX ? "center" : "";
      sqStudio.querySelectorAll("[data-sq-element-position-choice]").forEach((button) => { const active = button.dataset.sqElementPositionChoice === position; button.classList.toggle("active", active); button.setAttribute("aria-pressed", String(active)); });
      const quickWidth = sqStudio.querySelector("[data-sq-element-width-quick]");
      const quickWidthOutput = sqStudio.querySelector("[data-sq-element-width-quick-output]");
      if (quickWidth) { quickWidth.max = String(columns); quickWidth.value = String(layout.width); }
      const exactX = sqStudio.querySelector("[data-sq-element-x]");
      const exactWidth = sqStudio.querySelector("[data-sq-element-w]");
      if (exactX) exactX.max = String(columns);
      if (exactWidth) exactWidth.max = String(columns);
      if (quickWidthOutput) quickWidthOutput.textContent = `${layout.width} ${layout.width === 1 ? "column" : "columns"}`;
      const hideButton = sqStudio.querySelector("[data-sq-element-hide]");
      if (hideButton) hideButton.lastChild.textContent = selectedElement.classList.contains("sq-element-hidden") ? " Show" : " Hide";
      const computed = getComputedStyle(selectedElement);
      const colorFallbacks = { color: "#24262b", backgroundColor: "#ffffff", borderColor: "#e3e5e7" };
      sqStudio.querySelectorAll("[data-sq-element-color]").forEach((input) => {
        const property = input.dataset.sqElementColor;
        const transparent = isTransparentColor(computed[property]);
        const value = colorToHex(computed[property], colorFallbacks[property]);
        input.value = value;
        const hex = sqStudio.querySelector(`[data-sq-element-color-hex="${property}"]`);
        if (hex) { hex.value = transparent ? "Transparent" : value.toUpperCase(); hex.classList.toggle("is-transparent", transparent); }
        sqStudio.querySelector(`[data-sq-color-card="${property}"]`)?.classList.toggle("is-transparent", transparent);
      });
      const family = String(computed.fontFamily || "").toLowerCase();
      const fontFamily = sqStudio.querySelector("[data-sq-element-font-family]");
      if (fontFamily) fontFamily.value = family.includes("monospace") || family.includes("consolas") ? "ui-monospace, SFMono-Regular, Consolas, monospace" : family.includes("georgia") ? "Georgia, 'Times New Roman', serif" : family.includes("times new roman") ? "'Times New Roman', Times, serif" : family.includes("arial") || family.includes("helvetica") ? "Arial, Helvetica, sans-serif" : "Poppins, sans-serif";
      const fontWeight = sqStudio.querySelector("[data-sq-element-font-weight]");
      if (fontWeight) fontWeight.value = ["400", "500", "600", "700"].reduce((best, weight) => Math.abs(Number(weight) - Number.parseInt(computed.fontWeight, 10)) < Math.abs(Number(best) - Number.parseInt(computed.fontWeight, 10)) ? weight : best, "400");
      const computedFontSize = Math.round(Number.parseFloat(computed.fontSize) || 16);
      const fontSize = sqStudio.querySelector("[data-sq-element-font-size]");
      const fontSizeOutput = sqStudio.querySelector("[data-sq-element-font-size-output]");
      if (fontSize) fontSize.value = String(Math.min(160, Math.max(8, computedFontSize)));
      if (fontSizeOutput) fontSizeOutput.textContent = `${computedFontSize}px`;
      const computedLineHeight = computed.lineHeight === "normal" ? 1.2 : (Number.parseFloat(computed.lineHeight) / (Number.parseFloat(computed.fontSize) || 16));
      const lineHeight = Math.min(2.2, Math.max(.7, Math.round(computedLineHeight * 100) / 100));
      const lineHeightInput = sqStudio.querySelector("[data-sq-element-line-height]");
      const lineHeightOutput = sqStudio.querySelector("[data-sq-element-line-height-output]");
      if (lineHeightInput) lineHeightInput.value = String(lineHeight);
      if (lineHeightOutput) lineHeightOutput.textContent = String(lineHeight);
      const spacing = computed.letterSpacing === "normal" ? 0 : Number.parseFloat(computed.letterSpacing) || 0;
      const letterSpacing = sqStudio.querySelector("[data-sq-element-letter-spacing]");
      const letterSpacingOutput = sqStudio.querySelector("[data-sq-element-letter-spacing-output]");
      if (letterSpacing) letterSpacing.value = String(Math.min(20, Math.max(-10, spacing)));
      if (letterSpacingOutput) letterSpacingOutput.textContent = `${Math.round(spacing * 100) / 100}px`;
      const surfaceValue = selectedElement.dataset.sqSurface || "none";
      sqStudio.querySelectorAll("[data-sq-element-surface]").forEach((button) => { button.classList.toggle("active", button.dataset.sqElementSurface === surfaceValue); button.setAttribute("aria-pressed", String(button.dataset.sqElementSurface === surfaceValue)); });
      const alignValue = selectedElement.dataset.sqAlign || computed.textAlign || "left";
      sqStudio.querySelectorAll("[data-sq-element-align]").forEach((button) => { button.classList.toggle("active", button.dataset.sqElementAlign === alignValue); button.setAttribute("aria-pressed", String(button.dataset.sqElementAlign === alignValue)); });
      const transformValue = computed.textTransform === "uppercase" || computed.textTransform === "lowercase" ? computed.textTransform : "none";
      sqStudio.querySelectorAll("[data-sq-element-transform]").forEach((button) => { button.classList.toggle("active", button.dataset.sqElementTransform === transformValue); button.setAttribute("aria-pressed", String(button.dataset.sqElementTransform === transformValue)); });
      const borderWidth = Math.round(Number.parseFloat(computed.borderTopWidth) || 0);
      const borderWidthInput = sqStudio.querySelector("[data-sq-element-border-width]");
      const borderWidthOutput = sqStudio.querySelector("[data-sq-element-border-width-output]");
      if (borderWidthInput) borderWidthInput.value = String(Math.min(12, borderWidth));
      if (borderWidthOutput) borderWidthOutput.textContent = `${borderWidth}px`;
      const borderStyle = sqStudio.querySelector("[data-sq-element-border-style]");
      if (borderStyle) borderStyle.value = ["solid", "dashed", "dotted", "double"].includes(computed.borderTopStyle) ? computed.borderTopStyle : "solid";
      const radius = Number.parseInt(selectedElement.style.borderRadius || computed.borderTopLeftRadius || "0", 10) || 0;
      const radiusInput = sqStudio.querySelector("[data-sq-element-radius]");
      const radiusOutput = sqStudio.querySelector("[data-sq-element-radius-output]");
      const radiusNumber = sqStudio.querySelector("[data-sq-element-radius-number]");
      if (radiusInput) radiusInput.value = String(Math.min(64, radius));
      if (radiusOutput) radiusOutput.textContent = radius >= 999 ? "Pill" : `${radius}px`;
      if (radiusNumber) radiusNumber.value = String(radius);
      sqStudio.querySelectorAll("[data-sq-radius-choice]").forEach((button) => { const active = Number(button.dataset.sqRadiusChoice) === radius; button.classList.toggle("active", active); button.setAttribute("aria-pressed", String(active)); });
      const buttonControls = sqStudio.querySelector("[data-sq-element-button-controls]");
      const hasButton = Boolean(action);
      if (buttonControls) buttonControls.hidden = !hasButton;
      if (hasButton) {
        const linkType = inferredActionType(action);
        const link = inferredActionTarget(action, linkType);
        const labelInput = sqStudio.querySelector("[data-sq-button-label]");
        const typeInput = sqStudio.querySelector("[data-sq-button-link-type]");
        const linkInput = sqStudio.querySelector("[data-sq-button-link]");
        const linkWrap = sqStudio.querySelector("[data-sq-button-link-wrap]");
        const linkLabel = sqStudio.querySelector("[data-sq-button-link-label]");
        const newTab = sqStudio.querySelector("[data-sq-button-new-tab]");
        if (labelInput) labelInput.value = action.textContent.trim();
        if (typeInput) typeInput.value = linkType;
        if (linkInput) linkInput.value = link;
        if (linkWrap) linkWrap.hidden = ["checkout", "none"].includes(linkType);
        if (linkLabel) linkLabel.textContent = ({ section: "Section ID", url: "Web address", email: "Email address", phone: "Phone number" })[linkType] || "Destination";
        if (newTab) { newTab.checked = action.dataset.sqNewTab === "true" || action.target === "_blank"; newTab.closest("label").hidden = linkType !== "url"; }
        const checkoutTest = sqStudio.querySelector("[data-sq-checkout-test]");
        if (checkoutTest) checkoutTest.hidden = linkType !== "checkout";
      }
      const logoControls = sqStudio.querySelector("[data-sq-logo-controls]");
      if (logoControls) logoControls.hidden = !isLogo;
      if (isLogo) {
        const logoImage = selectedElement.querySelector("[data-sq-logo-image]");
        const logoText = selectedElement.querySelector("[data-sq-logo-text]");
        const source = sqStudio.querySelector("[data-sq-logo-src]");
        const text = sqStudio.querySelector("[data-sq-logo-text-input]");
        const alt = sqStudio.querySelector("[data-sq-logo-alt]");
        const width = sqStudio.querySelector("[data-sq-logo-width]");
        const widthOutput = sqStudio.querySelector("[data-sq-logo-width-output]");
        const logoWidth = Number.parseInt(logoImage?.style.width || "140", 10) || 140;
        if (source) source.value = logoImage?.getAttribute("src") || "";
        if (text) text.value = logoText?.textContent.trim() || "";
        if (alt) alt.value = logoImage?.getAttribute("alt") || "";
        if (width) width.value = String(logoWidth);
        if (widthOutput) widthOutput.textContent = `${logoWidth}px`;
      }
      const navigationControls = sqStudio.querySelector("[data-sq-navigation-controls]");
      if (navigationControls) navigationControls.hidden = !isNavigation;
      syncNavigationLayoutControls(isNavigation);
      if (isNavigation) {
        const links = [...selectedElement.querySelectorAll(":scope > a")];
        const list = sqStudio.querySelector("[data-sq-navigation-link-list]");
        if (list) list.innerHTML = links.map((link, index) => `<div class="sq-navigation-link-row" data-sq-navigation-link-row="${index}"><input type="text" maxlength="40" value="${escapeHtml(link.textContent.trim())}" aria-label="Navigation label"><input type="text" maxlength="200" value="${escapeHtml(link.getAttribute("href") || "#")}" aria-label="Navigation destination"><button type="button" aria-label="Remove ${escapeHtml(link.textContent.trim())}">×</button></div>`).join("");
        const cta = selectedElement.querySelector(":scope > button:not(.sq-nav-menu-toggle)");
        const ctaVisible = sqStudio.querySelector("[data-sq-navigation-cta-visible]");
        const ctaLabel = sqStudio.querySelector("[data-sq-navigation-cta-label]");
        const ctaTarget = sqStudio.querySelector("[data-sq-navigation-cta-target]");
        if (ctaVisible) ctaVisible.checked = Boolean(cta) && !cta.hidden;
        if (ctaLabel) ctaLabel.value = cta?.textContent.trim() || "Buy now";
        if (ctaTarget) {
          const ctaType = inferredActionType(cta);
          const ctaDestination = inferredActionTarget(cta, ctaType);
          ctaTarget.value = ctaType === "checkout" ? "checkout" : ctaType === "section" ? `#${ctaDestination.replace(/^#/, "") || "products"}` : ctaDestination || "#products";
        }
      }
      const buttonRole = selectedElement.dataset.sqButtonRole || "primary";
      sqStudio.querySelectorAll("[data-sq-role-choice]").forEach((button) => button.classList.toggle("active", button.dataset.sqRoleChoice === buttonRole));
      const brandSummary = sqStudio.querySelector("[data-sq-button-brand-summary]");
      if (brandSummary) brandSummary.hidden = !hasButton;
      if (hasButton) {
        const roleLabel = sqStudio.querySelector("[data-sq-selected-brand-role]");
        if (roleLabel) roleLabel.textContent = buttonRole[0].toUpperCase() + buttonRole.slice(1);
        sqStudio.querySelectorAll("[data-sq-selected-brand-swatch]").forEach((swatch) => {
          swatch.style.background = buttonValue(buttonRole, swatch.dataset.sqSelectedBrandSwatch);
        });
        sqStudio.querySelectorAll("[data-sq-selected-brand-value]").forEach((value) => {
          value.textContent = colorToHex(buttonValue(buttonRole, value.dataset.sqSelectedBrandValue), "#000000").toUpperCase();
        });
      }
      const animation = sqStudio.querySelector("[data-sq-element-animation-control]");
      if (animation) animation.value = selectedElement.dataset.sqElementAnimation || "none";
      const duration = Number.parseInt(selectedElement.style.getPropertyValue("--element-duration") || "700", 10);
      const delay = Number.parseInt(selectedElement.style.getPropertyValue("--element-delay") || "0", 10);
      [["duration", duration], ["delay", delay]].forEach(([field, value]) => {
        const input = sqStudio.querySelector(`[data-sq-element-${field}]`);
        const output = sqStudio.querySelector(`[data-sq-element-${field}-output]`);
        if (input) input.value = String(value);
        if (output) output.textContent = `${value}ms`;
      });
      sqStudio.querySelectorAll("[data-sq-hover-choice]").forEach((button) => button.classList.toggle("active", button.dataset.sqHoverChoice === (selectedElement.dataset.sqHover || "none")));
      const codeControls = sqStudio.querySelector("[data-sq-code-controls]");
      if (codeControls) codeControls.hidden = !isCode;
      const codeInput = sqStudio.querySelector("[data-sq-code-input]");
      if (isCode && codeInput) codeInput.value = codeSourceFor(selectedElement);
      const componentInstanceControls = sqStudio.querySelector("[data-sq-component-instance-controls]");
      if (componentInstanceControls) componentInstanceControls.hidden = !isComponentInstance;
      const instanceName = sqStudio.querySelector("[data-sq-instance-name]");
      if (isComponentInstance && instanceName) instanceName.textContent = selectedElement.dataset.sqComponentName || componentForId(selectedElement.dataset.sqComponentId)?.name || "Main component";
      const textControls = sqStudio.querySelector("[data-sq-element-text-controls]");
      const explicitTextTarget = selectedContent?.isConnected && selectedElement.contains(selectedContent) && !selectedAction ? selectedContent : null;
      const fallbackTextTarget = !action && !image && !isLogo && !isNavigation && !isProductGrid && !isCode && !isComponentInstance
        ? (selectedElement.matches("[data-sq-editable]") ? selectedElement : editableNodesFor(selectedElement)[0] || null)
        : null;
      const textTarget = explicitTextTarget || fallbackTextTarget;
      if (textControls) textControls.hidden = !textTarget;
      if (textTarget) {
        const textInput = sqStudio.querySelector("[data-sq-element-text]");
        const textLabel = sqStudio.querySelector("[data-sq-element-text-label]");
        if (textInput) textInput.value = textTarget.textContent.trim();
        if (textLabel) textLabel.textContent = textTarget.matches("h1,h2,h3") ? "Heading" : textTarget.matches("a") ? "Link label" : "Text content";
      }
      const marqueeControls = sqStudio.querySelector("[data-sq-marquee-controls]");
      if (marqueeControls) marqueeControls.hidden = !isMarquee;
      if (isMarquee) {
        const mode = marqueeMode(selectedElement);
        const speed = marqueeSpeed(selectedElement);
        const modeInput = sqStudio.querySelector("[data-sq-marquee-mode]");
        const speedInput = sqStudio.querySelector("[data-sq-marquee-speed]");
        const speedOutput = sqStudio.querySelector("[data-sq-marquee-speed-output]");
        const modeNote = sqStudio.querySelector("[data-sq-marquee-mode-note]");
        if (modeInput) modeInput.value = mode;
        if (speedInput) speedInput.value = String(speed);
        if (speedOutput) speedOutput.textContent = mode === "scroll" ? `${Math.round(speed / 60 * 100)}% scroll` : `${speed} px/s`;
        if (modeNote) modeNote.textContent = mode === "scroll" ? "The strip moves with the visitor’s page scroll and reverses when they scroll up." : "Automatic movement loops continuously with no empty gap.";
      }
      const reviewControls = sqStudio.querySelector("[data-sq-review-controls]");
      const isReview = elementType === "review";
      if (reviewControls) reviewControls.hidden = !isReview;
      if (isReview) {
        const rating = reviewRating(selectedElement);
        renderReviewStars(selectedElement, rating);
        sqStudio.querySelectorAll("[data-sq-review-rating]").forEach((button) => {
          const active = Number(button.dataset.sqReviewRating) === rating;
          button.classList.toggle("active", active);
          button.setAttribute("aria-pressed", String(active));
        });
      }
      const imageControls = sqStudio.querySelector("[data-sq-image-controls]");
      if (imageControls) imageControls.hidden = !image;
      const imageScrollControls = sqStudio.querySelector("[data-sq-image-scroll-controls]");
      if (imageScrollControls) imageScrollControls.hidden = !image;
      const backgroundScopeCard = sqStudio.querySelector("[data-sq-selected-background-scope]");
      if (backgroundScopeCard) backgroundScopeCard.hidden = !isBackgroundImage;
      if (isBackgroundImage) {
        const section = selectedElement.closest("[data-section-id]");
        const sectionName = sectionNames[section?.dataset.sectionId] || "Section";
        const scopeTitle = sqStudio.querySelector("[data-sq-selected-background-title]");
        const scopeCopy = sqStudio.querySelector("[data-sq-selected-background-copy]");
        if (scopeTitle) scopeTitle.textContent = `Editing ${sectionName}'s background`;
        if (scopeCopy) scopeCopy.textContent = `This image belongs only to the ${sectionName} section.`;
      }
      if (image) {
        const imageHeading = sqStudio.querySelector("[data-sq-image-controls] > .sq-inspector-heading h3");
        if (imageHeading) imageHeading.textContent = isBackgroundImage ? "Background image" : "Image";
        const srcInput = sqStudio.querySelector("[data-sq-image-src]");
        const altInput = sqStudio.querySelector("[data-sq-image-alt]");
        const fitInput = sqStudio.querySelector("[data-sq-image-fit]");
        const positionInput = sqStudio.querySelector("[data-sq-image-position]");
        if (srcInput) srcInput.value = image.getAttribute("src") || "";
        if (altInput) altInput.value = image.getAttribute("alt") || "";
        if (fitInput) fitInput.value = image.style.objectFit || getComputedStyle(image).objectFit || "cover";
        const position = image.style.objectPosition || getComputedStyle(image).objectPosition || "center";
        if (positionInput) positionInput.value = ["center", "top", "bottom", "left", "right"].includes(position) ? position : "center";
        const cropZoom = Math.round(imageCropZoom(image) * 100);
        const cropX = Math.max(0, Math.min(100, imageCropValue(image, "X", 50)));
        const cropY = Math.max(0, Math.min(100, imageCropValue(image, "Y", 50)));
        const cropToggle = sqStudio.querySelector("[data-sq-image-crop-toggle]");
        const cropControls = sqStudio.querySelector("[data-sq-image-crop-controls]");
        const cropZoomInput = sqStudio.querySelector("[data-sq-image-crop-zoom]");
        const cropZoomOutput = sqStudio.querySelector("[data-sq-image-crop-zoom-output]");
        const cropXInput = sqStudio.querySelector("[data-sq-image-crop-x]");
        const cropYInput = sqStudio.querySelector("[data-sq-image-crop-y]");
        const cropActive = cropEditingImage === image;
        if (cropToggle) { cropToggle.classList.toggle("active", cropActive); cropToggle.textContent = cropActive ? "Done cropping" : "Crop on canvas"; }
        if (cropControls) cropControls.hidden = !cropActive;
        if (cropZoomInput) cropZoomInput.value = String(cropZoom);
        if (cropZoomOutput) cropZoomOutput.textContent = `${cropZoom}%`;
        if (cropXInput) cropXInput.value = String(cropX);
        if (cropYInput) cropYInput.value = String(cropY);
        const backgroundActions = sqStudio.querySelector(".sq-image-background-actions");
        if (backgroundActions) backgroundActions.hidden = isBackgroundImage;
        sqStudio.querySelectorAll("[data-sq-image-background]").forEach((button) => {
          const hasBackground = Boolean(selectedElement?.closest("[data-sq-block]")?.querySelector(":scope > .sq-section-background"));
          button.classList.toggle("active", hasBackground);
          button.textContent = hasBackground ? "Replace section image" : "Use image";
        });
        const blendModeInput = sqStudio.querySelector("[data-sq-image-blend-mode]");
        const blendSourceInput = sqStudio.querySelector("[data-sq-image-blend-source]");
        const blendColorInput = sqStudio.querySelector("[data-sq-image-blend-color]");
        const blendColorHex = sqStudio.querySelector("[data-sq-image-blend-color-hex]");
        const blendColorWrap = sqStudio.querySelector("[data-sq-image-blend-color-wrap]");
        const blendColorClear = sqStudio.querySelector("[data-sq-image-blend-color-clear]");
        const blendNote = sqStudio.querySelector("[data-sq-image-blend-note]");
        const blendMode = imageBlendMode(image);
        const blendSource = imageBlendSource(image);
        const blendColor = imageBlendColor(image);
        if (blendModeInput) blendModeInput.value = blendMode;
        if (blendSourceInput) blendSourceInput.value = blendSource;
        if (blendColorInput) blendColorInput.value = blendColor || defaultImageBlendColor();
        if (blendColorHex) { blendColorHex.value = blendColor ? blendColor.toUpperCase() : "Transparent"; blendColorHex.classList.toggle("is-transparent", !blendColor); }
        [blendColorInput, blendColorHex, blendColorClear].forEach((control) => { if (control) control.disabled = blendSource === "behind"; });
        blendColorWrap?.classList.toggle("is-transparent", !blendColor);
        blendColorWrap?.classList.toggle("is-disabled", blendSource === "behind");
        if (blendNote) blendNote.textContent = blendSource === "behind"
          ? "Overlap this image with another layer, then use the layer order to choose what sits beneath it."
          : blendMode === "normal" && blendColor
            ? "Normal shows the original image unchanged. Choose a blend mode to mix in the overlay color."
            : "Blend the image with its overlay color. Multiply and Overlay are useful for polished brand treatments.";
        sqStudio.querySelectorAll("[data-sq-image-filter]").forEach((input) => {
          const name = input.dataset.sqImageFilter;
          const value = imageFilterValue(image, name);
          input.value = String(value);
          const output = sqStudio.querySelector(`[data-sq-image-output="${name}"]`);
          if (output) output.textContent = `${value}${name === "blur" ? "px" : "%"}`;
          });
        const scrollEffect = image.dataset.sqImageScroll === "parallax-deep" ? "parallax" : image.dataset.sqImageScroll || "none";
        const storedScrollStrength = Number(image.dataset.sqImageScrollStrength);
        const scrollStrength = Math.max(0, Math.min(100, Number.isFinite(storedScrollStrength) ? storedScrollStrength : 50));
        const scrollEffectInput = sqStudio.querySelector("[data-sq-image-scroll-effect]");
        const scrollStrengthInput = sqStudio.querySelector("[data-sq-image-scroll-strength]");
        const scrollStrengthOutput = sqStudio.querySelector("[data-sq-image-scroll-strength-output]");
        const scrollDampingInput = sqStudio.querySelector("[data-sq-image-scroll-damping]");
        if (scrollEffectInput) scrollEffectInput.value = scrollEffect;
        if (scrollStrengthInput) { scrollStrengthInput.value = String(scrollStrength); scrollStrengthInput.disabled = scrollEffect === "none"; }
        if (scrollStrengthOutput) scrollStrengthOutput.textContent = scrollStrength === 100 && scrollEffect === "parallax" ? "100% · fixed" : scrollStrength === 0 ? "0% · normal" : `${scrollStrength}%`;
        if (scrollDampingInput) { scrollDampingInput.checked = image.dataset.sqImageScrollDamping !== "false"; scrollDampingInput.disabled = scrollEffect === "none"; }
      }
      const productControls = sqStudio.querySelector("[data-sq-product-layout-controls]");
      if (productControls) productControls.hidden = !isProductGrid;
      if (isProductGrid) {
        const settings = productGridSettings(selectedElement);
        const columns = sqStudio.querySelector("[data-sq-product-columns]");
        const density = sqStudio.querySelector("[data-sq-product-density]");
        const device = sqStudio.querySelector("[data-sq-product-layout-device]");
        if (columns) columns.value = settings.columns;
        if (density) density.value = settings.density;
        if (device) device.textContent = activeDevice[0].toUpperCase() + activeDevice.slice(1);
      }
      const emptyContent = sqStudio.querySelector("[data-sq-element-content-empty]");
      if (emptyContent) emptyContent.hidden = [textControls, marqueeControls, reviewControls, logoControls, navigationControls, imageControls, imageScrollControls, buttonControls, codeControls, componentInstanceControls].some((control) => control && !control.hidden);
      showElementPanel(activeElementPanel);
      syncBuilderRanges();
    };
    const removeElementOverlay = () => previewRoot?.querySelectorAll(".sq-element-overlay").forEach((overlay) => overlay.remove());
    const refreshElementOverlay = () => {
      removeElementOverlay();
      if (!selectedElement?.isConnected) return;
      if (selectedElement.matches(".sq-page-background,.sq-section-background")) return;
      const section = selectedElement.closest("[data-sq-fluid]");
      if (!section) return;
      const overlay = document.createElement("div");
      overlay.className = "sq-element-overlay";
      overlay.innerHTML = `<div class="sq-element-toolbar"><button type="button" data-sq-element-move aria-label="Move element">${iconMarkup("grip")}</button><span>${escapeHtml(elementTypeName(selectedElement))}</span><button type="button" data-sq-overlay-duplicate aria-label="Duplicate element">${iconMarkup("layers")}</button><button type="button" data-sq-overlay-delete aria-label="Delete element">${iconMarkup("x")}</button></div><button class="sq-element-resize" type="button" data-sq-element-resize aria-label="Resize element"></button>`;
      section.append(overlay);
      const sectionRect = section.getBoundingClientRect();
      const elementRect = selectedElement.getBoundingClientRect();
      const renderedScale = section.offsetWidth ? sectionRect.width / section.offsetWidth : 1;
      overlay.style.left = `${(elementRect.left - sectionRect.left) / renderedScale}px`;
      overlay.style.top = `${(elementRect.top - sectionRect.top) / renderedScale}px`;
      overlay.style.width = `${elementRect.width / renderedScale}px`;
      overlay.style.height = `${elementRect.height / renderedScale}px`;
      overlay.querySelector("[data-sq-overlay-duplicate]").onclick = (event) => { event.stopPropagation(); duplicateSelectedElement(); };
      overlay.querySelector("[data-sq-overlay-delete]").onclick = (event) => { event.stopPropagation(); deleteSelectedElement(); };
      bindElementPointerControl(overlay.querySelector("[data-sq-element-move]"), false);
      bindElementPointerControl(overlay.querySelector("[data-sq-element-resize]"), true);
    };
    const selectSqElement = (element, action = null, image = null, content = null) => {
      if (!element?.matches("[data-sq-element],.sq-section-background")) return;
      if (cropEditingImage && (!element.contains(cropEditingImage) || image?.matches?.("img") && image !== cropEditingImage)) {
        imageVisualHostFor(cropEditingImage)?.classList.remove("sq-image-crop-editing");
        cropEditingImage = null;
      }
      inspector?.classList.remove("page-spacing-open");
      const pageControls = sqStudio.querySelector("[data-sq-page-spacing-controls]");
      if (pageControls) pageControls.hidden = true;
      sqStudio.querySelectorAll("[data-sq-section-controls]").forEach((control) => { control.hidden = false; });
      const sectionActions = sqStudio.querySelector("[data-sq-section-actions]");
      if (sectionActions) sectionActions.hidden = false;
      selectedElement = element;
      selectedAction = action?.matches?.("button,a") && element.contains(action) ? action : null;
      selectedImage = image?.matches?.("img") && element.contains(image) ? image : null;
      selectedContent = content?.matches?.("[data-sq-editable]") && element.contains(content) ? content : null;
      removeSectionToolbar();
      previewRoot?.querySelectorAll(".sq-element-selected").forEach((item) => item.classList.remove("sq-element-selected"));
      element.classList.add("sq-element-selected");
      sqStudio.querySelectorAll("[data-sq-element-layer]").forEach((layer) => layer.classList.toggle("active", layer.dataset.sqElementLayer === element.dataset.sqElementId));
      const elementType = element.dataset.sqElementType || "";
      showElementPanel(action ? "content" : elementType === "product-grid" ? "layout" : ["divider", "spacer", "icon"].includes(elementType) ? "style" : "content");
      syncElementControls();
      requestAnimationFrame(refreshElementOverlay);
    };
    const duplicateSelectedElement = () => {
      if (!selectedElement?.isConnected) return;
      const snapshot = captureState();
      const copy = selectedElement.cloneNode(true);
      copy.classList.remove("sq-element-selected", "sq-element-hidden");
      copy.dataset.sqElementId = `element-${Date.now()}`;
      ["desktop", "tablet", "mobile"].forEach((device) => {
        const layout = parseElementLayout(selectedElement, device);
        setElementLayout(copy, findOpenElementLayout(selectedElement.closest("[data-sq-fluid]"), layout, device), device);
      });
      selectedElement.after(copy);
      remember(snapshot);
      rebuildLayerList();
      bindSqInteractions();
      selectSqElement(copy);
      markSqChanged();
    };
    const deleteSelectedElement = () => {
      if (!selectedElement?.isConnected) return;
      const deletingBackground = selectedElement.matches(".sq-section-background");
      remember();
      const section = selectedElement.closest("[data-sq-fluid]");
      if (deletingBackground && section) section.dataset.sqBackgroundType = "solid";
      selectedElement.remove();
      selectedElement = null;
      selectedAction = null;
      selectedImage = null;
      selectedContent = null;
      removeElementOverlay();
      removeLayoutGrid();
      applyFluidSection(section);
      rebuildLayerList();
      bindSqInteractions();
      if (section?.dataset.sectionId) selectSqSection(section.dataset.sectionId, true);
      syncBackgroundManagers();
      markSqChanged();
      showToast(deletingBackground ? "Section background removed" : "Element deleted — Undo is available");
    };
    const bindElementPointerControl = (handle, resizing) => {
      if (!handle) return;
      handle.onpointerdown = (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!selectedElement?.isConnected) return;
        const section = selectedElement.closest("[data-sq-fluid]");
        const startLayout = parseElementLayout(selectedElement);
        const snapshot = captureState();
        const startX = event.clientX;
        const startY = event.clientY;
        layoutGridDragging = true;
        refreshLayoutGrid();
        const rect = section.getBoundingClientRect();
        const renderedScale = section.offsetWidth ? rect.width / section.offsetWidth : 1;
        const computed = getComputedStyle(section);
        const horizontalPadding = Number.parseFloat(computed.paddingLeft) + Number.parseFloat(computed.paddingRight);
        const columnGap = Number.parseFloat(computed.columnGap) || 0;
        const columns = fluidColumns();
        const columnWidth = (((section.clientWidth - horizontalPadding - columnGap * (columns - 1)) / columns) + columnGap) * renderedScale;
        const rowHeight = fluidRowHeight(section) * renderedScale;
        let changed = false;
        const move = (pointerEvent) => {
          const columns = Math.round((pointerEvent.clientX - startX) / columnWidth);
          const rows = Math.round((pointerEvent.clientY - startY) / rowHeight);
          const next = resizing
            ? { ...startLayout, width: startLayout.width + columns, height: startLayout.height + rows }
            : { ...startLayout, x: startLayout.x + columns, y: startLayout.y + rows };
          setElementLayout(selectedElement, next);
          applyFluidSection(section);
          syncElementControls();
          refreshElementOverlay();
          changed = changed || columns !== 0 || rows !== 0;
        };
        const end = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", end);
          window.removeEventListener("pointercancel", end);
          layoutGridDragging = false;
          revealLayoutGrid(650);
          if (changed) { remember(snapshot); markSqChanged(); }
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", end, { once: true });
        window.addEventListener("pointercancel", end, { once: true });
      };
    };
    const directDraggableElementTypes = new Set(["image", "divider", "spacer", "icon", "custom-code", "component-instance"]);
    const bindDirectElementDrag = (element) => {
      const enabled = directDraggableElementTypes.has(element?.dataset.sqElementType);
      element?.classList.toggle("sq-direct-draggable", enabled);
      if (!enabled) return;
      element.onpointerdown = (event) => {
        if (event.button !== 0 || cropEditingImage || event.target.closest?.("button,a,input,textarea,select,[contenteditable=true],.sq-element-toolbar,.sq-element-resize")) return;
        const section = element.closest("[data-sq-fluid]");
        if (!section) return;
        const startLayout = parseElementLayout(element);
        const snapshot = captureState();
        const startX = event.clientX;
        const startY = event.clientY;
        const sectionRect = section.getBoundingClientRect();
        const renderedScale = section.offsetWidth ? sectionRect.width / section.offsetWidth : 1;
        const computed = getComputedStyle(section);
        const gap = Number.parseFloat(computed.columnGap) || 0;
        const columns = fluidColumns();
        const columnWidth = (((section.clientWidth - Number.parseFloat(computed.paddingLeft) - Number.parseFloat(computed.paddingRight) - gap * (columns - 1)) / columns) + gap) * renderedScale;
        const rowHeight = fluidRowHeight(section) * renderedScale;
        let dragging = false;
        let changed = false;
        element.setPointerCapture?.(event.pointerId);
        const move = (pointerEvent) => {
          const dx = pointerEvent.clientX - startX;
          const dy = pointerEvent.clientY - startY;
          if (!dragging && Math.hypot(dx, dy) < 5) return;
          if (!dragging) {
            dragging = true;
            pointerEvent.preventDefault();
            selectSqSection(section.dataset.sectionId);
            selectSqElement(element, null, element.querySelector("img"));
            element.classList.add("sq-direct-dragging");
            layoutGridDragging = true;
            refreshLayoutGrid();
          }
          const columnDelta = Math.round(dx / Math.max(1, columnWidth));
          const rowDelta = Math.round(dy / Math.max(1, rowHeight));
          changed = columnDelta !== 0 || rowDelta !== 0;
          setElementLayout(element, { ...startLayout, x: startLayout.x + columnDelta, y: startLayout.y + rowDelta });
          applyFluidSection(section); syncElementControls(); refreshElementOverlay();
        };
        const end = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", end);
          window.removeEventListener("pointercancel", end);
          element.classList.remove("sq-direct-dragging");
          if (dragging) {
            directDragSuppressClicks.add(element);
            window.setTimeout(() => directDragSuppressClicks.delete(element), 0);
            layoutGridDragging = false;
            revealLayoutGrid(650);
            if (changed) { remember(snapshot); markSqChanged(); }
          }
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", end, { once: true });
        window.addEventListener("pointercancel", end, { once: true });
      };
    };

    const spacingKey = (section = selectedSection, device = activeDevice) => `${section}:${device}`;
    const defaultSpacing = (section = selectedSection, device = activeDevice) => {
      if (section === "announcement") return device === "mobile" ? { top: 7, right: 12, bottom: 7, left: 12 } : { top: 8, right: 18, bottom: 8, left: 18 };
      const gutter = pageSpacingState.gutters[device] ?? defaultPageSpacing.gutters[device];
      if (device === "mobile") return { top: 36, right: gutter, bottom: 36, left: gutter };
      if (device === "tablet") return { top: 52, right: gutter, bottom: 52, left: gutter };
      return { top: 70, right: gutter, bottom: 70, left: gutter };
    };
    const readSpacing = (section = selectedSection, device = activeDevice) => spacingState.get(spacingKey(section, device)) || defaultSpacing(section, device);
    const loadSpacingControls = () => {
      const values = readSpacing();
      sqStudio.querySelectorAll("[data-sq-spacing]").forEach((input) => {
        input.value = String(values[input.dataset.sqSpacing]);
        const output = sqStudio.querySelector(`[data-sq-spacing-output="${input.dataset.sqSpacing}"]`);
        if (output) output.textContent = input.value;
      });
      const label = sqStudio.querySelector("[data-sq-spacing-device]");
      if (label) label.textContent = activeDevice[0].toUpperCase() + activeDevice.slice(1);
    };
    const applySpacing = () => {
      const block = previewRoot?.querySelector(`[data-section-id="${selectedSection}"]`);
      const values = readSpacing();
      if (!block) return;
      block.style.paddingTop = `${values.top}px`;
      block.style.paddingRight = `${values.right}px`;
      block.style.paddingBottom = `${values.bottom}px`;
      block.style.paddingLeft = `${values.left}px`;
      syncSectionEdgeVariables(block);
    };
    const syncPageSpacingControls = () => {
      sqStudio.querySelectorAll("[data-sq-page-gutter]").forEach((input) => {
        const device = input.dataset.sqPageGutter;
        input.value = String(pageSpacingState.gutters[device]);
        const output = sqStudio.querySelector(`[data-sq-page-gutter-output="${device}"]`);
        if (output) output.textContent = `${pageSpacingState.gutters[device]}px`;
      });
      const gap = sqStudio.querySelector("[data-sq-page-column-gap]");
      const gapOutput = sqStudio.querySelector("[data-sq-page-column-gap-output]");
      if (gap) gap.value = String(pageSpacingState.columnGap);
      if (gapOutput) gapOutput.textContent = `${pageSpacingState.columnGap}px`;
      syncBuilderRanges();
    };
    const gridContentWidth = (device = activeDevice) => {
      const section = device === activeDevice ? previewRoot?.querySelector(`[data-section-id="${selectedSection}"][data-sq-fluid]`) || previewRoot?.querySelector("[data-sq-fluid]") : null;
      if (section?.clientWidth) {
        const computed = getComputedStyle(section);
        return Math.max(120, section.clientWidth - (Number.parseFloat(computed.paddingLeft) || 0) - (Number.parseFloat(computed.paddingRight) || 0));
      }
      return Math.max(120, ({ desktop: 1440, tablet: 768, mobile: 390 }[device] || 1440) - (pageSpacingState.gutters[device] || 0) * 2);
    };
    const gridCellWidth = (device = activeDevice) => Math.max(1, Math.round((gridContentWidth(device) - pageSpacingState.columnGap * (fluidColumns(device) - 1)) / fluidColumns(device)));
    const syncPageGridControls = () => {
      const density = sqStudio.querySelector("[data-sq-grid-density]");
      const densityOutput = sqStudio.querySelector("[data-sq-grid-density-output]");
      const countOutput = sqStudio.querySelector("[data-sq-grid-count-output]");
      const device = sqStudio.querySelector("[data-sq-grid-density-device]");
      const width = sqStudio.querySelector("[data-sq-grid-cell-width]");
      const widthOutput = sqStudio.querySelector("[data-sq-grid-cell-width-output]");
      const height = sqStudio.querySelector("[data-sq-grid-cell-height]");
      const heightOutput = sqStudio.querySelector("[data-sq-grid-cell-height-output]");
      const visibility = sqStudio.querySelector("[data-sq-show-layout-grid]");
      if (density) density.value = String(gridDensityState[activeDevice]);
      const matchingDensity = matchingGridDensity();
      if (densityOutput) densityOutput.textContent = matchingDensity ? gridDensityLabel(matchingDensity) : "Custom";
      const section = previewRoot?.querySelector(`[data-section-id="${selectedSection}"][data-sq-fluid]`) || previewRoot?.querySelector("[data-sq-fluid]");
      const rows = Math.max(1, Number.parseInt(section?.dataset.sqRows || section?.dataset.sqMinRows || "12", 10));
      if (countOutput) countOutput.textContent = `${fluidColumns()} columns × ${rows} rows`;
      if (device) device.textContent = activeDevice[0].toUpperCase() + activeDevice.slice(1);
      if (width) width.value = String(gridCellWidth());
      if (widthOutput) widthOutput.textContent = `${gridCellWidth()}px`;
      if (height) height.value = String(gridCellHeightState[activeDevice]);
      if (heightOutput) heightOutput.textContent = `${gridCellHeightState[activeDevice]}px`;
      if (visibility) visibility.checked = showLayoutGrid;
      sqStudio.querySelectorAll("[data-sq-grid-toggle]").forEach((button) => { button.classList.toggle("active", showLayoutGrid); button.setAttribute("aria-pressed", String(showLayoutGrid)); button.setAttribute("aria-label", showLayoutGrid ? "Hide rectangle grid" : "Show rectangle grid"); });
      syncBuilderRanges();
    };
    const applyPageGutter = (device, gutter) => {
      pageSpacingState.gutters[device] = gutter;
      previewRoot?.querySelectorAll("[data-section-id]").forEach((block) => {
        const section = block.dataset.sectionId;
        const values = { ...readSpacing(section, device), left: gutter, right: gutter };
        spacingState.set(spacingKey(section, device), values);
        if (device === activeDevice) {
          block.style.paddingLeft = `${gutter}px`;
          block.style.paddingRight = `${gutter}px`;
          syncSectionEdgeVariables(block);
        }
      });
    };

    const marqueeScrollRoot = sqStudio.querySelector(".sq-canvas-scroll");
    const observedMarquees = new WeakSet();
    let marqueeScrollFrame = 0;
    const marqueeMode = (element) => element?.dataset.sqMarqueeMode === "scroll" ? "scroll" : "auto";
    const marqueeSpeed = (element) => Math.max(20, Math.min(200, Number(element?.dataset.sqMarqueeSpeed) || 60));
    const updateScrollLinkedMarquees = () => {
      marqueeScrollFrame = 0;
      const scrollPosition = marqueeScrollRoot?.scrollTop || 0;
      previewRoot?.querySelectorAll('[data-sq-element-type="marquee"].sq-marquee-manual').forEach((element) => {
        const track = element.querySelector(".sq-marquee-track");
        const distance = Number.parseFloat(track?.style.getPropertyValue("--sq-marquee-distance")) || 1;
        const offset = (scrollPosition * marqueeSpeed(element) / 60) % distance;
        if (track) track.style.transform = `translate3d(${-offset}px,0,0)`;
      });
    };
    const scheduleScrollLinkedMarquees = () => {
      if (!marqueeScrollFrame) marqueeScrollFrame = window.requestAnimationFrame(updateScrollLinkedMarquees);
    };
    const syncMarqueeTrack = (element) => {
      if (element?.dataset.sqElementType !== "marquee") return;
      const track = element.querySelector(".sq-marquee-track");
      const source = track?.querySelector(".sq-marquee-copy:not([aria-hidden])");
      if (!track || !source) return;
      track.querySelectorAll('.sq-marquee-copy[aria-hidden="true"]').forEach((copy) => copy.remove());
      const copyWidth = Math.max(1, source.offsetWidth);
      const copies = Math.max(2, Math.ceil(Math.max(1, element.clientWidth) / copyWidth) + 2);
      for (let index = 1; index < copies; index += 1) {
        const copy = source.cloneNode(true);
        copy.removeAttribute("contenteditable");
        copy.removeAttribute("data-sq-editable");
        copy.setAttribute("aria-hidden", "true");
        track.append(copy);
      }
      const speed = marqueeSpeed(element);
      track.style.setProperty("--sq-marquee-distance", `${copyWidth}px`);
      track.style.setProperty("--sq-marquee-duration", `${Math.max(2, copyWidth / speed)}s`);
      const manual = marqueeMode(element) === "scroll";
      element.classList.toggle("sq-marquee-manual", manual);
      if (!manual) track.style.removeProperty("transform");
      else scheduleScrollLinkedMarquees();
    };
    const marqueeResizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver((entries) => entries.forEach((entry) => syncMarqueeTrack(entry.target))) : null;
    marqueeScrollRoot?.addEventListener("scroll", scheduleScrollLinkedMarquees, { passive: true });
    window.addEventListener("resize", () => previewRoot?.querySelectorAll('[data-sq-element-type="marquee"]').forEach(syncMarqueeTrack), { passive: true });
    const imageScrollHostFor = imageVisualHostFor;
    const editorImageScrollStates = new WeakMap();
    let editorImageScrollFrame = 0;
    let editorImageScrollTime = 0;
    const editorImageScrollClamp = (value) => Math.max(0, Math.min(1, value));
    const editorImageScrollDamp = (value, velocity, target, delta, smoothTime = .11) => {
      const omega = 2 / smoothTime;
      const x = omega * delta;
      const decay = 1 / (1 + x + .48 * x * x + .235 * x * x * x);
      const change = value - target;
      const temp = (velocity + omega * change) * delta;
      return [target + (change + temp) * decay, (velocity - omega * temp) * decay];
    };
    const releaseImageScrollEffect = (image) => {
      const host = imageScrollHostFor(image);
      image?.style.removeProperty("--sq-image-scroll-media-height");
      image?.style.removeProperty("--sq-image-scroll-scale");
      if (image) {
        image.style.transform = "";
        image.classList.remove("jarallax-img", "ezkart-scroll-media", "sq-image-scroll-media");
        editorImageScrollStates.delete(image);
      }
      if (host) {
        host.classList.remove("sq-image-scroll-host", "jarallax", "ezkart-scroll-frame");
        host.removeAttribute("data-jarallax");
        host.removeAttribute("data-speed");
        host.removeAttribute("data-type");
        host.removeAttribute("data-ezkart-scroll-effect");
        host.removeAttribute("data-ezkart-scroll-strength");
        host.removeAttribute("data-ezkart-scroll-damping");
      }
    };
    const updateEditorImageScrollEffects = (time) => {
      editorImageScrollFrame = 0;
      if (!previewRoot || !marqueeScrollRoot) return;
      const viewport = marqueeScrollRoot.getBoundingClientRect();
      const viewportHeight = Math.max(1, marqueeScrollRoot.clientHeight);
      const delta = Math.min(.05, editorImageScrollTime ? Math.max(0, (time - editorImageScrollTime) / 1000) : 1 / 60);
      editorImageScrollTime = time;
      let moving = false;
      previewRoot.querySelectorAll("img.sq-image-scroll-media:not([data-sq-image-scroll])").forEach(releaseImageScrollEffect);
      previewRoot.querySelectorAll('img[data-sq-image-scroll]:not([data-sq-image-scroll="none"])').forEach((image) => {
        const host = imageScrollHostFor(image);
        const rect = host?.getBoundingClientRect();
        if (!host || !rect || rect.height < 1 || rect.bottom < viewport.top - viewportHeight * .25 || rect.top > viewport.bottom + viewportHeight * .25) return;
        host.classList.add("sq-image-scroll-host");
        image.classList.add("sq-image-scroll-media");
        const effect = image.dataset.sqImageScroll === "parallax-deep" ? "parallax" : image.dataset.sqImageScroll;
        const strength = Math.max(0, Math.min(100, Number(image.dataset.sqImageScrollStrength) || 0)) / 100;
        const reverse = effect === "parallax-reverse";
        const zoom = effect === "zoom";
        const rate = reverse ? strength * .35 : strength;
        const progress = editorImageScrollClamp((viewport.bottom - rect.top) / (viewportHeight + rect.height));
        const displayScale = rect.height / Math.max(1, host.clientHeight);
        const visualOffset = zoom ? 0 : (progress - .5) * (viewportHeight + rect.height) * rate * (reverse ? -1 : 1);
        const yTarget = visualOffset / Math.max(.001, displayScale);
        const overscan = reverse ? (viewportHeight + rect.height) * rate : Math.max(0, viewportHeight - rect.height) * rate;
        const coverScale = zoom || !rate ? 1 : 1 + (overscan + 4) / rect.height;
        const cropScale = imageCropZoom(image);
        const scaleTarget = (zoom ? 1 + progress * strength * .3 : coverScale) * cropScale;
        const damping = image.dataset.sqImageScrollDamping !== "false";
        const state = editorImageScrollStates.get(image) || { y: yTarget, yVelocity: 0, scale: scaleTarget, scaleVelocity: 0 };
        if (damping) {
          [state.y, state.yVelocity] = editorImageScrollDamp(state.y, state.yVelocity, yTarget, delta);
          if (zoom) [state.scale, state.scaleVelocity] = editorImageScrollDamp(state.scale, state.scaleVelocity, scaleTarget, delta);
          else { state.scale = scaleTarget; state.scaleVelocity = 0; }
        } else {
          state.y = yTarget; state.yVelocity = 0; state.scale = scaleTarget; state.scaleVelocity = 0;
        }
        editorImageScrollStates.set(image, state);
        image.style.transform = `translate3d(0,${state.y.toFixed(3)}px,0) scale(${state.scale.toFixed(5)})`;
        if (damping && (Math.abs(yTarget - state.y) > .02 || Math.abs(state.yVelocity) > .02 || zoom && (Math.abs(scaleTarget - state.scale) > .0001 || Math.abs(state.scaleVelocity) > .0001))) moving = true;
      });
      if (moving) editorImageScrollFrame = window.requestAnimationFrame(updateEditorImageScrollEffects);
    };
    const scheduleImageScrollEffects = () => {
      if (!editorImageScrollFrame) {
        editorImageScrollTime = 0;
        editorImageScrollFrame = window.requestAnimationFrame(updateEditorImageScrollEffects);
      }
    };
    marqueeScrollRoot?.addEventListener("scroll", scheduleImageScrollEffects, { passive: true });
    window.addEventListener("resize", scheduleImageScrollEffects, { passive: true });
    if (typeof ResizeObserver === "function" && previewRoot) new ResizeObserver(scheduleImageScrollEffects).observe(previewRoot);
    const syncMarqueeCopies = (element, value, source = null) => {
      if (element?.dataset.sqElementType !== "marquee") return;
      element.querySelectorAll(".sq-marquee-copy").forEach((copy) => { if (copy !== source) copy.textContent = value; });
      window.requestAnimationFrame(() => syncMarqueeTrack(element));
    };
    const editableContentSelector = [
      ".sq-announcement>p",
      ".sq-site-logo>b", ".sq-store-nav a", ".sq-store-nav div>button",
      ".sq-hero-kicker", ".sq-hero-heading", ".sq-hero-description", ".sq-hero-action", ".sq-hero-trust",
      ".sq-hero-copy>span", ".sq-hero-copy>h1", ".sq-hero-copy>p", ".sq-hero-copy>div>button",
      ".sq-product-section>header span", ".sq-product-section>header h2", ".sq-product-section>header>p",
      ".sq-product-grid article small", ".sq-product-grid article h3", ".sq-product-grid article p", ".sq-product-grid article footer>button",
      ".sq-image-story>article>span", ".sq-image-story>article>h2", ".sq-image-story>article>p", ".sq-image-story>article>button",
      ".sq-benefit-row article b", ".sq-benefit-row article small",
      ".sq-cart-section>div>span", ".sq-cart-section>div>h2", ".sq-cart-section>div>p", ".sq-cart-section aside>small", ".sq-cart-section aside>button",
      ".sq-shipping-section>div>small", ".sq-shipping-section>div>h2", ".sq-shipping-section>div>p", ".sq-shipping-section li",
      ".sq-generated-text>small", ".sq-generated-text>h2", ".sq-generated-text>p",
      ".sq-generated-reviews b", ".sq-generated-reviews small",
      ".sq-generated-faq>h2", ".sq-generated-faq summary", ".sq-generated-faq p",
      ".sq-generated-spacer>span",
      ".sq-free-heading>h2", ".sq-free-text>p", ".sq-free-marquee .sq-marquee-copy:not([aria-hidden])", ".sq-free-button>button", ".sq-free-form>h3", ".sq-free-form>p",
    ].join(",");
    const editableNodesFor = (block) => block ? [...block.querySelectorAll(editableContentSelector)].filter((node) => !node.closest(".sq-image-drag-handle,.sq-nav-mobile-menu")) : [];
    const contentFieldLabel = (node, index) => {
      const article = node.closest("article");
      const group = article?.parentElement ? [...article.parentElement.children].filter((item) => item.matches("article")).indexOf(article) + 1 : 0;
      const prefix = group > 0 && (node.closest(".sq-benefit-row") || node.closest(".sq-product-grid") || node.closest(".sq-generated-reviews")) ? `${group} · ` : "";
      if (node.matches("h1,h2,h3")) return `${prefix}Heading`;
      if (node.matches("button")) return `${prefix}Button label`;
      if (node.matches("a")) return `${prefix}Navigation link`;
      if (node.matches("summary")) return `${prefix}Question`;
      if (node.matches("li")) return `${prefix}List item`;
      if (node.matches("p")) return `${prefix}Paragraph`;
      if (node.matches("b")) return `${prefix}Title`;
      if (node.matches("small")) return `${prefix}Supporting text`;
      return `${prefix}Text ${index + 1}`;
    };
    const syncInspectorContent = () => {
      const block = previewRoot?.querySelector(`[data-section-id="${selectedSection}"]`);
      const fields = sqStudio.querySelector("[data-sq-content-fields]");
      if (!fields) return;
      fields.replaceChildren();
      const nodes = editableNodesFor(block);
      if (!nodes.length) {
        const empty = document.createElement("p");
        empty.className = "sq-content-empty";
        empty.textContent = "This section has no text content. Its visual controls are available below.";
        fields.append(empty);
        return;
      }
      nodes.forEach((node, index) => {
        if (!node.dataset.sqEditable) node.dataset.sqEditable = `copy-${index + 1}`;
        const label = document.createElement("label");
        const caption = document.createElement("span");
        caption.textContent = contentFieldLabel(node, index);
        const multiline = node.matches("h1,h2,h3,p,summary") || node.textContent.trim().length > 55;
        const input = document.createElement(multiline ? "textarea" : "input");
        input.value = node.textContent.trim();
        input.dataset.sqContentField = node.dataset.sqEditable;
        let before;
        let remembered = false;
        input.addEventListener("focus", () => { before = captureState(); remembered = false; });
        input.addEventListener("input", () => {
          if (!before) before = captureState();
          node.textContent = input.value;
          syncMarqueeCopies(node.closest("[data-sq-element]"), input.value, node);
          if (!remembered) { remember(before); remembered = true; }
          markSqChanged();
        });
        input.addEventListener("change", () => { before = null; remembered = false; });
        label.append(caption, input);
        fields.append(label);
      });
    };
    const removeSectionToolbar = () => previewRoot?.querySelectorAll(".sq-section-toolbar").forEach((toolbar) => toolbar.remove());
    const refreshSectionToolbar = () => {
      removeSectionToolbar();
      if (selectedElement?.isConnected) return;
      const block = previewRoot?.querySelector(`[data-section-id="${selectedSection}"]`);
      if (!block) return;
      const toolbar = document.createElement("div");
      toolbar.className = "sq-section-toolbar";
      toolbar.innerHTML = `<span>${iconMarkup("layers")} ${escapeHtml(sectionNames[selectedSection] || "Section")}</span><button type="button" data-sq-toolbar-duplicate>${iconMarkup("layers")} Duplicate</button><button type="button" data-sq-toolbar-delete>${iconMarkup("x")} Delete</button>`;
      toolbar.onclick = (event) => event.stopPropagation();
      toolbar.querySelector("[data-sq-toolbar-duplicate]").onclick = () => sqStudio.querySelector("[data-sq-duplicate]")?.click();
      toolbar.querySelector("[data-sq-toolbar-delete]").onclick = () => sqStudio.querySelector("[data-sq-delete]")?.click();
      block.append(toolbar);
    };
    const selectSqSection = (sectionId, focusSection = false) => {
      inspector?.classList.remove("page-spacing-open");
      const pageControls = sqStudio.querySelector("[data-sq-page-spacing-controls]");
      if (pageControls) pageControls.hidden = true;
      sqStudio.querySelectorAll("[data-sq-section-controls]").forEach((control) => { control.hidden = false; });
      const sectionActions = sqStudio.querySelector("[data-sq-section-actions]");
      if (sectionActions) sectionActions.hidden = false;
      selectedSection = sectionId;
      sqStudio.classList.remove("mobile-panel-open");
      sqStudio.classList.remove("inspector-closed");
      inspector?.classList.remove("collapsed");
      sqStudio.querySelectorAll("[data-sq-layer]").forEach((layer) => layer.classList.toggle("active", layer.dataset.sectionId === sectionId));
      sqStudio.querySelectorAll("[data-sq-layer-group]").forEach((group) => group.classList.toggle("active", group.dataset.sectionId === sectionId));
      previewRoot?.querySelectorAll("[data-sq-block]").forEach((block) => block.classList.toggle("selected", block.dataset.sectionId === sectionId));
      const title = sqStudio.querySelector("[data-sq-inspector-title]");
      const context = sqStudio.querySelector("[data-sq-inspector-context]");
      const layerTitle = sqStudio.querySelector(`[data-sq-layer][data-section-id="${sectionId}"] b`)?.textContent;
      if (context) context.textContent = "Section settings";
      if (title) title.textContent = layerTitle || sectionNames[sectionId] || "Section";
      const block = previewRoot?.querySelector(`[data-section-id="${sectionId}"]`);
      if (selectedElement && (focusSection || !block?.contains(selectedElement))) {
        selectedElement = null;
        selectedAction = null;
        selectedImage = null;
        selectedContent = null;
        previewRoot?.querySelectorAll(".sq-element-selected").forEach((item) => item.classList.remove("sq-element-selected"));
        removeElementOverlay();
        removeLayoutGrid();
      }
      if (!selectedElement) sqStudio.querySelectorAll("[data-sq-element-layer]").forEach((layer) => layer.classList.remove("active"));
      const visibility = sqStudio.querySelector("[data-sq-visibility]");
      if (visibility) visibility.lastChild.textContent = block?.classList.contains("section-hidden") ? " Show" : " Hide";
      const animation = sqStudio.querySelector("[data-sq-animation]");
      if (animation) animation.value = block?.dataset.animation || "none";
      const duration = parseInt(block?.style.getPropertyValue("--animation-duration") || "600", 10);
      const delay = parseInt(block?.style.getPropertyValue("--animation-delay") || "0", 10);
      const durationInput = sqStudio.querySelector("[data-sq-duration]");
      const delayInput = sqStudio.querySelector("[data-sq-delay]");
      if (durationInput) durationInput.value = String(duration);
      if (delayInput) delayInput.value = String(delay);
      const durationOutput = sqStudio.querySelector("[data-sq-duration-output]");
      const delayOutput = sqStudio.querySelector("[data-sq-delay-output]");
      if (durationOutput) durationOutput.textContent = `${duration}ms`;
      if (delayOutput) delayOutput.textContent = `${delay}ms`;
      loadSpacingControls();
      if (spacingState.has(spacingKey())) applySpacing();
      syncInspectorContent();
      syncElementControls();
      syncBackgroundManagers();
      if (selectedElement) requestAnimationFrame(refreshElementOverlay);
      else { sqStudio.querySelector(".sq-inspector-scroll")?.scrollTo({ top: 0, behavior: "smooth" }); requestAnimationFrame(refreshSectionToolbar); }
    };
    const deselectSqItem = (sectionId = selectedSection) => {
      if (cropEditingImage) imageVisualHostFor(cropEditingImage)?.classList.remove("sq-image-crop-editing");
      cropEditingImage = null;
      selectSqSection(sectionId || selectedSection || "hero", true);
    };

    const reorderSection = (dragId, targetId, placeAfter) => {
      if (!dragId || !targetId || dragId === targetId) return;
      remember();
      const draggedLayer = layerList?.querySelector(`[data-sq-layer-group][data-section-id="${dragId}"]`);
      const targetLayer = layerList?.querySelector(`[data-sq-layer-group][data-section-id="${targetId}"]`);
      const draggedBlock = previewRoot?.querySelector(`[data-section-id="${dragId}"]`);
      const targetBlock = previewRoot?.querySelector(`[data-section-id="${targetId}"]`);
      if (!draggedLayer || !targetLayer || !draggedBlock || !targetBlock) return;
      targetLayer[placeAfter ? "after" : "before"](draggedLayer);
      targetBlock[placeAfter ? "after" : "before"](draggedBlock);
      selectSqSection(dragId);
      markSqChanged();
    };
    const bindSqInteractions = () => {
      previewRoot?.querySelectorAll(".animating, .sq-element-animate").forEach((element) => element.classList.remove("animating", "sq-element-animate"));
      previewRoot?.querySelectorAll('[data-sq-element-type="review"]').forEach((element) => renderReviewStars(element));
      previewRoot?.querySelectorAll('[data-sq-element-type="component-instance"]').forEach(syncComponentInstance);
      previewRoot?.querySelectorAll('[data-sq-element-type="marquee"]').forEach((element) => {
        syncMarqueeTrack(element);
        if (!observedMarquees.has(element)) { observedMarquees.add(element); marqueeResizeObserver?.observe(element); }
      });
      scheduleImageScrollEffects();
      sqStudio.querySelectorAll("[data-sq-background-layer]").forEach((button) => {
        button.onclick = (event) => { event.stopPropagation(); selectBackgroundLayer(button.dataset.sqBackgroundLayer, button.dataset.sectionId || selectedSection); };
      });
      previewRoot?.querySelectorAll('[class*="hover-"]').forEach((element) => {
        [...element.classList].filter((name) => name.startsWith("hover-")).forEach((name) => element.classList.remove(name));
      });
      sqStudio.querySelectorAll("[data-sq-layer]").forEach((layer) => {
        layer.onclick = () => {
          selectSqSection(layer.dataset.sectionId, true);
          previewRoot?.querySelector(`[data-section-id="${layer.dataset.sectionId}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
        };
        layer.ondragstart = (event) => { draggedSection = layer.dataset.sectionId; layer.classList.add("dragging"); event.dataTransfer.effectAllowed = "move"; };
        layer.ondragover = (event) => { event.preventDefault(); layer.classList.add("drag-over"); };
        layer.ondragleave = () => layer.classList.remove("drag-over");
        layer.ondrop = (event) => { event.preventDefault(); layer.classList.remove("drag-over"); const rect = layer.getBoundingClientRect(); reorderSection(draggedSection, layer.dataset.sectionId, event.clientY > rect.top + rect.height / 2); };
        layer.ondragend = () => { layer.classList.remove("dragging"); sqStudio.querySelectorAll(".drag-over").forEach((item) => item.classList.remove("drag-over")); };
      });
      sqStudio.querySelectorAll("[data-sq-element-layer]").forEach((layer) => {
        layer.onclick = (event) => {
          event.stopPropagation();
          const element = [...(previewRoot?.querySelectorAll("[data-sq-element]") || [])].find((candidate) => candidate.dataset.sqElementId === layer.dataset.sqElementLayer);
          if (!element) return;
          const section = element.closest("[data-section-id]");
          if (selectedElement === element) { if (section) selectSqSection(section.dataset.sectionId, true); return; }
          if (section) selectSqSection(section.dataset.sectionId);
          const action = element.matches("button,a") ? element : element.querySelector("button,a");
          const image = element.matches("img") ? element : element.querySelector("img");
          const content = section ? editableNodesFor(section).find((node) => node === element || element.contains(node)) : null;
          selectSqElement(element, action, image, content);
          element.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
        };
        layer.ondragstart = (event) => { event.stopPropagation(); draggedElementId = layer.dataset.sqElementLayer; layer.classList.add("dragging"); event.dataTransfer.effectAllowed = "move"; };
        layer.ondragover = (event) => { if (!draggedElementId) return; event.preventDefault(); event.stopPropagation(); layer.classList.add("drag-over"); };
        layer.ondragleave = () => layer.classList.remove("drag-over");
        layer.ondrop = (event) => {
          event.preventDefault(); event.stopPropagation(); layer.classList.remove("drag-over");
          const dragged = [...(previewRoot?.querySelectorAll("[data-sq-element]") || [])].find((candidate) => candidate.dataset.sqElementId === draggedElementId);
          const target = [...(previewRoot?.querySelectorAll("[data-sq-element]") || [])].find((candidate) => candidate.dataset.sqElementId === layer.dataset.sqElementLayer);
          if (!dragged || !target || dragged === target || dragged.parentElement !== target.parentElement) return;
          remember();
          const rect = layer.getBoundingClientRect();
          target[event.clientY > rect.top + rect.height / 2 ? "after" : "before"](dragged);
          rebuildLayerList(); bindSqInteractions(); selectSqElement(dragged); markSqChanged();
        };
        layer.ondragend = () => { draggedElementId = ""; layer.classList.remove("dragging"); sqStudio.querySelectorAll(".drag-over").forEach((item) => item.classList.remove("drag-over")); };
      });
      previewRoot?.querySelectorAll("[data-sq-block]").forEach((block) => {
        ensureSectionHeightHandle(block);
        block.onclick = (event) => {
          event.stopPropagation();
          const sectionId = block.dataset.sectionId;
          selectSqSection(sectionId, true);
        };
        block.ondragstart = (event) => { draggedSection = block.dataset.sectionId; block.classList.add("dragging"); event.dataTransfer.effectAllowed = "move"; };
        block.ondragover = (event) => {
          if (["element", "component"].includes(libraryDrag?.kind)) {
            event.preventDefault(); event.stopPropagation();
            event.dataTransfer.dropEffect = "copy";
            updateLibraryDropPreview(block, event);
            return;
          }
          event.preventDefault(); block.classList.add("drag-over");
        };
        block.ondragleave = (event) => {
          if (["element", "component"].includes(libraryDrag?.kind)) {
            if (!block.contains(event.relatedTarget)) clearLibraryDropPreview();
            return;
          }
          block.classList.remove("drag-over");
        };
        block.ondrop = (event) => {
          event.preventDefault(); block.classList.remove("drag-over");
          if (["element", "component"].includes(libraryDrag?.kind)) { event.stopPropagation(); dropLibraryElement(block, event); return; }
          const rect = block.getBoundingClientRect(); reorderSection(draggedSection, block.dataset.sectionId, event.clientY > rect.top + rect.height / 2);
        };
        block.ondragend = () => { block.classList.remove("dragging"); previewRoot.querySelectorAll(".drag-over").forEach((item) => item.classList.remove("drag-over")); };
      });
      applyFluidLayouts();
      previewRoot?.querySelectorAll(".sq-free-code").forEach(renderCodeElement);
      previewRoot?.querySelectorAll("[data-sq-fluid] > [data-sq-element]").forEach((element, index) => {
        if (!element.dataset.sqElementId) element.dataset.sqElementId = `element-${Date.now()}-${index}`;
        if (element.matches("button") || element.querySelector("button")) {
          applyButtonRoleToElement(element, element.dataset.sqButtonRole || (element.dataset.sqElementType === "navigation" ? "secondary" : "primary"));
        }
        if (element.dataset.sqElementType !== "product-grid") {
          const actions = element.matches("button,a") ? [element] : [...element.querySelectorAll("button,a")];
          actions.forEach((action) => {
            if (!action.dataset.sqLinkType) action.dataset.sqLinkType = inferredActionType(action);
            if (action.dataset.sqLink == null) action.dataset.sqLink = inferredActionTarget(action, action.dataset.sqLinkType);
            if (action.dataset.sqNewTab == null) action.dataset.sqNewTab = String(action.target === "_blank");
          });
        }
        element.draggable = false;
        element.querySelectorAll("img").forEach((image) => { image.draggable = false; });
        bindDirectElementDrag(element);
        element.onclick = (event) => {
          event.stopPropagation();
          if (directDragSuppressClicks.has(element)) return;
          const section = element.closest("[data-section-id]");
          const action = event.target.closest?.("button,a");
          const image = event.target.closest?.("img");
          if (selectedElement === element && (!action || selectedAction === action)) { if (section) selectSqSection(section.dataset.sectionId, true); return; }
          if (section) selectSqSection(section.dataset.sectionId);
          selectSqElement(element, action, image);
        };
      });
      previewRoot?.querySelectorAll("[data-sq-image-list]").forEach((list) => {
        [...list.children].filter((item) => item.matches("[data-sq-image-item]")).forEach((item) => {
          item.draggable = true;
          item.querySelectorAll("img").forEach((image) => { image.draggable = false; });
          if (!item.matches("img") && !item.querySelector(".sq-image-drag-handle")) {
            item.insertAdjacentHTML("afterbegin", `<span class="sq-image-drag-handle" aria-hidden="true">${iconMarkup("grip")}<small>Drag image</small></span>`);
          }
          item.onclick = (event) => {
            event.stopPropagation();
            const section = item.closest("[data-section-id]");
            if (selectedElement === item.closest("[data-sq-element]")) { if (section) selectSqSection(section.dataset.sectionId, true); return; }
            if (section) selectSqSection(section.dataset.sectionId);
            selectSqElement(item.closest("[data-sq-element]"), null, item.querySelector("img"));
            previewRoot.querySelectorAll(".sq-image-selected").forEach((image) => image.classList.remove("sq-image-selected"));
            item.classList.add("sq-image-selected");
          };
          item.ondragstart = (event) => {
            event.stopPropagation();
            draggedImage = item;
            draggedImageSnapshot = captureState();
            item.classList.add("sq-image-dragging");
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", item.dataset.productVisual || "image");
          };
          item.ondragover = (event) => {
            if (!draggedImage || draggedImage.parentElement !== list) return;
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = "move";
            item.classList.add("sq-image-drop-target");
          };
          item.ondragleave = (event) => { event.stopPropagation(); item.classList.remove("sq-image-drop-target"); };
          item.ondrop = (event) => {
            event.preventDefault();
            event.stopPropagation();
            item.classList.remove("sq-image-drop-target");
            if (!draggedImage || draggedImage === item || draggedImage.parentElement !== list) return;
            const items = [...list.children];
            if (items.indexOf(draggedImage) < items.indexOf(item)) item.after(draggedImage);
            else item.before(draggedImage);
            if (draggedImageSnapshot) remember(draggedImageSnapshot);
            updateProductView();
            draggedImage.classList.add("sq-image-selected");
            markSqChanged();
          };
          item.ondragend = (event) => {
            event.stopPropagation();
            item.classList.remove("sq-image-dragging");
            list.querySelectorAll(".sq-image-drop-target").forEach((image) => image.classList.remove("sq-image-drop-target"));
            draggedImage = null;
            draggedImageSnapshot = null;
          };
          item.onkeydown = (event) => {
            if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
            const moveBackward = event.key === "ArrowLeft" || event.key === "ArrowUp";
            const sibling = moveBackward ? item.previousElementSibling : item.nextElementSibling;
            if (!sibling?.matches("[data-sq-image-item]")) return;
            event.preventDefault();
            remember();
            if (moveBackward) sibling.before(item); else sibling.after(item);
            updateProductView();
            item.focus();
            markSqChanged();
          };
        });
      });
      previewRoot?.querySelectorAll("[data-sq-product-grid]").forEach((grid) => {
        let draggedCard = null;
        let productOrderSnapshot = null;
        [...grid.querySelectorAll(":scope > [data-product-card]")].forEach((card) => {
          card.draggable = true;
          card.tabIndex = 0;
          card.ondragstart = (event) => {
            event.stopPropagation();
            draggedCard = card;
            productOrderSnapshot = captureState();
            card.classList.add("sq-product-dragging");
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", card.dataset.productCard || "product");
          };
          card.ondragover = (event) => {
            if (!draggedCard || draggedCard === card) return;
            event.preventDefault(); event.stopPropagation();
            card.classList.add("sq-product-drop-target");
          };
          card.ondragleave = () => card.classList.remove("sq-product-drop-target");
          card.ondrop = (event) => {
            event.preventDefault(); event.stopPropagation();
            card.classList.remove("sq-product-drop-target");
            if (!draggedCard || draggedCard === card) return;
            const cards = [...grid.children];
            if (cards.indexOf(draggedCard) < cards.indexOf(card)) card.after(draggedCard); else card.before(draggedCard);
            if (productOrderSnapshot) remember(productOrderSnapshot);
            productOrderSnapshot = null;
            markSqChanged();
          };
          card.ondragend = () => {
            card.classList.remove("sq-product-dragging");
            grid.querySelectorAll(".sq-product-drop-target").forEach((item) => item.classList.remove("sq-product-drop-target"));
            draggedCard = null; productOrderSnapshot = null;
          };
          card.onkeydown = (event) => {
            if (!(event.altKey && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key))) return;
            const backward = event.key === "ArrowLeft" || event.key === "ArrowUp";
            const sibling = backward ? card.previousElementSibling : card.nextElementSibling;
            if (!sibling?.matches("[data-product-card]")) return;
            event.preventDefault(); remember();
            if (backward) sibling.before(card); else sibling.after(card);
            card.focus(); markSqChanged();
          };
        });
      });
      previewRoot?.querySelectorAll("[data-sq-block]").forEach((block) => {
        editableNodesFor(block).forEach((content, index) => {
          if (!content.dataset.sqEditable) content.dataset.sqEditable = `copy-${index + 1}`;
          content.contentEditable = content.matches("button,a") ? "false" : "true";
          content.spellcheck = true;
          content.draggable = false;
          const startInlineEdit = () => {
            if (!inlineEditSnapshots.has(content)) inlineEditSnapshots.set(content, { state: captureState(), text: content.textContent, remembered: false });
          };
          content.onpointerdown = (event) => { event.stopPropagation(); startInlineEdit(); };
          content.onclick = (event) => {
            event.stopPropagation();
            const isAction = content.matches("a,button");
            if (isAction) event.preventDefault();
            const element = content.closest("[data-sq-element]");
            if (!isAction && selectedElement === element) { selectSqSection(block.dataset.sectionId, true); return; }
            if (isAction && selectedElement === element && selectedAction === content) { selectSqSection(block.dataset.sectionId, true); return; }
            selectSqSection(block.dataset.sectionId);
            selectSqElement(element, isAction ? content : null, null, isAction ? null : content);
          };
          content.ondragstart = (event) => event.stopPropagation();
          content.onfocus = startInlineEdit;
          content.onbeforeinput = startInlineEdit;
          content.oninput = () => {
            const before = inlineEditSnapshots.get(content);
            if (before && !before.remembered) { remember(before.state); before.remembered = true; }
            syncMarqueeCopies(content.closest("[data-sq-element]"), content.textContent, content);
            const inspectorField = sqStudio.querySelector(`[data-sq-content-field="${content.dataset.sqEditable}"]`);
            if (inspectorField) inspectorField.value = content.textContent.trim();
            markSqChanged();
          };
          content.onblur = () => inlineEditSnapshots.delete(content);
        });
      });
      previewRoot.onclick = (event) => {
        if (event.target.closest?.("[data-sq-element], [data-sq-block]")) return;
        deselectSqItem(selectedSection);
      };
    };

    const bindSqProductInput = (input) => {
      input.onchange = () => {
        if (selectedProducts().length === 0) {
          input.checked = true;
          showToast("Keep at least one product connected to the page");
          return;
        }
        const previous = captureState();
        previous.products = input.checked ? previous.products.filter((value) => value !== input.value) : [...previous.products, input.value];
        remember(previous);
        updateProductView();
        markSqChanged();
      };
    };

    const restoreState = (state) => {
      if (!previewRoot || !layerList) return;
      selectedElement = null;
      selectedAction = null;
      selectedImage = null;
      selectedContent = null;
      previewRoot.innerHTML = state.preview;
      previewRoot.className = state.previewClass;
      if (state.previewStyle) previewRoot.setAttribute("style", state.previewStyle); else previewRoot.removeAttribute("style");
      previewRoot.querySelectorAll("[data-sq-nav-position]").forEach(applyNavigationSectionBehavior);
      setExtraPageHeight(Number.parseFloat(previewRoot.style.getPropertyValue("--sq-page-extra-height")) || 0);
      upgradeLegacyStructure();
      previewRoot.querySelectorAll("img[data-sq-image-blend-mode],img[data-sq-image-blend-source],img[data-sq-image-blend-color]").forEach(applyImageBlend);
      previewRoot.querySelectorAll("img[data-sq-image-crop-zoom],img[data-sq-image-crop-x],img[data-sq-image-crop-y]").forEach(applyImageCrop);
      previewRoot.querySelectorAll("img[data-sq-filter-opacity]").forEach(applySelectedImageFilters);
      rebuildLayerList();
      const productPicker = sqStudio.querySelector(".sq-product-picker");
      if (productPicker && typeof state.productPicker === "string") productPicker.innerHTML = state.productPicker;
      if (state.catalog) {
        Object.assign(productPrices, state.catalog.prices || {});
        Object.assign(productNames, state.catalog.names || {});
        Object.assign(productImages, state.catalog.images || {});
        Object.assign(productMeta, state.catalog.meta || {});
      }
      sqStudio.querySelectorAll("[data-sq-product]").forEach(bindSqProductInput);
      sqStudio.querySelectorAll("[data-sq-product]").forEach((input) => { input.checked = (state.products || []).includes(input.value); });
      spacingState.clear();
      try { JSON.parse(state.spacing || "[]").forEach(([key, value]) => spacingState.set(key, value)); } catch (_) { spacingState.clear(); }
      const savedPageSpacing = state.pageSpacing || {};
      ["desktop", "tablet", "mobile"].forEach((device) => { const value = Number(savedPageSpacing.gutters?.[device] ?? defaultPageSpacing.gutters[device]); pageSpacingState.gutters[device] = Number.isFinite(value) ? Math.max(0, value) : defaultPageSpacing.gutters[device]; });
      const savedColumnGap = Number(savedPageSpacing.columnGap ?? defaultPageSpacing.columnGap);
      pageSpacingState.columnGap = Number.isFinite(savedColumnGap) ? Math.max(0, savedColumnGap) : defaultPageSpacing.columnGap;
      ["desktop", "tablet", "mobile"].forEach((device) => { const density = Math.round(Number(state.gridDensity?.[device] ?? defaultGridDensity[device])); gridDensityState[device] = Math.max(1, Math.min(5, Number.isFinite(density) ? density : defaultGridDensity[device])); });
      ["desktop", "tablet", "mobile"].forEach((device) => {
        const density = gridDensityState[device];
        gridColumnsState[device] = Math.max(2, Math.min(24, Math.round(Number(state.gridColumns?.[device] ?? gridDensityPresets[density].columns))));
        gridCellHeightState[device] = Math.max(6, Math.min(72, Math.round(Number(state.gridCellHeight?.[device] ?? gridDensityPresets[density].cellHeight))));
      });
      previewRoot.style.setProperty("--sq-builder-column-gap", `${pageSpacingState.columnGap}px`);
      bindSqInteractions();
      updateProductView();
      applyFluidLayouts();
      deselectSqItem(state.selectedSection || "hero");
      syncBrandControls();
      syncPageSpacingControls();
      syncPageGridControls();
      markSqChanged();
    };
    const undoBuilderChange = () => {
      if (!undoStack.length) return;
      redoStack.push(captureState());
      restoreState(undoStack.pop());
      updateHistoryButtons();
    };
    const redoBuilderChange = () => {
      if (!redoStack.length) return;
      undoStack.push(captureState());
      restoreState(redoStack.pop());
      updateHistoryButtons();
    };
    undoButton?.addEventListener("click", undoBuilderChange);
    redoButton?.addEventListener("click", redoBuilderChange);
    document.addEventListener("keydown", (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== "z") return;
      const editingText = event.target.matches?.("input, textarea, [contenteditable='true']");
      if (editingText) return;
      event.preventDefault();
      if (event.shiftKey) redoBuilderChange(); else undoBuilderChange();
    });

    sqStudio.querySelectorAll("[data-sq-product]").forEach(bindSqProductInput);

    const storefrontOptionGroups = (product, variants) => {
      const explicit = (Array.isArray(product?.options) ? product.options : []).map((group) => {
        const name = String(group?.name || "").trim();
        const values = [...new Set((Array.isArray(group?.values) ? group.values : []).map((value) => String(value).trim()).filter(Boolean))]
          .filter((value) => variants.some((variant) => variant.options?.some((option) => option.option === name && option.value === value)));
        return { name, values };
      }).filter((group) => group.name && group.values.length);
      if (explicit.length) return explicit;
      const names = [];
      variants.forEach((variant) => (variant.options || []).forEach((option) => {
        const name = String(option?.option || "").trim();
        if (name && !names.includes(name)) names.push(name);
      }));
      return names.map((name) => ({
        name,
        values: [...new Set(variants.map((variant) => variant.options?.find((option) => option.option === name)?.value).map((value) => String(value || "").trim()).filter(Boolean))],
      })).filter((group) => group.values.length);
    };
    const installStorefrontVariantControls = (card, product, variants, fallbackPrice, fallbackImage) => {
      if (!card) return;
      const previousVariant = card.dataset.sqSelectedVariant || card.querySelector("[data-sq-variant-picker]")?.value || "";
      card.querySelectorAll(".sq-product-variant, [data-sq-product-options]").forEach((control) => control.remove());
      if (!variants.length) return;
      const groups = storefrontOptionGroups(product, variants);
      if (!groups.length) return;
      const controls = document.createElement("div");
      controls.className = "sq-product-options";
      controls.dataset.sqProductOptions = "";
      controls.dataset.ezkartVariants = JSON.stringify(variants.map((variant) => ({
        id: variant.id,
        price: Math.max(1000, Number(variant.price) || fallbackPrice),
        image: variant.image || fallbackImage,
        options: variant.options || [],
      })));
      const initialVariant = variants.find((variant) => variant.id === previousVariant) || variants[0];
      groups.forEach((group, index) => {
        const field = document.createElement("div");
        const caption = document.createElement("span");
        const trigger = document.createElement("button");
        const valueLabel = document.createElement("span");
        const menu = document.createElement("div");
        field.className = "sq-product-option";
        field.dataset.sqVariantOption = String(index);
        field.dataset.ezkartOption = group.name;
        trigger.type = "button";
        trigger.className = "sq-product-option-trigger";
        trigger.setAttribute("aria-haspopup", "listbox");
        trigger.setAttribute("aria-expanded", "false");
        valueLabel.className = "sq-product-option-value";
        valueLabel.textContent = group.values[0];
        trigger.append(valueLabel);
        trigger.insertAdjacentHTML("beforeend", '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="m3 4.5 3 3 3-3"/></svg>');
        menu.className = "sq-product-option-menu";
        menu.setAttribute("role", "listbox");
        menu.setAttribute("aria-label", group.name);
        menu.hidden = true;
        caption.textContent = group.name;
        group.values.forEach((value) => {
          const option = document.createElement("button");
          option.type = "button";
          option.setAttribute("role", "option");
          option.dataset.ezkartOptionValue = value;
          option.textContent = value;
          menu.append(option);
        });
        const initialValue = initialVariant.options?.find((option) => option.option === group.name)?.value;
        field.dataset.ezkartValue = initialValue && group.values.includes(initialValue) ? initialValue : group.values[0];
        valueLabel.textContent = field.dataset.ezkartValue;
        field.append(caption, trigger, menu);
        controls.append(field);
      });
      const footer = card.querySelector("footer");
      if (footer) footer.before(controls);
      else card.querySelector(":scope > div")?.append(controls);
      const optionControls = [...controls.querySelectorAll("[data-sq-variant-option]")];
      const valueFor = (variant, group) => variant.options?.find((option) => option.option === group.name)?.value;
      const closeMenus = (except = null) => optionControls.forEach((control) => {
        if (control === except) return;
        control.querySelector(".sq-product-option-menu").hidden = true;
        control.querySelector(".sq-product-option-trigger").setAttribute("aria-expanded", "false");
      });
      const setControlValue = (control, value) => {
        control.dataset.ezkartValue = value;
        const label = control.querySelector(".sq-product-option-value");
        if (label) label.textContent = value;
        control.querySelectorAll("[data-ezkart-option-value]").forEach((option) => {
          const selected = option.dataset.ezkartOptionValue === value;
          option.classList.toggle("selected", selected);
          option.setAttribute("aria-selected", String(selected));
        });
      };
      const applyVariant = (changedIndex = -1) => {
        let selected = variants.find((variant) => groups.every((group, index) => valueFor(variant, group) === optionControls[index].dataset.ezkartValue));
        if (!selected && changedIndex >= 0) selected = variants.find((variant) => valueFor(variant, groups[changedIndex]) === optionControls[changedIndex].dataset.ezkartValue);
        selected ||= variants[0];
        groups.forEach((group, index) => { const value = valueFor(selected, group); if (value) setControlValue(optionControls[index], value); });
        card.dataset.sqSelectedVariant = selected.id || "";
        const priceTarget = card.querySelector("footer b");
        const imageTarget = card.querySelector(".product-art img");
        if (priceTarget) priceTarget.textContent = formatRupiah(Math.max(1000, Number(selected.price) || fallbackPrice));
        if (imageTarget) imageTarget.src = selected.image || fallbackImage;
        optionControls.forEach((control, index) => control.querySelectorAll("[data-ezkart-option-value]").forEach((option) => {
          option.disabled = !variants.some((variant) => groups.every((group, groupIndex) => groupIndex === index ? valueFor(variant, group) === option.dataset.ezkartOptionValue : valueFor(variant, group) === optionControls[groupIndex].dataset.ezkartValue));
        }));
      };
      optionControls.forEach((control, index) => {
        const trigger = control.querySelector(".sq-product-option-trigger");
        const menu = control.querySelector(".sq-product-option-menu");
        const options = [...menu.querySelectorAll("[data-ezkart-option-value]")];
        const openMenu = () => {
          const opening = menu.hidden;
          closeMenus(opening ? control : null);
          menu.hidden = !opening;
          trigger.setAttribute("aria-expanded", String(opening));
          controls.closest("[data-sq-product-grid]")?.classList.toggle("sq-option-menu-open", opening);
          if (opening) (options.find((option) => option.classList.contains("selected")) || options.find((option) => !option.disabled))?.focus();
        };
        trigger.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); openMenu(); });
        trigger.addEventListener("keydown", (event) => { if (["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); openMenu(); } });
        options.forEach((option) => option.addEventListener("click", (event) => {
          event.preventDefault(); event.stopPropagation();
          if (option.disabled) return;
          setControlValue(control, option.dataset.ezkartOptionValue);
          applyVariant(index);
          closeMenus();
          controls.closest("[data-sq-product-grid]")?.classList.remove("sq-option-menu-open");
          trigger.focus();
        }));
        menu.addEventListener("keydown", (event) => {
          const enabled = options.filter((option) => !option.disabled);
          const current = enabled.indexOf(document.activeElement);
          if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
            event.preventDefault();
            const next = event.key === "Home" ? 0 : event.key === "End" ? enabled.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + enabled.length) % enabled.length;
            enabled[next]?.focus();
          }
          if (event.key === "Escape") { event.preventDefault(); closeMenus(); controls.closest("[data-sq-product-grid]")?.classList.remove("sq-option-menu-open"); trigger.focus(); }
        });
      });
      controls.addEventListener("focusout", (event) => {
        if (controls.contains(event.relatedTarget)) return;
        closeMenus();
        controls.closest("[data-sq-product-grid]")?.classList.remove("sq-option-menu-open");
      });
      applyVariant();
    };

    const installCustomProduct = (product, checked = true) => {
      const id = String(product?.id || "").trim();
      const name = String(product?.name || "").trim();
      const price = Math.max(1000, Math.round(Number(product?.price) || 0));
      const images = Array.isArray(product?.images) && product.images.length ? product.images.slice(0, 9) : [product?.image].filter(Boolean);
      if (!id || !name || !price || !images.length) return null;
      const type = ["physical", "digital", "subscription"].includes(product.type) ? product.type : "physical";
      const typeName = { physical: "Physical product", digital: "Digital download", subscription: "Subscription" }[type];
      const schedule = type === "subscription" ? ` · every ${product.subscription?.interval || 1} ${product.subscription?.unit || "month"}` : "";
      const detail = type === "physical" ? `Ships at ${Math.max(1, Number(product.weightGrams) || 1)} g.` : type === "digital" ? `${product.digitalFileName || "Digital file"} · delivered after confirmed payment.` : "Recurring billing on the selected schedule.";
      const imageUrl = String(images[0]);
      const safeName = escapeHtml(name);
      const safePrice = escapeHtml(formatRupiah(price));
      productNames[id] = name;
      productPrices[id] = price;
      productImages[id] = imageUrl;
      const variants = Array.isArray(product.variants) ? product.variants.filter((variant) => !variant.hidden).slice(0, 100) : [];
      productMeta[id] = { type, images, ...(variants.length ? { options: Array.isArray(product.options) ? product.options : [], variants } : {}), ...(type === "physical" ? { stock: Math.max(0, Number(product.stock) || 0), weightGrams: Math.max(1, Number(product.weightGrams) || 1) } : {}), ...(type === "digital" ? { digitalFileName: String(product.digitalFileName || "") } : {}), ...(type === "subscription" ? { subscription: { interval: Math.max(1, Number(product.subscription?.interval) || 1), unit: product.subscription?.unit || "month" } } : {}) };

      const picker = sqStudio.querySelector(".sq-product-picker");
      let input = picker?.querySelector(`[data-sq-product][value="${CSS.escape(id)}"]`);
      if (picker && !input) {
        const label = document.createElement("label");
        label.innerHTML = `<input type="checkbox" value="${escapeHtml(id)}" data-sq-product${checked ? " checked" : ""}><span><span class="product-art"><img src="${imageUrl}" alt="${safeName}"></span><div><b>${safeName}</b><small>${safePrice} · ${typeName}</small></div><i>${iconMarkup("check-circle")}</i></span>`;
        picker.append(label); input = label.querySelector("[data-sq-product]"); bindSqProductInput(input);
      } else if (input && checked) input.checked = true;
      const empty = picker?.querySelector("[data-sq-products-empty]");
      if (empty) empty.hidden = Boolean(picker.querySelector("[data-sq-product]"));
      previewRoot?.querySelectorAll("[data-sq-product-grid]").forEach((grid) => {
        let card = grid.querySelector(`[data-product-card="${CSS.escape(id)}"]`);
        if (!card) {
          card = document.createElement("article");
          card.dataset.productCard = id;
          card.dataset.productType = type;
          card.dataset.customCatalogProduct = "true";
          card.innerHTML = `<span class="product-art"><img src="${imageUrl}" alt="${safeName}">${images.length > 1 ? `<em class="sq-media-count">+${images.length - 1} photos</em>` : ""}</span><div><small>${typeName}${escapeHtml(schedule)}</small><h3>${safeName}</h3><p>${escapeHtml(detail)}</p><footer><b>${safePrice}</b><button type="button">${type === "subscription" ? "Subscribe" : "Add to cart"}</button></footer></div>`;
          grid.append(card);
        }
        installStorefrontVariantControls(card, product, variants, price, imageUrl);
      });
      scheduleProductGridFit();
      previewRoot?.querySelectorAll("[data-sq-basket-lines]").forEach((basket) => {
        if (basket.querySelector(`[data-product-line="${CSS.escape(id)}"]`)) return;
        const line = document.createElement("li"); line.dataset.productLine = id; line.innerHTML = `<span>${safeName}</span><b>${safePrice}</b>`; basket.append(line);
      });
      previewRoot?.querySelectorAll(".sq-hero-collage").forEach((collage) => {
        if (collage.querySelector(`[data-product-visual="${CSS.escape(id)}"]`)) return;
        const visual = document.createElement("span"); visual.dataset.productVisual = id; visual.dataset.sqImageItem = ""; visual.draggable = true; visual.tabIndex = 0; visual.setAttribute("aria-label", `${name} image — drag to rearrange`); visual.innerHTML = `<span class="product-art"><img src="${imageUrl}" alt="${safeName}"></span>`; collage.append(visual);
      });
      return input;
    };

    const quickProductForm = sqStudio.querySelector("[data-sq-product-form]");
    sqStudio.querySelector("[data-sq-show-product-form]")?.addEventListener("click", () => {
      if (!quickProductForm) return;
      quickProductForm.hidden = false;
      quickProductForm.querySelector('input[name="name"]')?.focus();
    });
    sqStudio.querySelector("[data-sq-cancel-product]")?.addEventListener("click", () => {
      if (!quickProductForm) return;
      quickProductForm.hidden = true;
      quickProductForm.reset();
    });
    const quickProductType = quickProductForm?.querySelector("[data-sq-quick-type]");
    const syncQuickProductType = () => {
      const type = String(quickProductType?.value || "physical");
      const physical = quickProductForm?.querySelector("[data-sq-quick-physical]");
      const digital = quickProductForm?.querySelector("[data-sq-quick-digital]");
      const subscription = quickProductForm?.querySelector("[data-sq-quick-subscription]");
      const rule = quickProductForm?.querySelector("[data-sq-quick-image-rule]");
      if (physical) physical.hidden = type !== "physical";
      if (digital) digital.hidden = type !== "digital";
      if (subscription) subscription.hidden = type !== "subscription";
      if (rule) rule.textContent = `${type === "physical" ? "Physical products need 3–9 images" : "Add 1–9 images"}, maximum 2 MB each.`;
    };
    quickProductType?.addEventListener("change", syncQuickProductType);
    syncQuickProductType();
    quickProductForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!quickProductForm.reportValidity()) return;
      const formData = new FormData(quickProductForm);
      const name = String(formData.get("name") || "").trim();
      const price = Math.max(1000, Math.round(Number(formData.get("price")) || 0));
      const type = String(formData.get("type") || "physical");
      const files = [...(quickProductForm.elements.images?.files || [])];
      const minimum = type === "physical" ? 3 : 1;
      const error = quickProductForm.querySelector("[data-sq-quick-error]");
      const fail = (message) => { if (error) { error.textContent = message; error.hidden = false; } };
      if (files.length < minimum || files.length > 9) { fail(`${type === "physical" ? "Physical products need 3–9" : "Products need 1–9"} images.`); return; }
      const oversized = files.find((file) => file.size > 2 * 1024 * 1024);
      if (oversized) { fail(`${oversized.name} is larger than 2 MB.`); return; }
      const weightGrams = Math.round(Number(formData.get("weight")) || 0);
      if (type === "physical" && weightGrams < 1) { fail("Physical products need a shipping weight."); return; }
      const interval = Math.round(Number(formData.get("interval")) || 1);
      if (type === "subscription" && (interval < 1 || interval > 12)) { fail("Choose a billing interval from 1 to 12."); return; }
      const submit = quickProductForm.querySelector('button[type="submit"]');
      if (submit) { submit.disabled = true; submit.textContent = "Preparing images…"; }
      try {
        const images = await Promise.all(files.map(compressCreatorProductImage));
        const id = `custom-${globalThis.crypto?.randomUUID?.().replace(/-/g, "").slice(0, 10) || Date.now()}`;
        remember();
        installCustomProduct({ id, name, price, type, images, image: images[0], ...(type === "physical" ? { weightGrams } : {}), ...(type === "digital" ? { digitalFileName: String(formData.get("digital_name") || "").trim() } : {}), ...(type === "subscription" ? { subscription: { interval, unit: String(formData.get("unit") || "month") } } : {}) });
        updateProductView(); bindSqInteractions(); syncInspectorContent(); markSqChanged();
        quickProductForm.hidden = true; quickProductForm.reset(); syncQuickProductType();
        showToast(`${name} added to this page`);
      } catch (imageError) { fail(imageError instanceof Error ? imageError.message : "The product images could not be prepared."); }
      finally { if (submit) { submit.disabled = false; submit.textContent = "Add product"; } }
    });

    const fitZoomForDevice = (device = activeDevice) => {
      const canvas = sqStudio.querySelector(".sq-canvas-scroll");
      const targetWidth = { desktop: 1440, tablet: 768, mobile: 390 }[device] || 1440;
      const availableWidth = Math.max(1, (canvas?.clientWidth || targetWidth) - 64);
      return Math.max(60, Math.min(100, Math.floor((availableWidth / targetWidth) * 100)));
    };
    sqStudio.querySelectorAll("[data-sq-device]").forEach((button) => button.addEventListener("click", () => {
      activeDevice = button.dataset.sqDevice;
      sqStudio.querySelectorAll("[data-sq-device]").forEach((item) => item.classList.toggle("active", item === button));
      deviceFrame?.classList.remove("device-tablet", "device-mobile");
      if (activeDevice !== "desktop") deviceFrame?.classList.add(`device-${activeDevice}`);
      const sizes = { desktop: "Desktop · 1440px", tablet: "Tablet · 768px", mobile: "Mobile · 390px" };
      const stageSize = sqStudio.querySelector("[data-sq-stage-size]");
      if (stageSize) stageSize.textContent = sizes[activeDevice];
      setZoom(fitZoomForDevice(activeDevice));
      loadSpacingControls();
      applySpacing();
      applyFluidLayouts();
      scheduleProductGridFit();
      scheduleImageScrollEffects();
      syncElementControls();
      syncPageGridControls();
      refreshLayoutGrid();
      if (selectedElement) requestAnimationFrame(refreshElementOverlay);
    }));
    deviceFrame?.addEventListener("transitionend", (event) => { if (event.propertyName === "width" && selectedElement?.isConnected) refreshElementOverlay(); });
    window.addEventListener("resize", () => { if (selectedElement?.isConnected) requestAnimationFrame(refreshElementOverlay); });

    let gridDensitySnapshot;
    const gridDensityInput = sqStudio.querySelector("[data-sq-grid-density]");
    const beginGridGeometryEdit = () => { if (!gridDensitySnapshot) gridDensitySnapshot = captureState(); };
    sqStudio.querySelectorAll("[data-sq-grid-density], [data-sq-grid-cell-width], [data-sq-grid-cell-height]").forEach((input) => {
      input.addEventListener("pointerdown", beginGridGeometryEdit);
      input.addEventListener("focus", beginGridGeometryEdit);
    });
    gridDensityInput?.addEventListener("input", () => {
      setGridDensity(activeDevice, gridDensityInput.value);
      applyFluidLayouts(); syncPageGridControls(); syncElementControls(); revealLayoutGrid(); refreshElementOverlay(); markSqChanged();
    });
    sqStudio.querySelector("[data-sq-grid-cell-width]")?.addEventListener("input", (event) => {
      const requestedWidth = Math.max(6, Number(event.currentTarget.value) || gridCellWidth());
      const columns = Math.max(2, Math.min(24, Math.round((gridContentWidth() + pageSpacingState.columnGap) / (requestedWidth + pageSpacingState.columnGap))));
      updateGridGeometry(activeDevice, { columns });
      applyFluidLayouts(); syncPageGridControls(); revealLayoutGrid(); markSqChanged();
    });
    sqStudio.querySelector("[data-sq-grid-cell-height]")?.addEventListener("input", (event) => {
      updateGridGeometry(activeDevice, { cellHeight: Number(event.currentTarget.value) });
      applyFluidLayouts(); syncPageGridControls(); revealLayoutGrid(); markSqChanged();
    });
    sqStudio.querySelectorAll("[data-sq-grid-density], [data-sq-grid-cell-width], [data-sq-grid-cell-height]").forEach((input) => input.addEventListener("change", () => { if (gridDensitySnapshot) remember(gridDensitySnapshot); gridDensitySnapshot = null; }));
    sqStudio.querySelector("[data-sq-show-layout-grid]")?.addEventListener("change", (event) => { showLayoutGrid = event.currentTarget.checked; syncPageGridControls(); refreshLayoutGrid(); });
    sqStudio.querySelectorAll("[data-sq-grid-toggle]").forEach((button) => button.addEventListener("click", () => { showLayoutGrid = !showLayoutGrid; syncPageGridControls(); refreshLayoutGrid(); }));

    let spacingSnapshot;
    sqStudio.querySelectorAll("[data-sq-spacing]").forEach((input) => {
      input.addEventListener("pointerdown", () => { spacingSnapshot = captureState(); });
      input.addEventListener("input", () => {
        const values = { ...readSpacing(), [input.dataset.sqSpacing]: Number(input.value) };
        if (sqStudio.querySelector("[data-sq-link-spacing]")?.checked) Object.keys(values).forEach((side) => { values[side] = Number(input.value); });
        spacingState.set(spacingKey(), values);
        loadSpacingControls();
        applySpacing();
        markSqChanged();
      });
      input.addEventListener("change", () => { if (spacingSnapshot) remember(spacingSnapshot); spacingSnapshot = null; });
    });
    let elementControlSnapshot;
    sqStudio.querySelectorAll("[data-sq-element-x], [data-sq-element-y], [data-sq-element-w], [data-sq-element-h]").forEach((input) => {
      input.addEventListener("focus", () => { elementControlSnapshot = captureState(); });
      input.addEventListener("input", () => {
        if (!selectedElement) return;
        const layout = parseElementLayout(selectedElement);
        const field = input.hasAttribute("data-sq-element-x") ? "x" : input.hasAttribute("data-sq-element-y") ? "y" : input.hasAttribute("data-sq-element-w") ? "width" : "height";
        setElementLayout(selectedElement, { ...layout, [field]: Number(input.value) });
        applyFluidSection(selectedElement.closest("[data-sq-fluid]"));
        requestAnimationFrame(refreshElementOverlay);
        markSqChanged();
      });
      input.addEventListener("change", () => { if (elementControlSnapshot) remember(elementControlSnapshot); elementControlSnapshot = null; });
    });
    const quickWidth = sqStudio.querySelector("[data-sq-element-width-quick]");
    quickWidth?.addEventListener("pointerdown", () => { if (!elementControlSnapshot) elementControlSnapshot = captureState(); });
    quickWidth?.addEventListener("focus", () => { if (!elementControlSnapshot) elementControlSnapshot = captureState(); });
    quickWidth?.addEventListener("input", () => {
      if (!selectedElement?.isConnected) return;
      const layout = parseElementLayout(selectedElement);
      setElementLayout(selectedElement, { ...layout, width: Number(quickWidth.value) });
      applyFluidSection(selectedElement.closest("[data-sq-fluid]"));
      syncElementControls(); refreshElementOverlay(); markSqChanged();
    });
    quickWidth?.addEventListener("change", () => { if (elementControlSnapshot) remember(elementControlSnapshot); elementControlSnapshot = null; });
    let elementInsetSnapshot;
    const startElementInsetEdit = () => { if (!elementInsetSnapshot) elementInsetSnapshot = captureState(); };
    const finishElementInsetEdit = () => { if (elementInsetSnapshot) remember(elementInsetSnapshot); elementInsetSnapshot = null; };
    sqStudio.querySelectorAll("[data-sq-element-inset]").forEach((input) => {
      input.addEventListener("focus", startElementInsetEdit);
      input.addEventListener("input", () => {
        if (!selectedElement?.isConnected) return;
        const side = input.dataset.sqElementInset;
        const value = Math.max(0, Math.min(240, Number(input.value) || 0));
        const values = elementInsetFor(selectedElement);
        if (sqStudio.querySelector("[data-sq-link-element-inset]")?.checked) Object.keys(values).forEach((key) => { values[key] = value; });
        else values[side] = value;
        setElementInset(selectedElement, values);
        sqStudio.querySelectorAll("[data-sq-element-inset]").forEach((field) => { field.value = String(values[field.dataset.sqElementInset]); });
        refreshElementOverlay(); markSqChanged();
      });
      input.addEventListener("change", finishElementInsetEdit);
    });
    sqStudio.querySelectorAll("[data-sq-element-position-choice]").forEach((button) => button.addEventListener("click", () => {
      if (!selectedElement?.isConnected) return;
      remember();
      const layout = parseElementLayout(selectedElement);
      const columns = fluidColumns();
      const x = button.dataset.sqElementPositionChoice === "left" ? 1 : button.dataset.sqElementPositionChoice === "right" ? columns - layout.width + 1 : Math.max(1, Math.round((columns - layout.width + 2) / 2));
      setElementLayout(selectedElement, { ...layout, x });
      applyFluidSection(selectedElement.closest("[data-sq-fluid]"));
      syncElementControls(); refreshElementOverlay(); markSqChanged();
    }));
    sqStudio.querySelector("[data-sq-element-inset-reset]")?.addEventListener("click", () => {
      if (!selectedElement?.isConnected) return;
      remember();
      ["desktop", "tablet", "mobile"].forEach((device) => selectedElement.style.removeProperty(elementInsetProperty(device)));
      selectedElement.classList.remove("sq-custom-inset");
      syncElementControls(); refreshElementOverlay(); markSqChanged();
    });
    [["[data-sq-product-columns]", "Columns"], ["[data-sq-product-density]", "Density"]].forEach(([selector, setting]) => {
      sqStudio.querySelector(selector)?.addEventListener("change", (event) => {
        if (selectedElement?.dataset.sqElementType !== "product-grid") return;
        remember();
        selectedElement.dataset[productSettingKey(setting)] = event.currentTarget.value;
        applyProductGridLayout(selectedElement);
        refreshElementOverlay();
        markSqChanged();
      });
    });
    sqStudio.querySelector("[data-sq-element-duplicate]")?.addEventListener("click", duplicateSelectedElement);
    sqStudio.querySelector("[data-sq-element-delete]")?.addEventListener("click", deleteSelectedElement);
    sqStudio.querySelector("[data-sq-element-hide]")?.addEventListener("click", () => {
      if (!selectedElement?.isConnected) return;
      remember();
      selectedElement.classList.toggle("sq-element-hidden");
      rebuildLayerList(); bindSqInteractions();
      syncElementControls();
      refreshElementOverlay();
      markSqChanged();
    });
    let elementStyleSnapshot;
    const rememberElementStyle = () => { if (!elementStyleSnapshot) elementStyleSnapshot = captureState(); };
    const finishElementStyle = () => { if (elementStyleSnapshot) remember(elementStyleSnapshot); elementStyleSnapshot = null; };
    const updateElementColor = (property, value) => {
      if (!selectedElement?.isConnected) return;
      selectedElement.style[property] = value;
      if (property === "color") selectedElement.classList.add("sq-color-override");
      if (property === "borderColor" && !isTransparentColor(value) && (getComputedStyle(selectedElement).borderStyle === "none" || getComputedStyle(selectedElement).borderTopWidth === "0px")) {
        selectedElement.style.borderWidth = "1px";
        selectedElement.style.borderStyle = "solid";
      }
      const hex = sqStudio.querySelector(`[data-sq-element-color-hex="${property}"]`);
      if (hex) { hex.value = isTransparentColor(value) ? "Transparent" : colorToHex(value).toUpperCase(); hex.classList.toggle("is-transparent", isTransparentColor(value)); }
      sqStudio.querySelector(`[data-sq-color-card="${property}"]`)?.classList.toggle("is-transparent", isTransparentColor(value));
      markSqChanged();
    };
    sqStudio.querySelectorAll("[data-sq-element-color]").forEach((input) => {
      input.addEventListener("focus", rememberElementStyle);
      input.addEventListener("input", () => {
        const property = input.dataset.sqElementColor;
        updateElementColor(property, input.value);
      });
      input.addEventListener("change", () => { finishElementStyle(); syncElementControls(); });
    });
    sqStudio.querySelectorAll("[data-sq-element-color-hex]").forEach((input) => {
      input.addEventListener("focus", rememberElementStyle);
      input.addEventListener("input", () => {
        const value = input.value.trim();
        if (!/^#[0-9a-f]{6}$/i.test(value)) return;
        const property = input.dataset.sqElementColorHex;
        const picker = sqStudio.querySelector(`[data-sq-element-color="${property}"]`);
        if (picker) picker.value = value;
        updateElementColor(property, value);
      });
      input.addEventListener("change", () => { finishElementStyle(); syncElementControls(); });
    });
    sqStudio.querySelectorAll("[data-sq-element-color-clear]").forEach((button) => button.addEventListener("click", () => {
      if (!selectedElement?.isConnected) return;
      remember();
      const property = button.dataset.sqElementColorClear;
      selectedElement.style[property] = "transparent";
      if (property === "borderColor") selectedElement.style.borderWidth = "0px";
      syncElementControls(); markSqChanged();
    }));
    const bindElementStyleSelect = (selector, property) => sqStudio.querySelector(selector)?.addEventListener("change", (event) => {
      if (!selectedElement?.isConnected) return;
      remember(); selectedElement.style[property] = event.currentTarget.value; refreshElementOverlay(); markSqChanged(); syncElementControls();
    });
    bindElementStyleSelect("[data-sq-element-font-family]", "fontFamily");
    bindElementStyleSelect("[data-sq-element-font-weight]", "fontWeight");
    bindElementStyleSelect("[data-sq-element-border-style]", "borderStyle");
    const bindElementStyleRange = (selector, property, unit, outputSelector, formatter = (value) => `${value}${unit}`) => {
      const input = sqStudio.querySelector(selector);
      input?.addEventListener("pointerdown", rememberElementStyle);
      input?.addEventListener("focus", rememberElementStyle);
      input?.addEventListener("input", (event) => {
        if (!selectedElement?.isConnected) return;
        rememberElementStyle();
        const value = event.currentTarget.value;
        selectedElement.style[property] = `${value}${unit}`;
        if (property === "borderWidth" && Number(value) > 0 && getComputedStyle(selectedElement).borderStyle === "none") selectedElement.style.borderStyle = sqStudio.querySelector("[data-sq-element-border-style]")?.value || "solid";
        if (property === "borderWidth" && Number(value) > 0 && isTransparentColor(getComputedStyle(selectedElement).borderColor)) selectedElement.style.borderColor = sqStudio.querySelector('[data-sq-element-color="borderColor"]')?.value || "#e3e5e7";
        const output = sqStudio.querySelector(outputSelector);
        if (output) output.textContent = formatter(value);
        refreshElementOverlay(); markSqChanged();
      });
      input?.addEventListener("change", () => { finishElementStyle(); syncElementControls(); });
    };
    bindElementStyleRange("[data-sq-element-font-size]", "fontSize", "px", "[data-sq-element-font-size-output]");
    bindElementStyleRange("[data-sq-element-line-height]", "lineHeight", "", "[data-sq-element-line-height-output]", (value) => value);
    bindElementStyleRange("[data-sq-element-letter-spacing]", "letterSpacing", "px", "[data-sq-element-letter-spacing-output]");
    bindElementStyleRange("[data-sq-element-border-width]", "borderWidth", "px", "[data-sq-element-border-width-output]");
    bindElementStyleRange("[data-sq-element-radius]", "borderRadius", "px", "[data-sq-element-radius-output]");
    sqStudio.querySelectorAll("[data-sq-element-surface]").forEach((button) => button.addEventListener("click", () => {
      if (!selectedElement?.isConnected) return;
      remember();
      const value = button.dataset.sqElementSurface;
      selectedElement.classList.remove("sq-surface-soft", "sq-surface-card", "sq-surface-outline", "sq-surface-glass");
      selectedElement.dataset.sqSurface = value;
      if (value !== "none") selectedElement.classList.add(`sq-surface-${value}`);
      syncElementControls(); refreshElementOverlay(); markSqChanged();
    }));
    sqStudio.querySelectorAll("[data-sq-element-align]").forEach((button) => button.addEventListener("click", () => {
      if (!selectedElement?.isConnected) return;
      remember(); const value = button.dataset.sqElementAlign; selectedElement.dataset.sqAlign = value; selectedElement.style.textAlign = value; syncElementControls(); markSqChanged();
    }));
    sqStudio.querySelectorAll("[data-sq-element-transform]").forEach((button) => button.addEventListener("click", () => {
      if (!selectedElement?.isConnected) return;
      remember(); selectedElement.style.textTransform = button.dataset.sqElementTransform; syncElementControls(); refreshElementOverlay(); markSqChanged();
    }));
    sqStudio.querySelectorAll("[data-sq-radius-choice]").forEach((button) => button.addEventListener("click", () => {
      if (!selectedElement?.isConnected) return;
      remember(); selectedElement.style.borderRadius = `${button.dataset.sqRadiusChoice}px`; syncElementControls(); refreshElementOverlay(); markSqChanged();
    }));
    sqStudio.querySelector("[data-sq-element-radius-number]")?.addEventListener("focus", rememberElementStyle);
    sqStudio.querySelector("[data-sq-element-radius-number]")?.addEventListener("input", (event) => {
      if (!selectedElement?.isConnected) return;
      rememberElementStyle(); const value = Math.min(999, Math.max(0, Number(event.currentTarget.value) || 0)); selectedElement.style.borderRadius = `${value}px`; syncElementControls(); refreshElementOverlay(); markSqChanged();
    });
    sqStudio.querySelector("[data-sq-element-radius-number]")?.addEventListener("change", finishElementStyle);
    sqStudio.querySelector("[data-sq-element-style-reset]")?.addEventListener("click", () => {
      if (!selectedElement?.isConnected) return;
      remember();
      ["color", "backgroundColor", "border", "borderColor", "borderWidth", "borderStyle", "borderRadius", "textAlign", "textTransform", "fontFamily", "fontWeight", "fontSize", "lineHeight", "letterSpacing", "boxShadow", "backdropFilter"].forEach((property) => { selectedElement.style[property] = ""; });
      selectedElement.classList.remove("sq-surface-soft", "sq-surface-card", "sq-surface-outline", "sq-surface-glass");
      selectedElement.classList.remove("sq-color-override");
      delete selectedElement.dataset.sqSurface; delete selectedElement.dataset.sqAlign; syncElementControls(); refreshElementOverlay(); markSqChanged();
    });
    sqStudio.querySelector("[data-sq-select-section]")?.addEventListener("click", () => selectSqSection(selectedSection, true));

    let textControlSnapshot;
    sqStudio.querySelector("[data-sq-element-text]")?.addEventListener("focus", () => { textControlSnapshot = captureState(); });
    sqStudio.querySelector("[data-sq-element-text]")?.addEventListener("input", (event) => {
      const explicitTarget = selectedContent?.isConnected && selectedElement?.contains(selectedContent) ? selectedContent : null;
      const fallbackTarget = selectedElement?.isConnected && !selectedAction && !selectedImage
        ? (selectedElement.matches("[data-sq-editable]") ? selectedElement : editableNodesFor(selectedElement)[0] || null)
        : null;
      const textTarget = explicitTarget || fallbackTarget;
      if (!textTarget) return;
      selectedContent = textTarget;
      textTarget.textContent = event.currentTarget.value;
      syncMarqueeCopies(selectedElement, event.currentTarget.value, textTarget);
      const sectionField = sqStudio.querySelector(`[data-sq-content-field="${textTarget.dataset.sqEditable}"]`);
      if (sectionField) sectionField.value = event.currentTarget.value;
      refreshElementOverlay(); markSqChanged();
    });
    sqStudio.querySelector("[data-sq-element-text]")?.addEventListener("change", () => { if (textControlSnapshot) remember(textControlSnapshot); textControlSnapshot = null; });
    sqStudio.querySelector("[data-sq-marquee-mode]")?.addEventListener("change", (event) => {
      if (selectedElement?.dataset.sqElementType !== "marquee") return;
      remember();
      selectedElement.dataset.sqMarqueeMode = event.currentTarget.value === "scroll" ? "scroll" : "auto";
      syncMarqueeTrack(selectedElement);
      syncElementControls();
      markSqChanged();
    });
    let marqueeSpeedSnapshot;
    const startMarqueeSpeedEdit = () => { if (!marqueeSpeedSnapshot && selectedElement?.dataset.sqElementType === "marquee") marqueeSpeedSnapshot = captureState(); };
    const marqueeSpeedInput = sqStudio.querySelector("[data-sq-marquee-speed]");
    marqueeSpeedInput?.addEventListener("pointerdown", startMarqueeSpeedEdit);
    marqueeSpeedInput?.addEventListener("focus", startMarqueeSpeedEdit);
    marqueeSpeedInput?.addEventListener("input", (event) => {
      if (selectedElement?.dataset.sqElementType !== "marquee") return;
      selectedElement.dataset.sqMarqueeSpeed = String(Math.max(20, Math.min(200, Number(event.currentTarget.value) || 60)));
      syncMarqueeTrack(selectedElement);
      syncElementControls();
      markSqChanged();
    });
    marqueeSpeedInput?.addEventListener("change", () => { if (marqueeSpeedSnapshot) remember(marqueeSpeedSnapshot); marqueeSpeedSnapshot = null; });
    sqStudio.querySelectorAll("[data-sq-review-rating]").forEach((button) => button.addEventListener("click", () => {
      if (selectedElement?.dataset.sqElementType !== "review") return;
      remember();
      renderReviewStars(selectedElement, button.dataset.sqReviewRating);
      syncElementControls();
      refreshElementOverlay();
      markSqChanged();
    }));

    let actionControlSnapshot;
    const startActionEdit = () => { if (!actionControlSnapshot) actionControlSnapshot = captureState(); };
    const finishActionEdit = () => { if (actionControlSnapshot) remember(actionControlSnapshot); actionControlSnapshot = null; syncInspectorContent(); };
    const applyActionSettings = () => {
      const action = actionForElement();
      if (!action) return;
      const type = sqStudio.querySelector("[data-sq-button-link-type]")?.value || "none";
      const target = sqStudio.querySelector("[data-sq-button-link]")?.value.trim() || "";
      const newTab = Boolean(sqStudio.querySelector("[data-sq-button-new-tab]")?.checked);
      action.dataset.sqLinkType = type;
      action.dataset.sqLink = target;
      action.dataset.sqNewTab = String(newTab);
      let href = "";
      if (type === "section") href = `#${target.replace(/^#/, "") || "products"}`;
      if (type === "url") href = target;
      if (type === "email") href = `mailto:${target}`;
      if (type === "phone") href = `tel:${target}`;
      if (action.matches("a")) {
        if (href) action.setAttribute("href", href); else action.removeAttribute("href");
        if (newTab && type === "url") { action.target = "_blank"; action.rel = "noopener"; }
        else { action.removeAttribute("target"); action.removeAttribute("rel"); }
      }
      syncElementControls();
      markSqChanged();
    };
    sqStudio.querySelector("[data-sq-button-label]")?.addEventListener("focus", startActionEdit);
    sqStudio.querySelector("[data-sq-button-label]")?.addEventListener("input", (event) => {
      const action = actionForElement();
      if (!action) return;
      action.textContent = event.currentTarget.value;
      markSqChanged();
    });
    sqStudio.querySelector("[data-sq-button-label]")?.addEventListener("change", finishActionEdit);
    sqStudio.querySelector("[data-sq-button-link-type]")?.addEventListener("change", (event) => { startActionEdit(); applyActionSettings(); finishActionEdit(); });
    sqStudio.querySelector("[data-sq-button-link]")?.addEventListener("focus", startActionEdit);
    sqStudio.querySelector("[data-sq-button-link]")?.addEventListener("input", applyActionSettings);
    sqStudio.querySelector("[data-sq-button-link]")?.addEventListener("change", finishActionEdit);
    sqStudio.querySelector("[data-sq-button-new-tab]")?.addEventListener("change", () => { startActionEdit(); applyActionSettings(); finishActionEdit(); });
    sqStudio.querySelector("[data-sq-test-checkout]")?.addEventListener("click", () => {
      const products = selectedProducts();
      const url = new URL("../", window.location.href);
      url.searchParams.set("products", products.join(","));
      const brandElement = previewRoot.querySelector(".sq-site-logo");
      const brandImage = brandElement?.querySelector("img[src]:not([hidden])");
      const brandName = (brandElement?.querySelector("b")?.textContent
        || brandImage?.getAttribute("alt")
        || document.querySelector("[data-current-site-name]")?.textContent
        || "Store").trim().slice(0, 80);
      if (brandName) url.searchParams.set("brand", brandName);
      if (brandImage) {
        const logo = new URL(brandImage.getAttribute("src"), window.location.href).href;
        if (/^https?:\/\//i.test(logo) && logo.length <= 1800) url.searchParams.set("logo", logo);
      }
      window.open(url.href, "_blank", "noopener");
    });

    let imageControlSnapshot;
    const startImageEdit = () => { if (!imageControlSnapshot) imageControlSnapshot = captureState(); };
    const finishImageEdit = () => { if (imageControlSnapshot) remember(imageControlSnapshot); imageControlSnapshot = null; };
    const updateImageTextSetting = (selector, attribute) => {
      sqStudio.querySelector(selector)?.addEventListener("focus", startImageEdit);
      sqStudio.querySelector(selector)?.addEventListener("change", (event) => {
        const image = imageForElement();
        if (!image) return;
        image.setAttribute(attribute, event.currentTarget.value.trim());
        finishImageEdit(); syncBackgroundManagers(); markSqChanged();
      });
    };
    updateImageTextSetting("[data-sq-image-src]", "src");
    updateImageTextSetting("[data-sq-image-alt]", "alt");
    [["[data-sq-image-fit]", "objectFit"], ["[data-sq-image-position]", "objectPosition"]].forEach(([selector, property]) => {
      sqStudio.querySelector(selector)?.addEventListener("change", (event) => {
        const image = imageForElement();
        if (!image) return;
        remember();
        image.style[property] = event.currentTarget.value;
        if (property === "objectPosition") {
          const [x, y] = ({ center: [50, 50], top: [50, 0], bottom: [50, 100], left: [0, 50], right: [100, 50] })[event.currentTarget.value] || [50, 50];
          image.dataset.sqImageCropX = String(x); image.dataset.sqImageCropY = String(y); applyImageCrop(image);
        }
        markSqChanged();
      });
    });
    const setImageCropValue = (image, key, value) => {
      if (!image) return;
      image.dataset[`sqImageCrop${key}`] = String(value);
      applyImageCrop(image);
      scheduleImageScrollEffects();
      const output = key === "Zoom" ? sqStudio.querySelector("[data-sq-image-crop-zoom-output]") : null;
      if (output) output.textContent = `${value}%`;
      markSqChanged();
    };
    sqStudio.querySelector("[data-sq-image-crop-toggle]")?.addEventListener("click", () => {
      const image = imageForElement();
      if (!image) return;
      const closing = cropEditingImage === image;
      if (cropEditingImage) imageVisualHostFor(cropEditingImage)?.classList.remove("sq-image-crop-editing");
      cropEditingImage = closing ? null : image;
      imageVisualHostFor(cropEditingImage)?.classList.add("sq-image-crop-editing");
      if (!closing) applyImageCrop(image);
      syncElementControls();
    });
    ["Zoom", "X", "Y"].forEach((key) => {
      const input = sqStudio.querySelector(`[data-sq-image-crop-${key.toLowerCase()}]`);
      input?.addEventListener("pointerdown", startImageEdit);
      input?.addEventListener("focus", startImageEdit);
      input?.addEventListener("input", (event) => setImageCropValue(imageForElement(), key, Number(event.currentTarget.value)));
      input?.addEventListener("change", finishImageEdit);
    });
    sqStudio.querySelector("[data-sq-image-crop-reset]")?.addEventListener("click", () => {
      const image = imageForElement();
      if (!image) return;
      remember();
      ["Zoom", "X", "Y"].forEach((key) => delete image.dataset[`sqImageCrop${key}`]);
      applyImageCrop(image); scheduleImageScrollEffects(); syncElementControls(); markSqChanged();
    });
    previewRoot?.addEventListener("pointerdown", (event) => {
      const image = cropEditingImage;
      const host = imageVisualHostFor(image);
      if (!image?.isConnected || !host?.contains(event.target) || event.button !== 0) return;
      event.preventDefault(); event.stopPropagation();
      const snapshot = captureState();
      const rect = host.getBoundingClientRect();
      const startX = event.clientX;
      const startY = event.clientY;
      const originalX = imageCropValue(image, "X", 50);
      const originalY = imageCropValue(image, "Y", 50);
      let changed = false;
      image.setPointerCapture?.(event.pointerId);
      host.classList.add("is-cropping");
      const move = (pointerEvent) => {
        const x = Math.max(0, Math.min(100, originalX - (pointerEvent.clientX - startX) / Math.max(1, rect.width) * 100));
        const y = Math.max(0, Math.min(100, originalY - (pointerEvent.clientY - startY) / Math.max(1, rect.height) * 100));
        changed = changed || Math.abs(x - originalX) > .1 || Math.abs(y - originalY) > .1;
        image.dataset.sqImageCropX = x.toFixed(1);
        image.dataset.sqImageCropY = y.toFixed(1);
        applyImageCrop(image); syncElementControls(); markSqChanged();
      };
      const end = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", end);
        window.removeEventListener("pointercancel", end);
        host.classList.remove("is-cropping");
        if (changed) remember(snapshot);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", end, { once: true });
      window.addEventListener("pointercancel", end, { once: true });
    }, true);
    const backgroundTargetFor = () => previewRoot?.querySelector(`[data-section-id="${selectedSection}"]`);
    const backgroundLayerFor = () => backgroundTargetFor()?.querySelector(":scope > .sq-section-background") || null;
    const prepareBackgroundLayer = (layer) => {
      if (!layer) return null;
      layer.dataset.sqElementType = "image-background";
      layer.dataset.sqBackgroundScope = "section";
      layer.setAttribute("aria-hidden", "true");
      return layer;
    };
    const sectionBackgroundColor = (section) => {
      const custom = section?.style.getPropertyValue("--sq-section-background-color").trim();
      if (/^#[0-9a-f]{6}$/i.test(custom || "")) return custom.toLowerCase();
      const computed = section ? getComputedStyle(section).backgroundColor : "";
      return isTransparentColor(computed) ? "#ffffff" : colorToHex(computed, "#ffffff");
    };
    const setSectionBackgroundColor = (section, rawColor) => {
      if (!section || !/^#[0-9a-f]{6}$/i.test(rawColor || "")) return;
      const color = rawColor.toLowerCase();
      const channels = color.slice(1).match(/.{2}/g).map((part) => Number.parseInt(part, 16) / 255);
      const luminance = channels.map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
      section.dataset.sqBackgroundType = "solid";
      section.classList.remove("section-bg-light", "section-bg-white", "section-bg-dark", "section-bg-accent");
      section.classList.add("section-bg-custom");
      section.classList.toggle("section-bg-custom-dark", luminance < .36);
      section.style.setProperty("--sq-section-background-color", color);
    };
    const syncBackgroundManagers = () => {
      previewRoot?.querySelectorAll("[data-sq-block] > .sq-section-background").forEach(prepareBackgroundLayer);
      sqStudio.querySelectorAll("[data-sq-background-manager]").forEach((manager) => {
        const section = backgroundTargetFor();
        const layer = backgroundLayerFor();
        const image = layer?.querySelector("img");
        const type = section?.dataset.sqBackgroundType === "image" ? "image" : "solid";
        if (section) section.dataset.sqBackgroundType = type;
        const thumbnail = manager.querySelector("[data-sq-background-thumbnail]");
        const title = manager.querySelector("[data-sq-background-title]");
        const status = manager.querySelector("[data-sq-background-status]");
        const url = manager.querySelector("[data-sq-background-url]");
        const edit = manager.querySelector("[data-sq-background-edit]");
        const remove = manager.querySelector("[data-sq-background-remove]");
        const sectionName = sectionNames[selectedSection] || "Section";
        const sectionNameLabel = manager.querySelector("[data-sq-section-background-name]");
        if (sectionNameLabel) sectionNameLabel.textContent = sectionName;
        manager.querySelectorAll("[data-sq-section-background-type]").forEach((button) => {
          const active = button.dataset.sqSectionBackgroundType === type;
          button.classList.toggle("active", active);
          button.setAttribute("aria-pressed", String(active));
        });
        manager.querySelectorAll("[data-sq-section-background-panel]").forEach((panel) => { panel.hidden = panel.dataset.sqSectionBackgroundPanel !== type; });
        const color = sectionBackgroundColor(section);
        const colorInput = manager.querySelector("[data-sq-section-background-color]");
        const colorOutput = manager.querySelector("[data-sq-section-background-color-output]");
        if (colorInput && document.activeElement !== colorInput) colorInput.value = color;
        if (colorOutput) colorOutput.textContent = color.toUpperCase();
        if (thumbnail) { thumbnail.classList.toggle("has-image", Boolean(image)); thumbnail.style.backgroundImage = image ? `url("${String(image.currentSrc || image.src).replace(/["\\]/g, "\\$&")}")` : ""; }
        if (title) title.textContent = image ? "Section image ready" : "No background image";
        if (status) status.textContent = image ? "Open image settings for crop, overlay, filters, and motion." : "Upload an image or paste a URL below.";
        if (url && document.activeElement !== url) url.value = image && /^(https?:\/\/|\/|\.\.\/|\.\/)/i.test(image.getAttribute("src") || "") ? image.getAttribute("src") : "";
        if (edit) edit.hidden = !image;
        if (remove) remove.hidden = !image;
        const scrollEffect = image?.dataset.sqImageScroll === "parallax-deep" ? "parallax" : image?.dataset.sqImageScroll || "none";
        const storedScrollStrength = Number(image?.dataset.sqImageScrollStrength);
        const scrollStrength = Math.max(0, Math.min(100, Number.isFinite(storedScrollStrength) ? storedScrollStrength : 50));
        const scrollEffectInput = manager.querySelector("[data-sq-section-background-scroll-effect]");
        const scrollStrengthInput = manager.querySelector("[data-sq-section-background-scroll-strength]");
        const scrollStrengthOutput = manager.querySelector("[data-sq-section-background-scroll-strength-output]");
        const scrollDampingInput = manager.querySelector("[data-sq-section-background-scroll-damping]");
        if (scrollEffectInput) { scrollEffectInput.value = scrollEffect; scrollEffectInput.disabled = !image; }
        if (scrollStrengthInput) { scrollStrengthInput.value = String(scrollStrength); scrollStrengthInput.disabled = !image || scrollEffect === "none"; }
        if (scrollStrengthOutput) scrollStrengthOutput.textContent = scrollStrength === 100 && scrollEffect === "parallax" ? "100% · fixed" : scrollStrength === 0 ? "0% · normal" : `${scrollStrength}%`;
        if (scrollDampingInput) { scrollDampingInput.checked = image?.dataset.sqImageScrollDamping !== "false"; scrollDampingInput.disabled = !image || scrollEffect === "none"; }
      });
    };
    const selectBackgroundLayer = (_scope = "section", sectionId = selectedSection) => {
      if (sectionId !== selectedSection) selectSqSection(sectionId);
      const layer = backgroundLayerFor();
      const image = layer?.querySelector("img");
      if (!layer || !image) return;
      prepareBackgroundLayer(layer);
      selectSqElement(layer, null, image);
      showElementPanel("content");
      syncElementControls();
    };
    const installBackgroundImage = (_scope, source, snapshot = captureState(), requestedTarget = backgroundTargetFor()) => {
      const target = requestedTarget;
      if (!target || !source) { showToast("Select a section before adding its background image."); return null; }
      let layer = target.querySelector(":scope > .sq-section-background");
      const previousImage = layer?.querySelector("img")?.cloneNode(true) || null;
      const createdLayer = !layer;
      if (!layer) {
        layer = document.createElement("div");
        layer.className = "sq-section-background";
        prepareBackgroundLayer(layer);
        target.prepend(layer);
      }
      const copy = source instanceof HTMLImageElement ? source.cloneNode(true) : document.createElement("img");
      copy.alt = ""; copy.draggable = false;
      copy.removeAttribute("tabindex");
      copy.classList.remove("sq-image-selected", "sq-element-selected", "sq-image-crop-editing", "is-cropping");
      copy.addEventListener("error", () => {
        if (!target.isConnected || !layer.isConnected) return;
        if (previousImage) {
          layer.replaceChildren(previousImage);
          applyImageCrop(previousImage); applySelectedImageFilters(previousImage); applyImageBlend(previousImage);
        } else if (createdLayer) {
          layer.remove();
          target.dataset.sqBackgroundType = "solid";
        }
        rebuildLayerList(); bindSqInteractions(); syncBackgroundManagers(); markSqChanged();
        showToast("That image could not be loaded. Try a PNG, JPEG, WebP, GIF, or AVIF file.");
      }, { once: true });
      if (!(source instanceof HTMLImageElement)) copy.src = String(source);
      layer.replaceChildren(copy);
      target.dataset.sqBackgroundType = "image";
      applyImageCrop(copy); applySelectedImageFilters(copy); applyImageBlend(copy);
      remember(snapshot); rebuildLayerList(); bindSqInteractions(); syncBackgroundManagers(); scheduleImageScrollEffects(); markSqChanged();
      selectBackgroundLayer("section", target.dataset.sectionId || selectedSection);
      showToast("Section background image added — image settings are open");
      return copy;
    };
    const removeBackgroundImage = () => {
      const layer = backgroundLayerFor();
      if (!layer) return;
      remember();
      if (selectedElement === layer) { selectedElement = null; selectedImage = null; }
      const section = backgroundTargetFor();
      if (section) section.dataset.sqBackgroundType = "solid";
      layer.remove(); rebuildLayerList(); bindSqInteractions(); syncBackgroundManagers(); markSqChanged();
      selectSqSection(selectedSection, true);
      showToast("Section background image removed");
    };
    const setImageAsBackground = () => {
      const image = imageForElement();
      if (!image) return;
      installBackgroundImage("section", image);
    };
    sqStudio.querySelectorAll("[data-sq-image-background]").forEach((button) => button.addEventListener("click", setImageAsBackground));
    sqStudio.querySelectorAll("[data-sq-section-background-type]").forEach((button) => button.addEventListener("click", () => {
      const section = backgroundTargetFor();
      if (!section) return;
      const type = button.dataset.sqSectionBackgroundType === "image" ? "image" : "solid";
      if (section.dataset.sqBackgroundType === type) return;
      remember();
      section.dataset.sqBackgroundType = type;
      syncBackgroundManagers();
      markSqChanged();
    }));
    let sectionBackgroundColorSnapshot = null;
    const backgroundColorInput = sqStudio.querySelector("[data-sq-section-background-color]");
    const startSectionBackgroundColor = () => { if (!sectionBackgroundColorSnapshot) sectionBackgroundColorSnapshot = captureState(); };
    backgroundColorInput?.addEventListener("pointerdown", startSectionBackgroundColor);
    backgroundColorInput?.addEventListener("focus", startSectionBackgroundColor);
    backgroundColorInput?.addEventListener("input", (event) => {
      setSectionBackgroundColor(backgroundTargetFor(), event.currentTarget.value);
      syncBackgroundManagers();
      markSqChanged();
    });
    backgroundColorInput?.addEventListener("change", () => { if (sectionBackgroundColorSnapshot) remember(sectionBackgroundColorSnapshot); sectionBackgroundColorSnapshot = null; });
    sqStudio.querySelectorAll("[data-sq-background-edit]").forEach((button) => button.addEventListener("click", () => selectBackgroundLayer(button.dataset.sqBackgroundEdit)));
    sqStudio.querySelectorAll("[data-sq-background-remove]").forEach((button) => button.addEventListener("click", removeBackgroundImage));
    sqStudio.querySelectorAll("[data-sq-background-apply]").forEach((button) => button.addEventListener("click", () => {
      const scope = button.dataset.sqBackgroundApply;
      const value = sqStudio.querySelector(`[data-sq-background-url="${scope}"]`)?.value.trim();
      if (!value || !/^(https?:\/\/|\/|\.\.\/|\.\/)/i.test(value)) { showToast("Paste a valid image URL"); return; }
      installBackgroundImage(scope, value);
    }));
    sqStudio.querySelectorAll("[data-sq-background-upload]").forEach((input) => input.addEventListener("change", (event) => {
      const upload = event.currentTarget;
      const file = upload.files?.[0];
      if (!file) return;
      if (file.size > 8 * 1024 * 1024) { showToast("Choose an image smaller than 8 MB"); upload.value = ""; return; }
      const scope = upload.dataset.sqBackgroundUpload;
      const target = backgroundTargetFor();
      const snapshot = captureState();
      const reader = new FileReader();
      reader.onload = () => installBackgroundImage(scope, String(reader.result || ""), snapshot, target);
      reader.onerror = () => showToast("That image could not be read. Try another file.");
      reader.readAsDataURL(file);
      upload.value = "";
    }));
    const sectionBackgroundMotionImage = () => backgroundLayerFor()?.querySelector("img") || null;
    sqStudio.querySelector("[data-sq-section-background-scroll-effect]")?.addEventListener("change", (event) => {
      const image = sectionBackgroundMotionImage();
      if (!image) return;
      remember();
      const effect = ["parallax", "parallax-reverse", "zoom"].includes(event.currentTarget.value) ? event.currentTarget.value : "none";
      if (effect === "none") {
        releaseImageScrollEffect(image);
        delete image.dataset.sqImageScroll;
      } else {
        image.dataset.sqImageScroll = effect;
        image.dataset.sqImageScrollStrength ||= "50";
      }
      syncBackgroundManagers(); scheduleImageScrollEffects(); markSqChanged();
    });
    sqStudio.querySelector("[data-sq-section-background-scroll-damping]")?.addEventListener("change", (event) => {
      const image = sectionBackgroundMotionImage();
      if (!image?.dataset.sqImageScroll) return;
      remember();
      image.dataset.sqImageScrollDamping = event.currentTarget.checked ? "true" : "false";
      scheduleImageScrollEffects(); markSqChanged();
    });
    let sectionBackgroundScrollStrengthSnapshot = null;
    const sectionBackgroundScrollStrengthInput = sqStudio.querySelector("[data-sq-section-background-scroll-strength]");
    const startSectionBackgroundScrollStrengthEdit = () => { if (!sectionBackgroundScrollStrengthSnapshot) sectionBackgroundScrollStrengthSnapshot = captureState(); };
    sectionBackgroundScrollStrengthInput?.addEventListener("pointerdown", startSectionBackgroundScrollStrengthEdit);
    sectionBackgroundScrollStrengthInput?.addEventListener("focus", startSectionBackgroundScrollStrengthEdit);
    sectionBackgroundScrollStrengthInput?.addEventListener("input", (event) => {
      const image = sectionBackgroundMotionImage();
      if (!image?.dataset.sqImageScroll) return;
      image.dataset.sqImageScrollStrength = event.currentTarget.value;
      const output = sqStudio.querySelector("[data-sq-section-background-scroll-strength-output]");
      if (output) output.textContent = Number(event.currentTarget.value) === 100 && image.dataset.sqImageScroll === "parallax" ? "100% · fixed" : Number(event.currentTarget.value) === 0 ? "0% · normal" : `${event.currentTarget.value}%`;
      scheduleImageScrollEffects(); markSqChanged();
    });
    sectionBackgroundScrollStrengthInput?.addEventListener("change", () => {
      if (sectionBackgroundScrollStrengthSnapshot) remember(sectionBackgroundScrollStrengthSnapshot);
      sectionBackgroundScrollStrengthSnapshot = null;
    });
    sqStudio.querySelector("[data-sq-image-blend-mode]")?.addEventListener("change", (event) => {
      const image = imageForElement();
      if (!image) return;
      remember();
      const mode = imageBlendModes.has(event.currentTarget.value) ? event.currentTarget.value : "normal";
      if (mode === "normal") { delete image.dataset.sqImageBlendMode; image.dataset.sqImageBlendNormal = "true"; }
      else { image.dataset.sqImageBlendMode = mode; delete image.dataset.sqImageBlendNormal; }
      applyImageBlend(image); syncElementControls(); markSqChanged();
    });
    sqStudio.querySelector("[data-sq-image-blend-source]")?.addEventListener("change", (event) => {
      const image = imageForElement();
      if (!image) return;
      remember();
      if (event.currentTarget.value === "behind") image.dataset.sqImageBlendSource = "behind";
      else delete image.dataset.sqImageBlendSource;
      applyImageBlend(image); syncElementControls(); markSqChanged();
    });
    const setSelectedImageBlendColor = (rawColor) => {
      const image = imageForElement();
      if (!image) return;
      const color = /^#[0-9a-f]{6}$/i.test(rawColor || "") ? rawColor.toLowerCase() : "";
      if (color) {
        image.dataset.sqImageBlendColor = color;
        if (imageBlendSource(image) === "color" && imageBlendMode(image) === "normal" && image.dataset.sqImageBlendNormal !== "true") image.dataset.sqImageBlendMode = "multiply";
      }
      else image.dataset.sqImageBlendColor = "transparent";
      applyImageBlend(image); syncElementControls(); markSqChanged();
    };
    const blendColorInput = sqStudio.querySelector("[data-sq-image-blend-color]");
    blendColorInput?.addEventListener("pointerdown", startImageEdit);
    blendColorInput?.addEventListener("focus", startImageEdit);
    blendColorInput?.addEventListener("input", (event) => setSelectedImageBlendColor(event.currentTarget.value));
    blendColorInput?.addEventListener("change", (event) => { finishImageEdit(); setSelectedImageBlendColor(event.currentTarget.value); });
    const blendColorHexInput = sqStudio.querySelector("[data-sq-image-blend-color-hex]");
    blendColorHexInput?.addEventListener("focus", startImageEdit);
    blendColorHexInput?.addEventListener("input", (event) => {
      const value = event.currentTarget.value.trim();
      if (/^#[0-9a-f]{6}$/i.test(value)) setSelectedImageBlendColor(value);
    });
    blendColorHexInput?.addEventListener("change", (event) => {
      const value = event.currentTarget.value.trim();
      finishImageEdit();
      if (!/^#[0-9a-f]{6}$/i.test(value)) { syncElementControls(); showToast("Enter a six-digit hex color, like #F44B34"); return; }
      setSelectedImageBlendColor(value);
    });
    sqStudio.querySelector("[data-sq-image-blend-color-clear]")?.addEventListener("click", () => {
      if (!imageBlendColor(imageForElement())) return;
      remember(); setSelectedImageBlendColor("");
    });
    sqStudio.querySelectorAll("[data-sq-image-filter]").forEach((input) => {
      input.addEventListener("pointerdown", startImageEdit);
      input.addEventListener("focus", startImageEdit);
      input.addEventListener("input", () => {
        const image = imageForElement();
        if (!image) return;
        const name = input.dataset.sqImageFilter;
        image.dataset[`sqFilter${name[0].toUpperCase()}${name.slice(1)}`] = input.value;
        applySelectedImageFilters(image);
        const output = sqStudio.querySelector(`[data-sq-image-output="${name}"]`);
        if (output) output.textContent = `${input.value}${name === "blur" ? "px" : "%"}`;
        markSqChanged();
      });
      input.addEventListener("change", finishImageEdit);
    });
    sqStudio.querySelector("[data-sq-image-upload]")?.addEventListener("change", (event) => {
      const image = imageForElement();
      const file = event.currentTarget.files?.[0];
      if (!image || !file) return;
      if (file.size > 8 * 1024 * 1024) { showToast("Choose an image smaller than 8 MB"); event.currentTarget.value = ""; return; }
      const snapshot = captureState();
      const reader = new FileReader();
      reader.onload = () => {
        image.src = String(reader.result || "");
        image.alt = image.alt || file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
        remember(snapshot); syncElementControls(); syncBackgroundManagers(); markSqChanged(); showToast("Image replaced — effects stay editable");
      };
      reader.readAsDataURL(file);
      event.currentTarget.value = "";
    });
    sqStudio.querySelector("[data-sq-image-reset]")?.addEventListener("click", () => {
      const image = imageForElement();
      if (!image) return;
      remember();
      Object.keys(imageDefaults).forEach((name) => { delete image.dataset[`sqFilter${name[0].toUpperCase()}${name.slice(1)}`]; });
      releaseImageScrollEffect(image);
      delete image.dataset.sqImageScroll;
      delete image.dataset.sqImageScrollStrength;
      delete image.dataset.sqImageScrollDamping;
      delete image.dataset.sqImageBlendMode;
      delete image.dataset.sqImageBlendNormal;
      delete image.dataset.sqImageBlendSource;
      delete image.dataset.sqImageBlendColor;
      ["Zoom", "X", "Y"].forEach((key) => delete image.dataset[`sqImageCrop${key}`]);
      applyImageBlend(image); applyImageCrop(image); applySelectedImageFilters(image);
      image.style.filter = ""; image.style.objectFit = ""; image.style.objectPosition = "";
      image.style.removeProperty("--sq-image-crop-zoom"); image.classList.remove("sq-image-crop-media");
      image.style.transform = ""; image.style.transformOrigin = ""; image.style.willChange = "";
      syncElementControls(); markSqChanged();
    });
    const selectedMotionImage = () => {
      if (!selectedElement?.isConnected || ["logo", "product-grid"].includes(selectedElement.dataset.sqElementType)) return null;
      return imageForElement();
    };
    sqStudio.querySelector("[data-sq-image-scroll-effect]")?.addEventListener("change", (event) => {
      const image = selectedMotionImage();
      if (!image) return;
      remember();
      const effect = event.currentTarget.value;
      if (effect === "none") {
        releaseImageScrollEffect(image);
        delete image.dataset.sqImageScroll;
        image.style.transform = "";
        image.style.transformOrigin = "";
        image.style.willChange = "";
      } else {
        image.dataset.sqImageScroll = effect;
        image.dataset.sqImageScrollStrength ||= "50";
      }
      syncElementControls(); scheduleImageScrollEffects(); markSqChanged();
    });
    sqStudio.querySelector("[data-sq-image-scroll-damping]")?.addEventListener("change", (event) => {
      const image = selectedMotionImage();
      if (!image || !image.dataset.sqImageScroll) return;
      remember();
      image.dataset.sqImageScrollDamping = event.currentTarget.checked ? "true" : "false";
      scheduleImageScrollEffects(); markSqChanged();
    });
    let imageScrollStrengthSnapshot = null;
    const startImageScrollStrengthEdit = () => { if (!imageScrollStrengthSnapshot) imageScrollStrengthSnapshot = captureState(); };
    const imageScrollStrengthInput = sqStudio.querySelector("[data-sq-image-scroll-strength]");
    imageScrollStrengthInput?.addEventListener("pointerdown", startImageScrollStrengthEdit);
    imageScrollStrengthInput?.addEventListener("focus", startImageScrollStrengthEdit);
    imageScrollStrengthInput?.addEventListener("input", (event) => {
      const image = selectedMotionImage();
      if (!image || !image.dataset.sqImageScroll) return;
      if (image.dataset.sqImageScroll === "parallax-deep") image.dataset.sqImageScroll = "parallax";
      image.dataset.sqImageScrollStrength = event.currentTarget.value;
      const output = sqStudio.querySelector("[data-sq-image-scroll-strength-output]");
      if (output) output.textContent = Number(event.currentTarget.value) === 100 && image.dataset.sqImageScroll === "parallax" ? "100% · fixed" : Number(event.currentTarget.value) === 0 ? "0% · normal" : `${event.currentTarget.value}%`;
      scheduleImageScrollEffects(); markSqChanged();
    });
    imageScrollStrengthInput?.addEventListener("change", () => {
      if (imageScrollStrengthSnapshot) remember(imageScrollStrengthSnapshot);
      imageScrollStrengthSnapshot = null;
    });
    const selectedLogoParts = () => selectedElement?.dataset.sqElementType === "logo" ? {
      image: selectedElement.querySelector("[data-sq-logo-image]"),
      text: selectedElement.querySelector("[data-sq-logo-text]"),
    } : null;
    const setLogoSource = (source) => {
      const logo = selectedLogoParts();
      if (!logo?.image || !logo.text) return;
      const value = String(source || "").trim();
      if (value) logo.image.setAttribute("src", value); else logo.image.removeAttribute("src");
      logo.image.hidden = !value;
      logo.text.hidden = Boolean(value);
      refreshElementOverlay();
      syncElementControls();
      markSqChanged();
    };
    let logoSnapshot;
    const startLogoEdit = () => { if (!logoSnapshot) logoSnapshot = captureState(); };
    const finishLogoEdit = () => { if (logoSnapshot) remember(logoSnapshot); logoSnapshot = null; };
    sqStudio.querySelector("[data-sq-logo-upload]")?.addEventListener("change", (event) => {
      const file = event.currentTarget.files?.[0];
      if (!selectedLogoParts() || !file) return;
      if (file.size > 4 * 1024 * 1024) { showToast("Choose a logo smaller than 4 MB"); event.currentTarget.value = ""; return; }
      const snapshot = captureState();
      const reader = new FileReader();
      reader.onload = () => {
        setLogoSource(String(reader.result || ""));
        const logo = selectedLogoParts();
        if (logo?.image && !logo.image.alt) logo.image.alt = `${logo.text?.textContent.trim() || "Brand"} logo`;
        remember(snapshot);
        showToast("Logo uploaded and added to the header");
      };
      reader.readAsDataURL(file);
      event.currentTarget.value = "";
    });
    sqStudio.querySelector("[data-sq-logo-src]")?.addEventListener("focus", startLogoEdit);
    sqStudio.querySelector("[data-sq-logo-src]")?.addEventListener("change", (event) => { setLogoSource(event.currentTarget.value); finishLogoEdit(); });
    sqStudio.querySelector("[data-sq-logo-text-input]")?.addEventListener("focus", startLogoEdit);
    sqStudio.querySelector("[data-sq-logo-text-input]")?.addEventListener("input", (event) => {
      const logo = selectedLogoParts();
      if (!logo?.text) return;
      logo.text.textContent = event.currentTarget.value || "Your brand";
      refreshElementOverlay(); markSqChanged();
    });
    sqStudio.querySelector("[data-sq-logo-text-input]")?.addEventListener("change", finishLogoEdit);
    sqStudio.querySelector("[data-sq-logo-alt]")?.addEventListener("focus", startLogoEdit);
    sqStudio.querySelector("[data-sq-logo-alt]")?.addEventListener("change", (event) => { const logo = selectedLogoParts(); if (logo?.image) logo.image.alt = event.currentTarget.value.trim(); finishLogoEdit(); markSqChanged(); });
    sqStudio.querySelector("[data-sq-logo-width]")?.addEventListener("pointerdown", startLogoEdit);
    sqStudio.querySelector("[data-sq-logo-width]")?.addEventListener("input", (event) => {
      const logo = selectedLogoParts();
      if (!logo?.image) return;
      logo.image.style.width = `${event.currentTarget.value}px`;
      const output = sqStudio.querySelector("[data-sq-logo-width-output]");
      if (output) output.textContent = `${event.currentTarget.value}px`;
      refreshElementOverlay(); markSqChanged();
    });
    sqStudio.querySelector("[data-sq-logo-width]")?.addEventListener("change", finishLogoEdit);
    const navigationElement = () => selectedElement?.dataset.sqElementType === "navigation" ? selectedElement : previewRoot?.querySelector('[data-sq-element-type="navigation"]') || null;
    const selectHeaderElement = (type) => {
      const element = previewRoot?.querySelector(`[data-sq-element-type="${type}"]`);
      if (!element && type === "navigation") {
        const section = previewRoot?.querySelector('[data-section-id="navigation"]') || previewRoot?.querySelector(`[data-section-id="${selectedSection}"]`);
        addLibraryElement("navigation", section);
        return;
      }
      const section = element?.closest("[data-section-id]");
      if (!element || !section) return;
      openSqPanel("layers", { pin: true });
      selectSqSection(section.dataset.sectionId);
      selectSqElement(element);
      element.scrollIntoView({ behavior: "smooth", block: "center" });
    };
    sqStudio.querySelectorAll("[data-sq-edit-logo]").forEach((button) => button.addEventListener("click", () => selectHeaderElement("logo")));
    sqStudio.querySelectorAll("[data-sq-edit-navigation]").forEach((button) => button.addEventListener("click", () => selectHeaderElement("navigation")));
    const setNavigationDestination = (action, rawValue) => {
      const value = String(rawValue || "").trim() || "#products";
      if (action.matches("button") && value.toLowerCase() === "checkout") {
        action.dataset.sqLinkType = "checkout";
        action.dataset.sqLink = "";
        action.dataset.sqNewTab = "false";
        return;
      }
      const sectionLink = value.startsWith("#");
      action.dataset.sqLinkType = sectionLink ? "section" : "url";
      action.dataset.sqLink = sectionLink ? value.slice(1) : value;
      action.dataset.sqNewTab ||= "false";
      if (action.matches("a")) action.setAttribute("href", value);
    };
    let navigationSnapshot = null;
    const startNavigationEdit = () => { if (!navigationSnapshot) navigationSnapshot = captureState(); };
    const finishNavigationEdit = () => { if (navigationSnapshot) remember(navigationSnapshot); navigationSnapshot = null; markSqChanged(); };
    const navigationLinkList = sqStudio.querySelector("[data-sq-navigation-link-list]");
    navigationLinkList?.addEventListener("focusin", startNavigationEdit);
    navigationLinkList?.addEventListener("input", (event) => {
      const row = event.target.closest("[data-sq-navigation-link-row]");
      const link = navigationElement()?.querySelectorAll(":scope > a")[Number(row?.dataset.sqNavigationLinkRow)];
      if (!link || !row) return;
      const fields = row.querySelectorAll("input");
      if (event.target === fields[0]) link.textContent = event.target.value;
      if (event.target === fields[1]) setNavigationDestination(link, event.target.value);
      markSqChanged();
    });
    navigationLinkList?.addEventListener("change", finishNavigationEdit);
    navigationLinkList?.addEventListener("click", (event) => {
      const button = event.target.closest("button");
      const row = button?.closest("[data-sq-navigation-link-row]");
      const link = navigationElement()?.querySelectorAll(":scope > a")[Number(row?.dataset.sqNavigationLinkRow)];
      if (!button || !link) return;
      remember(); link.remove(); syncElementControls(); markSqChanged();
    });
    sqStudio.querySelector("[data-sq-navigation-add-link]")?.addEventListener("click", () => {
      const navigation = navigationElement();
      if (!navigation) return;
      if (navigation.querySelectorAll(":scope > a").length >= 6) { showToast("Navigation supports up to six links"); return; }
      remember();
      const link = document.createElement("a");
      link.textContent = "New page";
      setNavigationDestination(link, "#section");
      const cta = navigation.querySelector(":scope > button:not(.sq-nav-menu-toggle)");
      if (cta) cta.before(link); else navigation.append(link);
      syncElementControls(); markSqChanged();
    });
    const updateNavigationCta = () => {
      const navigation = navigationElement();
      if (!navigation) return;
      let cta = navigation.querySelector(":scope > button:not(.sq-nav-menu-toggle)");
      if (!cta) { cta = document.createElement("button"); cta.type = "button"; const toggle = navigation.querySelector(":scope > .sq-nav-menu-toggle"); if (toggle) toggle.before(cta); else navigation.append(cta); }
      cta.hidden = !sqStudio.querySelector("[data-sq-navigation-cta-visible]")?.checked;
      cta.textContent = sqStudio.querySelector("[data-sq-navigation-cta-label]")?.value.trim() || "Buy now";
      setNavigationDestination(cta, sqStudio.querySelector("[data-sq-navigation-cta-target]")?.value || "#products");
      markSqChanged();
    };
    sqStudio.querySelectorAll("[data-sq-navigation-cta-visible], [data-sq-navigation-cta-label], [data-sq-navigation-cta-target]").forEach((input) => {
      input.addEventListener("focus", startNavigationEdit);
      input.addEventListener("input", updateNavigationCta);
      input.addEventListener("change", finishNavigationEdit);
    });
    sqStudio.querySelectorAll("[data-sq-navigation-position]").forEach((button) => button.addEventListener("click", () => {
      const section = navigationSectionFor();
      if (!section) return;
      remember();
      section.dataset.sqNavPosition = button.dataset.sqNavigationPosition;
      if (section.dataset.sqNavPosition !== "static") {
        moveNavigationSectionToTop(section);
        rebuildLayerList();
        bindSqInteractions();
      }
      applyNavigationSectionBehavior(section);
      syncNavigationLayoutControls(true);
      markSqChanged();
    }));
    let navigationBehaviorSnapshot = null;
    const startNavigationBehaviorEdit = () => { if (!navigationBehaviorSnapshot) navigationBehaviorSnapshot = captureState(); };
    const finishNavigationBehaviorEdit = () => { if (navigationBehaviorSnapshot) remember(navigationBehaviorSnapshot); navigationBehaviorSnapshot = null; markSqChanged(); };
    const navigationOffset = sqStudio.querySelector("[data-sq-navigation-offset]");
    navigationOffset?.addEventListener("pointerdown", startNavigationBehaviorEdit);
    navigationOffset?.addEventListener("focus", startNavigationBehaviorEdit);
    navigationOffset?.addEventListener("input", (event) => {
      const section = navigationSectionFor();
      if (!section) return;
      section.dataset.sqNavOffset = String(event.currentTarget.value);
      section.dataset.sqNavOffsetCustomized = "true";
      applyNavigationSectionBehavior(section);
      const output = sqStudio.querySelector("[data-sq-navigation-offset-output]");
      if (output) output.textContent = `${event.currentTarget.value}px`;
      markSqChanged();
    });
    navigationOffset?.addEventListener("change", finishNavigationBehaviorEdit);
    sqStudio.querySelectorAll("[data-sq-navigation-surface]").forEach((button) => button.addEventListener("click", () => {
      const section = navigationSectionFor();
      if (!section) return;
      remember();
      section.dataset.sqNavSurface = button.dataset.sqNavigationSurface;
      if (section.dataset.sqNavSurface === "transparent") section.dataset.sqNavOpacity = "0";
      else if (section.dataset.sqNavSurface === "blur" && Number(section.dataset.sqNavOpacity) === 0) section.dataset.sqNavOpacity = "82";
      else if (section.dataset.sqNavSurface === "solid" && Number(section.dataset.sqNavOpacity) === 0) section.dataset.sqNavOpacity = "100";
      applyNavigationSectionBehavior(section);
      syncNavigationLayoutControls(true);
      markSqChanged();
    }));
    [["[data-sq-navigation-opacity]", "sqNavOpacity", "%"], ["[data-sq-navigation-blur]", "sqNavBlur", "px"]].forEach(([selector, key, suffix]) => {
      const input = sqStudio.querySelector(selector);
      input?.addEventListener("pointerdown", startNavigationBehaviorEdit);
      input?.addEventListener("focus", startNavigationBehaviorEdit);
      input?.addEventListener("input", (event) => {
        const section = navigationSectionFor();
        if (!section) return;
        section.dataset[key] = String(event.currentTarget.value);
        applyNavigationSectionBehavior(section);
        const output = sqStudio.querySelector(selector.replace("]", "-output]"));
        if (output) output.textContent = `${event.currentTarget.value}${suffix}`;
        markSqChanged();
      });
      input?.addEventListener("change", finishNavigationBehaviorEdit);
    });
    [["[data-sq-navigation-hide-scroll]", "sqNavHideScroll"], ["[data-sq-navigation-stuck-shadow]", "sqNavShadow"]].forEach(([selector, key]) => {
      const input = sqStudio.querySelector(selector);
      input?.addEventListener("pointerdown", startNavigationBehaviorEdit);
      input?.addEventListener("keydown", (event) => { if ([" ", "Enter"].includes(event.key)) startNavigationBehaviorEdit(); });
      input?.addEventListener("change", (event) => {
        const section = navigationSectionFor();
        if (!section) return;
        section.dataset[key] = String(event.currentTarget.checked);
        applyNavigationSectionBehavior(section);
        finishNavigationBehaviorEdit();
      });
    });
    sqStudio.querySelector("[data-sq-logo-clear]")?.addEventListener("click", () => { if (!selectedLogoParts()) return; remember(); setLogoSource(""); showToast("Header switched to the brand name"); });
    sqStudio.querySelectorAll("[data-sq-role-choice]").forEach((button) => button.addEventListener("click", () => {
      if (!selectedElement?.isConnected) return;
      remember();
      applyButtonRoleToElement(selectedElement, button.dataset.sqRoleChoice);
      syncElementControls(); markSqChanged();
    }));
    sqStudio.querySelector("[data-sq-element-animation-control]")?.addEventListener("change", (event) => {
      if (!selectedElement?.isConnected) return;
      remember();
      [...selectedElement.classList].filter((name) => name.startsWith("element-animation-")).forEach((name) => selectedElement.classList.remove(name));
      selectedElement.dataset.sqElementAnimation = event.currentTarget.value;
      if (event.currentTarget.value !== "none") selectedElement.classList.add(`element-animation-${event.currentTarget.value}`);
      markSqChanged();
    });
    [["duration", "--element-duration"], ["delay", "--element-delay"]].forEach(([field, property]) => {
      sqStudio.querySelector(`[data-sq-element-${field}]`)?.addEventListener("input", (event) => {
        if (!selectedElement?.isConnected) return;
        selectedElement.style.setProperty(property, `${event.currentTarget.value}ms`);
        const output = sqStudio.querySelector(`[data-sq-element-${field}-output]`); if (output) output.textContent = `${event.currentTarget.value}ms`;
        markSqChanged();
      });
    });
    sqStudio.querySelectorAll("[data-sq-hover-choice]").forEach((button) => button.addEventListener("click", () => {
      if (!selectedElement?.isConnected) return;
      remember();
      [...selectedElement.classList].filter((name) => name.startsWith("hover-")).forEach((name) => selectedElement.classList.remove(name));
      selectedElement.dataset.sqHover = button.dataset.sqHoverChoice;
      syncElementControls(); markSqChanged();
    }));
    sqStudio.querySelector("[data-sq-element-replay]")?.addEventListener("click", () => sqStudio.querySelector("[data-sq-preview]")?.click());
    let codeSnapshot;
    const updateSelectedCode = () => {
      if (selectedElement?.dataset.sqElementType !== "custom-code") return;
      const source = selectedElement.querySelector("template[data-sq-code-source]");
      const input = sqStudio.querySelector("[data-sq-code-input]");
      if (!source || !input) return;
      source.innerHTML = input.value;
      renderCodeElement(selectedElement); markSqChanged();
    };
    sqStudio.querySelector("[data-sq-code-input]")?.addEventListener("focus", () => { codeSnapshot = captureState(); });
    sqStudio.querySelector("[data-sq-code-input]")?.addEventListener("change", () => { updateSelectedCode(); if (codeSnapshot) remember(codeSnapshot); codeSnapshot = null; });
    sqStudio.querySelector("[data-sq-run-code]")?.addEventListener("click", updateSelectedCode);
    sqStudio.querySelector("[data-sq-layout-preset]")?.addEventListener("change", (event) => {
      const section = previewRoot?.querySelector(`[data-section-id="${selectedSection}"]`);
      const elements = [...(section?.querySelectorAll(":scope > [data-sq-element]") || [])];
      if (!section || !elements.length || event.currentTarget.value === "custom") return;
      remember();
      const images = elements.filter((element) => ["image", "collage"].includes(element.dataset.sqElementType));
      const heroPieces = elements.filter((element) => ["eyebrow", "heading", "text", "button", "trust-note"].includes(element.dataset.sqElementType));
      const panels = elements.filter((element) => element.dataset.sqElementType === "hero-panel");
      const copy = elements.find((element) => ["copy", "text", "logo", "brand", "collection-heading"].includes(element.dataset.sqElementType)) || elements[0];
      const columns = fluidColumns();
      const leftWidth = Math.ceil(columns / 2);
      const rightWidth = columns - leftWidth;
      const placeHeroCopy = (region) => {
        heroPieces.forEach((element) => {
          const role = element.dataset.sqElementType === "trust-note" ? "trust" : element.dataset.sqElementType;
          setElementLayout(element, heroPieceLayout(region, role));
        });
        panels.forEach((panel) => setElementLayout(panel, region));
      };
      elements.forEach((element) => element.classList.remove("sq-element-hidden", "sq-single-image"));
      if (event.currentTarget.value === "text-only") {
        [...images, ...panels].forEach((element) => element.classList.add("sq-element-hidden"));
        if (heroPieces.length) placeHeroCopy({ x: Math.min(2, columns), y: 2, width: Math.max(1, columns - 2), height: Math.max(8, Number(section.dataset.sqRows || 12) - 2) });
        else if (copy) setElementLayout(copy, { x: Math.min(2, columns), y: 1, width: Math.max(1, columns - 2), height: Math.max(6, Number(section.dataset.sqRows || 12)) });
      } else if (event.currentTarget.value === "image-only") {
        elements.forEach((element) => element.classList.toggle("sq-element-hidden", !images.includes(element)));
        images.forEach((element, index) => setElementLayout(element, { x: 1, y: 1 + index * 6, width: columns, height: Math.max(6, Number(section.dataset.sqRows || 12)) }));
      } else if (event.currentTarget.value === "single-image") {
        if (heroPieces.length) placeHeroCopy({ x: 1, y: 2, width: leftWidth, height: 11 });
        else if (copy) setElementLayout(copy, { x: 1, y: 1, width: leftWidth, height: 12 });
        images.slice(0, 1).forEach((element) => { element.classList.add("sq-single-image"); setElementLayout(element, { x: leftWidth + 1, y: 1, width: rightWidth, height: 12 }); });
        images.slice(1).forEach((element) => element.classList.add("sq-element-hidden"));
      } else if (event.currentTarget.value === "stacked") {
        if (heroPieces.length) {
          placeHeroCopy({ x: 1, y: 1, width: columns, height: 8 });
          images.forEach((element, index) => setElementLayout(element, { x: 1, y: 9 + index * 8, width: columns, height: 8 }));
        } else {
          let row = 1;
          elements.forEach((element) => { setElementLayout(element, { x: 1, y: row, width: columns, height: 6 }); row += 6; });
        }
      } else {
        if (heroPieces.length) placeHeroCopy({ x: 1, y: 2, width: leftWidth, height: 11 });
        else if (copy) setElementLayout(copy, { x: 1, y: 1, width: leftWidth, height: 12 });
        images.forEach((element, index) => { setElementLayout(element, { x: leftWidth + 1, y: 1 + index * 6, width: rightWidth, height: images.length > 1 ? 6 : 12 }); });
      }
      applyFluidSection(section);
      rebuildLayerList(); bindSqInteractions();
      syncElementControls();
      refreshElementOverlay();
      markSqChanged();
    });
    sqStudio.querySelector("[data-sq-animation]")?.addEventListener("change", (event) => {
      remember();
      const block = previewRoot?.querySelector(`[data-section-id="${selectedSection}"]`);
      if (!block) return;
      block.classList.remove("animation-fade", "animation-slide-up", "animation-slide-left", "animation-scale");
      block.dataset.animation = event.currentTarget.value;
      if (event.currentTarget.value !== "none") block.classList.add(`animation-${event.currentTarget.value}`);
      markSqChanged();
    });
    [["duration", "animation-duration", "ms"], ["delay", "animation-delay", "ms"]].forEach(([field, property, suffix]) => {
      sqStudio.querySelector(`[data-sq-${field}]`)?.addEventListener("input", (event) => {
        const block = previewRoot?.querySelector(`[data-section-id="${selectedSection}"]`);
        block?.style.setProperty(`--${property}`, `${event.currentTarget.value}${suffix}`);
        const output = sqStudio.querySelector(`[data-sq-${field}-output]`);
        if (output) output.textContent = `${event.currentTarget.value}${suffix}`;
        markSqChanged();
      });
    });
    sqStudio.querySelector("[data-sq-easing]")?.addEventListener("change", (event) => {
      previewRoot?.querySelector(`[data-section-id="${selectedSection}"]`)?.style.setProperty("--animation-easing", event.currentTarget.value);
      markSqChanged();
    });
    sqStudio.querySelector("[data-sq-replay]")?.addEventListener("click", () => sqStudio.querySelector("[data-sq-preview]")?.click());

    sqStudio.querySelector("[data-sq-content-width]")?.addEventListener("input", (event) => {
      const block = previewRoot?.querySelector(`[data-section-id="${selectedSection}"]`);
      if (block) { block.style.width = `${event.currentTarget.value}px`; block.style.maxWidth = "100%"; block.style.marginInline = "auto"; }
      const output = sqStudio.querySelector("[data-sq-width-output]");
      if (output) output.textContent = `${event.currentTarget.value}px`;
      markSqChanged();
    });
    let pageSpacingSnapshot;
    const startPageSpacingEdit = () => { if (!pageSpacingSnapshot) pageSpacingSnapshot = captureState(); };
    const finishPageSpacingEdit = () => { if (pageSpacingSnapshot) remember(pageSpacingSnapshot); pageSpacingSnapshot = null; };
    sqStudio.querySelectorAll("[data-sq-page-gutter], [data-sq-page-column-gap]").forEach((input) => { input.addEventListener("pointerdown", startPageSpacingEdit); input.addEventListener("focus", startPageSpacingEdit); input.addEventListener("change", finishPageSpacingEdit); });
    sqStudio.querySelectorAll("[data-sq-page-gutter]").forEach((input) => input.addEventListener("input", () => {
      const gutter = Math.max(0, Number(input.value) || 0);
      applyPageGutter(input.dataset.sqPageGutter, gutter);
      syncPageSpacingControls();
      syncPageGridControls();
      revealLayoutGrid();
      if (selectedElement?.isConnected) refreshElementOverlay();
      markSqChanged();
    }));
    sqStudio.querySelector("[data-sq-page-column-gap]")?.addEventListener("input", (event) => {
      pageSpacingState.columnGap = Math.max(0, Number(event.currentTarget.value) || 0);
      previewRoot?.style.setProperty("--sq-builder-column-gap", `${pageSpacingState.columnGap}px`);
      syncPageSpacingControls(); syncPageGridControls(); applyFluidLayouts();
      revealLayoutGrid();
      if (selectedElement?.isConnected) refreshElementOverlay();
      markSqChanged();
    });
    sqStudio.querySelector("[data-sq-page-spacing-reset]")?.addEventListener("click", () => {
      remember();
      Object.entries(defaultPageSpacing.gutters).forEach(([device, gutter]) => applyPageGutter(device, gutter));
      Object.assign(gridDensityState, defaultGridDensity);
      ["desktop", "tablet", "mobile"].forEach((device) => updateGridGeometry(device, { columns: defaultGridColumns[device], cellHeight: defaultGridCellHeight[device] }));
      pageSpacingState.columnGap = defaultPageSpacing.columnGap;
      previewRoot?.style.setProperty("--sq-builder-column-gap", `${defaultPageSpacing.columnGap}px`);
      syncPageSpacingControls(); syncPageGridControls(); applyFluidLayouts(); revealLayoutGrid(); markSqChanged();
    });
    previewRoot?.style.setProperty("--sq-builder-column-gap", `${pageSpacingState.columnGap}px`);
    syncPageSpacingControls();

    const brandVariable = { accent: "--site-accent", page: "--site-page", ink: "--site-ink", surface: "--site-surface" };
    const syncPageAppearanceControls = () => {
      if (!previewRoot) return;
      const computed = getComputedStyle(previewRoot);
      sqStudio.querySelectorAll("[data-sq-page-brand-color]").forEach((input) => {
        const key = input.dataset.sqPageBrandColor;
        input.value = colorToHex(computed.getPropertyValue(brandVariable[key]), input.value);
        const output = sqStudio.querySelector(`[data-sq-page-brand-output="${key}"]`);
        if (output) output.textContent = input.value.toUpperCase();
      });
    };
    let globalStyleSnapshot;
    const startGlobalStyleEdit = () => { if (!globalStyleSnapshot) globalStyleSnapshot = captureState(); };
    const finishGlobalStyleEdit = () => { if (globalStyleSnapshot) remember(globalStyleSnapshot); globalStyleSnapshot = null; };
    sqStudio.querySelectorAll("[data-sq-brand-color], [data-sq-page-brand-color], [data-sq-brand-font], [data-sq-button-color], [data-sq-button-radius], [data-sq-button-border-width], [data-sq-button-height], [data-sq-button-weight], [data-sq-button-shadow], [data-sq-button-case]").forEach((input) => { input.addEventListener("focus", startGlobalStyleEdit); input.addEventListener("pointerdown", startGlobalStyleEdit); input.addEventListener("change", finishGlobalStyleEdit); });
    sqStudio.querySelectorAll("[data-sq-brand-color]").forEach((input) => input.addEventListener("input", () => {
      const key = input.dataset.sqBrandColor;
      previewRoot?.style.setProperty(brandVariable[key], input.value);
      if (key === "accent") previewRoot?.style.setProperty("--button-primary-bg", input.value);
      const output = sqStudio.querySelector(`[data-sq-brand-color-output="${key}"]`);
      if (output) output.textContent = input.value.toUpperCase();
      syncPageAppearanceControls();
      sqStudio.querySelectorAll("[data-sq-theme]").forEach((button) => button.classList.remove("active"));
      if (selectedAction?.isConnected) syncElementControls();
      markSqChanged();
    }));
    sqStudio.querySelectorAll("[data-sq-page-brand-color]").forEach((input) => input.addEventListener("input", () => {
      const key = input.dataset.sqPageBrandColor;
      previewRoot?.style.setProperty(brandVariable[key], input.value);
      const brandInput = sqStudio.querySelector(`[data-sq-brand-color="${key}"]`);
      const brandOutput = sqStudio.querySelector(`[data-sq-brand-color-output="${key}"]`);
      if (brandInput) brandInput.value = input.value;
      if (brandOutput) brandOutput.textContent = input.value.toUpperCase();
      syncPageAppearanceControls();
      sqStudio.querySelectorAll("[data-sq-theme]").forEach((button) => button.classList.remove("active"));
      markSqChanged();
    }));
    sqStudio.querySelectorAll("[data-sq-brand-font]").forEach((input) => input.addEventListener("change", () => {
      previewRoot?.style.setProperty(`--site-${input.dataset.sqBrandFont}-font`, input.value);
      markSqChanged();
    }));
    const buttonDefaults = {
      primary: { bg: "#f44b34", fg: "#ffffff", border: "#f44b34", radius: 24, borderWidth: 0, height: 42, weight: 600, shadow: "soft", case: "none", treatment: "solid" },
      secondary: { bg: "#ffffff", fg: "#24262b", border: "#24262b", radius: 10, borderWidth: 1, height: 42, weight: 600, shadow: "none", case: "none", treatment: "outline" },
      tertiary: { bg: "#ffffff", fg: "#f44b34", border: "#ffffff", radius: 0, borderWidth: 0, height: 42, weight: 600, shadow: "none", case: "none", treatment: "text" },
    };
    const activeButtonRole = () => sqStudio.querySelector("[data-sq-button-style-role]")?.value || "primary";
    const buttonValue = (role, field) => {
      const fallbackField = field.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      return previewRoot?.style.getPropertyValue(`--button-${role}-${field}`).trim() || String(buttonDefaults[role][fallbackField] ?? "");
    };
    const buttonTreatment = (role) => [...(previewRoot?.classList || [])].find((name) => name.startsWith(`buttons-${role}-`))?.replace(`buttons-${role}-`, "") || buttonDefaults[role].treatment;
    const buttonShadowValue = (role, value) => ({ none: "none", soft: `0 7px 16px color-mix(in srgb,var(--button-${role}-bg) 20%,transparent)`, strong: `0 12px 28px color-mix(in srgb,var(--button-${role}-bg) 32%,transparent)` })[value] || "none";
    const buttonShadowName = (role) => {
      const value = buttonValue(role, "shadow");
      return value === "none" ? "none" : value.includes("12px 28px") ? "strong" : "soft";
    };
    const applyButtonTreatment = (role, treatment) => {
      [...(previewRoot?.classList || [])].filter((name) => name.startsWith(`buttons-${role}-`)).forEach((name) => previewRoot.classList.remove(name));
      previewRoot?.classList.add(`buttons-${role}-${treatment}`);
    };
    const syncButtonSystemControls = () => {
      const role = activeButtonRole();
      sqStudio.querySelectorAll("[data-sq-button-color]").forEach((input) => { input.value = colorToHex(buttonValue(role, input.dataset.sqButtonColor), buttonDefaults[role][input.dataset.sqButtonColor]); });
      const treatment = sqStudio.querySelector("[data-sq-button-treatment]"); if (treatment) treatment.value = buttonTreatment(role);
      const radius = Number.parseInt(buttonValue(role, "radius"), 10) || 0;
      const radiusInput = sqStudio.querySelector("[data-sq-button-radius]"); if (radiusInput) radiusInput.value = String(radius);
      const radiusOutput = sqStudio.querySelector("[data-sq-button-radius-output]"); if (radiusOutput) radiusOutput.textContent = `${radius}px`;
      const borderWidth = Number.parseInt(buttonValue(role, "border-width"), 10);
      const borderWidthInput = sqStudio.querySelector("[data-sq-button-border-width]"); if (borderWidthInput) borderWidthInput.value = String(Number.isFinite(borderWidth) ? borderWidth : buttonDefaults[role].borderWidth);
      const borderWidthOutput = sqStudio.querySelector("[data-sq-button-border-width-output]"); if (borderWidthOutput) borderWidthOutput.textContent = `${borderWidthInput?.value || 0}px`;
      const height = Number.parseInt(buttonValue(role, "height"), 10) || buttonDefaults[role].height;
      const heightInput = sqStudio.querySelector("[data-sq-button-height]"); if (heightInput) heightInput.value = String(height);
      const heightOutput = sqStudio.querySelector("[data-sq-button-height-output]"); if (heightOutput) heightOutput.textContent = `${height}px`;
      const weight = sqStudio.querySelector("[data-sq-button-weight]"); if (weight) weight.value = String(Number.parseInt(buttonValue(role, "weight"), 10) || buttonDefaults[role].weight);
      const shadow = sqStudio.querySelector("[data-sq-button-shadow]"); if (shadow) shadow.value = buttonShadowName(role);
      const letterCase = sqStudio.querySelector("[data-sq-button-case]"); if (letterCase) letterCase.value = buttonValue(role, "case") || buttonDefaults[role].case;
      const preview = sqStudio.querySelector("[data-sq-button-preview]");
      if (preview) {
        const treatmentValue = buttonTreatment(role);
        const background = buttonValue(role, "bg");
        preview.classList.remove("button-primary", "button-secondary", "button-tertiary");
        preview.classList.add(`button-${role}`);
        preview.style.color = treatmentValue === "outline" || treatmentValue === "text" ? background : buttonValue(role, "fg");
        preview.style.background = treatmentValue === "outline" || treatmentValue === "text" ? "transparent" : treatmentValue === "soft" ? `color-mix(in srgb,${background} 14%,transparent)` : background;
        preview.style.border = `${borderWidthInput?.value || 0}px solid ${buttonValue(role, "border")}`;
        preview.style.borderRadius = `${radius}px`;
        preview.style.minHeight = `${height}px`;
        preview.style.fontWeight = weight?.value || "600";
        preview.style.textTransform = letterCase?.value || "none";
        preview.style.boxShadow = ["soft", "text"].includes(treatmentValue) ? "none" : buttonShadowValue(role, shadow?.value || "none");
      }
      syncBuilderRanges();
    };
    sqStudio.querySelector("[data-sq-button-style-role]")?.addEventListener("change", syncButtonSystemControls);
    sqStudio.querySelectorAll("[data-sq-button-color]").forEach((input) => input.addEventListener("input", () => {
      previewRoot?.style.setProperty(`--button-${activeButtonRole()}-${input.dataset.sqButtonColor}`, input.value);
      if (selectedAction?.isConnected) syncElementControls();
      syncButtonSystemControls();
      markSqChanged();
    }));
    sqStudio.querySelector("[data-sq-button-treatment]")?.addEventListener("change", (event) => {
      remember();
      const role = activeButtonRole();
      applyButtonTreatment(role, event.currentTarget.value);
      if (event.currentTarget.value === "outline" && Number.parseInt(buttonValue(role, "border-width"), 10) === 0) previewRoot?.style.setProperty(`--button-${role}-border-width`, "1px");
      syncButtonSystemControls();
      markSqChanged();
    });
    sqStudio.querySelector("[data-sq-button-radius]")?.addEventListener("input", (event) => {
      previewRoot?.style.setProperty(`--button-${activeButtonRole()}-radius`, `${event.currentTarget.value}px`);
      const output = sqStudio.querySelector("[data-sq-button-radius-output]"); if (output) output.textContent = `${event.currentTarget.value}px`; syncButtonSystemControls(); markSqChanged();
    });
    [["border-width", "px"], ["height", "px"]].forEach(([field, suffix]) => {
      sqStudio.querySelector(`[data-sq-button-${field}]`)?.addEventListener("input", (event) => {
        previewRoot?.style.setProperty(`--button-${activeButtonRole()}-${field}`, `${event.currentTarget.value}${suffix}`);
        const output = sqStudio.querySelector(`[data-sq-button-${field}-output]`); if (output) output.textContent = `${event.currentTarget.value}${suffix}`;
        syncButtonSystemControls();
        markSqChanged();
      });
    });
    sqStudio.querySelector("[data-sq-button-weight]")?.addEventListener("change", (event) => { previewRoot?.style.setProperty(`--button-${activeButtonRole()}-weight`, event.currentTarget.value); syncButtonSystemControls(); markSqChanged(); });
    sqStudio.querySelector("[data-sq-button-case]")?.addEventListener("change", (event) => { previewRoot?.style.setProperty(`--button-${activeButtonRole()}-case`, event.currentTarget.value); syncButtonSystemControls(); markSqChanged(); });
    sqStudio.querySelector("[data-sq-button-shadow]")?.addEventListener("change", (event) => { const role = activeButtonRole(); previewRoot?.style.setProperty(`--button-${role}-shadow`, buttonShadowValue(role, event.currentTarget.value)); syncButtonSystemControls(); markSqChanged(); });
    sqStudio.querySelector("[data-sq-edit-button-brand]")?.addEventListener("click", () => {
      const role = selectedElement?.dataset.sqButtonRole || "primary";
      const roleSelect = sqStudio.querySelector("[data-sq-button-style-role]");
      if (roleSelect) roleSelect.value = role;
      openSqPanel("brand", { pin: true });
      syncButtonSystemControls();
      const system = sqStudio.querySelector("[data-sq-brand-button-system]");
      system?.scrollIntoView({ behavior: "smooth", block: "start" });
      (roleSelect?._sqBuilderSelect?.trigger || roleSelect)?.focus({ preventScroll: true });
      system?.classList.remove("brand-focus");
      requestAnimationFrame(() => system?.classList.add("brand-focus"));
    });
    sqStudio.querySelector("[data-sq-page-brand-link]")?.addEventListener("click", () => {
      openSqPanel("brand", { pin: true });
      syncBrandControls();
      const palette = sqStudio.querySelector("[data-sq-brand-palette]");
      palette?.scrollIntoView({ behavior: "smooth", block: "start" });
      sqStudio.querySelector('[data-sq-brand-color="page"]')?.focus({ preventScroll: true });
      palette?.classList.remove("brand-focus");
      requestAnimationFrame(() => palette?.classList.add("brand-focus"));
    });
    sqStudio.querySelectorAll("[data-sq-theme]").forEach((button) => button.addEventListener("click", () => {
      remember();
      sqStudio.querySelectorAll("[data-sq-theme]").forEach((item) => item.classList.toggle("active", item === button));
      previewRoot?.classList.remove("theme-coral", "theme-forest", "theme-indigo", "theme-charcoal");
      previewRoot?.classList.add(button.dataset.sqTheme);
      const colors = { "theme-coral": ["#f44b34", "#fffbf7", "#24262b", "#ffffff"], "theme-forest": ["#1c6b55", "#f1f5ef", "#17382e", "#ffffff"], "theme-indigo": ["#3f58a8", "#f1f3fb", "#1d2644", "#ffffff"], "theme-charcoal": ["#24262b", "#f4f4f2", "#24262b", "#ffffff"] }[button.dataset.sqTheme];
      ["accent", "page", "ink", "surface"].forEach((key, index) => { previewRoot?.style.setProperty(brandVariable[key], colors[index]); const input = sqStudio.querySelector(`[data-sq-brand-color="${key}"]`); if (input) input.value = colors[index]; const output = sqStudio.querySelector(`[data-sq-brand-color-output="${key}"]`); if (output) output.textContent = colors[index].toUpperCase(); });
      previewRoot?.style.setProperty("--button-primary-bg", colors[0]);
      previewRoot?.style.setProperty("--button-primary-border", colors[0]);
      syncPageAppearanceControls();
      syncButtonSystemControls();
      if (selectedAction?.isConnected) syncElementControls();
      markSqChanged();
    }));
    sqStudio.querySelector("[data-sq-radius]")?.addEventListener("change", (event) => {
      remember(); previewRoot?.classList.remove("radius-soft", "radius-round", "radius-square"); previewRoot?.classList.add(event.currentTarget.value); markSqChanged();
    });
    sqStudio.querySelector("[data-sq-layout]")?.addEventListener("change", (event) => {
      remember(); previewRoot?.classList.remove("layout-rich", "layout-editorial", "layout-image-only"); previewRoot?.classList.add(event.currentTarget.value); markSqChanged();
    });
    sqStudio.querySelector("[data-sq-font-size]")?.addEventListener("input", (event) => {
      if (previewRoot) previewRoot.style.fontSize = `${event.currentTarget.value}px`;
      const output = sqStudio.querySelector("[data-sq-font-output]"); if (output) output.textContent = `${event.currentTarget.value}px`; markSqChanged();
    });

    const iconMarkup = (name) => `<svg class="icon" aria-hidden="true"><use href="#icon-${name}"></use></svg>`;
    const layerDetails = {
      announcement: ["Announcement", "Promotional message", "message"], navigation: ["Navigation", "Brand, links, and button", "layout"], hero: ["Hero", "Image, copy, and motion", "layout"], products: ["Product collection", "Connected commerce grid", "box"], "image-story": ["Brand story", "Editorial content", "image"], reviews: ["Customer proof", "Credible review state", "star"], benefits: ["Services", "Merchant service information", "star"], faq: ["FAQ", "Purchase objections answered", "help"], checkout: ["Checkout", "Secure cart action", "credit-card"], shipping: ["Shipping", "Courier and ETA", "truck"], newsletter: ["Newsletter", "Email signup", "mail"], footer: ["Footer", "Store links and information", "layout"],
    };
    const elementLayerIcon = (type) => ({ image: "image", collage: "image", logo: "image", button: "play", marquee: "trend", checkout: "credit-card", "product-grid": "box", navigation: "layout", benefit: "star", review: "star", faq: "help", icon: "star", "custom-code": "code" })[type] || "message";
    const elementLayerPreview = (element) => {
      const image = element.querySelector("img");
      if (image?.alt) return image.alt;
      const text = element.textContent.replace(/\s+/g, " ").trim();
      return text ? (text.length > 46 ? `${text.slice(0, 43)}…` : text) : "Visual element";
    };
    const rebuildLayerList = () => {
      if (!layerList) return;
      const groups = [...(previewRoot?.querySelectorAll(":scope > [data-sq-block]") || [])].map((section) => {
        const sectionId = section.dataset.sectionId;
        const detailKey = Object.keys(layerDetails).sort((a, b) => b.length - a.length).find((key) => sectionId === key || sectionId.startsWith(`${key}-`));
        const details = layerDetails[detailKey] || [elementTypeName(section), "Editable section", "layers"];
        const elements = [...section.querySelectorAll(":scope > [data-sq-element]")];
        const sectionBackground = section.querySelector(":scope > .sq-section-background");
        elements.forEach((element, index) => { if (!element.dataset.sqElementId) element.dataset.sqElementId = `element-${sectionId.replace(/[^a-z0-9-]/gi, "-")}-${index + 1}-${Date.now()}`; });
        const wrapper = document.createElement("div");
        wrapper.className = `sq-layer-group${sectionId === selectedSection ? " active" : ""}${section.classList.contains("section-hidden") ? " section-hidden" : ""}`;
        wrapper.dataset.sqLayerGroup = "";
        wrapper.dataset.sectionId = sectionId;
        const backgroundEntry = sectionBackground ? `<button type="button" class="sq-background-layer-entry" data-sq-background-layer="section" data-section-id="${escapeHtml(sectionId)}"><span>${iconMarkup("image")}</span><div><b>Background image</b><small>Click to edit crop, overlay, filters, and motion</small></div>${iconMarkup("chevron-right")}</button>` : "";
        wrapper.innerHTML = `<button type="button" draggable="true" data-sq-layer data-section-id="${escapeHtml(sectionId)}">${iconMarkup("grip")}<span>${iconMarkup(details[2])}</span><div><b>${escapeHtml(details[0])}</b><small>${elements.length} element${elements.length === 1 ? "" : "s"} · ${escapeHtml(details[1])}</small></div>${iconMarkup("chevron-right")}</button><div class="sq-layer-elements" aria-label="${escapeHtml(details[0])} elements">${backgroundEntry}${elements.map((element) => `<button type="button" draggable="true" class="${element.classList.contains("sq-element-hidden") ? "element-hidden" : ""}" data-sq-element-layer="${escapeHtml(element.dataset.sqElementId)}"><span>${iconMarkup(elementLayerIcon(element.dataset.sqElementType))}</span><div><b>${escapeHtml(elementTypeName(element))}</b><small>${escapeHtml(elementLayerPreview(element))}</small></div>${iconMarkup("chevron-right")}</button>`).join("")}</div>`;
        return wrapper;
      });
      layerList.replaceChildren(...groups);
    };
    const syncBrandControls = () => {
      const computed = getComputedStyle(previewRoot);
      ["accent", "page", "ink", "surface"].forEach((key) => { const input = sqStudio.querySelector(`[data-sq-brand-color="${key}"]`); if (input) input.value = colorToHex(computed.getPropertyValue(brandVariable[key]), input.value); const output = sqStudio.querySelector(`[data-sq-brand-color-output="${key}"]`); if (output && input) output.textContent = input.value.toUpperCase(); });
      sqStudio.querySelectorAll("[data-sq-brand-font]").forEach((input) => {
        const font = computed.getPropertyValue(`--site-${input.dataset.sqBrandFont}-font`).trim() || "Poppins, sans-serif";
        if ([...input.options].some((option) => option.value === font)) input.value = font;
      });
      syncPageAppearanceControls();
      syncButtonSystemControls();
    };
    const newBlockMarkup = (type, sectionId) => {
      const handle = `<button class="sq-block-handle" type="button" aria-label="Drag section">${iconMarkup("grip")}</button>`;
      if (type === "blank") return `<section class="sq-page-block sq-generated-blank" draggable="true" data-sq-block data-sq-fluid data-sq-rows="12" data-section-id="${sectionId}">${handle}</section>`;
      if (type === "full-image") return `<section class="sq-page-block sq-generated-image" draggable="true" data-sq-block data-sq-fluid data-sq-rows="14" data-section-id="${sectionId}">${handle}<div class="sq-free-image" data-sq-element data-sq-element-type="image" data-layout-desktop="1,1,12,14" data-layout-tablet="1,1,12,14" data-layout-mobile="1,1,12,14"><img src="${productImages.granola}" alt="Granola Madu Nusantara product story"></div></section>`;
      if (type === "gallery") return `<section class="sq-page-block sq-generated-gallery" draggable="true" data-sq-block data-sq-fluid data-sq-rows="12" data-section-id="${sectionId}">${handle}<div class="sq-free-image" data-sq-element data-sq-element-type="image" data-layout-desktop="1,1,6,12" data-layout-tablet="1,1,12,6" data-layout-mobile="1,1,12,6"><img src="${productImages.granola}" alt="Granola"></div><div class="sq-free-image" data-sq-element data-sq-element-type="image" data-layout-desktop="7,1,3,12" data-layout-tablet="1,7,6,6" data-layout-mobile="1,7,6,6"><img src="${productImages.coffee}" alt="Kopi Susu"></div><div class="sq-free-image" data-sq-element data-sq-element-type="image" data-layout-desktop="10,1,3,12" data-layout-tablet="7,7,6,6" data-layout-mobile="7,7,6,6"><img src="${productImages.sambal}" alt="Sambal Roa"></div></section>`;
      if (type === "text") return `<section class="sq-page-block sq-generated-text" draggable="true" data-sq-block data-sq-fluid data-sq-rows="10" data-section-id="${sectionId}">${handle}<small data-sq-element data-sq-element-type="eyebrow" data-layout-desktop="2,1,10,2" data-layout-tablet="1,1,12,2" data-layout-mobile="1,1,12,2">YOUR STORY</small><h2 data-sq-element data-sq-element-type="heading" data-layout-desktop="2,3,10,4" data-layout-tablet="1,3,12,4" data-layout-mobile="1,3,12,4">A clear idea deserves room to breathe.</h2><p data-sq-element data-sq-element-type="text" data-layout-desktop="3,7,8,3" data-layout-tablet="1,7,12,3" data-layout-mobile="1,7,12,3">Write a concise product or brand story here. Every line remains editable directly on the page.</p></section>`;
      if (type === "testimonials") return `<section class="sq-page-block sq-generated-reviews" draggable="true" data-sq-block data-sq-fluid data-sq-rows="8" data-section-id="${sectionId}">${handle}<article data-sq-element data-sq-element-type="review" data-sq-review-rating="5" data-layout-desktop="1,1,6,8" data-layout-tablet="1,1,6,8" data-layout-mobile="1,1,12,4"><b>“Excellent flavor and beautifully packed.”</b><small>Sarah · verified buyer</small></article><article data-sq-element data-sq-element-type="review" data-sq-review-rating="5" data-layout-desktop="7,1,6,8" data-layout-tablet="7,1,6,8" data-layout-mobile="1,5,12,4"><b>“Checkout was easy and delivery was quick.”</b><small>Michael · verified buyer</small></article></section>`;
      if (type === "faq") return `<section class="sq-page-block sq-generated-faq" draggable="true" data-sq-block data-sq-fluid data-sq-rows="12" data-section-id="${sectionId}">${handle}<h2 data-sq-element data-sq-element-type="heading" data-layout-desktop="1,1,12,3" data-layout-tablet="1,1,12,3" data-layout-mobile="1,1,12,3">Questions, answered.</h2><details open data-sq-element data-sq-element-type="faq" data-layout-desktop="1,4,12,4" data-layout-tablet="1,4,12,4" data-layout-mobile="1,4,12,4"><summary>How does payment work?</summary><p>Customers complete a secure checkout prepared by Ezkart.</p></details><details data-sq-element data-sq-element-type="faq" data-layout-desktop="1,8,12,4" data-layout-tablet="1,8,12,4" data-layout-mobile="1,8,12,4"><summary>How is shipping calculated?</summary><p>Product weights, destination, courier, and service determine the live rate.</p></details></section>`;
      if (type === "spacer") return `<section class="sq-page-block sq-generated-spacer" draggable="true" data-sq-block data-sq-fluid data-sq-rows="3" data-section-id="${sectionId}">${handle}<span data-sq-element data-sq-element-type="spacer" data-layout-desktop="1,1,12,3" data-layout-tablet="1,1,12,3" data-layout-mobile="1,1,12,3">Responsive spacer · 80px</span></section>`;
      const template = previewRoot?.querySelector(`[data-section-id="${type}"]`);
      if (template) { const clone = template.cloneNode(true); clone.querySelectorAll(".sq-element-overlay, .sq-section-height-handle").forEach((overlay) => overlay.remove()); clone.dataset.sectionId = sectionId; clone.removeAttribute("id"); clone.classList.remove("selected"); return clone.outerHTML; }
      return `<section class="sq-page-block sq-generated-text" draggable="true" data-sq-block data-section-id="${sectionId}">${handle}<h2>New section</h2></section>`;
    };
    const newElementMarkup = (type) => {
      if (type === "heading") return `<div class="sq-free-element sq-free-heading" data-sq-element data-sq-element-type="heading"><h2>Write a powerful heading.</h2></div>`;
      if (type === "text") return `<div class="sq-free-element sq-free-text" data-sq-element data-sq-element-type="text"><p>Add your story, product details, or supporting copy here.</p></div>`;
      if (type === "marquee") return `<div class="sq-free-element sq-free-marquee" data-sq-element data-sq-element-type="marquee" data-sq-marquee-mode="auto" data-sq-marquee-speed="60"><div class="sq-marquee-track"><span class="sq-marquee-copy">NEW ARRIVALS ✦ SHOP THE DROP ✦ MADE FOR YOUR EVERYDAY ✦</span><span class="sq-marquee-copy" aria-hidden="true">NEW ARRIVALS ✦ SHOP THE DROP ✦ MADE FOR YOUR EVERYDAY ✦</span></div></div>`;
      if (type === "button") return `<div class="sq-free-element sq-free-button" data-sq-element data-sq-element-type="button"><button type="button">Call to action</button></div>`;
      if (type === "navigation") return `<nav class="sq-free-element sq-free-navigation" data-sq-element data-sq-element-type="navigation"><a href="#products">Shop</a><a href="#story">Our story</a><a href="#contact">Contact</a><button type="button">Buy now</button></nav>`;
      if (type === "image") return `<div class="sq-free-element sq-free-image" data-sq-element data-sq-element-type="image"><img src="${productImages.granola}" alt="Product image"></div>`;
      if (type === "divider") return `<div class="sq-free-element sq-free-divider" data-sq-element data-sq-element-type="divider"><span></span></div>`;
      if (type === "html") return `<div class="sq-free-element sq-free-code" data-sq-element data-sq-element-type="custom-code"><iframe title="Custom code preview" sandbox="allow-scripts allow-forms" data-sq-code-render></iframe><template data-sq-code-source><style>.custom-promo{height:100%;padding:32px;display:grid;place-content:center;background:linear-gradient(135deg,#191923,#392d69);color:white;border-radius:18px;text-align:center}.custom-promo strong{font-size:28px}.custom-promo p{margin:8px 0 0;opacity:.72}</style><div class="custom-promo"><strong>Custom HTML block</strong><p>Add HTML, CSS, or JavaScript from the inspector.</p></div></template></div>`;
      return `<div class="sq-free-element sq-free-form" data-sq-element data-sq-element-type="form"><h3>Stay in the loop.</h3><p>Get product news and special offers.</p><form><input type="email" placeholder="Email address" aria-label="Email address"><button type="button">Subscribe</button></form></div>`;
    };
    const ensureElementSection = (section) => {
      if (!section || section.matches("[data-sq-fluid]")) return;
      section.dataset.sqFluid = "";
      section.dataset.sqRows = "12";
      let row = 1;
      [...section.children].filter((child) => !child.matches(".sq-block-handle,.sq-element-overlay")).forEach((child) => {
        let element = child;
        if (child.matches("img")) {
          element = document.createElement("div");
          element.className = "sq-free-image";
          child.before(element);
          element.append(child);
        }
        element.dataset.sqElement = "";
        element.dataset.sqElementType ||= element.matches("img,.sq-free-image") ? "image" : "content";
        ["desktop", "tablet", "mobile"].forEach((device) => setElementLayout(element, { x: 1, y: row, width: fluidColumns(device), height: 5 }, device));
        row += 5;
      });
      section.dataset.sqRows = String(Math.max(12, row - 1));
    };
    const libraryElementDimensions = (type) => ({
      heading: { width: 6, height: 4 }, text: { width: 6, height: 3 }, marquee: { width: fluidColumns(), height: 2 }, button: { width: 3, height: 2 },
      navigation: { width: fluidColumns(), height: 2 }, image: { width: 6, height: 8 }, divider: { width: 8, height: 1 }, form: { width: 6, height: 5 }, html: { width: 8, height: 8 },
    }[type] || { width: 6, height: 4 });
    const clearLibraryDropPreview = () => {
      libraryDropPreview?.remove();
      libraryDropPreview = null;
      previewRoot?.querySelectorAll(".sq-library-drop-section").forEach((section) => section.classList.remove("sq-library-drop-section"));
    };
    const libraryPointerLayout = (section, event, dimensions = libraryDrag?.kind === "component" ? { width: 8, height: 8 } : libraryElementDimensions(libraryDrag?.type)) => {
      const columns = fluidColumns();
      const width = Math.max(1, Math.min(columns, activeDevice === "mobile" ? columns : dimensions.width));
      const height = Math.max(1, dimensions.height);
      const rect = section.getBoundingClientRect();
      const scale = section.offsetWidth ? rect.width / section.offsetWidth : 1;
      const computed = getComputedStyle(section);
      const paddingLeft = (Number.parseFloat(computed.paddingLeft) || 0) * scale;
      const paddingRight = (Number.parseFloat(computed.paddingRight) || 0) * scale;
      const paddingTop = (Number.parseFloat(computed.paddingTop) || 0) * scale;
      const gap = (Number.parseFloat(computed.columnGap) || 0) * scale;
      const innerWidth = Math.max(1, rect.width - paddingLeft - paddingRight);
      const columnWidth = Math.max(1, (innerWidth - gap * (columns - 1)) / columns);
      const pointerColumn = Math.floor(Math.max(0, event.clientX - rect.left - paddingLeft) / Math.max(1, columnWidth + gap)) + 1;
      const x = Math.max(1, Math.min(columns - width + 1, pointerColumn - Math.floor(width / 2)));
      const renderedRowHeight = Math.max(1, fluidRowHeight(section) * scale);
      const pointerRow = Math.floor(Math.max(0, event.clientY - rect.top - paddingTop) / renderedRowHeight) + 1;
      const y = Math.max(1, Math.min(maximumFluidRows - height + 1, pointerRow - Math.floor(height / 2)));
      return { x, y, width, height };
    };
    const updateLibraryDropPreview = (section, event) => {
      if (!libraryDrag || !section) return;
      const layout = libraryPointerLayout(section, event);
      if (!libraryDropPreview) {
        libraryDropPreview = document.createElement("div");
        libraryDropPreview.className = "sq-library-drop-preview";
        libraryDropPreview.setAttribute("aria-hidden", "true");
      }
      if (libraryDropPreview.parentElement !== section) section.append(libraryDropPreview);
      libraryDropPreview.style.gridColumn = `${layout.x} / span ${layout.width}`;
      libraryDropPreview.style.gridRow = `${layout.y} / span ${layout.height}`;
      libraryDropPreview.dataset.layout = `${layout.x},${layout.y},${layout.width},${layout.height}`;
      libraryDropPreview.innerHTML = `<span>${escapeHtml(libraryDrag.label)}</span>`;
      previewRoot?.querySelectorAll(".sq-library-drop-section").forEach((candidate) => candidate.classList.toggle("sq-library-drop-section", candidate === section));
    };
    const addLibraryElement = (type, section, preferredLayout = null) => {
      if (!section) return null;
      remember();
      ensureElementSection(section);
      removeElementOverlay();
      const wrapper = document.createElement("div");
      wrapper.innerHTML = newElementMarkup(type);
      const element = wrapper.firstElementChild;
      const dimensions = libraryElementDimensions(type);
      ["desktop", "tablet", "mobile"].forEach((device) => {
        const desired = device === "mobile" || ["marquee", "navigation"].includes(type) ? { ...dimensions, width: fluidColumns(device) } : dimensions;
        setElementLayout(element, findOpenElementLayout(section, desired, device), device);
      });
      if (preferredLayout) setElementLayout(element, preferredLayout, activeDevice);
      section.append(element);
      rebuildLayerList();
      bindSqInteractions();
      applyFluidSection(section);
      selectSqElement(element);
      syncInspectorContent();
      openSqPanel("layers");
      element.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
      markSqChanged();
      showToast(`${elementTypeName(element)} added — drag it anywhere in the section`);
      return element;
    };
    const scaledNavigationLayout = (layout, device) => {
      const [x, y, width, height] = String(layout).split(",").map((value) => Number.parseInt(value, 10));
      const columns = fluidColumns(device);
      const left = Math.floor((Math.max(1, x || 1) - 1) * columns / 12) + 1;
      const right = Math.ceil((Math.max(1, x || 1) - 1 + Math.max(1, width || 1)) * columns / 12);
      return `${left},${Math.max(1, y || 1)},${Math.max(1, right - left + 1)},${Math.max(1, height || 1)}`;
    };
    const responsiveNavigationLayouts = (layouts) => Object.fromEntries(["desktop", "tablet", "mobile"].map((device) => [device, scaledNavigationLayout(layouts[device], device)]));
    const navigationLogoMarkup = (sourceLayouts) => {
      const layouts = responsiveNavigationLayouts(sourceLayouts);
      const source = previewRoot?.querySelector('[data-sq-element-type="logo"]');
      const logo = source?.cloneNode(true) || document.createElement("div");
      if (!source) logo.innerHTML = '<img data-sq-logo-image alt="" hidden><b data-sq-logo-text>Your brand</b>';
      logo.className = "sq-site-logo";
      logo.dataset.sqElement = "";
      logo.dataset.sqElementType = "logo";
      delete logo.dataset.sqElementId;
      logo.removeAttribute("contenteditable");
      logo.classList.remove("sq-element-selected", "sq-element-hidden");
      ["desktop", "tablet", "mobile"].forEach((device) => logo.setAttribute(`data-layout-${device}`, layouts[device]));
      return logo.outerHTML;
    };
    const navigationLinksMarkup = ({ className = "", slot = "", links = [], button = "Buy now", buttonAction = "checkout", layouts: sourceLayouts }) => {
      const layouts = responsiveNavigationLayouts(sourceLayouts);
      const actionType = buttonAction === "checkout" ? "checkout" : buttonAction.startsWith("#") ? "section" : "url";
      const actionTarget = actionType === "section" ? buttonAction.slice(1) : actionType === "url" ? buttonAction : "";
      const buttonMarkup = button ? `<button type="button" data-sq-link-type="${actionType}" data-sq-link="${actionTarget}" data-sq-new-tab="false">${button}</button>` : "";
      return `<nav class="sq-template-navigation button-primary${className ? ` ${className}` : ""}" data-sq-element data-sq-element-type="navigation" data-sq-button-role="primary"${slot ? ` data-sq-nav-slot="${slot}"` : ""} data-layout-desktop="${layouts.desktop}" data-layout-tablet="${layouts.tablet}" data-layout-mobile="${layouts.mobile}">${links.map(([label, target]) => `<a href="${target}">${label}</a>`).join("")}${buttonMarkup}</nav>`;
    };
    const navigationTemplateMarkup = (template, sectionId = "navigation") => {
      const handle = `<button class="sq-block-handle" type="button" aria-label="Drag navigation section">${iconMarkup("grip")}</button>`;
      const section = (rows, position, shadow, hideOnScroll, body) => {
        const surface = template === "overlay" ? "transparent" : "solid";
        const opacity = surface === "transparent" ? 0 : 100;
        return `<header class="sq-page-block sq-store-nav sq-navigation-template-section" draggable="true" data-sq-block data-sq-fluid data-sq-rows="${rows}" data-section-id="${sectionId}" data-sq-nav-template="${template}" data-sq-nav-position="${position}" data-sq-nav-offset="0" data-sq-nav-surface="${surface}" data-sq-nav-opacity="${opacity}" data-sq-nav-blur="16" data-sq-nav-shadow="${shadow}" data-sq-nav-hide-scroll="${hideOnScroll}">${handle}${body}</header>`;
      };
      const mainLinks = [["Shop", "#products"], ["Our story", "#story"], ["Contact", "#contact"]];
      if (template === "centered") return section(2, "static", "false", "false", `${navigationLinksMarkup({ slot: "left", links: [["Shop", "#products"], ["Our story", "#story"]], button: "", layouts: { desktop: "1,1,4,2", tablet: "1,1,4,2", mobile: "1,1,1,1" } })}${navigationLogoMarkup({ desktop: "5,1,4,2", tablet: "5,1,4,2", mobile: "1,1,6,2" })}${navigationLinksMarkup({ slot: "right", links: [["Search", "#products"]], button: "Cart", layouts: { desktop: "9,1,4,2", tablet: "9,1,4,2", mobile: "7,1,6,2" } })}`);
      if (template === "announcement") return section(4, "sticky", "true", "true", `<p class="sq-nav-announcement-copy" data-sq-element data-sq-element-type="text" data-layout-desktop="1,1,12,1" data-layout-tablet="1,1,12,1" data-layout-mobile="1,1,12,1">Free shipping on orders over Rp500k</p>${navigationLogoMarkup({ desktop: "1,2,4,3", tablet: "1,2,4,3", mobile: "1,2,5,3" })}${navigationLinksMarkup({ links: mainLinks, layouts: { desktop: "5,2,8,3", tablet: "5,2,8,3", mobile: "6,2,7,3" } })}`);
      if (template === "overlay") return section(2, "sticky", "true", "false", `${navigationLogoMarkup({ desktop: "1,1,4,2", tablet: "1,1,4,2", mobile: "1,1,5,2" })}${navigationLinksMarkup({ links: mainLinks, layouts: { desktop: "5,1,8,2", tablet: "5,1,8,2", mobile: "6,1,7,2" } })}`);
      if (template === "commerce") return section(2, "sticky", "true", "false", `${navigationLogoMarkup({ desktop: "1,1,3,2", tablet: "1,1,3,2", mobile: "1,1,5,2" })}<div class="sq-nav-commerce-search" data-sq-element data-sq-element-type="form" data-layout-desktop="4,1,5,2" data-layout-tablet="4,1,5,2" data-layout-mobile="1,1,1,1"><form role="search"><input type="search" placeholder="Search products…" aria-label="Search products"><button type="button">Search</button></form></div>${navigationLinksMarkup({ links: [["Account", "#contact"]], button: "Cart", layouts: { desktop: "9,1,4,2", tablet: "9,1,4,2", mobile: "6,1,7,2" } })}`);
      if (template === "minimal") return section(2, "sticky", "true", "false", `${navigationLogoMarkup({ desktop: "1,1,6,2", tablet: "1,1,6,2", mobile: "1,1,6,2" })}${navigationLinksMarkup({ links: [], button: "Shop now", buttonAction: "#products", layouts: { desktop: "7,1,6,2", tablet: "7,1,6,2", mobile: "7,1,6,2" } })}`);
      return section(2, "sticky", "true", "false", `${navigationLogoMarkup({ desktop: "1,1,4,2", tablet: "1,1,4,2", mobile: "1,1,5,2" })}${navigationLinksMarkup({ links: mainLinks, layouts: { desktop: "5,1,8,2", tablet: "5,1,8,2", mobile: "6,1,7,2" } })}`);
    };
    const addNavigationTemplate = (template) => {
      const existing = previewRoot?.querySelector('[data-section-id="navigation"]') || previewRoot?.querySelector(".sq-navigation-template-section");
      const sectionId = existing?.dataset.sectionId || "navigation";
      const snapshot = captureState();
      const wrapper = document.createElement("div");
      wrapper.innerHTML = navigationTemplateMarkup(template, sectionId);
      const section = wrapper.firstElementChild;
      if (!section) return;
      if (existing) existing.replaceWith(section);
      else {
        const announcement = previewRoot?.querySelector('[data-section-id="announcement"]');
        if (announcement) announcement.after(section); else previewRoot?.prepend(section);
      }
      remember(snapshot);
      moveNavigationSectionToTop(section);
      applyNavigationSectionBehavior(section);
      rebuildLayerList();
      bindSqInteractions();
      applyFluidSection(section);
      setLibraryView("");
      openSqPanel("layers", { pin: true });
      selectSqSection(sectionId);
      const navigation = section.querySelector('[data-sq-nav-slot="right"]') || section.querySelector('[data-sq-element-type="navigation"]');
      if (navigation) selectSqElement(navigation);
      markSqChanged();
      section.scrollIntoView({ behavior: "smooth", block: "start" });
      showToast(`${template[0].toUpperCase() + template.slice(1)} navigation added — every element is editable`);
    };
    const createComponentInstanceElement = (component) => {
      const element = document.createElement("div");
      element.className = "sq-free-element sq-free-code sq-component-instance";
      element.dataset.sqElement = "";
      element.dataset.sqElementType = "component-instance";
      element.dataset.sqComponentId = component.id;
      element.dataset.sqComponentName = component.name;
      const frame = document.createElement("iframe");
      frame.title = `${component.name} component preview`;
      frame.setAttribute("sandbox", "allow-scripts allow-forms");
      frame.dataset.sqCodeRender = "";
      const source = document.createElement("template");
      source.dataset.sqCodeSource = "";
      source.innerHTML = component.code;
      element.append(frame, source);
      return element;
    };
    const addComponentInstance = (component, section, preferredLayout = null) => {
      if (!component || !section) return null;
      remember();
      ensureElementSection(section);
      removeElementOverlay();
      const element = createComponentInstanceElement(component);
      const dimensions = { width: 8, height: 8 };
      ["desktop", "tablet", "mobile"].forEach((device) => {
        const desired = device === "mobile" ? { ...dimensions, width: fluidColumns(device) } : dimensions;
        setElementLayout(element, findOpenElementLayout(section, desired, device), device);
      });
      if (preferredLayout) setElementLayout(element, preferredLayout, activeDevice);
      section.append(element);
      rebuildLayerList(); bindSqInteractions(); applyFluidSection(section); renderCodeElement(element);
      selectSqElement(element); syncInspectorContent(); openSqPanel("layers");
      element.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
      markSqChanged();
      showToast(`${component.name} instance added`);
      return element;
    };
    const dropLibraryElement = (section, event) => {
      if (!libraryDrag) return;
      const layout = libraryDropPreview?.dataset.layout?.split(",").map(Number);
      const preferredLayout = layout?.length === 4 ? { x: layout[0], y: layout[1], width: layout[2], height: layout[3] } : libraryPointerLayout(section, event);
      const dragged = libraryDrag;
      clearLibraryDropPreview();
      if (dragged.kind === "component") addComponentInstance(componentForId(dragged.componentId), section, preferredLayout);
      else addLibraryElement(dragged.type, section, preferredLayout);
      libraryDrag = null;
      layoutGridDragging = false;
      revealLayoutGrid(650);
      document.body.classList.remove("sq-library-dragging");
    };
    sqStudio.querySelectorAll("[data-sq-add-element]").forEach((button) => {
      button.draggable = true;
      button.addEventListener("dragstart", (event) => {
        const type = button.dataset.sqAddElement;
        libraryDrag = { kind: "element", type, label: button.querySelector("b")?.textContent.trim() || elementTypeName({ dataset: { sqElementType: type } }) };
        layoutGridDragging = true;
        refreshLayoutGrid();
        document.body.classList.add("sq-library-dragging");
        button.classList.add("sq-library-drag-source");
        event.dataTransfer.effectAllowed = "copy";
        event.dataTransfer.setData("application/x-ezkart-element", type);
        event.dataTransfer.setData("text/plain", libraryDrag.label);
      });
      button.addEventListener("dragend", () => {
        button.classList.remove("sq-library-drag-source");
        document.body.classList.remove("sq-library-dragging");
        clearLibraryDropPreview();
        libraryDrag = null;
        layoutGridDragging = false;
        revealLayoutGrid(650);
      });
      button.addEventListener("click", () => {
        const section = previewRoot?.querySelector(`[data-section-id="${selectedSection}"]`);
        addLibraryElement(button.dataset.sqAddElement, section);
      });
    });

    const addPanel = sqStudio.querySelector('[data-sq-panel="add"]');
    const libraryViews = [...sqStudio.querySelectorAll("[data-sq-library-view]")];
    const setLibraryView = (name = "") => {
      if (!addPanel) return;
      libraryViews.forEach((view) => { view.hidden = view.dataset.sqLibraryView !== name; });
      addPanel.classList.toggle("sq-library-view-open", Boolean(name));
      addPanel.scrollTo({ top: 0, behavior: "auto" });
      if (name) libraryViews.find((view) => view.dataset.sqLibraryView === name)?.querySelector("[data-sq-library-search]")?.focus({ preventScroll: true });
    };
    sqStudio.querySelectorAll("[data-sq-open-library]").forEach((button) => button.addEventListener("click", () => setLibraryView(button.dataset.sqOpenLibrary)));
    sqStudio.querySelectorAll("[data-sq-close-library]").forEach((button) => button.addEventListener("click", () => setLibraryView("")));
    const filterLibraryView = (view) => {
      const query = normalize(view.querySelector("[data-sq-library-search]")?.value || "");
      const activeFilter = view.querySelector("[data-sq-library-filter].active")?.dataset.sqLibraryFilter || "all";
      view.querySelectorAll("[data-sq-library-card]").forEach((card) => {
        const matchesQuery = !query || normalize(card.dataset.search).includes(query);
        const categories = String(card.dataset.category || "").split(/\s+/);
        const matchesFilter = activeFilter === "all" || categories.includes(activeFilter);
        card.hidden = !matchesQuery || !matchesFilter;
      });
    };
    libraryViews.forEach((view) => {
      view.querySelector("[data-sq-library-search]")?.addEventListener("input", () => filterLibraryView(view));
      view.querySelectorAll("[data-sq-library-filter]").forEach((button) => button.addEventListener("click", () => {
        view.querySelectorAll("[data-sq-library-filter]").forEach((item) => {
          const active = item === button;
          item.classList.toggle("active", active);
          item.setAttribute("aria-pressed", String(active));
        });
        filterLibraryView(view);
      }));
    });
    addPanel?.addEventListener("keydown", (event) => { if (event.key === "Escape" && addPanel.classList.contains("sq-library-view-open")) { event.stopPropagation(); setLibraryView(""); } });
    sqStudio.querySelectorAll("[data-sq-add-navigation-template]").forEach((button) => button.addEventListener("click", () => addNavigationTemplate(button.dataset.sqAddNavigationTemplate)));

    const componentDialog = document.querySelector("[data-sq-component-dialog]");
    const componentForm = componentDialog?.querySelector("[data-sq-component-form]");
    const componentNameInput = componentForm?.querySelector('[name="component_name"]');
    const componentDescriptionInput = componentForm?.querySelector('[name="component_description"]');
    const componentCodeInput = componentForm?.querySelector('[name="component_code"]');
    const componentError = componentForm?.querySelector("[data-sq-component-error]");
    const componentDeleteButton = componentForm?.querySelector("[data-sq-component-delete]");
    let editingComponentId = "";
    const starterComponentCode = [
      "<style>",
      "  .card { padding: 24px; color: #24262b; background: #ffffff; border: 1px solid #e7e2df; border-radius: 18px; font-family: system-ui, sans-serif; }",
      "  .card h2 { margin: 0 0 8px; font-size: 28px; }",
      "  .card p { margin: 0; color: #6f747c; line-height: 1.6; }",
      "</style>",
      "<article class=\"card\">",
      "  <h2>Reusable component</h2>",
      "  <p>Edit the main component once and every connected instance updates.</p>",
      "</article>",
    ].join("\n");
    const formatComponentBytes = (bytes) => bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(bytes >= 10240 ? 0 : 1)} KB`;
    const syncComponentBudget = () => {
      const bytes = componentBytes(componentCodeInput?.value || "");
      const size = componentForm?.querySelector("[data-sq-component-size]");
      const total = componentForm?.querySelector("[data-sq-component-total]");
      if (size) { size.textContent = formatComponentBytes(bytes); size.classList.toggle("over-limit", bytes > componentLimits.bytes); }
      if (total) total.textContent = String(readComponents().length);
    };
    const closeComponentEditor = () => componentDialog?.close();
    const openComponentEditor = (component = null) => {
      if (!componentDialog || !componentForm) return;
      editingComponentId = component?.id || "";
      componentNameInput.value = component?.name || "";
      componentDescriptionInput.value = component?.description || "";
      componentCodeInput.value = component?.code || starterComponentCode;
      if (componentError) { componentError.hidden = true; componentError.textContent = ""; }
      if (componentDeleteButton) componentDeleteButton.hidden = !component;
      const context = componentForm.querySelector("[data-sq-component-dialog-context]");
      const title = componentForm.querySelector("[data-sq-component-dialog-title]");
      if (context) context.textContent = component ? "Main component" : "Create component";
      if (title) title.textContent = component ? component.name : "New main component";
      syncComponentBudget();
      componentDialog.showModal();
      window.setTimeout(() => componentNameInput?.focus(), 40);
    };
    const renderComponentLibrary = () => {
      const components = readComponents();
      const list = sqStudio.querySelector("[data-sq-component-list]");
      const count = sqStudio.querySelector("[data-sq-component-count]");
      const empty = sqStudio.querySelector("[data-sq-component-empty]");
      const createButton = sqStudio.querySelector("[data-sq-create-component]");
      if (count) count.textContent = `${components.length} / ${componentLimits.count}`;
      if (empty) empty.hidden = components.length > 0;
      if (createButton) {
        createButton.disabled = components.length >= componentLimits.count;
        createButton.title = components.length >= componentLimits.count ? "Delete a component before creating another" : "Create component";
      }
      if (!list) return;
      list.innerHTML = components.map((component) => `<article class="sq-component-card" draggable="true" data-sq-component="${escapeHtml(component.id)}" data-search="${escapeHtml(`${component.name} ${component.description}`)}"><button type="button" data-sq-insert-component><span class="sq-component-mark">${escapeHtml(component.name.slice(0, 1).toUpperCase())}</span><span><b>${escapeHtml(component.name)}</b><small>${escapeHtml(component.description || "Drag an instance onto the canvas")}</small></span></button><button type="button" data-sq-edit-component aria-label="Edit ${escapeHtml(component.name)}">${iconMarkup("code")}</button></article>`).join("");
      list.querySelectorAll("[data-sq-component]").forEach((card) => {
        const component = componentForId(card.dataset.sqComponent);
        if (!component) return;
        card.querySelector("[data-sq-insert-component]")?.addEventListener("click", () => {
          const section = previewRoot?.querySelector(`[data-section-id="${selectedSection}"]`) || previewRoot?.querySelector("[data-sq-block]");
          addComponentInstance(component, section);
        });
        card.querySelector("[data-sq-edit-component]")?.addEventListener("click", () => openComponentEditor(component));
        card.addEventListener("dragstart", (event) => {
          libraryDrag = { kind: "component", componentId: component.id, label: component.name };
          layoutGridDragging = true;
          refreshLayoutGrid();
          document.body.classList.add("sq-library-dragging");
          card.classList.add("sq-library-drag-source");
          event.dataTransfer.effectAllowed = "copy";
          event.dataTransfer.setData("application/x-ezkart-component", component.id);
          event.dataTransfer.setData("text/plain", component.name);
        });
        card.addEventListener("dragend", () => {
          card.classList.remove("sq-library-drag-source");
          document.body.classList.remove("sq-library-dragging");
          clearLibraryDropPreview();
          libraryDrag = null;
          layoutGridDragging = false;
          revealLayoutGrid(650);
        });
      });
    };
    sqStudio.querySelector("[data-sq-create-component]")?.addEventListener("click", () => {
      if (readComponents().length >= componentLimits.count) { showToast("You can save up to 20 components. Delete one to create another."); return; }
      openComponentEditor();
    });
    componentDialog?.querySelectorAll("[data-sq-component-close]").forEach((button) => button.addEventListener("click", closeComponentEditor));
    componentCodeInput?.addEventListener("input", syncComponentBudget);
    componentForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const name = componentNameInput?.value.trim() || "";
      const description = componentDescriptionInput?.value.trim() || "";
      const code = componentCodeInput?.value || "";
      const bytes = componentBytes(code);
      const fail = (message) => { if (componentError) { componentError.textContent = message; componentError.hidden = false; } };
      if (!name) { fail("Give this main component a name."); componentNameInput?.focus(); return; }
      if (!code.trim()) { fail("Add HTML, CSS, or JavaScript before saving."); componentCodeInput?.focus(); return; }
      if (bytes > componentLimits.bytes) { fail(`This component is ${formatComponentBytes(bytes)}. The maximum is 200 KB.`); return; }
      if (!editingComponentId && readComponents().length >= componentLimits.count) { fail("This account already has 20 components. Delete one before creating another."); return; }
      const id = editingComponentId || `component-${Date.now().toString(36)}`;
      const saveButton = componentForm.querySelector("[data-sq-component-save]");
      if (saveButton) saveButton.disabled = true;
      try {
        const saved = await saveReusableComponent({ id, name, description, code });
        const instances = [...(previewRoot?.querySelectorAll(`[data-sq-element-type="component-instance"][data-sq-component-id="${CSS.escape(id)}"]`) || [])];
        if (instances.length) remember();
        instances.forEach((instance) => {
          instance.dataset.sqComponentName = saved.name;
          const source = instance.querySelector(":scope > [data-sq-code-source]");
          if (source) source.innerHTML = saved.code;
          renderCodeElement(instance);
        });
        if (instances.length) { rebuildLayerList(); bindSqInteractions(); markSqChanged(); }
        renderComponentLibrary();
        closeComponentEditor();
        showToast(editingComponentId ? "Main component updated everywhere" : "Component created — drag an instance onto the canvas");
      } catch (error) {
        fail(error instanceof Error ? error.message : "The component could not be saved.");
      } finally {
        if (saveButton) saveButton.disabled = false;
      }
    });
    componentDeleteButton?.addEventListener("click", async () => {
      const component = componentForId(editingComponentId);
      if (!component || !window.confirm(`Delete the main component “${component.name}”? Existing instances will be detached and keep their current appearance.`)) return;
      try {
        remember();
        previewRoot?.querySelectorAll(`[data-sq-element-type="component-instance"][data-sq-component-id="${CSS.escape(component.id)}"]`).forEach((instance) => {
          instance.dataset.sqElementType = "custom-code";
          delete instance.dataset.sqComponentId;
          delete instance.dataset.sqComponentName;
          instance.classList.remove("sq-component-instance");
        });
        await deleteReusableComponent(component.id);
        rebuildLayerList(); bindSqInteractions(); markSqChanged(); renderComponentLibrary(); closeComponentEditor();
        showToast("Main component deleted; its instances were detached");
      } catch (error) { if (componentError) { componentError.textContent = error instanceof Error ? error.message : "The component could not be deleted."; componentError.hidden = false; } }
    });
    sqStudio.querySelector("[data-sq-edit-main-component]")?.addEventListener("click", () => {
      const component = componentForId(selectedElement?.dataset.sqComponentId);
      if (component) openComponentEditor(component); else showToast("This main component is no longer available. Detach the instance to edit its code.");
    });
    sqStudio.querySelector("[data-sq-detach-instance]")?.addEventListener("click", () => {
      if (!selectedElement?.matches('[data-sq-element-type="component-instance"]')) return;
      remember();
      selectedElement.dataset.sqElementType = "custom-code";
      delete selectedElement.dataset.sqComponentId;
      delete selectedElement.dataset.sqComponentName;
      selectedElement.classList.remove("sq-component-instance");
      rebuildLayerList(); bindSqInteractions(); syncInspectorContent(); markSqChanged();
      showToast("Instance detached — its code can now be edited independently");
    });
    renderComponentLibrary();
    sqStudio.querySelectorAll("[data-sq-add-block]").forEach((button) => button.addEventListener("click", () => {
      remember();
      const type = button.dataset.sqAddBlock;
      const sectionId = `${type}-${Date.now()}`;
      const wrapper = document.createElement("div"); wrapper.innerHTML = newBlockMarkup(type, sectionId);
      const newBlock = wrapper.firstElementChild;
      const selectedBlock = previewRoot?.querySelector(`[data-section-id="${selectedSection}"]`);
      selectedBlock?.after(newBlock);
      rebuildLayerList(); bindSqInteractions(); updateProductView(); selectSqSection(sectionId); openSqPanel("layers"); newBlock?.scrollIntoView({ behavior: "smooth", block: "center" }); markSqChanged();
    }));
    sqStudio.querySelector("[data-sq-block-search]")?.addEventListener("input", (event) => {
      const query = normalize(event.currentTarget.value);
      sqStudio.querySelectorAll("[data-sq-add-block], [data-sq-add-element], [data-sq-open-library], [data-sq-component]").forEach((button) => { button.hidden = Boolean(query) && !normalize(button.dataset.search).includes(query); });
    });

    sqStudio.querySelector("[data-sq-duplicate]")?.addEventListener("click", () => {
      const block = previewRoot?.querySelector(`[data-section-id="${selectedSection}"]`); if (!block) return;
      remember(); const newId = `${selectedSection}-copy-${Date.now()}`; const blockCopy = block.cloneNode(true); blockCopy.querySelectorAll(".sq-section-toolbar, .sq-element-overlay, .sq-section-height-handle").forEach((node) => node.remove()); blockCopy.dataset.sectionId = newId; blockCopy.classList.remove("selected"); blockCopy.querySelectorAll("[data-sq-element-id]").forEach((element, index) => { element.dataset.sqElementId = `element-${newId}-${index + 1}`; }); block.after(blockCopy); rebuildLayerList(); bindSqInteractions(); selectSqSection(newId, true); markSqChanged();
    });
    sqStudio.querySelector("[data-sq-visibility]")?.addEventListener("click", () => {
      const block = previewRoot?.querySelector(`[data-section-id="${selectedSection}"]`); if (!block) return;
      remember(); const hidden = !block.classList.contains("section-hidden"); block.classList.toggle("section-hidden", hidden); rebuildLayerList(); bindSqInteractions(); selectSqSection(selectedSection); markSqChanged();
    });
    const deleteSelectedSection = () => {
      if ((previewRoot?.querySelectorAll("[data-sq-block]").length || 0) <= 1) { showToast("A page needs at least one section"); return; }
      const block = previewRoot?.querySelector(`[data-section-id="${selectedSection}"]`); const group = layerList?.querySelector(`[data-sq-layer-group][data-section-id="${selectedSection}"]`); if (!block || !group) return;
      remember(); const next = group.nextElementSibling?.dataset.sectionId || group.previousElementSibling?.dataset.sectionId; selectedElement = null; selectedAction = null; selectedImage = null; selectedContent = null; block.remove(); rebuildLayerList(); bindSqInteractions(); if (next) selectSqSection(next, true); markSqChanged(); showToast("Section deleted — use Undo to restore it");
    };
    sqStudio.querySelector("[data-sq-delete]")?.addEventListener("click", deleteSelectedSection);

    const zoomSlider = sqStudio.querySelector("[data-sq-zoom-slider]");
    const pageHeightHandle = sqStudio.querySelector("[data-sq-page-height-handle]");
    const setZoom = (value) => {
      const minimum = Number(zoomSlider?.min || 40);
      zoom = Math.max(minimum, Math.min(100, Math.round(Number(value) || 100)));
      deviceFrame?.classList.remove("zoom-60", "zoom-70", "zoom-80", "zoom-90");
      if (deviceFrame) deviceFrame.style.zoom = zoom === 100 ? "" : String(zoom / 100);
      sqStudio.querySelectorAll("[data-sq-zoom]").forEach((output) => { output.textContent = `${zoom}%`; });
      if (zoomSlider) {
        zoomSlider.value = String(zoom);
        zoomSlider.style.setProperty("--sq-range-progress", `${((zoom - minimum) / (100 - minimum)) * 100}%`);
      }
      scheduleEditorNavigation();
    };
    sqStudio.querySelector("[data-sq-zoom-out]")?.addEventListener("click", () => setZoom(zoom - 10));
    sqStudio.querySelector("[data-sq-zoom-in]")?.addEventListener("click", () => setZoom(zoom + 10));
    zoomSlider?.addEventListener("input", () => setZoom(zoomSlider.value));
    sqStudio.querySelector("[data-sq-fit]")?.addEventListener("click", () => setZoom(fitZoomForDevice(activeDevice)));
    const setExtraPageHeight = (value) => {
      if (!previewRoot) return 0;
      const next = Math.max(0, Math.min(6000, Math.round(Number(value) || 0)));
      if (next > 0) previewRoot.style.setProperty("--sq-page-extra-height", `${next}px`);
      else previewRoot.style.removeProperty("--sq-page-extra-height");
      pageHeightHandle?.classList.toggle("has-extension", next > 0);
      pageHeightHandle?.setAttribute("aria-valuenow", String(next));
      pageHeightHandle?.setAttribute("aria-valuetext", next > 0 ? `${next} pixels of extra page height` : "Minimum page height");
      return next;
    };
    pageHeightHandle?.addEventListener("pointerdown", (event) => {
      if (!previewRoot) return;
      event.preventDefault();
      const snapshot = captureState();
      const startY = event.clientY;
      const startHeight = Number.parseFloat(previewRoot.style.getPropertyValue("--sq-page-extra-height")) || 0;
      let currentHeight = startHeight;
      pageHeightHandle.classList.add("dragging");
      document.body.classList.add("sq-page-height-resizing");
      const move = (pointerEvent) => {
        currentHeight = setExtraPageHeight(startHeight + (pointerEvent.clientY - startY) / Math.max(.4, zoom / 100));
      };
      const end = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", end);
        window.removeEventListener("pointercancel", end);
        pageHeightHandle.classList.remove("dragging");
        document.body.classList.remove("sq-page-height-resizing");
        if (currentHeight !== startHeight) { remember(snapshot); markSqChanged(); }
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", end, { once: true });
      window.addEventListener("pointercancel", end, { once: true });
    });
    pageHeightHandle?.addEventListener("keydown", (event) => {
      if (!["ArrowUp", "ArrowDown"].includes(event.key) || !previewRoot) return;
      event.preventDefault();
      const snapshot = captureState();
      const current = Number.parseFloat(previewRoot.style.getPropertyValue("--sq-page-extra-height")) || 0;
      setExtraPageHeight(current + (event.key === "ArrowDown" ? 40 : -40));
      remember(snapshot); markSqChanged();
    });
    setExtraPageHeight(Number.parseFloat(previewRoot?.style.getPropertyValue("--sq-page-extra-height")) || 0);
    sqStudio.querySelector("[data-sq-close-inspector]")?.addEventListener("click", () => { inspector?.classList.add("collapsed"); sqStudio.classList.add("inspector-closed"); });
    const livePreviewDialog = document.getElementById("landing-preview-dialog");
    const livePreviewFrame = livePreviewDialog?.querySelector("[data-sq-live-preview-frame]");
    const livePreviewStage = livePreviewDialog?.querySelector("[data-sq-live-preview-stage]");
    const setLivePreviewDevice = (device) => {
      if (!livePreviewStage || !["desktop", "tablet", "mobile"].includes(device)) return;
      livePreviewStage.dataset.previewDevice = device;
      livePreviewDialog.querySelectorAll("[data-sq-preview-device]").forEach((button) => button.classList.toggle("active", button.dataset.sqPreviewDevice === device));
    };
    livePreviewDialog?.querySelectorAll("[data-sq-preview-device]").forEach((button) => button.addEventListener("click", () => setLivePreviewDevice(button.dataset.sqPreviewDevice)));
    livePreviewDialog?.querySelector("[data-sq-preview-close]")?.addEventListener("click", () => livePreviewDialog.close());
    livePreviewDialog?.addEventListener("click", (event) => { if (event.target === livePreviewDialog) livePreviewDialog.close(); });
    livePreviewDialog?.querySelector("[data-sq-preview-new-tab]")?.addEventListener("click", () => {
      const url = URL.createObjectURL(new Blob([generateHtml()], { type: "text/html" }));
      window.open(url, "_blank", "noopener");
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    });
    sqStudio.querySelector("[data-sq-preview]")?.addEventListener("click", () => {
      if (!livePreviewDialog || !livePreviewFrame) return;
      const title = livePreviewDialog.querySelector("[data-sq-preview-title]");
      if (title) title.textContent = document.querySelector("[data-current-site-name]")?.textContent || "Landing page";
      const html = generateHtml();
      setLivePreviewDevice(activeDevice);
      livePreviewDialog.showModal();
      requestAnimationFrame(() => {
        livePreviewFrame.onload = () => {
          livePreviewFrame.onload = null;
          livePreviewFrame.contentWindow?.postMessage({ type: "ezkart-render-page", html }, "*");
        };
        livePreviewFrame.src = `page-preview.php?render=${Date.now()}`;
      });
    });
    document.addEventListener("keydown", (event) => {
      if (event.target.closest("input,textarea,select,[contenteditable=true]")) return;
      if (event.key === "Escape" && selectedElement?.isConnected) {
        selectSqSection(selectedSection, true);
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); if (selectedElement?.isConnected) deleteSelectedElement(); else deleteSelectedSection(); return; }
      if (!selectedElement?.isConnected) return;
      if (selectedElement.matches(".sq-page-background,.sq-section-background")) return;
      const movements = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (!movements[event.key]) return;
      event.preventDefault();
      remember();
      const layout = parseElementLayout(selectedElement);
      const [x, y] = movements[event.key];
      setElementLayout(selectedElement, { ...layout, x: layout.x + x, y: layout.y + y });
      applyFluidSection(selectedElement.closest("[data-sq-fluid]"));
      syncElementControls();
      refreshElementOverlay();
      markSqChanged();
    });

    const exportDialog = document.getElementById("html-export-dialog");
    const collectExportCss = () => {
      const tokens = [".sq-page-preview", ".sq-page-block", ".sq-page-background", ".sq-section-background", ".sq-announcement", ".sq-store-nav", ".sq-site-logo", ".sq-navigation-template", ".sq-nav-", ".sq-hero", ".sq-product", ".sq-image-story", ".sq-image-blend", ".sq-image-crop", ".sq-benefit", ".sq-cart", ".sq-shipping", ".sq-generated", ".sq-free", ".sq-marquee", ".sq-surface", ".sq-color", ".element-animation", ".hover-", ".button-", ".ez-fluid", "@keyframes sq", "@keyframes element", ".product-art", ".icon", ".svg-sprite"];
      const collect = (rules) => [...rules].map((rule) => {
        if (rule.type === CSSRule.KEYFRAMES_RULE) return tokens.some((token) => rule.cssText.includes(token)) ? rule.cssText : "";
        if (rule.cssRules && !rule.selectorText) { const nested = collect(rule.cssRules); return nested ? `${rule.conditionText ? `@media ${rule.conditionText}` : rule.cssText.slice(0, rule.cssText.indexOf("{"))}{${nested}}` : ""; }
        return tokens.some((token) => rule.cssText.includes(token)) ? rule.cssText : "";
      }).join("\n");
      return [...document.styleSheets].map((sheet) => { try { return collect(sheet.cssRules); } catch (_) { return ""; } }).join("\n");
    };
    const generateHtml = ({ libraryPreview = false } = {}) => {
      const clone = previewRoot.cloneNode(true);
      clone.querySelectorAll('[data-sq-background-type="solid"]').forEach((section) => {
        section.querySelector(":scope > .sq-section-background")?.remove();
      });
      clone.querySelectorAll("img[data-sq-image-blend-mode],img[data-sq-image-blend-source],img[data-sq-image-blend-color]").forEach(applyImageBlend);
      clone.querySelectorAll("img[data-sq-image-crop-zoom],img[data-sq-image-crop-x],img[data-sq-image-crop-y]").forEach(applyImageCrop);
      clone.querySelectorAll("img[data-sq-filter-opacity]").forEach(applySelectedImageFilters);
      clone.querySelectorAll(".sq-free-code").forEach((element) => {
        const source = element.querySelector("template[data-sq-code-source]")?.innerHTML || "";
        const content = document.createElement("template"); content.innerHTML = source; element.replaceChildren(content.content.cloneNode(true));
      });
      clone.querySelectorAll('.sq-free-marquee[data-sq-element-type="marquee"]').forEach((element) => {
        element.dataset.ezkartMarqueeMode = element.dataset.sqMarqueeMode === "scroll" ? "scroll" : "auto";
        element.dataset.ezkartMarqueeSpeed = String(marqueeSpeed(element));
        element.classList.toggle("sq-marquee-manual", element.dataset.ezkartMarqueeMode === "scroll");
      });
      clone.querySelectorAll("img[data-sq-image-scroll]").forEach((image) => {
        const effect = image.dataset.sqImageScroll === "parallax-deep" ? "parallax" : image.dataset.sqImageScroll || "none";
        const storedStrength = Number(image.dataset.sqImageScrollStrength);
        const strength = Math.max(0, Math.min(100, Number.isFinite(storedStrength) ? storedStrength : 50));
        const parent = image.parentElement;
        const imageItem = image.closest("[data-sq-image-item]");
        const host = parent?.classList.contains("product-art") ? parent : (imageItem && imageItem !== image ? imageItem : parent);
        image.classList.remove("jarallax-img", "ezkart-scroll-media", "sq-image-scroll-media");
        if (host) {
          host.classList.remove("sq-image-scroll-host", "jarallax", "ezkart-scroll-frame");
          host.removeAttribute("data-jarallax");
          host.removeAttribute("data-speed");
          host.removeAttribute("data-type");
          host.removeAttribute("data-ezkart-scroll-effect");
          host.removeAttribute("data-ezkart-scroll-strength");
          host.removeAttribute("data-ezkart-scroll-damping");
        }
        if (effect !== "none" && host) {
          host.classList.add("ezkart-scroll-frame");
          host.dataset.ezkartScrollEffect = effect;
          host.dataset.ezkartScrollStrength = String(strength);
          host.dataset.ezkartScrollDamping = image.dataset.sqImageScrollDamping === "false" ? "false" : "true";
          image.classList.add("ezkart-scroll-media");
        }
        image.style.removeProperty("transform");
        image.style.removeProperty("transform-origin");
        image.style.removeProperty("will-change");
        image.style.removeProperty("--sq-image-scroll-media-height");
        image.style.removeProperty("--sq-image-scroll-scale");
      });
      clone.querySelectorAll(".sq-block-handle, .sq-image-drag-handle, .sq-element-overlay, .sq-section-toolbar, .sq-layout-grid-overlay, .sq-section-height-handle, .section-hidden, .sq-element-hidden").forEach((node) => node.remove());
      clone.querySelectorAll(".sq-image-crop-editing, .sq-direct-draggable, .sq-direct-dragging, .sq-page-background.sq-element-selected, .sq-section-background.sq-element-selected").forEach((node) => node.classList.remove("sq-image-crop-editing", "is-cropping", "sq-direct-draggable", "sq-direct-dragging", "sq-element-selected"));
      clone.querySelectorAll("[data-product-card][hidden], [data-product-line][hidden], .sq-hero-collage > span[hidden]").forEach((node) => node.remove());
      clone.querySelectorAll("[data-sq-nav-position]").forEach((node) => {
        node.classList.remove("sq-nav-is-stuck", "sq-nav-hidden");
        node.style.removeProperty("--sq-nav-editor-shift");
        node.dataset.ezkartNavTemplate = node.dataset.sqNavTemplate || "essential";
        node.dataset.ezkartNavPosition = node.dataset.sqNavPosition || "static";
        node.dataset.ezkartNavOffset = node.dataset.sqNavOffset || "0";
        node.dataset.ezkartNavSurface = node.dataset.sqNavSurface || (node.dataset.sqNavTemplate === "overlay" ? "transparent" : "solid");
        node.dataset.ezkartNavOpacity = node.dataset.sqNavOpacity || (node.dataset.ezkartNavSurface === "transparent" ? "0" : "100");
        node.dataset.ezkartNavBlur = node.dataset.sqNavBlur || "16";
        node.dataset.ezkartNavHideScroll = node.dataset.sqNavHideScroll || "false";
        node.dataset.ezkartNavShadow = node.dataset.sqNavShadow || "true";
      });
      clone.querySelectorAll("[data-sq-nav-slot]").forEach((node) => { node.dataset.ezkartNavSlot = node.dataset.sqNavSlot; });
      clone.querySelectorAll("[data-section-id]").forEach((node) => { node.dataset.ezkartSection = node.dataset.sectionId; });
      clone.querySelectorAll("[draggable], [contenteditable], [data-sq-block], [data-section-id]").forEach((node) => { node.removeAttribute("draggable"); node.removeAttribute("contenteditable"); node.removeAttribute("data-sq-block"); node.removeAttribute("data-section-id"); node.classList.remove("selected", "dragging", "drag-over", "animating"); });
      clone.querySelectorAll("[data-sq-image-list], [data-sq-image-item]").forEach((node) => { node.removeAttribute("data-sq-image-list"); node.removeAttribute("data-sq-image-item"); node.removeAttribute("tabindex"); node.classList.remove("sq-image-selected", "sq-image-dragging", "sq-image-drop-target"); });
      clone.querySelectorAll("[data-sq-editable], [data-sq-content]").forEach((node) => { node.removeAttribute("data-sq-editable"); node.removeAttribute("data-sq-content"); });
      clone.querySelectorAll(".sq-navigation-template-section").forEach((section) => {
        const menu = section.querySelector(":scope > .sq-nav-mobile-menu");
        if (!menu) return;
        const links = [...section.querySelectorAll(':scope > [data-sq-element-type="navigation"] > a')];
        menu.replaceChildren(...links.map((link) => link.cloneNode(true)));
        menu.hidden = true;
        section.classList.remove("sq-nav-menu-open");
        const toggle = section.querySelector(".sq-nav-menu-toggle");
        if (toggle) { toggle.setAttribute("aria-expanded", "false"); toggle.setAttribute("aria-label", "Open navigation menu"); }
      });
      clone.querySelectorAll('.sq-store-nav [data-sq-element-type="navigation"] > button').forEach((action) => {
        if (action.dataset.sqLinkType) return;
        const type = inferredActionType(action);
        action.dataset.sqLinkType = type;
        action.dataset.sqLink = inferredActionTarget(action, type);
        action.dataset.sqNewTab = "false";
      });
      clone.querySelectorAll("[data-sq-link-type]").forEach((action) => {
        let type = action.dataset.sqLinkType || "none";
        const target = safeActionTarget(type, action.dataset.sqLink || "");
        if (!["checkout", "none"].includes(type) && !target) type = "none";
        const newTab = action.dataset.sqNewTab === "true";
        let href = "";
        if (type === "section") href = `#${target.replace(/^#/, "") || "products"}`;
        if (type === "url") href = target;
        if (type === "email") href = `mailto:${target}`;
        if (type === "phone") href = `tel:${target}`;
        if (action.matches("a")) {
          if (href) action.setAttribute("href", href); else action.removeAttribute("href");
          if (newTab && type === "url") { action.target = "_blank"; action.rel = "noopener"; }
        } else {
          action.dataset.ezkartAction = type;
          action.dataset.ezkartTarget = target;
          action.dataset.ezkartNewTab = String(newTab);
        }
        delete action.dataset.sqLinkType; delete action.dataset.sqLink; delete action.dataset.sqNewTab;
      });
      clone.querySelectorAll("[data-sq-fluid]").forEach((node) => { node.classList.add("ez-fluid-section"); node.style.removeProperty("--sq-fluid-row-height"); node.style.removeProperty("--sq-fluid-columns"); node.style.removeProperty("--sq-fluid-rows"); node.removeAttribute("data-sq-fluid"); node.removeAttribute("data-sq-rows"); node.removeAttribute("data-sq-min-rows"); });
      clone.querySelectorAll("[data-sq-element]").forEach((node) => {
        const hover = node.dataset.sqHover;
        if (hover && hover !== "none") node.classList.add(`hover-${hover}`);
        node.classList.add("ez-fluid-element");
        node.dataset.ezkartElement = node.dataset.sqElementId;
        ["sqElement", "sqElementId", "sqElementType", "sqElementAnimation", "sqHover", "sqSurface", "sqAlign", "sqButtonRole", "layoutDesktop", "layoutTablet", "layoutMobile"].forEach((key) => delete node.dataset[key]);
        node.classList.remove("sq-element-selected", "sq-element-animate");
      });
      clone.querySelectorAll("img[src]").forEach((image) => { image.src = new URL(image.getAttribute("src"), window.location.href).href; });
      const brandElement = clone.querySelector(".sq-site-logo");
      const brandImage = brandElement?.querySelector("img[src]:not([hidden])");
      const brandText = brandElement?.querySelector("b")?.textContent.trim();
      const checkoutBrand = {
        name: (brandText || brandImage?.getAttribute("alt") || document.querySelector("[data-current-site-name]")?.textContent || "Store").trim().slice(0, 80),
        logo: brandImage?.getAttribute("src") || "",
      };
      clone.querySelectorAll("[data-product-card]").forEach((card) => { const button = card.querySelector("footer button"); if (button) { button.dataset.ezkartAdd = card.dataset.productCard; button.type = "button"; } });
      clone.querySelectorAll(".sq-cart-section aside>button").forEach((checkout) => { checkout.dataset.ezkartCheckout = ""; });
      clone.querySelectorAll("[data-sq-basket-lines]").forEach((basket) => { basket.dataset.ezkartBasketLines = ""; });
      clone.querySelectorAll("[data-sq-basket-total]").forEach((total) => { total.dataset.ezkartBasketTotal = ""; });
      [clone, ...clone.querySelectorAll("*")].forEach((node) => [...node.attributes].forEach((attribute) => { if (attribute.name.startsWith("data-sq-")) node.removeAttribute(attribute.name); }));
      let pinnedNavigationHtml = "";
      const pinnedNavigation = clone.querySelector(':scope > .sq-navigation-template-section:is([data-ezkart-nav-position="sticky"],[data-ezkart-nav-position="fixed"])');
      if (pinnedNavigation) {
        clone.classList.add("sq-has-pinned-navigation");
        if (pinnedNavigation.dataset.ezkartNavTemplate === "announcement") clone.classList.add("sq-has-announcement-navigation");
        if (pinnedNavigation.dataset.ezkartNavTemplate === "overlay") clone.classList.add("sq-has-overlay-navigation");
        const pageStyle = getComputedStyle(previewRoot);
        const customProperties = new Set(Array.from(pageStyle).filter((property) => property.startsWith("--")));
        ["--site-accent", "--site-ink", "--site-page", "--site-surface", "--page-radius", "--button-primary-bg", "--button-primary-fg", "--button-primary-border", "--button-primary-border-width", "--button-primary-radius", "--button-primary-shadow"].forEach((property) => customProperties.add(property));
        customProperties.forEach((property) => {
          const value = pageStyle.getPropertyValue(property).trim();
          if (value) pinnedNavigation.style.setProperty(property, value);
        });
        pinnedNavigation.remove();
        pinnedNavigationHtml = pinnedNavigation.outerHTML;
      }
      const pageName = document.querySelector("[data-current-site-name]")?.textContent || "Ezkart Landing Page";
      const sprite = document.querySelector(".svg-sprite")?.outerHTML || "";
      const css = `${collectExportCss()}\nhtml{scrollbar-width:none}html::-webkit-scrollbar{width:0;height:0}.sq-page-block,.sq-page-block:hover{outline-color:transparent!important}`;
      const singleLineDesktopHeadings = new Set([...previewRoot.querySelectorAll('[data-sq-element-type="heading"]')].filter((element) => {
        const text = element.matches("h1,h2,h3") ? element : element.querySelector("h1,h2,h3") || element;
        if (!text.textContent.trim()) return false;
        const range = document.createRange();
        range.selectNodeContents(text);
        const lineTops = new Set([...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0).map((rect) => Math.round(rect.top)));
        return lineTops.size <= 1;
      }).map((element) => element.dataset.sqElementId));
      const spacingCssFor = (device) => [...spacingState.entries()].filter(([key]) => key.endsWith(`:${device}`)).map(([key, value]) => { const section = key.slice(0, -(device.length + 1)); return `[data-ezkart-section="${section}"]{padding:${value.top}px ${value.right}px ${value.bottom}px ${value.left}px!important}`; }).join("\n");
      const fluidCssFor = (device) => [...previewRoot.querySelectorAll("[data-sq-fluid]")].map((section) => { const spacing = readSpacing(section.dataset.sectionId, device); return `[data-ezkart-section="${section.dataset.sectionId}"]{--sq-fluid-row-height:${fluidRowHeight(section, device)}px;--sq-fluid-columns:${fluidColumns(device)};--sq-fluid-rows:${Math.max(fluidMinRows(section, device), sectionContentRows(section, device))};--sq-section-pad-left:${spacing.left}px;--sq-section-pad-right:${spacing.right}px}`; }).join("\n");
      const elementCssFor = (device) => [...previewRoot.querySelectorAll("[data-sq-element]")].map((element) => { const layout = parseElementLayout(element, device); const inset = elementInsetFor(element, device); const padding = element.classList.contains("sq-custom-inset") ? `padding:${inset.top}px ${inset.right}px ${inset.bottom}px ${inset.left}px!important;` : ""; const headingWrap = singleLineDesktopHeadings.has(element.dataset.sqElementId) ? `white-space:${device === "desktop" ? "nowrap" : "normal"}!important;` : ""; return `[data-ezkart-element="${element.dataset.sqElementId}"]{grid-column:${layout.x}/span ${layout.width}!important;grid-row:${layout.y}/span ${layout.height}!important;${padding}${headingWrap}}`; }).join("\n");
      const productCssFor = (device) => [...previewRoot.querySelectorAll('[data-sq-element-type="product-grid"]')].map((element) => {
        const settings = productGridSettings(element, device);
        const density = { compact: ["150px", "clamp(96px,58cqw,175px)", "11px", "none"], balanced: ["220px", "clamp(120px,62cqw,250px)", "18px", "block"], showcase: ["310px", "clamp(180px,70cqw,360px)", "18px", "block"] }[settings.density] || ["220px", "clamp(120px,62cqw,250px)", "18px", "block"];
        const columns = settings.columns === "auto" ? `repeat(auto-fit,minmax(min(100%,${density[0]}),1fr))` : `repeat(${settings.columns},minmax(0,1fr))`;
        const id = `[data-ezkart-element="${element.dataset.sqElementId}"]`;
        return `${id}{grid-template-columns:${columns}!important}${id}>article>.product-art{height:auto!important;aspect-ratio:1/1!important}${id}>article>div{padding:${density[2]}!important}${id} p{display:${density[3]}}`;
      }).join("\n");
      const responsiveSpacing = `${spacingCssFor("desktop")}\n${fluidCssFor("desktop")}\n${elementCssFor("desktop")}\n${productCssFor("desktop")}\n@media(max-width:900px){${spacingCssFor("tablet")}\n${fluidCssFor("tablet")}\n${elementCssFor("tablet")}\n${productCssFor("tablet")}}\n@media(max-width:600px){${spacingCssFor("mobile")}\n${fluidCssFor("mobile")}\n${elementCssFor("mobile")}\n${productCssFor("mobile")}}`;
      const storefrontCatalog = Object.fromEntries(selectedProducts().map((id) => {
        const card = clone.querySelector(`[data-product-card="${CSS.escape(id)}"]`);
        const baseImage = card?.querySelector(".product-art img")?.getAttribute("src") || "";
        return [id, {
          name: productNames[id] || card?.querySelector("h3")?.textContent.trim() || id,
          price: Math.max(0, Number(productPrices[id]) || 0),
          stock: productMeta[id]?.type === "physical" ? Math.max(0, Number(productMeta[id]?.stock) || 0) : null,
          image: baseImage,
          variants: (Array.isArray(productMeta[id]?.variants) ? productMeta[id].variants : []).filter((variant) => !variant.hidden).map((variant) => ({
            id: variant.id,
            name: variant.name,
            price: Math.max(0, Number(variant.price) || 0),
            stock: productMeta[id]?.type === "physical" ? Math.max(0, Number(variant.stock) || 0) : null,
            image: variant.image || baseImage,
            options: Array.isArray(variant.options) ? variant.options : [],
          })),
        }];
      }));
      const catalogJson = JSON.stringify(storefrontCatalog).replace(/</g, "\\u003c");
      const brandJson = JSON.stringify(checkoutBrand).replace(/</g, "\\u003c");
      const commerceStyles = `<style>
body.ezkart-cart-open{overflow:hidden}.ezkart-cart-trigger{min-height:44px;padding:0 14px;position:fixed;z-index:2147483000;right:20px;bottom:20px;display:flex;align-items:center;gap:9px;color:var(--button-primary-fg,#fff);background:var(--button-primary-bg,var(--site-ink,#17191e));border:var(--button-primary-border-width,0) solid var(--button-primary-border,transparent);border-radius:var(--button-primary-radius,12px);box-shadow:0 12px 35px rgba(10,14,22,.24);cursor:pointer;font:600 13px Poppins,Arial,sans-serif}.ezkart-cart-count{min-width:22px;height:22px;padding:0 6px;display:inline-grid;place-items:center;color:var(--site-ink,#17191e);background:#fff;border-radius:999px;font-size:11px;font-weight:700;line-height:1}.ezkart-cart-layer{position:fixed;z-index:2147483001;inset:0}.ezkart-cart-layer[hidden]{display:none}.ezkart-cart-backdrop{width:100%;height:100%;padding:0;position:absolute;inset:0;background:rgba(10,14,22,.46);border:0;opacity:0;transition:opacity .2s ease}.ezkart-cart-drawer{width:min(440px,100%);height:100%;padding:0;position:absolute;right:0;top:0;display:grid;grid-template-rows:auto minmax(0,1fr) auto;color:#17191e;background:#fff;box-shadow:-24px 0 70px rgba(10,14,22,.2);outline:0;transform:translateX(100%);transition:transform .24s cubic-bezier(.2,.75,.2,1)}.ezkart-cart-layer.is-open .ezkart-cart-backdrop{opacity:1}.ezkart-cart-layer.is-open .ezkart-cart-drawer{transform:none}.ezkart-cart-head{padding:24px 24px 18px;display:flex;align-items:flex-start;justify-content:space-between;gap:20px;border-bottom:1px solid #e7e8ea}.ezkart-cart-head small{display:block;margin-bottom:5px;color:#777e87;font-size:11px}.ezkart-cart-head h2{margin:0;font-size:24px;letter-spacing:-.035em}.ezkart-cart-close{width:40px;height:40px;padding:0;display:grid;place-items:center;background:#f2f3f4;border:0;border-radius:10px;cursor:pointer;font-size:22px}.ezkart-cart-items{padding:8px 24px;overflow:auto}.ezkart-cart-empty{min-height:260px;padding:50px 20px;display:grid;place-content:center;text-align:center}.ezkart-cart-empty b{font-size:16px}.ezkart-cart-empty p{max-width:270px;margin:7px auto 0;color:#747b84;font-size:12px;line-height:1.6}.ezkart-cart-row{padding:17px 0;display:grid;grid-template-columns:58px minmax(0,1fr) auto;align-items:center;gap:13px;border-bottom:1px solid #eceeef}.ezkart-cart-row img,.ezkart-cart-thumb{width:58px;height:66px;display:block;object-fit:cover;background:#f0f1f2;border-radius:9px}.ezkart-cart-thumb{display:grid;place-items:center;color:#8a9098;font-weight:700}.ezkart-cart-row h3{margin:0 0 4px;font-size:13px;line-height:1.35}.ezkart-cart-row p{margin:0;color:#747b84;font-size:11px}.ezkart-cart-quantity{margin-top:10px;display:flex;align-items:center;width:max-content;border:1px solid #dfe2e5;border-radius:8px;overflow:hidden}.ezkart-cart-quantity button{width:30px;height:30px;padding:0;background:#fff;border:0;cursor:pointer;font-size:16px}.ezkart-cart-quantity span{min-width:28px;text-align:center;font-size:11px;font-weight:600}.ezkart-cart-row>strong{align-self:start;padding-top:2px;font-size:12px;white-space:nowrap}.ezkart-cart-foot{padding:18px 24px 24px;border-top:1px solid #e3e5e7;background:#fff}.ezkart-cart-subtotal{margin-bottom:15px;display:flex;align-items:baseline;justify-content:space-between;gap:16px}.ezkart-cart-subtotal span{font-size:12px}.ezkart-cart-subtotal strong{font-size:20px}.ezkart-cart-checkout{width:100%;min-height:48px;padding:0 18px;color:var(--button-primary-fg,#fff);background:var(--button-primary-bg,var(--site-ink,#17191e));border:var(--button-primary-border-width,0) solid var(--button-primary-border,transparent);border-radius:var(--button-primary-radius,10px);cursor:pointer;font:600 13px Poppins,Arial,sans-serif}.ezkart-cart-checkout:disabled{cursor:not-allowed;opacity:.38}.ezkart-cart-foot small{margin-top:10px;display:block;color:#747b84;text-align:center;font-size:10px}.ezkart-basket-empty{justify-content:center!important;color:#777e87}.ezkart-cart-bump{animation:ezkart-cart-bump .24s ease}@keyframes ezkart-cart-bump{50%{transform:scale(1.18)}}@media(max-width:600px){.ezkart-cart-trigger{right:14px;bottom:14px}.ezkart-cart-head{padding:20px 18px 16px}.ezkart-cart-items{padding-inline:18px}.ezkart-cart-foot{padding:16px 18px 20px}.ezkart-cart-row{grid-template-columns:52px minmax(0,1fr)}.ezkart-cart-row img,.ezkart-cart-thumb{width:52px;height:60px}.ezkart-cart-row>strong{grid-column:2}.ezkart-cart-drawer{width:100%}}@media(prefers-reduced-motion:reduce){.ezkart-cart-backdrop,.ezkart-cart-drawer{transition:none}.ezkart-cart-bump{animation:none}}
</style>`;
      const commerceMarkup = `<button class="ezkart-cart-trigger" type="button" data-ezkart-cart-open aria-label="Open cart, 0 items">Cart <b class="ezkart-cart-count" data-ezkart-cart-count aria-live="polite">0</b></button><div class="ezkart-cart-layer" data-ezkart-cart-layer hidden><button class="ezkart-cart-backdrop" type="button" data-ezkart-cart-close aria-label="Close cart"></button><aside class="ezkart-cart-drawer" role="dialog" aria-modal="true" aria-labelledby="ezkart-cart-title" tabindex="-1"><header class="ezkart-cart-head"><div><small data-ezkart-cart-summary>0 items</small><h2 id="ezkart-cart-title">Your cart</h2></div><button class="ezkart-cart-close" type="button" data-ezkart-cart-close aria-label="Close cart">×</button></header><div class="ezkart-cart-items" data-ezkart-cart-items></div><footer class="ezkart-cart-foot"><div class="ezkart-cart-subtotal"><span>Subtotal</span><strong data-ezkart-cart-subtotal>Rp0</strong></div><button class="ezkart-cart-checkout" type="button" data-ezkart-cart-go disabled>Review cart</button><small>Shipping is calculated at checkout.</small></footer></aside></div>`;
      const commerceScript = `<script>(()=>{
const catalog=${catalogJson},storefrontBrand=${brandJson},storageKey='ezkart.storefront.cart.v2:'+location.pathname,money=value=>'Rp'+new Intl.NumberFormat('id-ID').format(value),escapeHtml=value=>String(value).replace(/[&<>'"]/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[character]));
const selectionId=(productId,variantId='')=>variantId?productId+'~'+variantId:productId,lineProduct=lineId=>{const [productId,variantId='']=String(lineId).split('~'),base=catalog[productId];if(!base)return null;const variants=Array.isArray(base.variants)?base.variants:[],variant=variantId?variants.find(item=>item.id===variantId):variants[0]||null;if(variantId&&!variant)return null;return{...base,...(variant||{}),name:variant?base.name+' — '+variant.name:base.name,productId,variantId:variant?.id||''}};
let cart={};
try{const saved=JSON.parse(localStorage.getItem(storageKey)||'{}');cart=Object.fromEntries(Object.entries(saved).filter(([id,quantity])=>{const product=lineProduct(id),stock=product?.stock==null?Number.MAX_SAFE_INTEGER:Number(product.stock);return product&&Number.isInteger(quantity)&&quantity>0&&(!Number.isFinite(stock)||quantity<=stock)}))}catch(_){}
const cartEntries=()=>Object.entries(cart).filter(([id,quantity])=>lineProduct(id)&&quantity>0),cartCount=()=>cartEntries().reduce((sum,[,quantity])=>sum+quantity,0),cartSubtotal=()=>cartEntries().reduce((sum,[id,quantity])=>sum+lineProduct(id).price*quantity,0);
const saveCart=()=>{try{localStorage.setItem(storageKey,JSON.stringify(cart))}catch(_){}};
const cartLayer=document.querySelector('[data-ezkart-cart-layer]'),cartDrawer=cartLayer?.querySelector('.ezkart-cart-drawer'),cartItems=document.querySelector('[data-ezkart-cart-items]'),cartGo=document.querySelector('[data-ezkart-cart-go]');let cartReturnFocus=null,cartCloseTimer=0;
const renderCart=()=>{const entries=cartEntries(),count=cartCount();document.querySelectorAll('[data-ezkart-cart-count]').forEach(target=>{target.textContent=String(count);target.classList.remove('ezkart-cart-bump');void target.offsetWidth;if(count)target.classList.add('ezkart-cart-bump')});document.querySelectorAll('[data-ezkart-cart-open]').forEach(button=>button.setAttribute('aria-label','Open cart, '+count+' '+(count===1?'item':'items')));document.querySelector('[data-ezkart-cart-summary]').textContent=count+' '+(count===1?'item':'items');document.querySelector('[data-ezkart-cart-subtotal]').textContent=money(cartSubtotal());cartGo.disabled=!count;cartItems.innerHTML=entries.length?entries.map(([id,quantity])=>{const product=lineProduct(id),thumb=product.image?'<img src="'+escapeHtml(product.image)+'" alt="">':'<span class="ezkart-cart-thumb" aria-hidden="true">EZ</span>';return '<article class="ezkart-cart-row" data-ezkart-cart-row="'+escapeHtml(id)+'">'+thumb+'<div><h3>'+escapeHtml(product.name)+'</h3><p>'+money(product.price)+' each</p><div class="ezkart-cart-quantity" aria-label="Quantity for '+escapeHtml(product.name)+'"><button type="button" data-ezkart-cart-quantity="-1" aria-label="Decrease quantity">−</button><span>'+quantity+'</span><button type="button" data-ezkart-cart-quantity="1" aria-label="Increase quantity">+</button></div></div><strong>'+money(product.price*quantity)+'</strong></article>'}).join(''):'<div class="ezkart-cart-empty"><b>Your cart is empty</b><p>Add something you like, then come back here to review it before checkout.</p></div>';document.querySelectorAll('[data-ezkart-add]').forEach(button=>{const productId=button.dataset.ezkartAdd,quantity=entries.filter(([id])=>lineProduct(id)?.productId===productId).reduce((sum,[,value])=>sum+value,0);button.textContent=quantity?'Added · '+quantity:'Add to cart'});document.querySelectorAll('[data-ezkart-basket-lines]').forEach(list=>{list.innerHTML=entries.length?entries.map(([id,quantity])=>{const product=lineProduct(id);return'<li><span>'+escapeHtml(product.name)+' × '+quantity+'</span><b>'+money(product.price*quantity)+'</b></li>'}).join(''):'<li class="ezkart-basket-empty">Your cart is empty</li>'});document.querySelectorAll('[data-ezkart-basket-total]').forEach(total=>{total.textContent=money(cartSubtotal())});saveCart()};
const openCart=()=>{if(!cartLayer)return;clearTimeout(cartCloseTimer);cartReturnFocus=document.activeElement;cartLayer.hidden=false;document.body.classList.add('ezkart-cart-open');requestAnimationFrame(()=>{cartLayer.classList.add('is-open');cartDrawer?.focus()})};
const closeCart=()=>{if(!cartLayer||cartLayer.hidden)return;cartLayer.classList.remove('is-open');document.body.classList.remove('ezkart-cart-open');cartCloseTimer=setTimeout(()=>{cartLayer.hidden=true;cartReturnFocus?.focus?.()},240)};
const changeCart=(id,change)=>{const product=lineProduct(id);if(!product)return;const stock=product.stock==null?Number.MAX_SAFE_INTEGER:Number(product.stock),maximum=Number.isFinite(stock)?Math.max(0,stock):Number.MAX_SAFE_INTEGER;cart[id]=Math.max(0,Math.min(maximum,(cart[id]||0)+change));if(!cart[id])delete cart[id];renderCart()};
const goCheckout=()=>{const entries=cartEntries();if(!entries.length)return;const params=new URLSearchParams({cart:entries.map(([id,quantity])=>id+':'+quantity).join(',')});if(storefrontBrand.name)params.set('brand',storefrontBrand.name);if(/^https?:\\/\\//i.test(storefrontBrand.logo||'')&&storefrontBrand.logo.length<=1800)params.set('logo',storefrontBrand.logo);location.href='/cart/?'+params};
document.querySelectorAll('[data-ezkart-action="checkout"]').forEach(button=>{if(!button.querySelector('[data-ezkart-cart-count]')){const count=document.createElement('span');count.className='ezkart-cart-count';count.dataset.ezkartCartCount='';count.textContent='0';button.append(count)}});
document.querySelectorAll('[data-ezkart-cart-open]').forEach(button=>button.addEventListener('click',openCart));document.querySelectorAll('[data-ezkart-cart-close]').forEach(button=>button.addEventListener('click',closeCart));cartGo?.addEventListener('click',goCheckout);cartItems?.addEventListener('click',event=>{const button=event.target.closest('[data-ezkart-cart-quantity]'),row=button?.closest('[data-ezkart-cart-row]');if(button&&row)changeCart(row.dataset.ezkartCartRow,Number(button.dataset.ezkartCartQuantity))});addEventListener('keydown',event=>{if(cartLayer?.hidden)return;if(event.key==='Escape'){event.preventDefault();closeCart();return}if(event.key!=='Tab')return;const focusable=[...cartDrawer.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),[tabindex]:not([tabindex="-1"])')],first=focusable[0],last=focusable.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}});
let marqueeFrame=0;
const marqueeSpeed=element=>Math.max(20,Math.min(200,Number(element.dataset.ezkartMarqueeSpeed)||60));
const updateScrollMarquees=()=>{marqueeFrame=0;document.querySelectorAll('.sq-free-marquee.sq-marquee-manual').forEach(element=>{const track=element.querySelector('.sq-marquee-track'),distance=Number.parseFloat(track?.style.getPropertyValue('--sq-marquee-distance'))||1,offset=(scrollY*marqueeSpeed(element)/60)%distance;if(track)track.style.transform='translate3d('+-offset+'px,0,0)'})};
const scheduleScrollMarquees=()=>{if(!marqueeFrame)marqueeFrame=requestAnimationFrame(updateScrollMarquees)};
const syncMarquees=()=>{document.querySelectorAll('.sq-free-marquee').forEach(element=>{const track=element.querySelector('.sq-marquee-track'),source=track?.querySelector('.sq-marquee-copy:not([aria-hidden])');if(!track||!source)return;track.querySelectorAll('.sq-marquee-copy[aria-hidden="true"]').forEach(copy=>copy.remove());const width=Math.max(1,source.offsetWidth),copies=Math.max(2,Math.ceil(Math.max(1,element.clientWidth)/width)+2);for(let index=1;index<copies;index+=1){const copy=source.cloneNode(true);copy.removeAttribute('contenteditable');copy.setAttribute('aria-hidden','true');track.append(copy)}track.style.setProperty('--sq-marquee-distance',width+'px');track.style.setProperty('--sq-marquee-duration',Math.max(2,width/marqueeSpeed(element))+'s');const manual=element.dataset.ezkartMarqueeMode==='scroll';element.classList.toggle('sq-marquee-manual',manual);if(!manual)track.style.removeProperty('transform')});scheduleScrollMarquees()};
addEventListener('scroll',scheduleScrollMarquees,{passive:true});addEventListener('resize',syncMarquees,{passive:true});document.fonts?.ready.then(syncMarquees);syncMarquees();
let navigationFrame=0,lastNavigationScroll=scrollY;
const syncNavigations=()=>{navigationFrame=0;const current=scrollY,direction=current-lastNavigationScroll;document.querySelectorAll('[data-ezkart-nav-position]').forEach(nav=>{const position=nav.dataset.ezkartNavPosition||'static',offset=Math.max(0,Math.min(120,Number(nav.dataset.ezkartNavOffset)||0)),opacity=Math.max(0,Math.min(100,Number(nav.dataset.ezkartNavOpacity??100))),blur=Math.max(0,Math.min(32,Number(nav.dataset.ezkartNavBlur??16))),stuck=position==='fixed'||position==='sticky'&&nav.getBoundingClientRect().top<=offset+1;nav.style.setProperty('--sq-nav-offset',offset+'px');nav.style.setProperty('--sq-nav-surface-opacity',opacity+'%');nav.style.setProperty('--sq-nav-backdrop-blur',blur+'px');nav.classList.toggle('sq-nav-is-stuck',stuck);if(!stuck||nav.dataset.ezkartNavHideScroll!=='true')nav.classList.remove('sq-nav-hidden');else if(direction>2&&current>offset+48)nav.classList.add('sq-nav-hidden');else if(direction<-2)nav.classList.remove('sq-nav-hidden')});lastNavigationScroll=current};
const scheduleNavigations=()=>{if(!navigationFrame)navigationFrame=requestAnimationFrame(syncNavigations)};
addEventListener('scroll',scheduleNavigations,{passive:true});addEventListener('resize',scheduleNavigations,{passive:true});syncNavigations();
document.querySelectorAll('.sq-navigation-template-section').forEach(section=>{const toggle=section.querySelector('.sq-nav-menu-toggle'),menu=section.querySelector(':scope>.sq-nav-mobile-menu');if(!toggle||!menu)return;const setOpen=open=>{menu.hidden=!open;section.classList.toggle('sq-nav-menu-open',open);toggle.setAttribute('aria-expanded',String(open));toggle.setAttribute('aria-label',open?'Close navigation menu':'Open navigation menu')};toggle.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();setOpen(menu.hidden)});menu.addEventListener('click',event=>{if(event.target.closest('a'))setOpen(false)});addEventListener('keydown',event=>{if(event.key==='Escape'&&!menu.hidden){setOpen(false);toggle.focus()}});document.addEventListener('click',event=>{if(!section.contains(event.target))setOpen(false)})});
document.querySelectorAll('.sq-nav-commerce-search form').forEach(form=>{const input=form.querySelector('input[type="search"]'),button=form.querySelector('button'),filterProducts=()=>{const query=(input?.value||'').trim().toLocaleLowerCase();document.querySelectorAll('[data-product-card]').forEach(card=>{card.hidden=Boolean(query)&&!card.textContent.toLocaleLowerCase().includes(query)})};form.addEventListener('submit',event=>{event.preventDefault();filterProducts()});button?.addEventListener('click',filterProducts);input?.addEventListener('input',filterProducts)});
document.querySelectorAll('[data-ezkart-variants]').forEach(controls=>{
  let variants=[];
  try{variants=JSON.parse(controls.dataset.ezkartVariants||'[]')}catch(_){return}
  const card=controls.closest('[data-product-card]'),fields=[...controls.querySelectorAll('[data-ezkart-option]')],valueFor=(variant,name)=>variant.options?.find(option=>option.option===name)?.value;
  if(!card||!fields.length||!variants.length)return;
  const closeMenus=(except=null)=>fields.forEach(field=>{if(field===except)return;const menu=field.querySelector('.sq-product-option-menu'),trigger=field.querySelector('.sq-product-option-trigger');if(menu)menu.hidden=true;if(trigger)trigger.setAttribute('aria-expanded','false')});
  const setValue=(field,value)=>{field.dataset.ezkartValue=value;const label=field.querySelector('.sq-product-option-value');if(label)label.textContent=value;field.querySelectorAll('[data-ezkart-option-value]').forEach(option=>{const selected=option.dataset.ezkartOptionValue===value;option.classList.toggle('selected',selected);option.setAttribute('aria-selected',String(selected))})};
  const sync=(changed=-1)=>{const groups=fields.map(field=>field.dataset.ezkartOption);let selected=variants.find(variant=>groups.every((group,index)=>valueFor(variant,group)===fields[index].dataset.ezkartValue));if(!selected&&changed>=0)selected=variants.find(variant=>valueFor(variant,groups[changed])===fields[changed].dataset.ezkartValue);selected||=variants[0];if(!selected)return;groups.forEach((group,index)=>{const value=valueFor(selected,group);if(value)setValue(fields[index],value)});card.dataset.ezkartVariant=selected.id||'';const price=card.querySelector('footer b'),image=card.querySelector('.product-art img');if(price)price.textContent=money(Math.max(1000,Number(selected.price)||0));if(image&&selected.image)image.src=selected.image;fields.forEach((field,index)=>field.querySelectorAll('[data-ezkart-option-value]').forEach(option=>{option.disabled=!variants.some(variant=>groups.every((group,groupIndex)=>groupIndex===index?valueFor(variant,group)===option.dataset.ezkartOptionValue:valueFor(variant,group)===fields[groupIndex].dataset.ezkartValue))}))};
  fields.forEach((field,index)=>{const trigger=field.querySelector('.sq-product-option-trigger'),menu=field.querySelector('.sq-product-option-menu'),options=[...field.querySelectorAll('[data-ezkart-option-value]')];if(!trigger||!menu)return;const setOpen=open=>{closeMenus(open?field:null);menu.hidden=!open;trigger.setAttribute('aria-expanded',String(open));controls.closest('.sq-product-grid')?.classList.toggle('sq-option-menu-open',open);if(open)(options.find(option=>option.classList.contains('selected'))||options.find(option=>!option.disabled))?.focus()};trigger.addEventListener('click',event=>{event.preventDefault();setOpen(menu.hidden)});trigger.addEventListener('keydown',event=>{if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();setOpen(true)}});options.forEach(option=>option.addEventListener('click',event=>{event.preventDefault();if(option.disabled)return;setValue(field,option.dataset.ezkartOptionValue);sync(index);setOpen(false);trigger.focus()}));menu.addEventListener('keydown',event=>{const enabled=options.filter(option=>!option.disabled),current=enabled.indexOf(document.activeElement);if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?enabled.length-1:(current+(event.key==='ArrowDown'?1:-1)+enabled.length)%enabled.length;enabled[next]?.focus()}if(event.key==='Escape'){event.preventDefault();setOpen(false);trigger.focus()}})});
  controls.addEventListener('focusout',event=>{if(controls.contains(event.relatedTarget))return;closeMenus();controls.closest('.sq-product-grid')?.classList.remove('sq-option-menu-open')});
  sync();
});
document.querySelectorAll('[data-ezkart-add]').forEach(button=>button.addEventListener('click',()=>{const productId=button.dataset.ezkartAdd,variantId=button.closest('[data-product-card]')?.dataset.ezkartVariant||'';changeCart(selectionId(productId,variantId),1)}));
document.querySelectorAll('[data-ezkart-checkout]').forEach(button=>button.addEventListener('click',openCart));
document.querySelectorAll('[data-ezkart-action]').forEach(button=>button.addEventListener('click',()=>{const type=button.dataset.ezkartAction,target=button.dataset.ezkartTarget||'';if(type==='checkout'){openCart();return}if(type==='section'){document.getElementById(target.replace(/^#/,''))?.scrollIntoView({behavior:'smooth'});return}const href=type==='email'?'mailto:'+target:type==='phone'?'tel:'+target:target;if(type==='url'&&button.dataset.ezkartNewTab==='true')window.open(href,'_blank','noopener');else if(href)location.href=href}));
renderCart();
const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add(entry.target.matches('[class*="element-animation-"]')?'sq-element-animate':'animating');observer.unobserve(entry.target)}}),{threshold:.12});
document.querySelectorAll('[class*="animation-"],[class*="element-animation-"]').forEach(element=>observer.observe(element))
})();<\/script>`;
      const fontBase = new URL("assets/fonts/poppins-400.woff2", window.location.href).href;
      const fontMedium = new URL("assets/fonts/poppins-500.woff2", window.location.href).href;
      const fontSemibold = new URL("assets/fonts/poppins-600.woff2", window.location.href).href;
      const fontBold = new URL("assets/fonts/poppins-700.woff2", window.location.href).href;
      const hasScrollMotion = Boolean(clone.querySelector(".ezkart-scroll-frame"));
      const motionStyles = hasScrollMotion ? `<style>.ezkart-scroll-frame{position:relative!important;overflow:hidden!important;contain:paint}.ezkart-scroll-frame>.ezkart-scroll-media{width:100%!important;max-width:none!important;height:100%;position:absolute!important;left:0!important;top:50%!important;display:block;object-fit:cover;transform:translate3d(0,calc(-50% + var(--ezkart-scroll-y,0px)),0) scale(calc(var(--ezkart-scroll-scale,1) * var(--sq-image-crop-zoom,1)));transform-origin:center;will-change:transform;backface-visibility:hidden}@media(prefers-reduced-motion:reduce){.ezkart-scroll-frame>.ezkart-scroll-media{height:100%!important;transform:translate3d(0,-50%,0) scale(var(--sq-image-crop-zoom,1))!important;will-change:auto}}</style>` : "";
      const libraryPreviewStyles = libraryPreview ? `<style id="ezkart-library-preview-style">.sq-free-marquee .sq-marquee-track{animation:none!important;transform:translate3d(0,0,0)!important;will-change:auto!important}</style>` : "";
      const motionScripts = hasScrollMotion ? `<script>(()=>{const frames=[...document.querySelectorAll('.ezkart-scroll-frame')].map(frame=>({frame,media:frame.querySelector(':scope>.ezkart-scroll-media'),effect:frame.dataset.ezkartScrollEffect||'parallax',strength:Math.max(0,Math.min(100,Number(frame.dataset.ezkartScrollStrength)||0))/100,damping:frame.dataset.ezkartScrollDamping!=='false',y:null,yVelocity:0,scale:1,scaleVelocity:0,coverScale:1})).filter(item=>item.media);if(!frames.length)return;const reduced=matchMedia('(prefers-reduced-motion: reduce)');let raf=0,lastTime=0,viewportHeight=1;const clamp=value=>Math.max(0,Math.min(1,value));const damp=(value,velocity,target,delta,smoothTime)=>{const omega=2/smoothTime,x=omega*delta,decay=1/(1+x+.48*x*x+.235*x*x*x),change=value-target,temp=(velocity+omega*change)*delta;return[target+(change+temp)*decay,(velocity-omega*temp)*decay]};const render=time=>{raf=0;if(reduced.matches)return;const delta=Math.min(.05,lastTime?Math.max(0,(time-lastTime)/1000):1/60);lastTime=time;let moving=false;frames.forEach(item=>{const rect=item.frame.getBoundingClientRect();if(rect.bottom<-viewportHeight*.25||rect.top>viewportHeight*1.25)return;const progress=clamp((viewportHeight-rect.top)/(viewportHeight+rect.height)),reverse=item.effect==='parallax-reverse',rate=reverse?item.strength*.35:item.strength,zoom=item.effect==='zoom';const yTarget=zoom?0:(progress-.5)*(viewportHeight+rect.height)*rate*(reverse?-1:1),scaleTarget=zoom?1+progress*item.strength*.3:item.coverScale;if(item.y===null){item.y=yTarget;item.scale=scaleTarget}else if(item.damping){[item.y,item.yVelocity]=damp(item.y,item.yVelocity,yTarget,delta,.11);if(zoom)[item.scale,item.scaleVelocity]=damp(item.scale,item.scaleVelocity,scaleTarget,delta,.11);else{item.scale=scaleTarget;item.scaleVelocity=0}}else{item.y=yTarget;item.yVelocity=0;item.scale=scaleTarget;item.scaleVelocity=0}item.media.style.setProperty('--ezkart-scroll-y',item.y.toFixed(3)+'px');item.media.style.setProperty('--ezkart-scroll-scale',item.scale.toFixed(5));if(item.damping&&(Math.abs(yTarget-item.y)>.02||Math.abs(item.yVelocity)>.02||zoom&&(Math.abs(scaleTarget-item.scale)>.0001||Math.abs(item.scaleVelocity)>.0001)))moving=true});if(moving)raf=requestAnimationFrame(render)};const schedule=()=>{if(!raf){lastTime=0;raf=requestAnimationFrame(render)}};const measure=()=>{viewportHeight=Math.max(1,document.documentElement.clientHeight||innerHeight);frames.forEach(item=>{const frameHeight=Math.max(1,item.frame.clientHeight),reverse=item.effect==='parallax-reverse',rate=reverse?item.strength*.35:item.strength,overscan=reverse?(viewportHeight+frameHeight)*rate:Math.max(0,viewportHeight-frameHeight)*rate;item.coverScale=item.effect==='zoom'||reduced.matches||!rate?1:1+(overscan+4)/frameHeight;if(item.scale<item.coverScale){item.scale=item.coverScale;item.scaleVelocity=0}if(reduced.matches){item.y=null;item.yVelocity=0;item.scale=1;item.scaleVelocity=0;item.media.style.removeProperty('--ezkart-scroll-y');item.media.style.removeProperty('--ezkart-scroll-scale')}});schedule()};addEventListener('scroll',schedule,{passive:true});addEventListener('touchmove',schedule,{passive:true});addEventListener('resize',measure,{passive:true});addEventListener('orientationchange',measure,{passive:true});addEventListener('pageshow',measure);window.visualViewport?.addEventListener('resize',measure,{passive:true});reduced.addEventListener?.('change',measure);if(typeof ResizeObserver==='function'){const observer=new ResizeObserver(measure);frames.forEach(item=>observer.observe(item.frame))}document.fonts?.ready.then(measure);measure()})();<\/script>` : "";
      return `<!doctype html>\n<html lang="id">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>${escapeHtml(pageName)}</title>\n<meta name="description" content="Shop selected Indonesian products with secure Ezkart checkout and delivery.">\n${motionStyles}\n<style>@font-face{font-family:Poppins;src:url('${fontBase}') format('woff2');font-weight:400}@font-face{font-family:Poppins;src:url('${fontMedium}') format('woff2');font-weight:500}@font-face{font-family:Poppins;src:url('${fontSemibold}') format('woff2');font-weight:600}@font-face{font-family:Poppins;src:url('${fontBold}') format('woff2');font-weight:700}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:#fff;font-family:Poppins,Arial,sans-serif}.svg-sprite{width:0;height:0;position:absolute;overflow:hidden}@media(prefers-reduced-motion:reduce){*{animation:none!important;scroll-behavior:auto!important}}\n${css}\n${responsiveSpacing}\n</style>\n${commerceStyles}\n${libraryPreviewStyles}\n</head>\n<body>\n${sprite}\n${clone.outerHTML}\n${pinnedNavigationHtml}\n${commerceMarkup}\n${motionScripts}\n${commerceScript}\n</body>\n</html>`;
    };
    sqStudio.querySelector("[data-sq-export]")?.addEventListener("click", () => {
      const html = generateHtml(); const output = exportDialog?.querySelector("[data-sq-html-output]"); if (output) output.value = html; const size = exportDialog?.querySelector("[data-sq-html-size]"); if (size) size.textContent = `${new Blob([html]).size.toLocaleString("id-ID")} bytes · ready to host`; exportDialog?.showModal();
    });
    exportDialog?.querySelector("[data-sq-copy-html]")?.addEventListener("click", async () => {
      const output = exportDialog.querySelector("[data-sq-html-output]"); try { await navigator.clipboard.writeText(output.value); showToast("Complete HTML copied"); } catch (_) { output.select(); document.execCommand("copy"); showToast("Complete HTML copied"); }
    });
    exportDialog?.querySelector("[data-sq-download-html]")?.addEventListener("click", () => {
      const html = exportDialog.querySelector("[data-sq-html-output]")?.value || generateHtml(); const url = URL.createObjectURL(new Blob([html], { type: "text/html" })); const link = document.createElement("a"); link.href = url; link.download = `${normalize(document.querySelector("[data-current-site-name]")?.textContent).replace(/[^a-z0-9]+/g, "-") || "ezkart-page"}.html`; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); showToast("HTML file downloaded");
    });
    sqStudio.querySelector("[data-sq-publish]")?.addEventListener("click", async () => {
      const saved = await persistCurrentState({ status: "published", publishedHtml: generateHtml() });
      if (saveState) saveState.textContent = saved ? "Published just now" : "Publish failed";
      if (saved) showToast("Landing page published");
    });
    const cloneBaseSiteState = () => JSON.parse(JSON.stringify(baseSiteState || captureState()));
    const loadSite = async (site, force = false) => {
      if (!site || (!force && site.classList.contains("active"))) return;
      const loadRequest = ++siteLoadRequest;
      sqStudio.classList.add("sq-site-loading");
      sqStudio.setAttribute("aria-busy", "true");
      try {
        if (!force && activeSiteKey) await persistCurrentState();
        activeSiteKey = site.dataset.siteUrl || "default";
        sqStudio.querySelectorAll("[data-sq-site]").forEach((item) => item.classList.toggle("active", item === site));
        document.querySelectorAll("[data-current-site-name]").forEach((target) => { target.textContent = site.dataset.siteName; });
        document.querySelectorAll("[data-current-site-url]").forEach((target) => { target.textContent = site.dataset.siteUrl; });
        window.history.replaceState(null, "", `?page=sites&edit=${encodeURIComponent(site.dataset.siteUrl)}`);
        let state = null;
        try {
          activeSiteDocument = await loadCloudLandingPage(site.dataset.siteUrl);
          state = activeSiteDocument.state || null;
          site.dataset.siteProducts = activeSiteDocument.products.join(",");
          site.dataset.siteCustomProducts = JSON.stringify(activeSiteDocument.customProducts);
        } catch (error) {
          showToast(error instanceof Error ? error.message : "The landing page could not be loaded.");
          return;
        }
        undoStack.length = 0; redoStack.length = 0; updateHistoryButtons();
        restoreState([2, 3, 4, 5, 6].includes(state?.version) ? state : cloneBaseSiteState());
        readCatalogProducts().forEach((product) => installCustomProduct(product, selectedProducts().includes(product.id)));
        let customProducts = [];
        try { customProducts = JSON.parse(site.dataset.siteCustomProducts || "[]"); } catch (_) { customProducts = []; }
        customProducts.forEach((product) => installCustomProduct(product, true));
        if (![2, 3].includes(state?.version) && site.dataset.siteProducts) {
          const starters = site.dataset.siteProducts.split(",").filter(Boolean);
          sqStudio.querySelectorAll("[data-sq-product]").forEach((input) => { input.checked = starters.includes(input.value); });
          updateProductView();
          if (!previewRepairMode) markSqChanged();
        }
        deselectSqItem(state?.selectedSection || "hero");
        scheduleLandingPreviewRefresh(1600);
      } finally {
        window.requestAnimationFrame(() => {
          if (loadRequest !== siteLoadRequest) return;
          sqStudio.classList.remove("sq-site-loading");
          sqStudio.setAttribute("aria-busy", "false");
        });
      }
    };
    const bindSiteButton = (site) => { site.onclick = () => { void loadSite(site); }; };
    const pageList = sqStudio.querySelector(".sq-page-list");
    const addSavedSiteButton = ({ name, url, products = [], customProducts = [] }) => {
      const sourceSite = pageList?.querySelector("template[data-sq-site-template]")?.content.firstElementChild;
      if (!pageList || !sourceSite || !name || !url || pageList.querySelector(`[data-site-url="${CSS.escape(url)}"]`)) return null;
      const site = sourceSite.cloneNode(true);
      site.classList.remove("active"); site.dataset.siteName = name; site.dataset.siteUrl = url; site.dataset.siteProducts = products.join(","); site.dataset.siteCustomProducts = JSON.stringify(customProducts); site.dataset.customSite = "true";
      const title = site.querySelector("b"); const subtitle = site.querySelector("small"); const status = site.querySelector("em");
      if (title) title.textContent = name; if (subtitle) subtitle.textContent = url; if (status) { status.textContent = "Draft"; status.className = "draft"; }
      pageList.append(site); bindSiteButton(site); return site;
    };
    readLandingSites().forEach(addSavedSiteButton);
    updateLandingCountBadges();
    sqStudio.querySelectorAll("[data-sq-site]").forEach(bindSiteButton);

    const newPageDialog = document.getElementById("page-creator-dialog");
    sqStudio.querySelectorAll("[data-open-page-creator]").forEach((button) => button.addEventListener("click", () => {
      if (readLandingSites().length >= 6) { showToast("Delete a project before creating another"); return; }
      newPageDialog?.showModal();
    }));
    const newPageForm = newPageDialog?.querySelector("[data-page-creator-form]");
    const newPageName = newPageForm?.elements.namedItem("page_name");
    const newPageSlug = newPageForm?.elements.namedItem("slug");
    hydrateCreatorCatalog(newPageForm);
    let newPageSlugEdited = false;
    const makePageSlug = (value) => normalize(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
    newPageSlug?.addEventListener("input", () => { newPageSlugEdited = true; newPageSlug.value = makePageSlug(newPageSlug.value); });
    newPageName?.addEventListener("input", () => { if (!newPageSlugEdited && newPageSlug) newPageSlug.value = makePageSlug(newPageName.value); });
    newPageDialog?.addEventListener("close", () => { if (newPageDialog.returnValue === "cancel") { newPageForm?.reset(); newPageSlugEdited = false; } });
    newPageForm?.addEventListener("submit", async (event) => {
      if (event.submitter?.value === "cancel") return;
      event.preventDefault(); event.stopImmediatePropagation();
      const starters = [...newPageForm.querySelectorAll('input[name="starter_products[]"]:checked')];
      if (!starters.length) { showToast("Select at least one starting product"); newPageForm.querySelector('input[name="starter_products[]"]')?.focus(); return; }
      if (!newPageForm.reportValidity()) return;
      const name = String(newPageForm.elements.page_name.value).trim();
      const siteUrl = `${String(newPageForm.elements.slug.value).trim()}.ezkart.site`;
      const starterIds = starters.map((starter) => starter.value);
      const customProducts = [];
      if (readLandingSites().some((page) => page.url === siteUrl)) { showToast("A page with this URL already exists"); return; }
      let savedPage;
      try { savedPage = await saveCloudLandingPage({ name, url: siteUrl, products: starterIds, customProducts }, { status: "draft" }); }
      catch (error) { showToast(error instanceof Error ? error.message : "The landing page could not be created."); return; }
      const site = addSavedSiteButton(savedPage);
      if (!site) { showToast("A page with this URL already exists"); return; }
      newPageDialog?.close(); await loadSite(site);
      sqStudio.querySelectorAll("[data-sq-product]").forEach((input) => { input.checked = starters.some((starter) => starter.value === input.value); });
      updateProductView(); markSqChanged();
      updateLandingCountBadges();
      showToast(`${name} created with ${starters.length} products`); newPageForm.reset(); newPageSlugEdited = false;
    });

    const syncCommerceStatus = async () => {
      const status = sqStudio.querySelector("[data-sq-commerce-status]");
      if (!status) return;
      try {
        const response = await fetch("../api/health.php", { headers: { Accept: "application/json" }, cache: "no-store" });
        const payload = await response.json();
        const ready = response.ok && payload.midtrans?.configured && payload.biteship?.configured && payload.biteship?.fulfillment_configured;
        status.classList.toggle("ready", ready);
        status.classList.toggle("warning", !ready);
        const production = payload.commerce_environment === "production";
        status.lastChild.textContent = ready ? ` Midtrans + Biteship ${production ? "production" : "sandbox"} ready` : ` Complete ${production ? "production" : "sandbox"} payment, rates, and pickup setup`;
        status.title = ready ? `Checkout creates a Midtrans ${production ? "production" : "sandbox"} payment. Biteship pickup is created only after the merchant accepts the order and selects Arrange pickup.` : "Add matching Midtrans and Biteship credentials, postcode, pickup contact, and pickup address.";
      } catch (_) {
        status.classList.add("warning");
        status.lastChild.textContent = " Commerce status unavailable";
      }
    };

    readCatalogProducts().forEach((product) => installCustomProduct(product, false));
    upgradeLegacyStructure();
    previewRoot?.querySelectorAll("img[data-sq-image-blend-mode],img[data-sq-image-blend-source],img[data-sq-image-blend-color]").forEach(applyImageBlend);
    previewRoot?.querySelectorAll("img[data-sq-image-crop-zoom],img[data-sq-image-crop-x],img[data-sq-image-crop-y]").forEach(applyImageCrop);
    previewRoot?.querySelectorAll("img[data-sq-filter-opacity]").forEach(applySelectedImageFilters);
    rebuildLayerList();
    bindSqInteractions();
    updateProductView();
    deselectSqItem("hero");
    syncBrandControls();
    syncCommerceStatus();
    baseSiteState = captureState();
    const requestedSiteButton = [...sqStudio.querySelectorAll("[data-sq-site]")].find((site) => site.dataset.siteUrl === requestedSiteUrl);
    if (requestedSiteButton) await loadSite(requestedSiteButton, true);
    else window.location.replace("?page=sites");
    setZoom(fitZoomForDevice());
  }

  const mapElement = document.getElementById("fulfillment-map");
  if (mapElement && window.L) {
    let points = [];
    try { points = JSON.parse(mapElement.dataset.points || "[]"); } catch (_) { points = []; }
    if (!Array.isArray(points) || points.length === 0) {
      points = [{ lat: -6.1754, lng: 106.8272, label: "Jakarta", status: "READY", order: "Sandbox operations" }];
    }

    const map = window.L.map(mapElement, { zoomControl: false, scrollWheelZoom: false });
    window.L.control.zoom({ position: "topright" }).addTo(map);
    window.L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      subdomains: "abcd",
      maxZoom: 20,
      attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
    }).addTo(map);

    const markerIcon = window.L.divIcon({
      className: "delivery-marker-shell",
      html: '<span class="delivery-marker"><i></i></span>',
      iconSize: [28, 28],
      iconAnchor: [7, 25],
      popupAnchor: [7, -23],
    });
    const bounds = [];
    points.forEach((point) => {
      const lat = Number(point.lat);
      const lng = Number(point.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      bounds.push([lat, lng]);
      window.L.marker([lat, lng], { icon: markerIcon })
        .addTo(map)
        .bindPopup(`<b>${escapeHtml(point.label || "Destination")}</b>${escapeHtml(point.order || "Order")} · ${escapeHtml(point.status || "Pending")}`);
    });
    if (bounds.length > 1) {
      window.L.polyline(bounds, { color: "#f43d51", opacity: 0.28, weight: 2, dashArray: "6 8" }).addTo(map);
      map.fitBounds(bounds, { padding: [42, 42], maxZoom: 8 });
    } else {
      map.setView(bounds[0] || [-6.1754, 106.8272], 11);
    }
  }
})();
