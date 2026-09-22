/* Page identity shared by settings, publication, previews, and HTML exports. */
(() => {
  const modes = ['light', 'dark'];
  const clean = value => typeof value === 'string' && value.length <= 131072 && /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value) ? value : '';
  const normalize = value => Object.fromEntries(modes.map(mode => [mode, clean(value?.[mode])]));
  const prepareImage = async file => {
    if (!/^(image\/(png|jpeg|webp|gif|avif|svg\+xml|x-icon|vnd.microsoft.icon))$/.test(file.type) && !(file.type === '' && /\.(png|jpe?g|webp|gif|avif|svg|ico)$/i.test(file.name))) {
      throw Error('Choose a PNG, SVG, ICO, JPEG, WebP, GIF, or AVIF image.');
    }
    if (file.size > 8 * 1024 * 1024) throw Error('Choose an image smaller than 8 MB.');
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      try { await image.decode(); } catch { throw Error('This image could not be opened. Try another file.'); }
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 128;
      const scale = 128 / Math.max(image.naturalWidth, image.naturalHeight);
      const width = image.naturalWidth * scale, height = image.naturalHeight * scale;
      canvas.getContext('2d').drawImage(image, (128 - width) / 2, (128 - height) / 2, width, height);
      const src = clean(canvas.toDataURL('image/png'));
      if (!src) throw Error('This image could not be used as a favicon. Try another file.');
      return src;
    } finally { URL.revokeObjectURL(url); }
  };
  // Use one active link so theme changes work consistently across browsers.
  const mount = () => {
    const icon = document.querySelector('[data-ezkart-favicon]');
    if (!icon) return;
    const scheme = matchMedia('(prefers-color-scheme: dark)');
    const update = () => { icon.href = scheme.matches ? icon.dataset.dark : icon.dataset.light; };
    update();
    scheme.addEventListener('change', update);
  };
  const html = value => {
    const icons = normalize(value), light = icons.light || icons.dark, dark = icons.dark || icons.light;
    if (!light) return '';
    return `<link rel="icon" type="image/png" sizes="128x128" href="${light}" data-ezkart-favicon data-light="${light}" data-dark="${dark}">\n<script>(${mount.toString()})();<\/script>`;
  };
  const create = ({root, remember, changed, siteKey}) => {
    let icons = normalize(), generation = 0, publishing = false;
    const pending = new Set(), feedback = {};
    const hosts = [...root.querySelectorAll('[data-sq-favicons]')];
    const dialog = root.querySelector('[data-sq-favicon-dialog]');
    hosts.forEach(host => {
      host.innerHTML = `<div class="sq-favicon-grid">${modes.map(mode => `<section class="sq-favicon-card" data-favicon-mode="${mode}">
        <h3>${mode === 'light' ? 'Light mode' : 'Dark mode'}</h3>
        <div class="sq-favicon-preview sq-favicon-preview-${mode}" aria-label="${mode === 'light' ? 'Light' : 'Dark'} browser tab preview"><img alt="${mode} favicon" hidden><span aria-hidden="true" data-favicon-placeholder>◎</span><span>Your site</span><span aria-hidden="true">×</span></div>
        <button class="ui-button" type="button" data-favicon-upload>Upload icon</button>
        <input type="file" accept="image/png,image/svg+xml,image/x-icon,image/vnd.microsoft.icon,image/jpeg,image/webp,image/gif,image/avif,.ico" aria-label="Upload ${mode} mode favicon" hidden>
        <button type="button" class="sq-favicon-remove" data-favicon-remove hidden>Remove</button>
        <p data-favicon-status role="status" aria-live="polite"></p>
      </section>`).join('')}</div><p class="sq-favicon-help">A favicon is the small icon in a browser tab. Add one for both themes, or upload a different icon for each. Square images work best. PNG, SVG, ICO and other images, up to 8 MB.</p>`;
      host.querySelectorAll('[data-favicon-mode]').forEach(card => {
        const mode = card.dataset.faviconMode, input = card.querySelector('input');
        card.querySelector('[data-favicon-upload]').addEventListener('click', () => input.click());
        input.addEventListener('change', async () => {
          const file = input.files?.[0]; input.value = '';
          if (!file || pending.has(mode) || publishing) return;
          const request = generation, site = siteKey();
          pending.add(mode); delete feedback[mode]; render();
          try {
            const src = await prepareImage(file);
            if (request !== generation || site !== siteKey()) return;
            remember(); icons[mode] = src; changed();
            feedback[mode] = {text: 'Icon added.'};
          } catch (error) {
            if (request === generation && site === siteKey()) feedback[mode] = {text: error.message, error: true};
          } finally { pending.delete(mode); render(); }
        });
        card.querySelector('[data-favicon-remove]').addEventListener('click', () => {
          if (pending.size || publishing) return;
          remember(); icons[mode] = ''; delete feedback[mode]; changed(); render();
        });
      });
    });
    const render = () => {
      hosts.forEach(host => host.querySelectorAll('[data-favicon-mode]').forEach(card => {
        const mode = card.dataset.faviconMode, other = mode === 'light' ? 'dark' : 'light';
        const src = icons[mode] || icons[other], image = card.querySelector('img');
        image.hidden = !src;
        if (src) image.src = src; else image.removeAttribute('src');
        card.querySelector('[data-favicon-placeholder]').hidden = Boolean(src);
        const upload = card.querySelector('[data-favicon-upload]');
        upload.disabled = pending.has(mode) || publishing;
        upload.textContent = pending.has(mode) ? 'Preparing…' : icons[mode] ? 'Replace icon' : 'Upload icon';
        const remove = card.querySelector('[data-favicon-remove]');
        remove.hidden = !icons[mode]; remove.disabled = Boolean(pending.size) || publishing;
        const status = card.querySelector('[data-favicon-status]');
        status.textContent = pending.has(mode) ? 'Preparing your icon…' : feedback[mode]?.text || (!icons[mode] && icons[other] ? `Using the ${other} mode icon.` : '');
        status.toggleAttribute('data-error', Boolean(feedback[mode]?.error));
      }));
      const submit = dialog.querySelector('[data-favicon-publish]');
      submit.disabled = Boolean(pending.size);
      submit.textContent = icons.light || icons.dark ? 'Publish page' : 'Publish without favicon';
    };
    dialog.querySelectorAll('[data-favicon-close]').forEach(button => button.addEventListener('click', () => dialog.close('cancel')));
    dialog.querySelector('[data-favicon-publish]').addEventListener('click', () => { if (!pending.size) dialog.close('publish'); });
    dialog.addEventListener('cancel', () => { dialog.returnValue = 'cancel'; });
    render();
    return {
      snapshot: () => ({...icons}),
      restore: value => { generation++; icons = normalize(value); modes.forEach(mode => delete feedback[mode]); render(); },
      html: () => html(icons),
      busy: () => Boolean(pending.size),
      setPublishing: value => { publishing = value; render(); },
      confirmPublish: () => {
        if (pending.size) throw Error('Wait for your favicon upload to finish, then publish.');
        if (icons.light || icons.dark) return Promise.resolve(true);
        dialog.returnValue = ''; dialog.showModal();
        return new Promise(resolve => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'publish'), {once: true}));
      },
    };
  };
  globalThis.EzkartSiteSettings = Object.freeze({create});
})();
