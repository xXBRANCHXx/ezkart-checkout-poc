<?php
declare(strict_types=1);

function ez_page_header(string $title, string $description, array $actions = []): void
{
    ?>
    <header class="page-heading">
      <div><h1><?= ez_admin_escape($title) ?></h1><p><?= ez_admin_escape($description) ?></p></div>
      <?php if ($actions !== []): ?><div class="page-actions"><?php foreach ($actions as $action): ?>
        <?php if (($action['href'] ?? '') !== ''): ?><a <?= !empty($action['icon']) ? 'data-ui-icon="' . ez_admin_escape($action['icon']) . '" ' : '' ?>class="action-button <?= ez_admin_escape($action['style'] ?? '') ?>" href="<?= ez_admin_escape($action['href']) ?>"<?= !empty($action['new_tab']) ? ' target="_blank" rel="noopener"' : '' ?>><?= ez_admin_escape($action['label']) ?></a>
        <?php else: ?><button <?= !empty($action['icon']) ? 'data-ui-icon="' . ez_admin_escape($action['icon']) . '" ' : '' ?>class="action-button <?= ez_admin_escape($action['style'] ?? '') ?>" type="button"<?= !empty($action['product_creator']) ? ' data-open-product-creator' : (!empty($action['copy_cart_link']) ? ' data-copy-cart-link' : ' data-toast="' . ez_admin_escape($action['toast'] ?? 'Action completed') . '"') ?><?= !empty($action['page_creator']) ? ' data-open-page-creator' : '' ?>><?= ez_admin_escape($action['label']) ?></button><?php endif; ?>
      <?php endforeach; ?></div><?php endif; ?>
    </header>
    <?php
}

function ez_stat_strip(array $items): void
{
    ?><section class="page-stat-strip"><?php foreach ($items as $item): ?><article><span class="stat-icon"><?= ez_admin_icon((string) ($item['icon'] ?? 'chart')) ?></span><div><small><?= ez_admin_escape($item['label'] ?? '') ?></small><strong><?= ez_admin_escape($item['value'] ?? '') ?></strong><p><?= ez_admin_escape($item['detail'] ?? '') ?></p></div></article><?php endforeach; ?></section><?php
}

function ez_orders_table(array $rows, string $tableId, string $csrfToken, string $queueLabel = ''): void
{
    ?>
    <div class="data-table-shell admin-order-table"><table><thead><tr><th>Order</th><th>Customer</th><th>Product</th><th>Status</th><th>Payment</th><th>Total</th><th>Created</th></tr></thead><tbody id="<?= ez_admin_escape($tableId) ?>">
    <?php foreach ($rows as $order):
        $status = strtoupper((string) ($order['status'] ?? 'UNKNOWN'));
        $customer = is_array($order['customer'] ?? null) ? $order['customer'] : [];
        $shipping = is_array($order['shipping'] ?? null) ? $order['shipping'] : [];
        $items = array_values(array_filter((array) ($order['items'] ?? []), static fn($item): bool => is_array($item) && ($item['id'] ?? '') !== 'EZK-SHIPPING'));
        $firstItem = is_array($items[0] ?? null) ? $items[0] : [];
        $payment = trim((string) ($order['payment_type'] ?? '')) ?: 'Awaiting method';
        $searchText = mb_strtolower(implode(' ', [(string) ($order['order_id'] ?? ''), (string) ($customer['name'] ?? ''), (string) ($customer['email'] ?? ''), (string) ($firstItem['name'] ?? ''), $payment]));
    ?>
      <tr data-order-card data-status="<?= ez_admin_escape($status) ?>" data-search="<?= ez_admin_escape($searchText) ?>"><td><button class="order-link" type="button" data-order-toggle aria-expanded="false">#<?= ez_admin_escape(str_replace('EZK-', '', (string) ($order['order_id'] ?? '—'))) ?></button></td><td><?= ez_admin_customer_avatar($customer) ?><b><?= ez_admin_escape($customer['name'] ?? 'Guest customer') ?></b><small><?= ez_admin_escape($customer['email'] ?? '—') ?></small></td><td><span class="table-product"><?= ez_admin_product_art((string) ($firstItem['name'] ?? ''), (string) ($firstItem['dashboard_product']['image_url'] ?? '')) ?><b><?= ez_admin_escape($firstItem['name'] ?? 'Mixed order') ?></b></span></td><td><span class="status-badge status-<?= ez_admin_escape(strtolower($status)) ?>"><?= ez_admin_escape(ez_admin_status_label($status)) ?></span></td><td><?= ez_admin_escape(ucwords(str_replace('_', ' ', $payment))) ?></td><td><b><?= ez_admin_money($order['total'] ?? 0) ?></b></td><td><?= ez_admin_escape(ez_admin_time($order['created_at'] ?? '')) ?></td></tr>
      <tr class="order-detail-row" hidden><td colspan="7"><div class="order-detail-inline"><section><span>Customer</span><b><?= ez_admin_escape($customer['name'] ?? 'Guest customer') ?></b><p><?= ez_admin_escape($customer['phone'] ?? '—') ?><br><?= ez_admin_escape($customer['location'] ?? '—') ?></p></section><section><span>Delivery</span><b><?= ez_admin_escape(ez_order_skips_shipping($order) ? 'Skipped (sandbox)' : (trim((string) ($shipping['courier'] ?? '') . ' ' . (string) ($shipping['service'] ?? '')) ?: 'Not selected')) ?></b><p><?= ez_admin_escape($customer['address'] ?? '—') ?><br>Biteship: <?= ez_admin_escape($order['biteship_order_id'] ?? ($order['fulfillment_status'] ?? 'awaiting payment')) ?></p></section><section><span>Payment</span><b><?= ez_admin_escape($order['payment_status'] ?? $order['midtrans_status'] ?? 'pending') ?></b><p><?= ez_admin_escape($order['payment_reference'] ?? $order['midtrans_transaction_id'] ?? 'No transaction ID') ?></p></section><section><span>Price detail</span><b><?= ez_admin_money($order['total'] ?? 0) ?></b><p>Products <?= ez_admin_money($order['subtotal'] ?? 0) ?><br>Shipping <?= ez_admin_money($order['shipping_price'] ?? 0) ?></p></section><?php if ($status === 'PAID'): $fulfillmentStatus = strtoupper((string) ($order['fulfillment_status'] ?? 'AWAITING_ACCEPTANCE')); ?><section class="order-fulfillment-action"><span>Fulfillment</span><b><?= ez_admin_escape(ucwords(strtolower(str_replace('_', ' ', $fulfillmentStatus)))) ?></b><?php if (!empty($order['fulfillment_deadline_at'])): ?><p>Arrange by <?= ez_admin_escape(ez_admin_time((string) $order['fulfillment_deadline_at'])) ?></p><?php endif; ?><?php if ($fulfillmentStatus === 'AWAITING_ACCEPTANCE'): ?><form method="post"><input type="hidden" name="csrf_token" value="<?= ez_admin_escape($csrfToken) ?>"><input type="hidden" name="action" value="accept_order"><input type="hidden" name="order_id" value="<?= ez_admin_escape($order['order_id'] ?? '') ?>"><button class="ui-button" type="submit" data-ui-icon="check">Accept order</button></form><?php elseif (in_array($fulfillmentStatus, ['AWAITING_PICKUP_ARRANGEMENT', 'RETRY_REQUIRED'], true)): ?><form method="post"><input type="hidden" name="csrf_token" value="<?= ez_admin_escape($csrfToken) ?>"><input type="hidden" name="action" value="arrange_pickup"><input type="hidden" name="order_id" value="<?= ez_admin_escape($order['order_id'] ?? '') ?>"><button class="ui-button" type="submit" data-ui-icon="truck">Arrange pickup</button></form><?php endif; ?></section><?php endif; ?></div></td></tr>
    <?php endforeach; ?>
    <?php if ($rows === []): ?><tr class="table-empty"><td colspan="7"><b><?= $queueLabel !== '' ? 'No orders in this stage' : 'No orders yet' ?></b><span><?= $queueLabel !== '' ? 'Orders will appear here when they enter ' . ez_admin_escape(strtolower($queueLabel)) . '.' : 'Orders will appear here as soon as checkout creates them.' ?></span></td></tr><?php endif; ?>
      <tr class="filter-empty" id="empty-filter" hidden><td colspan="7">No orders match your search and status filters.</td></tr>
    </tbody></table></div>
    <?php
}
?>

