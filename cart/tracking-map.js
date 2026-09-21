(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const config = JSON.parse($("tracking-map-config").textContent);
  const validPoint = (p) => p && Number.isFinite(p.latitude) && Number.isFinite(p.longitude) && Math.abs(p.latitude) <= 90 && Math.abs(p.longitude) <= 180 && (p.latitude !== 0 || p.longitude !== 0);
  const point = (p) => ({ lat: p.latitude, lng: p.longitude });
  const samePoint = (a, b) => a && b && a.latitude === b.latitude && a.longitude === b.longitude;
  let map, Marker, sdk, loading, failedAt = 0, state, stateKey = "", overview = false;
  let markers = [], lines = [], routeKey = "", routePath = [], routeSequence = 0, viewSequence = 0;
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
  function loadGoogle() {
    if (sdk) return sdk;
    sdk = new Promise((resolve, reject) => {
      if (!config.key || !config.mapId) { reject(new Error("Maps is not configured")); return; }
      const script = document.createElement("script");
      const timeout = setTimeout(() => reject(new Error("Map loading timed out")), 12000);
      window.ezkartGoogleMapsReady = () => { clearTimeout(timeout); resolve(); };
      window.gm_authFailure = () => { clearTimeout(timeout); failMap(); reject(new Error("Maps authorization failed")); };
      script.onerror = () => { clearTimeout(timeout); reject(new Error("Map loading failed")); };
      script.src = "https://maps.googleapis.com/maps/api/js?" + new URLSearchParams({ key: config.key, v: "weekly", loading: "async", callback: "ezkartGoogleMapsReady", auth_referrer_policy: "origin", language: "en", region: "ID" });
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
    const marker = new Marker({ map, position: point(coordinate), title, zIndex: kind === "truck" ? 30 : 10, anchorLeft: "-50%", anchorTop: "-50%" });
    marker.append(content);
    markers.push(marker);
  }
  function paintMarkers() {
    markers.forEach((marker) => { marker.map = null; });
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
      const bounds = new google.maps.LatLngBounds();
      const coordinates = [...routePath, ...[state.location, state.origin, state.destination].filter(Boolean).map(point)];
      if (!coordinates.length) return;
      coordinates.forEach((coordinate) => bounds.extend(coordinate));
      map.fitBounds(bounds, { top: 80, bottom: 85, left: 70, right: 70 });
      google.maps.event.addListenerOnce(map, "idle", () => { if (map.getZoom() > 16) map.setZoom(16); });
    } else {
      map.setCenter(point(state.location));
      map.setZoom(15);
    }
  }
  function clearRoute() {
    lines.forEach((line) => line.setMap(null));
    lines = [];
    routePath = [];
  }
  function routeNote(text, drawn = false) {
    $("map-route-note").textContent = text;
    $("map-route-summary").hidden = !text;
    $("map-route-summary").classList.toggle("route-drawn", drawn);
  }
  async function drawRoute() {
    if (!map) return;
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
        const { Route } = await google.maps.importLibrary("routes");
        const { routes } = await Route.computeRoutes({ origin: point(from), destination: point(to), travelMode: "DRIVING", fields: ["path"] });
        path = routes?.[0]?.path;
        if (!path?.length) throw new Error("No route available");
        routeCache.set(key, path);
        if (routeCache.size > 20) routeCache.delete(routeCache.keys().next().value);
      }
      // An older request must never draw over a newer shipment update.
      if (sequence !== routeSequence) return;
      routePath = path;
      lines = [
        new google.maps.Polyline({ map, path, strokeColor: "#ffffff", strokeOpacity: 1, strokeWeight: 9, zIndex: 1, clickable: false }),
        new google.maps.Polyline({ map, path, strokeColor: "#ee563d", strokeOpacity: 1, strokeWeight: 5, zIndex: 2, clickable: false }),
      ];
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
      await loadGoogle();
      const [maps, markerLibrary] = await Promise.all([google.maps.importLibrary("maps"), google.maps.importLibrary("marker")]);
      if ($("package-map-frame").hidden || $("delivery-map-section").hidden || failedAt) return;
      Marker = markerLibrary.AdvancedMarkerElement;
      map = new maps.Map($("delivery-map"), {
        mapId: config.mapId, center: point(state.location || state.origin || state.destination), zoom: 15,
        disableDefaultUI: true, clickableIcons: false, gestureHandling: "greedy", keyboardShortcuts: true,
        minZoom: 3, maxZoom: 20, heading: 0, tilt: 0, colorScheme: maps.ColorScheme.LIGHT,
      });
      map.addListener("dragstart", () => { viewSequence++; });
      map.addListener("zoom_changed", () => { viewSequence++; });
      $("map-tools").hidden = false;
      $("map-loading").hidden = true;
      paintMarkers();
      positionMap();
      void drawRoute();
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
    if (map) {
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
    if (map) { paintMarkers(); positionMap(); }
    else { $("package-map-frame").scrollIntoView({ block: "center", behavior: "smooth" }); void drawMap(); }
  });
  $("map-zoom-in").addEventListener("click", () => { if (map) map.setZoom(Math.min(20, map.getZoom() + 1)); });
  $("map-zoom-out").addEventListener("click", () => { if (map) map.setZoom(Math.max(3, map.getZoom() - 1)); });
  new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) void drawMap(); }).observe($("package-map-frame"));
  window.ezkartDeliveryMap = { update, validPoint };
})();
