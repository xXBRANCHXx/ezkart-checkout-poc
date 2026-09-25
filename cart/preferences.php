<?php
declare(strict_types=1);
require_once __DIR__ . '/api/customer-auth.php';
require_once __DIR__ . '/api/commerce-client.php';
header('Cache-Control: no-store');
header('Referrer-Policy: same-origin');
header('X-Content-Type-Options: nosniff');
$customerNext = ez_customer_next((string) ($_SERVER['REQUEST_URI'] ?? '/cart/preferences.php'));
try { $customerAccount = ez_customer_current(); } catch (Throwable) { $customerAccount = null; }
$customerCsrf = ez_customer_csrf();
if ($customerAccount === null || ($_GET['signin'] ?? '') === '1') {
    $customerGate = ['title' => 'Email preferences', 'description' => 'Sign in to choose which stores may send you promotional emails.', 'button' => 'Sign in to continue', 'success' => 'Finish signing in with Google to manage your email preferences.'];
    require __DIR__ . '/tracking-gate.php';
    exit;
}
$customerVersion = (string) ($_SESSION['customer_auth']['version'] ?? '');
session_write_close();
$preferencesEnabled = ez_central_commerce_enabled();
$preferenceOrder = is_string($_GET['order'] ?? null) && preg_match('/^EZK-[SP]-[A-F0-9]{24}$/D', $_GET['order']) === 1 ? $_GET['order'] : '';
$escape = static fn(string $text): string => htmlspecialchars($text, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
?>
<!doctype html>
<html lang="en"><head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
  <link rel="icon" href="../assets/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="payment.css?v=2">
  <link rel="stylesheet" href="customer-consents.css?v=<?= (int) filemtime(__DIR__ . '/customer-consents.css') ?>">
  <?php if ($preferencesEnabled): ?><script src="customer-consents.js?v=<?= (int) filemtime(__DIR__ . '/customer-consents.js') ?>" defer></script><?php endif; ?>
  <title>Email preferences · Ezkart</title>
</head><body>
  <header class="payment-header"><div class="header-content"><img class="brand" src="../assets/ezkart-logo.svg" width="1020" height="420" alt="Ezkart"><span class="secure-label">Your account</span></div></header>
  <main class="preferences-shell" data-customer-consents data-csrf="<?= $escape($customerCsrf) ?>" data-version="<?= $escape($customerVersion) ?>" data-order="<?= $escape($preferenceOrder) ?>">
    <nav aria-label="Customer account"><?php if ($preferenceOrder !== ''): ?><a href="return.php?order=<?= $escape($preferenceOrder) ?>">Back to your order</a><?php endif; ?><a href="addresses.php">Delivery addresses</a></nav>
    <div class="preferences-heading"><div><p class="preferences-eyebrow">YOUR CHOICES</p><h1>Email preferences</h1></div>
      <form method="post" action="login.php"><input type="hidden" name="action" value="logout"><input type="hidden" name="csrf_token" value="<?= $escape($customerCsrf) ?>"><input type="hidden" name="next" value="<?= $escape($customerNext) ?>"><button type="submit" class="preference-secondary">Sign out</button></form>
    </div>
    <p>Choose which stores may send promotional emails. You can withdraw permission at any time. Your order and delivery updates are unaffected.</p>
    <?php if ($preferencesEnabled): ?>
      <p class="preferences-account" data-consent-account></p>
      <div class="preferences-toolbar"><p data-consent-status role="status">Loading your preferences…</p><button type="button" class="preference-secondary" data-consent-refresh>Refresh preferences</button></div>
      <p data-consent-error class="preference-error" role="alert" hidden></p>
      <div data-consent-list></div>
      <button type="button" class="preference-secondary" data-consent-more hidden>Load more stores</button>
      <noscript><p>Enable JavaScript to view and save your email preferences.</p></noscript>
    <?php else: ?><p class="preferences-unavailable" role="status">Email preferences are not available for this checkout yet.</p><?php endif; ?>
  </main>
</body></html>
