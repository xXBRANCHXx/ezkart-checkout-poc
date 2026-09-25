<section class="tracking-card customer-returns" data-customer-returns data-order="<?= htmlspecialchars($orderId, ENT_QUOTES, 'UTF-8') ?>" data-csrf="<?= htmlspecialchars($customerCsrf, ENT_QUOTES, 'UTF-8') ?>" data-account="<?= htmlspecialchars($customerAccount['id'], ENT_QUOTES, 'UTF-8') ?>" aria-labelledby="customer-returns-title">
  <header><div><h2 id="customer-returns-title">Returns</h2><p>Request a return and follow the store’s response.</p></div><button type="button" class="copy-button" data-cr-refresh>Refresh returns</button></header>
  <p data-cr-status role="status">Loading your returns…</p><p class="cr-error" data-cr-error role="alert" hidden></p>
  <ul data-cr-list></ul><button type="button" class="copy-button" data-cr-more hidden>Load older returns</button>
  <div data-cr-detail hidden></div>
  <button type="button" class="copy-button" data-cr-new disabled>Request a return</button>
  <form data-cr-form hidden>
    <h3>New return request</h3><p>Choose the original items you want to return. The store will review your request and provide instructions.</p>
    <div data-cr-items></div>
    <label>Reason<select name="reason"><option value="damaged">Damaged item</option><option value="wrong_item">Wrong item</option><option value="not_as_described">Not as described</option><option value="changed_mind">Changed mind</option><option value="other">Other reason</option></select></label>
    <label>What happened?<textarea name="note" rows="3" maxlength="1000" required minlength="3" placeholder="Describe the issue and which items are affected"></textarea></label>
    <p class="cr-help">Wait for the store’s instructions before sending items back. Return approval and a refund are separate decisions.</p>
    <div class="cr-actions"><button type="button" class="copy-button" data-cr-cancel>Cancel</button><button type="submit" class="copy-button" data-cr-submit disabled>Submit request</button></div>
  </form>
  <form data-cr-withdraw-form hidden><h3>Withdraw this request?</h3><p>Your request will stay in the return history. The store will stop reviewing it.</p><label>Message to the store (optional)<textarea name="message" rows="2" maxlength="2000"></textarea></label><div class="cr-actions"><button type="button" class="copy-button" data-cr-withdraw-cancel>Keep request</button><button type="submit" class="copy-button" data-cr-withdraw-confirm>Withdraw request</button></div></form>
  <button type="button" class="copy-button" data-cr-retry hidden>Retry confirmation</button>
</section>
