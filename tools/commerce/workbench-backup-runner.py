#!/usr/bin/env python3
"""One bounded due backup, or a read-only machine-readable operations report."""
import argparse
from contextlib import contextmanager
import datetime
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import signal
import sys
import uuid

spec = importlib.util.spec_from_file_location("bundle", Path(__file__).with_name("workbench-backup-bundle.py"))
bundle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bundle)
require, db = bundle.require, bundle.db


def timestamp(value):
    parsed = datetime.datetime.fromisoformat(value)
    require(parsed.tzinfo is not None, "Timestamp must include timezone.")
    return parsed.timestamp()


def iso(value):
    return datetime.datetime.fromtimestamp(value, datetime.timezone.utc).isoformat()


def clock():
    return datetime.datetime.now(datetime.timezone.utc).timestamp()


def configuration(path):
    value = bundle.read_json(Path(path), 16384)
    allowed = {"deployment", "stateDirectory", "certificate", "intervalSeconds", "retrySeconds", "graceSeconds", "timeoutSeconds", "retain", "limits"}
    require(isinstance(value, dict) and not set(value) - allowed, "Unknown runner configuration.")
    bundle.buckets(value.get("deployment"))
    db.private_directory(value["stateDirectory"])
    require(Path(value["certificate"]).is_absolute(), "Certificate path must be absolute.")
    for field, default, low, high in (("intervalSeconds", 86400, 3600, 604800), ("retrySeconds", 3600, 300, 86400),
                                    ("graceSeconds", 3600, 300, 86400), ("timeoutSeconds", 900, 1, 3600), ("retain", 0, 0, 1000)):
        value.setdefault(field, default)
        require(type(value[field]) is int and low <= value[field] <= high, "Invalid runner bound.")
    value.setdefault("limits", dict(bundle.DEFAULT_LIMITS))
    require(set(value["limits"]) == set(bundle.DEFAULT_LIMITS) and all(type(v) is int and v > 0 for v in value["limits"].values()), "Invalid asset bounds.")
    return value


def location(config):
    return Path(config["stateDirectory"]) / ("runner-" + config["deployment"])


def load_status(config):
    root = location(config)
    if not root.exists():
        return None
    db.private_directory(root)
    path = root / "status.json"
    if not path.exists():
        return None
    status = bundle.read_json(path)
    require(status.get("version") == 1 and status.get("deployment") == config["deployment"], "Invalid runner state.")
    # Validate all timestamps before treating the durable record as healthy.
    for key in ("createdAt", "seenAt"):
        timestamp(status[key])
    for key in ("lastAttempt", "lastSuccess", "lastFailure"):
        event = status.get(key)
        if event:
            bundle.object_key(config["deployment"], event["runId"])
            timestamp(event["startedAt"])
            timestamp(event["deadlineAt"])
            if event.get("finishedAt"):
                timestamp(event["finishedAt"])
            require(event["status"] in ("running", "succeeded", "failed", "interrupted"), "Invalid attempt state.")
    return status


def next_due(config, status):
    attempt = status.get("lastAttempt") if status else None
    if not attempt:
        return 0
    field = "intervalSeconds" if attempt["status"] == "succeeded" else "retrySeconds"
    return timestamp(attempt.get("finishedAt", attempt["startedAt"])) + config[field]


def report(config, now=None, status=None):
    now = clock() if now is None else now
    status = load_status(config) if status is None else status
    warnings = []
    attempt, success, failure = (status.get(k) if status else None for k in ("lastAttempt", "lastSuccess", "lastFailure"))
    due = next_due(config, status)
    running = bool(attempt and attempt["status"] == "running" and now <= timestamp(attempt["deadlineAt"]))
    if not status:
        warnings += ["backup_runner_not_observed", "backup_never_succeeded"]
    else:
        if not running and now - timestamp(status["seenAt"]) > 900:
            warnings.append("backup_runner_overdue")
        if any(timestamp(value) > now + 60 for value in [status["seenAt"],
               *[event["startedAt"] for event in (attempt, success, failure) if event]]):
            warnings.append("backup_clock_invalid")
        if not success:
            warnings.append("backup_never_succeeded")
        anchor = timestamp(success["finishedAt"] if success else status["createdAt"])
        if now > anchor + config["intervalSeconds"] + config["graceSeconds"]:
            warnings.append("backup_overdue")
        if attempt and attempt["status"] in ("failed", "interrupted"):
            warnings.append("backup_failed" if attempt["status"] == "failed" else "backup_interrupted")
        if attempt and attempt["status"] == "running" and now > timestamp(attempt["deadlineAt"]):
            warnings.append("backup_interrupted")
    return {"version": 1, "deployment": config["deployment"], "observedAt": iso(now), "readOnly": True,
            "lastSeenAt": status.get("seenAt") if status else None, "lastAttempt": attempt,
            "lastSuccess": success, "lastFailure": failure, "nextDueAt": iso(due) if due else None,
            "due": not running and now >= due, "running": running, "warnings": warnings,
            "remoteReadbackPerformedByReport": False, "exitCode": 2 if warnings else 0}


