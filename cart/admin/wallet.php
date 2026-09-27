<?php
declare(strict_types=1);

if (empty($authenticated)) { http_response_code(404); return; }

ez_page_header('Wallet', 'Your balance, withdrawal availability, and the payments behind your earnings.', [
    ['label' => 'View payments', 'icon' => 'credit-card', 'href' => '?page=payments', 'style' => 'primary'],
    ['label' => 'Refresh', 'icon' => 'refresh', 'href' => '?page=wallet'],
]);
if (empty($walletAccess['unlocked'])) {
    require __DIR__ . '/wallet-verification.php';
    return;
}

// Account enrollment and payment collection do not establish settled funds.
// Do not derive either from PAID totals or a delivery scan.
$walletOrders = array_values(array_filter($orders, static fn($order) => strtoupper((string) ($order['status'] ?? '')) === 'PAID'));
$walletProductPayments = array_sum(array_map(static fn($order) => max(0, (int) ($order['subtotal'] ?? 0)), $walletOrders));
$walletDataAvailable = $authenticationMethod === 'password' || $sellerId !== '';
$walletOwner = ($activeSeller['role'] ?? '') === 'owner';
?>
<div data-wallet-content data-wallet-seconds="<?= max(0, (int) $walletAccess['expires_at'] - time()) ?>">
<div class="wallet-unlocked-note"><span><?= ez_admin_icon('shield') ?> Wallet unlocked until <?= ez_admin_escape((new DateTimeImmutable('@' . $walletAccess['expires_at']))->setTimezone(new DateTimeZone('Asia/Jakarta'))->format('H:i')) ?> WIB</span><form method="post" action="?page=wallet"><input type="hidden" name="csrf_token" value="<?= ez_admin_escape($csrfToken) ?>"><input type="hidden" name="action" value="wallet_lock"><button type="submit">Lock Wallet</button></form></div>
<?php if ($walletOwner): ?>
<section class="surface wallet-setup" data-wallet-setup data-account="<?= ez_admin_escape((string) ($adminUser['id'] ?? '')) ?>" data-store="<?= ez_admin_escape($sellerId) ?>" data-environment="<?= ez_admin_escape($commerceEnvironment) ?>" aria-labelledby="wallet-setup-title" aria-busy="true">
  <header><div><h2 id="wallet-setup-title">Connect your seller wallet</h2><p>Your store’s payment account with DOKU.</p></div><span class="wallet-status" data-wallet-setup-badge>Checking</span></header>
  <p data-wallet-setup-status role="status" aria-live="polite">Checking your wallet setup…</p>
  <dl class="wallet-setup-details" data-wallet-setup-details hidden><div><dt>Store name</dt><dd data-wallet-setup-name></dd></div><div><dt>Verified owner email</dt><dd data-wallet-setup-email></dd></div><div data-wallet-setup-account-row hidden><dt>DOKU account</dt><dd data-wallet-setup-account></dd></div></dl>
  <p data-wallet-setup-disclosure hidden>Connecting shares this store name and your verified email with DOKU to create your seller payment account. Check these details before continuing.</p>
  <div class="wallet-setup-actions"><button class="action-button primary" type="button" data-wallet-connect hidden>Connect seller wallet</button><button class="action-button" type="button" data-wallet-setup-refresh disabled>Check setup status</button></div>
  <p class="wallet-setup-footnote">Connecting an account does not make funds available to withdraw. Delivery, settlement, refunds, and any holds must be checked first.</p>
  <noscript><p>Enable JavaScript to connect your wallet and check setup status.</p></noscript>
</section>
<?php endif; ?>
<section class="wallet-overview" aria-label="Wallet overview">
  <article class="surface wallet-balance">
    <header><span class="wallet-heading-icon"><?= ez_admin_icon('wallet') ?></span><span class="wallet-environment"><?= $commerceProduction ? 'Production' : 'Sandbox' ?></span></header>
    <h2><?= $centralWalletWorkspace ? 'Available earnings' : 'Current wallet balance' ?></h2>
    <strong class="wallet-amount" aria-label="Balance unavailable"<?= $centralWalletWorkspace ? ' data-wallet-earnings-available' : '' ?>>—</strong>
    <p class="wallet-connection">Wallet connection pending</p>
    <p>Your balance will appear once your seller wallet is connected and its funds are confirmed.</p>
    <?php if ($centralWalletWorkspace): ?><p data-wallet-earnings-status role="status" aria-live="polite"><?= $walletOwner ? 'Checking recorded earnings…' : 'Only the store owner can view earnings.' ?></p><?php endif; ?>
    <dl class="wallet-balances">
      <?php if ($centralWalletWorkspace): ?>
      <div><dt>Pending earnings</dt><dd data-wallet-earnings-pending>—</dd></div>
      <div><dt>Reserved earnings</dt><dd data-wallet-earnings-reserved>—</dd></div>
      <div data-wallet-earnings-deficit-row hidden><dt>Negative earnings</dt><dd data-wallet-earnings-deficit>—</dd></div>
      <?php else: ?>
      <div><dt>Available to withdraw</dt><dd aria-label="Available balance unavailable">—</dd></div>
      <div><dt>Pending release</dt><dd aria-label="Pending balance unavailable">—</dd></div>
      <?php endif; ?>
    </dl>
    <footer><?= ez_admin_icon('help') ?><span>Payment totals can be checked in <a href="?page=payments">Payments</a>. Final earnings include seller fees and settlement.</span></footer>
  </article>
  <article class="surface wallet-withdrawal">
    <header><h2>When can I withdraw?</h2><span class="wallet-status">Not available yet</span></header>
    <p>Earnings become available after both delivery and provider settlement are confirmed.</p>
    <ol class="wallet-release-steps">
      <li><span><?= ez_admin_icon('truck') ?></span><div><b>Delivery confirmed</b><p>Your customer has received the order.</p></div></li>
      <li><span><?= ez_admin_icon('check-circle') ?></span><div><b>Provider settlement confirmed</b><p>Payment funds and final fees have been confirmed.</p></div></li>
      <li><span><?= ez_admin_icon('wallet') ?></span><div><b>At least Rp250.000 available</b><p>Minimum seller withdrawal. Ezkart covers the transfer fee.</p></div></li>
    </ol>
    <div class="wallet-withdraw-action"><button class="ui-button" type="button" disabled aria-describedby="wallet-withdraw-reason" data-ui-icon="wallet">Withdraw funds</button><p id="wallet-withdraw-reason">Bank withdrawals are not available yet. Your earnings remain recorded here.</p></div>
  </article>
