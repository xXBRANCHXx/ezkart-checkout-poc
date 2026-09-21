The small PHP adapter in `../../plus-code.php` follows Google's Open Location Code
validation, decoding, and nearest-code recovery algorithms. Original source:
https://github.com/google/open-location-code/blob/83986da0156bbf51fba33d0327d8ca4b7f955c89/js/src/openlocationcode.js

Copyright 2014 Google Inc. Licensed under Apache-2.0 (see LICENSE).
The upstream decoding and recovery fixtures in `tools/checkout-test/fixtures/plus-codes`
are copied from the same revision under this license and exercise the PHP adapter.
Ezkart returns the center of the code's area, using a locality lookup only for short codes.
