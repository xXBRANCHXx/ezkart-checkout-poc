<?php
declare(strict_types=1);

$landingProjects = [
    ['name' => 'Morning Ritual Store', 'url' => 'madu-nusantara.id', 'product' => 'Granola Madu Nusantara', 'status' => 'Live', 'tone' => 'gold', 'description' => 'Warm editorial storefront for an everyday breakfast ritual.'],
    ['name' => 'Kopi Susu at Home', 'url' => 'kopisusu.ezkart.site', 'product' => 'Kopi Susu Concentrate', 'status' => 'Live', 'tone' => 'coffee', 'description' => 'A focused product page for café-style coffee at home.'],
    ['name' => 'Sambal Roa Launch', 'url' => 'sambal-roa.ezkart.site', 'product' => 'Sambal Roa Signature', 'status' => 'Draft', 'tone' => 'chili', 'description' => 'A bold launch page built around heat, smoke, and conversion.'],
];
?>
<section class="landing-library" data-landing-library>
  <header class="landing-library-header">
    <div><p class="page-eyebrow">Hosted storefronts</p><h1>Your landing pages</h1><p>Open a saved project to edit it, or create a new page when you have room.</p></div>
    <div class="landing-library-actions">
      <label class="advanced-mode-toggle"><input type="checkbox" data-advanced-mode><span><i></i><b>Advanced Mode</b><small>Remove the 6-project limit</small></span></label>
      <button class="action-button primary" type="button" data-library-create><?= ez_admin_icon('plus') ?> New landing page</button>
    </div>
  </header>

  <div class="landing-library-summary">
    <div><strong><span data-library-count>3</span><small> / <span data-library-limit>6</span></small></strong><p>saved projects</p></div>
    <span class="landing-library-progress"><i data-library-progress style="width:50%"></i></span>
    <p data-library-cap-copy>You can create 3 more projects. Delete a draft to make space, or enable Advanced Mode.</p>
  </div>

  <div class="landing-project-grid" data-project-grid>
    <?php foreach ($landingProjects as $index => $project): ?>
      <article class="landing-project-card" data-project-card data-site-name="<?= ez_admin_escape($project['name']) ?>" data-site-url="<?= ez_admin_escape($project['url']) ?>" data-site-status="<?= ez_admin_escape($project['status']) ?>" data-site-tone="<?= ez_admin_escape($project['tone']) ?>">
        <a class="landing-project-preview tone-<?= ez_admin_escape($project['tone']) ?>" href="?page=sites&amp;edit=<?= rawurlencode($project['url']) ?>" aria-label="Edit <?= ez_admin_escape($project['name']) ?>">
          <span class="project-browser"><i></i><i></i><i></i><small><?= ez_admin_escape($project['url']) ?></small></span>
          <span class="project-mini-page"><span><b><?= ez_admin_escape($project['name']) ?></b><em>Shop now</em></span><?= ez_admin_product_art($project['product']) ?><i></i><i></i><i></i></span>
          <span class="project-edit-hint"><?= ez_admin_icon('play') ?> Open editor</span>
        </a>
        <div class="landing-project-details"><div><span class="project-status <?= strtolower($project['status']) ?>"><i></i><?= ez_admin_escape($project['status']) ?></span><h2><a href="?page=sites&amp;edit=<?= rawurlencode($project['url']) ?>"><?= ez_admin_escape($project['name']) ?></a></h2><p><?= ez_admin_escape($project['description']) ?></p></div><button type="button" data-project-menu aria-label="Project actions"><?= ez_admin_icon('settings') ?></button></div>
        <footer><span><?= ez_admin_icon('globe') ?> <?= ez_admin_escape($project['url']) ?></span><a href="?page=sites&amp;edit=<?= rawurlencode($project['url']) ?>">Edit page <?= ez_admin_icon('chevron-right') ?></a></footer>
      </article>
    <?php endforeach; ?>
    <button class="landing-project-new" type="button" data-library-create-card><span><?= ez_admin_icon('plus') ?></span><b>Create another page</b><small data-new-card-copy>3 project spaces available</small></button>
  </div>

  <aside class="landing-library-note"><span><?= ez_admin_icon('shield') ?></span><div><b>Saved locally and versioned while you build</b><p>Each project keeps its own responsive layouts, content, product selection, and published snapshot.</p></div><a href="?page=products">Manage products</a></aside>
</section>

<dialog class="page-creator-dialog" id="library-page-creator-dialog"><form method="dialog" data-library-page-form><header><span><?= ez_admin_icon('layout') ?></span><div><small>Create a landing page</small><h2>Start with at least one product.</h2><p>Your new project opens in the editor with responsive layouts ready to customize.</p></div><button value="cancel" aria-label="Close"><?= ez_admin_icon('x') ?></button></header><section><label><span>Page name</span><input name="page_name" required maxlength="60" placeholder="Example: Ramadan Collection"></label><fieldset><legend>Starting products</legend><label><input type="checkbox" name="starter_products[]" value="granola" checked><span><?= ez_admin_icon('box') ?><b>Granola</b><small>Rp58.000</small></span></label><label><input type="checkbox" name="starter_products[]" value="coffee" checked><span><?= ez_admin_icon('coffee') ?><b>Kopi Susu</b><small>Rp79.000</small></span></label><label><input type="checkbox" name="starter_products[]" value="sambal"><span><?= ez_admin_icon('sambal') ?><b>Sambal Roa</b><small>Rp46.000</small></span></label></fieldset><label><span>Free Ezkart URL</span><div class="slug-field"><input name="slug" required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="ramadan-collection"><em>.ezkart.site</em></div></label></section><footer><button value="cancel">Cancel</button><button class="primary" value="default">Create &amp; edit</button></footer></form></dialog>
