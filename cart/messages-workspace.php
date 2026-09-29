<?php
if (!isset($messageConfig)) { http_response_code(404); exit; }
$messageEscape = static fn($v): string => htmlspecialchars((string) $v, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
?>
<link rel="stylesheet" href="/cart/messages.css?v=<?= (int) filemtime(__DIR__ . '/messages.css') ?>">
<section class="ez-messages" data-message-workspace data-config="<?= $messageEscape(json_encode($messageConfig, JSON_THROW_ON_ERROR)) ?>" aria-label="Messages">
  <svg width="0" height="0" aria-hidden="true" style="position:absolute"><defs>
  <symbol id="msg-icon-inbox" viewBox="0 0 24 24"><path d="m4 4-2 12v4h20v-4L20 4ZM2 16h6l2 3h4l2-3h6"/></symbol>
  <symbol id="msg-icon-reply" viewBox="0 0 24 24"><path d="m9 4-6 6 6 6M3 10h10a7 7 0 0 1 7 7v3"/></symbol>
  <symbol id="msg-icon-mail" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7"/></symbol>
  <symbol id="msg-icon-messages" viewBox="0 0 24 24"><path d="M4 3h16v14H8l-4 4Z"/><path d="M8 7h8M8 11h6"/></symbol>
  <symbol id="msg-icon-check" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="m7 12 3 3 7-7"/></symbol>
  <symbol id="msg-icon-block" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="m6 6 12 12"/></symbol>
  <symbol id="msg-icon-search" viewBox="0 0 24 24"><circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/></symbol>
  <symbol id="msg-icon-refresh" viewBox="0 0 24 24"><path d="M20 8a9 9 0 1 0 0 8M20 3v6h-6"/></symbol>
  <symbol id="msg-icon-plus" viewBox="0 0 24 24"><path d="M12 4v16M4 12h16"/></symbol>
  <symbol id="msg-icon-photo" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="2"/><path d="m3 18 6-6 4 4 3-6 5 8"/></symbol>
  <symbol id="msg-icon-send" viewBox="0 0 24 24"><path d="m3 3 19 9-19 9 4-9ZM7 12h15"/></symbol>
  <symbol id="msg-icon-trash" viewBox="0 0 24 24"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></symbol>
  </defs></svg>
  <header class="msg-page-header"><div><h1>Messages</h1><p><?= $messageConfig['merchant'] ? 'Help your customers, from their first question to delivery.' : 'Your conversations with stores, all in one place.' ?></p></div><div class="msg-actions"><button type="button" data-msg-refresh><svg class="msg-icon" aria-hidden="true"><use href="#msg-icon-refresh"/></svg>Refresh inbox</button><?php if ($messageConfig['merchant']): ?><button type="button" data-msg-replies><svg class="msg-icon" aria-hidden="true"><use href="#msg-icon-messages"/></svg>Saved replies</button><button type="button" class="msg-primary" data-msg-new><svg class="msg-icon" aria-hidden="true"><use href="#msg-icon-plus"/></svg>New conversation</button><?php endif; ?></div></header>
  <p data-msg-notice class="msg-notice" role="status" hidden></p><p data-msg-error class="msg-error" role="alert" hidden></p>
  <a href="" data-msg-signin hidden>Reload sign-in</a>
  <div class="msg-workspace <?= $messageConfig['merchant'] ? 'msg-merchant-workspace' : '' ?>">
    <?php if ($messageConfig['merchant']): ?>
    <aside class="msg-folders" aria-label="Message folders"><h2>Your inbox</h2><nav aria-label="Conversations">
    <?php foreach ([['open','Inbox','inbox','open'],['needs-response','Needs response','reply','needsResponse'],['unread','Unread','mail',''],['all','All conversations','messages',''],['resolved','Resolved','check',''],['blocked','Blocked','block','']] as $folder): ?>
      <button type="button" data-msg-folder="<?= $folder[0] ?>" aria-pressed="false"><svg class="msg-icon" aria-hidden="true"><use href="#msg-icon-<?= $folder[2] ?>"/></svg><span><?= $folder[1] ?></span><?php if ($folder[3]): ?><b data-msg-count="<?= $folder[3] ?>">—</b><?php endif; ?></button>
    <?php endforeach; ?></nav><div class="msg-response-summary" data-msg-stats aria-label="Conversation statistics"></div></aside>
    <?php endif; ?>
    <aside class="msg-directory" aria-label="Conversation list">
      <form data-msg-filters class="msg-filters"><label>Search conversations<input type="search" name="q" maxlength="120" placeholder="Name, message or order"></label><?php if ($messageConfig['merchant']): ?><input type="hidden" name="state" value="open"><input type="hidden" name="unread" value="all"><button type="submit"><svg class="msg-icon" aria-hidden="true"><use href="#msg-icon-search"/></svg>Search</button><?php else: ?><div class="msg-filter-row"><label>State<select name="state"><option value="all">All conversations</option><option value="open">Open</option><option value="needs-response">Needs response</option><option value="resolved">Resolved</option><option value="blocked">Blocked</option></select></label><label>Read status<select name="unread"><option value="all">All messages</option><option value="1">Unread</option></select></label></div><button type="submit">Apply filters</button><?php endif; ?></form>
      <p class="msg-list-status" data-msg-list-status role="status">Loading conversations…</p><div data-msg-list></div><button type="button" data-msg-more hidden>Load more conversations</button>
    </aside>
    <section class="msg-detail" aria-label="Conversation" data-msg-detail><div class="msg-empty"><span aria-hidden="true">✉</span><h2>A little conversation goes a long way</h2><p>Choose a conversation to read and reply.</p></div></section>
  </div>
  <dialog data-msg-new-dialog aria-labelledby="msg-new-title"><form data-msg-new-form><h2 id="msg-new-title">Start a conversation</h2><p>Enter an order from your store. The buyer must have signed in and claimed that order.</p><label>Order reference<input name="order" required maxlength="30" pattern="EZK-[SP]-[A-F0-9]{24}" placeholder="EZK-S-…"></label><p class="msg-error" role="alert" data-msg-new-error></p><div class="msg-actions"><button type="button" data-msg-close>Cancel</button><button type="submit" class="msg-primary">Open conversation</button></div></form></dialog>
  <dialog data-msg-reply-dialog aria-labelledby="msg-reply-title"><h2 id="msg-reply-title">Saved replies</h2><p>Insert a reply into your draft, then review it before sending.</p><div data-msg-reply-list></div><form data-msg-reply-form><input type="hidden" name="id"><input type="hidden" name="revision" value="0"><label>Reply title<input name="title" maxlength="80" required></label><label>Reply text<textarea name="body" maxlength="4000" rows="4" required></textarea></label><p data-msg-reply-error class="msg-error" role="alert"></p><div class="msg-actions"><button type="button" data-msg-reply-reset>New saved reply</button><button type="submit" class="msg-primary">Save reply</button><button type="button" data-msg-reply-retry hidden>Retry confirmation</button></div></form><button type="button" data-msg-close>Close saved replies</button></dialog>
  <dialog data-msg-photo-dialog aria-label="Message photo"><button type="button" data-msg-close>Close photo</button><img alt="Photo attached to this conversation"></dialog>
</section>
<script src="/cart/messages.js?v=<?= (int) filemtime(__DIR__ . '/messages.js') ?>" defer></script>
