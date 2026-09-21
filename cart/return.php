<?php
declare(strict_types=1);
$orderId = trim((string) ($_GET['order'] ?? ''));
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
  <link rel="stylesheet" href="tracking.css?v=1">
  <script src="vendor/leaflet/leaflet.js?v=1.9.4" defer></script>
  <script src="tracking.js?v=1" defer></script>
  <title>Track your order · Ezkart</title>
</head>
<body>
  <header class="payment-header"><div class="header-content">
    <img class="brand" src="../assets/ezkart-logo.svg" width="1020" height="420" alt="Ezkart">
    <span class="secure-label">Order updates</span>
  </div></header>
  <main class="return-shell" data-order="<?= htmlspecialchars($orderId, ENT_QUOTES, 'UTF-8') ?>">
    <div class="tracking-intro">
      <div class="eyebrow"><span id="merchant-name-return">Your order</span><span id="tracking-sandbox" class="test-badge" hidden>Sandbox</span></div>
      <h1>Track your order</h1>
      <p>Keep this page for updates from payment to delivery.</p>
    </div>
    <p id="tracking-notice" class="notice" role="status">Loading your order…</p>
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
          <h2 id="map-title">Delivery locations</h2>
          <p class="muted">Pickup and delivery locations provided by the courier. For live courier movement, use the courier tracking link when available.</p>
          <div id="delivery-map" role="region" aria-label="Map of pickup and delivery locations"></div>
          <p id="map-notice" class="muted" role="status" hidden>The map is temporarily unavailable. Your order updates are still shown above.</p>
          <div class="map-legend"><span><i class="origin-dot"></i> Pickup</span><span><i class="destination-dot"></i> Delivery</span></div>
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
          <a id="courier-tracking-link" class="copy-button courier-link" target="_blank" rel="noopener noreferrer" hidden>View courier tracking ↗</a>
        </aside>
      </div>
    </div>
    <button id="retry-tracking" class="copy-button" type="button" hidden>Try again</button>
    <div class="payment-bottom"><a id="return-checkout-link" href="./">← Back to checkout</a><a id="return-store-link" href="../">Return to store</a></div>
  </main>
</body>
</html>
