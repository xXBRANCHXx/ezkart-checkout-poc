<?php
declare(strict_types=1);
if (empty($authenticated) || !isset($analytics)) { http_response_code(404); return; }

function ez_analytics_value(mixed $value, string $format = 'number'): string
{
    if ($value === null) return '—';
    return match ($format) {
        'money' => ez_admin_short_money((int) round($value)),
        'percent' => number_format($value, 1) . '%',
        'decimal' => number_format($value, 1),
        'duration' => $value < 60 ? number_format($value) . ' sec' : ($value < 3600 ? number_format($value / 60, 1) . ' min' : number_format($value / 3600, 1) . ' hr'),
        default => number_format($value),
    };
}

function ez_analytics_comparison(mixed $current, mixed $previous, string $format, bool $allTime): string
{
    if ($allTime) return 'All-time view';
    if ($current === null || $previous === null) return 'No comparable data';
    if ($format === 'percent') return ($current > $previous ? '+' : '') . number_format($current - $previous, 1) . ' pp vs previous period';
    if ($previous == 0) return $current == 0 ? 'No change vs previous period' : 'No previous value to compare';
    $change = 100 * ($current - $previous) / $previous;
    return ($change > 0 ? '+' : '') . number_format($change, 1) . '% vs previous period';
}

function ez_analytics_hidden_fields(array $analytics, array $omit = []): void
{
    parse_str(ltrim(ez_analytics_url($analytics), '?'), $query);
    foreach ($query as $key => $value) if (!in_array($key, $omit, true)) echo '<input type="hidden" name="' . ez_admin_escape($key) . '" value="' . ez_admin_escape($value) . '">';
}

