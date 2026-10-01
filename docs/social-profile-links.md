# Dedicated social profile links

Image Stack footer links and Studio's native Social links element share the
policy in `cart/admin/builder-media.js`. The Worker imports that same policy.
General navigation, buttons, HTML/custom-code links, scripts and checkout keep
their existing behavior; they are not social blocks.

Merchants choose a network and enter a handle or full profile URL. Display text
is optional and remains merchant content. Supported profile paths:

| Network | Profile URL path |
| --- | --- |
| Instagram | `/username` |
| TikTok | `/@username` |
| YouTube | `/@handle` or `/channel/UC…` |
| Facebook | `/username` or `/profile.php?id=…` |
| LinkedIn | `/in/name` (default for a handle) or `/company/name` (full URL) |
| X | `/username`; `twitter.com` is normalized to `x.com` |
| Pinterest | `/username` |
| Threads | `/@username`; `threads.net` is normalized to `threads.com` |

Only explicit provider hosts and aliases in the policy are accepted. HTTP
profile URLs are normalized to HTTPS; credentials, ports, fragments, tracking
queries, host lookalikes, encoded ASCII path tricks, dot segments, post/video
paths, WhatsApp, websites, shorteners and link hubs are rejected. No external
requests or redirects are used to guess or verify a profile. This is profile
URL validation, not proof of account ownership or existence.

Old unsupported source values stay in draft configuration so the editor can
show a per-row reason and let the merchant repair or remove them. Their anchors
are omitted from dedicated social renderings. Publication, export authorization
and scheduled publication reject unsupported dedicated source values in either
the generated HTML or saved preview. Valid saved/published/scheduled profile
URLs are canonicalized. Preview caches and hosted public, shared-preview and
custom-domain responses also filter dedicated social links, including older
snapshots. Unrelated custom anchors and scripts are preserved.

The supported YouTube handle and channel formats follow [YouTube's channel URL
documentation](https://support.google.com/youtube/answer/6180214) and [handle
guidelines](https://support.google.com/youtube/answer/11585688). Profile handles
and display names are separate, as described in [X's username documentation](https://help.x.com/en/managing-your-account/change-x-handle).

Verification: `social-profile-controls.test.mjs` covers both merchant editors,
invalid links, legacy repair values, save/reopen, native API bypass attempts,
preview/export rendering and narrow layouts. `social-profiles.test.mjs` covers
the shared URL policy, real Worker parsing, saves, preview caching, export and
publication rejection, canonical scheduled snapshots, execution rechecks, and
legacy interactive/public rendering. Existing publication, schedule,
custom-domain, builder media, language, blank-editor, section and grid checks
cover their unchanged surrounding behavior.
