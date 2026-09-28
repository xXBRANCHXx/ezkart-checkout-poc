#!/usr/bin/env python3
"""Private durable alert outbox for existing workbench machine reports; no report collection."""
import argparse
from contextlib import contextmanager
import datetime
import fcntl
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import signal
import sqlite3
import ssl
import stat
import sys
import time
from urllib.parse import urlsplit
import uuid

ROOT = Path(__file__).resolve().parents[2]
COMMERCE_CODES = set('jobs_uncertain jobs_dead job_leases_expired jobs_overdue orders_payment_review orders_stock_review orders_shipping_review capture_journals_missing capture_allocations_need_review financial_journals_inconsistent transactional_email_attention campaign_email_attention payout_sync_review payout_sync_leases_expired payout_sync_overdue payouts_need_reconciliation payout_accounts_unassigned payout_history_outside_window settlement_sources_stale payout_runner_not_observed payout_runner_overdue payout_runner_interrupted payout_runner_failed payout_runner_held refund_reviews_stale'.split())
BACKUP_CODES = set('backup_runner_not_observed backup_never_succeeded backup_runner_overdue backup_clock_invalid backup_overdue backup_failed backup_interrupted backup_runner_inspection_failed'.split())
COUNT_FIELDS = {
 'jobs': 'total uncertain dead cancelledBeforeSend expiredLeases overdue',
 'orders': 'total paymentReview stockReview shippingReview',
 'accounting': 'captures journals unpostedCaptures unallocatedCaptures inconsistentJournals',
 'wallets': 'enrollments confirmedProfiles',
 'payoutSync': 'jobs active reviewGroups expiredLeases overdue unreconciledPayouts unassignedAccounts outsideWindow staleSettlements',
 'refundReviews': 'open awaitingBuyer awaitingStore stale',
 'email': 'transactionalRequests transactionalAttention campaignRequests campaignAttention',
}

class AlertError(Exception):
    pass

def require(condition, code):
    if not condition:
        raise AlertError(code)

def iso(value):
    return datetime.datetime.fromtimestamp(value, datetime.timezone.utc).isoformat()

def timestamp(value):
    require(isinstance(value, str) and len(value) <= 40, 'input_invalid')
    try:
        parsed = datetime.datetime.fromisoformat(value.replace('Z', '+00:00'))
        require(parsed.tzinfo is not None, 'input_invalid')
        return parsed.timestamp()
    except (ValueError, OverflowError):
        raise AlertError('input_invalid') from None

def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True)

def private_directory(path):
    path = Path(path)
    require(path.is_absolute() and path == path.resolve() and not path.is_relative_to(ROOT), 'private_directory_required')
    info = path.lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.getuid() and stat.S_IMODE(info.st_mode) == 0o700, 'private_directory_required')
    return path

def private_file(path):
    path = Path(path)
    require(path.is_absolute() and path == path.resolve(), 'private_file_required')
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_uid == os.getuid() and stat.S_IMODE(info.st_mode) == 0o600, 'private_file_required')
    return info

def read_json(path, maximum=131072):
    original = private_file(path)
    require(original.st_size <= maximum, 'input_too_large')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        with os.fdopen(fd, 'rb') as handle:
            current = os.fstat(handle.fileno())
            require((current.st_dev,current.st_ino,current.st_mode,current.st_uid,current.st_nlink) == (original.st_dev,original.st_ino,original.st_mode,original.st_uid,original.st_nlink), 'input_changed')
            raw = handle.read(maximum + 1)
        require(len(raw) <= maximum, 'input_too_large')
        def pairs(items):
            result = {}
            for key, value in items:
                require(key not in result, 'input_invalid')
                result[key] = value
            return result
        return json.loads(raw, object_pairs_hook=pairs)
    except (ValueError, UnicodeError):
        raise AlertError('input_invalid') from None

