<?php
declare(strict_types=1);
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
  <link rel="icon" href="../assets/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="payment.css?v=2">
  <link rel="stylesheet" href="vendor/maplibre/maplibre-gl.css?v=5.24.0">
  <link rel="stylesheet" href="customer-addresses.css?v=3">
  <script src="address-picker.js?v=2" defer></script>
  <script src="customer-addresses.js?v=4" defer></script>
  <script src="addresses.js?v=1" defer></script>
  <title>Delivery addresses · Ezkart</title>
</head>
<body>
  <header class="payment-header"><div class="header-content"><img class="brand" src="../assets/ezkart-logo.svg" width="1020" height="420" alt="Ezkart"><span class="secure-label">Delivery details</span></div></header>
  <main class="addresses-shell">
    <h1>Delivery addresses</h1>
    <p>Save an address and pin the entrance for your next delivery.</p>
    <div id="customer-address-book"></div>
  </main>
</body>
</html>
