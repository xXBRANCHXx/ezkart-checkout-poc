#!/usr/bin/env python3
"""Bounded, encrypted workbench D1/R2 backups. No scheduler is installed."""
import argparse
from contextlib import contextmanager
import datetime
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import signal
import subprocess
import sys
import tarfile
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import uuid

spec = importlib.util.spec_from_file_location("database_backup", Path(__file__).with_name("workbench-backup.py"))
db = importlib.util.module_from_spec(spec)
spec.loader.exec_module(db)
BackupError = db.BackupError
TOOL = "ezkart-workbench-v1"
EXCLUDED = "operations/backups/"
RUN_ID = re.compile(r"\d{8}T\d{6}Z-[0-9a-f]{32}\Z")
MAX_BUNDLE = 2 * 1024 ** 3
MAX_MANIFEST = 16 * 1024 ** 2


def require(condition, message):
    if not condition:
        raise BackupError(message)


def buckets(deployment):
    require(deployment in db.TARGETS, "Only explicit beta or test is allowed.")
    return (f"ezkart-{deployment}-public", f"ezkart-{deployment}-private")


def object_key(deployment, run_id):
    buckets(deployment)
    require(isinstance(run_id, str) and RUN_ID.fullmatch(run_id), "Invalid backup run identity.")
    return f"{EXCLUDED}{TOOL}/{deployment}/{run_id}/snapshot.cms"


def atomic_json(path, value):
    temporary = path.with_name("." + path.name + "-" + uuid.uuid4().hex)
    db.save_json(temporary, value)
    os.replace(temporary, path)
    descriptor = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def read_json(path, limit=MAX_MANIFEST):
    require(db.private_file(path).st_size <= limit, "Private record exceeds its limit.")
    try:
        return json.loads(path.read_text())
    except (ValueError, UnicodeError):
        raise BackupError("Invalid private JSON record.") from None


def save_bytes(path, body):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "wb") as handle:
        handle.write(body)
        handle.flush()
        os.fsync(handle.fileno())


@contextmanager
def locked(state, deployment):
    buckets(deployment)
    state = db.private_directory(state)
    path = state / ("." + deployment + ".lock")
    descriptor = os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        db.private_file(path)
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise BackupError("Another backup holds this environment's exclusive lock.") from None
        root = state / deployment
        if not root.exists():
            root.mkdir(mode=0o700)
        yield db.private_directory(root)
    finally:
        os.close(descriptor)  # Never unlink a lock file: waiters must share one inode.


@contextmanager
def bounded(seconds):
    require(1 <= seconds <= 86400, "Deadline must be between 1 and 86400 seconds.")
    def expired(signum, frame):
        raise BackupError("Backup deadline exceeded; inspect private state before recovery.")
    previous = signal.signal(signal.SIGALRM, expired)
    signal.setitimer(signal.ITIMER_REAL, seconds)
    try:
        yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous)


