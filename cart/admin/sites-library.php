<?php declare(strict_types=1); ?>
<section class="landing-library" data-landing-library>
  <header class="landing-library-header">
    <div><p class="page-eyebrow">Hosted storefronts</p><h1>Your landing pages</h1><p>Create a page, connect products, and shape the storefront around your brand.</p></div>
    <div class="landing-library-actions">
      <button class="action-button primary" type="button" data-library-create><?= ez_admin_icon('plus') ?> New landing page</button>
    </div>
  </header>

  <div class="landing-library-summary">
    <div><strong><span data-library-count>0</span><small> / <span data-library-limit>6</span></small></strong><p>saved projects</p></div>
    <span class="landing-library-progress"><i data-library-progress style="width:0"></i></span>
    <p data-library-cap-copy>You can create up to 6 landing-page projects.</p>
  </div>

  <div class="landing-project-grid" data-project-grid>
    <button class="landing-project-new" type="button" data-library-create-card><span><?= ez_admin_icon('plus') ?></span><b>Create your first page</b><small data-new-card-copy>6 project spaces available</small></button>
  </div>

  <aside class="landing-library-note"><span><?= ez_admin_icon('shield') ?></span><div><b>Saved securely to Ezkart cloud storage</b><p>Each project keeps its responsive layouts, content, product selection, and published snapshot in R2.</p></div><a href="?page=products">Manage products</a></aside>
</section>

<dialog class="page-creator-dialog" id="library-page-creator-dialog"><form method="dialog" data-library-page-form>
  <header><span><?= ez_admin_icon('layout') ?></span><div><small>Create a landing page</small><h2>Start with at least one product.</h2><p>Choose a sandbox item or add a real product with its own name, price, and photos.</p></div><button type="button" data-creator-close aria-label="Close"><?= ez_admin_icon('x') ?></button></header>
  <section>
    <label><span>Page name</span><input name="page_name" required maxlength="60" placeholder="Example: Ramadan Collection"></label>
    <fieldset data-creator-products><legend>Starting products</legend><label><input type="checkbox" name="starter_products[]" value="granola" checked><span><?= ez_admin_icon('box') ?><b>Granola</b><small>Rp58.000</small></span></label><label><input type="checkbox" name="starter_products[]" value="coffee" checked><span><?= ez_admin_icon('coffee') ?><b>Kopi Susu</b><small>Rp79.000</small></span></label><label><input type="checkbox" name="starter_products[]" value="sambal"><span><?= ez_admin_icon('sambal') ?><b>Sambal Roa</b><small>Rp46.000</small></span></label></fieldset>
    <div class="creator-own-products"><button type="button" data-creator-add-own><?= ez_admin_icon('plus') ?> Add your own product</button><div class="creator-product-form" data-creator-product-form hidden>
      <label><span>Product name</span><input type="text" maxlength="70" data-creator-product-name placeholder="Example: Rafi's Leather Wallet"></label>
      <label><span>Product type</span><select data-creator-product-type><option value="physical">Physical product</option><option value="digital">Digital download</option><option value="subscription">Subscription</option></select></label>
      <label><span>Price (IDR)</span><input type="number" min="1000" step="500" value="75000" data-creator-product-price></label>
      <label data-creator-physical-field><span>Shipping weight (grams)</span><input type="number" min="1" max="50000" step="1" value="500" data-creator-product-weight></label>
      <label data-creator-digital-field hidden><span>Download filename</span><input type="text" maxlength="100" placeholder="example-ebook.pdf" data-creator-digital-name><small>Used in this sample; the sellable file belongs in secure catalog storage.</small></label>
      <div class="creator-subscription-fields" data-creator-subscription-fields hidden><label><span>Bill every</span><input type="number" min="1" max="120" value="1" data-creator-subscription-interval></label><label><span>Period</span><select data-creator-subscription-unit><option value="month">Month</option><option value="year">Year</option></select></label><p>Customers will be billed automatically on the schedule you choose.</p></div>
      <label class="creator-product-photo"><span>Product images</span><input type="file" multiple accept="image/png,image/jpeg,image/webp,image/avif" data-creator-product-image><small data-creator-image-rule>Physical products need 3–9 images. Every image must be 2 MB or smaller.</small></label>
      <div><button type="button" data-creator-product-cancel>Never mind</button><button type="button" class="primary" data-creator-product-save>Add product</button></div>
    </div><div class="creator-custom-product-list" data-creator-custom-products hidden></div></div>
    <label><span>Free Ezkart URL</span><div class="slug-field"><input name="slug" required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="ramadan-collection"><em>.ezkart.site</em></div></label>
  </section>
  <footer><button type="button" data-creator-close>Cancel</button><button class="primary" value="default">Create &amp; edit</button></footer>
</form></dialog>
