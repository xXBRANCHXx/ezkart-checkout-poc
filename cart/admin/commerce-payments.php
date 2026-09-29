<?php
declare(strict_types=1);
if (!isset($authenticated) || !$authenticated) { http_response_code(404); exit; }
$paymentPreview = ez_config('commerce_storage') !== 'd1';
ez_page_header('Payments', 'Follow every payment from request to confirmation.', [
    ['label'=>'Payment reports','icon'=>'chart','href'=>'?page=analytics&report=payments&range=all' . ($paymentPreview ? '&analytics-preview=1' : '')],
    ['label'=>'View wallet','icon'=>'wallet','href'=>'?page=wallet','style'=>'primary'],
]);
?>
<section class="commerce-orders commerce-payments" data-commerce-payments data-preview="<?= $paymentPreview ? '1' : '0' ?>">
  <p class="commerce-orders-notice" data-payments-availability role="status" hidden></p>
  <p class="commerce-payments-period" data-payments-period>All order creation dates · Jakarta time</p>
  <section class="page-stat-strip" aria-label="Payments in selected dates">
    <?php foreach ([
        'gross'=>['wallet','Confirmed payments','Primary captures, before fees or refunds'],
        'paidOrders'=>['check-circle','Paid orders','Orders with a verified payment'],
        'awaitingAmount'=>['refund','Awaiting payment','Unpaid orders still awaiting payment'],
        'average'=>['chart','Average payment','Per order with a verified payment'],
        'additional'=>['credit-card','Additional payments','Extra captures, excluded from confirmed payments'],
        'needsReview'=>['help','Needs review','Additional payments or unresolved requests'],
    ] as $key=>[$icon,$label,$detail]): ?>
    <article><span class="stat-icon"><?= ez_admin_icon($icon) ?></span><div><small><?= $label ?></small><strong data-payments-total="<?= $key ?>">—</strong><p data-payments-summary-detail="<?= $key ?>"><?= $detail ?></p></div></article>
    <?php endforeach; ?>
  </section>
  <details class="payment-setup">
    <summary><span class="payment-setup-title"><span class="ezpay-logo"><img src="assets/ezpay-logo.png" alt="Ezpay" width="2000" height="1000"></span><span class="payment-environment"><?= $commerceProduction ? 'Live mode' : 'Test mode' ?></span></span><span class="payment-setup-state"><?= $integrationStatus['doku'] ? 'Credentials configured' : 'Setup required' ?><?= ez_admin_icon('chevron-down') ?></span></summary>
    <div class="payment-setup-details"><p><?= $commerceProduction ? 'This workspace uses the production payment environment.' : 'You are viewing sandbox payments. These transactions do not represent live funds.' ?></p><p>Manage your payments and withdrawals with Ezpay.</p><a href="?page=wallet" data-ui-icon="wallet">View wallet</a></div>
  </details>
  <section class="surface" aria-labelledby="commerce-payment-list-title">
    <header class="surface-header"><div><h2 id="commerce-payment-list-title">Payment history</h2><p>Search all orders, provider references, customers, and payment methods.</p></div><button class="ui-button" type="button" data-payments-refresh data-ui-icon="refresh">Refresh payments</button></header>
    <form class="commerce-order-filters commerce-payment-filters" data-payments-filters>
      <label class="commerce-order-search"><span>Search</span><input type="search" name="q" maxlength="120" placeholder="Reference, customer or method"></label>
      <label><span>Payment status</span><select name="state" aria-label="Payment status"><option value="all">All statuses</option><?php foreach (['creating'=>'Creating','pending'=>'Pending','paid'=>'Paid','expired'=>'Expired','failed'=>'Failed','cancelled'=>'Cancelled','partially_refunded'=>'Partially refunded','refunded'=>'Refunded'] as $key=>$label): ?><option value="<?= $key ?>"><?= $label ?></option><?php endforeach; ?></select></label>
      <label><span>Payment confirmation</span><select name="evidence" aria-label="Payment confirmation"><option value="all">All records</option><option value="verified">Verified payment</option><option value="unverified">No verified payment</option><option value="additional">Additional payments</option></select></label>
      <label><span>Review</span><select name="review" aria-label="Payment review"><option value="all">All records</option><option value="yes">Needs review</option><option value="no">No review flagged</option></select></label>
      <label><span>Method</span><select name="method" aria-label="Payment method"><option value="">All methods</option></select></label>
      <label><span>From</span><input type="date" name="from" aria-label="Payments from order date"></label>
      <label><span>Through</span><input type="date" name="to" aria-label="Payments through order date"></label>
      <div class="commerce-order-filter-buttons"><button class="ui-button primary" type="submit" data-ui-icon="sliders">Apply filters</button><button class="ui-button" type="button" data-payments-clear data-ui-icon="undo">Clear filters</button></div>
    </form>
    <p class="commerce-orders-message" data-payments-list-status role="status">Loading payments…</p>
    <div class="commerce-order-table" tabindex="0" role="region" aria-label="Payment history, scroll horizontally for more columns"><table><thead><tr><th scope="col">Order and reference</th><th scope="col">Customer</th><th scope="col">Method</th><th scope="col">Payment status</th><th scope="col">Order total</th><th scope="col">Verified payment</th></tr></thead><tbody data-payments-rows></tbody></table></div>
    <footer class="commerce-order-paging"><p data-payments-count></p><nav aria-label="Payment pages"><button class="ui-button" type="button" data-payments-previous disabled data-ui-icon="arrow-left">Previous</button><button class="ui-button" type="button" data-payments-next disabled data-ui-icon="arrow-right">Next</button></nav></footer>
    <p class="commerce-orders-note">Summary cards and method shares cover all orders in the selected dates. Table filters narrow the history. Payment status stays current; refresh to include new orders.</p>
  </section>
  <section class="surface commerce-order-detail" id="commerce-payment-detail" data-payments-detail hidden aria-labelledby="commerce-payment-detail-title">
    <header class="surface-header"><div><h2 id="commerce-payment-detail-title" tabindex="-1">Payment details</h2><p data-payments-reference></p></div><div class="commerce-order-buttons"><button class="ui-button" type="button" data-payments-detail-reload data-ui-icon="refresh">Reload details</button><button class="ui-button" type="button" data-payments-detail-close data-ui-icon="x">Close details</button></div></header>
    <p class="commerce-orders-message" data-payments-detail-status role="status"></p>
    <div data-payments-detail-content></div>
  </section>
  <section class="surface commerce-payment-methods" aria-labelledby="commerce-payment-methods-title">
    <header class="surface-header"><div><h2 id="commerce-payment-methods-title">Payment methods</h2><p>Share of all checkouts in the selected dates.</p></div><a class="ui-button" data-payments-report href="?page=analytics&amp;report=payments&amp;range=all<?= $paymentPreview ? '&amp;analytics-preview=1' : '' ?>">View payment reports</a></header>
    <div class="commerce-payment-method-list" data-payments-methods></div>
    <p class="commerce-orders-note" data-payments-method-note></p>
  </section>
</section>
