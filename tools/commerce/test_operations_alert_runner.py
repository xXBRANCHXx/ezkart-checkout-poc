"""Offline durable outbox and local HTTPS wire tests; no real alert destination."""
import importlib.util
import json
import os
from pathlib import Path
import ssl
import subprocess
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('alerts', Path(__file__).with_name('operations-alert-runner.py'))
alerts = importlib.util.module_from_spec(spec)
spec.loader.exec_module(alerts)

class AlertsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.clock = 1800000000
        self.config_path = self.root / 'config.json'
        self.input = self.root / 'commerce.json'
        self.write(self.config_path, {'deployment':'beta','stateDirectory':str(self.root),
            'inputs':[{'source':'commerce','path':str(self.input),'maxAgeSeconds':900}],
            'retrySeconds':1,'maxRetrySeconds':10,'overdueSeconds':60,'reminderSeconds':60,'timeoutSeconds':1})
        self.config = alerts.configuration(self.config_path)
        self.sent = []
        self.report_input(['jobs_uncertain'])

    def tearDown(self):
        self.temp.cleanup()

    def write(self, path, value):
        path.write_text(json.dumps(value)); path.chmod(0o600)

    def report_input(self, codes=None, **changes):
        report = {'version':2,'deployment':'beta','environment':'production','observedAt':alerts.iso(self.clock),
          'readOnly':True,'warnings':codes or [],'exitCode':2 if codes else 0,'payoutRunner':None}
        for section, fields in alerts.COUNT_FIELDS.items():
            report[section] = {field:0 for field in fields.split()}
        report.update(changes)
        self.write(self.input, report)

    def run_once(self, send=False, sender=None):
        with patch.dict(os.environ, {'EZKART_ALERT_ENDPOINT':'https://alerts.example.test/events','EZKART_ALERT_TOKEN':'fixture-token-only-no-real-secret'}):
            return alerts.run_once(self.config, send=send, sender=sender or self.send, now=lambda:self.clock)

    def send(self, endpoint, token, event_id, body, timeout):
        self.sent.append((event_id, json.loads(body)))

    def rows(self):
        connection = alerts.connect(self.config)
        try:
            return [dict(row) for row in connection.execute('SELECT * FROM events ORDER BY sequence')]
        finally:
            connection.close()

    def test_queue_duplicate_change_recovery_and_private_redaction(self):
        raw = json.loads(self.input.read_text()); raw['rawProviderReceipt'] = {'email':'secret@example.test','token':'NEVER-OUTPUT'}; self.write(self.input,raw)
        self.assertEqual(self.run_once()['queued'],1)
        self.assertEqual(self.run_once()['queued'],1)
        self.assertEqual(self.sent,[])
        self.clock += 1; self.report_input(['jobs_uncertain','jobs_overdue'])
        self.assertEqual(self.run_once()['queued'],2)
        self.clock += 1; self.report_input([]); self.run_once()
        self.assertEqual(self.rows()[-1]['state'],'queued')
        result = self.run_once(True)
        self.assertEqual(result['queued'],0); self.assertEqual(result['delivered'],3)
        self.assertEqual([row[1]['kind'] for row in self.sent],['warning_changed','warning_changed','recovery'])
        self.assertEqual(self.sent[-1][1]['resolvedWarningCodes'],['jobs_overdue','jobs_uncertain'])
        output = json.dumps(self.rows()) + json.dumps(result)
        self.assertNotIn('secret@example',output); self.assertNotIn('NEVER-OUTPUT',output)
        self.assertTrue(all((self.root / name).stat().st_mode & 0o777 == 0o600 for name in ['alerts.sqlite3','.alerts.lock']))

    def test_failed_lost_ack_retries_exact_id_payload_and_order(self):
        def lost(*args):
            self.send(*args)
            raise OSError('raw response with private data')
        first = self.run_once(True,lost)
        self.assertIn('alert_delivery_unconfirmed',first['warnings'])
        event_id, body = self.sent[0]
        self.assertEqual(self.rows()[0]['attempts'],1)
        self.run_once(True); self.assertEqual(len(self.sent),1)
        self.clock += 1; self.report_input([]); self.run_once(True)
        self.assertEqual(self.sent[1],(event_id,body))
        self.assertEqual(self.sent[2][1]['kind'],'recovery')
        self.assertEqual([row['state'] for row in self.rows()],['delivered','delivered'])
        self.assertNotIn('private data',json.dumps(self.rows()))

    def test_process_crash_after_send_preserves_attempting_identity(self):
        class Crash(BaseException): pass
        def crash(*args):
            self.send(*args); raise Crash()
        with self.assertRaises(Crash): self.run_once(True,crash)
        self.assertEqual(self.rows()[0]['state'],'attempting')
        first = self.sent[0]
        self.clock += 2; self.run_once(True)
        self.assertEqual(self.sent[1],first)
        self.assertEqual(self.rows()[0]['attempts'],2)

    def test_missing_stale_failed_invalid_and_recovery_never_clear_prior_warning(self):
        self.run_once()
        self.input.unlink(); self.clock += 1
        self.assertEqual(self.run_once()['sources']['commerce'],['input_missing','jobs_uncertain'])
        self.write(self.input,{'version':1,'exitCode':1,'warnings':['raw_sensitive_body']})
        self.clock += 1
        self.assertEqual(self.run_once()['sources']['commerce'],['input_failed','jobs_uncertain'])
        self.report_input([],observedAt=alerts.iso(self.clock-1000))
        self.assertEqual(self.run_once()['sources']['commerce'],['input_stale','jobs_uncertain'])
        self.report_input([],observedAt=alerts.iso(self.clock+1000))
        self.assertEqual(self.run_once()['sources']['commerce'],['input_clock_invalid','jobs_uncertain'])
        self.report_input(['private@example.test'])
        self.assertEqual(self.run_once()['sources']['commerce'],['input_invalid','jobs_uncertain'])
        self.report_input([]); self.assertEqual(self.run_once()['sources']['commerce'],[])
        self.assertEqual(json.loads(self.rows()[-1]['payload'])['kind'],'recovery')

    def test_regressed_and_same_timestamp_conflicting_reports_are_not_healthy(self):
        self.run_once()
        self.report_input([])
        self.assertIn('input_conflicting',self.run_once()['sources']['commerce'])
        self.report_input([],observedAt=alerts.iso(self.clock-1))
        self.assertIn('input_regressed',self.run_once()['sources']['commerce'])
        self.clock += 1; self.report_input([]); self.assertEqual(self.run_once()['sources']['commerce'],[])

    def test_unconfigured_destination_overdue_and_reminder(self):
        with patch.dict(os.environ,{},clear=True):
            first = alerts.run_once(self.config,send=True,sender=self.send,now=lambda:self.clock)
            self.assertIn('alert_destination_unconfigured',first['warnings']); self.assertEqual(self.sent,[])
            self.clock += 61
            state = alerts.run_once(self.config,send=True,sender=self.send,now=lambda:self.clock)
            self.assertIn('alert_delivery_overdue',state['warnings']); self.assertEqual(state['queued'],2)
            self.assertEqual(json.loads(self.rows()[-1]['payload'])['kind'],'reminder')
            self.clock += 901
            self.assertIn('alert_runner_overdue',alerts.report(self.config,now=lambda:self.clock)['warnings'])

    def test_overlap_is_readonly_and_private_permissions_are_enforced(self):
        with alerts.lock(self.config):
            self.assertEqual(self.run_once()['status'],'overlap_skipped')
        self.assertFalse((self.root/'alerts.sqlite3').exists())
        self.config_path.chmod(0o644)
        with self.assertRaises(alerts.AlertError): alerts.configuration(self.config_path)
        self.config_path.chmod(0o600); self.input.chmod(0o644)
        self.assertEqual(self.run_once()['sources']['commerce'],['input_invalid'])
        (self.root/'alias').symlink_to(self.config_path)
        with self.assertRaises(alerts.AlertError): alerts.configuration(self.root/'alias')

    def test_pending_endpoint_cannot_change_after_uncertain_send(self):
        def lost(*args): raise OSError('lost acknowledgement')
        self.run_once(True,lost); self.clock += 2
        self.config['endpoint']='https://different.example.test/events'
        with self.assertRaisesRegex(alerts.AlertError,'alert_destination_changed'): self.run_once(True)
        self.assertEqual(self.rows()[0]['attempts'],1)

    def test_bounded_queue_delivery_and_read_only_report(self):
        self.config['maxEvents']=2; self.config['maxDeliveries']=1
        self.run_once(); self.clock+=1; self.report_input([]); self.run_once()
        self.clock+=1; self.report_input(['jobs_dead'])
        full=self.run_once(); self.assertEqual(full['exitCode'],1); self.assertIn('alert_outbox_full',full['warnings'])
        self.assertEqual(len(self.rows()),2)
        full=self.run_once(True); self.assertEqual(full['exitCode'],1); self.assertEqual(len(self.sent),1)
        original=(self.root/'alerts.sqlite3').read_bytes()
        with patch.dict(os.environ,{},clear=True): alerts.report(self.config,now=lambda:self.clock)
        self.assertEqual((self.root/'alerts.sqlite3').read_bytes(),original)

    def test_backup_report_contract_and_source_scope(self):
        self.config['inputs']=[{'source':'backup','path':str(self.input),'maxAgeSeconds':900}]
        backup={'version':1,'deployment':'beta','observedAt':alerts.iso(self.clock),'readOnly':True,
            'warnings':['backup_failed'],'exitCode':2,'lastSeenAt':None,'lastAttempt':{'raw':'do not forward'},
            'lastSuccess':None,'lastFailure':{'receipt':'private'},'nextDueAt':None,'due':True,'running':False,'remoteReadbackPerformedByReport':False}
        self.write(self.input,backup); self.run_once(True)
        self.assertEqual(self.sent[0][1]['warningCodes'],['backup_failed'])
        self.assertNotIn('private',json.dumps(self.rows()))
        backup['deployment']='test'; self.write(self.input,backup)
        self.assertIn('input_scope_invalid',self.run_once()['sources']['backup'])

    def resend_config(self):
        self.config.update(transport='resend',endpoint='https://api.resend.com/emails')
        return {'EZKART_ALERT_FROM':'alerts@example.test','EZKART_ALERT_TO':'operator@example.test'}

    def test_resend_frozen_payload_lost_ack_and_original_provider_id(self):
        environment=self.resend_config()
        original_id='49a3999c-0ce1-4ea6-ab68-afcd6dc2e794'
        def lost(*args):
            self.send(*args); raise OSError('unknown Resend acknowledgement')
        def confirmed(*args):
            self.send(*args); return original_id
        with patch.dict(os.environ,environment):
            self.run_once(True,lost); first=self.sent[0]
            self.assertEqual(first[1]['to'],['operator@example.test'])
            self.assertEqual(first[1]['from'],'Ezkart Operations <alerts@example.test>')
            self.assertIn('jobs_uncertain',first[1]['text'])
            self.assertNotIn('operator@example.test',first[1]['text'])
            self.clock+=2
            with patch.dict(os.environ,{'EZKART_ALERT_TO':'another@example.test'}):
                with self.assertRaisesRegex(alerts.AlertError,'alert_destination_changed'):self.run_once(True,confirmed)
            result=self.run_once(True,confirmed)
            self.assertEqual(result['queued'],0);self.assertEqual(self.sent[1],first)
            connection=alerts.connect(self.config)
            try:self.assertEqual(connection.execute('SELECT provider_id FROM resend_requests').fetchone()[0],original_id)
            finally:connection.close()

    def test_resend_retry_window_expiry_and_credential_change_never_resend(self):
        environment=self.resend_config()
        def lost(*args):self.send(*args);raise OSError('unknown')
        with patch.dict(os.environ,environment):
            self.run_once(True,lost)
            self.clock+=23*3600
            result=self.run_once(True,lost)
            self.assertIn('alert_delivery_needs_review',result['warnings'])
            self.assertEqual(len(self.sent),1);self.assertEqual(self.rows()[0]['attempts'],1)
            self.assertEqual(self.rows()[0]['last_error'],'transport_retry_window_expired')
        # New installation exercises account-key changes before the cutoff.
        connection=alerts.connect(self.config)
        try:
            with connection:connection.execute('UPDATE resend_requests SET retry_until=?,credential_hash=?',(self.clock+1000,'another-account'))
        finally:connection.close()
        with patch.dict(os.environ,environment):
            result=self.run_once(True,lost)
            self.assertIn('alert_delivery_needs_review',result['warnings'])
            self.assertEqual(len(self.sent),1)
            self.assertEqual(self.rows()[0]['last_error'],'transport_credential_changed')

    def test_resend_staged_envelope_cannot_change_before_network_start(self):
        environment=self.resend_config()
        with patch.dict(os.environ,environment):
            self.run_once()
            connection=alerts.connect(self.config)
            try:
                event=connection.execute('SELECT * FROM events').fetchone()
                with connection:connection.execute('INSERT INTO resend_requests VALUES(?,?,?,?,?,NULL)',(event['id'],alerts.resend_payload(self.config,event['payload']),'original-account',self.clock,self.clock+23*3600))
            finally:connection.close()
            with patch.dict(os.environ,{'EZKART_ALERT_TO':'changed@example.test'}):
                result=self.run_once(True)
            self.assertIn('alert_delivery_needs_review',result['warnings'])
            self.assertEqual(self.sent,[])
            self.assertEqual(self.rows()[0]['last_error'],'transport_destination_changed')

    def test_resend_missing_recipient_and_fixed_provider_endpoint(self):
        self.resend_config()
        with patch.dict(os.environ,{},clear=True):
            result=self.run_once(True)
            self.assertIn('alert_destination_unconfigured',result['warnings']);self.assertEqual(self.sent,[])
        with patch.dict(os.environ,{'EZKART_ALERT_FROM':'alerts@example.test','EZKART_ALERT_TO':'operator@example.test'}):
            self.config['endpoint']='https://unrelated.example.test/emails'
            with self.assertRaisesRegex(alerts.AlertError,'destination_invalid'):self.run_once(True)

    def test_https_destination_rejects_redirect_like_userinfo_query_and_http(self):
        for endpoint in ['http://localhost/','https://user:pass@example.test','https://example.test?token=secret','https://example.test/#x','https://example.test/\nheader']:
            with self.assertRaises(alerts.AlertError): alerts.validate_endpoint(endpoint)

class HTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp=tempfile.TemporaryDirectory(); root=Path(cls.temp.name)
        subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-keyout',str(root/'key.pem'),'-out',str(root/'cert.pem'),'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        cls.calls=[];cls.behavior='good'
        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                length=int(self.headers['Content-Length']);body=self.rfile.read(length)
                cls.calls.append((self.path,dict(self.headers),body))
                if cls.behavior=='drop':
                    self.close_connection=True;return
                if cls.behavior=='slow': time.sleep(1.5)
                payload=json.dumps({'id':self.headers.get('Idempotency-Key'),'accepted':True}).encode()
                if cls.behavior=='resend': payload=b'{"id":"49a3999c-0ce1-4ea6-ab68-afcd6dc2e794"}'
                if cls.behavior=='wrong': payload=b'{"id":"wrong","accepted":true}'
                if cls.behavior=='large': payload=b' ' * 4097
                self.send_response(302 if cls.behavior=='redirect' else 503 if cls.behavior=='failed' else 200)
                self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(payload)))
                if cls.behavior=='redirect': self.send_header('Location','https://localhost/should-not-follow')
                self.end_headers()
                try: self.wfile.write(payload)
                except (BrokenPipeError,ssl.SSLEOFError): pass
            def log_message(self,*args): pass
        cls.server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        context=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);context.load_cert_chain(root/'cert.pem',root/'key.pem');cls.server.socket=context.wrap_socket(cls.server.socket,server_side=True)
        cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True);cls.thread.start()
        cls.context=ssl.create_default_context(cafile=str(root/'cert.pem'));cls.endpoint=f'https://localhost:{cls.server.server_port}/events'

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown();cls.server.server_close();cls.temp.cleanup()

    def send(self):
        return alerts.send_https(self.endpoint,'fixture-token-only','ezalert_fixture','{"warningCodes":["jobs_uncertain"]}',1,context=self.context)

    def test_local_https_exact_ack_auth_idempotency_and_no_redirect(self):
        type(self).behavior='good';self.send()
        path,headers,body=self.calls[-1]
        self.assertEqual(path,'/events');self.assertEqual(headers['Authorization'],'Bearer fixture-token-only');self.assertEqual(headers['Idempotency-Key'],'ezalert_fixture')
        for behavior in ('redirect','failed','wrong','large','drop'):
            type(self).behavior=behavior;before=len(self.calls)
            with self.assertRaises(alerts.AlertError): self.send()
            self.assertEqual(len(self.calls),before+1,behavior)

    def test_resend_https_submission_response_and_idempotency_wire(self):
        type(self).behavior='resend'
        payload='{"from":"alerts@example.test","to":["operator@example.test"],"subject":"Alert","text":"jobs_uncertain"}'
        result=alerts.send_resend(self.endpoint,'fixture-resend-token','ezalert_stable',payload,1,context=self.context)
        self.assertEqual(result,'49a3999c-0ce1-4ea6-ab68-afcd6dc2e794')
        self.assertEqual(self.calls[-1][1]['Idempotency-Key'],'ezalert_stable')
        self.assertEqual(self.calls[-1][2].decode(),payload)
        for behavior in ('wrong','redirect','large','failed'):
            type(self).behavior=behavior
            with self.assertRaises(alerts.AlertError):alerts.send_resend(self.endpoint,'fixture-resend-token','ezalert_stable',payload,1,context=self.context)

    def test_total_timeout_and_certificate_verification(self):
        type(self).behavior='slow';start=time.monotonic()
        with self.assertRaises(alerts.AlertError):self.send()
        self.assertLess(time.monotonic()-start,1.4)
        type(self).behavior='good'
        with self.assertRaises(alerts.AlertError): alerts.send_https(self.endpoint,'fixture-token-only','ezalert_fixture','{}',1)

if __name__=='__main__':unittest.main()
