#!/usr/bin/env python3
"""Put ONLY the approved Beget node into the owner's fail-closed security hold.

No upstream, TLS termination, login, JavaScript, ACME challenge or financial path.
Preserves existing certificates as evidence, never reads their private bytes.
"""
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time

IP = '185.23.35.226'
HOST = 'ru.voltextech.net'
CONFIG = '''# Owner security hold. No TLS/HTTP upstream or frontend on Beget.
user www-data;
worker_processes 1;
pid /run/nginx.pid;
error_log /var/log/nginx/voltex-security-hold.log crit;
events { worker_connections 256; }
http {
  access_log off;
  server_tokens off;
  server { listen 80 default_server; server_name _; return 444; }
  server {
    listen 80;
    server_name ru.voltextech.net;
    default_type text/plain;
    add_header Cache-Control no-store always;
    add_header X-Content-Type-Options nosniff always;
    add_header Content-Security-Policy "default-src 'none'; frame-ancestors 'none'" always;
    return 503 "VOLTEX gateway unavailable pending security verification. Do not sign in here.\\n";
  }
}
'''


def run(args):
    p = subprocess.run(args, capture_output=True, text=True, timeout=20)
    return {'exit': p.returncode, 'stdout': p.stdout, 'stderr': p.stderr}


def main():
    if os.geteuid() != 0:
        raise RuntimeError('Root required')
    addresses = json.loads(subprocess.check_output(['ip', '-j', 'address'], text=True))
    if not any(a.get('local') == IP for n in addresses for a in n.get('addr_info', [])):
        raise RuntimeError('Wrong node')
    os.umask(0o077)
    result_path = Path('/root/voltex-rf-security-hold-result.json')
    if result_path.exists():
        raise RuntimeError('Existing hold record: inspect, no automatic repeat')
    marker = Path('/root/VOLTEX_RF_SECURITY_HOLD')
    marker.write_text('Owner requires end-to-end TLS and privacy review. Do not enable the L7 gateway.\n')
    config = Path('/etc/nginx/nginx.conf')
    backup = Path('/root/voltex-rf-backup') / 'before-security-hold.conf'
    backup.write_bytes(config.read_bytes())
    result = {'at': datetime.now(timezone.utc).isoformat(), 'node': 'voltex-ru-gateway-01',
              'ip': IP, 'beforeConfigSha256': hashlib.sha256(config.read_bytes()).hexdigest(),
              'beforeListeners': run(['ss', '-ltn']), 'mainChanged': False}
    candidate = config.with_name('nginx.conf.security-hold')
    candidate.write_text(CONFIG)
    subprocess.run(['nginx', '-t', '-c', str(candidate)], check=True, timeout=15)
    os.replace(candidate, config)
    subprocess.run(['systemctl', 'reload', 'nginx'], check=True, timeout=20)
    result['timersDisabled'] = run(['systemctl', 'disable', '--now', 'voltex-rf-monitor.timer', 'certbot.timer'])
    quarantined = []
    for name in ('/voltex-stage2.py', '/root/voltex-activate.py'):
        p = Path(name)
        if p.is_file():
            target = Path(name + '.disabled')
            if target.exists():
                raise RuntimeError('Existing quarantine target')
            p.rename(target)
            target.chmod(0o400)
            quarantined.append(str(target))
    for _ in range(20):
        listeners = run(['ss', '-ltn'])
        if not any(line.split()[3].endswith(':443') for line in listeners['stdout'].splitlines()[1:]):
            break
        time.sleep(0.25)
    result.update(afterListeners=listeners, quarantined=quarantined,
                  configSha256=hashlib.sha256(config.read_bytes()).hexdigest(),
                  nginxBuild=run(['nginx', '-V']), service=run(['systemctl', 'is-active', 'nginx']))
    result['httpChecks'] = {}
    for path in ('/', '/login', '/admin', '/api/v1/admin/users', '/api/v1/deposit-address/ETH',
                 '/api/v1/withdrawals', '/_voltex/kyc/v1/submit', '/assets/app.js',
                 '/.well-known/acme-challenge/voltex-gateway-preflight'):
        result['httpChecks'][path] = run(['curl', '--silent', '--show-error', '--max-time', '2',
            '--noproxy', '*', '-H', 'Host: ' + HOST, '-o', '/dev/null', '-w', '%{http_code}',
            'http://127.0.0.1' + path])
    result['certificateNamesInLetsEncryptLive'] = [p.name for p in Path('/etc/letsencrypt/live').iterdir() if p.is_dir()]
    result['certificatePrivateBytesRead'] = False
    no_tls = not any(line.split()[3].endswith(':443') for line in listeners['stdout'].splitlines()[1:])
    closed = all(p['exit'] == 0 and p['stdout'] == '503' for p in result['httpChecks'].values())
    result['status'] = ('SECURITY_HOLD_VERIFIED' if no_tls and closed and
                        result['timersDisabled']['exit'] == 0 and result['service']['exit'] == 0
                        else 'SECURITY_HOLD_NEEDS_INSPECTION')
    result_path.write_text(json.dumps(result, indent=2) + '\n')
    result_path.chmod(0o600)


if __name__ == '__main__':
    main()
