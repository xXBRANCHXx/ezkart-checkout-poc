<?php
if (empty($authenticated)) { http_response_code(404); return; }
ez_page_header('Welcome to Ezkart', 'Let’s get your store ready, one step at a time.');
if (($activeSeller['role'] ?? '') !== 'owner') { echo '<p>Only the current store owner can complete onboarding.</p>'; return; }
if (empty($walletAccess['unlocked'])) { require __DIR__ . '/wallet-verification.php'; return; }
?>
<div class="onboarding-workspace" data-wallet-content data-wallet-seconds="<?= max(0, (int) $walletAccess['expires_at'] - time()) ?>" data-onboarding data-account="<?= ez_admin_escape((string) ($adminUser['id'] ?? '')) ?>" data-store="<?= ez_admin_escape($sellerId) ?>">
 <nav class="onboarding-steps" aria-label="Seller setup">
 <?php foreach ([['profile','users','About you'],['addresses','map-pin','Your addresses'],['bank','wallet','Your bank']] as $step): ?>
 <button type="button" data-onboarding-step="<?= $step[0] ?>" disabled><?= ez_admin_icon($step[1]) ?><span><?= $step[2] ?></span><small data-step-status="<?= $step[0] ?>"></small></button>
 <?php endforeach; ?>
 </nav>
 <div class="onboarding-status-row"><p data-onboarding-status role="status" aria-live="polite">Loading your saved details…</p><button class="ui-button" type="button" data-onboarding-refresh><?= ez_admin_icon('redo') ?><span>Refresh</span></button></div>
 <section class="surface" data-onboarding-panel="profile"><span class="onboarding-step-label">Step 1 of 3</span><h2>First, a little about you</h2><p>Use your legal name and a phone number where we can reach you.</p>
 <form data-onboarding-profile>
 <label>Full legal name <input name="legalName" autocomplete="name" maxlength="128" required></label>
 <label for="seller-birth-date">Date of birth</label><div class="birth-date-field"><input id="seller-birth-date" data-birth-date name="birthDate" type="text" placeholder="YYYY-MM-DD" pattern="[0-9]{4}-[0-9]{2}-[0-9]{2}" autocomplete="bday" required aria-describedby="onboarding-age-help"><button type="button" aria-label="Choose date of birth" aria-haspopup="dialog" aria-expanded="false"><?= ez_admin_icon('calendar') ?></button></div>
 <label class="onboarding-confirm"><input name="ageConfirmed" type="checkbox" required><span>I confirm I am 18 or older.<small>Required to sell on Ezkart.</small></span></label>
 <p class="onboarding-hint" id="onboarding-age-help">We store your declared date of birth and calculated age.</p>
 <label>Verified sign-in email <input name="email" type="email" autocomplete="email" readonly></label>
 <label>Phone number <input name="phone" type="tel" autocomplete="tel" pattern="\+?[0-9]{8,15}" required></label>
 <button class="ui-button primary" type="submit"><?= ez_admin_icon('chevron-right') ?><span>Save and continue</span></button>
 </form></section>
 <section class="surface" data-onboarding-panel="addresses" hidden><span class="onboarding-step-label">Step 2 of 3</span><h2>Where will orders travel from?</h2><p>Add pickup and return addresses, then confirm their map pins. You can use the same address for both.</p><a class="ui-button" href="?page=shipping-settings&amp;setup=1"><?= ez_admin_icon('map-pin') ?><span>Edit addresses and map pins</span></a><div data-onboarding-addresses></div><button class="ui-button primary" type="button" data-onboarding-confirm-pins><?= ez_admin_icon('check-circle') ?><span>Confirm and continue</span></button></section>
 <section class="surface" data-onboarding-panel="bank" hidden><span class="onboarding-step-label">Step 3 of 3</span><h2>Where should we send your earnings?</h2><p data-onboarding-bank-summary>No bank saved.</p><p>Save your withdrawal destination. With two-step enabled, you can add this before your first withdrawal.</p>
 <form data-onboarding-bank autocomplete="off"><label>Bank <select name="code" required></select></label><label>Account number <input name="accountNumber" inputmode="numeric" pattern="[0-9]{1,22}" maxlength="22" required></label><label>Transfer method <select name="channel" required></select></label><button class="ui-button primary" type="submit"><?= ez_admin_icon('check-circle') ?><span>Save bank destination</span></button></form>
 <p class="onboarding-hint">Changes apply to new withdrawals. Existing requests keep their original destination.</p><a class="ui-button primary" href="?page=dashboard" data-onboarding-finish hidden><?= ez_admin_icon('chevron-right') ?><span>Go to my store</span></a></section>
 <details class="onboarding-details"><summary>Your saved declaration and Wallet</summary><p data-onboarding-age></p><p data-onboarding-wallet></p><a class="ui-button" href="?page=wallet"><?= ez_admin_icon('wallet') ?><span>Open Wallet</span></a></details>
</div>

<link rel="stylesheet" href="birth-date.css?v=<?= (int) filemtime(__DIR__ . '/birth-date.css') ?>">
<script src="birth-date.js?v=<?= (int) filemtime(__DIR__ . '/birth-date.js') ?>" defer></script>
