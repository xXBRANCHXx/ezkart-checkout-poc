"""Offline scheduling and real S3 wire-shape fixtures; never contacts a provider."""
import datetime
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from http.server import BaseHTTPRequestHandler, HTTPServer
from threading import Thread

spec = importlib.util.spec_from_file_location("runner", Path(__file__).with_name("workbench-backup-runner.py"))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)
bundle = runner.bundle
ENV = {"CLOUDFLARE_ACCOUNT_ID": "a" * 32, "R2_ACCESS_KEY_ID": "fixture", "R2_SECRET_ACCESS_KEY": "fixture-secret"}


class RunnerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.state = Path(self.temp.name)
        self.config = {"deployment": "beta", "stateDirectory": str(self.state), "certificate": str(self.state / "public.pem"),
                       "intervalSeconds": 86400, "retrySeconds": 3600, "graceSeconds": 3600,
                       "timeoutSeconds": 10, "retain": 0, "limits": dict(bundle.DEFAULT_LIMITS)}
        self.time = 1800000000
        self.calls = []

    def tearDown(self):
        self.temp.cleanup()

    def execute(self, config, run_id):
        self.calls.append(run_id)
        root = self.state / "beta" / run_id
        root.mkdir(mode=0o700, parents=True)
        (self.state / "beta").chmod(0o700)
        proof = {"bytes": 10, "sha256": "a" * 64}
        receipt = {"tool": bundle.TOOL, "version": 1, "status": "verified_encrypted_readback", "deployment": "beta",
                   "runId": run_id, "bucket": "ezkart-beta-private", "key": bundle.object_key("beta", run_id),
                   "database": list(bundle.db.TARGETS["beta"]), "ciphertext": proof, "archive": proof,
                   "completedAt": runner.iso(self.time)}
        bundle.atomic_json(root / "receipt.json", receipt)

    def run_once(self, execute=None):
        return runner.run_once(self.config, execute or self.execute, now=lambda: self.time)

    def test_due_success_missed_runs_coalesce_and_report_is_read_only(self):
        first = runner.report(self.config, self.time)
        self.assertTrue(first["due"])
        self.assertIn("backup_runner_not_observed", first["warnings"])
        self.assertFalse(runner.location(self.config).exists())
        result = self.run_once()
        self.assertEqual(result["status"], "succeeded")
        self.assertEqual(result["warnings"], [])
        self.time += 300
        self.assertEqual(self.run_once()["status"], "not_due")
        self.assertEqual(len(self.calls), 1)
        self.time += 10 * 86400
        status_path = runner.location(self.config) / "status.json"
        original = status_path.read_bytes()
        self.assertIn("backup_overdue", runner.report(self.config, self.time)["warnings"])
        self.assertEqual(status_path.read_bytes(), original)
        self.run_once()
        self.assertEqual(len(self.calls), 2)
        self.assertEqual(self.run_once()["status"], "not_due")

    def test_failure_preserves_last_success_and_throttles_fresh_attempts(self):
        self.run_once()
        first = self.calls[0]
        self.time += 86401
        def fail(config, run_id):
            self.calls.append(run_id)
            raise bundle.BackupError("secret provider body must not be recorded")
        result = self.run_once(fail)
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["lastSuccess"]["runId"], first)
        self.assertNotIn("secret", json.dumps(result))
        original_failure = result["lastFailure"]
        self.assertEqual(self.run_once()["status"], "not_due")
        self.time += 3601
        recovered = self.run_once()
        self.assertEqual(recovered["lastFailure"], original_failure)
        self.assertEqual(len(set(self.calls)), 3)
        evidence = runner.location(self.config) / (original_failure["runId"] + ".json")
        self.assertEqual(bundle.read_json(evidence)["status"], "failed")

    def test_retention_failure_still_reports_verified_copy(self):
        def retention_failure(config, run_id):
            self.execute(config, run_id)
            raise bundle.BackupError("Lost deletion acknowledgement")
        result = self.run_once(retention_failure)
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["lastSuccess"]["runId"], self.calls[0])
        self.assertIn("backup_failed", result["warnings"])

    def test_crash_reconciles_only_local_receipt_never_retries_original(self):
        self.run_once()
        status = runner.load_status(self.config)
        original = status["lastAttempt"]["runId"]
        status["lastAttempt"]["status"] = "running"
        del status["lastAttempt"]["finishedAt"]
        bundle.atomic_json(runner.location(self.config) / "status.json", status)
        self.time += 30
        self.assertIn("backup_interrupted", runner.report(self.config, self.time)["warnings"])
        result = self.run_once()
        self.assertEqual(result["status"], "not_due")
        self.assertEqual(result["lastFailure"]["status"], "interrupted")
        self.assertEqual(len(self.calls), 1)
        self.time += 3601
        self.run_once()
        self.assertNotEqual(self.calls[-1], original)

    def test_overlap_does_not_write_state_or_execute(self):
        with runner.runner_lock(self.config):
            self.assertEqual(self.run_once()["status"], "overlap_skipped")
        self.assertEqual(self.calls, [])
        self.assertFalse(runner.location(self.config).exists())

    def test_missing_credentials_becomes_durable_failure(self):
        with patch.dict(os.environ, {}, clear=True):
            result = self.run_once(runner.execute)
        self.assertEqual(result["status"], "failed")
        self.assertIn("backup_never_succeeded", result["warnings"])
        self.assertFalse((self.state / "beta").exists())

    def test_success_without_receipt_is_failure(self):
        result = self.run_once(lambda *args: {"status": "success"})
        self.assertEqual(result["status"], "failed")
        self.assertIsNone(result["lastSuccess"])

    def test_deadline_is_recorded_and_lock_released(self):
        import signal
        result = self.run_once(lambda *args: signal.raise_signal(signal.SIGALRM))
        self.assertEqual(result["status"], "failed")
        with runner.runner_lock(self.config) as acquired:
            self.assertTrue(acquired)

    def test_invalid_config_and_state_are_not_healthy(self):
        path = self.state / "config.json"
        bundle.atomic_json(path, {**self.config, "retain": -1})
        with self.assertRaises(bundle.BackupError):
            runner.configuration(path)
        self.run_once()
        status_path = runner.location(self.config) / "status.json"
        bundle.atomic_json(status_path, {"version": 1, "deployment": "test"})
        with self.assertRaises(bundle.BackupError):
            runner.report(self.config, self.time)


