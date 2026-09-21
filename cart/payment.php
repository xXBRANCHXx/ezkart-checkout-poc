<?php
declare(strict_types=1);
$orderId = trim((string) ($_GET['order'] ?? ''));
if (preg_match('/^EZK-[SP]-[A-F0-9]{24}$/D', $orderId) !== 1) {
    http_response_code(400);
    $orderId = '';
}
header('Cache-Control: no-store');
header('Referrer-Policy: no-referrer');
header('X-Content-Type-Options: nosniff');
header("Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
?>
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <meta name="theme-color" content="#ffffff">
  <link rel="icon" href="../assets/favicon.svg" type="image/svg+xml">
  <link rel="preload" href="admin/assets/fonts/inter.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="payment.css?v=2">
  <script src="payment.js?v=3" defer></script>
  <title>Complete your payment · Ezkart</title>
</head>
<body>
  <header class="payment-header">
    <div class="header-content">
      <img class="brand" src="../assets/ezkart-logo.svg" width="1020" height="420" alt="Ezkart">
      <span class="secure-label"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg> Secure checkout</span>
    </div>
  </header>
  <main id="payment" class="payment-shell" data-order="<?= htmlspecialchars($orderId, ENT_QUOTES, 'UTF-8') ?>">
    <div class="payment-intro">
      <div class="eyebrow"><span>Checkout <span class="step-divider" aria-hidden="true">/</span> <strong>Payment</strong></span><span id="sandbox-badge" class="test-badge" hidden>Sandbox</span></div>
      <h1 id="payment-title">Complete payment</h1>
      <p id="payment-description">Transfer to the BCA Virtual Account below to complete your order.</p>
    </div>
    <p id="page-notice" class="notice" role="status">Loading your payment details…</p>
    <button id="retry-details" class="copy-button" type="button" hidden>Try again</button>
    <div id="payment-layout" class="payment-layout" hidden>
      <section class="payment-card" aria-label="Payment details">
        <div class="card-heading">
          <img class="bank-logo" src="../assets/payment/bca.png" width="331" height="138" alt="BCA">
          <div class="bank-description"><h2>BCA Virtual Account</h2><p>Bank transfer</p></div>
          <span id="payment-state" class="state-pill">Awaiting payment</span>
        </div>
        <div id="transfer-details" hidden>
          <div class="amount-block">
            <span class="field-label">Total to pay</span>
            <div class="copy-row"><strong id="payment-amount" class="amount">—</strong><button class="copy-button" data-copy="amount" type="button" aria-label="Copy payment amount">Copy amount</button></div>
            <p>Transfer this exact amount.</p>
          </div>
          <div class="account-block">
            <label class="field-label" for="account-number">Virtual account number</label>
            <div class="account-box"><input id="account-number" readonly inputmode="numeric" aria-label="BCA virtual account number" spellcheck="false"><button class="copy-button" data-copy="account" type="button" aria-label="Copy virtual account number">Copy number</button></div>
            <p id="account-name" hidden></p>
          </div>
          <div class="deadline"><div><span class="field-label">Payment deadline</span><strong id="payment-deadline">—</strong></div><span id="time-left"></span></div>
        </div>
        <div id="result-panel" class="result-panel" hidden><div id="result-icon" class="result-icon" aria-hidden="true">✓</div><h2 id="result-title"></h2><p id="result-message"></p></div>
        <div class="payment-actions">
          <button id="check-payment" class="primary-button" type="button">Check payment status</button>
          <a id="order-link" class="primary-button" href="return.php" hidden>View order</a>
          <p id="check-message" role="status" aria-live="polite">Your payment will be confirmed automatically after the transfer.</p>
        </div>
      </section>
      <aside class="summary-card" aria-label="Order summary">
        <h2>Order summary</h2>
        <ul id="order-items" class="order-items"></ul>
        <dl class="order-totals"><div><dt>Subtotal</dt><dd id="order-subtotal">—</dd></div><div id="shipping-row"><dt>Delivery</dt><dd id="order-shipping">—</dd></div><div class="total-row"><dt>Total</dt><dd id="order-total">—</dd></div></dl>
        <div class="order-reference"><span>Order number</span><span id="order-number"></span></div>
        <p id="sandbox-note" class="sandbox-note" hidden>This is a test payment. Do not transfer real money.</p>
      </aside>
      <section id="payment-instructions" class="instructions" aria-label="How to pay" hidden>
        <h2>How to pay</h2>
        <details open><summary>BCA mobile</summary><ol><li>Open BCA mobile and select <strong>m-Transfer</strong>.</li><li>Select <strong>BCA Virtual Account</strong> and enter the account number above.</li><li>Check the payment details and exact amount, then enter your PIN to confirm.</li><li>Return to this page. Your payment status will update automatically.</li></ol></details>
        <details><summary>myBCA</summary><ol><li>Open myBCA and select <strong>Transfer</strong>, then <strong>Virtual Account</strong>.</li><li>Enter the virtual account number above.</li><li>Check the payment details and exact amount, then confirm with your PIN.</li></ol></details>
        <details><summary>BCA ATM</summary><ol><li>Insert your card and enter your PIN.</li><li>Select <strong>Other Transactions → Transfer → BCA Virtual Account</strong>.</li><li>Enter the account number above and check the payment details.</li><li>Confirm the payment and keep your receipt.</li></ol></details>
      </section>
    </div>
    <div class="payment-bottom"><a id="checkout-link" href="./">← Back to checkout</a><span>Payments processed securely by DOKU</span></div>
  </main>
  <div id="copy-feedback" class="copy-feedback" role="status" aria-live="polite"></div>
</body>
</html>
