<?php
declare(strict_types=1);
if (!isset($authenticated) || !$authenticated) { http_response_code(404); exit; }
?>
<main class="dashboard page-canvas commerce-dashboard" data-commerce-dashboard data-preview="<?= ez_config('commerce_storage') === 'd1' ? '0' : '1' ?>">
  <header class="page-heading"><div><h1>Dashboard</h1><p>Manage orders and track your store's performance.</p></div></header>
  <p class="commerce-dashboard-notice" data-dashboard-availability role="status" hidden></p>
  <?php if ($catalogError !== ''): ?><p class="dashboard-data-error" role="alert"><?= ez_admin_escape($catalogError) ?></p><?php endif; ?>
  <section class="order-overview" aria-labelledby="central-order-overview-title">
    <header class="order-overview-header"><div><h2 id="central-order-overview-title">Orders to manage</h2><p>Current operations across all dates.</p></div><a data-dashboard-orders href="?page=orders">View all orders <?= ez_admin_icon('chevron-right') ?></a></header>
    <div class="order-queue-grid">
    <?php foreach (['needs-processing'=>['Needs processing','Paid and awaiting acceptance','cart'],'processing'=>['Being processed','Preparing or awaiting pickup','box'],'shipped'=>['Shipped','With the courier','truck'],'attention'=>['Needs review','Payment, stock or delivery issues','help']] as $key=>$info): ?>
      <a class="order-queue-card" data-dashboard-queue-link="<?= $key ?>" href="?page=orders&amp;queue=<?= $key ?>"><span class="order-queue-icon"><?= ez_admin_icon($info[2]) ?></span><div><h3><?= $info[0] ?></h3><strong data-dashboard-queue="<?= $key ?>">—</strong><p><?= $info[1] ?></p></div><?= ez_admin_icon('chevron-right','order-queue-arrow') ?></a>
    <?php endforeach; ?>
    </div>
    <p class="commerce-dashboard-note" data-dashboard-queue-note></p>
  </section>
  <section class="sales-performance-heading" aria-labelledby="central-performance-title">
    <div><h2 id="central-performance-title">Sales performance</h2><p>Confirmed payments for orders created in the selected period.</p></div>
    <form class="dashboard-period" data-dashboard-filters>
      <label><span>Period</span><select name="range" aria-label="Dashboard date range"><?php foreach (['7'=>'Last 7 days','30'=>'Last 30 days','90'=>'Last 90 days','all'=>'All time'] as $value=>$label): ?><option value="<?= $value ?>" <?= $value === '30' ? 'selected' : '' ?>><?= $label ?></option><?php endforeach; ?></select></label>
      <label><span>Chart</span><select name="group" aria-label="Chart grouping"><?php foreach (['daily'=>'Daily','weekly'=>'Weekly','monthly'=>'Monthly','yearly'=>'Yearly'] as $value=>$label): ?><option value="<?= $value ?>"><?= $label ?></option><?php endforeach; ?></select></label>
      <button type="submit" class="ui-button primary">Apply period</button><button type="button" class="ui-button" data-dashboard-refresh>Refresh</button>
    </form>
  </section>
  <p class="commerce-dashboard-message" data-dashboard-status role="status">Loading performance…</p>
  <div data-dashboard-report hidden>
    <p class="dashboard-data-note" data-dashboard-period></p>
    <section class="kpi-grid" aria-label="Store performance">
    <?php foreach (['confirmedAmount'=>['Confirmed payments','Gross order payments, before fees or refunds','money'],'orders'=>['Orders','Created in selected period','cart'],'paymentRate'=>['Payment rate','Orders with a verified payment / all orders','trend'],'averageAmount'=>['Average paid order','Across orders with a verified payment','chart'],'pendingOrders'=>['Awaiting payment','Creating or pending checkouts','credit-card'],'additionalAmount'=>['Additional payments','Separate captures requiring reconciliation','help']] as $key=>$info): ?>
      <article><span class="kpi-icon"><?= ez_admin_icon($info[2]) ?></span><div><small><?= $info[0] ?></small><strong data-dashboard-value="<?= $key ?>">—</strong><p><?= $info[1] ?></p></div></article>
    <?php endforeach; ?>
    </section>
    <section class="commerce-dashboard-main">
      <article class="panel commerce-dashboard-chart-panel"><header class="panel-header"><div><h2>Payment trend</h2><p data-dashboard-chart-note></p></div></header>
        <div class="commerce-dashboard-chart" data-dashboard-chart></div>
        <details class="commerce-dashboard-chart-data"><summary>View chart values</summary><div class="commerce-dashboard-table" tabindex="0" role="region" aria-label="Chart values"><table><thead><tr><th>Period starting</th><th>Confirmed payments</th><th>Paid orders</th></tr></thead><tbody data-dashboard-chart-values></tbody></table></div></details>
      </article>
      <article class="panel"><header class="panel-header"><div><h2>Recent orders</h2><p>Latest five in this period.</p></div><a data-dashboard-period-orders href="?page=orders">View orders</a></header>
        <div class="commerce-dashboard-table" tabindex="0" role="region" aria-label="Recent orders, scroll for more columns"><table><thead><tr><th>Order / customer</th><th>Items</th><th>Payment</th><th>Total</th><th>Created</th></tr></thead><tbody data-dashboard-recent></tbody></table></div>
      </article>
    </section>
    <section class="commerce-dashboard-grid">
      <article class="panel"><header class="panel-header"><div><h2>Top selling products</h2><p>Saved item prices from paid orders.</p></div><a href="?page=products">Open catalog</a></header><ol class="commerce-dashboard-ranked" data-dashboard-products></ol><footer class="commerce-dashboard-card-footer"><span data-dashboard-paid-units></span><span><?= $activeCatalogCount === null ? 'Catalog unavailable' : $activeCatalogCount . ' active products' ?></span></footer></article>
      <article class="panel"><header class="panel-header"><h2>Order status</h2><a data-dashboard-period-orders href="?page=orders">View orders</a></header><ul class="commerce-dashboard-statuses" data-dashboard-states></ul></article>
      <article class="panel"><header class="panel-header"><div><h2>Order amounts</h2><p>Gross values, with unpaid orders separate.</p></div></header><dl class="commerce-dashboard-amounts" data-dashboard-amounts></dl><p class="commerce-dashboard-note">Fees, refunds and available wallet funds are calculated separately.</p></article>
      <article class="panel"><header class="panel-header"><h2>Customer activity</h2><small>Order history</small></header><ul class="commerce-dashboard-activity" data-dashboard-activity></ul></article>
      <article class="panel"><header class="panel-header"><div><h2>Catalog activity</h2><p>Units ordered across all payment states.</p></div></header><ol class="commerce-dashboard-ranked" data-dashboard-catalog></ol><footer class="commerce-dashboard-card-footer" data-dashboard-ordered-units></footer></article>
      <article class="panel"><header class="panel-header"><h2>Fulfillment pulse</h2><a href="?page=fulfillment">Open fulfillment</a></header><dl class="commerce-dashboard-amounts" data-dashboard-fulfillment></dl><p class="commerce-dashboard-note">Booking counts refer to the latest courier attempt. A booking is not delivery evidence.</p></article>
    </section>
  </div>
  <section class="commerce-dashboard-grid commerce-dashboard-store">
    <article class="panel reviews-panel"><header class="panel-header"><h2>Customer reviews</h2><a href="?page=customers&amp;tab=reviews">Open reviews</a></header><div class="review-body"><div><strong><?= $reviewAverage === null ? '—' : number_format($reviewAverage,1) ?></strong><p><?= $catalogError !== '' ? 'Reviews unavailable' : ($reviewCount > 0 ? number_format($reviewCount) . ' published reviews' : 'No published reviews yet') ?></p><small>All-time catalog ratings</small></div></div></article>
    <article class="panel storefront-panel"><header class="panel-header"><h2>Landing pages &amp; domain</h2><a href="?page=sites">Manage pages</a></header><div class="storefront-summary"><span class="storefront-preview"><?= ez_admin_icon('layout') ?><i data-landing-page-state>Loading</i></span><div><b data-landing-page-summary>Loading landing pages</b><p data-landing-page-detail>Checking saved pages…</p></div></div></article>
  </section>
</main>
