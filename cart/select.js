/* Progressive dropdown enhancement. Keep this installer self-contained so the
   landing-page exporter can include it without an external script dependency. */
(() => {
  function install() {
    if (CSS.supports('appearance', 'base-select') || document.documentElement.dataset.ezkartSelects) return;
    document.documentElement.dataset.ezkartSelects = 'true';
    const controls = new Map();
    let current = null, serial = 0, queued = false;
    const eligible = select => !select.multiple && select.size <= 1 && !select.matches('.sq-builder-native-select,.product-type-native,[data-native-select],[aria-hidden="true"]') && !select.closest('.sq-tool-panels,.sq-inspector,.sq-studio .sq-page-preview');
    const labelFor = select => {
      if (select.getAttribute('aria-label')) return select.getAttribute('aria-label');
      const label = select.labels?.[0]?.cloneNode(true);
      label?.querySelectorAll('select,.ezkart-select').forEach(node => node.remove());
      return label?.textContent.trim() || select.name || 'Choose an option';
    };
    const close = () => {
      if (!current) return;
      const control = current;
      current = null;
      if (control.menu.hidePopover && control.menu.matches(':popover-open')) control.menu.hidePopover();
      control.menu.hidden = true;
      control.trigger.setAttribute('aria-expanded', 'false');
      control.trigger.removeAttribute('aria-activedescendant');
    };
    const position = () => {
      if (!current) return;
      const { trigger, menu } = current, rect = trigger.getBoundingClientRect();
      if (!trigger.isConnected || !rect.width || !rect.height) { close(); return; }
      const below = innerHeight - rect.bottom - 12, above = rect.top - 12;
      const up = below < Math.min(menu.scrollHeight, 180) && above > below;
      const height = Math.max(40, Math.min(320, up ? above : below));
      const width = Math.min(innerWidth - 16, Math.max(180, rect.width));
      Object.assign(menu.style, { width: `${width}px`, maxHeight: `${height}px`, left: `${Math.max(8, Math.min(rect.left, innerWidth - width - 8))}px` });
      menu.style.top = `${up ? Math.max(8, rect.top - menu.getBoundingClientRect().height - 6) : rect.bottom + 6}px`;
    };
    const activate = (control, index) => {
      const options = [...control.menu.querySelectorAll('[role=option]')];
      const option = options.find(node => Number(node.dataset.index) === index);
      if (!option || option.getAttribute('aria-disabled') === 'true') return;
      control.active = index;
      options.forEach(node => node.classList.toggle('is-active', node === option));
      control.trigger.setAttribute('aria-activedescendant', option.id);
      option.scrollIntoView({ block: 'nearest' });
    };
    const sync = control => {
      const { select, trigger, menu, wrapper } = control;
      const signature = JSON.stringify([select.selectedIndex, select.matches(':disabled'), select.hidden, [...select.options].map(o => [o.label, o.disabled || o.parentElement.disabled, o.hidden, o.value])]);
      if (signature === control.signature) return;
      control.signature = signature;
      trigger.firstElementChild.textContent = select.selectedOptions[0]?.label || 'Choose an option';
      trigger.disabled = select.matches(':disabled');
      wrapper.hidden = select.hidden;
      if (current === control && (trigger.disabled || wrapper.hidden)) close();
      menu.replaceChildren(...[...select.options].filter(option => !option.hidden).map(option => {
        const item = document.createElement('div');
        item.className = 'ezkart-select-option';
        item.id = `${menu.id}-${option.index}`;
        item.dataset.index = String(option.index);
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', String(option.selected));
        item.setAttribute('aria-disabled', String(Boolean(option.disabled || option.parentElement.disabled)));
        item.textContent = option.label;
        return item;
      }));
      if (current === control) { activate(control, select.selectedIndex); position(); }
    };
    const choose = control => {
      const option = control.select.options[control.active];
      if (!option || option.disabled || option.parentElement.disabled) return;
      const changed = control.select.selectedIndex !== option.index;
      control.select.selectedIndex = option.index;
      close();
      sync(control);
      if (changed) {
        control.trigger.removeAttribute('aria-invalid');
        control.select.dispatchEvent(new Event('input', { bubbles: true }));
        control.select.dispatchEvent(new Event('change', { bubbles: true }));
      }
    };
    const open = control => {
      close();
      sync(control);
      if (control.trigger.disabled) return;
      current = control;
      control.menu.hidden = false;
      if (control.menu.showPopover) control.menu.showPopover();
      control.trigger.setAttribute('aria-expanded', 'true');
      position();
      const first = control.menu.querySelector('[aria-disabled=false]');
      const selected = control.select.selectedOptions[0];
      activate(control, !selected || selected.disabled || selected.parentElement.disabled ? Number(first?.dataset.index) : selected.index);
    };
    function enhance(select) {
      if (controls.has(select) || !eligible(select)) return;
      const style = getComputedStyle(select), label = labelFor(select);
      const wrapper = document.createElement('span');
      wrapper.className = 'ezkart-select';
      const trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.className = 'ezkart-select-trigger';
      trigger.setAttribute('role', 'combobox');
      trigger.setAttribute('aria-haspopup', 'listbox');
      trigger.setAttribute('aria-expanded', 'false');
      trigger.setAttribute('aria-label', label);
      for (const name of ['aria-labelledby', 'aria-describedby', 'aria-required']) if (select.hasAttribute(name)) trigger.setAttribute(name, select.getAttribute(name));
      if (select.required) trigger.setAttribute('aria-required', 'true');
      trigger.style.font = style.font;
      trigger.style.minHeight = `${Math.max(36, select.getBoundingClientRect().height)}px`;
      trigger.style.borderRadius = style.borderRadius;
      trigger.append(document.createElement('span'));
      const error = document.createElement('span');
      error.className = 'ezkart-select-error';
      error.id = `ezkart-select-error-${serial + 1}`;
      error.hidden = true;
      error.setAttribute('role', 'alert');
      const menu = document.createElement('div');
      menu.id = `ezkart-select-${++serial}`;
      menu.className = 'ezkart-select-menu';
      menu.style.fontFamily = style.fontFamily;
      menu.setAttribute('role', 'listbox');
      menu.setAttribute('aria-label', label);
      menu.hidden = true;
      if (menu.showPopover) menu.setAttribute('popover', 'manual');
      trigger.setAttribute('aria-controls', menu.id);
      select.before(wrapper);
      wrapper.append(select, trigger, error);
      (select.closest('dialog') || document.body).append(menu);
      select.classList.add('ezkart-select-source');
      select.setAttribute('aria-hidden', 'true');
      select.tabIndex = -1;
      const control = { select, wrapper, trigger, menu, active: select.selectedIndex, signature: '' };
      controls.set(select, control);
      trigger.addEventListener('click', () => current === control ? close() : open(control));
      trigger.addEventListener('blur', () => { if (current === control) close(); });
      trigger.addEventListener('keydown', event => {
        if (event.key === 'Escape') { if (current === control) { event.preventDefault(); event.stopPropagation(); close(); } return; }
        if (event.key === 'Tab') { if (current === control) choose(control); return; }
        const printable = event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && event.key !== ' ';
        if (!printable && !['Enter', ' ', 'ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp'].includes(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        const wasOpen = current === control;
        if (!wasOpen) open(control);
        if (['Enter', ' '].includes(event.key)) { if (wasOpen) choose(control); return; }
        const options = [...select.options].filter(o => !o.disabled && !o.hidden && !o.parentElement.disabled);
        if (!options.length) return;
        let index = Math.max(0, options.findIndex(o => o.index === control.active));
        if (printable) {
          const now = Date.now();
          control.search = (now - (control.typedAt || 0) < 700 ? control.search || '' : '') + event.key.toLowerCase();
          control.typedAt = now;
          const query = [...control.search].every(c => c === control.search[0]) ? control.search[0] : control.search;
          const ordered = [...options.slice(index + 1), ...options.slice(0, index + 1)];
          const match = ordered.find(o => o.label.toLowerCase().startsWith(query));
          if (match) activate(control, match.index);
          return;
        }
        if (event.key === 'Home') index = 0;
        else if (event.key === 'End') index = options.length - 1;
        else if (wasOpen) index += { ArrowDown: 1, ArrowUp: -1, PageDown: 10, PageUp: -10 }[event.key] || 0;
        activate(control, options[Math.max(0, Math.min(options.length - 1, index))].index);
      });
      menu.addEventListener('pointerdown', event => { if (event.target.closest('[role=option]')) event.preventDefault(); });
      menu.addEventListener('click', event => {
        const item = event.target.closest('[role=option]');
        if (!item || item.getAttribute('aria-disabled') === 'true') return;
        control.active = Number(item.dataset.index);
        choose(control);
        trigger.focus({ preventScroll: true });
      });
      select.addEventListener('change', () => {
        sync(control);
        if (select.validity.valid) { error.hidden = true; trigger.removeAttribute('aria-invalid'); trigger.setAttribute('aria-describedby', select.getAttribute('aria-describedby') || ''); }
      });
      select.addEventListener('input', () => sync(control));
      select.addEventListener('focus', () => trigger.focus());
      select.addEventListener('click', event => { event.preventDefault(); trigger.focus(); open(control); });
      select.addEventListener('invalid', event => {
        event.preventDefault();
        error.textContent = select.validationMessage;
        error.hidden = false;
        trigger.setAttribute('aria-invalid', 'true');
        trigger.setAttribute('aria-describedby', `${select.getAttribute('aria-describedby') || ''} ${error.id}`.trim());
        trigger.focus();
      });
      sync(control);
    }
    const refresh = () => {
      queued = false;
      for (const [select, control] of controls) {
        if (!select.isConnected) { if (current === control) close(); control.menu.remove(); controls.delete(select); }
        else sync(control);
      }
      document.querySelectorAll('select').forEach(enhance);
    };
    const start = () => {
      refresh();
      new MutationObserver(() => { if (!queued) { queued = true; queueMicrotask(refresh); } }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['disabled', 'selected', 'hidden', 'label', 'value'] });
      document.addEventListener('pointerdown', event => { if (current && !current.wrapper.contains(event.target) && !current.menu.contains(event.target)) close(); });
      document.addEventListener('scroll', event => { if (current && !current.menu.contains(event.target)) position(); }, true);
      document.addEventListener('reset', () => setTimeout(refresh, 0));
      window.addEventListener('resize', position);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  }
  globalThis.EzkartSelect = { install };
  install();
})();
