# Seller and Executive separation

Owner correction, 28 September 2026. Seller admin contains store tools only.
Native Executive Operations (`https://admin.ezkart.id/#operations`) now owns
Jev page moderation, platform refund review/support and Ezkart company treasury.
The seller's own refund requests and Wallet remain seller tools.

Old internal page bookmarks redirect to fixed Executive destinations, preserving
valid case/intent references. Internal seller-shell API routes return 410;
ordinary seller `?page=jev` bookmarks continue to open seller Alerts.

## Operator connection

Executive's approved device signs each API call. Its server signs the fixed
workbench operations bridge using the existing private HMAC configuration.
Connect operator account creates a short-lived, single-use authorization link.
The authenticated workbench account explicitly confirms that link with CSRF
protection; staff permission is required. Only its access token is delegated,
never its refresh token, and it stays outside both web roots. The connection is
bound to the Executive session, expires after eight hours and requires reconnect
when the original access token expires. Fresh authenticator verification is
available in Executive; it cannot grant a role. Operator roles, treasury allowlist,
original financial receipts and provider execution switches still apply.

Paths and methods are allowlisted. Expected account checks reject stale UI writes.
Private results recheck both staff permission and the Executive connection before
release, including evidence downloads. Browser storage holds original request
keys for recovery, not access tokens or bank packets. The bridge always targets
workbench; the analytics environment selector cannot select production execution.

## Onboarding reminder

An owner-only top-bar reminder links to seller onboarding until all saved
requirements pass the existing readiness view. A scoped notification endpoint
returns only owner/completion flags, never personal details. It updates after
setup saves, tab activation and every 45 seconds. MFA returns directly to setup.
The sidebar promo gradient is unchanged.

## Verification

The workbench checkout tests for Jev, refund disputes/processing and treasury
now exercise the adjacent `Ezkart-Executive-Dashboard` checkout through its
approved-device fixture and the actual signed PHP bridge/Worker. Fixtures use
isolated accounts and databases, stub external providers and make no real payment
or model calls. They cover original-request recovery, actor mismatch, stale MFA,
revocation, private evidence, closed seller endpoints and 390/1360px layouts.
Onboarding API tests cover owner/non-owner isolation and readiness transitions;
merchant onboarding UI verifies the toast disappears only on completion.
Executive `tools/operations.test.mjs` and `tools/access.test.mjs` cover the signed
connection, isolated sessions, native workspaces and browser approval boundaries.

## Hosted acceptance — 28 September 2026

Workbench commit `63977bb` and Executive `96e8e33` / `bea3647` were pushed to
their configured branches and observed on their separate hosts. Beta Worker
version `1e028ada-8cc2-41c6-a72c-9774fb38206b` supplies the completion endpoint.
The existing signed-in seller shows no onboarding or internal-operation sidebar
entries and has a visible setup reminder at desktop and 390px, with no horizontal
overflow. Its MFA screen now names and returns to seller setup. Completion and
reminder removal were verified in the isolated merchant workflow, without changing
the real seller's legal or bank details.

The approved Executive browser completed the real operator connection and loaded
the saved moderation queue and native refund workspace. The company treasury
workspace preserved the existing operator-access denial for that account; no role
was granted and no authenticator, financial dispatch or model run was performed.
All targeted API, approved-browser, onboarding and migrated workflow checks pass,
including treasury lost-response recovery and responsive refund processing.
