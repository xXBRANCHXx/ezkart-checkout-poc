<?php
if (!isset($notificationConfig) || $notificationConfig['merchant']) { http_response_code(404); exit; }
$buyerNoticeLabels = ['payment_confirmed' => ['Payment confirmed', 'When a provider confirms your payment.'], 'payment_pending' => ['Payment reminders', 'When an order is still waiting for payment.'], 'payment_failed' => ['Payment unsuccessful', 'Failed, cancelled or expired checkout updates.'], 'shipping' => ['Shipping updates', 'Order acceptance, courier and delivery updates.'], 'returns' => ['Returns', 'Changes to your return requests.'], 'messages' => ['Store messages', 'When a store replies in your conversation.']];
?>
<section data-buyer-preferences aria-label="Your notification preferences" hidden>
  <h2>Your notification preferences</h2>
  <p class="notice-info">These choices apply to your buyer account across stores. They cover your orders and conversations. They do not subscribe you to promotions. Changing a choice does not remove earlier updates.</p>
  <p data-buyer-pref-delivery class="notice-info" hidden></p>
  <p data-buyer-pref-status role="status">Loading your preferences…</p><p data-buyer-pref-error class="notice-error" role="alert" hidden></p><button type="button" data-buyer-pref-load hidden>Retry loading preferences</button>
  <form data-buyer-pref-form>
    <fieldset disabled><legend class="buyer-pref-legend">Choose how to receive updates</legend>
      <?php foreach ($buyerNoticeLabels as $key => [$title, $description]): ?>
      <div class="buyer-pref-row"><div><h3><?= $noticeEscape($title) ?></h3><p><?= $noticeEscape($description) ?></p></div><div class="buyer-pref-channels"><label><input type="checkbox" name="<?= $noticeEscape($key) ?>.inApp"> <span>In-app<span class="notice-sr-only"> · <?= $noticeEscape($title) ?></span></span></label><label><input type="checkbox" name="<?= $noticeEscape($key) ?>.email"> <span>Email<span class="notice-sr-only"> · <?= $noticeEscape($title) ?></span></span></label></div></div>
      <?php endforeach; ?>
    </fieldset>
    <div class="notice-actions buyer-pref-actions"><button type="submit" data-buyer-pref-save disabled>Save preferences</button><button type="button" data-buyer-pref-retry hidden>Retry original save</button><button type="button" data-buyer-pref-compare disabled>Compare saved preferences</button><button type="button" data-buyer-pref-history disabled>Preference history</button></div>
  </form>
  <dialog data-buyer-pref-comparison aria-labelledby="buyer-pref-compare-title"><h2 id="buyer-pref-compare-title">Compare your changes</h2><p>Changes made in another tab are kept unless your draft changes that same choice. Review the result, then save it to apply it.</p><div data-buyer-pref-comparison-rows></div><div class="notice-actions"><button type="button" data-buyer-pref-apply>Use compared choices</button><button type="button" data-buyer-pref-use-saved>Use saved preferences</button><button type="button" data-buyer-pref-close>Cancel comparison</button></div></dialog>
  <dialog data-buyer-pref-history-dialog aria-labelledby="buyer-pref-history-title"><h2 id="buyer-pref-history-title">Your preference history</h2><p data-buyer-pref-history-status role="status"></p><ol data-buyer-pref-history-items></ol><div class="notice-actions"><button type="button" data-buyer-pref-history-more hidden>Load older preferences</button><button type="button" data-buyer-pref-history-retry hidden>Retry history</button><button type="button" data-buyer-pref-close>Close history</button></div></dialog>
</section>
