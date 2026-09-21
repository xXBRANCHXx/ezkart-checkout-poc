(() => {
  "use strict";
  window.ezkartAddressBook = function (container, options = {}) {
    const endpoint = "/cart/admin/customer-addresses.php";
    let book = { addresses: [], default_id: "", revision: 0 }, csrf = "", email = "", selected = "", authenticated = false, busy = false, editing = null, draft = {}, popup, deadline = 0, pollTimer, checking = false, starting = false;
    container.classList.add("address-book");
    container.innerHTML = '<div class="address-book-heading"><strong>Saved addresses</strong><span class="address-book-count"></span></div><p class="address-book-account"></p><div class="address-book-guest" hidden><button type="button" class="address-book-signin">Sign in with Google</button><span>Save up to 3 addresses for next time.</span></div><div class="address-book-member" hidden><div class="address-book-picker"><label><span class="address-book-sr">Saved address</span><select aria-label="Saved address"></select></label><button type="button" data-book-action="use">Use address</button></div><p class="address-book-summary"></p><div class="address-book-actions"><button type="button" data-book-action="default">Set as default</button><button type="button" data-book-action="edit">Edit</button><button type="button" data-book-action="delete">Remove</button><button type="button" data-book-action="add">Save current address</button></div></div><p class="address-book-status" role="status"></p>';
    const $ = selector => container.querySelector(selector);
    const status = $(".address-book-status"), picker = $("select");
    const dialog = document.createElement("dialog"); dialog.className = "address-book-dialog";
    dialog.setAttribute("aria-label", "Save delivery address");
    dialog.innerHTML = '<form class="address-book-form"><div class="address-book-dialog-heading"><h2>Save delivery address</h2><button type="button" data-close aria-label="Close address editor">×</button></div><p>Save up to 3 addresses for faster checkout.</p><div class="address-book-fields"><label class="wide">Address name<input name="label" placeholder="Home, office, or family" maxlength="40" required></label><label>Recipient name <small>Optional</small><input name="fullName" autocomplete="name" maxlength="100"></label><label>WhatsApp number <small>Optional</small><input name="phone" autocomplete="tel" inputmode="tel" maxlength="20"></label><label class="wide">Full address<textarea name="address" autocomplete="street-address" minlength="5" maxlength="300" required></textarea></label><label>District / city<input name="location" autocomplete="address-level2" minlength="2" maxlength="120" required></label><label>Postcode<input name="postalCode" autocomplete="postal-code" inputmode="numeric" pattern="[0-9]{5}" maxlength="5" required></label><label class="wide">Courier note <small>Optional</small><input name="note" maxlength="120"></label></div><label class="address-book-default"><input type="checkbox" name="make_default"> Make this my default address</label><p class="address-book-error" role="alert"></p><div class="address-book-dialog-actions"><button type="button" data-close>Cancel</button><button type="submit">Save address</button></div></form>';
    document.body.append(dialog);
    const form = dialog.querySelector("form"), error = dialog.querySelector(".address-book-error");
    const chosen = () => book.addresses.find(address => address.id === selected);
    const fields = ["label", "fullName", "phone", "address", "location", "postalCode", "note"];
    function render() {
      $(".address-book-count").textContent = authenticated ? `${book.addresses.length} / 3` : "";
      $(".address-book-account").textContent = email ? `Saved to ${email}` : "";
      $(".address-book-guest").hidden = authenticated;
      $(".address-book-member").hidden = !authenticated;
      if (!book.addresses.some(address => address.id === selected)) selected = book.default_id || book.addresses[0]?.id || "";
      picker.replaceChildren(...book.addresses.map(address => { const option = document.createElement("option"); option.value = address.id; option.textContent = address.label + (address.id === book.default_id ? " · Default" : ""); return option; }));
      picker.value = selected;
      $(".address-book-picker").hidden = !book.addresses.length;
      const address = chosen();
      $(".address-book-summary").textContent = address ? `${address.address}, ${address.location} ${address.postalCode}` : "No saved addresses yet.";
      for (const action of ["default", "edit", "delete"]) $(`[data-book-action="${action}"]`).hidden = !address;
      $('[data-book-action="default"]').disabled = busy || !address || address.id === book.default_id;
      $('[data-book-action="default"]').textContent = address?.id === book.default_id ? "Default address" : "Set as default";
      $('[data-book-action="add"]').disabled = busy || book.addresses.length >= 3;
      for (const action of ["use", "edit", "delete"]) $(`[data-book-action="${action}"]`).disabled = busy;
    }
    async function read(checkExisting = false, applyDefault = false) {
      try {
        const response = await fetch(endpoint, { cache: "no-store", signal: AbortSignal.timeout(15000) });
        const data = await response.json();
        if (data.csrf) csrf = data.csrf;
        if (response.status === 401) { authenticated = false; email = ""; book = { addresses: [], default_id: "", revision: 0 }; render(); }
        if (!response.ok || !data.ok) throw new Error(data.error || "Saved addresses are temporarily unavailable.");
        csrf = data.csrf; authenticated = data.authenticated; email = data.email || "";
        if (!authenticated && checkExisting && data.check_existing) {
          const bridge = await fetch("/cart/admin/customer-session.php", { method: "POST", headers: { "X-Ezkart-CSRF": csrf }, signal: AbortSignal.timeout(15000) });
          if (bridge.ok && (await bridge.json()).authenticated) return read(false, applyDefault);
        }
        book = authenticated ? data.book : { addresses: [], default_id: "", revision: 0 }; render();
        options.onAccount?.({ authenticated, email });
        if (authenticated && applyDefault) {
          const address = book.addresses.find(address => address.id === book.default_id);
          if (address) options.onUse?.(address, { automatic: true });
        }
        return authenticated;
      } catch (failure) { if (csrf) render(); status.textContent = failure.message; return false; }
    }
    function openEditor(address = null, initial = null) {
      if (!authenticated) { status.textContent = "Sign in with Google to save addresses."; return; }
      if (!address && book.addresses.length >= 3) { status.textContent = "You have 3 saved addresses. Edit or remove one to add another."; return; }
      editing = address?.id || null; draft = { ...(address || initial || options.current?.() || {}) };
      for (const field of fields) form.elements[field].value = draft[field] || (field === "label" ? "Home" : "");
      form.elements.make_default.checked = !book.addresses.length || editing === book.default_id;
      error.textContent = ""; dialog.showModal();
    }
    async function mutate(payload) {
      if (busy) return false;
      busy = true; render(); form.querySelector('[type="submit"]').disabled = true;
      try {
        const response = await fetch(endpoint, { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json", "X-Ezkart-CSRF": csrf }, body: JSON.stringify({ ...payload, revision: book.revision }), signal: AbortSignal.timeout(15000) });
        const data = await response.json();
        if (!response.ok || !data.ok) { if ([401, 409].includes(response.status)) await read(); throw new Error(data.error || "The address could not be saved."); }
        const oldIds = book.addresses.map(address => address.id);
        book = data.book; csrf = data.csrf; email = data.email;
        if (["save", "pin"].includes(payload.action)) selected = payload.id || book.addresses.find(address => !oldIds.includes(address.id))?.id || book.default_id;
        render(); status.textContent = payload.action === "delete" ? "Address removed." : payload.action === "default" ? "Default address updated." : "Address saved to your account.";
        return true;
      } catch (failure) { status.textContent = failure.message; error.textContent = failure.message; return false; }
      finally { busy = false; render(); form.querySelector('[type="submit"]').disabled = false; }
    }
    form.addEventListener("submit", async event => {
      event.preventDefault();
      const address = Object.fromEntries(fields.map(field => [field, form.elements[field].value.trim()]));
      address.coordinate = ["address", "location", "postalCode"].every(key => !draft[key] || address[key] === draft[key]) ? draft.coordinate || null : null;
      if (await mutate({ action: "save", id: editing || undefined, address, make_default: form.elements.make_default.checked })) { dialog.close(); options.onSaved?.(chosen()); }
    });
    dialog.querySelectorAll("[data-close]").forEach(button => button.addEventListener("click", () => dialog.close()));
    picker.addEventListener("change", () => { selected = picker.value; render(); });
    container.addEventListener("click", event => {
      const action = event.target.closest("[data-book-action]")?.dataset.bookAction;
      if (!action || busy) return;
      if (action === "add") openEditor();
      else if (action === "edit") openEditor(chosen());
      else if (action === "use") options.onUse?.(chosen(), { automatic: false });
      else void mutate({ action, id: selected });
    });
    async function pollLogin() {
      if (checking || !deadline) return;
      checking = true; clearTimeout(pollTimer);
      try {
        const response = await fetch("/cart/api/customer-session.php", { cache: "no-store", signal: AbortSignal.timeout(12000) });
        const data = await response.json();
        if (response.ok && data.authenticated) { deadline = 0; status.textContent = ""; await read(false, true); return; }
        if (data.error) { deadline = 0; status.textContent = data.error; }
      } catch (_) {} finally {
        checking = false;
        if (deadline > Date.now()) pollTimer = setTimeout(pollLogin, 1500);
        else if (deadline) { deadline = 0; status.textContent = "Sign-in expired. Please try again."; }
      }
    }
    $(".address-book-signin").addEventListener("click", async () => {
      if (starting) return;
      try { if (deadline && popup && !popup.closed) { popup.focus(); return; } } catch (_) {}
      popup = window.open("about:blank", "", "popup=yes,width=480,height=680");
      const next = location.pathname + location.search;
      const body = new URLSearchParams({ action: "google", csrf_token: csrf, next });
      if (!popup) {
        const redirect = document.createElement("form"); redirect.method = "POST"; redirect.action = "/cart/login.php";
        for (const [name, value] of body) { const input = document.createElement("input"); input.type = "hidden"; input.name = name; input.value = value; redirect.append(input); }
        document.body.append(redirect); redirect.submit(); return;
      }
      popup.opener = null; body.set("popup", "1"); starting = true; $(".address-book-signin").disabled = true;
      try {
        const response = await fetch("/cart/login.php", { method: "POST", body, cache: "no-store", signal: AbortSignal.timeout(15000) });
        const data = await response.json();
        if (!response.ok || !data.ok || new URL(data.url).protocol !== "https:") throw new Error(data.error || "Sign-in could not start.");
        popup.location.replace(data.url); deadline = Date.now() + 600000; status.textContent = "Finish signing in with Google to use your addresses."; void pollLogin();
      } catch (failure) { try { popup.close(); } catch (_) {} status.textContent = failure.message; } finally { starting = false; $(".address-book-signin").disabled = false; }
    });
    window.addEventListener("focus", () => { if (deadline) void pollLogin(); });
    status.textContent = "Loading saved addresses…";
    void read(true, true).then(() => { if (status.textContent === "Loading saved addresses…") status.textContent = ""; });
    return {
      save: (initial, id) => {
        const existing = id ? book.addresses.find(address => address.id === id) : null;
        if (id && !existing) { status.textContent = "This saved address was removed. Select an address again."; return; }
        openEditor(existing, initial);
      },
      updatePin: async (id, coordinate, original) => {
        const address = book.addresses.find(address => address.id === id);
        if (!address) throw new Error("This saved address was removed. Select an address again.");
        if (["address", "location", "postalCode"].some(key => address[key] !== original[key])) throw new Error("This address changed. Cancel and select it again before placing its pin.");
        if (!await mutate({ action: "pin", id, coordinate })) throw new Error(status.textContent || "The pin could not be saved. Please try again.");
        return chosen();
      },
      reload: () => read(false, false),
    };
  };
})();
