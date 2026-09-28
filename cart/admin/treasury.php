<?php
if (!isset($authenticated) || !$authenticated) { http_response_code(404); exit; }
$summary = $treasury['summary'] ?? null; $detail = $treasury['detail'] ?? null;
$form = static function (string $action) use ($csrfToken): void { ?>
<input type="hidden" name="csrf_token" value="<?= ez_admin_escape($csrfToken) ?>"><input type="hidden" name="action" value="<?= ez_admin_escape($action) ?>"><input type="hidden" name="request_key" value="<?= bin2hex(random_bytes(16)) ?>">
<?php };
?>
<header class="page-heading"><div><h1>Ezkart treasury</h1><p>Reserve settled company commission and review its transfer to Ezkart’s registered bank.</p></div><a class="action-button" href="?page=treasury">Refresh</a></header>
<?php if (!empty($treasury['error'])): ?><p role="alert" class="order-flash"><?= ez_admin_escape($treasury['error']) ?></p><?php endif; ?>
<?php if (!empty($treasury['notice'])): ?><p role="status" class="order-flash"><?= ez_admin_escape($treasury['notice']) ?></p><?php endif; ?>
<?php if ($summary === null): ?>
<section class="refunds-workspace"><h2>Verify treasury access</h2><p>Ezkart treasury requires an authorized operator and a fresh authenticator code.</p>
<?php if (!empty($supportAccess['authorized'])): ?><form method="post"><?php $form('support_verify'); ?><label>Authenticator code<input name="code" required inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6"></label><button type="submit" class="action-button primary">Verify access</button></form><?php endif; ?></section>
<?php else: $bank = $summary['companyBank']; $funds = $summary['funds']; ?>
<section class="page-stat-strip"><?php foreach (['netCommission'=>'Net commission','reservedCommission'=>'Reserved','paidCommission'=>'Transferred commission','paidTransferFees'=>'Actual transfer fees','reservableCommission'=>'Available to reserve'] as $key=>$label): ?><article><div><small><?= $label ?></small><strong>Rp <?= ez_admin_escape($funds[$key] ?? '—') ?></strong></div></article><?php endforeach; ?></section>
<section class="refunds-workspace"><h2>Company bank</h2><p><?= ez_admin_escape($bank['expectedBeneficiaryName'] ?? 'Not configured') ?> · <?= ez_admin_escape($bank['code'] ?? '') ?> · account ending <?= ez_admin_escape($bank['accountSuffix'] ?? '—') ?></p>
<p>These are commission reservations. A reservation does not establish bank-withdrawable cash or a completed transfer.</p>
<p>New bank transfers are held until the provider fee contract, company funding and commission release policy are verified.</p>
<?php if (!empty($funds['sourceCapacityExceeded'])): ?><p role="alert">Commission evidence has reached the review capacity. New reservations are held.</p><?php endif; ?>
<form method="post"><?php $form('treasury_reserve'); ?><label>Commission to reserve (whole rupiah)<input name="amount" required inputmode="numeric" pattern="[1-9][0-9]{0,15}" autocomplete="off"></label><button class="action-button primary" type="submit">Reserve commission</button></form></section>
<?php if ($detail): $intent=$detail['intent']; $inquiry=null;$payment=null;foreach($detail['bank'] as $step){if($step['stage']==='inquiry')$inquiry=$step;else $payment=$step;} ?>
<section class="refunds-workspace"><h2>Reservation Rp <?= ez_admin_escape($intent['amount']) ?></h2><p><?= ez_admin_escape($intent['id']) ?></p><p>Status: <?= ez_admin_escape(str_replace('_',' ',$intent['state'])) ?></p>
<p>Original destination: <?= ez_admin_escape($intent['companyBank']['code']) ?> · ending <?= ez_admin_escape($intent['companyBank']['accountSuffix']) ?> · <?= ez_admin_escape($intent['companyBank']['expectedBeneficiaryName']) ?></p>
<?php if ($detail['configurationChanged']): ?><p role="alert">Company account configuration changed. This original request requires review.</p><?php endif; ?>
<?php if ($inquiry): ?><p>Bank response holder: <strong><?= ez_admin_escape($inquiry['beneficiaryName'] ?? 'Response not recorded; original dispatch needs review') ?></strong></p><?php endif; ?>
<?php if (!$intent['cancelledAt'] && !$payment): ?>
<?php if ($inquiry && $inquiry['digest'] && !$detail['configurationChanged']): ?><form method="post"><?php $form('treasury_confirm'); ?><input type="hidden" name="digest" value="<?= ez_admin_escape($inquiry['digest']) ?>"><button class="action-button" type="submit">Confirm this company bank response</button></form><?php endif; ?>
<form method="post"><?php $form('treasury_inquiry'); ?><button class="action-button" type="submit" <?= !$inquiry && empty($summary['inquiryAvailable']) ? 'disabled' : '' ?>><?= $inquiry ? 'Recover original inquiry receipt' : 'Verify company bank' ?></button></form>
<form method="post"><?php $form('treasury_cancel'); ?><button class="action-button" type="submit">Cancel reservation</button></form>
<?php endif; ?>
<?php if ($payment || (!empty($detail['executionAvailable']) && !empty($detail['confirmations']))): ?><form method="post"><?php $form('treasury_payment'); ?><input type="hidden" name="confirmation_id" value="<?= ez_admin_escape($detail['paymentConfirmationId'] ?? $detail['confirmations'][0]['id'] ?? '') ?>"><button class="action-button" type="submit"><?= $payment ? 'Recover original transfer receipt' : 'Transfer confirmed commission' ?></button></form><?php endif; ?>
<?php if (!empty($detail['providerStatus'])): ?><p>Last provider status: <?= ez_admin_escape(str_replace('_',' ',$detail['providerStatus']['state'])) ?> · <?= ez_admin_escape($detail['providerStatus']['checkedAt']) ?></p><?php endif; ?>
<?php if (!empty($detail['outcome'])): $outcome=$detail['outcome']; ?><p>Evidence review: <strong><?= ez_admin_escape(str_replace('_',' ',$outcome['state'])) ?></strong> · <?= ez_admin_escape(str_replace('_',' ',$outcome['reason'])) ?></p><p>Observed provider fee: <?= $outcome['observedFee'] === null ? 'Unknown' : 'Rp ' . ez_admin_escape($outcome['observedFee']) ?>. <?= !empty($outcome['reconciled']) ? 'Company outflow is reconciled; the commission reservation is consumed. Bank-statement confirmation remains separate.' : (!empty($outcome['reservationConsumed']) ? 'The recorded company outflow remains deducted. Changed evidence needs review.' : 'The original reservation remains held until complete matching evidence is available.') ?></p><?php endif; ?>
<p>A recorded transfer response needs matching bank status and cash history. Unknown outcomes cannot be resent or manually marked paid.</p></section>
<?php endif; ?>
<section class="refunds-workspace"><h2>Recent reservations</h2><div class="data-table-shell"><table><thead><tr><th>Created</th><th>Commission</th><th>Status</th><th>Review</th></tr></thead><tbody><?php foreach($summary['recentIntents'] as $item): ?><tr><td><?= ez_admin_escape($item['createdAt']) ?></td><td>Rp <?= ez_admin_escape($item['amount']) ?></td><td><?= !empty($item['reconciled']) ? 'Company outflow reconciled' : ($item['transferStarted'] ? 'Transfer requires reconciliation' : ($item['cancelledAt'] ? 'Cancelled' : 'Reserved')) ?></td><td><a href="?page=treasury&amp;intent=<?= ez_admin_escape($item['id']) ?>">Open reservation</a></td></tr><?php endforeach; ?></tbody></table></div></section>
<?php endif; ?>
