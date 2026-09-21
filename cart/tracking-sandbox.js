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
  let timer, selectedPlace = null, searchSequence = 0, searchController;
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
  function choose(place) {
    selectedPlace = place;
    pause(); show("transit");
    results.hidden = true; results.replaceChildren();
    chosen.hidden = false;
    document.getElementById("sandbox-address-name").textContent = place.name;
    document.getElementById("sandbox-address-detail").textContent = place.address;
    status.textContent = place.kind + " · Check the pin; address matches can be approximate.";
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
      status.textContent = places.length ? "Choose the address you want to test." : "No match found. Try the street and city, or a nearby landmark.";
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
    searchSequence++; searchController?.abort(); results.hidden = true; results.replaceChildren();
    searchButton.disabled = false; form.removeAttribute("aria-busy");
    status.textContent = "Search, then choose a match to see its delivery pin.";
  });
  document.getElementById("sandbox-address-focus").addEventListener("click", () => { pause(); show("transit"); window.ezkartDeliveryMap.focusDestination(); });
  document.getElementById("sandbox-address-reset").addEventListener("click", () => {
    searchSequence++; searchController?.abort(); selectedPlace = null; chosen.hidden = true; results.hidden = true; results.replaceChildren(); input.value = "";
    searchButton.disabled = false; form.removeAttribute("aria-busy"); status.textContent = "Using the sample delivery address.";
    pause(); show(current); document.getElementById("map-recenter").click();
  });
  show(current);
})();
