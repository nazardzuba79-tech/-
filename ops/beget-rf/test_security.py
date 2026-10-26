"""Narrow security-order checks, no production traffic or financial operations."""
import hashlib
import importlib.util
import os
from pathlib import Path
import socket
import ssl
import subprocess
import tempfile
import threading
import time
import unittest

from passthrough_proposal import HOST, render
from security_hold import CONFIG

ROOT = Path(__file__).parent


def port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


class HoldTests(unittest.TestCase):
    def test_default_has_no_sensitive_or_frontend_upstream(self):
        spec = importlib.util.spec_from_file_location('legacy_renderer', ROOT / 'render.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        self.assertEqual(module.render(), CONFIG)
        self.assertNotIn('proxy_pass', CONFIG)
        self.assertNotIn('ssl_certificate', CONFIG)
        self.assertNotIn('listen 443', CONFIG)
        self.assertIn('return 503', CONFIG)
        self.assertIn('access_log off', CONFIG)

    def test_superseded_activators_stop_before_any_mutation(self):
        for file, args in [('stage1.py', []), ('stage2.py', ['--owner-agreed-le-20260706']),
                           ('activate_existing_tls.py', []), ('build_transfer.py', ['/must-not-exist'])]:
            result = subprocess.run(['python3', str(ROOT / file), *args], capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('OWNER SECURITY HOLD', result.stderr)

    def test_proposal_rejects_unreviewed_targets(self):
        for target in ('185.23.35.226', '127.0.0.1', '10.0.0.1', 'host.invalid', '::1'):
            with self.assertRaises(ValueError):
                render(target, '/tmp/proposal')


class StreamTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory(prefix='voltex-tls-fixture-')
        cls.root = Path(cls.tmp.name)
        cls.port = port()
        cls.backend_port = port()
        cls.requests = []
        cls.stop = threading.Event()
        cert, key = cls.root / 'trusted-endpoint.pem', cls.root / 'trusted-endpoint.key'
        subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
            '-subj', '/CN=' + HOST, '-addext', 'subjectAltName=DNS:' + HOST,
            '-keyout', str(key), '-out', str(cert)], check=True, capture_output=True)
        cls.fingerprint = hashlib.sha256(ssl.PEM_cert_to_DER_cert(cert.read_text())).hexdigest()
        cls.client_context = ssl.create_default_context(cafile=str(cert))
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(cert, key)
        cls.listener = socket.socket()
        cls.listener.bind(('127.0.0.1', cls.backend_port))
        cls.listener.listen()
        cls.listener.settimeout(0.2)

        def serve():
            while not cls.stop.is_set():
                try:
                    connection, _ = cls.listener.accept()
                except socket.timeout:
                    continue
                try:
                    connection.settimeout(2)
                    with context.wrap_socket(connection, server_side=True) as tls:
                        data = tls.recv(8192)
                        if not data:
                            continue
                        cls.requests.append(data)
                        blocked = data.startswith(b'GET /admin ')
                        body = b'trusted endpoint denied admin' if blocked else b'fixture: exact trusted bytes'
                        status = b'403 Forbidden' if blocked else b'200 OK'
                        tls.sendall(b'HTTP/1.1 ' + status + b'\r\nConnection: close\r\nContent-Length: ' + str(len(body)).encode() + b'\r\n\r\n' + body)
                except (ssl.SSLError, OSError):
                    connection.close()

        cls.thread = threading.Thread(target=serve, daemon=True)
        cls.thread.start()
        cls.relay_root = cls.root / 'relay'
        cls.relay_root.mkdir()
        config = cls.relay_root / 'nginx.conf'
        config.write_text(render('127.0.0.1', cls.relay_root, cls.port, cls.backend_port, fixture=True))
        cls.nginx = os.environ['NGINX_BIN']
        subprocess.run([cls.nginx, '-t', '-c', str(config)], check=True, capture_output=True)
        cls.process = subprocess.Popen([cls.nginx, '-c', str(config), '-g', 'daemon off;'], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        deadline = time.monotonic() + 5
        while True:
            try:
                with socket.create_connection(('127.0.0.1', cls.port), timeout=0.2):
                    break
            except OSError:
                if time.monotonic() >= deadline:
                    raise
                time.sleep(0.05)

    @classmethod
    def tearDownClass(cls):
        cls.process.terminate()
        cls.process.wait(timeout=5)
        cls.process.stderr.close()
        cls.stop.set()
        cls.thread.join(timeout=2)
        cls.listener.close()
        log = cls.relay_root / 'error.log'
        if log.exists():
            print('\nSynthetic stream diagnostic log:\n' + log.read_text())
        cls.tmp.cleanup()

    def request(self, path='/'):
        with socket.create_connection(('127.0.0.1', self.port), timeout=2) as raw:
            with self.client_context.wrap_socket(raw, server_hostname=HOST) as tls:
                fingerprint = hashlib.sha256(tls.getpeercert(binary_form=True)).hexdigest()
                tls.sendall(('GET ' + path + ' HTTP/1.1\r\nHost: ' + HOST + '\r\nConnection: close\r\n\r\n').encode())
                parts = []
                while chunk := tls.recv(8192):
                    parts.append(chunk)
                return fingerprint, b''.join(parts)

    def test_endpoint_certificate_and_bytes_survive_opaque_relay(self):
        fingerprint, response = self.request()
        self.assertEqual(fingerprint, self.fingerprint)
        self.assertTrue(response.endswith(b'fixture: exact trusted bytes'))
        self.assertEqual(list(self.relay_root.glob('*.key')), [])
        config = (self.relay_root / 'nginx.conf').read_text()
        self.assertNotIn('ssl_certificate', config)
        self.assertNotIn('http {', config)

    def test_admin_denial_is_enforced_at_trusted_endpoint(self):
        _, response = self.request('/admin')
        self.assertIn(b'403 Forbidden', response)
        self.assertTrue(self.requests[-1].startswith(b'GET /admin '))

    def test_foreign_or_absent_sni_is_rejected(self):
        for hostname in ('voltextech.net', None):
            context = self.client_context
            if hostname is None:
                context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
                context.check_hostname = False
                context.verify_mode = ssl.CERT_REQUIRED
                # No-SNI rejection occurs before any certificate can be returned.
            with socket.create_connection(('127.0.0.1', self.port), timeout=2) as raw:
                with self.assertRaises((ssl.SSLError, ConnectionResetError)):
                    context.wrap_socket(raw, server_hostname=hostname)

    def test_untrusted_certificate_is_not_accepted(self):
        context = ssl.create_default_context()
        with socket.create_connection(('127.0.0.1', self.port), timeout=2) as raw:
            with self.assertRaises(ssl.SSLCertVerificationError):
                context.wrap_socket(raw, server_hostname=HOST)


if __name__ == '__main__':
    unittest.main(verbosity=2)
