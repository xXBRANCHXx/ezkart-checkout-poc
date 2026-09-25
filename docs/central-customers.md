# Central customer workspace

The Customers directory uses D1 when the PHP central flag is enabled. Signed-in
TEST merchants can inspect it at `?page=customers&customer-preview=1` without
switching checkout. Profile, note/tag, segment and export controls are real
operations. Central failures remain explicit and never load legacy order files.
The existing published review summary remains accessible through the Reviews
tab; review submission/moderation and buyer consent collection are still open
work under the full completion plan.

## Identity and customer calculations

Customer IDs come from checkout's existing seller/email identity. Repeated
normalized emails retain the same customer ID. The directory joins only the
authenticated seller's version-1 orders in the deployment's commerce environment.
Latest names, emails, phones and delivery locations come from saved orders in
that scope, not from mutable master contacts that another environment may have
updated. An email identity is not proof of a unique person or a verified contact.
Buyer auth IDs and address coordinates are excluded from these responses.

Primary verified captures determine customer value; paid labels alone contribute
no verified money. Refunded orders keep their gross captures and additional
payments remain separate. Repeat buyers require at least two verified paid
orders. Average customer value includes all known customers and is not a forecast
of future lifetime value. Markets count nonempty latest delivery locations.
Unassigned central orders are counted separately and are explicitly excluded
from customer totals. No visit, discovery or marketing metric is fabricated.

All monetary sums are integer decimal strings. The API rounds averages using
BigInt, and the UI/CSV preserve amounts above JavaScript's safe integer range.
Profiles and their first purchase-history page share a D1 batch and insertion
frontier. Subsequent purchase pages preserve that frontier, excluding later
backdated inserts. Existing payment states remain current.

No consent is inferred from a checkout, a customer master JSON field, or an
authenticated buyer account. Profiles and exports currently say marketing
consent is not recorded. Merchant edits cannot change buyer contact details or
mark a customer as opted in. A buyer-authorized consent workflow, withdrawal
history and enforcement in campaign delivery remain required before marketing.

## Directory, profiles and saved groups

`GET /v1/commerce/customers` accepts `q`, `activity`, `minSpend`, `minOrders`,
`maxOrders`, `lastFrom`, `lastTo`, `location`, `tag`, `limit` and `cursor`.
Query/criteria values are strings, including integer filters. Numeric filters
reject fractions, negatives and overflow. Dates are inclusive Asia/Jakarta
boundaries applied to each profile's last order; values still cover the complete
customer history. Activity is all/high_value/one_order/repeat/no_paid. High value
means at least Rp150,000 in primary verified captures. Tag matching uses canonical
lowercase NFC tags. Search covers saved names, email, phone and customer ID.

The UI pages 25 profiles; API pages are bounded at 50. New customer/order inserts
are excluded across Next, Previous and reload until refresh. Live payments and
metadata can change filter membership. Summary cards/group counts cover all
profiles in that frontier, independent of directory filters. A scoped 24-hour
list reference is returned for exports. It is not an authorization credential;
all operations independently authenticate the seller and environment.

`GET /v1/commerce/customers/:customer` provides current scoped contact/address
details, exact values, first/last order times, merchant metadata and the first 20
orders. `/orders` and `/changes` support bounded cursor history. Foreign profiles
return 404. Viewer memberships can read profiles and export their authorized
directory, but cannot change notes, tags or segments.

`PUT /v1/commerce/customers/:customer/profile` accepts `revision`, `requestKey`,
`note` and `tags`. Notes are limited to 2,000 characters and tags to 10 names of
32 characters. Notes are private to the store team. Revision conflicts preserve
the browser draft. Explicit reload retains the draft and shows the current saved
version for comparison before saving again. In-memory drafts survive switching
profiles in that tab; browser navigation warns while they are unsaved. They are
not written into browser local storage. Reloading/dismissing that warning can
discard the draft; saved records and their complete history remain durable.

`GET/POST /v1/commerce/customers/segments` lists/creates segments;
`GET/PUT /segments/:id` reads/updates one. Segments persist a name and validated
directory criteria, not a frozen audience. Members change with customer data.
The active/archived lists are paginated. Archive and restore are reversible,
revision-checked changes; there is an atomic limit of 50 active segments.
The UI can save applied directory filters, view members, rename, archive and
restore groups. To update criteria, apply the new directory filters and choose
Use directory filters in the segment editor before saving. The name and criteria
are a single revision-checked change. No campaign or outgoing message is created
by these operations.

Migration 0020 adds profile/segment projections, immutable change receipts and
customer export storage. Note/segment saves require a 32-hex request key and an
expected revision. Receipts and projections commit together. Reusing the key
with the same intent recovers a lost response; a changed intent conflicts.
Database guards recheck current seller membership inside the write transaction,
validate profile scope, enforce revisions and segment capacity, and forbid direct
projection changes or audit deletion. The UI rejects stale list/detail/segment
responses and keeps drafts after failures. Metadata setup does not require
central checkout activation; provider/stock/financial operations are unaffected.

## Complete private customer exports

`POST /v1/commerce/customers/exports` accepts a request key, validated directory
filters and the scoped list reference. Admission, complete materialization and
the ready receipt commit in one D1 transaction. The snapshot freezes all matching
profiles when created, not just the visible page. Retry recovers the same export.
New snapshots are limited to 10 per seller/environment/hour; retries are exempt.

`GET /exports/:id?after=0&limit=500` downloads bounded rows, maximum 1,000 per
response. Foreign exports return 404; expired owned exports return 410. Private
snapshots expire after 24 hours. The existing hourly maintenance also deletes up
to 5,000 expired customer rows and 100 emptied receipts per run. Retention backlog
and representative capacity still need operational acceptance.

CSV includes customer ID/contact, latest location, order counts, exact primary
and additional values, first/last order times, tags and consent status. Private
notes, buyer auth IDs, provider credentials and address coordinates are excluded.
The browser checks snapshot identity, total count and contiguous ordinals before
saving a complete file. Lost receipts and failed chunks can be retried without
creating duplicates. Changing the directory while a download is pending prevents
the old view from downloading. Formula-like values (including Unicode/invisible
prefixes), commas, quotes and line breaks receive the same CSV defenses as the
analytics exports. Snapshot assembly uses browser memory proportional to the file.

## Acceptance and remaining work

Eight D1 cases cover seller/environment/version isolation, normalization and
scoped contacts, 241-profile paging, dates and filters, exact money, primary versus
additional captures, repeat buyers, backdated history frontiers, replay/conflict,
transactional membership checks, immutable audit/projections, concurrent segment
capacity, archive/restore, export concurrency/immutability/rate limits, rollback
and expiry cleanup. Twelve adjacent order/payment API cases pass.

Seven PHP/browser cases cover desktop/mobile profiles, real saves, persisted
segments and paging, archive/restore, failed pages, complete chunked exports,
formula-like names, lost receipts, two-tab conflicts and retained drafts, preview
isolation, proxy CSRF and viewer permissions, stale replies, cancellation of an
old download, and exact large amounts in cards, profiles and CSV. The 14 adjacent
central order/payment/dashboard/analytics browser cases pass. Screenshots are
inspected. These are correctness checks, not production-volume benchmarks.

Signed-in hosted acceptance remains pending shared Chrome initialization. The
central flags and production release hold remain unchanged. This stage does not
close the full customer acceptance item: buyer consent, review workflows,
messaging/marketing use, operational legacy promotion and hosted acceptance still
need completion. Full workbench requirements remain in
[commerce-completion-plan.md](commerce-completion-plan.md).
