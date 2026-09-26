(() => {
  const root = document.querySelector('[data-wallet-setup]');
  if (!root) return;
  const find = name => root.querySelector(`[data-wallet-${name}]`);
  const status = find('setup-status'), badge = find('setup-badge'), connect = find('connect'), refresh = find('setup-refresh');
  const scope = ['ezkart-wallet-request', root.dataset.account, root.dataset.store, root.dataset.environment].join(':');
  const headers = {'X-Ezkart-Csrf': document.body.dataset.adminCsrfToken, 'X-Ezkart-Wallet-Account': root.dataset.account, 'X-Ezkart-Wallet-Store': root.dataset.store};
  let current = null, busy = false, controller, stopped = false, requestKey = '';
  try { requestKey = sessionStorage.getItem(scope) || ''; } catch {}
  const key = () => {
    if (!/^[a-f0-9]{32}$/.test(requestKey)) {
      requestKey = Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join('');
      try { sessionStorage.setItem(scope, requestKey); } catch {}
    }
    return requestKey;
  };
  const controls = () => { connect.disabled = busy || !current?.enabled; refresh.disabled = busy; root.setAttribute('aria-busy', String(busy)); };
  const render = data => {
    current = data;
    const enrollment = data.enrollment, state = enrollment?.status || 'not_connected';
    badge.textContent = ({connected: 'Connected', review: 'Needs review', connecting: 'Connecting', queued: 'Setup requested'})[state] || (data.enabled ? 'Ready to connect' : 'Not available yet');
    const messages = {
      connected: 'Your seller account is connected. Earnings and withdrawal availability will appear after settlement is confirmed.',
      review: 'Your original setup request needs review. Check its status here; you do not need to create another wallet.',
      connecting: 'Your wallet setup is being processed. Check its status again shortly.',
      queued: 'Your setup request is saved. Continue setup to connect your seller account.',
    };
    status.textContent = messages[state] || (data.enabled ? 'Review the saved store name and verified email below.' : 'Wallet setup is not available yet. Check back after Ezkart enables seller wallets.');
    find('setup-details').hidden = false;
    find('setup-name').textContent = enrollment?.accountName || data.owner?.storeName || 'Unavailable';
    find('setup-email').textContent = enrollment?.email || data.owner?.email || 'Unavailable';
    find('setup-account-row').hidden = !enrollment?.providerAccountSuffix;
    find('setup-account').textContent = enrollment?.providerAccountSuffix ? 'Ending in ' + enrollment.providerAccountSuffix : '';
    find('setup-disclosure').hidden = !!enrollment || !data.enabled;
    connect.hidden = !!enrollment || !data.enabled;
    refresh.textContent = state === 'queued' && data.enabled ? 'Continue setup' : 'Check setup status';
    root.dataset.state = state;
    root.querySelector('h2').textContent = state === 'connected' ? 'Your seller wallet' : 'Connect your seller wallet';
    document.querySelector('.wallet-connection').textContent = state === 'connected' ? 'Seller account connected · settlement pending' : 'Wallet connection pending';
    document.querySelector('.wallet-connection + p').textContent = state === 'connected'
      ? 'Your account is connected. Your balance will appear after settlement, fees, refunds, and holds are reconciled.'
      : 'Your balance will appear once your seller wallet is connected and its funds are confirmed.';
  };
  const lock = () => {
    stopped = true; controller?.abort();
    const content = root.closest('[data-wallet-content]'); if (content) content.hidden = true;
  };
  window.addEventListener('ezkart:wallet-locked', lock);
  const request = async (action, body) => {
    controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 140000);
    try {
      const response = await fetch('?wallet=' + action, {method: body === undefined ? 'GET' : 'POST', cache: 'no-store', credentials: 'same-origin',
        headers: {...headers, ...(body === undefined ? {} : {'Content-Type': 'application/json'})}, ...(body === undefined ? {} : {body: JSON.stringify(body)}), signal: controller.signal});
      const data = await response.json();
      if (data.code === 'wallet_locked' || response.status === 401) { lock(); location.replace('?page=wallet'); throw Error('Verify your identity again.'); }
      if (!response.ok || !data.ok) throw Error(data.error || 'Wallet could not be checked.');
      return data;
    } finally { clearTimeout(timer); }
  };
  const run = async action => {
    if (busy || stopped) return;
    busy = true; controls();
    status.textContent = action === 'enroll' ? 'Saving your wallet setup request…' : 'Checking your wallet setup…';
    try {
      let data = await request(action, action === 'read' ? undefined : (action === 'enroll' ? {requestKey: key()} : {}));
      if (!stopped) render(data);
      if (action === 'enroll' && data.enrollment?.status === 'queued') {
        status.textContent = 'Connecting your seller account…';
        data = await request('refresh', {});
        if (!stopped) render(data);
      }
    } catch (error) {
      if (stopped) return;
      // Recover a possibly saved intent before another click; keep its key.
      if (action === 'enroll' || action === 'refresh') {
        try { const saved = await request('read'); if (!stopped) render(saved); }
        catch { /* A later read can recover it without a fresh identity. */ }
      }
      if (!stopped) status.textContent = (error.name === 'AbortError' ? 'The check took too long.' : error.message) + ' Check setup status to recover the saved result.';
    } finally { busy = false; if (!stopped) controls(); }
  };
  connect.addEventListener('click', () => run('enroll'));
  refresh.addEventListener('click', () => run(current?.enabled && current.enrollment && current.enrollment.status !== 'connected' ? 'refresh' : 'read'));
  run('read');
})();
