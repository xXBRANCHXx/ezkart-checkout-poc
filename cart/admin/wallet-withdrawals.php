<?php
declare(strict_types=1);
if (realpath((string) ($_SERVER['SCRIPT_FILENAME'] ?? '')) === __FILE__) { http_response_code(404); exit; }
if (empty($walletAccess['unlocked']) || empty($walletOwner) || empty($centralWalletWorkspace)) return;
?>
<section class="surface wallet-withdrawals" data-withdrawals aria-labelledby="withdrawal-history-title" aria-busy="true">
  <header class="surface-header"><div><h2 id="withdrawal-history-title">Withdrawal requests</h2><p>Bank checks, confirmations and cancellations for your saved requests.</p></div><button class="action-button" type="button" data-withdrawal-refresh disabled>Refresh requests</button></header>
  <div class="wallet-withdrawal-recovery" data-withdrawal-recovery hidden><p>An earlier withdrawal request needs a status check before you start another.</p><button class="action-button" type="button" data-withdrawal-recover>Check previous request</button></div>
  <p class="wallet-empty" data-withdrawal-history-status role="status" aria-live="polite">Checking withdrawal requests…</p>
  <div class="wallet-table-wrap" data-withdrawal-history-table hidden><table><thead><tr><th scope="col">Request / created</th><th scope="col">Bank account</th><th scope="col">Amount</th><th scope="col">Status</th><th scope="col"><span class="wallet-sr-only">Details</span></th></tr></thead><tbody data-withdrawal-history></tbody></table></div>
  <div class="wallet-table-note"><button class="action-button" type="button" data-withdrawal-more hidden>Load earlier requests</button></div>
  <noscript><p class="wallet-table-note">Enable JavaScript to view or manage withdrawal requests.</p></noscript>
  <dialog class="wallet-withdraw-dialog" data-withdrawal-dialog aria-labelledby="withdrawal-dialog-title">
    <header><h2 id="withdrawal-dialog-title" data-withdrawal-title>Withdraw funds</h2><button class="action-button" type="button" data-withdrawal-close aria-label="Close withdrawal details">×</button></header>
    <p class="wallet-withdraw-message" data-withdrawal-message role="status" aria-live="polite"></p>
    <p class="wallet-withdraw-error" data-withdrawal-error role="alert" hidden></p>
    <form data-withdrawal-form autocomplete="off">
      <p class="wallet-withdraw-available">Available earnings <strong data-withdrawal-available>—</strong></p>
      <label for="withdrawal-amount">Withdrawal amount (IDR)</label><input id="withdrawal-amount" name="amount" type="text" inputmode="numeric" pattern="[1-9][0-9]{5,15}" maxlength="16" placeholder="250000" aria-describedby="withdrawal-amount-help" required>
      <small id="withdrawal-amount-help">Minimum Rp250.000. Enter whole rupiah without dots or commas.</small>
      <p data-withdrawal-saved-bank>Your saved onboarding bank will be used.</p>
      <a href="?page=onboarding">Review or change saved bank</a>
      <p class="wallet-withdraw-fee">Your withdrawal fee: <strong>Rp0</strong>. Ezkart covers the transfer fee.</p>
      <p>Saving reserves this amount from your available earnings. You will check the bank-returned name before confirming the destination.</p>
      <button class="action-button primary" type="submit" data-withdrawal-save>Save withdrawal request</button>
    </form>
    <section data-withdrawal-detail hidden aria-label="Saved withdrawal details">
      <dl class="wallet-withdraw-details">
        <div><dt>Amount to your bank</dt><dd data-withdrawal-amount></dd></div>
        <div><dt>Your withdrawal fee</dt><dd>Rp0 · paid by Ezkart</dd></div>
        <div><dt>Bank</dt><dd data-withdrawal-bank></dd></div>
        <div><dt>Account number</dt><dd data-withdrawal-account></dd></div>
        <div><dt>Account-holder name</dt><dd data-withdrawal-beneficiary></dd></div>
        <div><dt>Transfer method</dt><dd data-withdrawal-channel></dd></div>
        <div><dt>Status</dt><dd data-withdrawal-status></dd></div>
        <div><dt>Created</dt><dd data-withdrawal-created></dd></div>
        <div class="wallet-withdraw-reference"><dt>Reference</dt><dd data-withdrawal-reference></dd></div>
      </dl>
      <p class="wallet-withdraw-warning" data-withdrawal-warning role="status" hidden></p>
      <p data-withdrawal-status-note role="status" hidden></p>
      <div class="wallet-withdraw-actions"><button class="action-button" type="button" data-withdrawal-check>Verify bank account</button><button class="action-button" type="button" data-withdrawal-status-check hidden>Check transfer status</button><button class="action-button" type="button" data-withdrawal-detail-refresh>Refresh request</button></div>
      <form class="wallet-withdraw-confirm" data-withdrawal-confirm-form hidden>
        <label><input type="checkbox" name="confirmed" required> I have checked the amount, bank, account number and account-holder name.</label>
        <button class="action-button primary" type="submit" data-withdrawal-confirm>Confirm bank details</button>
      </form>
      <p class="wallet-withdraw-confirmed" data-withdrawal-confirmed hidden></p>
      <form class="wallet-withdraw-confirm" data-withdrawal-pay-form hidden>
        <label><input type="checkbox" name="confirmed" required> Send the amount above to this confirmed bank account. This transfer cannot be cancelled after sending.</label>
        <button class="action-button primary" type="submit" data-withdrawal-pay>Send bank transfer</button>
      </form>
      <div class="wallet-withdraw-cancel"><button class="action-button" type="button" data-withdrawal-cancel>Cancel request</button>
        <div data-withdrawal-cancel-review hidden><p>Cancel this withdrawal request? Other holds on your earnings will remain.</p><div class="wallet-withdraw-actions"><button class="action-button" type="button" data-withdrawal-keep>Keep request</button><button class="action-button" type="button" data-withdrawal-cancel-confirm>Confirm cancellation</button></div></div>
      </div>
    </section>
  </dialog>
</section>
