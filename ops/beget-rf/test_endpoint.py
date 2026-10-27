"""New trusted-vhost transport checks only; no real accounts or financial writes."""
import http.client
import os
from pathlib import Path
import ssl
import subprocess
import tempfile
import threading
import time
import unittest
from http.server import ThreadingHTTPServer
from endpoint import HOST, REWRITES, ROUTES, render
from test_gateway import Fixture, free_port


class EndpointTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix='voltex-trusted-endpoint-')
        cls.root = Path(cls.temp.name)
        for p in ('client', 'proxy', 'logs'):
            (cls.root / p).mkdir()
        cls.cert, cls.key = cls.root / 'cert.pem', cls.root / 'key.pem'
        subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
            '-keyout', str(cls.key), '-out', str(cls.cert), '-days', '1',
            '-subj', '/CN=' + HOST, '-addext', 'subjectAltName=IP:127.0.0.1,DNS:' + HOST],
            check=True, capture_output=True)
        cls.context = ssl.create_default_context(cafile=str(cls.cert))
        cls.fixture = ThreadingHTTPServer(('127.0.0.1', 0), Fixture)
        cls.fixture.daemon_threads = True
        cls.thread = threading.Thread(target=cls.fixture.serve_forever, daemon=True)
        cls.thread.start()
        cls.port = free_port()
        config = cls.root / 'nginx.conf'
        import pwd
        config.write_text('user ' + pwd.getpwuid(os.geteuid()).pw_name + ';\nmaster_process off;\npid ' + str(cls.root / 'nginx.pid') +
            ';\nevents {}\nhttp {\nfastcgi_temp_path ' + str(cls.root / 'fastcgi') + ';\nuwsgi_temp_path ' + str(cls.root / 'uwsgi') + ';\nscgi_temp_path ' + str(cls.root / 'scgi') + ';\n' + render(str(cls.root), cls.port,
                cls.fixture.server_port, str(cls.cert), str(cls.key)) + '}\n')
        cls.nginx = str(Path(os.environ['NGINX_BIN']).resolve())
        check = subprocess.run([cls.nginx, '-p', str(cls.root), '-t', '-c', str(config)], capture_output=True, text=True)
        if check.returncode:
            raise RuntimeError(check.stderr)
        cls.process = subprocess.Popen([cls.nginx, '-p', str(cls.root), '-c', str(config), '-g', 'daemon off;'],
            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        deadline = time.monotonic() + 5
        while True:
            try:
                cls.request('/_voltex/health')
                break
            except OSError:
                if time.monotonic() > deadline:
                    raise
                time.sleep(0.05)

    @classmethod
    def tearDownClass(cls):
        cls.process.terminate()
        cls.process.wait(timeout=5)
        cls.process.stderr.close()
        cls.fixture.shutdown()
        cls.fixture.server_close()
        cls.thread.join(timeout=2)
        cls.temp.cleanup()

    @classmethod
    def request(cls, path, method='GET', body=None, headers=None):
        c = http.client.HTTPSConnection('127.0.0.1', cls.port, context=cls.context, timeout=3)
        h = {'Host': HOST, **(headers or {})}
        if method not in ('GET', 'HEAD'):
            h.setdefault('Origin', 'https://' + HOST)
        c.request(method, path, body=body, headers=h)
        response = c.getresponse()
        result = (response.status, dict(response.getheaders()), response.read())
        c.close()
        return result

    def test_admin_internal_and_unreviewed_kyc_never_forward(self):
        for path, method in [('/admin', 'GET'), ('/api/v1/admin/users', 'GET'),
                ('/api/v1/kyc/admin/delivery', 'GET'), ('/_voltex/kyc/admin', 'POST'),
                ('/api/v1/kyc/submit', 'POST'), ('/_voltex/kyc/v1/unknown', 'POST'),
                ('/api/v1/internal/kyc/authorize', 'POST'), ('/api/v1/products', 'POST'),
                ('/api/v1/market/status', 'GET'), ('/api/v1/demo/vta', 'GET')]:
            before = len(Fixture.requests)
            self.assertEqual(self.request(path, method)[0], 403, (path, method))
            self.assertEqual(len(Fixture.requests), before)

    def test_customer_kyc_status_and_three_exact_worker_routes(self):
        self.assertEqual(self.request('/api/v1/kyc/me')[0], 200)
        for name in ('submit', 'materials', 'confirm'):
            payload = '--synthetic\r\nContent-Disposition: form-data; name="document"; filename="synthetic.txt"\r\n\r\nNOT A REAL DOCUMENT\r\n--synthetic--\r\n'
            status, headers, _ = self.request('/_voltex/kyc/v1/' + name, 'POST', payload,
                {'Authorization': 'Bearer synthetic-kyc-user', 'Cookie': 'never-forward-me',
                 'Content-Type': 'multipart/form-data; boundary=synthetic'})
            self.assertEqual(status, 200)
            received = Fixture.requests[-1]
            self.assertEqual(received['path'], '/v1/' + name)
            self.assertEqual(received['body'], payload)
            self.assertEqual(received['headers']['Authorization'], 'Bearer synthetic-kyc-user')
            self.assertEqual(received['headers']['Origin'], 'https://voltextech.net')
            self.assertEqual(int(received['headers']['Content-Length']), len(payload))
            self.assertNotIn('Cookie', received['headers'])
            self.assertNotIn('Set-Cookie', headers)
            self.assertIn('no-store', headers['Cache-Control'])

    def test_kyc_wrong_origin_method_and_body_cap(self):
        self.assertEqual(self.request('/_voltex/kyc/v1/submit', 'POST', 'synthetic',
            {'Origin': 'https://evil.invalid'})[0], 403)
        self.assertEqual(self.request('/_voltex/kyc/v1/submit')[0], 403)
        self.assertEqual(self.request('/_voltex/kyc/v1/submit', 'POST', 'synthetic',
            {'Content-Length': str(4259841)})[0], 413)

    def test_encoded_sensitive_paths_and_unknown_api_do_not_forward(self):
        for path in ('/api/v1/%61dmin/users', '/api/v1/%2561dmin/users',
                     '/api/v1/orders/x/../../admin/users', '/api/v1/not-reviewed'):
            before = len(Fixture.requests)
            self.assertIn(self.request(path)[0], (400, 403))
            self.assertEqual(len(Fixture.requests), before)

    def test_two_synthetic_bearers_and_order_body_preserved_without_retry(self):
        for token in ('synthetic-user-A', 'synthetic-user-B'):
            payload = '{"side":"BUY","quantity":"0.125","idempotencyKey":"synthetic-123"}'
            before = len(Fixture.requests)
            status, headers, _ = self.request('/api/v1/orders', 'POST', payload,
                {'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
            self.assertEqual(status, 200)
            self.assertEqual(len(Fixture.requests), before + 1)
            self.assertEqual(Fixture.requests[-1]['body'], payload)
            self.assertEqual(Fixture.requests[-1]['headers']['Authorization'], 'Bearer ' + token)
            self.assertEqual(headers.get('Cache-Control'), 'no-store')

    def test_json_financial_response_is_not_url_rewritten(self):
        import json
        status, _, body = self.request('/api/v1/deposit-address/ethereum', headers={'Authorization': 'Bearer synthetic-A'})
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)['url'], 'https://api.voltextech.net')

    def test_frontend_urls_rewritten_only_on_trusted_endpoint(self):
        status, _, body = self.request('/assets/app.js')
        self.assertEqual(status, 200)
        self.assertNotIn(b'https://api.voltextech.net', body)
        self.assertIn(b'https://ru.voltextech.net/_voltex/market', body)

    def test_foreign_or_missing_unsafe_origin_stops_before_upstream(self):
        for origin in ('https://foreign.invalid', ''):
            before = len(Fixture.requests)
            self.assertEqual(self.request('/api/v1/orders', 'POST', '{}', {'Origin': origin})[0], 403)
            self.assertEqual(len(Fixture.requests), before)

    def test_native_live_and_calculator_routes_are_in_allowlist(self):
        self.assertIn(['GET', '/private-trading/native/live'], ROUTES)
        self.assertIn(['POST', '/private-trading/native/quote'], ROUTES)
        for path in ('/api/v1/private-trading/native/live', '/api/v1/balances', '/api/v1/wallet/overview'):
            self.assertEqual(self.request(path)[0], 200)

    def test_public_websocket_upgrade_is_forwarded(self):
        import socket
        with socket.create_connection(('127.0.0.1', self.port), timeout=3) as raw:
            with self.context.wrap_socket(raw, server_hostname=HOST) as tls:
                tls.sendall(('GET /_voltex/ws/kraken HTTP/1.1\r\nHost: ' + HOST +
                    '\r\nOrigin: https://' + HOST + '\r\nConnection: Upgrade\r\nUpgrade: websocket'
                    '\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n').encode())
                data = b''
                while b'\r\n\r\n' not in data:
                    data += tls.recv(8192)
                self.assertIn(b'101 Switching Protocols', data)
                self.assertIn(b'Upgrade: websocket', data)


if __name__ == '__main__':
    unittest.main(verbosity=2)
