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
}
$displayOrders = array_slice($orders, 0, 200);
?>
<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <link rel="icon" href="../../assets/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="admin.css?v=1">
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
  <header class="admin-header">
    <a class="admin-brand" href="../../"><img src="../../assets/ezkart-logo.svg" alt="Ezkart"></a>
    <div class="admin-actions">
      <span class="environment-pill"><i></i> Midtrans Sandbox</span>
      <a class="ghost-button" href="./">Refresh</a>
      <form method="post">
        <input type="hidden" name="action" value="logout">
        <input type="hidden" name="csrf_token" value="<?= ez_admin_escape($csrfToken) ?>">
        <button class="ghost-button" type="submit">Keluar</button>
      </form>
    </div>
  </header>

  <main class="dashboard-shell">
    <section class="dashboard-heading">
      <div><p class="eyebrow">Sandbox operations</p><h1>Order dashboard.</h1></div>
      <p>Pesanan dibuat oleh checkout Ezkart dan diperbarui hanya setelah notifikasi Midtrans yang bertanda tangan berhasil diverifikasi.</p>
    </section>

    <section class="metric-grid" aria-label="Ringkasan sandbox">
      <article><span>Total pesanan</span><strong><?= $metrics['orders'] ?></strong><small>Seluruh order ID tersimpan</small></article>
      <article class="paid-metric"><span>Volume dibayar</span><strong><?= ez_admin_money($metrics['paid_volume']) ?></strong><small><?= $metrics['paid_count'] ?> transaksi sandbox</small></article>
      <article><span>Menunggu</span><strong><?= $metrics['pending_count'] ?></strong><small>Dibuat atau belum selesai</small></article>
      <article><span>Gagal</span><strong><?= $metrics['failed_count'] ?></strong><small>Ditolak, batal, atau kedaluwarsa</small></article>
    </section>

    <section class="sandbox-notice">
      <b>Bukan saldo wallet</b>
      <p>“Volume dibayar” adalah jumlah transaksi demo berstatus PAID. Tidak ada dana nyata, saldo yang dapat ditarik, atau pencatatan settlement produksi.</p>
    </section>

    <section class="orders-section">
      <div class="orders-heading">
        <div><p class="eyebrow">Order activity</p><h2>Pesanan terbaru</h2></div>
        <div class="order-tools">
          <label><span class="sr-only">Cari pesanan</span><input id="order-search" type="search" placeholder="Cari order, pelanggan, email…"></label>
          <label><span class="sr-only">Filter status</span><select id="status-filter"><option value="all">Semua status</option><option value="PAID">Dibayar</option><option value="PENDING">Menunggu</option><option value="CREATING">Dibuat</option><option value="FAILED">Gagal</option></select></label>
        </div>
      </div>

      <p class="filter-summary" id="filter-summary"><?= count($displayOrders) ?> pesanan ditampilkan<?= count($orders) > 200 ? ' (200 terbaru)' : '' ?></p>
      <div class="empty-orders" <?= $orders !== [] ? 'hidden' : '' ?>>
        <span>＋</span><b>Belum ada pesanan sandbox</b><p>Selesaikan checkout demo pertama; order akan muncul di sini setelah Snap token dibuat.</p>
      </div>
      <div class="empty-filter" id="empty-filter" hidden>Tidak ada pesanan yang cocok dengan filter.</div>

      <div class="order-list" id="order-list">
      <?php foreach ($displayOrders as $order):
          $status = strtoupper((string) ($order['status'] ?? 'UNKNOWN'));
          $customer = is_array($order['customer'] ?? null) ? $order['customer'] : [];
          $shipping = is_array($order['shipping'] ?? null) ? $order['shipping'] : [];
          $items = is_array($order['items'] ?? null) ? $order['items'] : [];
          $searchText = implode(' ', [
              (string) ($order['order_id'] ?? ''), (string) ($customer['name'] ?? ''),
              (string) ($customer['email'] ?? ''), (string) ($customer['phone'] ?? ''),
              (string) ($order['midtrans_transaction_id'] ?? ''), (string) ($order['payment_type'] ?? ''),
          ]);
      ?>
        <article class="order-card" data-order-card data-status="<?= ez_admin_escape($status) ?>" data-search="<?= ez_admin_escape(mb_strtolower($searchText)) ?>">
          <header class="order-topline">
            <div><span>Order ID</span><h3><?= ez_admin_escape($order['order_id'] ?? '—') ?></h3></div>
            <div class="order-total"><span>Total</span><strong><?= ez_admin_money($order['total'] ?? 0) ?></strong></div>
            <span class="status-badge status-<?= ez_admin_escape(strtolower($status)) ?>"><?= ez_admin_escape(ez_admin_status_label($status)) ?></span>
          </header>
          <div class="order-facts">
            <div><span>Pelanggan</span><b><?= ez_admin_escape($customer['name'] ?? '—') ?></b><small><?= ez_admin_escape($customer['email'] ?? '—') ?><br><?= ez_admin_escape($customer['phone'] ?? '—') ?></small></div>
            <div><span>Harga</span><b>Produk <?= ez_admin_money($order['subtotal'] ?? 0) ?></b><small>Pengiriman <?= ez_admin_money($order['shipping_price'] ?? 0) ?></small></div>
            <div><span>Pengiriman</span><b><?= ez_admin_escape(trim((string) ($shipping['courier'] ?? '') . ' ' . (string) ($shipping['service'] ?? '')) ?: '—') ?></b><small><?= ez_admin_escape($customer['location'] ?? '—') ?></small></div>
            <div><span>Pembayaran</span><b><?= ez_admin_escape(str_replace('_', ' ', (string) ($order['payment_type'] ?? 'Menunggu metode'))) ?></b><small>Midtrans: <?= ez_admin_escape($order['midtrans_status'] ?? 'pending') ?></small></div>
            <div><span>Dibuat</span><b><?= ez_admin_escape(ez_admin_time($order['created_at'] ?? '')) ?></b><small>Diperbarui <?= ez_admin_escape(ez_admin_time($order['updated_at'] ?? '')) ?></small></div>
          </div>
          <details>
            <summary>Lihat rincian pesanan <span>＋</span></summary>
            <div class="order-detail-grid">
              <section><h4>Item</h4>
                <?php foreach ($items as $item): ?>
                  <div class="item-row"><span><?= ez_admin_escape($item['name'] ?? 'Item') ?> <small>×<?= (int) ($item['quantity'] ?? 0) ?></small></span><b><?= ez_admin_money(((int) ($item['price'] ?? 0)) * ((int) ($item['quantity'] ?? 0))) ?></b></div>
                <?php endforeach; ?>
                <div class="item-row item-total"><span>Total</span><b><?= ez_admin_money($order['total'] ?? 0) ?></b></div>
              </section>
              <section><h4>Alamat pengiriman</h4><p><?= ez_admin_escape($customer['address'] ?? '—') ?><br><?= ez_admin_escape($customer['location'] ?? '—') ?>, <?= ez_admin_escape($customer['postalCode'] ?? '—') ?></p></section>
              <section><h4>Referensi Midtrans</h4><p><b>Transaction ID</b><br><?= ez_admin_escape($order['midtrans_transaction_id'] ?? 'Belum tersedia') ?></p><p><b>Status message</b><br><?= ez_admin_escape($order['status_message'] ?? '—') ?></p></section>
            </div>
          </details>
        </article>
      <?php endforeach; ?>
      </div>
    </section>
  </main>
  <script src="admin.js?v=1"></script>
<?php endif; ?>
</body>
</html>