function ez_analytics_chart_view(array $analytics, string $metric, string $title, string $format): void
{
    $points = [];
    foreach ($analytics['buckets'] as $bucket) {
        $last = $bucket['end']->modify('-1 day');
        $label = $bucket['start']->format('j M Y') . ($last > $bucket['start'] ? ' – ' . $last->format('j M Y') : '');
        $previousLabel = $analytics['previous'] === null ? '' : $bucket['start']->modify('-' . $analytics['period']['days'] . ' days')->format('j M Y') . ' – ' . $last->modify('-' . $analytics['period']['days'] . ' days')->format('j M Y');
        $points[] = ['label' => $label, 'short' => $bucket['start']->format('j M'), 'previousLabel' => $previousLabel,
            'current' => $bucket['current'][$metric], 'previous' => $analytics['previous'] !== null ? $bucket['previous'][$metric] : null,
            'currentText' => $format === 'money' ? ez_admin_money($bucket['current'][$metric]) : ez_analytics_value($bucket['current'][$metric], $format), 'previousText' => $analytics['previous'] !== null ? ($format === 'money' ? ez_admin_money($bucket['previous'][$metric]) : ez_analytics_value($bucket['previous'][$metric], $format)) : '—'];
    }
    $maximum = $format === 'percent' ? 100 : max(0, ...array_column($points, 'current'), ...array_column($points, 'previous'));
    $x = static fn($index) => count($points) > 1 ? 24 + $index * 852 / (count($points) - 1) : 450;
    $y = static fn($value) => 226 - 202 * ($value / max(1, $maximum));
    $path = static function ($key) use ($points, $x, $y): string {
        $path = ''; $new = true;
        foreach ($points as $index => $point) {
            if ($point[$key] === null) { $new = true; continue; }
            $path .= ($new ? 'M' : ' L') . round($x($index), 2) . ' ' . round($y($point[$key]), 2);
            $new = false;
        }
        return $path;
    };
    ?>
    <article class="surface an-chart" data-analytics-chart data-points="<?= ez_admin_escape(json_encode($points, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE)) ?>">
      <header class="an-panel-header"><div><h2><?= ez_admin_escape($title) ?></h2><p><?= ucfirst($analytics['period']['group']) ?> · orders grouped by creation date</p></div><nav class="an-chart-groups" aria-label="Chart grouping"><?php foreach (['daily', 'weekly', 'monthly'] as $group): if (($group === 'daily' && $analytics['period']['days'] > 90) || ($group === 'weekly' && $analytics['period']['days'] > 730)) continue; ?><a href="<?= ez_admin_escape(ez_analytics_url($analytics, ['group' => $group])) ?>" <?= $analytics['period']['group'] === $group ? 'aria-current="true"' : '' ?>><?= ucfirst($group) ?></a><?php endforeach; ?></nav></header>
      <div class="an-chart-legend"><span><i></i>Selected period</span><?php if ($analytics['previous'] !== null): ?><span><i class="previous"></i>Previous period</span><?php endif; ?></div>
      <div class="an-plot"><div class="an-axis"><span><?= ez_analytics_value($maximum, $format) ?></span><span><?= ez_analytics_value($maximum / 2, $format) ?></span><span><?= ez_analytics_value(0, $format) ?></span></div><svg viewBox="0 0 900 260" preserveAspectRatio="none" role="img" aria-label="<?= ez_admin_escape($title) ?>; values available in the chart data table">
        <?php foreach ([24, 125, 226] as $lineY): ?><path class="an-grid-line" d="M24 <?= $lineY ?> H876"/><?php endforeach; ?>
        <?php if ($analytics['previous'] !== null): ?><path class="an-series previous" d="<?= $path('previous') ?>"/><?php endif; ?><path class="an-series" d="<?= $path('current') ?>"/>
        <?php foreach ($points as $index => $point): ?>
          <?php if ($point['previous'] !== null): ?><circle class="an-point previous" data-point="<?= $index ?>" cx="<?= $x($index) ?>" cy="<?= $y($point['previous']) ?>" r="2.5"><title><?= ez_admin_escape($point['previousLabel'] . ': ' . $point['previousText']) ?></title></circle><?php endif; ?>
          <?php if ($point['current'] !== null): ?><circle class="an-point" data-point="<?= $index ?>" cx="<?= $x($index) ?>" cy="<?= $y($point['current']) ?>" r="<?= count($points) > 90 ? 2 : 3.5 ?>"><title><?= ez_admin_escape($point['label'] . ': ' . $point['currentText']) ?></title></circle><?php endif; ?>
        <?php endforeach; ?>
      </svg></div>
      <div class="an-x-axis"><?php foreach ($points as $index => $point): if ($index % max(1, (int) ceil((count($points) - 1) / 4)) !== 0 && $index !== count($points) - 1) continue; ?><span><?= $point['short'] ?></span><?php endforeach; ?></div>
      <div class="an-chart-inspector"><input type="range" min="0" max="<?= count($points) - 1 ?>" value="<?= count($points) - 1 ?>" aria-label="Inspect chart period"><output aria-live="polite"></output></div>
      <details class="an-chart-data"><summary>View chart data</summary><div class="an-table-scroll"><table><thead><tr><th>Period</th><th>Selected value</th><th>Previous period</th><th>Previous value</th></tr></thead><tbody><?php foreach ($points as $point): ?><tr><td><?= $point['label'] ?></td><td><?= $point['currentText'] ?></td><td><?= $point['previousLabel'] ?: '—' ?></td><td><?= $point['previousText'] ?></td></tr><?php endforeach; ?></tbody></table></div></details>
    </article>
    <?php
}

