(() => {
  'use strict';
  const avatars = [...document.querySelectorAll('[data-admin-profile-avatar]')];
  if (!avatars.length) return;
  const editor = document.querySelector('[data-profile-logo-editor]');
  const upload = editor?.querySelector('[data-profile-logo-upload]');
  const remove = editor?.querySelector('[data-profile-logo-remove]');
  const retry = editor?.querySelector('[data-profile-logo-retry]');
  let profile = { logoId: '', canEdit: false }, busy = false;
  const status = (message, error = false) => {
    const node = editor?.querySelector('[data-profile-logo-status]');
    if (node) { node.textContent = message; node.dataset.error = String(error); }
  };
  const controls = () => {
    if (upload) upload.disabled = busy || !profile.canEdit;
    if (remove) { remove.disabled = busy || !profile.canEdit; remove.hidden = !profile.logoId; }
    if (retry) retry.disabled = busy;
    const label = editor?.querySelector('[data-profile-logo-upload-label]');
    if (label) label.textContent = profile.logoId ? 'Replace logo' : 'Upload logo';
    editor?.setAttribute('aria-busy', String(busy));
  };
  const url = path => `./?cloud=${encodeURIComponent(path)}`;
  async function request(method, path, body) {
    const response = await fetch(url(path), {
      method, credentials: 'same-origin', cache: 'no-store',
      headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json', 'X-Ezkart-Csrf': document.body.dataset.adminCsrfToken } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) throw new Error(result.error || 'The store logo could not be saved. Please try again.');
    return result;
  }
  function render() {
    for (const avatar of avatars) {
      const image = avatar.querySelector('[data-admin-profile-image]');
      const fallback = avatar.querySelector('[data-admin-profile-fallback]');
      const showImage = show => { image.hidden = !show; fallback.hidden = show; avatar.classList.toggle('has-logo', show); };
      showImage(false);
      image.onload = () => showImage(true);
      image.onerror = () => {
        showImage(false);
        if (profile.logoId && !busy) {
          status('The saved logo could not be displayed. Try again to reload it.', true);
          if (retry) retry.hidden = false;
        }
      };
      if (profile.logoId) image.src = url(`/v1/media/${encodeURIComponent(profile.logoId)}`);
      else image.removeAttribute('src');
    }
    controls();
  }
  async function load() {
    if (busy) return;
    busy = true; controls();
    if (retry) retry.hidden = true;
    status('Loading store logo…');
    try {
      profile = (await request('GET', '/v1/admin-profile')).profile;
      render();
      status(profile.canEdit ? (profile.logoId ? 'Your store logo is saved.' : 'Upload a logo to replace your initials.') : 'Your account cannot change the store logo.');
    } catch (error) {
      status(error.message, true);
      if (retry) retry.hidden = false;
    } finally { busy = false; controls(); }
  }
  async function normalizedLogo(file) {
    if (file.size > 2097152 || !['image/png', 'image/jpeg', 'image/webp', 'image/avif'].includes(file.type))
      throw new Error('Choose a PNG, JPG, WebP or AVIF image up to 2 MB.');
    const source = URL.createObjectURL(file), image = new Image();
    try {
      image.src = source;
      await image.decode().catch(() => { throw new Error('This image could not be opened. Choose another file.'); });
      if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 16777216)
        throw new Error('Choose an image with no more than 16 million pixels.');
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 512;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Image preparation is unavailable. Please try another browser.');
      // Keep even square logo corners inside the circular badge; preserve transparency.
      const scale = (512 / Math.SQRT2) / Math.max(image.naturalWidth, image.naturalHeight);
      const width = image.naturalWidth * scale, height = image.naturalHeight * scale;
      context.drawImage(image, (512 - width) / 2, (512 - height) / 2, width, height);
      return canvas.toDataURL('image/png');
    } finally { URL.revokeObjectURL(source); }
  }
  async function save(file = null) {
    if (busy || !profile.canEdit) return;
    busy = true; controls();
    if (retry) retry.hidden = true;
    status(file ? 'Preparing and saving your logo…' : 'Removing store logo…');
    try {
      let logoId = '';
      if (file) {
        const dataUrl = await normalizedLogo(file);
        logoId = (await request('POST', '/v1/media', { dataUrl })).media.id;
      }
      const saved = (await request('PUT', '/v1/admin-profile', { logoId })).profile;
      profile = saved;
      render();
      status(logoId ? 'Store logo saved.' : 'Logo removed. Your initials are shown again.');
    } catch (error) { status(error.message, true); }
    finally { busy = false; if (upload) upload.value = ''; controls(); }
  }
  upload?.addEventListener('change', () => { const file = upload.files?.[0]; if (file) void save(file); });
  remove?.addEventListener('click', () => { void save(); });
  retry?.addEventListener('click', () => { void load(); });
  if (document.body.dataset.adminCloudEnabled === 'true') void load();
  else { status('Sign in with your account to upload a store logo.'); controls(); }
})();
