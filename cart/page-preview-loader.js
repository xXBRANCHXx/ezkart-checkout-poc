(() => {
  const source = document.currentScript.dataset.previewSource;
  (async () => {
    try {
      const response = await fetch(source, {credentials: 'same-origin', cache: 'no-store'});
      if (response.status === 401) {
        document.querySelector('[data-preview-status]').textContent = 'Sign in to view this private preview.';
        document.querySelector('[data-preview-sign-in]').hidden = false;
        return;
      }
      if (!response.ok || !response.headers.get('content-type')?.startsWith('text/html')) throw Error('Preview unavailable');
      const canonicalPath = response.headers.get('x-ezkart-preview-path');
      if (/^\/[a-z0-9-]+\/shop\/[a-z0-9-]+\/preview$/.test(canonicalPath) && canonicalPath !== location.pathname) {
        location.replace(canonicalPath);
        return;
      }
      const html = await response.text();
      // This endpoint returns a trusted shell containing sandboxed authored HTML.
      // Replacing this document keeps its pretty URL, title and checkout return.
      document.open();
      document.write(html);
      document.close();
    } catch {
      document.querySelector('[data-preview-status]').textContent = 'This preview could not be loaded. Reopen it from the editor or try refreshing.';
    }
  })();
})();
