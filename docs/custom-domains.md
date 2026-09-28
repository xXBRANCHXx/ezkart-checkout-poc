# Advanced custom domains

Owners manage connections in **Advanced Mode → Connect your domain**. Choose a
published page, enroll a public hostname, add the displayed ownership TXT and
CNAME records, then check DNS and HTTPS. Each enrollment issues a random 256-bit
code valid for initial verification for 24 hours. Renewing invalidates the old
code and temporarily stops serving. Provider certificate TXT records are shown
as they become available. Keep these records in place.

A connection is live only after an exact ownership TXT match, an exact direct
CNAME match to the configured target, and a fresh provider GET showing both
hostname and SSL status `active`. A POST acknowledgement is never issuance proof.
The public handler reads only the enrollment's immutable seller/page R2 key and
serves the existing published snapshot at `/` or its original Ezkart public path.
No draft, another store's path, merchant API, DNS-supplied origin, arbitrary
redirect or forwarded Host header is used. Existing Ezkart public URLs continue
working. Unpublishing/deleting a page makes its domain unavailable immediately.

Switching to Basic (or disabling a seller) atomically suspends domain rows via
migration 0069 without deleting pages. Returning to Advanced requires a new
ownership code and verification. Disconnect first disables serving, then deletes
only the recorded Cloudflare custom hostname. A failed removal retains the
reservation and exposes a retryable disconnect. A new enrollment gets a new code.
A timed-out create is recovered by exact hostname plus enrollment metadata and
never causes an automatic second create; absent evidence needs operator
reconciliation. No provider mutations or DNS provisioning were run to deliver
this code.

The existing housekeeping schedule rechecks up to five due connections per run,
starting at 12 hours since the last check. Failed checks suspend serving. A
24-hour freshness limit independently denies stale records if the schedule is
missing, overloaded or failing. Owners can check immediately in the UI. Operators
must monitor schedule capacity (five/hour supports at most 60 checks per 12-hour
cycle) and scale it before growing beyond that bound. An uncertain create with no
matching provider object still needs operator reconciliation; this implementation
does not guess whether the remote request succeeded.

## Operator setup

Apply migration `0069_custom_domains.sql`. Configure these **per environment**;
none is inferred from merchant input or an incoming Host header:

- `CUSTOM_DOMAIN_ZONE_ID`: 32-hex Cloudflare SaaS zone ID.
- `CUSTOM_DOMAIN_CNAME_TARGET`: exact lowercase DNS hostname supplied to merchants.
- `CUSTOM_DOMAIN_API_HOSTS`: comma-separated exact Worker/API hostnames permitted
  to enter ordinary API routing, including the environment's workers.dev name
  if that endpoint is used. All other hosts enter only custom-domain resolution.
- `CUSTOM_DOMAIN_API_TOKEN`: Worker secret scoped to that zone with **SSL and
  Certificates Write**. The zone must support custom hostnames and custom
  metadata (`ezkart_domain_id` binds recovery to this enrollment).

Use a dedicated SaaS zone/fallback, configured as an originless proxied record
and wildcard Worker route according to Cloudflare's Worker-as-origin procedure.
Keep main/production and unrelated zone routes untouched. Configure the fallback
origin through Cloudflare; this application deliberately cannot mutate fallback
origins, zones, route settings or customer DNS. The API adapter only creates,
reads, finds and deletes individual hostname resources. No caller-selected
custom origin or SNI is accepted.

This version supports direct public CNAME hostnames. IP addresses, wildcards,
URLs, ports, reserved/internal names and Ezkart platform domains are rejected.
Apex flattening/proxied customer records that hide the required CNAME need a
separate apex adapter; use a subdomain such as `shop.brand.com` now. DNS errors,
provider failures, mismatched metadata/identity and oversized responses fail
closed. Actual provider issuance, DNS propagation and delivery through the
configured Cloudflare zone still require operator setup and live acceptance.

Official contracts consulted 28 September 2026:

- [Custom hostname API and readiness](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/start/common-api-calls/)
- [Create custom hostname and zone permission](https://developers.cloudflare.com/api/resources/custom_hostnames/methods/create/)
- [Custom hostname details](https://developers.cloudflare.com/api/resources/custom_hostnames/methods/get/)
- [Worker as fallback origin](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/start/advanced-settings/worker-as-origin/)
- [Cloudflare DNS-over-HTTPS](https://developers.cloudflare.com/1.1.1.1/encryption/dns-over-https/make-api-requests/)

Validation: lifecycle and hostile input fixtures in
`cloudflare/ezkart-api/test/custom-domains.test.mjs`, existing Advanced plan tests,
and isolated browser management checks in
`tools/builder-mcp/test/custom-domains.test.mjs`. The realistic commerce fixture
`tools/builder-mcp/test/custom-domain-commerce.test.mjs` publishes through the
existing builder, serves the exact snapshot on a vanity hostname, loads product
and variant photos, embedded fonts and layout styles, adds a variant to the cart,
and opens the configured canonical checkout with its seller, cart and vanity
return URL. It verifies an opaque script origin, no opener, and no authenticated
API or checkout routing on the vanity host. All destinations are local fixtures.
These establish local behavior;
they do not establish real certificate issuance or DNS configuration.
