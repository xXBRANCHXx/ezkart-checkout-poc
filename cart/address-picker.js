(() => {
  "use strict";
  let sdk;
  const valid = p => p && Number.isFinite(p.latitude) && Number.isFinite(p.longitude) && Math.abs(p.latitude) <= 90 && Math.abs(p.longitude) <= 180 && (p.latitude !== 0 || p.longitude !== 0);
  const pin = '<svg viewBox="0 0 40 50" width="40" height="50" fill="none" aria-hidden="true"><path d="M20 47S3 29 3 20a17 17 0 1 1 34 0c0 9-17 27-17 27Z" fill="#182b45" stroke="#fff" stroke-width="3" stroke-linejoin="round"/><circle cx="20" cy="20" r="6" fill="#fff"/></svg>';
  function loadLibrary() {
    if (window.maplibregl) return Promise.resolve();
    if (sdk) return sdk;
    sdk = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      const timeout = setTimeout(() => reject(new Error("Map loading timed out")), 15000);
      script.onload = () => { clearTimeout(timeout); window.maplibregl ? resolve() : reject(new Error("Map unavailable")); };
      script.onerror = () => { clearTimeout(timeout); reject(new Error("Map unavailable")); };
      script.src = "/cart/vendor/maplibre/maplibre-gl.js?v=5.24.0";
      document.head.append(script);
    }).catch(error => { sdk = null; throw error; });
    return sdk;
  }
  window.ezkartAddressPicker = (container, options) => {
    container.className = "address-picker";
    container.innerHTML = '<div class="address-picker-heading"><strong>Delivery location</strong><span>Optional</span></div><label class="address-picker-label">Find your address<input type="search" class="address-picker-query" placeholder="Street, city, Plus Code, or coordinates" maxlength="500" autocomplete="off"></label><div class="address-picker-actions"><button type="button" data-find>Find address</button></div><p class="address-picker-status" role="status">Enter your address and we’ll find it on the map.</p><div class="address-picker-frame"><div class="address-picker-map" role="region" aria-label="Position your delivery entrance"></div><div class="address-picker-loading" role="status">Loading map…</div><div class="address-picker-hint">Enter your address to find its location</div><span class="address-picker-pin" aria-hidden="true" hidden>' + pin + '</span><div class="address-picker-zoom"><button type="button" data-zoom="1" aria-label="Zoom in">+</button><button type="button" data-zoom="-1" aria-label="Zoom out">−</button></div></div><ul class="address-picker-results" hidden></ul><p class="address-picker-credit">Address search: <a href="https://photon.komoot.io/" target="_blank" rel="noopener noreferrer">Photon</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap</a></p>';
    const $ = selector => container.querySelector(selector);
    const query = $("input"), status = $(".address-picker-status"), results = $("ul"), canvas = $(".address-picker-map"), loading = $(".address-picker-loading");
    const overview = { latitude: -2.5, longitude: 118 };
    let map, mapReady, ready = false, active = false, coordinate = null, confirmed = false, positioning = false, controller, autoTimer, sequence = 0, generation = 0, searching = false, lookupSource = "fields";
    const closeEnough = () => ready && loading.hidden && map.getZoom() >= 16;
    function updateHint() {
      $(".address-picker-pin").hidden = !valid(coordinate) || !closeEnough();
      $(".address-picker-hint").textContent = valid(coordinate) || closeEnough() ? "Move the map to pin your entrance" : "Enter your address to find its location";
    }
    function cancelSearch() {
      clearTimeout(autoTimer); sequence++; controller?.abort(); searching = false;
      results.hidden = true; results.replaceChildren(); $("[data-find]").disabled = false;
    }
    function chooseCenter() {
      if (!active || positioning || !ready || !loading.hidden) return;
      const center = map.getCenter(), p = { latitude: center.lat, longitude: center.lng };
      const changed = !coordinate || Math.abs(p.latitude - coordinate.latitude) > 1e-10 || Math.abs(p.longitude - coordinate.longitude) > 1e-10;
      // A country overview is not a delivery pin. Keep an existing pin when zooming out.
      if (closeEnough() && valid(p) && changed) {
        cancelSearch(); coordinate = p; confirmed = true; options.onPin?.();
        status.textContent = "Pin adjusted. It will be saved with your address.";
      }
      updateHint();
    }
    async function showMap(initial, zoom = 17) {
      const version = ++generation;
      loading.hidden = false; loading.textContent = "Loading map…"; updateHint();
      try {
        await loadLibrary();
        if (!active || version !== generation) return;
        if (!map) {
          map = new maplibregl.Map({ container: canvas, style: "/cart/tracking-map-style.json?v=1", center: [initial.longitude, initial.latitude], zoom, minZoom: 3, maxZoom: 19, maxPitch: 0, renderWorldCopies: false, dragRotate: false, touchPitch: false, pitchWithRotate: false, attributionControl: { compact: true, customAttribution: '<a href="/cart/vendor/openfreemap/POSITRON-LICENSE.md" target="_blank" rel="noopener noreferrer">Positron</a>' } });
          map.touchZoomRotate.disableRotation();
          map.on("dragstart", cancelSearch);
          map.on("zoomstart", () => { if (!positioning && ready && loading.hidden) cancelSearch(); });
          map.on("moveend", chooseCenter);
          mapReady = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error("Map loading timed out")), 20000);
            map.once("load", () => { clearTimeout(timeout); ready = true; resolve(); });
          });
        }
        await mapReady;
        if (!active || version !== generation) return;
        positioning = true; map.stop(); map.resize(); map.jumpTo({ center: [initial.longitude, initial.latitude], zoom }); positioning = false;
        loading.hidden = true; updateHint();
      } catch (_) {
        if (version !== generation || !active) return;
        map?.remove(); map = null; mapReady = null; ready = false;
        loading.textContent = "The map is unavailable. You can still save your address.";
        const retry = document.createElement("button"); retry.type = "button"; retry.textContent = "Retry map";
        retry.addEventListener("click", () => void showMap(coordinate || overview, coordinate ? 17 : 4));
        loading.append(retry); updateHint();
      }
    }
    function choose(place, preserveAddress = false) {
      cancelSearch(); coordinate = { ...place.coordinate }; confirmed = false;
      options.onPlace(place, { preserveAddress }); options.onPin?.();
      status.textContent = "Suggested location. Move the map if the entrance is elsewhere.";
      void showMap(coordinate);
    }
    const textFor = source => source === "fields" ? options.addressText() : query.value.trim() || options.addressText();
    async function search({ source = lookupSource } = {}) {
      const text = textFor(source);
      cancelSearch();
      if (text.length < 3 || text.length > 500) {
        status.textContent = "Enter a street and city, Plus Code, or coordinates.";
        return;
      }
      const request = sequence;
      controller = new AbortController(); const requestController = controller;
      const timer = setTimeout(() => requestController.abort(), 12000);
      searching = true;
      $("[data-find]").disabled = true; status.textContent = "Locating your address…";
      try {
        const response = await fetch("/cart/api/address-search.php", { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json", "X-Ezkart-CSRF": options.csrf() }, body: JSON.stringify({ address: text }), signal: requestController.signal });
        const data = await response.json();
        if (request !== sequence || !active) return;
        if (!response.ok || !data.ok || !Array.isArray(data.results)) throw new Error(response.status === 401 ? "Please sign in again to search for an address." : data.error || "Address search is unavailable. You can still save your address.");
        const places = data.results.filter(place => valid(place.coordinate));
        if (places.length) {
          // Start at the best match, without making customers choose from a list first.
          choose(places[0], source === "fields");
          if (places.length > 1) {
            for (const place of places) {
              const row = document.createElement("li"), button = document.createElement("button"), name = document.createElement("strong"), detail = document.createElement("span");
              button.type = "button"; name.textContent = place.name; detail.textContent = place.address;
              button.append(name, detail); button.addEventListener("click", () => choose(place, source === "fields")); row.append(button); results.append(row);
            }
            results.hidden = false;
          }
        } else status.textContent = "No match found. Try a nearby landmark, move the map, or save without a pin.";
      } catch (error) {
        if (request === sequence && active) status.textContent = error.name === "AbortError" ? "The search timed out. You can still save your address or try again." : error.message;
      } finally { clearTimeout(timer); if (request === sequence) { searching = false; $("[data-find]").disabled = false; } }
    }
    function schedule(source) {
      cancelSearch(); lookupSource = source; confirmed = false; coordinate = null; updateHint();
      status.textContent = textFor(source).length >= 8 ? "Finding the location after you finish entering the address…" : "Enter your address and we’ll find it on the map.";
      // One lookup after typing/paste/autofill settles, never on every keystroke.
      autoTimer = setTimeout(() => { if (active && textFor(source).length >= 8) void search({ source }); }, 1100);
    }
    $("[data-find]").addEventListener("click", () => { lookupSource = query.value.trim() ? "query" : "fields"; void search(); });
    query.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); lookupSource = "query"; void search(); } });
    query.addEventListener("input", () => schedule("query"));
    container.querySelectorAll("[data-zoom]").forEach(button => button.addEventListener("click", () => { if (ready) map.setZoom(Math.max(3, Math.min(19, map.getZoom() + Number(button.dataset.zoom)))); }));
    return {
      reset(address) {
        generation++; cancelSearch(); active = true; coordinate = valid(address.coordinate) ? { ...address.coordinate } : null; confirmed = !!coordinate;
        lookupSource = "fields"; query.value = "";
        status.textContent = coordinate ? "Your saved delivery pin. Move the map to adjust the entrance." : "Enter your address and we’ll find it on the map.";
        void showMap(coordinate || overview, coordinate ? 17 : 4);
        if (!coordinate && options.addressText().length >= 8) schedule("fields");
      },
      addressChanged({ invalidate = true } = {}) {
        // Adding a missing postcode/city should not discard an already located entrance.
        if (coordinate && !invalidate) return;
        schedule("fields");
      },
      close() { active = false; generation++; cancelSearch(); map?.stop(); },
      read() {
        if (map?.isMoving()) map.stop();
        const pending = searching; cancelSearch();
        if (pending) status.textContent = "You can save your address without a map pin.";
        return { coordinate, confirmed };
      },
    };
  };
})();
