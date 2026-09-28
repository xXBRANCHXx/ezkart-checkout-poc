<?php
if (empty($authenticated)) { http_response_code(404); return; }
ez_page_header('Seller onboarding', 'Save your seller details before starting money actions. You can keep exploring your dashboard.');
if (($activeSeller['role'] ?? '') !== 'owner') { echo '<p>Only the current store owner can complete onboarding.</p>'; return; }
if (empty($walletAccess['unlocked'])) { echo '<p>Use Wallet verification to protect your personal and bank details. After unlocking, return to Seller onboarding.</p>'; require __DIR__ . '/wallet-verification.php'; return; }
?>
<div class="onboarding-workspace" data-wallet-content data-wallet-seconds="<?= max(0, (int) $walletAccess['expires_at'] - time()) ?>" data-onboarding data-account="<?= ez_admin_escape((string) ($adminUser['id'] ?? '')) ?>" data-store="<?= ez_admin_escape($sellerId) ?>">
 <p data-onboarding-status role="status" aria-live="polite">Loading your saved details…</p>
 <button class="ui-button" type="button" data-onboarding-refresh>Refresh saved details</button>
 <section class="surface"><h2>Your legal details</h2><p>These are your seller-declared details. Please keep them accurate and up to date.</p>
 <form data-onboarding-profile><label>Full legal name <input name="legalName" autocomplete="name" maxlength="128" required></label><label>Date of birth <input name="birthDate" type="date" autocomplete="bday" required></label><p>Sellers must be 18 or older under Ezkart’s seller policy. We store your declared date of birth and the age calculated from it.</p><label>Verified sign-in email <input name="email" type="email" readonly></label><label>Phone number <input name="phone" type="tel" autocomplete="tel" pattern="\+?[0-9]{8,15}" required></label><button class="ui-button" type="submit">Save legal details</button></form></section>
 <section class="surface"><h2>Your withdrawal bank</h2><p data-onboarding-bank-summary>No bank saved.</p><p>New withdrawals use this saved destination. Changes do not redirect an existing request. DOKU must still verify the beneficiary before a transfer.</p>
 <form data-onboarding-bank autocomplete="off"><label>Bank <select name="code" required></select></label><label>Account number <input name="accountNumber" inputmode="numeric" pattern="[0-9]{1,22}" maxlength="22" required></label><label>Transfer method <select name="channel" required></select></label><button class="ui-button" type="submit">Save bank destination</button></form></section>
 <section class="surface"><h2>Pickup and return locations</h2><p>Both addresses need a map pin. You may use the same address for pickup and returns.</p><a href="?page=shipping-settings">Edit addresses and map pins</a><div data-onboarding-addresses></div><button class="ui-button" type="button" data-onboarding-confirm-pins>I confirm these addresses and map pins</button></section>
 <section class="surface"><h2>Your age declaration and Wallet</h2><p data-onboarding-age>No age declaration saved.</p><p>Your birth date and calculated age are seller-declared information. This form does not assess identity documents.</p><p data-onboarding-wallet></p><a href="?page=wallet">Open Wallet setup and existing requests</a></section>
</div>