class CloudflareStorage:
    """REST adapter; credentials are supplied by the scheduler's environment only."""
    def __init__(self, deployment):
        self.deployment = deployment
        self.buckets = buckets(deployment)
        account = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "")
        token = os.environ.get("CLOUDFLARE_API_TOKEN", "")
        require(re.fullmatch(r"[0-9a-f]{32}", account) and token, "Supply CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN.")
        self.base = f"https://api.cloudflare.com/client/v4/accounts/{account}/r2/buckets/"
        self.headers = {"Authorization": "Bearer " + token, "User-Agent": TOOL}

    def url(self, bucket, key=None):
        require(bucket in self.buckets, "Bucket is outside the selected workbench environment.")
        url = self.base + bucket + "/objects"
        if key is not None:
            require(isinstance(key, str) and key and "\x00" not in key, "Invalid object key.")
            url += "/" + urllib.parse.quote(key, safe="")
        return url

    def writable(self, bucket, key):
        prefix = f"{EXCLUDED}{TOOL}/{self.deployment}/"
        require(bucket == self.buckets[1] and key.startswith(prefix), "Refusing a write outside the private backup prefix.")
        run_id = key[len(prefix):].removesuffix("/snapshot.cms")
        require(key == object_key(self.deployment, run_id), "Refusing an arbitrary backup path.")

    def request(self, url, method="GET", data=None, extra=None):
        request = urllib.request.Request(url, method=method, data=data, headers={**self.headers, **(extra or {})})
        try:
            return urllib.request.urlopen(request, timeout=40)
        except urllib.error.HTTPError as error:
            code = error.code
            error.close()
            if code == 404:
                raise FileNotFoundError("Object absent") from None
            raise BackupError("Storage request was not acknowledged; private run state is retained.") from None
        except (OSError, urllib.error.URLError):
            raise BackupError("Storage request failed; private run state is retained.") from None

    def list_page(self, bucket, cursor):
        query = {"per_page": 1000}
        if cursor:
            query["cursor"] = cursor
        with self.request(self.url(bucket) + "?" + urllib.parse.urlencode(query)) as response:
            raw = response.read(8 * 1024 ** 2 + 1)
        require(len(raw) <= 8 * 1024 ** 2, "Storage listing exceeded its bound.")
        value = json.loads(raw)
        require(value.get("success") is True and isinstance(value.get("result"), list), "Storage inventory did not succeed.")
        info = value.get("result_info", {})
        if info.get("is_truncated", False):
            require(isinstance(info.get("cursor"), str) and info["cursor"], "Truncated inventory has no continuation cursor.")
            return value["result"], info["cursor"]
        return value["result"], None

    def download(self, bucket, key, path, limit):
        with self.request(self.url(bucket, key)) as response:
            descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            with os.fdopen(descriptor, "wb") as handle:
                size = 0
                while chunk := response.read(min(1024 ** 2, limit - size + 1)):
                    size += len(chunk)
                    require(size <= limit, "Storage object exceeds its download bound.")
                    handle.write(chunk)
                handle.flush()
                os.fsync(handle.fileno())
            return {k.lower(): v for k, v in response.headers.items()}

    def upload_new(self, bucket, key, path):
        self.writable(bucket, key)
        try:
            with self.request(self.url(bucket, key)):
                pass
        except FileNotFoundError:
            pass
        else:
            raise BackupError("Backup key already exists; nothing overwritten.")
        with path.open("rb") as source, self.request(self.url(bucket, key), "PUT", source, {
            "Content-Length": str(db.private_file(path).st_size),
            "Content-Type": "application/pkcs7-mime", "If-None-Match": "*",
        }) as response:
            raw = response.read(1024 ** 2 + 1)
            require(len(raw) <= 1024 ** 2 and json.loads(raw).get("success") is True, "Upload acknowledgement is unknown; use recover, never retry this upload.")

    def delete_verified(self, bucket, key):
        self.writable(bucket, key)
        with self.request(self.url(bucket, key), "DELETE") as response:
            raw = response.read(1024 ** 2 + 1)
            require(len(raw) <= 1024 ** 2 and json.loads(raw).get("success") is True, "Retention deletion was not acknowledged.")


def inventory(storage, bucket, max_pages, max_objects, max_object_bytes):
    rows, keys, cursors, cursor = [], set(), set(), None
    for _ in range(max_pages):
        page, next_cursor = storage.list_page(bucket, cursor)
        require(isinstance(page, list), "Invalid inventory page.")
        for row in page:
            key = row.get("key")
            require(isinstance(key, str) and key and key not in keys, "Invalid or repeated inventory key.")
            keys.add(key)
            # Includes old one-off snapshots and every nested backup generation.
            if key == EXCLUDED.rstrip("/") or key.startswith(EXCLUDED):
                continue
            size = row.get("size")
            require(isinstance(size, (str, int)) and str(size).isdigit() and 0 <= int(size) <= max_object_bytes,
                    "Asset size is invalid or exceeds its bound.")
            require(isinstance(row.get("etag"), str) and row["etag"], "Asset has no version ETag.")
            rows.append(row)
            require(len(rows) <= max_objects, "Asset inventory exceeds its object bound.")
        if next_cursor is None:
            return sorted(rows, key=lambda row: row["key"])
        require(isinstance(next_cursor, str) and next_cursor and next_cursor not in cursors, "Storage pagination did not advance.")
        cursors.add(next_cursor)
        cursor = next_cursor
    raise BackupError("Storage inventory exceeds its page bound.")