def configuration(path):
    require(not Path(path).resolve().is_relative_to(ROOT), 'private_configuration_required')
    value = read_json(path, 16384)
    fields = {'deployment','stateDirectory','inputs','endpoint','endpointEnv','tokenEnv','timeoutSeconds','maxDeliveries','retrySeconds','maxRetrySeconds','overdueSeconds','reminderSeconds','maxEvents'}
    require(isinstance(value, dict) and not set(value) - fields and value.get('deployment') in ('test','beta'), 'configuration_invalid')
    private_directory(value['stateDirectory'])
    value.setdefault('endpointEnv', 'EZKART_ALERT_ENDPOINT')
    value.setdefault('tokenEnv', 'EZKART_ALERT_TOKEN')
    for key in ('endpointEnv','tokenEnv'):
        require(isinstance(value[key], str) and re.fullmatch(r'EZKART_[A-Z0-9_]{3,80}', value[key]), 'configuration_invalid')
    for key, default, low, high in (
        ('timeoutSeconds', 10, 1, 30), ('maxDeliveries', 4, 1, 10), ('retrySeconds', 60, 1, 3600),
        ('maxRetrySeconds', 3600, 1, 86400), ('overdueSeconds', 900, 60, 86400),
        ('reminderSeconds', 3600, 60, 604800), ('maxEvents', 10000, 10, 100000)):
        value.setdefault(key, default)
        require(type(value[key]) is int and low <= value[key] <= high, 'configuration_invalid')
    require(value['maxRetrySeconds'] >= value['retrySeconds'], 'configuration_invalid')
    require(isinstance(value.get('inputs'), list) and 1 <= len(value['inputs']) <= 2, 'configuration_invalid')
    seen = set()
    for item in value['inputs']:
        require(isinstance(item, dict) and set(item) == {'source','path','maxAgeSeconds'} and item['source'] in ('commerce','backup') and item['source'] not in seen, 'configuration_invalid')
        seen.add(item['source'])
        require(Path(item['path']).is_absolute() and type(item['maxAgeSeconds']) is int and 60 <= item['maxAgeSeconds'] <= 86400, 'configuration_invalid')
    if value.get('endpoint'):
        validate_endpoint(value['endpoint'])
    return value

def validate_endpoint(endpoint):
    require(isinstance(endpoint, str) and 1 <= len(endpoint) <= 2048 and not any(ord(c) <= 32 or ord(c) == 127 for c in endpoint), 'destination_invalid')
    parts = urlsplit(endpoint)
    require(parts.scheme == 'https' and parts.hostname and not parts.username and not parts.password and not parts.fragment and not parts.query, 'destination_invalid')
    try:
        port = parts.port
    except ValueError:
        raise AlertError('destination_invalid') from None
    require(port is None or 1 <= port <= 65535, 'destination_invalid')
    return parts

def destination(config):
    endpoint = config.get('endpoint') or os.environ.get(config['endpointEnv'], '')
    token = os.environ.get(config['tokenEnv'], '')
    if not endpoint or not token:
        return None
    validate_endpoint(endpoint)
    require(isinstance(token, str) and 16 <= len(token) <= 4096 and all(33 <= ord(c) <= 126 for c in token), 'authentication_invalid')
    return endpoint, token