<main class="page-canvas admin-page page-<?= ez_admin_escape($page) ?>">
<?php switch ($page): case 'orders': ?>
  <?php ez_page_header('Orders', 'Manage orders, payments, and deliveries.', [
      ['label' => 'Refresh data', 'icon' => 'refresh', 'href' => '?page=orders'], ['label' => 'Open checkout', 'icon' => 'external-link', 'href' => '../', 'style' => 'primary'],
  ]); ?>
  <?php if ($orderFlash !== null): ?><div class="order-flash <?= ez_admin_escape($orderFlash['type'] ?? 'info') ?>"><?= ez_admin_escape($orderFlash['message'] ?? '') ?></div><?php endif; ?>
  <?php ez_stat_strip([
      ['icon'=>'cart','label'=>'Total orders','value'=>number_format($metrics['orders']),'detail'=>'Stored order records'],
      ['icon'=>'check-circle','label'=>'Paid','value'=>number_format($metrics['paid_count']),'detail'=>number_format($conversionRate, 1) . '% payment conversion'],
      ['icon'=>'refund','label'=>'Needs attention','value'=>number_format($metrics['pending_count']),'detail'=>ez_admin_short_money($pendingVolume) . ' pending'],
      ['icon'=>'truck','label'=>'Biteship orders','value'=>number_format($metrics['fulfilled_count']),'detail'=>$metrics['fulfillment_attention_count'] . ' paid handoffs need attention'],
  ]); ?>
  <nav class="order-queue-filters" aria-label="Order fulfillment filters">
    <a href="?page=orders" <?= $orderQueueFilter === '' ? 'aria-current="page"' : '' ?>>All orders <span><?= number_format($allOrderCount) ?></span></a>
    <?php foreach ($orderQueues as $queue => $queueInfo): ?><a href="?page=orders&amp;fulfillment=<?= $queue ?>" <?= $orderQueueFilter === $queue ? 'aria-current="page"' : '' ?>><?= $queueInfo['label'] ?> <span><?= number_format($orderQueueCounts[$queue]) ?></span></a><?php endforeach; ?>
  </nav>
  <section class="page-grid orders-control-grid">
    <article class="surface orders-workspace"><header class="surface-header"><div><h2><?= $orderQueueFilter !== '' ? $orderQueues[$orderQueueFilter]['label'] : 'Order manager' ?></h2><p><?= $orderQueueFilter !== '' ? $orderQueues[$orderQueueFilter]['detail'] . ' · ' . number_format(count($orderQueueRows)) . ' orders' : 'Search, filter, and inspect complete transaction records.' ?></p><?php if (count($orderQueueRows) > 200): ?><p>Showing the latest 200 matching orders.</p><?php endif; ?></div><div class="surface-tools"><label class="surface-search"><?= ez_admin_icon('search') ?><input id="order-search" type="search" placeholder="Search orders, customers, products"></label><select id="status-filter" aria-label="Payment status"><option value="all">All payment statuses</option><option value="PAID">Paid</option><option value="PENDING">Pending</option><option value="CREATING">Creating</option><option value="FAILED">Failed</option></select></div></header><?php ez_orders_table($allDisplayOrders, 'order-list', $csrfToken, $orderQueues[$orderQueueFilter]['label'] ?? ''); ?></article>
    <aside class="surface attention-queue"><header class="surface-header"><div><h2>Attention queue</h2><p>Prioritized operational follow-up.</p></div></header><div class="queue-list"><article><span class="queue-state urgent"></span><div><b><?= $metrics['pending_count'] ?> payment confirmations</b><p>Check unresolved payment sessions before fulfillment.</p></div><small>High</small></article><article><span class="queue-state warning"></span><div><b><?= $metrics['failed_count'] ?> failed checkouts</b><p>Review provider messages and customer retry options.</p></div><small>Review</small></article><article><span class="queue-state good"></span><div><b><?= $metrics['fulfillment_attention_count'] ?> Biteship handoffs</b><p>Paid orders without a confirmed Biteship test order.</p></div><small><?= $metrics['fulfillment_attention_count'] > 0 ? 'Review' : 'Clear' ?></small></article></div><footer><span>Paid-order automation</span><b><?= $fulfillmentRate ?>%</b><i><em style="width:<?= $fulfillmentRate ?>%"></em></i></footer></aside>
  </section>
  <section class="page-grid fulfillment-grid">
    <article class="surface delivery-map-card"><header class="surface-header"><div><h2>Delivery command map</h2><p>Live geographic context for order destinations.</p></div><span class="map-legend"><i></i> Latest destination</span></header><div id="fulfillment-map" class="delivery-map" data-points="<?= ez_admin_escape(json_encode($orderMapPoints, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)) ?>"></div><footer><div><small>Current focus</small><b><?= ez_admin_escape($mapLabel) ?></b></div><div><small>Fulfilled</small><b><?= $metrics['fulfilled_count'] ?></b></div><div><small>Pending</small><b><?= $metrics['pending_count'] ?></b></div><a href="https://www.google.com/maps/search/?api=1&amp;query=<?= rawurlencode($mapLatitude . ',' . $mapLongitude) ?>" target="_blank" rel="noopener">Open directions</a></footer></article>
    <article class="surface shipping-health"><header class="surface-header"><div><h2>Courier readiness</h2><p>Biteship test-rate availability from this server.</p></div></header><div class="carrier-list"><?php foreach (['JNE', 'SiCepat', 'J&amp;T Express'] as $courier): ?><article><span><?= ez_admin_icon('truck') ?></span><div><b><?= $courier ?></b><small><?= $integrationStatus['biteship'] ? 'Rates quoted live at checkout' : 'Add Biteship test credentials' ?></small></div><em class="<?= $integrationStatus['biteship'] ? 'connected' : '' ?>"><?= $integrationStatus['biteship'] ? 'Rates ready' : 'Setup required' ?></em></article><?php endforeach; ?></div><footer><small>Average quoted fee</small><strong><?= ez_admin_money($metrics['orders'] > 0 ? (int) round(array_sum(array_map(static fn($order): int => (int) ($order['shipping_price'] ?? 0), $orders)) / $metrics['orders']) : 0) ?></strong></footer></article>
  </section>