</section>
<section class="surface wallet-payments" aria-label="<?= $centralWalletWorkspace ? 'Earnings history' : 'Payments awaiting wallet settlement' ?>">
  <header class="surface-header"><div><h2><?= $centralWalletWorkspace ? 'Earnings history' : 'Payments behind your earnings' ?></h2><p><?= $centralWalletWorkspace ? 'Releases, reserves and adjustments for your orders.' : 'Delivery and settlement status for your paid orders.' ?></p></div><a class="action-button" href="?page=payments">Check all payments <?= ez_admin_icon('chevron-right') ?></a></header>
  <?php if ($centralWalletWorkspace): ?>
  <p class="wallet-empty" data-wallet-earnings-history-status role="status"><?= $walletOwner ? 'Checking earnings history…' : 'Only the store owner can view earnings history.' ?></p>
  <div class="wallet-table-wrap" data-wallet-earnings-history-table hidden><table><thead><tr><th>Order / recorded</th><th>Update</th><th>Available after</th><th>Reserved after</th></tr></thead><tbody data-wallet-earnings-history></tbody></table></div>
  <div class="wallet-table-note"><button class="action-button" type="button" data-wallet-earnings-more hidden>Load earlier updates</button></div>
  <?php else: ?>
  <div class="wallet-payment-summary"><div><small>Product payments received</small><strong><?= $walletDataAvailable ? ez_admin_money($walletProductPayments) : '—' ?></strong><span>Before seller fees · shipping excluded</span></div><div><small>Paid orders</small><strong><?= $walletDataAvailable ? number_format(count($walletOrders)) : '—' ?></strong><span><?= $commerceProduction ? 'Production payment records' : 'Sandbox payment records' ?></span></div></div>
  <?php if (!$walletDataAvailable): ?><p class="wallet-empty" role="alert">Payment records could not be loaded. Reload to try again.</p>
  <?php elseif ($walletOrders === []): ?><p class="wallet-empty">No paid orders yet. Confirmed payments will appear here.</p>
  <?php else: ?>
    <div class="wallet-table-wrap"><table><thead><tr><th>Payment</th><th>Product amount</th><th>Delivery</th><th>Settlement</th></tr></thead><tbody>
    <?php foreach (array_slice($walletOrders, 0, 20) as $order):
        $skipped = ez_order_skips_shipping($order);
        $shipment = ez_tracking_status((string) ($order['biteship_status'] ?? ''));
        $delivered = !$skipped && !empty($order['biteship_order_id']) && $shipment === 'delivered';
        $delivery = $skipped ? 'Skipped in sandbox' : ($delivered ? 'Confirmed' : (in_array($shipment, ['returned', 'cancelled', 'return_in_transit'], true) ? 'Returned or cancelled' : 'Awaiting delivery'));
        $reference = (string) ($order['order_id'] ?? '');
    ?><tr><td><a href="<?= ez_admin_escape('?' . http_build_query(['page' => 'payments', 'order' => $reference])) ?>"><?= ez_admin_escape($reference) ?></a><small><?= ez_admin_escape(ez_admin_time($order['paid_at'] ?? $order['created_at'] ?? '')) ?></small></td><td><?= ez_admin_money($order['subtotal'] ?? 0) ?></td><td><span class="wallet-delivery <?= $delivered ? 'confirmed' : '' ?>"><?= ez_admin_escape($delivery) ?></span></td><td><span>No settlement record</span></td></tr><?php endforeach; ?>
    </tbody></table></div>
    <?php if (count($walletOrders) > 20): ?><p class="wallet-table-note">Showing the 20 most recent paid orders. <a href="?page=payments" data-ui-icon="credit-card">View all payments</a></p><?php endif; ?>
  <?php endif; ?>
  <?php endif; ?>
</section>
</div>