class S3Tests(unittest.TestCase):
    def setUp(self):
        with patch.dict(os.environ, ENV):
            self.storage = bundle.CloudflareStorage("beta")

    def test_sigv4_matches_official_aws_known_answer(self):
        # Public example credentials and expected signature from AWS S3 Developer Guide.
        self.storage.access_key = "AKIAIOSFODNN7EXAMPLE"
        self.storage.secret_key = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
        headers = self.storage.signed_headers("https://examplebucket.s3.amazonaws.com/test.txt", "GET",
                    hashlib.sha256(b"").hexdigest(), {"Range": "bytes=0-9"},
                    datetime.datetime(2013, 5, 24, tzinfo=datetime.timezone.utc), region="us-east-1")
        self.assertTrue(headers["Authorization"].endswith("Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41"))

    def test_list_xml_cursor_encoding_metadata_and_fail_closed(self):
        xml = b'''<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>ezkart-beta-public</Name><EncodingType>url</EncodingType><IsTruncated>true</IsTruncated><NextContinuationToken>a+/=</NextContinuationToken><Contents><Key>folder/caf%C3%A9%2B%20%252F.bin</Key><Size>2</Size><ETag>"hash"</ETag><LastModified>2026-09-28T00:00:00Z</LastModified><StorageClass>STANDARD</StorageClass></Contents></ListBucketResult>'''
        with patch.object(self.storage, "request", return_value=io.BytesIO(xml)) as request:
            rows, cursor = self.storage.list_page("ezkart-beta-public", "a+/=")
        self.assertEqual(cursor, "a+/=")
        self.assertEqual(rows[0]["key"], "folder/café+ %2F.bin")
        self.assertEqual(rows[0]["last_modified"], "2026-09-28T00:00:00Z")
        self.assertEqual(request.call_args.args[0].split("?")[1], "continuation-token=a%2B%2F%3D&encoding-type=url&list-type=2&max-keys=1000")
        for invalid in (xml.replace(b"<IsTruncated>true</IsTruncated>", b""), xml.replace(b"ezkart-beta-public", b"ezkart-test-public"), b'{"success":true}', b'<!DOCTYPE x><x/>'):
            with patch.object(self.storage, "request", return_value=io.BytesIO(invalid)):
                with self.assertRaises(bundle.BackupError):
                    self.storage.list_page("ezkart-beta-public", None)

    def test_wire_upload_is_raw_signed_conditional_and_delete_ack_is_empty(self):
        requests = []
        class Handler(BaseHTTPRequestHandler):
            def do_HEAD(self):
                requests.append(("HEAD", self.path, dict(self.headers), b""))
                self.send_response(404)
                self.end_headers()
            def do_PUT(self):
                body = self.rfile.read(int(self.headers["Content-Length"]))
                requests.append(("PUT", self.path, dict(self.headers), body))
                self.send_response(200)
                self.send_header("ETag", '"fixture"')
                self.end_headers()
            def do_DELETE(self):
                requests.append(("DELETE", self.path, dict(self.headers), b""))
                self.send_response(204)
                self.end_headers()
            def log_message(self, *args):
                pass
        with HTTPServer(("127.0.0.1", 0), Handler) as server, tempfile.TemporaryDirectory() as scratch:
            thread = Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                self.storage.base = f"http://127.0.0.1:{server.server_port}"
                path = Path(scratch) / "cipher"
                bundle.save_bytes(path, b"raw encrypted fixture")
                key = bundle.object_key("beta", "20260928T000000Z-" + "a" * 32)
                self.storage.upload_new("ezkart-beta-private", key, path)
                self.storage.delete_verified("ezkart-beta-private", key)
            finally:
                server.shutdown()
                thread.join()
        self.assertEqual([row[0] for row in requests], ["HEAD", "PUT", "DELETE"])
        headers = {k.lower(): v for k, v in requests[1][2].items()}
        self.assertEqual(requests[1][3], b"raw encrypted fixture")
        self.assertEqual(headers["if-none-match"], "*")
        self.assertNotIn("transfer-encoding", headers)
        self.assertIn("/auto/s3/aws4_request", headers["authorization"])
        self.assertIn("if-none-match", headers["authorization"])
        self.assertEqual(headers["x-amz-content-sha256"], hashlib.sha256(requests[1][3]).hexdigest())
        self.assertIn("/operations/backups/", requests[1][1])

    def test_special_keys_preserve_slashes_and_do_not_normalize(self):
        self.assertTrue(self.storage.url("ezkart-beta-private", "../a//café +%2F?").endswith("/../a//caf%C3%A9%20%2B%252F%3F"))
        for bucket, key in (("ezkart-beta-public", "products/1"), ("ezkart-beta-private", "operations/backups/old/a"), ("ezkart-test-private", "x")):
            with self.assertRaises(bundle.BackupError):
                self.storage.delete_verified(bucket, key)


if __name__ == "__main__":
    unittest.main()