def copy_assets(storage, deployment, source, limits):
    selected = buckets(deployment)
    before = {bucket: inventory(storage, bucket, limits["pages"], limits["objects"], limits["object_bytes"]) for bucket in selected}
    require(sum(len(rows) for rows in before.values()) <= limits["objects"], "Total asset count exceeds its bound.")
    require(sum(int(row["size"]) for rows in before.values() for row in rows) <= limits["total_bytes"], "Total asset bytes exceed their bound.")
    records = []
    for bucket, rows in before.items():
        directory = source / "r2" / bucket
        directory.mkdir(mode=0o700, parents=True)
        (source / "r2").chmod(0o700)
        for row in rows:
            target = directory / (hashlib.sha256(row["key"].encode()).hexdigest() + ".bin")
            headers = storage.download(bucket, row["key"], target, limits["object_bytes"])
            proof = db.digest(target)
            require(proof["bytes"] == int(row["size"]) and headers.get("etag", "").strip('"') == row["etag"].strip('"'), "Asset changed during download.")
            records.append({"bucket": bucket, "metadata": row, "httpHeaders": {
                k: v for k, v in headers.items() if k in ("content-type", "cache-control", "content-disposition", "content-encoding", "content-language", "expires", "last-modified") or k.startswith("x-amz-meta-")
            }, "file": str(target.relative_to(source)), **proof})
    after = {bucket: inventory(storage, bucket, limits["pages"], limits["objects"], limits["object_bytes"]) for bucket in selected}
    require(before == after, "Asset inventory changed during the snapshot.")
    db.save_json(source / "r2-manifest.json", {"objects": records, "excludedPrefix": EXCLUDED, "inventoryUnchanged": True, "databaseAtomicSnapshot": False})
    require(db.private_file(source / "r2-manifest.json").st_size <= MAX_MANIFEST, "Asset manifest exceeds its recovery bound.")
    return len(records)


def openssl(arguments):
    try:
        subprocess.run(["openssl", *arguments], stdin=subprocess.DEVNULL, capture_output=True, check=True, timeout=120)
    except (OSError, subprocess.SubprocessError):
        raise BackupError("Recovery cryptography failed; no unauthenticated plaintext may be consumed.") from None


def authenticated_envelope(path):
    """Accept our definite-length DER AuthEnvelopedData/GCM format, never CBC CMS.

    Inspect only small ASN.1 headers. OpenSSL performs the full authentication;
    this check prevents a caller-supplied receipt from downgrading the format.
    """
    size = db.private_file(path).st_size
    with path.open("rb") as stream:
        def element(offset, tag, boundary):
            require(offset < boundary <= size, "Invalid encrypted envelope boundary.")
            stream.seek(offset)
            header = stream.read(2)
            require(len(header) == 2 and header[0] == tag, "Expected an authenticated CMS envelope.")
            length = header[1]
            if length & 128:
                count = length & 127
                require(1 <= count <= 8, "Invalid DER length.")
                encoded = stream.read(count)
                require(len(encoded) == count, "Truncated DER length.")
                length = int.from_bytes(encoded, "big")
            start = stream.tell()
            require(start + length <= boundary, "Truncated encrypted envelope.")
            return start, start + length

        def oid(offset, boundary, expected):
            start, end = element(offset, 6, boundary)
            require(end - start == len(expected), "Unexpected encryption content type.")
            stream.seek(start)
            require(stream.read(len(expected)) == expected, "Only authenticated CMS AES-256-GCM is supported.")
            return end

        start, end = element(0, 0x30, size)
        require(end == size, "Trailing encrypted envelope data.")
        after_oid = oid(start, end, bytes.fromhex("2a864886f70d0109100117"))
        wrapped, wrapped_end = element(after_oid, 0xa0, end)
        content, content_end = element(wrapped, 0x30, wrapped_end)
        _, version_end = element(content, 2, content_end)
        _, recipients_end = element(version_end, 0x31, content_end)
        encrypted, encrypted_end = element(recipients_end, 0x30, content_end)
        after_data = oid(encrypted, encrypted_end, bytes.fromhex("2a864886f70d010701"))
        algorithm, algorithm_end = element(after_data, 0x30, encrypted_end)
        oid(algorithm, algorithm_end, bytes.fromhex("60864801650304012e"))


