/* Shared publication rules. Catalog ownership is checked again by the server. */
(() => {
  const available = (product, variantId = "") => {
    if (!product || ![undefined, "active"].includes(product.status))
      return false;
    const variants = (product.variants || []).filter((item) => !item.hidden);
    if (product.variants?.length && !variants.length) return false;
    if (variantId) {
      const variant = variants.find((v) => v.id === variantId);
      if (!variant) return false;
      return (
        ["digital", "subscription"].includes(product.type) ||
        Number(variant.stock ?? product.stock) >= 1
      );
    }
    if (["digital", "subscription"].includes(product.type)) return true;
    return variants.length
      ? variants.some((item) => Number(item.stock ?? product.stock) >= 1)
      : Number(product.stock) >= 1;
  };
  const purchase = (config) => {
    if (config.type === "product" || config.part === "add")
      return config.productId
        ? [
            config.part === "add" && config.variantId
              ? `${config.productId}::${config.variantId}`
              : config.productId,
          ]
        : [];
    if (config.part === "set-add") return config.productIds || [];
    return [];
  };
  const check = (groups, products) => {
    const catalog = new Map(products.map((p) => [p.id, p]));
    const owned = groups.filter(
      (ids) => ids.length && ids.every((id) => catalog.has(id.split("::")[0])),
    );
    if (!owned.length)
      return "Add one of your products to the page before publishing.";
    if (
      !owned.some((ids) =>
        ids.every((id) => {
          const [productId, variantId] = id.split("::");
          return available(catalog.get(productId), variantId);
        }),
      )
    )
      return "Add stock to a product on this page before publishing. At least one product or visible variant must be available to buy.";
    return "";
  };
  const hidden = (get) => {
    const style = get("style") || "";
    let config = {};
    try {
      config = JSON.parse(get("data-sq-native") || "{}");
    } catch {}
    const props = config.props || {};
    return (
      get("hidden") !== null ||
      get("aria-hidden") === "true" ||
      get("data-native-collapsed") === "true" ||
      config.collapsed ||
      props.display === "none" ||
      props.visibility === "hidden" ||
      Number(props.opacity ?? 1) === 0 ||
      /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:\.0*)?)\s*(?:!important)?\s*(?:;|$)/i.test(
        style,
      )
    );
  };
  const fromAttributes = (get) => {
    const legacy = get("data-ezkart-add") || get("data-product-card");
    if (legacy)
      return [
        get("data-ezkart-variant")
          ? `${legacy}::${get("data-ezkart-variant")}`
          : legacy,
      ];
    try {
      return purchase(
        JSON.parse(
          get("data-native-commerce") || get("data-sq-native") || "{}",
        ),
      );
    } catch {
      return [];
    }
  };
  const groupsInDocument = (root) =>
    [
      ...root.querySelectorAll(
        "[data-native-commerce],[data-sq-native],[data-ezkart-add],[data-product-card]",
      ),
    ]
      .filter((node) => {
        if (
          !node.matches("button[data-ezkart-add]") &&
          !node.querySelector(
            "button[data-commerce-add],button[data-commerce-set],[data-product-card] footer button",
          ) &&
          !(
            node.matches("[data-product-card]") &&
            node.querySelector("footer button")
          )
        )
          return false;
        for (
          let parent = node;
          parent && parent !== root;
          parent = parent.parentElement
        )
          if (
            hidden((key) => parent.getAttribute(key)) ||
            ["TEMPLATE", "SCRIPT", "STYLE", "NOSCRIPT"].includes(parent.tagName)
          )
            return false;
        return true;
      })
      .map((node) => fromAttributes((key) => node.getAttribute(key)))
      .filter((ids) => ids.length);
  globalThis.EzkartPublish = Object.freeze({
    available,
    purchase,
    check,
    hidden,
    fromAttributes,
    groupsInDocument,
  });
})();
