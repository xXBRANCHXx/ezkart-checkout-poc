<?php
if (!isset($messageConfig)) { http_response_code(404); exit; }
$messageEscape = static fn($v): string => htmlspecialchars((string) $v, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
?>
<link rel="stylesheet" href="/cart/messages.css?v=<?= (int) filemtime(__DIR__ . '/messages.css') ?>">
<section class="ez-messages" data-message-workspace data-config="<?= $messageEscape(json_encode($messageConfig, JSON_THROW_ON_ERROR)) ?>" aria-label="Messages">
  <header class="msg-page-header"><div><h1>Messages</h1><p><?= $messageConfig['merchant'] ? 'Help your customers, from their first question to delivery.' : 'Your conversations with stores, all in one place.' ?></p></div><div class="msg-actions"><button type="button" data-msg-refresh>Refresh inbox</button><?php if ($messageConfig['merchant']): ?><button type="button" data-msg-replies>Saved replies</button><button type="button" class="msg-primary" data-msg-new>New conversation</button><?php endif; ?></div></header>
  <p data-msg-notice class="msg-notice" role="status" hidden></p><p data-msg-error class="msg-error" role="alert" hidden></p>
  <a href="" data-msg-signin hidden>Reload sign-in</a>
  <?php if ($messageConfig['merchant']): ?><div class="msg-stats" data-msg-stats aria-label="Conversation statistics"></div><?php endif; ?>
  <div class="msg-workspace">
    <aside class="msg-directory" aria-label="Conversation list">
      <form data-msg-filters class="msg-filters"><label>Search conversations<input type="search" name="q" maxlength="120" placeholder="Name, message or order"></label><div class="msg-filter-row"><label>State<select name="state"><option value="all">All conversations</option><option value="open">Open</option><option value="needs-response">Needs response</option><option value="resolved">Resolved</option><option value="blocked">Blocked</option></select></label><label>Read status<select name="unread"><option value="all">All messages</option><option value="1">Unread</option></select></label></div><button type="submit">Apply filters</button></form>
      <p class="msg-list-status" data-msg-list-status role="status">Loading conversations…</p><div data-msg-list></div><button type="button" data-msg-more hidden>Load more conversations</button>
    </aside>
    <section class="msg-detail" aria-label="Conversation" data-msg-detail><div class="msg-empty"><span aria-hidden="true">✉</span><h2>A little conversation goes a long way</h2><p>Choose a conversation to read and reply.</p></div></section>
  </div>
  <dialog data-msg-new-dialog aria-labelledby="msg-new-title"><form data-msg-new-form><h2 id="msg-new-title">Start a conversation</h2><p>Enter an order from your store. The buyer must have signed in and claimed that order.</p><label>Order reference<input name="order" required maxlength="30" pattern="EZK-[SP]-[A-F0-9]{24}" placeholder="EZK-S-…"></label><p class="msg-error" role="alert" data-msg-new-error></p><div class="msg-actions"><button type="button" data-msg-close>Cancel</button><button type="submit" class="msg-primary">Open conversation</button></div></form></dialog>
  <dialog data-msg-reply-dialog aria-labelledby="msg-reply-title"><h2 id="msg-reply-title">Saved replies</h2><p>Insert a reply into your draft, then review it before sending.</p><div data-msg-reply-list></div><form data-msg-reply-form><input type="hidden" name="id"><input type="hidden" name="revision" value="0"><label>Reply title<input name="title" maxlength="80" required></label><label>Reply text<textarea name="body" maxlength="4000" rows="4" required></textarea></label><p data-msg-reply-error class="msg-error" role="alert"></p><div class="msg-actions"><button type="button" data-msg-reply-reset>New saved reply</button><button type="submit" class="msg-primary">Save reply</button><button type="button" data-msg-reply-retry hidden>Retry confirmation</button></div></form><button type="button" data-msg-close>Close saved replies</button></dialog>
  <dialog data-msg-photo-dialog aria-label="Message photo"><button type="button" data-msg-close>Close photo</button><img alt="Photo attached to this conversation"></dialog>
</section>
<script src="/cart/messages.js?v=<?= (int) filemtime(__DIR__ . '/messages.js') ?>" defer></script>
