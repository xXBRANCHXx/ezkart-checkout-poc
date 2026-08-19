# Ezkart Cloudflare data service

This Worker is the bridge between Ezkart, Supabase Auth, Cloudflare D1, and
Cloudflare R2.

- Supabase authenticates the person and issues the access token.
- The Worker validates that token before reading or writing seller data.
- D1 stores structured, queryable records. It never stores passwords, Google
  tokens, Supabase refresh tokens, or a service-role key.
- R2 stores files. Public and private content use different buckets so a paid
  download cannot become public because of one bucket-level setting.

## One-time setup

1. Create `ezkart_test_database` in D1. Keep the existing
   `ezkart_main_user_database` as production.
2. Create four R2 buckets:
   `ezkart-test-public`, `ezkart-test-private`, `ezkart-production-public`, and
   `ezkart-production-private`. Leave all four private; the Worker will decide
   what may be served.
3. Copy `wrangler.example.jsonc` to `wrangler.jsonc` and replace the test D1
   database ID. The production D1 ID already matches the database shown in the
   Cloudflare dashboard. The Worker verifies ES256 Supabase access tokens
   against Supabase's public JWKS endpoint, so no Supabase API key is stored in
   Cloudflare.
4. Install the local deploy tool with `npm install`.
5. Run `npm run db:migrate:test`, then `npm run deploy:test`.
6. Open the `workers.dev` URL printed by `npm run deploy:test`, followed by
   `/health`. All three checks must be `true` and the table count must be 16
   before connecting the test application. A custom `api-test.ezkart.id`
   hostname can be added later if the domain's DNS is managed by Cloudflare.
7. Only after acceptance testing, run `npm run db:migrate:production` and
   `npm run deploy:production`.

The Google client secret remains only inside the Supabase provider settings.
Never place an R2 secret, Cloudflare API token, Supabase service-role key,
access token, or refresh token in this repository.

## Current endpoints

- `GET /health` checks D1 and both R2 bindings without exposing credentials.
- `GET /v1/me` validates a Supabase bearer token, creates or refreshes the
  corresponding D1 profile, provisions an idempotent personal seller and owner
  membership when the account has none, and returns only that account's safe
  profile and seller memberships.
- `GET /v1/catalog` returns only the active seller's products and drafts.
- `POST /v1/media` validates and stores a seller-scoped product image in R2.
- `GET /v1/media/:id` streams an image only after authenticating its seller.
- `PUT|DELETE /v1/products/:id` stores or removes a seller-scoped product,
  gallery, and variant set in D1.
- `PUT|DELETE /v1/drafts/:id` stores or removes a seller-scoped editor draft.

The Hostinger admin proxies these calls with its server-side Supabase session,
so access and refresh tokens are never placed in page markup or browser storage.
Page, order, review, payment, and download routes still need to move behind the
same token validation and seller-membership checks.
