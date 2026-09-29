<?php
declare(strict_types=1);
if (!isset($authenticated) || !$authenticated) { http_response_code(404); exit; }
$customerPreview = ez_config('commerce_storage') !== 'd1';
$customerPreviewQuery = $customerPreview ? '&amp;customer-preview=1' : '';
$customerTab = in_array($_GET['tab'] ?? '', ['reviews','subscriptions'], true) ? $_GET['tab'] : 'directory';
ez_page_header('Customers', 'Customer profiles, purchase history, and saved groups.');
?>
<nav class="customer-page-tabs" aria-label="Customer sections">
  <a href="?page=customers<?= $customerPreviewQuery ?>"<?= $customerTab === 'directory' ? ' aria-current="page"' : '' ?>><?= ez_admin_icon('users') ?>Customer directory</a>
  <a href="?page=customers&amp;tab=reviews<?= $customerPreviewQuery ?>"<?= $customerTab === 'reviews' ? ' aria-current="page"' : '' ?>><?= ez_admin_icon('star') ?>Reviews</a>
  <a data-ui-icon="refresh" href="?page=customers&amp;tab=subscriptions"<?= $customerTab === 'subscriptions' ? ' aria-current="page"' : '' ?>>Subscriptions</a>
</nav>
<?php if ($customerTab === 'subscriptions'): ?><section class="surface" data-merchant-subscriptions><header class="surface-header"><h2>Subscriptions</h2><button class="ui-button" type="button" data-subscription-refresh data-ui-icon="refresh">Refresh subscriptions</button></header><p data-subscription-status role="status"></p><div data-subscription-list></div><button class="ui-button" type="button" data-subscription-more hidden data-ui-icon="arrow-right">Load more subscriptions</button></section><?php return; endif; ?>
<?php if ($customerTab === 'reviews'): ?>
<?php require __DIR__ . '/commerce-reviews.php'; ?>
<?php return; endif; ?>
<section class="commerce-orders commerce-customers" data-commerce-customers data-preview="<?= $customerPreview ? '1' : '0' ?>">
  <p class="commerce-orders-notice" data-customers-availability role="status" hidden></p>
  <section class="page-stat-strip" aria-label="All customer totals">
    <?php foreach (['customers'=>['Customers','Unique checkout email identities'],'gross'=>['Customer value','Verified gross payments, before fees or refunds'],'average'=>['Average customer value','Across all customer profiles'],'markets'=>['Markets','Latest saved delivery locations']] as $key=>[$label,$description]): ?><article title="<?= $description ?>"><div><small><?= $label ?></small><strong data-customers-total="<?= $key ?>">—</strong></div><div class="customer-chart" data-customer-chart="<?= $key ?>" role="img" aria-label="Loading chart"><span class="customer-chart-empty">Loading…</span></div></article><?php endforeach; ?>
  </section>
  <p class="commerce-orders-note" data-customers-unassigned hidden></p>
  <section class="commerce-customer-groups" aria-label="Customer groups">
    <?php foreach (['high_value'=>['High value','Verified payments of at least Rp150.000','highValue'],'one_order'=>['One checkout','Customers with one order','oneOrder'],'repeat'=>['Repeat buyers','At least two verified paid orders','repeatCustomers'],'no_paid'=>['No paid order','No verified payment recorded','noPaid']] as $activity=>[$label,$description,$key]): ?><button type="button" class="surface" data-customers-group="<?= $activity ?>" title="<?= $description ?>"><span><?= $label ?></span><b data-customers-total="<?= $key ?>">—</b><span class="customer-group-meter" aria-hidden="true"><i data-customer-meter="<?= $key ?>"></i></span><small data-customer-share="<?= $key ?>">—</small></button><?php endforeach; ?>
  </section>
  <section class="surface" aria-labelledby="commerce-customer-list-title">
    <header class="surface-header"><div><h2 id="commerce-customer-list-title">Customer directory</h2><p>Search the complete history. Dates use Jakarta time.</p></div><div class="commerce-order-buttons"><button type="button" class="ui-button" data-customers-refresh data-ui-icon="refresh">Refresh customers</button><button type="button" class="ui-button" data-customers-export disabled data-ui-icon="download">Export matching customers</button><button type="button" class="ui-button primary" data-customers-create-segment disabled data-ui-icon="save">Save filters as segment</button></div></header>
    <form class="commerce-order-filters commerce-customer-filters" data-customers-filters>
      <label class="commerce-order-search"><span>Search</span><input type="search" name="q" maxlength="120" placeholder="Name, email or phone"></label>
      <label><span>Customer group</span><select name="activity" aria-label="Customer group"><option value="all">All customers</option><option value="high_value">High value</option><option value="one_order">One checkout</option><option value="repeat">Repeat paid buyers</option><option value="no_paid">No paid order</option></select></label>
      <label><span>Delivery location</span><input type="search" name="location" maxlength="100" placeholder="City or region"></label>
      <label><span>Tag</span><input type="search" name="tag" maxlength="32" placeholder="Exact tag"></label>
      <label><span>Minimum value (Rp)</span><input type="text" inputmode="numeric" name="minSpend" pattern="[0-9]*" maxlength="19" placeholder="0"></label>
      <label><span>Minimum orders</span><input type="number" name="minOrders" min="0" max="1000000000" step="1"></label>
      <label><span>Maximum orders</span><input type="number" name="maxOrders" min="0" max="1000000000" step="1"></label>
      <label><span>Last order from</span><input type="date" name="lastFrom"></label>
      <label><span>Last order through</span><input type="date" name="lastTo"></label>
      <div class="commerce-order-filter-buttons"><button type="submit" class="ui-button primary" data-ui-icon="sliders">Apply filters</button><button type="button" class="ui-button" data-customers-clear data-ui-icon="undo">Clear filters</button></div>
    </form>
    <p class="commerce-orders-message" data-customers-export-status role="status"></p>
    <p class="commerce-orders-message" data-customers-list-status role="status">Loading customers…</p>
    <div class="commerce-order-table" tabindex="0" role="region" aria-label="Customer directory, scroll horizontally for more columns"><table><thead><tr><th scope="col">Customer</th><th scope="col">Location and tags</th><th scope="col">Orders</th><th scope="col">Verified value</th><th scope="col">Last order</th></tr></thead><tbody data-customers-rows></tbody></table></div>
    <footer class="commerce-order-paging"><p data-customers-count></p><nav aria-label="Customer pages"><button type="button" class="ui-button" data-customers-previous disabled data-ui-icon="arrow-left">Previous</button><button type="button" class="ui-button" data-customers-next disabled data-ui-icon="arrow-right">Next</button></nav></footer>
    <p class="commerce-orders-note">Summary totals and customer groups cover all profiles. Filters narrow the directory and export. Profiles use each customer’s latest saved checkout details. Refresh to include new orders.</p>
  </section>
  <section class="surface commerce-order-detail" id="commerce-customer-detail" data-customers-detail hidden aria-labelledby="commerce-customer-detail-title">
    <header class="surface-header"><div><h2 id="commerce-customer-detail-title" tabindex="-1">Customer profile</h2><p data-customers-reference></p></div><div class="commerce-order-buttons"><button type="button" class="ui-button" data-customers-detail-reload data-ui-icon="refresh">Reload saved profile</button><button type="button" class="ui-button" data-customers-detail-close data-ui-icon="x">Close profile</button></div></header>
    <p class="commerce-orders-message" data-customers-detail-status role="status"></p><div data-customers-detail-content></div>
  </section>
  <section class="surface commerce-customer-segment-editor" data-customers-segment-editor hidden aria-labelledby="commerce-segment-editor-title">
    <header class="surface-header"><div><h2 id="commerce-segment-editor-title" tabindex="-1">Save customer segment</h2><p>Segments keep filters and update as customer records change.</p></div></header>
    <form data-customers-segment-form><label><span>Segment name</span><input type="text" name="name" maxlength="80" required></label><p data-customers-segment-rules class="commerce-customer-muted"></p><p class="commerce-customer-muted">To change these rules, apply filters in the directory and choose Use directory filters.</p><div><button type="button" class="ui-button" data-customers-segment-filters data-ui-icon="sliders">Use directory filters</button></div><p data-customers-segment-status role="status" class="commerce-customer-muted"></p><div class="commerce-order-buttons"><button type="submit" class="ui-button primary" data-ui-icon="save">Save segment</button><button type="button" class="ui-button" data-customers-segment-cancel data-ui-icon="x">Cancel</button></div></form>
  </section>
  <section class="surface commerce-customer-segments" aria-labelledby="commerce-segment-list-title">
    <header class="surface-header"><div><h2 id="commerce-segment-list-title">Saved segments</h2><p>Reusable customer groups for this store.</p></div><div class="commerce-order-buttons"><select data-customers-segment-state aria-label="Saved segment state"><option value="active">Active segments</option><option value="archived">Archived segments</option></select><button type="button" class="ui-button" data-customers-segments-refresh data-ui-icon="refresh">Reload segments</button></div></header>
    <p data-customers-segments-status role="status" class="commerce-orders-message"></p><div data-customers-segments class="commerce-customer-segment-list"></div><footer class="commerce-order-paging"><button type="button" class="ui-button" data-customers-segments-more hidden data-ui-icon="arrow-right">Load more segments</button></footer>
  </section>
</section>
