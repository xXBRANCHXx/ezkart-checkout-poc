#!/usr/bin/env python3
"""Atomic report collectors and an independent read-only local operations watchdog."""
import argparse
from contextlib import contextmanager
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import selectors
import signal
import sqlite3
import subprocess
import sys
import time
import uuid

spec = importlib.util.spec_from_file_location('alerts', Path(__file__).with_name('operations-alert-runner.py'))
alerts = importlib.util.module_from_spec(spec)
spec.loader.exec_module(alerts)
require, iso, timestamp = alerts.require, alerts.iso, alerts.timestamp
ROOT = Path(__file__).resolve().parents[2]


def configuration(path):
    require(not Path(path).resolve().is_relative_to(ROOT), 'private_configuration_required')
    config = alerts.read_json(path, 16384)
    allowed = {'deployment','reportsDirectory','backupConfig','alertStateDirectory','commerceTimeoutSeconds','backupTimeoutSeconds','staleSeconds'}
    require(isinstance(config, dict) and not set(config)-allowed and config.get('deployment') in ('test','beta'), 'configuration_invalid')
    alerts.private_directory(config['reportsDirectory'])
    alert_root=Path(config['alertStateDirectory'])
    require(alert_root.is_absolute() and alert_root==alert_root.resolve() and not alert_root.is_relative_to(ROOT),'private_directory_required')
    if alert_root.exists():alerts.private_directory(alert_root)
    require(Path(config['backupConfig']).is_absolute(), 'configuration_invalid')
    for key,default,low,high in (('commerceTimeoutSeconds',120,1,180),('backupTimeoutSeconds',15,1,60),('staleSeconds',900,60,3600)):
        config.setdefault(key,default)
        require(type(config[key]) is int and low <= config[key] <= high, 'configuration_invalid')
    return config