$report = $analytics['report'];
$info = ez_analytics_reports()[$report];
$period = $analytics['period'];
$stats = $analytics['current'];
$statusLabels = ['PAID' => 'Paid', 'PENDING' => 'Awaiting payment', 'CREATING' => 'Checkout creating', 'FAILED' => 'Failed or expired', 'OTHER' => 'Other status'];
$fulfillmentLabels = ['needs-processing' => 'Needs processing', 'processing' => 'Being processed', 'shipped' => 'Shipped', 'delivered' => 'Delivered', 'attention' => 'Shipping issues / returns', 'not-required' => 'Shipping skipped (sandbox)', 'unpaid' => 'Not paid'];
ez_page_header($info['title'], $info['description'], $analyticsAvailable ? [['label' => 'Export CSV', 'icon' => 'download', 'href' => ez_analytics_url($analytics, ['export' => 'csv']), 'style' => 'primary']] : []);
?>
<nav class="an-navigation" aria-label="Analytics reports"><?php foreach (ez_analytics_reports() as $key => $item): ?><a href="<?= ez_admin_escape(ez_analytics_url($analytics, ['report' => $key])) ?>" <?= $report === $key ? 'aria-current="page"' : '' ?>><?= ez_admin_icon($item['icon']) ?><?= $item['label'] ?></a><?php endforeach; ?></nav>
<?php if (!$analyticsAvailable): ?><section class="surface an-empty" role="alert"><h2>Analytics could not be loaded</h2><p>We couldn’t confirm your store. Reload to try again.</p><a class="action-button" href="?page=analytics">Reload analytics</a></section><?php return; endif; ?>
<form class="surface an-period" method="get"><?php ez_analytics_hidden_fields($analytics, ['range', 'from', 'to']); ?>
  <label>Period<select name="range" aria-label="Analytics date range"><?php foreach (['7' => 'Last 7 days', '30' => 'Last 30 days', '90' => 'Last 90 days', '180' => 'Last 6 months (180 days)', 'all' => 'All time', 'custom' => 'Custom dates'] as $value => $label): ?><option value="<?= $value ?>" <?= $period['range'] === (string) $value ? 'selected' : '' ?>><?= $label ?></option><?php endforeach; ?></select></label>
  <label>From<input type="date" name="from" aria-label="From date" min="1970-01-01" max="<?= $nowJakarta->format('Y-m-d') ?>" value="<?= $period['start']->format('Y-m-d') ?>"></label>
  <label>To<input type="date" name="to" aria-label="To date" min="1970-01-01" max="<?= $nowJakarta->format('Y-m-d') ?>" value="<?= $period['end']->modify('-1 day')->format('Y-m-d') ?>"></label>
  <button type="submit" class="ui-button" data-ui-icon="check">Apply</button>
  <div class="an-period-context"><b><?= $period['start']->format('j M Y') ?> – <?= $period['end']->modify('-1 day')->format('j M Y') ?></b><span><?= $period['previousStart'] !== null ? 'Compared with ' . $period['previousStart']->format('j M') . ' – ' . $period['start']->modify('-1 day')->format('j M Y') : 'All recorded history · no previous period' ?></span></div>
</form>
<p class="an-source-note"><?= $commerceProduction ? 'Production' : 'Sandbox' ?> order records · Asia/Jakarta · Updated <?= $nowJakarta->format('H:i') ?> WIB · Current payment and delivery statuses</p>
<?php if ($period['error'] !== ''): ?><p class="an-notice" role="alert"><?= ez_admin_escape($period['error']) ?></p><?php endif; ?>
<?php if ($analytics['undated'] > 0): ?><p class="an-notice"><?= number_format($analytics['undated']) ?> records have no valid order date and are excluded from these reports.</p><?php endif; ?>
<?php if ($catalogError !== ''): ?><p class="an-notice" role="alert">Catalog details are unavailable. These reports still use your saved order records and product snapshots.</p><?php endif; ?>
<?php if ($stats['orders'] === 0): ?><div class="an-notice" role="status">No orders were created in this period. Choose another date range to explore your history.</div><?php endif; ?>
<?php
$cards = match ($report) {
    'revenue' => [['revenue', 'Confirmed revenue', 'money', 'Includes shipping', 'revenue'], ['product_revenue', 'Product payments', 'money', 'Saved product subtotals', 'revenue'], ['shipping', 'Shipping collected', 'money', 'From paid orders', 'revenue'], ['aov', 'Average paid order', 'money', 'Confirmed revenue ÷ paid orders', 'revenue']],
    'orders' => [['orders', 'Orders created', 'number', 'Every saved order in the period', 'orders'], ['paid', 'Paid orders', 'number', 'Provider-confirmed payments', 'orders'], ['pending', 'Awaiting payment', 'number', 'Pending + creating orders', 'orders'], ['basket_size', 'Items per order', 'decimal', 'Ordered units ÷ orders', 'orders']],
    'payments' => [['payment_rate', 'Payment rate', 'percent', 'Paid orders ÷ all orders', 'payments'], ['pending_value', 'Unpaid order value', 'money', 'Pending + creating orders', 'payments'], ['failure_rate', 'Failure rate', 'percent', 'Failed orders ÷ all orders', 'payments'], ['payment_seconds', 'Median time to pay', 'duration', $stats['payment_time_samples'] . ' orders with valid payment timestamps', 'payments']],
    'products' => [['units', 'Paid units', 'number', 'Units in provider-confirmed orders', 'products'], ['products_sold', 'Products sold', 'number', 'Distinct products with paid units', 'products'], ['item_revenue', 'Paid item value', 'money', 'Item prices × paid quantities', 'products'], ['ordered_units', 'Units ordered', 'number', 'Includes unpaid and failed orders', 'products']],
    default => [['revenue', 'Confirmed revenue', 'money', 'Includes shipping', 'revenue'], ['orders', 'Orders created', 'number', 'All payment statuses', 'orders'], ['payment_rate', 'Payment rate', 'percent', 'Paid orders ÷ all orders', 'payments'], ['units', 'Paid units', 'number', 'Products in confirmed orders', 'products']],
};
?>
<section class="an-metrics" aria-label="Report summary"><?php foreach ($cards as [$key, $label, $format, $detail, $destination]): ?><a class="surface an-metric" href="<?= ez_admin_escape(ez_analytics_url($analytics, ['report' => $destination])) ?>" data-metric="<?= $key ?>"><span class="an-metric-top"><span><?= $label ?></span><?= ez_admin_icon(ez_analytics_reports()[$destination]['icon']) ?></span><strong><?= ez_analytics_value($stats[$key], $format) ?></strong><small><?= ez_admin_escape($detail) ?></small><span class="an-comparison"><?= ez_admin_escape(ez_analytics_comparison($stats[$key], $analytics['previous'][$key] ?? null, $format, $analytics['previous'] === null)) ?></span></a><?php endforeach; ?></section>

