<?php
if (empty($authenticated) || !isset($analytics, $stats)) { http_response_code(404); return; }
$queryText = mb_substr(trim(is_string($_GET['q'] ?? null) ? $_GET['q'] : ''), 0, 150);
$filterStatus = is_string($_GET['status'] ?? null) && isset($statusLabels[$_GET['status']]) ? $_GET['status'] : '';
$filterStage = is_string($_GET['stage'] ?? null) && isset($fulfillmentLabels[$_GET['stage']]) ? $_GET['stage'] : '';
$filterMethod = mb_substr(is_string($_GET['method'] ?? null) ? $_GET['method'] : '', 0, 100);
$sortOptions = match ($report) { 'products' => ['revenue' => 'Highest item value', 'units' => 'Most paid units', 'orders' => 'Most orders', 'name' => 'Product name'], 'payments' => ['orders' => 'Most orders', 'revenue' => 'Highest revenue', 'rate' => 'Highest payment rate'], default => ['recent' => 'Newest first', 'total' => 'Highest order value'] };
$sort = is_string($_GET['sort'] ?? null) && isset($sortOptions[$_GET['sort']]) ? $_GET['sort'] : array_key_first($sortOptions);
$tableRows = match ($report) { 'products' => array_values($stats['products']), 'payments' => array_values($stats['methods']), default => $analytics['rows'] };
$tableRows = array_values(array_filter($tableRows, static function ($row) use ($report, $queryText, $filterStatus, $filterStage, $filterMethod): bool {
    if ($report === 'revenue' && ez_analytics_status($row) !== 'PAID') return false;
    if ($report === 'orders') {
        if ($filterStatus !== '' && ez_analytics_status($row) !== $filterStatus) return false;
        if ($filterStage !== '' && ez_analytics_fulfillment($row) !== $filterStage) return false;
        $method = ucwords(str_replace('_', ' ', trim((string) ($row['payment_type'] ?? '')) ?: 'Not selected'));
        if ($filterMethod !== '' && $method !== $filterMethod) return false;
    }
    $text = in_array($report, ['products', 'payments'], true) ? ($row['name'] . ' ' . ($row['key'] ?? '')) : implode(' ', [$row['order_id'] ?? '', $row['customer']['name'] ?? '', $row['customer']['email'] ?? '', implode(' ', array_column($row['items'] ?? [], 'name'))]);
    return $queryText === '' || str_contains(mb_strtolower($text), mb_strtolower($queryText));
}));
usort($tableRows, static function ($a, $b) use ($sort): int {
    $difference = match ($sort) { 'name' => strcmp($a['name'], $b['name']), 'rate' => ($b['paid'] / max(1, $b['orders'])) <=> ($a['paid'] / max(1, $a['orders'])), 'recent' => $b['_timestamp'] <=> $a['_timestamp'], default => ($b[$sort] ?? 0) <=> ($a[$sort] ?? 0) };
    return $difference ?: strcmp((string) ($a['key'] ?? $a['name'] ?? $a['order_id']), (string) ($b['key'] ?? $b['name'] ?? $b['order_id']));
});
$rowCount = count($tableRows);
$lastPage = max(1, (int) ceil($rowCount / 20));
$tablePage = min($lastPage, max(1, (int) (is_scalar($_GET['table_page'] ?? null) ? $_GET['table_page'] : 1)));
$tableRows = array_slice($tableRows, ($tablePage - 1) * 20, 20);
$tableState = ['q' => $queryText, 'sort' => $sort];
if ($report === 'orders') $tableState += ['status' => $filterStatus, 'stage' => $filterStage, 'method' => $filterMethod];
$tableTitle = match ($report) { 'products' => 'Product performance', 'payments' => 'Performance by payment method', 'revenue' => 'Paid orders behind your revenue', default => 'Order records' };
?>
<article class="surface an-records" id="report-records">
  <header class="an-panel-header"><div><h2><?= $tableTitle ?></h2><p><?= number_format($rowCount) ?> matching <?= in_array($report, ['revenue', 'orders'], true) ? 'orders' : ($report === 'products' ? 'products' : 'methods') ?> · summary cards cover the full selected period</p></div></header>
  <form method="get" class="an-table-filters"><?php ez_analytics_hidden_fields($analytics); ?><label class="an-record-search"><?= ez_admin_icon('search') ?><input type="search" name="q" value="<?= ez_admin_escape($queryText) ?>" placeholder="<?= $report === 'products' ? 'Search products' : ($report === 'payments' ? 'Search payment methods' : 'Search orders, customers, products') ?>" aria-label="Search report records"></label><label>Sort<select name="sort" aria-label="Sort report records"><?php foreach ($sortOptions as $value => $label): ?><option value="<?= $value ?>" <?= $sort === $value ? 'selected' : '' ?>><?= $label ?></option><?php endforeach; ?></select></label>
    <?php if ($report === 'orders'): ?><label>Payment<select name="status" aria-label="Filter payment status"><option value="">All statuses</option><?php foreach ($statusLabels as $value => $label): ?><option value="<?= $value ?>" <?= $filterStatus === $value ? 'selected' : '' ?>><?= $label ?></option><?php endforeach; ?></select></label><label>Delivery<select name="stage" aria-label="Filter fulfillment status"><option value="">All stages</option><?php foreach ($fulfillmentLabels as $value => $label): ?><option value="<?= $value ?>" <?= $filterStage === $value ? 'selected' : '' ?>><?= $label ?></option><?php endforeach; ?></select></label><?php if ($filterMethod !== ''): ?><input type="hidden" name="method" value="<?= ez_admin_escape($filterMethod) ?>"><?php endif; endif; ?>
    <button class="ui-button" type="submit"><?= ez_admin_icon('search') ?> Filter</button><a class="an-text-link" href="<?= ez_admin_escape(ez_analytics_url($analytics)) ?>#report-records">Reset</a>
  </form>
  <?php if ($filterMethod !== ''): ?><p class="an-table-note">Payment method: <?= ez_admin_escape($filterMethod) ?></p><?php endif; ?>
  <p class="an-table-mobile-hint">Swipe the table to see all columns.</p>
  <div class="an-table-scroll"><table class="an-report-table"><thead><tr>
    <?php foreach (match ($report) { 'products' => ['Product', 'Orders', 'Paid orders', 'Ordered units', 'Paid units', 'Item value', 'Share of item value'], 'payments' => ['Payment method', 'Orders', 'Paid', 'Unresolved', 'Failed', 'Other', 'Payment rate', 'Confirmed revenue'], 'revenue' => ['Order', 'Customer', 'Created (WIB)', 'Product amount', 'Shipping', 'Total'], default => ['Order', 'Customer', 'Created (WIB)', 'Payment', 'Fulfillment', 'Total'] } as $heading): ?><th scope="col"><?= $heading ?></th><?php endforeach; ?>
  </tr></thead><tbody>
  <?php foreach ($tableRows as $row): ?>
    <?php if ($report === 'products'): ?><tr><td><span class="an-product"><?= ez_admin_product_art($row['name'], $row['image_url']) ?><span><b><?= ez_admin_escape($row['name']) ?></b><small><?= ez_admin_escape($row['key']) ?></small></span></span></td><td><?= number_format($row['orders']) ?></td><td><?= number_format($row['paid_orders']) ?></td><td><?= number_format($row['ordered_units']) ?></td><td><?= number_format($row['units']) ?></td><td><b><?= ez_admin_money($row['revenue']) ?></b></td><td><?= $stats['item_revenue'] > 0 ? number_format(100 * $row['revenue'] / $stats['item_revenue'], 1) . '%' : '—' ?></td></tr>
    <?php elseif ($report === 'payments'): ?><tr><td><a href="<?= ez_admin_escape(ez_analytics_url($analytics, ['report' => 'orders', 'method' => $row['name']])) ?>#report-records"><?= ez_admin_escape($row['name']) ?></a></td><td><?= number_format($row['orders']) ?></td><td><?= number_format($row['paid']) ?></td><td><?= number_format($row['pending']) ?></td><td><?= number_format($row['failed']) ?></td><td><?= number_format($row['other']) ?></td><td><?= number_format(100 * $row['paid'] / $row['orders'], 1) ?>%</td><td><b><?= ez_admin_money($row['revenue']) ?></b></td></tr>
    <?php else: ?><tr><td><a href="<?= ez_admin_escape('?' . http_build_query(['page' => $report === 'revenue' ? 'payments' : 'orders', 'order' => $row['order_id']])) ?>"><?= ez_admin_escape($row['order_id']) ?></a></td><td><span class="an-customer"><?= ez_admin_customer_avatar($row['customer'] ?? []) ?><span><?= ez_admin_escape($row['customer']['name'] ?? 'Guest customer') ?></span></span></td><td><?= ez_admin_escape(ez_admin_time($row['created_at'])) ?></td><?php if ($report === 'revenue'): ?><td><?= ez_admin_money($row['subtotal'] ?? 0) ?></td><td><?= ez_admin_money($row['shipping_price'] ?? 0) ?></td><?php else: ?><td><?= $statusLabels[ez_analytics_status($row)] ?></td><td><?= $fulfillmentLabels[ez_analytics_fulfillment($row)] ?></td><?php endif; ?><td><b><?= ez_admin_money($row['total'] ?? 0) ?></b></td></tr>
    <?php endif; ?>
  <?php endforeach; ?>
  <?php if ($tableRows === []): ?><tr><td colspan="8" class="an-empty-text">No records match this report. Try another date range or reset the table filters.</td></tr><?php endif; ?>
  </tbody></table></div>
  <footer class="an-pagination"><span><?= $rowCount ? (($tablePage - 1) * 20 + 1) . '–' . min($rowCount, $tablePage * 20) : '0' ?> of <?= number_format($rowCount) ?> · CSV includes the full report</span><nav aria-label="Report pagination"><?php if ($tablePage > 1): ?><a class="action-button" href="<?= ez_admin_escape(ez_analytics_url($analytics, $tableState + ['table_page' => $tablePage - 1])) ?>#report-records">Previous</a><?php endif; ?><span>Page <?= $tablePage ?> of <?= $lastPage ?></span><?php if ($tablePage < $lastPage): ?><a class="action-button" href="<?= ez_admin_escape(ez_analytics_url($analytics, $tableState + ['table_page' => $tablePage + 1])) ?>#report-records">Next</a><?php endif; ?></nav></footer>
</article>