@contextmanager
def lock(config, action):
    root = alerts.private_directory(config['reportsDirectory'])
    path = root / ('.' + action + '.lock')
    fd = os.open(path,os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
    try:
        alerts.private_file(path)
        try:
            fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:
            yield False
        else:
            yield True
    finally:
        os.close(fd)


def atomic_json(path,value):
    root=alerts.private_directory(path.parent)
    if path.exists() or path.is_symlink():
        alerts.private_file(path)
    temporary=root/('.'+path.name+'-'+uuid.uuid4().hex)
    descriptor=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    try:
        with os.fdopen(descriptor,'w') as handle:
            handle.write(alerts.canonical(value)+'\n');handle.flush();os.fsync(handle.fileno())
        os.replace(temporary,path)
        descriptor=os.open(root,os.O_RDONLY|os.O_DIRECTORY)
        try:os.fsync(descriptor)
        finally:os.close(descriptor)
    finally:
        if temporary.exists():temporary.unlink()


def execute(command,timeout):
    """Bound stdout, wall time and the full child process group; discard stderr."""
    process=subprocess.Popen(command,cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,start_new_session=True,
        env={**os.environ,'WRANGLER_SEND_METRICS':'false','CI':'1'})
    chunks=[];size=0;end=time.monotonic()+timeout
    selector=selectors.DefaultSelector();selector.register(process.stdout,selectors.EVENT_READ)
    try:
        while selector.get_map():
            remaining=end-time.monotonic();require(remaining>0,'collector_timeout')
            for key,_ in selector.select(min(remaining,0.2)):
                chunk=os.read(key.fileobj.fileno(),16384)
                if not chunk:selector.unregister(key.fileobj);continue
                size+=len(chunk);require(size<=131072,'collector_output_too_large');chunks.append(chunk)
        try:status=process.wait(timeout=max(0.001,end-time.monotonic()))
        except subprocess.TimeoutExpired:raise alerts.AlertError('collector_timeout') from None
        return status,b''.join(chunks)
    finally:
        selector.close();process.stdout.close()
        # Even a successful wrapper must not leave background grandchildren alive.
        try:os.killpg(process.pid,signal.SIGKILL)
        except ProcessLookupError:pass
        process.wait(timeout=5)


def safe_stamp(value,nullable=False):
    if value is None and nullable:return None
    timestamp(value);return value


def sanitize(source,raw,status,deployment,now):
    require(status in (0,2),'collector_command_failed')
    try:report=json.loads(raw)
    except (ValueError,UnicodeError):raise alerts.AlertError('collector_json_invalid') from None
    require(isinstance(report,dict) and report.get('deployment')==deployment and report.get('readOnly') is True,'collector_scope_invalid')
    require(report.get('version')==(2 if source=='commerce' else 1),'collector_schema_invalid')
    codes=report.get('warnings');allowed=alerts.COMMERCE_CODES if source=='commerce' else alerts.BACKUP_CODES
    require(isinstance(codes,list) and all(isinstance(code,str) and code in allowed for code in codes) and len(codes)==len(set(codes)),'collector_schema_invalid')
    require(type(report.get('exitCode')) is int and report['exitCode']==status==(2 if codes else 0),'collector_exit_mismatch')
    observed=timestamp(report.get('observedAt'))
    require(now-300<=observed<=now+60,'collector_clock_invalid')
    result={'version':report['version'],'deployment':deployment,'observedAt':report['observedAt'],'readOnly':True,'warnings':sorted(codes),'exitCode':status}
    if source=='commerce':
        require(report.get('environment')==('sandbox' if deployment=='test' else 'production'),'collector_scope_invalid')
        result['environment']=report['environment']
        for section,fields in alerts.COUNT_FIELDS.items():
            require(isinstance(report.get(section),dict),'collector_schema_invalid')
            result[section]={}
            for key in fields.split():
                value=report[section].get(key);require(type(value) is int and 0<=value<=9007199254740991,'collector_schema_invalid');result[section][key]=value
        require('payoutRunner' in report,'collector_schema_invalid')
        runner=report['payoutRunner'];result['payoutRunner']=None
        if runner is not None:
            require(isinstance(runner,dict) and runner.get('state') in ('running','held','idle','completed','retry','review','failed'),'collector_schema_invalid')
            cleaned={'state':runner['state']}
            for key in ('runs','failedRuns','interruptedRuns'):
                value=runner.get(key);require(type(value) is int and value>=0,'collector_schema_invalid');cleaned[key]=value
            for key in ('startedAt','seenAt','leaseUntil','finishedAt','lastFailureAt'):cleaned[key]=safe_stamp(runner[key],key in ('finishedAt','lastFailureAt'))
            result['payoutRunner']=cleaned
        result.update(launchReadinessAssessed=False,settlementAssessed=False)
    else:
        require(report.get('remoteReadbackPerformedByReport') is False,'collector_schema_invalid')
        for key in ('due','running'):
            require(type(report.get(key)) is bool,'collector_schema_invalid');result[key]=report[key]
        for key in ('lastSeenAt','nextDueAt'):result[key]=safe_stamp(report[key],True)
        for key in ('lastAttempt','lastSuccess','lastFailure'):
            event=report[key];result[key]=None
            if event is not None:
                require(isinstance(event,dict) and event.get('status') in ('running','succeeded','failed','interrupted'),'collector_schema_invalid')
                cleaned={'status':event['status'],'startedAt':safe_stamp(event['startedAt']),'deadlineAt':safe_stamp(event['deadlineAt'])}
                if 'finishedAt' in event:cleaned['finishedAt']=safe_stamp(event['finishedAt'])
                result[key]=cleaned
        result['remoteReadbackPerformedByReport']=False
    return result


def backup_config(config):
    value=alerts.read_json(config['backupConfig'],16384)
    require(isinstance(value,dict) and value.get('deployment')==config['deployment'],'collector_scope_invalid')
    alerts.private_directory(value['stateDirectory'])
    return value


def commands(config):
    return {
      'commerce':['node',str(ROOT/'tools/commerce/operations-report.mjs'),'--deployment='+config['deployment'],'--fail-on-warning'],
      'backup':[sys.executable,'-B',str(ROOT/'tools/commerce/workbench-backup-runner.py'),'report','--config='+config['backupConfig']]}


def collect(config,executor=execute,now=time.time):
    with lock(config,'collector') as acquired:
        if not acquired:return {'version':1,'status':'overlap_skipped','exitCode':0}
        root=Path(config['reportsDirectory']);started=now();results={}
        state={'version':1,'deployment':config['deployment'],'startedAt':iso(started),'finishedAt':None,'status':'running','results':{}}
        atomic_json(root/'collector-status.json',state)
        for source,command in commands(config).items():
            try:
                if source=='commerce':require(bool(os.environ.get('CLOUDFLARE_API_TOKEN')),'collector_credentials_missing')
                else:backup_config(config)
                status,raw=executor(command,config[source+'TimeoutSeconds'])
                report=sanitize(source,raw,status,config['deployment'],now())
                result={'status':'observed','exitCode':status}
            except (alerts.AlertError,OSError,ValueError,TypeError,KeyError) as error:
                allowed={'collector_timeout','collector_output_too_large','collector_command_failed','collector_json_invalid','collector_scope_invalid','collector_schema_invalid','collector_exit_mismatch','collector_clock_invalid','collector_credentials_missing'}
                reason=str(error) if isinstance(error,alerts.AlertError) and str(error) in allowed else 'collector_inspection_failed'
                report={'version':1,'deployment':config['deployment'],'source':source,'observedAt':iso(now()),'readOnly':True,'warnings':['collector_failed'],'collectorReason':reason,'exitCode':1}
                result={'status':'failed','exitCode':1,'reason':reason}
            # Failure markers replace old healthy data atomically; the alert consumer
            # retains its previously accepted incident codes on exitCode=1.
            atomic_json(root/(source+'.json'),report);results[source]=result
            state['results']=dict(results);atomic_json(root/'collector-status.json',state)
        state.update(finishedAt=iso(now()),status='failed' if any(r['exitCode']==1 for r in results.values()) else 'completed')
        atomic_json(root/'collector-status.json',state)
        return {**state,'exitCode':1 if state['status']=='failed' else 2 if any(r['exitCode']==2 for r in results.values()) else 0}


def freshness(value,now,limit):
    stamp=timestamp(value)
    if stamp>now+60:return 'clock_invalid'
    return 'stale' if now-stamp>limit else None


def watchdog(config,now=time.time):
    with lock(config,'watchdog') as acquired:
        if not acquired:return {'version':1,'status':'overlap_skipped','exitCode':0}
        observed=now();warnings=[];root=Path(config['reportsDirectory'])
        def inspect(name,reader):
            try:reader()
            except FileNotFoundError:warnings.append(name+'_missing')
            except (alerts.AlertError,OSError,ValueError,TypeError,KeyError,sqlite3.Error,IndexError):warnings.append(name+'_invalid')
        def collector():
            state=alerts.read_json(root/'collector-status.json');require(state.get('version')==1 and state.get('deployment')==config['deployment'],'scope')
            issue=freshness(state['finishedAt'] or state['startedAt'],observed,config['staleSeconds'])
            if issue:warnings.append('monitor_'+issue)
            if state['status']=='failed':warnings.append('monitor_failed')
            elif state['status']=='running' and observed-timestamp(state['startedAt'])>config['commerceTimeoutSeconds']+config['backupTimeoutSeconds']+30:warnings.append('monitor_interrupted')
            else:require(state['status'] in ('running','completed'),'state')
        inspect('monitor',collector)
        for source in ('commerce','backup'):
            def report(source=source):
                value=alerts.read_json(root/(source+'.json'));require(value.get('deployment')==config['deployment'] and value.get('readOnly') is True,'scope')
                issue=freshness(value['observedAt'],observed,config['staleSeconds'])
                if issue:warnings.append(source+'_report_'+issue)
                require(value.get('exitCode') in (0,1,2),'report')
                if value['exitCode']==1:warnings.append(source+'_report_failed')
            inspect(source+'_report',report)
        def backup():
            config_value=backup_config(config);state=alerts.read_json(Path(config_value['stateDirectory'])/('runner-'+config['deployment'])/'status.json')
            require(state.get('version')==1 and state.get('deployment')==config['deployment'],'scope')
            attempt=state.get('lastAttempt');running=False
            if attempt:
                require(attempt.get('status') in ('running','failed','interrupted','succeeded'),'state')
                if attempt['status']=='running':
                    start,deadline=timestamp(attempt['startedAt']),timestamp(attempt['deadlineAt'])
                    require(start<=observed+60 and start<deadline<=start+3600,'clock')
                    running=observed<=deadline
                    if not running:warnings.append('backup_runner_interrupted')
                elif attempt['status'] in ('failed','interrupted'):warnings.append('backup_runner_'+attempt['status'])
            issue=freshness(state['seenAt'],observed,config['staleSeconds'])
            if issue and (issue!='stale' or not running):warnings.append('backup_runner_'+issue)
            if not state.get('lastSuccess'):warnings.append('backup_never_succeeded')
        inspect('backup_runner',backup)
        def alert():
            root_path=alerts.private_directory(config['alertStateDirectory'])
            path=root_path/'alerts.sqlite3';alerts.private_file(path)
            connection=sqlite3.connect(path.as_uri()+'?mode=ro',uri=True,timeout=1)
            try:
                connection.execute('PRAGMA query_only=ON')
                require(connection.execute("SELECT value FROM metadata WHERE key='deployment'").fetchone()[0]==config['deployment'],'scope')
                seen=float(connection.execute("SELECT value FROM metadata WHERE key='seen_at'").fetchone()[0])
                issue=freshness(iso(seen),observed,config['staleSeconds'])
                if issue:warnings.append('alert_runner_'+issue)
                oldest=connection.execute("SELECT MIN(created_at) FROM events WHERE state!='delivered'").fetchone()[0]
                if oldest is not None and observed-float(oldest)>config['staleSeconds']:warnings.append('alert_delivery_overdue')
                if connection.execute("SELECT 1 FROM events WHERE state!='delivered' AND last_error IN ('transport_retry_window_expired','transport_credential_changed','transport_destination_changed') LIMIT 1").fetchone():warnings.append('alert_delivery_needs_review')
            finally:connection.close()
        inspect('alert_runner',alert)
        result={'version':1,'deployment':config['deployment'],'observedAt':iso(observed),'status':'warning' if warnings else 'healthy','readOnlyInputs':True,'warnings':sorted(set(warnings)),'exitCode':2 if warnings else 0}
        atomic_json(root/'watchdog.json',result)
        return result


def main(argv=None):
    os.umask(0o077)
    parser=argparse.ArgumentParser(description=__doc__,allow_abbrev=False)
    parser.add_argument('action',choices=('collect','watchdog'));parser.add_argument('--config',required=True,action=alerts.Once)
    args=parser.parse_args(argv);config=configuration(args.config)
    return collect(config) if args.action=='collect' else watchdog(config)

if __name__=='__main__':
    try:
        result=main();print(json.dumps(result,indent=2));sys.exit(result['exitCode'])
    except (alerts.AlertError,OSError,ValueError,TypeError,KeyError,sqlite3.Error):
        print(json.dumps({'version':1,'warnings':['operations_monitor_failed'],'exitCode':1}));sys.exit(1)
