<?php
if (empty($authenticated)) { http_response_code(404); return; }
ez_page_header('Advanced Mode', 'More room for your store to grow.', [['label' => 'Settings', 'icon' => 'settings', 'href' => '?page=settings']]);
?>
<div class="advanced-layout" data-advanced-page>
  <section class="surface advanced-benefits" aria-labelledby="advanced-benefits-title">
    <header><h2 id="advanced-benefits-title">What you get</h2><p>Higher limits for your catalog and landing pages.</p></header>
    <div class="advanced-feature"><?= ez_admin_icon('layout') ?><div><h3>Up to 24 landing pages</h3><p>Create more pages for your products, campaigns, and audiences.</p><span>Basic includes 6 pages</span></div><strong>24</strong></div>
    <div class="advanced-feature"><?= ez_admin_icon('box') ?><div><h3>Up to 50 products</h3><p>Expand your catalog while keeping everything in one place.</p><span>Basic includes 10 products</span></div><strong>50</strong></div>
    <div class="advanced-feature"><?= ez_admin_icon('chart') ?><div><h3>Sales reports <span class="advanced-availability">Available on both plans</span></h3><p>Explore revenue, orders, payments and products, with chart details and CSV downloads. <a href="?page=analytics">Open analytics</a>.</p></div></div>
    <div class="advanced-feature"><?= ez_admin_icon('globe') ?><div><h3>Your own domain</h3><p>Connect a domain below, verify DNS ownership, and activate HTTPS for a published landing page.</p></div></div>
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
      <div class="advanced-toggle-row"><div><label for="advanced-toggle">Advanced Mode</label><span data-advanced-state><?= !empty($advancedPlan['enabled']) ? 'On for this store' : 'Off for this store' ?></span></div><input id="advanced-toggle" class="advanced-toggle" type="checkbox" role="switch" aria-describedby="advanced-price-title advanced-toggle-help advanced-status advanced-downgrade" data-advanced-toggle <?= !empty($advancedPlan['enabled']) ? 'checked' : '' ?> disabled></div>
      <p id="advanced-toggle-help">Turning this on selects Advanced and its extra 1% fee. To turn it off, your store must fit within Basic’s 6 pages and 10 products. Nothing is deleted automatically.</p>
      <section id="advanced-downgrade" class="advanced-downgrade" data-advanced-downgrade aria-labelledby="advanced-downgrade-title" hidden>
        <h3 id="advanced-downgrade-title" data-advanced-downgrade-title>Before switching to Basic</h3>
        <p data-advanced-downgrade-summary></p>
        <ul class="advanced-usage">
          <li data-advanced-usage="landingPages"><div><strong>Landing pages</strong><span data-advanced-count></span></div><p data-advanced-removal></p><a href="?page=sites">Manage landing pages</a></li>
          <li data-advanced-usage="products"><div><strong>Products</strong><span data-advanced-count></span></div><p data-advanced-removal></p><a href="?page=products">Manage products</a></li>
        </ul>
        <p class="advanced-counting-note">Published and draft landing pages count. Active and archived products count; archiving does not free a slot. Products with order history cannot be deleted.</p>
        <button class="ui-button" type="button" data-advanced-recheck data-ui-icon="refresh">Check limits again</button>
      </section>
      <?php if (!$commerceProduction): ?><p class="advanced-sandbox-note">You’re in sandbox mode. No real transaction fees are charged here.</p><?php endif; ?>
      <p id="advanced-status" data-advanced-status role="status" aria-live="polite">Loading your store’s plan…</p>
      <button class="ui-button" type="button" data-advanced-retry data-ui-icon="refresh" hidden>Try again</button>
      <noscript><p>Enable JavaScript to change Advanced Mode.</p></noscript>
    </div>
  </section>
</div>
<section class="surface domain-management" data-domain-management aria-labelledby="domain-title">
  <h2 id="domain-title">Connect your domain</h2>
  <p>Connect a public subdomain, such as shop.yourbrand.com, to one published landing page. Add the DNS records shown below, then check the connection. HTTPS must be ready before your page goes live here. Ezkart checks connected domains regularly. If a check is overdue or fails, use Check DNS and HTTPS to restore the connection.</p>
  <p>Switching to Basic suspends custom domains immediately. Your original Ezkart page addresses keep working. After returning to Advanced, generate a new ownership code and check the connection again.</p>
  <form data-domain-form>
    <label>Domain <input name="hostname" type="text" placeholder="shop.yourbrand.com" maxlength="253" required autocomplete="off"></label>
    <fieldset data-domain-pages><legend>Published landing page</legend><p>Loading pages…</p></fieldset>
    <button class="ui-button" type="submit" data-ui-icon="globe">Connect domain</button>
  </form>
  <p data-domain-status role="status" aria-live="polite">Loading domain connections…</p>
  <button class="ui-button" type="button" data-domain-refresh data-ui-icon="refresh">Refresh connections</button>
  <div data-domain-list></div>
</section>
