# Customer order tracking

The payment page links to `/cart/return.php?order=…&shop=…` after verified payment. Existing hosted-payment return links continue to use the same page. Customers can bookmark the order link and follow payment, seller acceptance/preparation, pickup arrangement, actual courier collection, transit, delivery, and exceptions.

Booking a shipment or receiving a waybill never marks it as picked up. A sandbox payment that skipped shipping shows a completed test payment and no shipping progress or map. Payment polling stays local and no longer toggles the button's disabled state; manual checks have an accessible busy state and can join an existing background request.

## Customer Google sign-in

Tracking pages and the sandbox walkthrough require Google login through the existing Supabase project. `/cart/login.php` starts a CSRF-protected S256 PKCE flow; `/cart/admin/customer-auth.php` reuses the existing `/cart/admin/**` callback allowlist. It has a separate `ezkart_customer` HTTP-only, SameSite=Lax cookie scoped to `/cart`, with private session storage configured by `customer_session_storage`. It never grants merchant/admin access. Supabase `/user` verifies the Google identity and confirmed email. Existing verified TOTP factors must be completed before access; tokens refresh server-side and never enter page HTML or browser-readable storage.

Signed-in checkout records the immutable Supabase user ID on the order. Guest checkout remains available; the first tracking visit can claim an order only when the verified account email matches the checkout email. The server persists that immutable user ID under the order lock. Subsequent access follows the ID, so another account cannot claim an already-linked order through an email match. Wrong-account and nonexistent references return the same 404 response. Unsigned tracking requests return 401 before reading an order or contacting Biteship. Page login preserves the validated order/shop link and prevents external redirect targets.

## Provider data

Tracking requests use `GET /cart/api/status.php?order=…&tracking=1`. The server calls Biteship's [Retrieve an Order](https://biteship.com/en/docs/api/orders/retrieve) endpoint, which includes courier history, tracking link and nullable origin/destination coordinates. Credentials are selected from the stored order environment. It never creates a shipment or changes payment status.

A two-minute cache shared by all viewers limits provider calls, including failed requests. Network calls happen outside the order lock. A webhook arriving while the provider read is in progress takes precedence over that response. Provider outages preserve the last confirmed status and display a retry notice. Authenticated `order.status` callbacks update the local timeline between provider reads; price and waybill callbacks cannot reset shipment status. Snake-case and camel-case [Biteship status values](https://biteship.com/en/docs/api/trackings/status) are supported. Duplicate and delayed notifications cannot reverse completed delivery/return milestones.

The authenticated customer projection includes delivery status, bounded timestamped history, courier/service, waybill, HTTPS tracking link, and validated delivery coordinates. Provider keys, full provider responses, addresses and driver contact details are not added to the public API. The public payment poll omits all shipment fields. Shipment access requires both the order reference and an authenticated customer who owns the order. External links omit referrers; map tiles send only the site origin, never the order query.

## Maps and live tracking

The primary card shows the latest courier update and a timestamp. When a scan explicitly supplies valid coordinates, the Leaflet map centers on that last reported package location with one Ezkart-orange parcel marker. The timestamp remains visible; this is not labeled a continuous GPS feed. A confirmed pickup or delivery may use the known origin/destination with a “Confirmed by the courier” label. Merely booking a shipment never establishes a package position.

Without a reported location, the card explains that the courier has not shared one and retains the scan timeline. A secondary “View pickup & delivery” action offers a two-pin overview when both coordinates exist. It never interpolates a package position or geocodes a location from scan text. Maps initialize only when scrolled into view; map failures leave the timeline usable. Provider labels and notes render as plain text, including Leaflet tooltips.

Biteship's [instant courier guide](https://help.biteship.com/hc/en-us/articles/58381493064985-How-to-Track-Instant-Couriers-in-Real-Time) instructs API clients to open `courier.link` for the live map. Instant services get a “View courier live tracking” link when the provider supplies it. Other services get “View courier tracking.” A raw driver GPS feed is not documented by these endpoints, so the live map opens in the courier's tracking page. Regular courier scan notes remain in the timeline without geocoding guesses. Scan-level coordinates are accepted defensively when explicitly returned, but are not guaranteed or documented in the standard order response; the sandbox location is a clearly labeled fixture.

Leaflet 1.9.4 is vendored under `cart/vendor/leaflet` with its BSD license. The scripts/styles match the SHA-256 hashes published on the [Leaflet download page](https://leafletjs.com/download.html). OpenStreetMap tiles use the standard browser cache and visible attribution, following its [tile policy](https://operations.osmfoundation.org/policies/tiles/). Public OSM tile availability is best-effort; reassess the tile provider before scaling production traffic.

## Verification (21 September 2026)

`PHP_BINARY=php node --test tools/checkout-test/checkout.test.mjs`

The provider transport uses fixtures and cannot contact payment or shipping providers. Coverage includes the existing checkout/payment/merchant flows plus seller-to-courier progression, provider throttling and outages, wrong-order payloads, invalid links/coordinates, webhook retries/status aliases/returns, and an in-flight automatic payment check joined by a manual click. Browser checks cover 1280px and 390px widths, a centered package marker, optional route view and recentering, absent coordinates, safe timeline/tooltips, delivery confirmation, request errors and horizontal overflow. Authentication checks cover CSRF, PKCE, one-use callbacks, verified Google identities, ownership and guest claims, immutable account binding, MFA, refresh failures, logout, and shipment redaction from the public payment poll. Map tiles are stubbed in automated tests.

These checks do not establish live courier GPS availability or production provider acceptance. Work remains on `agent/ezkart-workbench`; the existing production release hold applies.

## Interactive sandbox walkthrough

Open `/cart/tracking-sandbox.php?stage=transit` on `test.ezkart.id` and sign in with Google. It renders the same customer page using sample orders projected through `ez_public_order_tracking`, without creating orders, modifying cart storage, calling payment/shipping providers, or writing payment/shipment state. The page is available only when deployment is `test` and commerce mode is `sandbox`; production returns 404.

Choose a stage, advance one step, or run the eight-stage walkthrough at five-second intervals. It pauses when the tab is hidden and stops at delivery. Additional scenarios cover delays, cancellation, returns, provider unavailability, and absent coordinates. A `stage` query parameter preserves the selected view for sharing. The persistent banner identifies all order/map data as simulated. This is a UI walkthrough, not evidence of a completed DOKU/Biteship sandbox transaction.
