"""Offline provider/storage fixtures only; no credentials or customer data are used."""
from contextlib import redirect_stderr
import copy
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import signal
import subprocess
import tarfile
import tempfile
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from threading import Thread
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("bundle", Path(__file__).with_name("workbench-backup-bundle.py"))
bundle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bundle)

SQL = """CREATE TABLE wallets(id TEXT PRIMARY KEY, state TEXT, attempts INTEGER);
INSERT INTO wallets VALUES('original','uncertain',1);
CREATE TABLE content(id INTEGER, data BLOB, note TEXT);
INSERT INTO content VALUES(1,X'00ff','Indonesian — café');
"""


class FakeStorage:
    def __init__(self, deployment="beta"):
        self.deployment = deployment
        self.objects = {}
        self.uploads = []
        self.deletions = []
        self.pages = 0
        self.lost_ack = False
        self.corrupt_readback = False
        self.mutate_asset = False
        for bucket in bundle.buckets(deployment):
            self.add(bucket, "products/folder/image.bin", b"\x00\xff image bytes")
            self.add(bucket, "../valid-object-key", "Unicode café".encode())
            self.add(bucket, "operations/backups/old/nested/backup.cms", b"old historical backup")

    def add(self, bucket, key, body):
        self.objects[bucket, key] = bytes(body)

    def list_page(self, bucket, cursor):
        self.pages += 1
        keys = sorted(key for selected, key in self.objects if selected == bucket)
        offset = int(cursor or "0")
        page = []
        for key in keys[offset:offset + 2]:
            body = self.objects[bucket, key]
            page.append({"key": key, "size": len(body), "etag": hashlib.md5(body).hexdigest(),
                         "httpMetadata": {"contentType": "application/octet-stream"},
                         "customMetadata": {"original": "preserved"}})
        return page, str(offset + 2) if offset + 2 < len(keys) else None

    def download(self, bucket, key, path, limit):
        if (bucket, key) not in self.objects:
            raise FileNotFoundError()
        body = self.objects[bucket, key]
        etag = hashlib.md5(body).hexdigest()
        if key.startswith(bundle.EXCLUDED) and self.corrupt_readback:
            body = body[:-1] + bytes([body[-1] ^ 1])
        if not key.startswith(bundle.EXCLUDED) and self.mutate_asset:
            body += b"changed"
        bundle.require(len(body) <= limit, "Fake download exceeded its bound")
        bundle.save_bytes(path, body)
        return {"etag": etag, "content-type": "application/octet-stream", "x-amz-meta-original": "preserved"}

    def upload_new(self, bucket, key, path):
        bundle.require((bucket, key) not in self.objects, "No overwrite")
        self.uploads.append((bucket, key))
        self.add(bucket, key, path.read_bytes())
        if self.lost_ack:
            raise bundle.BackupError("Lost upload acknowledgement")

    def delete_verified(self, bucket, key):
        self.deletions.append((bucket, key))
        del self.objects[bucket, key]


