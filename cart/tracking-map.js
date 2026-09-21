(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const validPoint = (p) => p && Number.isFinite(p.latitude) && Number.isFinite(p.longitude) && Math.abs(p.latitude) <= 90 && Math.abs(p.longitude) <= 180 && (p.latitude !== 0 || p.longitude !== 0);
  const point = (p) => [p.longitude, p.latitude];
  const samePoint = (a, b) => a && b && a.latitude === b.latitude && a.longitude === b.longitude;
  let map, sdk, loading, ready = false, failedAt = 0, state, stateKey = "", overview = false;
  let markers = [], routeKey = "", routePath = [], routeSequence = 0, viewSequence = 0;
  const routeCache = new Map();
  const truck = '<svg viewBox="0 0 48 36" width="43" height="33" fill="none" aria-hidden="true"><path d="M4 7a3 3 0 0 1 3-3h23v23H4V7Z" fill="#f3563c"/><path d="M30 13h8l7 9v5H30V13Z" fill="#182b45"/><path d="M33 16h4l5 6h-9v-6Z" fill="#dcecf6"/><path d="M1 14h9M1 19h7" stroke="#fff" stroke-width="2" stroke-linecap="round"/><path d="m15 12 5-3 5 3-5 3-5-3Zm0 0v6l5 3 5-3v-6m-5 3v6" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/><path d="M5 27h39" stroke="#182b45" stroke-width="2"/><circle cx="12" cy="28" r="5" fill="#182b45" stroke="#fff" stroke-width="2"/><circle cx="37" cy="28" r="5" fill="#182b45" stroke="#fff" stroke-width="2"/><circle cx="12" cy="28" r="1.5" fill="#fff"/><circle cx="37" cy="28" r="1.5" fill="#fff"/></svg>';
  const home = '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 11 9-8 9 8M5 10v11h14V10M9 21v-7h6v7"/></svg>';

  function failMap() {
    failedAt = Date.now();
    $("package-map-frame").hidden = true;
    $("map-tools").hidden = true;
    $("map-route-summary").hidden = true;
    $("map-route-toggle").hidden = true;
    $("map-notice").hidden = false;
  }
  function loadMapLibrary() {
    if (sdk) return sdk;
    sdk = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      const timeout = setTimeout(() => reject(new Error("Map loading timed out")), 12000);
      script.onload = () => { clearTimeout(timeout); window.maplibregl ? resolve() : reject(new Error("Map unavailable")); };
      script.onerror = () => { clearTimeout(timeout); reject(new Error("Map loading failed")); };
      script.src = "vendor/maplibre/maplibre-gl.js?v=5.24.0";
      script.async = true;
      document.head.append(script);
    });
    return sdk;
  }
  function makeMarker(coordinate, kind, label, title) {
    const content = document.createElement("div");
    content.className = "shipment-pin shipment-pin-" + kind;
    const symbol = document.createElement("span");
    symbol.className = "shipment-pin-symbol";
    if (kind === "truck") symbol.innerHTML = truck;
    else if (kind === "home") symbol.innerHTML = home;
    else symbol.textContent = "";
    const caption = document.createElement("span");
    caption.className = "shipment-pin-label";
    caption.textContent = label;
    content.append(symbol, caption);
    const element = document.createElement("div");
    element.title = title;
    element.setAttribute("aria-label", title);
    element.style.zIndex = kind === "truck" ? "3" : "2";
    element.append(content);
    const marker = new maplibregl.Marker({ element, anchor: "center" }).setLngLat(point(coordinate)).addTo(map);
    markers.push(marker);
  }
  function paintMarkers() {
    markers.forEach((marker) => marker.remove());
    markers = [];
    const { location, origin, destination, completed, returning } = state;
    if (destination && !samePoint(location, destination)) makeMarker(destination, "home", returning ? "Seller" : "Delivery", returning ? "Return address" : "Delivery address");
    if ((overview || !location) && origin && !samePoint(origin, location) && !samePoint(origin, destination)) makeMarker(origin, "pickup", "Pickup", "Pickup address");
    if (location) makeMarker(location, completed ? "home" : "truck", completed ? (returning ? "Returned" : "Delivered") : "Your package", "Last reported location: " + location.label);
  }
  function positionMap() {
    if (!map || !state) return;
    viewSequence++;
    if (overview || !state.location) {
      const bounds = new maplibregl.LngLatBounds();
      const coordinates = [...routePath, ...[state.location, state.origin, state.destination].filter(Boolean).map(point)];
      if (!coordinates.length) return;
      coordinates.forEach((coordinate) => bounds.extend(coordinate));
      map.fitBounds(bounds, { padding: { top: 80, bottom: 85, left: 70, right: 70 }, maxZoom: 16, duration: 0 });
    } else {
      map.jumpTo({ center: point(state.location), zoom: 15 });
    }
  }
  function clearRoute() {
    if (map?.getSource("delivery-route")) map.getSource("delivery-route").setData({ type: "FeatureCollection", features: [] });
    routePath = [];
  }
  function routeNote(text, drawn = false) {
    $("map-route-note").textContent = text;
    $("map-route-summary").hidden = !text;
    $("map-route-summary").classList.toggle("route-drawn", drawn);
  }
  async function drawRoute() {
    if (!ready) return;
    const from = state.location || state.origin, to = state.destination;
    const key = !state.terminal && from && to && !samePoint(from, to) ? JSON.stringify([point(from), point(to)]) : "";
    if (key === routeKey) return;
    routeKey = key;
    const sequence = ++routeSequence, view = viewSequence;
    clearRoute();
    if (!key) { routeNote(""); return; }
    routeNote("Finding the road route…");
    try {
      let path = routeCache.get(key);
      if (!path) {
        const params = new URLSearchParams({ order: document.querySelector(".return-shell").dataset.order });
        if (window.ezkartTrackingSandbox) { params.delete("order"); params.set("sandbox", "1"); params.set("stage", new URLSearchParams(location.search).get("stage") || "processing"); }
        const response = await fetch("api/tracking-route.php?" + params, { cache: "no-store", signal: AbortSignal.timeout(10000) });
        const data = await response.json();
        const route = data.route;
        if (!response.ok || !data.ok || !samePoint(route?.from, from) || !samePoint(route?.to, to) || route.type !== "LineString") throw new Error("Route unavailable");
        path = route.coordinates;
        if (!Array.isArray(path) || path.length < 2 || path.length > 10000 || path.some((p) => !Array.isArray(p) || p.length !== 2 || !validPoint({ longitude: p[0], latitude: p[1] }))) throw new Error("No route available");
        routeCache.set(key, path);
        if (routeCache.size > 20) routeCache.delete(routeCache.keys().next().value);
      }
      // An older request must never draw over a newer shipment update.
      if (sequence !== routeSequence) return;
      routePath = path;
      map.getSource("delivery-route").setData({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: path } });
      routeNote("Suggested road route · The courier’s actual route may differ.", true);
      if (overview && view === viewSequence) positionMap();
    } catch (_) {
      if (sequence === routeSequence) routeNote("Road route unavailable. Reported locations are still shown.");
    }
  }
  async function drawMap() {
    if (loading || $("package-map-frame").hidden || $("delivery-map-section").hidden) return;
    if (map) return;
    loading = true;
    $("map-loading").hidden = false;
    try {
      await loadMapLibrary();
      if ($("package-map-frame").hidden || $("delivery-map-section").hidden || failedAt) return;
      map = new maplibregl.Map({
        container: "delivery-map", style: "tracking-map-style.json?v=1", center: point(state.location || state.origin || state.destination), zoom: 15,
        attributionControl: { compact: true, customAttribution: '<a href="vendor/openfreemap/POSITRON-LICENSE.md" target="_blank" rel="noopener noreferrer">Positron</a>' }, dragRotate: false, touchPitch: false, pitchWithRotate: false,
        minZoom: 3, maxZoom: 19, maxPitch: 0, renderWorldCopies: false,
      });
      map.touchZoomRotate.disableRotation();
      map.on("dragstart", () => { viewSequence++; });
      map.on("zoomstart", () => { viewSequence++; });
      const timeout = setTimeout(() => { if (!ready) failMap(); }, 20000);
      map.on("error", () => { $("map-notice").hidden = false; });
      map.once("load", () => {
        clearTimeout(timeout);
        if (failedAt) return;
        ready = true;
        map.addSource("delivery-route", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addLayer({ id: "delivery-route-casing", type: "line", source: "delivery-route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#fff", "line-width": 9 } });
        map.addLayer({ id: "delivery-route-line", type: "line", source: "delivery-route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#ee563d", "line-width": 5 } });
        $("map-tools").hidden = false;
        $("map-loading").hidden = true;
        paintMarkers(); positionMap(); void drawRoute();
      });
    } catch (_) { failMap(); }
    finally { loading = false; }
  }
  function update(t) {
    const location = validPoint(t.latest_location) ? t.latest_location : null;
    const origin = validPoint(t.locations?.origin) ? t.locations.origin : null;
    const end = validPoint(t.locations?.destination) ? t.locations.destination : null;
    const returning = ["returning", "returned"].includes(t.stage);
    const destination = returning ? origin : end;
    const terminal = ["delivered", "returned", "cancelled"].includes(t.stage);
    const completed = ["delivered", "returned"].includes(t.stage);
    const next = { location, origin, destination, returning, terminal, completed };
    const key = JSON.stringify(next);
    if (key === stateKey) return;
    const firstLocation = !state?.location && !!location;
    state = next; stateKey = key;
    if (!destination) overview = false;
    $("package-location-empty").hidden = !!location;
    $("package-map-frame").hidden = !(location || (origin && destination));
    $("map-route-toggle").hidden = !destination || terminal;
    $("map-route-toggle").textContent = overview ? "Back to package" : "View full route";
    $("map-location-badge").textContent = location ? (location.source === "confirmed_stop" ? "Confirmed by courier" : "Last reported location") : "Pickup & delivery";
    $("map-notice").hidden = true;
    if (failedAt) { failMap(); return; }
    if (ready) {
      map.resize();
      paintMarkers();
      if (firstLocation) positionMap();
      void drawRoute();
    }
    const rect = $("package-map-frame").getBoundingClientRect();
    if (rect.bottom > 0 && rect.top < innerHeight) void drawMap();
  }
  $("map-recenter").addEventListener("click", () => {
    overview = false;
    $("map-route-toggle").textContent = "View full route";
    paintMarkers(); positionMap();
  });
  $("map-route-toggle").addEventListener("click", () => {
    overview = !overview;
    $("map-route-toggle").textContent = overview ? "Back to package" : "View full route";
    if (ready) { paintMarkers(); positionMap(); }
    else { $("package-map-frame").scrollIntoView({ block: "center", behavior: "smooth" }); void drawMap(); }
  });
  $("map-zoom-in").addEventListener("click", () => { if (map) map.setZoom(Math.min(19, map.getZoom() + 1)); });
  $("map-zoom-out").addEventListener("click", () => { if (map) map.setZoom(Math.max(3, map.getZoom() - 1)); });
  new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) void drawMap(); }).observe($("package-map-frame"));
  window.ezkartDeliveryMap = { update, validPoint };
})();
