(async () => {
  "use strict";

  const normalize = (value) => String(value || "").trim().toLocaleLowerCase("id-ID");
  const escapeHtml = (value) => String(value || "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '"': "&quot;",
  })[character]);

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
  const cloudUrl = (path) => `./?cloud=${encodeURIComponent(path)}`;
  const cloudMediaUrl = (id) => cloudUrl(`/v1/media/${encodeURIComponent(id)}`);
  const cloudRequest = async (method, path, payload = null) => {
    if (!cloudEnabled) throw new Error("Sign in with Google to use cloud product storage.");
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
    if (!response.ok || result.ok !== true) throw new Error(String(result.error || `Cloud storage returned ${response.status}.`));
    return result;
  };
  const normalizeCloudProduct = (product) => {
    const media = Array.isArray(product?.media) ? product.media : [];
    const images = media.map((item) => cloudMediaUrl(item.id));
    return {
      ...product,
      mediaIds: media.map((item) => item.id),
      images,
      image: images[0] || "",
      variants: (Array.isArray(product?.variants) ? product.variants : []).map((variant) => ({
        ...variant,
        image: variant.imageUploadId ? cloudMediaUrl(variant.imageUploadId) : null,
      })),
    };
  };
  const normalizeCloudDraft = (draft) => ({
    ...draft,
    images: (Array.isArray(draft?.images) ? draft.images : []).map((item) => ({
      ...item,
      data: item.cloudId ? cloudMediaUrl(item.cloudId) : item.data || "",
    })),
    variants: (Array.isArray(draft?.variants) ? draft.variants : []).map((variant) => ({
      ...variant,
      customImage: variant.customImage?.cloudId
        ? { ...variant.customImage, data: cloudMediaUrl(variant.customImage.cloudId) }
        : variant.customImage || null,
    })),
  });
  let cloudCatalogProducts = [];
  let cloudProductDrafts = [];
  let cloudLoadError = "";
  if (cloudEnabled) {
    try {
      const catalog = await cloudRequest("GET", "/v1/catalog");
      cloudCatalogProducts = (Array.isArray(catalog.products) ? catalog.products : []).map(normalizeCloudProduct);
      cloudProductDrafts = (Array.isArray(catalog.drafts) ? catalog.drafts : []).map(normalizeCloudDraft);
    } catch (error) {
      cloudLoadError = error instanceof Error ? error.message : "Cloud product storage could not be loaded.";
    }
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
  const legacyLandingSiteRegistryKey = "ezkart:landing-builder:v3:sites";
  const landingSiteRegistryKey = scopedStorageKey(legacyLandingSiteRegistryKey);
  const landingLegacyRegistryKey = scopedStorageKey("ezkart:landing-builder:v2:sites");
  const legacyLandingAdvancedModeKey = "ezkart:landing-builder:advanced-mode";
  const landingAdvancedModeKey = scopedStorageKey(legacyLandingAdvancedModeKey);
  const legacyProductCatalogKey = "ezkart:catalog:v1";
  const productCatalogKey = scopedStorageKey(legacyProductCatalogKey);
  const legacyProductDraftsKey = "ezkart:product-drafts:v1";
  const productDraftsKey = scopedStorageKey(legacyProductDraftsKey);
  const legacyActiveProductDraftKey = "ezkart:product-editor:active-draft";
  const activeProductDraftKey = scopedStorageKey(legacyActiveProductDraftKey);
  migrateLegacyStorage(legacyLandingSiteRegistryKey, landingSiteRegistryKey);
  migrateLegacyStorage("ezkart:landing-builder:v2:sites", landingLegacyRegistryKey);
  migrateLegacyStorage(legacyLandingAdvancedModeKey, landingAdvancedModeKey);
  migrateLegacyStorage(legacyProductCatalogKey, productCatalogKey);
  migrateLegacyStorage(legacyProductDraftsKey, productDraftsKey);
  migrateLegacyStorage(legacyActiveProductDraftKey, activeProductDraftKey, sessionStorage);
  const readLocalCatalogProducts = () => {
    try {
      const value = JSON.parse(localStorage.getItem(productCatalogKey) || "[]");
      return Array.isArray(value) ? value.filter((product) => product && /^custom-[a-z0-9]+$/i.test(product.id || "") && typeof product.name === "string") : [];
    } catch (_) { return []; }
  };
  const readCatalogProducts = () => {
    const products = [...cloudCatalogProducts];
    readLocalCatalogProducts().forEach((product) => { if (!products.some((item) => item.id === product.id)) products.push(product); });
    return products;
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
      if (!String(source || "").startsWith("data:image/")) throw new Error("A product image is not ready for cloud upload.");
      imageUploadIds.push((await uploadCloudImage(source)).id);
    }
    const variants = [];
    for (const variant of Array.isArray(product.variants) ? product.variants : []) {
      let imageUploadId = variant.imageUploadId || null;
      if (!imageUploadId && variant.imageSource === "variant-upload" && String(variant.image || "").startsWith("data:image/")) {
        imageUploadId = (await uploadCloudImage(variant.image)).id;
      }
      variants.push({ ...variant, imageUploadId });
    }
    return { ...product, imageUploadIds, variants };
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
      if (!cloudId) throw new Error("A draft image is not ready for cloud upload.");
      next.images.push({ id: image.id, cloudId });
    }
    next.variants = [];
    for (const variant of Array.isArray(snapshot.variants) ? snapshot.variants : []) {
      let customImage = variant.customImage || null;
      if (customImage) {
        let cloudId = customImage.cloudId || null;
        if (!cloudId && String(customImage.data || "").startsWith("data:image/")) cloudId = (await uploadCloudImage(customImage.data)).id;
        if (!cloudId) throw new Error("A variant draft image is not ready for cloud upload.");
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
    for (const product of readLocalCatalogProducts()) {
      if (cloudCatalogProducts.some((item) => item.id === product.id)) { removeLocalProduct(product.id); continue; }
      try { await saveCloudProduct(product); } catch (_) { /* Keep the local copy until a later successful retry. */ }
    }
    for (const draft of readLocalProductDrafts()) {
      if (cloudProductDrafts.some((item) => item.id === draft.id)) { removeLocalDraft(draft.id); continue; }
      try { await saveCloudDraft(draft); } catch (_) { /* Keep the local copy until a later successful retry. */ }
    }
  };
  if (cloudLoadError) showToast(`Cloud storage unavailable: ${cloudLoadError}`);
  else window.setTimeout(() => { void migrateLegacyCloudData(); }, 600);
  const hydrateCreatorCatalog = (form) => {
    const fieldset = form?.querySelector("[data-creator-products]");
    if (!fieldset) return;
    readCatalogProducts().forEach((product) => {
      if (fieldset.querySelector(`input[value="${CSS.escape(product.id)}"]`)) return;
      const label = document.createElement("label");
      label.dataset.sharedCatalogProduct = product.id;
      label.innerHTML = `<input type="checkbox" name="starter_products[]" value="${product.id}"><span><span class="product-art"><img src="${product.image || product.images?.[0] || ""}" alt=""></span><b>${escapeHtml(product.name)}</b><small>${escapeHtml(formatCreatorPrice(product.price))} · ${escapeHtml(product.type || "product")}</small></span>`;
      fieldset.append(label);
    });
  };
  const readLandingSites = () => {
    try {
      const value = JSON.parse(localStorage.getItem(landingSiteRegistryKey) || localStorage.getItem(landingLegacyRegistryKey) || "[]");
      return Array.isArray(value) ? value.filter((site) => site && typeof site.name === "string" && /^[a-z0-9-]+\.ezkart\.site$/i.test(site.url || "")) : [];
    } catch (_) { return []; }
  };
  const writeLandingSites = (sites) => {
    try { localStorage.setItem(landingSiteRegistryKey, JSON.stringify(sites)); return true; }
    catch (_) { showToast("These images exceed this browser's draft storage. Use fewer or simpler images."); return false; }
  };
  const landingAdvancedMode = () => localStorage.getItem(landingAdvancedModeKey) === "true";
  const updateLandingCountBadges = (count = 3 + readLandingSites().length) => document.querySelectorAll("[data-site-count]").forEach((badge) => { badge.textContent = String(count); });
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
  const productCreateForm = document.querySelector("[data-product-create-form]");
  if (productCreateForm) {
    const q = (selector) => productCreateForm.querySelector(selector);
    const typeInput = q("[data-product-create-type]");
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
    const editingProduct = requestedProductId ? readCatalogProducts().find((product) => product.id === requestedProductId) || null : null;
    let draftId = draftQuery.get("draft") || (editingProduct ? `edit-${editingProduct.id}` : sessionStorage.getItem(activeProductDraftKey)) || `draft-${globalThis.crypto?.randomUUID?.() || Date.now()}`;
    if (draftQuery.get("new") === "1") draftId = `draft-${globalThis.crypto?.randomUUID?.() || Date.now()}`;
    sessionStorage.setItem(activeProductDraftKey, draftId);
    const editorQuery = new URLSearchParams({ page: "product-new", draft: draftId });
    if (editingProduct) editorQuery.set("product", editingProduct.id);
    history.replaceState(null, "", `?${editorQuery.toString()}`);

    const currentType = () => String(typeInput?.value || "physical");
    const typeName = (type) => ({ physical: "Physical product", digital: "Digital product", subscription: "Subscription" }[type] || "Product");
    const setText = (selector, value) => { const target = q(selector); if (target) target.textContent = value; };
    const showError = (message) => { if (!errorTarget) return; errorTarget.textContent = message; errorTarget.hidden = false; errorTarget.scrollIntoView({ behavior: "smooth", block: "center" }); };
    const clearError = () => { if (!errorTarget) return; errorTarget.hidden = true; errorTarget.textContent = ""; };
    const optionValues = (input) => String(input?.value || "").split(",").map((value) => value.trim()).filter(Boolean).filter((value, index, values) => values.indexOf(value) === index);
    const compactVariantName = (name) => { const characters = [...String(name || "")]; return characters.length > 20 ? `${characters.slice(0, 19).join("")}…` : characters.join(""); };
    const optionSnapshot = () => [...(optionGroups?.children || [])].map((row) => ({ name: String(row.querySelector("[data-option-name]")?.value || "").trim(), values: optionValues(row.querySelector("[data-option-values]")) })).filter((group) => group.name && group.values.length);
    const selectedPreviewVariant = () => {
      if (!variantToggle?.checked || !variants.length) return null;
      return variants.find((variant) => variant.options?.every((option) => liveOptionSelection[option.option] === option.value)) || variants[0];
    };
    const imageData = async (item) => item?.data || (item?.file ? compressCreatorProductImage(item.file) : "");
    const setDropzoneState = (state = "idle") => {
      if (!dropzone) return;
      dropzone.classList.toggle("is-dragging", state === "ready"); dropzone.classList.toggle("is-uploading", state === "uploading");
      if (dropzoneTitle) dropzoneTitle.textContent = state === "ready" ? "Release to upload" : state === "uploading" ? "Preparing your images…" : "Drop images here";
      if (dropzoneHint) dropzoneHint.textContent = state === "ready" ? "They’re ready—drop them right here" : state === "uploading" ? "Optimizing them for a fast storefront" : "or click to browse your files";
    };

    const previewAvailability = (selectedVariant) => {
      const type = currentType();
      if (type === "digital") return "Available immediately after payment";
      if (type === "subscription") {
        const interval = Math.max(1, Math.round(Number(productCreateForm.elements.interval?.value) || 1));
        const unit = String(productCreateForm.elements.unit?.value || "month");
        return `Billed every ${interval} ${unit}${interval === 1 ? "" : "s"}`;
      }
      const stock = selectedVariant ? selectedVariant.stock : productCreateForm.elements.stock?.value;
      return `Stock: ${Math.max(0, Math.round(Number(stock) || 0))}`;
    };
    const updatePreview = (imageDirection = 0, swipeOffset = 0) => {
      const selectedVariant = selectedPreviewVariant();
      const name = String(productCreateForm.elements.name?.value || "").trim();
      const category = String(productCreateForm.elements.category?.value || "").trim();
      const description = String(productCreateForm.elements.description?.value || "").trim();
      const price = selectedVariant ? selectedVariant.price : productCreateForm.elements.price?.value;
      setText("[data-product-live-name]", name || "Your product name");
      setText("[data-product-live-category]", category || "Product category");
      setText("[data-product-live-description]", description || "Add a clear description so customers immediately understand what they are buying.");
      setText("[data-product-live-price]", formatCreatorPrice(Math.max(0, Math.round(Number(price) || 0))));
      setText("[data-product-live-type]", typeName(currentType()));
      setText("[data-product-live-availability]", previewAvailability(selectedVariant));
      if (descriptionCount) descriptionCount.textContent = String(productCreateForm.elements.description?.value.length || 0);
      const useCustom = Boolean(previewUsesVariantImage && selectedVariant?.useCustomImage && selectedVariant.customImage?.url);
      const variantIndex = previewUsesVariantImage && selectedVariant && Number.isInteger(selectedVariant.imageIndex) ? selectedVariant.imageIndex : previewImageIndex;
      const source = useCustom ? selectedVariant.customImage.url : selectedImages[variantIndex]?.url || selectedImages[0]?.url || "";
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
      const show = Boolean(variantToggle?.checked && variants.length && groups.length);
      liveVariant.hidden = !show;
      liveVariant.replaceChildren();
      if (!show) { updatePreview(); return; }
      const first = variants[0];
      groups.forEach((group) => {
        const available = new Set(group.values);
        if (!available.has(liveOptionSelection[group.name])) liveOptionSelection[group.name] = first.options?.find((option) => option.option === group.name)?.value || group.values[0];
        const section = document.createElement("section");
        section.innerHTML = `<span>${escapeHtml(group.name)}</span><div>${group.values.map((value) => `<button type="button" class="${liveOptionSelection[group.name] === value ? "active" : ""}" data-live-option-name="${escapeHtml(group.name)}" data-live-option-value="${escapeHtml(value)}">${escapeHtml(value)}</button>`).join("")}</div>`;
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
        if (!String(source || "").startsWith("data:image/")) throw new Error("A product image could not be prepared for cloud storage.");
        image.cloudId = (await uploadCloudImage(source)).id;
      }
      for (const variant of variants) {
        if (!variant.useCustomImage || !variant.customImage || variant.customImage.cloudId) continue;
        const source = variant.customImage.data || variant.customImage.url;
        if (!String(source || "").startsWith("data:image/")) throw new Error("A variant image could not be prepared for cloud storage.");
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
        if (draftStatus) { draftStatus.classList.remove("is-saving"); draftStatus.innerHTML = "<i></i> Saved to cloud"; }
        if (announce) showToast(cloudEnabled ? "Product draft saved to cloud" : "Product draft saved");
      }).catch((error) => {
        if (draftStatus) { draftStatus.classList.remove("is-saving"); draftStatus.innerHTML = "<i></i> Cloud save needs attention"; }
        showError(error instanceof Error ? error.message : "The draft could not be saved to cloud.");
      });
      return draftSavePromise;
    };

    const addOptionGroup = (name = "", values = "") => {
      if (!optionGroups || optionGroups.children.length >= 3) return;
      const row = document.createElement("div"); row.className = "product-option-group";
      row.innerHTML = `<label><span>Option name</span><input type="text" maxlength="20" placeholder="Size" value="${escapeHtml(name)}" data-option-name></label><label><span>Values</span><input type="text" maxlength="180" placeholder="50 ml, 250 ml" value="${escapeHtml(values)}" data-option-values></label><button type="button" aria-label="Remove option group">×</button>`;
      row.querySelector("button").addEventListener("click", () => { row.remove(); variants = []; selectedVariantIds.clear(); renderVariants(); markDraftChanged(); });
      optionGroups.append(row);
    };

    const updateVariantSelection = () => {
      variantRows?.querySelectorAll(".product-variant-row").forEach((row) => {
        const selected = selectedVariantIds.has(row.dataset.variantId);
        row.classList.toggle("selected", selected);
        const checkbox = row.querySelector("[data-variant-select]"); if (checkbox) checkbox.checked = selected;
      });
      if (selectedCount) selectedCount.textContent = `${selectedVariantIds.size} selected`;
      if (selectAllVariants) { selectAllVariants.checked = variants.length > 0 && selectedVariantIds.size === variants.length; selectAllVariants.indeterminate = selectedVariantIds.size > 0 && selectedVariantIds.size < variants.length; }
      filterChips?.querySelectorAll("button").forEach((chip) => {
        const matches = variants.filter((variant) => variant.options?.some((option) => option.option === chip.dataset.optionName && option.value === chip.dataset.optionValue));
        chip.classList.toggle("active", matches.length > 0 && matches.every((variant) => selectedVariantIds.has(variant.id)));
      });
    };
    const renderVariantFilters = () => {
      if (!filterChips) return;
      filterChips.replaceChildren();
      optionSnapshot().forEach((group) => {
        const section = document.createElement("section");
        section.innerHTML = `<span>${escapeHtml(group.name)}</span><div>${group.values.map((value) => `<button type="button" data-option-name="${escapeHtml(group.name)}" data-option-value="${escapeHtml(value)}">All ${escapeHtml(value)}</button>`).join("")}</div>`;
        section.querySelectorAll("button").forEach((chip) => chip.addEventListener("click", () => {
          const matches = variants.filter((variant) => variant.options?.some((option) => option.option === chip.dataset.optionName && option.value === chip.dataset.optionValue));
          const deselect = matches.length && matches.every((variant) => selectedVariantIds.has(variant.id));
          matches.forEach((variant) => deselect ? selectedVariantIds.delete(variant.id) : selectedVariantIds.add(variant.id));
          updateVariantSelection();
        }));
        filterChips.append(section);
      });
    };
    const variantPhotoMarkup = (variant) => {
      const currentSource = variant.useCustomImage && variant.customImage?.url ? variant.customImage.url : Number.isInteger(variant.imageIndex) ? selectedImages[variant.imageIndex]?.url : selectedImages[0]?.url;
      const choices = selectedImages.length ? selectedImages.map((image, index) => `<button type="button" data-main-image-index="${index}"><img src="${image.url}" alt=""><span>${index === 0 ? "Main image" : `Image ${index + 1}`}</span></button>`).join("") : '<p>Upload main images first.</p>';
      return `<div class="product-variant-photo"><div class="product-variant-photo-source"><label class="product-variant-upload"><input type="file" accept="image/png,image/jpeg,image/webp,image/avif" data-variant-photo-input><span>${currentSource ? `<img src="${currentSource}" alt=""><b>${variant.useCustomImage ? "Replace" : "Upload"}</b>` : '<svg class="icon" aria-hidden="true"><use href="#icon-image"></use></svg><b>Upload</b>'}</span></label><details class="product-variant-main-picker"><summary aria-label="Choose a photo from main images"><svg class="icon" aria-hidden="true"><use href="#icon-chevron-down"></use></svg></summary><div>${choices}</div></details></div>${variant.useCustomImage ? '<button type="button" data-variant-photo-clear aria-label="Remove variant upload">×</button>' : ""}</div>`;
    };
    const renderVariants = () => {
      if (variantTable) variantTable.hidden = variants.length === 0;
      if (variantEmpty) variantEmpty.hidden = variants.length > 0;
      if (!variantRows) return;
      selectedVariantIds = new Set([...selectedVariantIds].filter((id) => variants.some((variant) => variant.id === id)));
      variantRows.replaceChildren();
      variants.forEach((variant, index) => {
        const physical = currentType() === "physical";
        const row = document.createElement("div"); row.className = "product-variant-row"; row.dataset.variantId = variant.id;
        row.innerHTML = `<span><input type="checkbox" data-variant-select aria-label="Select ${escapeHtml(variant.name)}"></span><b title="${escapeHtml(variant.name)}">${escapeHtml(compactVariantName(variant.name))}</b><label><span>Price</span><input type="number" min="1000" step="500" value="${variant.price}" data-variant-price></label><label ${physical ? "" : "hidden"}><span>Stock</span><input type="number" min="0" max="999999" value="${variant.stock}" data-variant-stock></label><label ${physical ? "" : "hidden"}><span>Weight</span><input type="number" min="1" max="50000" value="${variant.weightGrams || 500}" data-variant-weight></label><label><span>SKU</span><input type="text" maxlength="48" value="${escapeHtml(variant.sku)}" data-variant-sku></label>${variantPhotoMarkup(variant)}<button type="button" data-variant-remove aria-label="Remove ${escapeHtml(variant.name)}"><svg class="icon" aria-hidden="true"><use href="#icon-trash"></use></svg></button>`;
        row.querySelector("[data-variant-select]").addEventListener("change", (event) => { event.target.checked ? selectedVariantIds.add(variant.id) : selectedVariantIds.delete(variant.id); updateVariantSelection(); });
        row.querySelector("[data-variant-price]").addEventListener("input", (event) => { variant.price = Math.max(0, Math.round(Number(event.target.value) || 0)); updatePreview(); markDraftChanged(); });
        row.querySelector("[data-variant-stock]").addEventListener("input", (event) => { variant.stock = Math.max(0, Math.round(Number(event.target.value) || 0)); updatePreview(); markDraftChanged(); });
        row.querySelector("[data-variant-weight]").addEventListener("input", (event) => { variant.weightGrams = Math.max(0, Math.round(Number(event.target.value) || 0)); markDraftChanged(); });
        row.querySelector("[data-variant-sku]").addEventListener("input", (event) => { variant.sku = event.target.value.trim(); markDraftChanged(); });
        row.querySelectorAll("[data-main-image-index]").forEach((button) => button.addEventListener("click", () => { variant.imageIndex = Number(button.dataset.mainImageIndex); variant.useCustomImage = false; button.closest("details").open = false; renderVariants(); markDraftChanged(); }));
        row.querySelector("[data-variant-photo-input]").addEventListener("change", async (event) => {
          const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
          if (!allowedImageTypes.includes(file.type) || file.size > 2 * 1024 * 1024) { showError("Variant photos must be PNG, JPG, WebP, or AVIF and no larger than 2 MB."); return; }
          try { const data = await compressCreatorProductImage(file); variant.customImage = { data, url: data }; variant.useCustomImage = true; clearError(); renderVariants(); markDraftChanged(); }
          catch (error) { showError(error instanceof Error ? error.message : "That variant image could not be added."); }
        });
        row.querySelector("[data-variant-photo-clear]")?.addEventListener("click", () => { variant.customImage = null; variant.useCustomImage = false; renderVariants(); markDraftChanged(); });
        row.querySelector("[data-variant-remove]").addEventListener("click", () => { variants.splice(index, 1); selectedVariantIds.delete(variant.id); renderVariants(); markDraftChanged(); });
        variantRows.append(row);
      });
      q("[data-variant-stock-heading]")?.toggleAttribute("hidden", currentType() !== "physical");
      q("[data-variant-weight-heading]")?.toggleAttribute("hidden", currentType() !== "physical");
      q("[data-product-variant-batch]")?.querySelectorAll("[data-batch-physical]").forEach((field) => { field.hidden = currentType() !== "physical"; });
      renderVariantFilters(); updateVariantSelection(); syncLiveVariants();
    };
    const generateVariants = () => {
      clearError();
      const groups = optionSnapshot();
      if (!groups.length) { showError("Add at least one option name and comma-separated values before generating variants."); return; }
      const combinations = groups.reduce((list, group) => list.flatMap((combination) => group.values.map((value) => [...combination, { option: group.name, value }])), [[]]);
      if (combinations.length > 100) { showError("These options create more than 100 variants. Reduce the values before continuing."); return; }
      const previous = new Map(variants.map((variant) => [variant.name, variant]));
      const price = Math.max(1000, Math.round(Number(productCreateForm.elements.price?.value) || 75000));
      const stock = Math.max(0, Math.round(Number(productCreateForm.elements.stock?.value) || 0));
      const weightGrams = Math.max(1, Math.round(Number(productCreateForm.elements.weight?.value) || 500));
      variants = combinations.map((options, index) => {
        const name = options.map((option) => option.value).join(" · ");
        return previous.get(name) || { id: globalThis.crypto?.randomUUID?.() || `variant-${Date.now()}-${index}`, name, options, price, stock, weightGrams, sku: `VAR-${String(index + 1).padStart(3, "0")}`, imageIndex: null, useCustomImage: false };
      });
      renderVariants(); markDraftChanged();
    };

    const syncVariantMode = () => {
      const enabled = Boolean(variantToggle?.checked);
      if (variantBuilder) variantBuilder.hidden = !enabled;
      if (noVariants) noVariants.hidden = enabled;
      if (basePricingCard) basePricingCard.hidden = enabled;
      if (productCreateForm.elements.price) productCreateForm.elements.price.required = !enabled;
      if (enabled && optionGroups?.children.length === 0) { addOptionGroup("Size", "50 ml, 250 ml"); addOptionGroup("Flavor", "Peach, Original"); }
      syncLiveVariants(); markDraftChanged();
    };
    const syncType = () => {
      const type = currentType();
      productCreateForm.querySelectorAll("[data-product-physical]").forEach((field) => { field.hidden = type !== "physical"; });
      const digital = q("[data-product-digital]"); if (digital) digital.hidden = type !== "digital";
      const subscription = q("[data-product-subscription]"); if (subscription) subscription.hidden = type !== "subscription";
      if (imageRule) imageRule.querySelector("span").innerHTML = type === "physical" ? "<b>Physical products need 3–9 images.</b> The first image becomes the main catalog photo." : "<b>This product needs 1–9 images.</b> The first image becomes the main catalog photo.";
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
      optionGroups?.replaceChildren(); (snapshot.options || []).forEach((group) => addOptionGroup(group.name, (group.values || []).join(", ")));
      variants = (snapshot.variants || []).map((variant) => ({ ...variant, weightGrams: variant.weightGrams || 500, customImage: variant.customImage?.data ? { cloudId: variant.customImage.cloudId || null, data: variant.customImage.data, url: variant.customImage.data } : null }));
      previewDevice = snapshot.previewDevice === "mobile" ? "mobile" : "desktop";
      if (draftStatus) draftStatus.innerHTML = `<i></i> ${label}`;
    };
    const restoreDraft = () => {
      const draft = readProductDrafts().find((item) => item.id === draftId);
      if (draft) { restoreSnapshot(draft, editingProduct ? "Unsaved edits restored" : "Draft restored"); return; }
      if (editingProduct) restoreSnapshot(productSnapshot(editingProduct), "Product loaded");
    };

    variantToggle?.addEventListener("change", syncVariantMode);
    q("[data-add-option-group]")?.addEventListener("click", () => { addOptionGroup(); markDraftChanged(); });
    q("[data-generate-variants]")?.addEventListener("click", generateVariants);
    selectAllVariants?.addEventListener("change", () => { selectedVariantIds = selectAllVariants.checked ? new Set(variants.map((variant) => variant.id)) : new Set(); updateVariantSelection(); });
    q("[data-clear-variant-selection]")?.addEventListener("click", () => { selectedVariantIds.clear(); updateVariantSelection(); });
    q("[data-apply-variant-batch]")?.addEventListener("click", () => {
      if (!selectedVariantIds.size) { showError("Select at least one variant or use an All option filter first."); return; }
      const price = q("[data-batch-price]").value; const stock = q("[data-batch-stock]").value; const weight = q("[data-batch-weight]").value;
      if (price === "" && stock === "" && weight === "") { showError("Enter at least one batch value to apply."); return; }
      variants.filter((variant) => selectedVariantIds.has(variant.id)).forEach((variant) => { if (price !== "") variant.price = Math.max(0, Math.round(Number(price) || 0)); if (stock !== "") variant.stock = Math.max(0, Math.round(Number(stock) || 0)); if (weight !== "") variant.weightGrams = Math.max(0, Math.round(Number(weight) || 0)); });
      clearError(); renderVariants(); markDraftChanged(); showToast(`Updated ${selectedVariantIds.size} variants`);
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
    productCreateForm.addEventListener("input", () => { updatePreview(); markDraftChanged(); });
    productCreateForm.addEventListener("change", () => { updatePreview(); markDraftChanged(); });
    typeInput?.addEventListener("change", syncType);
    productCreateForm.addEventListener("submit", async (event) => {
      event.preventDefault(); clearError();
      if (!productCreateForm.reportValidity()) return;
      const type = currentType(); const minimum = type === "physical" ? 3 : 1;
      if (selectedImages.length < minimum || selectedImages.length > 9) { showError(`${typeName(type)} requires ${minimum === 3 ? "3–9" : "1–9"} images.`); return; }
      if (variantToggle.checked && !variants.length) { showError("Generate at least one variant, or turn off Has variants."); return; }
      if (variants.some((variant) => variant.price < 1000 || !variant.sku || (type === "physical" && variant.weightGrams < 1))) { showError("Every variant needs a valid price, SKU, and shipping weight."); return; }
      const interval = Math.max(1, Math.round(Number(productCreateForm.elements.interval?.value) || 1));
      submitButtons.forEach((button) => { button.disabled = true; button.dataset.originalText = button.textContent; button.textContent = editingProduct ? "Saving changes…" : "Creating product…"; });
      try {
        await ensureEditorMediaCloud();
        const images = await Promise.all(selectedImages.map(imageData));
        const suffix = globalThis.crypto?.randomUUID?.().replace(/-/g, "").slice(0, 10) || String(Date.now());
        const product = {
          id: editingProduct?.id || `custom-${suffix}`, sku: editingProduct?.sku || `EZK-${type.slice(0, 3).toUpperCase()}-${suffix.toUpperCase()}`, name: String(productCreateForm.elements.name.value).trim(), category: String(productCreateForm.elements.category.value).trim(), description: String(productCreateForm.elements.description.value).trim(), type,
          price: variantToggle.checked ? Math.min(...variants.map((variant) => variant.price)) : Math.round(Number(productCreateForm.elements.price.value) || 0), images, mediaIds: selectedImages.map((image) => image.cloudId), image: images[0],
          ...(type === "physical" ? { stock: variantToggle.checked ? variants.reduce((total, variant) => total + variant.stock, 0) : Math.max(0, Math.round(Number(productCreateForm.elements.stock.value) || 0)), weightGrams: variantToggle.checked ? Math.max(...variants.map((variant) => variant.weightGrams)) : Math.max(1, Math.round(Number(productCreateForm.elements.weight.value) || 0)) } : {}),
          ...(type === "digital" ? { digitalFileName: String(productCreateForm.elements.digital_name.value || "").trim() } : {}),
          ...(type === "subscription" ? { subscription: { interval, unit: String(productCreateForm.elements.unit.value || "month") } } : {}),
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
      finally { submitButtons.forEach((button) => { button.disabled = false; button.textContent = button.dataset.originalText || (editingProduct ? "Save changes" : "Create product"); }); }
    });

    restoreDraft(); syncVariantMode(); syncType(); syncPreviewDevice(); renderImages(); restoringDraft = false; updatePreview();
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
        row.innerHTML = `<input type="checkbox" name="starter_products[]" value="${product.id}" checked hidden><img src="${product.image}" alt=""><div><b>${escapeHtml(product.name)}</b><small>${escapeHtml(formatCreatorPrice(product.price))} · ${escapeHtml(typeLabel(product.type))}${escapeHtml(schedule)} · ${product.images.length} image${product.images.length === 1 ? "" : "s"}</small></div><button type="button" aria-label="Remove ${escapeHtml(product.name)}">×</button>`;
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
      if (productType === "subscription" && (interval < 1 || interval > 12)) { showError("Choose a billing interval from 1 to 12."); subscriptionInterval?.focus(); return; }
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
    const builtInCount = landingLibrary.querySelectorAll("[data-project-card]:not([data-custom-site])").length;
    const grid = landingLibrary.querySelector("[data-project-grid]");
    const dialog = document.getElementById("library-page-creator-dialog");
    const form = dialog?.querySelector("[data-library-page-form]");
    const advancedToggle = landingLibrary.querySelector("[data-advanced-mode]");
    const makePageSlug = (value) => normalize(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
    let customSites = readLandingSites();
    let slugEdited = false;
    hydrateCreatorCatalog(form);
    const creatorProducts = setupCreatorProducts(form);

    const projectTone = (products = []) => products.includes("coffee") ? "coffee" : products.includes("sambal") ? "chili" : "gold";
    const projectImage = (site) => {
      if (site.customProducts?.[0]?.image) return site.customProducts[0].image;
      const shared = readCatalogProducts().find((product) => (site.products || []).includes(product.id));
      if (shared?.image || shared?.images?.[0]) return shared.image || shared.images[0];
      if ((site.products || []).includes("coffee")) return "assets/products/kopi-susu.webp";
      if ((site.products || []).includes("sambal")) return "assets/products/sambal-roa.webp";
      return "assets/products/granola.webp";
    };
    const projectCard = (site) => {
      const tone = projectTone(site.products);
      const href = `?page=sites&edit=${encodeURIComponent(site.url)}`;
      const card = document.createElement("article");
      card.className = "landing-project-card";
      card.dataset.projectCard = "";
      card.dataset.customSite = "true";
      card.dataset.siteName = site.name;
      card.dataset.siteUrl = site.url;
      card.innerHTML = `<a class="landing-project-preview tone-${tone}" href="${href}" aria-label="Edit ${escapeHtml(site.name)}"><span class="project-browser"><i></i><i></i><i></i><small>${escapeHtml(site.url)}</small></span><span class="project-mini-page"><span><b>${escapeHtml(site.name)}</b><em>Shop now</em></span><span class="product-art"><img src="${projectImage(site)}" alt="" loading="lazy"></span><i></i><i></i><i></i></span><span class="project-edit-hint">Open editor</span></a><div class="landing-project-details"><div><span class="project-status draft"><i></i>Draft</span><h2><a href="${href}">${escapeHtml(site.name)}</a></h2><p>Your saved custom storefront, ready for responsive editing.</p></div><button type="button" data-project-menu aria-label="Project actions"><svg class="icon" aria-hidden="true"><use href="#icon-settings"></use></svg></button></div><footer><span><svg class="icon" aria-hidden="true"><use href="#icon-globe"></use></svg>${escapeHtml(site.url)}</span><a href="${href}">Edit page <svg class="icon" aria-hidden="true"><use href="#icon-chevron-right"></use></svg></a></footer>`;
      return card;
    };
    const closeProjectMenu = () => document.querySelector(".landing-project-menu")?.remove();
    const bindProjectMenus = () => landingLibrary.querySelectorAll("[data-project-menu]").forEach((button) => {
      button.onclick = (event) => {
        event.stopPropagation(); closeProjectMenu();
        const card = button.closest("[data-project-card]");
        if (!card?.dataset.customSite) { showToast("Built-in projects stay available as starting points"); return; }
        const menu = document.createElement("div");
        menu.className = "landing-project-menu";
        menu.innerHTML = '<button type="button">Delete project</button>';
        const rect = button.getBoundingClientRect();
        menu.style.left = `${Math.max(8, rect.right - 160)}px`; menu.style.top = `${rect.bottom + 5}px`;
        menu.querySelector("button").onclick = () => {
          if (!window.confirm(`Delete “${card.dataset.siteName}”? This removes its saved draft from this browser.`)) return;
          const url = card.dataset.siteUrl;
          customSites = customSites.filter((site) => site.url !== url);
          writeLandingSites(customSites);
          localStorage.removeItem(`ezkart:landing-builder:v3:${url}`);
          localStorage.removeItem(`ezkart:landing-builder:v2:${url}`);
          card.remove(); closeProjectMenu(); renderSummary(); showToast("Landing page deleted — one project space is available");
        };
        document.body.append(menu);
      };
    });
    const renderSummary = () => {
      const count = builtInCount + customSites.length;
      const advanced = landingAdvancedMode();
      const remaining = Math.max(0, 6 - count);
      landingLibrary.querySelector("[data-library-count]").textContent = String(count);
      landingLibrary.querySelector("[data-library-limit]").textContent = advanced ? "∞" : "6";
      landingLibrary.querySelector("[data-library-progress]").style.width = advanced ? "100%" : `${Math.min(100, count / 6 * 100)}%`;
      landingLibrary.querySelector("[data-library-cap-copy]").textContent = advanced ? "Advanced Mode is on. You can create more than 6 projects." : remaining ? `You can create ${remaining} more project${remaining === 1 ? "" : "s"}. Delete a draft to make space, or enable Advanced Mode.` : "Project limit reached. Delete one to return to 5, or enable Advanced Mode.";
      const newCard = landingLibrary.querySelector("[data-library-create-card]");
      newCard.disabled = !advanced && count >= 6;
      landingLibrary.querySelector("[data-new-card-copy]").textContent = advanced ? "Advanced Mode · unlimited" : remaining ? `${remaining} project space${remaining === 1 ? "" : "s"} available` : "6-project limit reached";
      updateLandingCountBadges(count);
    };
    const openCreator = () => {
      if (!landingAdvancedMode() && builtInCount + customSites.length >= 6) { showToast("Delete a project or enable Advanced Mode to create another"); return; }
      dialog?.showModal();
    };
    customSites.forEach((site) => grid?.insertBefore(projectCard(site), landingLibrary.querySelector("[data-library-create-card]")));
    bindProjectMenus(); renderSummary();
    landingLibrary.querySelectorAll("[data-library-create], [data-library-create-card]").forEach((button) => button.addEventListener("click", openCreator));
    advancedToggle.checked = landingAdvancedMode();
    advancedToggle.addEventListener("change", () => { localStorage.setItem(landingAdvancedModeKey, String(advancedToggle.checked)); renderSummary(); showToast(advancedToggle.checked ? "Advanced Mode enabled" : "Standard 6-project limit restored"); });
    document.addEventListener("click", closeProjectMenu);
    const nameInput = form?.elements.namedItem("page_name");
    const slugInput = form?.elements.namedItem("slug");
    slugInput?.addEventListener("input", () => { slugEdited = true; slugInput.value = makePageSlug(slugInput.value); });
    nameInput?.addEventListener("input", () => { if (!slugEdited && slugInput) slugInput.value = makePageSlug(nameInput.value); });
    form?.addEventListener("submit", (event) => {
      if (event.submitter?.value === "cancel") return;
      event.preventDefault();
      const products = [...form.querySelectorAll('input[name="starter_products[]"]:checked')].map((input) => input.value);
      if (!products.length) { showToast("Select at least one starting product"); return; }
      if (!form.reportValidity()) return;
      const site = { name: String(nameInput.value).trim(), url: `${makePageSlug(slugInput.value)}.ezkart.site`, products, customProducts: creatorProducts.selected(products) };
      if (customSites.some((item) => item.url === site.url) || landingLibrary.querySelector(`[data-site-url="${CSS.escape(site.url)}"]`)) { showToast("A page with this URL already exists"); return; }
      customSites.push(site);
      if (!writeLandingSites(customSites)) { customSites.pop(); return; }
      window.location.href = `?page=sites&edit=${encodeURIComponent(site.url)}`;
    });
    dialog?.addEventListener("close", () => { if (dialog.returnValue === "cancel") { form?.reset(); creatorProducts.reset(); slugEdited = false; } });
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
    const typeName = (type) => ({ physical: "Physical product", digital: "Digital product", subscription: "Subscription" }[type] || "Product");
    const clearError = () => { if (errorTarget) { errorTarget.hidden = true; errorTarget.textContent = ""; } };
    const showError = (message) => { if (errorTarget) { errorTarget.textContent = message; errorTarget.hidden = false; } };
    const syncType = () => {
      const type = String(typeInput?.value || "physical");
      form?.querySelectorAll("[data-catalog-physical]").forEach((field) => { field.hidden = type !== "physical"; });
      const digital = form?.querySelector("[data-catalog-digital]"); if (digital) digital.hidden = type !== "digital";
      const subscription = form?.querySelector("[data-catalog-subscription]"); if (subscription) subscription.hidden = type !== "subscription";
      if (imageRule) imageRule.textContent = `${type === "physical" ? "Physical products need 3–9 images" : "Products need 1–9 images"}. Maximum 2 MB each.`;
      clearError();
    };
    const updateCatalogStats = (products) => {
      const stats = document.querySelectorAll(".page-products .page-stat-strip article");
      const demoProductCount = Math.max(0, Number(productCatalogPage.dataset.demoProductCount) || 0);
      const demoStock = Math.max(0, Number(productCatalogPage.dataset.demoStock) || 0);
      const physicalStock = products.filter((product) => product.type === "physical").reduce((sum, product) => sum + Math.max(0, Number(product.stock) || 0), 0);
      if (stats[0]?.querySelector("strong")) stats[0].querySelector("strong").textContent = String(demoProductCount + products.length);
      if (stats[1]?.querySelector("strong")) stats[1].querySelector("strong").textContent = String(demoStock + physicalStock);
      if (stats[1]?.querySelector("p")) stats[1].querySelector("p").textContent = "Physical inventory only";
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
        card.innerHTML = `<span>${image ? `<img src="${image}" alt="">` : '<svg class="icon" aria-hidden="true"><use href="#icon-image"></use></svg>'}</span><div><b>${escapeHtml(draft.name || "Untitled product")}</b><small>${draft.hasVariants ? `${draft.variants?.length || 0} variants` : typeName(draft.fields?.type || "physical")} · ${escapeHtml(when)}</small></div><div><a href="?${continueQuery.toString().replaceAll("&", "&amp;")}">Continue</a><button type="button" aria-label="Delete ${escapeHtml(draft.name || "untitled product")} draft">×</button></div>`;
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
    const renderCatalog = () => {
      const products = readCatalogProducts();
      productCatalogPage.querySelectorAll("[data-custom-product]").forEach((card) => card.remove());
      productCatalogPage.querySelectorAll("[data-catalog-empty]").forEach((message) => message.remove());
      inventory?.querySelectorAll("[data-custom-product]").forEach((row) => row.remove());
      products.forEach((product) => {
        const type = ["physical", "digital", "subscription"].includes(product.type) ? product.type : "physical";
        const image = product.image || product.images?.[0] || "";
        const availability = type === "physical" ? `${Math.max(0, Number(product.stock) || 0)} in stock` : type === "digital" ? "Digital delivery" : `Every ${product.subscription?.interval || 1} ${product.subscription?.unit || "month"}`;
        const card = document.createElement("article");
        card.className = "product-card"; card.dataset.customProduct = product.id;
        card.innerHTML = `<span class="product-art"><img src="${image}" alt="${escapeHtml(product.name)}"><em>${product.images?.length || 1} image${(product.images?.length || 1) === 1 ? "" : "s"}</em></span><div class="product-card-body"><header><span class="product-card-type">${escapeHtml(product.category || typeName(type))}</span><em>Active</em></header><h2>${escapeHtml(product.name)}</h2><p>${escapeHtml(product.sku)}</p><div class="product-price"><strong>${escapeHtml(formatCreatorPrice(product.price))}</strong><small>${escapeHtml(availability)}</small></div><footer><div><small>Type</small><b>${escapeHtml(typeName(type))}</b></div><div><small>Revenue</small><b>Rp0</b></div><div class="product-card-actions"><a href="?page=product-new&amp;product=${encodeURIComponent(product.id)}">Edit</a><button class="product-delete" type="button">Delete</button></div></footer></div>`;
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
        if (inventory) {
          const row = document.createElement("article"); row.dataset.customProduct = product.id;
          row.innerHTML = `<span class="product-art"><img src="${image}" alt=""></span><div><b>${escapeHtml(product.name)}</b><small>${escapeHtml(product.sku)}</small></div><strong>${type === "physical" ? Math.max(0, Number(product.stock) || 0) : "∞"}</strong><span>${type === "physical" ? "15" : "—"}</span><em class="inventory-good">${type === "physical" ? "Healthy" : "Available"}</em>`;
          inventory.append(row);
        }
      });
      if ((Number(productCatalogPage.dataset.demoProductCount) || 0) + products.length === 0) {
        const empty = document.createElement("div");
        empty.className = "catalog-empty-note"; empty.dataset.catalogEmpty = "true";
        empty.innerHTML = '<b>Your catalog is empty.</b><span>Create your first product to start building this store.</span><a href="?page=product-new&amp;new=1">Create product</a>';
        productCatalogPage.append(empty);
      }
      updateCatalogStats(products); renderDrafts();
    };
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
      if (type === "subscription" && (interval < 1 || interval > 12)) { showError("Choose a billing interval from 1 to 12."); return; }
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
          ...(type === "subscription" ? { subscription: { interval, unit: String(values.get("unit") || "month") } } : {}),
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
    const productPrices = { granola: 58000, coffee: 79000, sambal: 46000 };
    const productNames = { granola: "Granola Madu Nusantara", coffee: "Kopi Susu Concentrate", sambal: "Sambal Roa Signature" };
    const productImages = { granola: "assets/products/granola.webp", coffee: "assets/products/kopi-susu.webp", sambal: "assets/products/sambal-roa.webp" };
    const productMeta = {
      granola: { type: "physical", weightGrams: 320, images: ["assets/products/granola.webp"] },
      coffee: { type: "physical", weightGrams: 650, images: ["assets/products/kopi-susu.webp"] },
      sambal: { type: "physical", weightGrams: 260, images: ["assets/products/sambal-roa.webp"] },
    };
    const sectionNames = { announcement: "Announcement", navigation: "Navigation", hero: "Hero", products: "Product collection", "image-story": "Image story", benefits: "Benefits", checkout: "Checkout", shipping: "Shipping" };
    const templateCatalog = {
      sora: { name: "Sora Modest", brand: "SORA", category: "Fashion", image: "assets/templates/fashion-terracotta.webp", accent: "#b54b36", page: "#f8f0e8", ink: "#30231f", surface: "#fffaf5", mode: "split-right", kicker: "MODERN MODEST WEAR", headline: "Made to move with your whole life.", body: "Considered silhouettes, breathable fabrics, and expressive color—designed in Jakarta for everyday confidence.", cta: "Explore the collection", story: "Quiet confidence, cut with intention.", storyBody: "Small production runs and thoughtful details make every piece feel personal.", announcement: "Complimentary nationwide delivery this week", entrance: "rise", hover: "lift" },
      embun: { name: "Embun Botanics", brand: "EMBUN", category: "Beauty", image: "assets/templates/skincare-sage.webp", accent: "#5d7450", page: "#eef1e7", ink: "#263126", surface: "#f9fbf5", mode: "split-left", kicker: "BOTANICAL SKINCARE", headline: "A calmer ritual for resilient skin.", body: "High-performance tropical botanicals, transparent formulation, and a routine made to feel beautifully simple.", cta: "Find your ritual", story: "Rooted in plants. Refined by science.", storyBody: "Every formula balances proven actives with ingredients grown closer to home.", announcement: "Free skin consultation with every first order", entrance: "blur", hover: "glow" },
      pulih: { name: "Ruang Pulih", brand: "PULIH", category: "Wellness", image: "assets/templates/wellness-bali.webp", accent: "#7b7656", page: "#f5f0e6", ink: "#282a24", surface: "#fffcf5", mode: "bleed-light", kicker: "MOVEMENT · BREATH · REST", headline: "Come back to yourself.", body: "Grounded classes, quiet rituals, and a caring community for strength that lasts beyond the studio.", cta: "View this week’s classes", story: "Wellness without performance.", storyBody: "Choose movement, guided rest, or a flexible membership that meets you where you are.", announcement: "First studio class is complimentary", entrance: "fade", hover: "scale" },
      tanah: { name: "Tanah Studio", brand: "TANAH", category: "Homeware", image: "assets/templates/homeware-clay.webp", accent: "#9a5437", page: "#e9dfd2", ink: "#2c241e", surface: "#f7f1e8", mode: "bleed-dark", kicker: "OBJECTS FOR DAILY LIVING", headline: "Useful things, made slowly.", body: "Hand-shaped ceramics and tactile home objects created in small batches across the archipelago.", cta: "Shop the new firing", story: "The hand of the maker stays visible.", storyBody: "Natural variation is not a flaw—it is the quiet signature of a real object.", announcement: "New studio firing available now", entrance: "slide-left", hover: "image-zoom" },
      senja: { name: "Kopi Senja", brand: "SENJA", category: "Coffee", image: "assets/products/kopi-susu.webp", accent: "#d28a3c", page: "#201a18", ink: "#fff4e7", surface: "#342824", mode: "editorial", kicker: "COFFEE FOR SLOWER HOURS", headline: "Deep flavor. Zero café queue.", body: "Small-batch concentrate brewed for effortless iced kopi susu at home.", cta: "Stock the fridge", story: "Brewed bold enough to stay balanced.", storyBody: "A café-style base tuned for milk, ice, and your preferred level of sweetness.", announcement: "Cold-brew bundle ships free today", entrance: "scale", hover: "glow" },
      timur: { name: "Dapur Timur", brand: "TIMUR!", category: "Food", image: "assets/products/sambal-roa.webp", accent: "#ff442f", page: "#ffe7d0", ink: "#2f1611", surface: "#fff7ed", mode: "split-right", kicker: "SMOKE · CHILI · MANADO", headline: "Turn the whole table up.", body: "Savory smoked roa, bright chili, and the kind of heat that keeps you reaching back in.", cta: "Get the sambal", story: "Big flavor from a small jar.", storyBody: "Built from real fish, honest aromatics, and a recipe made for rice, noodles, eggs—everything.", announcement: "Bundle three jars and save 15%", entrance: "slide-right", hover: "tilt" },
      pagi: { name: "Meja Pagi", brand: "PAGI", category: "Food", image: "assets/products/granola.webp", accent: "#ec8b25", page: "#fff5d8", ink: "#3c2c1d", surface: "#fffdf6", mode: "split-left", kicker: "BETTER EVERYDAY BREAKFAST", headline: "A brighter start, one bowl at a time.", body: "Toasty clusters, local honey, and generous nuts for mornings that deserve better than boring.", cta: "Build a breakfast box", story: "Real pantry ingredients. Serious crunch.", storyBody: "Made in small batches so every bag arrives fragrant, crisp, and ready for your morning ritual.", announcement: "Breakfast bundles delivered nationwide", entrance: "rise", hover: "lift" },
      mono: { name: "Mono Catalog", brand: "MONO—01", category: "Minimal", image: "assets/templates/homeware-clay.webp", accent: "#111111", page: "#f4f4f1", ink: "#111111", surface: "#ffffff", mode: "editorial", kicker: "PERMANENT COLLECTION 01", headline: "Less noise. Better objects.", body: "An uncompromising catalog for products that earn their place in your everyday.", cta: "Browse all objects", story: "Designed to outlast the moment.", storyBody: "A restrained material palette and details that reward a closer look.", announcement: "Edition 01 is now available", entrance: "fade", hover: "scale" },
      neon: { name: "Neon Drop", brand: "DROP//11", category: "Launch", image: "assets/products/kopi-susu.webp", accent: "#c6ff00", page: "#0e0e13", ink: "#f6f7ff", surface: "#1b1b24", mode: "bleed-dark", kicker: "LIMITED RELEASE · NO RESTOCK", headline: "Built to interrupt the scroll.", body: "A high-impact drop page for limited products, countdown energy, and a checkout that moves fast.", cta: "Enter the drop", story: "One release. One window.", storyBody: "Keep the story sharp, the imagery loud, and every path pointed toward checkout.", announcement: "Drop closes Sunday at 23:59 WIB", entrance: "flip", hover: "glow" },
      kisah: { name: "Kisah Visual", brand: "KISAH", category: "Portfolio", image: "assets/templates/fashion-terracotta.webp", accent: "#6f4cff", page: "#f3f0ff", ink: "#1f1831", surface: "#ffffff", mode: "bleed-light", kicker: "PHOTOGRAPHY · DIRECTION · CAMPAIGNS", headline: "Images with something to say.", body: "A portfolio-first storefront for commissions, print drops, and visual work that deserves room to breathe.", cta: "View selected work", story: "Campaign thinking, human feeling.", storyBody: "From a first creative brief to the final frame, every decision serves the story.", announcement: "Now booking Q4 campaigns", entrance: "blur", hover: "image-zoom" },
      kelas: { name: "Kelas Bertumbuh", brand: "BERTUMBUH", category: "Creator", image: "assets/templates/wellness-bali.webp", accent: "#405de6", page: "#eef3ff", ink: "#17203b", surface: "#ffffff", mode: "split-right", kicker: "LEARN · PRACTICE · GROW", headline: "A practical course for your next chapter.", body: "Structured lessons, a generous community, and clear momentum without the usual online-course overwhelm.", cta: "See the curriculum", story: "Progress you can actually feel.", storyBody: "Short lessons, useful exercises, and feedback loops designed around real schedules.", announcement: "Cohort enrollment is open", entrance: "slide-left", hover: "lift" },
      kanvas: { name: "Kanvas", brand: "KANVAS", category: "Image-led", image: "assets/templates/skincare-sage.webp", accent: "#ffffff", page: "#171717", ink: "#ffffff", surface: "#242424", mode: "image-led", kicker: "A SINGLE IDEA, FULL BLEED", headline: "Let the image carry the feeling.", body: "A cinematic starting point for campaigns that lead with art direction and keep copy deliberately spare.", cta: "Discover the story", story: "A flexible canvas, not a locked collage.", storyBody: "Replace the image, delete the copy, add custom code, or rebuild the composition from zero.", announcement: "New visual story live now", entrance: "scale", hover: "image-zoom" },
    };
    const undoStack = [];
    const redoStack = [];
    const spacingState = new Map();
    const inlineEditSnapshots = new WeakMap();
    let selectedSection = "announcement";
    let selectedElement = null;
    let selectedAction = null;
    let selectedImage = null;
    let selectedContent = null;
    let activeDevice = "desktop";
    let draggedSection = "";
    let draggedImage = null;
    let draggedElementId = "";
    let draggedImageSnapshot = null;
    let saveTimer;
    let zoom = 90;
    let activeSiteKey = sqStudio.querySelector("[data-sq-site].active")?.dataset.siteUrl || "default";
    let baseSiteState = null;
    const storageKeyFor = (site = activeSiteKey) => `ezkart:landing-builder:v3:${site}`;
    const legacyStorageKeyFor = (site = activeSiteKey) => `ezkart:landing-builder:v2:${site}`;

    const openSqPanel = (name) => {
      sqStudio.querySelectorAll("[data-sq-tab]").forEach((button) => button.classList.toggle("active", button.dataset.sqTab === name));
      sqStudio.querySelectorAll("[data-sq-panel]").forEach((panel) => panel.classList.toggle("active", panel.dataset.sqPanel === name));
      if (window.matchMedia("(max-width: 720px)").matches) sqStudio.classList.add("mobile-panel-open");
    };
    sqStudio.querySelectorAll("[data-sq-tab]").forEach((button) => button.addEventListener("click", () => openSqPanel(button.dataset.sqTab)));
    sqStudio.querySelectorAll("[data-sq-open-panel]").forEach((button) => button.addEventListener("click", () => openSqPanel(button.dataset.sqOpenPanel)));

    const selectedProducts = () => [...sqStudio.querySelectorAll("[data-sq-product]:checked")].map((input) => input.value);
    const previewSnapshotHtml = () => {
      if (!previewRoot) return "";
      const clone = previewRoot.cloneNode(true);
      clone.querySelectorAll(".sq-element-overlay, .sq-section-toolbar").forEach((overlay) => overlay.remove());
      clone.querySelectorAll(".sq-element-selected, .sq-image-selected, .sq-element-animate").forEach((element) => element.classList.remove("sq-element-selected", "sq-image-selected", "sq-element-animate"));
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
      catalog: { prices: { ...productPrices }, names: { ...productNames }, images: { ...productImages }, meta: JSON.parse(JSON.stringify(productMeta)) },
      version: 3,
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
    const persistCurrentState = () => {
      try {
        localStorage.setItem(storageKeyFor(), JSON.stringify(captureState()));
        return true;
      } catch (_) {
        if (saveState) saveState.textContent = "Saved for this session";
        return false;
      }
    };
    const markSqChanged = () => {
      if (!saveState) return;
      saveState.textContent = "Saving…";
      window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(() => { if (persistCurrentState()) saveState.textContent = "Saved just now"; }, 550);
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
    };

    const layoutKey = (device = activeDevice) => `layout${device[0].toUpperCase()}${device.slice(1)}`;
    const parseElementLayout = (element, device = activeDevice) => {
      const raw = element?.dataset[layoutKey(device)] || element?.dataset.layoutDesktop || "1,1,12,4";
      const [x, y, width, height] = raw.split(",").map((value) => Number.parseInt(value, 10));
      const safeWidth = Math.max(1, Math.min(12, width || 12));
      return {
        x: Math.max(1, Math.min(13 - safeWidth, x || 1)),
        y: Math.max(1, y || 1),
        width: safeWidth,
        height: Math.max(1, height || 4),
      };
    };
    const setElementLayout = (element, layout, device = activeDevice) => {
      if (!element) return;
      const width = Math.max(1, Math.min(12, Number(layout.width) || 1));
      const normalized = {
        x: Math.max(1, Math.min(13 - width, Number(layout.x) || 1)),
        y: Math.max(1, Math.min(30, Number(layout.y) || 1)),
        width,
        height: Math.max(1, Math.min(30, Number(layout.height) || 1)),
      };
      element.dataset[layoutKey(device)] = `${normalized.x},${normalized.y},${normalized.width},${normalized.height}`;
      if (device === activeDevice) {
        element.style.gridColumn = `${normalized.x} / span ${normalized.width}`;
        element.style.gridRow = `${normalized.y} / span ${normalized.height}`;
      }
      return normalized;
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
      const width = Math.max(1, Math.min(12, Number(desired.width) || 4));
      const height = Math.max(1, Math.min(30, Number(desired.height) || 2));
      const minimumRows = Math.max(1, Number.parseInt(section?.dataset.sqMinRows || section?.dataset.sqRows || "12", 10));
      const occupied = [...(section?.querySelectorAll(":scope > [data-sq-element]") || [])]
        .filter((element) => !element.classList.contains("sq-element-hidden"))
        .map((element) => parseElementLayout(element, device));
      const maximumOccupiedRow = occupied.reduce((maximum, layout) => Math.max(maximum, layout.y + layout.height - 1), minimumRows);
      const preferredX = Math.max(1, Math.round((13 - width) / 2));
      const preferredY = Math.max(1, Math.round((minimumRows - height) / 2) + 1);
      const xCandidates = Array.from({ length: 13 - width }, (_, index) => index + 1)
        .sort((a, b) => Math.abs(a - preferredX) - Math.abs(b - preferredX));
      const rowsToSearch = Math.min(30 - height + 1, Math.max(minimumRows - height + 1, maximumOccupiedRow + 2));
      const yCandidates = Array.from({ length: rowsToSearch }, (_, index) => index + 1)
        .sort((a, b) => Math.abs(a - preferredY) - Math.abs(b - preferredY));
      for (const y of yCandidates) {
        for (const x of xCandidates) {
          const candidate = { x, y, width, height };
          if (!occupied.some((layout) => layoutsOverlap(candidate, layout))) return candidate;
        }
      }
      return { x: preferredX, y: Math.min(30 - height + 1, maximumOccupiedRow + 1), width, height };
    };
    const fluidRowHeight = (section, device = activeDevice) => {
      if (section?.classList.contains("sq-announcement")) return 10;
      if (section?.classList.contains("sq-store-nav")) return 36;
      if (section?.classList.contains("sq-benefit-row")) return device === "mobile" ? 34 : 22;
      if (section?.classList.contains("sq-shipping-section")) return 22;
      if (section?.classList.contains("sq-product-section")) return 28;
      return 34;
    };
    const applyFluidSection = (section) => {
      if (!section?.matches("[data-sq-fluid]")) return;
      if (!section.dataset.sqMinRows) section.dataset.sqMinRows = section.dataset.sqRows || "12";
      let rows = Number.parseInt(section.dataset.sqMinRows || "12", 10);
      section.querySelectorAll(":scope > [data-sq-element]").forEach((element) => {
        const layout = setElementLayout(element, parseElementLayout(element));
        applyProductGridLayout(element);
        rows = Math.max(rows, layout.y + layout.height - 1);
      });
      section.dataset.sqRows = String(rows);
      section.style.setProperty("--sq-fluid-rows", String(rows));
      section.style.setProperty("--sq-fluid-row-height", `${fluidRowHeight(section)}px`);
    };
    const applyFluidLayouts = () => previewRoot?.querySelectorAll("[data-sq-fluid]").forEach(applyFluidSection);
    const elementTypeName = (element) => (element?.dataset.sqElementType || "element").replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
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
        const isPanel = composite.classList.contains("sq-template-copy-overlay") || composite.closest(".sq-template-editorial");
        if (isPanel) {
          const panel = document.createElement("div");
          panel.className = "sq-template-copy-panel";
          panel.dataset.sqElement = "";
          panel.dataset.sqElementType = "hero-panel";
          ["desktop", "tablet", "mobile"].forEach((device) => setElementLayout(panel, parseElementLayout(composite, device), device));
          composite.before(panel);
        }
        pieces.forEach(([node, type, className]) => {
          node.className = `${node.className} ${className} ${isPanel ? "sq-template-overlay-piece" : ""}`.trim();
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
    };
    const colorToHex = (value, fallback = "#ffffff") => {
      if (/^#[0-9a-f]{6}$/i.test(value || "")) return value.toLowerCase();
      const match = String(value || "").match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
      return match ? `#${match.slice(1, 4).map((part) => Number(part).toString(16).padStart(2, "0")).join("")}` : fallback;
    };
    const codeSourceFor = (element) => element?.querySelector("template[data-sq-code-source]")?.innerHTML || "";
    const renderCodeElement = (element) => {
      const frame = element?.querySelector("iframe[data-sq-code-render]");
      if (!frame) return;
      const source = codeSourceFor(element);
      frame.onload = () => frame.contentWindow?.postMessage({ type: "ezkart-render-code", html: source }, "*");
      frame.src = `code-preview.php?render=${Date.now()}`;
    };
    const actionForElement = (element = selectedElement) => {
      if (selectedAction?.isConnected && element?.contains(selectedAction)) return selectedAction;
      if (element?.matches("button,a")) return element;
      return element?.querySelector("button,a") || null;
    };
    const imageForElement = (element = selectedElement) => {
      if (selectedImage?.isConnected && element?.contains(selectedImage)) return selectedImage;
      if (element?.matches("img")) return element;
      return element?.querySelector("img") || null;
    };
    const inferredActionType = (action) => {
      if (!action) return "none";
      if (action.dataset.sqLinkType) return action.dataset.sqLinkType;
      const href = action.getAttribute("href") || "";
      if (href.startsWith("#")) return "section";
      if (href.startsWith("mailto:")) return "email";
      if (href.startsWith("tel:")) return "phone";
      if (/checkout|buy now|secure checkout/i.test(action.textContent)) return "checkout";
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
    const imageFilterValue = (image, name) => Number(image?.dataset[`sqFilter${name[0].toUpperCase()}${name.slice(1)}`] ?? imageDefaults[name]);
    const applySelectedImageFilters = (image = imageForElement()) => {
      if (!image) return;
      image.style.filter = `blur(${imageFilterValue(image, "blur")}px) brightness(${imageFilterValue(image, "brightness")}%) contrast(${imageFilterValue(image, "contrast")}%) saturate(${imageFilterValue(image, "saturate")}%) grayscale(${imageFilterValue(image, "grayscale")}%) opacity(${imageFilterValue(image, "opacity")}%)`;
    };
    const syncElementControls = () => {
      const controls = sqStudio.querySelector("[data-sq-element-controls]");
      const valid = selectedElement?.isConnected && selectedElement.closest(`[data-section-id="${selectedSection}"]`);
      if (controls) controls.hidden = !valid;
      inspector?.classList.toggle("element-selected", Boolean(valid));
      if (!valid) {
        const context = sqStudio.querySelector("[data-sq-inspector-context]");
        if (context) context.textContent = "Selected section";
        const productControls = sqStudio.querySelector("[data-sq-product-layout-controls]");
        if (productControls) productControls.hidden = true;
        return;
      }
      const layout = parseElementLayout(selectedElement);
      const type = sqStudio.querySelector(".sq-element-controls [data-sq-element-type]");
      const isLogo = selectedElement.dataset.sqElementType === "logo";
      const isProductGrid = selectedElement.dataset.sqElementType === "product-grid";
      const action = isProductGrid ? null : actionForElement();
      const image = isLogo || isProductGrid ? null : imageForElement();
      const contentName = selectedContent?.matches("h1,h2,h3") ? "Heading" : selectedContent ? "Text" : "";
      const contextualName = isLogo ? "Logo" : selectedAction && action ? "Button" : selectedImage && image ? "Image" : contentName || elementTypeName(selectedElement);
      if (type) type.textContent = contextualName;
      const context = sqStudio.querySelector("[data-sq-inspector-context]");
      const title = sqStudio.querySelector("[data-sq-inspector-title]");
      if (context) context.textContent = "Selected element";
      if (title) title.textContent = contextualName;
      [["x", layout.x], ["y", layout.y], ["w", layout.width], ["h", layout.height]].forEach(([field, value]) => {
        const input = sqStudio.querySelector(`[data-sq-element-${field}]`);
        if (input) input.value = String(value);
      });
      const hideButton = sqStudio.querySelector("[data-sq-element-hide]");
      if (hideButton) hideButton.lastChild.textContent = selectedElement.classList.contains("sq-element-hidden") ? " Show" : " Hide";
      const computed = getComputedStyle(selectedElement);
      const colorFallbacks = { color: "#24262b", backgroundColor: "#ffffff", borderColor: "#e3e5e7" };
      sqStudio.querySelectorAll("[data-sq-element-color]").forEach((input) => { input.value = colorToHex(computed[input.dataset.sqElementColor], colorFallbacks[input.dataset.sqElementColor]); });
      const surface = sqStudio.querySelector("[data-sq-element-surface]");
      if (surface) surface.value = selectedElement.dataset.sqSurface || "none";
      const align = sqStudio.querySelector("[data-sq-element-align]");
      if (align) align.value = selectedElement.dataset.sqAlign || "left";
      const radius = Number.parseInt(selectedElement.style.borderRadius || "0", 10) || 0;
      const radiusInput = sqStudio.querySelector("[data-sq-element-radius]");
      const radiusOutput = sqStudio.querySelector("[data-sq-element-radius-output]");
      if (radiusInput) radiusInput.value = String(radius);
      if (radiusOutput) radiusOutput.textContent = `${radius}px`;
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
      const buttonRole = selectedElement.dataset.sqButtonRole || "primary";
      sqStudio.querySelectorAll("[data-sq-role-choice]").forEach((button) => button.classList.toggle("active", button.dataset.sqRoleChoice === buttonRole));
      const animation = sqStudio.querySelector("[data-sq-element-animation-control]");
      if (animation) animation.value = selectedElement.dataset.sqElementAnimation || "none";
      sqStudio.querySelectorAll("[data-sq-entrance-preview]").forEach((button) => button.classList.toggle("active", button.dataset.sqEntrancePreview === (selectedElement.dataset.sqElementAnimation || "none")));
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
      const isCode = selectedElement.dataset.sqElementType === "custom-code";
      if (codeControls) codeControls.hidden = !isCode;
      const codeInput = sqStudio.querySelector("[data-sq-code-input]");
      if (isCode && codeInput) codeInput.value = codeSourceFor(selectedElement);
      const textControls = sqStudio.querySelector("[data-sq-element-text-controls]");
      const textTarget = selectedContent?.isConnected && selectedElement.contains(selectedContent) && !selectedAction ? selectedContent : null;
      if (textControls) textControls.hidden = !textTarget;
      if (textTarget) {
        const textInput = sqStudio.querySelector("[data-sq-element-text]");
        const textLabel = sqStudio.querySelector("[data-sq-element-text-label]");
        if (textInput) textInput.value = textTarget.textContent.trim();
        if (textLabel) textLabel.textContent = textTarget.matches("h1,h2,h3") ? "Heading" : textTarget.matches("a") ? "Link label" : "Text content";
      }
      const imageControls = sqStudio.querySelector("[data-sq-image-controls]");
      if (imageControls) imageControls.hidden = !image;
      if (image) {
        const srcInput = sqStudio.querySelector("[data-sq-image-src]");
        const altInput = sqStudio.querySelector("[data-sq-image-alt]");
        const fitInput = sqStudio.querySelector("[data-sq-image-fit]");
        const positionInput = sqStudio.querySelector("[data-sq-image-position]");
        if (srcInput) srcInput.value = image.getAttribute("src") || "";
        if (altInput) altInput.value = image.getAttribute("alt") || "";
        if (fitInput) fitInput.value = image.style.objectFit || getComputedStyle(image).objectFit || "cover";
        const position = image.style.objectPosition || getComputedStyle(image).objectPosition || "center";
        if (positionInput) positionInput.value = ["center", "top", "bottom", "left", "right"].includes(position) ? position : "center";
        sqStudio.querySelectorAll("[data-sq-image-filter]").forEach((input) => {
          const name = input.dataset.sqImageFilter;
          const value = imageFilterValue(image, name);
          input.value = String(value);
          const output = sqStudio.querySelector(`[data-sq-image-output="${name}"]`);
          if (output) output.textContent = `${value}${name === "blur" ? "px" : "%"}`;
          });
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
    };
    const removeElementOverlay = () => previewRoot?.querySelectorAll(".sq-element-overlay").forEach((overlay) => overlay.remove());
    const refreshElementOverlay = () => {
      removeElementOverlay();
      if (!selectedElement?.isConnected) return;
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
      if (!element?.matches("[data-sq-element]")) return;
      selectedElement = element;
      selectedAction = action?.matches?.("button,a") && element.contains(action) ? action : null;
      selectedImage = image?.matches?.("img") && element.contains(image) ? image : null;
      selectedContent = content?.matches?.("[data-sq-editable]") && element.contains(content) ? content : null;
      removeSectionToolbar();
      previewRoot?.querySelectorAll(".sq-element-selected").forEach((item) => item.classList.remove("sq-element-selected"));
      element.classList.add("sq-element-selected");
      sqStudio.querySelectorAll("[data-sq-element-layer]").forEach((layer) => layer.classList.toggle("active", layer.dataset.sqElementLayer === element.dataset.sqElementId));
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
      remember();
      const section = selectedElement.closest("[data-sq-fluid]");
      selectedElement.remove();
      selectedElement = null;
      selectedAction = null;
      selectedImage = null;
      selectedContent = null;
      removeElementOverlay();
      applyFluidSection(section);
      rebuildLayerList();
      bindSqInteractions();
      syncElementControls();
      syncInspectorContent();
      markSqChanged();
      showToast("Element deleted — Undo is available");
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
        const rect = section.getBoundingClientRect();
        const renderedScale = section.offsetWidth ? rect.width / section.offsetWidth : 1;
        const computed = getComputedStyle(section);
        const horizontalPadding = Number.parseFloat(computed.paddingLeft) + Number.parseFloat(computed.paddingRight);
        const columnGap = Number.parseFloat(computed.columnGap) || 0;
        const columnWidth = (((section.clientWidth - horizontalPadding - columnGap * 11) / 12) + columnGap) * renderedScale;
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
          if (changed) { remember(snapshot); markSqChanged(); }
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", end, { once: true });
      };
    };

    const spacingKey = (section = selectedSection, device = activeDevice) => `${section}:${device}`;
    const defaultSpacing = () => {
      if (selectedSection === "announcement") return activeDevice === "mobile" ? { top: 7, right: 12, bottom: 7, left: 12 } : { top: 8, right: 18, bottom: 8, left: 18 };
      if (activeDevice === "mobile") return { top: 36, right: 22, bottom: 36, left: 22 };
      if (activeDevice === "tablet") return { top: 52, right: 38, bottom: 52, left: 38 };
      return { top: 70, right: 60, bottom: 70, left: 60 };
    };
    const readSpacing = () => spacingState.get(spacingKey()) || defaultSpacing();
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
      ".sq-free-heading>h2", ".sq-free-text>p", ".sq-free-button>button", ".sq-free-form>h3", ".sq-free-form>p",
      ".sq-template-story-copy>span", ".sq-template-story-copy>h2", ".sq-template-story-copy>p", ".sq-template-story-copy>button",
      ".sq-template-manifesto>b", ".sq-template-manifesto>small",
      ".sq-template-proof-heading>small", ".sq-template-proof-heading>h2", ".sq-template-proof-heading>p",
    ].join(",");
    const editableNodesFor = (block) => block ? [...block.querySelectorAll(editableContentSelector)].filter((node) => !node.closest(".sq-image-drag-handle")) : [];
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
      selectedSection = sectionId;
      sqStudio.classList.remove("mobile-panel-open");
      sqStudio.classList.remove("inspector-closed");
      inspector?.classList.remove("collapsed");
      sqStudio.querySelectorAll("[data-sq-layer]").forEach((layer) => layer.classList.toggle("active", layer.dataset.sectionId === sectionId));
      sqStudio.querySelectorAll("[data-sq-layer-group]").forEach((group) => group.classList.toggle("active", group.dataset.sectionId === sectionId));
      previewRoot?.querySelectorAll("[data-sq-block]").forEach((block) => block.classList.toggle("selected", block.dataset.sectionId === sectionId));
      const title = sqStudio.querySelector("[data-sq-inspector-title]");
      const layerTitle = sqStudio.querySelector(`[data-sq-layer][data-section-id="${sectionId}"] b`)?.textContent;
      if (title) title.textContent = layerTitle || sectionNames[sectionId] || "Section";
      const block = previewRoot?.querySelector(`[data-section-id="${sectionId}"]`);
      if (selectedElement && (focusSection || !block?.contains(selectedElement))) {
        selectedElement = null;
        selectedAction = null;
        selectedImage = null;
        selectedContent = null;
        previewRoot?.querySelectorAll(".sq-element-selected").forEach((item) => item.classList.remove("sq-element-selected"));
        removeElementOverlay();
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
      if (selectedElement) requestAnimationFrame(refreshElementOverlay);
      else requestAnimationFrame(refreshSectionToolbar);
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
        block.onclick = () => selectSqSection(block.dataset.sectionId);
        block.ondragstart = (event) => { draggedSection = block.dataset.sectionId; block.classList.add("dragging"); event.dataTransfer.effectAllowed = "move"; };
        block.ondragover = (event) => { event.preventDefault(); block.classList.add("drag-over"); };
        block.ondragleave = () => block.classList.remove("drag-over");
        block.ondrop = (event) => { event.preventDefault(); block.classList.remove("drag-over"); const rect = block.getBoundingClientRect(); reorderSection(draggedSection, block.dataset.sectionId, event.clientY > rect.top + rect.height / 2); };
        block.ondragend = () => { block.classList.remove("dragging"); previewRoot.querySelectorAll(".drag-over").forEach((item) => item.classList.remove("drag-over")); };
      });
      applyFluidLayouts();
      previewRoot?.querySelectorAll(".sq-free-code").forEach(renderCodeElement);
      previewRoot?.querySelectorAll("[data-sq-fluid] > [data-sq-element]").forEach((element, index) => {
        if (!element.dataset.sqElementId) element.dataset.sqElementId = `element-${Date.now()}-${index}`;
        if ((element.matches("button") || element.querySelector("button")) && !element.dataset.sqButtonRole) {
          element.dataset.sqButtonRole = element.dataset.sqElementType === "navigation" ? "secondary" : "primary";
          element.classList.add(`button-${element.dataset.sqButtonRole}`);
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
        element.onclick = (event) => {
          event.stopPropagation();
          const section = element.closest("[data-section-id]");
          if (section) selectSqSection(section.dataset.sectionId);
          const action = event.target.closest?.("button,a");
          const image = event.target.closest?.("img");
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
          content.contentEditable = "true";
          content.spellcheck = true;
          content.draggable = false;
          const startInlineEdit = () => {
            if (!inlineEditSnapshots.has(content)) inlineEditSnapshots.set(content, { state: captureState(), text: content.textContent, remembered: false });
          };
          content.onpointerdown = (event) => { event.stopPropagation(); startInlineEdit(); };
          content.onclick = (event) => {
            event.stopPropagation();
            if (content.matches("a,button")) event.preventDefault();
            selectSqSection(block.dataset.sectionId);
            selectSqElement(content.closest("[data-sq-element]"), content.matches("button,a") ? content : null, null, content);
          };
          content.ondragstart = (event) => event.stopPropagation();
          content.onfocus = startInlineEdit;
          content.onbeforeinput = startInlineEdit;
          content.oninput = () => {
            const before = inlineEditSnapshots.get(content);
            if (before && !before.remembered) { remember(before.state); before.remembered = true; }
            const inspectorField = sqStudio.querySelector(`[data-sq-content-field="${content.dataset.sqEditable}"]`);
            if (inspectorField) inspectorField.value = content.textContent.trim();
            markSqChanged();
          };
          content.onblur = () => inlineEditSnapshots.delete(content);
        });
      });
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
      upgradeLegacyStructure();
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
      bindSqInteractions();
      updateProductView();
      selectSqSection(state.selectedSection || "hero");
      syncBrandControls();
      markSqChanged();
    };
    undoButton?.addEventListener("click", () => {
      if (!undoStack.length) return;
      redoStack.push(captureState());
      restoreState(undoStack.pop());
      updateHistoryButtons();
    });
    redoButton?.addEventListener("click", () => {
      if (!redoStack.length) return;
      undoStack.push(captureState());
      restoreState(redoStack.pop());
      updateHistoryButtons();
    });

    sqStudio.querySelectorAll("[data-sq-product]").forEach(bindSqProductInput);

    const installCustomProduct = (product, checked = true) => {
      const id = String(product?.id || "").trim();
      const name = String(product?.name || "").trim();
      const price = Math.max(1000, Math.round(Number(product?.price) || 0));
      const images = Array.isArray(product?.images) && product.images.length ? product.images.slice(0, 9) : [product?.image].filter(Boolean);
      if (!id || !name || !price || !images.length) return null;
      const type = ["physical", "digital", "subscription"].includes(product.type) ? product.type : "physical";
      const typeName = { physical: "Physical product", digital: "Digital download", subscription: "Subscription" }[type];
      const schedule = type === "subscription" ? ` · every ${product.subscription?.interval || 1} ${product.subscription?.unit || "month"}` : "";
      const detail = type === "physical" ? `Ships at ${Math.max(1, Number(product.weightGrams) || 1)} g.` : type === "digital" ? `${product.digitalFileName || "Digital file"} · delivered after confirmed payment.` : "Recurring billing through Midtrans after merchant activation.";
      const imageUrl = String(images[0]);
      const safeName = escapeHtml(name);
      const safePrice = escapeHtml(formatRupiah(price));
      productNames[id] = name;
      productPrices[id] = price;
      productImages[id] = imageUrl;
      const variants = Array.isArray(product.variants) ? product.variants.slice(0, 100) : [];
      productMeta[id] = { type, images, ...(variants.length ? { options: Array.isArray(product.options) ? product.options : [], variants } : {}), ...(type === "physical" ? { weightGrams: Math.max(1, Number(product.weightGrams) || 1) } : {}), ...(type === "digital" ? { digitalFileName: String(product.digitalFileName || "") } : {}), ...(type === "subscription" ? { subscription: { interval: Math.max(1, Number(product.subscription?.interval) || 1), unit: product.subscription?.unit || "month" } } : {}) };

      const picker = sqStudio.querySelector(".sq-product-picker");
      let input = picker?.querySelector(`[data-sq-product][value="${CSS.escape(id)}"]`);
      if (picker && !input) {
        const label = document.createElement("label");
        label.innerHTML = `<input type="checkbox" value="${escapeHtml(id)}" data-sq-product${checked ? " checked" : ""}><span><span class="product-art"><img src="${imageUrl}" alt="${safeName}"></span><div><b>${safeName}</b><small>${safePrice} · ${typeName}</small></div><i>${iconMarkup("check-circle")}</i></span>`;
        picker.append(label); input = label.querySelector("[data-sq-product]"); bindSqProductInput(input);
      } else if (input && checked) input.checked = true;
      previewRoot?.querySelectorAll("[data-sq-product-grid]").forEach((grid) => {
        if (grid.querySelector(`[data-product-card="${CSS.escape(id)}"]`)) return;
        const card = document.createElement("article");
        card.dataset.productCard = id;
        card.dataset.productType = type;
        card.dataset.customCatalogProduct = "true";
        const variantPicker = variants.length ? `<label class="sq-product-variant"><span>Choose a variant</span><select data-sq-variant-picker>${variants.map((variant) => `<option value="${escapeHtml(variant.id)}" data-price="${Math.max(1000, Number(variant.price) || price)}" data-image="${escapeHtml(variant.image || imageUrl)}">${escapeHtml(variant.name)}</option>`).join("")}</select></label>` : "";
        card.innerHTML = `<span class="product-art"><img src="${imageUrl}" alt="${safeName}">${images.length > 1 ? `<em class="sq-media-count">+${images.length - 1} photos</em>` : ""}</span><div><small>${typeName}${escapeHtml(schedule)}</small><h3>${safeName}</h3><p>${escapeHtml(detail)}</p>${variantPicker}<footer><b>${safePrice}</b><button type="button">${type === "subscription" ? "Subscribe" : "Add to cart"}</button></footer></div>`;
        const variantSelect = card.querySelector("[data-sq-variant-picker]");
        variantSelect?.addEventListener("change", () => { const option = variantSelect.selectedOptions[0]; card.querySelector("footer b").textContent = formatRupiah(Number(option.dataset.price) || price); card.querySelector(".product-art img").src = option.dataset.image || imageUrl; });
        grid.append(card);
      });
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
      syncElementControls();
      if (selectedElement) requestAnimationFrame(refreshElementOverlay);
    }));
    deviceFrame?.addEventListener("transitionend", (event) => { if (event.propertyName === "width" && selectedElement?.isConnected) refreshElementOverlay(); });
    window.addEventListener("resize", () => { if (selectedElement?.isConnected) requestAnimationFrame(refreshElementOverlay); });

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
    sqStudio.querySelectorAll("[data-sq-element-color]").forEach((input) => {
      input.addEventListener("focus", rememberElementStyle);
      input.addEventListener("input", () => {
        if (!selectedElement?.isConnected) return;
        const property = input.dataset.sqElementColor;
        selectedElement.style[property] = input.value;
        if (property === "color") selectedElement.classList.add("sq-color-override");
        if (property === "borderColor" && getComputedStyle(selectedElement).borderStyle === "none") selectedElement.style.border = `1px solid ${input.value}`;
        markSqChanged();
      });
      input.addEventListener("change", finishElementStyle);
    });
    sqStudio.querySelector("[data-sq-element-surface]")?.addEventListener("change", (event) => {
      if (!selectedElement?.isConnected) return;
      remember();
      selectedElement.classList.remove("sq-surface-soft", "sq-surface-card", "sq-surface-outline", "sq-surface-glass");
      selectedElement.classList.remove("sq-color-override");
      selectedElement.dataset.sqSurface = event.currentTarget.value;
      if (event.currentTarget.value !== "none") selectedElement.classList.add(`sq-surface-${event.currentTarget.value}`);
      markSqChanged();
    });
    sqStudio.querySelector("[data-sq-element-align]")?.addEventListener("change", (event) => {
      if (!selectedElement?.isConnected) return;
      remember(); selectedElement.dataset.sqAlign = event.currentTarget.value; selectedElement.style.textAlign = event.currentTarget.value; markSqChanged();
    });
    sqStudio.querySelector("[data-sq-element-radius]")?.addEventListener("input", (event) => {
      if (!selectedElement?.isConnected) return;
      rememberElementStyle(); selectedElement.style.borderRadius = `${event.currentTarget.value}px`;
      const output = sqStudio.querySelector("[data-sq-element-radius-output]"); if (output) output.textContent = `${event.currentTarget.value}px`; markSqChanged();
    });
    sqStudio.querySelector("[data-sq-element-radius]")?.addEventListener("change", finishElementStyle);
    sqStudio.querySelector("[data-sq-element-style-reset]")?.addEventListener("click", () => {
      if (!selectedElement?.isConnected) return;
      remember();
      ["color", "backgroundColor", "border", "borderColor", "borderRadius", "textAlign", "boxShadow", "backdropFilter"].forEach((property) => { selectedElement.style[property] = ""; });
      selectedElement.classList.remove("sq-surface-soft", "sq-surface-card", "sq-surface-outline", "sq-surface-glass");
      delete selectedElement.dataset.sqSurface; delete selectedElement.dataset.sqAlign; syncElementControls(); markSqChanged();
    });
    sqStudio.querySelector("[data-sq-select-section]")?.addEventListener("click", () => selectSqSection(selectedSection, true));

    let textControlSnapshot;
    sqStudio.querySelector("[data-sq-element-text]")?.addEventListener("focus", () => { textControlSnapshot = captureState(); });
    sqStudio.querySelector("[data-sq-element-text]")?.addEventListener("input", (event) => {
      if (!selectedContent?.isConnected) return;
      selectedContent.textContent = event.currentTarget.value;
      const sectionField = sqStudio.querySelector(`[data-sq-content-field="${selectedContent.dataset.sqEditable}"]`);
      if (sectionField) sectionField.value = event.currentTarget.value;
      refreshElementOverlay(); markSqChanged();
    });
    sqStudio.querySelector("[data-sq-element-text]")?.addEventListener("change", () => { if (textControlSnapshot) remember(textControlSnapshot); textControlSnapshot = null; });

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
        finishImageEdit(); markSqChanged();
      });
    };
    updateImageTextSetting("[data-sq-image-src]", "src");
    updateImageTextSetting("[data-sq-image-alt]", "alt");
    [["[data-sq-image-fit]", "objectFit"], ["[data-sq-image-position]", "objectPosition"]].forEach(([selector, property]) => {
      sqStudio.querySelector(selector)?.addEventListener("change", (event) => {
        const image = imageForElement();
        if (!image) return;
        remember(); image.style[property] = event.currentTarget.value; markSqChanged();
      });
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
        remember(snapshot); syncElementControls(); markSqChanged(); showToast("Image replaced — effects stay editable");
      };
      reader.readAsDataURL(file);
      event.currentTarget.value = "";
    });
    sqStudio.querySelector("[data-sq-image-reset]")?.addEventListener("click", () => {
      const image = imageForElement();
      if (!image) return;
      remember();
      Object.keys(imageDefaults).forEach((name) => { delete image.dataset[`sqFilter${name[0].toUpperCase()}${name.slice(1)}`]; });
      image.style.filter = ""; image.style.objectFit = ""; image.style.objectPosition = "";
      syncElementControls(); markSqChanged();
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
    sqStudio.querySelector("[data-sq-logo-clear]")?.addEventListener("click", () => { if (!selectedLogoParts()) return; remember(); setLogoSource(""); showToast("Header switched to the brand name"); });
    sqStudio.querySelectorAll("[data-sq-role-choice]").forEach((button) => button.addEventListener("click", () => {
      if (!selectedElement?.isConnected) return;
      remember();
      selectedElement.classList.remove("button-primary", "button-secondary", "button-tertiary");
      selectedElement.classList.add(`button-${button.dataset.sqRoleChoice}`);
      selectedElement.dataset.sqButtonRole = button.dataset.sqRoleChoice;
      syncElementControls(); markSqChanged();
    }));
    const replayElementAnimation = () => {
      if (!selectedElement?.isConnected) return;
      selectedElement.classList.remove("sq-element-animate"); void selectedElement.offsetWidth; selectedElement.classList.add("sq-element-animate");
      window.setTimeout(() => selectedElement?.classList.remove("sq-element-animate"), 2400);
    };
    const replayVisibleTemplateAnimations = () => {
      const stage = sqStudio.querySelector(".sq-canvas-scroll")?.getBoundingClientRect();
      if (!stage) return;
      previewRoot?.querySelectorAll('[class*="element-animation-"]').forEach((element) => {
        const rect = element.getBoundingClientRect();
        if (rect.bottom < stage.top || rect.top > stage.bottom) return;
        element.classList.remove("sq-element-animate"); void element.offsetWidth; element.classList.add("sq-element-animate");
        window.setTimeout(() => element.classList.remove("sq-element-animate"), 2400);
      });
    };
    sqStudio.querySelector("[data-sq-element-animation-control]")?.addEventListener("change", (event) => {
      if (!selectedElement?.isConnected) return;
      remember();
      [...selectedElement.classList].filter((name) => name.startsWith("element-animation-")).forEach((name) => selectedElement.classList.remove(name));
      selectedElement.dataset.sqElementAnimation = event.currentTarget.value;
      if (event.currentTarget.value !== "none") selectedElement.classList.add(`element-animation-${event.currentTarget.value}`);
      replayElementAnimation(); markSqChanged();
    });
    sqStudio.querySelectorAll("[data-sq-entrance-preview]").forEach((button) => button.addEventListener("click", () => {
      const select = sqStudio.querySelector("[data-sq-element-animation-control]");
      if (!select) return;
      select.value = button.dataset.sqEntrancePreview;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      syncElementControls();
    }));
    [["duration", "--element-duration"], ["delay", "--element-delay"]].forEach(([field, property]) => {
      sqStudio.querySelector(`[data-sq-element-${field}]`)?.addEventListener("input", (event) => {
        if (!selectedElement?.isConnected) return;
        selectedElement.style.setProperty(property, `${event.currentTarget.value}ms`);
        const output = sqStudio.querySelector(`[data-sq-element-${field}-output]`); if (output) output.textContent = `${event.currentTarget.value}ms`;
        replayElementAnimation(); markSqChanged();
      });
    });
    sqStudio.querySelectorAll("[data-sq-hover-choice]").forEach((button) => button.addEventListener("click", () => {
      if (!selectedElement?.isConnected) return;
      remember();
      [...selectedElement.classList].filter((name) => name.startsWith("hover-")).forEach((name) => selectedElement.classList.remove(name));
      selectedElement.dataset.sqHover = button.dataset.sqHoverChoice;
      if (button.dataset.sqHoverChoice !== "none") selectedElement.classList.add(`hover-${button.dataset.sqHoverChoice}`);
      syncElementControls(); markSqChanged();
    }));
    sqStudio.querySelector("[data-sq-element-replay]")?.addEventListener("click", replayElementAnimation);
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
        if (heroPieces.length) placeHeroCopy({ x: 2, y: 2, width: 10, height: Math.max(8, Number(section.dataset.sqRows || 12) - 2) });
        else if (copy) setElementLayout(copy, { x: 2, y: 1, width: 10, height: Math.max(6, Number(section.dataset.sqRows || 12)) });
      } else if (event.currentTarget.value === "image-only") {
        elements.forEach((element) => element.classList.toggle("sq-element-hidden", !images.includes(element)));
        images.forEach((element, index) => setElementLayout(element, { x: 1, y: 1 + index * 6, width: 12, height: Math.max(6, Number(section.dataset.sqRows || 12)) }));
      } else if (event.currentTarget.value === "single-image") {
        if (heroPieces.length) placeHeroCopy({ x: 1, y: 2, width: 6, height: 11 });
        else if (copy) setElementLayout(copy, { x: 1, y: 1, width: 6, height: 12 });
        images.slice(0, 1).forEach((element) => { element.classList.add("sq-single-image"); setElementLayout(element, { x: 7, y: 1, width: 6, height: 12 }); });
        images.slice(1).forEach((element) => element.classList.add("sq-element-hidden"));
      } else if (event.currentTarget.value === "stacked") {
        if (heroPieces.length) {
          placeHeroCopy({ x: 1, y: 1, width: 12, height: 8 });
          images.forEach((element, index) => setElementLayout(element, { x: 1, y: 9 + index * 8, width: 12, height: 8 }));
        } else {
          let row = 1;
          elements.forEach((element) => { setElementLayout(element, { x: 1, y: row, width: 12, height: 6 }); row += 6; });
        }
      } else {
        if (heroPieces.length) placeHeroCopy({ x: 1, y: 2, width: 6, height: 11 });
        else if (copy) setElementLayout(copy, { x: 1, y: 1, width: 6, height: 12 });
        images.forEach((element, index) => { setElementLayout(element, { x: 7, y: 1 + index * 6, width: 6, height: images.length > 1 ? 6 : 12 }); });
      }
      applyFluidSection(section);
      rebuildLayerList(); bindSqInteractions();
      syncElementControls();
      refreshElementOverlay();
      markSqChanged();
    });
    const replayAnimation = () => {
      const block = previewRoot?.querySelector(`[data-section-id="${selectedSection}"]`);
      if (!block) return;
      block.classList.remove("animating");
      void block.offsetWidth;
      block.classList.add("animating");
      window.setTimeout(() => block.classList.remove("animating"), 2700);
    };
    sqStudio.querySelector("[data-sq-animation]")?.addEventListener("change", (event) => {
      remember();
      const block = previewRoot?.querySelector(`[data-section-id="${selectedSection}"]`);
      if (!block) return;
      block.classList.remove("animation-fade", "animation-slide-up", "animation-slide-left", "animation-scale");
      block.dataset.animation = event.currentTarget.value;
      if (event.currentTarget.value !== "none") block.classList.add(`animation-${event.currentTarget.value}`);
      replayAnimation(); markSqChanged();
    });
    [["duration", "animation-duration", "ms"], ["delay", "animation-delay", "ms"]].forEach(([field, property, suffix]) => {
      sqStudio.querySelector(`[data-sq-${field}]`)?.addEventListener("input", (event) => {
        const block = previewRoot?.querySelector(`[data-section-id="${selectedSection}"]`);
        block?.style.setProperty(`--${property}`, `${event.currentTarget.value}${suffix}`);
        const output = sqStudio.querySelector(`[data-sq-${field}-output]`);
        if (output) output.textContent = `${event.currentTarget.value}${suffix}`;
        replayAnimation(); markSqChanged();
      });
    });
    sqStudio.querySelector("[data-sq-easing]")?.addEventListener("change", (event) => {
      previewRoot?.querySelector(`[data-section-id="${selectedSection}"]`)?.style.setProperty("--animation-easing", event.currentTarget.value);
      replayAnimation(); markSqChanged();
    });
    sqStudio.querySelector("[data-sq-replay]")?.addEventListener("click", replayAnimation);

    sqStudio.querySelector("[data-sq-content-width]")?.addEventListener("input", (event) => {
      const block = previewRoot?.querySelector(`[data-section-id="${selectedSection}"]`);
      if (block) { block.style.width = `${event.currentTarget.value}px`; block.style.maxWidth = "100%"; block.style.marginInline = "auto"; }
      const output = sqStudio.querySelector("[data-sq-width-output]");
      if (output) output.textContent = `${event.currentTarget.value}px`;
      markSqChanged();
    });
    sqStudio.querySelector("[data-sq-background]")?.addEventListener("change", (event) => {
      remember();
      const block = previewRoot?.querySelector(`[data-section-id="${selectedSection}"]`);
      block?.classList.remove("section-bg-light", "section-bg-white", "section-bg-dark", "section-bg-accent");
      block?.classList.add(`section-bg-${event.currentTarget.value}`);
      markSqChanged();
    });

    const brandVariable = { accent: "--site-accent", page: "--site-page", ink: "--site-ink", surface: "--site-surface" };
    let globalStyleSnapshot;
    const startGlobalStyleEdit = () => { if (!globalStyleSnapshot) globalStyleSnapshot = captureState(); };
    const finishGlobalStyleEdit = () => { if (globalStyleSnapshot) remember(globalStyleSnapshot); globalStyleSnapshot = null; };
    sqStudio.querySelectorAll("[data-sq-brand-color], [data-sq-button-color], [data-sq-button-radius]").forEach((input) => { input.addEventListener("focus", startGlobalStyleEdit); input.addEventListener("pointerdown", startGlobalStyleEdit); input.addEventListener("change", finishGlobalStyleEdit); });
    sqStudio.querySelectorAll("[data-sq-brand-color]").forEach((input) => input.addEventListener("input", () => {
      const key = input.dataset.sqBrandColor;
      previewRoot?.style.setProperty(brandVariable[key], input.value);
      if (key === "accent") previewRoot?.style.setProperty("--button-primary-bg", input.value);
      sqStudio.querySelectorAll("[data-sq-theme]").forEach((button) => button.classList.remove("active"));
      markSqChanged();
    }));
    const buttonDefaults = {
      primary: { bg: "#f44b34", fg: "#ffffff", border: "#f44b34", radius: 10, treatment: "solid" },
      secondary: { bg: "#ffffff", fg: "#24262b", border: "#24262b", radius: 10, treatment: "outline" },
      tertiary: { bg: "#ffffff", fg: "#f44b34", border: "#ffffff", radius: 0, treatment: "text" },
    };
    const activeButtonRole = () => sqStudio.querySelector("[data-sq-button-style-role]")?.value || "primary";
    const buttonValue = (role, field) => previewRoot?.style.getPropertyValue(`--button-${role}-${field}`).trim() || String(buttonDefaults[role][field]);
    const buttonTreatment = (role) => [...(previewRoot?.classList || [])].find((name) => name.startsWith(`buttons-${role}-`))?.replace(`buttons-${role}-`, "") || buttonDefaults[role].treatment;
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
      const preview = sqStudio.querySelector("[data-sq-button-preview]"); if (preview) { preview.classList.remove("button-primary", "button-secondary", "button-tertiary"); preview.classList.add(`button-${role}`); }
    };
    sqStudio.querySelector("[data-sq-button-style-role]")?.addEventListener("change", syncButtonSystemControls);
    sqStudio.querySelectorAll("[data-sq-button-color]").forEach((input) => input.addEventListener("input", () => {
      previewRoot?.style.setProperty(`--button-${activeButtonRole()}-${input.dataset.sqButtonColor}`, input.value); markSqChanged();
    }));
    sqStudio.querySelector("[data-sq-button-treatment]")?.addEventListener("change", (event) => { remember(); applyButtonTreatment(activeButtonRole(), event.currentTarget.value); markSqChanged(); });
    sqStudio.querySelector("[data-sq-button-radius]")?.addEventListener("input", (event) => {
      previewRoot?.style.setProperty(`--button-${activeButtonRole()}-radius`, `${event.currentTarget.value}px`);
      const output = sqStudio.querySelector("[data-sq-button-radius-output]"); if (output) output.textContent = `${event.currentTarget.value}px`; markSqChanged();
    });
    sqStudio.querySelectorAll("[data-sq-theme]").forEach((button) => button.addEventListener("click", () => {
      remember();
      sqStudio.querySelectorAll("[data-sq-theme]").forEach((item) => item.classList.toggle("active", item === button));
      previewRoot?.classList.remove("theme-coral", "theme-forest", "theme-indigo", "theme-charcoal");
      previewRoot?.classList.add(button.dataset.sqTheme);
      const colors = { "theme-coral": ["#f44b34", "#fffbf7", "#24262b", "#ffffff"], "theme-forest": ["#1c6b55", "#f1f5ef", "#17382e", "#ffffff"], "theme-indigo": ["#3f58a8", "#f1f3fb", "#1d2644", "#ffffff"], "theme-charcoal": ["#24262b", "#f4f4f2", "#24262b", "#ffffff"] }[button.dataset.sqTheme];
      ["accent", "page", "ink", "surface"].forEach((key, index) => { previewRoot?.style.setProperty(brandVariable[key], colors[index]); const input = sqStudio.querySelector(`[data-sq-brand-color="${key}"]`); if (input) input.value = colors[index]; });
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
    const templateHandle = (label) => `<button class="sq-block-handle" type="button" aria-label="Drag ${escapeHtml(label)} section">${iconMarkup("grip")}</button>`;
    const commerceSectionMarkup = (sectionId, animation = "rise", hover = "lift") => {
      const source = previewRoot?.querySelector(`[data-section-id="${sectionId}"]`);
      if (!source) return "";
      const clone = source.cloneNode(true);
      clone.querySelectorAll(".sq-element-overlay, .sq-section-toolbar").forEach((node) => node.remove());
      clone.classList.remove("selected", "section-hidden");
      clone.querySelectorAll(":scope > [data-sq-element]").forEach((element, index) => {
        [...element.classList].filter((name) => name.startsWith("element-animation-") || name.startsWith("hover-")).forEach((name) => element.classList.remove(name));
        element.classList.add(`element-animation-${animation}`);
        if (index > 0 && hover !== "none") element.classList.add(`hover-${hover}`);
        element.dataset.sqElementAnimation = animation;
        element.dataset.sqHover = index > 0 ? hover : "none";
        element.style.setProperty("--element-delay", `${index * 120}ms`);
      });
      return clone.outerHTML;
    };
    const templateHeroLayouts = (mode) => {
      if (mode === "split-left") return { copy: "7,2,6,12", image: "1,1,6,15", tabletCopy: "1,8,12,8", tabletImage: "1,1,12,7" };
      if (mode === "split-right") return { copy: "1,2,6,12", image: "7,1,6,15", tabletCopy: "1,1,12,8", tabletImage: "1,9,12,7" };
      if (mode === "editorial") return { copy: "7,3,6,11", image: "1,1,8,15", tabletCopy: "1,8,12,8", tabletImage: "1,1,12,8" };
      if (mode === "image-led") return { copy: "2,8,9,7", image: "1,1,12,15", tabletCopy: "1,8,12,8", tabletImage: "1,1,12,15" };
      return { copy: mode === "bleed-dark" ? "2,3,6,11" : "7,3,5,11", image: "1,1,12,15", tabletCopy: "1,8,12,8", tabletImage: "1,1,12,15" };
    };
    const makeTemplateMarkup = (config, key) => {
      const layout = templateHeroLayouts(config.mode);
      const overlay = config.mode.startsWith("bleed") || config.mode === "image-led";
      const hasCopyPanel = overlay || config.mode === "editorial";
      const imagePosition = ["embun", "pulih"].includes(key) ? "center" : key === "sora" ? "center right" : "center";
      const parseLayoutString = (value) => { const [x, y, width, height] = value.split(",").map(Number); return { x, y, width, height }; };
      const mobileCopy = "1,8,12,8";
      const pieceAttributes = (role) => {
        const desktop = heroPieceLayout(parseLayoutString(layout.copy), role);
        const tablet = heroPieceLayout(parseLayoutString(layout.tabletCopy), role);
        const mobile = heroPieceLayout(parseLayoutString(mobileCopy), role);
        const format = (value) => `${value.x},${value.y},${value.width},${value.height}`;
        return `data-layout-desktop="${format(desktop)}" data-layout-tablet="${format(tablet)}" data-layout-mobile="${format(mobile)}"`;
      };
      const overlayClass = overlay ? " sq-template-overlay-piece" : "";
      const panel = hasCopyPanel ? `<div class="sq-template-copy-panel${overlay ? " sq-template-copy-panel-overlay" : ""}" data-sq-element data-sq-element-type="hero-panel" data-sq-hover="none" data-layout-desktop="${layout.copy}" data-layout-tablet="${layout.tabletCopy}" data-layout-mobile="${mobileCopy}"></div>` : "";
      const hero = `<section class="sq-page-block sq-hero sq-hero-elements sq-template-hero sq-template-${config.mode}" draggable="true" data-sq-block data-sq-fluid data-sq-rows="15" data-section-id="hero">${templateHandle("hero")}<div class="sq-template-media sq-free-image element-animation-scale hover-${config.hover}" data-sq-element data-sq-element-type="image" data-sq-element-animation="scale" data-sq-hover="${config.hover}" data-layout-desktop="${layout.image}" data-layout-tablet="${layout.tabletImage}" data-layout-mobile="${overlay ? "1,1,12,15" : "1,1,12,7"}"><img src="${config.image}" alt="${escapeHtml(config.name)} campaign" style="object-position:${imagePosition}"></div>${panel}<span class="sq-hero-kicker sq-template-copy-piece${overlayClass} element-animation-${config.entrance}" data-sq-element data-sq-element-type="eyebrow" data-sq-element-animation="${config.entrance}" data-sq-hover="none" ${pieceAttributes("eyebrow")}>${escapeHtml(config.kicker)}</span><h1 class="sq-hero-heading sq-template-copy-piece${overlayClass} element-animation-${config.entrance}" data-sq-element data-sq-element-type="heading" data-sq-element-animation="${config.entrance}" data-sq-hover="none" ${pieceAttributes("heading")}>${escapeHtml(config.headline)}</h1><p class="sq-hero-description sq-template-copy-piece${overlayClass} element-animation-${config.entrance}" data-sq-element data-sq-element-type="text" data-sq-element-animation="${config.entrance}" data-sq-hover="none" ${pieceAttributes("text")}>${escapeHtml(config.body)}</p><button class="sq-hero-action sq-template-copy-piece${overlayClass} button-primary element-animation-${config.entrance}" type="button" data-sq-element data-sq-element-type="button" data-sq-button-role="primary" data-sq-link-type="checkout" data-sq-link="" data-sq-new-tab="false" data-sq-element-animation="${config.entrance}" data-sq-hover="none" ${pieceAttributes("button")}>${escapeHtml(config.cta)}</button><small class="sq-hero-trust sq-template-copy-piece${overlayClass} element-animation-${config.entrance}" data-sq-element data-sq-element-type="trust-note" data-sq-element-animation="${config.entrance}" data-sq-hover="none" ${pieceAttributes("trust")}>${iconMarkup("shield")} Secure checkout by Ezkart</small></section>`;
      const story = `<section class="sq-page-block sq-template-story" draggable="true" data-sq-block data-sq-fluid data-sq-rows="11" data-section-id="image-story">${templateHandle("story")}<div class="sq-template-story-copy element-animation-slide-left" data-sq-element data-sq-element-type="copy" data-sq-element-animation="slide-left" data-sq-hover="none" data-layout-desktop="1,2,8,9" data-layout-tablet="1,1,12,7" data-layout-mobile="1,1,12,7"><span>OUR POINT OF VIEW</span><h2>${escapeHtml(config.story)}</h2><p>${escapeHtml(config.storyBody)}</p><button class="button-tertiary" type="button">Read our story</button></div><aside class="sq-template-manifesto sq-surface-card element-animation-rise hover-lift" data-sq-element data-sq-element-type="content" data-sq-element-animation="rise" data-sq-hover="lift" data-layout-desktop="9,2,4,9" data-layout-tablet="1,8,12,4" data-layout-mobile="1,8,12,4"><strong>01</strong><b>Designed locally</b><small>Built for independent Indonesian brands and their customers.</small></aside></section>`;
      const benefits = `<section class="sq-page-block sq-benefit-row sq-template-benefits" draggable="true" data-sq-block data-sq-fluid data-sq-rows="6" data-section-id="benefits">${templateHandle("benefits")}<article class="element-animation-rise hover-lift" style="--element-delay:0ms" data-sq-element data-sq-element-type="benefit" data-sq-element-animation="rise" data-sq-hover="lift" data-layout-desktop="1,1,4,6" data-layout-tablet="1,1,4,6" data-layout-mobile="1,1,12,2">${iconMarkup("star")}<div><b>Thoughtful by default</b><small>Clear details and deliberate design</small></div></article><article class="element-animation-rise hover-lift" style="--element-delay:140ms" data-sq-element data-sq-element-type="benefit" data-sq-element-animation="rise" data-sq-hover="lift" data-layout-desktop="5,1,4,6" data-layout-tablet="5,1,4,6" data-layout-mobile="1,3,12,2">${iconMarkup("credit-card")}<div><b>Secure payment</b><small>Midtrans-ready checkout built in</small></div></article><article class="element-animation-rise hover-lift" style="--element-delay:280ms" data-sq-element data-sq-element-type="benefit" data-sq-element-animation="rise" data-sq-hover="lift" data-layout-desktop="9,1,4,6" data-layout-tablet="9,1,4,6" data-layout-mobile="1,5,12,2">${iconMarkup("truck")}<div><b>Delivery connected</b><small>Rates, couriers, and ETA included</small></div></article></section>`;
      const reviews = `<section class="sq-page-block sq-generated-reviews sq-template-proof" draggable="true" data-sq-block data-sq-fluid data-sq-rows="9" data-section-id="reviews">${templateHandle("reviews")}<div class="sq-template-proof-heading element-animation-fade" data-sq-element data-sq-element-type="copy" data-sq-element-animation="fade" data-sq-hover="none" data-layout-desktop="1,1,4,9" data-layout-tablet="1,1,12,3" data-layout-mobile="1,1,12,3"><small>Loved by customers</small><h2>Proof that feels human.</h2><p>Specific, credible social proof close to the buying decision.</p></div><article class="element-animation-rise hover-lift" data-sq-element data-sq-element-type="review" data-sq-element-animation="rise" data-sq-hover="lift" data-layout-desktop="5,1,4,9" data-layout-tablet="1,4,6,6" data-layout-mobile="1,4,12,5"><span>★★★★★</span><b>“The quality was obvious from the first use.”</b><small>Nadia · verified customer</small></article><article class="element-animation-rise hover-lift" style="--element-delay:140ms" data-sq-element data-sq-element-type="review" data-sq-element-animation="rise" data-sq-hover="lift" data-layout-desktop="9,1,4,9" data-layout-tablet="7,4,6,6" data-layout-mobile="1,9,12,5"><span>★★★★★</span><b>“Beautifully packed and genuinely easy to order.”</b><small>Raka · verified customer</small></article></section>`;
      const faq = `<section class="sq-page-block sq-generated-faq sq-template-faq" draggable="true" data-sq-block data-sq-fluid data-sq-rows="12" data-section-id="faq">${templateHandle("FAQ")}<h2 class="element-animation-fade" data-sq-element data-sq-element-type="heading" data-sq-element-animation="fade" data-sq-hover="none" data-layout-desktop="1,1,5,5" data-layout-tablet="1,1,12,3" data-layout-mobile="1,1,12,3">Everything you need to order confidently.</h2><details open data-sq-element data-sq-element-type="faq" data-layout-desktop="7,1,6,4" data-layout-tablet="1,4,12,3" data-layout-mobile="1,4,12,3"><summary>How does payment work?</summary><p>Checkout is secured by Midtrans and connected directly to this page.</p></details><details data-sq-element data-sq-element-type="faq" data-layout-desktop="7,5,6,4" data-layout-tablet="1,7,12,3" data-layout-mobile="1,7,12,3"><summary>When will my order arrive?</summary><p>Live courier options, price, and estimated delivery time appear at checkout.</p></details><details data-sq-element data-sq-element-type="faq" data-layout-desktop="7,9,6,4" data-layout-tablet="1,10,12,3" data-layout-mobile="1,10,12,3"><summary>Can I buy more than one item?</summary><p>Yes. Build a basket from any connected products and pay once.</p></details></section>`;
      const announcement = `<section class="sq-page-block sq-announcement" draggable="true" data-sq-block data-sq-fluid data-sq-rows="2" data-section-id="announcement">${templateHandle("announcement")}<p class="element-animation-fade" data-sq-element data-sq-element-type="text" data-sq-element-animation="fade" data-sq-hover="none" data-layout-desktop="1,1,12,2" data-layout-tablet="1,1,12,2" data-layout-mobile="1,1,12,2">${escapeHtml(config.announcement)}</p></section>`;
      const navigation = `<nav class="sq-page-block sq-store-nav" draggable="true" data-sq-block data-sq-fluid data-sq-rows="2" data-section-id="navigation">${templateHandle("navigation")}<div class="sq-site-logo element-animation-fade" data-sq-element data-sq-element-type="logo" data-sq-element-animation="fade" data-sq-hover="none" data-layout-desktop="1,1,4,2" data-layout-tablet="1,1,5,2" data-layout-mobile="1,1,6,2"><img data-sq-logo-image alt="" hidden><b data-sq-logo-text>${escapeHtml(config.brand)}</b></div><div class="button-secondary element-animation-fade" data-sq-element data-sq-element-type="navigation" data-sq-button-role="secondary" data-sq-element-animation="fade" data-sq-hover="none" data-layout-desktop="7,1,6,2" data-layout-tablet="6,1,7,2" data-layout-mobile="7,1,6,2"><a href="#products">Shop</a><a href="#story">Story</a><a href="#shipping">Delivery</a><button type="button">Buy now</button></div></nav>`;
      const linkedStory = story.replace('<section class="', '<section id="story" class="').replace('sq-template-story-copy element-animation', 'sq-template-story-copy button-tertiary element-animation').replace('data-sq-element data-sq-element-type="copy"', 'data-sq-element data-sq-element-type="copy" data-sq-button-role="tertiary"').replace('<button class="button-tertiary"', '<button');
      return `${announcement}${navigation}${hero}${linkedStory}${commerceSectionMarkup("products", "rise", config.hover)}${reviews}${benefits}${faq}${commerceSectionMarkup("checkout", config.entrance, "lift")}${commerceSectionMarkup("shipping", "fade", "none")}`;
    };
    const layerDetails = {
      announcement: ["Announcement", "Promotional message", "message"], navigation: ["Navigation", "Brand, links, and button", "layout"], hero: ["Hero", "Image, copy, and motion", "layout"], products: ["Product collection", "Connected commerce grid", "box"], "image-story": ["Brand story", "Editorial content", "image"], reviews: ["Customer proof", "Conversion-focused reviews", "star"], benefits: ["Benefits", "Three trust points", "star"], faq: ["FAQ", "Purchase objections answered", "help"], checkout: ["Checkout", "Midtrans cart action", "credit-card"], shipping: ["Shipping", "Courier and ETA", "truck"],
    };
    const elementLayerIcon = (type) => ({ image: "image", collage: "image", logo: "image", button: "play", checkout: "credit-card", "product-grid": "box", navigation: "layout", benefit: "star", review: "star", faq: "help", icon: "star", "custom-code": "code" })[type] || "message";
    const elementLayerPreview = (element) => {
      const image = element.querySelector("img");
      if (image?.alt) return image.alt;
      const text = element.textContent.replace(/\s+/g, " ").trim();
      return text ? (text.length > 46 ? `${text.slice(0, 43)}…` : text) : "Visual element";
    };
    const rebuildLayerList = () => {
      if (!layerList) return;
      layerList.replaceChildren(...[...(previewRoot?.querySelectorAll(":scope > [data-sq-block]") || [])].map((section) => {
        const sectionId = section.dataset.sectionId;
        const detailKey = Object.keys(layerDetails).sort((a, b) => b.length - a.length).find((key) => sectionId === key || sectionId.startsWith(`${key}-`));
        const details = layerDetails[detailKey] || [elementTypeName(section), "Editable section", "layers"];
        const elements = [...section.querySelectorAll(":scope > [data-sq-element]")];
        elements.forEach((element, index) => { if (!element.dataset.sqElementId) element.dataset.sqElementId = `element-${sectionId.replace(/[^a-z0-9-]/gi, "-")}-${index + 1}-${Date.now()}`; });
        const wrapper = document.createElement("div");
        wrapper.className = `sq-layer-group${sectionId === selectedSection ? " active" : ""}${section.classList.contains("section-hidden") ? " section-hidden" : ""}`;
        wrapper.dataset.sqLayerGroup = "";
        wrapper.dataset.sectionId = sectionId;
        wrapper.innerHTML = `<button type="button" draggable="true" data-sq-layer data-section-id="${escapeHtml(sectionId)}">${iconMarkup("grip")}<span>${iconMarkup(details[2])}</span><div><b>${escapeHtml(details[0])}</b><small>${elements.length} element${elements.length === 1 ? "" : "s"} · ${escapeHtml(details[1])}</small></div>${iconMarkup("chevron-right")}</button><div class="sq-layer-elements" aria-label="${escapeHtml(details[0])} elements">${elements.map((element) => `<button type="button" draggable="true" class="${element.classList.contains("sq-element-hidden") ? "element-hidden" : ""}" data-sq-element-layer="${escapeHtml(element.dataset.sqElementId)}"><span>${iconMarkup(elementLayerIcon(element.dataset.sqElementType))}</span><div><b>${escapeHtml(elementTypeName(element))}</b><small>${escapeHtml(elementLayerPreview(element))}</small></div>${iconMarkup("chevron-right")}</button>`).join("")}</div>`;
        return wrapper;
      }));
    };
    const syncBrandControls = () => {
      const computed = getComputedStyle(previewRoot);
      ["accent", "page", "ink", "surface"].forEach((key) => { const input = sqStudio.querySelector(`[data-sq-brand-color="${key}"]`); if (input) input.value = colorToHex(computed.getPropertyValue(brandVariable[key]), input.value); });
      syncButtonSystemControls();
    };
    sqStudio.querySelectorAll("[data-sq-template]").forEach((button) => button.addEventListener("click", () => {
      const config = templateCatalog[button.dataset.sqTemplate];
      if (!config || !previewRoot) return;
      remember(); selectedElement = null; selectedAction = null; selectedImage = null; selectedContent = null; removeElementOverlay(); removeSectionToolbar();
      previewRoot.innerHTML = makeTemplateMarkup(config, button.dataset.sqTemplate);
      previewRoot.className = `sq-page-preview radius-soft layout-rich template-${button.dataset.sqTemplate}`;
      previewRoot.setAttribute("style", `--site-accent:${config.accent};--site-page:${config.page};--site-ink:${config.ink};--site-surface:${config.surface};--button-primary-bg:${config.accent};--button-primary-fg:${config.mode === "image-led" ? "#171717" : "#ffffff"};--button-primary-border:${config.accent};--button-primary-radius:12px;--button-secondary-bg:${config.surface};--button-secondary-fg:${config.ink};--button-secondary-border:${config.ink};--button-secondary-radius:12px;--button-tertiary-bg:transparent;--button-tertiary-fg:${config.accent};--button-tertiary-border:transparent;--button-tertiary-radius:0px`);
      applyButtonTreatment("primary", "solid"); applyButtonTreatment("secondary", "outline"); applyButtonTreatment("tertiary", "text");
      rebuildLayerList(); bindSqInteractions(); updateProductView(); selectSqSection("hero"); syncBrandControls();
      sqStudio.querySelectorAll("[data-sq-template]").forEach((item) => item.classList.toggle("selected", item === button));
      openSqPanel("layers"); sqStudio.querySelector(".sq-canvas-scroll")?.scrollTo({ top: 0, behavior: "smooth" }); markSqChanged();
      window.setTimeout(replayVisibleTemplateAnimations, 180);
      showToast(`${config.name} applied — every element remains editable`);
    }));
    let activeTemplateFilter = "all";
    const filterTemplates = () => {
      const query = normalize(sqStudio.querySelector("[data-sq-template-search]")?.value || "");
      sqStudio.querySelectorAll("[data-sq-template]").forEach((button) => { const category = button.dataset.templateCategory || ""; const categoryMatch = activeTemplateFilter === "all" || category.split(" ").includes(activeTemplateFilter); button.hidden = !categoryMatch || (query && !normalize(button.dataset.search).includes(query)); });
    };
    sqStudio.querySelector("[data-sq-template-search]")?.addEventListener("input", filterTemplates);
    sqStudio.querySelectorAll("[data-template-filter]").forEach((button) => button.addEventListener("click", () => { activeTemplateFilter = button.dataset.templateFilter; sqStudio.querySelectorAll("[data-template-filter]").forEach((item) => item.classList.toggle("active", item === button)); filterTemplates(); }));
    const newBlockMarkup = (type, sectionId) => {
      const handle = `<button class="sq-block-handle" type="button" aria-label="Drag section">${iconMarkup("grip")}</button>`;
      if (type === "blank") return `<section class="sq-page-block sq-generated-blank" draggable="true" data-sq-block data-sq-fluid data-sq-rows="12" data-section-id="${sectionId}">${handle}</section>`;
      if (type === "full-image") return `<section class="sq-page-block sq-generated-image" draggable="true" data-sq-block data-sq-fluid data-sq-rows="14" data-section-id="${sectionId}">${handle}<div class="sq-free-image" data-sq-element data-sq-element-type="image" data-layout-desktop="1,1,12,14" data-layout-tablet="1,1,12,14" data-layout-mobile="1,1,12,14"><img src="${productImages.granola}" alt="Granola Madu Nusantara product story"></div></section>`;
      if (type === "gallery") return `<section class="sq-page-block sq-generated-gallery" draggable="true" data-sq-block data-sq-fluid data-sq-rows="12" data-section-id="${sectionId}">${handle}<div class="sq-free-image" data-sq-element data-sq-element-type="image" data-layout-desktop="1,1,6,12" data-layout-tablet="1,1,12,6" data-layout-mobile="1,1,12,6"><img src="${productImages.granola}" alt="Granola"></div><div class="sq-free-image" data-sq-element data-sq-element-type="image" data-layout-desktop="7,1,3,12" data-layout-tablet="1,7,6,6" data-layout-mobile="1,7,6,6"><img src="${productImages.coffee}" alt="Kopi Susu"></div><div class="sq-free-image" data-sq-element data-sq-element-type="image" data-layout-desktop="10,1,3,12" data-layout-tablet="7,7,6,6" data-layout-mobile="7,7,6,6"><img src="${productImages.sambal}" alt="Sambal Roa"></div></section>`;
      if (type === "text") return `<section class="sq-page-block sq-generated-text" draggable="true" data-sq-block data-sq-fluid data-sq-rows="10" data-section-id="${sectionId}">${handle}<small data-sq-element data-sq-element-type="eyebrow" data-layout-desktop="2,1,10,2" data-layout-tablet="1,1,12,2" data-layout-mobile="1,1,12,2">YOUR STORY</small><h2 data-sq-element data-sq-element-type="heading" data-layout-desktop="2,3,10,4" data-layout-tablet="1,3,12,4" data-layout-mobile="1,3,12,4">A clear idea deserves room to breathe.</h2><p data-sq-element data-sq-element-type="text" data-layout-desktop="3,7,8,3" data-layout-tablet="1,7,12,3" data-layout-mobile="1,7,12,3">Write a concise product or brand story here. Every line remains editable directly on the page.</p></section>`;
      if (type === "testimonials") return `<section class="sq-page-block sq-generated-reviews" draggable="true" data-sq-block data-sq-fluid data-sq-rows="8" data-section-id="${sectionId}">${handle}<article data-sq-element data-sq-element-type="review" data-layout-desktop="1,1,6,8" data-layout-tablet="1,1,6,8" data-layout-mobile="1,1,12,4"><b>“Excellent flavor and beautifully packed.”</b><small>Sarah · verified buyer</small></article><article data-sq-element data-sq-element-type="review" data-layout-desktop="7,1,6,8" data-layout-tablet="7,1,6,8" data-layout-mobile="1,5,12,4"><b>“Checkout was easy and delivery was quick.”</b><small>Michael · verified buyer</small></article></section>`;
      if (type === "faq") return `<section class="sq-page-block sq-generated-faq" draggable="true" data-sq-block data-sq-fluid data-sq-rows="12" data-section-id="${sectionId}">${handle}<h2 data-sq-element data-sq-element-type="heading" data-layout-desktop="1,1,12,3" data-layout-tablet="1,1,12,3" data-layout-mobile="1,1,12,3">Questions, answered.</h2><details open data-sq-element data-sq-element-type="faq" data-layout-desktop="1,4,12,4" data-layout-tablet="1,4,12,4" data-layout-mobile="1,4,12,4"><summary>How does payment work?</summary><p>Customers complete a secure Midtrans checkout prepared by Ezkart.</p></details><details data-sq-element data-sq-element-type="faq" data-layout-desktop="1,8,12,4" data-layout-tablet="1,8,12,4" data-layout-mobile="1,8,12,4"><summary>How is shipping calculated?</summary><p>Product weights, destination, courier, and service determine the live rate.</p></details></section>`;
      if (type === "spacer") return `<section class="sq-page-block sq-generated-spacer" draggable="true" data-sq-block data-sq-fluid data-sq-rows="3" data-section-id="${sectionId}">${handle}<span data-sq-element data-sq-element-type="spacer" data-layout-desktop="1,1,12,3" data-layout-tablet="1,1,12,3" data-layout-mobile="1,1,12,3">Responsive spacer · 80px</span></section>`;
      const template = previewRoot?.querySelector(`[data-section-id="${type}"]`);
      if (template) { const clone = template.cloneNode(true); clone.querySelectorAll(".sq-element-overlay").forEach((overlay) => overlay.remove()); clone.dataset.sectionId = sectionId; clone.removeAttribute("id"); clone.classList.remove("selected"); return clone.outerHTML; }
      return `<section class="sq-page-block sq-generated-text" draggable="true" data-sq-block data-section-id="${sectionId}">${handle}<h2>New section</h2></section>`;
    };
    const newElementMarkup = (type) => {
      if (type === "heading") return `<div class="sq-free-element sq-free-heading" data-sq-element data-sq-element-type="heading"><h2>Write a powerful heading.</h2></div>`;
      if (type === "text") return `<div class="sq-free-element sq-free-text" data-sq-element data-sq-element-type="text"><p>Add your story, product details, or supporting copy here.</p></div>`;
      if (type === "button") return `<div class="sq-free-element sq-free-button" data-sq-element data-sq-element-type="button"><button type="button">Call to action</button></div>`;
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
        ["desktop", "tablet", "mobile"].forEach((device) => setElementLayout(element, { x: 1, y: row, width: 12, height: 5 }, device));
        row += 5;
      });
      section.dataset.sqRows = String(Math.max(12, row - 1));
    };
    sqStudio.querySelectorAll("[data-sq-add-element]").forEach((button) => button.addEventListener("click", () => {
      const section = previewRoot?.querySelector(`[data-section-id="${selectedSection}"]`);
      if (!section) return;
      remember();
      ensureElementSection(section);
      removeElementOverlay();
      const wrapper = document.createElement("div");
      wrapper.innerHTML = newElementMarkup(button.dataset.sqAddElement);
      const element = wrapper.firstElementChild;
      const dimensions = {
        heading: { width: 6, height: 4 }, text: { width: 6, height: 3 }, button: { width: 3, height: 2 },
        image: { width: 6, height: 8 }, divider: { width: 8, height: 1 }, form: { width: 6, height: 5 }, html: { width: 8, height: 8 },
      }[button.dataset.sqAddElement] || { width: 6, height: 4 };
      ["desktop", "tablet", "mobile"].forEach((device) => {
        const desired = device === "mobile" ? { ...dimensions, width: 12 } : dimensions;
        setElementLayout(element, findOpenElementLayout(section, desired, device), device);
      });
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
    }));
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
      sqStudio.querySelectorAll("[data-sq-add-block], [data-sq-add-element]").forEach((button) => { button.hidden = Boolean(query) && !normalize(button.dataset.search).includes(query); });
    });

    sqStudio.querySelector("[data-sq-duplicate]")?.addEventListener("click", () => {
      const block = previewRoot?.querySelector(`[data-section-id="${selectedSection}"]`); if (!block) return;
      remember(); const newId = `${selectedSection}-copy-${Date.now()}`; const blockCopy = block.cloneNode(true); blockCopy.querySelectorAll(".sq-section-toolbar, .sq-element-overlay").forEach((node) => node.remove()); blockCopy.dataset.sectionId = newId; blockCopy.classList.remove("selected"); blockCopy.querySelectorAll("[data-sq-element-id]").forEach((element, index) => { element.dataset.sqElementId = `element-${newId}-${index + 1}`; }); block.after(blockCopy); rebuildLayerList(); bindSqInteractions(); selectSqSection(newId, true); markSqChanged();
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

    const setZoom = (value) => {
      zoom = Math.max(60, Math.min(100, Math.round(value)));
      deviceFrame?.classList.remove("zoom-60", "zoom-70", "zoom-80", "zoom-90");
      if (deviceFrame) deviceFrame.style.zoom = zoom === 100 ? "" : String(zoom / 100);
      const output = sqStudio.querySelector("[data-sq-zoom]"); if (output) output.textContent = `${zoom}%`;
    };
    sqStudio.querySelector("[data-sq-zoom-out]")?.addEventListener("click", () => setZoom(zoom - 10));
    sqStudio.querySelector("[data-sq-zoom-in]")?.addEventListener("click", () => setZoom(zoom + 10));
    sqStudio.querySelector("[data-sq-fit]")?.addEventListener("click", () => setZoom(fitZoomForDevice(activeDevice)));
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
        livePreviewFrame.onload = () => livePreviewFrame.contentWindow?.postMessage({ type: "ezkart-render-page", html }, "*");
        livePreviewFrame.src = `page-preview.php?render=${Date.now()}`;
      });
    });
    document.addEventListener("keydown", (event) => {
      if (event.target.closest("input,textarea,select,[contenteditable=true]")) return;
      if (event.key === "Escape" && selectedElement?.isConnected) { selectSqSection(selectedSection, true); return; }
      if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); if (selectedElement?.isConnected) deleteSelectedElement(); else deleteSelectedSection(); return; }
      if (!selectedElement?.isConnected) return;
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
      const tokens = [".sq-page-preview", ".sq-page-block", ".sq-announcement", ".sq-store-nav", ".sq-site-logo", ".sq-hero", ".sq-product", ".sq-image-story", ".sq-benefit", ".sq-cart", ".sq-shipping", ".sq-generated", ".sq-free", ".sq-template", ".sq-surface", ".sq-color", ".element-animation", ".hover-", ".button-", ".ez-fluid", "@keyframes sq", "@keyframes element", ".product-art", ".icon", ".svg-sprite"];
      const collect = (rules) => [...rules].map((rule) => {
        if (rule.type === CSSRule.KEYFRAMES_RULE) return tokens.some((token) => rule.cssText.includes(token)) ? rule.cssText : "";
        if (rule.cssRules && !rule.selectorText) { const nested = collect(rule.cssRules); return nested ? `${rule.conditionText ? `@media ${rule.conditionText}` : rule.cssText.slice(0, rule.cssText.indexOf("{"))}{${nested}}` : ""; }
        return tokens.some((token) => rule.cssText.includes(token)) ? rule.cssText : "";
      }).join("\n");
      return [...document.styleSheets].map((sheet) => { try { return collect(sheet.cssRules); } catch (_) { return ""; } }).join("\n");
    };
    const generateHtml = () => {
      const clone = previewRoot.cloneNode(true);
      clone.querySelectorAll(".sq-free-code").forEach((element) => {
        const source = element.querySelector("template[data-sq-code-source]")?.innerHTML || "";
        const content = document.createElement("template"); content.innerHTML = source; element.replaceChildren(content.content.cloneNode(true));
      });
      clone.querySelectorAll(".sq-block-handle, .sq-image-drag-handle, .sq-element-overlay, .sq-section-toolbar, .section-hidden, .sq-element-hidden").forEach((node) => node.remove());
      clone.querySelectorAll("[data-product-card][hidden], [data-product-line][hidden], .sq-hero-collage > span[hidden]").forEach((node) => node.remove());
      clone.querySelectorAll("[data-section-id]").forEach((node) => { node.dataset.ezkartSection = node.dataset.sectionId; });
      clone.querySelectorAll("[draggable], [contenteditable], [data-sq-block], [data-section-id]").forEach((node) => { node.removeAttribute("draggable"); node.removeAttribute("contenteditable"); node.removeAttribute("data-sq-block"); node.removeAttribute("data-section-id"); node.classList.remove("selected", "dragging", "drag-over", "animating"); });
      clone.querySelectorAll("[data-sq-image-list], [data-sq-image-item]").forEach((node) => { node.removeAttribute("data-sq-image-list"); node.removeAttribute("data-sq-image-item"); node.removeAttribute("tabindex"); node.classList.remove("sq-image-selected", "sq-image-dragging", "sq-image-drop-target"); });
      clone.querySelectorAll("[data-sq-editable], [data-sq-content]").forEach((node) => { node.removeAttribute("data-sq-editable"); node.removeAttribute("data-sq-content"); });
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
      clone.querySelectorAll("[data-sq-fluid]").forEach((node) => { node.classList.add("ez-fluid-section"); node.removeAttribute("data-sq-fluid"); node.removeAttribute("data-sq-rows"); node.removeAttribute("data-sq-min-rows"); });
      clone.querySelectorAll("[data-sq-element]").forEach((node) => {
        node.classList.add("ez-fluid-element");
        node.dataset.ezkartElement = node.dataset.sqElementId;
        ["sqElement", "sqElementId", "sqElementType", "sqElementAnimation", "sqHover", "sqSurface", "sqAlign", "sqButtonRole", "layoutDesktop", "layoutTablet", "layoutMobile"].forEach((key) => delete node.dataset[key]);
        node.classList.remove("sq-element-selected", "sq-element-animate");
      });
      clone.querySelectorAll("img[src]").forEach((image) => { image.src = new URL(image.getAttribute("src"), window.location.href).href; });
      clone.querySelectorAll("[data-product-card]").forEach((card) => { const button = card.querySelector("button"); if (button) { button.dataset.ezkartAdd = card.dataset.productCard; button.type = "button"; } });
      const checkout = clone.querySelector(".sq-cart-section aside>button"); if (checkout) checkout.dataset.ezkartCheckout = "";
      [clone, ...clone.querySelectorAll("*")].forEach((node) => [...node.attributes].forEach((attribute) => { if (attribute.name.startsWith("data-sq-")) node.removeAttribute(attribute.name); }));
      const pageName = document.querySelector("[data-current-site-name]")?.textContent || "Ezkart Landing Page";
      const sprite = document.querySelector(".svg-sprite")?.outerHTML || "";
      const css = `${collectExportCss()}\nhtml{scrollbar-width:none}html::-webkit-scrollbar{width:0;height:0}.sq-page-block,.sq-page-block:hover{outline-color:transparent!important}`;
      const spacingCssFor = (device) => [...spacingState.entries()].filter(([key]) => key.endsWith(`:${device}`)).map(([key, value]) => { const section = key.slice(0, -(device.length + 1)); return `[data-ezkart-section="${section}"]{padding:${value.top}px ${value.right}px ${value.bottom}px ${value.left}px!important}`; }).join("\n");
      const fluidCssFor = (device) => [...previewRoot.querySelectorAll("[data-sq-fluid]")].map((section) => `[data-ezkart-section="${section.dataset.sectionId}"]{--sq-fluid-row-height:${fluidRowHeight(section, device)}px}`).join("\n");
      const elementCssFor = (device) => [...previewRoot.querySelectorAll("[data-sq-element]")].map((element) => { const layout = parseElementLayout(element, device); return `[data-ezkart-element="${element.dataset.sqElementId}"]{grid-column:${layout.x}/span ${layout.width}!important;grid-row:${layout.y}/span ${layout.height}!important}`; }).join("\n");
      const productCssFor = (device) => [...previewRoot.querySelectorAll('[data-sq-element-type="product-grid"]')].map((element) => {
        const settings = productGridSettings(element, device);
        const density = { compact: ["150px", "clamp(96px,58cqw,175px)", "11px", "none"], balanced: ["220px", "clamp(120px,62cqw,250px)", "18px", "block"], showcase: ["310px", "clamp(180px,70cqw,360px)", "18px", "block"] }[settings.density] || ["220px", "clamp(120px,62cqw,250px)", "18px", "block"];
        const columns = settings.columns === "auto" ? `repeat(auto-fit,minmax(min(100%,${density[0]}),1fr))` : `repeat(${settings.columns},minmax(0,1fr))`;
        const id = `[data-ezkart-element="${element.dataset.sqElementId}"]`;
        return `${id}{grid-template-columns:${columns}!important}${id} .product-art{height:${density[1]}!important}${id}>article>div{padding:${density[2]}!important}${id} p{display:${density[3]}}`;
      }).join("\n");
      const responsiveSpacing = `${spacingCssFor("desktop")}\n${fluidCssFor("desktop")}\n${elementCssFor("desktop")}\n${productCssFor("desktop")}\n@media(max-width:900px){${spacingCssFor("tablet")}\n${fluidCssFor("tablet")}\n${elementCssFor("tablet")}\n${productCssFor("tablet")}}\n@media(max-width:600px){${spacingCssFor("mobile")}\n${fluidCssFor("mobile")}\n${elementCssFor("mobile")}\n${productCssFor("mobile")}}`;
      const commerceScript = `<script>(()=>{const defaults=${JSON.stringify(selectedProducts())},cart=new Set();document.querySelectorAll('[data-ezkart-add]').forEach(button=>button.addEventListener('click',()=>{const id=button.dataset.ezkartAdd;cart.has(id)?cart.delete(id):cart.add(id);button.textContent=cart.has(id)?'Added ✓':'Add to cart'}));const checkout=()=>{const products=cart.size?[...cart]:defaults;if(!products.length){alert('This page has no connected products.');return}location.href='/cart/?products='+encodeURIComponent(products.join(','))};document.querySelector('[data-ezkart-checkout]')?.addEventListener('click',checkout);document.querySelectorAll('[data-ezkart-action]').forEach(button=>button.addEventListener('click',()=>{const type=button.dataset.ezkartAction,target=button.dataset.ezkartTarget||'';if(type==='checkout'){checkout();return}if(type==='section'){document.getElementById(target.replace(/^#/,''))?.scrollIntoView({behavior:'smooth'});return}const href=type==='email'?'mailto:'+target:type==='phone'?'tel:'+target:target;if(type==='url'&&button.dataset.ezkartNewTab==='true')window.open(href,'_blank','noopener');else if(href)location.href=href}));const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add(entry.target.matches('[class*="element-animation-"]')?'sq-element-animate':'animating');observer.unobserve(entry.target)}}),{threshold:.12});document.querySelectorAll('[class*="animation-"],[class*="element-animation-"]').forEach(element=>observer.observe(element))})();<\/script>`;
      const fontBase = new URL("assets/fonts/poppins-400.woff2", window.location.href).href;
      const fontBold = new URL("assets/fonts/poppins-600.woff2", window.location.href).href;
      return `<!doctype html>\n<html lang="id">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>${escapeHtml(pageName)}</title>\n<meta name="description" content="Shop selected Indonesian products with secure Midtrans checkout and Ezkart delivery.">\n<style>@font-face{font-family:Poppins;src:url('${fontBase}') format('woff2');font-weight:400}@font-face{font-family:Poppins;src:url('${fontBold}') format('woff2');font-weight:600}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:#fff;font-family:Poppins,Arial,sans-serif}.svg-sprite{width:0;height:0;position:absolute;overflow:hidden}@media(prefers-reduced-motion:reduce){*{animation:none!important;scroll-behavior:auto!important}}\n${css}\n${responsiveSpacing}\n</style>\n</head>\n<body>\n${sprite}\n${clone.outerHTML}\n${commerceScript}\n</body>\n</html>`;
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
    sqStudio.querySelector("[data-sq-publish]")?.addEventListener("click", () => {
      const saved = persistCurrentState();
      try { localStorage.setItem(`${storageKeyFor()}:published`, new Date().toISOString()); } catch (_) { /* draft remains available in this tab */ }
      if (saveState) saveState.textContent = saved ? "Published just now" : "Published for this session";
      showToast("Published snapshot updated with checkout and responsive settings");
    });
    const cloneBaseSiteState = () => JSON.parse(JSON.stringify(baseSiteState || captureState()));
    const loadSite = (site, force = false) => {
      if (!site || (!force && site.classList.contains("active"))) return;
      if (!force) persistCurrentState();
      activeSiteKey = site.dataset.siteUrl || "default";
      sqStudio.querySelectorAll("[data-sq-site]").forEach((item) => item.classList.toggle("active", item === site));
      document.querySelectorAll("[data-current-site-name]").forEach((target) => { target.textContent = site.dataset.siteName; });
      document.querySelectorAll("[data-current-site-url]").forEach((target) => { target.textContent = site.dataset.siteUrl; });
      window.history.replaceState(null, "", `?page=sites&edit=${encodeURIComponent(site.dataset.siteUrl)}`);
      let state = null;
      try { state = JSON.parse(localStorage.getItem(storageKeyFor()) || localStorage.getItem(legacyStorageKeyFor()) || "null"); } catch (_) { state = null; }
      undoStack.length = 0; redoStack.length = 0; updateHistoryButtons();
      restoreState([2, 3].includes(state?.version) ? state : cloneBaseSiteState());
      readCatalogProducts().forEach((product) => installCustomProduct(product, selectedProducts().includes(product.id)));
      let customProducts = [];
      try { customProducts = JSON.parse(site.dataset.siteCustomProducts || "[]"); } catch (_) { customProducts = []; }
      customProducts.forEach((product) => installCustomProduct(product, true));
      if (![2, 3].includes(state?.version) && site.dataset.siteProducts) {
        const starters = site.dataset.siteProducts.split(",").filter(Boolean);
        sqStudio.querySelectorAll("[data-sq-product]").forEach((input) => { input.checked = starters.includes(input.value); });
        updateProductView(); markSqChanged();
      }
      showToast(`${site.dataset.siteName} loaded with its saved draft`);
    };
    const bindSiteButton = (site) => { site.onclick = () => loadSite(site); };
    const pageList = sqStudio.querySelector(".sq-page-list");
    const addSavedSiteButton = ({ name, url, products = [], customProducts = [] }) => {
      const sourceSite = pageList?.querySelector("[data-sq-site]");
      if (!pageList || !sourceSite || !name || !url || pageList.querySelector(`[data-site-url="${CSS.escape(url)}"]`)) return null;
      const site = sourceSite.cloneNode(true);
      site.classList.remove("active"); site.dataset.siteName = name; site.dataset.siteUrl = url; site.dataset.siteProducts = products.join(","); site.dataset.siteCustomProducts = JSON.stringify(customProducts); site.dataset.customSite = "true";
      const title = site.querySelector("b"); const subtitle = site.querySelector("small"); const status = site.querySelector("em");
      if (title) title.textContent = name; if (subtitle) subtitle.textContent = url; if (status) { status.textContent = "Draft"; status.className = "draft"; }
      pageList.append(site); bindSiteButton(site); return site;
    };
    readLandingSites().forEach(addSavedSiteButton);
    updateLandingCountBadges(3 + readLandingSites().length);
    sqStudio.querySelectorAll("[data-sq-site]").forEach(bindSiteButton);

    const newPageDialog = document.getElementById("page-creator-dialog");
    sqStudio.querySelectorAll("[data-open-page-creator]").forEach((button) => button.addEventListener("click", () => {
      if (!landingAdvancedMode() && sqStudio.querySelectorAll("[data-sq-site]").length >= 6) { showToast("The standard workspace supports 6 projects. Delete one or enable Advanced Mode from Landing Pages."); return; }
      newPageDialog?.showModal();
    }));
    const newPageForm = newPageDialog?.querySelector("[data-page-creator-form]");
    const newPageName = newPageForm?.elements.namedItem("page_name");
    const newPageSlug = newPageForm?.elements.namedItem("slug");
    hydrateCreatorCatalog(newPageForm);
    const newPageProducts = setupCreatorProducts(newPageForm);
    let newPageSlugEdited = false;
    const makePageSlug = (value) => normalize(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
    newPageSlug?.addEventListener("input", () => { newPageSlugEdited = true; newPageSlug.value = makePageSlug(newPageSlug.value); });
    newPageName?.addEventListener("input", () => { if (!newPageSlugEdited && newPageSlug) newPageSlug.value = makePageSlug(newPageName.value); });
    newPageDialog?.addEventListener("close", () => { if (newPageDialog.returnValue === "cancel") { newPageForm?.reset(); newPageProducts.reset(); newPageSlugEdited = false; } });
    newPageForm?.addEventListener("submit", (event) => {
      if (event.submitter?.value === "cancel") return;
      event.preventDefault(); event.stopImmediatePropagation();
      const starters = [...newPageForm.querySelectorAll('input[name="starter_products[]"]:checked')];
      if (!starters.length) { showToast("Select at least one starting product"); newPageForm.querySelector('input[name="starter_products[]"]')?.focus(); return; }
      if (!newPageForm.reportValidity()) return;
      const name = String(newPageForm.elements.page_name.value).trim();
      const siteUrl = `${String(newPageForm.elements.slug.value).trim()}.ezkart.site`;
      const starterIds = starters.map((starter) => starter.value);
      const customProducts = newPageProducts.selected(starterIds);
      const site = addSavedSiteButton({ name, url: siteUrl, products: starterIds, customProducts });
      if (!site) { showToast("A page with this URL already exists"); return; }
      try {
        const savedSites = [...sqStudio.querySelectorAll("[data-custom-site]")].map((item) => { let own = []; try { own = JSON.parse(item.dataset.siteCustomProducts || "[]"); } catch (_) { own = []; } return { name: item.dataset.siteName, url: item.dataset.siteUrl, products: item.dataset.siteProducts.split(",").filter(Boolean), customProducts: own }; });
        writeLandingSites(savedSites);
      } catch (_) { /* page remains available in this tab */ }
      newPageDialog?.close(); loadSite(site);
      sqStudio.querySelectorAll("[data-sq-product]").forEach((input) => { input.checked = starters.some((starter) => starter.value === input.value); });
      updateProductView(); markSqChanged();
      updateLandingCountBadges(3 + readLandingSites().length);
      showToast(`${name} created with ${starters.length} products`); newPageForm.reset(); newPageProducts.reset(); newPageSlugEdited = false;
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
        status.title = ready ? `Checkout creates a Midtrans ${production ? "production" : "sandbox"} payment and a Biteship ${production ? "live" : "test"} order after verified payment.` : "Add matching Midtrans and Biteship credentials, postcode, pickup contact, and pickup address.";
      } catch (_) {
        status.classList.add("warning");
        status.lastChild.textContent = " Commerce status unavailable";
      }
    };

    readCatalogProducts().forEach((product) => installCustomProduct(product, false));
    upgradeLegacyStructure();
    rebuildLayerList();
    bindSqInteractions();
    updateProductView();
    selectSqSection("announcement");
    syncBrandControls();
    syncCommerceStatus();
    baseSiteState = captureState();
    const requestedSiteUrl = new URLSearchParams(window.location.search).get("edit") || "";
    const requestedSiteButton = [...sqStudio.querySelectorAll("[data-sq-site]")].find((site) => site.dataset.siteUrl === requestedSiteUrl);
    if (requestedSiteButton) loadSite(requestedSiteButton, true);
    else {
      try {
        const stored = JSON.parse(localStorage.getItem(storageKeyFor()) || localStorage.getItem(legacyStorageKeyFor()) || "null");
        if ([2, 3].includes(stored?.version)) restoreState(stored);
      } catch (_) { /* start with the server-provided page */ }
    }
    window.addEventListener("beforeunload", persistCurrentState);
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
