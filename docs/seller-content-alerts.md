# Seller content alerts

Owner correction, 28 September 2026: Jev is an internal reviewer tool, not a
seller sidebar destination. Seller moderation issues belong in Notifications,
with a separate Alerts detail page and unavailable items visibly grayed out.

The seller `?page=alerts` route and old `?page=jev` bookmarks now show only
store-scoped unresolved alerts. Notifications display persistent warnings and
the bell includes unresolved holds. Landing-page library previews turn gray,
show their original deadline, and link to the reason and resolution page.
Editing remains available. Existing public-page hold enforcement stays active.
No warning is created merely because somebody submitted an unverified report.

The detail page shows the archive reason and evidence, the remaining requests,
and the original five-day countdown. Request re-scan queues the changed saved
revision for an authorized reviewer; it never spends on a model call, approves
a page, or resets the deadline. Three rescans or expiry requires human review.
Original request keys survive lost responses and reloads. Restoration removes
the warning and gray state on the next refresh; ordinary edits do not restore.

This uses the existing landing-page moderation backend. Product moderation has
no equivalent case/hold model yet; ordinary seller-archived products are not
misrepresented as policy violations.

Reviewer controls now live natively in the separate Executive Dashboard's
Operations view, alongside platform refund support and company treasury.
Old staff bookmarks redirect there; seller-shell staff proxy endpoints return
410. The seller `?page=jev` alias still opens seller Alerts. Existing role,
fresh-MFA, treasury allowlist and provider safeguards remain required. See
[seller/Executive separation](seller-executive-separation.md).

Validation: API integration covers store isolation, counts, queued edits,
idempotent retry, unchanged deadlines, no additional model calls, continued
public unavailability, and restored visibility. Browser coverage checks the
notification-to-alert journey, lost-response recovery across reloads, 1360/390
widths, gray library previews, and old bookmarks. Reviewer workspace regression
coverage uses the native Executive workspace and signed operator bridge.
