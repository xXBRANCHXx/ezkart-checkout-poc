(() => {
  const root = document.querySelector('[data-withdrawals]'), wallet = document.querySelector('[data-wallet-setup]');
  if (!root || !wallet) return;
  const q = name => root.querySelector('[data-withdrawal-' + name + ']');
  const dialog = q('dialog'), form = q('form'), confirmation = q('confirm-form'), start = document.querySelector('[data-wallet-withdraw-start]');
  const storageScope = ['ezkart-withdrawal', wallet.dataset.account, wallet.dataset.store, wallet.dataset.environment].join(':');
  const headers = {'Content-Type':'application/json', 'X-Ezkart-Csrf':document.body.dataset.adminCsrfToken,
    'X-Ezkart-Wallet-Account':wallet.dataset.account, 'X-Ezkart-Wallet-Store':wallet.dataset.store};
  const controllers = new Set(), keyPattern = /^[a-f0-9]{32}$/;
  let report = null, selected = null, history = null, busy = false, stopped = false, initialized = false;
  let checking = true, unavailableMessage = 'Checking withdrawal availability…';
  const amount = value => {
    if (typeof value !== 'string' || !/^-?(0|[1-9][0-9]{0,30})$/.test(value)) throw Error('The amount could not be checked. Refresh Wallet.');
    return BigInt(value);
  };
  const money = value => new Intl.NumberFormat('id-ID', {style:'currency',currency:'IDR',maximumFractionDigits:0}).format(amount(value));
  const date = value => new Intl.DateTimeFormat('id-ID', {dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
  const caps = () => report?.withdrawalCapabilities || {};
  const banks = () => Array.isArray(caps().banks) ? caps().banks : [];
  const bankName = code => banks().find(bank => bank.code === code)?.name || code;
  const method = channel => channel === 'BI_FAST' ? 'BI-FAST' : 'Online bank transfer';
  const paymentStarted = row => row.payment && row.payment.state !== 'not_started';
  const providerStatus = {reported_pending:'DOKU reports pending',reported_success:'DOKU reports success · reconciliation pending',
    reported_failed:'DOKU reports failure · reconciliation pending',review:'Transfer status needs review'};
  const status = row => ({cancelled:'Cancelled',completed:'Transfer completed',failed:'Transfer failed · funds released',review:'Transfer reconciliation needs review'}[row.state]) || (paymentStarted(row) ? (providerStatus[row.payment.status?.state] || (row.payment.state === 'response_recorded' ? 'Transfer response saved' : 'Transfer needs review')) : row.confirmation ? 'Bank confirmed' : row.bankVerified ? 'Bank verified' : row.inquiry?.state === 'review' ? 'Bank check needs review' : 'Request saved');
  const storageName = type => storageScope + ':' + type;
  const storedKey = type => {
    try {
      const value = sessionStorage.getItem(storageName(type)) || '';
      if (value && !keyPattern.test(value)) throw Error();
      return value;
    } catch { throw Error('Your browser could not read this request’s recovery information. Check withdrawal history before trying again.'); }
  };
  const actionKey = type => {
    const saved = storedKey(type); if (saved) return saved;
    const value = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2,'0')).join('');
    try { sessionStorage.setItem(storageName(type),value); if (storedKey(type) !== value) throw Error(); }
    catch { throw Error('Allow site storage in your browser before saving a withdrawal request.'); }
    return value;
  };
  const forgetKey = type => { try { sessionStorage.removeItem(storageName(type)); } catch {} };
  const setError = message => { q('error').textContent = message; q('error').hidden = !message; };
  function clearDialog() {
    form.reset(); confirmation.reset(); selected = null; q('detail').hidden = true; form.hidden = true;
    q('message').textContent = ''; setError('');
    for (const name of ['amount','bank','account','beneficiary','channel','status','status-note','created','reference','confirmed','warning']) q(name).textContent = '';
    q('cancel-review').hidden = true;
  }
  function lock() {
    if (stopped) return;
    stopped = true; controllers.forEach(controller => controller.abort()); report = null; history = null;
    dialog.close(); clearDialog(); q('history').replaceChildren(); q('history-table').hidden = true;
    root.closest('[data-wallet-content]').hidden = true;
  }
  window.addEventListener('ezkart:wallet-locked',lock);
  async function call(action, body) {
    if (stopped) throw Error('Verify your identity again.');
    const controller = new AbortController(); controllers.add(controller);
    const timer = setTimeout(() => controller.abort(),140000);
    try {
      const response = await fetch('?wallet=withdrawal_' + action, {method:'POST',credentials:'same-origin',cache:'no-store',headers,
        body:JSON.stringify(body),signal:controller.signal});
      if (response.status === 401 || response.status === 403) {
        window.dispatchEvent(new Event('ezkart:wallet-locked')); location.replace('?page=wallet'); throw Error('Verify your identity again.');
      }
      const data = await response.json();
      if (!response.ok || !data.ok) { const error = Error(data.error || 'The request could not be checked.'); error.status = response.status; throw error; }
      if (stopped) throw Error('Verify your identity again.');
      return data;
    } finally { clearTimeout(timer); controllers.delete(controller); }
  }
  function controls() {
    if (stopped) return;
    const available = report?.earnings ? amount(report.earnings.availableEarnings) : 0n;
    const ready = caps().requests === true && report?.earnings?.balanced === true && available >= 250000n;
    start.disabled = busy || !ready;
    document.querySelector('[data-wallet-withdraw-badge]').textContent = !report ? (checking ? 'Checking' : 'Unavailable') : caps().requests ? (ready ? 'Request available' : 'Below minimum') : 'Not available yet';
    document.getElementById('wallet-withdraw-reason').textContent = !report ? unavailableMessage
      : !caps().requests ? 'Bank withdrawals are not available yet. Your earnings remain recorded here.'
      : !ready ? 'At least Rp250.000 in available earnings is needed for a new request.'
      : 'Save a request and confirm your bank details. Bank transfers are currently paused.';
    root.setAttribute('aria-busy',String(busy)); dialog.setAttribute('aria-busy',String(busy));
    q('refresh').disabled = busy || !report; q('recover').disabled = busy || !report; q('more').disabled = busy;
    root.querySelectorAll('[data-withdrawal-id]').forEach(button => { button.disabled = busy; });
    form.querySelectorAll('input,select,button').forEach(control => { control.disabled = busy || !caps().requests; });
    q('detail-refresh').disabled = busy; q('cancel-confirm').disabled = busy; q('keep').disabled = busy;
    try { q('recovery').hidden = !storedKey('reserve'); } catch { q('recovery').hidden = false; }
    if (!selected) return;
    const row = selected.withdrawal, cancelled = row.state === 'cancelled', started = paymentStarted(row);
    const funded = selected.funds.accountingComplete && amount(selected.funds.reservationShortfall) === 0n;
    const own = selected.originalOwner === true;
    const confirmed = row.confirmation && Date.parse(row.confirmation.proofExpiresAt) > Date.now();
    q('check').hidden = cancelled || started || row.bankVerified;
    q('check').disabled = busy || !caps().bankVerification || !caps().requests || !own || !funded;
    q('check').textContent = row.inquiry?.state === 'review' ? 'Check bank verification' : 'Verify bank account';
    q('status-check').hidden = !started;
    q('status-check').disabled = busy || !caps().paymentStatus;
    confirmation.hidden = cancelled || started || !row.bankVerified || !!confirmed || !own;
    confirmation.querySelector('input').disabled = busy || !caps().requests || !funded;
    q('confirm').disabled = busy || !caps().requests || !funded;
    q('cancel').hidden = cancelled || started || !q('cancel-review').hidden; q('cancel').disabled = busy;
    if (started) q('cancel-review').hidden = true;
    q('confirmed').hidden = cancelled || started || !confirmed;
  }
  function renderDetail(data) {
    const row = data.withdrawal;
    if (!row || !/^wd_[a-f0-9]{40}$/.test(row.id) || !['reserved','cancelled','completed','failed','review'].includes(row.state) || typeof row.bank?.accountNumber !== 'string') throw Error('Saved withdrawal details could not be checked.');
    if (!dialog.open || stopped) return;
    selected = data; form.hidden = true; q('detail').hidden = false; confirmation.reset(); q('cancel-review').hidden = true;
    q('title').textContent = 'Withdrawal request'; q('message').textContent = row.state === 'cancelled'
      ? 'This request was cancelled. No bank transfer was started.'
      : row.state === 'completed' ? 'Your bank transfer and its actual fee have been reconciled. The transferred amount stays deducted from your earnings. Ezkart covers the transfer fee.'
      : row.state === 'failed' ? 'DOKU confirms failure and a voided debit. This request’s reservation has been released. Current earnings and any other holds still determine your available balance.'
      : row.state === 'review' ? 'The provider evidence needs reconciliation. Earlier accounting entries remain recorded, and available earnings are held while the discrepancy is resolved.'
      : paymentStarted(row) ? 'This request has entered payment processing. Its outcome must be reconciled before the reserved amount can be released. It cannot be cancelled or sent again.'
      : row.bankVerified ? 'Check the bank-returned account-holder name and your original request below.'
      : row.inquiry?.state === 'review' ? 'The bank check needs review. Check its saved status; you can also cancel this request.'
      : 'Your request is saved and the amount is reserved. Verify the bank account before confirming the destination.';
    const values = {amount:money(row.amount),bank:bankName(row.bank.code),account:row.bank.accountNumber,
      beneficiary:row.bank.beneficiaryName || 'Not verified yet',channel:method(row.bank.channel),status:status(row),
      created:date(row.createdAt),reference:row.id};
    for (const [name,value] of Object.entries(values)) q(name).textContent = value;
    const warnings = [];
    if (row.state !== 'cancelled') {
      if (!data.originalOwner) warnings.push(paymentStarted(row) ? 'A previous owner authorized this payment. Its original destination is preserved while the outcome is reconciled.' : 'A previous owner created this request. You can review or cancel it; create your own request to continue.');
      if (!data.funds.accountingComplete) warnings.push('Wallet accounting needs reconciliation before more funds become available.');
      if (amount(data.funds.reservationShortfall) > 0n) warnings.push(paymentStarted(row) ? 'Changed earnings no longer cover all withdrawal requests. Resolve the holds while this payment is reconciled.' : 'Changed earnings no longer cover all withdrawal requests. Resolve the holds or cancel a request before continuing.');
      if (!caps().bankVerification && !row.bankVerified) warnings.push('Bank verification is temporarily unavailable. Your saved request is preserved.');
    }
    q('warning').textContent = warnings.join(' '); q('warning').hidden = !warnings.length;
    const check = row.payment?.status;
    q('status-note').hidden = !check;
    q('status-note').textContent = row.payment?.outcome ? 'Reconciliation recorded: ' + date(row.payment.outcome.recordedAt) + '. ' + (row.payment.outcome.reconciled
      ? 'Transfer and fee records are matched.' : 'Updated provider evidence still needs review.') : check ? 'Last DOKU check: ' + date(check.checkedAt) + '. ' + (check.state === 'review'
      ? 'The provider results need review. Your withdrawal remains reserved while the outcome is reconciled.'
      : 'Your withdrawal remains reserved until the transfer and its actual fees have been reconciled.') : '';
    q('confirmed').textContent = row.confirmation ? 'Bank details confirmed on ' + date(row.confirmation.confirmedAt) + '. No transfer has been started.' : '';
    controls();
  }
  function renderHistory(data, append) {
    if (!Array.isArray(data.items)) throw Error('Withdrawal history could not be checked.');
    if (!append) q('history').replaceChildren();
    history = data;
    for (const item of data.items) {
      const row = document.createElement('tr'), reference = document.createElement('td'), created = document.createElement('small');
      reference.textContent = 'Request ' + item.sequence; created.textContent = date(item.createdAt); reference.append(created); row.append(reference);
      for (const [label,value] of [['Bank account',bankName(item.bank.code) + ' · ending in ' + item.bank.accountSuffix],['Amount',money(item.amount)],['Status',status(item)]]) {
        const cell = document.createElement('td'); cell.dataset.label = label; cell.textContent = value; row.append(cell);
      }
      const action = document.createElement('td'), button = document.createElement('button');
      button.type = 'button'; button.className = 'action-button'; button.textContent = 'View request';
      button.setAttribute('aria-label','View withdrawal ' + item.sequence); button.dataset.withdrawalId = item.id;
      button.addEventListener('click', () => openSaved(item.id)); action.append(button); row.append(action); q('history').append(row);
    }
    q('history-table').hidden = !q('history').children.length;
    q('history-status').textContent = q('history').children.length ? 'Saved requests remain here after you close or reload Wallet. A bank check is not a completed transfer.' : 'No withdrawal requests yet.';
    q('more').hidden = data.nextBefore === null;
  }
  async function loadHistory(append = false) {
    const input = {limit:10};
    if (append && history?.nextBefore) Object.assign(input,{cap:history.cap,before:history.nextBefore});
    const data = await call('list',input);
    if (!stopped) renderHistory(data,append);
  }
  async function run(work) {
    if (busy || stopped) return;
    busy = true; setError(''); controls();
    try { await work(); }
    catch (error) {
      if (!stopped) {
        const message = error.name === 'AbortError' ? 'This check took too long. Check the saved request before trying again.' : error.message;
        if (dialog.open) setError(message); else q('history-status').textContent = message;
      }
    } finally { busy = false; if (!dialog.open) selected = null; controls(); }
  }
  function openDialog() { clearDialog(); dialog.showModal(); }
  async function lookupPending() {
    const requestKey = storedKey('reserve'); if (!requestKey) return null;
    try { const data = await call('lookup',{requestKey}); forgetKey('reserve'); return data; }
    catch (error) { if (error.status === 404) return null; throw error; }
  }
  async function changed() {
    try { await loadHistory(); }
    catch { if (!stopped) q('history-status').textContent = 'The saved request changed, but history could not refresh. Refresh requests to check it.'; }
    if (!stopped) window.dispatchEvent(new Event('ezkart:wallet-refresh'));
  }
  function bankOptions() {
    const search = q('bank-search').value.trim().toLocaleLowerCase(), choice = form.elements.bank.value;
    const options = banks().filter(bank => bank.name.toLocaleLowerCase().includes(search));
    form.elements.bank.replaceChildren(new Option(options.length ? 'Choose your bank' : 'No matching banks',''), ...options.map(bank => new Option(bank.name,bank.code)));
    if (options.some(bank => bank.code === choice)) form.elements.bank.value = choice;
    channelOptions();
  }
  function channelOptions() {
    const bank = banks().find(bank => bank.code === form.elements.bank.value), current = form.elements.channel.value;
    form.elements.channel.replaceChildren(...(bank ? bank.channels.map(channel => new Option(method(channel),channel)) : [new Option('Choose a bank first','')]));
    if (bank?.channels.includes(current)) form.elements.channel.value = current;
  }
  const openSaved = id => run(async () => {
    openDialog(); q('title').textContent = 'Withdrawal request'; q('message').textContent = 'Checking the saved request…';
    renderDetail(await call('read',{id}));
  });
  start.addEventListener('click', () => run(async () => {
    openDialog(); q('title').textContent = 'Withdraw funds';
    const recovered = await lookupPending(); if (recovered) { renderDetail(recovered); await changed(); return; }
    form.hidden = false; bankOptions(); q('available').textContent = money(report.earnings.availableEarnings);
    q('message').textContent = storedKey('reserve') ? 'Your previous request has not been confirmed. Enter the same details to try again; the original request will be recovered if it was saved.' : 'Choose your bank and the amount to withdraw.';
    form.elements.amount.focus();
  }));
  q('bank-search').addEventListener('input',bankOptions); form.elements.bank.addEventListener('change',channelOptions);
  form.addEventListener('submit',event => {
    event.preventDefault();
    const payload = {amount:form.elements.amount.value,bank:{code:form.elements.bank.value,accountNumber:form.elements.account.value,channel:form.elements.channel.value}};
    void run(async () => {
      const recovered = await lookupPending(); if (recovered) { renderDetail(recovered); await changed(); return; }
      if (!/^[1-9][0-9]{5,15}$/.test(payload.amount) || amount(payload.amount) < 250000n || amount(payload.amount) > 9007199254740991n) throw Error('Enter a whole-rupiah amount of at least Rp250.000 within the withdrawal limit.');
      if (!report?.earnings || amount(payload.amount) > amount(report.earnings.availableEarnings)) throw Error('This amount is more than your current available earnings.');
      const requestKey = actionKey('reserve'); q('message').textContent = 'Saving your withdrawal request…';
      try {
        const saved = await call('reserve',{...payload,requestKey});
        const detail = await call('read',{id:saved.withdrawal.id}); forgetKey('reserve'); renderDetail(detail);
      } catch (error) {
        const saved = await lookupPending();
        if (saved) renderDetail(saved); else throw error;
      } finally { await changed(); }
    });
  });
  q('recover').addEventListener('click', () => run(async () => {
    const saved = await lookupPending();
    if (saved) { openDialog(); renderDetail(saved); await changed(); }
    else q('history-status').textContent = 'No saved request is confirmed yet. Use the same details when you try again; do not start a different withdrawal.';
  }));
  async function act(action) {
    if (!selected) return;
    const id = selected.withdrawal.id, payload = {id}, keyType = action + ':' + id;
    if (action === 'confirm') Object.assign(payload,{requestKey:actionKey(keyType),inquiryDigest:selected.withdrawal.inquiry.digest});
    if (action === 'cancel') payload.requestKey = actionKey(keyType);
    q('message').textContent = action === 'inquire' ? 'Checking your bank account…' : action === 'status' ? 'Checking the original transfer with DOKU…' : action === 'confirm' ? 'Saving your bank confirmation…' : 'Cancelling this request…';
    try {
      const result = await call(action,payload); if (action !== 'inquire' && action !== 'status') forgetKey(keyType);
      renderDetail(await call('read',{id}));
      if (result.statusCheck?.state === 'review') setError('The latest status check needs review. Earlier accounting entries remain recorded.');
    } catch (error) {
      try { renderDetail(await call('read',{id})); } catch { /* Keep the original reference for the next status check. */ }
      throw error;
    } finally { await changed(); }
  }
  q('check').addEventListener('click', () => run(() => act('inquire')));
  q('status-check').addEventListener('click', () => run(() => act('status')));
  confirmation.addEventListener('submit',event => { event.preventDefault(); if (confirmation.elements.confirmed.checked) void run(() => act('confirm')); });
  q('detail-refresh').addEventListener('click', () => run(async () => { if (selected) renderDetail(await call('read',{id:selected.withdrawal.id})); }));
  q('cancel').addEventListener('click', () => { if (!busy) { q('cancel-review').hidden = false; controls(); q('keep').focus(); } });
  q('keep').addEventListener('click', () => { q('cancel-review').hidden = true; controls(); q('cancel').focus(); });
  q('cancel-confirm').addEventListener('click', () => run(() => act('cancel')));
  q('close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close',clearDialog);
  q('refresh').addEventListener('click', () => run(() => loadHistory()));
  q('more').addEventListener('click', () => run(() => loadHistory(true)));
  window.addEventListener('ezkart:wallet-unavailable', event => {
    report = null; checking = event.detail?.checking === true; unavailableMessage = event.detail?.message || 'Refresh Wallet to check withdrawal availability.';
    if (!initialized) q('history-status').textContent = unavailableMessage;
    controls();
  });
  window.addEventListener('ezkart:wallet-loaded',event => {
    if (stopped) return;
    report = event.detail; controls();
    if (!initialized) { initialized = true; void run(() => loadHistory()); }
  });
})();
