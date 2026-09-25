<section class="fulfillment-workspace" data-fulfillment>
  <header class="page-heading"><div><a href="?page=orders">← Orders</a><h1>Fulfillment</h1><p>Accept paid orders, arrange pickup, and follow every shipment.</p></div><a class="ui-button" href="?page=returns"><?= ez_admin_icon('refund') ?>Manage returns</a></header>
  <p class="fulfillment-status" data-fulfillment-status role="status">Loading your orders…</p>
  <div class="fulfillment-recovery" data-fulfillment-recovery hidden></div>
  <div class="fulfillment-layout">
    <section class="surface fulfillment-queue" aria-label="Order queue"><header><h2>Order queue</h2><button type="button" class="ui-button" data-fulfillment-refresh>Refresh</button></header>
      <form data-fulfillment-search><label>Find an order<input name="q" type="search" maxlength="100" placeholder="Order reference or customer"></label><button type="submit" class="ui-button">Search</button></form>
      <label>Show<select data-fulfillment-filter><option value="needs_action">Ready for action</option><option value="awaiting_acceptance">Awaiting acceptance</option><option value="processing">Preparing &amp; pickup</option><option value="in_transit">On the way</option><option value="delivered">Delivered</option><option value="attention">Needs attention</option><option value="all">All orders</option></select></label>
      <p data-fulfillment-list-status role="status"></p><ul data-fulfillment-list></ul><button type="button" class="ui-button" data-fulfillment-more hidden>Load more orders</button>
    </section>
    <section class="surface fulfillment-detail" aria-label="Order details"><header><div><h2 data-fulfillment-title tabindex="-1">Select an order</h2><p data-fulfillment-subtitle>Review its items, delivery details, and courier updates.</p></div><button type="button" class="ui-button" data-fulfillment-reload disabled>Reload</button></header>
      <p class="fulfillment-error" data-fulfillment-error role="alert" hidden></p>
      <div data-fulfillment-detail><div class="fulfillment-empty"><span class="fulfillment-empty-icon"><?= ez_admin_icon('truck') ?></span><h3>Ready when your orders are.</h3><p>Select a paid order to prepare its delivery.</p></div></div>
      <div class="fulfillment-actions" data-fulfillment-actions></div>
    </section>
  </div>
  <dialog class="fulfillment-dialog" data-fulfillment-dialog aria-labelledby="fulfillment-dialog-title">
    <header><h2 id="fulfillment-dialog-title">Review action</h2><button type="button" class="ui-button" data-fulfillment-close aria-label="Close action review">×</button></header>
    <div class="fulfillment-dialog-body"><p data-fulfillment-context></p><div data-fulfillment-preview></div>
      <form id="fulfillment-operation" data-fulfillment-form><label data-fulfillment-note-field>Why are you cancelling this pickup?<textarea name="note" rows="3" maxlength="500" placeholder="Give the courier a clear reason"></textarea></label></form>
      <p class="fulfillment-help" data-fulfillment-help></p><p class="fulfillment-error" data-fulfillment-form-error role="alert" hidden></p>
    </div>
    <footer><button type="button" class="ui-button" data-fulfillment-close>Close</button><button type="submit" form="fulfillment-operation" class="ui-button primary" data-fulfillment-confirm>Confirm</button></footer>
  </dialog>
</section>
