<?php
if (!isset($authenticated) || !$authenticated) { http_response_code(404); exit; }
?>
<header class="page-heading"><div><h1>Jev page reviews</h1><p>Review a saved page, assess Jev’s evidence and grade its recommendation.</p></div></header>
<?php if (empty($supportAccess['authorized'])): ?>
<section class="jev-card"><h2>Review access required</h2><p>This account has no Ezkart review permission. Store membership does not grant this access.</p></section>
<?php else: ?>
<?php if (!empty($supportAccess['requiresVerification']) || !empty($supportAccess['error'])): ?>
<section class="jev-card" id="review-verification"><h2>Verify your authenticator</h2><p>A fresh authenticator code is required before changing a review. Verification lasts ten minutes.</p>
<?php if (!empty($supportAccess['error'])): ?><p role="alert"><?= ez_admin_escape($supportAccess['error']) ?></p><?php endif; ?>
<form method="post"><input type="hidden" name="action" value="support_verify"><input type="hidden" name="csrf_token" value="<?= ez_admin_escape($csrfToken) ?>"><label>Authenticator code<input name="code" required inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6"></label><button class="action-button" type="submit">Verify review access</button></form></section>
<?php endif; ?>
<?php if (!empty($supportAccess['canRead'])): ?>
<div class="jev-workspace" data-jev data-account="<?= ez_admin_escape($adminUser['id'] ?? '') ?>" data-csrf="<?= ez_admin_escape($csrfToken) ?>" data-can-write="<?= !empty($supportAccess['canWrite']) ? 'true' : 'false' ?>">
<section class="jev-card jev-notice"><p>Jev’s recommendations need human judgment. A permitted temporary archive hides the page from visitors while the seller can edit and existing orders remain available. No automatic deletion.</p><p data-jev-mode>Loading review configuration…</p></section>
<p role="status" aria-live="polite" data-jev-message></p>
<div class="jev-recovery" data-jev-recovery hidden><p>An action has not been confirmed. Recover the original action before starting another.</p><button type="button" class="action-button" data-jev-retry>Retry confirmation</button></div>
<div class="jev-layout">
<section class="jev-card"><header class="jev-heading"><h2>Review queue</h2><button type="button" class="action-button" data-jev-refresh>Refresh</button></header><div data-jev-list><p>Loading reviews…</p></div></section>
<section class="jev-card" data-jev-detail aria-live="polite"><h2>Choose a review</h2><p>Open a saved request to inspect the exact page revision and its evidence.</p></section>
</div>
<section class="jev-card" data-jev-intake><h2>Queue a page review</h2><p>Saving a concern does not call the model or establish that the claim is true. A reviewer starts each review separately. Public visitor reports are not connected yet.</p>
<form data-jev-pages><label>Store slug<input name="store" required maxlength="96" pattern="[a-z0-9][a-z0-9-]*" autocomplete="off" placeholder="example-store"></label><button type="submit" class="action-button">Load saved pages</button></form>
<form data-jev-create hidden><label>Saved page<select name="pageId" required></select></label><p data-jev-revision></p><label>Reported concern<textarea name="reportText" maxlength="1200" rows="3" required placeholder="Describe the concern. Jev must assess the page evidence independently."></textarea></label><button type="submit" class="action-button primary">Save review request</button></form>
</section>
</div>
<?php endif; endif; ?>
