# Private digital product files

Workbench implementation, 27 September 2026. This is the catalog storage layer.
The subsequent [digital commerce API](digital-commerce.md) implements immutable
purchases, payment-bound access and verified-download evidence; its customer
screens, hosted acceptance, refunds and subscription billing remain unfinished.
Uploading a file does not
make a sale, grant a customer access, mark delivery or release wallet earnings.

## Merchant workflow

The product editor accepts one private file shared by all variants. Select a file
up to 500 MiB, watch verification/upload progress, pause, resume, or discard the
unpublished upload. After a reload, select the same file: every part is verified
against the original manifest before the browser resumes missing parts. A changed
file cannot replace bytes in an existing upload. The browser saves the upload reference before the first request; product drafts
also retain it. Publishing first saves the current digital draft, so another
store editor can recover the same file and product identity.
An ambiguous result keeps that reference and can be retried. A failed discard
also retains its original intent until the server confirms deletion.

Publish after the complete file is verified. Its real filename replaces the old
free-text placeholder. Every replacement creates an immutable file version;
saving other product details retains the current version. The editor displays
published versions, timestamps and store member names, with private downloads.
Copies reference the same immutable file without duplicating its bytes. Existing
filename-only products are not silently treated as uploaded files; an actual file
is required for their next digital publication or copy.

An initial upload can resume for 24 hours. A completed, unpublished file is kept
for seven days. Published file versions currently remain retained, including
after catalog deletion. They cannot be cancelled or cleaned up. This preserves
the historical file identities needed by the upcoming purchase-entitlement
implementation. Automatic deletion of obsolete published versions is not enabled.
Ten uploads may be in progress per store; initiation is bounded to twenty per
hour and one hundred per day. Exact retries do not consume another initiation.
These are technical upload limits, not a new priced storage allowance.

## Storage and authorization

Migration `0042_digital_product_files.sql` adds four tables and eighteen indexes/
triggers. No existing schema object or application record is rewritten. The
existing `entitlements` scaffold does not authorize access to these files.

Files use only `PRIVATE_ASSETS`. Five-MiB multipart chunks are bounded on actual
received bytes and checked against an immutable ordered SHA-256 manifest. The
manifest is a checksum per part, not a claim of one whole-file SHA-256. The server
owns multipart identifiers, object keys and completion ETags; clients receive
none of them. Every uploaded part and merchant completion/cancellation records its store member.

Concurrent initiation selects one multipart upload in D1 and aborts known losers.
An uncertain D1 result never aborts a possibly committed winner. An invocation
lost before recording a multipart identifier can leave an empty orphan upload;
R2's default incomplete-multipart lifecycle removes it after seven days. This
default is verified on `ezkart-test-private` and must remain configured unless
a replacement cleanup policy is validated.
An interrupted completion recovers the object using its unique key, expected size
and original metadata. Cancellation first fences further publication in D1, then
aborts the multipart upload and deletes the object. Storage errors leave a durable
deleting state for retry. Cleanup processes at most five expired/unlinked uploads
per hourly maintenance invocation; aggregate cleanup capacity and retention costs
remain part of operational acceptance.

Current store membership is checked before and after storage awaits. Transaction
guards prevent publishing a cancelled/expired/foreign file, preserve immutable
versions, and reject identified catalog changes after a merchant loses editing
access. A lost initial digital product publication keeps a deterministic product
identity: retry cannot create another product, and a conflicting saved result
links to the latest product for review.

The PHP proxy validates the current account, store, CSRF token, exact route and
method. It buffers at most one upload part and spools downloads to a private
temporary file, checking the session again before sending bytes. Native browser
downloads do not assemble a 500-MiB browser Blob. Their narrowly scoped form path
also accepts same-origin iframe-navigation metadata when the dashboard's
`no-referrer` policy causes an `Origin: null` request; the account/store/CSRF
checks still apply. Failed HEAD requests preserve their access/error status.

Downloads are attachments with UTF-8 filenames, `application/octet-stream`,
`nosniff`, `private, no-store` and `default-src 'none'; sandbox allow-downloads`.
Scripts and same-origin sandbox access remain disabled. Single byte ranges and
HEAD work through the authenticated API. No public bearer download URL is issued.
The Hostinger response-policy bridge preserves the selected attachment policy.

Storage follows Cloudflare's [multipart API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/#r2multipartupload-definition)
and [part-size/lifecycle contract](https://developers.cloudflare.com/r2/objects/upload-objects/#multipart-upload-details).
The narrowly permitted download sandbox flag is defined in the
[HTML sandboxing rules](https://html.spec.whatwg.org/multipage/browsers.html#sandboxing).

## Verification and remaining acceptance

Eight real D1/R2 storage cases cover binary/multipart integrity, concurrency,
immutable versions/copies, stale catalog rollback, role revocation during storage,
completion versus cancellation, ambiguous responses, exact request recovery,
expiration, cleanup, limits, private ranges and safe headers. Both Advanced plan
cases pass with an actual uploaded digital fixture. Existing physical order and
publication regressions pass. Five PHP/browser cases cover publication, native
downloads, reload/resume, wrong-file rejection, lost discard responses, changed
sign-ins, strict proxy routes, unavailable/corrupt recovery storage, and a lost
first publication resumed by another store editor. Thirteen existing checkout
and order-read proxy cases also pass. The two
merchant security-policy cases pass. Desktop and 390px layouts are visually
checked. Twelve builder cases pass; the remaining flow-grid case passes on a
focused rerun after a transient missing-cell failure in the concurrent run.

The fresh private TEST export is 655,349 bytes, SHA-256
`8aac26501fe6d7c26b293bbd49705a29b2b660673a434533418221ea2bafff1b`.
Restoration preserves every record in all 130 existing physical tables, passes
integrity and foreign-key checks, adds exactly 22 objects and changes no existing
object. All 150 captured compatibility statements compile against the restored
database. The TEST Worker dry-run passes.

Implementation `4606eef` is pushed and hosted on workbench. TEST migration 0042
and Worker `d54f902b-bc88-48b2-b539-41215822fdbb` are installed. Fifty-eight Worker
checks pass at 00:54:34 UTC on 27 September; twelve hosted asset hashes match at
00:55:07 UTC, and thirty-five hosted access/header checks pass at 00:55:09 UTC.
Final remote verification preserves existing counts/settings/legacy evidence,
confirms the restored schema and all 150 query plans, and finds no pending
migration or foreign-key error. All four new tables remain empty: hosted checks
created no uploaded file, product, order or payment. Shared Chrome is still disconnected; no new reconnect was attempted.
Signed-in hosted uploads/downloads, maximum-size real-network transfers, storage
capacity and cleanup monitoring remain unverified. Central commerce, provider
send/payment holds and the production release hold remain unchanged. All thirteen
top-level completion gates remain open.
