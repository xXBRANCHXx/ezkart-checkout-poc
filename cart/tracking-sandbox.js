(() => {
  "use strict";
  const data = document.getElementById("tracking-sandbox-data");
  if (!data) return;
  const scenarios = JSON.parse(data.textContent);
  const select = document.getElementById("sandbox-stage");
  const play = document.getElementById("sandbox-play");
  const next = document.getElementById("sandbox-next");
  const progress = document.getElementById("sandbox-progress");
  const sequence = ["pending", "paid", "processing", "pickup", "picked", "transit", "delivery", "delivered"];
  const requested = new URLSearchParams(location.search).get("stage");
  let current = Object.hasOwn(scenarios, requested) ? requested : "processing";
  let timer, selectedPlace = null, searchSequence = 0, searchController, pendingAddress = null;
  window.ezkartTrackingSandbox = {
    place: () => selectedPlace,
    read: () => {
      const result = structuredClone(scenarios[current].data);
      if (selectedPlace && current !== "no-map") {
        result.tracking.locations.destination = { ...selectedPlace.coordinate };
        if (result.tracking.stage === "delivered") result.tracking.latest_location = { ...result.tracking.latest_location, ...selectedPlace.coordinate };
      }
      return result;
    },
  };
  function pause() {
    clearInterval(timer);
    timer = null;
    play.textContent = "Run walkthrough";
    play.setAttribute("aria-pressed", "false");
  }
  function show(stage) {
    current = stage;
    select.value = stage;
    const index = sequence.indexOf(stage);
    next.disabled = index === sequence.length - 1;
    progress.textContent = (index >= 0 ? `Step ${index + 1} of ${sequence.length}: ` : "Scenario: ") + scenarios[stage].label + (timer ? " · Advances every 5 seconds." : " · Paused for inspection.");
    const url = new URL(location.href);
    url.searchParams.set("stage", stage);
    history.replaceState(null, "", url);
    window.dispatchEvent(new Event("ezkart:sandbox-update"));
  }
  function advance() {
    const index = sequence.indexOf(current);
    const stage = sequence[Math.min(sequence.length - 1, index + 1)];
    if (stage === "delivered") pause();
    show(stage);
  }
  select.addEventListener("change", () => { pause(); show(select.value); });
  next.addEventListener("click", () => { pause(); advance(); });
  document.getElementById("sandbox-reset").addEventListener("click", () => { pause(); show("pending"); });
  play.addEventListener("click", () => {
    if (timer) { pause(); show(current); return; }
    timer = setInterval(advance, 5000);
    play.textContent = "Pause walkthrough";
    play.setAttribute("aria-pressed", "true");
    show("pending");
  });
  document.addEventListener("visibilitychange", () => { if (document.hidden) { pause(); show(current); } });
  const form = document.getElementById("sandbox-address-form");
  const input = document.getElementById("sandbox-address-input");
  const status = document.getElementById("sandbox-address-status");
  const results = document.getElementById("sandbox-address-results");
  const chosen = document.getElementById("sandbox-address-selected");
  const searchButton = form.querySelector("button");
  function savedPlace(address, coordinate = address.coordinate, id = address.preview_id) {
    return { id, coordinate, name: address.label, address: `${address.address}, ${address.location} ${address.postalCode}`, address_line: address.address, location: address.location, postalCode: address.postalCode, kind: "Saved address", savedAddress: address };
  }
  function renderPlace() {
    chosen.hidden = !selectedPlace;
    if (!selectedPlace) return;
    document.getElementById("sandbox-address-name").textContent = selectedPlace.name;
    document.getElementById("sandbox-address-detail").textContent = selectedPlace.address;
    document.getElementById("sandbox-address-save").textContent = selectedPlace.savedAddress ? "Edit address" : "Save this address";
  }
  function choose(place) {
    if (pendingAddress) { place = { ...place, ...savedPlace(pendingAddress, place.coordinate, place.id) }; pendingAddress = null; }
    selectedPlace = place;
    pause(); show("transit");
    results.hidden = true; results.replaceChildren();
    renderPlace();
    status.textContent = place.resolved ? place.kind + " · Delivery pin placed on the map." : place.kind + " · Check the pin; address matches can be approximate.";
    window.ezkartDeliveryMap.focusDestination();
  }
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const query = input.value.trim();
    if (query.length < 3) return;
    const sequence = ++searchSequence;
    searchController?.abort(); const controller = new AbortController(); searchController = controller;
    const timeout = setTimeout(() => controller.abort(), 12000);
    searchButton.disabled = true; form.setAttribute("aria-busy", "true");
    status.textContent = "Finding matching addresses…";
    results.hidden = true; results.replaceChildren();
    try {
      const response = await fetch("api/tracking-address.php", { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json", "X-Ezkart-CSRF": form.dataset.csrf }, body: JSON.stringify({ address: query }), signal: controller.signal });
      const data = await response.json();
      if (sequence !== searchSequence) return;
      if (!response.ok || !data.ok || !Array.isArray(data.results)) throw new Error(response.status === 401 ? "Please reload and sign in to search for an address." : data.error || "Address search is temporarily unavailable. Please try again.");
      const places = data.results.filter(place => window.ezkartDeliveryMap.validPoint(place.coordinate));
      if (places.length === 1 && places[0].resolved) { choose(places[0]); return; }
      status.textContent = places.length ? "Choose the address you want to test." : "No match found. Choose on map to place the pin yourself, or search a nearby landmark.";
      for (const place of places) {
        const row = document.createElement("li"), button = document.createElement("button"), name = document.createElement("strong"), detail = document.createElement("span"), kind = document.createElement("small");
        button.type = "button"; name.textContent = place.name; detail.textContent = place.address; kind.textContent = place.kind;
        button.append(name, detail, kind); button.addEventListener("click", () => choose(place)); row.append(button); results.append(row);
      }
      results.hidden = !places.length;
    } catch (error) {
      if (sequence === searchSequence) status.textContent = error.name === "AbortError" ? "The search timed out. Please try again." : error.message;
    } finally {
      clearTimeout(timeout);
      if (sequence === searchSequence) { searchButton.disabled = false; form.removeAttribute("aria-busy"); }
    }
  });
  input.addEventListener("input", () => {
    pendingAddress = null;
    searchSequence++; searchController?.abort(); results.hidden = true; results.replaceChildren();
    searchButton.disabled = false; form.removeAttribute("aria-busy");
    status.textContent = "Search, then choose a match to see its delivery pin.";
  });
  document.getElementById("sandbox-address-focus").addEventListener("click", () => { pause(); show("transit"); window.ezkartDeliveryMap.focusDestination(); });
  document.getElementById("sandbox-address-reset").addEventListener("click", () => {
    searchSequence++; searchController?.abort(); selectedPlace = null; pendingAddress = null; chosen.hidden = true; results.hidden = true; results.replaceChildren(); input.value = "";
    searchButton.disabled = false; form.removeAttribute("aria-busy"); status.textContent = "Using the sample delivery address.";
    pause(); show(current); document.getElementById("map-recenter").click();
  });
  const savedAddresses = window.ezkartAddressBook(document.getElementById("sandbox-address-book"), {
    current: () => selectedPlace ? ({ address: selectedPlace.address_line || selectedPlace.name, location: selectedPlace.location || "", postalCode: selectedPlace.postalCode || "", coordinate: selectedPlace.coordinate }) : {},
    onUse: (address, { automatic }) => {
      if (!address || (automatic && (selectedPlace || input.value.trim() || timer))) return;
      searchSequence++; searchController?.abort(); pendingAddress = null;
      searchButton.disabled = false; form.removeAttribute("aria-busy");
      results.hidden = true; results.replaceChildren();
      if (address.coordinate && address.preview_id) {
        const place = savedPlace(address);
        if (automatic) {
          selectedPlace = place; show(current); renderPlace();
          status.textContent = "Using your default delivery address.";
        } else choose(place);
      } else if (!automatic) {
        const parts = [];
        for (const part of [address.address, address.location, address.postalCode]) {
          if (part && !parts.some(value => value.toLowerCase().includes(part.toLowerCase()))) parts.push(part);
        }
        input.value = parts.join(', ');
        pendingAddress = address;
        form.requestSubmit();
      }
    },
    onSaved: address => { if (address.coordinate && address.preview_id) { pendingAddress = null; choose(savedPlace(address)); } },
  });
  document.getElementById("sandbox-address-save").addEventListener("click", () => savedAddresses.save(undefined, selectedPlace?.savedAddress?.id));
  function editPin(place = null) {
    const address = input.value.trim();
    if (!place && (address.length < 3 || address.length > 500)) { input.reportValidity(); input.focus(); return; }
    const original = place?.savedAddress || (!place ? pendingAddress : null);
    searchSequence++; searchController?.abort(); searchButton.disabled = false; form.removeAttribute("aria-busy");
    pause(); show("transit");
    const controls = [...document.querySelectorAll(".sandbox-controls, .sandbox-address, #sandbox-address-book")];
    const started = window.ezkartDeliveryMap.beginPinEdit({
      coordinate: place?.coordinate,
      label: original ? "Save delivery pin" : "Use this pin",
      onClose: () => controls.forEach(element => { element.inert = false; }),
      onSave: async coordinate => {
        const response = await fetch("api/tracking-address.php", { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json", "X-Ezkart-CSRF": form.dataset.csrf }, body: JSON.stringify({ action: "pin", place: place?.id, address, coordinate }), signal: AbortSignal.timeout(15000) });
        const data = await response.json();
        if (!response.ok || !data.ok || !data.results?.[0]) throw new Error(data.error || "The pin could not be saved. Please try again.");
        let updated = { ...place, ...data.results[0] };
        if (original) {
          const saved = await savedAddresses.updatePin(original.id, coordinate, original);
          updated = savedPlace(saved);
        }
        pendingAddress = null;
        selectedPlace = updated; renderPlace();
        results.hidden = true; results.replaceChildren();
        show(current);
        status.textContent = original ? "Delivery pin saved to this address. It will be used at checkout." : "Delivery pin set. Save this address to use it again at checkout.";
      },
    });
    if (started) controls.forEach(element => { element.inert = true; });
    else status.textContent = "The map is temporarily unavailable. Please reload and try again.";
  }
  document.getElementById("sandbox-address-adjust").addEventListener("click", () => { if (selectedPlace) editPin(selectedPlace); });
  document.getElementById("sandbox-address-map").addEventListener("click", () => editPin());
  show(current);
})();
