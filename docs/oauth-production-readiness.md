# Google OAuth production-readiness

## Implemented in Ezkart

- Google sign-in starts on Ezkart with a CSRF-protected POST.
- OAuth uses an S256 PKCE challenge and a single-use verifier that expires
  after ten minutes in the private PHP session.
- Supabase authorization codes are exchanged server-side. Access and refresh
  tokens never enter browser-readable storage or the callback URL.
- Access tokens refresh five minutes before expiry. Rotated refresh tokens are
  saved atomically under the PHP session lock.
- Temporary provider failures preserve the refresh token for a later retry;
  invalid or revoked sessions fail closed.
- Logout clears the Ezkart session and requests Supabase `scope=local`
  revocation without signing the user out on their other devices.
- Open-beta access requires a verified Google identity at initial sign-in and
  after every refresh. The owner allowlist grants legacy-data access only.
- Each sign-in has an absolute 30-day lifetime, independent of browser refresh
  frequency. The cookie is HTTP-only, Secure on HTTPS, SameSite=Lax, and scoped
  to `/cart/admin`.
- Session files live outside the public web root in a private directory.

## Customer tracking login

The same Supabase Google provider also authenticates customers from a compact dialog on the tracking page. Its button opens Google in a popup using `/cart/login.php` as the PKCE controller; that route no longer presents a separate login landing page. Completion is checked against the server session, and blocked popups fall back to a full-page OAuth round trip. The callback `/cart/admin/customer-auth.php` is inside the existing redirect allowlist, but does not load the merchant admin session. A separate `ezkart_customer` cookie is scoped to `/cart`; its private directory is set by `customer_session_storage`. Customer login uses the same PKCE, server token storage, verified Google identity, refresh, absolute lifetime and local logout protections described above. Verified TOTP factors are required before completing login. Customer sessions confer no merchant privileges.

An active Ezkart Google login on the same host is recognized through the CSRF-protected `/cart/admin/customer-session.php` bridge. It reuses the existing admin session validation/refresh and verifies Google identity and MFA, then creates a short-lived customer identity without copying refresh tokens or merchant permissions. Password-only and pending-MFA sessions are rejected. Customer sign-out prevents automatic re-entry from the existing login.

Tracking authorization is tied to each order's immutable Supabase user ID. Guest orders can be linked only through a matching verified account email. See [customer tracking](customer-order-tracking.md) for ownership and sandbox behavior.

## Test Supabase project settings

1. Keep Google enabled under Authentication > Providers.
2. Set the test Site URL to `https://test.ezkart.id/cart/admin/`.
3. Allow `https://test.ezkart.id/cart/admin/**` as a redirect URL.
4. Keep JWT expiry at the recommended one hour.
5. Keep refresh-token rotation enabled and its reuse interval at 10 seconds.
6. Do not enable single-session-per-user for the beta; each tester should be
   able to use their own browser without invalidating another device.
7. Keep the Google client secret only in Supabase.

## Google Cloud settings for the open beta

1. Use an External consent screen and publish it to Production status so Google
   does not require a manually maintained test-user list.
2. Request only `openid`, `email`, and `profile`.
3. Add `ezkart.id` as an authorized domain and verify ownership.
4. Configure the exact Supabase callback URI displayed on the Google provider
   page in Supabase. Google redirects to Supabase; Supabase redirects to Ezkart.
5. Keep localhost and unrelated preview URLs out of the production web OAuth
   client.

## Production promotion

Google recommends separating test and production OAuth projects/clients. The
production client should contain only production origins and redirect URIs.
Before publishing the consent screen, confirm:

- app name, logo, support email, and developer contact email;
- a public Ezkart home page that accurately describes the service;
- public privacy-policy and terms pages on the verified `ezkart.id` domain;
- the production Supabase redirect allowlist includes only the required Ezkart
  admin callback;
- `config.runtime.php` uses `deployment_environment=production`,
  `admin_auth_mode=open`, and the publishable/anon key (never service-role);
- the test and production session directories are separate and outside their
  public document roots.

## Owner input still required

- The support/developer contact email to show on Google's consent screen.
- The legal or business name and contact details for the privacy policy and
  terms.
- Approval of the beta test before the hardened auth changes are promoted from
  `agent/ezkart-workbench` to `main`.
