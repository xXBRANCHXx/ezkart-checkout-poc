<?php
if (!isset($authenticated) || !$authenticated) { http_response_code(404); exit; }
$notificationRows = [
    'payment_confirmed' => ['Payment confirmed', 'A provider-confirmed payment is recorded.'],
    'payment_pending' => ['Payment pending', 'An unpaid checkout needs attention after 30 minutes.'],
    'payment_failed' => ['Payment failed or expired', 'A payment fails or its payment window closes.'],
    'payment_review' => ['Payment and stock review', 'A payment or stock exception needs your review.'],
    'shipping' => ['Shipping updates', 'Pickup, delivery and shipping exceptions.'],
    'returns' => ['Returns and refunds', 'Return and refund requests, decisions and return inspection updates.'],
    'messages' => ['Buyer messages', 'A buyer sends your store a new message.'],
    'weekly_activity' => ['Weekly catalog activity', 'A weekly summary of products without paid orders.'],
];
?>
<p class="merchant-settings-notice" data-settings-status role="status">Loading saved settings…</p>
<button class="ui-button" type="button" data-settings-load hidden data-ui-icon="refresh">Try loading settings again</button>
<section class="surface settings-section" id="store-profile">
  <header class="surface-header"><div><h2>Store profile</h2><p>Your store identity and customer support details.</p></div></header>
  <?php require __DIR__ . '/profile-logo.php'; ?>
  <form data-settings-form="profile">
    <fieldset class="settings-form" disabled>
      <label class="wide"><span>Store name</span><input name="name" maxlength="120" required autocomplete="organization"><small>A separate shop display name can be set in <a href="?page=shop">Shop appearance</a>.</small></label>
      <label><span>Business type</span><select name="businessType"><option value="online_merchant">Online merchant</option><option value="retailer">Retailer</option><option value="manufacturer">Manufacturer</option><option value="service_provider">Service provider</option></select></label>
      <label><span>Plan</span><input data-settings-plan readonly value="Loading…"></label>
      <label><span>Support email</span><input name="supportEmail" type="email" maxlength="160" autocomplete="email"><small>Shown publicly on your shop and checkout.</small></label>
      <label><span>Support phone</span><input name="supportPhone" type="tel" maxlength="32" autocomplete="tel" placeholder="+62…"><small>Use an international number. Indonesian 08 numbers are accepted.</small></label>
      <label class="wide"><span>Store description</span><textarea name="description" maxlength="1000" rows="4"></textarea><small>Shown on your shop. Up to 1,000 characters.</small></label>
      <div class="wide settings-region-heading"><h3>Dates and region</h3><p>Order, payment and message times use these settings. Report periods and chart totals keep Jakarta calendar days.</p></div>
      <label><span>Display timezone</span><select name="timezone"><option value="Asia/Jakarta">Asia/Jakarta (WIB)</option><option value="Asia/Makassar">Asia/Makassar (WITA)</option><option value="Asia/Jayapura">Asia/Jayapura (WIT)</option></select></label>
      <label><span>Date format</span><select name="dateFormat"><option value="long">11 Aug 2026</option><option value="numeric">11/08/2026</option><option value="iso">2026-08-11</option></select></label>
      <label><span>Currency</span><input readonly value="IDR — Indonesian Rupiah"></label>
      <label><span>Country</span><input readonly value="Indonesia"></label>
    </fieldset>
    <p class="settings-form-status" data-settings-form-status role="status"></p>
    <p class="settings-form-error" data-settings-form-error role="alert" hidden></p>
    <div class="settings-form-actions"><button class="ui-button primary" type="submit" data-settings-save disabled data-ui-icon="save">Save store details</button><button class="ui-button" type="button" data-settings-retry hidden data-ui-icon="refresh">Retry original save</button><button class="ui-button" type="button" data-settings-refresh disabled data-ui-icon="eye">Review saved details</button><button class="ui-button" type="button" data-settings-history disabled data-ui-icon="eye">View store history</button></div>
  </form>
</section>
<section class="surface settings-section" id="notifications">
  <header class="surface-header"><div><h2>Notifications</h2><p>These choices apply to you in this store. Other staff keep their own preferences.</p></div></header>
  <p class="merchant-settings-notice" data-settings-delivery></p>
  <form data-settings-form="notifications">
    <fieldset class="settings-notifications" disabled><legend class="settings-sr-only">Notification channels</legend>
      <div class="settings-notification-head" aria-hidden="true"><span>Updates</span><span>In-app</span><span>Email</span></div>
      <?php foreach ($notificationRows as $key => [$title, $description]): ?>
      <div class="settings-notification-row"><div><b><?= ez_admin_escape($title) ?></b><p><?= ez_admin_escape($description) ?></p></div><label><span class="settings-sr-only"><?= ez_admin_escape($title) ?>: in-app</span><input type="checkbox" name="<?= ez_admin_escape($key) ?>.inApp"></label><label><span class="settings-sr-only"><?= ez_admin_escape($title) ?>: email</span><input type="checkbox" name="<?= ez_admin_escape($key) ?>.email"></label></div>
      <?php endforeach; ?>
    </fieldset>
    <p class="settings-form-status" data-settings-form-status role="status"></p>
    <p class="settings-form-error" data-settings-form-error role="alert" hidden></p>
    <div class="settings-form-actions"><button class="ui-button primary" type="submit" data-settings-save disabled data-ui-icon="save">Save notification preferences</button><button class="ui-button" type="button" data-settings-retry hidden data-ui-icon="refresh">Retry original save</button><button class="ui-button" type="button" data-settings-refresh disabled data-ui-icon="eye">Review saved preferences</button><button class="ui-button" type="button" data-settings-history disabled data-ui-icon="eye">View my preference history</button></div>
  </form>
</section>
<dialog class="settings-dialog" data-settings-compare aria-labelledby="settings-compare-title"><h2 id="settings-compare-title">Compare your changes</h2><p data-settings-compare-description></p><div data-settings-comparison></div><div class="settings-form-actions"><button class="ui-button primary" type="button" data-settings-apply data-ui-icon="check">Use compared changes</button><button class="ui-button" type="button" data-settings-use-saved data-ui-icon="check">Use saved version</button><button class="ui-button" type="button" data-settings-close data-ui-icon="pencil">Keep editing</button></div></dialog>
<dialog class="settings-dialog" data-settings-history-dialog aria-labelledby="settings-history-title"><h2 id="settings-history-title">Settings history</h2><p data-settings-history-status role="status"></p><ol data-settings-history-items></ol><div class="settings-form-actions"><button class="ui-button" type="button" data-settings-history-more hidden data-ui-icon="arrow-right">Load older changes</button><button class="ui-button" type="button" data-settings-history-retry hidden data-ui-icon="refresh">Try history again</button><button class="ui-button" type="button" data-settings-close data-ui-icon="x">Close history</button></div></dialog>
