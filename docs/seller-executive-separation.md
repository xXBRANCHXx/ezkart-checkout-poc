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
