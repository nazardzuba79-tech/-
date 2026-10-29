"""Real isolated Nginx/TLS; upstream is the existing synthetic loopback fixture."""
import test_endpoint as base
from test_customer_reads import READS
from test_gateway import Fixture

class CustomerReadTransport(base.EndpointTest):
    def test_customer_gets_preserve_bearer_origin_and_no_store(self):
        for path in READS:
            before = len(Fixture.requests)
            status, headers, _ = self.request('/api/v1' + path,
                headers={'Authorization': 'Bearer synthetic-customer-only', 'Origin': 'https://ru.voltextech.net'})
            self.assertEqual(status, 200)
            self.assertEqual(len(Fixture.requests), before + 1)
            received = Fixture.requests[-1]
            self.assertEqual(received['path'], '/api/v1' + path)
            self.assertEqual(received['headers']['Authorization'], 'Bearer synthetic-customer-only')
            self.assertEqual(received['headers']['Origin'], 'https://voltextech.net')
            self.assertIn('no-store', headers['Cache-Control'])

    def test_banking_writes_still_do_not_reach_upstream(self):
        for path in ('/banking/calculate', '/banking/placements', '/banking/placements/x/settle'):
            before = len(Fixture.requests)
            self.assertEqual(self.request('/api/v1' + path, 'POST', '{}')[0], 403)
            self.assertEqual(len(Fixture.requests), before)

    def test_similar_or_nested_unreviewed_paths_do_not_reach_upstream(self):
        for path in ('/banking/config/extra', '/copy-trading/nazar/reset', '/banking/admin',
                     '/banking/state/../admin', '/banking/%2561dmin'):
            before = len(Fixture.requests)
            self.assertIn(self.request('/api/v1' + path)[0], (400, 403))
            self.assertEqual(len(Fixture.requests), before)
