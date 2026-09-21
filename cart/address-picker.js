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
    container.innerHTML = '<label class="address-picker-label">Find your address<input type="search" class="address-picker-query" placeholder="Street, city, Plus Code, or coordinates" maxlength="500" autocomplete="off"></label><div class="address-picker-actions"><button type="button" data-find>Find address</button><button type="button" data-place>Choose on map</button></div><p class="address-picker-status" role="status">Search for your address, then check the entrance on the map.</p><ul class="address-picker-results" hidden></ul><div class="address-picker-frame" hidden><div class="address-picker-map" role="region" aria-label="Position your delivery entrance"></div><div class="address-picker-loading" role="status">Loading map…</div><div class="address-picker-hint">Move the map to pin your entrance</div><span class="address-picker-pin" aria-hidden="true">' + pin + '</span><div class="address-picker-zoom"><button type="button" data-zoom="1" aria-label="Zoom in">+</button><button type="button" data-zoom="-1" aria-label="Zoom out">−</button></div></div><p class="address-picker-credit">Address search: <a href="https://photon.komoot.io/" target="_blank" rel="noopener noreferrer">Photon</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap</a></p>';
    const $ = selector => container.querySelector(selector);
    const query = $("input"), status = $(".address-picker-status"), results = $("ul"), frame = $(".address-picker-frame"), canvas = $(".address-picker-map");
    let map, mapReady, ready = false, active = false, coordinate = null, confirmed = false, positioning = false, controller, sequence = 0, generation = 0;
    function cancelSearch() {
      sequence++; controller?.abort(); results.hidden = true; results.replaceChildren(); $("[data-find]").disabled = false;
    }
    function chooseCenter() {
      if (!active || positioning || !ready || frame.hidden) return;
      const center = map.getCenter(), p = { latitude: center.lat, longitude: center.lng };
      if (!valid(p)) return;
      coordinate = p; confirmed = true;
      status.textContent = "Pin placed. Save the address when the entrance is correct.";
      options.onPin?.();
    }
    async function showMap(initial, zoom = 17) {
      const version = generation;
      frame.hidden = false; $(".address-picker-loading").hidden = false;
      try {
        await loadLibrary();
        if (!active || version !== generation) return;
        if (!map) {
          map = new maplibregl.Map({ container: canvas, style: "/cart/tracking-map-style.json?v=1", center: [initial.longitude, initial.latitude], zoom, minZoom: 3, maxZoom: 19, maxPitch: 0, renderWorldCopies: false, dragRotate: false, touchPitch: false, pitchWithRotate: false, attributionControl: { compact: true, customAttribution: '<a href="/cart/vendor/openfreemap/POSITRON-LICENSE.md" target="_blank" rel="noopener noreferrer">Positron</a>' } });
          map.touchZoomRotate.disableRotation();
          map.on("moveend", chooseCenter);
          mapReady = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error("Map loading timed out")), 20000);
            map.once("load", () => { clearTimeout(timeout); ready = true; resolve(); });
          });
        }
        await mapReady;
        if (!active || version !== generation || frame.hidden) return;
        positioning = true; map.stop(); map.resize(); map.jumpTo({ center: [initial.longitude, initial.latitude], zoom }); positioning = false;
        $(".address-picker-loading").hidden = true;
      } catch (_) {
        if (version !== generation || !active) return;
        map?.remove(); map = null; mapReady = null; ready = false;
        frame.hidden = true;
        status.textContent = "The map is unavailable. You can still edit the written address or try again.";
      }
    }
    function choose(place) {
      cancelSearch();
      coordinate = { ...place.coordinate }; confirmed = true;
      options.onPlace(place);
      options.onPin?.();
      status.textContent = "Check the pin, then move the map if your entrance is elsewhere.";
      void showMap(coordinate);
    }
    async function search() {
      const text = query.value.trim() || options.addressText();
      if (text.length < 3 || text.length > 500) { status.textContent = "Enter a street and city, Plus Code, or coordinates."; query.focus(); return; }
      cancelSearch(); const request = sequence;
      controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 12000);
      $("[data-find]").disabled = true; status.textContent = "Finding matching addresses…";
      try {
        const response = await fetch("/cart/api/address-search.php", { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json", "X-Ezkart-CSRF": options.csrf() }, body: JSON.stringify({ address: text }), signal: controller.signal });
        const data = await response.json();
        if (request !== sequence || !active) return;
        if (!response.ok || !data.ok || !Array.isArray(data.results)) throw new Error(response.status === 401 ? "Please sign in again to search for an address." : data.error || "Address search is unavailable. Choose on map or try again.");
        const places = data.results.filter(place => valid(place.coordinate));
        if (places.length === 1 && places[0].resolved) { choose(places[0]); return; }
        status.textContent = places.length ? "Choose your address below." : "No match found. Choose on map, or search a nearby landmark.";
        for (const place of places) {
          const row = document.createElement("li"), button = document.createElement("button"), name = document.createElement("strong"), detail = document.createElement("span");
          button.type = "button"; name.textContent = place.name; detail.textContent = place.address;
          button.append(name, detail); button.addEventListener("click", () => choose(place)); row.append(button); results.append(row);
        }
        results.hidden = !places.length;
      } catch (error) { if (request === sequence && active) status.textContent = error.name === "AbortError" ? "The search timed out. Choose on map or try again." : error.message; }
      finally { clearTimeout(timer); if (request === sequence) $("[data-find]").disabled = false; }
    }
    $("[data-find]").addEventListener("click", () => void search());
    query.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); void search(); } });
    query.addEventListener("input", () => { cancelSearch(); });
    $("[data-place]").addEventListener("click", () => {
      cancelSearch();
      const center = map?.getCenter();
      const initial = coordinate || (center ? { latitude: center.lat, longitude: center.lng } : { latitude: -2.5, longitude: 118 });
      if (!coordinate) status.textContent = "Zoom to your location and move the map to place the entrance.";
      void showMap(initial, coordinate ? 17 : center ? Math.max(5, map.getZoom()) : 4);
    });
    container.querySelectorAll("[data-zoom]").forEach(button => button.addEventListener("click", () => { if (map) map.setZoom(Math.max(3, Math.min(19, map.getZoom() + Number(button.dataset.zoom)))); }));
    return {
      reset(address) {
        generation++; cancelSearch(); active = true; coordinate = valid(address.coordinate) ? { ...address.coordinate } : null; confirmed = !!coordinate;
        query.value = ""; frame.hidden = !coordinate;
        status.textContent = coordinate ? "Your saved delivery pin. Move the map if the entrance has changed." : "Search for your address, then check the entrance on the map.";
        if (coordinate) void showMap(coordinate);
      },
      clear() { generation++; cancelSearch(); coordinate = null; confirmed = false; frame.hidden = true; status.textContent = "Address changed. Find it on the map again to add its pin."; },
      close() { active = false; generation++; cancelSearch(); map?.stop(); },
      read() { if (map?.isMoving()) map.stop(); return { coordinate, confirmed }; },
    };
  };
})();
