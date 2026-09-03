<?php
declare(strict_types=1);
$orderId = trim((string) ($_GET['order'] ?? ''));
if (preg_match('/^EZK-[A-Z0-9-]{8,70}$/', $orderId) !== 1) {
    http_response_code(400);
    $orderId = '';
}
?>
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <meta name="theme-color" content="#ffffff">
  <link rel="icon" href="../assets/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="cart.css?v=checkout-rebuild-3">
  <title>Order status · Ezkart</title>
</head>
<body class="return-page">
  <header class="checkout-header">
    <div class="header-inner">
      <div class="merchant-brand">
        <span class="merchant-avatar" id="merchant-avatar-return" aria-hidden="true">S</span>
        <img id="merchant-logo-return" alt="" referrerpolicy="no-referrer" hidden>
        <span class="merchant-copy"><small>Order from</small><strong id="merchant-name-return">Store</strong></span>
      </div>
    </div>
  </header>

  <main class="return-shell" data-order="<?= htmlspecialchars($orderId, ENT_QUOTES, 'UTF-8') ?>">
    <section class="return-card">
      <div class="success-icon" id="return-icon" aria-hidden="true">···</div>
      <h1 id="return-title">Confirming your payment</h1>
      <p id="return-message">We’re securely checking your payment status. Please keep this page open.</p>
      <div class="success-details">
        <div><span>Order number</span><b id="return-order"><?= htmlspecialchars($orderId, ENT_QUOTES, 'UTF-8') ?></b></div>
        <div><span>Status</span><b id="return-status">Pending</b></div>
        <div><span>Total</span><b id="return-total">—</b></div>
        <div><span>Payment reference</span><b id="return-reference">—</b></div>
        <div><span>Delivery</span><b id="return-fulfillment">Waiting for payment</b></div>
      </div>
      <div class="success-actions">
        <a class="primary-button" href="./">Back to checkout</a>
        <a class="text-button" href="../">Return to Ezkart</a>
      </div>
    </section>
  </main>

  <footer class="checkout-footer">
    <img src="../assets/ezkart-logo.svg" alt="Ezkart" width="1020" height="420">
    <p>Simple, secure checkout for Indonesian businesses.</p>
    <span>© <?= gmdate('Y') ?> Ezkart</span>
  </footer>

  <script>
    (() => {
      const safeMessage = (value, fallback = 'Order status is temporarily unavailable.') => String(value || fallback)
        .replace(/midtrans|doku|xendit|stripe|paypal/gi, 'payment service')
        .replace(/biteship/gi, 'delivery service');
      try {
        const brand = JSON.parse(sessionStorage.getItem('ezkart.checkout.brand') || '{}');
        const name = String(brand.name || 'Store').slice(0, 80);
        document.getElementById('merchant-name-return').textContent = name;
        document.getElementById('merchant-avatar-return').textContent = name.charAt(0).toUpperCase();
        if (brand.logo && /^https?:\/\//i.test(brand.logo)) {
          const image = document.getElementById('merchant-logo-return');
          image.src = brand.logo;
          image.alt = name + ' logo';
          image.hidden = false;
          document.getElementById('merchant-avatar-return').hidden = true;
          image.addEventListener('error', () => {
            image.hidden = true;
            document.getElementById('merchant-avatar-return').hidden = false;
          }, { once: true });
        }
      } catch (_) {}

      const shell = document.querySelector('.return-shell');
      const order = shell.dataset.order;
      const money = new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        maximumFractionDigits: 0,
      });
      let attempts = 0;

      async function check() {
        attempts += 1;
        try {
          const response = await fetch('api/status.php?order=' + encodeURIComponent(order), { cache: 'no-store' });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || 'Order status is unavailable.');
          document.getElementById('return-total').textContent = money.format(data.total);
          document.getElementById('return-reference').textContent = data.midtrans_transaction_id || 'Waiting';
          document.getElementById('return-status').textContent = data.status;
          const fulfillment = document.getElementById('return-fulfillment');
          fulfillment.textContent = data.fulfillment_status === 'CONFIRMED'
            ? (data.biteship_waybill_id || data.biteship_order_id || 'Pickup arranged')
            : data.fulfillment_status === 'AWAITING_PICKUP_ARRANGEMENT' ? 'Seller arranging pickup'
            : data.fulfillment_status === 'AWAITING_ACCEPTANCE' ? 'Waiting for seller confirmation'
            : data.fulfillment_status === 'RETRY_REQUIRED' ? 'Delivery setup needs attention'
            : 'Waiting for payment';

          if (data.status === 'PAID') {
            shell.classList.add('confirmed');
            document.getElementById('return-icon').textContent = '✓';
            document.getElementById('return-title').textContent = 'Payment confirmed';
            if (data.fulfillment_status === 'CONFIRMED') {
              const firstName = String(data.customer_name || '').split(' ')[0];
              document.getElementById('return-message').textContent = (firstName ? 'Thank you, ' + firstName + '. ' : '') + 'Your order is confirmed and pickup has been arranged.';
              return;
            }
            document.getElementById('return-message').textContent = 'Your payment is confirmed. The seller will review the order before arranging pickup.';
          }

          if (data.status === 'FAILED') {
            document.getElementById('return-icon').textContent = '×';
            document.getElementById('return-title').textContent = 'Payment wasn’t completed';
            document.getElementById('return-message').textContent = 'The payment was declined, expired, or cancelled. You can return to checkout and try again.';
            return;
          }
        } catch (error) {
          document.getElementById('return-message').textContent = safeMessage(error.message);
        }
        if (attempts < 30) {
          window.setTimeout(check, 2000);
        } else {
          document.getElementById('return-message').textContent = 'Confirmation is taking longer than usual. Keep the order number above for support.';
        }
      }
      check();
    })();
  </script>
</body>
</html>
