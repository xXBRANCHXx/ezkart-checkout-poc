<?php
declare(strict_types=1);

if (empty($authenticated)) { http_response_code(404); return; }

// Payment callbacks confirm collection only. No settlement feed, wallet mapping
// or payout ledger exists yet, so neither a balance nor a release date is known.
// Do not derive either from PAID totals or a delivery scan.
$walletOrders = array_values(array_filter($orders, static fn($order) => strtoupper((string) ($order['status'] ?? '')) === 'PAID'));
$walletProductPayments = array_sum(array_map(static fn($order) => max(0, (int) ($order['subtotal'] ?? 0)), $walletOrders));
$walletDataAvailable = $authenticationMethod === 'password' || $sellerId !== '';
ez_page_header('Wallet', 'Your balance, withdrawal availability, and the payments behind your earnings.', [
    ['label' => 'View payments', 'href' => '?page=payments', 'style' => 'primary'],
    ['label' => 'Refresh', 'href' => '?page=wallet'],
]);
?>
<section class="wallet-overview" aria-label="Wallet overview">
  <article class="surface wallet-balance">
    <header><span class="wallet-heading-icon"><?= ez_admin_icon('wallet') ?></span><span class="wallet-environment"><?= $commerceProduction ? 'Production' : 'Sandbox' ?></span></header>
    <h2>Current wallet balance</h2>
    <strong class="wallet-amount" aria-label="Balance unavailable">—</strong>
    <p class="wallet-connection">Wallet connection pending</p>
    <p>Your balance will appear once your seller wallet is connected and its funds are confirmed.</p>
    <dl class="wallet-balances">
      <div><dt>Available to withdraw</dt><dd aria-label="Available balance unavailable">—</dd></div>
      <div><dt>Pending release</dt><dd aria-label="Pending balance unavailable">—</dd></div>
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
    <div class="wallet-withdraw-action"><button type="button" disabled aria-describedby="wallet-withdraw-reason">Withdraw funds</button><p id="wallet-withdraw-reason">Withdrawals will open after wallet setup is complete and eligible funds are available. A release date is not available yet.</p></div>
  </article>
</section>
<section class="surface wallet-payments" aria-label="Payments awaiting wallet settlement">
  <header class="surface-header"><div><h2>Payments behind your earnings</h2><p>Delivery and settlement status for your paid orders.</p></div><a class="action-button" href="?page=payments">Check all payments <?= ez_admin_icon('chevron-right') ?></a></header>
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
    <?php if (count($walletOrders) > 20): ?><p class="wallet-table-note">Showing the 20 most recent paid orders. <a href="?page=payments">View all payments</a></p><?php endif; ?>
  <?php endif; ?>
</section>
