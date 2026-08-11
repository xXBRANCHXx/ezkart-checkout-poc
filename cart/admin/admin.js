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
    let activeDevice = "desktop";
    let draggedSection = "";
    let draggedImage = null;
    let draggedImageSnapshot = null;
    let saveTimer;
    let zoom = 90;

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
      clone.querySelectorAll(".sq-element-overlay").forEach((overlay) => overlay.remove());
      return clone.innerHTML;
    };
    const captureState = () => ({
      preview: previewSnapshotHtml(),
      previewClass: previewRoot?.className || "",
      previewStyle: previewRoot?.getAttribute("style") || "",
      layers: layerList?.innerHTML || "",
      productPicker: sqStudio.querySelector(".sq-product-picker")?.innerHTML || "",
      products: selectedProducts(),
      selectedSection,
      spacing: JSON.stringify([...spacingState.entries()]),
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
    const markSqChanged = () => {
      if (!saveState) return;
      saveState.textContent = "Saving…";
      window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(() => { saveState.textContent = "Saved just now"; }, 550);
    };

    const formatRupiah = (amount) => `Rp${new Intl.NumberFormat("id-ID").format(amount)}`;
    const updateProductView = () => {
      const products = selectedProducts();
      [...(previewRoot?.classList || [])].filter((name) => name.startsWith("product-count-")).forEach((name) => previewRoot.classList.remove(name));
      previewRoot?.classList.add(`product-count-${products.length}`);
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
        rows = Math.max(rows, layout.y + layout.height - 1);
      });
      section.dataset.sqRows = String(rows);
      section.style.setProperty("--sq-fluid-rows", String(rows));
      section.style.setProperty("--sq-fluid-row-height", `${fluidRowHeight(section)}px`);
    };
    const applyFluidLayouts = () => previewRoot?.querySelectorAll("[data-sq-fluid]").forEach(applyFluidSection);
    const elementTypeName = (element) => (element?.dataset.sqElementType || "element").replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
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
    const syncElementControls = () => {
      const controls = sqStudio.querySelector("[data-sq-element-controls]");
      const valid = selectedElement?.isConnected && selectedElement.closest(`[data-section-id="${selectedSection}"]`);
      if (controls) controls.hidden = !valid;
      if (!valid) return;
      const layout = parseElementLayout(selectedElement);
      const type = sqStudio.querySelector(".sq-element-controls [data-sq-element-type]");
      if (type) type.textContent = elementTypeName(selectedElement);
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
      const hasButton = selectedElement.matches("button") || Boolean(selectedElement.querySelector("button"));
      if (buttonControls) buttonControls.hidden = !hasButton;
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
    const selectSqElement = (element) => {
      if (!element?.matches("[data-sq-element]")) return;
      selectedElement = element;
      previewRoot?.querySelectorAll(".sq-element-selected").forEach((item) => item.classList.remove("sq-element-selected"));
      element.classList.add("sq-element-selected");
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
      removeElementOverlay();
      applyFluidSection(section);
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
      ".sq-store-nav>b", ".sq-store-nav a", ".sq-store-nav div>button",
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
    const selectSqSection = (sectionId) => {
      selectedSection = sectionId;
      sqStudio.classList.remove("mobile-panel-open");
      sqStudio.classList.remove("inspector-closed");
      inspector?.classList.remove("collapsed");
      sqStudio.querySelectorAll("[data-sq-layer]").forEach((layer) => layer.classList.toggle("active", layer.dataset.sectionId === sectionId));
      previewRoot?.querySelectorAll("[data-sq-block]").forEach((block) => block.classList.toggle("selected", block.dataset.sectionId === sectionId));
      const title = sqStudio.querySelector("[data-sq-inspector-title]");
      const layerTitle = sqStudio.querySelector(`[data-sq-layer][data-section-id="${sectionId}"] b`)?.textContent;
      if (title) title.textContent = layerTitle || sectionNames[sectionId] || "Section";
      const block = previewRoot?.querySelector(`[data-section-id="${sectionId}"]`);
      if (selectedElement && !block?.contains(selectedElement)) {
        selectedElement = null;
        previewRoot?.querySelectorAll(".sq-element-selected").forEach((item) => item.classList.remove("sq-element-selected"));
        removeElementOverlay();
      }
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
    };

    const reorderSection = (dragId, targetId, placeAfter) => {
      if (!dragId || !targetId || dragId === targetId) return;
      remember();
      const draggedLayer = layerList?.querySelector(`[data-section-id="${dragId}"]`);
      const targetLayer = layerList?.querySelector(`[data-section-id="${targetId}"]`);
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
          selectSqSection(layer.dataset.sectionId);
          previewRoot?.querySelector(`[data-section-id="${layer.dataset.sectionId}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
        };
        layer.ondragstart = (event) => { draggedSection = layer.dataset.sectionId; layer.classList.add("dragging"); event.dataTransfer.effectAllowed = "move"; };
        layer.ondragover = (event) => { event.preventDefault(); layer.classList.add("drag-over"); };
        layer.ondragleave = () => layer.classList.remove("drag-over");
        layer.ondrop = (event) => { event.preventDefault(); layer.classList.remove("drag-over"); const rect = layer.getBoundingClientRect(); reorderSection(draggedSection, layer.dataset.sectionId, event.clientY > rect.top + rect.height / 2); };
        layer.ondragend = () => { layer.classList.remove("dragging"); sqStudio.querySelectorAll(".drag-over").forEach((item) => item.classList.remove("drag-over")); };
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
        element.draggable = false;
        element.onclick = (event) => {
          event.stopPropagation();
          const section = element.closest("[data-section-id]");
          if (section) selectSqSection(section.dataset.sectionId);
          selectSqElement(element);
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
            selectSqElement(item.closest("[data-sq-element]"));
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
            selectSqElement(content.closest("[data-sq-element]"));
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
      previewRoot.innerHTML = state.preview;
      previewRoot.className = state.previewClass;
      if (state.previewStyle) previewRoot.setAttribute("style", state.previewStyle); else previewRoot.removeAttribute("style");
      layerList.innerHTML = state.layers;
      const productPicker = sqStudio.querySelector(".sq-product-picker");
      if (productPicker && typeof state.productPicker === "string") productPicker.innerHTML = state.productPicker;
      sqStudio.querySelectorAll("[data-sq-product]").forEach(bindSqProductInput);
      sqStudio.querySelectorAll("[data-sq-product]").forEach((input) => { input.checked = state.products.includes(input.value); });
      spacingState.clear();
      JSON.parse(state.spacing || "[]").forEach(([key, value]) => spacingState.set(key, value));
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
    quickProductForm?.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!quickProductForm.reportValidity()) return;
      const formData = new FormData(quickProductForm);
      const name = String(formData.get("name") || "").trim();
      const price = Math.max(1000, Math.round(Number(formData.get("price")) || 0));
      const photo = String(formData.get("photo") || "granola");
      if (!name || !price || !productImages[photo]) return;

      remember();
      const id = `custom-${Date.now()}`;
      const imageUrl = productImages[photo];
      const safeName = escapeHtml(name);
      const safePrice = escapeHtml(formatRupiah(price));
      productNames[id] = name;
      productPrices[id] = price;
      productImages[id] = imageUrl;

      const picker = sqStudio.querySelector(".sq-product-picker");
      if (picker) {
        const label = document.createElement("label");
        label.innerHTML = `<input type="checkbox" value="${id}" data-sq-product checked><span><span class="product-art"><img src="${imageUrl}" alt="${safeName}"></span><div><b>${safeName}</b><small>${safePrice} · New product</small></div><i>${iconMarkup("check-circle")}</i></span>`;
        picker.append(label);
        bindSqProductInput(label.querySelector("[data-sq-product]"));
      }

      previewRoot?.querySelectorAll("[data-sq-product-grid]").forEach((grid) => {
        const card = document.createElement("article");
        card.dataset.productCard = id;
        card.innerHTML = `<span class="product-art"><img src="${imageUrl}" alt="${safeName}"></span><div><small>New product · ready to sell</small><h3>${safeName}</h3><p>Add product details, variants, weight, and inventory from the product catalog.</p><footer><b>${safePrice}</b><button type="button">Add to cart</button></footer></div>`;
        grid.append(card);
      });
      previewRoot?.querySelectorAll("[data-sq-basket-lines]").forEach((basket) => {
        const line = document.createElement("li");
        line.dataset.productLine = id;
        line.innerHTML = `<span>${safeName}</span><b>${safePrice}</b>`;
        basket.append(line);
      });
      previewRoot?.querySelectorAll(".sq-hero-collage").forEach((collage) => {
        const visual = document.createElement("span");
        visual.dataset.productVisual = id;
        visual.dataset.sqImageItem = "";
        visual.draggable = true;
        visual.tabIndex = 0;
        visual.setAttribute("aria-label", `${name} image — drag to rearrange`);
        visual.innerHTML = `<span class="product-art"><img src="${imageUrl}" alt="${safeName}"></span>`;
        collage.append(visual);
      });

      updateProductView();
      bindSqInteractions();
      syncInspectorContent();
      markSqChanged();
      quickProductForm.hidden = true;
      quickProductForm.reset();
      showToast(`${name} added to this page`);
    });

    sqStudio.querySelectorAll("[data-sq-device]").forEach((button) => button.addEventListener("click", () => {
      activeDevice = button.dataset.sqDevice;
      sqStudio.querySelectorAll("[data-sq-device]").forEach((item) => item.classList.toggle("active", item === button));
      deviceFrame?.classList.remove("device-tablet", "device-mobile");
      if (activeDevice !== "desktop") deviceFrame?.classList.add(`device-${activeDevice}`);
      const sizes = { desktop: "Desktop · 1440px", tablet: "Tablet · 768px", mobile: "Mobile · 390px" };
      const stageSize = sqStudio.querySelector("[data-sq-stage-size]");
      if (stageSize) stageSize.textContent = sizes[activeDevice];
      loadSpacingControls();
      applySpacing();
      applyFluidLayouts();
      syncElementControls();
      if (selectedElement) requestAnimationFrame(refreshElementOverlay);
    }));

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
    sqStudio.querySelector("[data-sq-element-duplicate]")?.addEventListener("click", duplicateSelectedElement);
    sqStudio.querySelector("[data-sq-element-delete]")?.addEventListener("click", deleteSelectedElement);
    sqStudio.querySelector("[data-sq-element-hide]")?.addEventListener("click", () => {
      if (!selectedElement?.isConnected) return;
      remember();
      selectedElement.classList.toggle("sq-element-hidden");
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
      const copy = elements.find((element) => ["copy", "text", "brand", "collection-heading"].includes(element.dataset.sqElementType)) || elements[0];
      elements.forEach((element) => element.classList.remove("sq-element-hidden", "sq-single-image"));
      if (event.currentTarget.value === "text-only") {
        images.forEach((element) => element.classList.add("sq-element-hidden"));
        if (copy) setElementLayout(copy, { x: 2, y: 1, width: 10, height: Math.max(6, Number(section.dataset.sqRows || 12)) });
      } else if (event.currentTarget.value === "image-only") {
        elements.forEach((element) => element.classList.toggle("sq-element-hidden", !images.includes(element)));
        images.forEach((element, index) => setElementLayout(element, { x: 1, y: 1 + index * 6, width: 12, height: Math.max(6, Number(section.dataset.sqRows || 12)) }));
      } else if (event.currentTarget.value === "single-image") {
        if (copy) setElementLayout(copy, { x: 1, y: 1, width: 6, height: 12 });
        images.slice(0, 1).forEach((element) => { element.classList.add("sq-single-image"); setElementLayout(element, { x: 7, y: 1, width: 6, height: 12 }); });
        images.slice(1).forEach((element) => element.classList.add("sq-element-hidden"));
      } else if (event.currentTarget.value === "stacked") {
        let row = 1;
        elements.forEach((element) => { setElementLayout(element, { x: 1, y: row, width: 12, height: 6 }); row += 6; });
      } else {
        if (copy) setElementLayout(copy, { x: 1, y: 1, width: 6, height: 12 });
        images.forEach((element, index) => { setElementLayout(element, { x: 7, y: 1 + index * 6, width: 6, height: images.length > 1 ? 6 : 12 }); });
      }
      applyFluidSection(section);
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
      clone.querySelectorAll(".sq-element-overlay").forEach((node) => node.remove());
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
      const heroTextClass = overlay ? " sq-template-copy-overlay" : "";
      const imagePosition = ["embun", "pulih"].includes(key) ? "center" : key === "sora" ? "center right" : "center";
      const hero = `<section class="sq-page-block sq-hero sq-template-hero sq-template-${config.mode}" draggable="true" data-sq-block data-sq-fluid data-sq-rows="15" data-section-id="hero">${templateHandle("hero")}<div class="sq-template-media sq-free-image element-animation-scale hover-${config.hover}" data-sq-element data-sq-element-type="image" data-sq-element-animation="scale" data-sq-hover="${config.hover}" data-layout-desktop="${layout.image}" data-layout-tablet="${layout.tabletImage}" data-layout-mobile="1,1,12,15"><img src="${config.image}" alt="${escapeHtml(config.name)} campaign" style="object-position:${imagePosition}"></div><div class="sq-hero-copy sq-template-copy${heroTextClass} button-primary element-animation-${config.entrance}" data-sq-element data-sq-element-type="copy" data-sq-button-role="primary" data-sq-element-animation="${config.entrance}" data-sq-hover="none" data-layout-desktop="${layout.copy}" data-layout-tablet="${layout.tabletCopy}" data-layout-mobile="1,8,12,8"><span>${escapeHtml(config.kicker)}</span><h1>${escapeHtml(config.headline)}</h1><p>${escapeHtml(config.body)}</p><div><button type="button">${escapeHtml(config.cta)}</button><small>${iconMarkup("shield")} Secure checkout by Ezkart</small></div></div></section>`;
      const story = `<section class="sq-page-block sq-template-story" draggable="true" data-sq-block data-sq-fluid data-sq-rows="11" data-section-id="image-story">${templateHandle("story")}<div class="sq-template-story-copy element-animation-slide-left" data-sq-element data-sq-element-type="copy" data-sq-element-animation="slide-left" data-sq-hover="none" data-layout-desktop="1,2,8,9" data-layout-tablet="1,1,12,7" data-layout-mobile="1,1,12,7"><span>OUR POINT OF VIEW</span><h2>${escapeHtml(config.story)}</h2><p>${escapeHtml(config.storyBody)}</p><button class="button-tertiary" type="button">Read our story</button></div><aside class="sq-template-manifesto sq-surface-card element-animation-rise hover-lift" data-sq-element data-sq-element-type="content" data-sq-element-animation="rise" data-sq-hover="lift" data-layout-desktop="9,2,4,9" data-layout-tablet="1,8,12,4" data-layout-mobile="1,8,12,4"><strong>01</strong><b>Designed locally</b><small>Built for independent Indonesian brands and their customers.</small></aside></section>`;
      const benefits = `<section class="sq-page-block sq-benefit-row sq-template-benefits" draggable="true" data-sq-block data-sq-fluid data-sq-rows="6" data-section-id="benefits">${templateHandle("benefits")}<article class="element-animation-rise hover-lift" style="--element-delay:0ms" data-sq-element data-sq-element-type="benefit" data-sq-element-animation="rise" data-sq-hover="lift" data-layout-desktop="1,1,4,6" data-layout-tablet="1,1,4,6" data-layout-mobile="1,1,12,2">${iconMarkup("star")}<div><b>Thoughtful by default</b><small>Clear details and deliberate design</small></div></article><article class="element-animation-rise hover-lift" style="--element-delay:140ms" data-sq-element data-sq-element-type="benefit" data-sq-element-animation="rise" data-sq-hover="lift" data-layout-desktop="5,1,4,6" data-layout-tablet="5,1,4,6" data-layout-mobile="1,3,12,2">${iconMarkup("credit-card")}<div><b>Secure payment</b><small>Midtrans-ready checkout built in</small></div></article><article class="element-animation-rise hover-lift" style="--element-delay:280ms" data-sq-element data-sq-element-type="benefit" data-sq-element-animation="rise" data-sq-hover="lift" data-layout-desktop="9,1,4,6" data-layout-tablet="9,1,4,6" data-layout-mobile="1,5,12,2">${iconMarkup("truck")}<div><b>Delivery connected</b><small>Rates, couriers, and ETA included</small></div></article></section>`;
      const announcement = `<section class="sq-page-block sq-announcement" draggable="true" data-sq-block data-sq-fluid data-sq-rows="2" data-section-id="announcement">${templateHandle("announcement")}<p class="element-animation-fade" data-sq-element data-sq-element-type="text" data-sq-element-animation="fade" data-sq-hover="none" data-layout-desktop="1,1,12,2" data-layout-tablet="1,1,12,2" data-layout-mobile="1,1,12,2">${escapeHtml(config.announcement)}</p></section>`;
      const navigation = `<nav class="sq-page-block sq-store-nav" draggable="true" data-sq-block data-sq-fluid data-sq-rows="2" data-section-id="navigation">${templateHandle("navigation")}<b class="element-animation-fade" data-sq-element data-sq-element-type="brand" data-sq-element-animation="fade" data-sq-hover="none" data-layout-desktop="1,1,4,2" data-layout-tablet="1,1,4,2" data-layout-mobile="1,1,6,2">${escapeHtml(config.brand)}</b><div class="button-secondary element-animation-fade" data-sq-element data-sq-element-type="navigation" data-sq-button-role="secondary" data-sq-element-animation="fade" data-sq-hover="none" data-layout-desktop="7,1,6,2" data-layout-tablet="6,1,7,2" data-layout-mobile="7,1,6,2"><a href="#products">Shop</a><a href="#story">Story</a><a href="#shipping">Delivery</a><button type="button">Buy now</button></div></nav>`;
      let responsiveHero = overlay ? hero : hero.replace('data-layout-mobile="1,1,12,15"', 'data-layout-mobile="1,1,12,7"');
      const linkedStory = story.replace('<section class="', '<section id="story" class="').replace('sq-template-story-copy element-animation', 'sq-template-story-copy button-tertiary element-animation').replace('data-sq-element data-sq-element-type="copy"', 'data-sq-element data-sq-element-type="copy" data-sq-button-role="tertiary"').replace('<button class="button-tertiary"', '<button');
      return `${announcement}${navigation}${responsiveHero}${linkedStory}${commerceSectionMarkup("products", "rise", config.hover)}${benefits}${commerceSectionMarkup("checkout", config.entrance, "lift")}${commerceSectionMarkup("shipping", "fade", "none")}`;
    };
    const layerDetails = {
      announcement: ["Announcement", "Promotional message", "message"], navigation: ["Navigation", "Brand, links, and button", "layout"], hero: ["Hero", "Image, copy, and motion", "layout"], products: ["Product collection", "Connected commerce grid", "box"], "image-story": ["Brand story", "Editorial content", "image"], benefits: ["Benefits", "Three trust points", "star"], checkout: ["Checkout", "Midtrans cart action", "credit-card"], shipping: ["Shipping", "Courier and ETA", "truck"],
    };
    const rebuildLayerList = () => {
      if (!layerList) return;
      layerList.replaceChildren(...[...(previewRoot?.querySelectorAll(":scope > [data-sq-block]") || [])].map((section) => {
        const details = layerDetails[section.dataset.sectionId] || [elementTypeName(section), "Editable section", "layers"];
        const wrapper = document.createElement("div");
        wrapper.innerHTML = `<button type="button" draggable="true" data-sq-layer data-section-id="${escapeHtml(section.dataset.sectionId)}">${iconMarkup("grip")}<span>${iconMarkup(details[2])}</span><div><b>${escapeHtml(details[0])}</b><small>${escapeHtml(details[1])}</small></div>${iconMarkup("chevron-right")}</button>`;
        return wrapper.firstElementChild;
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
      remember(); selectedElement = null; removeElementOverlay();
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
      const layerTemplate = layerList?.querySelector("[data-sq-layer]")?.cloneNode(true);
      if (layerTemplate) {
        layerTemplate.dataset.sectionId = sectionId; layerTemplate.classList.remove("active", "section-hidden");
        const title = layerTemplate.querySelector("b"); const subtitle = layerTemplate.querySelector("small");
        if (title) title.textContent = ({ blank: "Blank canvas", "full-image": "Full image", gallery: "Image gallery", text: "Text story", testimonials: "Reviews", faq: "FAQ", spacer: "Spacer", products: "Product collection", checkout: "Checkout" })[type] || "Section";
        if (subtitle) subtitle.textContent = "Added just now · draggable";
        layerList.querySelector(`[data-section-id="${selectedSection}"]`)?.after(layerTemplate);
      }
      bindSqInteractions(); updateProductView(); selectSqSection(sectionId); openSqPanel("layers"); newBlock?.scrollIntoView({ behavior: "smooth", block: "center" }); markSqChanged();
    }));
    sqStudio.querySelector("[data-sq-block-search]")?.addEventListener("input", (event) => {
      const query = normalize(event.currentTarget.value);
      sqStudio.querySelectorAll("[data-sq-add-block], [data-sq-add-element]").forEach((button) => { button.hidden = Boolean(query) && !normalize(button.dataset.search).includes(query); });
    });

    sqStudio.querySelector("[data-sq-duplicate]")?.addEventListener("click", () => {
      const block = previewRoot?.querySelector(`[data-section-id="${selectedSection}"]`); const layer = layerList?.querySelector(`[data-section-id="${selectedSection}"]`); if (!block || !layer) return;
      remember(); const newId = `${selectedSection}-copy-${Date.now()}`; const blockCopy = block.cloneNode(true); const layerCopy = layer.cloneNode(true); blockCopy.dataset.sectionId = newId; layerCopy.dataset.sectionId = newId; blockCopy.classList.remove("selected"); layerCopy.classList.remove("active"); const title = layerCopy.querySelector("b"); if (title) title.textContent = `${title.textContent} copy`; block.after(blockCopy); layer.after(layerCopy); bindSqInteractions(); selectSqSection(newId); markSqChanged();
    });
    sqStudio.querySelector("[data-sq-visibility]")?.addEventListener("click", () => {
      const block = previewRoot?.querySelector(`[data-section-id="${selectedSection}"]`); const layer = layerList?.querySelector(`[data-section-id="${selectedSection}"]`); if (!block || !layer) return;
      remember(); const hidden = !block.classList.contains("section-hidden"); block.classList.toggle("section-hidden", hidden); layer.classList.toggle("section-hidden", hidden); selectSqSection(selectedSection); markSqChanged();
    });
    sqStudio.querySelector("[data-sq-delete]")?.addEventListener("click", () => {
      if ((previewRoot?.querySelectorAll("[data-sq-block]").length || 0) <= 1) { showToast("A page needs at least one section"); return; }
      const block = previewRoot?.querySelector(`[data-section-id="${selectedSection}"]`); const layer = layerList?.querySelector(`[data-section-id="${selectedSection}"]`); if (!block || !layer) return;
      remember(); const next = layer.nextElementSibling?.dataset.sectionId || layer.previousElementSibling?.dataset.sectionId; block.remove(); layer.remove(); bindSqInteractions(); if (next) selectSqSection(next); markSqChanged(); showToast("Section removed — Undo is available");
    });

    const setZoom = (value) => {
      zoom = Math.max(60, Math.min(100, value)); deviceFrame?.classList.remove("zoom-60", "zoom-70", "zoom-80", "zoom-90"); if (zoom < 100) deviceFrame?.classList.add(`zoom-${zoom}`); const output = sqStudio.querySelector("[data-sq-zoom]"); if (output) output.textContent = `${zoom}%`;
    };
    sqStudio.querySelector("[data-sq-zoom-out]")?.addEventListener("click", () => setZoom(zoom - 10));
    sqStudio.querySelector("[data-sq-zoom-in]")?.addEventListener("click", () => setZoom(zoom + 10));
    sqStudio.querySelector("[data-sq-fit]")?.addEventListener("click", () => setZoom(activeDevice === "desktop" ? 80 : activeDevice === "tablet" ? 90 : 100));
    sqStudio.querySelector("[data-sq-close-inspector]")?.addEventListener("click", () => { inspector?.classList.add("collapsed"); sqStudio.classList.add("inspector-closed"); });
    sqStudio.querySelector("[data-sq-preview]")?.addEventListener("click", (event) => {
      const enabled = !sqStudio.classList.contains("preview-mode"); sqStudio.classList.toggle("preview-mode", enabled); const label = event.currentTarget.querySelector("span"); if (label) label.textContent = enabled ? "Exit preview" : "Preview"; showToast(enabled ? "Full-canvas preview enabled — press Escape to exit" : "Editing tools restored");
    });
    document.addEventListener("keydown", (event) => { if (event.key === "Escape" && sqStudio.classList.contains("preview-mode")) { sqStudio.classList.remove("preview-mode"); const label = sqStudio.querySelector("[data-sq-preview] span"); if (label) label.textContent = "Preview"; } });
    document.addEventListener("keydown", (event) => {
      if (!selectedElement?.isConnected || event.target.closest("input,textarea,select,[contenteditable=true]")) return;
      if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); deleteSelectedElement(); return; }
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
      const tokens = [".sq-page-preview", ".sq-page-block", ".sq-announcement", ".sq-store-nav", ".sq-hero", ".sq-product", ".sq-image-story", ".sq-benefit", ".sq-cart", ".sq-shipping", ".sq-generated", ".sq-free", ".sq-template", ".sq-surface", ".sq-color", ".element-animation", ".hover-", ".button-", ".ez-fluid", "@keyframes sq", "@keyframes element", ".product-art", ".icon", ".svg-sprite"];
      const collect = (rules) => [...rules].map((rule) => {
        if (rule.cssRules) { const nested = collect(rule.cssRules); return nested ? `${rule.conditionText ? `@media ${rule.conditionText}` : rule.cssText.slice(0, rule.cssText.indexOf("{"))}{${nested}}` : ""; }
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
      clone.querySelectorAll(".sq-block-handle, .sq-image-drag-handle, .sq-element-overlay, .section-hidden, .sq-element-hidden").forEach((node) => node.remove());
      clone.querySelectorAll("[data-product-card][hidden], [data-product-line][hidden], .sq-hero-collage > span[hidden]").forEach((node) => node.remove());
      clone.querySelectorAll("[data-section-id]").forEach((node) => { node.dataset.ezkartSection = node.dataset.sectionId; });
      clone.querySelectorAll("[draggable], [contenteditable], [data-sq-block], [data-section-id]").forEach((node) => { node.removeAttribute("draggable"); node.removeAttribute("contenteditable"); node.removeAttribute("data-sq-block"); node.removeAttribute("data-section-id"); node.classList.remove("selected", "dragging", "drag-over", "animating"); });
      clone.querySelectorAll("[data-sq-image-list], [data-sq-image-item]").forEach((node) => { node.removeAttribute("data-sq-image-list"); node.removeAttribute("data-sq-image-item"); node.removeAttribute("tabindex"); node.classList.remove("sq-image-selected", "sq-image-dragging", "sq-image-drop-target"); });
      clone.querySelectorAll("[data-sq-editable], [data-sq-content]").forEach((node) => { node.removeAttribute("data-sq-editable"); node.removeAttribute("data-sq-content"); });
      clone.querySelectorAll("[data-sq-fluid]").forEach((node) => { node.classList.add("ez-fluid-section"); node.removeAttribute("data-sq-fluid"); node.removeAttribute("data-sq-rows"); node.removeAttribute("data-sq-min-rows"); });
      clone.querySelectorAll("[data-sq-element]").forEach((node) => {
        node.classList.add("ez-fluid-element");
        node.dataset.ezkartElement = node.dataset.sqElementId;
        ["sqElement", "sqElementId", "sqElementType", "sqElementAnimation", "sqHover", "sqSurface", "sqAlign", "sqButtonRole", "layoutDesktop", "layoutTablet", "layoutMobile"].forEach((key) => delete node.dataset[key]);
        node.classList.remove("sq-element-selected", "sq-element-animate");
      });
      clone.querySelectorAll("img").forEach((image) => { image.src = new URL(image.getAttribute("src"), window.location.href).href; });
      clone.querySelectorAll("[data-product-card]").forEach((card) => { const button = card.querySelector("button"); if (button) { button.dataset.ezkartAdd = card.dataset.productCard; button.type = "button"; } });
      const checkout = clone.querySelector(".sq-cart-section aside>button"); if (checkout) checkout.dataset.ezkartCheckout = "";
      const pageName = document.querySelector("[data-current-site-name]")?.textContent || "Ezkart Landing Page";
      const sprite = document.querySelector(".svg-sprite")?.outerHTML || "";
      const css = collectExportCss();
      const spacingCssFor = (device) => [...spacingState.entries()].filter(([key]) => key.endsWith(`:${device}`)).map(([key, value]) => { const section = key.slice(0, -(device.length + 1)); return `[data-ezkart-section="${section}"]{padding:${value.top}px ${value.right}px ${value.bottom}px ${value.left}px!important}`; }).join("\n");
      const fluidCssFor = (device) => [...previewRoot.querySelectorAll("[data-sq-fluid]")].map((section) => `[data-ezkart-section="${section.dataset.sectionId}"]{--sq-fluid-row-height:${fluidRowHeight(section, device)}px}`).join("\n");
      const elementCssFor = (device) => [...previewRoot.querySelectorAll("[data-sq-element]")].map((element) => { const layout = parseElementLayout(element, device); return `[data-ezkart-element="${element.dataset.sqElementId}"]{grid-column:${layout.x}/span ${layout.width}!important;grid-row:${layout.y}/span ${layout.height}!important}`; }).join("\n");
      const responsiveSpacing = `${spacingCssFor("desktop")}\n${fluidCssFor("desktop")}\n${elementCssFor("desktop")}\n@media(max-width:900px){${spacingCssFor("tablet")}\n${fluidCssFor("tablet")}\n${elementCssFor("tablet")}}\n@media(max-width:600px){${spacingCssFor("mobile")}\n${fluidCssFor("mobile")}\n${elementCssFor("mobile")}}`;
      const commerceScript = `<script>(()=>{const cart=new Set();document.querySelectorAll('[data-ezkart-add]').forEach(button=>button.addEventListener('click',()=>{const id=button.dataset.ezkartAdd;cart.has(id)?cart.delete(id):cart.add(id);button.textContent=cart.has(id)?'Added ✓':'Add to cart'}));document.querySelector('[data-ezkart-checkout]')?.addEventListener('click',()=>{const products=[...cart];if(!products.length){alert('Add at least one product first.');return}location.href='/cart/?products='+encodeURIComponent(products.join(','))});const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add(entry.target.matches('[class*="element-animation-"]')?'sq-element-animate':'animating');observer.unobserve(entry.target)}}),{threshold:.12});document.querySelectorAll('[class*="animation-"],[class*="element-animation-"]').forEach(element=>observer.observe(element))})();<\/script>`;
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
    sqStudio.querySelector("[data-sq-publish]")?.addEventListener("click", () => { if (saveState) saveState.textContent = "Published just now"; showToast("Page published with products, Midtrans, and shipping connected"); });
    sqStudio.querySelectorAll("[data-sq-site]").forEach((site) => site.addEventListener("click", () => { sqStudio.querySelectorAll("[data-sq-site]").forEach((item) => item.classList.toggle("active", item === site)); document.querySelectorAll("[data-current-site-name]").forEach((target) => { target.textContent = site.dataset.siteName; }); document.querySelectorAll("[data-current-site-url]").forEach((target) => { target.textContent = site.dataset.siteUrl; }); showToast(`${site.dataset.siteName} loaded into the editor`); }));

    const newPageDialog = document.getElementById("page-creator-dialog");
    sqStudio.querySelectorAll("[data-open-page-creator]").forEach((button) => button.addEventListener("click", () => newPageDialog?.showModal()));
    const newPageForm = newPageDialog?.querySelector("[data-page-creator-form]");
    const newPageName = newPageForm?.elements.namedItem("page_name");
    const newPageSlug = newPageForm?.elements.namedItem("slug");
    let newPageSlugEdited = false;
    const makePageSlug = (value) => normalize(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
    newPageSlug?.addEventListener("input", () => { newPageSlugEdited = true; newPageSlug.value = makePageSlug(newPageSlug.value); });
    newPageName?.addEventListener("input", () => { if (!newPageSlugEdited && newPageSlug) newPageSlug.value = makePageSlug(newPageName.value); });
    newPageForm?.addEventListener("submit", (event) => {
      if (event.submitter?.value === "cancel") return;
      event.preventDefault(); event.stopImmediatePropagation();
      const starters = [...newPageForm.querySelectorAll('input[name="starter_products[]"]:checked')];
      if (!starters.length) { showToast("Select at least one starting product"); newPageForm.querySelector('input[name="starter_products[]"]')?.focus(); return; }
      if (!newPageForm.reportValidity()) return;
      newPageDialog?.close(); showToast(`${newPageForm.elements.page_name.value} created with ${starters.length} products`); newPageForm.reset(); newPageSlugEdited = false;
    });

    bindSqInteractions();
    updateProductView();
    selectSqSection("announcement");
    syncBrandControls();
    setZoom(90);
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
