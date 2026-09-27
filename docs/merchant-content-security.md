# Merchant content-security policy

The hosted merchant response has been replacing PHP's content-security policy
with `upgrade-insecure-requests`. That does not enforce the intended script,
connection, form, frame and base-URL restrictions. The merchant release gate
remains open until the full selected policy is verified on TEST.

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
Hostinger's exact expression behavior must be verified on the hosted TEST
response; local PHP's built-in server does not execute `.htaccess`.

Two new local HTTP/browser cases pass. They cover dashboard/map/preview/repair
policy selection, duplicate query parameters, forged client policy headers,
the startup hash and actual rejection of unapproved inline scripts, handlers
and eval. All six existing shipping-setting cases and the startup/editor case
pass. The hosted-page/isolated-preview regression requires the local PHP curl
extension; its first run omitted that extension and stopped before page hosting.
The corrected preview run passes with that extension loaded, including markup
isolation and checkout navigation. Syntax and diff checks pass. Deployed
evidence follows below. These checks do not replace
signed-in hosted merchant/customer acceptance or close a top-level gate.