def certificate(path):
    path = Path(path)
    require(path.is_absolute() and path == path.resolve() and path.is_file() and path.stat().st_size <= 1024 ** 2,
            "Supply an absolute public recovery certificate path.")
    raw = path.read_bytes()
    require(b"PRIVATE KEY" not in raw and b"BEGIN CERTIFICATE" in raw, "Only a public recovery certificate is accepted for backup.")
    openssl(["x509", "-in", str(path), "-noout", "-checkend", "0"])
    return path


def seal(source, output, cert, deployment):
    files = sorted(path for path in source.rglob("*") if path.is_file())
    manifest = {"tool": TOOL, "version": 1, "deployment": deployment, "files": {str(path.relative_to(source)): db.digest(path) for path in files}}
    require(sum(item["bytes"] for item in manifest["files"].values()) <= MAX_BUNDLE, "Bundle exceeds its bound.")
    db.save_json(source / "bundle-manifest.json", manifest)
    require(db.private_file(source / "bundle-manifest.json").st_size <= MAX_MANIFEST, "Bundle manifest exceeds its recovery bound.")
    db.save_json(output / "bundle-manifest.json", manifest)
    db.save_json(output / "r2-manifest.json", read_json(source / "r2-manifest.json"))
    archive = output / "snapshot.tar.gz"
    with tarfile.open(archive, "x:gz") as handle:
        for path in [*files, source / "bundle-manifest.json"]:
            handle.add(path, arcname=str(path.relative_to(source)), recursive=False)
    archive.chmod(0o600)
    require(db.private_file(archive).st_size <= MAX_BUNDLE, "Archive exceeds its bound.")
    cipher = output / "snapshot.cms"
    openssl(["cms", "-encrypt", "-binary", "-aes-256-gcm", "-in", str(archive), "-outform", "DER", "-out", str(cipher),
             "-recip", str(cert), "-keyopt", "rsa_padding_mode:oaep", "-keyopt", "rsa_oaep_md:sha256"])
    cipher.chmod(0o600)
    authenticated_envelope(cipher)
    proof = db.digest(cipher)
    require(proof["bytes"] <= MAX_BUNDLE, "Ciphertext exceeds its bound.")
    return {"ciphertext": proof, "archive": db.digest(archive), "certificateSha256": hashlib.sha256(cert.read_bytes()).hexdigest()}


def validate_receipt(receipt, deployment, run_id):
    require(isinstance(receipt, dict) and receipt.get("tool") == TOOL and receipt.get("version") == 1
            and receipt.get("status") == "verified_encrypted_readback" and receipt.get("deployment") == deployment
            and receipt.get("runId") == run_id and receipt.get("bucket") == buckets(deployment)[1]
            and receipt.get("key") == object_key(deployment, run_id)
            and receipt.get("database") == list(db.TARGETS[deployment]), "Receipt does not identify this tool and environment.")
    for name in ("ciphertext", "archive"):
        proof = receipt.get(name, {})
        require(isinstance(proof.get("bytes"), int) and 0 < proof["bytes"] <= MAX_BUNDLE
                and isinstance(proof.get("sha256"), str) and re.fullmatch(r"[0-9a-f]{64}", proof["sha256"]), "Invalid receipt digest.")
    return receipt


def verify_remote(storage, receipt, parent):
    with tempfile.TemporaryDirectory(prefix=".readback-", dir=parent) as scratch:
        path = Path(scratch) / "snapshot.cms"
        storage.download(receipt["bucket"], receipt["key"], path, receipt["ciphertext"]["bytes"])
        require(db.digest(path) == receipt["ciphertext"], "Remote ciphertext does not match the exact upload SHA-256 and size.")


def remove_staging(directory, receipt):
    """Remove known plaintext staging only after a durable verified receipt exists."""
    validate_receipt(read_json(directory / "receipt.json"), receipt["deployment"], directory.name)
    archive_path = directory / "snapshot.tar.gz"
    if archive_path.exists():
        require(db.digest(archive_path) == receipt["archive"], "Changed plaintext staging retained for inspection.")
        archive_path.unlink()
    source = directory / "source"
    if source.exists():
        db.private_directory(source)
        shutil.rmtree(source)


