(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const validPoint = (p) => p && Number.isFinite(p.latitude) && Number.isFinite(p.longitude) && Math.abs(p.latitude) <= 90 && Math.abs(p.longitude) <= 180 && (p.latitude !== 0 || p.longitude !== 0);
  const point = (p) => [p.longitude, p.latitude];
  const samePoint = (a, b) => a && b && a.latitude === b.latitude && a.longitude === b.longitude;
  let map, sdk, loading, ready = false, failedAt = 0, state, stateKey = "", overview = false, destinationFocus = false;
  let markers = [], routeKey = "", routePath = [], routeSequence = 0, viewSequence = 0;
  let pinEdit = null;
  const routeCache = new Map();
  const truck = '<svg viewBox="0 0 64 46" width="64" height="46" fill="none" aria-hidden="true"><ellipse cx="33" cy="39" rx="25" ry="3" fill="#182b45" opacity=".12"/><path d="M7 9a4 4 0 0 1 4-4h27a4 4 0 0 1 4 4v5h7a5 5 0 0 1 4 2l7 10v7a3 3 0 0 1-3 3H7V9Z" fill="#fff" stroke="#fff" stroke-width="6" stroke-linejoin="round"/><path d="M7 9a4 4 0 0 1 4-4h27a4 4 0 0 1 4 4v25H7V9Z" fill="#ee563d"/><path d="M42 14h7a5 5 0 0 1 4 2l7 10v7a3 3 0 0 1-3 3H42V14Z" fill="#df462f"/><path d="M46 18h3a2 2 0 0 1 1.6.8L55 25h-9v-7Z" fill="#e7f0f4"/><path d="M7 29h35v6H7z" fill="#d9422c"/><path d="M15 15h16m-16 5h10" stroke="#fff" stroke-width="3" stroke-linecap="round"/><path d="M46 29h4" stroke="#a52f23" stroke-width="2" stroke-linecap="round"/><path d="M58 28h2v4h-2" fill="#fff3d5"/><path d="M6 35h54" stroke="#182b45" stroke-width="2.5" stroke-linecap="round"/><circle cx="17" cy="35" r="6" fill="#182b45" stroke="#fff" stroke-width="2"/><circle cx="50" cy="35" r="6" fill="#182b45" stroke="#fff" stroke-width="2"/><circle cx="17" cy="35" r="2" fill="#e3eaf0"/><circle cx="50" cy="35" r="2" fill="#e3eaf0"/></svg>';
  const destinationPin = '<svg viewBox="0 0 40 50" width="40" height="50" fill="none" aria-hidden="true"><path d="M20 47S3 29 3 20a17 17 0 1 1 34 0c0 9-17 27-17 27Z" fill="#182b45" stroke="#fff" stroke-width="3" stroke-linejoin="round"/><circle cx="20" cy="20" r="6" fill="#fff"/></svg>';

  function failMap() {
    if (pinEdit) finishPinEdit(false);
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
    else if (kind === "destination") symbol.innerHTML = destinationPin;
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
    const marker = new maplibregl.Marker({ element, anchor: kind === "destination" ? "bottom" : "center" }).setLngLat(point(coordinate)).addTo(map);
    markers.push(marker);
  }
  function paintMarkers() {
    markers.forEach((marker) => marker.remove());
    markers = [];
    if (pinEdit) return;
    const { location, origin, destination, completed, returning } = state;
    if (destination && !samePoint(location, destination)) makeMarker(destination, "destination", returning ? "Seller" : "Delivery", returning ? "Return address" : "Delivery address");
    if ((overview || !location) && origin && !samePoint(origin, location) && !samePoint(origin, destination)) makeMarker(origin, "pickup", "Pickup", "Pickup address");
    if (location) makeMarker(location, completed ? "destination" : "truck", completed ? (returning ? "Returned" : "Delivered") : "Your package", "Last reported location: " + location.label);
  }
  function positionMap() {
    if (!map || !state || pinEdit) return;
    viewSequence++;
    if (destinationFocus && state.destination) {
      map.jumpTo({ center: point(state.destination), zoom: 16 });
    } else if (overview || !state.location) {
      const bounds = new maplibregl.LngLatBounds();
      const coordinates = [...routePath, ...[state.location, state.origin, state.destination].filter(Boolean).map(point)];
      if (!coordinates.length) return;
      coordinates.forEach((coordinate) => bounds.extend(coordinate));
      map.fitBounds(bounds, { padding: { top: 80, bottom: innerWidth <= 780 ? 115 : 85, left: 70, right: 70 }, maxZoom: 16, duration: 0 });
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
        if (window.ezkartTrackingSandbox) { params.delete("order"); params.set("sandbox", "1"); params.set("stage", new URLSearchParams(location.search).get("stage") || "processing"); if (window.ezkartTrackingSandbox.place()) params.set("place", window.ezkartTrackingSandbox.place().id); }
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
        paintMarkers();
        if (pinEdit) preparePinEdit(); else positionMap();
        void drawRoute();
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
    if (state && (state.returning !== returning || state.completed !== completed)) destinationFocus = false;
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
    overview = false; destinationFocus = false;
    $("map-route-toggle").textContent = "View full route";
    paintMarkers(); positionMap();
  });
  $("map-route-toggle").addEventListener("click", () => {
    destinationFocus = false;
    overview = !overview;
    $("map-route-toggle").textContent = overview ? "Back to package" : "View full route";
    if (ready) { paintMarkers(); positionMap(); }
    else { $("package-map-frame").scrollIntoView({ block: "center", behavior: "smooth" }); void drawMap(); }
  });
  $("map-zoom-in").addEventListener("click", () => { if (map) map.setZoom(Math.min(19, map.getZoom() + 1)); });
  $("map-zoom-out").addEventListener("click", () => { if (map) map.setZoom(Math.max(3, map.getZoom() - 1)); });
  new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) void drawMap(); }).observe($("package-map-frame"));
  function focusDestination() {
    if (!state?.destination) return;
    overview = false; destinationFocus = true;
    $("map-route-toggle").textContent = "View full route";
    $("package-map-frame").scrollIntoView({ block: "center", behavior: "smooth" });
    if (ready) { paintMarkers(); positionMap(); } else void drawMap();
  }
  function pinRouteVisibility(visible) {
    for (const id of ["delivery-route-casing", "delivery-route-line"]) {
      if (map?.getLayer(id)) map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
    }
  }
  function preparePinEdit() {
    if (!ready || !pinEdit) return;
    map.stop(); map.resize();
    const center = map.getCenter();
    pinEdit.previousView = { center: center.toArray(), zoom: map.getZoom() };
    const initial = pinEdit.coordinate;
    // Keep a nearby view the customer has already panned to inspect.
    const nearby = !initial || (Math.abs(center.lat - initial.latitude) < .03 && Math.abs(center.lng - initial.longitude) < .03);
    map.jumpTo({ center: nearby ? center : point(initial), zoom: Math.max(17, map.getZoom()) });
    paintMarkers(); pinRouteVisibility(false);
    $("map-pin-save").disabled = false;
    map.getCanvas().focus({ preventScroll: true });
  }
  function beginPinEdit(options) {
    if (pinEdit || failedAt || !$("map-pin-editor")) return false;
    pinEdit = { ...options, trigger: document.activeElement };
    $("map-pin-symbol").innerHTML = destinationPin;
    $("map-pin-editor").hidden = false;
    $("map-pin-error").textContent = "";
    $("map-pin-save").textContent = options.label || "Use this pin";
    $("map-pin-save").disabled = true;
    $("map-recenter").disabled = true;
    $("map-route-toggle").disabled = true;
    $("package-map-frame").classList.add("choosing-pin");
    $("package-map-frame").scrollIntoView({ block: "center", behavior: "smooth" });
    if (ready) preparePinEdit(); else void drawMap();
    return true;
  }
  function finishPinEdit(saved) {
    const previous = pinEdit; pinEdit = null;
    $("map-pin-editor").hidden = true;
    $("package-map-frame").classList.remove("choosing-pin", "saving-pin");
    $("map-pin-cancel").disabled = false;
    $("map-tools").inert = false;
    $("delivery-map").inert = false;
    $("map-recenter").disabled = false;
    $("map-route-toggle").disabled = false;
    if (ready) {
      pinRouteVisibility(true); paintMarkers();
      if (saved && state.destination) { overview = false; destinationFocus = true; map.jumpTo({ center: point(state.destination), zoom: Math.max(17, map.getZoom()) }); }
      else if (previous.previousView) map.jumpTo(previous.previousView);
    }
    previous.onClose?.(saved);
    previous.trigger?.focus({ preventScroll: true });
  }
  $("map-pin-cancel")?.addEventListener("click", () => { if (pinEdit && !pinEdit.saving) finishPinEdit(false); });
  $("map-pin-save")?.addEventListener("click", async () => {
    if (!pinEdit || !ready || pinEdit.saving) return;
    map.stop();
    const center = map.getCenter(), coordinate = { latitude: center.lat, longitude: center.lng };
    if (!validPoint(coordinate)) { $("map-pin-error").textContent = "Move the pin to a valid location."; return; }
    pinEdit.saving = true;
    $("map-pin-save").disabled = true; $("map-pin-cancel").disabled = true;
    $("map-pin-save").textContent = "Saving pin…";
    $("map-pin-error").textContent = "";
    $("map-tools").inert = true;
    $("delivery-map").inert = true;
    $("package-map-frame").classList.add("saving-pin");
    // Remove keyboard focus as well as pointer input while the position is saved.
    map.getCanvas().blur();
    try { await pinEdit.onSave(coordinate); finishPinEdit(true); }
    catch (error) {
      pinEdit.saving = false;
      $("map-pin-error").textContent = error.message || "The pin could not be saved. Please try again.";
      $("map-pin-save").textContent = pinEdit.label || "Use this pin";
      $("map-pin-save").disabled = false; $("map-pin-cancel").disabled = false;
      $("map-tools").inert = false;
      $("delivery-map").inert = false;
      $("package-map-frame").classList.remove("saving-pin");
    }
  });
  window.ezkartDeliveryMap = { update, validPoint, focusDestination, beginPinEdit };
})();
