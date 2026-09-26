<?php
if (!isset($notificationConfig)) { http_response_code(404); exit; }
$noticeEscape = static fn($value): string => htmlspecialchars((string) $value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
?>
<link rel="stylesheet" href="/cart/notifications.css?v=<?= (int) filemtime(__DIR__ . '/notifications.css') ?>">
<section class="ez-notifications" data-notification-workspace data-config="<?= $noticeEscape(json_encode($notificationConfig, JSON_THROW_ON_ERROR)) ?>" aria-label="Notifications">
  <header class="notice-header"><div><h1>Notifications</h1><p><?= $notificationConfig['merchant'] ? 'Keep up with payments, deliveries, returns, and conversations.' : 'Updates from your stores, from payment to delivery.' ?></p></div><div class="notice-actions"><button type="button" data-notice-refresh>Refresh</button><?php if ($notificationConfig['merchant']): ?><a href="?page=settings#notifications">Preferences</a><?php else: ?><a href="/cart/messages.php">Messages</a><?php endif; ?></div></header>
  <div class="notice-summary"><strong data-notice-count>Loading updates…</strong><span data-notice-total></span></div>
  <p class="notice-info" data-notice-held hidden></p><p class="notice-error" data-notice-error role="alert" hidden></p><a href="" data-notice-signin hidden>Reload sign-in</a>
  <p data-notice-live role="status" class="notice-live"></p>
  <div data-notice-private>
    <?php if ($notificationConfig['merchant']): ?><nav class="notice-views" aria-label="Notification views"><button type="button" data-notice-view="inbox" aria-pressed="true">Your inbox</button><button type="button" data-notice-view="processing" aria-pressed="false">Store delivery activity</button></nav><?php endif; ?>
    <section data-notice-inbox aria-label="Your notification inbox">
      <form class="notice-filters" data-notice-filters><label>Search updates<input type="search" name="q" maxlength="120" placeholder="Search notification text"></label><label>Category<select name="category"><option value="">All categories</option><option value="payment_confirmed">Payment confirmed</option><option value="payment_pending">Payment pending</option><option value="payment_failed">Payment unsuccessful</option><option value="payment_review">Payment review</option><option value="shipping">Shipping</option><option value="returns">Returns</option><option value="messages">Messages</option><option value="weekly_activity">Weekly activity</option></select></label><label>Read status<select name="state"><option value="all">All updates</option><option value="unread">Unread</option><option value="read">Read</option></select></label><button type="submit">Apply filters</button></form>
      <div class="notice-list-heading"><p data-notice-result role="status">Loading your notifications…</p><button type="button" data-notice-mark disabled>Mark shown as read</button></div>
      <p class="notice-error" data-notice-read-error role="alert" hidden></p><button type="button" data-notice-read-retry hidden>Retry read confirmation</button>
      <ol class="notice-list" data-notice-list></ol><button type="button" data-notice-more hidden>Load older notifications</button>
    </section>
    <?php if ($notificationConfig['merchant']): ?><section data-notice-processing aria-label="Store notification delivery activity" hidden>
      <p class="notice-info">Delivery activity covers this store's updates. In-app counts confirm that an update reached an inbox; they do not confirm it was read. Email requests are recorded, but no email service is connected yet.</p>
      <form class="notice-filters notice-processing-filter" data-notice-process-filters><label>Delivery state<select name="state"><option value="attention">Needs attention</option><option value="queued">Queued</option><option value="succeeded">Processed</option><option value="all">All updates</option></select></label><button type="submit">Apply delivery filter</button></form>
      <p data-notice-process-result role="status"></p><ol class="notice-list" data-notice-process-list></ol><button type="button" data-notice-process-more hidden>Load older delivery activity</button>
    </section><?php endif; ?>
  </div>
</section>
<script src="/cart/notifications.js?v=<?= (int) filemtime(__DIR__ . '/notifications.js') ?>" defer></script>
