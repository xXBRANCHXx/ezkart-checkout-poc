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
    const undoStack = [];
    const redoStack = [];
    const spacingState = new Map();
    const inlineEditSnapshots = new WeakMap();
    let selectedSection = "announcement";
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
    const captureState = () => ({
      preview: previewRoot?.innerHTML || "",
      previewClass: previewRoot?.className || "",
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
      previewRoot.innerHTML = state.preview;
      previewRoot.className = state.previewClass;
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

    sqStudio.querySelectorAll("[data-sq-theme]").forEach((button) => button.addEventListener("click", () => {
      remember();
      sqStudio.querySelectorAll("[data-sq-theme]").forEach((item) => item.classList.toggle("active", item === button));
      previewRoot?.classList.remove("theme-coral", "theme-forest", "theme-indigo", "theme-charcoal");
      previewRoot?.classList.add(button.dataset.sqTheme);
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
    const newBlockMarkup = (type, sectionId) => {
      const handle = `<button class="sq-block-handle" type="button" aria-label="Drag section">${iconMarkup("grip")}</button>`;
      if (type === "full-image") return `<section class="sq-page-block sq-generated-image" draggable="true" data-sq-block data-section-id="${sectionId}">${handle}<img src="${productImages.granola}" alt="Granola Madu Nusantara product story"></section>`;
      if (type === "gallery") return `<section class="sq-page-block sq-generated-gallery" draggable="true" data-sq-block data-sq-image-list data-section-id="${sectionId}">${handle}<img draggable="true" tabindex="0" data-sq-image-item src="${productImages.granola}" alt="Granola — drag to rearrange"><img draggable="true" tabindex="0" data-sq-image-item src="${productImages.coffee}" alt="Kopi Susu — drag to rearrange"><img draggable="true" tabindex="0" data-sq-image-item src="${productImages.sambal}" alt="Sambal Roa — drag to rearrange"></section>`;
      if (type === "text") return `<section class="sq-page-block sq-generated-text" draggable="true" data-sq-block data-section-id="${sectionId}">${handle}<small>YOUR STORY</small><h2 contenteditable="true">A clear idea deserves room to breathe.</h2><p contenteditable="true">Write a concise product or brand story here. Every line remains editable directly on the page.</p></section>`;
      if (type === "testimonials") return `<section class="sq-page-block sq-generated-reviews" draggable="true" data-sq-block data-section-id="${sectionId}">${handle}<article><b>“Excellent flavor and beautifully packed.”</b><small>Sarah · verified buyer</small></article><article><b>“Checkout was easy and delivery was quick.”</b><small>Michael · verified buyer</small></article></section>`;
      if (type === "faq") return `<section class="sq-page-block sq-generated-faq" draggable="true" data-sq-block data-section-id="${sectionId}">${handle}<h2>Questions, answered.</h2><details open><summary>How does payment work?</summary><p>Customers complete a secure Midtrans checkout prepared by Ezkart.</p></details><details><summary>How is shipping calculated?</summary><p>Product weights, destination, courier, and service determine the live rate.</p></details></section>`;
      if (type === "spacer") return `<section class="sq-page-block sq-generated-spacer" draggable="true" data-sq-block data-section-id="${sectionId}">${handle}<span>Responsive spacer · 80px</span></section>`;
      const template = previewRoot?.querySelector(`[data-section-id="${type}"]`);
      if (template) { const clone = template.cloneNode(true); clone.dataset.sectionId = sectionId; clone.removeAttribute("id"); clone.classList.remove("selected"); return clone.outerHTML; }
      return `<section class="sq-page-block sq-generated-text" draggable="true" data-sq-block data-section-id="${sectionId}">${handle}<h2>New section</h2></section>`;
    };
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
        if (title) title.textContent = ({ "full-image": "Full image", gallery: "Image gallery", text: "Text story", testimonials: "Reviews", faq: "FAQ", spacer: "Spacer", products: "Product collection", checkout: "Checkout" })[type] || "Section";
        if (subtitle) subtitle.textContent = "Added just now · draggable";
        layerList.querySelector(`[data-section-id="${selectedSection}"]`)?.after(layerTemplate);
      }
      bindSqInteractions(); updateProductView(); selectSqSection(sectionId); openSqPanel("layers"); newBlock?.scrollIntoView({ behavior: "smooth", block: "center" }); markSqChanged();
    }));
    sqStudio.querySelector("[data-sq-block-search]")?.addEventListener("input", (event) => {
      const query = normalize(event.currentTarget.value);
      sqStudio.querySelectorAll("[data-sq-add-block]").forEach((button) => { button.hidden = Boolean(query) && !normalize(button.dataset.search).includes(query); });
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

    const exportDialog = document.getElementById("html-export-dialog");
    const collectExportCss = () => {
      const tokens = [".sq-page-preview", ".sq-page-block", ".sq-announcement", ".sq-store-nav", ".sq-hero", ".sq-product", ".sq-image-story", ".sq-benefit", ".sq-cart", ".sq-shipping", ".sq-generated", "@keyframes sq", ".product-art", ".icon", ".svg-sprite"];
      const collect = (rules) => [...rules].map((rule) => {
        if (rule.cssRules) { const nested = collect(rule.cssRules); return nested ? `${rule.conditionText ? `@media ${rule.conditionText}` : rule.cssText.slice(0, rule.cssText.indexOf("{"))}{${nested}}` : ""; }
        return tokens.some((token) => rule.cssText.includes(token)) ? rule.cssText : "";
      }).join("\n");
      return [...document.styleSheets].map((sheet) => { try { return collect(sheet.cssRules); } catch (_) { return ""; } }).join("\n");
    };
    const generateHtml = () => {
      const clone = previewRoot.cloneNode(true);
      clone.querySelectorAll(".sq-block-handle, .sq-image-drag-handle, .section-hidden").forEach((node) => node.remove());
      clone.querySelectorAll("[data-product-card][hidden], [data-product-line][hidden], .sq-hero-collage > span[hidden]").forEach((node) => node.remove());
      clone.querySelectorAll("[data-section-id]").forEach((node) => { node.dataset.ezkartSection = node.dataset.sectionId; });
      clone.querySelectorAll("[draggable], [contenteditable], [data-sq-block], [data-section-id]").forEach((node) => { node.removeAttribute("draggable"); node.removeAttribute("contenteditable"); node.removeAttribute("data-sq-block"); node.removeAttribute("data-section-id"); node.classList.remove("selected", "dragging", "drag-over", "animating"); });
      clone.querySelectorAll("[data-sq-image-list], [data-sq-image-item]").forEach((node) => { node.removeAttribute("data-sq-image-list"); node.removeAttribute("data-sq-image-item"); node.removeAttribute("tabindex"); node.classList.remove("sq-image-selected", "sq-image-dragging", "sq-image-drop-target"); });
      clone.querySelectorAll("[data-sq-editable], [data-sq-content]").forEach((node) => { node.removeAttribute("data-sq-editable"); node.removeAttribute("data-sq-content"); });
      clone.querySelectorAll("img").forEach((image) => { image.src = new URL(image.getAttribute("src"), window.location.href).href; });
      clone.querySelectorAll("[data-product-card]").forEach((card) => { const button = card.querySelector("button"); if (button) { button.dataset.ezkartAdd = card.dataset.productCard; button.type = "button"; } });
      const checkout = clone.querySelector(".sq-cart-section aside>button"); if (checkout) checkout.dataset.ezkartCheckout = "";
      const pageName = document.querySelector("[data-current-site-name]")?.textContent || "Ezkart Landing Page";
      const sprite = document.querySelector(".svg-sprite")?.outerHTML || "";
      const css = collectExportCss();
      const spacingCssFor = (device) => [...spacingState.entries()].filter(([key]) => key.endsWith(`:${device}`)).map(([key, value]) => { const section = key.slice(0, -(device.length + 1)); return `[data-ezkart-section="${section}"]{padding:${value.top}px ${value.right}px ${value.bottom}px ${value.left}px!important}`; }).join("\n");
      const responsiveSpacing = `${spacingCssFor("desktop")}\n@media(max-width:900px){${spacingCssFor("tablet")}}\n@media(max-width:600px){${spacingCssFor("mobile")}}`;
      const commerceScript = `<script>(()=>{const cart=new Set();document.querySelectorAll('[data-ezkart-add]').forEach(button=>button.addEventListener('click',()=>{const id=button.dataset.ezkartAdd;cart.has(id)?cart.delete(id):cart.add(id);button.textContent=cart.has(id)?'Added ✓':'Add to cart'}));document.querySelector('[data-ezkart-checkout]')?.addEventListener('click',()=>{const products=[...cart];if(!products.length){alert('Add at least one product first.');return}location.href='/cart/?products='+encodeURIComponent(products.join(','))});const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add('animating');observer.unobserve(entry.target)}}),{threshold:.12});document.querySelectorAll('[class*="animation-"]').forEach(section=>observer.observe(section))})();<\/script>`;
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
