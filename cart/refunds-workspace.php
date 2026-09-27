<?php if (!isset($refundAudience)) { http_response_code(404); exit; } ?>
<section class="refunds-workspace tracking-card" data-refunds data-audience="<?= htmlspecialchars($refundAudience, ENT_QUOTES, 'UTF-8') ?>" data-order="<?= htmlspecialchars($refundOrderId, ENT_QUOTES, 'UTF-8') ?>" data-account="<?= htmlspecialchars($refundAccount, ENT_QUOTES, 'UTF-8') ?>" data-store="<?= htmlspecialchars($refundStore, ENT_QUOTES, 'UTF-8') ?>" data-csrf="<?= htmlspecialchars($refundCsrf, ENT_QUOTES, 'UTF-8') ?>" data-version="<?= htmlspecialchars($refundVersion, ENT_QUOTES, 'UTF-8') ?>" aria-labelledby="refund-title">
  <header><div><h2 id="refund-title">Refund requests</h2><p>Choose the purchase amounts to review and follow the store’s decision.</p></div><div class="refund-buttons"><button type="button" data-refund-refresh>Refresh refunds</button><button type="button" data-refund-new>Request a refund</button></div></header>
  <p data-refund-status role="status">Loading refund requests…</p><p data-refund-error role="alert" hidden></p>
  <section data-refund-recovery hidden aria-label="Saved refund request"></section>
  <form data-refund-lookup hidden><label>Order reference<input name="order" required maxlength="30" placeholder="EZK-S-…" autocomplete="off"></label><button type="submit">Find order</button></form>
  <form data-refund-form hidden><h3>Request a refund</h3><p data-refund-order></p>
    <label>Reason<select name="reason"><option value="not_received">Not received</option><option value="damaged">Damaged item</option><option value="wrong_item">Wrong item</option><option value="not_as_described">Not as described</option><option value="file_problem">Problem with a digital file</option><option value="changed_mind">Changed mind</option><option value="other">Other reason</option></select></label>
    <label>What happened?<textarea name="note" required minlength="3" maxlength="2000" rows="3"></textarea></label>
    <p>Enter whole rupiah for the items you want reviewed. Leave other amounts at zero.</p><div data-refund-amounts></div>
    <p class="refund-total" data-refund-total></p><p>Submitting asks the store to review these amounts. A payment confirmation will be shown separately when a refund is processed.</p>
    <div class="refund-buttons"><button type="submit" data-refund-submit>Submit refund request</button><button type="button" data-refund-cancel>Cancel</button></div>
  </form>
  <div class="refund-list-heading"><h3>Request history</h3><label>Show<select data-refund-filter><option value="all">All requests</option><option value="open">Needs follow-up</option><option value="requested">Awaiting review</option><option value="approved">Approved, awaiting refund</option><option value="declined">Declined</option><option value="withdrawn">Withdrawn</option></select></label></div>
  <div data-refund-list></div><button type="button" data-refund-more hidden>Load more requests</button>
  <section data-refund-detail hidden aria-label="Refund request details"></section>
  <noscript><p>Enable JavaScript to manage refund requests.</p></noscript>
</section>