def retain(storage, root, deployment, newest, keep):
    require(isinstance(keep, int) and keep >= 0, "Retention count must be nonnegative; zero disables deletion.")
    result = {"keep": keep, "deleted": [], "skipped": []}
    if keep == 0:
        return result
    latest = validate_receipt(read_json(db.private_directory(root / newest) / "receipt.json"), deployment, newest)
    verify_remote(storage, latest, root)
    # No remote prefix scans: only our durable, private success receipts qualify.
    candidates = []
    for directory in sorted(root.iterdir(), reverse=True):
        if not RUN_ID.fullmatch(directory.name) or directory.name == newest:
            continue
        try:
            db.private_directory(directory)
            if (directory / "retention-deleted.json").exists():
                continue
            receipt = validate_receipt(read_json(directory / "receipt.json"), deployment, directory.name)
            completed = datetime.datetime.fromisoformat(receipt["completedAt"])
            require(completed.tzinfo is not None, "Retention receipt needs a verified completion time.")
            verify_remote(storage, receipt, root)
            candidates.append((directory, receipt, completed))
        except (BackupError, OSError, ValueError, TypeError, KeyError):
            result["skipped"].append(directory.name)
    candidates.sort(key=lambda item: item[2], reverse=True)
    for directory, receipt, _ in candidates[max(0, keep - 1):]:
        # The newest successful copy is never eligible. Preserve receipts even after deletion.
        atomic_json(directory / "retention-intent.json", {"key": receipt["key"], "ciphertext": receipt["ciphertext"], "at": db.now()})
        storage.delete_verified(receipt["bucket"], receipt["key"])
        atomic_json(directory / "retention-deleted.json", {"at": db.now(), "key": receipt["key"]})
        local_cipher = directory / "snapshot.cms"
        if local_cipher.exists() and db.digest(local_cipher) == receipt["ciphertext"]:
            local_cipher.unlink()
        result["deleted"].append(directory.name)
    return result


DEFAULT_LIMITS = {"pages": 100, "objects": 10000, "object_bytes": 32 * 1024 ** 2, "total_bytes": 256 * 1024 ** 2}


def archive(deployment, state, public_certificate, storage, run=db.command, keep=0, limits=None):
    buckets(deployment)
    require(storage.deployment == deployment, "Storage adapter environment does not match the database target.")
    limits = dict(DEFAULT_LIMITS if limits is None else limits)
    require(set(limits) == set(DEFAULT_LIMITS) and all(isinstance(v, int) and v > 0 for v in limits.values()), "All snapshot bounds must be positive integers.")
    require(limits["objects"] <= 20000, "At most 20000 assets can be restored per bundle.")
    require(isinstance(keep, int) and keep >= 0, "Retention count must be nonnegative.")
    cert = certificate(public_certificate)
    with locked(state, deployment) as root:
        run_id = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ-") + uuid.uuid4().hex
        directory = db.private_directory(root / run_id, create=True)
        progress = {"tool": TOOL, "deployment": deployment, "runId": run_id, "stage": "database", "startedAt": db.now(),
                    "bucket": buckets(deployment)[1], "key": object_key(deployment, run_id)}
        def stage(name):
            progress["stage"] = name
            atomic_json(directory / "state.json", progress)
        try:
            stage("database")
            source = directory / "source"
            db.snapshot(deployment, source, run)
            stage("assets")
            count = copy_assets(storage, deployment, source, limits)
            stage("encryption")
            proof = seal(source, directory, cert, deployment)
            proposed = {"tool": TOOL, "version": 1, "status": "verified_encrypted_readback", "deployment": deployment,
                        "runId": run_id, "bucket": progress["bucket"], "key": progress["key"], "database": list(db.TARGETS[deployment]),
                        "startedAt": progress["startedAt"], "objects": count, **proof,
                        "encryption": "CMS AES-256-GCM / RSA-OAEP SHA-256", "databaseAtomicSnapshot": False,
                        "privateKeyUsed": False, "remoteApplicationRestorePerformed": False}
            progress["pendingReceipt"] = proposed
            stage("upload_intent")  # Durable key + digest before the first potentially uncertain write.
            storage.upload_new(proposed["bucket"], proposed["key"], directory / "snapshot.cms")
            stage("readback")
            verify_remote(storage, proposed, directory)
            proposed["completedAt"] = db.now()
            atomic_json(directory / "receipt.json", proposed)
            stage("verified")
            remove_staging(directory, proposed)
        except Exception:
            atomic_json(directory / "incomplete.json", {"stage": progress["stage"], "at": db.now(), "runId": run_id,
                        "recovery": "Use recover for upload_intent/readback; otherwise start a fresh run. Never overwrite or retry an uncertain upload."})
            raise
        # Retention errors are independent from the durable success of this backup.
        try:
            outcome = retain(storage, root, deployment, run_id, keep)
            atomic_json(directory / "retention.json", outcome)
        except Exception:
            atomic_json(directory / "retention-incomplete.json", {"at": db.now(), "backupRemainsVerified": True})
            raise
        return {"status": proposed["status"], "runId": run_id, "deployment": deployment, "objects": count, "deleted": len(outcome["deleted"])}


