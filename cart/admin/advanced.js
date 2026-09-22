(() => {
  'use strict';
  const page = document.querySelector('[data-advanced-page]');
  if (!page) return;
  const toggle = page.querySelector('[data-advanced-toggle]');
  const status = page.querySelector('[data-advanced-status]');
  const retry = page.querySelector('[data-advanced-retry]');
  let plan = null, busy = false;
  function render() {
    toggle.checked = Boolean(plan?.enabled);
    toggle.disabled = busy || !plan?.canEdit;
    page.setAttribute('aria-busy', String(busy));
    page.querySelector('[data-advanced-state]').textContent = plan ? (plan.enabled ? 'On for this store' : 'Off for this store') : 'Plan unavailable';
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
    if (!response.ok || !result.ok || typeof result.plan?.enabled !== 'boolean') throw new Error(result.error || 'Your plan could not be loaded. Please try again.');
    return result.plan;
  }
  async function update(enabled) {
    if (busy) return;
    busy = true; retry.hidden = true; status.dataset.error = 'false'; render();
    status.textContent = enabled === undefined ? 'Loading your store’s plan…' : 'Saving your plan…';
    try {
      plan = await request(enabled === undefined ? undefined : { enabled, commissionPercent: enabled ? 6 : 5 });
      status.textContent = !plan.canEdit ? 'Only the store owner can change this plan.' : enabled === undefined ? 'Changes save automatically for this store.' : plan.enabled ? 'Advanced Mode is on. Your higher limits are ready.' : 'Advanced Mode is off. Your store is on Basic.';
    } catch (error) {
      status.textContent = error.message;
      status.dataset.error = 'true'; retry.hidden = false;
    } finally { busy = false; render(); }
  }
  toggle.addEventListener('change', () => { void update(toggle.checked); });
  retry.addEventListener('click', () => { void update(); });
  if (document.body.dataset.adminCloudEnabled === 'true') void update();
  else { status.textContent = 'Sign in with your store account to change Advanced Mode.'; render(); }
})();
