# Supabase Auth, Cloudflare D1, and R2 environments

## The simple version

Supabase is Ezkart's identity provider. It handles Google OAuth and returns a
stable `auth_user_id` plus a short-lived access token. It is not the commerce
database and Ezkart does not use the PostgreSQL direct-connection string.

Cloudflare provides the application data plane:

- A Worker validates the Supabase access token and applies seller permissions.
- D1 stores structured, queryable records such as profiles, sellers, products,
  page definitions, orders, payments, subscriptions, shipping, and reviews.
- R2 stores file bodies such as images, published HTML, paid downloads, and
  seller exports.

The D1 `app_users` row is a safe application profile linked by
`auth_user_id`. It is not an Auth replica. Never copy passwords, Google tokens,
Supabase access/refresh tokens, or a service-role key into D1.

## Environment boundary

| Website | Git branch | Worker | D1 | R2 |
| --- | --- | --- | --- | --- |
| `test.ezkart.id` | `agent/ezkart-workbench` | `ezkart-api-test.*.workers.dev` initially; `api-test.ezkart.id` after DNS moves to Cloudflare | `ezkart_test_database` | `ezkart-test-public` + `ezkart-test-private` |
| `ezkart.id` | `main` | `api.ezkart.id` | `ezkart_main_user_database` | `ezkart-production-public` + `ezkart-production-private` |

Both environments may use the same Supabase Auth project so the free project
remains the canonical user directory. Their application data and files remain
separate. A Git merge copies Worker code and migrations; it never copies D1
rows, R2 objects, Cloudflare bindings, or credentials.

## One-time setup

1. In Supabase Auth, enable Google and configure the Google client ID/secret.
2. Add the Supabase callback URL shown on its Google provider page to Google.
3. Add `https://test.ezkart.id/**` and `https://ezkart.id/**` to Supabase's
   allowed redirect URLs. Keep the Google client secret only in Supabase.
   Add the Supabase URL, publishable/anon key, and an explicit admin email
   allowlist to each website's private `config.runtime.php`; never use the
   service-role key. The workbranch admin exchanges the OAuth response for a
   server-verified PHP session. Supabase access and rotating refresh tokens
   remain only in Ezkart's private server-side session directory; they are
   never stored in browser-readable storage or D1.
4. Keep the existing `ezkart_main_user_database` D1 database as production and
   create `ezkart_test_database` for test.
5. Create four private R2 buckets: `ezkart-test-public`,
   `ezkart-test-private`, `ezkart-production-public`, and
   `ezkart-production-private`.
6. Copy `cloudflare/ezkart-api/wrangler.example.jsonc` to `wrangler.jsonc`,
   insert the test D1 ID, then deploy test. The Worker verifies Supabase's ES256
   signature through its public JWKS endpoint and needs no Supabase API key.
7. Apply `cloudflare/ezkart-api/migrations/0001_core.sql` to test and confirm
   the deployed test Worker's `/health` endpoint reports all bindings and 16
   tables. The workbranch uses `workers.dev` while Hostinger manages the
   `ezkart.id` DNS zone; do not move production nameservers just to add a test
   Worker hostname.
8. Connect the test frontend and run seller-isolation, catalog, builder, upload,
   checkout, callback, subscription, digital-access, review, and shipping tests.
9. After approval, merge the application change into `main`, apply the same D1
   migration to production, and deploy the production Worker.

## Data placement

- Supabase Auth: sign-in method, canonical user ID, and active Auth session.
- D1 `app_users`: safe profile fields needed by Ezkart.
- D1 seller tables: all structured records and R2 object keys.
- Public R2 binding: product images, page assets, and published HTML. The bucket
  may remain private while the Worker serves approved objects.
- Private R2 binding: paid downloads and exports. Access is customer-bound and
  temporary.

Orders and reviews belong in D1, not R2. A landing-page definition and publish
state belong in D1; the generated HTML and images belong in R2.

## Current boundary

The Worker scaffold, D1 migration, environment bindings, health endpoint, and
authenticated `/v1/me` profile sync are prepared on the workbranch. The current
prototype UI still saves custom catalog and landing-page drafts in browser
storage, while sandbox checkout still writes private JSON order files. Those
paths must move behind Worker routes before they become production-authoritative.
