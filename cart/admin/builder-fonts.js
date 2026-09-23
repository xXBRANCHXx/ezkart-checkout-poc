/* Shared visual font picker and self-contained, used-font-only HTML exports. */
(() => {
  'use strict';
  const assetBase = new URL('assets/fonts/', document.currentScript.src);
  const categories = {all:'All fonts',sans:'Sans serif',serif:'Serif',display:'Display',handwriting:'Handwriting',mono:'Monospace'};
  const selector = '[data-native-prop="fontFamily"], [data-sq-element-font-family], [data-sq-brand-font]';
  const controls = new WeakMap(), dataCache = new Map(), licenseCache = new Map();
  let families = [{id:"poppins",name:"Poppins",category:"sans",license:"OFL.txt",faces:[400,500,600,700].map(weight=>({file:`poppins-${weight}.woff2`,weight:String(weight)}))}], catalogError, dialog, active, observer, search, category, list, count, preview;
  const fallback = font => font.category === 'serif' ? 'serif' : font.category === 'mono' ? 'monospace' : font.category === 'handwriting' ? 'cursive' : 'sans-serif';
  const familyValue = font => `"${font.name}", ${fallback(font)}`;
  const firstFamily = value => String(value || '').split(',')[0].replace(/["']/g,'').trim().toLowerCase();
  const findFont = value => families.find(font => font.name.toLowerCase() === firstFamily(value));
  const loadCatalog = () => fetch(new URL('builder-fonts.json',assetBase)).then(response => {
    if (!response.ok) throw Error('The font library could not load. Please try again.');
    return response.json();
  }).then(data => { families = data.families; catalogError = null; return families; }).catch(error => { catalogError = error; throw error; });
  // Keep ordinary editing available if the optional catalog is temporarily offline.
  const ready = loadCatalog().catch(() => families);

  function setValue(input,value) {
    if (input.tagName === 'SELECT' && ![...input.options].some(option => option.value === value)) {
      input.append(new Option(findFont(value)?.name || value.split(',')[0].replace(/["']/g,''),value));
    }
    input.value = value;
    sync(input);
  }
  function sync(input) {
    const control = controls.get(input);
    if (!control) return;
    const font = findFont(input.value);
    control.value.textContent = font?.name || input.value.split(',')[0].replace(/["']/g,'').trim() || 'Inherit font';
    control.trigger.setAttribute('aria-label',`${control.label}: ${control.value.textContent}. Choose font`);
    control.trigger.disabled = input.disabled;
  }
  function close() {
    if (!dialog?.open) return;
    observer?.disconnect();
    dialog.close();
  }
  function choose(value) {
    const input = active?.input;
    if (!input) return;
    // Existing brand controls capture their undo snapshot on focus before change.
    input.dispatchEvent(new Event('focus'));
    setValue(input,value);
    input.dispatchEvent(new Event('input',{bubbles:true}));
    input.dispatchEvent(new Event('change',{bubbles:true}));
    close();
  }
  function render() {
    observer?.disconnect();
    const query = search.value.trim().toLowerCase();
    const matched = families.filter(font => (category.value === 'all' || font.category === category.value) && `${font.name} ${categories[font.category]}`.toLowerCase().includes(query));
    list.replaceChildren();
    count.textContent = catalogError ? 'Library unavailable. Reopen to retry.' : `${matched.length} ${matched.length === 1 ? 'font' : 'fonts'}`;
    if (!matched.length) {
      const empty = document.createElement('p');
      empty.className = 'sq-font-empty'; empty.textContent = 'No fonts found. Try a different name or style.'; list.append(empty); return;
    }
    observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const sample = entry.target.querySelector('.sq-font-sample');
      sample.style.fontFamily = entry.target.dataset.fontFamily;
      observer.unobserve(entry.target);
    }),{root:list,rootMargin:'100px'});
    matched.forEach(font => {
      const row = document.createElement('button');
      row.type = 'button'; row.className = 'sq-font-option'; row.dataset.fontId = font.id; row.dataset.fontFamily = familyValue(font);
      row.setAttribute('role','option'); row.setAttribute('aria-label',font.name);
      row.setAttribute('aria-selected',String(firstFamily(active.input.value) === font.name.toLowerCase()));
      const meta = document.createElement('span'); meta.className = 'sq-font-meta';
      const name = document.createElement('span'); name.textContent = font.name;
      const style = document.createElement('small'); style.textContent = categories[font.category];
      meta.append(name,style);
      const sample = document.createElement('span'); sample.className = 'sq-font-sample'; sample.textContent = preview.value.trim() || 'Make something yours'; sample.setAttribute('aria-hidden','true');
      row.append(meta,sample); row.addEventListener('click',() => choose(familyValue(font)));
      list.append(row); observer.observe(row);
    });
  }
  function createDialog() {
    dialog = document.createElement('dialog'); dialog.className = 'sq-font-dialog'; dialog.dataset.sqFontDialog = '';
    dialog.setAttribute('aria-labelledby','sq-font-title');
    dialog.innerHTML = '<header><div><h2 id="sq-font-title">Choose a font</h2><p>See how your words look in every style.</p></div><button type="button" data-font-close aria-label="Close font picker">×</button></header><div class="sq-font-search"><label><span class="sq-font-sr-only">Search fonts</span><input type="search" placeholder="Search fonts…" data-font-search autocomplete="off"></label><label><span class="sq-font-sr-only">Font style</span><select data-font-category></select></label></div><label class="sq-font-preview"><span>Preview text</span><input data-font-preview value="Make something yours" maxlength="80"></label><div class="sq-font-results"><span data-font-count role="status"></span><button type="button" data-font-inherit>Use default font</button></div><div class="sq-font-list" data-font-list role="listbox" aria-label="Fonts"></div><details class="sq-font-custom"><summary>Custom font family</summary><p>Use a system font or a font already loaded on your page.</p><div><input aria-label="Custom font family" data-font-custom placeholder="Georgia, serif"><button type="button" data-font-custom-apply>Apply</button></div></details>';
    document.body.append(dialog);
    search = dialog.querySelector('[data-font-search]'); category = dialog.querySelector('[data-font-category]'); list = dialog.querySelector('[data-font-list]'); count = dialog.querySelector('[data-font-count]'); preview = dialog.querySelector('[data-font-preview]');
    for (const [value,label] of Object.entries(categories)) category.append(new Option(label,value));
    dialog.querySelector('[data-font-close]').addEventListener('click',close);
    dialog.querySelector('[data-font-inherit]').addEventListener('click',() => choose(''));
    dialog.querySelector('[data-font-custom-apply]').addEventListener('click',() => {
      const value = dialog.querySelector('[data-font-custom]').value.trim();
      if (value && CSS.supports('font-family',value)) choose(value);
      else dialog.querySelector('[data-font-custom]').reportValidity();
    });
    dialog.querySelector('[data-font-custom]').addEventListener('input',event => event.target.setCustomValidity(CSS.supports('font-family',event.target.value.trim()) ? '' : 'Enter a valid font family, such as Georgia, serif.'));
    dialog.addEventListener('keydown',event => { event.stopPropagation(); if(event.key === 'Escape'){event.preventDefault();close();} });
    dialog.addEventListener('close',() => { observer?.disconnect(); if(active) { active.trigger.setAttribute('aria-expanded','false'); active.trigger.focus(); } });
    dialog.addEventListener('click',event => { if(event.target === dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)close();} });
    search.addEventListener('input',render); category.addEventListener('change',render); preview.addEventListener('input',render);
    search.addEventListener('keydown',event => { if(event.key === 'ArrowDown'){event.preventDefault();list.querySelector('[role=option]')?.focus();} });
    list.addEventListener('keydown',event => {
      if (!['ArrowDown','ArrowUp','Home','End'].includes(event.key)) return;
      event.preventDefault(); const rows=[...list.querySelectorAll('[role=option]')],current=rows.indexOf(document.activeElement);
      const next=event.key==='Home'?0:event.key==='End'?rows.length-1:(current+(event.key==='ArrowDown'?1:-1)+rows.length)%rows.length;
      rows[next]?.focus();
    });
  }
  async function open(control) {
    if (!dialog) createDialog(); active = control;
    search.value = ''; category.value = 'all';
    dialog.querySelector('[data-font-custom]').value = control.input.value;
    dialog.querySelector('[data-font-custom]').setCustomValidity('');
    dialog.querySelector('[data-font-inherit]').hidden = control.input.hasAttribute('data-sq-brand-font');
    count.textContent = 'Loading fonts…'; list.replaceChildren();
    control.trigger.setAttribute('aria-expanded','true'); dialog.showModal(); search.focus();
    await ready; if(catalogError)await loadCatalog().catch(()=>{}); if(dialog.open) render();
  }
  function attach(root = document) {
    root.querySelectorAll(selector).forEach(input => {
      if (controls.has(input)) return;
      input.dataset.sqFontInput = ''; input.hidden = true; input.tabIndex = -1; input.removeAttribute('list');
      const wrapper = document.createElement('span'); wrapper.className = 'sq-font-control';
      const trigger = document.createElement('button'); trigger.type = 'button'; trigger.className = 'sq-font-trigger'; trigger.dataset.sqFontPicker = ''; trigger.setAttribute('aria-haspopup','dialog'); trigger.setAttribute('aria-expanded','false');
      const value = document.createElement('span'); value.className = 'sq-font-value'; trigger.append(value);
      const arrow = document.createElement('span'); arrow.textContent='⌄'; arrow.setAttribute('aria-hidden','true'); trigger.append(arrow);
      const label = input.getAttribute('aria-label') || input.closest('label')?.querySelector(':scope > span')?.textContent || 'Font';
      const control = {input,trigger,value,label}; controls.set(input,control); wrapper.append(trigger); input.after(wrapper);
      input.closest('label')?.classList.add('sq-font-field');
      trigger.addEventListener('click',event => { event.preventDefault(); open(control); });
      input.addEventListener('input',() => sync(input)); input.addEventListener('change',() => sync(input)); sync(input); ready.then(() => sync(input)).catch(() => {});
    });
  }
  function usedFamilies(root) {
    const names = new Set(['poppins']); // Base page and universal cart use Poppins.
    const add = value => { String(value || '').split(',').forEach(name => names.add(firstFamily(name))); };
    add(getComputedStyle(root).getPropertyValue('--site-heading-font')); add(getComputedStyle(root).getPropertyValue('--site-body-font'));
    [root,...root.querySelectorAll('*')].forEach(node => {
      if (node.closest('script,style,template,.sq-element-overlay,.sq-section-toolbar')) return;
      if (node.childNodes.length && [...node.childNodes].some(child => child.nodeType === Node.TEXT_NODE && child.textContent.trim())) add(getComputedStyle(node).fontFamily);
      if (node.style?.fontFamily) add(node.style.fontFamily);
      // Include alternate responsive/interactive states stored in the native schema.
      if (node.dataset.sqNative) {
        try { const visit=value=>{if(!value||typeof value!=='object')return;for(const[key,item]of Object.entries(value)){if(key==='fontFamily')add(item);else if(typeof item==='object')visit(item);}};visit(JSON.parse(node.dataset.sqNative)); } catch (_) {}
      }
    });
    return families.filter(font => names.has(font.name.toLowerCase()));
  }
  function cached(cache,file,read) {
    if (!cache.has(file)) cache.set(file,fetch(new URL(file,assetBase)).then(response => {
      if(!response.ok) throw Error(`Could not load font asset ${file}. Please try again.`); return read(response);
    }).catch(error => { cache.delete(file); throw error; }));
    return cache.get(file);
  }
  async function ensureUsed(root) { await ready; return Promise.all(usedFamilies(root).map(font => document.fonts.load(`16px "${font.name}"`))); }
  async function prepareExport(root) {
    await ready;
    if (catalogError) await loadCatalog();
    await Promise.all(usedFamilies(root).flatMap(font => [
      cached(licenseCache,font.license,response => response.text()),
      ...font.faces.map(face => cached(dataCache,face.file,async response => {
        const blob = await response.blob();
        return new Promise((resolve,reject) => {const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);});
      })),
    ]));
    // Save resolved data separately so the existing synchronous HTML generator can use it.
    for (const font of usedFamilies(root)) {
      font.exportLicense = await licenseCache.get(font.license);
      for (const face of font.faces) face.exportData = await dataCache.get(face.file);
    }
  }
  function exportCss(root) {
    return usedFamilies(root).map(font => {
      const license = font.exportLicense ? `/* ${font.exportLicense.replace(/\*\//g,'* /').replace(/<\//g,'< /')} */\n` : '';
      return license + font.faces.map(face => `@font-face{font-family:${JSON.stringify(font.name)};src:url('${face.exportData || new URL(face.file,assetBase).href}') format('woff2');font-weight:${face.weight};font-style:normal;font-display:swap}`).join('\n');
    }).join('\n');
  }
  globalThis.EzkartFonts = {attach,sync,setValue,ensureUsed,prepareExport,exportCss,ready,get families(){return families;}};
})();
