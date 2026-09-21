<?php
// Included only by the tracking page. No order data is loaded until authenticated.
if (!isset($customerNext, $customerCsrf)) { http_response_code(404); exit; }
$escape = static fn(string $text): string => htmlspecialchars($text, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
$gateError = (string) ($_SESSION['customer_flash'] ?? '');
unset($_SESSION['customer_flash']);
$gateVersion = (string) ($_SESSION['customer_auth']['version'] ?? '');
$gateSwitch = ($_GET['signin'] ?? '') === '1';
if ($gateSwitch) $_SESSION['customer_skip_existing_login'] = true;
$gateCheckExisting = !$gateSwitch && empty($_SESSION['customer_skip_existing_login']) && $gateError === '';
session_write_close();
header('Referrer-Policy: same-origin');
header('X-Content-Type-Options: nosniff');
$gateProvider = '';
try { $gateProvider = ez_customer_auth_settings()['url']; } catch (Throwable) {}
header("Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self' " . $gateProvider . " https://accounts.google.com");
?>
<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><link rel="icon" href="/assets/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/cart/payment.css?v=2"><link rel="stylesheet" href="/cart/tracking.css?v=3"><link rel="stylesheet" href="/cart/customer-auth.css?v=2"><script src="/cart/customer-auth.js?v=1" defer></script><title>Track your order · Ezkart</title></head>
<body><header class="payment-header"><div class="header-content"><img class="brand" src="/assets/ezkart-logo.svg" width="1020" height="420" alt="Ezkart"><span class="secure-label">Order tracking</span></div></header>
<main class="return-shell tracking-locked" id="tracking-auth" data-next="<?= $escape($customerNext) ?>" data-version="<?= $escape($gateVersion) ?>" data-check-existing="<?= $gateCheckExisting ? 'true' : 'false' ?>">
<div class="tracking-intro"><h1>Track your order</h1></div>
<p id="auth-loading" class="auth-loading" role="status">Checking your sign-in…</p>
<div class="tracking-placeholder" aria-hidden="true"><div class="placeholder-summary"><i></i><i></i><div class="placeholder-steps"><b></b><b></b><b></b><b></b><b></b></div></div><div class="placeholder-columns"><div></div><div></div></div></div>
<dialog id="tracking-auth-dialog" aria-labelledby="auth-title" aria-describedby="auth-description">
<div class="auth-parcel" aria-hidden="true"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.7"><path d="m12 3 9 5-9 5-9-5 9-5Z M3 8v9l9 5 9-5V8 M12 13v9 M7.5 5.5l9 5"/></svg></div>
<h2 id="auth-title">Track your order</h2><p id="auth-description">Sign in to see where your package is and follow its delivery.</p>
<form id="tracking-signin" method="post" action="/cart/login.php"><input type="hidden" name="action" value="google"><input type="hidden" name="csrf_token" value="<?= $escape($customerCsrf) ?>"><input type="hidden" name="next" value="<?= $escape($customerNext) ?>"><button class="google-button" type="submit" autofocus><?php require __DIR__ . '/google-icon.php'; ?>Sign in to track</button></form>
<p id="auth-message" class="auth-message" role="alert"<?= $gateError === '' ? ' hidden' : '' ?>><?= $escape($gateError) ?></p>
<a class="auth-back" href="/cart/">Back to checkout</a>
</dialog>
<noscript><p>Sign in with Google to track your order.</p><form method="post" action="/cart/login.php"><input type="hidden" name="action" value="google"><input type="hidden" name="csrf_token" value="<?= $escape($customerCsrf) ?>"><input type="hidden" name="next" value="<?= $escape($customerNext) ?>"><button class="google-button" type="submit">Sign in to track</button></form></noscript>
</main></body></html>
