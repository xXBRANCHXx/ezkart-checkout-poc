// Start the requested document while the builder scripts are downloading.
(() => {
  if (document.body.dataset.adminCloudEnabled !== 'true') return;
  const requests = new Map();
  const preload = path => {
    const promise = fetch(`./?cloud=${encodeURIComponent(path)}`, {
      credentials: 'same-origin', headers: {Accept: 'application/json'}, cache: 'no-store',
    }).then(async response => {
      const result = await response.json();
      if (!response.ok || result.ok !== true) {
        const error = new Error(String(result.error || `Ezkart returned ${response.status}.`));
        error.status = response.status;
        throw error;
      }
      return result;
    });
    // Store a settled result so slow script downloads cannot cause an unhandled rejection.
    requests.set(path, promise.then(value => ({value}), error => ({error})));
  };
  const catalog = document.getElementById('ezkart-catalog-bootstrap');
  if (catalog) {
    try { requests.set('/v1/catalog', Promise.resolve({value: JSON.parse(catalog.textContent)})); }
    catch (_) { /* Fall back to the authenticated catalog endpoint. */ }
    catalog.remove();
  }
  const query = new URLSearchParams(location.search);
  const site = query.get('edit') || '';
  if (query.get('page') === 'sites' && /^[a-z0-9]+(?:-[a-z0-9]+)*\.ezkart\.site$/.test(site)) {
    preload('/v1/landing-pages/' + site.replace(/\.ezkart\.site$/, ''));
  }
  globalThis.EzkartAdminStartup = {
    take(path) {
      const promise = requests.get(path);
      requests.delete(path);
      return promise?.then(({value, error}) => { if (error) throw error; return value; });
    },
  };
})();
