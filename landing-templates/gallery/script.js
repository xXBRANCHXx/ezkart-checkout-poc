(() => {
  "use strict";

  const products = Array.from(document.querySelectorAll(".product-card")).map((card) => {
    const button = card.querySelector("[data-product]");
    return {
      name: button.dataset.product,
      price: button.dataset.price,
      material: button.dataset.material,
      asset: button.dataset.asset,
      position: button.dataset.position,
      category: card.dataset.category,
      card,
      button
    };
  });

  const assetPaths = {
    one: "assets/catalog-one.png",
    two: "assets/catalog-two.png"
  };

  const quickView = document.querySelector("[data-quick-view]");
  const quickMedia = document.querySelector("[data-quick-media]");
  const quickImage = document.querySelector("[data-quick-image]");
  const quickName = document.querySelector("[data-quick-name]");
  const quickPrice = document.querySelector("[data-quick-price]");
  const quickMaterial = document.querySelector("[data-quick-material]");
  const searchDialog = document.querySelector("[data-search-dialog]");
  const searchInput = document.querySelector("[data-search-input]");
  const searchResults = document.querySelector("[data-search-results]");
  const cartDialog = document.querySelector("[data-cart-dialog]");
  const cartContent = document.querySelector("[data-cart-content]");
  const cartCount = document.querySelector("[data-cart-count]");
  const checkout = document.querySelector("[data-checkout]");
  const toast = document.querySelector("[data-cart-toast]");
  const grid = document.querySelector("[data-product-grid]");
  const catalogStatus = document.querySelector("[data-catalog-status]");
  const menu = document.querySelector("#mobile-menu");
  const menuToggle = document.querySelector("[data-menu-toggle]");
  let currentProduct = products[0];
  const cart = [];

  const openDialog = (dialog) => {
    if (dialog && !dialog.open) dialog.showModal();
  };

  const closeOnBackdrop = (dialog) => {
    dialog?.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
  };

  [quickView, searchDialog, cartDialog].forEach(closeOnBackdrop);

  const setQuickProduct = (product) => {
    currentProduct = product;
    quickName.textContent = product.name;
    quickPrice.textContent = product.price;
    quickMaterial.textContent = product.material;
    quickMedia.className = `quick-media quadrant ${product.position}`;
    quickImage.src = assetPaths[product.asset];
    quickImage.alt = `Fictional ${product.name}`;
  };

  products.forEach((product) => {
    product.button.addEventListener("click", () => {
      setQuickProduct(product);
      openDialog(quickView);
    });
  });

  const selectFilter = (filter) => {
    let visible = 0;
    document.querySelectorAll("[data-filter]").forEach((button) => {
      const active = button.dataset.filter === filter;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });

    products.forEach((product) => {
      const show = filter === "All" || product.category === filter;
      product.card.hidden = !show;
      if (show) visible += 1;
    });
    catalogStatus.textContent = `Showing ${visible} fictional demo product${visible === 1 ? "" : "s"}`;
  };

  document.querySelectorAll("[data-filter]").forEach((button) => {
    button.addEventListener("click", () => selectFilter(button.dataset.filter));
  });

  document.querySelectorAll("[data-filter-link]").forEach((link) => {
    link.addEventListener("click", () => selectFilter(link.dataset.filterLink));
  });

  document.querySelectorAll("[data-density]").forEach((button) => {
    button.addEventListener("click", () => {
      const compact = button.dataset.density === "compact";
      grid.classList.toggle("is-compact", compact);
      document.querySelectorAll("[data-density]").forEach((choice) => {
        const active = choice === button;
        choice.classList.toggle("is-active", active);
        choice.setAttribute("aria-pressed", String(active));
      });
    });
  });

  menuToggle?.addEventListener("click", () => {
    const expanded = menuToggle.getAttribute("aria-expanded") === "true";
    menuToggle.setAttribute("aria-expanded", String(!expanded));
    menu.hidden = expanded;
  });

  menu?.querySelectorAll("a, button").forEach((control) => {
    control.addEventListener("click", () => {
      menu.hidden = true;
      menuToggle.setAttribute("aria-expanded", "false");
    });
  });

  document.querySelectorAll("[data-search-open]").forEach((button) => {
    button.addEventListener("click", () => {
      openDialog(searchDialog);
      window.setTimeout(() => searchInput.focus(), 0);
    });
  });

  searchInput?.addEventListener("input", () => {
    const query = searchInput.value.trim().toLowerCase();
    if (!query) {
      searchResults.textContent = "Start typing to filter the fictional demo catalog.";
      return;
    }
    const matches = products.filter((product) => `${product.name} ${product.category} ${product.material}`.toLowerCase().includes(query));
    searchResults.replaceChildren();
    if (!matches.length) {
      searchResults.textContent = "No matching demo products.";
      return;
    }
    matches.forEach((product) => {
      const button = document.createElement("button");
      const name = document.createElement("span");
      const price = document.createElement("span");
      button.type = "button";
      button.className = "search-result";
      name.textContent = product.name;
      price.textContent = product.price;
      button.append(name, price);
      button.addEventListener("click", () => {
        searchDialog.close();
        setQuickProduct(product);
        openDialog(quickView);
      });
      searchResults.append(button);
    });
  });

  const numericPrice = (price) => Number(price.replace(/\D/g, ""));
  const formatPrice = (value) => `Rp${new Intl.NumberFormat("id-ID").format(value)}`;

  const renderCart = () => {
    cartCount.textContent = String(cart.length);
    checkout.disabled = cart.length === 0;
    cartContent.replaceChildren();
    if (!cart.length) {
      const empty = document.createElement("p");
      empty.textContent = "Your cart is empty.";
      cartContent.append(empty);
      return;
    }

    cart.forEach((product) => {
      const line = document.createElement("div");
      const name = document.createElement("span");
      const price = document.createElement("span");
      line.className = "cart-line";
      name.textContent = product.name;
      price.textContent = product.price;
      line.append(name, price);
      cartContent.append(line);
    });

    const total = document.createElement("div");
    const label = document.createElement("strong");
    const price = document.createElement("strong");
    total.className = "cart-total";
    label.textContent = "Total";
    price.textContent = formatPrice(cart.reduce((sum, product) => sum + numericPrice(product.price), 0));
    total.append(label, price);
    cartContent.append(total);
  };

  const showToast = (message) => {
    toast.textContent = message;
    toast.classList.add("is-visible");
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => toast.classList.remove("is-visible"), 2200);
  };

  document.querySelector("[data-add-product]")?.addEventListener("click", () => {
    cart.push(currentProduct);
    renderCart();
    quickView.close();
    showToast(`${currentProduct.name} added to cart`);
  });

  document.querySelectorAll("[data-cart-open]").forEach((button) => {
    button.addEventListener("click", () => openDialog(cartDialog));
  });

  document.querySelectorAll("[data-material-note]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll("[data-material-note]").forEach((choice) => choice.classList.toggle("is-active", choice === button));
      document.querySelector("[data-material-output]").textContent = button.dataset.materialNote;
    });
  });

  document.querySelector("[data-newsletter-form]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    document.querySelector("[data-newsletter-status]").textContent = "Thanks — this demo form is ready for the merchant’s real mailing-list connection.";
    form.reset();
  });

  document.querySelector("[data-year]").textContent = String(new Date().getFullYear());
  renderCart();
})();
