<?php
declare(strict_types=1);
require_once __DIR__ . '/api/customer-auth.php';
require_once __DIR__ . '/api/commerce-client.php';
header('Cache-Control: no-store'); header('X-Content-Type-Options: nosniff'); header('Referrer-Policy: same-origin');
$customerNext = ez_customer_next((string) ($_SERVER['REQUEST_URI'] ?? '/cart/notifications.php'));
try { $customerAccount = ez_customer_current(); } catch (Throwable) { $customerAccount = null; }
$customerCsrf = ez_customer_csrf();
if ($customerAccount === null || ($_GET['signin'] ?? '') === '1') {
    $customerGate = ['title' => 'Your order updates', 'description' => 'Sign in to see payment, shipping, return, and message notifications from your stores.', 'button' => 'Sign in to see updates', 'success' => 'Finish signing in with Google to open your notifications.'];
    require __DIR__ . '/tracking-gate.php'; exit;
}
$notificationConfig = ['merchant' => false, 'account' => $customerAccount['id'], 'version' => (string) ($_SESSION['customer_auth']['version'] ?? ''), 'csrf' => $customerCsrf,
    'enabled' => ez_central_commerce_enabled(), 'environment' => ez_commerce_environment()];
session_write_close();
header("Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
?>
<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Notifications · Ezkart</title><link rel="icon" href="/assets/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/cart/select.css"><script src="/cart/select.js" defer></script><link rel="stylesheet" href="/cart/notifications.css?v=<?= (int) filemtime(__DIR__ . '/notifications.css') ?>"></head>
<body class="customer-notifications-page"><header class="notice-customer-header"><a href="/cart/"><img src="/assets/ezkart-logo.svg" width="116" height="48" alt="Ezkart"></a><div><span><?= htmlspecialchars($customerAccount['email'], ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8') ?></span><form action="/cart/login.php" method="post"><input type="hidden" name="action" value="logout"><input type="hidden" name="csrf_token" value="<?= htmlspecialchars($customerCsrf, ENT_QUOTES, 'UTF-8') ?>"><input type="hidden" name="next" value="<?= htmlspecialchars($customerNext, ENT_QUOTES, 'UTF-8') ?>"><button type="submit">Sign out</button></form></div></header>
<main><?php require __DIR__ . '/notifications-workspace.php'; ?></main></body></html>