<?php break; case 'product-new': ?>
  <?php $editingProduct = preg_match('/^custom-[a-z0-9]+$/i', (string) ($_GET['product'] ?? '')) === 1; ?>
  <section class="product-editor" data-product-editor>
    <header class="product-editor-header page-heading">
      <div>
        <a href="?page=products"><?= ez_admin_icon('chevron-left') ?> Products</a>
        <h1><?= $editingProduct ? 'Edit product' : 'Create product' ?></h1>
        <p><?= $editingProduct ? 'Update product details, pricing, and availability.' : 'Add product details, pricing, and availability.' ?></p>
      </div>
      <div class="product-editor-actions page-actions">
        <span data-product-draft-status><i></i> Draft autosaves</span>
        <a class="action-button" href="?page=products" data-ui-icon="x">Cancel</a>
        <button class="action-button" type="button" data-save-product-draft data-ui-icon="save">Save draft</button>
        <button data-ui-icon="<?= $editingProduct ? 'globe' : 'plus' ?>" class="action-button primary" type="submit" form="product-create-form"><?= $editingProduct ? 'Publish changes' : 'Create product' ?></button>
      </div>
    </header>

    <form class="product-editor-layout" id="product-create-form" data-product-create-form>
      <div class="product-editor-main">
        <section class="product-form-card">
          <header><span>01</span><div><h2>Product details</h2><p>The basics used in your catalog, landing pages, and checkout.</p></div></header>
          <div class="product-form-grid">
            <label class="product-field-wide"><span>Product name</span><input name="name" required maxlength="70" placeholder="Example: Complete Freelance Guide" data-product-preview-name></label>
            <label class="product-type-field"><span>Product type</span><div class="product-type-picker" data-product-type-picker><select class="product-type-native" name="type" data-product-create-type tabindex="-1" aria-hidden="true"><option value="physical">Physical product</option><option value="digital">Digital product</option><option value="subscription">Subscription</option></select><button class="product-type-trigger" type="button" data-product-type-trigger aria-haspopup="listbox" aria-expanded="false"><span class="product-type-trigger-copy"><b data-product-type-value>Physical product</b></span><?= ez_admin_icon('chevron-right') ?></button><div class="product-type-menu" data-product-type-menu role="listbox" aria-label="Product type" hidden><button type="button" role="option" data-product-type-option="physical" aria-selected="true"><span class="product-type-option-name">Physical product</span><span class="product-type-help"><?= ez_admin_icon('help') ?><span class="product-type-help-card" role="tooltip">A shipped item with inventory, weight, and delivery details.</span></span><em><?= ez_admin_icon('check-circle') ?></em></button><button type="button" role="option" data-product-type-option="digital" aria-selected="false"><span class="product-type-option-name">Digital product</span><span class="product-type-help"><?= ez_admin_icon('help') ?><span class="product-type-help-card" role="tooltip">A downloadable file delivered to the customer after purchase.</span></span><em><?= ez_admin_icon('check-circle') ?></em></button><button type="button" role="option" data-product-type-option="subscription" aria-selected="false"><span class="product-type-option-name">Subscription</span><span class="product-type-help"><?= ez_admin_icon('help') ?><span class="product-type-help-card" role="tooltip">A recurring offer billed in monthly or yearly periods.</span></span><em><?= ez_admin_icon('check-circle') ?></em></button></div></div></label>
            <label class="product-category-field"><span>Category</span><input name="category" type="hidden" maxlength="80" data-product-preview-category><button class="product-category-trigger" type="button" data-product-category-open aria-haspopup="dialog" aria-required="true"><span class="product-category-trigger-icon"><?= ez_admin_icon('layers') ?></span><span class="product-category-trigger-copy"><b data-product-category-value>Choose a category</b><small data-product-category-path>Search or browse the catalog</small></span><?= ez_admin_icon('chevron-right') ?></button><small class="product-category-field-note" data-product-category-note>Categories keep product discovery and filtering consistent.</small></label>
            <label class="product-field-wide"><span>Description</span><textarea name="description" maxlength="360" rows="4" placeholder="Tell customers what makes this product worth buying." data-product-preview-description></textarea><small><b data-description-count>0</b>/360 characters</small></label>
          </div>
        </section>

        <section class="product-form-card product-media-card">
          <header><span>02</span><div><h2>Product images</h2><p>Drag photos into the square or browse from your device.</p></div><em data-product-media-count>0 / 9</em></header>
          <div class="product-media-workspace">
            <label class="product-upload-dropzone" data-product-dropzone>
              <input name="images" type="file" multiple accept="image/png,image/jpeg,image/webp,image/avif" data-product-media-input>
              <span><?= ez_admin_icon('image') ?></span>
              <strong data-product-drop-title>Drop images here</strong>
              <p data-product-drop-hint>or click to browse your files</p>
              <small>PNG, JPEG, WebP or AVIF · maximum 2 MB each</small>
            </label>
            <div class="product-media-empty" data-product-media-empty><span><?= ez_admin_icon('layers') ?></span><p>Your uploaded images will appear here.</p></div>
            <div class="product-media-gallery" data-product-media-gallery hidden></div>
          </div>
          <p class="product-media-rule" data-product-image-rule><?= ez_admin_icon('help') ?><span><b>Physical products need 3–9 images.</b> The first image becomes the main catalog photo. Use the arrows to change the order.</span></p>
        </section>

        <section class="product-form-card">
          <header><span>03</span><div><h2 data-variant-section-title>Product variants</h2><p data-variant-section-description>Keep sizes, flavors, colors, or bundles inside this one product.</p></div><label class="product-variant-switch"><input type="checkbox" data-product-variant-toggle><i></i><b data-variant-toggle-label>Has variants</b></label></header>
          <div class="product-variant-builder" data-product-variant-builder hidden>
            <div class="product-option-heading"><div><b data-variant-options-title>Option groups</b><p data-variant-options-description>Enter values separated by commas. Example: 50 ml, 250 ml.</p></div><button type="button" data-add-option-group><?= ez_admin_icon('plus') ?> Add option</button></div>
            <div class="product-option-groups" data-product-option-groups></div>
            <button class="product-generate-variants" type="button" data-generate-variants><?= ez_admin_icon('layers') ?> <span data-generate-variants-label>Generate combinations</span></button>
            <div class="product-variant-empty" data-product-variant-empty><span><?= ez_admin_icon('box') ?></span><div><b data-variant-empty-title>No combinations yet</b><p data-variant-empty-description>Add option values, then generate the sellable variants for this product.</p></div></div>
            <div class="product-variant-table" data-product-variant-table hidden>
              <div class="product-variant-batch" data-product-variant-batch>
                <div><b>Batch edit</b><p data-variant-batch-description>Select every matching option—such as all 250 ml or all Peach—then update them together.</p></div>
                <div class="variant-filter-chips" data-variant-filter-chips></div>
                <div class="variant-batch-fields"><span data-variant-selected-count>0 selected</span><label><span>Price</span><input type="number" min="1000" step="500" placeholder="No change" data-batch-price></label><label data-batch-physical><span>Stock</span><input type="number" min="0" max="999999" placeholder="No change" data-batch-stock></label><label data-batch-physical><span>Weight (g)</span><input type="number" min="1" max="50000" placeholder="No change" data-batch-weight></label><button class="ui-button" type="button" data-apply-variant-batch data-ui-icon="check">Apply to selected</button><button class="ui-button" type="button" data-clear-variant-selection data-ui-icon="x">Clear</button></div>
              </div>
              <header><span class="product-variant-group-heading"><input type="checkbox" data-select-all-variants aria-label="Select all variants"><b data-variant-group-heading>Flavor</b></span><span data-variant-column-title>Size</span><span>Price</span><span data-variant-stock-heading>Stock</span><span data-variant-weight-heading>Weight</span><span data-variant-billing-heading hidden>Billing</span><span>SKU</span><span></span></header>
              <div data-product-variant-rows></div>
            </div>
            <p class="product-variant-help" data-variant-help>Every row remains part of this product. Physical variants carry their own stock and shipping weight. Images are shared by the first option group.</p>
          </div>
          <p class="product-no-variants" data-product-no-variants>No variants needed? The base price and stock below will be used.</p>
        </section>

        <section class="product-form-card" data-product-base-pricing>
          <header><span>04</span><div><h2 data-base-pricing-title>Price and availability</h2><p data-base-pricing-description>Used as the default when the product has no variants.</p></div></header>
          <div class="product-form-grid">
            <label><span>Price (IDR)</span><input name="price" type="number" required min="1000" step="500" value="75000" data-product-preview-price></label>
            <label data-product-physical><span>Stock</span><input name="stock" type="number" min="0" max="999999" value="10" data-product-preview-stock></label>
            <label data-product-physical><span>Shipping weight (grams)</span><input name="weight" type="number" min="1" max="50000" value="500"></label>
            <label data-product-digital hidden><span>Download filename</span><input name="digital_name" maxlength="100" placeholder="freelance-guide.pdf"><small>The protected file upload is connected separately.</small></label>
            <div class="product-subscription-settings product-field-wide" data-product-subscription hidden>
              <label><span>Bill every</span><input name="interval" type="number" min="1" max="120" value="1" data-product-preview-interval></label>
              <label><span>Billing period</span><select name="unit" data-product-preview-unit><option value="month">Month</option><option value="year">Year</option></select></label>
              <p>Customers will be billed automatically on the schedule you choose.</p>
            </div>
          </div>
        </section>

        <p class="product-editor-error" data-product-create-error hidden></p>
        <footer class="product-editor-footer"><a href="?page=products" data-ui-icon="x">Cancel</a><button data-ui-icon="<?= $editingProduct ? 'globe' : 'plus' ?>" class="action-button primary" type="submit"><?= $editingProduct ? 'Publish changes' : 'Create product' ?></button></footer>
      </div>

      <aside class="product-preview-sidebar">
        <div class="product-preview-label"><span>Storefront preview</span><div class="product-preview-devices" aria-label="Preview size"><button class="active" type="button" data-product-preview-device="desktop"><?= ez_admin_icon('monitor') ?> Desktop</button><button type="button" data-product-preview-device="mobile"><?= ez_admin_icon('smartphone') ?> Mobile</button></div></div>
        <div class="product-preview-viewport preview-desktop" data-product-preview-viewport>
          <article class="product-live-card">
            <div class="product-live-commerce">
              <div class="product-live-media"><div class="product-live-image-stage" data-product-live-image-stage><div class="product-live-image" data-product-live-image><span><?= ez_admin_icon('image') ?><small>Your square main image</small></span></div><button type="button" data-product-image-prev aria-label="Previous product image"><?= ez_admin_icon('chevron-left') ?></button><button type="button" data-product-image-next aria-label="Next product image"><?= ez_admin_icon('chevron-right') ?></button></div><div class="product-live-thumbs" data-product-live-thumbs hidden></div></div>
              <div class="product-live-copy">
                <div class="product-live-heading">
                  <h2 data-product-live-name>Your product name</h2>
                  <span class="product-live-rating" data-product-live-rating aria-label="Rating 5.0 out of 5"><?= ez_admin_icon('star') ?><b>5.0</b></span>
                </div>
                <strong data-product-live-price>Rp75.000</strong>
                <em data-product-live-availability>Stock: 10</em>
                <div class="product-live-options" data-product-live-variant hidden></div>
                <button type="button" data-product-live-action><span data-product-live-action-icon><?= ez_admin_icon('plus') ?></span><span data-product-live-action-label>Add to cart</span></button>
                <footer><?= ez_admin_icon('shield') ?> Secure checkout powered by Ezkart</footer>
              </div>
            </div>
            <section class="product-live-reviews" data-product-live-reviews><header><div><span>Product reviews</span><b>No reviews yet</b></div><div><button type="button" data-review-prev aria-label="Previous review" disabled>←</button><button type="button" data-review-next aria-label="Next review" disabled>→</button></div></header><div class="product-review-track" data-review-track><article class="product-review-empty"><?= ez_admin_icon('star') ?><p>Reviews will appear here automatically after verified customers leave feedback.</p></article></div></section>
            <section class="product-live-details"><h3>Product information</h3><dl><div><dt>Product type</dt><dd data-product-live-type>Physical product</dd></div><div><dt>Category</dt><dd data-product-live-category>Product category</dd></div></dl><div><h4>Product description</h4><p data-product-live-description>Add a clear description so customers immediately understand what they are buying.</p></div></section>
          </article>
        </div>
        <p class="product-preview-note"><?= ez_admin_icon('eye') ?><span><b>This is a preview, not a published page.</b> The product becomes available to your landing-page builder after you create it.</span></p>
      </aside>

      <div class="product-category-dialog" data-product-category-dialog hidden>
        <button class="product-category-backdrop" type="button" data-product-category-close aria-label="Close category chooser"></button>
        <section role="dialog" aria-modal="true" aria-labelledby="product-category-title">
          <header><div><h2 id="product-category-title">Where should customers find this?</h2><p>Choose the closest match to keep discovery, filters, and catalog organization accurate.</p></div><button type="button" data-product-category-close aria-label="Close category chooser">×</button></header>
          <label class="product-category-search"><?= ez_admin_icon('search') ?><input type="search" autocomplete="off" placeholder="Search categories, such as syrup or skincare" data-product-category-search></label>
          <div class="product-category-suggestions" data-product-category-suggestions></div>
          <div class="product-category-search-results" data-product-category-results hidden></div>
          <div class="product-category-browser" data-product-category-browser>
            <section><header><b>Department</b><small>1</small></header><div data-product-category-level="0"></div></section>
            <section><header><b>Category</b><small>2</small></header><div data-product-category-level="1"></div></section>
            <section><header><b>Specific category</b><small>3</small></header><div data-product-category-level="2"></div></section>
          </div>
          <footer><div><small>Selected category</small><b data-product-category-selection>Nothing selected yet</b></div><button class="ui-button" type="button" data-product-category-confirm disabled data-ui-icon="check">Use this category</button></footer>
        </section>
      </div>
    </form>
  </section>

