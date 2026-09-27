# Verified seller wallet enrollment

The workbench can save one owner-authorized wallet setup request per store and
environment, dispatch it through DOKU Sub-Account V2, and confirm the resulting
cash and pending account identities. Enrollment creates no financial entries,
settlement, available balance, payment routing or withdrawal capability.

## Merchant flow and authorization

An owner opens Wallet with the existing fresh email or authenticator challenge.
The setup card shows the saved store name and verified owner email, and explains
that connecting shares those details with DOKU. The server uses those verified
values; the browser supplies only a random request key. It cannot choose a seller,
email, provider profile, parent account or account number.

`cart/admin/commerce-wallet.php` handles `?wallet=read|enroll|refresh`. All three
require the active owner's Google session, current store membership, matching
account/store headers, CSRF and the ten-minute factor-bound Wallet grant. Current
provider identity and factors are checked, including after upstream operations.
Session/account/CSRF changes and expired proof suppress late replies, even when
an earlier intent was already committed. The browser keeps the original key and
reads the saved request after an interrupted reply or reload.

Setup states are queued, connecting, connected and needs review. Connected means
that both provider account identities were independently confirmed. Only the last
four cash-account digits reach the merchant. Provider balances never become
withdrawable funds. With central storage enabled, Wallet does not read old local
order files; confirmed payments are available through the central Payments view.
Wallet settlement history still requires reconciliation work.

## Durable registration and recovery

Migration 0024 adds five tables and sixteen guards. Owner intent, dispatch binding,
the original registration receipt, confirmed profile and account links reject
updates, deletion and replacement writes. The intent and provider job commit in
one transaction. Store name and active ownership are checked again inside that
transaction. Profile IDs and account numbers cannot cross store boundaries within
an environment, including cash/pending column substitutions.

The service-only HMAC routes under `/internal/commerce/finance/wallet` implement:

- `POST /wallet`: read or enroll with a verified actor and proof expiry.
- `GET /wallet/registrations/{id}?environment=sandbox`: protected dispatch data.
- `POST /wallet/registrations/{id}/bind`: pin the current provider credentials,
  client, parent profile and live execute attempt before registration.
- `POST /wallet/registrations/{id}/receipt`: save the original successful response
  before the independent confirmation read. Identical retries are idempotent.
- `POST /wallet/registrations/{id}/record`: confirm the saved profile and both IDR
  accounts, atomically recording their unique store links.

`commerce-wallet-jobs.php` validates the original payload and reads the configured
parent before committing the binding. This obtains a usable token and makes
preflight configuration/authentication failures safe to retry with backoff. A
missing private key is checked before claiming a job, so it consumes no attempt.
Original ownership is checked again at dispatch. A different account, parent or
credential fingerprint cannot take over an existing binding.

Once bound, registration is sent at most once by the adapter. Lost bind replies,
provider timeouts, duplicate-reference responses and ambiguous registration bodies
remain uncertain. The adapter never generates a replacement reference or blindly
calls register again. A saved receipt permits a later read-only confirmation even
when the first balance read failed. Late verified evidence can be recorded after
lease expiry; stale workers cannot finish another worker's lease. Job success
requires the confirmed profile, and a bound request cannot enter ordinary retry.

An unknown registration without its original successful receipt still needs
provider-supported investigation. The published V2 guide does not establish a
registration lookup or usable registration webhook contract. No guessed callback,
manual merchant account override, automatic credential reassignment or destructive
reset is provided. Those operator recovery paths remain acceptance work.

## Provider contract and configuration

