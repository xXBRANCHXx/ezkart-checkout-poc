(() => {
  "use strict";

  function open({ product, selectedId, quantity, cart, onApply, onApplied }) {
    const { escape: esc, money, imageUrl } = window.EzkartStorefront;
    const choices = product.choices;
    let draft = choices.find(choice => choice.id === selectedId);
    if (!draft) return;
    const valueFor = (choice, name) => choice.options?.find(item => item.option === name)?.value;
    const names = (choices[0].options || []).map(item => item.option);
    const grouped = names.length > 0 && new Set(names).size === names.length && choices.every(choice =>
      choice.options?.length === names.length && names.every(name => typeof valueFor(choice, name) === "string" && valueFor(choice, name)));
    const groups = grouped ? names.map(name => ({ name, values: [...new Set(choices.map(choice => valueFor(choice, name)))] })) : [];
    const canChoose = choice => choice.available && Number(choice.stock) >= quantity + (cart[choice.id] || 0) - (choice.id === selectedId ? quantity : 0);
    const opener = document.activeElement;
    const searches = new Map();
    let pending = false;
    const dialog = document.createElement("dialog");
    dialog.className = "product-options-dialog";
    dialog.setAttribute("aria-labelledby", "product-options-title");
    dialog.innerHTML = `<header class="product-options-heading"><div><h2 id="product-options-title" tabindex="-1">Choose your options</h2><p>Review your selection before updating your cart.</p></div><button type="button" class="product-options-close" aria-label="Close options">×</button></header>
      <div class="product-options-body"><div class="product-options-product"><img alt=""><div><h3>${esc(product.name)}</h3><p data-option-selection></p></div></div>
      ${!grouped && choices.length > 8 ? '<label class="product-options-search">Find an option<input type="search" placeholder="Search options" autocomplete="off"></label>' : ""}
      <div class="product-options-fields"></div></div>
      <footer class="product-options-footer"><p class="product-options-status" role="status" aria-live="polite"></p><div class="product-options-total"><span><b>Item total</b><small data-option-unit></small></span><strong data-option-total></strong></div><div class="product-options-actions"><button type="button" class="product-options-cancel">Cancel</button><button type="button" class="primary-button" data-options-apply>Update item</button></div></footer>`;
    document.body.append(dialog);
    document.body.classList.add("product-options-open");
    const fields = dialog.querySelector(".product-options-fields");
    const status = dialog.querySelector(".product-options-status");
    const apply = dialog.querySelector("[data-options-apply]");
    const cancel = () => { if (!pending) dialog.close(); };
    const candidates = (groupIndex, value) => choices.filter(choice => groups.slice(0, groupIndex).every(group => valueFor(choice, group.name) === valueFor(draft, group.name)) && valueFor(choice, groups[groupIndex].name) === value);
    const bestChoice = candidates => candidates.filter(canChoose).sort((a, b) =>
      names.filter(name => valueFor(b, name) === valueFor(draft, name)).length - names.filter(name => valueFor(a, name) === valueFor(draft, name)).length)[0];
    const unavailableLabel = candidates => !candidates.length ? "Not available" : candidates.every(choice => Number(choice.stock) === 0) ? "Sold out" : candidates.some(choice => choice.available) ? "Not enough stock" : "Unavailable";
    const radio = ({ name, value, label, detail, checked, disabled, attributes }) => `<label class="product-option-choice${disabled ? " is-unavailable" : ""}"><input type="radio" name="${name}" value="${value}" ${attributes} ${checked ? "checked" : ""} ${disabled ? "disabled" : ""}><span><b>${esc(label)}</b>${detail ? `<small>${esc(detail)}</small>` : ""}</span><i aria-hidden="true"></i></label>`;

    function render() {
      const scrollTop = dialog.querySelector(".product-options-body").scrollTop;
      const scrollPositions = new Map([...fields.querySelectorAll("[data-option-scroll]")].map(list => [list.dataset.optionScroll, list.scrollTop]));
      if (grouped) {
        fields.innerHTML = groups.map((group, groupIndex) => {
          const search = searches.get(groupIndex) || "";
          const values = group.values.map((value, index) => ({ value, index })).filter(({ value }) => value.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
          return `<fieldset ${pending ? "disabled" : ""}><legend>${esc(group.name)}${group.values.length > 8 ? `<small aria-hidden="true">${group.values.length} options</small>` : ""}</legend>${group.values.length > 8 ? `<input class="product-options-group-search" type="search" data-option-search="${groupIndex}" aria-label="Search ${esc(group.name)}" placeholder="Find ${esc(group.name.toLocaleLowerCase())}" value="${esc(search)}" autocomplete="off">` : ""}<div class="product-option-choices${group.values.length > 8 ? " is-scrollable" : group.values.length <= 3 ? " is-short" : ""}" data-option-scroll="${groupIndex}">${values.map(({ value, index }) => {
          const matches = candidates(groupIndex, value), choice = bestChoice(matches);
          return radio({ name: `product-option-${groupIndex}`, value: index, label: value,
            detail: !choice ? unavailableLabel(matches) : groupIndex === groups.length - 1 ? money(choice.price) : "",
            checked: value === valueFor(draft, group.name), disabled: !choice, attributes: `data-option-group="${groupIndex}"` });
        }).join("")}</div>${!values.length ? '<p class="product-options-empty">No matching options. Try another search.</p>' : ""}</fieldset>`;
        }).join("");
      } else {
        const search = dialog.querySelector('input[type="search"]')?.value.trim().toLocaleLowerCase() || "";
        const matches = choices.map((choice, index) => ({ choice, index })).filter(({ choice }) => choice.name.toLocaleLowerCase().includes(search));
        fields.innerHTML = `<fieldset ${pending ? "disabled" : ""}><legend>Option</legend><div class="product-option-choices product-option-list">${matches.map(({ choice, index }) => radio({ name: "product-option", value: index, label: choice.name,
          detail: `${money(choice.price)}${!canChoose(choice) ? " · " + unavailableLabel([choice]) : ""}`, checked: choice.id === draft.id, disabled: !canChoose(choice), attributes: "data-option-choice" })).join("")}</div>${!matches.length ? '<p class="product-options-empty">No matching options. Try another search.</p>' : ""}</fieldset>`;
      }
      const photo = dialog.querySelector(".product-options-product img");
      const source = imageUrl(draft.imageUrl || product.imageUrl);
      photo.hidden = !source;
      if (source && photo.src !== source) photo.src = source;
      dialog.querySelector("[data-option-selection]").textContent = grouped ? groups.map(group => valueFor(draft, group.name)).join(" · ") : draft.name;
      dialog.querySelector("[data-option-unit]").textContent = `${money(draft.price)} each × ${quantity}`;
      dialog.querySelector("[data-option-total]").textContent = money(draft.price * quantity);
      apply.disabled = pending || !canChoose(draft);
      apply.textContent = pending ? "Checking availability…" : "Update item";
      dialog.querySelectorAll(".product-options-close,.product-options-cancel").forEach(button => { button.disabled = pending; });
      dialog.querySelector(".product-options-body").scrollTop = scrollTop;
      fields.querySelectorAll("[data-option-scroll]").forEach(list => { list.scrollTop = scrollPositions.get(list.dataset.optionScroll) || 0; });
    }
    fields.addEventListener("change", event => {
      const input = event.target.closest('input[type="radio"]');
      if (!input || pending) return;
      const previous = draft;
      if (input.hasAttribute("data-option-group")) {
        const index = Number(input.dataset.optionGroup), value = groups[index].values[Number(input.value)];
        draft = bestChoice(candidates(index, value)) || draft;
        const adjusted = groups.slice(index + 1).filter(group => valueFor(previous, group.name) !== valueFor(draft, group.name));
        status.textContent = adjusted.length ? adjusted.map(group => `${group.name} updated to ${valueFor(draft, group.name)}.`).join(" ") : "";
      } else {
        const choice = choices[Number(input.value)];
        if (choice && canChoose(choice)) draft = choice;
        status.textContent = "";
      }
      const name = input.name, value = input.value;
      render();
      fields.querySelector(`input[name="${name}"][value="${value}"]`)?.focus({ preventScroll: true });
    });
    fields.addEventListener("input", event => {
      const input = event.target.closest("[data-option-search]");
      if (!input || pending) return;
      const index = Number(input.dataset.optionSearch), start = input.selectionStart;
      searches.set(index, input.value); render();
      const next = fields.querySelector(`[data-option-search="${index}"]`);
      next.focus({ preventScroll: true }); next.setSelectionRange(start, start);
    });
    dialog.querySelector('input[type="search"]')?.addEventListener("input", render);
    dialog.querySelector(".product-options-close").addEventListener("click", cancel);
    dialog.querySelector(".product-options-cancel").addEventListener("click", cancel);
    dialog.addEventListener("cancel", event => { if (pending) event.preventDefault(); });
    dialog.addEventListener("click", event => {
      const box = dialog.getBoundingClientRect();
      if (event.target === dialog && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom)) cancel();
    });
    dialog.addEventListener("close", () => {
      dialog.remove(); document.body.classList.remove("product-options-open");
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    });
    apply.addEventListener("click", async () => {
      if (pending || !canChoose(draft)) return;
      pending = true; status.textContent = ""; render();
      try {
        const result = await onApply(draft);
        if (result?.error) { status.textContent = result.error; return; }
        dialog.close(); onApplied?.(draft);
      } catch (error) {
        status.textContent = error.name === "TimeoutError" ? "The connection took too long. Your cart hasn't changed. Please try again." : error.message || "We couldn't update your item. Please try again.";
      } finally {
        pending = false;
        if (dialog.open) { render(); apply.focus({ preventScroll: true }); }
      }
    });
    render(); dialog.showModal(); dialog.querySelector("h2").focus();
  }
  window.EzkartProductOptions = { open };
})();
