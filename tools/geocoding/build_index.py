#!/usr/bin/env python3
"""Build the native PHP address index from an owned OSM extract; never call a geocoder."""
import argparse
import collections
import datetime
import hashlib
import json
import pathlib
import re
import sqlite3
import sys


def normalize(text):
    text = text.lower()
    text = re.sub(r"\b(?:jl|jln|jalan)\b\.?\s*", "jalan ", text)
    text = re.sub(r"\b(?:kecamatan|kec|kelurahan|kel|desa|dusun|kabupaten|kab|kota|provinsi|daerah istimewa)\b\.?\s*", "", text)
    return re.sub(r"[^\w]+", " ", text.replace("_", " ")).strip()


def write_index(records, destination, source):
    """The writer also accepts hand-authored public fixtures for repeatable integration tests."""
    destination = pathlib.Path(destination)
    destination.mkdir(parents=True, exist_ok=False)
    (destination / "tokens").mkdir()
    postings = sqlite3.connect(destination / ".postings.sqlite")
    postings.execute("CREATE TABLE postings(bucket TEXT, key TEXT, offset INTEGER)")
    counts = collections.Counter()
    with (destination / "records.jsonl").open("wb") as output:
        for record in records:
            offset = output.tell()
            raw = (json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n").encode()
            if len(raw) > 8192:
                raise ValueError("Address record exceeds reader bound")
            output.write(raw)
            p = record["properties"]
            keys = set()
            if p.get("street"):
                keys.add("street:" + normalize(p["street"]))
                if p.get("housenumber"):
                    keys.add("street_number:" + normalize(p["street"]) + ":" + normalize(p["housenumber"]))
            if p.get("postcode"):
                keys.add("postcode:" + p["postcode"])
            for word in normalize(" ".join([p.get("name", ""), p.get("street", "")])).split():
                if len(word) >= 4 and word not in {"jalan", "indonesia", "kecamatan", "kabupaten"} and not word.isdecimal():
                    keys.add("word:" + word)
            for key in keys:
                bucket = hashlib.sha256(key.encode()).hexdigest()[:3]
                postings.execute("INSERT INTO postings VALUES(?,?,?)", (bucket, key, offset))
            counts[record["precision"]] += 1
            if sum(counts.values()) % 20000 == 0:
                postings.commit()
                print("Indexed", sum(counts.values()), flush=True)
    postings.commit()
    postings.execute("CREATE INDEX posting_order ON postings(bucket,key,offset)")
    current_bucket = None
    mapping = {}
    def flush():
        if current_bucket is not None:
            data = json.dumps(mapping, ensure_ascii=False, separators=(",", ":"))
            if len(data.encode()) > 4000000:
                raise ValueError("Posting shard exceeds reader bound")
            (destination / "tokens" / (current_bucket + ".json")).write_text(data)
    for bucket, key, offset in postings.execute("SELECT bucket,key,offset FROM postings ORDER BY bucket,key,offset"):
        if bucket != current_bucket:
            flush()
            current_bucket, mapping = bucket, {}
        mapping.setdefault(key, []).append(offset)
    flush()
    postings.close()
    (destination / ".postings.sqlite").unlink()
    manifest = {"format": "ezkart-address-index-v1", "builtAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                "source": source, "counts": dict(counts), "records": sum(counts.values()),
                "licence": "OpenStreetMap contributors, ODbL 1.0", "attribution": "https://www.openstreetmap.org/copyright"}
    # Installing the manifest last prevents activation of a partially uploaded dataset.
    (destination / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(manifest), flush=True)


def osm_records(filename, scratch):
    import osmium
    from shapely import STRtree, Point
    from shapely.geometry import shape
    from shapely.validation import make_valid
    scratch = pathlib.Path(scratch)
    database = sqlite3.connect(scratch)
    database.execute("CREATE TABLE raw(osm TEXT PRIMARY KEY, lon REAL, lat REAL, precision TEXT, properties TEXT)")
    geo = osmium.geom.GeoJSONFactory()
    boundaries = []
    seen = 0
    node_cache = scratch.with_suffix('.nodes')
    processors = (osmium.FileProcessor(str(filename))
                  .with_locations('sparse_file_array,' + str(node_cache))
                  .with_areas()
                  .with_filter(osmium.filter.KeyFilter('name', 'addr:housenumber', 'boundary')))
    for entity in processors:
        tags = dict(entity.tags)
        try:
            if entity.is_area() and tags.get("boundary") == "administrative" and tags.get("name"):
                level = tags.get("admin_level", "")
                if level not in {"2", "4", "5", "6", "7", "8", "9", "10"}:
                    continue
                polygon = make_valid(shape(json.loads(geo.create_multipolygon(entity))))
                boundaries.append((polygon, int(level), tags["name"], tags.get("ISO3166-1:alpha2", "")))
                continue
            if entity.is_relation() or (entity.is_way() and entity.is_closed() and tags.get("highway") is None):
                continue
            street = tags.get("addr:street", "")
            number = tags.get("addr:housenumber", "")
            name = tags.get("name", "")
            if tags.get("addr:country", "ID").upper() not in {"ID", "INDONESIA"}:
                continue
            address = bool(street and number)
            road = bool(tags.get("highway") and name)
            place = bool(name and any(k in tags for k in ("amenity", "shop", "office", "tourism", "leisure", "building", "craft", "historic", "healthcare", "place")))
            if not (address or road or place):
                continue
            if entity.is_node():
                point = Point(entity.location.lon, entity.location.lat)
                osm_id = "N" + str(entity.id)
            elif entity.is_area():
                polygon = shape(json.loads(geo.create_multipolygon(entity)))
                point = polygon.representative_point()
                osm_id = ("W" if entity.from_way() else "R") + str(entity.orig_id())
            elif entity.is_way():
                line = shape(json.loads(geo.create_linestring(entity)))
                point = line.interpolate(0.5, normalized=True)
                osm_id = "W" + str(entity.id)
            else:
                continue
            precision = "address" if address else "street" if road else "area" if "place" in tags else "place"
            postcode = tags.get("addr:postcode", "")
            p = {"street": (name if road else street)[:160], "housenumber": number[:40],
                 "postcode": postcode if re.fullmatch(r"\d{5}", postcode) else "",
                 "name": (name or (street + " " + number).strip())[:160],
                 "city": tags.get("addr:city", "")[:160], "district": tags.get("addr:district", tags.get("addr:suburb", ""))[:160]}
            database.execute("INSERT OR REPLACE INTO raw VALUES(?,?,?,?,?)", (osm_id, point.x, point.y, precision, json.dumps(p)))
            seen += 1
            if seen % 50000 == 0:
                database.commit()
                print("Read", seen, "mapped locations; boundaries", len(boundaries), flush=True)
        except (osmium.InvalidLocationError, RuntimeError, ValueError):
            # Incomplete geometry is not a license to invent a position.
            continue
    database.commit()
    node_cache.unlink(missing_ok=True)
    print("Resolving administrative context for", seen, "locations with", len(boundaries), "boundaries", flush=True)
    tree = STRtree([b[0] for b in boundaries])
    for osm_id, lon, lat, precision, raw in database.execute("SELECT * FROM raw ORDER BY osm"):
        p = json.loads(raw)
        point = Point(lon, lat)
        context = sorted((boundaries[int(i)] for i in tree.query(point, predicate="within")), key=lambda b: b[1], reverse=True)
        countries = [b[3] for b in context if b[1] == 2 and b[3]]
        if countries and "ID" not in countries:
            continue
        p["localities"] = list(dict.fromkeys([v for v in [p.get("district"), p.get("city"), *(b[2] for b in context if b[1] != 2)] if v]))[:8]
        for _, level, label, _ in context:
            if level in {5, 6, 7} and not p["city"]:
                p["city"] = label
            if level in {8, 9} and not p["district"]:
                p["district"] = label
        yield {"osm": osm_id, "coordinate": {"latitude": lat, "longitude": lon}, "precision": precision, "properties": p}
    database.close()
    scratch.unlink()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=pathlib.Path, required=True)
    parser.add_argument("--output", type=pathlib.Path, required=True)
    parser.add_argument("--fixture-jsonl", action="store_true")
    args = parser.parse_args()
    if args.fixture_jsonl:
        records = (json.loads(line) for line in args.input.open() if line.strip())
    else:
        records = osm_records(args.input, args.output.with_suffix(".build.sqlite"))
    write_index(records, args.output, {"file": args.input.name, "url": "https://download.geofabrik.de/asia/indonesia.html" if not args.fixture_jsonl else "fixture"})
