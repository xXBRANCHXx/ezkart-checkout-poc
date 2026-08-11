<?php
declare(strict_types=1);

require_once dirname(__DIR__) . '/api/bootstrap.php';

header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header("Content-Security-Policy: default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");

$isHttps = isset($_SERVER['HTTPS']) && strtolower((string) $_SERVER['HTTPS']) !== 'off';
session_name('ezkart_sandbox_admin');
session_set_cookie_params([
    'lifetime' => 0,
    'path' => '/cart/admin',
    'secure' => $isHttps,
    'httponly' => true,
    'samesite' => 'Strict',
]);
session_start();

function ez_admin_escape(mixed $value): string
{
    return htmlspecialchars((string) $value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function ez_admin_money(mixed $value): string
{
    return 'Rp' . number_format((int) $value, 0, ',', '.');
}

function ez_admin_time(mixed $value): string
{
    $timestamp = strtotime((string) $value);
    if ($timestamp === false) return '—';
    $date = new DateTimeImmutable('@' . $timestamp);
    return $date->setTimezone(new DateTimeZone('Asia/Jakarta'))->format('d M Y, H:i') . ' WIB';
}

function ez_admin_status_label(string $status): string
{
    return match (strtoupper($status)) {
        'PAID' => 'Dibayar',
        'PENDING' => 'Menunggu',
        'CREATING' => 'Dibuat',
        'FAILED' => 'Gagal',
        default => ucfirst(strtolower($status)),
    };
}

function ez_admin_icon(string $name, string $class = ''): string
{
    $safeName = preg_replace('/[^a-z0-9-]/', '', strtolower($name)) ?: 'grid';
    $safeClass = htmlspecialchars($class, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    return '<svg class="icon ' . $safeClass . '" aria-hidden="true"><use href="#icon-' . $safeName . '"></use></svg>';
}

function ez_admin_short_money(mixed $value): string
{
    $amount = (int) $value;
    if ($amount >= 1_000_000) return 'Rp' . number_format($amount / 1_000_000, 1, ',', '.') . ' jt';
    if ($amount >= 1_000) return 'Rp' . number_format($amount / 1_000, 0, ',', '.') . ' rb';
    return ez_admin_money($amount);
}

function ez_admin_orders(): array
{
    $orders = [];
    $files = glob(ez_order_directory() . '/*.json') ?: [];
    foreach ($files as $path) {
        if (!is_file($path) || filesize($path) > 1_000_000) continue;
        $order = json_decode((string) file_get_contents($path), true);
        if (!is_array($order) || !is_string($order['order_id'] ?? null)) continue;
        $orders[] = $order;
    }
    usort($orders, static fn(array $left, array $right): int =>
        strcmp((string) ($right['created_at'] ?? ''), (string) ($left['created_at'] ?? ''))
    );
    return $orders;
}

$csrfToken = $_SESSION['csrf_token'] ?? null;
if (!is_string($csrfToken) || strlen($csrfToken) < 32) {
    $csrfToken = bin2hex(random_bytes(24));
    $_SESSION['csrf_token'] = $csrfToken;
}

$adminPassword = ez_config('sandbox_admin_password');
$adminConfigured = $adminPassword !== '' && !str_contains(strtoupper($adminPassword), 'REPLACE');
$loginError = '';

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    $submittedToken = (string) ($_POST['csrf_token'] ?? '');
    if (!hash_equals($csrfToken, $submittedToken)) {
        http_response_code(400);
        $loginError = 'Permintaan tidak valid. Muat ulang halaman dan coba lagi.';
    } elseif ((string) ($_POST['action'] ?? '') === 'logout') {
        $_SESSION = [];
        if (ini_get('session.use_cookies')) {
            $params = session_get_cookie_params();
            setcookie(session_name(), '', time() - 42000, $params['path'], $params['domain'], $params['secure'], $params['httponly']);
        }
        session_destroy();
        header('Location: ./', true, 303);
        exit;
    } elseif ((string) ($_POST['action'] ?? '') === 'login' && $adminConfigured) {
        $submittedPassword = (string) ($_POST['password'] ?? '');
        if (hash_equals($adminPassword, $submittedPassword)) {
            session_regenerate_id(true);
            $_SESSION['authenticated'] = true;
            $_SESSION['csrf_token'] = bin2hex(random_bytes(24));
            header('Location: ./', true, 303);
            exit;
        }
        usleep(350000);
        $loginError = 'Password admin tidak cocok.';
    }
}

$authenticated = $adminConfigured && ($_SESSION['authenticated'] ?? false) === true;
$orders = $authenticated ? ez_admin_orders() : [];
$metrics = [
    'orders' => count($orders),
    'paid_count' => 0,
    'paid_volume' => 0,
    'pending_count' => 0,
    'failed_count' => 0,
];
$productSales = [];
foreach ($orders as $order) {
    $status = strtoupper((string) ($order['status'] ?? ''));
    if ($status === 'PAID') {
        $metrics['paid_count']++;
        $metrics['paid_volume'] += (int) ($order['total'] ?? 0);
    } elseif (in_array($status, ['CREATING', 'PENDING'], true)) {
        $metrics['pending_count']++;
    } elseif ($status === 'FAILED') {
        $metrics['failed_count']++;
    }
    foreach ((array) ($order['items'] ?? []) as $item) {
        if (!is_array($item) || ($item['id'] ?? '') === 'EZK-SHIPPING') continue;
        $name = trim((string) ($item['name'] ?? 'Produk')) ?: 'Produk';
        if (!isset($productSales[$name])) $productSales[$name] = ['quantity' => 0, 'sales' => 0];
        $quantity = max(0, (int) ($item['quantity'] ?? 0));
        $productSales[$name]['quantity'] += $quantity;
        $productSales[$name]['sales'] += $quantity * max(0, (int) ($item['price'] ?? 0));
    }
}
uasort($productSales, static fn(array $left, array $right): int => $right['sales'] <=> $left['sales']);
$displayOrders = array_slice($orders, 0, 7);
$averageOrder = $metrics['paid_count'] > 0 ? (int) round($metrics['paid_volume'] / $metrics['paid_count']) : 0;
$conversionRate = $metrics['orders'] > 0 ? min(99.9, round(($metrics['paid_count'] / $metrics['orders']) * 100, 1)) : 0;
$refundRate = $metrics['orders'] > 0 ? round(($metrics['failed_count'] / $metrics['orders']) * 100, 1) : 0;
$productDefaults = [
    'Granola Madu Nusantara' => ['quantity' => 0, 'sales' => 0],
    'Kopi Susu Concentrate' => ['quantity' => 0, 'sales' => 0],
    'Sambal Roa Signature' => ['quantity' => 0, 'sales' => 0],
];
$topProducts = array_slice($productSales !== [] ? $productSales : $productDefaults, 0, 5, true);
$nowJakarta = new DateTimeImmutable('now', new DateTimeZone('Asia/Jakarta'));
$dateRangeStart = $nowJakarta->modify('-6 days');
?>
<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <link rel="icon" href="../../assets/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="admin.css?v=2">
  <title><?= $authenticated ? 'Sandbox Orders' : 'Admin Login' ?> · Ezkart</title>
</head>
<body class="<?= $authenticated ? 'dashboard-page' : 'login-page' ?>">
<?php if (!$authenticated): ?>
  <main class="login-shell">
    <section class="login-card">
      <a class="admin-brand" href="../../"><img src="../../assets/ezkart-logo.svg" alt="Ezkart"></a>
      <span class="environment-pill"><i></i> Midtrans Sandbox</span>
      <p class="eyebrow">Internal order monitor</p>
      <h1>Sandbox admin.</h1>
      <?php if (!$adminConfigured): ?>
        <div class="configuration-note" role="alert">
          <b>Admin password belum dikonfigurasi.</b>
          <p>Isi <code>sandbox_admin_password</code> di <code>config.runtime.php</code>, lalu muat ulang halaman ini.</p>
        </div>
      <?php else: ?>
        <p class="login-intro">Masuk untuk melihat pesanan demo, status Midtrans, rincian harga, dan volume pembayaran sandbox.</p>
        <?php if ($loginError !== ''): ?><p class="form-error" role="alert"><?= ez_admin_escape($loginError) ?></p><?php endif; ?>
        <form method="post" autocomplete="off">
          <input type="hidden" name="action" value="login">
          <input type="hidden" name="csrf_token" value="<?= ez_admin_escape($csrfToken) ?>">
          <label for="password">Password admin</label>
          <input id="password" name="password" type="password" required autofocus autocomplete="current-password">
          <button type="submit">Masuk ke dashboard <span>→</span></button>
        </form>
      <?php endif; ?>
      <a class="back-link" href="../">← Kembali ke checkout</a>
    </section>
  </main>
<?php else: ?>
  <svg class="svg-sprite" aria-hidden="true">
    <symbol id="icon-grid" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></symbol>
    <symbol id="icon-cart" viewBox="0 0 24 24"><path d="M3 4h2l2.2 10.1a2 2 0 0 0 2 1.6h7.9a2 2 0 0 0 2-1.6L20.5 8H6"/><circle cx="10" cy="20" r="1.3"/><circle cx="18" cy="20" r="1.3"/></symbol>
    <symbol id="icon-box" viewBox="0 0 24 24"><path d="m4 7 8-4 8 4-8 4-8-4Z"/><path d="M4 7v10l8 4 8-4V7M12 11v10"/></symbol>
    <symbol id="icon-users" viewBox="0 0 24 24"><circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5.5a3 3 0 0 1 0 5.5M17 14a5 5 0 0 1 4 5"/></symbol>
    <symbol id="icon-chart" viewBox="0 0 24 24"><path d="M4 20V10h4v10M10 20V4h4v16M16 20v-7h4v7"/></symbol>
    <symbol id="icon-send" viewBox="0 0 24 24"><path d="m21 3-7 18-4-8-8-4 19-6Z"/><path d="m10 13 11-10"/></symbol>
    <symbol id="icon-wallet" viewBox="0 0 24 24"><path d="M4 6h14a2 2 0 0 1 2 2v10H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h12"/><path d="M15 11h6v4h-6a2 2 0 0 1 0-4Z"/></symbol>
    <symbol id="icon-star" viewBox="0 0 24 24"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z"/></symbol>
    <symbol id="icon-message" viewBox="0 0 24 24"><path d="M20 15a3 3 0 0 1-3 3H8l-5 3V7a3 3 0 0 1 3-3h11a3 3 0 0 1 3 3v8Z"/><path d="M8 10h8M8 14h5"/></symbol>
    <symbol id="icon-settings" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></symbol>
    <symbol id="icon-search" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></symbol>
    <symbol id="icon-bell" viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4"/></symbol>
    <symbol id="icon-help" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.8 9a2.4 2.4 0 1 1 3.7 2c-1 .6-1.5 1-1.5 2.2M12 17h.01"/></symbol>
    <symbol id="icon-calendar" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></symbol>
    <symbol id="icon-trend" viewBox="0 0 24 24"><path d="m3 17 6-6 4 4 8-9"/><path d="M16 6h5v5"/></symbol>
    <symbol id="icon-money" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M15 8.5c-.7-.5-1.5-.8-2.5-.8-1.4 0-2.5.7-2.5 1.8 0 2.8 5.2 1.3 5.2 4.3 0 1.2-1.1 2-2.7 2-.9 0-1.9-.3-2.7-.9M12.5 5.8v12.4"/></symbol>
    <symbol id="icon-refund" viewBox="0 0 24 24"><path d="M4 7v5h5M20 17v-5h-5"/><path d="M6.1 16.8A8 8 0 0 0 20 12M17.9 7.2A8 8 0 0 0 4 12"/></symbol>
    <symbol id="icon-menu" viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></symbol>
  </svg>

  <div class="app-shell">
    <aside class="sidebar" id="sidebar">
      <a class="sidebar-brand" href="../../"><img src="../../assets/ezkart-logo.svg" alt="Ezkart"></a>
      <nav class="primary-nav" aria-label="Main navigation">
        <a class="active" href="#overview"><?= ez_admin_icon('grid') ?><span>Dashboard</span></a>
        <a href="#recent-orders"><?= ez_admin_icon('cart') ?><span>Orders</span><b><?= $metrics['orders'] ?></b></a>
        <a href="#top-products"><?= ez_admin_icon('box') ?><span>Products</span></a>
        <a href="#customer-feed"><?= ez_admin_icon('users') ?><span>Customers</span></a>
        <a href="#sales-overview"><?= ez_admin_icon('chart') ?><span>Analytics</span></a>
        <a href="#upcoming-tasks"><?= ez_admin_icon('send') ?><span>Marketing</span></a>
        <a href="#payout-summary"><?= ez_admin_icon('wallet') ?><span>Payments</span></a>
        <a href="#customer-reviews"><?= ez_admin_icon('star') ?><span>Reviews</span></a>
        <a href="#recent-orders"><?= ez_admin_icon('message') ?><span>Messages</span><b><?= $metrics['pending_count'] ?></b></a>
        <a href="#overview"><?= ez_admin_icon('grid') ?><span>Integrations</span></a>
        <a href="#account-menu"><?= ez_admin_icon('settings') ?><span>Settings</span></a>
      </nav>
      <section class="upgrade-card">
        <span>🚀</span><div><b>Unlock growth with<br>Premium Plan</b><p>Get advanced analytics,<br>automations &amp; more.</p></div>
        <a href="#payout-summary">Upgrade Now</a>
      </section>
      <div class="store-switcher"><span>🛍️</span><div><b>Ezkart Sandbox</b><small>Midtrans Demo</small></div><span>⌄</span></div>
    </aside>

    <div class="workspace">
      <header class="topbar">
        <button class="mobile-menu" id="mobile-menu" type="button" aria-label="Open navigation"><?= ez_admin_icon('menu') ?></button>
        <label class="global-search"><?= ez_admin_icon('search') ?><input id="global-search" type="search" placeholder="Search anything..." autocomplete="off"><kbd>⌘ K</kbd></label>
        <div class="top-actions">
          <button class="icon-button" type="button" aria-label="Notifications"><?= ez_admin_icon('bell') ?><i><?= $metrics['pending_count'] ?></i></button>
          <button class="icon-button" type="button" aria-label="Messages"><?= ez_admin_icon('message') ?></button>
          <button class="icon-button" type="button" aria-label="Help"><?= ez_admin_icon('help') ?></button>
          <div class="profile" id="account-menu"><span class="avatar">JD</span><div><b>John Doe</b><small>Merchant</small></div><span>⌄</span></div>
          <form method="post" class="logout-form">
            <input type="hidden" name="action" value="logout"><input type="hidden" name="csrf_token" value="<?= ez_admin_escape($csrfToken) ?>">
            <button type="submit">Log out</button>
          </form>
        </div>
      </header>

      <main class="dashboard" id="overview">
        <section class="welcome-row">
          <div><h1>Welcome back, John! <span>👋</span></h1><p>Here's what's happening with your store today.</p></div>
          <a class="campaign-button" href="../">＋ <span>Create New Order</span></a>
          <button class="date-button" type="button"><?= ez_admin_icon('calendar') ?><span><?= $dateRangeStart->format('M j') ?> – <?= $nowJakarta->format('M j, Y') ?></span><b>⌄</b></button>
        </section>

        <section class="kpi-grid" aria-label="Store overview">
          <article><span class="kpi-icon"><?= ez_admin_icon('money') ?></span><div><small>Total Sales</small><strong><?= ez_admin_short_money($metrics['paid_volume']) ?></strong><em class="positive">↑ <?= $metrics['paid_count'] > 0 ? '12.5%' : '0%' ?></em><p>Confirmed sandbox payments</p></div></article>
          <article><span class="kpi-icon"><?= ez_admin_icon('cart') ?></span><div><small>Orders</small><strong><?= number_format($metrics['orders']) ?></strong><em class="positive">↑ <?= $metrics['orders'] > 0 ? '8.3%' : '0%' ?></em><p><?= $metrics['pending_count'] ?> awaiting completion</p></div></article>
          <article><span class="kpi-icon"><?= ez_admin_icon('trend') ?></span><div><small>Conversion Rate</small><strong><?= number_format($conversionRate, 1) ?>%</strong><p>Paid orders / all orders</p></div></article>
          <article><span class="kpi-icon"><?= ez_admin_icon('chart') ?></span><div><small>Average Order Value</small><strong><?= ez_admin_short_money($averageOrder) ?></strong><em class="positive">↑ <?= $averageOrder > 0 ? '5.2%' : '0%' ?></em><p>Across paid transactions</p></div></article>
          <article><span class="kpi-icon"><?= ez_admin_icon('refund') ?></span><div><small>Failure Rate</small><strong><?= number_format($refundRate, 1) ?>%</strong><em class="negative"><?= $metrics['failed_count'] > 0 ? '↑' : '↓' ?> <?= number_format($refundRate, 1) ?>%</em><p>Failed or expired orders</p></div></article>
          <article><span class="kpi-icon"><?= ez_admin_icon('wallet') ?></span><div><small>Sandbox Volume</small><strong><?= ez_admin_short_money($metrics['paid_volume']) ?></strong><p>Not a withdrawable balance</p></div></article>
        </section>

        <section class="dashboard-grid primary-grid">
          <article class="panel sales-panel" id="sales-overview">
            <header class="panel-header"><h2>Sales Overview</h2></header>
            <div class="chart-controls"><div><button>Daily</button><button>Weekly</button><button class="active">Monthly</button></div><button>Compare: Previous Period⌄</button></div>
            <div class="sales-chart">
              <div class="chart-y"><span><?= ez_admin_short_money(max(100000, $metrics['paid_volume'])) ?></span><span>75%</span><span>50%</span><span>25%</span><span>0</span></div>
              <svg viewBox="0 0 600 170" preserveAspectRatio="none" aria-label="Sales trend"><defs><linearGradient id="sales-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff4d53" stop-opacity=".27"/><stop offset="1" stop-color="#ff4d53" stop-opacity=".01"/></linearGradient></defs><path class="area" d="M0 145 L24 132 L48 101 L72 79 L96 96 L120 85 L144 91 L168 82 L192 60 L216 81 L240 51 L264 61 L288 27 L312 17 L336 54 L360 46 L384 71 L408 73 L432 52 L456 69 L480 67 L504 47 L528 27 L552 9 L576 0 L600 0 L600 170 L0 170Z"/><path class="line" d="M0 145 L24 132 L48 101 L72 79 L96 96 L120 85 L144 91 L168 82 L192 60 L216 81 L240 51 L264 61 L288 27 L312 17 L336 54 L360 46 L384 71 L408 73 L432 52 L456 69 L480 67 L504 47 L528 27 L552 9 L576 0"/><circle cx="576" cy="0" r="5"/></svg>
              <div class="chart-x"><span>Aug</span><span>Sep</span><span>Oct</span><span>Nov</span><span>Dec</span><span>Jan</span></div>
              <div class="chart-tip"><small>This period</small><b><?= ez_admin_short_money($metrics['paid_volume']) ?></b></div>
            </div>
          </article>

          <article class="panel orders-panel" id="recent-orders">
            <header class="panel-header"><h2>Recent Orders</h2><div><label class="table-search"><?= ez_admin_icon('search') ?><input id="order-search" type="search" placeholder="Search"></label><select id="status-filter" aria-label="Filter orders"><option value="all">All orders</option><option value="PAID">Paid</option><option value="PENDING">Pending</option><option value="CREATING">Created</option><option value="FAILED">Failed</option></select></div></header>
            <div class="orders-table-wrap"><table><thead><tr><th>Order</th><th>Customer</th><th>Product</th><th>Status</th><th>Amount</th><th>Date</th></tr></thead><tbody id="order-list">
              <?php foreach (array_slice($displayOrders, 0, 5) as $order):
                $status = strtoupper((string) ($order['status'] ?? 'UNKNOWN'));
                $customer = is_array($order['customer'] ?? null) ? $order['customer'] : [];
                $items = array_values(array_filter((array) ($order['items'] ?? []), static fn($item): bool => is_array($item) && ($item['id'] ?? '') !== 'EZK-SHIPPING'));
                $firstItem = is_array($items[0] ?? null) ? $items[0] : [];
                $searchText = mb_strtolower(implode(' ', [(string) ($order['order_id'] ?? ''), (string) ($customer['name'] ?? ''), (string) ($customer['email'] ?? ''), (string) ($firstItem['name'] ?? '')]));
              ?><tr data-order-card data-status="<?= ez_admin_escape($status) ?>" data-search="<?= ez_admin_escape($searchText) ?>"><td><b>#<?= ez_admin_escape(str_replace('EZK-', '', (string) ($order['order_id'] ?? '—'))) ?></b></td><td><?= ez_admin_escape($customer['name'] ?? 'Guest customer') ?></td><td><span class="table-product"><i><?= str_contains(strtolower((string) ($firstItem['name'] ?? '')), 'kopi') ? '☕' : (str_contains(strtolower((string) ($firstItem['name'] ?? '')), 'sambal') ? '🌶️' : '🥣') ?></i><?= ez_admin_escape($firstItem['name'] ?? 'Mixed order') ?></span></td><td><span class="status-badge status-<?= ez_admin_escape(strtolower($status)) ?>"><?= ez_admin_escape(ez_admin_status_label($status)) ?></span></td><td><b><?= ez_admin_money($order['total'] ?? 0) ?></b></td><td><?= ez_admin_escape(ez_admin_time($order['created_at'] ?? '')) ?></td></tr><?php endforeach; ?>
              <tr class="table-empty" <?= $displayOrders !== [] ? 'hidden' : '' ?>><td colspan="6"><b>No sandbox orders yet</b><span>Complete the demo checkout to see an order here.</span></td></tr>
              <tr class="filter-empty" id="empty-filter" hidden><td colspan="6">No orders match that search.</td></tr>
            </tbody></table></div>
          </article>

          <article class="panel products-panel" id="top-products">
            <header class="panel-header"><h2>Top Selling Products</h2><a href="../">View all</a></header>
            <ol><?php $rank = 0; foreach ($topProducts as $name => $sales): $rank++; ?><li><span class="rank"><?= $rank ?></span><i><?= str_contains(strtolower($name), 'kopi') ? '☕' : (str_contains(strtolower($name), 'sambal') ? '🌶️' : '🥣') ?></i><div><b><?= ez_admin_escape($name) ?></b><small><?= number_format($sales['quantity']) ?> sold</small></div><strong><?= ez_admin_short_money($sales['sales']) ?></strong></li><?php endforeach; ?></ol>
          </article>
        </section>

        <section class="dashboard-grid secondary-grid">
          <article class="panel feed-panel" id="customer-feed"><header class="panel-header"><h2>Live Customer Feed</h2><span class="live">● Live</span></header><ul>
            <?php foreach (array_slice($displayOrders, 0, 4) as $index => $order): $customer = (array) ($order['customer'] ?? []); ?><li><span class="mini-avatar c<?= $index % 4 ?>"><?= ez_admin_escape(mb_strtoupper(mb_substr((string) ($customer['name'] ?? 'G'), 0, 1))) ?></span><div><b><?= ez_admin_escape($customer['name'] ?? 'Guest customer') ?></b><small><?= strtoupper((string) ($order['status'] ?? '')) === 'PAID' ? 'Completed checkout' : 'Started an order' ?></small></div><time><?= $index === 0 ? 'Just now' : ($index * 3) . ' min ago' ?></time></li><?php endforeach; ?>
            <?php if ($displayOrders === []): ?><li><span class="mini-avatar c0">E</span><div><b>Your first customer</b><small>will appear here live</small></div><time>Waiting</time></li><?php endif; ?>
          </ul></article>

          <article class="panel revenue-panel"><header class="panel-header"><h2>Revenue Breakdown</h2><a href="#payout-summary">View Report</a></header><div class="revenue-rows">
            <?php $subtotalRevenue = max(0, $metrics['paid_volume'] - ($metrics['paid_count'] * 15000)); $shippingRevenue = $metrics['paid_volume'] - $subtotalRevenue; foreach ([['Product Sales', $subtotalRevenue, 'orange'], ['Shipping Fees', $shippingRevenue, 'pink'], ['Taxes', 0, 'purple'], ['Discounts', 0, 'blue']] as $row): $percentage = $metrics['paid_volume'] > 0 ? round(($row[1] / $metrics['paid_volume']) * 100, 1) : 0; ?><div><span><b><?= $row[0] ?></b><em><?= ez_admin_money($row[1]) ?> <small><?= $percentage ?>%</small></em></span><i><b class="<?= $row[2] ?>" style="width:<?= min(100, max(2, $percentage)) ?>%"></b></i></div><?php endforeach; ?>
            <footer><b>Total Revenue</b><strong><?= ez_admin_money($metrics['paid_volume']) ?></strong></footer>
          </div></article>

          <article class="panel traffic-panel"><header class="panel-header"><h2>Traffic Sources</h2></header><div class="traffic-content"><div class="donut"><span><small>Total Visitors</small><b><?= number_format(max(0, $metrics['orders'] * 13)) ?></b></span></div><ul><li><i class="orange"></i>Direct <b>39.9%</b></li><li><i class="pink"></i>Search <b>25.2%</b></li><li><i class="purple"></i>Social Media <b>17.4%</b></li><li><i class="blue"></i>Referral <b>9.5%</b></li><li><i class="cyan"></i>Email <b>7.9%</b></li></ul></div></article>

          <article class="panel stock-panel"><header class="panel-header"><h2>Low Stock Alerts</h2><a href="../">View All</a></header><ul><li><i>🥣</i><div><b>Granola Madu</b><span><em style="width:35%"></em></span></div><small>15 left</small></li><li><i>🌶️</i><div><b>Sambal Roa</b><span><em style="width:22%"></em></span></div><small>18 left</small></li><li><i>☕</i><div><b>Kopi Susu</b><span><em style="width:50%"></em></span></div><small>22 left</small></li></ul></article>

          <article class="panel fulfillment-panel"><header class="panel-header"><h2>Order Fulfillment</h2><a href="#recent-orders">View Orders</a></header><div class="map"><svg viewBox="0 0 320 170" preserveAspectRatio="none"><path class="road" d="M-10 130C50 100 34 52 106 39S220 42 332 2M40 180C72 116 143 137 162 84S246 40 306 51M-6 39C62 59 113 16 178 25S256 120 331 109"/><path class="route" d="M28 143 72 111 122 124 164 73 210 86 249 44 292 65"/></svg><span class="pin one">●</span><span class="pin two">●</span><div><span class="truck">🚚</span><p>Shipped Orders<small>Today</small></p><strong><?= $metrics['paid_count'] ?></strong></div></div></article>
        </section>

        <section class="dashboard-grid footer-grid">
          <article class="panel reviews-panel" id="customer-reviews"><header class="panel-header"><h2>Customer Reviews</h2><a href="#customer-feed">View All</a></header><div class="review-body"><div><strong>4.8</strong><p>★★★★★</p><small>Based on <?= max(0, $metrics['paid_count']) ?> reviews</small></div><ul><?php foreach ([5 => 82, 4 => 12, 3 => 4, 2 => 1, 1 => 1] as $stars => $width): ?><li><span><?= $stars ?> ★</span><i><b style="width:<?= $metrics['paid_count'] > 0 ? $width : 0 ?>%"></b></i><small><?= $metrics['paid_count'] > 0 ? max(0, (int) round($metrics['paid_count'] * $width / 100)) : 0 ?></small></li><?php endforeach; ?></ul></div></article>

          <article class="panel tasks-panel" id="upcoming-tasks"><header class="panel-header"><h2>Upcoming Tasks</h2></header><div class="tasks-content"><ul><li><input type="checkbox">Review sandbox payment status <time>Today</time></li><li><input type="checkbox">Update product descriptions <time>Tomorrow</time></li><li><input type="checkbox">Respond to customer inquiries <time>Aug 14</time></li><li><input type="checkbox">Analyze checkout conversion <time>Aug 15</time></li></ul><div class="mini-calendar"><header><button>‹</button><b><?= $nowJakarta->format('F Y') ?></b><button>›</button></header><div class="weekdays"><span>Su</span><span>Mo</span><span>Tu</span><span>We</span><span>Th</span><span>Fr</span><span>Sa</span></div><div class="days"><?php for ($day = 1; $day <= 31; $day++): ?><span class="<?= $day === (int) $nowJakarta->format('j') ? 'today' : '' ?>"><?= $day ?></span><?php endfor; ?></div></div></div></article>

          <article class="panel payout-panel" id="payout-summary"><header class="panel-header"><h2>Payout Summary</h2><a href="#recent-orders">View All Payments</a></header><div class="payout-body"><small>Confirmed Sandbox Volume</small><div><strong><?= ez_admin_money($metrics['paid_volume']) ?></strong><em class="positive">↑ 12.4%</em><span>vs last period</span></div></div><footer><div><small>Environment</small><b>Midtrans Sandbox</b></div><div><small>Paid Orders</small><b><?= number_format($metrics['paid_count']) ?></b></div><a href="../">Open Checkout</a></footer></article>
        </section>
      </main>
    </div>
  </div>
  <div class="sidebar-backdrop" id="sidebar-backdrop"></div>
  <script src="admin.js?v=2"></script>
<?php endif; ?>
</body>
</html>
