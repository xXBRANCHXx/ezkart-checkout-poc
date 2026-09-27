import importlib.util
from contextlib import closing
from contextlib import redirect_stderr
import io
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("workbench_backup", Path(__file__).with_name("workbench-backup.py"))
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)

SQL = """PRAGMA foreign_keys=OFF;
CREATE TABLE wallets(id TEXT PRIMARY KEY, state TEXT NOT NULL, original_reference TEXT NOT NULL);
INSERT INTO wallets VALUES('original-wallet', 'uncertain', 'original-reference');
CREATE TABLE attempts(id INTEGER PRIMARY KEY, wallet TEXT REFERENCES wallets(id), amount INTEGER, body BLOB, note TEXT);
INSERT INTO attempts VALUES(1,'original-wallet',9007199254740991,X'0001ff','Mini 60 ml; sample 50 ml — it''s unchanged');
CREATE TRIGGER immutable_attempt BEFORE UPDATE ON attempts BEGIN SELECT RAISE(ABORT,'immutable'); END;
CREATE VIEW uncertain_wallets AS SELECT id FROM wallets WHERE state='uncertain';
CREATE TABLE observations(value TEXT, amount REAL);
INSERT INTO observations VALUES(NULL,-12.5),(NULL,-12.5);
"""


class BackupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="ezkart-backup-test-")
        self.addCleanup(self.temp.cleanup)
        self.output = Path(self.temp.name) / "backup"
        self.calls = []
        self.sql = SQL
        self.identity = {"uuid": backup.TARGETS["beta"][1], "name": backup.TARGETS["beta"][0]}

    def run_remote(self, args):
        self.calls.append(args)
        self.assertIn("beta", args)
        if args[:2] == ["d1", "info"]:
            return json.dumps(self.identity)
        if args[:3] == ["d1", "time-travel", "info"]:
            return json.dumps({"bookmark": "original-bookmark"})
        if args[:2] == ["d1", "export"]:
            self.assertEqual(args[2], backup.TARGETS["beta"][1])
            self.assertIn("--remote", args)
            Path(args[args.index("--output") + 1]).write_text(self.sql)
            return "Export complete"
        self.fail("Unexpected remote command")

    def create(self):
        return backup.snapshot("beta", self.output, self.run_remote)

    def test_original_unknown_attempt_and_exact_sql_values_survive_offline_rehearsal(self):
        result = self.create()
        self.assertEqual(result["tables"], 3)
        self.assertFalse(result["remoteRestorePerformed"])
        self.assertEqual(len(self.calls), 4)
        for path in self.output.iterdir():
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.output.stat().st_mode & 0o777, 0o700)
        with closing(sqlite3.connect(self.output / "rehearsal.sqlite")) as db:
            self.assertEqual(db.execute("SELECT * FROM wallets").fetchone(), ("original-wallet", "uncertain", "original-reference"))
            self.assertEqual(db.execute("SELECT amount,body,note FROM attempts").fetchone(),
                             (9007199254740991, b"\x00\x01\xff", "Mini 60 ml; sample 50 ml — it's unchanged"))
            self.assertEqual(db.execute("SELECT * FROM observations").fetchall(), [(None, -12.5), (None, -12.5)])
            with self.assertRaisesRegex(sqlite3.IntegrityError, "immutable"):
                db.execute("UPDATE attempts SET amount=0")
        verified = backup.verify(self.output)
        self.assertFalse(verified["networkUsed"])
        self.assertEqual(len(self.calls), 4)
        self.assertFalse(list(self.output.glob(".verify-*")))

    def test_main_and_mismatched_database_are_rejected_before_export(self):
        with self.assertRaises(backup.BackupError):
            backup.snapshot("production", self.output, self.run_remote)
        self.assertFalse(self.output.exists())
        self.assertEqual(self.calls, [])
        self.identity["uuid"] = "wrong-database"
        with self.assertRaises(backup.BackupError):
            self.create()
        self.assertEqual(len(self.calls), 1)
        self.assertFalse((self.output / "database.sql").exists())
        self.assertFalse((self.output / "receipt.json").exists())
        self.assertEqual(json.loads((self.output / "incomplete.json").read_text())["stage"], "identity")

    def test_ambiguous_cli_selection_is_rejected_before_any_backup(self):
        with redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            backup.main(["create", "--deployment=beta", "--deployment=test", "--output=" + str(self.output)])
        self.assertFalse(self.output.exists())

    def test_malformed_export_and_missing_parent_never_get_success_receipts(self):
        for name, sql in (("truncated", SQL + "INSERT INTO wallets VALUES("),
                          ("foreign-key", SQL.replace("1,'original-wallet'", "1,'missing-wallet'"))):
            with self.subTest(name=name):
                self.output = Path(self.temp.name) / name
                self.sql = sql
                with self.assertRaises(backup.BackupError):
                    self.create()
                self.assertFalse((self.output / "receipt.json").exists())
                self.assertEqual(json.loads((self.output / "incomplete.json").read_text())["stage"], "local_restore")

    def test_changed_backup_bytes_are_detected_without_network(self):
        self.create()
        with (self.output / "database.sql").open("a") as handle:
            handle.write("\n-- changed after backup\n")
        with self.assertRaisesRegex(backup.BackupError, "SHA-256"):
            backup.verify(self.output)
        self.assertEqual(len(self.calls), 4)

    def test_potential_provider_export_precision_loss_cannot_be_certified(self):
        self.sql = SQL.replace('9007199254740991', '9007199254740993')
        with self.assertRaisesRegex(backup.BackupError, "exact integer range"):
            self.create()
        self.assertFalse((self.output / "receipt.json").exists())

    def test_existing_output_symlink_and_non_private_files_are_rejected(self):
        self.create()
        with self.assertRaises(FileExistsError):
            self.create()
        (self.output / "database.sql").chmod(0o644)
        with self.assertRaises(backup.BackupError):
            backup.verify(self.output)
        link = Path(self.temp.name) / "link"
        link.symlink_to(self.output, target_is_directory=True)
        with self.assertRaises(backup.BackupError):
            backup.verify(link)
        with self.assertRaises(backup.BackupError):
            backup.private_directory(backup.ROOT / "must-not-create", create=True)
        self.assertFalse((backup.ROOT / "must-not-create").exists())

    def test_sql_cannot_attach_another_database_or_enable_writable_schema(self):
        for name, sql in (("attach", "ATTACH DATABASE 'outside.sqlite' AS outside;"),
                          ("pragma", "PRAGMA writable_schema=ON;"),
                          ("extension", "SELECT load_extension('private-extension');")):
            with self.subTest(name=name):
                self.output = Path(self.temp.name) / name
                self.sql = sql + SQL
                with self.assertRaises(backup.BackupError):
                    self.create()
                self.assertFalse((self.output / "receipt.json").exists())

    def test_lost_export_response_is_incomplete_and_never_retried(self):
        def interrupted(args):
            result = self.run_remote(args)
            if args[:2] == ["d1", "export"]:
                raise backup.BackupError("Export result unknown")
            return result
        with self.assertRaises(backup.BackupError):
            backup.snapshot("beta", self.output, interrupted)
        self.assertEqual(len([a for a in self.calls if a[:2] == ["d1", "export"]]), 1)
        self.assertFalse((self.output / "receipt.json").exists())
        self.assertEqual(json.loads((self.output / "incomplete.json").read_text())["stage"], "export")


if __name__ == "__main__":
    os.umask(0o077)
    unittest.main()
