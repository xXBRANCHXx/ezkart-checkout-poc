<?php
if (!isset($authenticated) || !$authenticated) { http_response_code(404); exit; }
$refundAudience='support'; $refundOrderId=''; $refundAccount=(string) ($adminUser['id'] ?? ''); $refundStore=''; $refundCsrf=$csrfToken; $refundVersion='';
?>
<div class="page-heading"><div><h1>Ezkart reviews</h1><p>Review refunds against their original purchase and evidence, and prepare approved DOKU requests.</p></div></div>
<?php if (empty($supportAccess['authorized'])): ?>
<section class="refunds-workspace"><h2>Review access required</h2><p>This account has no Ezkart review permission. Store membership does not grant this access.</p><?php if (!empty($supportAccess['error'])): ?><p role="alert"><?= htmlspecialchars($supportAccess['error'], ENT_QUOTES, 'UTF-8') ?></p><?php endif; ?></section>
<?php else: ?>
<?php if (!empty($supportAccess['requiresVerification']) || !empty($supportAccess['error'])): ?>
<section class="refunds-workspace" id="review-verification"><h2>Verify your authenticator</h2><p>A fresh authenticator code is required before changing a review. Verification lasts ten minutes.</p>
<?php if (!empty($supportAccess['error'])): ?><p role="alert"><?= htmlspecialchars($supportAccess['error'], ENT_QUOTES, 'UTF-8') ?></p><?php endif; ?>
<form method="post"><input type="hidden" name="action" value="support_verify"><input type="hidden" name="csrf_token" value="<?= htmlspecialchars($csrfToken, ENT_QUOTES, 'UTF-8') ?>"><label>Authenticator code<input name="code" required inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6"></label><button type="submit">Verify review access</button></form>
</section>
<?php endif; ?>
<?php if (!empty($supportAccess['canRead'])): ?>
<?php if (($supportAccess['role'] ?? '') === 'viewer'): ?><p>Your review access is read-only.</p><?php endif; ?>
<?php require dirname(__DIR__) . '/refunds-workspace.php'; ?>
<?php endif; ?>
<?php endif; ?>
