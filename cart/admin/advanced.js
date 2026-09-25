(() => {
  'use strict';
  const page = document.querySelector('[data-advanced-page]');
  if (!page) return;
  const toggle = page.querySelector('[data-advanced-toggle]');
  const status = page.querySelector('[data-advanced-status]');
  const retry = page.querySelector('[data-advanced-retry]');
  const requirements = page.querySelector('[data-advanced-downgrade]');
  const recheck = page.querySelector('[data-advanced-recheck]');
  let plan = null, busy = false, verified = false;
  function hasUsage(value) {
    const downgrade = value?.downgrade;
    return typeof value?.enabled === 'boolean' && typeof downgrade?.allowed === 'boolean'
      && ['landingPages', 'products'].every(key => ['usage', 'limits', 'excess'].every(field =>
        Number.isSafeInteger(downgrade[field]?.[key]) && downgrade[field][key] >= 0));
  }
  function render() {
    const blocked = plan?.enabled && plan.downgrade?.allowed !== true;
    toggle.checked = plan ? plan.enabled : document.body.dataset.adminAdvancedMode === 'true';
    toggle.disabled = busy || !verified || !plan?.canEdit || blocked;
    recheck.disabled = busy;
    retry.disabled = busy;
    page.setAttribute('aria-busy', String(busy));
    if (plan) page.querySelector('[data-advanced-state]').textContent = plan.enabled ? 'On for this store' : 'Off for this store';
    requirements.hidden = !verified || !plan?.enabled;
    if (!requirements.hidden) {
      requirements.dataset.blocked = String(blocked);
      page.querySelector('[data-advanced-downgrade-title]').textContent = blocked ? 'Before switching to Basic' : 'Ready for Basic';
      page.querySelector('[data-advanced-downgrade-summary]').textContent = blocked
        ? 'Delete the extra items below first. Advanced Mode stays on until everything fits within Basic’s limits.'
        : 'Your store fits within Basic’s limits. You can turn off Advanced Mode. Nothing will be deleted.';
      for (const [key, label] of [['landingPages', 'landing page'], ['products', 'product']]) {
        const row = page.querySelector(`[data-advanced-usage="${key}"]`);
        const count = plan.downgrade.excess[key];
        row.dataset.overLimit = String(count > 0);
        row.querySelector('[data-advanced-count]').textContent = `${plan.downgrade.usage[key]} / ${plan.downgrade.limits[key]} on Basic`;
        row.querySelector('[data-advanced-removal]').textContent = count ? `Delete ${count} ${label}${count === 1 ? '' : 's'} to fit.` : 'Within Basic’s limit.';
      }
    }
    if (plan) {
      document.body.dataset.adminAdvancedMode = String(plan.enabled);
      document.body.dataset.adminLandingLimit = String(plan.limits.landingPages);
      document.querySelectorAll('[data-advanced-promo]').forEach(link => { link.hidden = plan.enabled; });
    }
  }
  async function request(body) {
    const response = await fetch('./?cloud=' + encodeURIComponent('/v1/advanced-mode'), {
      method: body ? 'PUT' : 'GET', credentials: 'same-origin', cache: 'no-store',
      headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json', 'X-Ezkart-Csrf': document.body.dataset.adminCsrfToken } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) {
      const error = new Error(result.error || 'Your plan could not be loaded. Please try again.');
      if (result.code === 'basic_limits_exceeded' && hasUsage(result.plan)) error.plan = result.plan;
      throw error;
    }
    if (!hasUsage(result.plan)) throw new Error('Your store’s limits could not be checked. Please try again before changing plans.');
    return result.plan;
  }
  async function update(enabled) {
    if (busy) return;
    busy = true; retry.hidden = true; status.dataset.error = 'false'; render();
    status.textContent = enabled === undefined ? 'Loading your store’s plan…' : 'Saving your plan…';
    try {
      plan = await request(enabled === undefined ? undefined : { enabled, commissionPercent: enabled ? 6 : 5 });
      verified = true;
      status.textContent = !plan.canEdit ? 'Only the store owner can change this plan.' : plan.enabled && !plan.downgrade.allowed ? 'Switching to Basic is blocked until you delete the extra items listed above. Nothing is deleted automatically.' : enabled === undefined ? 'Changes save automatically for this store.' : plan.enabled ? 'Advanced Mode is on. Your higher limits are ready.' : 'Advanced Mode is off. Your store is on Basic.';
    } catch (error) {
      verified = Boolean(error.plan);
      if (error.plan) plan = error.plan;
      status.textContent = error.message;
      status.dataset.error = 'true'; retry.hidden = verified;
    } finally { busy = false; render(); }
  }
  toggle.addEventListener('change', () => { void update(toggle.checked); });
  retry.addEventListener('click', () => { void update(); });
  recheck.addEventListener('click', () => { void update(); });
  // Recheck after managing content in another tab or returning from the browser's
  // back/forward cache. A write still checks current usage on the server.
  window.addEventListener('focus', () => { if (plan && !busy) void update(); });
  window.addEventListener('pageshow', event => { if (event.persisted && !busy) void update(); });
  if (document.body.dataset.adminCloudEnabled === 'true') void update();
  else { status.textContent = 'Sign in with your store account to change Advanced Mode.'; render(); }
})();
