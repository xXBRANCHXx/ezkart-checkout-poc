#!/usr/bin/env python3
"""Export only an identified workbench database and rehearse restoration locally."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import stat
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
WORKER = ROOT / "cloudflare/ezkart-api"
TARGETS = {
    "test": ("ezkart_test_database", "2595f8c1-3e25-422f-9197-91d50a90e131"),
    "beta": ("ezkart_beta_database", "27bb47cf-c0f0-463c-94e3-44b9b27edcf4"),
}
MAX_EXPORT_BYTES = 512 * 1024 * 1024


class BackupError(Exception):
    pass


class Once(argparse.Action):
    def __call__(self, parser, namespace, value, option_string=None):
        marker = "_provided_" + self.dest
        if getattr(namespace, marker, False):
            raise argparse.ArgumentError(self, "specify this option once")
        setattr(namespace, marker, True)
        setattr(namespace, self.dest, value)


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def private_directory(path, create=False):
    path = Path(path)
    if not path.is_absolute() or path != path.resolve() or path.is_relative_to(ROOT):
        raise BackupError("Use an absolute, non-symlink private directory outside the repository.")
    if create:
        path.mkdir(mode=0o700)  # Exclusive: never reuse or overwrite an earlier backup.
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o700:
        raise BackupError("The backup directory must be owned by this user with mode 0700.")
    return path


def private_file(path):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o600:
        raise BackupError("Backup files must be regular, single-link files owned by this user with mode 0600.")
    return info


def save_json(path, data):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "w") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())


def digest(path):
    info = private_file(path)
    with path.open("rb") as handle:
        value = hashlib.file_digest(handle, "sha256").hexdigest()
    return {"bytes": info.st_size, "sha256": value}


def command(args):
    try:
        result = subprocess.run(
            ["node", str(WORKER / "node_modules/wrangler/bin/wrangler.js"), *args],
            cwd=WORKER, capture_output=True, text=True, timeout=300, check=True,
            stdin=subprocess.DEVNULL,
        )
        return result.stdout
    except (OSError, subprocess.SubprocessError):
        # Provider/CLI output can contain private URLs or data. Do not echo it.
        raise BackupError("The Cloudflare read/export did not complete. No remote restore was requested.") from None


def read_json(run, args):
    try:
        return json.loads(run(args))
    except (ValueError, TypeError):
        raise BackupError("The Cloudflare response could not be verified.") from None


def quoted(name):
    return '"' + name.replace('"', '""') + '"'


def rehearse(sql_path, database_path):
    size = private_file(sql_path).st_size
    if size == 0 or size > MAX_EXPORT_BYTES:
        raise BackupError("The SQL export is empty or exceeds the 512 MiB local rehearsal limit.")
    descriptor = os.open(database_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    os.close(descriptor)
    connection = sqlite3.connect(database_path)
    try:
        def authorize(action, first, second, database, trigger):
            if action in (sqlite3.SQLITE_ATTACH, sqlite3.SQLITE_DETACH):
                return sqlite3.SQLITE_DENY
            if action == sqlite3.SQLITE_PRAGMA and first.lower() not in ("foreign_keys", "defer_foreign_keys"):
                return sqlite3.SQLITE_DENY
            if action == sqlite3.SQLITE_FUNCTION and (second or "").lower() in ("load_extension", "writefile", "readfile"):
                return sqlite3.SQLITE_DENY
            return sqlite3.SQLITE_OK

        connection.set_authorizer(authorize)
        connection.executescript(sql_path.read_text(encoding="utf-8"))
        connection.commit()
        connection.set_authorizer(None)
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("PRAGMA query_only=ON")
        if connection.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
            raise BackupError("The local restore failed its integrity check.")
        if connection.execute("PRAGMA foreign_key_check").fetchone() is not None:
            raise BackupError("The local restore has a foreign-key violation.")
        schema = connection.execute("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY type,name").fetchall()
        tables, row_digests, large_numbers = {}, {}, []
        for (name,) in connection.execute("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"):
            hashes = []
            for row in connection.execute("SELECT * FROM " + quoted(name)):
                encoded = []
                for value in row:
                    if isinstance(value, (int, float)) and abs(value) > 9007199254740991 and name not in large_numbers:
                        large_numbers.append(name)
                    encoded.append([type(value).__name__, value.hex() if isinstance(value, (bytes, float)) else str(value)])
                hashes.append(hashlib.sha256(json.dumps(encoded, ensure_ascii=False, separators=(",", ":")).encode()).digest())
            tables[name] = len(hashes)
            row_digests[name] = hashlib.sha256(b"".join(sorted(hashes))).hexdigest()
        if not tables:
            raise BackupError("The SQL export contains no application tables.")
        return {
            "integrity": "ok", "foreignKeyErrors": 0, "tables": tables,
            "rowSha256": row_digests, "largeNumericTables": large_numbers,
            "schemaSha256": hashlib.sha256(json.dumps(schema, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest(),
        }
    except (sqlite3.Error, UnicodeError):
        raise BackupError("The SQL export could not be restored locally. Its contents were not printed.") from None
    finally:
        connection.close()


def snapshot(deployment, output, run=command):
    if deployment not in TARGETS:
        raise BackupError("Only explicit test or beta backups are supported; main is excluded.")
    name, identity = TARGETS[deployment]
    directory = private_directory(output, create=True)
    started = now()
    stage = "identity"
    try:
        info = read_json(run, ["d1", "info", identity, "--env", deployment, "--json"])
        if info.get("uuid") != identity or info.get("name") != name:
            raise BackupError("The remote database identity does not match the selected workbench environment.")
        stage = "bookmark_before"
        before = read_json(run, ["d1", "time-travel", "info", identity, "--env", deployment, "--json"])
        if not isinstance(before, dict) or not isinstance(before.get("bookmark"), str) or not before["bookmark"]:
            raise BackupError("The recovery bookmark could not be verified.")
        stage = "export"
        sql = directory / "database.sql"
        run(["d1", "export", identity, "--env", deployment, "--remote", "--skip-confirmation", "--output", str(sql)])
        # The enclosing directory is private even if the CLI's file mode is wider.
        if sql.is_symlink() or not sql.is_file() or sql.stat().st_nlink != 1:
            raise BackupError("The export did not create a regular private SQL file.")
        sql.chmod(0o600)
        with sql.open("rb") as handle:
            os.fsync(handle.fileno())
        stage = "bookmark_after"
        after = read_json(run, ["d1", "time-travel", "info", identity, "--env", deployment, "--json"])
        if not isinstance(after, dict) or not isinstance(after.get("bookmark"), str) or not after["bookmark"]:
            raise BackupError("The post-export recovery bookmark could not be verified.")
        stage = "local_restore"
        restored = directory / "rehearsal.sqlite"
        proof = rehearse(sql, restored)
        if proof["largeNumericTables"]:
            raise BackupError("The export has numeric values beyond JavaScript's exact integer range; native recovery or an exact-value export is required.")
        stage = "receipt"
        receipt = {
            "version": 1, "status": "verified_local_restore", "deployment": deployment,
            "database": {"name": name, "uuid": identity}, "startedAt": started, "completedAt": now(),
            "bookmarkBefore": before["bookmark"], "bookmarkAfter": after["bookmark"],
            "bookmarkChanged": before["bookmark"] != after["bookmark"],
            "files": {"database.sql": digest(sql), "rehearsal.sqlite": digest(restored)},
            "restore": proof, "remoteRestorePerformed": False,
            "coverage": "D1 SQL export and local SQLite restoration only; excludes R2 bytes, Supabase Auth, hosting configuration and secrets.",
        }
        save_json(directory / "receipt.json", receipt)
        descriptor = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
        return {"status": receipt["status"], "deployment": deployment, "directory": str(directory),
                "tables": len(proof["tables"]), "sql": receipt["files"]["database.sql"],
                "bookmarkChanged": receipt["bookmarkChanged"], "remoteRestorePerformed": False}
    except Exception as error:
        save_json(directory / "incomplete.json", {"status": "incomplete", "stage": stage, "deployment": deployment,
                  "reason": str(error) if isinstance(error, BackupError) else type(error).__name__, "at": now()})
        raise


def verify(directory):
    directory = private_directory(directory)
    private_file(directory / "receipt.json")
    try:
        receipt = json.loads((directory / "receipt.json").read_text())
        target = TARGETS[receipt["deployment"]]
        if receipt["version"] != 1 or receipt["status"] != "verified_local_restore" or receipt["database"] != {"name": target[0], "uuid": target[1]}:
            raise ValueError()
        for name in ("database.sql", "rehearsal.sqlite"):
            if digest(directory / name) != receipt["files"][name]:
                raise BackupError("The backup file no longer matches its recorded size and SHA-256.")
        with tempfile.TemporaryDirectory(prefix=".verify-", dir=directory) as scratch:
            proof = rehearse(directory / "database.sql", Path(scratch) / "restored.sqlite")
        if proof != receipt["restore"]:
            raise BackupError("The new local restoration differs from its original receipt.")
        return {"status": "verified_local_restore", "deployment": receipt["deployment"],
                "directory": str(directory), "tables": len(proof["tables"]), "networkUsed": False}
    except (KeyError, TypeError, ValueError):
        raise BackupError("The backup receipt is invalid.") from None


def main(args=None):
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    commands = parser.add_subparsers(dest="action", required=True)
    backup = commands.add_parser("create", allow_abbrev=False)
    backup.add_argument("--deployment", choices=tuple(TARGETS), required=True, action=Once)
    backup.add_argument("--output", required=True, action=Once, help="New 0700 directory outside the repository; parent must exist")
    check = commands.add_parser("verify", allow_abbrev=False)
    check.add_argument("--directory", required=True, action=Once)
    options = parser.parse_args(args)
    return snapshot(options.deployment, options.output) if options.action == "create" else verify(options.directory)


if __name__ == "__main__":
    os.umask(0o077)
    try:
        print(json.dumps(main(), indent=2))
    except BackupError as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
    except OSError:
        # Do not print SQL, provider output, paths embedded in OS errors or credentials.
        print("Backup/rehearsal was not confirmed. Check arguments, access and the private incomplete.json stage; no remote restore was requested.", file=sys.stderr)
        sys.exit(1)
