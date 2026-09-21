<?php
declare(strict_types=1);
require_once __DIR__ . '/api/customer-auth.php';
header('Cache-Control: no-store');
$customerNext = ez_customer_next((string) ($_SERVER['REQUEST_URI'] ?? '/cart/return.php'));
try { $customerAccount = ez_customer_current(); }
catch (Throwable) { $customerAccount = null; }
$customerCsrf = ez_customer_csrf();
if ($customerAccount === null || ($_GET['signin'] ?? '') === '1') {
    require __DIR__ . '/tracking-gate.php';
    exit;
}
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
  <link rel="stylesheet" href="vendor/maplibre/maplibre-gl.css?v=5.24.0">
  <link rel="stylesheet" href="tracking.css?v=7">
  <script src="tracking-map.js?v=3" defer></script>
  <?php if ($isTrackingSandbox): ?><script src="tracking-sandbox.js?v=2" defer></script><?php endif; ?>
  <script src="tracking.js?v=6" defer></script>
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
    <a id="switch-tracking-account" class="copy-button courier-link" href="<?= htmlspecialchars($customerNext . (str_contains($customerNext, '?') ? '&' : '?') . 'signin=1', ENT_QUOTES, 'UTF-8') ?>" hidden>Use a different Google account</a>
    <div id="tracking-content" hidden>
      <section class="tracking-card" aria-labelledby="return-title">
        <div class="tracking-heading"><h2 id="return-title">Confirming your payment</h2><p id="return-message" role="status">We’re checking your payment status.</p></div>
        <ol id="tracking-steps" class="tracking-steps" aria-label="Order progress">
          <li><span class="step-dot" aria-hidden="true">1</span><div><b>Payment received</b><small>Payment confirmed</small></div></li>
          <li><span class="step-dot" aria-hidden="true">2</span><div><b>Seller processing</b><small id="processing-detail">Preparing your order</small></div></li>
          <li><span class="step-dot" aria-hidden="true">3</span><div><b>Awaiting pickup</b><small>Courier collection arranged</small></div></li>
          <li><span class="step-dot" aria-hidden="true">4</span><div><b>On the way</b><small>Picked up by the courier</small></div></li>
          <li><span class="step-dot" aria-hidden="true">5</span><div><b>Delivered</b><small>Order received</small></div></li>
        </ol>
        <div class="tracking-controls"><span id="tracking-updated">Updates appear here automatically.</span><span>Updates automatically</span></div>
      </section>
      <div class="tracking-layout">
        <section id="delivery-map-section" class="tracking-card map-card" aria-labelledby="map-title" hidden>
          <div class="package-map-heading"><div><span class="map-eyebrow">FOLLOW YOUR DELIVERY</span><h2 id="map-title">Delivery map</h2></div><span id="map-location-badge" class="map-location-badge">Last reported location</span></div>
          <p id="package-update" class="package-update"></p>
          <p id="package-location-time" class="package-location-time"></p>
          <?php if ($isTrackingSandbox): ?>
          <section class="sandbox-address" aria-label="Test a delivery address">
            <form id="sandbox-address-form" data-csrf="<?= htmlspecialchars($customerCsrf, ENT_QUOTES, 'UTF-8') ?>">
              <label for="sandbox-address-input">Try a delivery address</label>
              <div class="address-search-row"><input id="sandbox-address-input" type="search" placeholder="Street address or place in Indonesia" minlength="3" maxlength="240" autocomplete="off" required><button type="submit">Find address</button></div>
            </form>
            <p id="sandbox-address-status" role="status">Search, then choose a match to see its delivery pin.</p>
            <ul id="sandbox-address-results" class="address-results" aria-label="Address matches" hidden></ul>
            <div id="sandbox-address-selected" class="address-selected" hidden><div><span>Deliver to</span><strong id="sandbox-address-name"></strong><p id="sandbox-address-detail"></p></div><div class="address-preview-actions"><button id="sandbox-address-focus" type="button">Show delivery pin</button><button id="sandbox-address-reset" type="button">Use sample address</button></div></div>
            <p class="address-search-credit">Address search: <a href="https://photon.komoot.io/" target="_blank" rel="noopener noreferrer">Photon</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap</a></p>
          </section>
          <?php endif; ?>
          <div class="package-map-frame" id="package-map-frame" hidden>
            <div id="delivery-map" role="region" aria-label="Delivery map showing the package’s last reported location and suggested road route"></div>
            <div id="map-loading" class="map-loading" role="status">Loading delivery map…</div>
            <div class="map-tools" id="map-tools" hidden>
              <button id="map-recenter" type="button" aria-label="Center map on package location" title="Center on package"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/></svg></button>
              <div class="map-zoom"><button id="map-zoom-in" type="button" aria-label="Zoom in">+</button><button id="map-zoom-out" type="button" aria-label="Zoom out">−</button></div>
            </div>
          </div>
          <p id="package-location-empty" class="location-empty" hidden>The courier hasn’t shared a package location yet. Follow the latest updates below.</p>
          <p id="map-notice" class="muted" role="status" hidden>The map is temporarily unavailable. Your order updates are still shown above.</p>
          <div class="map-route-summary" id="map-route-summary" hidden><span class="route-line-key" aria-hidden="true"></span><p id="map-route-note" role="status"></p><span class="route-credit"><a href="https://routing.openstreetmap.de/about.html" target="_blank" rel="noopener noreferrer">Routing: FOSSGIS</a> · <a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noopener noreferrer">Fix the map</a></span></div>
          <div class="package-map-actions"><button id="map-route-toggle" type="button" hidden>View full route</button><a id="google-maps-link" target="_blank" rel="noopener noreferrer" hidden>Open in Google Maps ↗</a><a id="courier-tracking-link" class="courier-link" target="_blank" rel="noopener noreferrer" hidden>View courier tracking ↗</a></div>
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
