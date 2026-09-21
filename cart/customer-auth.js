(() => {
  "use strict";
  const gate = document.getElementById("tracking-auth");
  if (!gate) return;
  const dialog = document.getElementById("tracking-auth-dialog");
  const form = document.getElementById("tracking-signin");
  const button = form.querySelector("button");
  const message = document.getElementById("auth-message");
  let popup, timer, deadline = 0, checking = false, starting = false;
  const showMessage = (text) => { message.textContent = text; message.hidden = !text; };
  const showPrompt = () => {
    document.getElementById("auth-loading").hidden = true;
    if (!dialog.open) dialog.showModal();
  };
  dialog.addEventListener("cancel", (event) => event.preventDefault());
  async function readSession() {
    if (checking) return;
    checking = true;
    clearTimeout(timer);
    try {
      const response = await fetch("/cart/api/customer-session.php", { cache: "no-store", signal: AbortSignal.timeout(12000) });
      const data = await response.json();
      if (response.ok && data.authenticated && (!gate.dataset.version || data.version !== gate.dataset.version)) {
        location.replace(gate.dataset.next);
        return;
      }
      if (data.error) { showMessage(data.error); deadline = 0; }
    } catch (_) { /* Keep the sign-in action available during a temporary network failure. */ }
    finally {
      checking = false;
      if (deadline > Date.now()) timer = setTimeout(readSession, 1500);
      else if (deadline) { deadline = 0; showMessage("Sign-in expired. Please try again."); }
    }
  }
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (starting) return;
    // Open synchronously from the click so browsers allow the Google popup.
    try { if (deadline && popup && !popup.closed) { popup.focus(); return; } } catch (_) {}
    popup = window.open("about:blank", "", "popup=yes,width=480,height=680,left=" + Math.max(0, screenX + (outerWidth - 480) / 2) + ",top=" + Math.max(0, screenY + (outerHeight - 680) / 2));
    if (!popup) { HTMLFormElement.prototype.submit.call(form); return; }
    popup.opener = null;
    starting = true;
    button.disabled = true;
    showMessage("");
    try {
      const body = new URLSearchParams(new FormData(form));
      body.set("popup", "1");
      const response = await fetch(form.getAttribute("action"), { method: "POST", body, cache: "no-store", signal: AbortSignal.timeout(15000) });
      const data = await response.json();
      if (!response.ok || !data.ok || !data.url) throw new Error(data.error || "Google sign-in could not start. Please try again.");
      const url = new URL(data.url);
      if (url.protocol !== "https:") throw new Error("Google sign-in is unavailable. Please try again.");
      popup.location.replace(url.href);
      deadline = Date.now() + 10 * 60 * 1000;
      showMessage("Finish signing in with Google to load your order.");
      readSession();
    } catch (error) {
      try { popup.close(); } catch (_) {}
      showMessage(error.message || "Google sign-in could not start. Please try again.");
    } finally { starting = false; button.disabled = false; }
  });
  // Google can sever the opener through COOP. Verify the cookie on our server instead
  // of relying on popup.closed, postMessage, or any browser-supplied identity.
  window.addEventListener("focus", () => { if (deadline) readSession(); });
  window.addEventListener("pageshow", (event) => { if (event.persisted) location.reload(); });
  (async () => {
    if (gate.dataset.checkExisting === "true") {
      try {
        const response = await fetch("/cart/admin/customer-session.php", { method: "POST", headers: { "X-Ezkart-CSRF": form.elements.csrf_token.value }, cache: "no-store", signal: AbortSignal.timeout(15000) });
        const data = await response.json();
        if (response.ok && data.authenticated) { location.replace(gate.dataset.next); return; }
      } catch (_) {}
    }
    showPrompt();
  })();
})();
