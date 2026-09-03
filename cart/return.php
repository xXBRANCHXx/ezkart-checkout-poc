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
  <link rel="icon" href="../assets/favicon.svg" type="image/svg+xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="cart.css?v=checkout-reboot-3">
  <title>Order status · Ezkart</title>
</head>
<body>
  <header class="checkout-header">
    <a class="brand" href="../" aria-label="Ezkart home"><img src="../assets/ezkart-logo.svg" alt="Ezkart"></a>
    <div class="header-security"><span class="lock-mark" aria-hidden="true">✓</span><span><b>Secure checkout</b><small>Protected order status</small></span></div>
  </header>
  <main class="return-shell" data-order="<?= htmlspecialchars($orderId, ENT_QUOTES, 'UTF-8') ?>">
    <section class="success-card return-card">
      <div class="success-icon pending-icon" id="return-icon">···</div>
      <h1 id="return-title">Confirming your payment…</h1>
      <p id="return-message">We’re waiting for a signed confirmation from the payment provider. Please keep this page open.</p>
      <div class="success-details">
        <div><span>Order number</span><b id="return-order"><?= htmlspecialchars($orderId, ENT_QUOTES, 'UTF-8') ?></b></div>
        <div><span>Status</span><b id="return-status">Pending</b></div>
        <div><span>Total</span><b id="return-total">—</b></div>
        <div><span>Payment reference</span><b id="return-reference">—</b></div>
        <div><span>Delivery</span><b id="return-fulfillment">Waiting for payment</b></div>
      </div>
      <div class="success-actions"><a class="primary-button" href="./">Back to checkout</a><a class="text-button" href="../">Return to Ezkart</a></div>
    </section>
  </main>
  <script>
    (() => {
      const shell = document.querySelector('.return-shell');
      const order = shell.dataset.order;
      const money = new Intl.NumberFormat('id-ID', { style:'currency', currency:'IDR', maximumFractionDigits:0 });
      let attempts = 0;
      async function check() {
        attempts += 1;
        try {
          const response = await fetch(`api/status.php?order=${encodeURIComponent(order)}`, { cache:'no-store' });
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
            : data.fulfillment_status === 'RETRY_REQUIRED' ? 'Delivery setup needs attention' : 'Waiting for payment';
          if (data.status === 'PAID') {
            shell.classList.add('confirmed');
            document.getElementById('return-icon').textContent = '✓';
            document.getElementById('return-title').textContent = 'Payment confirmed';
            if (data.fulfillment_status === 'CONFIRMED') {
              document.getElementById('return-message').textContent = `Thank you, ${String(data.customer_name).split(' ')[0]}. Your payment is verified and courier pickup has been arranged.`;
              return;
            }
            document.getElementById('return-message').textContent = 'Your payment is secure. The seller will confirm the order before arranging pickup.';
          }
          if (data.status === 'FAILED') {
            document.getElementById('return-icon').textContent = '×';
            document.getElementById('return-title').textContent = 'Payment wasn’t completed';
            document.getElementById('return-message').textContent = 'The payment was declined, expired, or cancelled. Your card was not charged by Ezkart.';
            return;
          }
        } catch (error) {
          document.getElementById('return-message').textContent = error.message;
        }
        if (attempts < 30) setTimeout(check, 2000);
        else document.getElementById('return-message').textContent = 'Confirmation is taking longer than usual. Keep the order number above for support.';
      }
      check();
    })();
  </script>
</body>
</html>