<?php break; case 'products': ?>
  <?php $productPageInventory = []; // Legacy demonstrations stay out of the signed-in seller catalog. ?>
  <?php ez_page_header('Products', 'Manage your products, prices, and stock.', [
      ['label'=>'Shop & checkout appearance', 'icon' => 'palette','href'=>'?page=shop'], ['label'=>'Copy cart link', 'icon' => 'copy','copy_cart_link'=>true], ['label'=>'Create product', 'icon' => 'plus','href'=>'?page=product-new&new=1','new_tab'=>true,'style'=>'primary'],
  ]); ?>
  <?php ez_stat_strip([
      ['icon'=>'box','label'=>'Active products','value'=>(string) count($productPageInventory),'detail'=>'Published in this store'],
      ['icon'=>'chart','label'=>'Units on hand','value'=>(string) array_sum(array_column($productPageInventory, 'stock')),'detail'=>'Physical inventory only'],
      ['icon'=>'money','label'=>'Catalog revenue','value'=>ez_admin_short_money(array_sum(array_column($productSales, 'sales'))),'detail'=>$paidUnits . ' paid units'],
      ['icon'=>'trend','label'=>'Sell-through','value'=>$paidUnits > 0 ? number_format(($paidUnits / max(1, $paidUnits + array_sum(array_column($productPageInventory, 'stock')))) * 100, 1) . '%' : '0.0%','detail'=>'Paid units vs availability'],
  ]); ?>
  <section class="product-commerce-strip" aria-label="Product commerce connections"><article><span><?= ez_admin_icon('box') ?></span><div><small>Product data</small><b>Complete catalog record</b><p>Price, stock, weight, media, and fulfillment origin</p></div><em>Ready</em></article><i><?= ez_admin_icon('chevron-right') ?></i><article><span><?= ez_admin_icon('layout') ?></span><div><small>Shop &amp; checkout</small><b>One checkout link per product</b><p>Sell from any website or share your whole catalog</p></div><a href="?page=shop">Set up shop</a></article><i><?= ez_admin_icon('chevron-right') ?></i><article><span><?= ez_admin_icon('credit-card') ?></span><div><small>Checkout data</small><b>DOKU onboarding pending</b><p>Awaiting CV approval; merchant disbursement is required</p></div><em>Pending</em></article><i><?= ez_admin_icon('chevron-right') ?></i><article><span><?= ez_admin_icon('truck') ?></span><div><small>Delivery</small><b><?= $integrationStatus['biteship'] ? 'Biteship rates enabled' : 'Biteship setup required' ?></b><p>Weights and origin feed live courier quotes</p></div><em class="<?= $integrationStatus['biteship'] ? 'connected' : '' ?>"><?= $integrationStatus['biteship'] ? 'Ready' : 'Setup' ?></em></article></section>
  <section class="surface product-drafts-panel" data-product-drafts-panel hidden><header class="surface-header"><div><h2>Product drafts</h2><p>Continue products that are not ready to publish yet.</p></div><a class="action-button" href="?page=product-new&new=1" data-ui-icon="plus">New draft</a></header><div class="product-draft-list" data-product-draft-list></div></section>
  <section class="product-catalog-controls" data-product-catalog-controls>
    <div class="product-catalog-summary">
      <div><strong><span data-product-count>0</span> <span data-product-count-noun>products</span></strong><p data-product-count-detail>Active products in this store</p></div>
      <nav class="product-catalog-filters" aria-label="Product status">
        <button type="button" data-product-filter="all" aria-pressed="false">All</button>
        <button type="button" data-product-filter="active" aria-pressed="true">Active</button>
      </nav>
    </div>
    <div class="product-catalog-control-actions">
      <div class="product-catalog-sort" data-product-sort-picker>
        <button type="button" data-product-sort-trigger aria-haspopup="listbox" aria-expanded="false"><span data-product-sort-label>Newest first</span><?= ez_admin_icon('chevron-down') ?></button>
        <div data-product-sort-menu role="listbox" aria-label="Sort products" hidden>
          <button type="button" role="option" data-product-sort-option="newest" aria-selected="true"><span>Newest first</span><?= ez_admin_icon('check-circle') ?></button>
          <button type="button" role="option" data-product-sort-option="updated" aria-selected="false"><span>Recently updated</span><?= ez_admin_icon('check-circle') ?></button>
          <button type="button" role="option" data-product-sort-option="name" aria-selected="false"><span>Name A–Z</span><?= ez_admin_icon('check-circle') ?></button>
          <button type="button" role="option" data-product-sort-option="price-high" aria-selected="false"><span>Highest price</span><?= ez_admin_icon('check-circle') ?></button>
          <button type="button" role="option" data-product-sort-option="price-low" aria-selected="false"><span>Lowest price</span><?= ez_admin_icon('check-circle') ?></button>
        </div>
      </div>
      <div class="product-catalog-view" role="group" aria-label="Product layout">
        <button type="button" data-product-view="list" aria-label="Compact list view" title="Compact list view"><?= ez_admin_icon('menu') ?></button>
        <button type="button" data-product-view="grid" aria-label="Card grid view" title="Card grid view"><?= ez_admin_icon('grid') ?></button>
      </div>
    </div>
  </section>
  <section class="catalog-grid catalog-view-grid" data-product-catalog data-demo-product-count="0" data-demo-stock="0"></section>
  <section class="page-grid product-ops-grid"><article class="surface"><header class="surface-header"><div><h2>Inventory control</h2><p>Availability, reorder points, and product health.</p></div><button class="ui-button" type="button" data-toast="Inventory count prepared" data-ui-icon="box">Count inventory</button></header><div class="inventory-table" data-product-inventory><div class="inventory-head"><span>Product</span><span>Available</span><span>Reorder at</span><span>Health</span></div><?php foreach ($productPageInventory as $name => $product): ?><article><?= ez_admin_product_art($sales['name'], $sales['image_url']) ?><div><b><?= ez_admin_escape($sales['name']) ?></b><small><?= ez_admin_escape($product['sku']) ?></small></div><strong><?= $product['stock'] ?></strong><span>15</span><em class="inventory-good">Healthy</em></article><?php endforeach; ?></div></article><aside class="surface merchandising-card"><header class="surface-header"><div><h2>Merchandising</h2><p>Storefront presentation score.</p></div></header><strong>94<small>/100</small></strong><ul><li><?= ez_admin_icon('check-circle') ?> Product photography complete</li><li><?= ez_admin_icon('check-circle') ?> Pricing published</li><li><?= ez_admin_icon('check-circle') ?> Type-aware fulfillment</li><li><?= ez_admin_icon('check-circle') ?> Descriptions optimized</li></ul><button class="ui-button" type="button" data-toast="Merchandising checklist opened" data-ui-icon="eye">Review storefront</button></aside></section>

