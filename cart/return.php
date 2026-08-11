<?php
declare(strict_types=1);
$orderId = trim((string) ($_GET['order'] ?? ''));
if (preg_match('/^EZK-[A-Z0-9-]{8,70}$/', $orderId) !== 1) {
    http_response_code(400);
    $orderId = '';
}
?>
<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <link rel="icon" href="../assets/favicon.svg" type="image/svg+xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="cart.css">
  <title>Status pembayaran Midtrans · Ezkart</title>
</head>
<body>
  <header class="checkout-header"><a class="brand" href="../"><img src="../assets/ezkart-logo.svg" alt="Ezkart"></a><span class="sandbox-pill"><i></i> Midtrans Sandbox</span></header>
  <main class="return-shell" data-order="<?= htmlspecialchars($orderId, ENT_QUOTES, 'UTF-8') ?>">
    <section class="success-card return-card">
      <div class="success-icon pending-icon" id="return-icon">···</div>
      <p class="eyebrow">Midtrans payment status</p>
      <h1 id="return-title">Menunggu konfirmasi Midtrans…</h1>
      <p id="return-message">Halaman ini menunggu notifikasi bertanda tangan dari server Midtrans. Jangan tutup halaman ini.</p>
      <div class="success-details">
        <div><span>Nomor pesanan</span><b id="return-order"><?= htmlspecialchars($orderId, ENT_QUOTES, 'UTF-8') ?></b></div>
        <div><span>Status</span><b id="return-status">Pending</b></div>
        <div><span>Total</span><b id="return-total">—</b></div>
        <div><span>Transaksi Midtrans</span><b id="return-reference">—</b></div>
        <div><span>Fulfillment Biteship</span><b id="return-fulfillment">Menunggu pembayaran</b></div>
      </div>
      <div class="success-actions"><a class="primary-button" href="./">Kembali ke keranjang</a><a class="text-button" href="../">Kembali ke Ezkart</a></div>
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
          if (!response.ok) throw new Error(data.error || 'Status tidak tersedia.');
          document.getElementById('return-total').textContent = money.format(data.total);
          document.getElementById('return-reference').textContent = data.midtrans_transaction_id || 'Menunggu';
          document.getElementById('return-status').textContent = data.status;
          const fulfillment = document.getElementById('return-fulfillment');
          fulfillment.textContent = data.fulfillment_status === 'CONFIRMED'
            ? (data.biteship_waybill_id || data.biteship_order_id || 'Order test dibuat')
            : data.fulfillment_status === 'RETRY_REQUIRED' ? 'Menyinkronkan ulang' : 'Menunggu pembayaran';
          if (data.status === 'PAID') {
            shell.classList.add('confirmed');
            document.getElementById('return-icon').textContent = '✓';
            document.getElementById('return-title').textContent = 'Pembayaran dikonfirmasi Midtrans';
            if (data.fulfillment_status === 'CONFIRMED') {
              document.getElementById('return-message').textContent = `Terima kasih, ${String(data.customer_name).split(' ')[0]}. Pembayaran terverifikasi dan order pengiriman Biteship Test sudah dibuat.`;
              return;
            }
            document.getElementById('return-message').textContent = 'Pembayaran sudah aman. Ezkart sedang menyelesaikan handoff pengiriman ke Biteship Test.';
          }
          if (data.status === 'FAILED') {
            document.getElementById('return-icon').textContent = '×';
            document.getElementById('return-title').textContent = 'Pembayaran tidak berhasil';
            document.getElementById('return-message').textContent = 'Midtrans mengembalikan status pembayaran gagal, kedaluwarsa, atau dibatalkan.';
            return;
          }
        } catch (error) {
          document.getElementById('return-message').textContent = error.message;
        }
        if (attempts < 30) setTimeout(check, 2000);
        else document.getElementById('return-message').textContent = 'Konfirmasi membutuhkan waktu lebih lama. Nomor pesanan di atas dapat digunakan untuk pengecekan.';
      }
      check();
    })();
  </script>
</body>
</html>
