"""Focused TLS integration of existing auth/read handlers; no PG or real data."""
import http.client
import json
import os
from pathlib import Path
import ssl
import subprocess
import tempfile
import time
import unittest
from endpoint import HOST, render
from test_gateway import free_port


class ActualRoutesTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix='voltex-rf-actual-routes-')
        cls.root = Path(cls.temp.name)
        cls.node = subprocess.Popen(['node', str(Path(__file__).with_name('actual_routes_fixture.cjs'))],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, cwd=Path(__file__).resolve().parents[2])
        import select
        if not select.select([cls.node.stdout], [], [], 15)[0]:
            cls.node.terminate()
            raise RuntimeError('Actual HTTP fixture did not start')
        line = cls.node.stdout.readline()
        if not line:
            raise RuntimeError(cls.node.stderr.read())
        cls.data = json.loads(line)
        for name in ('client', 'proxy', 'logs'): (cls.root/name).mkdir()
        cert, key = cls.root/'cert.pem', cls.root/'key.pem'
        subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-keyout',str(key),
            '-out',str(cert),'-days','1','-subj','/CN='+HOST,'-addext','subjectAltName=IP:127.0.0.1,DNS:'+HOST],
            check=True,capture_output=True)
        cls.context = ssl.create_default_context(cafile=str(cert))
        cls.port = free_port()
        import pwd
        conf = cls.root/'nginx.conf'
        conf.write_text('user '+pwd.getpwuid(os.geteuid()).pw_name+';\nmaster_process off;\npid '+str(cls.root/'nginx.pid')+
            ';\nevents {}\nhttp {\n'+render(str(cls.root),cls.port,cls.data['port'],str(cert),str(key))+'}\n')
        cls.nginx = subprocess.Popen([os.environ['NGINX_BIN'],'-p',str(cls.root),'-c',str(conf),'-g','daemon off;'],
            stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
        deadline = time.monotonic()+5
        while True:
            try: cls.call('/_voltex/health'); break
            except OSError:
                if time.monotonic()>deadline: raise
                time.sleep(.05)

    @classmethod
    def tearDownClass(cls):
        for p in (cls.nginx,cls.node):
            p.terminate(); p.wait(timeout=5)
            if p.stdout: p.stdout.close()
            if p.stderr: p.stderr.close()
        cls.temp.cleanup()

    @classmethod
    def call(cls,path,user='synthetic-A',direct=False,method='GET'):
        c = (http.client.HTTPConnection('127.0.0.1',cls.data['port'],timeout=3) if direct else
             http.client.HTTPSConnection('127.0.0.1',cls.port,timeout=3,context=cls.context))
        h={'Host':HOST}
        if user: h['Authorization']='Bearer '+cls.data['tokens'][user]
        c.request(method,path,headers=h)
        r=c.getresponse(); out=(r.status,dict(r.getheaders()),r.read()); c.close(); return out

    def test_01_two_actual_auth_sessions_cannot_select_foreign_balances(self):
        for user,other,value in [('synthetic-A','synthetic-B','123.45'),('synthetic-B','synthetic-A','678.90')]:
            path='/api/v1/balances?userId='+other
            direct=self.call(path,user,direct=True)
            relayed=self.call(path,user)
            self.assertEqual(relayed[0],200)
            self.assertEqual(relayed[2],direct[2])
            self.assertEqual(json.loads(relayed[2])[0]['available'],value)
            self.assertEqual(relayed[1]['Cache-Control'],'no-store')
            history=json.loads(self.call('/api/v1/deposits/me?userId='+other,user)[2])
            self.assertEqual(history[0]['id'],user+'-deposit')

    def test_02_real_deposit_handler_bytes_and_address_unchanged(self):
        for user in ('synthetic-A','synthetic-B'):
            path='/api/v1/deposit-address/ethereum'
            direct=self.call(path,user,direct=True); relayed=self.call(path,user)
            self.assertEqual(relayed[0],200)
            self.assertEqual(relayed[2],direct[2])
            self.assertEqual(json.loads(relayed[2])['address'],'0x'+'1'*40)
            self.assertEqual(relayed[1]['Cache-Control'],'no-store')

    def test_03_revocation_missing_token_and_no_storage_write(self):
        self.call('/fixture/revoke-A',direct=True,method='POST')
        self.assertEqual(self.call('/api/v1/balances')[0],401)
        self.assertEqual(self.call('/api/v1/balances',user=None)[0],401)
        self.assertEqual(self.call('/api/v1/balances',user='synthetic-B')[0],200)
        self.assertEqual(json.loads(self.call('/fixture/invariants',direct=True)[2]),{'writes':0,'unchanged':True})