<?php break; case 'shop': require __DIR__ . '/shop.php'; ?>
<?php break; case 'sites': require __DIR__ . ($siteEditor ? '/sites-builder.php' : '/sites-library.php'); break; case 'customers': ?>
  <?php $customerCount = count($customerProfiles); $customerSpend = array_sum(array_column($customerProfiles, 'spend')); ?>
  <?php $customerTab = ($_GET['tab'] ?? '') === 'reviews' ? 'reviews' : 'directory'; ?>
  <?php ez_page_header('Customers', 'Manage your customers, purchase history, and reviews.', $customerTab === 'reviews' ? [] : [['label'=>'Export customers', 'icon' => 'download','toast'=>'Customer export prepared'],['label'=>'Create segment', 'icon' => 'users','toast'=>'Segment builder opened','style'=>'primary']]); ?>
  <nav class="customer-page-tabs" aria-label="Customer sections">
    <a href="?page=customers"<?= $customerTab === 'directory' ? ' aria-current="page"' : '' ?>><?= ez_admin_icon('users') ?>Customer directory</a>
    <a href="?page=customers&amp;tab=reviews"<?= $customerTab === 'reviews' ? ' aria-current="page"' : '' ?>><?= ez_admin_icon('star') ?>Reviews</a>
  </nav>
  <?php if ($customerTab === 'reviews'): ?>
  <section class="surface customer-reviews-summary"><header class="surface-header"><div><h2>Customer ratings</h2><p>All-time published reviews</p></div></header><div class="review-body"><div><strong><?= $reviewAverage === null ? '—' : number_format($reviewAverage, 1) ?></strong><p><?= $catalogError !== '' ? 'Reviews could not be loaded. Reload to try again.' : ($reviewCount > 0 ? number_format($reviewCount) . ' published reviews' : 'No published reviews yet.') ?></p></div></div></section>
  <?php else: ?>
  <?php ez_stat_strip([
      ['icon'=>'users','label'=>'Customers','value'=>(string) $customerCount,'detail'=>'Unique checkout identities'],
      ['icon'=>'wallet','label'=>'Customer value','value'=>ez_admin_short_money($customerSpend),'detail'=>'Provider-confirmed spend'],
      ['icon'=>'trend','label'=>'Average LTV','value'=>ez_admin_short_money($customerCount > 0 ? (int) round($customerSpend / $customerCount) : 0),'detail'=>'Per known customer'],
      ['icon'=>'map-pin','label'=>'Markets','value'=>(string) count(array_unique(array_column($customerProfiles, 'location'))),'detail'=>'Delivery locations'],
  ]); ?>
  <section class="page-grid customer-main-grid"><article class="surface"><header class="surface-header"><div><h2>Customer directory</h2><p>Profiles assembled from sandbox checkout history.</p></div><label class="surface-search"><?= ez_admin_icon('search') ?><input data-table-search="customer-table" type="search" placeholder="Search customers"></label></header><div class="customer-table" id="customer-table"><?php $index=0; foreach ($customerProfiles as $profile): ?><article data-search-row="<?= ez_admin_escape(mb_strtolower(implode(' ', [$profile['name'],$profile['email'],$profile['location']]))) ?>"><?= ez_admin_customer_avatar($profile, 'customer-avatar c' . ($index++ % 4)) ?><div><b><?= ez_admin_escape($profile['name']) ?></b><small><?= ez_admin_escape($profile['email']) ?></small></div><span><?= ez_admin_escape($profile['location']) ?></span><span><b><?= $profile['orders'] ?> orders</b><small><?= $profile['paid'] ?> paid</small></span><strong><?= ez_admin_money($profile['spend']) ?></strong><button class="ui-button" type="button" data-toast="Customer profile opened" data-ui-icon="eye">View</button></article><?php endforeach; ?><?php if ($customerProfiles === []): ?><div class="blank-state">Customer profiles will appear after the first checkout.</div><?php endif; ?></div></article><aside class="surface segments-panel"><header class="surface-header"><div><h2>Smart segments</h2><p>Automatically maintained groups.</p></div></header><div class="segment-list"><article><span class="segment-dot vip"></span><div><b>High value</b><p>Paid spend above Rp150.000</p></div><strong><?= count(array_filter($customerProfiles, static fn($profile): bool => $profile['spend'] >= 150000)) ?></strong></article><article><span class="segment-dot new"></span><div><b>New customers</b><p>One checkout in history</p></div><strong><?= count(array_filter($customerProfiles, static fn($profile): bool => $profile['orders'] === 1)) ?></strong></article><article><span class="segment-dot at-risk"></span><div><b>Needs follow-up</b><p>No provider-confirmed order</p></div><strong><?= count(array_filter($customerProfiles, static fn($profile): bool => $profile['paid'] === 0)) ?></strong></article></div><footer><button class="ui-button" type="button" data-toast="Segment builder opened" data-ui-icon="users">Build a segment</button></footer></aside></section>
  <section class="surface lifecycle-panel"><header class="surface-header"><div><h2>Lifecycle overview</h2><p>Customer movement through the sandbox funnel.</p></div></header><div class="lifecycle-flow"><article><span>01</span><b>Discovered</b><strong><?= max($customerCount, $metrics['orders']) ?></strong><p>Known sessions</p></article><i></i><article><span>02</span><b>Started checkout</b><strong><?= $metrics['orders'] ?></strong><p>Order records</p></article><i></i><article><span>03</span><b>Paid</b><strong><?= $metrics['paid_count'] ?></strong><p>Verified payments</p></article><i></i><article><span>04</span><b>Retained</b><strong><?= count(array_filter($customerProfiles, static fn($profile): bool => $profile['orders'] > 1)) ?></strong><p>Repeat buyers</p></article></div></section>

  <?php endif; ?>

