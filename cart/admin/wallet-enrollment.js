(() => {
  const root = document.querySelector('[data-wallet-setup]');
  if (!root) return;
  const find = name => root.querySelector(`[data-wallet-${name}]`);
  const status = find('setup-status'), badge = find('setup-badge'), connect = find('connect'), refresh = find('setup-refresh');
  const scope = ['ezkart-wallet-request', root.dataset.account, root.dataset.store, root.dataset.environment].join(':');
  const headers = {'X-Ezkart-Csrf': document.body.dataset.adminCsrfToken, 'X-Ezkart-Wallet-Account': root.dataset.account, 'X-Ezkart-Wallet-Store': root.dataset.store};
  let current = null, busy = false, controller, stopped = false, requestKey = '';
  const earnings = name => document.querySelector(`[data-wallet-earnings-${name}]`);
  const more = earnings('more');
  let historyPage = null;
  const money = value => {
    if (typeof value !== 'string' || !/^-?(0|[1-9][0-9]{0,30})$/.test(value)) throw Error('Earnings could not be verified.');
    return new Intl.NumberFormat('id-ID', {style: 'currency', currency: 'IDR', maximumFractionDigits: 0}).format(BigInt(value));
  };
  const clearEarnings = message => {
    if (!earnings('available')) return;
    for (const name of ['available', 'pending', 'reserved', 'deficit']) earnings(name).textContent = '—';
    earnings('available').setAttribute('aria-label', 'Earnings unavailable');
    earnings('deficit-row').hidden = true;
    earnings('status').textContent = message;
  };
  const renderHistory = (data, append = false) => {
    const body = earnings('history'); if (!body) return;
    if (!append) body.replaceChildren();
    historyPage = data;
    if (!data || !Array.isArray(data.items)) {
      earnings('history-status').textContent = 'Earnings history is not available yet.';
      earnings('history-table').hidden = true; more.hidden = true; return;
    }
    for (const item of data.items) {
      const row = document.createElement('tr'), order = document.createElement('td'), link = document.createElement('a'), at = document.createElement('small');
      link.href = '?page=payments&order=' + encodeURIComponent(item.orderId); link.textContent = item.orderId;
      at.textContent = new Intl.DateTimeFormat('id-ID', {dateStyle: 'medium', timeStyle: 'short'}).format(new Date(item.recordedAt));
      order.append(link, at); row.append(order);
      const label = item.state === 'reserved' ? 'Reserved' : item.state === 'pending' ? 'Returned to pending' : BigInt(item.availableChange) > 0n ? 'Released' : 'Adjusted';
      for (const [index, value] of [label, money(item.availableAfter), money(item.reservedAfter)].entries()) { const cell = document.createElement('td'); cell.textContent = value; cell.dataset.label = ['Update', 'Available after', 'Reserved after'][index]; row.append(cell); }
      body.append(row);
    }
    earnings('history-table').hidden = body.children.length === 0;
    earnings('history-status').textContent = body.children.length ? 'Amounts show this order’s position after each update.' : 'No earnings have been released or reserved yet.';
    more.hidden = data.nextBefore === null; more.disabled = busy;
  };
  const renderEarnings = data => {
    if (!earnings('available')) return;
    const report = data.earnings;
    if (!report) { clearEarnings('Recorded earnings are not available yet.'); renderHistory(null); return; }
    const values = {available: report.availableEarnings, pending: report.pendingEarnings, reserved: report.reservedEarnings, deficit: report.negativeAllocations};
    for (const [name, value] of Object.entries(values)) earnings(name).textContent = money(value);
    earnings('available').setAttribute('aria-label', 'Available earnings ' + money(values.available));
    earnings('deficit-row').hidden = BigInt(values.deficit) === 0n;
    const messages = ['Available earnings require complete delivery and confirmed settlement. Withdrawals are not open yet.'];
    if (report.unknownProcessingFees) messages.push('Some pending orders still need their actual payment fees confirmed.');
    if (report.unreconciledOrders) messages.push('Changed records are being reconciled; affected earnings are held.');
    if (report.incompleteCaptures || !report.balanced) messages.push('Payment accounting needs review before earnings can be used.');
    if (BigInt(values.deficit) > 0n) messages.push('Negative earnings have been deducted from the available amount.');
    earnings('status').textContent = messages.join(' ');
    renderHistory(data.earningsHistory);
  };
  try { requestKey = sessionStorage.getItem(scope) || ''; } catch {}
  const key = () => {
    if (!/^[a-f0-9]{32}$/.test(requestKey)) {
      requestKey = Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join('');
      try { sessionStorage.setItem(scope, requestKey); } catch {}
    }
    return requestKey;
  };
  const controls = () => { connect.disabled = busy || !current?.enabled; refresh.disabled = busy; if (more) more.disabled = busy; root.setAttribute('aria-busy', String(busy)); };
  const render = data => {
    current = data;
    const enrollment = data.enrollment, state = enrollment?.status || 'not_connected';
    badge.textContent = ({connected: 'Connected', review: 'Needs review', connecting: 'Connecting', queued: 'Setup requested'})[state] || (data.enabled ? 'Ready to connect' : 'Not available yet');
    const messages = {
      connected: 'Your seller payment account is connected. Check recorded earnings and any holds below.',
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
    document.querySelector('.wallet-connection').textContent = state === 'connected' ? 'Seller account connected' : state === 'review' ? 'Wallet setup needs review' : 'Wallet connection pending';
    document.querySelector('.wallet-connection + p').textContent = state === 'connected'
      ? 'Earnings below come from your recorded orders, after fees and current holds.'
      : 'Complete wallet setup before using funds. Recorded earnings are separate from your DOKU account balance.';
    renderEarnings(data);
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
    clearEarnings('Checking recorded earnings…');
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
      if (!stopped) { status.textContent = (error.name === 'AbortError' ? 'The check took too long.' : error.message) + ' Check setup status to recover the saved result.'; clearEarnings('Earnings could not be checked. Refresh Wallet to try again.'); }
    } finally { busy = false; if (!stopped) controls(); }
  };
  connect.addEventListener('click', () => run('enroll'));
  refresh.addEventListener('click', () => run(current?.enabled && current.enrollment && current.enrollment.status !== 'connected' ? 'refresh' : 'read'));
  more?.addEventListener('click', async () => {
    if (busy || stopped || !historyPage?.nextBefore) return;
    busy = true; controls();
    try {
      const data = await request('history&cap=' + encodeURIComponent(historyPage.cap) + '&before=' + encodeURIComponent(historyPage.nextBefore));
      if (!stopped) renderHistory(data.earningsHistory, true);
    } catch { if (!stopped) earnings('history-status').textContent = 'Earlier updates could not be loaded. Try again.'; }
    finally { busy = false; if (!stopped) controls(); }
  });
  run('read');
})();
