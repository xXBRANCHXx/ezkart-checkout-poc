# Seller shipping settings

Shipping settings are stored per seller in D1. The merchant workspace is under
Settings → Shipping and linked from Fulfillment. It supports ten named addresses,
separate default pickup and return addresses, confirmed map pins, courier
selection and the ten most recent save records. One pickup location is used for
an order; the address book does not partition inventory between warehouses.

Each address includes the contact name, phone, optional email/organization,
street, city/district, five-digit postcode and courier instructions. The complete
pickup address must fit the provider's 300-character address limit. Saved pins
must lie within Indonesia's geographic bounds. Map suggestions do not silently
become confirmed pickup pins: the merchant confirms the entrance or adjusts the
map. Clearing a pin cancels pending address searches.

The reviewed courier list currently includes JNE, SiCepat, J&T Express, TIKI,
Anteraja, Ninja Xpress, Lion Parcel, Pos Indonesia, ID Express, SAP Express,
Wahana, J&T Cargo, GoSend and GrabExpress. Enabling a courier is a preference;
the provider must still return a rate for the route and package. GoSend and
GrabExpress require a pickup pin before they can be enabled for a configured
store. A customer delivery pin is also required to quote their services.

Provider references:
- [Courier codes](https://biteship.com/en/docs/api/couriers/overview)
- [Rates by postcode and coordinates](https://biteship.com/en/docs/api/rates/retrieve)
- [Order creation and pickup fields](https://biteship.com/en/docs/api/orders/create)

## Save contract

Authenticated `GET /v1/shipping-settings` returns seller identity, capability,
checkout activation state, configuration/revision and recent save metadata.
`PUT` accepts `{requestKey, revision, configuration}`. The request key is 32
lowercase hexadecimal characters. Replays return the original receipt, including
after a subsequent settings change; a changed body under the same key conflicts.
Viewer accounts can read but cannot save. The transaction checks current seller
status and membership as well as the expected revision.

Migration 0016 adds the current settings row and immutable change records. An
insert into the change log atomically advances the current configuration; direct
unreceipted updates/deletions and historical edits are rejected. An empty address
book is an explicit saved state with a retained revision. It disables new shipped
checkouts without removing the configuration history or existing order snapshots.

The UI stores the exact pending request in session storage before sending it.
An unreadable response retains that request across reloads. Once a save becomes
uncertain, a later rejection cannot erase it; only its matching receipt resolves
it. A definite initial validation/conflict response permits correcting the draft.
Reloading a saved version asks before discarding unsaved form changes. Browser
storage failure blocks writes before transmission. The proxy enforces the
existing session, CSRF and applicable MFA checks.

The map uses the shared address picker. Address matching and dedicated geocoder configuration are documented in [address geocoding](address-geocoding.md). Merchant address search is a bounded,
authenticated, CSRF-protected PHP route at `?cloud=/v1/shipping-address-search`.
It does not borrow the customer's authentication session or expose provider keys.
Only the shipping page permits the map SDK's blob worker and connections to
`tiles.openfreemap.org`; other merchant pages retain their original policy.
Initial map-data failures show the retry state and cannot confirm a suggested
pin. The editor can save a standard-courier address without a pin, but production onboarding requires confirmed pickup and return pins before new money actions.

## Checkout binding

With central commerce enabled, the signed service reads
`GET /internal/commerce/shipping-settings/:seller?environment=sandbox|production`.
It returns the selected origin and return address, configuration revision, address
identities and courier preferences. These private fields are never returned by
the public rates endpoint. Seller identity and package details come from the
verified catalog, not request-supplied origin fields.

PHP loads the profile once per rate calculation and uses that same context for
the new order. Standard courier rates use postcodes. GoSend/GrabExpress requests
use both saved pickup and customer delivery coordinates. Results exclude disabled
couriers, malformed prices/services and pin-dependent services without both pins.
Checkout recalculates rates and verifies the customer's reviewed total before
creating an order. The API credential no longer depends on global pickup fields.

Before a new order is accepted, the Worker checks the selected courier, origin,
return address and configuration revision against the saved profile. A SQL guard
checks the revision again inside the inventory reservation transaction. The
quoted product weights are checked against the catalog and again when order items
are inserted. Concurrent changes roll back the customer, order, stock holds and
payment job together. A previously accepted order resumes before consulting newer
settings, preserving its original paid-for delivery and return details.

## Rollout limits

Central processing follows the deployment’s D1 activation. Shipping booking has
its own PHP/Worker switches, described in [beta shipping readiness](beta-shipping-readiness.md).
When booking is held, customer shipping checkout pauses before a provider call.
The legacy path retains its separate server configuration when D1 is disabled. No real merchant address is
inferred from a server-wide warehouse or from account identity.

This change does not arrange return couriers or labels, provide multiple-warehouse
stock allocation, certify provider account activation/balance, or complete the
broader commerce acceptance plan. The frozen return address is available for the
remaining return-delivery workflow. Production deployment remains on hold.
