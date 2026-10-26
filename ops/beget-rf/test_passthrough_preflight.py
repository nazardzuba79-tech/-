"""Offline security assertions for the proposed Beget TCP/TLS relay.

No live DNS, network, credentials, server writes, or trusted endpoint activation.
"""
import unittest

from passthrough_proposal import render

EXAMPLE_GLOBAL_IP = '93.184.216.34'  # Static generator fixture only; never a deployment target


class PassthroughPreflightTests(unittest.TestCase):
    def test_relay_preserves_sni_and_never_parses_https(self):
        conf = render(EXAMPLE_GLOBAL_IP, '/tmp/voltex-stream-test')
        self.assertIn('ru.voltextech.net ' + EXAMPLE_GLOBAL_IP + ':443;', conf)
        self.assertIn('default "";', conf)
        self.assertIn('ssl_preread on;', conf)
        self.assertIn('proxy_timeout 3600s;', conf)
        self.assertIn('proxy_next_upstream off;', conf)
        for forbidden in ('ssl_certificate ', 'listen 443 ssl', 'http {',
                          'location /', 'proxy_set_header'):
            self.assertNotIn(forbidden, conf)

    def test_dynamic_stream_module_is_opt_in(self):
        plain = render(EXAMPLE_GLOBAL_IP, '/tmp/voltex-stream-test')
        self.assertNotIn('load_module ', plain)
        dynamic = render(EXAMPLE_GLOBAL_IP, '/tmp/voltex-stream-test',
                         stream_module='/usr/lib/nginx/modules/ngx_stream_module.so')
        self.assertIn('load_module /usr/lib/nginx/modules/ngx_stream_module.so;', dynamic)
        self.assertEqual(dynamic.count('load_module '), 1)

    def test_target_and_module_path_validation(self):
        for ip in ('185.23.35.226', '127.0.0.1', '10.1.2.3', '::1', 'not-an-ip'):
            with self.subTest(ip=ip), self.assertRaises(ValueError):
                render(ip, '/tmp/voltex-stream-test')
        for path in ('relative', '/tmp/unsafe;evil', '/tmp/quoted"'):
            with self.subTest(path=path), self.assertRaises(ValueError):
                render(EXAMPLE_GLOBAL_IP, path)
        for module in ('relative', '/tmp/evil.so', '/tmp/unsafe;evil/ngx_stream_module.so'):
            with self.subTest(module=module), self.assertRaises(ValueError):
                render(EXAMPLE_GLOBAL_IP, '/tmp/voltex-stream-test', stream_module=module)


if __name__ == '__main__':
    unittest.main()
