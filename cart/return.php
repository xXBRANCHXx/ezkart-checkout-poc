<?php
declare(strict_types=1);
require_once __DIR__ . '/api/customer-auth.php';
header('Cache-Control: no-store');
$customerNext = ez_customer_next((string) ($_SERVER['REQUEST_URI'] ?? '/cart/return.php'));
$customerAccount = ez_customer_require_page($customerNext);
$customerCsrf = ez_customer_csrf();
session_write_close();
$isTrackingSandbox = isset($trackingSandboxData) && is_array($trackingSandboxData);
$orderId = $isTrackingSandbox ? 'EZK-S-000000000000000000000001' : trim((string) ($_GET['order'] ?? ''));
if (preg_match('/^EZK-[A-Z0-9-]{8,70}$/D', $orderId) !== 1) {
    http_response_code(400);
    $orderId = '';
}
header('Cache-Control: no-store');
header('Referrer-Policy: strict-origin-when-cross-origin');
header('X-Content-Type-Options: nosniff');
?>
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <meta name="theme-color" content="#ffffff">
  <link rel="icon" href="../assets/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="payment.css?v=2">
  <link rel="stylesheet" href="vendor/leaflet/leaflet.css?v=1.9.4">
  <link rel="stylesheet" href="tracking.css?v=3">
  <script src="vendor/leaflet/leaflet.js?v=1.9.4" defer></script>
  <?php if ($isTrackingSandbox): ?><script src="tracking-sandbox.js?v=1" defer></script><?php endif; ?>
  <script src="tracking.js?v=3" defer></script>
  <title>Track your order · Ezkart</title>