class BundleTests(unittest.TestCase):
    def test_storage_redirect_never_forwards_authorization(self):
        requests = []
        class Redirect(BaseHTTPRequestHandler):
            def do_GET(self):
                requests.append(self.path)
                self.send_response(302)
                self.send_header('Location', '/credential-target')
                self.end_headers()
            def log_message(self, *args):
                pass
        with HTTPServer(('127.0.0.1', 0), Redirect) as server:
            thread = Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                with patch.dict(os.environ, {'CLOUDFLARE_ACCOUNT_ID': 'a' * 32, 'CLOUDFLARE_API_TOKEN': 'fixture-only'}):
                    storage = bundle.CloudflareStorage('beta')
                with self.assertRaises(bundle.BackupError):
                    storage.request(f'http://127.0.0.1:{server.server_port}/original')
                self.assertEqual(requests, ['/original'])
            finally:
                server.shutdown()
                thread.join()

    @classmethod
    def setUpClass(cls):
        cls.old_umask = os.umask(0o077)
        cls.keys = tempfile.TemporaryDirectory(prefix="ezkart-ephemeral-test-key-")
        cls.cert = Path(cls.keys.name) / "public.pem"
        cls.key = Path(cls.keys.name) / "private.pem"
        # Ephemeral local test identity only, never installed or used with a provider.
        subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-noenc", "-keyout", str(cls.key),
                        "-out", str(cls.cert), "-subj", "/CN=Offline test fixture/", "-days", "1"],
                       capture_output=True, check=True, timeout=30)

    @classmethod
    def tearDownClass(cls):
        cls.keys.cleanup()
        os.umask(cls.old_umask)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="ezkart-bundle-test-")
        self.addCleanup(self.temp.cleanup)
        self.state = Path(self.temp.name)
        self.storage = FakeStorage()
        self.calls = []

    def remote(self, args):
        self.calls.append(args)
        if args[:2] == ["d1", "info"]:
            return json.dumps({"name": bundle.db.TARGETS["beta"][0], "uuid": bundle.db.TARGETS["beta"][1]})
        if args[:3] == ["d1", "time-travel", "info"]:
            return json.dumps({"bookmark": "fixture-original"})
        if args[:2] == ["d1", "export"]:
            Path(args[args.index("--output") + 1]).write_text(SQL)
            return "done"
        self.fail("Unexpected provider command")

    def archive(self, **kwargs):
        return bundle.archive("beta", self.state, self.cert, self.storage, self.remote, **kwargs)

    def directory(self, result):
        return self.state / "beta" / result["runId"]

    def test_encrypted_roundtrip_preserves_database_assets_metadata_and_private_modes(self):
        result = self.archive()
        source = self.directory(result)
        receipt = bundle.read_json(source / "receipt.json")
        restored = self.state / "restored"
        verified = bundle.restore("beta", source / "snapshot.cms", source / "receipt.json", self.key, restored)
        self.assertEqual(verified["tables"], 2)
        self.assertEqual(verified["objects"], 4)
        self.assertFalse(verified["networkUsed"])
        self.assertEqual(len(self.calls), 4)
        self.assertGreater(self.storage.pages, 4)
        self.assertEqual(len(self.storage.uploads), 1)
        self.assertEqual(self.storage.objects[receipt["bucket"], receipt["key"]], (source / "snapshot.cms").read_bytes())
        self.assertFalse((source / "source").exists())
        self.assertFalse((source / "snapshot.tar.gz").exists())
        self.assertTrue((source / "bundle-manifest.json").exists())
        self.assertNotIn(b"original", (source / "snapshot.cms").read_bytes())
        manifest = bundle.read_json(restored / "r2-manifest.json")
        self.assertFalse(manifest["databaseAtomicSnapshot"])
        for item in manifest["objects"]:
            self.assertFalse(item["metadata"]["key"].startswith(bundle.EXCLUDED))
            self.assertEqual(item["metadata"]["customMetadata"], {"original": "preserved"})
            self.assertEqual(item["httpHeaders"]["x-amz-meta-original"], "preserved")
        for path in source.rglob("*"):
            self.assertEqual(path.stat().st_mode & 0o777, 0o700 if path.is_dir() else 0o600)
        self.assertEqual(self.storage.deletions, [])

    def test_readback_failure_preserves_previous_good_copy_and_has_no_success_receipt(self):
        good = self.archive()
        old = bundle.read_json(self.directory(good) / "receipt.json")
        self.storage.corrupt_readback = True
        with self.assertRaisesRegex(bundle.BackupError, "Remote ciphertext"):
            self.archive(keep=1)
        failed = next(path for path in (self.state / "beta").iterdir() if path.name != good["runId"])
        self.assertFalse((failed / "receipt.json").exists())
        self.assertEqual(bundle.read_json(failed / "incomplete.json")["stage"], "readback")
        self.assertIn((old["bucket"], old["key"]), self.storage.objects)
        self.assertEqual(self.storage.deletions, [])

    def test_lost_upload_ack_recovery_is_read_only_and_retains_failure_evidence(self):
        self.storage.lost_ack = True
        with self.assertRaises(bundle.BackupError):
            self.archive()
        failed = next((self.state / "beta").iterdir())
        self.assertEqual(bundle.read_json(failed / "state.json")["stage"], "upload_intent")
        self.assertFalse((failed / "receipt.json").exists())
        result = bundle.recover("beta", self.state, failed.name, self.storage)
        self.assertEqual(result["status"], "verified_encrypted_readback")
        self.assertEqual(len(self.storage.uploads), 1)
        self.assertTrue((failed / "incomplete.json").exists())
        self.assertTrue((failed / "recovered.json").exists())

    def test_recovery_of_absent_upload_does_not_repeat_it(self):
        self.storage.lost_ack = True
        with self.assertRaises(bundle.BackupError):
            self.archive()
        failed = next((self.state / "beta").iterdir())
        bucket, key = self.storage.uploads[0]
        del self.storage.objects[bucket, key]
        with self.assertRaises(FileNotFoundError):
            bundle.recover("beta", self.state, failed.name, self.storage)
        self.assertEqual(len(self.storage.uploads), 1)
        self.assertFalse((failed / "receipt.json").exists())

    def test_exclusive_lock_is_released_after_failure_and_other_environment_is_separate(self):
        with bundle.locked(self.state, "beta"):
            with self.assertRaisesRegex(bundle.BackupError, "exclusive lock"):
                self.archive()
            with bundle.locked(self.state, "test"):
                pass
        self.assertEqual(self.calls, [])
        self.archive()

    def test_retention_only_deletes_verified_tool_objects_and_preserves_newest(self):
        first, second = self.archive(), self.archive()
        root = self.state / "beta"
        original = bundle.read_json(self.directory(first) / "receipt.json")
        # A private but invalid receipt cannot turn an app key into a deletion candidate.
        forged_id = "20000101T000000Z-" + "a" * 32
        forged = root / forged_id
        forged.mkdir(mode=0o700)
        receipt = copy.deepcopy(original)
        receipt.update(runId=forged_id, key="products/folder/image.bin")
        bundle.db.save_json(forged / "receipt.json", receipt)
        missing_id = "20000101T000001Z-" + "b" * 32
        (root / missing_id).mkdir(mode=0o700)  # Incomplete run, no receipt.
        unknown_key = bundle.object_key("beta", "20000101T000002Z-" + "c" * 32)
        self.storage.add("ezkart-beta-private", unknown_key, b"no success receipt")
        final = self.archive(keep=1)
        self.assertEqual(len(self.storage.deletions), 2)
        self.assertEqual({key for _, key in self.storage.deletions}, {
            bundle.object_key("beta", first["runId"]), bundle.object_key("beta", second["runId"])})
        self.assertIn(("ezkart-beta-private", bundle.object_key("beta", final["runId"])), self.storage.objects)
        self.assertIn(("ezkart-beta-private", unknown_key), self.storage.objects)
        self.assertIn(("ezkart-beta-private", "products/folder/image.bin"), self.storage.objects)
        self.assertIn(("ezkart-beta-private", "operations/backups/old/nested/backup.cms"), self.storage.objects)
        self.assertTrue((self.directory(first) / "retention-deleted.json").exists())
        self.assertFalse((self.directory(first) / "snapshot.cms").exists())
        self.assertTrue((self.directory(final) / "snapshot.cms").exists())

    def test_default_retention_never_deletes_and_changed_old_ciphertext_is_not_eligible(self):
        first = self.archive()
        self.archive()
        self.assertEqual(self.storage.deletions, [])
        key = bundle.object_key("beta", first["runId"])
        self.storage.objects["ezkart-beta-private", key] = b"replaced or corrupted"
        self.archive(keep=1)
        self.assertNotIn(("ezkart-beta-private", key), self.storage.deletions)
        self.assertIn(("ezkart-beta-private", key), self.storage.objects)

    def test_wrong_environment_paths_symlinks_and_duplicate_cli_flags_fail_closed(self):
        with self.assertRaises(bundle.BackupError):
            bundle.archive("main", self.state, self.cert, self.storage, self.remote)
        with self.assertRaises(bundle.BackupError):
            bundle.object_key("beta", "../outside")
        with self.assertRaises(bundle.BackupError):
            bundle.archive("beta", bundle.db.ROOT / "unsafe-backup", self.cert, self.storage, self.remote)
        link = self.state / "link"
        link.symlink_to(self.state, target_is_directory=True)
        with self.assertRaises(bundle.BackupError):
            bundle.archive("beta", link, self.cert, self.storage, self.remote)
        with redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            bundle.main(["archive", "--once", "--deployment=beta", "--deployment=test", "--state-directory=" + str(self.state), "--certificate=" + str(self.cert)])
        self.assertEqual(self.calls, [])
        with patch.dict(os.environ, {"CLOUDFLARE_ACCOUNT_ID": "a" * 32, "CLOUDFLARE_API_TOKEN": "offline-fixture"}):
            adapter = bundle.CloudflareStorage("beta")
            for bucket, key in (("ezkart-test-private", bundle.object_key("beta", "20000101T000000Z-" + "d" * 32)),
                                ("ezkart-beta-private", "products/app.bin"),
                                ("ezkart-beta-private", "operations/backups/other-tool/snapshot.cms")):
                with self.assertRaises(bundle.BackupError):
                    adapter.writable(bucket, key)

    def test_tamper_rejected_even_if_cipher_hash_in_receipt_is_replaced(self):
        result = self.archive()
        directory = self.directory(result)
        cipher = directory / "snapshot.cms"
        corrupted = bytearray(cipher.read_bytes())
        corrupted[-1] ^= 1
        cipher.write_bytes(corrupted)
        destination = self.state / "tampered"
        with self.assertRaisesRegex(bundle.BackupError, "trusted receipt"):
            bundle.restore("beta", cipher, directory / "receipt.json", self.key, destination)
        self.assertFalse(destination.exists())
        receipt = bundle.read_json(directory / "receipt.json")
        receipt["ciphertext"] = bundle.db.digest(cipher)
        bundle.atomic_json(directory / "receipt.json", receipt)
        with self.assertRaises(bundle.BackupError):
            bundle.restore("beta", cipher, directory / "receipt.json", self.key, destination)
        self.assertEqual({path.name for path in destination.iterdir()}, {"restore-incomplete.json"})

    def test_wrong_restore_environment_and_key_are_rejected_without_plaintext(self):
        result = self.archive()
        directory = self.directory(result)
        with self.assertRaises(bundle.BackupError):
            bundle.restore("test", directory / "snapshot.cms", directory / "receipt.json", self.key, self.state / "wrong-env")
        self.assertFalse((self.state / "wrong-env").exists())
        invalid = self.state / "not-a-key"
        bundle.save_bytes(invalid, b"not a private key")
        with self.assertRaises(bundle.BackupError):
            bundle.restore("beta", directory / "snapshot.cms", directory / "receipt.json", invalid, self.state / "wrong-key")
        self.assertEqual({p.name for p in (self.state / "wrong-key").iterdir()}, {"restore-incomplete.json"})
        with self.assertRaisesRegex(bundle.BackupError, "public recovery certificate"):
            self.archive_with_cert(self.key)

    def archive_with_cert(self, cert):
        return bundle.archive("beta", self.state, cert, self.storage, self.remote)

    def test_limits_pagination_and_asset_changes_prevent_upload(self):
        limits = {**bundle.DEFAULT_LIMITS, "total_bytes": 1}
        with self.assertRaisesRegex(bundle.BackupError, "Total asset bytes"):
            self.archive(limits=limits)
        self.assertEqual(self.storage.uploads, [])
        self.storage.mutate_asset = True
        with self.assertRaisesRegex(bundle.BackupError, "Asset changed"):
            self.archive()
        self.assertEqual(self.storage.uploads, [])
        with patch.object(self.storage, "list_page", return_value=([], "same-cursor")):
            with self.assertRaisesRegex(bundle.BackupError, "pagination did not advance"):
                bundle.inventory(self.storage, "ezkart-beta-private", 5, 10, 1024)
        with patch.object(self.storage, "list_page", side_effect=[([], "cursor-1"), ([], "cursor-2")]):
            with self.assertRaisesRegex(bundle.BackupError, "page bound"):
                bundle.inventory(self.storage, "ezkart-beta-private", 2, 10, 1024)

    def test_restore_rejects_archive_traversal_and_duplicate_members(self):
        for label, names in (("traversal", ["../outside"]), ("duplicate", ["same", "same"]), ("link", ["link"])):
            with self.subTest(label=label):
                archive = self.state / (label + ".tar.gz")
                with tarfile.open(archive, "w:gz") as handle:
                    for name in names:
                        item = tarfile.TarInfo(name)
                        if label == "link":
                            item.type = tarfile.SYMTYPE
                            item.linkname = "/tmp/unsafe"
                        handle.addfile(item)
                output = self.state / label
                output.mkdir(mode=0o700)
                with self.assertRaises(bundle.BackupError):
                    bundle.unpack_verified(archive, output, "beta")
                self.assertEqual(list(output.iterdir()), [])

    def test_deadline_and_failure_state_release_lock(self):
        original = self.storage.upload_new
        def delayed(*args):
            original(*args)
            signal.raise_signal(signal.SIGALRM)
        with patch.object(self.storage, "upload_new", side_effect=delayed):
            with self.assertRaisesRegex(bundle.BackupError, "deadline"):
                with bundle.bounded(10):
                    self.archive()
        failed = next((self.state / "beta").iterdir())
        self.assertFalse((failed / "receipt.json").exists())
        self.assertEqual(bundle.read_json(failed / "incomplete.json")["stage"], "upload_intent")
        with bundle.locked(self.state, "beta"):
            pass

    def test_retention_requires_newest_readback_and_keeps_two_most_recent_successes(self):
        first, second = self.archive(), self.archive()
        third = self.archive(keep=2)
        self.assertEqual(self.storage.deletions, [("ezkart-beta-private", bundle.object_key("beta", first["runId"]))])
        self.assertIn(("ezkart-beta-private", bundle.object_key("beta", second["runId"])), self.storage.objects)
        del self.storage.objects["ezkart-beta-private", bundle.object_key("beta", third["runId"])]
        with self.assertRaises(FileNotFoundError):
            bundle.retain(self.storage, self.state / "beta", "beta", third["runId"], 1)
        self.assertEqual(len(self.storage.deletions), 1)

    def test_unauthenticated_cms_downgrade_is_rejected_before_decryption(self):
        plaintext = self.state / "fixture.txt"
        cipher = self.state / "cbc.cms"
        bundle.save_bytes(plaintext, b"offline fixture")
        bundle.openssl(["cms", "-encrypt", "-binary", "-aes-256-cbc", "-in", str(plaintext),
                        "-outform", "DER", "-out", str(cipher), str(self.cert)])
        with self.assertRaises(bundle.BackupError):
            bundle.authenticated_envelope(cipher)

    def test_rest_adapter_uses_conditional_upload_and_rejects_truncated_inventory(self):
        with patch.dict(os.environ, {"CLOUDFLARE_ACCOUNT_ID": "a" * 32, "CLOUDFLARE_API_TOKEN": "offline-fixture"}):
            adapter = bundle.CloudflareStorage("beta")
        payload = self.state / "cipher.cms"
        bundle.save_bytes(payload, b"encrypted fixture")
        key = bundle.object_key("beta", "20000101T000000Z-" + "e" * 32)
        calls = []
        def request(url, method="GET", data=None, extra=None):
            calls.append((url, method, extra))
            if method == "GET":
                raise FileNotFoundError()
            self.assertEqual(data.read(), b"encrypted fixture")
            return io.BytesIO(b'{"success":true}')
        with patch.object(adapter, "request", side_effect=request):
            adapter.upload_new("ezkart-beta-private", key, payload)
        self.assertEqual([call[1] for call in calls], ["GET", "PUT"])
        self.assertEqual(calls[1][2]["If-None-Match"], "*")
        self.assertIn("operations%2Fbackups%2F", calls[1][0])
        truncated = {"success": True, "result": [], "result_info": {"is_truncated": True}}
        with patch.object(adapter, "request", return_value=io.BytesIO(json.dumps(truncated).encode())):
            with self.assertRaisesRegex(bundle.BackupError, "continuation cursor"):
                adapter.list_page("ezkart-beta-private", None)
        with patch.object(adapter, "request", return_value=io.BytesIO(b"existing ciphertext")) as request_mock:
            with self.assertRaisesRegex(bundle.BackupError, "already exists"):
                adapter.upload_new("ezkart-beta-private", key, payload)
            self.assertEqual(request_mock.call_count, 1)

    def test_storage_environment_mismatch_fails_before_database_export(self):
        with self.assertRaisesRegex(bundle.BackupError, "environment"):
            bundle.archive("beta", self.state, self.cert, FakeStorage("test"), self.remote)
        self.assertEqual(self.calls, [])


if __name__ == "__main__":
    unittest.main()
