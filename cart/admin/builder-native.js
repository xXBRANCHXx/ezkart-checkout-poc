/* Native containers, rich text, media, and responsive properties. No page-specific renderer. */
(() => {
  const groups = {
    Layout: {
      containerType: ["normal", "inline-size", "size"],
      display: [
        "block",
        "flex",
        "inline-flex",
        "grid",
        "inline",
        "inline-block",
        "contents",
        "none",
      ],
      flexDirection: ["row", "column", "row-reverse", "column-reverse"],
      flexWrap: ["nowrap", "wrap", "wrap-reverse"],
      alignItems: [
        "normal",
        "stretch",
        "center",
        "flex-start",
        "flex-end",
        "baseline",
      ],
      justifyContent: [
        "normal",
        "flex-start",
        "flex-end",
        "center",
        "space-between",
        "space-around",
        "space-evenly",
      ],
      alignSelf: ["auto", "stretch", "center", "flex-start", "flex-end"],
      gap: "length",
      rowGap: "length",
      columnGap: "length",
      gridTemplateColumns: "columns",
      gridTemplateRows: "columns",
      gridColumn: "text",
      gridRow: "text",
      flexGrow: "number",
      flexShrink: "number",
      flexBasis: "length",
      order: "number",
    },
    Size: {
      width: "length",
      height: "length",
      minWidth: "length",
      maxWidth: "length",
      minHeight: "length",
      maxHeight: "length",
      aspectRatio: "text",
      overflow: ["visible", "hidden", "clip", "auto", "scroll"],
      overflowX: ["visible", "hidden", "clip", "auto", "scroll"],
      overflowY: ["visible", "hidden", "clip", "auto", "scroll"],
      objectFit: ["fill", "contain", "cover", "none", "scale-down"],
      objectPosition: "text",
    },
    Spacing: {
      paddingTop: "length",
      paddingRight: "length",
      paddingBottom: "length",
      paddingLeft: "length",
      marginTop: "length",
      marginRight: "length",
      marginBottom: "length",
      marginLeft: "length",
      scrollMarginTop: "length",
    },
    Typography: {
      fontFamily: "text",
      fontOpticalSizing: ["auto", "none"],
      fontSize: "length",
      fontWeight: "number",
      lineHeight: "length",
      letterSpacing: "length",
      textAlign: ["start", "left", "center", "right", "end", "justify"],
      textTransform: ["none", "uppercase", "lowercase", "capitalize"],
      whiteSpace: ["normal", "nowrap", "pre", "pre-line", "pre-wrap"],
      verticalAlign: "length",
      textDecoration: "text",
      textWrap: ["wrap", "nowrap", "balance", "pretty"],
      overflowWrap: ["normal", "break-word", "anywhere"],
      color: "color",
    },
    Surface: {
      backgroundColor: "color",
      borderTopWidth: "length",
      borderRightWidth: "length",
      borderBottomWidth: "length",
      borderLeftWidth: "length",
      borderTopColor: "color",
      borderRightColor: "color",
      borderBottomColor: "color",
      borderLeftColor: "color",
      borderTopStyle: [
        "none",
        "solid",
        "dashed",
        "dotted",
        "double",
        "outset",
        "inset",
        "groove",
        "ridge",
        "hidden",
      ],
      borderRightStyle: [
        "none",
        "solid",
        "dashed",
        "dotted",
        "double",
        "outset",
        "inset",
        "groove",
        "ridge",
        "hidden",
      ],
      borderBottomStyle: [
        "none",
        "solid",
        "dashed",
        "dotted",
        "double",
        "outset",
        "inset",
        "groove",
        "ridge",
        "hidden",
      ],
      borderLeftStyle: [
        "none",
        "solid",
        "dashed",
        "dotted",
        "double",
        "outset",
        "inset",
        "groove",
        "ridge",
        "hidden",
      ],
      borderRadius: "length",
      boxShadow: "shadow",
      opacity: "number",
      filter: "filter",
      backdropFilter: "filter",
    },
    Position: {
      position: ["static", "relative", "absolute", "fixed", "sticky"],
      top: "length",
      right: "length",
      bottom: "length",
      left: "length",
      zIndex: "number",
      transform: "transform",
      transformOrigin: "text",
      perspective: "length",
      isolation: ["auto", "isolate"],
      cursor: ["auto", "default", "pointer"],
      listStyleType: ["none", "disc", "decimal"],
      pointerEvents: ["auto", "none"],
    },
  };
  const schema = Object.assign({}, ...Object.values(groups));
  const tags = {
    container: [
      "div",
      "span",
      "section",
      "header",
      "footer",
      "aside",
      "nav",
      "article",
      "ul",
      "ol",
      "li",
      "main",
      "label",
      "dialog",
    ],
    text: ["p", "span", "small", "strong", "b", "em", "i"],
    heading: ["h1", "h2", "h3", "h4"],
    button: ["a", "button"],
    image: ["img"],
    product: ["div"],
    commerce: ["div"],
    icon: ["svg"],
    video: ["video"],
    accordion: ["details"],
    summary: ["summary"],
    break: ["br"],
  };
  const defaults = {
    commerce: { display: "block", width: "100%", fontSize: "14px" },
    product: {
      display: "grid",
      gridTemplateColumns: "minmax(0, 1fr)",
      containerType: "inline-size",
      width: "360px",
      maxWidth: "100%",
      height: "auto",
      fontSize: "16px",
      backgroundColor: "#ffffff",
      borderRadius: "14px",
    },
    container: { display: "flex", flexDirection: "column", gap: "16px" },
    text: { fontSize: "16px", lineHeight: "1.6" },
    heading: { fontSize: "48px", fontWeight: "600", lineHeight: "1.15" },
    button: {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      gap: "12px",
      paddingTop: "14px",
      paddingBottom: "14px",
      paddingLeft: "24px",
      paddingRight: "24px",
      backgroundColor: "#242424",
      color: "#ffffff",
      borderRadius: "8px",
      fontSize: "14px",
      cursor: "pointer",
    },
    image: { display: "block", maxWidth: "100%", objectFit: "cover" },
    icon: {
      display: "inline-block",
      width: "20px",
      height: "20px",
      flexShrink: "0",
    },
    video: { display: "block", width: "100%" },
    accordion: { display: "block" },
    summary: {
      display: "flex",
      justifyContent: "space-between",
      cursor: "pointer",
      listStyleType: "none",
    },
    break: {},
  };
  const cssName = (key) => key.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
  const label = (key) =>
    key
      .replace(/[A-Z]/g, (c) => " " + c.toLowerCase())
      .replace(/^./, (c) => c.toUpperCase());
  const identifier = (value) => /^[a-z][a-z0-9-]{0,80}$/.test(value || "");
  const typeName = (type) =>
    ({
      container: "Layout group",
      text: "Paragraph",
      product: "Product card",
      commerce: "Product control",
      accordion: "Expandable answer",
      summary: "Answer heading",
    })[type] || label(type);
  function validateProps(props = {}) {
    for (const [key, value] of Object.entries(props)) {
      if (!schema[key]) throw Error(`Unknown native property: ${key}`);
      const text = String(value);
      if (/[;{}<>]|url\s*\(|expression|javascript/i.test(text))
        throw Error(`Invalid ${label(key)} value.`);
      if (Array.isArray(schema[key]) && !schema[key].includes(text))
        throw Error(`Choose a listed ${label(key)} option.`);
      if (!CSS.supports(cssName(key), text))
        throw Error(`Invalid ${label(key)} value: ${text}`);
    }
    return props;
  }
  const color = (value) => {
    if (!CSS.supports("color", String(value)) || /[;{}<>]/.test(value))
      throw Error("Choose a valid color.");
    return String(value);
  };
  function gradientCss(layers) {
    if (!Array.isArray(layers) || layers.length > 8)
      throw Error("Use up to eight gradient layers.");
    return layers
      .map((layer) => {
        if (!["linear", "radial"].includes(layer.kind))
          throw Error("Choose linear or radial.");
        if (
          !Array.isArray(layer.stops) ||
          layer.stops.length < 2 ||
          layer.stops.length > 12
        )
          throw Error("A gradient needs 2–12 stops.");
        const stops = layer.stops
          .map((s) => {
            if (
              !Number.isFinite(s.position) ||
              s.position < 0 ||
              s.position > 100
            )
              throw Error("Gradient stops must be between 0 and 100%.");
            return `${color(s.color)} ${s.position}%`;
          })
          .join(",");
        if (layer.kind === "linear") {
          if (!Number.isFinite(layer.angle)) throw Error("Enter an angle.");
          return `linear-gradient(${layer.angle}deg,${stops})`;
        }
        const x = Number(layer.x ?? 50),
          y = Number(layer.y ?? 50);
        if (!Number.isFinite(x) || !Number.isFinite(y))
          throw Error("Enter the radial center.");
        return `radial-gradient(${layer.shape === "circle" ? "circle" : "ellipse"} at ${x}% ${y}%,${stops})`;
      })
      .join(",");
  }
  let textColorAdapter = null;
  const read = (node) => {
    if (node && node === textColorAdapter?.node)
      return structuredClone(textColorAdapter.config);
    try {
      return JSON.parse(node.dataset.sqNative || "{}");
    } catch {
      return {};
    }
  };
  const write = (node, config) => {
    if (node === textColorAdapter?.node) {
      textColorAdapter.config = structuredClone(config);
      return;
    }
    node.dataset.sqNative = JSON.stringify(config);
  };
  const safeUrl = (value) => {
    if (!/^(https?:\/\/|mailto:|tel:|#|\/(?!\/))/.test(value || ""))
      throw Error("Use a web, email, phone, or section destination.");
    return value;
  };
  function validate(config, depth = 0, ids = new Set()) {
    if (depth > 24) throw Error("Too many nested containers.");
    if (!identifier(config.id) || ids.has(config.id))
      throw Error("Each native element needs a unique ID.");
    ids.add(config.id);
    if (!tags[config.type]) throw Error("Choose a native element type.");
    if (
      config.type === "product" &&
      (typeof config.productId !== "string" ||
        !/^[a-zA-Z0-9_-]{1,120}$/.test(config.productId))
    )
      throw Error("Choose a product from your catalog.");
    if (config.tag && !tags[config.type].includes(config.tag))
      throw Error("Choose a supported semantic role.");
    if (
      config.icon &&
      !Object.hasOwn(globalThis.EzkartNativeIcons || {}, config.icon)
    )
      throw Error("Choose an icon from the library.");
    for (const key of ["iconFill", "iconStroke"])
      if (
        config[key] !== undefined &&
        !["none", "currentColor"].includes(config[key])
      )
        color(config[key]);
    if (
      config.iconWeight !== undefined &&
      (!Number.isFinite(config.iconWeight) ||
        config.iconWeight < 0 ||
        config.iconWeight > 24)
    )
      throw Error("Use an icon stroke weight from 0 to 24.");
    validateProps(config.props);
    if (config.fill?.layers) gradientCss(config.fill.layers);
    for (const rule of config.responsive || []) {
      if (
        (rule.min != null && (!Number.isFinite(rule.min) || rule.min < 0)) ||
        (rule.max != null && (!Number.isFinite(rule.max) || rule.max < 0))
      )
        throw Error("Enter numeric breakpoints.");
      validateProps(rule.props);
      if (rule.fill?.layers) gradientCss(rule.fill.layers);
    }
    for (const [name, state] of Object.entries(config.states || {})) {
      if (!identifier(name)) throw Error("Use a short state name.");
      validateProps(state.props);
      if (state.fill?.layers) gradientCss(state.fill.layers);
      for (const rule of state.responsive || []) {
        validateProps(rule.props);
        if (rule.fill?.layers) gradientCss(rule.fill.layers);
      }
    }
    if (
      config.scrollMotion &&
      (!Number.isFinite(config.scrollMotion.tilt) ||
        !Number.isFinite(config.scrollMotion.travel))
    )
      throw Error("Enter numeric motion values.");
    if (
      config.fit &&
      (!Number.isFinite(config.fit.max) ||
        !Number.isFinite(config.fit.width) ||
        config.fit.width <= 0 ||
        !Number.isFinite(config.fit.height) ||
        !Number.isFinite(config.fit.extra))
    )
      throw Error("Enter valid frame dimensions.");
    if (config.type === "commerce") {
      if (
        ![
          "image",
          "options",
          "price",
          "title",
          "description",
          "add",
          "cart",
          "product-name",
          "set-price",
          "set-add",
        ].includes(config.part)
      )
        throw Error("Choose a product control.");
      if (
        !["cart", "set-price", "set-add"].includes(config.part) &&
        !/^[a-zA-Z0-9_-]{1,120}$/.test(config.productId || "")
      )
        throw Error("Choose a catalog product.");
      if (config.group && !identifier(config.group))
        throw Error(
          "Use letters, numbers and hyphens for the shared selection name.",
        );
      if (
        config.optionLayout &&
        !["compact", "detailed", "select"].includes(config.optionLayout)
      )
        throw Error("Choose side-by-side, detailed, or dropdown options.");
    }
    for (const key of [
      "stateScope",
      "initialState",
      "stateParam",
      "statePanel",
    ])
      if (config[key] && !identifier(config[key]))
        throw Error("Use a short name for the state or group.");
    if (config.stateMode && !["tabs", "filter"].includes(config.stateMode))
      throw Error("Choose tabs or filters.");
    if (
      config.productIds &&
      (!Array.isArray(config.productIds) ||
        config.productIds.length > 24 ||
        config.productIds.some((id) => !/^[a-zA-Z0-9_-]{1,120}$/.test(id)) ||
        new Set(config.productIds).size !== config.productIds.length)
    )
      throw Error("Choose up to 24 different catalog products.");
    if (
      ["set-price", "set-add"].includes(config.part) &&
      !config.productIds?.length
    )
      throw Error("Choose products for this set.");
    if (config.scrollVisibility) {
      const v = config.scrollVisibility;
      if (
        (v.after && !identifier(v.after)) ||
        !Array.isArray(v.hideWhile || []) ||
        (v.hideWhile || []).some((id) => !identifier(id))
      )
        throw Error(
          "Choose valid section or element IDs for scroll visibility.",
        );
    }
    if (config.src) safeUrl(config.src);
    if (config.poster) safeUrl(config.poster);
    if (config.captions) safeUrl(config.captions);
    if (config.action) {
      if (
        ![
          "link",
          "toggle",
          "state",
          "dialog",
          "close-dialog",
          "video-dialog",
          "video-toggle",
        ].includes(config.action.type)
      )
        throw Error("Choose an interaction.");
      if (config.action.scope && !identifier(config.action.scope))
        throw Error("Choose a valid interaction group.");
      if (
        config.action.disableWhenActive != null &&
        typeof config.action.disableWhenActive !== "boolean"
      )
        throw Error("Disable when selected must be on or off.");
      if (config.action.type === "link") safeUrl(config.action.target);
      else if (!identifier(config.action.target))
        throw Error("Choose a target element or state.");
    }
    for (const mark of config.marks || []) {
      if (
        !Number.isInteger(mark.start) ||
        !Number.isInteger(mark.end) ||
        mark.start < 0 ||
        mark.end < mark.start ||
        mark.end > String(config.text || "").length
      )
        throw Error("Choose a valid text range.");
      if (mark.color) color(mark.color);
      if (mark.gradient) gradientCss(mark.gradient);
    }
    for (const child of config.children || []) validate(child, depth + 1, ids);
    return config;
  }
  function editText(config, value) {
    const old = String(config.text || ""),
      text = String(value);
    let start = 0,
      suffix = 0;
    while (
      start < old.length &&
      start < text.length &&
      old[start] === text[start]
    )
      start++;
    while (
      suffix < old.length - start &&
      suffix < text.length - start &&
      old[old.length - 1 - suffix] === text[text.length - 1 - suffix]
    )
      suffix++;
    const removedEnd = old.length - suffix,
      insertedEnd = text.length - suffix,
      delta = text.length - old.length;
    config.marks = (config.marks || [])
      .map((mark) => ({
        ...mark,
        start:
          mark.start <= start
            ? mark.start
            : mark.start >= removedEnd
              ? mark.start + delta
              : start,
        end:
          mark.end < start
            ? mark.end
            : mark.end >= removedEnd
              ? mark.end + delta
              : insertedEnd,
      }))
      .filter((mark) => mark.end > mark.start);
    config.text = text;
    return config;
  }
  function renderText(node, config) {
    if (node === textColorAdapter?.node) {
      renderDOMColors(node, config);
      return;
    }
    node.replaceChildren();
    const text = String(config.text || ""),
      marks = config.marks || [],
      cuts = [
        ...new Set([0, text.length, ...marks.flatMap((m) => [m.start, m.end])]),
      ].sort((a, b) => a - b);
    for (let i = 0; i < cuts.length - 1; i++) {
      const start = cuts[i],
        end = cuts[i + 1],
        mark = marks.filter((m) => m.start <= start && m.end >= end).at(-1);
      if (!mark) {
        node.append(document.createTextNode(text.slice(start, end)));
        continue;
      }
      const span = document.createElement("span");
      span.textContent = text.slice(start, end);
      span.className = "sq-native-run";
      if (mark.color) span.style.color = mark.color;
      if (mark.gradient) {
        span.style.backgroundImage = gradientCss(mark.gradient);
        span.style.backgroundClip = "text";
        span.style.webkitBackgroundClip = "text";
        span.style.color = "transparent";
      }
      if (mark.weight) span.style.fontWeight = mark.weight;
      if (mark.italic) span.style.fontStyle = "italic";
      node.append(span);
    }
  }
  function syncMedia(node, config) {
    if (node.tagName !== "VIDEO") return;
    node.src = config.src || "";
    node.poster = config.poster || "";
    node.controls = Boolean(config.controls);
    node.muted = config.muted !== false;
    node.loop = Boolean(config.loop);
    node.querySelectorAll("track").forEach((t) => t.remove());
    if (config.captions || config.captionsText) {
      const track = document.createElement("track");
      Object.assign(track, {
        kind: "captions",
        label: "Bahasa Indonesia",
        srclang: "id",
        src: config.captionsText
          ? "data:text/vtt;charset=utf-8," +
            encodeURIComponent(config.captionsText)
          : config.captions,
      });
      node.append(track);
    }
  }
  function create(config) {
    const tag = config.tag || tags[config.type][0];
    let node;
    if (config.type === "icon") {
      node = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      node.setAttribute("viewBox", "0 0 24 24");
      node.setAttribute("fill", config.iconFill || "none");
      node.setAttribute("stroke", config.iconStroke || "currentColor");
      node.setAttribute("stroke-width", String(config.iconWeight ?? 1.6));
      node.setAttribute("stroke-linecap", "round");
      node.setAttribute("stroke-linejoin", "round");
      node.setAttribute("aria-hidden", "true");
      const source =
        globalThis.EzkartNativeIcons?.[config.icon || "arrow-right"];
      if (source) node.innerHTML = source;
    } else node = document.createElement(tag);
    node.classList.add("sq-native");
    node.dataset.nativeId = config.id;
    node.dataset.sqElement = "";
    node.dataset.sqElementId = config.id;
    node.dataset.sqElementType = config.type;
    node.dataset.nativeType = config.type;
    const stored = { ...config };
    delete stored.children;
    write(node, stored);
    node.id = config.anchor || `native-${config.id}`;
    if (config.text !== undefined) {
      node.dataset.nativeTextField = "";
      renderText(node, config);
    }
    if (config.type === "image") {
      node.src = config.src || "";
      node.alt = config.alt || "";
      node.draggable = false;
      node.loading = config.loading || "lazy";
    }
    if (config.type === "video") {
      node.src = config.src || "";
      if (config.poster) node.poster = config.poster;
      node.controls = Boolean(config.controls);
      node.muted = config.muted !== false;
      node.loop = Boolean(config.loop);
      node.playsInline = true;
      node.preload = "metadata";
      if (config.captions || config.captionsText) {
        const track = document.createElement("track");
        track.kind = "captions";
        track.label = "Bahasa Indonesia";
        track.srclang = "id";
        track.src = config.captionsText
          ? "data:text/vtt;charset=utf-8," +
            encodeURIComponent(config.captionsText)
          : config.captions;
        node.append(track);
      }
    }
    if (config.action?.type === "link") {
      node.setAttribute("href", config.action.target);
      if (config.action.newTab) {
        node.target = "_blank";
        node.rel = "noopener noreferrer";
      }
    }
    if (config.type === "button" && tag === "button") node.type = "button";
    if (config.label) node.setAttribute("aria-label", config.label);
    if (config.open) node.open = true;
    if (config.action?.type === "toggle") {
      node.setAttribute("aria-expanded", "false");
      node.setAttribute("aria-controls", `native-${config.action.target}`);
    }
    if (config.collapsed) {
      node.dataset.nativeCollapsed = "true";
      node.hidden = true;
    }
    for (const child of config.children || []) node.append(create(child));
    return node;
  }
  const declarations = ({ props = {}, fill } = {}) =>
    Object.entries(props)
      .map(
        ([key, value]) =>
          `${cssName(key)}:${String(value).replace(/([\d.]+)vw\b/g, "calc($1 * var(--native-vw, 1vw))")}${key === "color" ? `;--native-text-color:${value}` : ""}`,
      )
      .join(";") +
    (fill?.layers?.length
      ? `;background-image:${gradientCss(fill.layers)};${fill.clip === "text" ? "background-clip:text;-webkit-background-clip:text;color:transparent;" : "background-clip:border-box;-webkit-background-clip:border-box;color:var(--native-text-color,inherit);"}`
      : fill
        ? ";background-image:none;background-clip:border-box;-webkit-background-clip:border-box;color:var(--native-text-color,inherit);"
        : "");
  function stylesheet(root, exported = false) {
    const query = (selector, rule) => {
      const conditions = [
        rule.min != null ? `(min-width:${rule.min}px)` : "",
        rule.max != null ? `(max-width:${rule.max}px)` : "",
      ]
        .filter(Boolean)
        .join(" and ");
      return conditions
        ? `@container ezkart-page ${conditions}{${selector}{${declarations(rule)}}}`
        : "";
    };
    return [...root.querySelectorAll(".sq-native")]
      .map((node) => {
        const config = read(node),
          selector = `.sq-page-preview .sq-native[data-native-id="${config.id}"]`;
        let css = `${selector}{${declarations(config)}${config.type === "icon" ? `;fill:${config.iconFill || "none"};stroke:${config.iconStroke || "currentColor"};stroke-width:${config.iconWeight ?? 1.6};stroke-linecap:round;stroke-linejoin:round;` : ""}}`;
        for (const rule of config.responsive || [])
          css += query(selector, rule);
        for (const [state, value] of Object.entries(config.states || {})) {
          const variant = config.stateScope
            ? `.sq-page-preview [data-native-id="${config.stateScope}"][data-native-state="${state}"] .sq-native[data-native-id="${config.id}"]`
            : `.sq-page-preview[data-native-state="${state}"] .sq-native[data-native-id="${config.id}"]`;
          css += `${variant}{${declarations(value)}}`;
          for (const rule of value.responsive || [])
            css += query(variant, rule);
        }
        return css;
      })
      .join("\n");
  }
  function mount(root, editing = false) {
    if (root.dataset.nativeMounted) return;
    root.dataset.nativeMounted = "true";
    const find = (id) =>
      root.querySelector(`[data-native-id="${CSS.escape(id)}"]`);
    let opener, dialog;
    const stateConfig = (node) => {
      try {
        return JSON.parse(node.dataset.nativeStateConfig || "{}");
      } catch {
        return {};
      }
    };
    const actions = (scope) =>
      [...root.querySelectorAll("[data-native-action]")].filter((n) => {
        try {
          const a = JSON.parse(n.dataset.nativeAction);
          return (
            a.type === "state" && (a.scope ? find(a.scope) : root) === scope
          );
        } catch {
          return false;
        }
      });
    const setState = (scope, value, persist = false) => {
      if (!scope) return;
      const buttons = actions(scope),
        settings = stateConfig(scope);
      if (
        !buttons.some(
          (n) => JSON.parse(n.dataset.nativeAction).target === value,
        ) &&
        !(buttons.length === 0 && value === settings.initial)
      )
        return;
      scope.dataset.nativeState = value;
      const focused = document.activeElement;
      buttons.forEach((n) => {
        const a = JSON.parse(n.dataset.nativeAction),
          active = a.target === value;
        if (a.disableWhenActive && n.tagName === "BUTTON") {
          n.disabled = !editing && active;
          n.setAttribute("aria-disabled", String(active));
        }
        n.setAttribute(
          settings.mode === "tabs" ? "aria-selected" : "aria-pressed",
          String(active),
        );
        if (settings.mode === "tabs") {
          n.setAttribute("role", "tab");
          n.tabIndex = active ? 0 : -1;
          n.parentElement.setAttribute("role", "tablist");
          n.parentElement.setAttribute(
            "aria-label",
            settings.label || "Choose a view",
          );
          const panel = [
            ...scope.querySelectorAll("[data-native-state-panel]"),
          ].find((p) => p.dataset.nativeStatePanel === a.target);
          if (panel) {
            n.setAttribute("aria-controls", panel.id);
            panel.setAttribute("role", "tabpanel");
            panel.setAttribute("aria-labelledby", n.id);
          }
        }
      });
      if (!editing && focused?.disabled && buttons.includes(focused)) {
        buttons
          .find((n) => n.parentElement === focused.parentElement && !n.disabled)
          ?.focus({ preventScroll: true });
      }
      if (persist && settings.param && !editing)
        try {
          const url = new URL(location.href);
          url.searchParams.set(settings.param, value);
          history.replaceState(null, "", url);
        } catch {}
      root.dispatchEvent(new Event("native-state-change"));
    };
    const initStates = () =>
      root.querySelectorAll("[data-native-state-config]").forEach((scope) => {
        const c = stateConfig(scope),
          fromUrl =
            !editing && c.param
              ? new URL(location.href).searchParams.get(c.param)
              : null;
        const requested = scope.dataset.nativeState || fromUrl || c.initial;
        setState(
          scope,
          actions(scope).some(
            (n) => JSON.parse(n.dataset.nativeAction).target === requested,
          )
            ? requested
            : c.initial,
        );
      });
    if (!editing)
      root
        .querySelectorAll("[data-native-state-config]")
        .forEach((n) => delete n.dataset.nativeState);
    root.addEventListener("native-refresh", initStates);
    initStates();
    root.addEventListener("keydown", (event) => {
      const tab = event.target.closest('[role="tab"][data-native-action]');
      if (
        !tab ||
        !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
      )
        return;
      const a = JSON.parse(tab.dataset.nativeAction),
        scope = a.scope ? find(a.scope) : root,
        buttons = actions(scope);
      event.preventDefault();
      const i = buttons.indexOf(tab),
        next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? buttons.length - 1
              : (i + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) %
                buttons.length;
      buttons[next].click();
      buttons[next].focus();
    });
    const openDialog = (target, trigger) => {
      if (target?.tagName !== "DIALOG" || target.open) return;
      target.__nativeOpener = trigger || document.activeElement;
      if (editing) target.show();
      else target.showModal();
      if (!editing) {
        target.__previousOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
      }
      (
        target.querySelector('button,[href],input,select,[tabindex="0"]') ||
        target
      ).focus();
    };
    root.addEventListener(
      "close",
      (event) => {
        const d = event.target;
        if (d.tagName !== "DIALOG") return;
        if (!editing) document.body.style.overflow = d.__previousOverflow || "";
        d.__nativeOpener?.focus({ preventScroll: true });
      },
      true,
    );
    root.addEventListener("click", (event) => {
      if (event.target.tagName !== "DIALOG") return;
      const box = event.target.getBoundingClientRect();
      if (
        event.clientX < box.left ||
        event.clientX > box.right ||
        event.clientY < box.top ||
        event.clientY > box.bottom
      )
        event.target.close();
    });
    root.addEventListener("keydown", (event) => {
      const d = event.target.closest("dialog[open]");
      if (!d) return;
      if (event.key === "Escape" && editing) {
        event.preventDefault();
        d.close();
      }
      if (event.key !== "Tab" || editing) return;
      const nodes = [
        ...d.querySelectorAll(
          'button:not(:disabled),a[href],input:not(:disabled),select,[tabindex="0"]',
        ),
      ].filter((n) => n.getClientRects().length);
      const first = nodes[0],
        last = nodes.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    });
    if (!editing) {
      const deepLink = () => {
        let id;
        try {
          id = decodeURIComponent(location.hash.slice(1));
        } catch {
          return;
        }
        const target = [...root.querySelectorAll("dialog")].find(
          (n) => n.id === id,
        );
        if (target) openDialog(target);
      };
      window.addEventListener("hashchange", deepLink);
      deepLink();
    }
    const visibility = () => {
      root
        .querySelectorAll("[data-native-scroll-visibility]")
        .forEach((node) => {
          const v = JSON.parse(node.dataset.nativeScrollVisibility);
          const viewport = editing
            ? root.closest(".sq-canvas-scroll")?.getBoundingClientRect()
            : { top: 0, bottom: innerHeight };
          if (!viewport) return;
          const after = find(v.after)?.getBoundingClientRect();
          const covered = (v.hideWhile || []).some((id) => {
            const rect = find(id)?.getBoundingClientRect();
            return (
              rect && rect.top < viewport.bottom && rect.bottom > viewport.top
            );
          });
          const visible =
            (!after || after.bottom < viewport.top) &&
            !covered &&
            !document.body.classList.contains("ezkart-cart-open");
          if (
            !editing &&
            node.showPopover &&
            getComputedStyle(node).position === "fixed"
          ) {
            node.hidden = false;
            node.setAttribute("popover", "manual");
            if (visible && !node.matches(":popover-open")) node.showPopover();
            if (!visible && node.matches(":popover-open")) node.hidePopover();
          } else
            node.hidden =
              !visible && !node.classList.contains("sq-element-selected");
        });
    };
    const motion = () => {
      visibility();
      root.querySelectorAll("[data-native-motion]").forEach((node) => {
        const m = JSON.parse(node.dataset.nativeMotion),
          f = node.dataset.nativeFit
            ? JSON.parse(node.dataset.nativeFit)
            : null;
        if (f && root.clientWidth <= f.max) return;
        if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
          node.style.removeProperty("transform");
          return;
        }
        const scroll = editing ? root.closest(".sq-canvas-scroll") : null,
          viewport = scroll?.clientHeight || innerHeight,
          top =
            node.parentElement.getBoundingClientRect().top -
            (scroll?.getBoundingClientRect().top || 0),
          progress = Math.min(1, Math.max(0, (viewport - top) / viewport));
        node.style.transform = `rotateX(${m.tilt * (1 - progress)}deg) translateY(${m.travel * progress}px)`;
      });
    };
    let pending = false;
    const scheduleMotion = () => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        motion();
      });
    };
    window.addEventListener("scroll", scheduleMotion, { passive: true });
    document.addEventListener("ezkart:cart-visibility", scheduleMotion);
    window.addEventListener("resize", scheduleMotion);
    root
      .closest(".sq-canvas-scroll")
      ?.addEventListener("scroll", scheduleMotion, { passive: true });
    const fit = () => {
      root.style.setProperty("--native-vw", `${root.clientWidth / 100}px`);
      const stickyHeight = Math.max(
        0,
        ...[...root.children]
          .filter((node) => getComputedStyle(node).position === "sticky")
          .map((node) => node.getBoundingClientRect().height),
      );
      root.style.setProperty("--native-sticky-inset", `${stickyHeight + 20}px`);
      root.querySelectorAll("[data-native-fit]").forEach((node) => {
        const f = JSON.parse(node.dataset.nativeFit),
          parent = node.parentElement;
        if (root.clientWidth <= f.max) {
          const scale = parent.clientWidth / f.width;
          node.style.transform = `scale(${scale})`;
          parent.style.height = `${f.height * scale + f.extra}px`;
        } else {
          node.style.removeProperty("transform");
          parent.style.removeProperty("height");
        }
      });
      motion();
    };
    if (typeof ResizeObserver === "function")
      new ResizeObserver(fit).observe(root);
    root.addEventListener("native-refresh", fit);
    fit();
    root.addEventListener("click", (event) => {
      const node = event.target.closest(".sq-native");
      if (!node) return;
      const actionNode = node.closest(".sq-native[data-native-action]") || node;
      let config;
      try {
        config = JSON.parse(
          actionNode.dataset.nativeAction ||
            actionNode.dataset.sqNative ||
            "{}",
        );
      } catch {
        return;
      }
      const action = config.action || config;
      if (!action?.type || (editing && !event.altKey)) return;
      if (action.type === "link") {
        root
          .querySelectorAll("[data-native-collapsed]")
          .forEach((n) => (n.hidden = true));
        root
          .querySelectorAll(".sq-native[aria-expanded=true]")
          .forEach((n) => n.setAttribute("aria-expanded", "false"));
        if (actionNode.tagName === "A") return;
        event.preventDefault();
        if (action.newTab) window.open(action.target, "_blank", "noopener");
        else location.href = action.target;
      }
      if (action.type === "toggle") {
        event.preventDefault();
        const target = find(action.target);
        if (target) {
          target.hidden = !target.hidden;
          actionNode.setAttribute("aria-expanded", String(!target.hidden));
        }
      }
      if (action.type === "state") {
        event.preventDefault();
        setState(action.scope ? find(action.scope) : root, action.target, true);
      }
      if (action.type === "dialog") {
        event.preventDefault();
        openDialog(find(action.target), actionNode);
      }
      if (action.type === "close-dialog") {
        event.preventDefault();
        find(action.target)?.close();
      }
      if (action.type === "video-toggle") {
        event.preventDefault();
        const video = find(action.target);
        if (video?.tagName === "VIDEO") {
          if (video.paused) video.play().catch(() => {});
          else video.pause();
          actionNode.setAttribute(
            "aria-label",
            video.paused ? "Play video" : "Pause video",
          );
        }
      }
      if (action.type === "video-dialog") {
        event.preventDefault();
        const source = find(action.target);
        if (source?.tagName !== "VIDEO") return;
        opener = actionNode;
        source.pause();
        dialog = document.createElement("dialog");
        dialog.className = "sq-native-video-dialog";
        const close = document.createElement("button");
        close.textContent = "×";
        close.setAttribute("aria-label", "Close video");
        close.onclick = () => dialog.close();
        const video = source.cloneNode(true);
        video.removeAttribute("data-native-id");
        video.controls = true;
        video.muted = false;
        dialog.append(close, video);
        document.body.append(dialog);
        dialog.addEventListener("close", () => {
          video.pause();
          dialog.remove();
          opener?.focus();
        });
        dialog.addEventListener("click", (e) => {
          if (e.target === dialog) dialog.close();
        });
        dialog.showModal();
        video.play().catch(() => {});
      }
    });
    root.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        root
          .querySelectorAll("[data-native-collapsed]")
          .forEach((n) => (n.hidden = true));
        root.querySelectorAll(".sq-native[aria-expanded=true]").forEach((n) => {
          n.setAttribute("aria-expanded", "false");
          n.focus();
        });
      }
    });
    if (!editing && typeof IntersectionObserver === "function") {
      const observer = new IntersectionObserver(
        (entries) =>
          entries.forEach(({ target, isIntersecting }) => {
            if (!isIntersecting) target.pause();
            else if (
              !matchMedia("(prefers-reduced-motion: reduce)").matches &&
              target.dataset.nativeAutoplay === "true"
            )
              target.play().catch(() => {});
          }),
        { threshold: 0.3 },
      );
      root.querySelectorAll("video").forEach((v) => observer.observe(v));
    }
  }
  let hooks,
    selected,
    context = "base",
    state = "",
    selection,
    draftLayers = [],
    layerIndex = 0,
    wordLayers = [],
    wordLayerIndex = 0,
    wordSelectionKey = "";
  function remapTree(root, rootId) {
    const nodes = [root, ...root.querySelectorAll(".sq-native")];
    const anchors = new Map(
      nodes.filter((n) => read(n).anchor).map((n) => [read(n).anchor, n.id]),
    );
    const ids = new Map(
      nodes.map((n, i) => [
        n.dataset.nativeId,
        i === 0 && rootId ? rootId : `native-${Date.now()}-${i}`,
      ]),
    );
    for (const n of nodes) {
      const c = read(n);
      c.id = ids.get(c.id);
      if (c.anchor) c.anchor = n.id;
      if (
        c.action?.type !== "state" &&
        c.action?.target &&
        ids.has(c.action.target)
      )
        c.action.target = ids.get(c.action.target);
      if (c.action?.type === "link" && c.action.target.startsWith("#")) {
        const old = c.action.target.slice(1);
        if (anchors.has(old)) c.action.target = "#" + anchors.get(old);
      }
      if (c.action?.scope && ids.has(c.action.scope))
        c.action.scope = ids.get(c.action.scope);
      if (c.stateScope && ids.has(c.stateScope))
        c.stateScope = ids.get(c.stateScope);
      n.dataset.nativeId = c.id;
      n.dataset.sqElementId = c.id;
      if (c.action?.type === "link" && n.tagName === "A")
        n.href = c.action.target;
      write(n, c);
    }
  }
  function startPointer(event, node, resizing) {
    if (!hooks) return;
    const config = read(node),
      originalStyle = node.getAttribute("style"),
      cs = getComputedStyle(node),
      rect = node.getBoundingClientRect(),
      scale = rect.width / Math.max(1, node.offsetWidth),
      start = {
        x: event.clientX,
        y: event.clientY,
        width: node.offsetWidth,
        height: node.offsetHeight,
        left: parseFloat(cs.left) || 0,
        top: parseFloat(cs.top) || 0,
      };
    let props,
      remembered = false;
    const guides = hooks.beginPointer?.(node, resizing);
    const move = (e) => {
      const rawX = (e.clientX - start.x) / scale,
        rawY = (e.clientY - start.y) / scale;
      if (Math.abs(rawX) + Math.abs(rawY) < 1) return;
      const { dx, dy } = guides?.snap(rawX, rawY, e) || { dx: rawX, dy: rawY };
      if (!remembered) {
        hooks.remember();
        remembered = true;
      }
      props = resizing
        ? {
            width: `${Math.max(1, Math.round(start.width + dx))}px`,
            height: `${Math.max(1, Math.round(start.height + dy))}px`,
          }
        : {
            position: cs.position === "static" ? "relative" : cs.position,
            left: `${Math.round(start.left + dx)}px`,
            top: `${Math.round(start.top + dy)}px`,
            right: "auto",
            bottom: "auto",
          };
      if (config.type === "product" && resizing) props.height = "auto";
      Object.assign(node.style, props);
      guides?.update();
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      if (originalStyle === null) node.removeAttribute("style");
      else node.setAttribute("style", originalStyle);
      if (props) {
        const target = getContext(config);
        target.props = { ...target.props, ...props };
        write(node, config);
        refresh();
        hooks.changed();
        hooks.rebind?.();
        hooks.select(node);
      }
      guides?.end();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end, { once: true });
    window.addEventListener("pointercancel", end, { once: true });
  }
  function nudge(dx, dy) {
    if (!selected) return;
    const style = getComputedStyle(selected);
    change({
      props: {
        position: style.position === "static" ? "relative" : style.position,
        left: `${(parseFloat(style.left) || 0) + dx}px`,
        top: `${(parseFloat(style.top) || 0) + dy}px`,
        right: "auto",
        bottom: "auto",
      },
    });
  }
  function refresh() {
    if (!hooks) return;
    let sheet = document.querySelector("[data-sq-native-styles]");
    if (!sheet) {
      sheet = document.createElement("style");
      sheet.dataset.sqNativeStyles = "";
      document.head.append(sheet);
    }
    sheet.textContent = stylesheet(hooks.root);
    hooks.root.querySelectorAll(".sq-native").forEach((node) => {
      const config = read(node);
      node.toggleAttribute(
        "data-native-pinned",
        [
          config.props,
          ...(config.responsive || []).map((rule) => rule.props),
        ].some((props) => ["sticky", "fixed"].includes(props?.position)),
      );
      if (config.type === "product")
        hooks.renderProduct?.(node, config.productId);
      if (config.initialState)
        node.dataset.nativeStateConfig = JSON.stringify({
          initial: config.initialState,
          param: config.stateParam,
          mode: config.stateMode,
          label: config.label || config.name,
        });
      else delete node.dataset.nativeStateConfig;
      if (config.statePanel) node.dataset.nativeStatePanel = config.statePanel;
      else delete node.dataset.nativeStatePanel;
      if (config.action)
        node.dataset.nativeAction = JSON.stringify(config.action);
      else delete node.dataset.nativeAction;
      node.dataset.nativeAutoplay = String(Boolean(config.autoplay));
      if (config.fit) node.dataset.nativeFit = JSON.stringify(config.fit);
      else delete node.dataset.nativeFit;
      if (config.scrollVisibility)
        node.dataset.nativeScrollVisibility = JSON.stringify(
          config.scrollVisibility,
        );
      else if (node.hasAttribute("data-native-scroll-visibility")) {
        delete node.dataset.nativeScrollVisibility;
        node.removeAttribute("popover");
        node.hidden = Boolean(config.collapsed);
      }
      if (config.scrollMotion)
        node.dataset.nativeMotion = JSON.stringify(config.scrollMotion);
      else delete node.dataset.nativeMotion;
      if (config.action?.type === "toggle") {
        const target = hooks.root.querySelector(
          `[data-native-id="${CSS.escape(config.action.target)}"]`,
        );
        if (target) node.setAttribute("aria-controls", target.id);
      }
    });
    globalThis.EzkartCommerce?.mount(
      hooks.root,
      hooks.products?.() || [],
      true,
    );
    mount(hooks.root, true);
    hooks.root.dispatchEvent(new Event("native-refresh"));
  }
  const getHost = (config) => (state ? config.states?.[state] || {} : config);
  const getContext = (config) =>
    context === "base"
      ? getHost(config)
      : (getHost(config).responsive || []).find(
          (r) => `${r.min ?? ""}:${r.max ?? ""}` === context,
        ) || {};
  function change(patch) {
    if (!selected) return;
    const config = read(selected);
    if (
      patch.text !== undefined &&
      (config.text === undefined || patch.text === config.text) &&
      Object.keys(patch).length === 1
    )
      return;
    const target = Object.keys(patch).some((k) =>
      [
        "initialState",
        "stateScope",
        "stateParam",
        "stateMode",
        "statePanel",
        "productIds",
      ].includes(k),
    )
      ? config
      : getContext(config);
    if (patch.text !== undefined) editText(config, patch.text);
    Object.assign(target, patch, {
      props: { ...target.props, ...patch.props },
    });
    validate({ ...config, children: [] });
    hooks.remember();
    write(selected, config);
    if (patch.text !== undefined || patch.marks !== undefined)
      renderText(selected, config);
    refresh();
    hooks.changed();
  }
  function inspectorFill(panel) {
    const layers = structuredClone(draftLayers);
    layers[layerIndex] = {
      kind: panel.querySelector("[data-native-gradient-kind]").value,
      angle: panel.querySelector("[data-native-gradient-angle]").valueAsNumber,
      x: panel.querySelector("[data-native-gradient-x]").valueAsNumber,
      y: panel.querySelector("[data-native-gradient-y]").valueAsNumber,
      shape: panel.querySelector("[data-native-gradient-shape]").value,
      stops: [...panel.querySelectorAll(".sq-native-stop")]
        .map((row) => ({
          color: row.querySelector("[data-stop-color]").value,
          position: row.querySelector("[data-stop-position]").valueAsNumber,
        }))
        .sort((a, b) => a.position - b.position),
    };
    const type = panel.querySelector("[data-native-fill-type]").value;
    return {
      clip: type === "text" ? "text" : "background",
      layers: type === "solid" ? [] : layers,
    };
  }
  function wordStylesInRange(config, start, end) {
    const current = getContext(config);
    const fill = current.fill ?? config.fill;
    const base =
      fill?.clip === "text" && fill.layers?.length
        ? { gradient: fill.layers }
        : {
            color:
              current.props?.color ||
              config.props?.color ||
              getComputedStyle(selected).color,
          };
    const cuts = [
      ...new Set([
        start,
        end,
        ...(config.marks || [])
          .flatMap((m) => [m.start, m.end])
          .filter((n) => n > start && n < end),
      ]),
    ].sort((a, b) => a - b);
    return cuts.slice(0, -1).map((from, index) => {
      const to = cuts[index + 1];
      const mark = (config.marks || [])
        .filter((m) => m.start <= from && m.end >= to)
        .at(-1);
      const style = mark?.gradient
        ? { gradient: mark.gradient }
        : mark?.color
          ? { color: mark.color }
          : base;
      return { start: from - start, end: to - start, ...style };
    });
  }
  function syncWordSelection(panel) {
    const config = read(selected);
    const hasWordColors = config.marks?.some(
      (mark) => mark.color || mark.gradient,
    );
    const valid =
      selection &&
      selected === selection.node &&
      selection.end > selection.start &&
      config.text?.slice(selection.start, selection.end) === selection.text;
    const rich = panel.querySelector("[data-native-rich-range]");
    const editor = panel.querySelector("[data-native-word-editor]");
    editor.hidden = !valid;
    rich.textContent = valid
      ? `Editing “${selection.text}”`
      : hasWordColors
        ? "Select words in your text, or choose a phrase below to edit its color."
        : "Select words in your text to give them a different color.";
    rich.classList.toggle("has-selection", Boolean(valid));
    if (!valid)
      panel.querySelector("[data-native-apply-word-style]").disabled = true;
    panel.querySelector("[data-native-clear-marks]").hidden = !hasWordColors;
    panel
      .querySelector("[data-native-word-styles]")
      .querySelectorAll("button")
      .forEach((button) => {
        button.setAttribute(
          "aria-pressed",
          String(
            Boolean(
              valid &&
              Number(button.dataset.start) === selection.start &&
              Number(button.dataset.end) === selection.end,
            ),
          ),
        );
      });
    if (!valid) {
      wordSelectionKey = "";
      return;
    }
    const styles = wordStylesInRange(config, selection.start, selection.end);
    const key = JSON.stringify([
      selected.dataset.nativeId,
      selection.start,
      selection.end,
      styles,
    ]);
    if (key === wordSelectionKey) return;
    wordSelectionKey = key;
    const first = styles[0];
    const mixed = styles.some(
      (style) =>
        JSON.stringify(style.gradient || style.color) !==
        JSON.stringify(first.gradient || first.color),
    );
    panel.querySelector("[data-native-word-type]").value = mixed
      ? "mixed"
      : first.gradient
        ? "gradient"
        : "solid";
    const solidColor = first.color || config.props?.color || "#303440";
    panel.querySelector("[data-native-word-color-value]").value = solidColor;
    wordLayers = structuredClone(
      first.gradient || [
        {
          kind: "linear",
          angle: 105,
          stops: [
            { color: solidColor, position: 0 },
            { color: "#ed1467", position: 100 },
          ],
        },
      ],
    );
    wordLayerIndex = 0;
    loadWordGradient(panel);
    syncWordFillControls(panel);
    panel.querySelector("[data-native-word-status]").textContent = mixed
      ? "These words have different colors. Choose a color style to make them match."
      : "Changes apply only to the words shown above.";
  }
  function readWordGradient(panel) {
    const layers = structuredClone(wordLayers);
    layers[wordLayerIndex] = {
      kind: panel.querySelector("[data-word-gradient-kind]").value,
      angle: panel.querySelector("[data-word-gradient-angle]").valueAsNumber,
      x: panel.querySelector("[data-word-gradient-x]").valueAsNumber,
      y: panel.querySelector("[data-word-gradient-y]").valueAsNumber,
      shape: panel.querySelector("[data-word-gradient-shape]").value,
      stops: [...panel.querySelectorAll(".sq-word-stop")]
        .map((row) => ({
          color: row.querySelector("[data-stop-color]").value,
          position: row.querySelector("[data-stop-position]").valueAsNumber,
        }))
        .sort((a, b) => a.position - b.position),
    };
    return layers;
  }
  function loadWordGradient(panel) {
    const layer = wordLayers[wordLayerIndex];
    for (const [key, fallback] of Object.entries({
      kind: "linear",
      angle: 105,
      x: 50,
      y: 50,
      shape: "ellipse",
    }))
      panel.querySelector(`[data-word-gradient-${key}]`).value =
        layer[key] ?? fallback;
    renderStops(panel, layer.stops, true);
    panel
      .querySelector("[data-word-layer]")
      .replaceChildren(
        ...wordLayers.map(
          (_, index) => new Option(`Gradient ${index + 1}`, index),
        ),
      );
    panel.querySelector("[data-word-layer]").value = wordLayerIndex;
  }
  function syncWordFillControls(panel, edited = false) {
    const type = panel.querySelector("[data-native-word-type]").value;
    const radial =
      panel.querySelector("[data-word-gradient-kind]").value === "radial";
    panel.querySelector("[data-native-word-solid]").hidden = type !== "solid";
    panel.querySelector("[data-native-word-gradient]").hidden =
      type !== "gradient";
    panel.querySelector("[data-word-linear]").hidden = radial;
    panel.querySelector("[data-word-radial]").hidden = !radial;
    panel.querySelector("[data-word-shape]").hidden = !radial;
    panel.querySelector("[data-word-layer-add]").disabled =
      wordLayers.length >= 8;
    panel.querySelector("[data-word-layer-remove]").disabled =
      wordLayers.length <= 1;
    const rows = [...panel.querySelectorAll(".sq-word-stop")];
    rows.forEach((row, index) => {
      syncColorPicker(
        row.querySelector("[data-stop-picker]"),
        row.querySelector("[data-stop-color]").value,
      );
      row
        .querySelector("[data-stop-color]")
        .setAttribute("aria-label", `Word gradient color ${index + 1}`);
      row
        .querySelector("[data-stop-picker]")
        .setAttribute("aria-label", `Choose word gradient color ${index + 1}`);
      row
        .querySelector("[data-stop-position]")
        .setAttribute(
          "aria-label",
          `Word gradient color ${index + 1} position (%)`,
        );
      row.querySelector("button").disabled = rows.length <= 2;
      row
        .querySelector("button")
        .setAttribute("aria-label", `Remove word gradient color ${index + 1}`);
      row.querySelector("button").title =
        rows.length <= 2
          ? "A gradient needs at least two colors"
          : `Remove color ${index + 1}`;
    });
    panel.querySelector("[data-word-add-stop]").disabled = rows.length >= 12;
    const preview = panel.querySelector("[data-native-word-preview]");
    const apply = panel.querySelector("[data-native-apply-word-style]");
    const status = panel.querySelector("[data-native-word-status]");
    const value = panel.querySelector("[data-native-word-color-value]").value;
    syncColorPicker(panel.querySelector("[data-native-word-color]"), value);
    preview.textContent = selection?.text || "";
    preview.style.backgroundImage = "none";
    preview.style.color = "inherit";
    try {
      if (type === "gradient") {
        preview.style.backgroundImage = gradientCss(readWordGradient(panel));
        preview.style.color = "transparent";
      } else if (type === "solid") preview.style.color = color(value);
      else if (selection)
        renderText(preview, {
          text: selection.text,
          marks: wordStylesInRange(
            read(selected),
            selection.start,
            selection.end,
          ),
        });
      apply.disabled = type === "mixed";
      if (edited || status.dataset.invalid)
        status.textContent =
          "Preview only. Apply to update the selected words.";
      delete status.dataset.invalid;
    } catch (error) {
      apply.disabled = true;
      status.textContent = error.message;
      status.dataset.invalid = "true";
    }
    hooks.syncSelects?.(panel.querySelector("[data-native-word-editor]"));
  }
  function syncFillControls(panel, edited = false) {
    const solid =
      panel.querySelector("[data-native-fill-type]").value === "solid";
    const radial =
      panel.querySelector("[data-native-gradient-kind]").value === "radial";
    panel.querySelector("[data-native-solid-controls]").hidden = !solid;
    panel.querySelector("[data-native-gradient-controls]").hidden = solid;
    panel.querySelector("[data-native-linear-controls]").hidden = radial;
    panel.querySelector("[data-native-radial-controls]").hidden = !radial;
    panel.querySelector("[data-native-radial-shape]").hidden = !radial;
    const rows = [...panel.querySelectorAll(".sq-native-stop")];
    rows.forEach((row, i) => {
      syncColorPicker(
        row.querySelector("[data-stop-picker]"),
        row.querySelector("[data-stop-color]").value,
      );
      row
        .querySelector("[data-stop-color]")
        .setAttribute("aria-label", `Color ${i + 1}`);
      row
        .querySelector("[data-stop-picker]")
        .setAttribute("aria-label", `Choose color ${i + 1}`);
      row
        .querySelector("[data-stop-position]")
        .setAttribute("aria-label", `Color ${i + 1} position (%)`);
      const remove = row.querySelector("button");
      remove.disabled = rows.length <= 2;
      remove.title =
        rows.length <= 2
          ? "A gradient needs at least two colors"
          : `Remove color ${i + 1}`;
      remove.setAttribute("aria-label", `Remove color ${i + 1}`);
    });
    panel.querySelector("[data-native-add-stop]").disabled = rows.length >= 12;
    const layers = draftLayers;
    panel.querySelector("[data-native-layer-add]").disabled =
      layers.length >= 8;
    panel.querySelector("[data-native-layer-remove]").disabled = !layers.length;
    const status = panel.querySelector("[data-native-fill-status]");
    const apply = panel.querySelector("[data-native-apply-fill]");
    const targetIsText =
      panel.querySelector("[data-native-fill-type]").value === "text";
    apply.textContent = targetIsText
      ? "Apply gradient to all text"
      : solid
        ? "Apply background color"
        : "Apply background gradient";
    const preview = panel.querySelector("[data-native-fill-preview]");
    syncColorPicker(
      panel.querySelector("[data-native-solid-picker]"),
      panel.querySelector("[data-native-solid-color]").value,
    );
    try {
      const value = solid
        ? color(panel.querySelector("[data-native-solid-color]").value)
        : gradientCss(inspectorFill(panel).layers);
      preview.style.background = value;
      preview.dataset.text =
        panel.querySelector("[data-native-fill-type]").value === "text";
      preview.setAttribute(
        "aria-label",
        solid ? `Color preview: ${value}` : "Gradient preview",
      );
      apply.disabled = false;
      if (edited || status.dataset.invalid)
        status.textContent = targetIsText
          ? "Preview only. Apply to update all text."
          : "Preview only. Apply to update the background.";
      delete status.dataset.invalid;
    } catch (error) {
      status.textContent = error.message;
      status.dataset.invalid = "true";
      apply.disabled = true;
    }
    hooks.syncSelects?.(panel.querySelector("[data-native-fill-section]"));
  }
  function syncColorPicker(picker, value) {
    if (!CSS.supports("color", value)) return;
    picker.style.background = value;
    const rgb = getComputedStyle(picker).backgroundColor.match(
      /^rgba?\((\d+),\s*(\d+),\s*(\d+)/,
    );
    if (rgb)
      picker.value =
        "#" +
        rgb
          .slice(1)
          .map((part) => Number(part).toString(16).padStart(2, "0"))
          .join("");
  }
  function renderStops(panel, stops, words = false) {
    const host = panel.querySelector(
      words ? "[data-word-gradient-stops]" : "[data-native-gradient-stops]",
    );
    const update = () =>
      words ? syncWordFillControls(panel, true) : syncFillControls(panel, true);
    host.replaceChildren(
      ...stops.map((stop) => {
        const row = document.createElement("div");
        row.className = words ? "sq-word-stop" : "sq-native-stop";
        row.innerHTML =
          '<input type="color" data-stop-picker><input type="text" spellcheck="false" data-stop-color><div class="sq-native-unit"><input type="number" min="0" max="100" step="any" data-stop-position><span aria-hidden="true">%</span></div><button type="button" aria-label="Remove color stop" title="Remove color stop"><svg class="icon" aria-hidden="true"><use href="#icon-trash"></use></svg></button>';
        const field = row.querySelector("[data-stop-color]"),
          picker = row.querySelector("[data-stop-picker]");
        field.value = stop.color;
        picker.value = /^#[0-9a-f]{6}$/i.test(stop.color)
          ? stop.color
          : "#f44b34";
        picker.style.background = stop.color;
        const sync = () => {
          picker.style.background = CSS.supports("color", field.value)
            ? field.value
            : "";
          if (/^#[0-9a-f]{6}$/i.test(field.value)) picker.value = field.value;
          update();
        };
        field.addEventListener("input", sync);
        picker.addEventListener("input", () => {
          field.value = picker.value;
          sync();
        });
        row.querySelector("[data-stop-position]").value = stop.position;
        row
          .querySelector("[data-stop-position]")
          .addEventListener("input", update);
        row.querySelector("button").onclick = () => {
          if (host.children.length <= 2) return;
          const next = row.nextElementSibling || row.previousElementSibling;
          row.remove();
          update();
          next?.querySelector("[data-stop-color]").focus();
        };
        return row;
      }),
    );
  }
  function syncLayerOptions(panel) {
    panel
      .querySelector("[data-native-layer]")
      .replaceChildren(
        ...(draftLayers.length ? draftLayers : [{}]).map(
          (layer, index) => new Option(`Layer ${index + 1}`, index),
        ),
      );
    panel.querySelector("[data-native-layer]").value = layerIndex;
    panel.querySelector("[data-native-layer-count]").textContent = Math.max(
      1,
      draftLayers.length,
    );
  }
  function loadGradient(panel, layer) {
    for (const [key, value] of Object.entries({
      kind: "linear",
      angle: 105,
      x: 50,
      y: 50,
      shape: "ellipse",
    }))
      panel.querySelector(`[data-native-gradient-${key}]`).value =
        layer[key] ?? value;
    renderStops(panel, layer.stops);
  }
  // Existing authored text uses the same range model and word-color controls.
  // Keep its elements and layout intact; only replace the paint on text runs.
  function splitCSSList(value) {
    const parts = [];
    let depth = 0,
      start = 0;
    for (let i = 0; i < value.length; i++) {
      if (value[i] === "(") depth++;
      else if (value[i] === ")") depth--;
      else if (value[i] === "," && depth === 0) {
        parts.push(value.slice(start, i).trim());
        start = i + 1;
      }
    }
    parts.push(value.slice(start).trim());
    return parts;
  }
  function readCSSGradients(value) {
    const layers = splitCSSList(value).map((value) => {
      const match = value.match(/^(linear|radial)-gradient\((.*)\)$/);
      if (!match) return null;
      const parts = splitCSSList(match[2]),
        layer = { kind: match[1] };
      if (layer.kind === "linear") {
        const direction = parts[0];
        const angles = {
          "to top": 0,
          "to right": 90,
          "to bottom": 180,
          "to left": 270,
          "to top right": 45,
          "to right top": 45,
          "to bottom right": 135,
          "to right bottom": 135,
          "to bottom left": 225,
          "to left bottom": 225,
          "to top left": 315,
          "to left top": 315,
        };
        layer.angle = 180;
        if (/^-?[\d.]+deg$/.test(direction)) {
          layer.angle = parseFloat(parts.shift());
        } else if (direction in angles) {
          layer.angle = angles[parts.shift()];
        }
      } else {
        layer.shape = "ellipse";
        layer.x = 50;
        layer.y = 50;
        if (/^(circle|ellipse|at |closest-|farthest-)/.test(parts[0])) {
          const geometry = parts.shift();
          layer.shape = geometry.startsWith("circle") ? "circle" : "ellipse";
          const position = geometry.match(/at ([\d.]+)% ([\d.]+)%/);
          if (position) {
            layer.x = Number(position[1]);
            layer.y = Number(position[2]);
          }
        }
      }
      layer.stops = parts.map((part) => {
        const positioned = part.match(/^(.*)\s+(-?[\d.]+)%$/);
        return positioned
          ? { color: positioned[1], position: Number(positioned[2]) }
          : { color: part };
      });
      if (
        layer.stops.length < 2 ||
        layer.stops.some((stop) => !CSS.supports("color", stop.color))
      )
        return null;
      layer.stops[0].position ??= 0;
      layer.stops.at(-1).position ??= 100;
      for (let i = 1; i < layer.stops.length - 1; i++) {
        if (layer.stops[i].position !== undefined) continue;
        let end = i + 1;
        while (layer.stops[end].position === undefined) end++;
        const left = layer.stops[i - 1].position,
          right = layer.stops[end].position;
        for (let j = i; j < end; j++)
          layer.stops[j].position =
            left + ((right - left) * (j - i + 1)) / (end - i + 1);
        i = end;
      }
      return layer;
    });
    return layers.length && layers.every(Boolean) ? layers : null;
  }
  const clipsText = (style) =>
    style.backgroundClip === "text" || style.webkitBackgroundClip === "text";
  function domTextNodes(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT),
      nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    return nodes;
  }
  function readDOMColors(node) {
    let base = getComputedStyle(node).color;
    for (
      let parent = node.parentElement;
      /^(transparent|rgba\([^)]*,\s*0\))$/.test(base) && parent;
      parent = parent.parentElement
    )
      base = getComputedStyle(parent).color;
    const config = {
      id: "existing-text",
      type: /^H[1-6]$/.test(node.tagName) ? "heading" : "text",
      text: node.textContent,
      props: { color: base },
      marks: [],
    };
    let offset = 0;
    for (const text of domTextNodes(node)) {
      const start = offset;
      offset += text.length;
      if (!text.length) continue;
      let gradient;
      for (
        let parent = text.parentElement;
        parent && (parent === node || node.contains(parent));
        parent = parent.parentElement
      ) {
        const style = getComputedStyle(parent);
        if (clipsText(style) && style.backgroundImage !== "none") {
          gradient = readCSSGradients(style.backgroundImage);
          break;
        }
      }
      const color = getComputedStyle(text.parentElement).color;
      const appearance = gradient
        ? { gradient }
        : color !== base
          ? { color }
          : null;
      if (!appearance) continue;
      const previous = config.marks.at(-1);
      if (
        previous &&
        previous.end === start &&
        JSON.stringify(previous.gradient || previous.color) ===
          JSON.stringify(gradient || color)
      )
        previous.end = offset;
      else config.marks.push({ start, end: offset, ...appearance });
    }
    return config;
  }
  function renderDOMColors(node, config) {
    node
      .querySelectorAll("[data-sq-word-run]")
      .forEach((run) => run.replaceWith(...run.childNodes));
    node.normalize();
    const nodes = domTextNodes(node),
      ancestors = new Set([node]);
    for (const text of nodes)
      for (
        let p = text.parentElement;
        p && (p === node || node.contains(p));
        p = p.parentElement
      )
        ancestors.add(p);
    for (const element of ancestors) {
      const style = getComputedStyle(element),
        gradient = clipsText(style);
      if (gradient) {
        element.style.backgroundImage = "none";
        element.style.backgroundClip = "border-box";
        element.style.webkitBackgroundClip = "border-box";
        element.style.webkitTextFillColor = "currentColor";
      }
      if (gradient || (element !== node && style.color !== config.props.color))
        element.style.setProperty("color", "inherit", "important");
    }
    let offset = 0;
    for (const text of nodes) {
      const start = offset,
        end = offset + text.length;
      offset = end;
      const cuts = [
        ...new Set([
          start,
          end,
          ...(config.marks || [])
            .flatMap((mark) => [mark.start, mark.end])
            .filter((n) => n > start && n < end),
        ]),
      ].sort((a, b) => a - b);
      const fragment = document.createDocumentFragment();
      for (let i = 0; i < cuts.length - 1; i++) {
        const from = cuts[i],
          to = cuts[i + 1],
          mark = (config.marks || [])
            .filter((m) => m.start <= from && m.end >= to)
            .at(-1);
        const copy = text.textContent.slice(from - start, to - start);
        if (!mark?.gradient && !mark?.color) {
          fragment.append(document.createTextNode(copy));
          continue;
        }
        const span = document.createElement("span");
        span.dataset.sqWordRun = "";
        span.textContent = copy;
        span.style.setProperty("display", "inline", "important");
        span.style.setProperty(
          "color",
          mark.gradient ? "transparent" : mark.color,
          "important",
        );
        span.style.webkitTextFillColor = "currentColor";
        if (mark.gradient) {
          span.style.backgroundImage = gradientCss(mark.gradient);
          span.style.backgroundClip = "text";
          span.style.webkitBackgroundClip = "text";
        }
        fragment.append(span);
      }
      text.replaceWith(fragment);
    }
  }
  function selectTextColors(node, host, onSelect) {
    const changed = selected !== node || !textColorAdapter;
    if (changed) {
      selection = null;
      wordSelectionKey = "";
    }
    selected = node;
    context = "base";
    state = "";
    textColorAdapter = { node, host, onSelect, config: readDOMColors(node) };
    const panel = document.querySelector("[data-sq-native-inspector]");
    host.append(panel);
    panel.hidden = false;
    panel.classList.add("sq-word-colors-only");
    const content = panel.querySelector("[data-native-content]");
    content.hidden = false;
    content.open = true;
    const words = panel.querySelector("[data-native-word-controls]");
    words.hidden = false;
    words.open = true;
    renderWordStyles(panel, textColorAdapter.config);
    syncWordSelection(panel);
    if (changed && textColorAdapter.config.marks.some((mark) => mark.gradient))
      onSelect?.();
  }
  function renderWordStyles(panel, config) {
    const wordStyles = panel.querySelector("[data-native-word-styles]");
    wordStyles.replaceChildren();
    if (config.marks?.some((mark) => mark.color || mark.gradient)) {
      const caption = document.createElement("small");
      caption.textContent = "Words with custom colors";
      wordStyles.append(caption);
      for (const mark of config.marks.filter(
        (mark) => mark.color || mark.gradient,
      )) {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.start = mark.start;
        button.dataset.end = mark.end;
        const swatch = document.createElement("span");
        swatch.className = "sq-word-swatch";
        swatch.setAttribute("aria-hidden", "true");
        swatch.style.background = mark.gradient
          ? gradientCss(mark.gradient)
          : mark.color;
        const name = document.createElement("span");
        name.textContent = `“${config.text.slice(mark.start, mark.end)}”`;
        const action = document.createElement("small");
        action.textContent = mark.gradient ? "Edit gradient" : "Edit color";
        button.append(swatch, name, action);
        button.onclick = () => {
          selection = {
            node: selected,
            start: mark.start,
            end: mark.end,
            text: config.text.slice(mark.start, mark.end),
          };
          panel.querySelector("[data-native-word-controls]").open = true;
          wordSelectionKey = "";
          syncWordSelection(panel);
          panel
            .querySelector("[data-native-word-editor]")
            .focus({ preventScroll: true });
        };
        wordStyles.append(button);
      }
    }
  }
  function select(node) {
    if (node && node === textColorAdapter?.node) {
      selectTextColors(node, textColorAdapter.host, textColorAdapter.onSelect);
      return;
    }
    textColorAdapter = null;
    const sharedPanel = document.querySelector("[data-sq-native-inspector]");
    if (sharedPanel && hooks) {
      sharedPanel.classList.remove("sq-word-colors-only");
      hooks.inspector
        .querySelector(".sq-inspector-scroll")
        .prepend(sharedPanel);
    }
    if (node !== selected) {
      selection = null;
      layerIndex = 0;
    }
    selected = node?.matches(".sq-native") ? node : null;
    const panel = document.querySelector("[data-sq-native-inspector]");
    if (!panel) return;
    panel.hidden = !selected;
    if (!selected) return;
    const config = read(selected);
    panel.querySelector("[data-native-product-controls]").hidden =
      !["product", "commerce"].includes(config.type) ||
      ["cart", "set-price", "set-add"].includes(config.part);
    if (["product", "commerce"].includes(config.type)) {
      const products = hooks.products?.() || [];
      const field = panel.querySelector("[data-native-product-id]");
      field.replaceChildren(
        ...products.map((product) => new Option(product.name, product.id)),
      );
      if (!products.some((product) => product.id === config.productId))
        field.append(
          new Option("Product no longer available", config.productId),
        );
      field.value = config.productId;
    }
    panel.querySelector("[data-native-commerce-controls]").hidden =
      config.type !== "commerce";
    if (config.type === "commerce") {
      for (const key of [
        "part",
        "group",
        "label",
        "prefix",
        "suffix",
        "priceSuffix",
        "optionLayout",
      ])
        panel.querySelector(`[data-commerce-setting="${key}"]`).value =
          config[key] || (key === "optionLayout" ? "compact" : "");
      panel.querySelector('[data-commerce-setting="showPrice"]').checked =
        Boolean(config.showPrice);
      const setProducts = panel.querySelector("[data-native-set-products]");
      setProducts.replaceChildren(
        ...(hooks.products?.() || []).map((p) => {
          const label = document.createElement("label"),
            input = document.createElement("input");
          input.type = "checkbox";
          input.value = p.id;
          input.checked = (config.productIds || []).includes(p.id);
          label.append(input, document.createTextNode(p.name));
          return label;
        }),
      );
      setProducts.hidden = !["set-price", "set-add"].includes(config.part);
      const visible = {
        part: true,
        group: config.part !== "cart",
        label: ["options", "add", "cart", "set-add"].includes(config.part),
        optionLayout: config.part === "options",
        prefix: [
          "price",
          "title",
          "description",
          "product-name",
          "set-price",
        ].includes(config.part),
        suffix: [
          "price",
          "title",
          "description",
          "product-name",
          "set-price",
        ].includes(config.part),
        priceSuffix:
          config.part === "options" && config.optionLayout === "detailed",
        showPrice: ["add", "set-add"].includes(config.part),
      };
      for (const [key, show] of Object.entries(visible))
        panel
          .querySelector(`[data-commerce-setting="${key}"]`)
          .closest("label").hidden = !show;
    }
    panel.querySelector("[data-native-content-title]").textContent =
      config.text !== undefined ? "Text" : label(config.type);
    const parent = selected.parentElement.closest(".sq-native");
    const parentName = parent && read(parent).name;
    panel.querySelector("[data-native-element-kind]").textContent = parent
      ? parentName && !/^container( section)?$/i.test(parentName)
        ? `Inside “${parentName}”`
        : parent.matches(".sq-native-section")
          ? "Inside this section"
          : "Inside a layout group"
      : "On this page";
    panel.querySelector("[data-native-parent]").hidden = !parent;
    panel.querySelector("[data-native-parent]").textContent = parent?.matches(
      ".sq-native-section",
    )
      ? "↑ Edit section"
      : "↑ Edit layout group";
    panel.querySelector("[data-native-word-controls]").hidden =
      config.text === undefined;
    panel.querySelector("[data-native-text-help]").hidden =
      config.text === undefined;
    panel.querySelector("[data-native-group=Typography]").hidden = [
      "image",
      "video",
      "break",
    ].includes(config.type);
    panel.querySelector("[data-native-open]").closest("label").hidden =
      config.type !== "accordion";
    if (!config.states?.[state]) state = "";
    if (
      context !== "base" &&
      !(getHost(config).responsive || []).some(
        (r) => `${r.min ?? ""}:${r.max ?? ""}` === context,
      )
    )
      context = "base";
    const current = getContext(config),
      props = current.props || {};
    hooks.inspector.querySelector("[data-sq-inspector-context]").textContent =
      selected.matches(".sq-native-section")
        ? "Selected section"
        : "Selected element";
    hooks.inspector.querySelector("[data-sq-inspector-title]").textContent =
      config.name ||
      (selected.matches(".sq-native-section")
        ? "Section"
        : typeName(config.type));
    const responsive = panel.querySelector("[data-native-breakpoint]");
    responsive.replaceChildren(
      new Option("All screen sizes", "base"),
      ...(getHost(config).responsive || []).map(
        (r) =>
          new Option(
            r.min != null ? `At least ${r.min}px` : `Up to ${r.max}px`,
            `${r.min ?? ""}:${r.max ?? ""}`,
          ),
      ),
    );
    if (![...responsive.options].some((o) => o.value === context))
      context = "base";
    responsive.value = context;
    const variants = panel.querySelector("[data-native-variant]");
    variants.replaceChildren(
      new Option("Normal appearance", ""),
      ...Object.keys(config.states || {}).map((key) => new Option(key, key)),
    );
    variants.value = state;
    if (variants.value !== state) state = "";
    if (config.stateScope) {
      const scope = hooks.root.querySelector(
        `[data-native-id="${CSS.escape(config.stateScope)}"]`,
      );
      if (scope)
        scope.dataset.nativeState = state || read(scope).initialState || "";
    } else hooks.root.dataset.nativeState = state;
    panel.querySelector("[data-native-context-note]").textContent =
      context === "base" && !state
        ? "Layout and appearance settings affect all screen sizes."
        : `Editing ${responsive.selectedOptions[0].text.toLowerCase()}${state ? ` · ${state} version` : ""}.`;
    panel.querySelectorAll("[data-native-prop]").forEach((input) => {
      input.value = props[input.dataset.nativeProp] ?? "";
      input.closest("label").hidden =
        config.type === "product" &&
        ["height", "maxHeight"].includes(input.dataset.nativeProp);
    });
    const text = panel.querySelector("[data-native-text]");
    text.parentElement.hidden = config.text === undefined;
    text.value = config.text || "";
    renderWordStyles(panel, config);

    panel.querySelector("[data-native-src]").value = config.src || "";
    panel.querySelector("[data-native-src]").parentElement.hidden = ![
      "image",
      "video",
    ].includes(config.type);
    panel.querySelector("[data-native-alt]").value =
      config.alt || config.label || "";
    const accessibleLabel =
      panel.querySelector("[data-native-alt]").parentElement;
    const mediaLabel = ["image", "video", "icon", "button"].includes(
      config.type,
    );
    accessibleLabel.firstChild.textContent =
      config.type === "image" ? "Image description" : "Accessible label";
    panel
      .querySelector(
        mediaLabel ? "[data-native-content]" : "[data-native-structure]",
      )
      .append(accessibleLabel);
    panel.querySelector("[data-native-content]").hidden =
      config.text === undefined &&
      !["image", "video", "icon", "button"].includes(config.type);
    panel.querySelector(
      '[data-native-fill-type] option[value="text"]',
    ).disabled = config.text === undefined;
    const icons = panel.querySelector("[data-native-icon]");
    icons.parentElement.hidden = config.type !== "icon";
    icons.replaceChildren(
      ...Object.keys(globalThis.EzkartNativeIcons || {}).map(
        (key) => new Option(label(key.replace(/-/g, " ")), key),
      ),
    );
    icons.value = config.icon || "arrow-right";
    for (const key of [
      "stateScope",
      "initialState",
      "stateParam",
      "stateMode",
      "statePanel",
    ])
      panel.querySelector(`[data-state-setting="${key}"]`).value =
        config[key] || "";
    const action = config.action || {};
    panel.querySelector("[data-native-action-scope]").value =
      action.scope || "";
    panel.querySelector("[data-native-action-type]").value = action.type || "";
    panel.querySelector("[data-native-action-target]").value =
      action.target || "";
    panel.querySelector("[data-native-action-disable-active]").checked =
      Boolean(action.disableWhenActive);
    panel
      .querySelector("[data-native-action-disable-active]")
      .closest("label").hidden = action.type !== "state";
    const layers = current.fill?.layers || [];
    draftLayers = structuredClone(layers);
    layerIndex = Math.min(layerIndex, Math.max(0, layers.length - 1));
    const layer = layers[layerIndex] || {
      kind: "linear",
      angle: 105,
      stops: [
        { color: "#fa6418", position: 0 },
        { color: "#ed1467", position: 100 },
      ],
    };
    syncLayerOptions(panel);
    panel.querySelector("[data-native-fill-type]").value = layers.length
      ? current.fill.clip === "text"
        ? "text"
        : "gradient"
      : "solid";
    const computedBackground = getComputedStyle(selected).backgroundColor;
    const background =
      props.backgroundColor ||
      (computedBackground === "rgba(0, 0, 0, 0)"
        ? "transparent"
        : computedBackground) ||
      "transparent";
    panel.querySelector("[data-native-solid-color]").value = background;
    panel.querySelector("[data-native-solid-picker]").value =
      /^#[0-9a-f]{6}$/i.test(background) ? background : "#ffffff";
    panel.querySelector("[data-native-solid-picker]").style.background =
      background;
    panel.querySelector("[data-native-layer-count]").textContent = Math.max(
      1,
      layers.length,
    );
    panel.querySelector("[data-native-fill-status]").textContent =
      config.text !== undefined
        ? "Affects the entire element. Use “Color specific words” to change a phrase."
        : `Applies to this ${config.type === "product" ? "product card" : "element"}.`;
    panel.querySelector("[data-native-fill-section] > summary").textContent =
      selected.matches(".sq-native-section")
        ? "Section background"
        : config.text !== undefined
          ? "Background & text color"
          : "Background";
    if (selected.matches(".sq-native-section"))
      panel.querySelector("[data-native-fill-status]").textContent =
        `Applies to the “${config.name || "selected"}” section.`;
    loadGradient(panel, layer);
    syncFillControls(panel);
    panel.querySelector("[data-native-name]").value = config.name || "";
    panel.querySelector("[data-native-anchor]").value = config.anchor || "";
    panel
      .querySelector("[data-native-tag]")
      .replaceChildren(...tags[config.type].map((t) => new Option(t, t)));
    panel.querySelector("[data-native-tag]").value =
      config.tag || tags[config.type][0];
    panel
      .querySelector("[data-native-move-parent]")
      .replaceChildren(
        ...[
          ...hooks.root.querySelectorAll(
            ".sq-native[data-native-type=container],.sq-native[data-native-type=accordion]",
          ),
        ]
          .filter((n) => n !== selected && !selected.contains(n))
          .map(
            (n) =>
              new Option(
                `${read(n).name || "Container"} · ${n.dataset.nativeId}`,
                n.dataset.nativeId,
              ),
          ),
      );
    panel.querySelector("[data-native-move-parent]").value =
      selected.parentElement.closest(".sq-native")?.dataset.nativeId || "";
    panel.querySelector("[data-native-media]").hidden = config.type !== "video";
    for (const key of [
      "poster",
      "captions",
      "captionsText",
      "muted",
      "controls",
      "loop",
      "autoplay",
    ]) {
      const input = panel.querySelector(`[data-native-media-${key}]`);
      if (input.type === "checkbox") input.checked = Boolean(config[key]);
      else input.value = config[key] || "";
    }
    panel.querySelector("[data-native-icon-options]").hidden =
      config.type !== "icon";
    for (const key of ["iconFill", "iconStroke", "iconWeight"])
      panel.querySelector(`[data-native-setting=${key}]`).value =
        config[key] ??
        (key === "iconWeight"
          ? 1.6
          : key === "iconFill"
            ? "none"
            : "currentColor");
    for (const key of ["max", "width", "height", "extra"])
      panel.querySelector(`[data-native-fit-${key}]`).value =
        config.fit?.[key] ?? "";
    for (const key of ["tilt", "travel"])
      panel.querySelector(`[data-native-motion-${key}]`).value =
        config.scrollMotion?.[key] ?? "";
    panel.querySelector("[data-native-visible-after]").value =
      config.scrollVisibility?.after || "";
    panel.querySelector("[data-native-hide-while]").value = (
      config.scrollVisibility?.hideWhile || []
    ).join(", ");
    panel.querySelector("[data-native-collapsed]").checked = Boolean(
      config.collapsed,
    );
    panel.querySelector("[data-native-open]").checked = Boolean(config.open);
    syncWordSelection(panel);
    hooks.syncSelects?.(panel);
  }
  function init(callbacks) {
    hooks = callbacks;
    const panel = document.createElement("section");
    panel.dataset.sqNativeInspector = "";
    panel.className = "sq-native-inspector";
    panel.hidden = true;
    panel.innerHTML = `
      <div class="sq-native-context">
        <div class="sq-native-context-heading"><span data-native-element-kind>Element</span><button type="button" class="sq-native-text-button" data-native-parent>↑ Edit layout group</button></div>
        <label>Apply layout changes to<select data-native-breakpoint><option value="base">All screen sizes</option></select></label>
        <p class="sq-native-help" data-native-context-note>Layout and appearance settings affect all screen sizes.</p>
      </div>
      <details open data-native-product-controls hidden><summary>Connected product</summary><label>Product shown here<select data-native-product-id></select></label><p class="sq-native-help">Choose a product for this element. Other placements keep their own product.</p><button type="button" class="sq-native-wide" data-native-another-product>+ Add another product card</button></details>
      <details open data-native-commerce-controls hidden><summary>Product control</summary>
      <label>Show<select data-commerce-setting="part"><option value="image">Product image</option><option value="options">Variant choices</option><option value="price">Selected price</option><option value="title">Selected name</option><option value="product-name">Product name</option><option value="set-price">Combined price</option><option value="set-add">Add a set of products</option><option value="description">Selected description</option><option value="add">Add to cart button</option><option value="cart">Open cart button</option></select></label>
      <div data-native-set-products></div><label>Shared selection name<input data-commerce-setting="group" placeholder="e.g. main-product"></label><p class="sq-native-help">Use the same name and product on controls that should share a selected variant. Leave blank for independent choices.</p>
      <label>Label<input data-commerce-setting="label"></label><label>Options layout<select data-commerce-setting="optionLayout"><option value="compact">Side by side</option><option value="detailed">Stacked with details</option><option value="select">Dropdown</option></select></label>
      <label>Text before value<input data-commerce-setting="prefix"></label><label>Text after value<input data-commerce-setting="suffix"></label><label>Option price suffix<input data-commerce-setting="priceSuffix" placeholder=" / pack"></label><label><input type="checkbox" data-commerce-setting="showPrice"> Show price on the button</label>
      </details>
      <details open data-native-content><summary data-native-content-title>Text</summary>
        <label>Your text<textarea rows="3" data-native-text></textarea></label>
        <p class="sq-native-help" data-native-text-help>Edit your copy here. Select words to change their color.</p>
        <label>Image or video URL<input type="url" placeholder="https://…" data-native-src></label>
        <label>Image description / accessible label<input data-native-alt></label>
        <label>Icon<select data-native-icon></select></label>
        <details class="sq-native-subsection" data-native-word-controls><summary>Color specific words</summary>
          <p class="sq-native-selection-note" data-native-rich-range aria-live="polite"></p>
          <div data-native-word-styles></div>
          <div data-native-word-editor role="group" aria-label="Selected word color" tabindex="-1" hidden>
            <label>Color style<select data-native-word-type><option value="mixed" disabled>Mixed colors</option><option value="solid">Solid color</option><option value="gradient">Gradient</option></select></label>
            <div class="sq-word-preview"><span data-native-word-preview></span></div>
            <div data-native-word-solid><label>Text color<div class="sq-native-color-field"><input type="color" data-native-word-color aria-label="Choose selected text color"><input type="text" spellcheck="false" data-native-word-color-value aria-label="Selected text color value"></div></label></div>
            <div data-native-word-gradient hidden>
              <div class="sq-native-pair"><label>Gradient direction<select data-word-gradient-kind><option value="linear">Straight</option><option value="radial">From a center</option></select></label><label data-word-linear>Angle (°)<input type="number" data-word-gradient-angle value="105"></label><label data-word-shape hidden>Shape<select data-word-gradient-shape><option value="ellipse">Oval</option><option value="circle">Circle</option></select></label></div>
              <div class="sq-native-pair" data-word-radial hidden><label>Center left to right (%)<input type="number" data-word-gradient-x value="50"></label><label>Center top to bottom (%)<input type="number" data-word-gradient-y value="50"></label></div>
              <div class="sq-native-stop-heading"><span>Gradient colors</span><span>At (%)</span><span></span></div><div data-word-gradient-stops></div>
              <button type="button" class="sq-native-wide" data-word-add-stop>+ Add gradient color</button>
              <details class="sq-native-subsection"><summary>Overlapping gradients</summary><label>Gradient to edit<select data-word-layer></select></label><div class="sq-native-pair"><button type="button" data-word-layer-add>Add gradient</button><button type="button" data-word-layer-remove>Remove gradient</button></div></details>
            </div>
            <button type="button" class="sq-native-primary sq-native-wide" data-native-apply-word-style>Apply to selected words</button>
            <p class="sq-native-help" data-native-word-status aria-live="polite"></p>
            <button type="button" class="sq-native-text-button" data-native-reset-word-style>Use default text color</button>
          </div>
          <button type="button" class="sq-native-text-button" data-native-clear-marks hidden>Use default color for all words</button>
        </details>
      </details>
      <details open data-native-fill-section><summary>Background &amp; text color</summary>
        <label>What to change<select data-native-fill-type><option value="solid">Background color</option><option value="gradient">Background gradient</option><option value="text">Gradient on all text</option></select></label>
        <div class="sq-native-preview-frame"><div data-native-fill-preview role="img"></div></div>
        <div data-native-solid-controls><label>Background color<div class="sq-native-color-field"><input type="color" value="#ffffff" data-native-solid-picker aria-label="Choose background color"><input type="text" value="transparent" spellcheck="false" data-native-solid-color aria-label="Background color value"></div></label></div>
        <div data-native-gradient-controls hidden>
          <div class="sq-native-pair">
            <label>Gradient direction<select data-native-gradient-kind><option value="linear">Straight</option><option value="radial">From a center</option></select></label>
            <label data-native-linear-controls>Angle<div class="sq-native-unit"><input type="number" value="105" data-native-gradient-angle><span aria-hidden="true">°</span></div></label>
            <label data-native-radial-shape hidden>Shape<select data-native-gradient-shape><option value="ellipse">Oval</option><option value="circle">Circle</option></select></label>
          </div>
          <div data-native-radial-controls hidden><div class="sq-native-pair"><label>Horizontal center (%)<input type="number" data-native-gradient-x value="50"></label><label>Vertical center (%)<input type="number" data-native-gradient-y value="50"></label></div></div>
          <div class="sq-native-stop-heading"><span>Gradient colors</span><span>At (%)</span><span></span></div>
          <div data-native-gradient-stops></div>
          <button type="button" class="sq-native-wide" data-native-add-stop>+ Add color</button>
          <details class="sq-native-subsection" data-native-layers><summary>Gradient layers <span data-native-layer-count>1</span></summary><p class="sq-native-help">Combine up to 8 gradients. The first layer sits on top.</p><label>Editing layer<select data-native-layer></select></label><div class="sq-native-pair sq-native-actions"><button type="button" data-native-layer-add>+ Add layer</button><button type="button" data-native-layer-remove>Remove layer</button></div></details>
        </div>
        <button type="button" class="sq-native-primary sq-native-wide" data-native-apply-fill>Apply to entire element</button>
        <p class="sq-native-help" data-native-fill-status aria-live="polite">Affects the entire element. Use “Color specific words” to change a phrase.</p>
      </details>`;
    panel.insertAdjacentHTML(
      "beforeend",
      `<details data-native-structure><summary>Structure &amp; accessibility</summary><label>Name<input data-native-name></label><label>Section anchor<input data-native-anchor></label><label>HTML element<select data-native-tag></select></label><label>Parent container<select data-native-move-parent></select></label><button type="button" data-native-move>Move into container</button><div class="sq-native-pair"><button type="button" data-native-earlier>Move earlier</button><button type="button" data-native-later>Move later</button></div><label><input type="checkbox" data-native-collapsed>Initially hidden (toggle target)</label><label><input type="checkbox" data-native-open>Accordion initially open</label></details><details data-native-media><summary>Video</summary><label>Poster image URL<input data-native-media-poster></label><label>Captions URL<input data-native-media-captions></label><label>Captions (WebVTT)<textarea rows="5" data-native-media-captionsText></textarea></label>${["muted", "controls", "loop", "autoplay"].map((k) => `<label><input type="checkbox" data-native-media-${k}>${label(k)}</label>`).join("")}</details><details data-native-icon-options><summary>Icon appearance</summary>${["iconFill", "iconStroke", "iconWeight"].map((k) => `<label>${label(k)}<input data-native-setting="${k}"></label>`).join("")}</details><details><summary>Show while scrolling</summary><label>Show after element or section<input data-native-visible-after placeholder="e.g. hero"></label><label>Hide while these are visible<input data-native-hide-while placeholder="e.g. purchase, footer"></label><p class="sq-native-help">Enter element IDs separated by commas. Useful for a purchase bar that appears after the hero.</p><button type="button" data-native-visibility-apply>Apply visibility</button><button type="button" data-native-visibility-clear>Always show</button></details><details><summary>Scroll motion</summary><label>Starting tilt (degrees)<input type="number" data-native-motion-tilt></label><label>Vertical travel (px)<input type="number" data-native-motion-travel></label><button type="button" data-native-motion-apply>Apply motion</button><button type="button" data-native-motion-clear>Remove motion</button></details><details><summary>Scale to fit</summary><p>Keep a detailed composition proportional below a screen width. Its parent reserves the scaled height.</p>${["max", "width", "height", "extra"].map((k) => `<label>${{ max: "Below screen width", width: "Design width", height: "Design height", extra: "Extra space below" }[k]}<input type="number" data-native-fit-${k}></label>`).join("")}<button type="button" data-native-fit-apply>Apply frame</button><button type="button" data-native-fit-clear>Remove scaling</button></details>`,
    );
    panel.insertAdjacentHTML(
      "beforeend",
      `<details data-native-state-controls><summary>Tabs &amp; filters</summary><p class="sq-native-help">Give a container a starting version. Connect its buttons and alternate appearances to that container’s ID.</p><label>Starting version<input data-state-setting="initialState" placeholder="e.g. all"></label><label>Control style<select data-state-setting="stateMode"><option value="">Buttons</option><option value="tabs">Tabs</option><option value="filter">Filters</option></select></label><label>Remember choice in URL<input data-state-setting="stateParam" placeholder="e.g. material"></label><label>Appearance follows group ID<input data-state-setting="stateScope"></label><label>Tab panel version<input data-state-setting="statePanel"></label></details>`,
    );
    const advanced = document.createElement("details");
    advanced.dataset.nativeAdvanced = "";
    advanced.innerHTML = `<summary>Advanced settings</summary><details data-native-responsive><summary>Responsive layout &amp; alternate versions</summary><label>Editing version<select data-native-variant><option value="">Normal appearance</option></select></label><p class="sq-native-help">Use different layouts for smaller screens, or create an alternate appearance for a click action.</p><label>Width rule<select data-native-breakpoint-kind><option value="max">Up to width</option><option value="min">At least width</option></select></label><label>Screen width (px)<input type="number" min="240" max="3000" placeholder="e.g. 768" data-native-new-breakpoint></label><button type="button" class="sq-native-wide" data-native-add-breakpoint>Add screen size</button><label>New version name<input placeholder="e.g. expanded" data-native-new-state></label><p class="sq-native-help">Use lowercase words and hyphens.</p><button type="button" class="sq-native-wide" data-native-add-state>Add version</button></details>`;
    [...panel.children]
      .filter(
        (node) =>
          node.matches("details") &&
          !node.matches(
            "[data-native-content], [data-native-fill-section], [data-native-product-controls], [data-native-commerce-controls], [data-native-media], [data-native-icon-options]",
          ),
      )
      .forEach((node) => advanced.append(node));
    const basicFields = {
      Layout: [
        "display",
        "flexDirection",
        "alignItems",
        "justifyContent",
        "gap",
        "gridTemplateColumns",
      ],
      Size: [
        "width",
        "height",
        "minWidth",
        "maxWidth",
        "minHeight",
        "maxHeight",
        "objectFit",
        "aspectRatio",
      ],
      Typography: [
        "fontFamily",
        "fontSize",
        "fontWeight",
        "lineHeight",
        "letterSpacing",
        "textAlign",
        "color",
      ],
      Surface: ["backgroundColor", "borderRadius", "opacity", "boxShadow"],
    };
    const names = {
      Surface: "Borders & effects",
      Size: "Size",
      Position: "Position & behavior",
    };
    const fieldNames = {
      display: "Layout type",
      flexDirection: "Direction",
      alignItems: "Align items",
      justifyContent: "Distribute items",
      gap: "Item spacing",
      gridTemplateColumns: "Grid columns",
      objectFit: "Image fit",
      color: "Text color",
      backgroundColor: "Background color",
      borderRadius: "Corner radius",
    };
    const optionNames = {
      flex: "Flexible row / column",
      grid: "Grid",
      block: "Stacked blocks",
      row: "Horizontal",
      column: "Vertical",
      "flex-start": "Start",
      "flex-end": "End",
      "space-between": "Space between",
      "space-around": "Space around",
      nowrap: "No wrap",
    };
    for (const group of [
      "Typography",
      "Size",
      "Spacing",
      "Layout",
      "Surface",
      "Position",
    ]) {
      const fields = groups[group];
      const detail = document.createElement("details");
      detail.dataset.nativeGroup = group;
      detail.innerHTML = `<summary>${group === "Typography" ? "Font & text alignment" : names[group] || group}</summary>`;
      const more = document.createElement("details");
      more.className = "sq-native-subsection";
      more.innerHTML = `<summary>More ${group.toLowerCase()} options</summary><div class="sq-native-fields"></div>`;
      const grid = document.createElement("div");
      grid.className = "sq-native-fields";
      for (const [key, type] of Object.entries(fields)) {
        if (key === "backgroundColor") continue;
        const wrap = document.createElement("label");
        wrap.append(fieldNames[key] || label(key));
        const input = Array.isArray(type)
          ? document.createElement("select")
          : document.createElement("input");
        if (Array.isArray(type))
          input.replaceChildren(
            new Option("Inherit / automatic", ""),
            ...type.map(
              (value) => new Option(optionNames[value] || label(value), value),
            ),
          );
        else input.type = "text";
        input.dataset.nativeProp = key;
        if (key === "fontFamily")
          input.setAttribute("list", "sq-native-font-families");
        input.placeholder =
          type === "length" ? "24px, 100%, auto" : "Automatic";
        wrap.append(input);
        (basicFields[group] && !basicFields[group].includes(key)
          ? more.lastElementChild
          : grid
        ).append(wrap);
      }
      detail.append(grid);
      if (more.lastElementChild.children.length) detail.append(more);
      if (group === "Position") advanced.append(detail);
      else panel.append(detail);
    }
    panel.insertAdjacentHTML(
      "beforeend",
      '<details><summary>Click action</summary><label>On click<select data-native-action-type><option value="">None</option><option value="link">Open link</option><option value="toggle">Show / hide element</option><option value="state">Switch state</option><option value="dialog">Open dialog</option><option value="close-dialog">Close dialog</option><option value="video-dialog">Open video dialog</option><option value="video-toggle">Play / pause video</option></select></label><label>Destination or target ID<input data-native-action-target></label><label>Interaction group ID<input data-native-action-scope placeholder="Optional: collection or setup group"></label><label><input type="checkbox" data-native-action-disable-active> Disable when this state is selected</label><button type="button" data-native-action-apply>Apply action</button></details><p class="sq-native-help">Hold Alt and click an element to try its interaction.</p>',
    );
    panel.append(advanced);
    const fontOptions = document.createElement("datalist");
    fontOptions.id = "sq-native-font-families";
    for (const family of ["Poppins", "Anton", "DM Sans", "Arial", "Georgia"])
      fontOptions.append(
        new Option(
          family,
          `"${family}", ${family === "Georgia" ? "serif" : "sans-serif"}`,
        ),
      );
    panel.append(fontOptions);
    panel.querySelectorAll("label").forEach((wrap) => {
      if (wrap.querySelector('input[type="checkbox"]'))
        wrap.classList.add("sq-native-check");
    });
    callbacks.inspector.querySelector(".sq-inspector-scroll").prepend(panel);
    const listen = (selector, event, fn) =>
      panel.querySelector(selector).addEventListener(event, () => {
        try {
          fn();
        } catch (error) {
          callbacks.toast(error.message);
        }
      });
    panel.querySelectorAll("[data-native-prop]").forEach((input) =>
      input.addEventListener("change", () => {
        try {
          if (!input.value) {
            const config = read(selected),
              current = getContext(config);
            delete current.props?.[input.dataset.nativeProp];
            hooks.remember();
            write(selected, config);
            refresh();
            hooks.changed();
          } else
            change({
              props: validateProps({ [input.dataset.nativeProp]: input.value }),
            });
        } catch (error) {
          callbacks.toast(error.message);
          select(selected);
        }
      }),
    );
    panel.querySelectorAll("[data-state-setting]").forEach((field) =>
      field.addEventListener("change", () => {
        try {
          change({ [field.dataset.stateSetting]: field.value });
        } catch (error) {
          hooks.toast(error.message);
          select(selected);
        }
      }),
    );
    panel
      .querySelector("[data-native-set-products]")
      .addEventListener("change", () => {
        try {
          change({
            productIds: [
              ...panel.querySelectorAll(
                "[data-native-set-products] input:checked",
              ),
            ].map((n) => n.value),
          });
        } catch (error) {
          hooks.toast(error.message);
          select(selected);
        }
      });
    listen("[data-native-product-id]", "change", () => {
      const productId = panel.querySelector("[data-native-product-id]").value;
      if (
        !(hooks.products?.() || []).some((product) => product.id === productId)
      )
        throw Error("Choose an available catalog product.");
      const config = read(selected);
      config.productId = productId;
      validate(config);
      hooks.remember();
      write(selected, config);
      refresh();
      hooks.changed();
      select(selected);
    });
    panel.querySelectorAll("[data-commerce-setting]").forEach((input) =>
      input.addEventListener("change", () => {
        const config = read(selected);
        const value = input.type === "checkbox" ? input.checked : input.value;
        if (
          (config[input.dataset.commerceSetting] ??
            (input.type === "checkbox" ? false : "")) === value
        )
          return;
        config[input.dataset.commerceSetting] = value;
        if (
          input.dataset.commerceSetting === "part" &&
          ["set-price", "set-add"].includes(value) &&
          !config.productIds?.length
        )
          config.productIds = [
            config.productId || hooks.products?.()[0]?.id,
          ].filter(Boolean);
        try {
          validate(config);
          hooks.remember();
          write(selected, config);
          refresh();
          hooks.changed();
          select(selected);
        } catch (error) {
          hooks.toast(error.message);
          select(selected);
        }
      }),
    );
    listen("[data-native-another-product]", "click", () =>
      hooks.openProducts?.(),
    );
    listen("[data-native-text]", "select", () => {
      const field = panel.querySelector("[data-native-text]");
      if (field.selectionStart !== field.selectionEnd) {
        selection = {
          node: selected,
          start: field.selectionStart,
          end: field.selectionEnd,
          text: field.value.slice(field.selectionStart, field.selectionEnd),
        };
        panel.querySelector("[data-native-word-controls]").open = true;
      } else selection = null;
      syncWordSelection(panel);
    });
    listen("[data-native-text]", "input", () => {
      selection = null;
      syncWordSelection(panel);
    });
    listen("[data-native-text]", "change", () => {
      change({ text: panel.querySelector("[data-native-text]").value });
      select(selected);
    });
    listen("[data-native-breakpoint]", "change", () => {
      context = panel.querySelector("[data-native-breakpoint]").value;
      select(selected);
    });
    listen("[data-native-variant]", "change", () => {
      state = panel.querySelector("[data-native-variant]").value;
      hooks.root.dataset.nativeState = state;
      select(selected);
    });
    listen("[data-native-add-breakpoint]", "click", () => {
      const max = Number(
        panel.querySelector("[data-native-new-breakpoint]").value,
      );
      if (max < 240 || max > 3000)
        throw Error("Use a width from 240 to 3000px.");
      hooks.remember();
      const config = read(selected),
        host = getHost(config);
      host.responsive ||= [];
      const kind = panel.querySelector("[data-native-breakpoint-kind]").value;
      if (host.responsive.some((rule) => rule[kind] === max))
        throw Error(
          "This screen size already exists. Select it at the top of the panel.",
        );
      host.responsive.push({ [kind]: max, props: {} });
      host.responsive.sort((a, b) => (b.max || 0) - (a.max || 0));
      write(selected, config);
      context = kind === "max" ? `:${max}` : `${max}:`;
      select(selected);
      hooks.changed();
    });
    listen("[data-native-add-state]", "click", () => {
      const name = panel.querySelector("[data-native-new-state]").value;
      if (!identifier(name)) throw Error("Use lowercase words and hyphens.");
      const config = read(selected);
      if (config.states?.[name])
        throw Error(
          "This version already exists. Choose it in Editing version.",
        );
      hooks.remember();
      config.states ||= {};
      config.states[name] = { props: {} };
      write(selected, config);
      state = name;
      select(selected);
      hooks.changed();
    });
    listen("[data-native-parent]", "click", () =>
      callbacks.select(selected.parentElement.closest(".sq-native")),
    );
    listen("[data-native-src]", "change", () => {
      const src = safeUrl(panel.querySelector("[data-native-src]").value);
      change({ src });
      selected.src = src;
    });
    listen("[data-native-alt]", "change", () => {
      const value = panel.querySelector("[data-native-alt]").value;
      change({ alt: value, label: value });
      if (selected.tagName === "IMG") selected.alt = value;
      else selected.setAttribute("aria-label", value);
    });
    listen("[data-native-icon]", "change", () => {
      const icon = panel.querySelector("[data-native-icon]").value;
      change({ icon });
      selected.innerHTML = globalThis.EzkartNativeIcons[icon];
    });
    const fill = () => inspectorFill(panel);
    for (const key of [
      "fill-type",
      "gradient-kind",
      "gradient-angle",
      "gradient-x",
      "gradient-y",
      "gradient-shape",
      "solid-color",
    ])
      listen(`[data-native-${key}]`, "input", () =>
        syncFillControls(panel, true),
      );
    listen("[data-native-solid-picker]", "input", () => {
      panel.querySelector("[data-native-solid-color]").value =
        panel.querySelector("[data-native-solid-picker]").value;
      syncFillControls(panel, true);
    });
    listen("[data-native-layer]", "change", () => {
      draftLayers = fill().layers;
      layerIndex = Number(panel.querySelector("[data-native-layer]").value);
      loadGradient(panel, draftLayers[layerIndex]);
      syncFillControls(panel, true);
    });
    listen("[data-native-layer-add]", "click", () => {
      const f = fill();
      if (f.layers.length >= 8) return;
      f.layers.push({
        kind: "radial",
        x: 50,
        y: 100,
        stops: [
          { color: "#f43d3950", position: 0 },
          { color: "transparent", position: 100 },
        ],
      });
      draftLayers = f.layers;
      layerIndex = draftLayers.length - 1;
      syncLayerOptions(panel);
      loadGradient(panel, draftLayers[layerIndex]);
      syncFillControls(panel, true);
    });
    listen("[data-native-layer-remove]", "click", () => {
      const f = fill();
      f.layers.splice(layerIndex, 1);
      draftLayers = f.layers;
      layerIndex = Math.max(0, layerIndex - 1);
      syncLayerOptions(panel);
      if (draftLayers.length) loadGradient(panel, draftLayers[layerIndex]);
      else panel.querySelector("[data-native-fill-type]").value = "solid";
      syncFillControls(panel, true);
    });
    for (const key of ["name", "anchor"])
      listen(`[data-native-${key}]`, "change", () => {
        const value = panel.querySelector(`[data-native-${key}]`).value;
        change({ [key]: value });
        if (key === "anchor") selected.id = value;
      });
    listen("[data-native-tag]", "change", () => {
      const config = read(selected),
        tag = panel.querySelector("[data-native-tag]").value;
      if (tag === selected.tagName.toLowerCase()) return;
      hooks.remember();
      config.tag = tag;
      const replacement = create(config);
      for (const attr of selected.attributes)
        if (attr.name !== "data-sq-native")
          replacement.setAttribute(attr.name, attr.value);
      replacement.replaceChildren(...selected.childNodes);
      selected.replaceWith(replacement);
      selected = replacement;
      hooks.changed();
      hooks.rebind?.();
      refresh();
      callbacks.select(selected);
    });
    const move = (before) => {
      const parent = panel.querySelector("[data-native-move-parent]").value;
      hooks.move({ id: selected.dataset.nativeId, parent, before });
      select(selected);
    };
    listen("[data-native-move]", "click", () => move());
    listen("[data-native-earlier]", "click", () => {
      const prev = selected.previousElementSibling;
      if (prev?.matches(".sq-native")) move(prev.dataset.nativeId);
    });
    listen("[data-native-later]", "click", () => {
      const next = selected.nextElementSibling;
      if (next?.matches(".sq-native"))
        move(next.nextElementSibling?.dataset.nativeId);
    });
    for (const key of ["collapsed", "open"])
      listen(`[data-native-${key}]`, "change", () => {
        const value = panel.querySelector(`[data-native-${key}]`).checked;
        change({ [key]: value });
        if (key === "collapsed") {
          selected.hidden = value;
          selected.toggleAttribute("data-native-collapsed", value);
        } else selected.open = value;
      });
    for (const key of [
      "poster",
      "captions",
      "captionsText",
      "muted",
      "controls",
      "loop",
      "autoplay",
    ])
      listen(`[data-native-media-${key}]`, "change", () => {
        const input = panel.querySelector(`[data-native-media-${key}]`),
          value = input.type === "checkbox" ? input.checked : input.value;
        if (value && ["poster", "captions"].includes(key)) safeUrl(value);
        change({ [key]: value });
        syncMedia(selected, read(selected));
      });
    for (const key of ["iconFill", "iconStroke", "iconWeight"])
      listen(`[data-native-setting=${key}]`, "change", () => {
        const v = panel.querySelector(`[data-native-setting=${key}]`).value,
          value = key === "iconWeight" ? Number(v) : v;
        if (
          key !== "iconWeight" &&
          value !== "none" &&
          value !== "currentColor"
        )
          color(value);
        change({ [key]: value });
        selected.setAttribute(
          {
            iconFill: "fill",
            iconStroke: "stroke",
            iconWeight: "stroke-width",
          }[key],
          value,
        );
      });
    listen("[data-native-visibility-apply]", "click", () =>
      change({
        scrollVisibility: {
          after: panel
            .querySelector("[data-native-visible-after]")
            .value.trim(),
          hideWhile: panel
            .querySelector("[data-native-hide-while]")
            .value.split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        },
      }),
    );
    listen("[data-native-visibility-clear]", "click", () =>
      change({ scrollVisibility: null }),
    );
    listen("[data-native-motion-apply]", "click", () => {
      change({
        scrollMotion: Object.fromEntries(
          ["tilt", "travel"].map((k) => [
            k,
            Number(panel.querySelector(`[data-native-motion-${k}]`).value),
          ]),
        ),
      });
    });
    listen("[data-native-motion-clear]", "click", () => {
      change({ scrollMotion: null });
      selected.style.removeProperty("transform");
    });
    listen("[data-native-fit-apply]", "click", () => {
      change({
        fit: Object.fromEntries(
          ["max", "width", "height", "extra"].map((k) => [
            k,
            Number(panel.querySelector(`[data-native-fit-${k}]`).value),
          ]),
        ),
      });
      refresh();
    });
    listen("[data-native-fit-clear]", "click", () => change({ fit: null }));
    listen("[data-native-apply-fill]", "click", () => {
      const solid =
        panel.querySelector("[data-native-fill-type]").value === "solid";
      change({
        fill: fill(),
        ...(solid
          ? {
              props: {
                backgroundColor: color(
                  panel.querySelector("[data-native-solid-color]").value,
                ),
              },
            }
          : {}),
      });
      select(selected);
      panel.querySelector("[data-native-fill-status]").textContent =
        "Element color updated. You can undo this change.";
    });
    listen("[data-native-add-stop]", "click", () => {
      const stops = [...panel.querySelectorAll(".sq-native-stop")].map(
        (row) => ({
          color: row.querySelector("[data-stop-color]").value,
          position: row.querySelector("[data-stop-position]").valueAsNumber,
        }),
      );
      if (stops.length >= 12) return;
      stops.push({ color: "#f44b34", position: 50 });
      renderStops(panel, stops);
      syncFillControls(panel, true);
      panel
        .querySelector(".sq-native-stop:last-child [data-stop-color]")
        .focus();
    });
    for (const key of ["kind", "angle", "x", "y", "shape"])
      listen(`[data-word-gradient-${key}]`, "input", () =>
        syncWordFillControls(panel, true),
      );
    listen("[data-native-word-type]", "input", () =>
      syncWordFillControls(panel, true),
    );
    listen("[data-native-word-color-value]", "input", () =>
      syncWordFillControls(panel, true),
    );
    listen("[data-native-word-color]", "input", () => {
      panel.querySelector("[data-native-word-color-value]").value =
        panel.querySelector("[data-native-word-color]").value;
      syncWordFillControls(panel, true);
    });
    listen("[data-word-add-stop]", "click", () => {
      const layers = readWordGradient(panel);
      if (layers[wordLayerIndex].stops.length >= 12) return;
      layers[wordLayerIndex].stops.push({ color: "#f44b34", position: 50 });
      wordLayers = layers;
      loadWordGradient(panel);
      syncWordFillControls(panel, true);
      panel.querySelector(".sq-word-stop:last-child [data-stop-color]").focus();
    });
    listen("[data-word-layer]", "change", () => {
      wordLayers = readWordGradient(panel);
      wordLayerIndex = Number(panel.querySelector("[data-word-layer]").value);
      loadWordGradient(panel);
      syncWordFillControls(panel, true);
    });
    listen("[data-word-layer-add]", "click", () => {
      if (wordLayers.length >= 8) return;
      wordLayers = readWordGradient(panel);
      wordLayers.push({
        kind: "linear",
        angle: 105,
        stops: [
          { color: "#f44b3480", position: 0 },
          { color: "transparent", position: 100 },
        ],
      });
      wordLayerIndex = wordLayers.length - 1;
      loadWordGradient(panel);
      syncWordFillControls(panel, true);
    });
    listen("[data-word-layer-remove]", "click", () => {
      if (wordLayers.length <= 1) return;
      wordLayers = readWordGradient(panel);
      wordLayers.splice(wordLayerIndex, 1);
      wordLayerIndex = Math.max(0, wordLayerIndex - 1);
      loadWordGradient(panel);
      syncWordFillControls(panel, true);
    });
    const applyWords = (style) => {
      if (
        !selection ||
        selected !== selection.node ||
        read(selected).text?.slice(selection.start, selection.end) !==
          selection.text
      )
        throw Error("Select the words you want to change first.");
      const config = read(selected),
        original = config.marks || [];
      const cuts = [
        ...new Set([
          0,
          config.text.length,
          selection.start,
          selection.end,
          ...original.flatMap((m) => [m.start, m.end]),
        ]),
      ].sort((a, b) => a - b);
      config.marks = [];
      for (let i = 0; i < cuts.length - 1; i++) {
        const start = cuts[i],
          end = cuts[i + 1];
        const active = original
          .filter((m) => m.start <= start && m.end >= end)
          .at(-1);
        const { start: oldStart, end: oldEnd, ...appearance } = active || {};
        if (start >= selection.start && end <= selection.end) {
          delete appearance.color;
          delete appearance.gradient;
          Object.assign(appearance, style);
        }
        if (Object.keys(appearance).length)
          config.marks.push({ start, end, ...appearance });
      }
      validate(config);
      hooks.remember();
      write(selected, config);
      renderText(selected, config);
      hooks.changed();
      if (textColorAdapter) {
        wordSelectionKey = "";
        select(selected);
        return;
      }
      // Refresh the phrase list without replacing an unrelated element-color draft.
      const draft = inspectorFill(panel),
        editingLayer = layerIndex,
        type = panel.querySelector("[data-native-fill-type]").value;
      wordSelectionKey = "";
      select(selected);
      draftLayers = draft.layers;
      layerIndex = editingLayer;
      syncLayerOptions(panel);
      panel.querySelector("[data-native-fill-type]").value = type;
      if (draft.layers.length)
        loadGradient(panel, draft.layers[layerIndex] || draft.layers[0]);
      syncFillControls(panel);
      panel.querySelector("[data-native-word-status]").textContent = style
        ? "Selected words updated."
        : "Selected words now use the text’s default color.";
    };
    listen("[data-native-apply-word-style]", "click", () => {
      const type = panel.querySelector("[data-native-word-type]").value;
      if (type === "mixed") return;
      applyWords(
        type === "gradient"
          ? { gradient: readWordGradient(panel) }
          : {
              color: color(
                panel.querySelector("[data-native-word-color-value]").value,
              ),
            },
      );
    });
    listen("[data-native-reset-word-style]", "click", () => applyWords(null));
    listen("[data-native-clear-marks]", "click", () => {
      const marks = (read(selected).marks || [])
        .map(({ color, gradient, ...mark }) => mark)
        .filter((mark) => Object.keys(mark).length > 2);
      change({ marks });
      wordSelectionKey = "";
      select(selected);
    });
    listen("[data-native-action-type]", "change", () => {
      panel
        .querySelector("[data-native-action-disable-active]")
        .closest("label").hidden =
        panel.querySelector("[data-native-action-type]").value !== "state";
    });
    listen("[data-native-action-apply]", "click", () => {
      const type = panel.querySelector("[data-native-action-type]").value,
        target = panel.querySelector("[data-native-action-target]").value;
      change({
        action: type
          ? {
              type,
              target,
              scope:
                panel.querySelector("[data-native-action-scope]").value ||
                undefined,
              disableWhenActive:
                type === "state" &&
                panel.querySelector("[data-native-action-disable-active]")
                  .checked,
            }
          : null,
      });
      if (selected.tagName === "A" && type === "link") selected.href = target;
      refresh();
    });
    document.addEventListener("selectionchange", () => {
      // Sidebar focus can leave an old canvas range behind. Only a canvas
      // selection should replace the phrase currently being edited.
      const focus = document.activeElement;
      if (focus && focus !== document.body && !hooks.root.contains(focus))
        return;
      const s = getSelection();
      if (!s || s.isCollapsed || !s.rangeCount) return;
      const range = s.getRangeAt(0),
        ancestor =
          range.commonAncestorContainer.nodeType === 3
            ? range.commonAncestorContainer.parentElement
            : range.commonAncestorContainer,
        node = textColorAdapter?.node.contains(ancestor)
          ? textColorAdapter.node
          : ancestor.closest(".sq-native");
      if (!node || node !== selected || read(node).text === undefined) return;
      const before = range.cloneRange();
      before.selectNodeContents(node);
      before.setEnd(range.startContainer, range.startOffset);
      selection = {
        node,
        start: before.toString().length,
        end: before.toString().length + range.toString().length,
        text: range.toString(),
      };
      panel.querySelector("[data-native-content]").open = true;
      panel.querySelector("[data-native-word-controls]").open = true;
      if (textColorAdapter) textColorAdapter.onSelect?.();
      syncWordSelection(panel);
    });
    hooks.root.addEventListener("input", (event) => {
      if (textColorAdapter?.node.contains(event.target)) {
        textColorAdapter.config = readDOMColors(textColorAdapter.node);
        selection = null;
        wordSelectionKey = "";
        renderWordStyles(panel, textColorAdapter.config);
        syncWordSelection(panel);
      }
      const node = event.target.closest(".sq-native[data-native-text-field]");
      if (!node) return;
      const config = read(node);
      editText(config, node.textContent);
      write(node, config);
      selection = null;
      if (node === selected) {
        panel.querySelector("[data-native-text]").value = config.text;
        syncWordSelection(panel);
      }
      hooks.changed();
    });
    refresh();
  }
  globalThis.EzkartNative = {
    selectTextColors,
    preserveTextColors: () => {
      if (
        textColorAdapter?.node.isConnected &&
        textColorAdapter.config.marks.length
      )
        renderDOMColors(textColorAdapter.node, textColorAdapter.config);
    },
    typeName,
    groups,
    schema,
    tags,
    defaults,
    validate,
    validateProps,
    read,
    write,
    create,
    refresh,
    select,
    init,
    stylesheet,
    mount,
    gradientCss,
    renderText,
    editText,
    syncMedia,
    remapTree,
    startPointer,
    nudge,
  };
})();
