"""Exercise the real collector's OTLP routing, auth, and durable retry queue.

Run with Python 3 and Docker: python3 tests/test_observability.py
Uses synthetic data and a local fake PostHog; no production credentials needed.
"""
import gzip
import json
from pathlib import Path
import subprocess
import threading
import time
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

IMAGE = 'otel/opentelemetry-collector-contrib:0.160.0@sha256:799dc6cf12c96192af37b5bdba804da8c10b3bc563b43cb90c3f3c58d9572ad6'
CONFIG = Path(__file__).resolve().parents[1] / 'ops/production/observability/otel-collector.yaml'
TRACE_ID = '11223344556677889900aabbccddeeff'
SPAN_ID = '1122334455667788'
received = []
attempted = threading.Event()
accepting = threading.Event()


class Receiver(BaseHTTPRequestHandler):
    def do_POST(self):
        body = self.rfile.read(int(self.headers['Content-Length']))
        if self.headers.get('Content-Encoding') == 'gzip':
            body = gzip.decompress(body)
        attempted.set()
        if accepting.is_set():
            received.append((self.path, dict(self.headers), body))
            self.send_response(200)
            self.send_header('Content-Type', 'application/x-protobuf')
        else:
            self.send_response(503)
        self.send_header('Content-Length', '0')
        self.end_headers()

    def log_message(self, *_):
        pass


def docker(*args):
    return subprocess.check_output(['docker', *args], text=True).strip()


def wait_for(predicate, description):
    deadline = time.monotonic() + 40
    while time.monotonic() < deadline:
        try:
            if predicate():
                return
        except (OSError, urllib.error.URLError):
            pass
        time.sleep(0.25)
    raise AssertionError(description)


suffix = uuid.uuid4().hex[:12]
name = 'uwplan-otel-test-' + suffix
volume = name + '-queue'
server = ThreadingHTTPServer(('0.0.0.0', 0), Receiver)
threading.Thread(target=server.serve_forever, daemon=True).start()
try:
    docker('volume', 'create', volume)
    docker('run', '-d', '--name', name, '--user', '0:0', '--read-only',
           '--cap-drop=ALL', '--security-opt=no-new-privileges:true',
           '--add-host=host.docker.internal:host-gateway', '--memory=256m',
           '-e', 'GOMEMLIMIT=192MiB',
           '-e', 'POSTHOG_PROJECT_TOKEN=phc_synthetic',
           '-e', f'POSTHOG_OTLP_ENDPOINT=http://host.docker.internal:{server.server_port}/i',
           '-p', '127.0.0.1::4318', '-p', '127.0.0.1::13133',
           '-v', f'{CONFIG}:/etc/otelcol/config.yaml:ro',
           '-v', f'{volume}:/var/lib/otelcol', IMAGE,
           '--config=/etc/otelcol/config.yaml')
    ingest = 'http://' + docker('port', name, '4318/tcp')
    health = 'http://' + docker('port', name, '13133/tcp')
    wait_for(lambda: urllib.request.urlopen(health, timeout=2).status == 200,
             'collector did not become healthy')
    now = str(time.time_ns())
    resource = {'attributes': [{'key': 'service.name', 'value': {'stringValue': 'synthetic-test'}}]}
    signals = {
        'logs': {'resourceLogs': [{'resource': resource, 'scopeLogs': [{'logRecords': [{
            'timeUnixNano': now, 'severityNumber': 9, 'severityText': 'INFO',
            'body': {'stringValue': 'queue-survives-restart'},
            'traceId': TRACE_ID, 'spanId': SPAN_ID}]}]}]},
        'traces': {'resourceSpans': [{'resource': resource, 'scopeSpans': [{'spans': [{
            'traceId': TRACE_ID, 'spanId': SPAN_ID, 'name': 'queue-survives-restart',
            'kind': 2, 'startTimeUnixNano': now, 'endTimeUnixNano': str(int(now) + 1000000)}]}]}]},
        'metrics': {'resourceMetrics': [{'resource': resource, 'scopeMetrics': [{'metrics': [{
            'name': 'queue-survives-restart', 'gauge': {'dataPoints': [{
                'timeUnixNano': now, 'asDouble': 1.0}]}}]}]}]},
    }
    for signal, payload in signals.items():
        request = urllib.request.Request(ingest + '/v1/' + signal,
            json.dumps(payload).encode(), {'Content-Type': 'application/json'})
        with urllib.request.urlopen(request, timeout=10) as response:
            assert response.status == 200
    assert attempted.wait(15), 'collector never tried the configured endpoint'
    # Abrupt termination while the upstream returns 503: queued data must survive.
    docker('kill', name)
    accepting.set()
    docker('start', name)
    wait_for(lambda: {p for p, _, _ in received} == {'/i/v1/logs', '/i/v1/traces', '/i/v1/metrics'},
             'durable logs, traces or metrics were lost after restart')
    for path, headers, body in received:
        assert headers.get('Authorization') == 'Bearer phc_synthetic', (path, headers)
        assert headers.get('Content-Type') == 'application/x-protobuf', headers
        assert b'deployment.environment' in body and b'production' in body, path
        assert b'synthetic-test' in body and b'queue-survives-restart' in body, path
        if path.endswith(('/logs', '/traces')):
            assert bytes.fromhex(TRACE_ID) in body and bytes.fromhex(SPAN_ID) in body, path
    print('PASS: logs, traces and metrics use authenticated /i/v1 endpoints; service and trace IDs survive; queued data survives abrupt restart.')
except Exception:
    print(docker('logs', name))
    raise
finally:
    docker('rm', '-f', name)
    docker('volume', 'rm', volume)
    server.shutdown()
    server.server_close()
