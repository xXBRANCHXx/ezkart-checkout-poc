<?php
if (empty($authenticated)) { http_response_code(404); return; }
ez_page_header('Advanced Mode', 'More room for your store to grow.', [['label' => 'Settings', 'icon' => 'settings', 'href' => '?page=settings']]);
?>
<div class="advanced-layout" data-advanced-page>
  <section class="surface advanced-benefits" aria-labelledby="advanced-benefits-title">
    <header><h2 id="advanced-benefits-title">What you get</h2><p>Higher limits now, with more ways to understand and build your business.</p></header>
    <div class="advanced-feature"><?= ez_admin_icon('layout') ?><div><h3>Up to 24 landing pages</h3><p>Create more pages for your products, campaigns, and audiences.</p><span>Basic includes 6 pages</span></div><strong>24</strong></div>
    <div class="advanced-feature"><?= ez_admin_icon('box') ?><div><h3>Up to 50 products</h3><p>Expand your catalog while keeping everything in one place.</p><span>Basic includes 10 products</span></div><strong>50</strong></div>
    <div class="advanced-feature"><?= ez_admin_icon('chart') ?><div><h3>Richer analytics <span class="advanced-availability">Coming soon</span></h3><p>More detailed insights into your store’s performance.</p></div></div>
    <div class="advanced-feature"><?= ez_admin_icon('globe') ?><div><h3>Your own domain <span class="advanced-availability">Coming soon</span></h3><p>Connect your domain to your landing pages for a branded web address.</p></div></div>
  </section>
  <section class="surface advanced-plan" aria-labelledby="advanced-price-title">
    <div class="advanced-price">
      <h2 id="advanced-price-title">Advanced pricing</h2>
      <p class="advanced-rate"><strong>+1%</strong><span>per transaction</span></p>
      <p>Advanced adds 1% to your Ezkart transaction fee.</p>
    </div>
    <div class="advanced-plan-body">
      <dl class="advanced-fees"><div><dt>Basic commission</dt><dd>5%</dd></div><div><dt>With Advanced</dt><dd>6%</dd></div></dl>
      <p class="advanced-example">On Rp100,000 in product sales, that’s <strong>Rp1,000 extra</strong>. Shipping is excluded. Existing admin and payment-processing fees still apply.</p>
      <div class="advanced-toggle-row"><div><label for="advanced-toggle">Advanced Mode</label><span data-advanced-state><?= !empty($advancedPlan['enabled']) ? 'On for this store' : 'Off for this store' ?></span></div><input id="advanced-toggle" class="advanced-toggle" type="checkbox" role="switch" aria-describedby="advanced-price-title advanced-toggle-help advanced-status" data-advanced-toggle <?= !empty($advancedPlan['enabled']) ? 'checked' : '' ?> disabled></div>
      <p id="advanced-toggle-help">Turning this on selects Advanced and its extra 1% fee. To turn it off, your store must fit within Basic’s 6 pages and 10 products. Nothing is deleted automatically.</p>
      <?php if (!$commerceProduction): ?><p class="advanced-sandbox-note">You’re in sandbox mode. No real transaction fees are charged here.</p><?php endif; ?>
      <p id="advanced-status" data-advanced-status role="status" aria-live="polite">Loading your store’s plan…</p>
      <button class="ui-button" type="button" data-advanced-retry data-ui-icon="refresh" hidden>Try again</button>
      <noscript><p>Enable JavaScript to change Advanced Mode.</p></noscript>
    </div>
  </section>
</div>
