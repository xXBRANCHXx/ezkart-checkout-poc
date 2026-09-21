(() => {
  "use strict";
  const byId = (id) => document.getElementById(id);
  const shell = document.querySelector(".return-shell");
  const order = shell.dataset.order;
  const sandbox = document.getElementById("tracking-sandbox-data") ? window.ezkartTrackingSandbox : null;
  const params = new URLSearchParams(location.search);
  let scope = /^[a-z0-9][a-z0-9_-]{5,79}$/i.test(params.get("shop") || "") ? params.get("shop").toLowerCase() : "";
  const money = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
  const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" });
  const date = (value) => Number.isFinite(Date.parse(value)) ? dateFormat.format(Date.parse(value)) + " WIB" : "";
  const setText = (id, text) => { if (byId(id).textContent !== text) byId(id).textContent = text; };
  const notice = (text) => { setText("tracking-notice", text); byId("tracking-notice").hidden = !text; };
  const safeLink = (value) => {
    try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? url.href : ""; } catch { return ""; }
  };
  function brand() {
    if (sandbox) { setText("merchant-name-return", "Order from Sandbox store"); return; }
    if (scope) byId("return-checkout-link").href = "./?shop=" + encodeURIComponent(scope);
    try {
      const stored = scope ? localStorage.getItem("ezkart.checkout.shop.v1:" + scope) : sessionStorage.getItem("ezkart.checkout.brand");
      const data = JSON.parse(stored || "{}");
      setText("merchant-name-return", data.name ? "Order from " + String(data.name).slice(0, 80) : "Your order");
      const url = safeLink(data.returnUrl);
      if (url) byId("return-store-link").href = url;
    } catch (_) {}
  }
  brand();
  const labels = {
    confirmed: "Pickup arranged", scheduled: "Pickup scheduled", allocated: "Courier assigned",
    picking_up: "Courier heading to pickup", picked: "Picked up by courier", in_transit: "In transit",
    dropping_off: "Out for delivery", delivered: "Delivered", on_hold: "Delivery on hold",
    return_in_transit: "Returning to seller", returned: "Returned to seller", cancelled: "Delivery cancelled",
    rejected: "Shipment rejected", courier_not_found: "Courier unavailable", disposed: "Shipment disposed",
  };
  function presentation(data) {
    const t = data.tracking;
    if (data.status === "FAILED") return ["Payment wasn’t completed", "The payment was declined, expired, or cancelled. Return to checkout to try again."];
    if (t.stage === "awaiting_payment") {
      if (Date.parse(data.payment_details?.expires_at) <= Date.now()) return ["Payment window ended", "Do not transfer to the expired account. If you already paid, we’re still checking for confirmation."];
      return ["Awaiting payment", "We’re waiting for payment confirmation. Your order will move to the seller once payment is received."];
    }
    return ({
      not_required: ["Payment confirmed", "Your test payment is confirmed. Delivery was skipped for this sandbox order."],
      processing: t.seller_accepted
        ? ["The seller is preparing your order", "Your payment is confirmed and the seller has accepted your order. Next, they’ll arrange a courier pickup."]
        : ["Your order is with the seller", "Payment received. The seller has been notified and will confirm your order before preparing it for delivery."],
      awaiting_pickup: [t.shipment_status === "picking_up" ? "The courier is heading to the seller" : "Your order is awaiting pickup", "Pickup has been arranged. We’ll update this page when the courier has collected your package."],
      in_transit: ["Your order is on the way", "The courier has picked up your package. Follow its latest delivery updates below."],
      out_for_delivery: ["Your order is out for delivery", "The courier is bringing your package to the delivery address."],
      delivered: ["Your order has been delivered", "The courier has confirmed delivery. Thank you for your order."],
      returning: ["Your order is returning to the seller", "The courier is returning your package. Contact the seller for the next steps."],
      returned: ["Your order was returned to the seller", "The courier has confirmed the return. Contact the seller for help with your order."],
      cancelled: ["Delivery was cancelled", "This shipment was cancelled. Your payment remains confirmed; contact the seller for the next steps."],
      pickup_issue: ["Pickup needs attention", "Your payment is confirmed. The seller needs to resolve a pickup issue before your package can be collected."],
      attention: [labels[t.shipment_status] || "Delivery needs attention", "The courier reported a delivery issue. Check the latest update below or contact the seller for help."],
      shipment_update: ["Waiting for a courier update", "Your shipment has been booked. Its latest delivery status will appear here when available."],
    })[t.stage] || ["Order update", "We’ll show the latest confirmed update here."];
  }
  let map, markers, mapKey = "", locations, latestLocation, overview = false;
  const validPoint = (point) => point && Number.isFinite(point.latitude) && Number.isFinite(point.longitude) && Math.abs(point.latitude) <= 90 && Math.abs(point.longitude) <= 180;
  const point = (coordinate) => [coordinate.latitude, coordinate.longitude];
  function positionMap() {
    if (!map) return;
    markers.clearLayers();
    if (!overview && latestLocation) {
      const icon = L.divIcon({ className: "package-marker", html: '<span><svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m12 3 9 5-9 5-9-5 9-5Z M3 8v9l9 5 9-5V8 M12 13v9 M7.5 5.5l9 5"/></svg></span>', iconSize: [48, 48], iconAnchor: [24, 24] });
      const tooltip = document.createElement("span");
      tooltip.textContent = latestLocation.label;
      L.marker(point(latestLocation), { icon, title: latestLocation.label, alt: "Package’s last reported location" }).addTo(markers).bindTooltip(tooltip, { direction: "top", offset: [0, -26] });
      map.setView(point(latestLocation), 13, { animate: false });
    } else if (locations) {
      const bounds = [];
      for (const [key, label, letter] of [["origin", "Pickup", "P"], ["destination", "Delivery", "D"]]) {
        bounds.push(point(locations[key]));
        L.marker(point(locations[key]), { title: label, alt: label, icon: L.divIcon({ className: "", html: `<span class="delivery-pin ${key}-dot">${letter}</span>`, iconSize: [30, 30], iconAnchor: [15, 15] }) }).addTo(markers).bindTooltip(label);
      }
      map.fitBounds(bounds, { padding: [48, 48], maxZoom: 13, animate: false });
    }
  }
  function drawMap() {
    if (byId("package-map-frame").hidden) return;
    if (!window.L) { byId("map-notice").hidden = false; return; }
    try {
      if (!map) {
        map = L.map("delivery-map", { scrollWheelZoom: false, zoomControl: false });
        markers = L.layerGroup().addTo(map);
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19, referrerPolicy: "strict-origin-when-cross-origin",
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>',
        }).on("tileerror", () => { byId("map-notice").hidden = false; }).addTo(map);
        positionMap();
      }
      map.invalidateSize();
    } catch (_) { byId("map-notice").hidden = false; }
  }
  const mapObserver = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) drawMap(); });
  mapObserver.observe(byId("package-map-frame"));
  function updateMapView() {
    byId("package-map-frame").hidden = !(latestLocation || (overview && locations));
    byId("map-recenter").hidden = byId("package-map-frame").hidden;
    byId("map-route-toggle").hidden = !locations;
    setText("map-route-toggle", overview ? (latestLocation ? "Back to package location" : "Hide route overview") : "View pickup & delivery");
    setText("map-location-badge", overview ? "Pickup & delivery overview" : latestLocation?.source === "confirmed_stop" ? "Confirmed by the courier" : "Last reported location");
    byId("package-location-empty").hidden = !!latestLocation || overview;
    if (map) { map.invalidateSize(); positionMap(); }
    const rect = byId("package-map-frame").getBoundingClientRect();
    if (rect.bottom > 0 && rect.top < innerHeight) drawMap();
  }
  byId("map-recenter").addEventListener("click", () => { if (latestLocation) overview = false; updateMapView(); });
  byId("map-route-toggle").addEventListener("click", () => { overview = !overview; updateMapView(); });
  function renderMap(t) {
    byId("delivery-map-section").hidden = ["awaiting_payment", "not_required", "processing", "pickup_issue"].includes(t.stage);
    const latest = (t.history || []).at(-1);
    setText("package-update", latest?.note || labels[t.shipment_status] || "Waiting for the courier’s first update.");
    const location = validPoint(t.latest_location) ? t.latest_location : null;
    setText("package-location-time", location ? location.label + " · " + date(location.updated_at) : latest ? date(latest.updated_at) : "Updates appear as the courier shares them.");
    const route = validPoint(t.locations?.origin) && validPoint(t.locations?.destination) ? t.locations : null;
    const key = JSON.stringify([location, route]);
    if (key === mapKey) return;
    mapKey = key;
    latestLocation = location;
    locations = route;
    overview = false;
    byId("map-notice").hidden = true;
    updateMapView();
  }
  let historyKey = "";
  function renderHistory(t) {
    const events = [];
    if (t.paid_at) events.push({ title: "Payment received", updated_at: t.paid_at });
    if (t.accepted_at) events.push({ title: "Seller accepted your order", updated_at: t.accepted_at, note: "The seller is preparing your order for pickup." });
    if (t.pickup_arranged_at) events.push({ title: "Pickup arranged", updated_at: t.pickup_arranged_at });
    for (const item of t.history || []) events.push({ ...item, title: labels[item.status] || "Courier update" });
    events.forEach((event, index) => { event.sequence = index; });
    events.sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at) || b.sequence - a.sequence);
    const key = JSON.stringify(events);
    if (key === historyKey) return;
    historyKey = key;
    byId("journey-empty").hidden = events.length > 0;
    byId("tracking-history").replaceChildren(...events.map((event) => {
      const row = document.createElement("li");
      const title = document.createElement("b");
      title.textContent = event.title;
      row.append(title);
      if (event.note) { const note = document.createElement("p"); note.textContent = event.note; row.append(note); }
      const time = document.createElement("time"); time.dateTime = event.updated_at; time.textContent = date(event.updated_at); row.append(time);
      return row;
    }));
  }
  function render(data) {
    const t = data.tracking;
    const attention = ["attention", "pickup_issue", "cancelled", "returning", "returned"].includes(t.stage);
    shell.dataset.stage = t.stage;
    shell.dataset.attention = String(attention);
    const [title, message] = presentation(data);
    setText("return-title", title);
    setText("return-message", message);
    setText("return-icon", attention ? "!" : data.status === "PAID" ? "✓" : "◷");
    byId("tracking-sandbox").hidden = data.environment !== "sandbox";
    setText("return-total", money.format(data.total));
    setText("return-reference", data.payment_reference || "Waiting");
    setText("return-status", data.status + (data.environment === "sandbox" ? " (test)" : ""));
    setText("return-fulfillment", t.stage === "not_required" ? "Delivery skipped (sandbox)" : t.stage === "awaiting_payment" ? "Waiting for payment" : labels[t.shipment_status] || (t.stage === "processing" ? "Seller processing" : title));
    setText("processing-detail", t.seller_accepted ? "Preparing your order" : "Waiting for seller confirmation");
    byId("tracking-steps").hidden = t.stage === "not_required";
    [...byId("tracking-steps").children].forEach((step, index) => {
      step.classList.toggle("complete", index < t.progress || (attention && index <= t.progress));
      if (index === t.progress && !attention) step.setAttribute("aria-current", "step"); else step.removeAttribute("aria-current");
      const text = index < t.progress ? "✓" : String(index + 1);
      if (step.firstElementChild.textContent !== text) step.firstElementChild.textContent = text;
    });
    byId("courier-row").hidden = !t.courier;
    byId("waybill-row").hidden = !t.waybill_id;
    setText("tracking-courier", t.courier || "");
    setText("tracking-waybill", t.waybill_id || "");
    const link = safeLink(t.link);
    const courierLink = byId("courier-tracking-link");
    courierLink.hidden = !link;
    if (link) courierLink.href = link; else courierLink.removeAttribute("href");
    setText("courier-tracking-link", t.live_tracking ? "View courier live tracking ↗" : "View courier tracking ↗");
    setText("tracking-updated", date(t.updated_at) ? "Last update: " + date(t.updated_at) : "Updates appear here automatically.");
    notice(t.unavailable ? "Courier updates are temporarily unavailable. Your last confirmed status is shown; we’ll try again automatically." : "");
    if (/^[a-z0-9][a-z0-9_-]{5,79}$/.test(data.shop || "") && scope !== data.shop) { scope = data.shop; brand(); }
    if (!sandbox && data.status === "PAID" && data.shop) {
      try { localStorage.removeItem("ezkart.checkout.cart.v1:" + data.shop); } catch (_) {}
    }
    byId("tracking-content").hidden = false;
    renderHistory(t);
    renderMap(t);
  }
  let lastData, requestInFlight = false, manualCheck = false, timer, failures = 0;
  async function check(manual = false) {
    if (!order) return;
    if (manual) {
      manualCheck = true;
      byId("refresh-tracking").disabled = byId("retry-tracking").disabled = true;
      byId("refresh-tracking").setAttribute("aria-busy", "true");
    }
    if (requestInFlight) return;
    clearTimeout(timer);
    requestInFlight = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    let notFound = false;
    try {
      let data;
      if (sandbox) data = sandbox.read();
      else {
        const response = await fetch("api/status.php?order=" + encodeURIComponent(order) + "&tracking=1", { cache: "no-store", signal: controller.signal });
        if (response.status === 401) {
          byId("tracking-content").hidden = true;
          location.reload();
          return;
        }
        notFound = response.status === 404;
        if (!response.ok) throw new Error("unavailable");
        data = await response.json();
      }
      if (!data.ok || data.order_id !== order || !Number.isSafeInteger(data.total) || !data.tracking || !Array.isArray(data.tracking.history)) throw new Error("unavailable");
      lastData = data;
      failures = 0;
      byId("retry-tracking").hidden = true;
      render(data);
    } catch (_) {
      failures++;
      if (notFound) { lastData = null; byId("tracking-content").hidden = true; byId("switch-tracking-account").hidden = false; }
      notice(notFound ? "This order isn’t linked to this account. Check your order link, or sign in with the Google account that uses your checkout email." : lastData ? "We couldn’t refresh your order. Your last confirmed update is still shown; we’ll try again automatically." : "Order updates are temporarily unavailable. Please try again.");
      byId("retry-tracking").hidden = !!lastData || notFound;
    } finally {
      clearTimeout(timeout);
      requestInFlight = false;
      if (manualCheck) {
        byId("refresh-tracking").disabled = byId("retry-tracking").disabled = false;
        byId("refresh-tracking").removeAttribute("aria-busy");
        manualCheck = false;
      }
      if (!sandbox && !notFound && !document.hidden) timer = setTimeout(check, Math.min(60000, (lastData?.status === "PAID" ? 15000 : 5000) * (failures + 1)));
    }
  }
  byId("refresh-tracking").addEventListener("click", () => check(true));
  byId("retry-tracking").addEventListener("click", () => check(true));
  document.addEventListener("visibilitychange", () => { clearTimeout(timer); if (!document.hidden) check(); });
  window.addEventListener("online", () => check());
  window.addEventListener("pageshow", (event) => { if (event.persisted) location.reload(); });
  if (sandbox) window.addEventListener("ezkart:sandbox-update", () => check());
  if (order) check(); else notice("This order link is invalid. Use the link provided after checkout.");
})();
