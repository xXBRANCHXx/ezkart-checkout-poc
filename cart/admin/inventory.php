<section class="inv-workspace" data-inventory-workspace>
  <header class="page-heading"><div><a href="?page=products">← Products</a><h1>Inventory</h1><p>Count physical stock, record incoming units, and see every change.</p></div><button type="button" class="ui-button" data-inv-refresh>Refresh inventory</button></header>
  <p class="inv-status" data-inv-status role="status" aria-live="polite">Loading inventory…</p>
  <div class="inv-error" data-inv-error role="alert" hidden><span></span><button type="button" class="ui-button" data-inv-reload-draft>Reload saved draft</button></div>
  <section class="inv-metrics" aria-label="Inventory totals"><article><span>Units on hand</span><strong data-inv-metric="onHand">—</strong></article><article><span>Reserved for orders</span><strong data-inv-metric="reserved">—</strong></article><article><span>Available units</span><strong data-inv-metric="available">—</strong></article><article><span>Low / out of stock SKUs</span><strong data-inv-metric="lowStock">—</strong></article></section>
  <section class="surface inv-order-reviews" data-stock-reviews>
    <header class="surface-header"><div><h2>Paid orders needing stock</h2><p>Review payments received after their inventory hold was released.</p></div><button type="button" class="ui-button" data-stock-refresh>Refresh orders</button></header>
    <p class="inv-help" data-stock-status role="status">Loading paid orders…</p><ul class="inv-order-list" data-stock-list></ul>
    <div class="inv-pagination"><button type="button" class="ui-button" data-stock-more hidden>Load more orders</button></div>
    <dialog class="inv-review inv-stock-review" data-stock-dialog aria-labelledby="stock-review-title">
      <header><h2 id="stock-review-title">Review stock for a paid order</h2><button type="button" class="ui-button" data-stock-close aria-label="Close stock review">×</button></header>
      <p data-stock-order></p><p>Check the original items against the current catalog and available stock. All items must be allocated together before fulfillment can continue.</p>
      <p class="inv-error" data-stock-warning role="alert" hidden></p>
      <div class="inv-table-wrap"><table class="inv-table"><thead><tr><th>Original order item</th><th>Current inventory</th><th>Needed</th><th>Available</th></tr></thead><tbody data-stock-lines></tbody></table></div>
      <label class="inv-stock-note">Review note<textarea rows="3" maxlength="500" data-stock-note placeholder="Where you checked stock or the receipt that made it available"></textarea></label>
      <label class="inv-stock-confirm"><input type="checkbox" data-stock-confirm><span>I checked every original item and these units are available to fulfill this paid order.</span></label>
      <p class="inv-error" data-stock-error role="alert" hidden></p>
      <footer><button type="button" class="ui-button" data-stock-close>Close</button><button type="button" class="ui-button" data-stock-reload>Reload review</button><button type="button" class="ui-button primary" data-stock-apply disabled>Allocate stock and continue</button></footer>
    </dialog>
  </section>
  <div class="inv-layout">
    <section class="surface inv-stock">
      <form class="inv-filters" data-inv-filters><label>Find an item<input type="search" name="q" placeholder="Product, option, or SKU" maxlength="120"></label><label>Products<select name="status"><option value="active">Active</option><option value="archived">Archived</option><option value="all">All products</option></select></label><label>Availability<select name="level"><option value="all">All stock</option><option value="low">Low stock</option><option value="zero">Out of stock</option></select></label><button type="submit" class="ui-button">Search</button></form>
      <p class="inv-help">On hand includes reserved units and hidden options. Available = on hand − reserved. Only physically received, saleable units belong in a count.</p>
      <div class="inv-table-wrap"><table class="inv-table"><thead><tr><th scope="col">Product / SKU</th><th scope="col">On hand</th><th scope="col">Reserved</th><th scope="col">Available</th><th scope="col">Alert at</th><th scope="col" data-inv-input-label>New count</th></tr></thead><tbody data-inv-rows></tbody></table></div>
      <div class="inv-pagination"><span data-inv-results></span><button type="button" class="ui-button" data-inv-more hidden>Load more items</button></div>
    </section>
    <aside class="surface inv-count">
      <h2>Record a stock change</h2>
      <label>Action<select data-inv-kind><option value="count">Physical count</option><option value="received">Stock received</option><option value="damaged">Damaged stock</option><option value="lost">Lost stock</option><option value="correction">Correct a record</option><option value="alert">Change alert threshold</option></select></label>
      <p class="inv-help" data-inv-kind-help>Enter the total physically counted for each item. Leave uncounted items blank.</p>
      <label>Reference or note<textarea rows="3" maxlength="500" data-inv-note placeholder="Delivery reference, count location, or explanation"></textarea></label>
      <p class="inv-draft-status" data-inv-draft-status role="status">Your count draft saves to your account.</p>
      <h3><span data-inv-selected-count>0</span> <span data-inv-selected-label>selected items</span></h3>
      <ul class="inv-selection" data-inv-selection></ul>
      <button type="button" class="ui-button primary" data-inv-review disabled>Review changes</button>
      <button type="button" class="ui-button" data-inv-discard disabled>Clear draft</button>
      <p class="inv-help">Up to 100 items per adjustment. Saved counts remain in history. A changed stock version must be reviewed before saving.</p>
    </aside>
  </div>
  <section class="surface inv-history"><header class="surface-header"><div><h2>Inventory history</h2><p>Counts, catalog changes, receipts, and confirmed payment deductions.</p></div><button type="button" class="ui-button" data-inv-history-reset>All items</button></header><p class="inv-help" data-inv-history-filter>Latest changes across this store</p><div class="inv-table-wrap"><table class="inv-table"><thead><tr><th scope="col">When / who</th><th scope="col">Item</th><th scope="col">Change</th><th scope="col">Reason / reference</th></tr></thead><tbody data-inv-history-rows></tbody></table></div><div class="inv-pagination"><button type="button" class="ui-button" data-inv-history-more hidden>Load older changes</button></div></section>
  <button type="button" class="ui-button primary inv-mobile-review" data-inv-mobile-review disabled>Review changes</button>
  <dialog class="inv-review" data-inv-review-dialog aria-labelledby="inv-review-title"><header><h2 id="inv-review-title">Review inventory changes</h2><button type="button" class="ui-button" data-inv-review-close aria-label="Close review">×</button></header><p data-inv-review-note></p><div class="inv-table-wrap"><table class="inv-table"><thead><tr><th>Item</th><th>Before</th><th>After</th></tr></thead><tbody data-inv-review-rows></tbody></table></div><p class="inv-error" data-inv-review-error role="alert" hidden></p><footer><button type="button" class="ui-button" data-inv-review-close>Keep editing</button><button type="button" class="ui-button primary" data-inv-apply>Apply changes</button></footer></dialog>
</section>
