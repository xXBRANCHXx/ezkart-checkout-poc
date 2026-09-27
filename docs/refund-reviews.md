# Ezkart refund reviews

Workbench implementation, 28 September 2026. Buyers and store editors can ask
Ezkart to review an existing requested, approved or declined refund. A review
preserves the original request, item/shipping amounts, store decision and
supporting files. It does not execute a refund, mark payment returned, change
stock or revoke digital access.

## Buyer, store and reviewer workflow

The buyer's tracking-page refund section and the merchant Refunds workspace
offer **Request Ezkart review**. One case belongs to each refund. Its opening
explanation and every later message/action are retained. Both parties can add
information and original supporting files. Messages and files are private to
the purchase's buyer, store and authorized Ezkart reviewers.

Authorized reviewers use **Ezkart reviews** in the workbench sidebar. The queue
shows open cases, cases awaiting either party, closed cases and all cases. It
includes the original store and purchase reference. Reviewers can request
information, reply, approve or decline the original requested amount, or reopen
a closed case. Approval records a decision; the screen and notification make
clear that payment is not confirmed. No smaller amount is silently substituted.

While open, a review prevents a competing ordinary store decision or withdrawal
of the refund. The person who opened the review can withdraw that review; the
original refund state still applies. A reply from the requested party returns
an awaiting-information case to open. Closed cases retain their history. Only
a reviewer can reopen one; both parties retain their original evidence uploads.

The latest fifty actions load with the case, with earlier history available in
bounded pages. Each account may submit thirty new actions per case per hour.
Exact retries retain the original action and do not consume another slot.

## Access and verification

Store membership, email matching and browser flags grant no platform review
authority. An append-only D1 permission registry records each explicit reviewer,
read-only viewer or revocation. The latest entry applies in the original
environment. Only an authenticated private service can provision an existing
verified Ezkart account. The workbench-only CLI is:

```sh
php tools/commerce/support-access.php --deployment=beta < /private/review-access.json
```

The private JSON contains `environment` (`production` for beta), `authUserId`,
`role` (`reviewer`, `viewer` or `revoked`), a stable 32-character hexadecimal
`requestKey`, and audit `operator`/`reason`. Save that original request outside
the public root. After a lost response, retry that exact file; the receipt
reports both the recorded role and the current role. The CLI refuses main or
a mismatched configured deployment. This is an access operation, not a payout
or refund authority.

The Worker verifies the Supabase ES256 signature before using its `aal`, `amr`
and expiry claims. Reading cases requires AAL2; changes require a signed TOTP
verification from the preceding ten minutes and a current reviewer role.
The [Supabase JWT reference](https://supabase.com/docs/guides/auth/jwt-fields)
defines these signed assurance fields. Writes recheck permission and proof
expiry in the same database transaction. The operator page can refresh its
authenticator verification without losing its original case or saved retry.
There is no email-code fallback for this role.

PHP also binds responses to the same account and session, checks CSRF for
writes, and withholds private file bytes when sign-in changes. Native form
verification accepts an opaque Origin from the admin's no-referrer policy only
with same-origin browser fetch metadata and the original session CSRF token.

## Financial holds and atomic history

An open review reserves the original item and shipping allocation even when
the store previously declined the refund. New refunds and reopened reviews
cannot claim the same original amount twice. Opening or changing a case also
reconciles the order's earnings in the same transaction; unsettled, undelivered,
negative or otherwise held funds cannot become spendable through a review.

Review decisions require the current case, refund, order and evidence versions.
The projection preserves original store actions and adds the review decision
separately. Approval updates the refund before closing the review hold, so there
is no intermediate release of available earnings. Closing a declined review
releases only this hold, subject to every other financial prerequisite.

Migration 0064 adds three append-only tables, current-permission and earnings
views, and guarded projections. Without a review, existing earnings source JSON
is unchanged. Original rows, financial entries and historical notifications are
preserved. Replacement writes, direct edits and deletion are rejected.

## Notifications and operations

Each original opening/action creates one durable purchase-bound source job.
Existing **Returns and refunds** inbox/email choices apply to buyer and store.
Delivery checks the exact original action, environment, purchase and lease.
Alerts link to the authorized refund; private messages and files stay out of
their body. Automatic email delivery remains separately held in beta.

The read-only operations report counts open cases and cases awaiting each
party. An open case unchanged for 48 hours produces `refund_reviews_stale`.
This is an inspection threshold, not a promise of a response deadline or proof
that an external alert has been delivered.

## Verification limits

API and browser coverage includes original decision retention, concurrent
decisions, allocation/earnings holds, changed evidence, roles and revocation,
authenticator expiry/refresh, lost responses, private files, paged history,
writer limits, source notifications, migration preservation and desktop/mobile
layouts. Local paid orders and provider behavior are isolated fixtures.

All 62 affected Worker cases and 22 PHP/browser cases pass, including eight new
Worker cases and four new integrated review/access cases. Desktop 1360px and
phone 390px layouts are inspected; phone actions remain readable. The private
pre-0064 beta export restores 173 tables with clean integrity and foreign keys.
Its migration rehearsal preserves every original row and both earnings views,
adding only three empty tables. A separate populated paid-refund fixture also
preserves original decisions and financial history. Worker dry-run and affected
PHP/JavaScript syntax checks pass.

Actual paid-purchase acceptance, funded/provider-supported refund execution,
unknown-outcome recovery, confirmed refund receipts, proportional commission
reversal, actual fee custody, entitlement changes and negative-balance recovery
remain separate work. Main and final release remain held.