@contextmanager
def runner_lock(config):
    path = Path(config["stateDirectory"]) / (".runner-" + config["deployment"] + ".lock")
    fd = os.open(path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        db.private_file(path)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            yield False
        else:
            yield True
    finally:
        os.close(fd)


def record(config, state, attempt):
    root = location(config)
    bundle.atomic_json(root / (attempt["runId"] + ".json"), attempt)
    bundle.atomic_json(root / "status.json", state)


def verified_receipt(config, attempt):
    """A verified copy can exist even when retention or final acknowledgement failed."""
    directory = Path(config["stateDirectory"]) / config["deployment"] / attempt["runId"]
    path = directory / "receipt.json"
    if not path.exists():
        return None
    db.private_directory(directory)
    receipt = bundle.validate_receipt(bundle.read_json(path), config["deployment"], attempt["runId"])
    timestamp(receipt["completedAt"])
    return {**attempt, "status": "succeeded", "finishedAt": receipt["completedAt"]}


def execute(config, run_id):
    # Both are explicit dependencies. Never fall back to an interactive Wrangler login.
    require(os.environ.get("CLOUDFLARE_API_TOKEN"), "Supply CLOUDFLARE_API_TOKEN for D1 export.")
    storage = bundle.CloudflareStorage(config["deployment"])
    return bundle.archive(config["deployment"], config["stateDirectory"], config["certificate"], storage,
                          keep=config["retain"], limits=config["limits"], run_id=run_id)


def run_once(config, execute_backup=execute, now=clock):
    with runner_lock(config) as acquired:
        if not acquired:
            return {"deployment": config["deployment"], "status": "overlap_skipped", "exitCode": 0}
        root = location(config)
        if not root.exists():
            root.mkdir(mode=0o700)
        db.private_directory(root)
        observed = now()
        state = load_status(config) or {"version": 1, "deployment": config["deployment"], "createdAt": iso(observed)}
        previous = state.get("lastAttempt")
        if previous and previous["status"] == "running":
            # The exclusive runner lock proves the prior process no longer owns this installation.
            interrupted = {**previous, "status": "interrupted", "finishedAt": iso(observed)}
            state["lastAttempt"] = state["lastFailure"] = interrupted
            verified = verified_receipt(config, interrupted)
            if verified:
                state["lastSuccess"] = verified
            record(config, state, interrupted)
        state["seenAt"] = iso(observed)
        bundle.atomic_json(root / "status.json", state)
        if observed < next_due(config, state):
            return {**report(config, observed, state), "status": "not_due"}
        run_id = datetime.datetime.fromtimestamp(observed, datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ-") + uuid.uuid4().hex
        attempt = {"runId": run_id, "startedAt": iso(observed), "deadlineAt": iso(observed + config["timeoutSeconds"]), "status": "running"}
        state["lastAttempt"] = attempt
        record(config, state, attempt)
        def terminate(signum, frame):
            raise bundle.BackupError("Runner terminated; preserve original attempt.")
        old_term = signal.signal(signal.SIGTERM, terminate)
        try:
            with bundle.bounded(config["timeoutSeconds"]):
                execute_backup(config, run_id)
                verified = verified_receipt(config, attempt)
                require(verified is not None, "Backup did not leave a durable verified receipt.")
            attempt = {**attempt, "status": "succeeded", "finishedAt": iso(now())}
            state["lastSuccess"] = verified
        except Exception:
            attempt = {**attempt, "status": "failed", "finishedAt": iso(now())}
            state["lastFailure"] = attempt
            # Never use a subprocess success string as evidence of a verified copy.
            try:
                verified = verified_receipt(config, attempt)
            except (bundle.BackupError, OSError, ValueError, KeyError, TypeError):
                verified = None
                attempt["receiptInvalid"] = True
            if verified:
                state["lastSuccess"] = verified
        finally:
            signal.signal(signal.SIGTERM, old_term)
        state["lastAttempt"] = attempt
        state["seenAt"] = iso(now())
        record(config, state, attempt)
        result = report(config, now(), state)
        return {**result, "status": attempt["status"], "exitCode": 1 if attempt["status"] == "failed" else result["exitCode"]}


def main(argv=None):
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument("action", choices=("run", "report"))
    parser.add_argument("--config", required=True, action=db.Once)
    args = parser.parse_args(argv)
    config = configuration(args.config)
    return report(config) if args.action == "report" else run_once(config)


if __name__ == "__main__":
    try:
        result = main()
        print(json.dumps(result, indent=2))
        sys.exit(result["exitCode"])
    except (bundle.BackupError, OSError, ValueError, KeyError, TypeError):
        print(json.dumps({"version": 1, "warnings": ["backup_runner_inspection_failed"], "exitCode": 1}))
        sys.exit(1)
