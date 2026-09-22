<?php if (empty($authenticated) || !isset($walletAccess)) { http_response_code(404); return; } ?>
<section class="surface wallet-verification" aria-labelledby="wallet-verification-title">
  <span class="wallet-verification-icon"><?= ez_admin_icon('shield') ?></span>
  <h2 id="wallet-verification-title">Verify to open Wallet</h2>
  <?php if ($walletAccess['method'] === 'totp'): ?>
    <p>Enter the current six-digit code from your authenticator app.</p>
  <?php elseif ($walletAccess['method'] === 'email'): ?>
    <p><?= $walletAccess['email_sent'] ? 'Enter the code sent to' : 'We’ll send a verification code to' ?> <b><?= ez_admin_escape($walletAccess['email']) ?></b>.</p>
  <?php endif; ?>
  <?php if ($walletAccess['error'] !== ''): ?><p class="wallet-verification-error" role="alert"><?= ez_admin_escape($walletAccess['error']) ?></p><?php endif; ?>
  <?php if ($walletAccess['notice'] !== ''): ?><p class="wallet-verification-notice" role="status"><?= ez_admin_escape($walletAccess['notice']) ?></p><?php endif; ?>
  <?php if ($walletAccess['method'] === 'totp' || $walletAccess['email_sent']): ?>
    <form method="post" action="?page=wallet" class="wallet-code-form">
      <input type="hidden" name="csrf_token" value="<?= ez_admin_escape($csrfToken) ?>"><input type="hidden" name="action" value="wallet_verify">
      <label for="wallet-code"><?= $walletAccess['method'] === 'totp' ? 'Authenticator code' : 'Email code' ?></label>
      <input id="wallet-code" name="code" type="text" inputmode="numeric" pattern="<?= $walletAccess['method'] === 'totp' ? '[0-9]{6}' : '[0-9]{6,10}' ?>" minlength="6" maxlength="<?= $walletAccess['method'] === 'totp' ? '6' : '10' ?>" autocomplete="one-time-code" required autofocus>
      <button type="submit" class="wallet-verify-button">Verify and open Wallet</button>
    </form>
  <?php endif; ?>
  <?php if ($walletAccess['method'] === 'email'): ?>
    <form method="post" action="?page=wallet" class="wallet-send-form">
      <input type="hidden" name="csrf_token" value="<?= ez_admin_escape($csrfToken) ?>"><input type="hidden" name="action" value="wallet_email_send">
      <button type="submit" class="<?= $walletAccess['email_sent'] ? 'wallet-resend-button' : 'wallet-verify-button' ?>"><?= $walletAccess['email_sent'] ? 'Resend email code' : 'Send email code' ?></button>
    </form>
  <?php endif; ?>
  <p class="wallet-verification-footnote">Wallet stays unlocked for 10 minutes in this browser.</p>
  <a href="?page=dashboard">Back to Dashboard</a>
</section>
