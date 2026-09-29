# Saved bank changes require human review

Owner decision, 29 September 2026: once banking information exists, replacing it must be a deliberate process reviewed by a human before it becomes the payment destination.

Initial bank setup still uses the protected onboarding bank form. Every subsequent bank save, including a new store owner's replacement, creates an immutable pending request. It requires fresh bank verification, the current bank revision and a 20–500 character reason. Only one undecided request can exist per store. Exact retries recover the original request; conflicting retries are rejected.

The current bank remains active while review is pending or rejected. No provider call or money transfer is made by the request or review. Approved changes append a bank revision atomically with the review decision. Existing withdrawal records keep their original destinations; the existing send guards continue to block unsent requests whose saved-bank revision has become stale.

Executive Operations → Bank changes provides the staff queue and private detail view. An environment-authorized reviewer with fresh authenticator verification must confirm both established-contact verification and bank ownership, enter a private verification-case reference and record review notes. The requester and any store member cannot decide the request. Viewer accounts cannot decide requests. These confirmations record a human's checks, not automated identity or bank verification; evidence remains in the private support case. Staff must complete those checks before approving. No automated reviewer or timed approval exists.

Migration 0082 adds immutable request/decision records and database guards. Any direct insertion replacing a bank without a matching approved request fails. A changed owner, expired proof or stale bank revision causes the approval transaction to roll back. Request and decision evidence cannot be updated or deleted through the application schema. Queue summaries show account suffixes; complete proposed account numbers are restricted to authenticated staff detail views. Ordinary profile/address requests redact bank change details.

Validation: API/security tests cover direct-write bypass, original-bank retention, independent review, viewer restrictions, expired MFA, explicit verification checks, approval/rejection, exact retries, immutable decisions and stale ownership rollback. Browser fixtures cover seller submission and staff approval at desktop and phone widths. All use synthetic accounts without financial provider calls.

Deliver to workbench/beta and the separate Executive Dashboard only; the main storefront release hold remains in effect.
