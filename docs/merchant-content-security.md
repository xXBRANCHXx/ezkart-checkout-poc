# Merchant content-security policy

Hosted merchant responses now preserve PHP's full content-security policy.
Previously Hostinger replaced it with `upgrade-insecure-requests`, losing the
intended script, connection, form, frame and base-URL restrictions. The fix is
verified on TEST; signed-in workflow acceptance remains a separate requirement.

PHP now emits its existing policy in both the standard CSP header and an
intermediate header, `X-Ezkart-Content-Security-Policy`. The merchant
directory's `.htaccess` restores that response value after inherited header
configuration and removes the intermediate header. Only `index.php` is affected.
The value comes from the response, never a client request header. A missing PHP
value leaves a restrictive `default-src 'none'` fallback.

The policy selection is unchanged: ordinary pages permit same-origin scripts
and the exact startup-script hash; shipping settings additionally permits the
map tile service and its blob worker; document previews disable scripts; the
interactive page view preserves its sandbox without same-origin access; and
the narrowly validated editor-repair frame retains same-origin framing. The
existing frame-options and other response headers remain in place. No policy
is reconstructed from raw query-string matching in the server configuration.

Apache documents [response header expressions and the two header tables](https://httpd.apache.org/docs/2.4/mod/mod_headers.html).
LiteSpeed documents [security headers in `.htaccess` and wire verification](https://docs.litespeedtech.com/lsws/security-headers/).
Hostinger's expression behavior is verified on the hosted TEST response; local
PHP's built-in server does not execute `.htaccess`.

Two new local HTTP/browser cases pass. They cover dashboard/map/preview/repair
policy selection, duplicate query parameters, forged client policy headers,
the startup hash and actual rejection of unapproved inline scripts, handlers
and eval. All six existing shipping-setting cases and the startup/editor case
pass. The hosted-page/isolated-preview regression requires the local PHP curl
extension; its first run omitted that extension and stopped before page hosting.
The corrected preview run passes with that extension loaded, including markup
isolation and checkout navigation. Syntax and diff checks pass. Deployed
evidence is recorded below. These checks do not replace signed-in hosted
merchant/customer acceptance or close a top-level gate.

## Hosted verification

Implementation `c316c2b` is pushed and automatically deployed on workbench.
At 00:01:35 UTC on 27 September, eleven GET/HEAD cases each return one CSP header
that exactly matches the local PHP policy. The intermediate header is absent.
This includes both index URL forms, dashboard, map, editor repair, preview/view
API error responses, duplicate query parameters and forged client headers.
Cache and frame restrictions are preserved and HEAD bodies are empty.

An isolated browser verifies the hosted sign-in screen at 1360px and 390px:
unapproved inline script execution is blocked, the sign-in control renders and
there is no horizontal overflow. Both screenshots were visually checked. No
sign-in, email, merchant action or commerce record was created. A read-only
shared-browser status check still reports disconnected, with six historical
connection attempts and no new attempt. Authenticated hosted workflows remain
pending. Main and production are unchanged.