def recover(deployment, state, run_id, storage):
    object_key(deployment, run_id)
    require(storage.deployment == deployment, "Storage adapter environment does not match the recovery target.")
    with locked(state, deployment) as root:
        directory = db.private_directory(root / run_id)
        progress = read_json(directory / "state.json")
        require(progress.get("stage") in ("upload_intent", "readback", "verified"), "This run has no sealed upload to recover; start a fresh run.")
        receipt = validate_receipt(progress.get("pendingReceipt"), deployment, run_id)
        require(db.digest(directory / "snapshot.cms") == receipt["ciphertext"], "Local ciphertext changed; recovery cannot certify it.")
        verify_remote(storage, receipt, directory)  # Read only: never repeat an uncertain upload.
        receipt["completedAt"] = db.now()
        atomic_json(directory / "receipt.json", receipt)
        progress["stage"] = "verified"
        atomic_json(directory / "state.json", progress)
        atomic_json(directory / "recovered.json", {"at": db.now(), "oldFailureEvidenceRetained": True})
        remove_staging(directory, receipt)
        return {"status": receipt["status"], "runId": run_id, "deployment": deployment}


def safe_member(name):
    path = PurePosixPath(name)
    require(isinstance(name, str) and name and not path.is_absolute() and ".." not in path.parts
            and str(path) == name and "\\" not in name, "Unsafe archive member path.")
    return path


def unpack_verified(archive_path, destination, deployment):
    # Called only after CMS authentication AND matching the trusted receipt hash.
    with tarfile.open(archive_path, "r:gz") as handle:
        members, names, total = [], set(), 0
        for member in handle:
            safe_member(member.name)
            require(member.isfile() and member.name not in names, "Archive has a duplicate or non-file member.")
            total += member.size
            require(len(members) < 20010 and total <= MAX_BUNDLE, "Expanded archive exceeds its bound.")
            names.add(member.name)
            members.append(member)
        require("bundle-manifest.json" in names, "Archive manifest is missing.")
        member = handle.getmember("bundle-manifest.json")
        require(member.size <= MAX_MANIFEST, "Archive manifest exceeds its bound.")
        with handle.extractfile(member) as stream:
            manifest = json.load(stream)
        require(manifest.get("tool") == TOOL and manifest.get("version") == 1 and manifest.get("deployment") == deployment,
                "Archive environment does not match the recovery target.")
        files = manifest.get("files", {})
        require(isinstance(files, dict) and names == set(files) | {"bundle-manifest.json"}, "Archive members do not match the manifest.")
        # Verify every member before writing any restored file.
        for member in members:
            if member.name == "bundle-manifest.json":
                continue
            with handle.extractfile(member) as stream:
                digest = hashlib.file_digest(stream, "sha256").hexdigest()
            require(files[member.name] == {"bytes": member.size, "sha256": digest}, "Archive member SHA-256 mismatch.")
        for member in members:
            target = destination / member.name
            target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            with os.fdopen(descriptor, "wb") as output, handle.extractfile(member) as stream:
                while chunk := stream.read(1024 ** 2):
                    output.write(chunk)
    database = db.verify(destination)
    require(database["deployment"] == deployment, "Database environment mismatch.")
    assets = read_json(destination / "r2-manifest.json")
    seen = set()
    for item in assets["objects"]:
        require(item["bucket"] in buckets(deployment) and not item["metadata"]["key"].startswith(EXCLUDED), "Invalid asset environment or recursive backup.")
        relative = str(safe_member(item["file"]))
        expected = f"r2/{item['bucket']}/{hashlib.sha256(item['metadata']['key'].encode()).hexdigest()}.bin"
        require(relative == expected and relative not in seen and db.digest(destination / relative) == {"bytes": item["bytes"], "sha256": item["sha256"]}, "Restored asset does not match its manifest.")
        seen.add(relative)
    require({name for name in files if name.startswith("r2/")} == seen, "Untracked restored assets.")
    return {"tables": database["tables"], "objects": len(seen)}


