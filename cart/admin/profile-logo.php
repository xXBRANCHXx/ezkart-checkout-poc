<div class="profile-logo-editor" id="profile-logo" data-profile-logo-editor>
  <span class="avatar profile-logo-preview" data-admin-profile-avatar data-logo-state="<?= ez_admin_escape($adminLogoState) ?>">
    <span data-admin-profile-fallback><?= ez_admin_escape(mb_substr($adminInitials, 0, 2)) ?></span>
    <img data-admin-profile-image alt="Store logo" <?= $adminLogoSrc !== '' ? 'src="' . ez_admin_escape($adminLogoSrc) . '"' : '' ?>>
  </span>
  <div class="profile-logo-content">
    <h3>Store logo</h3>
    <p>Your store logo, shown in the admin header. Landing-page logos are uploaded separately.</p>
    <div class="profile-logo-actions">
      <label class="profile-logo-upload"><input type="file" accept="image/png,image/jpeg,image/webp,image/avif" data-profile-logo-upload disabled><span data-profile-logo-upload-label>Upload logo</span></label>
      <button type="button" data-profile-logo-remove hidden disabled>Remove</button>
      <button type="button" data-profile-logo-retry hidden>Try again</button>
    </div>
    <p class="profile-logo-help">PNG, JPG, WebP or AVIF, up to 2 MB. Fits your logo inside a circular badge. Changes save automatically.</p>
    <p class="profile-logo-status" data-profile-logo-status role="status" aria-live="polite">Loading store logo…</p>
  </div>
</div>
