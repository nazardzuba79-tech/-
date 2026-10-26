#!/usr/bin/env python3
"""Real Nginx/TLS tests. All upstreams are loopback fixtures; no production calls."""
import base64
import hashlib
import http.client
import json
import os
from pathlib import Path
import socket
import ssl
import subprocess
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from render import HOST, REWRITES, render


class Fixture(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    requests = []

    def log_message(self, *_):
        pass

    def do_GET(self):
        self.respond()

    def do_POST(self):
        self.respond()

    def do_OPTIONS(self):
        self.respond()

    def respond(self):
        body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
        self.requests.append({'path': self.path, 'headers': dict(self.headers), 'body': body.decode()})
        # Existing KYC Worker accepts canonical app origins, not the RU origin.
        if self.path == '/v1/confirm' and self.headers.get('Origin') != 'https://voltextech.net':
            self.send_response(403)
            self.send_header('Content-Length', '0')
            self.end_headers()
            return
        if self.path == '/v2' and self.headers.get('Upgrade') == 'websocket':
            accept = base64.b64encode(hashlib.sha1((self.headers['Sec-WebSocket-Key'] +
                '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode()).digest()).decode()
            self.send_response(101)
            self.send_header('Upgrade', 'websocket')
            self.send_header('Connection', 'Upgrade')
            self.send_header('Sec-WebSocket-Accept', accept)
            self.end_headers()
            self.wfile.write(b'\x81\x02OK')
            self.wfile.flush()
            self.close_connection = True
            return
        if self.path == '/api/v1/fixture-stream':
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream')
            self.send_header('Connection', 'close')
            self.end_headers()
            self.wfile.write(b'data: first\n\n')
            self.wfile.flush()
            time.sleep(.6)
            self.wfile.write(b'data: last\n\n')
            self.wfile.flush()
            self.close_connection = True
            return
        mime = 'application/json'
        if self.path in ('/', '/assets/app.js', '/assets/app.css'):
            mime = {'/': 'text/html', '/assets/app.js': 'application/javascript',
                    '/assets/app.css': 'text/css'}[self.path]
            payload = '|'.join(REWRITES).encode()
        else:
            payload = json.dumps({'path': self.path, 'body': body.decode(),
                                  'url': 'https://api.voltextech.net'}).encode()
        self.send_response(200)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(payload)))
        self.send_header('Cache-Control', 'public, max-age=3600')
        self.send_header('Set-Cookie', 'fixture=secret-cookie; Secure; HttpOnly')
        self.end_headers()
        self.wfile.write(payload)


def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


class GatewayTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.nginx = str(Path(os.environ['NGINX_BIN']).resolve())
        cls.temp = tempfile.TemporaryDirectory(prefix='voltex-rf-')
        cls.prefix = Path(cls.temp.name)
        for name in ('client', 'proxy', 'logs'):
            (cls.prefix / name).mkdir()
        cls.cert, cls.key = cls.prefix / 'cert.pem', cls.prefix / 'key.pem'
        subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
                        '-keyout', str(cls.key), '-out', str(cls.cert), '-days', '1',
                        '-subj', '/CN=ru.voltextech.net', '-addext',
                        'subjectAltName=IP:127.0.0.1,DNS:ru.voltextech.net'],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        cls.context = ssl.create_default_context(cafile=str(cls.cert))
        cls.fixture = ThreadingHTTPServer(('127.0.0.1', 0), Fixture)
        cls.fixture.daemon_threads = True
        cls.thread = threading.Thread(target=cls.fixture.serve_forever, daemon=True)
        cls.thread.start()
        cls.port = free_port()
        cls.config = cls.prefix / 'nginx.conf'
        cls.config.write_text(render(str(cls.prefix), port=cls.port,
            fixture_port=cls.fixture.server_port, cert=str(cls.cert), key=str(cls.key)))
        cls.syntax = subprocess.run([cls.nginx, '-p', str(cls.prefix) + '/', '-c', str(cls.config), '-t'],
                                    capture_output=True, text=True)
        if cls.syntax.returncode:
            raise RuntimeError(cls.syntax.stderr)
        cls.proc = subprocess.Popen([cls.nginx, '-p', str(cls.prefix) + '/',
                                     '-c', str(cls.config), '-g', 'daemon off;'],
                                    stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        for _ in range(60):
            if cls.proc.poll() is not None:
                raise RuntimeError(cls.proc.stderr.read().decode())
            try:
                with socket.create_connection(('127.0.0.1', cls.port), timeout=.1):
                    break
            except OSError:
                time.sleep(.05)
        else:
            raise RuntimeError('Nginx did not listen')

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate()
        cls.proc.communicate(timeout=5)
        cls.fixture.shutdown()
        cls.fixture.server_close()
        cls.thread.join(timeout=2)
        cls.temp.cleanup()

    def request(self, path, method='GET', body=None, extra=None, origin=True):
        headers = {'Host': HOST}
        if origin:
            headers['Origin'] = 'https://' + HOST
        headers.update(extra or {})
        conn = http.client.HTTPSConnection('127.0.0.1', self.port, context=self.context, timeout=3)
        try:
            conn.request(method, path, body, headers)
            res = conn.getresponse()
            return res.status, dict(res.getheaders()), res.read()
        finally:
            conn.close()

    def test_01_nginx_syntax_and_health(self):
        self.assertEqual(self.syntax.returncode, 0)
        status, _, body = self.request('/_voltex/health')
        self.assertEqual(status, 200)
        self.assertIn(b'voltex-rf-gateway', body)

    def test_02_frontend_url_rewriting_html_js_css(self):
        for path in ('/', '/assets/app.js', '/assets/app.css'):
            with self.subTest(path=path):
                status, headers, body = self.request(path)
                self.assertEqual(status, 200)
                for old, new in REWRITES.items():
                    self.assertNotIn(old.encode(), body)
                    self.assertIn(new.encode(), body)
                self.assertEqual(headers['Cache-Control'], 'no-store')

    def test_03_financial_json_and_body_unchanged_single_request(self):
        before = len(Fixture.requests)
        body = '{"quantity":"0.125","price":"0.0140"}'
        status, headers, result = self.request('/api/v1/fixture-order?request=synthetic-secret',
            'POST', body, {'Authorization': 'Bearer synthetic-secret', 'Cookie': 'session=secret-cookie'})
        self.assertEqual(status, 200)
        self.assertEqual(len(Fixture.requests), before + 1)
        actual = Fixture.requests[-1]
        self.assertEqual(actual['body'], body)
        self.assertEqual(actual['headers']['Authorization'], 'Bearer synthetic-secret')
        self.assertEqual(actual['headers']['Cookie'], 'session=secret-cookie')
        self.assertEqual(actual['headers']['Origin'], 'https://voltextech.net')
        self.assertEqual(json.loads(result)['url'], 'https://api.voltextech.net')
        self.assertEqual(headers['Cache-Control'], 'no-store')

    def test_04_public_routes_strip_credentials_and_keep_query(self):
        routes = {
            '/_voltex/market/market/display/tickers': '/market/display/tickers',
            '/_voltex/market/market/test-assets/TYVN-USDT': '/market/test-assets/TYVN-USDT',
            '/_voltex/market/market/listings': '/market/listings',
            '/_voltex/market/cfd/display/candles/AAPL': '/cfd/display/candles/AAPL',
            '/_voltex/market/health': '/health',
            '/health': '/health',
            '/_voltex/kraken/0/public/OHLC': '/0/public/OHLC',
            '/_voltex/bybit/v5/market/tickers': '/v5/market/tickers',
            '/_voltex/bytick/v5/market/kline': '/v5/market/kline',
            '/_voltex/catalogue/public/deposit-catalogue': '/public/deposit-catalogue',
        }
        for path, target in routes.items():
            with self.subTest(path=path):
                status, headers, data = self.request(path + '?fixture=1', extra={
                    'Authorization': 'Bearer synthetic-secret', 'Cookie': 'session=secret-cookie'})
                self.assertEqual(status, 200)
                self.assertEqual(json.loads(data)['path'], target + '?fixture=1')
                self.assertNotIn('Authorization', Fixture.requests[-1]['headers'])
                self.assertNotIn('Cookie', Fixture.requests[-1]['headers'])
                self.assertNotIn('Set-Cookie', headers)

    def test_05_foreign_origin_and_missing_unsafe_origin_rejected(self):
        before = len(Fixture.requests)
        self.assertEqual(self.request('/api/v1/fixture', extra={'Origin': 'https://evil.invalid'})[0], 403)
        self.assertEqual(self.request('/api/v1/fixture', 'POST', '{}', origin=False)[0], 403)
        self.assertEqual(len(Fixture.requests), before)
        self.assertEqual(self.request('/api/v1/fixture', origin=False)[0], 200)

    def test_06_reserved_arbitrary_and_internal_targets_denied(self):
        before = len(Fixture.requests)
        for path in ('/_voltex/proxy?url=https://evil.invalid', '/_voltex/kraken/0/private/Balance',
                     '/_voltex/kyc/v1/admin', '/internal/v1/config'):
            self.assertEqual(self.request(path)[0], 404)
        self.assertEqual(len(Fixture.requests), before)

    def test_07_public_post_and_trace_denied(self):
        before = len(Fixture.requests)
        self.assertEqual(self.request('/_voltex/market/market/listings', 'POST', '{}')[0], 405)
        self.assertEqual(self.request('/', 'POST', '{}')[0], 405)
        self.assertIn(self.request('/api/v1/fixture', 'TRACE')[0], (403, 405))
        self.assertEqual(len(Fixture.requests), before)

    def test_08_kyc_fixed_route_preserves_credentials(self):
        status, _, data = self.request('/_voltex/kyc/v1/confirm', 'POST', '{}',
                                      {'Authorization': 'Bearer synthetic-secret'})
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(data)['path'], '/v1/confirm')
        self.assertEqual(Fixture.requests[-1]['headers']['Authorization'], 'Bearer synthetic-secret')
        self.assertEqual(Fixture.requests[-1]['headers']['Origin'], 'https://voltextech.net')

    def test_09_sse_first_chunk_is_not_buffered(self):
        conn = http.client.HTTPSConnection('127.0.0.1', self.port, context=self.context, timeout=3)
        try:
            start = time.monotonic()
            conn.request('GET', '/api/v1/fixture-stream', headers={'Host': HOST})
            res = conn.getresponse()
            self.assertEqual(res.read(13), b'data: first\n\n')
            self.assertLess(time.monotonic() - start, .5)
            self.assertEqual(res.read(), b'data: last\n\n')
        finally:
            conn.close()

    def test_10_websocket_tunnel_and_origin(self):
        self.assertEqual(self.request('/_voltex/ws/kraken', origin=False)[0], 403)
        self.assertEqual(self.request('/_voltex/ws/kraken')[0], 426)
        with socket.create_connection(('127.0.0.1', self.port), timeout=3) as raw:
            with self.context.wrap_socket(raw, server_hostname='127.0.0.1') as sock:
                sock.sendall(('GET /_voltex/ws/kraken HTTP/1.1\r\nHost: ' + HOST +
                    '\r\nOrigin: https://' + HOST + '\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
                    'Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n').encode())
                data = b''
                while b'\x81\x02OK' not in data:
                    chunk = sock.recv(4096)
                    if not chunk:
                        break
                    data += chunk
                self.assertIn(b'101 Switching Protocols', data)
                self.assertIn(b'\x81\x02OK', data)

    def test_11_unknown_host_closed(self):
        with self.assertRaises(http.client.RemoteDisconnected):
            self.request('/', extra={'Host': 'evil.invalid'})

    def test_12_logs_have_no_credentials_or_queries(self):
        self.request('/api/v1/fixture?token=synthetic-secret', extra={
            'Authorization': 'Bearer synthetic-secret', 'Cookie': 'session=secret-cookie'})
        logs = '\n'.join(p.read_text() for p in self.prefix.glob('*.log'))
        self.assertNotIn('synthetic-secret', logs)
        self.assertNotIn('secret-cookie', logs)
        self.assertNotIn('/api/v1/', logs)


class RenderTest(unittest.TestCase):
    def test_invalid_paths_rejected(self):
        for kwargs in ({'prefix': '/tmp/unsafe;'}, {'resolver': 'evil.invalid'},
                       {'key': '/tmp/a\nb'}, {'fixture_port': 0}):
            with self.assertRaises(ValueError):
                render(**kwargs)

    def test_production_default_is_closed_security_hold(self):
        text = render()
        self.assertNotIn('proxy_pass', text)
        self.assertNotIn('ssl_certificate', text)
        self.assertNotIn('listen 443', text)
        self.assertNotIn('/.well-known/acme-challenge/', text)
        self.assertIn('return 503', text)
        self.assertIn("default-src 'none'", text)

    def test_old_bootstrap_option_also_stays_closed(self):
        text = render(bootstrap=True)
        self.assertNotIn('/.well-known/acme-challenge/', text)
        self.assertIn('return 503', text)
        self.assertNotIn('proxy_pass', text)
        self.assertNotIn('listen 443', text)

    def test_api_and_market_prefixes_remain_distinct(self):
        api = REWRITES['https://api.voltextech.net'] + '/api/v1/market/test-assets'
        edge = REWRITES['https://market.voltextech.net']
        self.assertFalse(api.startswith(edge + '/'))

    def test_checked_in_configs_match_renderer(self):
        for name, options in [('nginx.conf', {}), ('nginx-bootstrap.conf', {'bootstrap': True})]:
            self.assertEqual((Path(__file__).parent / name).read_text(), render(**options))


if __name__ == '__main__':
    unittest.main(verbosity=2)