</head>
<body>
  <header class="payment-header"><div class="header-content">
    <img class="brand" src="../assets/ezkart-logo.svg" width="1020" height="420" alt="Ezkart">
    <span class="secure-label">Order updates</span>
  </div></header>
  <main class="return-shell" data-order="<?= htmlspecialchars($orderId, ENT_QUOTES, 'UTF-8') ?>">
    <div class="customer-account"><span>Signed in as <b><?= htmlspecialchars($customerAccount['email'], ENT_QUOTES, 'UTF-8') ?></b></span><form method="post" action="/cart/login.php"><input type="hidden" name="action" value="logout"><input type="hidden" name="csrf_token" value="<?= htmlspecialchars($customerCsrf, ENT_QUOTES, 'UTF-8') ?>"><input type="hidden" name="next" value="<?= htmlspecialchars($customerNext, ENT_QUOTES, 'UTF-8') ?>"><button type="submit">Sign out</button></form></div>
    <?php if ($isTrackingSandbox): ?>
    <section class="sandbox-controls" aria-label="Sandbox walkthrough controls">
      <div><strong>Sandbox walkthrough</strong><p>Simulated order data and sample map locations. No payment or courier booking is made.</p></div>
      <div class="sandbox-actions">
        <label for="sandbox-stage">View a stage<select id="sandbox-stage"><?php foreach ($trackingSandboxData as $key => $scenario): ?><option value="<?= htmlspecialchars($key, ENT_QUOTES, 'UTF-8') ?>"><?= htmlspecialchars($scenario['label'], ENT_QUOTES, 'UTF-8') ?></option><?php endforeach; ?></select></label>
        <button id="sandbox-play" class="copy-button" type="button">Run walkthrough</button>
        <button id="sandbox-next" class="copy-button" type="button">Next step</button>
        <button id="sandbox-reset" class="copy-button" type="button">Restart</button>
      </div>
      <p id="sandbox-progress" role="status">Choose a stage, or run the order from payment to delivery.</p>
    </section>
    <script id="tracking-sandbox-data" type="application/json"><?= json_encode($trackingSandboxData, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_THROW_ON_ERROR) ?></script>
    <?php endif; ?>
    <div class="tracking-intro">
      <div class="eyebrow"><span id="merchant-name-return">Your order</span><span id="tracking-sandbox" class="test-badge" hidden>Sandbox</span></div>
      <h1>Track your order</h1>
      <p>Keep this page for updates from payment to delivery.</p>
    </div>
    <p id="tracking-notice" class="notice" role="status">Loading your order…</p>
    <a id="switch-tracking-account" class="copy-button courier-link" href="/cart/login.php?<?= htmlspecialchars(http_build_query(['switch' => '1', 'next' => $customerNext]), ENT_QUOTES, 'UTF-8') ?>" hidden>Use a different Google account</a>
    <div id="tracking-content" hidden>
      <section class="tracking-card" aria-labelledby="return-title">
        <div class="tracking-heading"><span id="return-icon" class="tracking-icon" aria-hidden="true">…</span><div><h2 id="return-title">Confirming your payment</h2><p id="return-message" role="status">We’re checking your payment status.</p></div></div>
        <ol id="tracking-steps" class="tracking-steps" aria-label="Order progress">
          <li><span class="step-dot" aria-hidden="true">1</span><div><b>Payment received</b><small>Payment confirmed</small></div></li>
          <li><span class="step-dot" aria-hidden="true">2</span><div><b>Seller processing</b><small id="processing-detail">Preparing your order</small></div></li>
          <li><span class="step-dot" aria-hidden="true">3</span><div><b>Awaiting pickup</b><small>Courier collection arranged</small></div></li>
          <li><span class="step-dot" aria-hidden="true">4</span><div><b>On the way</b><small>Picked up by the courier</small></div></li>
          <li><span class="step-dot" aria-hidden="true">5</span><div><b>Delivered</b><small>Order received</small></div></li>
        </ol>
        <div class="tracking-controls"><span id="tracking-updated">Updates appear here automatically.</span><button id="refresh-tracking" class="copy-button" type="button">Refresh status</button></div>
      </section>
      <div class="tracking-layout">
        <section id="delivery-map-section" class="tracking-card map-card" aria-labelledby="map-title" hidden>
          <div class="package-map-heading"><div><span class="map-eyebrow">YOUR PACKAGE</span><h2 id="map-title">Latest delivery update</h2></div><button id="map-recenter" class="map-recenter" type="button" aria-label="Center map on package location" hidden>⌖</button></div>
          <p id="package-update" class="package-update"></p>
          <p id="package-location-time" class="package-location-time"></p>
          <div class="package-map-frame" id="package-map-frame" hidden><span id="map-location-badge" class="map-location-badge">Last reported location</span><div id="delivery-map" role="region" aria-label="Map of the package’s last reported location"></div></div>
          <p id="package-location-empty" class="location-empty" hidden>The courier hasn’t shared a package location yet. Follow the latest updates below.</p>
          <p id="map-notice" class="muted" role="status" hidden>The map is temporarily unavailable. Your order updates are still shown above.</p>
          <div class="package-map-actions"><button id="map-route-toggle" type="button" hidden>View pickup & delivery</button><a id="courier-tracking-link" class="courier-link" target="_blank" rel="noopener noreferrer" hidden>View courier tracking ↗</a></div>
        </section>
        <section class="tracking-card journey-card" aria-labelledby="journey-title">
          <h2 id="journey-title">Order journey</h2>
          <p id="journey-empty" class="muted">Your timeline will start when payment is confirmed.</p>
          <ol id="tracking-history" class="tracking-history"></ol>
        </section>
        <aside class="tracking-card order-card" aria-labelledby="details-title">
          <h2 id="details-title">Order details</h2>
          <dl class="tracking-details">
            <div><dt>Order number</dt><dd id="return-order"><?= htmlspecialchars($orderId, ENT_QUOTES, 'UTF-8') ?></dd></div>
            <div><dt>Payment</dt><dd id="return-status">Pending</dd></div>
            <div><dt>Total</dt><dd id="return-total">—</dd></div>
            <div><dt>Payment reference</dt><dd id="return-reference">—</dd></div>
            <div><dt>Delivery</dt><dd id="return-fulfillment">Waiting for payment</dd></div>
            <div id="courier-row" hidden><dt>Courier</dt><dd id="tracking-courier"></dd></div>
            <div id="waybill-row" hidden><dt>Tracking number</dt><dd id="tracking-waybill"></dd></div>
          </dl>
        </aside>
      </div>
    </div>
    <button id="retry-tracking" class="copy-button" type="button" hidden>Try again</button>
    <div class="payment-bottom"><a id="return-checkout-link" href="./">← Back to checkout</a><a id="return-store-link" href="../">Return to store</a></div>
  </main>
</body>
</html>
