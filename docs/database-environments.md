# Database environments and safe branch merges

## The simple version

Git stores the database **structure** in `supabase/migrations`. Hostinger stores each website's private **connection details** in its own ignored `config.runtime.php`.

That means a merge copies tables, rules, and application code. It does **not** copy the test database, production data, passwords, API keys, or Hostinger's branch connection.

| Website | Git branch | Database | Runtime value |
| --- | --- | --- | --- |
| `test.ezkart.id` | `agent/ezkart-workbench` | Separate Supabase test branch/project | `deployment_environment = test` |
| `ezkart.id` | `main` | Supabase production project | `deployment_environment = production` |
| `admin.ezkart.id` | Executive Dashboard `main` | Read-only status sources later | No Ezkart commerce credentials in the browser |

## One-time connection checklist

1. Create or identify a **test** Supabase branch/project and a separate **production** project.
2. Apply `supabase/migrations/202608120001_seller_platform.sql` to test first.
3. On `test.ezkart.id`, copy `config.example.php` to the ignored `config.runtime.php` and set the test URL, anon key, and exact test project ref.
4. Open `https://test.ezkart.id/cart/api/health.php`. `database.configured` and `database.connected` must both be `true`, and `database.environment` must be `test`.
5. Run seller isolation, product validation, upload, checkout, callback, subscription, digital-access, and physical-shipping acceptance tests.
6. After approval, merge the workbranch into `main` and apply the same migration to production through Supabase's migration workflow.
7. Configure `ezkart.id/config.runtime.php` with the production URL, key, exact production ref, and `deployment_environment = production`.
8. Open `https://ezkart.id/cart/api/health.php` and confirm the production values.

The runtime guard refuses a mismatched Supabase project ref. It also refuses test database settings on the production hostname and production settings on the test hostname.

## Seller data map

All authoritative commerce records live in one Postgres schema. Every seller-owned table carries `seller_id`. Composite foreign keys include both `seller_id` and the related record ID, preventing a row owned by one seller from referencing another seller's row.

- `sellers` → account root
- `seller_memberships` → which signed-in users can manage it
- `products` → physical, digital, or subscription catalog
- `product_media` → 1–9 images; active physical products require 3–9
- `landing_pages` and `page_versions` → saved builder pages and history
- `customers`, `orders`, and `order_items` → purchases
- `payment_transactions` → verified Midtrans state
- `subscriptions` → recurring Midtrans schedule and state
- `entitlements` → access to paid digital files or benefits
- `shipments` → Biteship delivery for physical purchases only
- `seller_events` → permanent activity history

Row-level security checks signed-in membership. Storage paths begin with `seller_id`; product pictures and page pictures are public buckets, while paid downloads and seller exports are private buckets.

## Product rules enforced by the migration

- Product type is exactly `physical`, `digital`, or `subscription`.
- Weight and stock belong only to physical products.
- A recurring interval belongs only to subscriptions.
- Images are at most 2 MB each and sort positions are limited to 1–9.
- An active physical product needs at least 3 images.
- An active digital product or subscription needs at least 1 image.
- Digital product files use private storage and temporary signed links.

Draft products may remain incomplete while the seller is editing. The stricter image rule is checked when a product becomes active.

## Important current boundary

This migration and connection guard make the database ready and branch-safe. The current prototype UI still saves custom catalog and landing-page drafts in browser storage, and the sandbox checkout still writes private JSON order files. Those code paths must be migrated to authenticated server endpoints before the database becomes the live source of truth.
