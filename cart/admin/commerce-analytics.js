(() => {
  function csvCell(value) {
    let text = value == null ? '' : String(value);
    // Check a normalized form for invisible prefixes and compatibility signs;
    // preserve the original text after making a risky string a literal cell.
    if (typeof value === 'string' && /^(?:[\p{White_Space}\p{Cf}\u0000-\u001f]*[=+@-]|[\t\r\n])/u.test(text.normalize('NFKC'))) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  }
  const csvRow = cells => cells.map(csvCell).join(',') + '\r\n';
  function mount({request}) {
    const root = document.querySelector('[data-commerce-analytics]');
    if (!root || root.dataset.mounted) return;
    root.dataset.mounted = '1';
    const button = root.querySelector('button'), status = root.querySelector('[role=status]');
    const requestKey = Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join('');
    let snapshot = null, busy = false;
    button.disabled = false;
    button.addEventListener('click', async () => {
      if (busy) return;
      busy = true; button.disabled = true; status.textContent = 'Preparing your complete report…';
      try {
        if (!snapshot) {
          const result = await request('POST', '/v1/commerce/analytics/exports', {report:root.dataset.report, cohort:root.dataset.cohort, requestKey});
          snapshot = result.export;
        }
        if (!snapshot || !/^aex_[a-f0-9]{40}$/.test(snapshot.id) || !Number.isSafeInteger(snapshot.rowCount) || snapshot.rowCount < 0) throw Error('The export receipt is incomplete. Retry the download.');
        const parts = ['\uFEFF', csvRow(['Report', snapshot.report]), csvRow(['Order creation dates (Asia/Jakarta)', snapshot.period.from, snapshot.period.to]),
          csvRow(['Snapshot created (UTC)', snapshot.createdAt]), csvRow(['Currency', 'IDR']), '\r\n', csvRow(snapshot.headers)];
        let after = 0;
        do {
          const result = await request('GET', '/v1/commerce/analytics/exports/' + snapshot.id + '?after=' + after + '&limit=500');
          if (result.export?.id !== snapshot.id || result.export?.rowCount !== snapshot.rowCount || !Array.isArray(result.rows)
            || result.rows.some((r,i) => r.ordinal !== after+i+1 || !Array.isArray(r.cells))) throw Error('The export is incomplete. Retry the download.');
          for (const row of result.rows) parts.push(csvRow(row.cells));
          after += result.rows.length;
          if (after > snapshot.rowCount || (result.nextAfter !== null && (result.nextAfter !== after || !result.rows.length))
            || (result.nextAfter === null && after !== snapshot.rowCount)) throw Error('The export is incomplete. Retry the download.');
          status.textContent = `Preparing ${after.toLocaleString()} of ${snapshot.rowCount.toLocaleString()} rows…`;
        } while (after < snapshot.rowCount);
        const href = URL.createObjectURL(new Blob(parts, {type:'text/csv;charset=utf-8'}));
        const link = document.createElement('a'); link.href = href; link.download = snapshot.filename; document.body.append(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(href), 60000);
        status.textContent = `Downloaded all ${snapshot.rowCount.toLocaleString()} rows. This snapshot is available for 24 hours.`;
        button.textContent = 'Download again';
      } catch (error) {
        status.textContent = (error.message || 'The export could not be downloaded.') + ' No partial file was saved.';
        button.textContent = 'Retry export';
      } finally { busy = false; button.disabled = false; }
    });
  }
  globalThis.EzkartCommerceAnalytics = {mount};
})();
