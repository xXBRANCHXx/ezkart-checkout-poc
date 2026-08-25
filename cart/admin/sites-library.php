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
  <header><span><?= ez_admin_icon('layout') ?></span><div><small>Create a landing page</small><h2>Start with at least one product.</h2><p>Choose from the real products already saved in your Ezkart catalog.</p></div><button type="button" data-creator-close aria-label="Close"><?= ez_admin_icon('x') ?></button></header>
  <section>
    <label><span>Page name</span><input name="page_name" required maxlength="60" placeholder="Example: Ramadan Collection"></label>
    <fieldset data-creator-products><legend>Starting products</legend><p class="creator-products-empty" data-creator-products-empty>No products are available yet. <a href="?page=products">Create a product first</a>.</p></fieldset>
    <label><span>Free Ezkart URL</span><div class="slug-field"><input name="slug" required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="ramadan-collection"><em>.ezkart.site</em></div></label>
  </section>
  <footer><button type="button" data-creator-close>Cancel</button><button class="primary" value="default">Create &amp; edit</button></footer>
</form></dialog>