<?php break; case 'analytics': require __DIR__ . '/analytics.php'; ?>

<?php break; case 'marketing': ?>
  <?php ez_page_header('Marketing', 'Manage your campaigns and customer outreach.', [['label'=>'Campaign calendar', 'icon' => 'calendar','toast'=>'Campaign calendar opened'],['label'=>'New campaign', 'icon' => 'plus','toast'=>'Campaign builder opened','style'=>'primary']]); ?>
  <?php ez_stat_strip([
      ['icon'=>'send','label'=>'Active campaigns','value'=>'3','detail'=>'Sandbox templates'],['icon'=>'users','label'=>'Reachable customers','value'=>(string) count($customerProfiles),'detail'=>'Known email profiles'],['icon'=>'trend','label'=>'Recovery audience','value'=>(string) $metrics['pending_count'],'detail'=>ez_admin_short_money($pendingVolume).' opportunity'],['icon'=>'message','label'=>'Automations','value'=>'4','detail'=>'3 active · 1 draft'],
  ]); ?>
  <section class="campaign-grid"><article class="campaign-card live-campaign"><header><span>Always on</span><em>Active</em></header><div class="campaign-visual campaign-recovery"><?= ez_admin_icon('cart') ?></div><h2>Checkout recovery</h2><p>Remind customers with unresolved payments and return them to checkout.</p><div><span><small>Audience</small><b><?= $metrics['pending_count'] ?> customers</b></span><span><small>Potential</small><b><?= ez_admin_short_money($pendingVolume) ?></b></span></div><footer><button class="ui-button" type="button" data-toast="Campaign analytics opened" data-ui-icon="chart">View performance</button><button class="ui-button" type="button" data-toast="Campaign editor opened" data-ui-icon="pencil">Edit</button></footer></article><article class="campaign-card"><header><span>Lifecycle</span><em>Active</em></header><div class="campaign-visual campaign-welcome"><?= ez_admin_icon('sparkles') ?></div><h2>First-order welcome</h2><p>Introduce the catalog to newly identified customers after checkout.</p><div><span><small>Audience</small><b><?= count($customerProfiles) ?> customers</b></span><span><small>Touchpoints</small><b>2 messages</b></span></div><footer><button class="ui-button" type="button" data-toast="Campaign analytics opened" data-ui-icon="chart">View performance</button><button class="ui-button" type="button" data-toast="Campaign editor opened" data-ui-icon="pencil">Edit</button></footer></article><article class="campaign-card draft-campaign"><header><span>Retention</span><em>Draft</em></header><div class="campaign-visual campaign-loyalty"><?= ez_admin_icon('star') ?></div><h2>Second-order incentive</h2><p>Encourage one-time customers to return with a curated product recommendation.</p><div><span><small>Audience</small><b><?= count(array_filter($customerProfiles,static fn($p):bool=>$p['orders']===1)) ?> customers</b></span><span><small>Status</small><b>Needs review</b></span></div><footer><button class="ui-button" type="button" data-toast="Campaign preview opened" data-ui-icon="eye">Preview</button><button class="ui-button" type="button" data-toast="Campaign editor opened" data-ui-icon="settings">Finish setup</button></footer></article></section>
  <section class="page-grid automation-grid"><article class="surface"><header class="surface-header"><div><h2>Customer journeys</h2><p>Trigger-based lifecycle automation.</p></div><button class="ui-button" type="button" data-toast="Automation builder opened" data-ui-icon="plus">Create automation</button></header><div class="automation-list"><article><span class="automation-icon"><?= ez_admin_icon('cart') ?></span><div><b>Payment pending</b><p>Order enters PENDING for 30 minutes</p></div><span class="automation-flow"><i></i><i></i><i></i></span><em class="connected">Active</em></article><article><span class="automation-icon"><?= ez_admin_icon('check-circle') ?></span><div><b>Payment confirmed</b><p>Signed provider notification marks PAID</p></div><span class="automation-flow"><i></i><i></i></span><em class="connected">Active</em></article><article><span class="automation-icon"><?= ez_admin_icon('users') ?></span><div><b>First customer order</b><p>Customer profile reaches one paid order</p></div><span class="automation-flow"><i></i><i></i></span><em>Draft</em></article></div></article><aside class="surface channel-card"><header class="surface-header"><div><h2>Channel readiness</h2><p>Available campaign surfaces.</p></div></header><ul><li><span><?= ez_admin_icon('mail') ?></span><div><b>Email</b><small>Customer email captured at checkout</small></div><em class="connected">Ready</em></li><li><span><?= ez_admin_icon('smartphone') ?></span><div><b>WhatsApp</b><small>Phone numbers available</small></div><em>Setup</em></li><li><span><?= ez_admin_icon('monitor') ?></span><div><b>In-app</b><small>Checkout messaging</small></div><em class="connected">Ready</em></li></ul></aside></section>

