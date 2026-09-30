# Ezkart address geocoding

Ezkart's own PHP geocoder searches an index built from free Indonesian
OpenStreetMap data. It runs inside the existing PHP hosting, with no Java or
PostgreSQL process, SQLite extension, external geocoding account or subscription.
The customer address book and seller pickup/return editor share the lookup.

The old picker automatically selected Photon's first result, including street
and district centers, and displayed all of them at building zoom. It discarded
independent address fields before searching. The new forms preserve street,
house number, district/city and postcode constraints, rank mapped buildings
first and require a choice for ambiguous buildings. Broad area/street matches
can orient the map but cannot become a delivery pin merely by zooming in.
Seller pickup/return pins retain their explicit confirmation requirement.

## Owned index

`tools/geocoding/build_index.py` reads a regional `.osm.pbf` extract with pyosmium
and Shapely. It extracts mapped addresses, named points of interest and streets,
then resolves locality labels using containing administrative polygons. It never
asks an external geocoder to infer coordinates. Point objects retain their mapped
coordinates; buildings use a point within the mapped polygon, and street results
use their line midpoint. Missing house numbers are never interpolated.

The output comprises `records.jsonl`, 4096 possible token shards, and
`manifest.json`. PHP hashes query anchors to find bounded posting lists, seeks
candidate records and verifies house number, locality and postcode. A compound
street/number anchor supports common street names across multiple cities. The
reader requires no database driver, downloads or background process.

Generate an index outside the repository:

```sh
python -m venv /path/to/geocoding-venv
/path/to/geocoding-venv/bin/pip install osmium shapely
/path/to/geocoding-venv/bin/python tools/geocoding/build_index.py \
  --input /path/to/indonesia-latest.osm.pbf \
  --output /path/to/new-index
```

The [Indonesia extract](https://download.geofabrik.de/asia/indonesia.html) is
available from Geofabrik. The index and source extract are managed data, not Git
assets. Importing them does not change orders, merchant addresses or saved pins.

Install the index in `ezkart-geocoding` beside `public_html`, outside the public
web root. Alternatively set the absolute private path with
`address_geocoding_directory` in ignored `config.runtime.php`, or
`EZKART_ADDRESS_GEOCODING_DIRECTORY`. Install data and token shards first and the
manifest last. For updates, build and check a fresh directory before atomically
switching the configured directory. Preserve the previous index for rollback.

`GET /cart/api/health.php` reports `address_search.engine=ezkart` and
`index_ready=true` when the index is installed. An active index returns an empty
match or an unavailable state when appropriate; it never silently falls back to
an external provider. Before the initial index installation, the old bounded
Photon demo is retained for continuity. That temporary path uses structured form
queries and the same result-quality rules. Supplied coordinates and Plus Codes
continue to work independently of the index.

## Accuracy and data updates

The map index is limited to what has been mapped. Self-hosting removes a service
subscription and gives us control of matching and updates; it cannot create
missing building numbers or entrances. A building match is not a certified
entrance. Do not label a street center as an exact delivery location. Corrections
to private customer pins remain private and must not automatically become public
map-index records. OpenStreetMap attribution and its ODbL licence are preserved.

## Checks

`address-local-index.test.mjs` builds an actual native index and exercises the PHP
API with no database extensions or remote geocoder calls. It covers exact house
lookup, wrong-city/postcode/number rejection, locality labels, ambiguous
buildings, named places, absent house numbers and corrupt-index failure.
`address-geocoding.test.mjs` covers the temporary demo adapter and desktop/phone
building selection and saving. The checkout address suite covers Plus Codes,
supplied coordinates, late results, map failure, saved-pin precedence,
pointer/touch positioning and delivery-coordinate binding. The merchant shipping
suite covers confirmation and save/reload recovery.


## Indonesia import, 30 September 2026

The Geofabrik extract dated 29 September 2026 was verified against its published
MD5 (`b82fe01e59cfd6737cbcc93d1ffbbfe0`, 1,737,609,162 bytes). The completed
index contains 1,103,818 records: 48,306 numbered addresses, 401,046 named places,
530,820 streets and 123,646 areas. Every JSON record was validated before upload.
The private runtime directory is configured independently of Git deployments.

Twelve sampled mapped addresses spanning Java, Sumatra, Kalimantan, Sulawesi and
Bali returned their original mapped coordinates through the PHP customer API,
with no external geocoder calls. Eleven were unique; one returned two buildings
and required a choice. The sample also exercised block identifiers, street
metadata containing commas, and non-Jalan street prefixes. This checks index and
lookup integration against mapped records; it is not independent verification of
entrances or evidence of complete Indonesian address coverage.


The private index was activated on Workbench after the hosted record-file size
and all 4,096 token-shard sizes were checked; eight sampled shard SHA-256 hashes
matched the local data. Health reported `engine=ezkart` and `index_ready=true`.
