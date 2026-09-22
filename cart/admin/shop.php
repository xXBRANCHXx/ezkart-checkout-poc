<?php declare(strict_types=1); ?>
<?php ez_page_header('Ready to sell', 'Shop', 'One home for your products. One familiar checkout for every order.', [['label' => 'Manage products', 'href' => '?page=products']]); ?>
<div class="shop-admin" data-shop-admin>
  <p class="shop-admin-status" id="shop-admin-status" role="status" aria-live="polite">Loading your shop…</p>
  <button class="action-button" type="button" id="shop-admin-retry" hidden>Try again</button>
  <section class="surface shop-link-panel"><div><span class="shop-section-label">YOUR SHOP PAGE</span><h2>Your whole catalog, one link</h2><p>Customers can add several products and pay together. Product prices, options, and stock stay in sync.</p><div class="shop-link-row"><input id="shop-public-url" aria-label="Shop URL" readonly placeholder="Your shop link will appear here"><button class="action-button" id="shop-copy-link" type="button" disabled>Copy link</button><a class="action-button" id="shop-open-link" target="_blank" rel="noopener" hidden>Open shop ↗</a></div><small id="shop-publish-status">Enable your shop below to share this link.</small></div></section>
  <form id="shop-appearance-form">
    <fieldset id="shop-settings" disabled>
      <div class="shop-editor-layout">
        <section class="surface shop-settings-panel">
          <header><span class="shop-section-label">CHECKOUT APPEARANCE</span><h2>Make it yours</h2><p>Shared across your shop and every product checkout.</p></header>
          <label class="shop-enable"><input type="checkbox" name="enabled"><span><b>Enable shop page</b><small>Your product checkout links work independently.</small></span></label>
          <label class="shop-field">Store name<input name="name" maxlength="80" required autocomplete="organization"></label>
          <div class="shop-colors"><label>Accent<input name="accent" type="color" value="#334155"></label><label>Buttons<input name="button" type="color" value="#111827"></label><label>Background<input name="background" type="color" value="#f7f8fa"></label></div>
          <div class="shop-upload"><label class="shop-field">Logo<input type="file" data-shop-upload="logoId" accept="image/png,image/jpeg,image/webp,image/avif"></label><div class="shop-upload-preview"><img id="shop-logo-preview" alt="Your logo" hidden><button type="button" class="action-button" data-remove-image="logoId" hidden>Remove logo</button></div></div>
          <div class="shop-upload"><label class="shop-field">Background image<input type="file" data-shop-upload="backgroundId" accept="image/png,image/jpeg,image/webp,image/avif"></label><div class="shop-upload-preview"><img id="shop-background-preview" alt="Your background" hidden><button type="button" class="action-button" data-remove-image="backgroundId" hidden>Remove background</button></div></div>
          <p class="shop-field-note">PNG, JPG, WebP, or AVIF. Up to 2 MB each.</p>
          <label class="shop-field">Element animation<select name="animation"><option value="none">None</option><option value="fade">Soft fade</option><option value="rise">Gentle rise</option></select></label>
          <p class="shop-field-note">Subtle entrance effects. Customer reduced-motion preferences are respected.</p>
          <button class="action-button primary shop-save" id="shop-save" type="submit">Save changes</button>
        </section>
        <section class="surface shop-preview-panel" aria-label="Appearance preview">
          <header><div><span class="shop-section-label">LIVE PREVIEW</span><h2>See how it feels</h2></div><div class="shop-preview-tabs" role="group" aria-label="Preview page"><button type="button" data-preview-mode="shop" aria-pressed="true">Shop</button><button type="button" data-preview-mode="checkout" aria-pressed="false">Product checkout</button></div></header>
          <label class="shop-preview-product" hidden>Preview product<select id="shop-preview-product"></select></label>
          <div id="shop-preview" class="shop-preview"></div>
          <p class="shop-preview-caption">Preview only. Save changes to update your public pages.</p>
        </section>
      </div>
    </fieldset>
  </form>
  <section class="surface shop-product-links"><header><span class="shop-section-label">PRODUCT CHECKOUT LINKS</span><h2>Sell from any website</h2><p>Each active product has one checkout link. Connect it to a button on your website, or share it directly.</p></header><div id="shop-product-links"></div></section>
  <p class="shop-explainer">Need a page to explain your offer? <a href="?page=sites">Build a landing page</a>. Its purchase buttons use the same delivery and payment flow.</p>
</div>
