import hashlib, os, pwd, subprocess, tempfile, unittest
from pathlib import Path
import client_ip_rollout as rollout
from endpoint import render
from relay import render as render_relay

class RolloutConfigTest(unittest.TestCase):
    def test_combined_config_matches_renderer_and_real_nginx_syntax(self):
        old=Path(__file__).with_name('nginx-ru-hetzner.conf').read_text()
        self.assertEqual(hashlib.sha256(old.encode()).hexdigest(),rollout.OLD_HETZNER)
        marker='    client_max_body_size 4259840;\n    if ($request_method !~ "^(POST|OPTIONS)$") { return 405; }'
        legacy=old.replace(marker,marker+'\n    proxy_set_header X-Voltex-Ru-Client-IP "";',1)
        legacy=legacy.replace('\n}\nserver {','\n'+rollout.EXTRA_MAP+'}\nserver {',1)
        self.assertEqual(legacy,render())
        combined=legacy+rollout.PROXY_SERVER
        with tempfile.TemporaryDirectory(prefix='ru-rollout-syntax-') as tmp:
            d=Path(tmp)
            for n in ('logs','client','proxy'):(d/n).mkdir()
            subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-keyout',str(d/'key.pem'),'-out',str(d/'cert.pem'),'-days','1','-subj','/CN=ru.voltextech.net'],check=True,capture_output=True)
            combined=combined.replace('/opt/voltex-rf-endpoint',tmp).replace('/etc/letsencrypt/live/ru.voltextech.net/fullchain.pem',str(d/'cert.pem')).replace('/etc/letsencrypt/live/ru.voltextech.net/privkey.pem',str(d/'key.pem'))
            conf='user '+pwd.getpwuid(os.geteuid()).pw_name+';\npid '+str(d/'pid')+';\nevents {}\nhttp {\nclient_body_temp_path '+str(d/'body')+';\n'+''.join(n+'_temp_path '+str(d/n)+';\n' for n in ('fastcgi','uwsgi','scgi','proxy'))+combined+'}\n'
            (d/'nginx.conf').write_text(conf)
            r=subprocess.run([os.environ['NGINX_BIN'],'-p',tmp,'-t','-c',str(d/'nginx.conf')],capture_output=True,text=True)
            self.assertEqual(r.returncode,0,r.stderr)

    def test_beget_only_changes_destination_port_and_proxy_preamble(self):
        old=render_relay(public=True,acme=True)
        self.assertEqual(hashlib.sha256(old.encode()).hexdigest(),rollout.OLD_BEGET)
        new=old.replace(rollout.HETZNER+':18443;',rollout.HETZNER+':18444;').replace('    proxy_pass $voltex_fixed_target;','    proxy_protocol on;\n    proxy_pass $voltex_fixed_target;')
        self.assertNotIn('ssl_certificate',new)
        self.assertNotIn('\nhttp {',new)
        self.assertIn('default "";',new)
        self.assertEqual(new.count('proxy_protocol on;'),1)
        self.assertIn('proxy_pass 138.199.227.130:18080;',new)

if __name__=='__main__':unittest.main()
