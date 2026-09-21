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
  let timer, selectedPlace = null;
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
  const destinations = document.getElementById("sandbox-destination");
  const detail = document.getElementById("sandbox-destination-detail");
  let addresses = [], reading = false, initialized = false;
  function useDestination() {
    const address = addresses.find(a => a.id === destinations.value);
    selectedPlace = address ? { id: address.preview_id, coordinate: address.coordinate, name: address.label } : null;
    detail.textContent = address ? `${address.address}, ${address.location} ${address.postalCode}` : "Using the sample delivery address.";
    show(current);
  }
  destinations.addEventListener("change", () => { pause(); useDestination(); });
  document.getElementById("sandbox-address-focus").addEventListener("click", () => { pause(); show("transit"); window.ezkartDeliveryMap.focusDestination(); });
  async function loadDestinations() {
    if (reading) return;
    reading = true;
    try {
      const response = await fetch("/cart/admin/customer-addresses.php", { cache: "no-store", signal: AbortSignal.timeout(15000) });
      const data = await response.json();
      if (!response.ok || !data.ok || !data.authenticated) return;
      const selection = initialized ? destinations.value : data.book.default_id;
      addresses = data.book.addresses.filter(a => a.preview_id && window.ezkartDeliveryMap.validPoint(a.coordinate));
      destinations.replaceChildren(new Option("Sample delivery address", ""), ...addresses.map(a => new Option(a.label + (a.id === data.book.default_id ? " · Default" : ""), a.id)));
      destinations.value = addresses.some(a => a.id === selection) ? selection : "";
      initialized = true; useDestination();
    } catch (_) { detail.textContent = "Saved addresses are unavailable. You can still preview the sample delivery."; }
    finally { reading = false; }
  }
  window.addEventListener("focus", () => void loadDestinations());
  show(current); void loadDestinations();
})();
