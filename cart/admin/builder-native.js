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
    },
    Typography: {
      fontFamily: "text",
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
    ],
    text: ["p", "span", "small", "strong", "b", "em", "i"],
    heading: ["h1", "h2", "h3", "h4"],
    button: ["a", "button"],
    image: ["img"],
    icon: ["svg"],
    video: ["video"],
    accordion: ["details"],
    summary: ["summary"],
    break: ["br"],
  };
  const defaults = {
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
  const read = (node) => {
    try {
      return JSON.parse(node.dataset.sqNative || "{}");
    } catch {
      return {};
    }
  };
  const write = (node, config) => {
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
    if (config.src) safeUrl(config.src);
    if (config.poster) safeUrl(config.poster);
    if (config.captions) safeUrl(config.captions);
    if (config.action) {
      if (
        !["link", "toggle", "state", "video-dialog", "video-toggle"].includes(
          config.action.type,
        )
      )
        throw Error("Choose an interaction.");
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
          `${cssName(key)}:${String(value).replace(/([\d.]+)vw\b/g, "calc($1 * var(--native-vw, 1vw))")}`,
      )
      .join(";") +
    (fill?.layers?.length
      ? `;background-image:${gradientCss(fill.layers)};${fill.clip === "text" ? "background-clip:text;-webkit-background-clip:text;color:transparent;" : ""}`
      : fill
        ? ";background-image:none;background-clip:border-box;"
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
          const variant = `.sq-page-preview[data-native-state="${state}"] .sq-native[data-native-id="${config.id}"]`;
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
    const motion = () =>
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
    root
      .closest(".sq-canvas-scroll")
      ?.addEventListener("scroll", scheduleMotion, { passive: true });
    const fit = () => {
      root.style.setProperty("--native-vw", `${root.clientWidth / 100}px`);
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
          .querySelectorAll("[aria-expanded=true]")
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
        root.dataset.nativeState = action.target;
        root.querySelectorAll("[data-native-action]").forEach((n) => {
          try {
            const a = JSON.parse(n.dataset.nativeAction);
            if (a.type === "state")
              n.setAttribute(
                "aria-pressed",
                String(a.target === action.target),
              );
          } catch {}
        });
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
        root
          .querySelectorAll("[aria-expanded=true]")
          .forEach((n) => n.setAttribute("aria-expanded", "false"));
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
    layerIndex = 0;
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
      if (c.action?.target && ids.has(c.action.target))
        c.action.target = ids.get(c.action.target);
      if (c.action?.type === "link" && c.action.target.startsWith("#")) {
        const old = c.action.target.slice(1);
        if (anchors.has(old)) c.action.target = "#" + anchors.get(old);
      }
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
    const move = (e) => {
      const dx = (e.clientX - start.x) / scale,
        dy = (e.clientY - start.y) / scale;
      if (Math.abs(dx) + Math.abs(dy) < 1) return;
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
      Object.assign(node.style, props);
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
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end, { once: true });
    window.addEventListener("pointercancel", end, { once: true });
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
      if (config.action)
        node.dataset.nativeAction = JSON.stringify(config.action);
      else delete node.dataset.nativeAction;
      node.dataset.nativeAutoplay = String(Boolean(config.autoplay));
      if (config.fit) node.dataset.nativeFit = JSON.stringify(config.fit);
      else delete node.dataset.nativeFit;
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
    if (patch.text !== undefined && config.text === undefined) return;
    const target = getContext(config);
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
  function select(node) {
    selected = node?.matches(".sq-native") ? node : null;
    const panel = document.querySelector("[data-sq-native-inspector]");
    if (!panel) return;
    panel.hidden = !selected;
    if (!selected) return;
    const config = read(selected);
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
    panel.querySelector("[data-native-title]").textContent =
      config.name || label(config.type);
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
      new Option("Default", ""),
      ...Object.keys(config.states || {}).map((key) => new Option(key, key)),
    );
    variants.value = state;
    if (variants.value !== state) state = "";
    panel
      .querySelectorAll("[data-native-prop]")
      .forEach(
        (input) => (input.value = props[input.dataset.nativeProp] ?? ""),
      );
    const text = panel.querySelector("[data-native-text]");
    text.parentElement.hidden = config.text === undefined;
    text.value = config.text || "";
    const wordStyles = panel.querySelector("[data-native-word-styles]");
    wordStyles.replaceChildren();
    if (config.marks?.length) {
      const caption = document.createElement("small");
      caption.textContent = "Styled words";
      wordStyles.append(caption);
      for (const mark of config.marks) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = `${config.text.slice(mark.start, mark.end)} · ${mark.gradient ? "Gradient" : mark.color || "Style"}`;
        button.onclick = () => {
          selection = {
            node: selected,
            start: mark.start,
            end: mark.end,
            text: config.text.slice(mark.start, mark.end),
          };
          text.focus();
          text.setSelectionRange(mark.start, mark.end);
          panel.querySelector("[data-native-rich-range]").textContent =
            `Selected: “${selection.text}”`;
          if (mark.gradient) {
            const layer = mark.gradient[0];
            panel.querySelector("[data-native-fill-type]").value = "text";
            panel.querySelector("[data-native-gradient-kind]").value =
              layer.kind;
            panel.querySelector("[data-native-gradient-angle]").value =
              layer.angle ?? 105;
            const stops = panel.querySelector("[data-native-gradient-stops]"),
              template = stops.firstElementChild.cloneNode(true);
            stops.replaceChildren(
              ...layer.stops.map((stop) => {
                const row = template.cloneNode(true);
                row.children[0].value = stop.color;
                row.children[1].value = stop.position;
                row.children[2].onclick = () => {
                  if (stops.children.length > 2) row.remove();
                };
                return row;
              }),
            );
          } else if (mark.color && /^#[0-9a-f]{6}$/i.test(mark.color))
            panel.querySelector("[data-native-word-color]").value = mark.color;
        };
        wordStyles.append(button);
      }
    }

    panel.querySelector("[data-native-src]").value = config.src || "";
    panel.querySelector("[data-native-src]").parentElement.hidden = ![
      "image",
      "video",
    ].includes(config.type);
    panel.querySelector("[data-native-alt]").value =
      config.alt || config.label || "";
    const icons = panel.querySelector("[data-native-icon]");
    icons.parentElement.hidden = config.type !== "icon";
    icons.replaceChildren(
      ...Object.keys(globalThis.EzkartNativeIcons || {}).map(
        (key) => new Option(label(key.replace(/-/g, " ")), key),
      ),
    );
    icons.value = config.icon || "arrow-right";
    const action = config.action || {};
    panel.querySelector("[data-native-action-type]").value = action.type || "";
    panel.querySelector("[data-native-action-target]").value =
      action.target || "";
    const layers = current.fill?.layers || [];
    layerIndex = Math.min(layerIndex, Math.max(0, layers.length - 1));
    const layer = layers[layerIndex] || {
      kind: "linear",
      angle: 105,
      stops: [
        { color: "#fa6418", position: 0 },
        { color: "#ed1467", position: 100 },
      ],
    };
    panel
      .querySelector("[data-native-layer]")
      .replaceChildren(
        ...(layers.length ? layers : [layer]).map(
          (l, i) => new Option(`Layer ${i + 1}`, i),
        ),
      );
    panel.querySelector("[data-native-layer]").value = layerIndex;
    panel.querySelector("[data-native-gradient-x]").value = layer.x ?? 50;
    panel.querySelector("[data-native-gradient-y]").value = layer.y ?? 50;
    panel.querySelector("[data-native-gradient-shape]").value =
      layer.shape || "ellipse";
    panel.querySelector("[data-native-fill-type]").value = layers.length
      ? current.fill.clip === "text"
        ? "text"
        : "gradient"
      : "solid";
    panel.querySelector("[data-native-gradient-kind]").value = layer.kind;
    panel.querySelector("[data-native-gradient-angle]").value =
      layer.angle ?? 105;
    panel.querySelector("[data-native-gradient-stops]").replaceChildren(
      ...layer.stops.map((stop, index) => {
        const row = document.createElement("div");
        row.className = "sq-native-stop";
        const colorInput = document.createElement("input");
        colorInput.value = stop.color;
        colorInput.setAttribute("aria-label", `Stop ${index + 1} color`);
        const position = document.createElement("input");
        position.type = "number";
        position.min = 0;
        position.max = 100;
        position.value = stop.position;
        position.setAttribute("aria-label", `Stop ${index + 1} position`);
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "×";
        remove.setAttribute("aria-label", `Remove stop ${index + 1}`);
        remove.onclick = () => {
          if (row.parentElement.children.length > 2) row.remove();
        };
        row.append(colorInput, position, remove);
        return row;
      }),
    );
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
    panel.querySelector("[data-native-collapsed]").checked = Boolean(
      config.collapsed,
    );
    panel.querySelector("[data-native-open]").checked = Boolean(config.open);
    const rich = panel.querySelector("[data-native-rich-range]");
    rich.textContent =
      selection && selected.contains(selection.node)
        ? `Selected: “${selection.text}”`
        : "Select words on the canvas, then apply a color or gradient.";
  }
  function init(callbacks) {
    hooks = callbacks;
    const panel = document.createElement("section");
    panel.dataset.sqNativeInspector = "";
    panel.className = "sq-native-inspector";
    panel.hidden = true;
    panel.innerHTML =
      '<header><h3 data-native-title>Element</h3><button type="button" data-native-parent>↑ Select parent</button></header><label>Screen size<select data-native-breakpoint><option value="base">All screen sizes</option></select></label><div class="sq-native-pair"><select data-native-breakpoint-kind><option value="max">Up to width</option><option value="min">At least width</option></select><input type="number" min="240" placeholder="Width (px)" data-native-new-breakpoint><button type="button" data-native-add-breakpoint>Add breakpoint</button></div><label>State<select data-native-variant><option value="">Default</option></select></label><div class="sq-native-pair"><input placeholder="State name" data-native-new-state><button type="button" data-native-add-state>Add state</button></div><label>Text<textarea rows="3" data-native-text></textarea></label><div data-native-word-styles></div><label>Image or video URL<input type="url" data-native-src></label><label>Image description / accessible label<input data-native-alt></label><label>Icon<select data-native-icon></select></label><details open><summary>Color &amp; gradient</summary><label>Layer<select data-native-layer></select></label><div class="sq-native-pair"><button type="button" data-native-layer-add>+ Layer</button><button type="button" data-native-layer-remove>Remove layer</button></div><label>Fill<select data-native-fill-type><option value="solid">Solid color</option><option value="gradient">Gradient background</option><option value="text">Gradient text</option></select></label><div class="sq-native-pair"><label>Style<select data-native-gradient-kind><option value="linear">Linear</option><option value="radial">Radial</option></select></label><label>Angle<input type="number" data-native-gradient-angle value="105"></label></div><div class="sq-native-pair"><label>Center X (%)<input type="number" data-native-gradient-x value="50"></label><label>Center Y (%)<input type="number" data-native-gradient-y value="50"></label></div><label>Radial shape<select data-native-gradient-shape><option value="ellipse">Ellipse</option><option value="circle">Circle</option></select></label><div data-native-gradient-stops></div><button type="button" data-native-add-stop>+ Color stop</button><button type="button" data-native-apply-fill>Apply fill</button><p data-native-rich-range></p><div class="sq-native-pair"><input type="color" data-native-word-color value="#f44b34"><button type="button" data-native-apply-word-color>Color selected words</button></div><button type="button" data-native-apply-word-gradient>Gradient selected words</button><button type="button" data-native-clear-marks>Clear word styles</button></details>';
    panel.insertAdjacentHTML(
      "beforeend",
      `<details><summary>Structure &amp; accessibility</summary><label>Name<input data-native-name></label><label>Section anchor<input data-native-anchor></label><label>HTML role<select data-native-tag></select></label><label>Parent container<select data-native-move-parent></select></label><button type="button" data-native-move>Move into container</button><div class="sq-native-pair"><button type="button" data-native-earlier>Move earlier</button><button type="button" data-native-later>Move later</button></div><label><input type="checkbox" data-native-collapsed>Initially hidden (toggle target)</label><label><input type="checkbox" data-native-open>Accordion initially open</label></details><details data-native-media><summary>Video</summary><label>Poster image URL<input data-native-media-poster></label><label>Captions URL<input data-native-media-captions></label><label>Captions (WebVTT)<textarea rows="5" data-native-media-captionsText></textarea></label>${["muted", "controls", "loop", "autoplay"].map((k) => `<label><input type="checkbox" data-native-media-${k}>${label(k)}</label>`).join("")}</details><details data-native-icon-options><summary>Icon appearance</summary>${["iconFill", "iconStroke", "iconWeight"].map((k) => `<label>${label(k)}<input data-native-setting="${k}"></label>`).join("")}</details><details><summary>Scroll motion</summary><label>Starting tilt (degrees)<input type="number" data-native-motion-tilt></label><label>Vertical travel (px)<input type="number" data-native-motion-travel></label><button type="button" data-native-motion-apply>Apply motion</button><button type="button" data-native-motion-clear>Remove motion</button></details><details><summary>Scale to fit</summary><p>Keep a detailed composition proportional below a screen width. Its parent reserves the scaled height.</p>${["max", "width", "height", "extra"].map((k) => `<label>${{ max: "Below screen width", width: "Design width", height: "Design height", extra: "Extra space below" }[k]}<input type="number" data-native-fit-${k}></label>`).join("")}<button type="button" data-native-fit-apply>Apply frame</button><button type="button" data-native-fit-clear>Remove scaling</button></details>`,
    );
    for (const [group, fields] of Object.entries(groups)) {
      const detail = document.createElement("details");
      detail.innerHTML = `<summary>${group}</summary>`;
      const grid = document.createElement("div");
      grid.className = "sq-native-fields";
      for (const [key, type] of Object.entries(fields)) {
        const wrap = document.createElement("label");
        wrap.append(label(key));
        const input = Array.isArray(type)
          ? document.createElement("select")
          : document.createElement("input");
        if (Array.isArray(type))
          input.replaceChildren(
            new Option("Inherit / automatic", ""),
            ...type.map((value) => new Option(label(value), value)),
          );
        else input.type = "text";
        input.dataset.nativeProp = key;
        input.placeholder =
          type === "length" ? "24px, 100%, auto" : "Automatic";
        wrap.append(input);
        grid.append(wrap);
      }
      detail.append(grid);
      panel.append(detail);
    }
    panel.insertAdjacentHTML(
      "beforeend",
      '<details><summary>Interaction</summary><label>On click<select data-native-action-type><option value="">None</option><option value="link">Open link</option><option value="toggle">Show / hide element</option><option value="state">Switch state</option><option value="video-dialog">Open video dialog</option><option value="video-toggle">Play / pause video</option></select></label><label>Destination or target ID<input data-native-action-target></label><button type="button" data-native-action-apply>Apply action</button></details><p class="sq-field-note">Layout and appearance stay editable at every screen size. Hold Alt to try interactions in the editor.</p>',
    );
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
    listen("[data-native-text]", "select", () => {
      const field = panel.querySelector("[data-native-text]");
      if (field.selectionStart !== field.selectionEnd) {
        selection = {
          node: selected,
          start: field.selectionStart,
          end: field.selectionEnd,
          text: field.value.slice(field.selectionStart, field.selectionEnd),
        };
        panel.querySelector("[data-native-rich-range]").textContent =
          `Selected: “${selection.text}”`;
      }
    });
    listen("[data-native-text]", "change", () =>
      change({ text: panel.querySelector("[data-native-text]").value }),
    );
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
      hooks.remember();
      const config = read(selected);
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
    const fill = () => {
      const current = getContext(read(selected)),
        layers = structuredClone(current.fill?.layers || []);
      layers[layerIndex] = {
        kind: panel.querySelector("[data-native-gradient-kind]").value,
        angle: Number(
          panel.querySelector("[data-native-gradient-angle]").value,
        ),
        x: Number(panel.querySelector("[data-native-gradient-x]").value),
        y: Number(panel.querySelector("[data-native-gradient-y]").value),
        shape: panel.querySelector("[data-native-gradient-shape]").value,
        stops: [
          ...panel.querySelector("[data-native-gradient-stops]").children,
        ].map((row) => ({
          color: row.children[0].value,
          position: Number(row.children[1].value),
        })),
      };
      return {
        clip:
          panel.querySelector("[data-native-fill-type]").value === "text"
            ? "text"
            : "background",
        layers:
          panel.querySelector("[data-native-fill-type]").value === "solid"
            ? []
            : layers,
      };
    };
    listen("[data-native-layer]", "change", () => {
      layerIndex = Number(panel.querySelector("[data-native-layer]").value);
      select(selected);
    });
    listen("[data-native-layer-add]", "click", () => {
      const f = fill();
      f.layers.push({
        kind: "radial",
        x: 50,
        y: 100,
        stops: [
          { color: "#f43d3950", position: 0 },
          { color: "transparent", position: 100 },
        ],
      });
      layerIndex = f.layers.length - 1;
      change({ fill: f });
      select(selected);
    });
    listen("[data-native-layer-remove]", "click", () => {
      const f = fill();
      f.layers.splice(layerIndex, 1);
      layerIndex = 0;
      change({ fill: f });
      select(selected);
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
      change({ fill: fill() });
      select(selected);
    });
    listen("[data-native-add-stop]", "click", () => {
      const row = panel.querySelector(".sq-native-stop").cloneNode(true);
      row.children[0].value = "#f43d39";
      row.children[1].value = "50";
      row.children[2].onclick = () => {
        if (row.parentElement.children.length > 2) row.remove();
      };
      panel.querySelector("[data-native-gradient-stops]").append(row);
    });
    const words = (gradient) => {
      if (!selection || !selected.contains(selection.node))
        throw Error("Select words in this text first.");
      const config = read(selection.node);
      if (config.text === undefined) throw Error("Select a text element.");
      hooks.remember();
      config.marks ||= [];
      config.marks.push({
        start: selection.start,
        end: selection.end,
        ...(gradient
          ? { gradient: fill().layers }
          : { color: panel.querySelector("[data-native-word-color]").value }),
      });
      validate(config);
      write(selection.node, config);
      renderText(selection.node, config);
      hooks.changed();
    };
    listen("[data-native-apply-word-color]", "click", () => words(false));
    listen("[data-native-apply-word-gradient]", "click", () => {
      if (panel.querySelector("[data-native-fill-type]").value === "solid")
        panel.querySelector("[data-native-fill-type]").value = "text";
      words(true);
    });
    listen("[data-native-clear-marks]", "click", () => {
      change({ marks: [] });
      renderText(selected, read(selected));
    });
    listen("[data-native-action-apply]", "click", () => {
      const type = panel.querySelector("[data-native-action-type]").value,
        target = panel.querySelector("[data-native-action-target]").value;
      change({ action: type ? { type, target } : null });
      if (selected.tagName === "A" && type === "link") selected.href = target;
      refresh();
    });
    document.addEventListener("selectionchange", () => {
      const s = getSelection();
      if (!s || s.isCollapsed || !s.rangeCount) return;
      const range = s.getRangeAt(0),
        node = (
          range.commonAncestorContainer.nodeType === 3
            ? range.commonAncestorContainer.parentElement
            : range.commonAncestorContainer
        ).closest(".sq-native");
      if (!node || read(node).text === undefined) return;
      const before = range.cloneRange();
      before.selectNodeContents(node);
      before.setEnd(range.startContainer, range.startOffset);
      selection = {
        node,
        start: before.toString().length,
        end: before.toString().length + range.toString().length,
        text: range.toString(),
      };
      if (selected)
        panel.querySelector("[data-native-rich-range]").textContent =
          `Selected: “${selection.text}”`;
    });
    hooks.root.addEventListener("input", (event) => {
      const node = event.target.closest(".sq-native[data-native-text-field]");
      if (!node) return;
      const config = read(node);
      editText(config, node.textContent);
      write(node, config);
      hooks.changed();
    });
    refresh();
  }
  globalThis.EzkartNative = {
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
  };
})();
