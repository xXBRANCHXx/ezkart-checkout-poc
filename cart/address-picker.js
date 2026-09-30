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
    container.innerHTML = '<div class="address-picker-heading"><strong>Delivery location</strong><span>Optional</span></div><p class="address-picker-status" role="status">Enter your address and we’ll find it on the map.</p><div class="address-picker-frame"><div class="address-picker-map" role="region" aria-label="Position your delivery entrance"></div><div class="address-picker-loading" role="status">Loading map…</div><div class="address-picker-hint">Enter your address to find its location</div><span class="address-picker-pin" aria-hidden="true" hidden>' + pin + '</span><div class="address-picker-zoom"><button type="button" data-zoom="1" aria-label="Zoom in">+</button><button type="button" data-zoom="-1" aria-label="Zoom out">−</button></div></div><ul class="address-picker-results" hidden></ul><p class="address-picker-credit">Address search: Ezkart · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap</a></p>';
    const $ = selector => container.querySelector(selector);
    const status = $(".address-picker-status"), results = $("ul"), canvas = $(".address-picker-map"), loading = $(".address-picker-loading");
    $(".address-picker-frame").before(results);
    const overview = { latitude: -2.5, longitude: 118 };
    const pinZoom = 19;
    let map, mapReady, ready = false, active = false, coordinate = null, confirmed = false, positioning = false, controller, autoTimer, sequence = 0, generation = 0, searching = false, addressKey = "", manualMove = false;
    const closeEnough = () => ready && loading.hidden && map.getZoom() >= 16;
    function updateHint() {
      $(".address-picker-pin").hidden = !valid(coordinate) || !closeEnough();
      $(".address-picker-hint").textContent = valid(coordinate) || closeEnough() ? "Move the map to pin your entrance" : "Enter your address to find its location";
    }
    function cancelSearch() {
      clearTimeout(autoTimer); sequence++; controller?.abort(); searching = false;
      results.hidden = true; results.replaceChildren();
    }
    function chooseCenter() {
      if (!active || positioning || !ready || !loading.hidden) return;
      const center = map.getCenter(), p = { latitude: center.lat, longitude: center.lng };
      const changed = !coordinate || Math.abs(p.latitude - coordinate.latitude) > 1e-10 || Math.abs(p.longitude - coordinate.longitude) > 1e-10;
      // A country overview is not a delivery pin. Keep an existing pin when zooming out.
      if (manualMove && closeEnough() && valid(p) && changed) {
        cancelSearch(); coordinate = p; confirmed = true; options.onPin?.();
        status.textContent = "Pin adjusted. It will be saved with your address.";
      }
      manualMove = false; updateHint();
    }
    async function showMap(initial, zoom = pinZoom) {
      const version = ++generation;
      loading.hidden = false; loading.textContent = "Loading map…"; updateHint();
      try {
        await loadLibrary();
        if (!active || version !== generation) return;
        if (!map) {
          map = new maplibregl.Map({ container: canvas, style: "/cart/tracking-map-style.json?v=1", center: [initial.longitude, initial.latitude], zoom, minZoom: 3, maxZoom: 19, maxPitch: 0, renderWorldCopies: false, dragRotate: false, touchPitch: false, pitchWithRotate: false, attributionControl: { compact: true, customAttribution: '<a href="/cart/vendor/openfreemap/POSITRON-LICENSE.md" target="_blank" rel="noopener noreferrer">Positron</a>' } });
          map.touchZoomRotate.disableRotation();
          map.on("dragstart", () => { manualMove = true; cancelSearch(); });
          map.on("zoomstart", () => { if (!positioning && ready && loading.hidden) cancelSearch(); });
          map.on("movestart", event => { if (/^Arrow/.test(event.originalEvent?.key || "")) { manualMove = true; cancelSearch(); } });
          map.on("moveend", chooseCenter);
          mapReady = new Promise((resolve, reject) => {
            let timeout;
            const cleanup = () => { clearTimeout(timeout); document.removeEventListener("visibilitychange", visible); };
            const visible = () => { if (!document.hidden) { document.removeEventListener("visibilitychange", visible); timeout = setTimeout(expire, 20000); } };
            const expire = () => {
              // Chrome pauses map rendering in a background tab. Give it time to
              // render after returning instead of rejecting healthy map data.
              if (document.hidden) { document.addEventListener("visibilitychange", visible); return; }
              cleanup(); reject(new Error("Map loading timed out"));
            };
            const failed = event => { if (!ready && !event.tile) { cleanup(); reject(new Error("Map data is unavailable")); } };
            timeout = setTimeout(expire, 20000);
            map.on("error", failed);
            map.once("load", () => { cleanup(); map.off("error", failed); ready = true; resolve(); });
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
        retry.addEventListener("click", () => void showMap(coordinate || overview, coordinate ? pinZoom : 4));
        loading.append(retry); updateHint();
      }
    }
    const precise = place => ["supplied", "address", "place"].includes(place.precision) || place.resolved === true;
    function credit(place) {
      const node = $(".address-picker-credit");
      node.innerHTML = place.provider !== "photon" ? 'Address search: Ezkart · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap</a>' : 'Address search: <a href="https://photon.komoot.io/" target="_blank" rel="noopener noreferrer">Photon</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap</a>';
    }
    function choose(place) {
      cancelSearch(); credit(place);
      if (!precise(place)) {
        coordinate = null; confirmed = false;
        status.textContent = "Only an approximate area was found. No delivery pin selected. Add the building address above or position its entrance.";
        void showMap(place.coordinate);
        return;
      }
      coordinate = { ...place.coordinate }; confirmed = false;
      options.onPlace(place, { preserveAddress: true }); addressKey = keyFor(); options.onPin?.();
      status.textContent = "Suggested location. Move the map if the entrance is elsewhere.";
      void showMap(coordinate);
    }
    const textFor = () => options.addressText().trim();
    const keyFor = () => JSON.stringify(options.addressFields?.() || textFor());
    async function search() {
      const text = textFor();
      cancelSearch();
      if (text.length < 3 || text.length > 500) {
        status.textContent = "Enter a street and city, Plus Code, or coordinates.";
        return;
      }
      const request = sequence;
      controller = new AbortController(); const requestController = controller;
      const timer = setTimeout(() => requestController.abort(), 12000);
      searching = true;
      status.textContent = "Locating your address…";
      try {
        const response = await fetch(options.endpoint || "/cart/api/address-search.php", { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json", "X-Ezkart-CSRF": options.csrf() }, body: JSON.stringify({ address: text, ...(options.addressFields ? { components: options.addressFields() } : {}) }), signal: requestController.signal });
        const data = await response.json();
        if (request !== sequence || !active) return;
        if (!response.ok || !data.ok || !Array.isArray(data.results)) throw new Error(response.status === 401 ? "Please sign in again to search for an address." : data.error || "Address search is unavailable. You can still save your address.");
        const places = data.results.filter(place => valid(place.coordinate));
        if (places.length) {
          const automatic = places.filter(place => place.auto_select === true || (place.auto_select === undefined && place.resolved === true && places.length === 1));
          if (automatic.length === 1 && precise(automatic[0])) choose(automatic[0]);
          else {
            credit(places[0]);
            status.textContent = places.some(precise) ? "Choose the matching building below. Several results or an incomplete match need your selection." : "Only approximate locations were found. No delivery pin selected. Add a building name or a more specific address above.";
            void showMap(places[0].coordinate);
          }
          if (places.length > 1 || automatic.length !== 1) {
            for (const place of places) {
              const row = document.createElement("li"), button = document.createElement("button"), name = document.createElement("strong"), detail = document.createElement("span");
              button.type = "button"; name.textContent = place.name; detail.textContent = [place.kind, place.address].filter(Boolean).join(" · ");
              button.append(name, detail); button.addEventListener("click", () => choose(place)); row.append(button); results.append(row);
            }
            results.hidden = false;
          }
        } else status.textContent = "No match found. Try a nearby landmark, move the map, or save without a pin.";
      } catch (error) {
        if (request === sequence && active) status.textContent = error.name === "AbortError" ? "The search timed out. You can still save your address or try again." : error.message;
      } finally { clearTimeout(timer); if (request === sequence) { searching = false; } }
    }
    function schedule() {
      cancelSearch(); addressKey = keyFor(); confirmed = false; coordinate = null; updateHint();
      status.textContent = textFor().length >= 3 ? "Finding the location after you finish entering the address…" : "Enter your address and we’ll find it on the map.";
      // One lookup after typing/paste/autofill settles, never on every keystroke.
      autoTimer = setTimeout(() => { if (active && textFor().length >= 3) void search(); }, 1100);
    }
    container.querySelectorAll("[data-zoom]").forEach(button => button.addEventListener("click", () => { if (ready) map.setZoom(Math.max(3, Math.min(19, map.getZoom() + Number(button.dataset.zoom)))); }));
    return {
      reset(address) {
        generation++; cancelSearch(); active = true; manualMove = false; coordinate = valid(address.coordinate) ? { ...address.coordinate } : null; confirmed = !!coordinate;
        addressKey = keyFor();
        status.textContent = coordinate ? "Your saved delivery pin. Move the map to adjust the entrance." : "Enter your address and we’ll find it on the map.";
        void showMap(coordinate || overview, coordinate ? pinZoom : 4);
        if (!coordinate && textFor().length >= 3) schedule();
      },
      addressChanged({ invalidate = true } = {}) {
        if (!active || keyFor() === addressKey) return;
        addressKey = keyFor();
        // Adding a missing postcode/city should not discard an already located entrance.
        if (coordinate && !invalidate) return;
        schedule();
      },
      close() { active = false; generation++; cancelSearch(); map?.stop(); },
      confirm() {
        if (!active || !closeEnough() || !valid(coordinate)) return false;
        if (map.isMoving()) map.stop();
        confirmed = true; options.onPin?.(); status.textContent = "Entrance confirmed. This pin will be saved with your address."; return true;
      },
      clear() {
        cancelSearch(); coordinate = null; confirmed = false;
        status.textContent = "No pin selected. Find the address or move the map to add one."; updateHint();
      },
      read() {
        if (map?.isMoving()) map.stop();
        const pending = searching; cancelSearch();
        if (pending) status.textContent = "You can save your address without a map pin.";
        return { coordinate, confirmed };
      },
    };
  };
})();
