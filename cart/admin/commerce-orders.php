<?php
declare(strict_types=1);
if (!isset($authenticated) || !$authenticated) { http_response_code(404); exit; }
ez_page_header('Orders', 'Find every order and review its payment and delivery progress.', [
    ['label'=>'Fulfillment','icon'=>'truck','href'=>'?page=fulfillment'],
    ['label'=>'Returns','icon'=>'undo','href'=>'?page=returns'],
]);
?>
<section class="commerce-orders" data-commerce-orders data-preview="<?= ez_config('commerce_storage') === 'd1' ? '0' : '1' ?>">
  <p class="commerce-orders-notice" data-orders-availability role="status" hidden></p>
  <section class="page-stat-strip" aria-label="All order totals">
    <?php foreach (['total'=>['Orders','All saved orders'],'paid'=>['Paid orders','At least one verified order payment'],'confirmedAmount'=>['Confirmed payments','Order payments, before fees or refunds'],'needsReview'=>['Needs review','Payment, stock or delivery issues']] as $key=>$labels): ?>
    <article><div><small><?= $labels[0] ?></small><strong data-orders-total="<?= $key ?>">—</strong><p><?= $labels[1] ?></p></div></article>
    <?php endforeach; ?>
  </section>
  <section class="surface commerce-order-list" aria-labelledby="commerce-order-list-title">
    <header class="surface-header"><div><h2 id="commerce-order-list-title">Order manager</h2><p>Search the complete history. Dates use Jakarta time.</p></div><button class="ui-button" type="button" data-orders-refresh>Refresh orders</button></header>
    <form class="commerce-order-filters" data-orders-filters>
      <label class="commerce-order-search"><span>Search</span><input type="search" name="q" maxlength="120" placeholder="Order, customer, product or SKU"></label>
      <label><span>Payment status</span><select name="state" aria-label="Payment status"><option value="all">All statuses</option><?php foreach (['creating'=>'Creating','pending'=>'Pending','paid'=>'Paid','expired'=>'Expired','failed'=>'Failed','cancelled'=>'Cancelled','partially_refunded'=>'Partially refunded','refunded'=>'Refunded'] as $key=>$label): ?><option value="<?= $key ?>"><?= $label ?></option><?php endforeach; ?></select></label>
      <label><span>Fulfillment</span><select name="queue" aria-label="Fulfillment queue"><option value="all">All stages</option><?php foreach (['needs-processing'=>'Needs processing','processing'=>'Being processed','shipped'=>'Shipped','delivered'=>'Delivered','attention'=>'Needs review','not-required'=>'Delivery not required'] as $key=>$label): ?><option value="<?= $key ?>"><?= $label ?></option><?php endforeach; ?></select></label>
      <label><span>From</span><input type="date" name="from" aria-label="Orders from date"></label>
      <label><span>Through</span><input type="date" name="to" aria-label="Orders through date"></label>
      <div class="commerce-order-filter-buttons"><button class="ui-button primary" type="submit">Apply filters</button><button class="ui-button" type="button" data-orders-clear>Clear filters</button></div>
    </form>
    <p class="commerce-orders-message" data-orders-list-status role="status">Loading orders…</p>
    <div class="commerce-order-table" tabindex="0" role="region" aria-label="Orders, scroll horizontally for more columns"><table><thead><tr><th>Order</th><th>Customer</th><th>Items</th><th>Payment</th><th>Fulfillment</th><th>Total</th><th>Created</th></tr></thead><tbody data-orders-rows></tbody></table></div>
    <footer class="commerce-order-paging"><p data-orders-count></p><nav aria-label="Order pages"><button class="ui-button" type="button" data-orders-previous disabled>Previous</button><button class="ui-button" type="button" data-orders-next disabled>Next</button></nav></footer>
    <p class="commerce-orders-note">Status changes remain live. Refresh to include orders created since this list opened.</p>
  </section>
  <section class="surface commerce-order-detail" data-orders-detail hidden aria-labelledby="commerce-order-detail-title">
    <header class="surface-header"><div><h2 id="commerce-order-detail-title" tabindex="-1">Order details</h2><p data-orders-reference></p></div><div class="commerce-order-buttons"><button class="ui-button" type="button" data-orders-detail-reload>Reload details</button><button class="ui-button" type="button" data-orders-detail-close>Close details</button></div></header>
    <p data-orders-detail-status role="status" class="commerce-orders-message"></p>
    <div data-orders-detail-content></div>
  </section>
</section>