<?php if ($report === 'overview'): ?>
<div class="an-main-grid">
  <?php ez_analytics_chart_view($analytics, 'revenue', 'Revenue over time', 'money'); ?>
  <article class="surface an-breakdown"><header class="an-panel-header"><div><h2>Order payment status</h2><p><?= number_format($stats['orders']) ?> orders in this period</p></div></header><div class="an-breakdown-rows"><?php foreach ($statusLabels as $status => $label): if ($status === 'OTHER' && !$stats['status'][$status]) continue; ?><a href="<?= ez_admin_escape(ez_analytics_url($analytics, ['report' => 'orders', 'status' => $status])) ?>"><span><?= $label ?></span><b><?= number_format($stats['status'][$status]) ?></b><i><em style="width:<?= $stats['orders'] > 0 ? 100 * $stats['status'][$status] / $stats['orders'] : 0 ?>%"></em></i></a><?php endforeach; ?></div><footer><a href="<?= ez_admin_escape(ez_analytics_url($analytics, ['report' => 'payments'])) ?>">Explore payments <?= ez_admin_icon('chevron-right') ?></a></footer></article>
</div>
<section class="an-report-library" aria-labelledby="an-explore-title"><div class="an-section-heading"><h2 id="an-explore-title">Explore your reports</h2><p>One place for each part of your store’s performance.</p></div><div class="an-report-cards"><?php foreach (['revenue' => ['Revenue', 'Payment totals, revenue mix, and the value of each paid order.', 'money'], 'orders' => ['Orders', 'Order trends, basket size, and fulfillment progress.', 'cart'], 'payments' => ['Payments', 'Payment rates, unresolved value, and payment methods.', 'credit-card'], 'products' => ['Products', 'Product rankings, paid units, and item revenue.', 'box']] as $key => [$label, $description, $icon]): ?><a class="surface an-report-card" href="<?= ez_admin_escape(ez_analytics_url($analytics, ['report' => $key])) ?>"><span class="an-report-icon"><?= ez_admin_icon($icon) ?></span><h3><?= $label ?></h3><p><?= $description ?></p><span>Open report <?= ez_admin_icon('chevron-right') ?></span></a><?php endforeach; ?></div></section>
<?php else: ?>
<div class="an-main-grid">
  <?php [$chartMetric, $chartTitle, $chartFormat] = match ($report) { 'orders' => ['orders', 'Orders over time', 'number'], 'payments' => ['payment_rate', 'Payment rate over time', 'percent'], 'products' => ['units', 'Paid units over time', 'number'], default => ['revenue', 'Revenue over time', 'money'] }; ez_analytics_chart_view($analytics, $chartMetric, $chartTitle, $chartFormat); ?>
  <article class="surface an-breakdown">
    <header class="an-panel-header"><div><h2><?= match ($report) { 'revenue' => 'Revenue breakdown', 'orders' => 'Fulfillment progress', 'payments' => 'Payment outcomes', default => 'Leading products' } ?></h2><p><?= match ($report) { 'revenue' => 'From paid orders in this period', 'orders' => 'Current status of selected orders', 'payments' => 'Every recorded payment status', default => 'Ranked by paid item value' } ?></p></div></header>
    <div class="an-breakdown-rows">
    <?php if ($report === 'revenue'): foreach (['Product payments' => $stats['product_revenue'], 'Shipping collected' => $stats['shipping'], 'Other order adjustments' => $stats['revenue'] - $stats['product_revenue'] - $stats['shipping']] as $label => $value): if ($label === 'Other order adjustments' && $value === 0) continue; ?><div><span><?= $label ?></span><b><?= ez_admin_money($value) ?></b><i><em style="width:<?= $stats['revenue'] > 0 ? min(100, max(0, 100 * $value / $stats['revenue'])) : 0 ?>%"></em></i></div><?php endforeach; ?>
    <?php elseif ($report === 'orders' || $report === 'payments'): $counts = $report === 'orders' ? $stats['fulfillment'] : $stats['status']; $labels = $report === 'orders' ? $fulfillmentLabels : $statusLabels; foreach ($counts as $key => $value): if (in_array($key, ['OTHER', 'not-required'], true) && !$value) continue; ?><a href="<?= ez_admin_escape(ez_analytics_url($analytics, ['report' => 'orders', $report === 'orders' ? 'stage' : 'status' => $key])) ?>"><span><?= $labels[$key] ?></span><b><?= number_format($value) ?></b><i><em style="width:<?= $stats['orders'] > 0 ? 100 * $value / $stats['orders'] : 0 ?>%"></em></i></a><?php endforeach; ?>
    <?php else: foreach (array_slice($stats['products'], 0, 5) as $row): ?><div class="an-leading-product"><?= ez_admin_product_art($row['name'], $row['image_url']) ?><span><?= ez_admin_escape($row['name']) ?><small><?= number_format($row['units']) ?> paid units</small></span><b><?= ez_admin_short_money($row['revenue']) ?></b></div><?php endforeach; if ($stats['products'] === []): ?><p class="an-empty-text">No products in this period.</p><?php endif; endif; ?>
    </div>
    <footer><?= match ($report) { 'revenue' => 'Confirmed revenue is before provider fees and refunds; it is not a wallet balance.', 'orders' => 'A courier booking stays in processing until pickup is confirmed.', 'payments' => 'Payment rate measures order completion. Store visits are not tracked here.', default => 'Variants are combined using the saved product ID. Item values exclude shipping and order-level adjustments.' } ?></footer>
  </article>