def restore(deployment, encrypted, receipt_path, private_key, output):
    buckets(deployment)
    encrypted, receipt_path, private_key = Path(encrypted), Path(receipt_path), Path(private_key)
    receipt = read_json(receipt_path)
    validate_receipt(receipt, deployment, receipt.get("runId"))
    require(db.digest(encrypted) == receipt["ciphertext"], "Ciphertext does not match the trusted receipt.")
    authenticated_envelope(encrypted)
    require(private_key.is_absolute() and private_key == private_key.resolve(), "Use a separate, absolute private-key path.")
    db.private_file(private_key)  # Never load, print, copy, or include key bytes in an artifact.
    destination = db.private_directory(output, create=True)
    try:
        with tempfile.TemporaryDirectory(prefix=".authenticated-", dir=destination) as scratch:
            clear = Path(scratch) / "archive.tar.gz"
            # OpenSSL can emit untrusted bytes before returning failure. The temporary
            # directory is destroyed on every exception; no tar parser sees those bytes.
            openssl(["cms", "-decrypt", "-binary", "-inform", "DER", "-in", str(encrypted), "-inkey", str(private_key), "-out", str(clear)])
            clear.chmod(0o600)
            require(db.digest(clear) == receipt["archive"], "Authenticated archive does not match the receipt.")
            result = unpack_verified(clear, destination, deployment)
        atomic_json(destination / "restore-receipt.json", {"status": "verified_offline_restore", "deployment": deployment, "at": db.now(), **result})
        return {"status": "verified_offline_restore", "networkUsed": False, **result}
    except Exception:
        atomic_json(destination / "restore-incomplete.json", {"at": db.now(), "status": "incomplete"})
        raise


def main(argv=None):
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    commands = parser.add_subparsers(dest="action", required=True)
    for name in ("archive", "recover", "restore"):
        sub = commands.add_parser(name, allow_abbrev=False)
        sub.add_argument("--deployment", choices=tuple(db.TARGETS), required=True, action=db.Once)
        sub.add_argument("--timeout-seconds", type=int, default=900, action=db.Once)
        if name in ("archive", "recover"):
            sub.add_argument("--once", action="store_true", required=True, help="One bounded run; never starts a scheduler")
            sub.add_argument("--state-directory", required=True, action=db.Once)
        if name == "archive":
            sub.add_argument("--certificate", required=True, action=db.Once)
            sub.add_argument("--retain", type=int, default=0, action=db.Once, help="Copies to retain; 0 disables deletion (default)")
            for field, default in DEFAULT_LIMITS.items():
                sub.add_argument("--max-" + field.replace("_", "-"), type=int, default=default, action=db.Once)
        if name == "recover":
            sub.add_argument("--run-id", required=True, action=db.Once)
        if name == "restore":
            for option in ("ciphertext", "receipt", "private-key", "output"):
                sub.add_argument("--" + option, required=True, action=db.Once)
    args = parser.parse_args(argv)
    with bounded(args.timeout_seconds):
        if args.action == "restore":
            return restore(args.deployment, args.ciphertext, args.receipt, args.private_key, args.output)
        storage = CloudflareStorage(args.deployment)
        if args.action == "recover":
            return recover(args.deployment, args.state_directory, args.run_id, storage)
        return archive(args.deployment, args.state_directory, args.certificate, storage, keep=args.retain,
                       limits={field: getattr(args, "max_" + field) for field in DEFAULT_LIMITS})


if __name__ == "__main__":
    try:
        print(json.dumps(main(), indent=2))
    except (BackupError, OSError, ValueError, KeyError, TypeError, tarfile.TarError):
        # Never print provider bodies, object keys, SQL, secrets, or private OS paths.
        print("Backup command failed. Inspect its private state/receipt; no success is implied. No remote restore was requested.", file=sys.stderr)
        sys.exit(1)
