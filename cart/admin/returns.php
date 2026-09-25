<section class="returns-workspace" data-returns>
  <header class="page-heading"><div><a href="?page=orders">← Orders</a><h1>Returns</h1><p>Review requests, inspect received items, and keep a clear stock history.</p></div><button type="button" class="ui-button primary" data-return-new disabled>Open a return</button></header>
  <p class="returns-status" data-return-status role="status">Loading returns…</p>
  <div class="returns-layout">
    <section class="surface returns-queue"><header><h2>Return requests</h2><button type="button" class="ui-button" data-return-refresh>Refresh</button></header>
      <label>Show<select data-return-filter><option value="open">Needs follow-up</option><option value="requested">Awaiting review</option><option value="approved">Awaiting arrival</option><option value="receiving">Partly received</option><option value="inspected">Inspection complete</option><option value="all">All returns</option><option value="declined">Declined</option><option value="withdrawn">Withdrawn</option><option value="closed">Intake closed</option></select></label>
      <p data-return-list-status role="status"></p><ul data-return-list></ul><button type="button" class="ui-button" data-return-more hidden>Load more returns</button>
    </section>
    <section class="surface returns-detail" aria-label="Return details"><header><div><h2 data-return-title>Select a return</h2><p data-return-subtitle>Review the original order and its return history here.</p></div><button type="button" class="ui-button" data-return-reload disabled>Reload</button></header>
      <p class="returns-error" data-return-error role="alert" hidden></p><div data-return-detail><div class="returns-empty">Return requests will appear as customers and your team open them.</div></div>
      <div class="returns-actions" data-return-actions></div>
    </section>
  </div>
  <dialog class="returns-dialog" data-return-dialog aria-labelledby="return-dialog-title">
    <header><h2 id="return-dialog-title">Open a return</h2><button type="button" class="ui-button" data-return-close aria-label="Close return form">×</button></header>
    <div class="returns-dialog-body">
      <form data-return-lookup><label>Order reference<input name="order" placeholder="EZK-S-…" autocomplete="off" maxlength="30" required></label><button type="submit" class="ui-button">Find order</button></form>
      <p data-return-form-context></p>
      <form data-return-form>
        <div data-return-request-fields><label>Reason<select name="reason"><option value="damaged">Damaged item</option><option value="wrong_item">Wrong item</option><option value="not_as_described">Not as described</option><option value="changed_mind">Changed mind</option><option value="delivery_failed">Courier return</option><option value="other">Other reason</option></select></label><label>What happened?<textarea name="note" rows="3" maxlength="1000" placeholder="Describe the issue and the items being returned"></textarea></label></div>
        <div class="returns-lines" data-return-form-lines></div>
        <label data-return-message-field>Message for the customer<textarea name="message" rows="3" maxlength="2000"></textarea></label>
        <label data-return-private-field>Private inspection note<textarea name="privateNote" rows="3" maxlength="1000" placeholder="Condition, inspection location, and why any units are kept out of stock"></textarea></label>
        <label class="returns-confirm" data-return-confirm-field><input type="checkbox" name="confirmed"><span>I physically received and inspected these units. Only saleable units will go back into stock.</span></label>
      </form>
      <p class="returns-help" data-return-form-help></p><p class="returns-error" data-return-form-error role="alert" hidden></p>
    </div>
    <footer><button type="button" class="ui-button" data-return-form-reload>Reload details</button><button type="button" class="ui-button" data-return-close>Cancel</button><button type="submit" form="return-operation" class="ui-button primary" data-return-save disabled>Save</button></footer>
  </dialog>
</section>
