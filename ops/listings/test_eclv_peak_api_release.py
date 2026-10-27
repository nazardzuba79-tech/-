import copy, importlib.util, pathlib, unittest
spec=importlib.util.spec_from_file_location('release',pathlib.Path(__file__).with_name('eclv_peak_api_release.py'))
release=importlib.util.module_from_spec(spec);spec.loader.exec_module(release)

class ReleaseScope(unittest.TestCase):
    def setUp(self):
        self.before={'services':{'api-production':{'image':'old','command':['node','dist/index.js'],'environment':{'FINANCE_GATE':'false','VOLTEX_RELEASE_SHA':'old'},'volumes':['private-bootstrap:ro']},'db':{'image':'postgres:18','volumes':['existing-db']}}}
        self.after=copy.deepcopy(self.before);self.after['services']['api-production']['image']='voltex-eclv-peak:'+'a'*40;self.after['services']['api-production']['environment']['VOLTEX_RELEASE_SHA']='a'*40
    def check(self): release.assert_only_overlay(self.before,self.after,'api-production','a'*40)
    def test_only_image_and_identity_allowed_without_mutating_input(self):
        b,a=copy.deepcopy(self.before),copy.deepcopy(self.after);self.check();self.assertEqual(self.before,b);self.assertEqual(self.after,a)
    def test_financial_gate_change_refused(self):
        self.after['services']['api-production']['environment']['FINANCE_GATE']='true'
        with self.assertRaises(AssertionError):self.check()
    def test_bootstrap_startup_change_refused(self):
        self.after['services']['api-production']['command']=['sh','-c','migrate then start']
        with self.assertRaises(AssertionError):self.check()
    def test_database_change_refused(self):
        self.after['services']['db']['volumes']=['other-db']
        with self.assertRaises(AssertionError):self.check()
    def test_private_mount_change_refused(self):
        self.after['services']['api-production']['volumes']=['different-bootstrap:ro']
        with self.assertRaises(AssertionError):self.check()
    def test_wrong_release_identity_refused(self):
        self.after['services']['api-production']['environment']['VOLTEX_RELEASE_SHA']='b'*40
        with self.assertRaises(AssertionError):self.check()
    def test_wrong_image_refused(self):
        self.after['services']['api-production']['image']='unrelated-api:main'
        with self.assertRaises(AssertionError):self.check()

if __name__=='__main__':unittest.main()
