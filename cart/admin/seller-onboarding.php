<?php
if (empty($authenticated)) { http_response_code(404); return; }
ez_page_header('Welcome to Ezkart', 'Let’s get your store ready, one step at a time.');
if (($activeSeller['role'] ?? '') !== 'owner') { echo '<p>Only the current store owner can complete onboarding.</p>'; return; }
?>
<div class="onboarding-workspace" data-onboarding aria-busy="true" data-account="<?= ez_admin_escape((string) ($adminUser['id'] ?? '')) ?>" data-store="<?= ez_admin_escape($sellerId) ?>">
 <nav class="onboarding-steps" aria-label="Seller setup">
 <?php foreach ([['profile','users','About you'],['addresses','map-pin','Your addresses'],['bank','wallet','Your bank']] as $step): ?>
 <button type="button" data-onboarding-step="<?= $step[0] ?>" disabled><?= ez_admin_icon($step[1]) ?><span><?= $step[2] ?></span><small data-step-status="<?= $step[0] ?>"></small></button>
 <?php endforeach; ?>
 </nav>
 <div class="onboarding-status-row"><p data-onboarding-status role="status" aria-live="polite">Loading your saved details…</p><button class="ui-button" type="button" data-onboarding-refresh><?= ez_admin_icon('redo') ?><span>Refresh</span></button></div>
 <section class="surface" data-onboarding-panel="profile" hidden><span class="onboarding-step-label">Step 1 of 3</span><h2>First, a little about you</h2><p>Use your legal name and a phone number where we can reach you.</p>
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
 <section class="surface" data-onboarding-panel="bank" hidden><span class="onboarding-step-label">Step 3 of 3</span><h2>Where should we send your earnings?</h2><p data-onboarding-bank-summary>Bank details stay protected until you verify.</p><p>Save your withdrawal destination. With two-step enabled, you can add this before your first withdrawal.</p>
 <?php if (empty($walletAccess['unlocked'])): ?>
 <?php require __DIR__ . '/wallet-verification.php'; ?>
 <?php else: ?>
 <div data-wallet-content data-wallet-seconds="<?= max(0, (int) $walletAccess['expires_at'] - time()) ?>">
 <form data-onboarding-bank autocomplete="off"><label>Bank <select name="code" required></select></label><label>Account number <input name="accountNumber" inputmode="numeric" pattern="[0-9]{1,22}" maxlength="22" required></label><label>Transfer method <select name="channel" required></select></label><label data-bank-change-reason hidden>Why are you changing your bank? <textarea name="reason" minlength="20" maxlength="500"></textarea></label><p data-bank-change-status role="status"></p><button class="ui-button primary" type="submit"><?= ez_admin_icon('check-circle') ?><span data-bank-submit-label>Save bank destination</span></button></form>
 </div><p data-onboarding-bank-locked hidden>Bank verification expired. <a class="ui-button" href="?page=onboarding&amp;step=bank"><?= ez_admin_icon('shield') ?><span>Verify bank details</span></a></p>
 <?php endif; ?>
 <p class="onboarding-hint">Once saved, changing your bank requires a reason and human review by Ezkart. We will verify the request and bank ownership before approval. Your current bank stays active during review. Existing withdrawals keep their original destination.</p><button class="ui-button" type="button" data-onboarding-finish hidden><?= ez_admin_icon('check-circle') ?><span>Finish setup</span></button></section>
 <section class="surface onboarding-complete" data-onboarding-panel="complete" hidden aria-labelledby="onboarding-complete-title">
 <span class="onboarding-complete-icon"><?= ez_admin_icon('check-circle') ?></span>
 <h2 id="onboarding-complete-title" tabindex="-1" data-onboarding-complete-title>You're all set!</h2>
 <p data-onboarding-complete-copy>Your seller details are saved. Head to your store to take the next step.</p>
 <ul class="onboarding-complete-list"><li><?= ez_admin_icon('check-circle') ?><span>Personal details saved</span></li><li><?= ez_admin_icon('check-circle') ?><span>Pickup and return addresses confirmed</span></li><li><?= ez_admin_icon('wallet') ?><span data-onboarding-complete-bank>Withdrawal bank saved</span></li></ul>
 <div class="onboarding-complete-actions"><a class="ui-button primary" href="?page=dashboard"><?= ez_admin_icon('store') ?><span>Go to my store</span></a><button class="ui-button" type="button" data-onboarding-review><?= ez_admin_icon('pencil') ?><span>Review my details</span></button></div>
 </section>
 <details class="onboarding-details"><summary>Your saved declaration and Wallet</summary><p data-onboarding-age></p><p data-onboarding-wallet></p><a class="ui-button" href="?page=wallet"><?= ez_admin_icon('wallet') ?><span>Open Wallet</span></a></details>
</div>

<link rel="stylesheet" href="birth-date.css?v=<?= (int) filemtime(__DIR__ . '/birth-date.css') ?>">
<script src="birth-date.js?v=<?= (int) filemtime(__DIR__ . '/birth-date.js') ?>" defer></script>
