"""Offline collectors, atomic publishing and watchdog failure/recovery fixtures."""
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('monitor',Path(__file__).with_name('operations-monitor.py'))
monitor=importlib.util.module_from_spec(spec);spec.loader.exec_module(monitor)
alerts=monitor.alerts

class MonitorTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.clock=1800000000
        for name in ('reports','backup','alerts'):(self.root/name).mkdir(mode=0o700)
        self.backup_config=self.root/'backup.json';self.write(self.backup_config,{'deployment':'beta','stateDirectory':str(self.root/'backup')})
        self.path=self.root/'monitor.json';self.write(self.path,{'deployment':'beta','reportsDirectory':str(self.root/'reports'),'backupConfig':str(self.backup_config),'alertStateDirectory':str(self.root/'alerts'),'commerceTimeoutSeconds':1,'backupTimeoutSeconds':1,'staleSeconds':900})
        self.config=monitor.configuration(self.path);self.calls=[]
        self.responses={'commerce':self.commerce(),'backup':self.backup()}

    def tearDown(self):self.temp.cleanup()

    def write(self,path,value):path.write_text(json.dumps(value));path.chmod(0o600)

    def commerce(self,codes=None):
        value={'version':2,'deployment':'beta','environment':'production','readOnly':True,'observedAt':alerts.iso(self.clock),'warnings':codes or [],'exitCode':2 if codes else 0,'payoutRunner':None,'privateReceipt':{'email':'private@example.test','token':'DO-NOT-COPY'}}
        for section,fields in alerts.COUNT_FIELDS.items():value[section]={field:0 for field in fields.split()}
        return value

    def backup(self):
        return {'version':1,'deployment':'beta','readOnly':True,'observedAt':alerts.iso(self.clock),'warnings':[],'exitCode':0,'lastSeenAt':alerts.iso(self.clock),'lastAttempt':{'status':'succeeded','startedAt':alerts.iso(self.clock-10),'deadlineAt':alerts.iso(self.clock+10),'finishedAt':alerts.iso(self.clock),'runId':'PRIVATE-RUN','rawReceipt':'SECRET'},'lastSuccess':None,'lastFailure':None,'nextDueAt':alerts.iso(self.clock+86400),'due':False,'running':False,'remoteReadbackPerformedByReport':False}

    def executor(self,command,timeout):
        source='commerce' if any('operations-report.mjs' in arg for arg in command) else 'backup'
        self.calls.append((source,command,timeout));value=self.responses[source]
        if isinstance(value,Exception):raise value
        if isinstance(value,tuple):return value
        return value['exitCode'],json.dumps(value).encode()

    def collect(self):
        with patch.dict(os.environ,{'CLOUDFLARE_API_TOKEN':'offline-fixture-only'}):return monitor.collect(self.config,executor=self.executor,now=lambda:self.clock)

    def read(self,name):return alerts.read_json(self.root/'reports'/name)

    def healthy_states(self):
        root=self.root/'backup'/'runner-beta';root.mkdir(mode=0o700,exist_ok=True)
        self.write(root/'status.json',{'version':1,'deployment':'beta','seenAt':alerts.iso(self.clock),'lastAttempt':{'status':'succeeded'},'lastSuccess':{'finishedAt':alerts.iso(self.clock)}})
        config={'deployment':'beta','stateDirectory':str(self.root/'alerts')};connection=alerts.connect(config)
        with connection:connection.execute("INSERT OR REPLACE INTO metadata VALUES('seen_at',?)",(str(self.clock),))
        connection.close()

    def test_collects_exact_readonly_commands_sanitized_atomic_and_alert_compatible(self):
        result=self.collect();self.assertEqual(result['exitCode'],0)
        self.assertEqual([row[0] for row in self.calls],['commerce','backup'])
        self.assertIn('--deployment=beta',self.calls[0][1]);self.assertIn('--fail-on-warning',self.calls[0][1])
        self.assertIn('report',self.calls[1][1]);self.assertNotIn('run',self.calls[1][1])
        for source in ('commerce','backup'):
            path=self.root/'reports'/(source+'.json');self.assertEqual(path.stat().st_mode&0o777,0o600)
            self.assertNotIn('PRIVATE',path.read_text());self.assertNotIn('SECRET',path.read_text());self.assertNotIn('private@example',path.read_text())
            codes,_,_=alerts.inspect_input({'deployment':'beta'},{'source':source,'path':str(path),'maxAgeSeconds':900},self.clock,None)
            self.assertEqual(codes,[])
        self.assertEqual(list((self.root/'reports').glob('.*.json-*')),[])
        self.assertEqual(self.read('collector-status.json')['status'],'completed')

    def test_failed_source_replaces_healthy_report_other_source_continues_and_recovers(self):
        self.collect();self.responses['commerce']=monitor.alerts.AlertError('collector_timeout');self.clock+=5
        result=self.collect();self.assertEqual(result['exitCode'],1)
        self.assertEqual(self.read('commerce.json')['collectorReason'],'collector_timeout')
        self.assertEqual(self.read('backup.json')['exitCode'],0)
        self.responses['commerce']=self.commerce(['jobs_uncertain']);result=self.collect()
        self.assertEqual(result['exitCode'],2);self.assertEqual(self.read('commerce.json')['warnings'],['jobs_uncertain'])
        self.assertEqual(self.read('collector-status.json')['status'],'completed')

    def test_missing_credentials_never_runs_wranger_and_marks_failure(self):
        with patch.dict(os.environ,{},clear=True):result=monitor.collect(self.config,executor=self.executor,now=lambda:self.clock)
        self.assertEqual(result['exitCode'],1);self.assertEqual([c[0] for c in self.calls],['backup'])
        self.assertEqual(self.read('commerce.json')['collectorReason'],'collector_credentials_missing')

    def test_invalid_scope_exit_json_and_oversized_subprocess_are_failures(self):
        cases=[((1,b'private stderr'), 'collector_command_failed'),((0,b'bad-json'),'collector_json_invalid')]
        report=self.commerce();report['deployment']='test';cases.append(((0,json.dumps(report).encode()),'collector_scope_invalid'))
        report=self.commerce();report['exitCode']=2;cases.append(((0,json.dumps(report).encode()),'collector_exit_mismatch'))
        for response,reason in cases:
            self.responses['commerce']=response;self.collect();self.assertEqual(self.read('commerce.json')['collectorReason'],reason)
        with self.assertRaisesRegex(alerts.AlertError,'collector_output_too_large'):
            monitor.execute([sys.executable,'-c',"print('x'*140000)"],2)

    def test_actual_subprocess_timeout_error_output_and_private_stderr(self):
        status,raw=monitor.execute([sys.executable,'-c',"import sys;print('ok');print('secret token',file=sys.stderr);sys.exit(2)"],2)
        self.assertEqual((status,raw),(2,b'ok\n'))
        start=time.monotonic()
        with self.assertRaisesRegex(alerts.AlertError,'collector_timeout'):monitor.execute([sys.executable,'-c','import time;time.sleep(20)'],0.15)
        self.assertLess(time.monotonic()-start,1.5)

    def test_process_group_cleanup_and_missing_alert_directory_are_independent(self):
        pidfile=self.root/'child.pid'
        script="import subprocess,sys,time; from pathlib import Path; child=subprocess.Popen([sys.executable,'-c','import time; time.sleep(20)'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); Path(sys.argv[1]).write_text(str(child.pid)); print('done')"
        status,raw=monitor.execute([sys.executable,'-c',script,str(pidfile)],2)
        self.assertEqual((status,raw),(0,b'done\n'))
        pid=int(pidfile.read_text());process=Path('/proc')/str(pid)/'stat'
        for _ in range(20):
            if not process.exists() or process.read_text().split()[2]=='Z':break
            time.sleep(0.01)
        self.assertTrue(not process.exists() or process.read_text().split()[2]=='Z')
        (self.root/'alerts').rmdir()
        config=monitor.configuration(self.path)
        self.assertEqual(self.collect()['exitCode'],0)
        self.assertIn('alert_runner_missing',monitor.watchdog(config,now=lambda:self.clock)['warnings'])

    def test_atomic_replace_failure_preserves_original_complete_report(self):
        path=self.root/'reports'/'commerce.json';self.write(path,{'original':True})
        with patch.object(monitor.os,'replace',side_effect=OSError('disk fault private path')):
            with self.assertRaises(OSError):monitor.atomic_json(path,{'replacement':True})
        self.assertEqual(self.read('commerce.json'),{'original':True})
        self.assertEqual(list((self.root/'reports').glob('.*.json-*')),[])

    def test_overlap_private_config_and_output_symlink_are_rejected(self):
        with monitor.lock(self.config,'collector'):
            self.assertEqual(self.collect()['status'],'overlap_skipped')
        self.assertEqual(self.calls,[])
        self.path.chmod(0o644)
        with self.assertRaises(alerts.AlertError):monitor.configuration(self.path)
        target=self.root/'reports'/'commerce.json';target.symlink_to(self.path)
        with self.assertRaises(alerts.AlertError):monitor.atomic_json(target,{})

    def test_watchdog_independently_detects_missing_stale_failed_and_recovery(self):
        initial=monitor.watchdog(self.config,now=lambda:self.clock)
        self.assertEqual(initial['exitCode'],2);self.assertIn('monitor_missing',initial['warnings']);self.assertIn('backup_runner_missing',initial['warnings']);self.assertIn('alert_runner_missing',initial['warnings'])
        self.collect();self.healthy_states();self.assertEqual(monitor.watchdog(self.config,now=lambda:self.clock)['warnings'],[])
        original=(self.root/'alerts'/'alerts.sqlite3').read_bytes();self.clock+=901
        stale=monitor.watchdog(self.config,now=lambda:self.clock)
        for code in ('monitor_stale','commerce_report_stale','backup_report_stale','backup_runner_stale','alert_runner_stale'):self.assertIn(code,stale['warnings'])
        self.assertEqual((self.root/'alerts'/'alerts.sqlite3').read_bytes(),original)
        self.responses={'commerce':self.commerce(),'backup':self.backup()};self.collect();self.healthy_states()
        self.assertEqual(monitor.watchdog(self.config,now=lambda:self.clock)['warnings'],[])
        self.responses['commerce']=(1,b'not forwarded');self.collect()
        failed=monitor.watchdog(self.config,now=lambda:self.clock)
        self.assertIn('monitor_failed',failed['warnings']);self.assertIn('commerce_report_failed',failed['warnings'])

    def test_watchdog_running_backup_lease_is_bounded_and_alert_overdue_visible(self):
        self.collect();self.healthy_states();path=self.root/'backup'/'runner-beta'/'status.json'
        state=alerts.read_json(path);state['seenAt']=alerts.iso(self.clock-1000);state['lastAttempt']={'status':'running','startedAt':alerts.iso(self.clock-1000),'deadlineAt':alerts.iso(self.clock+100)};self.write(path,state)
        self.assertNotIn('backup_runner_stale',monitor.watchdog(self.config,now=lambda:self.clock)['warnings'])
        self.clock+=101;warnings=monitor.watchdog(self.config,now=lambda:self.clock)['warnings']
        self.assertIn('backup_runner_stale',warnings);self.assertIn('backup_runner_interrupted',warnings)
        connection=sqlite3.connect(self.root/'alerts'/'alerts.sqlite3')
        with connection:connection.execute("INSERT INTO events(id,payload,created_at,state,next_attempt_at,last_error) VALUES('fixture','{}',?,'queued',?,'transport_retry_window_expired')",(self.clock-1000,self.clock))
        connection.close();warnings=monitor.watchdog(self.config,now=lambda:self.clock)['warnings']
        self.assertIn('alert_delivery_overdue',warnings);self.assertIn('alert_delivery_needs_review',warnings)

    def test_watchdog_interrupted_collector_and_future_heartbeats_cannot_look_healthy(self):
        self.collect();self.healthy_states()
        status=self.read('collector-status.json');status.update(status='running',startedAt=alerts.iso(self.clock-100),finishedAt=None)
        self.write(self.root/'reports'/'collector-status.json',status)
        backup=self.root/'backup'/'runner-beta'/'status.json';state=alerts.read_json(backup);state['seenAt']=alerts.iso(self.clock+1000);self.write(backup,state)
        connection=sqlite3.connect(self.root/'alerts'/'alerts.sqlite3')
        with connection:connection.execute("UPDATE metadata SET value=? WHERE key='seen_at'",(str(self.clock+1000),))
        connection.close()
        result=monitor.watchdog(self.config,now=lambda:self.clock)
        for code in ('monitor_interrupted','backup_runner_clock_invalid','alert_runner_clock_invalid'):self.assertIn(code,result['warnings'])
        self.assertEqual(result['exitCode'],2)

    def test_watchdog_uses_no_commands_credentials_or_notification_adapter(self):
        self.collect();self.healthy_states()
        with patch.dict(os.environ,{},clear=True),patch.object(monitor.subprocess,'Popen',side_effect=AssertionError('must not spawn')),patch.object(alerts,'send_https',side_effect=AssertionError('must not send')):
            self.assertEqual(monitor.watchdog(self.config,now=lambda:self.clock)['exitCode'],0)
        with monitor.lock(self.config,'watchdog'):
            self.assertEqual(monitor.watchdog(self.config,now=lambda:self.clock)['status'],'overlap_skipped')

if __name__=='__main__':unittest.main()
