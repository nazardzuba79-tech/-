"""PROXY preamble + verified TLS + actual unchanged Express auth quotas."""
import http.client, json, os, select, socket, ssl, subprocess, tempfile, time, unittest
from pathlib import Path
from endpoint import HOST, render
from test_gateway import free_port

class IpChainTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp=tempfile.TemporaryDirectory(prefix='ru-ip-chain-');cls.root=Path(cls.temp.name)
        for folder in ('client','proxy','logs'):(cls.root/folder).mkdir()
        cls.node=subprocess.Popen(['node',str(Path(__file__).with_name('ip_chain_fixture.cjs'))],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        if not select.select([cls.node.stdout],[],[],15)[0]:raise RuntimeError('Fixture startup timeout')
        line=cls.node.stdout.readline()
        if not line:raise RuntimeError(cls.node.stderr.read())
        cls.upstream=json.loads(line)['port'];cls.port=free_port()
        cert,key=cls.root/'cert.pem',cls.root/'key.pem'
        subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-keyout',str(key),'-out',str(cert),'-days','1','-subj','/CN='+HOST,'-addext','subjectAltName=DNS:'+HOST],check=True,capture_output=True)
        cls.context=ssl.create_default_context(cafile=str(cert))
        conf=cls.root/'nginx.conf'
        import pwd
        text='user '+pwd.getpwuid(os.geteuid()).pw_name+';\nmaster_process off;\npid '+str(cls.root/'nginx.pid')+';\nevents {}\nhttp {\n'
        for item in ('fastcgi','uwsgi','scgi'):text+=item+'_temp_path '+str(cls.root/item)+';\n'
        conf.write_text(text+render(str(cls.root),cls.port,cls.upstream,str(cert),str(key),proxy_protocol=True)+'}\n')
        cls.nginx=subprocess.Popen([os.environ['NGINX_BIN'],'-p',str(cls.root),'-c',str(conf),'-g','daemon off;'],stderr=subprocess.PIPE)
        deadline=time.monotonic()+5
        while True:
            try:cls.call('/_voltex/health');break
            except OSError:
                if time.monotonic()>deadline:raise
                time.sleep(.05)

    @classmethod
    def tearDownClass(cls):
        for proc in (cls.nginx,cls.node):
            proc.terminate();proc.wait(timeout=5)
            if proc.stdout:proc.stdout.close()
            if proc.stderr:proc.stderr.close()
        cls.temp.cleanup()

    @classmethod
    def call(cls,path,ip='198.51.100.10',method='GET',headers=None):
        class ProxyHTTPS(http.client.HTTPSConnection):
            def connect(self):
                raw=socket.create_connection(('127.0.0.1',cls.port),timeout=3)
                raw.sendall(('PROXY TCP4 '+ip+' 127.0.0.1 45000 '+str(cls.port)+'\r\n').encode())
                self.sock=cls.context.wrap_socket(raw,server_hostname=HOST)
        c=ProxyHTTPS(HOST,cls.port,timeout=3)
        h={'Host':HOST,'Origin':'https://'+HOST,**(headers or {})}
        if method=='POST':h['Content-Type']='application/json'
        c.request(method,path,body='{}' if method=='POST' else None,headers=h)
        r=c.getresponse();out=(r.status,dict(r.getheaders()),r.read());c.close();return out

    def test_client_http_headers_cannot_spoof_rate_identity(self):
        row=json.loads(self.call('/api/v1/kyc/me',headers={'X-Forwarded-For':'203.0.113.99','X-Real-IP':'203.0.113.98','CF-Connecting-IP':'203.0.113.97'})[2])
        self.assertEqual(row,{'ip':'198.51.100.10','xff':'198.51.100.10'})

    def test_real_ten_attempt_limit_is_per_transport_client_and_unchanged(self):
        statuses=[self.call('/api/v1/auth/login',method='POST')[0] for _ in range(11)]
        self.assertEqual(statuses,[400]*10+[429])
        other=self.call('/api/v1/auth/login',ip='198.51.100.11',method='POST')
        self.assertEqual(other[0],400)

    def test_tls_without_proxy_preamble_fails_closed(self):
        with self.assertRaises((OSError,ssl.SSLError)):
            with socket.create_connection(('127.0.0.1',self.port),timeout=3) as s:
                self.context.wrap_socket(s,server_hostname=HOST)

if __name__=='__main__':unittest.main()
