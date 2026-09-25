(() => {
  const base = '/v1/commerce/payments';
  const fields = ['q', 'state', 'evidence', 'review', 'method', 'from', 'to'];
  const allFields = ['state', 'evidence', 'review'];
  const reference = /^EZK-[SP]-[A-F0-9]{24}$/;
  const money = value => value == null ? '—' : new Intl.NumberFormat('id-ID', {style:'currency', currency:'IDR', maximumFractionDigits:0}).format(BigInt(value));
  const date = value => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('en-GB', {dateStyle:'medium', timeStyle:'short', timeZone:'Asia/Jakarta'}).format(new Date(value)) + ' WIB' : '—';
  const label = value => String(value || '').replaceAll('_', ' ').replace(/^./, s => s.toUpperCase());
  const events = {'payment.instructions':'Payment instructions saved', 'payment.succeeded':'Payment confirmed', 'payment.failed':'Payment failed'};
  const outcomes = {succeeded:'Completed', retry:'Retry scheduled', uncertain:'Confirmation needed', dead:'Needs investigation', cancelled:'Cancelled'};
  const el = (tag, text, className = '') => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = String(text);
    if (className) node.className = className;
    return node;
  };
  const button = (text, action) => {
    const node = el('button', text, 'ui-button'); node.type = 'button'; node.addEventListener('click', action); return node;
  };
  function mount({request}) {
    const root = document.querySelector('[data-commerce-payments]');
    if (!root || root.dataset.mounted) return;
    root.dataset.mounted = '1';
    const q = selector => root.querySelector(selector), form = q('[data-payments-filters]');
    const rows = q('[data-payments-rows]'), detail = q('[data-payments-detail]'), globalSearch = document.getElementById('global-search');
    const api = path => request('GET', path, undefined, {timeoutMs:15000});
    let listVersion = 0, detailVersion = 0, selected = '', cursor = null, next = null, previous = null, loading = false, loaded = false, filters = {};
    const formFilters = () => Object.fromEntries(fields.map(field => [field, form.elements[field].value.trim()]));
    const message = (selector, text) => { q(selector).textContent = text; q(selector).hidden = !text; };
    const ensureMethod = value => {
      if (value && !Array.from(form.elements.method.options).some(o => o.value === value)) form.elements.method.add(new Option(label(value), value));
    };
    function pageControls() {
      q('[data-payments-previous]').disabled = loading || !previous;
      q('[data-payments-next]').disabled = loading || !next;
      rows.setAttribute('aria-busy', String(loading));
    }
    function urlUpdate(push = false) {
      const url = new URL(location.href);
      for (const field of fields) {
        const value = filters[field];
        if (value && !(allFields.includes(field) && value === 'all')) url.searchParams.set(field, value); else url.searchParams.delete(field);
      }
      if (cursor) url.searchParams.set('cursor', cursor); else url.searchParams.delete('cursor');
      if (selected) url.searchParams.set('order', selected); else url.searchParams.delete('order');
      history[push ? 'pushState' : 'replaceState']({}, '', url);
    }
    function clearSummary() {
      for (const node of root.querySelectorAll('[data-payments-total]')) { node.textContent = '—'; delete node.closest('article').dataset.wideMoney; }
      message('[data-payments-summary-detail="paidOrders"]', 'Orders with a verified payment');
      message('[data-payments-summary-detail="awaitingAmount"]', 'Unpaid orders still awaiting payment');
      q('[data-payments-methods]').replaceChildren();
      q('[data-payments-method-note]').textContent = '';
      q('[data-payments-count]').textContent = '';
      q('[data-payments-period]').textContent = 'Loading totals for the selected dates…';
    }
    function readUrl() {
      const query = new URLSearchParams(location.search);
      ensureMethod(query.get('method'));
      for (const field of fields) {
        form.elements[field].value = query.get(field) || (allFields.includes(field) ? 'all' : '');
        form.elements[field].dispatchEvent(new Event('change', {bubbles:true}));
      }
      filters = formFilters(); if (globalSearch) globalSearch.value = filters.q;
      cursor = query.get('cursor') || null; next = null; previous = null; loaded = false; rows.replaceChildren(); clearSummary();
      return query.get('order');
    }
    function closeDetail(update = true) {
      detailVersion++; selected = ''; detail.hidden = true; q('[data-payments-detail-content]').replaceChildren();
      rows.querySelectorAll('[data-payment-open]').forEach(n => n.setAttribute('aria-expanded', 'false'));
      if (update) urlUpdate();
    }
    function renderSummary(data) {
      const summary = data.summary;
      for (const node of root.querySelectorAll('[data-payments-total]')) {
        const key = node.dataset.paymentsTotal, isMoney = !['paidOrders', 'needsReview'].includes(key);
        node.textContent = isMoney ? money(summary[key]) : summary[key].toLocaleString();
        node.closest('article').dataset.wideMoney = String(isMoney && String(summary[key] || '').length > 12);
      }
      message('[data-payments-summary-detail="paidOrders"]', `${summary.paidOrders.toLocaleString()} of ${summary.orders.toLocaleString()} orders · ${summary.paymentRate == null ? '—' : summary.paymentRate.toFixed(1) + '%'} paid`);
      message('[data-payments-summary-detail="awaitingAmount"]', `${summary.awaitingOrders.toLocaleString()} unpaid orders awaiting payment`);
      q('[data-payments-period]').textContent = `${data.period.from || data.period.to ? (data.period.from || 'All dates') + (data.period.to ? ' through ' + data.period.to : ' onward') : 'All order creation dates'} · Jakarta time`;
      message('[data-payments-availability]', data.enabled && root.dataset.preview !== '1' ? '' : 'Order processing is not enabled for this store yet.');
      const methods = q('[data-payments-methods]'), draftMethod = form.elements.method.value;
      methods.replaceChildren(); form.elements.method.replaceChildren(new Option('All methods', ''));
      for (const item of data.methods) {
        ensureMethod(item.method);
        const row = button('', () => {
          form.elements.method.value = item.method;
          form.elements.method.dispatchEvent(new Event('change', {bubbles:true}));
          form.requestSubmit();
        });
        row.className = 'commerce-payment-method'; row.setAttribute('aria-label', 'Filter by ' + label(item.method));
        const share = summary.orders ? 100 * item.orders / summary.orders : 0, bar = el('span', undefined, 'commerce-payment-share'), fill = el('i');
        fill.style.width = share + '%'; bar.setAttribute('aria-hidden', 'true'); bar.append(fill);
        row.append(el('b', label(item.method)), el('small', `${item.orders.toLocaleString()} orders · ${share.toFixed(1)}%`), bar); methods.append(row);
      }
      ensureMethod(draftMethod); form.elements.method.value = draftMethod;
      form.elements.method.dispatchEvent(new Event('change', {bubbles:true}));
      q('[data-payments-method-note]').textContent = data.otherMethodOrders > 0
        ? `Showing the 20 most used methods. ${data.otherMethodOrders.toLocaleString()} orders use other methods; search by method or open Payment reports for the complete breakdown.`
        : data.methods.length ? 'Choose a method to filter the payment history.' : 'Payment methods will appear with your first orders.';
      const report = new URLSearchParams({page:'analytics', report:'payments', range:filters.from && filters.to ? 'custom' : 'all'});
      if (filters.from && filters.to) { report.set('from', filters.from); report.set('to', filters.to); }
      if (root.dataset.preview === '1') report.set('analytics-preview', '1');
      for (const link of [q('[data-payments-report]'), document.querySelector('.page-heading a[href*="page=analytics"]')]) if (link) link.href = '?' + report;
    }
    function renderRows(items) {
      rows.replaceChildren();
      for (const item of items) {
        const row = el('tr'), order = el('td'), open = button(item.id, () => void loadDetail(item.id, true));
        open.className = 'order-link'; open.dataset.paymentOpen = item.id;
        open.setAttribute('aria-expanded', String(selected === item.id)); open.setAttribute('aria-controls', 'commerce-payment-detail');
        order.append(open, el('small', date(item.createdAt)), el('small', item.primaryReference || 'No verified reference'));
        const customer = el('td'); customer.append(el('b', item.customerName || 'Customer'), el('small', item.customerEmail));
        const status = el('td'); status.append(el('span', label(item.state), 'commerce-order-badge' + (item.state === 'paid' ? ' good' : '')));
        if (item.needsReview) status.append(el('small', 'Needs review', 'commerce-payment-attention'));
        const verified = el('td'); verified.append(el('b', BigInt(item.confirmed) > 0n ? money(item.confirmed) : 'Not verified'));
        if (BigInt(item.additional) > 0n) verified.append(el('small', money(item.additional) + ' additional'));
        row.append(order, customer, el('td', label(item.method)), status, el('td', money(item.total)), verified); rows.append(row);
      }
    }
    async function loadList({reset = false, push = false, applyFilters = false, targetCursor = cursor} = {}) {
      const version = ++listVersion;
      if (reset) {
        if (applyFilters) filters = formFilters();
        cursor = null; targetCursor = null; previous = null; next = null; rows.replaceChildren(); loaded = false; clearSummary();
      }
      loading = true; pageControls(); message('[data-payments-list-status]', loaded ? 'Updating payments…' : 'Loading payments…');
      const query = new URLSearchParams({limit:'25'});
      for (const field of fields) if (filters[field]) query.set(field, filters[field]);
      if (targetCursor) query.set('cursor', targetCursor);
      try {
        const data = await api(base + '?' + query); if (version !== listVersion) return;
        if (!Array.isArray(data.items) || !Array.isArray(data.methods) || !data.summary || !data.period || typeof data.pageCursor !== 'string') throw Error('The payment response was incomplete.');
        renderSummary(data); renderRows(data.items); next = data.nextCursor; previous = data.previousCursor; cursor = data.pageCursor; loaded = true;
        message('[data-payments-list-status]', data.items.length ? '' : data.matching === 0 ? 'No payments match these filters.' : 'No more records in this view. Refresh to include status changes.');
        q('[data-payments-count]').textContent = `${data.items.length} shown · ${data.matching.toLocaleString()} matching orders`;
        urlUpdate(push);
      } catch (error) {
        if (version === listVersion) message('[data-payments-list-status]', `${error.message || 'Payments could not be loaded.'} Use Refresh payments to try again.${loaded ? ' Previously loaded payments are still shown.' : ''}`);
      } finally { if (version === listVersion) { loading = false; pageControls(); } }
    }
    function card(title, lines) {
      const node = el('article', undefined, 'commerce-order-card'); node.append(el('h3', title));
      for (const line of lines) if (line) node.append(el('p', line));
      return node;
    }
    function historySection(kind, data, id, version) {
      const titles = {captures:'Verified payment history', attempts:'Payment request history', events:'Payment activity'};
      const section = el('section', undefined, 'commerce-payment-history'), list = el('ol', undefined, 'commerce-order-history');
      section.dataset.paymentHistory = kind; section.append(el('h3', titles[kind]), list);
      let nextCursor = data.nextCursor, busy = false;
      const append = items => {
        for (const item of items) {
          const row = el('li'); row.dataset.historyId = item.id;
          if (kind === 'captures') {
            row.append(el('b', money(item.amount) + (item.kind === 'order_payment' ? ' · Order payment' : ' · Additional payment')),
              el('small', `${label(item.provider)} · ${item.reference}`));
          } else if (kind === 'attempts') {
            row.append(el('b', `${item.mode === 'reconcile' ? 'Status check' : 'Payment request'} · Attempt ${item.attempt} · ${outcomes[item.outcome] || label(item.outcome) || 'In progress'}`),
              el('small', 'Request ' + item.requestId), el('small', item.finishedAt ? 'Finished ' + date(item.finishedAt) : 'No completion recorded'));
          } else row.append(el('b', events[item.type] || label(item.type.replace(/^payment\./, ''))), el('small', 'Order update ' + item.revision));
          const time = el('time', date(item.createdAt)); time.dateTime = item.createdAt; row.append(time); list.append(row);
        }
      };
      append(data.items);
      if (!data.items.length) section.append(el('p', kind === 'captures' ? 'No verified payments recorded.' : kind === 'attempts' ? 'No payment requests recorded.' : 'No payment activity recorded.', 'commerce-payment-muted'));
      const status = el('p', '', 'commerce-payment-muted'); status.setAttribute('role', 'status');
      const more = button('Load older entries', async () => {
        if (busy || !nextCursor || version !== detailVersion) return;
        busy = true; more.disabled = true; status.textContent = 'Loading history…';
        try {
          const result = await api(base + '/' + id + '/' + kind + '?' + new URLSearchParams({limit:'20', cursor:nextCursor}));
          if (version !== detailVersion) return;
          if (!Array.isArray(result.items) || (result.nextCursor && result.nextCursor === nextCursor)) throw Error('The history response was incomplete.');
          append(result.items); nextCursor = result.nextCursor; more.hidden = !nextCursor; status.textContent = '';
        } catch (error) { if (version === detailVersion) status.textContent = (error.message || 'History could not be loaded.') + ' Try Load older entries again.'; }
        finally { busy = false; more.disabled = false; }
      });
      more.hidden = !nextCursor; section.append(status, more); return section;
    }
    function renderDetail(data, version) {
      const order = data.order, content = q('[data-payments-detail-content]');
      if (!order || !Array.isArray(data.operations) || !['captures', 'attempts', 'events'].every(k => Array.isArray(data[k]?.items))) throw Error('The payment details were incomplete.');
      q('#commerce-payment-detail-title').textContent = 'Payment · ' + (order.customerName || 'Customer');
      const columns = el('div', undefined, 'commerce-order-columns');
      columns.append(card('Customer', [order.customerName || 'Customer', order.customerEmail]),
        card('Order payment', [label(order.state), 'Created ' + date(order.createdAt), 'Verified ' + date(order.verifiedAt), 'Expires ' + date(order.expiresAt)]),
        card('Provider request', data.session ? [label(data.session.provider), label(data.session.method), data.session.reference, 'Created ' + date(data.session.createdAt), 'Expires ' + date(data.session.expiresAt)] : ['No payment instructions recorded.']));
      content.append(columns);
      if (order.needsReview) content.append(el('p', BigInt(order.additional) > 0n
        ? 'Additional payments need review. They are recorded separately from the primary order payment.'
        : 'This payment needs review. Check the provider confirmation before requesting another payment.', 'commerce-orders-notice'));
      const totals = el('dl', undefined, 'commerce-order-totals');
      for (const [name, amount] of [['Items', order.subtotal], ['Shipping', order.shipping], ['Order total', order.total], ['Verified order payment', order.confirmed], ['Additional payments', order.additional]]) {
        const row = el('div'); row.append(el('dt', name), el('dd', money(amount))); totals.append(row);
      }
      content.append(totals, el('p', 'These are gross payment amounts, before fees and refunds. Check Wallet for available funds.', 'commerce-payment-muted'));
      const actions = el('div', undefined, 'commerce-order-buttons'), link = el('a', 'Open order', 'ui-button');
      const orderQuery = new URLSearchParams({page:'orders', order:order.id}); if (root.dataset.preview === '1') orderQuery.set('order-preview', '1');
      link.href = '?' + orderQuery; actions.append(link); content.append(actions);
      const operations = el('section'); operations.append(el('h3', 'Payment requests'));
      for (const item of data.operations) operations.append(el('p', `${outcomes[item.state] || (item.state === 'running' ? 'In progress' : label(item.state))}: ${item.count} requests · ${item.attempts} attempts${item.timedOut ? ' · ' + item.timedOut + ' overdue; confirmation needed' : ''}`, 'commerce-payment-muted'));
      if (!data.operations.length) operations.append(el('p', 'No payment requests recorded.', 'commerce-payment-muted'));
      content.append(operations, ...['captures', 'attempts', 'events'].map(kind => historySection(kind, data[kind], order.id, version)));
    }
    async function loadDetail(id, focus = false) {
      if (!reference.test(id || '')) return;
      const version = ++detailVersion; selected = id; detail.hidden = false; q('[data-payments-detail-content]').replaceChildren();
      q('#commerce-payment-detail-title').textContent = 'Payment details'; q('[data-payments-reference]').textContent = id;
      message('[data-payments-detail-status]', 'Loading payment…'); urlUpdate(focus);
      rows.querySelectorAll('[data-payment-open]').forEach(n => n.setAttribute('aria-expanded', String(n.dataset.paymentOpen === id)));
      if (focus) { q('#commerce-payment-detail-title').focus({preventScroll:true}); detail.scrollIntoView({block:'start', behavior:matchMedia('(prefers-reduced-motion:reduce)').matches ? 'instant' : 'smooth'}); }
      try { const data = await api(base + '/' + id); if (version !== detailVersion) return; renderDetail(data, version); message('[data-payments-detail-status]', ''); }
      catch (error) { if (version === detailVersion) { q('[data-payments-detail-content]').replaceChildren(); message('[data-payments-detail-status]', (error.message || 'Payment details could not be loaded.') + ' Use Reload details to try again.'); } }
    }
    form.addEventListener('submit', event => { event.preventDefault(); if (globalSearch) globalSearch.value = form.elements.q.value; closeDetail(false); void loadList({reset:true, push:true, applyFilters:true}); });
    q('[data-payments-clear]').addEventListener('click', () => {
      form.reset(); for (const field of [...allFields, 'method']) form.elements[field].dispatchEvent(new Event('change', {bubbles:true}));
      if (globalSearch) globalSearch.value = ''; closeDetail(false); void loadList({reset:true, push:true, applyFilters:true});
    });
    q('[data-payments-refresh]').addEventListener('click', () => { void loadList({reset:true}); if (selected) void loadDetail(selected); });
    q('[data-payments-next]').addEventListener('click', () => { if (!loading && next) void loadList({targetCursor:next, push:true}); });
    q('[data-payments-previous]').addEventListener('click', () => { if (!loading && previous) void loadList({targetCursor:previous, push:true}); });
    q('[data-payments-detail-reload]').addEventListener('click', () => void loadDetail(selected));
    q('[data-payments-detail-close]').addEventListener('click', () => { const id = selected; closeDetail(); (rows.querySelector(`[data-payment-open="${id}"]`) || q('[data-payments-refresh]')).focus(); });
    addEventListener('popstate', () => { closeDetail(false); const id = readUrl(); void loadList(); if (reference.test(id || '')) void loadDetail(id); });
    const id = readUrl();
    if (globalSearch) {
      globalSearch.placeholder = 'Search payments · press Enter'; globalSearch.value = form.elements.q.value;
      globalSearch.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); form.elements.q.value = globalSearch.value; form.requestSubmit(); } });
    }
    void loadList(); if (reference.test(id || '')) void loadDetail(id);
  }
  globalThis.EzkartCommercePayments = {mount};
})();
