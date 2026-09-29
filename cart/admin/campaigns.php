<?php
declare(strict_types=1);
if (empty($authenticated)) { http_response_code(404); return; }
ez_page_header('Campaigns', 'See which landing pages and sources turn visits into sales.');
?>
<div class="tracking-workspace" data-tracking-campaigns data-store="<?= ez_admin_escape($sellerId) ?>">
  <div class="tracking-toolbar"><nav aria-label="Campaign status"><button class="ui-button" data-view="active" aria-pressed="true" data-ui-icon="chart">Active Campaigns <span data-count="active">0</span></button><button class="ui-button" data-view="ended" aria-pressed="false" data-ui-icon="check">Ended Campaigns <span data-count="ended">0</span></button></nav><div class="tracking-actions"><button class="ui-button" data-refresh data-ui-icon="refresh">Refresh</button><button class="ui-button" data-compare disabled data-ui-icon="chart">Compare <span data-selected-count></span></button><button class="ui-button primary" data-new disabled data-ui-icon="plus">New campaign</button></div></div>
  <p data-status role="status">Loading campaigns…</p>
  <aside class="surface tracking-pending" data-pending hidden><p>A save is awaiting confirmation. Retry the original request to check its result.</p><button class="ui-button primary" data-retry data-ui-icon="refresh">Retry original save</button></aside>
  <div class="tracking-cards" data-list></div><button class="ui-button" data-more hidden data-ui-icon="plus">Load more campaigns</button>
  <section class="surface tracking-comparison" data-comparison hidden aria-label="Campaign comparison"><header><h2>Compare campaigns</h2><button class="ui-button" data-close-compare data-ui-icon="x">Close comparison</button></header><p>Daily averages use each campaign’s active calendar days in Jakarta time.</p><div class="tracking-table" data-compare-table tabindex="0" role="region" aria-label="Campaign comparison table"></div></section>
  <section class="tracking-detail" data-detail hidden aria-label="Campaign performance"></section>
  <dialog data-create-dialog aria-labelledby="tracking-create-title">
    <form data-create>
      <header class="tracking-create-header">
        <h2 id="tracking-create-title">Start a new campaign</h2>
        <button type="button" class="ui-button" data-cancel data-ui-icon="x" aria-label="Close"><span>Close</span></button>
      </header>
      <div class="tracking-create-body">
        <label class="tracking-create-name"><span id="tracking-name-label">Campaign name</span><input aria-labelledby="tracking-name-label" name="name" required maxlength="120" placeholder="e.g. September Launch" autocomplete="off" autofocus></label>
        <fieldset class="tracking-page-picker">
          <legend>Landing pages</legend>
          <p>Select one or more published landing pages to include in this campaign.</p>
          <div data-page-options></div>
        </fieldset>
        <p class="tracking-create-next">After creating the campaign, you can add up to 40 custom source URLs per landing page.</p>
        <p data-create-error role="alert"></p>
      </div>
      <footer class="tracking-create-footer"><span data-page-selection role="status">No pages selected yet</span><button type="submit" class="ui-button primary" data-ui-icon="arrow-right">Start campaign</button></footer>
    </form>
  </dialog>
  <dialog data-end-dialog aria-labelledby="tracking-end-title"><form method="dialog"><h2 id="tracking-end-title">End this campaign?</h2><p>Save its end date and close the reporting window. Existing links will still open the landing page. Later traffic and payments will not change this campaign’s results.</p><div class="tracking-actions"><button class="ui-button" value="cancel" data-ui-icon="x">Keep active</button><button class="ui-button primary" value="end" data-ui-icon="check">End campaign</button></div></form></dialog>
</div>