<?php break; case 'payments': ?>
  <?php ez_page_header('Payments', 'Track incoming payments and review each transaction.', [['label'=>'Refresh', 'icon' => 'refresh','href'=>'?page=payments'],['label'=>'View wallet', 'icon' => 'wallet','href'=>'?page=wallet','style'=>'primary']]); ?>
  <?php ez_stat_strip([
      ['icon'=>'wallet','label'=>'Payments received','value'=>ez_admin_short_money($metrics['paid_volume']),'detail'=>$commerceProduction?'Provider-confirmed payments':'Sandbox payments'],
      ['icon'=>'check-circle','label'=>'Paid orders','value'=>(string)$metrics['paid_count'],'detail'=>number_format($conversionRate,1).'% of orders'],
      ['icon'=>'refund','label'=>'Awaiting payment','value'=>ez_admin_short_money($pendingVolume),'detail'=>$metrics['pending_count'].' pending orders'],
      ['icon'=>'chart','label'=>'Average payment','value'=>ez_admin_short_money($averageOrder),'detail'=>'Per paid order'],
  ]); ?>
  <details class="payment-setup">
    <summary><span class="payment-setup-title"><?= ez_admin_icon('credit-card') ?><b>DOKU checkout</b><span class="payment-environment"><?= $commerceProduction ? 'Live mode' : 'Test mode' ?></span></span><span class="payment-setup-state"><?= $integrationStatus['doku'] ? 'Credentials configured' : 'Setup required' ?><?= ez_admin_icon('chevron-down') ?></span></summary>
    <div class="payment-setup-details"><p><?= $commerceProduction ? 'This workspace uses the production payment environment.' : 'You are viewing sandbox payments. These transactions do not represent live funds.' ?></p><p>Before public orders, merchant onboarding, refunds, reconciliation, and verified disbursement must pass acceptance checks.</p><a href="../../docs/production-commerce-checklist.md" data-ui-icon="external-link">View setup requirements</a></div>
  </details>
  <section class="page-grid payments-grid">
    <article class="surface payments-ledger">
      <header class="surface-header"><div><h2>Transactions</h2><p>Payment references, customers, and methods.</p></div><label class="surface-search"><?= ez_admin_icon('search') ?><input data-table-search="payments-table" type="search" aria-label="Search payments" placeholder="Search payments" value="<?= ez_admin_escape(mb_substr(is_string($_GET['order'] ?? null) ? $_GET['order'] : '', 0, 100)) ?>"></label></header>
      <div class="ledger-table" id="payments-table">
        <div class="ledger-head"><span>Reference</span><span>Customer</span><span>Method</span><span>Status</span><span>Amount</span></div>
        <?php foreach ($allDisplayOrders as $order):
          $customer = (array) ($order['customer'] ?? []);
          $status = strtoupper((string) ($order['status'] ?? ''));
          $paymentMethod = trim((string) ($order['payment_type'] ?? ''));
        ?>
          <article data-search-row="<?= ez_admin_escape(mb_strtolower(implode(' ', [(string) ($order['order_id'] ?? ''), (string) ($customer['name'] ?? ''), $paymentMethod]))) ?>">
            <div class="payment-reference"><b><?= ez_admin_escape($order['order_id'] ?? '—') ?></b><small><?= ez_admin_escape(ez_admin_time($order['created_at'] ?? '')) ?></small></div>
            <span class="payment-customer"><?= ez_admin_escape($customer['name'] ?? 'Guest') ?></span>
            <span class="payment-method"><?= ez_admin_escape($paymentMethod !== '' ? ucwords(str_replace('_', ' ', $paymentMethod)) : 'Not selected') ?></span>
            <span class="payment-state status-badge status-<?= ez_admin_escape(strtolower($status)) ?>"><?= ez_admin_escape($order['payment_status'] ?? $order['midtrans_status'] ?? strtolower($status)) ?></span>
            <strong class="payment-amount"><?= ez_admin_money($order['total'] ?? 0) ?></strong>
          </article>
        <?php endforeach; ?>
        <?php if ($allDisplayOrders === []): ?><div class="blank-state"><b>No payments yet</b><p>Transactions will appear when a customer places an order.</p></div>
        <?php else: ?><div class="payments-search-empty" role="status"><b>No matching payments</b><p>Try a different reference, customer, or payment method.</p></div><?php endif; ?>
      </div>
      <?php if ($allDisplayOrders !== []): ?><footer class="payments-ledger-footer">Showing <?= number_format(count($allDisplayOrders)) ?> recent <?= count($allDisplayOrders) === 1 ? 'transaction' : 'transactions' ?></footer><?php endif; ?>
    </article>
    <aside class="surface methods-panel">
      <header class="surface-header"><div><h2>Payment methods</h2><p>Share of recorded orders.</p></div></header>
      <div class="method-list">
        <?php foreach ($paymentMethods as $method => $count): ?>
          <article><div><b><?= ez_admin_escape($method) ?></b><small><?= $count ?> <?= $count === 1 ? 'order' : 'orders' ?></small></div><span><i style="width:<?= round(($count / max(1, $metrics['orders'])) * 100, 1) ?>%"></i></span><strong><?= number_format(($count / max(1, $metrics['orders'])) * 100, 1) ?>%</strong></article>
        <?php endforeach; ?>
        <?php if ($paymentMethods === []): ?><div class="blank-state">Payment methods will appear with your first orders.</div><?php endif; ?>
      </div>
      <footer><span>Environment</span><b><?= $commerceProduction ? 'Production' : 'Sandbox' ?></b></footer>
    </aside>
  </section>

<?php break; case 'messages': ?>
  <?php ez_page_header('Messages', 'Manage customer conversations and order questions.', [['label'=>'Saved replies', 'icon' => 'message','toast'=>'Saved replies opened'],['label'=>'New message', 'icon' => 'pencil','toast'=>'Message composer opened','style'=>'primary']]); ?>
  <?php ez_stat_strip([
      ['icon'=>'message','label'=>'Open conversations','value'=>(string)max(1,$metrics['pending_count']),'detail'=>'Across email and checkout'],['icon'=>'help','label'=>'Needs response','value'=>(string)$metrics['pending_count'],'detail'=>'Payment-related questions'],['icon'=>'check-circle','label'=>'Resolved today','value'=>(string)$metrics['paid_count'],'detail'=>'Sample service activity'],['icon'=>'trend','label'=>'Median response','value'=>'8 min','detail'=>'Sandbox service target'],
  ]); ?>
  <section class="inbox-shell"><aside class="thread-list"><header><label><?= ez_admin_icon('search') ?><input type="search" placeholder="Search conversations"></label><button type="button" aria-label="Open inbox filters" data-toast="Inbox filters opened"><?= ez_admin_icon('settings') ?></button></header><?php $threads=array_values($customerProfiles);for($i=0;$i<max(3,min(5,count($threads)));$i++):$profile=$threads[$i]??['name'=>['Sarah Johnson','Michael Brown','Emily Davis','David Wilson','Jessica Taylor'][$i],'email'=>'customer@example.com'];?><button class="thread-item <?= $i===0?'active':'' ?>" type="button" data-thread="<?= $i ?>"><span class="customer-avatar c<?= $i%4 ?>"><?= ez_admin_escape(mb_strtoupper(mb_substr((string)$profile['name'],0,1))) ?></span><div><b><?= ez_admin_escape($profile['name']) ?></b><p><?= ez_admin_escape(['Has my payment been confirmed?','Can I change the delivery address?','When will the order be shipped?','Thank you for the quick help.','Is the sambal back in stock?'][$i]) ?></p></div><time><?= $i*7+2 ?>m</time></button><?php endfor;?></aside><article class="conversation-panel"><header><span class="customer-avatar c0">S</span><div><b><?= ez_admin_escape($threads[0]['name']??'Sarah Johnson') ?></b><small>Online · customer since today</small></div><button type="button" aria-label="Open conversation details" data-toast="Conversation details opened"><?= ez_admin_icon('help') ?></button></header><div class="message-history"><span class="date-divider">Today</span><div class="bubble customer-bubble"><p>Hi, I completed the bank transfer. Has my payment been confirmed?</p><small>10:22</small></div><div class="bubble agent-bubble"><p>Thanks for checking in. I can see the provider notification and your order is now marked as paid.</p><small>10:28 · Ezkart Admin</small></div><div class="system-message"><?= ez_admin_icon('check-circle') ?> Payment status updated to PAID</div></div><footer><textarea placeholder="Write a thoughtful reply..."></textarea><div><button class="ui-button" type="button" data-toast="Attachment picker opened" data-ui-icon="paperclip">Attach</button><button class="ui-button primary" type="button" data-toast="Message sent" data-ui-icon="send">Send reply</button></div></footer></article><aside class="conversation-context"><header><h2>Customer context</h2></header><section><span class="customer-avatar c0">S</span><b><?= ez_admin_escape($threads[0]['name']??'Sarah Johnson') ?></b><small><?= ez_admin_escape($threads[0]['email']??'sarah@example.com') ?></small></section><dl><div><dt>Lifetime value</dt><dd><?= ez_admin_money($threads[0]['spend']??0) ?></dd></div><div><dt>Orders</dt><dd><?= $threads[0]['orders']??1 ?></dd></div><div><dt>Location</dt><dd><?= ez_admin_escape($threads[0]['location']??'Jakarta') ?></dd></div><div><dt>Segment</dt><dd>New customer</dd></div></dl><a href="?page=customers">Open customer profile</a></aside></section>

