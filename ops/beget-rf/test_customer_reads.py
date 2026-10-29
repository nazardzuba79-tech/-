"""Only two side-effect-free handlers; other missing GETs stay blocked."""
import hashlib
from pathlib import Path
import re
import unittest
from endpoint import ROUTES, render

READS = ('/banking/config', '/banking/referral')
SIDE_EFFECT_READS = ('/banking/state', '/copy-trading/nazar', '/copy-trading/ksenia')

def allowed(config, method, path):
    body = config.split('map "$request_method:$uri" $voltex_ru_api_allowed {', 1)[1].split('}', 1)[0]
    return any(re.search(pattern, method + ':' + path)
               for pattern in re.findall(r'^\s+~(\S+) 1;', body, re.M))

class CustomerReadPolicy(unittest.TestCase):
    def test_financial_or_scenario_side_effect_gets_remain_blocked(self):
        for config in (render(), Path(__file__).with_name('nginx-ru-hetzner-final.conf').read_text()):
            for path in SIDE_EFFECT_READS:
                for method in ('GET', 'HEAD'):
                    self.assertFalse(allowed(config, method, '/api/v1' + path), (method, path))

    def test_exact_diff_guard_and_repeat_are_deterministic(self):
        from propose_customer_reads import BASE_SHA256, LINES, propose
        final = Path(__file__).with_name('nginx-ru-hetzner-final.conf').read_text()
        old = final.replace(LINES, '', 1)
        self.assertEqual(hashlib.sha256(old.encode()).hexdigest(), BASE_SHA256)
        self.assertEqual(propose(old), final)
        self.assertEqual(propose(final), final)
        self.assertEqual(len(final.splitlines()) - len(old.splitlines()), 2)

    def test_config_drift_or_duplicate_rules_refused(self):
        from propose_customer_reads import LINES, propose
        final = Path(__file__).with_name('nginx-ru-hetzner-final.conf').read_text()
        for text in (final + '\n# unknown change\n', final.replace(LINES, LINES + LINES, 1)):
            with self.assertRaises(ValueError): propose(text)

    def test_two_exact_reads_reach_existing_authorizing_api(self):
        for path in READS:
            self.assertIn(['GET', path], ROUTES)
            for method in ('GET', 'HEAD'):
                self.assertTrue(allowed(render(), method, '/api/v1' + path), (method, path))

    def test_generated_checkpoint_matches_policy(self):
        text = Path(__file__).with_name('nginx-ru-hetzner-final.conf').read_text()
        for path in READS:
            self.assertTrue(allowed(text, 'GET', '/api/v1' + path), path)

    def test_no_new_commands_or_prefix_wildcards(self):
        for config in (render(), Path(__file__).with_name('nginx-ru-hetzner-final.conf').read_text()):
            for method in ('POST', 'PUT', 'PATCH', 'DELETE'):
                for path in READS + ('/banking/calculate', '/banking/placements', '/banking/placements/x/settle'):
                    self.assertFalse(allowed(config, method, '/api/v1' + path), (method, path))
            for path in ('/banking/admin', '/banking/state/extra', '/banking/referral/other',
                         '/copy-trading/nazar/reset', '/copy-trading/ksenia/admin', '/admin/users',
                         '/internal/kyc/authorize', '/kyc/material-requests/x/acknowledge'):
                self.assertFalse(allowed(config, 'GET', '/api/v1' + path), path)

    def test_unrelated_existing_reads_preserved(self):
        for path in ('/kyc/me', '/wallet/overview', '/futures/positions', '/private-trading/native/live'):
            self.assertTrue(allowed(render(), 'GET', '/api/v1' + path), path)

if __name__ == '__main__': unittest.main(verbosity=2)
