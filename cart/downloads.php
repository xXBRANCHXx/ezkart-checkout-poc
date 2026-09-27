<?php
declare(strict_types=1);
require_once __DIR__ . '/api/customer-auth.php';
require_once __DIR__ . '/api/commerce-client.php';
header('Cache-Control: private, no-store');
header('Referrer-Policy: same-origin');
header('X-Content-Type-Options: nosniff');
$customerNext = ez_customer_next((string) ($_SERVER['REQUEST_URI'] ?? '/cart/downloads.php'));
try { $customerAccount = ez_customer_current(); } catch (Throwable) { $customerAccount = null; }
$customerCsrf = ez_customer_csrf();
if ($customerAccount === null || ($_GET['signin'] ?? '') === '1') {
    $customerGate = ['title' => 'Your downloads', 'description' => 'Sign in with the account used for your purchase to download your files.', 'button' => 'Sign in to download', 'success' => 'Finish signing in with Google to load your purchased files.'];
    ob_start(); require __DIR__ . '/tracking-gate.php'; $downloadGate = ob_get_clean();
    foreach (headers_list() as $header) if (str_starts_with(strtolower($header), 'content-security-policy:')) header('X-Ezkart-Content-Security-Policy:' . substr($header, strlen('Content-Security-Policy:')));
    echo $downloadGate; exit;
}
$customerVersion = (string) ($_SESSION['customer_auth']['version'] ?? '');
session_write_close();
$downloadsEnabled = ez_central_commerce_enabled();
$downloadOrder = is_string($_GET['order'] ?? null) && preg_match('/^EZK-[SP]-[A-F0-9]{24}$/D', $_GET['order']) === 1 ? $_GET['order'] : '';
$downloadPolicy = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; worker-src 'self'; font-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
header('Content-Security-Policy: ' . $downloadPolicy);
header('X-Ezkart-Content-Security-Policy: ' . $downloadPolicy);
$escape = static fn(string $text): string => htmlspecialchars($text, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
?>
<!doctype html><html lang="en"><head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
  <link rel="icon" href="../assets/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="payment.css?v=2">
  <link rel="stylesheet" href="customer-downloads.css?v=<?= (int) filemtime(__DIR__ . '/customer-downloads.css') ?>">
  <?php if ($downloadsEnabled && $downloadOrder !== ''): ?><script src="customer-downloads.js?v=<?= (int) filemtime(__DIR__ . '/customer-downloads.js') ?>" defer></script><?php endif; ?>
  <title>Your downloads · Ezkart</title>
</head><body>
  <header class="payment-header"><div class="header-content"><img class="brand" src="../assets/ezkart-logo.svg" width="1020" height="420" alt="Ezkart"><span class="secure-label">Your purchases</span></div></header>
  <main class="downloads-shell" data-customer-downloads data-csrf="<?= $escape($customerCsrf) ?>" data-version="<?= $escape($customerVersion) ?>" data-account="<?= $escape($customerAccount['id']) ?>" data-order="<?= $escape($downloadOrder) ?>" data-worker="customer-download-worker.js?v=<?= (int) filemtime(__DIR__ . '/customer-download-worker.js') ?>">
    <?php if ($downloadOrder !== ''): ?><nav aria-label="Your order"><a href="return.php?order=<?= $escape($downloadOrder) ?>">Back to your order</a><a href="messages.php?order=<?= $escape($downloadOrder) ?>">Message seller</a></nav><?php endif; ?>
    <div class="downloads-heading"><div><p class="downloads-eyebrow">YOUR PURCHASES</p><h1>Your downloads</h1></div>
      <form method="post" action="login.php"><input type="hidden" name="action" value="logout"><input type="hidden" name="csrf_token" value="<?= $escape($customerCsrf) ?>"><input type="hidden" name="next" value="<?= $escape($customerNext) ?>"><button type="submit" class="download-secondary">Sign out</button></form>
    </div>
    <p class="downloads-account">Signed in as <?= $escape($customerAccount['email']) ?></p>
    <?php if ($downloadsEnabled && $downloadOrder !== ''): ?>
      <p>Download the original files included with your purchase. Your files are checked as they arrive, then you can save them to your device.</p>
      <p class="download-help">You can pause or resume on this browser. Keep enough free space for the file. A complete, verified download confirms digital delivery.</p>
      <div class="downloads-toolbar"><p data-download-status role="status">Loading your purchased files…</p><button type="button" class="download-secondary" data-download-refresh>Refresh purchases</button></div>
      <div data-download-list></div>
      <noscript><p>Enable JavaScript to download and verify your purchased files.</p></noscript>
    <?php else: ?><p role="status"><?= $downloadOrder === '' ? 'Open downloads from your order to find your purchased files.' : 'Downloads are not available for this checkout yet.' ?></p><?php endif; ?>
  </main>
</body></html>