@contextmanager
def lock(config):
    root = private_directory(config['stateDirectory'])
    path = root / '.alerts.lock'
    fd = os.open(path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        private_file(path)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            yield False
        else:
            yield True
    finally:
        os.close(fd)

def connect(config, create=True):
    root = private_directory(config['stateDirectory'])
    path = root / 'alerts.sqlite3'
    if not path.exists():
        require(create, 'alert_runner_not_observed')
        descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
        os.close(descriptor)
    private_file(path)
    for suffix in ('-journal','-wal','-shm'):
        if path.with_name(path.name + suffix).exists():
            private_file(path.with_name(path.name + suffix))
    connection = sqlite3.connect(str(path) if create else path.as_uri() + '?mode=ro', uri=not create, timeout=1)
    connection.row_factory = sqlite3.Row
    if create:
        connection.execute('PRAGMA journal_mode=DELETE')
        connection.execute('PRAGMA synchronous=FULL')
        connection.executescript('''
        CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sources(source TEXT PRIMARY KEY,codes TEXT NOT NULL,accepted_at REAL,accepted_codes TEXT NOT NULL,last_event_at REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS events(sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,payload TEXT NOT NULL,created_at REAL NOT NULL,
          state TEXT NOT NULL CHECK(state IN ('queued','attempting','delivered')),attempts INTEGER NOT NULL DEFAULT 0,next_attempt_at REAL NOT NULL,
          attempted_at REAL,delivered_at REAL,last_error TEXT,destination_hash TEXT);
        ''')
        with connection:
            connection.execute("INSERT OR IGNORE INTO metadata VALUES('installation',?)", (uuid.uuid4().hex,))
            connection.execute("INSERT OR IGNORE INTO metadata VALUES('deployment',?)", (config['deployment'],))
    require(connection.execute("SELECT value FROM metadata WHERE key='deployment'").fetchone()[0] == config['deployment'], 'state_deployment_mismatch')
    return connection

def inspect_input(config, item, now, prior):
    accepted_at = prior['accepted_at'] if prior else None
    accepted_codes = json.loads(prior['accepted_codes']) if prior else []
    try:
        report = read_json(item['path'])
        require(isinstance(report, dict), 'input_invalid')
        if report.get('exitCode') == 1:
            raise AlertError('input_failed')
        require(report.get('deployment') == config['deployment'] and report.get('readOnly') is True, 'input_scope_invalid')
        require(report.get('version') == (2 if item['source'] == 'commerce' else 1), 'input_version_invalid')
        require(type(report.get('exitCode')) is int and report['exitCode'] in (0,2), 'input_invalid')
        codes = report.get('warnings')
        allowed = COMMERCE_CODES if item['source'] == 'commerce' else BACKUP_CODES
        require(isinstance(codes, list) and all(isinstance(code, str) and code in allowed for code in codes) and len(set(codes)) == len(codes), 'input_invalid')
        if item['source'] == 'commerce':
            require(report.get('environment') == ('sandbox' if config['deployment'] == 'test' else 'production'), 'input_scope_invalid')
            for section, fields in COUNT_FIELDS.items():
                require(isinstance(report.get(section), dict), 'input_invalid')
                require(all(type(report[section].get(key)) is int and 0 <= report[section][key] <= 9007199254740991 for key in fields.split()), 'input_invalid')
            require('payoutRunner' in report and (report['payoutRunner'] is None or isinstance(report['payoutRunner'], dict)), 'input_invalid')
        else:
            require(all(key in report for key in ('lastSeenAt','lastAttempt','lastSuccess','lastFailure','nextDueAt','due','running')) and report.get('remoteReadbackPerformedByReport') is False, 'input_invalid')
            require(type(report['due']) is bool and type(report['running']) is bool and report['exitCode'] == (2 if codes else 0), 'input_invalid')
        observed = timestamp(report.get('observedAt'))
        require(observed <= now + 60, 'input_clock_invalid')
        require(now - observed <= item['maxAgeSeconds'], 'input_stale')
        require(accepted_at is None or observed >= accepted_at, 'input_regressed')
        codes = sorted(codes)
        require(accepted_at != observed or codes == accepted_codes, 'input_conflicting')
        return codes, observed, codes
    except FileNotFoundError:
        issue = 'input_missing'
    except AlertError as error:
        issue = str(error) if str(error).startswith('input_') else 'input_invalid'
    except (OSError, ValueError, KeyError, TypeError, OverflowError):
        issue = 'input_invalid'
    # Unknown/stale input never silently clears the previously observed warnings.
    return sorted(set(accepted_codes + [issue])), accepted_at, accepted_codes

def collect(config, connection, now):
    installation = connection.execute("SELECT value FROM metadata WHERE key='installation'").fetchone()[0]
    with connection:
        last_seen = connection.execute("SELECT value FROM metadata WHERE key='seen_at'").fetchone()
        require(not last_seen or float(last_seen[0]) <= now + 60, 'alert_clock_invalid')
        for item in config['inputs']:
            prior = connection.execute('SELECT * FROM sources WHERE source=?', (item['source'],)).fetchone()
            codes, accepted_at, accepted_codes = inspect_input(config, item, now, prior)
            old_codes = json.loads(prior['codes']) if prior else []
            changed = codes != old_codes
            remind = bool(codes and prior and now - prior['last_event_at'] >= config['reminderSeconds'])
            event_at = prior['last_event_at'] if prior else now
            if changed or remind:
                require(connection.execute('SELECT COUNT(*) FROM events').fetchone()[0] < config['maxEvents'], 'alert_outbox_full')
                sequence = int(connection.execute("SELECT COALESCE(MAX(sequence),0)+1 FROM events").fetchone()[0])
                event_id = 'ezalert_' + hashlib.sha256(f'{installation}:{config["deployment"]}:{sequence}'.encode()).hexdigest()
                payload = {'version':1,'id':event_id,'deployment':config['deployment'],'source':item['source'],
                  'kind':'recovery' if not codes else 'reminder' if not changed else 'warning_changed',
                  'createdAt':iso(now),'observedAt':iso(accepted_at) if accepted_at is not None else None,
                  'warningCodes':codes,'resolvedWarningCodes':sorted(set(old_codes) - set(codes))}
                connection.execute('INSERT INTO events(id,payload,created_at,state,next_attempt_at) VALUES(?,?,?,\'queued\',?)', (event_id, canonical(payload), now, now))
                event_at = now
            connection.execute('INSERT INTO sources VALUES(?,?,?,?,?) ON CONFLICT(source) DO UPDATE SET codes=excluded.codes,accepted_at=excluded.accepted_at,accepted_codes=excluded.accepted_codes,last_event_at=excluded.last_event_at', (item['source'],canonical(codes),accepted_at,canonical(accepted_codes),event_at))
        connection.execute("INSERT INTO metadata VALUES('seen_at',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (str(now),))

@contextmanager
def deadline(seconds):
    def expired(signum, frame):
        raise AlertError('transport_timeout')
    previous = signal.signal(signal.SIGALRM, expired)
    signal.setitimer(signal.ITIMER_REAL, seconds)
    try:
        yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous)

def send_https(endpoint, token, event_id, body, timeout, context=None):
    parts = validate_endpoint(endpoint)
    connection = http.client.HTTPSConnection(parts.hostname, parts.port or 443, timeout=timeout, context=context or ssl.create_default_context())
    try:
        with deadline(timeout):
            connection.request('POST', parts.path or '/', body=body.encode(), headers={
              'Authorization':'Bearer ' + token, 'Idempotency-Key':event_id, 'Content-Type':'application/json', 'Accept':'application/json', 'User-Agent':'Ezkart-Operations-Alerts/1'})
            response = connection.getresponse()
            # HTTPSConnection never follows redirects; a redirect is an uncertain failure.
            require(200 <= response.status < 300, 'transport_http_failure')
            length = response.getheader('Content-Length')
            require(length is None or length.isdigit() and int(length) <= 4096, 'transport_response_too_large')
            require(response.getheader('Content-Type','').split(';')[0].strip().lower() == 'application/json', 'transport_ack_invalid')
            raw = response.read(4097)
            require(len(raw) <= 4096, 'transport_response_too_large')
            try:
                acknowledgement = json.loads(raw)
            except (ValueError, UnicodeError):
                raise AlertError('transport_ack_invalid') from None
            require(isinstance(acknowledgement, dict) and acknowledgement.get('id') == event_id and acknowledgement.get('accepted') is True, 'transport_ack_invalid')
    except (OSError, http.client.HTTPException, ValueError):
        raise AlertError('transport_unconfirmed') from None
    finally:
        connection.close()

def deliver(config, connection, target, sender, now):
    if not target:
        return
    endpoint, token = target
    destination_hash = hashlib.sha256(endpoint.encode()).hexdigest()
    # A lost acknowledgement must never be redirected to a newly configured recipient.
    require(not connection.execute("SELECT 1 FROM events WHERE state!='delivered' AND destination_hash IS NOT NULL AND destination_hash!=? LIMIT 1", (destination_hash,)).fetchone(), 'alert_destination_changed')
    rows = connection.execute("SELECT * FROM events WHERE state!='delivered' ORDER BY sequence LIMIT ?", (config['maxDeliveries'],)).fetchall()
    for row in rows:
        if row['next_attempt_at'] > now():
            break  # Preserve ordering: an old warning is never delivered after its recovery.
        attempts = row['attempts'] + 1
        observed = now()
        delay = min(config['maxRetrySeconds'], config['retrySeconds'] * 2 ** min(attempts - 1, 20))
        with connection:
            connection.execute("UPDATE events SET state='attempting',attempts=?,attempted_at=?,next_attempt_at=?,destination_hash=?,last_error='transport_unconfirmed' WHERE id=?", (attempts, observed, observed + delay, destination_hash, row['id']))
        try:
            sender(endpoint, token, row['id'], row['payload'], config['timeoutSeconds'])
        except Exception as error:
            code = str(error) if isinstance(error, AlertError) and str(error).startswith('transport_') else 'transport_unconfirmed'
            with connection:
                connection.execute("UPDATE events SET state='queued',last_error=? WHERE id=?", (code, row['id']))
            break
        with connection:
            connection.execute("UPDATE events SET state='delivered',delivered_at=?,last_error=NULL WHERE id=?", (now(), row['id']))

def summary(config, connection, now, target_present):
    seen = connection.execute("SELECT value FROM metadata WHERE key='seen_at'").fetchone()
    pending = connection.execute("SELECT COUNT(*) count,MIN(created_at) oldest,MAX(attempts) attempts FROM events WHERE state!='delivered'").fetchone()
    warnings = []
    if not seen:
        warnings.append('alert_runner_not_observed')
    elif now - float(seen[0]) > 900:
        warnings.append('alert_runner_overdue')
    elif float(seen[0]) > now + 60:
        warnings.append('alert_clock_invalid')
    if not target_present:
        warnings.append('alert_destination_unconfigured')
    if connection.execute('SELECT COUNT(*) FROM events').fetchone()[0] >= config['maxEvents']:
        warnings.append('alert_outbox_full')
    if pending['count']:
        warnings.append('alert_delivery_pending')
        if pending['attempts']:
            warnings.append('alert_delivery_unconfirmed')
        if now - pending['oldest'] >= config['overdueSeconds']:
            warnings.append('alert_delivery_overdue')
    sources = {row['source']:json.loads(row['codes']) for row in connection.execute('SELECT * FROM sources ORDER BY source')}
    return {'version':1,'deployment':config['deployment'],'observedAt':iso(now),'queued':pending['count'],
            'delivered':connection.execute("SELECT COUNT(*) FROM events WHERE state='delivered'").fetchone()[0],
            'oldestPendingAt':iso(pending['oldest']) if pending['count'] else None,'sources':sources,'warnings':warnings,'exitCode':2 if warnings else 0}

def run_once(config, send=False, sender=send_https, now=time.time):
    with lock(config) as acquired:
        if not acquired:
            return {'version':1,'deployment':config['deployment'],'status':'overlap_skipped','exitCode':0}
        connection = connect(config)
        try:
            collection_error = None
            try:
                collect(config, connection, now())
            except AlertError as error:
                if str(error) != 'alert_outbox_full':
                    raise
                collection_error = 'alert_outbox_full'
                # Capacity must not prevent retrying an already durable delivery.
                with connection:
                    connection.execute("INSERT INTO metadata VALUES('seen_at',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (str(now()),))
            target = destination(config)
            if send:
                deliver(config, connection, target, sender, now)
            result = {**summary(config, connection, now(), bool(target)), 'status':'processed' if send else 'queued_only'}
            if collection_error:
                result['exitCode'] = 1
            return result
        finally:
            connection.close()

def report(config, now=time.time):
    if not (Path(config['stateDirectory']) / 'alerts.sqlite3').exists():
        return {'version':1,'deployment':config['deployment'],'observedAt':iso(now()),'warnings':['alert_runner_not_observed'],'exitCode':2}
    connection = connect(config, create=False)
    try:
        return {**summary(config, connection, now(), bool(destination(config))), 'readOnly':True}
    finally:
        connection.close()

class Once(argparse.Action):
    def __call__(self, parser, namespace, value, option_string=None):
        require(not getattr(namespace, self.dest, None), 'duplicate_argument')
        setattr(namespace, self.dest, value)

def main(argv=None):
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument('action', choices=('queue','run','report'))
    parser.add_argument('--config', required=True, action=Once)
    args = parser.parse_args(argv)
    config = configuration(args.config)
    return report(config) if args.action == 'report' else run_once(config, send=args.action == 'run')

if __name__ == '__main__':
    try:
        result = main()
        print(json.dumps(result, indent=2))
        sys.exit(result['exitCode'])
    except (AlertError, OSError, ValueError, KeyError, TypeError, sqlite3.Error) as error:
        # Never echo endpoint URLs, credentials, source contents, exception bodies or paths.
        code = str(error) if isinstance(error, AlertError) and str(error) in {'alert_outbox_full','alert_destination_changed','alert_clock_invalid','state_deployment_mismatch','destination_invalid','authentication_invalid','configuration_invalid','private_configuration_required','private_directory_required','private_file_required'} else 'alert_runner_failed'
        print(json.dumps({'version':1,'warnings':[code],'exitCode':1}))
        sys.exit(1)