</div>
<?php if ($report === 'orders'): ?><article class="surface an-weekdays"><header class="an-panel-header"><div><h2>Orders by day of the week</h2><p>Totals across the selected period · WIB</p></div></header><div><?php foreach (['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as $index => $label): ?><span><b><?= number_format($stats['weekdays'][$index]) ?></b><i><em style="height:<?= 100 * $stats['weekdays'][$index] / max(1, ...$stats['weekdays']) ?>%"></em></i><small><?= $label ?></small></span><?php endforeach; ?></div></article><?php endif; ?>
<?php require __DIR__ . '/analytics-table.php'; ?>
<?php endif; ?>
<details class="surface an-definitions"><summary>How these numbers are calculated</summary><div><p>Every report selects orders by their creation date in Asia/Jakarta, then uses their current payment status. A payment completed later updates the original order’s period. Previous-period comparisons use the same number of days immediately before the selected period.</p><p>Confirmed revenue sums paid order totals, including shipping. Average paid order divides that total by paid orders. Payment rate divides paid orders by all orders; periods with no orders show “—”. Product item values use saved prices and quantities, and may differ from order subtotals when adjustments apply.</p><p>These reports do not estimate visits, advertising attribution, provider settlements, refunds, or profit. Open <a href="?page=payments">Payments</a> to inspect payment records or <a href="?page=wallet">Wallet</a> for settlement availability.</p></div></details>
