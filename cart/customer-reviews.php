<section class="tracking-card customer-reviews" data-customer-reviews data-order="<?= htmlspecialchars($orderId, ENT_QUOTES, 'UTF-8') ?>" data-csrf="<?= htmlspecialchars($customerCsrf, ENT_QUOTES, 'UTF-8') ?>" data-version="<?= htmlspecialchars($customerVersion, ENT_QUOTES, 'UTF-8') ?>" aria-labelledby="customer-reviews-title">
  <header><div><h2 id="customer-reviews-title">Your product reviews</h2><p>Share your experience after delivery. Your public name, rating, text and selected photos will be visible to shoppers.</p></div><button type="button" class="copy-button" data-review-refresh>Refresh reviews</button></header>
  <p data-review-status role="status">Loading your purchases…</p><p data-review-error class="review-error" role="alert" hidden></p>
  <div data-review-items></div>
  <noscript><p>Enable JavaScript to read and manage your product reviews.</p></noscript>
</section>
