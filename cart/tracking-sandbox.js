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
  let timer;
  window.ezkartTrackingSandbox = { read: () => structuredClone(scenarios[current].data) };
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
  show(current);
})();
