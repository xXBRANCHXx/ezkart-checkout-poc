# Message origins and browser notifications

Seller Messages displays the retained landing-page name, configured tracking
source and campaign name. These labels come from the seller's saved records,
never browser-supplied platform names, UTM strings or referrer claims. A valid
24-hour opaque `tracking_visit` must belong to the same seller and deployment
environment, and its campaign must still be active when the origin is attached.
The source is the seller's free-text source name (for example Facebook), not
proof that a human viewed an ad on that platform. Campaign page names retain the
campaign's original saved snapshot. For ordinary links, the page reference must
resolve to that seller's currently published R2 page; platform and campaign stay
empty. Unknown sources show “Source not recorded.”

The first verified origin is retained separately from the expiring tracking visit
and remains visible after reload and subsequent replies. Existing conversations
gain an origin on their first verified landing contact, but later contact links
cannot replace it. Contact links on PHP and direct Worker hosted pages carry only
the page ID and opaque visit token. Authored content retains its opaque iframe
isolation. No tracking token or origin name enters push payloads.

## Setup (not performed by this change)

1. Apply `0084_message_origin_push.sql` to the intended Workbench D1 database
   before deploying this API version. It adds origin snapshots, customer browser
   subscriptions and durable push-delivery receipts.
2. Configure an owner-approved VAPID P-256 key pair. Set
   `WEB_PUSH_VAPID_PUBLIC_KEY` to the base64url uncompressed 65-byte public point;
   set the Worker secret `WEB_PUSH_VAPID_PRIVATE_KEY` to the base64url 32-byte
   private scalar. Set `WEB_PUSH_VAPID_SUBJECT` to an owner-controlled `mailto:`
   contact or HTTPS contact URL. Never place the private key in PHP, HTML, logs,
   repository files or browser configuration. This task creates no persistent
   keys and activates no provider account.
3. Set `CUSTOMER_WEB_PUSH=enabled` only after keys are configured and activation
   is approved. Existing holds remain required: `COMMERCE_STORAGE=d1` and
   `COMMERCE_NOTIFICATIONS=enabled` (or existing beta `scheduled` mode).
4. Deploy the API and customer/PHP/static files to Workbench. The existing
   notifications minute cron processes the queue after creating ordinary message
   notifications; the existing beta scheduled notifications handler does the
   same. No additional cron or paid notification service is required.
5. Verify opt-in on an HTTPS customer Messages page using an approved test account
   and device. This local task sends only fixture pushes; it does not establish
   live delivery or enable browser permissions on a user's device.

Absent setup, the customer sees “Browser notifications are not configured yet.”
Browser permission is requested only by clicking Enable notifications. Supported
Push API browsers receive notifications even when Messages is closed. iPhone and
iPad require a Home Screen web app with browser push support. The UI explains
blocked permission and unsupported browsers; it never substitutes email.

## Authorization and delivery

Subscriptions use the existing verified customer session, CSRF, origin and
late-account-change checks. At most ten active browser subscriptions belong to
one account/environment. Only the authenticated owner can read subscription
status or revoke it. Confirming the same subscription preserves opt-in time;
re-enabling, key changes or transferring a shared browser to another account
creates a new generation. Old-generation deliveries cannot send to that new
account. VAPID rotation is repaired only after an explicit Enable click.

Only future store-message notification receipts are eligible, for active stores
and the conversation's permanent buyer. There is no historical backfill. Sends
recheck ownership and active opt-in, use atomic delivery leases and at most three
attempts, and revoke endpoints returning 404/410. An uncertain transport can
retry the same generic notification tag, so a browser replaces its display
rather than accumulating duplicate alerts. A 201/2xx receipt means the push
service accepted a message, not that a device displayed it. Delivery may be
delayed by the platform or device. Revocation cannot recall an already accepted
push.

Payloads contain only a generic reply notice, immutable notification tag and
same-origin conversation link. No private message text, buyer name, attachment,
cookie or authentication token is sent to a push provider. The service worker
does not cache pages, intercept requests or bypass sign-in. Notification clicks
allow only the same-origin customer Messages route with a valid conversation ID.
The API reauthorizes access when that page opens. Provider endpoints are fixed to
the browser push services for Chrome, Firefox, Safari and Windows, preventing
customer-supplied internal network destinations or arbitrary redirect follows.

Encryption follows [RFC 8291](https://www.rfc-editor.org/rfc/rfc8291);
VAPID signing follows [RFC 8292](https://www.rfc-editor.org/rfc/rfc8292).
