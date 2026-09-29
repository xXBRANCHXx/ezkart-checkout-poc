<?php if (!isset($authenticated) || !$authenticated) { http_response_code(404); exit; } ?>
<section class="reviews-view commerce-reviews" data-commerce-reviews data-preview="<?= $customerPreview ? '1' : '0' ?>">
  <p class="reviews-notice" data-reviews-availability hidden></p>
  <section class="surface reviews-workspace-summary" aria-label="Published store ratings"><header class="surface-header"><div><h2>Customer ratings</h2><p>Published reviews across your store. Filters narrow the list below.</p></div></header><div data-reviews-summary></div></section>
  <section class="surface reviews-workspace-list" aria-labelledby="review-list-heading">
    <header class="surface-header"><div><h2 id="review-list-heading">Manage reviews</h2><p>Reply to buyers and review content with a clear, recorded reason.</p></div><button type="button" class="reviews-button" data-reviews-refresh data-ui-icon="refresh">Refresh reviews</button></header>
    <form class="reviews-filters" data-reviews-filters>
      <label>Search<input type="search" name="q" maxlength="120" placeholder="Buyer, text, product or order"></label>
      <label>Product<select name="product"><option value="">All products</option><?php foreach ($dashboardProducts as $product): ?><option value="<?= ez_admin_escape((string) $product['id']) ?>"><?= ez_admin_escape((string) ($product['name'] ?? $product['title'] ?? $product['id'])) ?></option><?php endforeach; ?></select></label>
      <label>Visibility<select name="state"><option value="all">All states</option><option value="published">Published</option><option value="pending">Awaiting moderation</option><option value="hidden">Hidden by store</option><option value="withdrawn">Withdrawn by buyer</option></select></label>
      <label>Rating<select name="rating"><option value="">All ratings</option><?php for ($rating=5;$rating>=1;$rating--): ?><option value="<?= $rating ?>"><?= $rating ?> <?= $rating===1?'star':'stars' ?></option><?php endfor; ?></select></label>
      <label>Store reply<select name="reply"><option value="all">All reviews</option><option value="needed">Needs a current reply</option><option value="replied">Current reply saved</option></select></label>
      <label>Photos<select name="photos"><option value="">All reviews</option><option value="1">With photos</option><option value="0">Without photos</option></select></label>
      <label>Order<select name="sort"><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label>
      <div class="reviews-actions"><button type="submit" class="reviews-button primary" data-ui-icon="sliders">Apply filters</button><button type="button" class="reviews-button" data-reviews-clear data-ui-icon="undo">Clear filters</button></div>
    </form>
    <p data-reviews-list-status role="status">Loading reviews…</p><p data-reviews-list-error class="reviews-error" role="alert" hidden></p>
    <div data-reviews-list></div><footer class="reviews-footer"><p data-reviews-count></p><button type="button" class="reviews-button" data-reviews-more hidden data-ui-icon="arrow-right">Load more reviews</button></footer>
  </section>
  <section class="surface reviews-workspace-detail" data-reviews-detail hidden aria-labelledby="review-detail-heading">
    <header class="surface-header"><div><h2 id="review-detail-heading" tabindex="-1">Review details</h2><p data-reviews-detail-reference></p></div><div class="reviews-actions"><button type="button" class="reviews-button" data-reviews-detail-refresh data-ui-icon="refresh">Reload saved review</button><button type="button" class="reviews-button" data-reviews-detail-close data-ui-icon="x">Close details</button></div></header>
    <p data-reviews-detail-status role="status"></p><div data-reviews-detail-content></div>
  </section>
</section>