<?php break; case 'wallet': require __DIR__ . '/wallet.php'; ?>

<?php break; case 'settings': ?>
  <?php ez_page_header('Settings', 'Manage your store, notifications, and security.', [['label'=>'Discard changes', 'icon' => 'undo','href'=>'?page=settings'],['label'=>'Save changes', 'icon' => 'save','toast'=>'Settings saved in preview','style'=>'primary']]); ?>
  <div class="settings-layout">
    <nav class="settings-nav"><a class="active" href="#store-profile">Store profile</a><a href="#notifications">Notifications</a><a href="#security">Security</a><a href="#preferences">Preferences</a></nav>
    <div class="settings-content">
      <section class="surface settings-section" id="store-profile"><header class="surface-header"><div><h2>Store profile</h2><p>Identity shown across the admin workspace.</p></div></header><?php require __DIR__ . '/profile-logo.php'; ?><div class="settings-form"><label class="wide"><span>Store name</span><input value="Ezkart Sandbox"></label><label><span>Business type</span><select><option>Online merchant</option></select></label><label><span>Plan</span><input value="Sandbox Demo" readonly></label><label><span>Support email</span><input type="email" value="support@ezkart.id"></label><label><span>Support phone</span><input value="+62 812 3456 7890"></label><label class="wide"><span>Store description</span><textarea>Commerce sandbox for testing checkout, shipping, and payment operations.</textarea></label></div></section>
      <section class="surface settings-section" id="notifications"><header class="surface-header"><div><h2>Notifications</h2><p>Choose which operational events need attention.</p></div></header><div class="setting-rows"><label><div><b>Payment confirmed</b><p>Notify when a signed callback marks an order paid.</p></div><input type="checkbox" checked></label><label><div><b>Payment pending</b><p>Surface unresolved checkouts after 30 minutes.</p></div><input type="checkbox" checked></label><label><div><b>Payment failed</b><p>Notify when a payment provider rejects or expires a transaction.</p></div><input type="checkbox" checked></label><label><div><b>Low catalog activity</b><p>Weekly summary for products without paid orders.</p></div><input type="checkbox"></label></div></section>
      <section class="surface settings-section" id="security">
        <header class="surface-header"><div><h2>Security</h2><p>Protect sign-in and store data.</p></div><span class="verified-label"><?= ez_admin_icon('check-circle') ?> <?= $mfaEnabled ? 'Two-step on' : 'Protected session' ?></span></header>
        <?php if ($securityFlash !== null): ?><p class="security-flash <?= ez_admin_escape((string) ($securityFlash['type'] ?? 'info')) ?>" role="status"><?= ez_admin_escape((string) ($securityFlash['message'] ?? '')) ?></p><?php endif; ?>
        <div class="security-cards">
          <article class="mfa-security-card">
            <?= ez_admin_icon($mfaEnabled ? 'check-circle' : 'shield') ?>
            <div><b>Two-step verification</b><p><?= $mfaEnabled ? 'Your sign-in plus a code from your authenticator app protects this account.' : 'Add an authenticator code after sign-in on new devices.' ?></p></div>
            <?php if ($authenticationMethod !== 'supabase'): ?><em>Verified sign-in required</em>
            <?php elseif ($mfaEnabled): ?><em>Enabled</em>
            <?php elseif ($mfaSetup === null): ?><form method="post"><input type="hidden" name="action" value="mfa_enroll_start"><input type="hidden" name="csrf_token" value="<?= ez_admin_escape($csrfToken) ?>"><button class="ui-button" type="submit" data-ui-icon="settings">Set up</button></form>
            <?php else: ?><em>Setup started</em><?php endif; ?>
          </article>
          <article><?= ez_admin_icon('check-circle') ?><div><b>Trusted device session</b><p>This browser stays signed in for up to 30 days.</p></div><em>Enabled</em></article>
          <article><?= ez_admin_icon('box') ?><div><b>Protected account data</b><p>Store changes require your authenticated server session.</p></div><em>Protected</em></article>
        </div>
        <?php if ($mfaSetup !== null): ?>
          <div class="mfa-setup-panel">
            <div class="mfa-setup-copy"><span>Authenticator setup</span><h3>Scan, then confirm.</h3><p>Scan this QR code with Google Authenticator, 1Password, Authy, or another authenticator app. Keep access to that app; losing it requires an account recovery reset.</p><small>Can&rsquo;t scan it? Enter this setup key manually:</small><code><?= ez_admin_escape((string) ($mfaSetup['secret'] ?? '')) ?></code></div>
            <?php if ((string) ($mfaSetup['qr_uri'] ?? '') !== ''): ?><div class="mfa-qr mfa-qr-local mfa-qr-fallback" data-mfa-qr-uri="<?= ez_admin_escape((string) $mfaSetup['qr_uri']) ?>" role="img" aria-label="Authenticator setup QR code"><span>Preparing QR code&hellip;</span><small>The setup key remains available here.</small></div><?php elseif ((string) ($mfaSetup['qr_code'] ?? '') !== ''): ?><img class="mfa-qr" src="<?= ez_admin_escape((string) $mfaSetup['qr_code']) ?>" alt="Authenticator setup QR code" width="184" height="184"><?php else: ?><div class="mfa-qr mfa-qr-fallback"><span>QR unavailable</span><small>Use the setup key shown here.</small></div><?php endif; ?>
            <form class="mfa-confirm-form" method="post" autocomplete="off">
              <input type="hidden" name="action" value="mfa_enroll_verify"><input type="hidden" name="csrf_token" value="<?= ez_admin_escape($csrfToken) ?>">
              <label for="mfa-setup-code"><span>Six-digit code</span><input id="mfa-setup-code" name="code" type="text" inputmode="numeric" pattern="[0-9]{6}" minlength="6" maxlength="6" autocomplete="one-time-code" placeholder="000000" required></label>
              <button class="ui-button" type="submit" data-ui-icon="shield">Turn on two-step verification</button>
            </form>
            <form class="mfa-setup-cancel" method="post"><input type="hidden" name="action" value="mfa_enroll_cancel"><input type="hidden" name="csrf_token" value="<?= ez_admin_escape($csrfToken) ?>"><button class="ui-button" type="submit" data-ui-icon="x">Cancel setup</button></form>
          </div>
        <?php elseif ($mfaEnabled): ?>
          <details class="mfa-disable-panel">
            <summary>Turn off two-step verification</summary>
            <form method="post" autocomplete="off"><input type="hidden" name="action" value="mfa_disable"><input type="hidden" name="csrf_token" value="<?= ez_admin_escape($csrfToken) ?>"><p>Enter your current authenticator code. Your usual sign-in method alone will protect the account afterward.</p><label for="mfa-disable-code">Authenticator code</label><input id="mfa-disable-code" name="code" type="text" inputmode="numeric" pattern="[0-9]{6}" minlength="6" maxlength="6" autocomplete="one-time-code" placeholder="000000" required><button class="ui-button" type="submit" data-ui-icon="shield">Turn off</button></form>
          </details>
        <?php endif; ?>
      </section>
      <section class="surface settings-section" id="preferences"><header class="surface-header"><div><h2>Regional preferences</h2><p>Formatting used throughout the workspace.</p></div></header><div class="settings-form"><label><span>Timezone</span><select><option>Asia/Jakarta (WIB)</option></select></label><label><span>Currency</span><select><option>IDR — Indonesian Rupiah</option></select></label><label><span>Date format</span><select><option>11 Aug 2026</option></select></label><label><span>Language</span><select><option>English</option><option>Bahasa Indonesia</option></select></label></div></section>
    </div>
  </div>

<?php endswitch; ?>
</main>