Checked against the official [V2 integration guide](https://developers.doku.com/wallet-as-a-service/sub-account/sub-account-v2/integration-guide)
on 26 September 2026. Register uses `/sub-account/v2.0/register`, type `DEFAULT`,
country `ID`, a stable partner reference, saved name and verified email. The guide
currently limits email to 25 characters; longer verified addresses are rejected
with an explanation, never truncated or replaced. Register must return a new
profile under the configured parent and exactly one cash and one pending IDR
account, with an optional merchant point account. The subsequent balance inquiry
must identify that exact profile and the same accounts.

Live DOKU balance evidence on 27 September uses numeric account IDs. The adapters
and Worker preserve exact integer tokens as digit strings for comparison while
retaining original response JSON. Fractions, exponents, negatives and IDs longer
than ten digits are rejected. Migration 0049 updates the database evidence guard
without changing existing rows or ownership requirements. Parent preflight now
accepts the observed merchant cash/points shape without requiring a pending
account; seller registration and confirmation still require both IDR accounts.

`cart/api/doku-snap.php` now holds the shared signed transport; the read-only
adapter and registration adapter use its pinned origins, RSA token authentication,
HMAC request signing, TLS checks, response limits and strict financial JSON parser.
The [financial reader](doku-financial-reader.md) still exposes only reads.

Server-private configuration uses `doku_{environment}_client_id`,
`doku_{environment}_secret_key`, `doku_{environment}_snap_private_key` (registered
RSA PEM), and `doku_{environment}_parent_profile_id`. Central commerce must be
enabled in the matching environment. Merely saving ordinary checkout credentials
does not enable this flow. No credentials or activation flags were changed by this
delivery, and no DOKU account was created outside isolated fixtures.

For an authorized, configured environment, install the dispatcher outside the
public web root and invoke it once per scheduler pass:

```sh
php tools/commerce/wallet-dispatch.php --once
```

It claims one job at a time with a 120-second lease, at most five reconciliation
and five execution jobs per pass. Existing backoff and attempt limits apply. It
outputs counts, with exit 2 for uncertain/dead results and exit 1 for a failed
pass, without owner details, provider bodies or credentials. HTTP returns 404.
No scheduler was installed or activated during this work.

## Verification and current limits

Thirteen PHP/Worker/browser checks cover signed registration, account confirmation,
idempotent receipt recovery, unknown provider outcomes, mismatched parents/accounts,
credential changes, preflight failures, owner revocation, protected proxy inputs,
fresh proof and factor checks, late-session changes, lost browser replies, central
storage/provider holds, desktop/mobile reloads and the bounded CLI. Five existing
Wallet verification tests also pass. Screenshots at 1360 and 390 pixels were
visually inspected for wrapping, controls and overflow; the sidebar announcement
gradient is preserved.

Logs are `/tmp/ezkart-wallet-integration-01a0d643.log` and
`/tmp/ezkart-wallet-existing-01a0d643.log`. Browser images are under
`/tmp/ezkart-wallet-enrollment-ui-01a0d643/`. The complete Worker suite passes all
142 tests, including eight adversarial enrollment cases. The affected checkout,
fulfillment, payment, review, signing and financial-reader suites pass 44 more
tests. Together with the thirteen new and five existing Wallet checks, that is
62 PHP/integration/browser checks. PHP syntax, TEST Worker dry build and whitespace
checks pass. Full logs: `/tmp/ezkart-wallet-api-final-01a0d643.log` and
`/tmp/ezkart-wallet-php-final-01a0d643.log`; the final strict-evidence checks also
run in `/tmp/ezkart-wallet-api-focused-01a0d643.log`.

The fresh pre-migration TEST export is
`/tmp/ezkart-wallet-deploy-01a0d643/test-before-0024.sql`, mode 0600, 411,426 bytes,
SHA-256 `0d99823720cbdc2baf0cf179385a707b0f56e396d099690df693b43a4dd537e3`.
Restoring it and applying 0024 in original file order yields SQLite integrity
`ok`, no foreign-key errors, all five empty wallet tables and sixteen guards.
All existing table counts are unchanged.

At the original 26 September delivery, hosted signed-in acceptance was unavailable: the shared Chrome service
remains disconnected after its earlier approved connection timed out. No new
connection or approval loop was attempted. Real provider registration, sandbox
routing, actual fees/settlement, delivery release, reserves, refunds, withdrawals,
reconciliation, operational recovery and sustained financial validation remain
open. This delivery does not close a top-level commerce or production release gate.

On 27 September, the owner-approved production session and private signing key
are available. The merchant parent balance read succeeds with matching identity
at 06:31:01 UTC. Forty-nine affected PHP/Worker cases pass, including a complete
numeric-account registration/confirmation fixture and preservation of existing
registered string accounts through 0049. No real child account was manufactured;
actual seller registration, payment routing and payouts still need acceptance.

### Hosted TEST rollout — 26 September 2026

Implementation `1052e92` is pushed to `agent/ezkart-workbench`. Only migration
0024 was pending and applied to TEST D1. TEST Worker version
`b981177f-ae81-413e-8036-94b2ca6315d3` is deployed; the existing hourly schedule is
unchanged. At 11:21 UTC / 18:21 Jakarta, health reports 67 tables and healthy
D1/public R2/private R2. The five wallet tables remain empty, all sixteen guards
are present, and foreign-key checks report no errors. Operational counts, the
six financial account definitions, zero journals/entries and the 15-entry legacy
import manifest are unchanged.

Hostinger's workbench deployment serves the exact checked JavaScript. An
unauthenticated Wallet read returns 401 with no account data. Direct access to
the private proxy and CLI dispatcher returns empty 404 responses. The internal
wallet route returns the existing central-storage hold (503). No real enrollment,
provider read, balance or money movement was initiated. Private before/after,
deployment and hosted-check artifacts are under
`/tmp/ezkart-wallet-deploy-01a0d643/`.
