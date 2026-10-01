# Scheduled landing-page publication

The Studio and Image Stack editors have a Schedule action. Merchants choose a
future date and time in the displayed browser timezone. The dialog shows the
saved version, the schedule's timezone, and the currently scheduled time.
Scheduling saves the current draft and freezes its generated HTML and purchase
validation preview. Later draft edits stay private. **Change time** retains that
same version; **Schedule this version** explicitly replaces it with the current
draft. **Cancel schedule** leaves both the draft and any existing published page
unchanged. Publishing immediately cancels the pending schedule.

Dates must be at least one minute ahead and within 366 days. The minute Worker
trigger begins processing at or after the chosen time; queues and outages can
delay publication. The dispatcher processes at most three valid due snapshots
per invocation and scans ten ordered index entries to keep work bounded. No new
cron slot, database migration, or external scheduling service is required.

The authoritative schedule is stored with the project. An R2 due-time hint is
written first, so a lost acknowledgement after a project write cannot lose its
queue entry. Replaced, cancelled, deleted, or orphaned hints cannot publish: the
dispatcher checks the project schedule ID. The existing D1 page-write fence and
conditional R2 write serialize publication with draft saves, cancellation,
rescheduling, and moderation. Later private draft state is preserved when the
frozen publication goes live.

Scheduling and due publication both validate current seller-owned active
products, purchase actions, available stock and bank/two-step requirements.
The schedule records referenced products' base and visible variant prices at
confirmation. A changed price or missing verified baseline fails the schedule
visibly instead of publishing an outdated offer; unrelated products and hidden
variant prices do not invalidate it. Changing only the time retains that price
baseline. Merchants review the current catalog and schedule a fresh version.
Moderation holds block due publication. A definite rejection is shown as a
failed schedule, preserving the existing public page. A transient service or
storage error keeps it pending for retry. Merchants review and schedule a fresh
version after a definite failure. Viewers cannot change a schedule.

The browser preserves the exact request before sending it, scoped to account
and page. A lost response checks the saved receipt. Unresolved requests survive
reload and retry with their original request ID; mismatched receipts do not
confirm success. Corrupt or unavailable recovery storage blocks new schedule
writes. No real page was scheduled or published by the development checks.

Deployment requires the frontend changes and the TEST Worker together. The
current TEST configuration already registers the minute trigger. The feature
does not itself authorize a beta/production deployment or a real merchant
schedule.
