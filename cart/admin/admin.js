(() => {
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

  const builderStudio = document.querySelector(".builder-studio");
  if (builderStudio) {
    const previewFrame = builderStudio.querySelector("[data-preview-frame]");
    const landingPreview = builderStudio.querySelector(".landing-page-preview");
    const autosave = builderStudio.querySelector(".autosave-state");
    const autosaveStatus = builderStudio.querySelector("[data-autosave-status]");
    let autosaveTimer;
    const markBuilderChanged = () => {
      if (!autosave || !autosaveStatus) return;
      autosave.classList.add("saving");
      autosaveStatus.textContent = "Saving changes…";
      window.clearTimeout(autosaveTimer);
      autosaveTimer = window.setTimeout(() => {
        autosave.classList.remove("saving");
        autosaveStatus.textContent = "Saved just now";
      }, 650);
    };

    builderStudio.querySelectorAll("[data-preview-device]").forEach((button) => {
      button.addEventListener("click", () => {
        builderStudio.querySelectorAll("[data-preview-device]").forEach((item) => item.classList.remove("active"));
        button.classList.add("active");
        previewFrame?.classList.remove("device-tablet", "device-mobile");
        if (button.dataset.previewDevice !== "desktop") previewFrame?.classList.add(`device-${button.dataset.previewDevice}`);
      });
    });

    let selectedBlockName = "announcement";
    const selectBuilderBlock = (blockName) => {
      selectedBlockName = blockName;
      builderStudio.querySelectorAll("[data-builder-target]").forEach((button) => button.classList.toggle("active", button.dataset.builderTarget === blockName));
      builderStudio.querySelectorAll("[data-preview-block]").forEach((block) => block.classList.toggle("selected-block", block.dataset.previewBlock === blockName));
      const selectedButton = builderStudio.querySelector(`[data-builder-target="${blockName}"]`);
      const inspectorTitle = builderStudio.querySelector("[data-inspector-title]");
      if (inspectorTitle && selectedButton) inspectorTitle.textContent = selectedButton.querySelector("b")?.textContent || "Section";
      const visibilityButton = builderStudio.querySelector("[data-toggle-section]");
      const selectedPreview = builderStudio.querySelector(`[data-preview-block="${blockName}"]`);
      if (visibilityButton) visibilityButton.textContent = selectedPreview?.classList.contains("section-hidden") ? "Show section" : "Hide section";
    };
    const bindOutlineButton = (button) => button.addEventListener("click", () => selectBuilderBlock(button.dataset.builderTarget));
    const bindPreviewBlock = (block) => block.addEventListener("click", () => selectBuilderBlock(block.dataset.previewBlock));
    builderStudio.querySelectorAll("[data-builder-target]").forEach(bindOutlineButton);
    builderStudio.querySelectorAll("[data-preview-block]").forEach(bindPreviewBlock);

    const builderFields = {
      headline: builderStudio.querySelector("[data-preview-headline]"),
      description: builderStudio.querySelector("[data-preview-description]"),
      cta: builderStudio.querySelector("[data-preview-cta]"),
    };
    builderStudio.querySelectorAll("[data-builder-field]").forEach((field) => {
      field.addEventListener("input", () => {
        const target = builderFields[field.dataset.builderField];
        if (target) target.textContent = field.value;
        if (field.dataset.builderField === "headline") {
          const counter = builderStudio.querySelector("[data-headline-count]");
          if (counter) counter.textContent = String(field.value.length);
        }
        markBuilderChanged();
      });
    });

    const productSelect = builderStudio.querySelector("[data-builder-product]");
    productSelect?.addEventListener("change", () => {
      const option = productSelect.selectedOptions[0];
      const image = builderStudio.querySelector(".preview-product-photo img");
      const checkoutName = builderStudio.querySelector(".preview-checkout div b");
      const checkoutPrice = builderStudio.querySelector(".preview-checkout > strong");
      const ctaField = builderStudio.querySelector('[data-builder-field="cta"]');
      if (image && option?.dataset.image) image.src = option.dataset.image;
      if (checkoutName) checkoutName.textContent = option?.dataset.name || option?.textContent || "Product";
      if (checkoutPrice) checkoutPrice.textContent = option?.dataset.price || "";
      if (builderFields.cta && ctaField) builderFields.cta.textContent = `${ctaField.value} — ${option?.dataset.price || ""}`;
      markBuilderChanged();
    });

    builderStudio.querySelectorAll("[data-theme-class]").forEach((button) => {
      button.addEventListener("click", () => {
        builderStudio.querySelectorAll("[data-theme-class]").forEach((item) => item.classList.remove("active"));
        button.classList.add("active");
        landingPreview?.classList.remove("theme-coral", "theme-forest", "theme-indigo", "theme-charcoal");
        landingPreview?.classList.add(button.dataset.themeClass || "theme-coral");
        markBuilderChanged();
      });
    });

    builderStudio.querySelector("[data-corner-style]")?.addEventListener("change", (event) => {
      landingPreview?.classList.remove("radius-soft", "radius-round", "radius-square");
      landingPreview?.classList.add(event.currentTarget.value || "radius-soft");
      markBuilderChanged();
    });

    const previewButton = builderStudio.querySelector("[data-preview-site]");
    const setPreviewFocus = (enabled) => {
      builderStudio.classList.toggle("preview-focus", enabled);
      previewButton?.setAttribute("aria-pressed", String(enabled));
      const label = previewButton?.querySelector("span");
      if (label) label.textContent = enabled ? "Exit preview" : "Preview";
    };
    previewButton?.addEventListener("click", () => {
      const enabled = !builderStudio.classList.contains("preview-focus");
      setPreviewFocus(enabled);
      if (enabled) builderStudio.scrollIntoView({ behavior: "smooth", block: "start" });
      showToast(enabled ? "Focused preview enabled — press Escape to exit" : "Builder panels restored");
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && builderStudio.classList.contains("preview-focus")) setPreviewFocus(false);
    });

    builderStudio.querySelector("[data-duplicate-section]")?.addEventListener("click", () => {
      const sourceOutline = builderStudio.querySelector(`[data-builder-target="${selectedBlockName}"]`);
      const sourcePreview = builderStudio.querySelector(`[data-preview-block="${selectedBlockName}"]`);
      if (!sourceOutline || !sourcePreview) return;
      const key = `copy-${selectedBlockName.replace(/[^a-z0-9-]/gi, "-")}-${Date.now()}`;
      const outlineCopy = sourceOutline.cloneNode(true);
      const previewCopy = sourcePreview.cloneNode(true);
      outlineCopy.dataset.builderTarget = key;
      previewCopy.dataset.previewBlock = key;
      outlineCopy.classList.remove("active", "section-hidden");
      previewCopy.classList.remove("selected-block", "section-hidden");
      const title = outlineCopy.querySelector("b");
      const helper = outlineCopy.querySelector("small");
      if (title) title.textContent = `${title.textContent} copy`;
      if (helper) helper.textContent = "Duplicated · ready to edit";
      sourceOutline.after(outlineCopy);
      sourcePreview.after(previewCopy);
      bindOutlineButton(outlineCopy);
      bindPreviewBlock(previewCopy);
      selectBuilderBlock(key);
      showToast("Section duplicated and selected");
      markBuilderChanged();
    });

    builderStudio.querySelector("[data-toggle-section]")?.addEventListener("click", (event) => {
      const selectedOutline = builderStudio.querySelector(`[data-builder-target="${selectedBlockName}"]`);
      const selectedPreview = builderStudio.querySelector(`[data-preview-block="${selectedBlockName}"]`);
      if (!selectedOutline || !selectedPreview) return;
      const hidden = !selectedPreview.classList.contains("section-hidden");
      selectedOutline.classList.toggle("section-hidden", hidden);
      selectedPreview.classList.toggle("section-hidden", hidden);
      event.currentTarget.textContent = hidden ? "Show section" : "Hide section";
      showToast(hidden ? "Section hidden from the published page" : "Section restored to the published page");
      markBuilderChanged();
    });

    builderStudio.querySelectorAll("[data-add-builder-block]").forEach((button) => {
      button.addEventListener("click", () => {
        const label = button.dataset.addBuilderBlock || "Section";
        const key = `custom-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`;
        const outline = builderStudio.querySelector(".builder-outline");
        const outlineTemplate = outline?.querySelector('[data-builder-target="benefits"]');
        const outlineButton = outlineTemplate?.cloneNode(true);
        if (outline && outlineButton) {
          outlineButton.dataset.builderTarget = key;
          const title = outlineButton.querySelector("b");
          const description = outlineButton.querySelector("small");
          if (title) title.textContent = label;
          if (description) description.textContent = "New section · ready to edit";
          outline.append(outlineButton);
          bindOutlineButton(outlineButton);
        }

        const previewSection = document.createElement("section");
        previewSection.className = "preview-added-section";
        previewSection.dataset.previewBlock = key;
        const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        icon.setAttribute("class", "icon");
        icon.setAttribute("aria-hidden", "true");
        const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
        use.setAttribute("href", "#icon-sparkles");
        icon.append(use);
        const content = document.createElement("span");
        const heading = document.createElement("b");
        const helper = document.createElement("small");
        heading.textContent = label;
        helper.textContent = "Select this section to customize its content and layout.";
        content.append(heading, helper);
        previewSection.append(icon, content);
        landingPreview?.querySelector(".preview-checkout")?.before(previewSection);
        bindPreviewBlock(previewSection);
        selectBuilderBlock(key);
        previewSection.scrollIntoView({ behavior: "smooth", block: "center" });
        showToast(`${label} section added and selected`);
        markBuilderChanged();
      });
    });
    builderStudio.querySelector("[data-publish-site]")?.addEventListener("click", () => {
      if (autosaveStatus) autosaveStatus.textContent = "Published just now";
      autosave?.classList.remove("saving");
      showToast("Landing page published securely");
    });
  }

  const productCatalog = {
    "Granola Madu Nusantara": { value: "granola", image: "assets/products/granola.webp", price: "Rp58.000", headline: "Start your morning with a better crunch.", description: "Honey-toasted granola made with local oats, cashews, and a warm touch of Nusantara spice." },
    "Kopi Susu Concentrate": { value: "coffee", image: "assets/products/kopi-susu.webp", price: "Rp79.000", headline: "Cafe-quality kopi susu, ready in seconds.", description: "A rich, balanced concentrate for effortless iced coffee at home—just pour, mix, and enjoy." },
    "Sambal Roa Signature": { value: "sambal", image: "assets/products/sambal-roa.webp", price: "Rp46.000", headline: "Smoky Manado heat for every meal.", description: "Small-batch sambal roa with deep smoke, bright chili, and the savory finish your table has been missing." },
  };
  const activateSite = (site, shouldScroll = true) => {
      document.querySelectorAll("[data-site-select]").forEach((item) => item.classList.remove("active"));
      site.classList.add("active");
      document.querySelectorAll("[data-current-site-name]").forEach((target) => { target.textContent = site.dataset.siteName || "Landing page"; });
      document.querySelectorAll("[data-current-site-url]").forEach((target) => { target.textContent = site.dataset.siteUrl || "ezkart.site"; });
      const select = document.querySelector("[data-builder-product]");
      const product = productCatalog[site.dataset.siteProduct];
      if (select && product) {
        select.value = product.value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
      const headline = document.querySelector('[data-builder-field="headline"]');
      const description = document.querySelector('[data-builder-field="description"]');
      if (headline && site.dataset.siteHeadline) {
        headline.value = site.dataset.siteHeadline;
        headline.dispatchEvent(new Event("input", { bubbles: true }));
      }
      if (description && site.dataset.siteDescription) {
        description.value = site.dataset.siteDescription;
        description.dispatchEvent(new Event("input", { bubbles: true }));
      }
      if (shouldScroll) document.querySelector("#visual-builder")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const bindSiteSelector = (site) => site.addEventListener("click", () => activateSite(site));
  document.querySelectorAll("[data-site-select]").forEach(bindSiteSelector);

  const domainForm = document.querySelector("[data-domain-form]");
  domainForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = domainForm.querySelector("[data-domain-input]");
    const feedback = domainForm.querySelector("[data-domain-feedback]");
    const domain = normalize(input?.value).replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/\.$/, "");
    const valid = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain);
    feedback?.classList.remove("error", "success");
    if (!valid) {
      if (feedback) {
        feedback.textContent = "Enter a valid domain such as shop.yourbrand.com.";
        feedback.classList.add("error");
      }
      input?.setAttribute("aria-invalid", "true");
      input?.focus();
      return;
    }
    input?.removeAttribute("aria-invalid");
    if (input) input.value = domain;
    if (feedback) {
      feedback.textContent = `${domain} is ready for a DNS check. No live settings were changed.`;
      feedback.classList.add("success");
    }
    showToast("Domain format verified — DNS instructions prepared");
  });

  const seoTitle = document.querySelector("[data-seo-title]");
  const seoDescription = document.querySelector("[data-seo-description]");
  seoTitle?.addEventListener("input", () => {
    const target = document.querySelector("[data-seo-preview-title]");
    if (target) target.textContent = seoTitle.value || "Untitled landing page";
  });
  seoDescription?.addEventListener("input", () => {
    const target = document.querySelector("[data-seo-preview-description]");
    if (target) target.textContent = seoDescription.value || "Add a description to improve search visibility.";
  });

  const pageDialog = document.getElementById("page-creator-dialog");
  document.querySelectorAll("[data-open-page-creator]").forEach((button) => button.addEventListener("click", () => {
    if (typeof pageDialog?.showModal === "function") pageDialog.showModal();
  }));
  const pageCreatorForm = pageDialog?.querySelector("[data-page-creator-form]");
  const pageNameField = pageCreatorForm?.elements.namedItem("page_name");
  const slugField = pageCreatorForm?.elements.namedItem("slug");
  let slugWasEdited = false;
  const makeSlug = (value) => normalize(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
  slugField?.addEventListener("input", () => {
    slugWasEdited = true;
    slugField.value = makeSlug(slugField.value);
  });
  pageNameField?.addEventListener("input", () => {
    if (!slugWasEdited && slugField) slugField.value = makeSlug(pageNameField.value);
  });
  pageCreatorForm?.addEventListener("submit", (event) => {
    if (event.submitter?.value === "cancel") return;
    event.preventDefault();
    if (!pageCreatorForm.reportValidity()) return;
    const pageName = String(pageNameField?.value || "New landing page");
    const pageSlug = String(slugField?.value || makeSlug(pageName) || "new-page");
    const productName = String(pageCreatorForm.elements.namedItem("product")?.value || "Granola Madu Nusantara");
    const product = productCatalog[productName] || productCatalog["Granola Madu Nusantara"];
    const list = document.querySelector(".site-list");
    const template = list?.querySelector(".site-list-item:last-child");
    const newSite = template?.cloneNode(true);
    if (list && newSite) {
      newSite.classList.remove("active");
      newSite.dataset.siteName = pageName;
      newSite.dataset.siteUrl = `${pageSlug}.ezkart.site`;
      newSite.dataset.siteProduct = productName;
      newSite.dataset.siteHeadline = product.headline;
      newSite.dataset.siteDescription = product.description;
      const thumbnail = newSite.querySelector(".site-thumbnail");
      const image = thumbnail?.querySelector("img");
      const state = thumbnail?.querySelector("i");
      if (image) {
        image.src = product.image;
        image.alt = productName;
      }
      if (state) {
        state.className = "draft";
        state.textContent = "Draft";
      }
      const details = newSite.querySelector(":scope > span:nth-child(2)");
      if (details) {
        const name = details.querySelector("b");
        const url = details.querySelector("small");
        const updated = details.querySelector("em");
        if (name) name.textContent = pageName;
        if (url) url.textContent = `${pageSlug}.ezkart.site`;
        if (updated) updated.textContent = "Created just now";
      }
      const metrics = newSite.querySelector(".site-metrics");
      if (metrics) {
        const visits = metrics.querySelector("b");
        const conversion = metrics.querySelector("strong");
        if (visits) visits.textContent = "—";
        if (conversion) conversion.textContent = "Draft";
      }
      list.append(newSite);
      bindSiteSelector(newSite);
      const total = list.querySelectorAll("[data-site-select]").length;
      const navBadge = document.querySelector('a[href="?page=sites"] b');
      const statValue = document.querySelector(".page-stat-strip article:first-child strong");
      const statDetail = document.querySelector(".page-stat-strip article:first-child p");
      if (navBadge) navBadge.textContent = String(total);
      if (statValue) statValue.textContent = String(total);
      if (statDetail) statDetail.textContent = `2 live · ${Math.max(total - 2, 0)} drafts`;
      activateSite(newSite, false);
    }
    pageDialog.close();
    pageCreatorForm.reset();
    slugWasEdited = false;
    showToast(`${pageName} created as a safe draft`);
    document.querySelector("#visual-builder")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });

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
