#!/usr/bin/env python3
"""Apply opaque relay only on the existing owner-approved Beget node."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import ssl
import socket
import subprocess
import time

HOST = 'ru.voltextech.net'
IP = '185.23.35.226'
TRUSTED = '138.199.227.130'
ROOT = Path('/root/voltex-rf-relay')
CONF = Path('/etc/nginx/nginx.conf')
MODULE = '/usr/lib/nginx/modules/ngx_stream_module.so'


def run(args, timeout=30):
    return subprocess.run(args, capture_output=True, text=True, timeout=timeout)


def identity():
    rows = json.loads(subprocess.check_output(['ip', '-j', 'address'], text=True))
    if os.geteuid() or not any(a.get('local') == IP for n in rows for a in n.get('addr_info', [])):
        raise RuntimeError('Wrong server: existing approved Beget only')
    os.umask(0o077)
    ROOT.mkdir(mode=0o700, exist_ok=True)


def render(public=False):
    return f'''# Opaque VOLTEX relay. No TLS key, HTTP upstream or local JavaScript.
load_module {MODULE};
worker_processes 1;
pid /run/nginx.pid;
error_log /var/log/nginx/voltex-stream-error.log crit;
events {{ worker_connections 1024; }}
stream {{
  access_log off;
  map $ssl_preread_server_name $voltex_fixed_target {{
    default "";
    {HOST} {TRUSTED}:18443;
  }}
  server {{
    listen {'443' if public else '127.0.0.1:19443'};
    ssl_preread on;
    preread_timeout 5s;
    proxy_connect_timeout 5s;
    proxy_timeout 3600s;
    proxy_next_upstream off;
    proxy_pass $voltex_fixed_target;
  }}
}}
http {{
  access_log off; server_tokens off;
  server {{ listen 80 default_server; server_name _; return 503; }}
}}
'''


def apply(text):
    previous = CONF.read_bytes()
    CONF.write_text(text)
    try:
        test = run(['nginx', '-t'])
        if test.returncode:
            raise RuntimeError(test.stderr)
        reload = run(['systemctl', 'reload', 'nginx'])
        if reload.returncode:
            raise RuntimeError(reload.stderr)
    except BaseException:
        CONF.write_bytes(previous)
        subprocess.run(['nginx', '-t'], check=True, timeout=15)
        subprocess.run(['systemctl', 'reload', 'nginx'], check=True, timeout=15)
        raise


def request(path, port=19443, method='GET', origin=None):
    # CA validation AND exact hostname remain mandatory. No insecure flag.
    import http.client
    class LocalHTTPS(http.client.HTTPSConnection):
        def connect(self):
            raw = socket.create_connection(('127.0.0.1', port), timeout=15)
            self.sock = ssl.create_default_context().wrap_socket(raw, server_hostname=HOST)
    c = LocalHTTPS(HOST, port, timeout=15)
    headers = {'Host': HOST}
    if origin is not None:
        headers['Origin'] = origin
    c.request(method, path, headers=headers)
    r = c.getresponse()
    body = r.read(2000000)
    result = {'path': path, 'status': r.status, 'bytes': len(body),
              'bodySha256': hashlib.sha256(body).hexdigest(),
              'cacheControl': r.getheader('Cache-Control'),
              'location': r.getheader('Location')}
    c.close()
    return result, body


def check(port=19443):
    raw = socket.create_connection(('127.0.0.1', port), timeout=15)
    with ssl.create_default_context().wrap_socket(raw, server_hostname=HOST) as tls:
        cert = tls.getpeercert(binary_form=True)
        cert_sha = hashlib.sha256(cert).hexdigest()
        expiry = tls.getpeercert().get('notAfter')
    records = []
    for path, expected in [('/_voltex/health', 200), ('/admin', 403),
            ('/api/v1/admin/users', 403), ('/api/v1/kyc/me', 403),
            ('/_voltex/kyc/v1/submit', 403), ('/api/v1/balances', 401),
            ('/api/v1/deposit-address/ethereum', 401), ('/api/v1/not-reviewed', 403),
            ('/assets/../api/v1/%61dmin/users', 403)]:
        row, body = request(path, port)
        row['pass'] = row['status'] == expected
        if path == '/_voltex/health':
            row['pass'] = row['pass'] and body == b'voltex-rf-hetzner\n'
        records.append(row)
    row, _ = request('/api/v1/orders', port, method='POST', origin='https://foreign.invalid')
    row['pass'] = row['status'] == 403
    records.append(row)
    # Actual anonymous frontend: no fake UA, credentials, trades, or challenges.
    row, body = request('/', port)
    row['pass'] = row['status'] == 200 and b'<html' in body.lower()
    row['html'] = b'<html' in body.lower()
    records.append(row)
    result = {'at': datetime.now(timezone.utc).isoformat(), 'certSha256': cert_sha,
              'certExpiry': expiry, 'records': records,
              'status': 'PASS' if all(r['pass'] for r in records) else 'FAIL'}
    (ROOT / 'preflight.json').write_text(json.dumps(result, indent=2))
    print(json.dumps(result, indent=2), flush=True)
    if result['status'] != 'PASS':
        raise RuntimeError('Pre-DNS live path gate failed; public listener/DNS NOT activated')
    return result


def stage():
    if (ROOT / 'staged.json').exists():
        raise RuntimeError('Already staged: inspect first, do not repeat')
    backup = ROOT / ('backup-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
    shutil.copytree('/etc/nginx', backup / 'nginx')
    if not Path(MODULE).exists():
        env = dict(os.environ, NEEDRESTART_MODE='l', DEBIAN_FRONTEND='noninteractive')
        subprocess.run(['apt-get', 'install', '-y', '--no-upgrade', '--no-install-recommends',
                        'libnginx-mod-stream'], env=env, check=True, timeout=180)
    apply(render())
    (ROOT / 'staged.json').write_text(json.dumps({'backup': str(backup),
        'sha256': hashlib.sha256(CONF.read_bytes()).hexdigest(), 'at': datetime.now(timezone.utc).isoformat()}))
    time.sleep(0.5)
    check()


def revoke():
    marker = ROOT / 'old-cert-revoke.json'
    if marker.exists():
        raise RuntimeError('Already attempted: inspect recorded result')
    result = run(['certbot', 'revoke', '--cert-path',
        '/etc/letsencrypt/live/' + HOST + '/cert.pem', '--reason',
        'cessationofoperation', '--non-interactive'], timeout=90)
    data = {'at': datetime.now(timezone.utc).isoformat(), 'code': result.returncode,
            'stdout': result.stdout, 'stderr': result.stderr}
    marker.write_text(json.dumps(data, indent=2))
    print(json.dumps(data, indent=2))
    if result.returncode:
        raise RuntimeError('Old certificate revocation not confirmed; remain closed')


def activate():
    if json.loads((ROOT / 'old-cert-revoke.json').read_text())['code'] != 0:
        raise RuntimeError('Old Beget certificate must be revoked first')
    if json.loads((ROOT / 'preflight.json').read_text())['status'] != 'PASS':
        raise RuntimeError('Pre-DNS gate not passed')
    if CONF.read_text() != render():
        raise RuntimeError('Staged config drift; inspect before activation')
    apply(render(public=True))
    try:
        # systemctl reload returns before the new workers bind the port.
        deadline = time.monotonic() + 5
        while True:
            try:
                with socket.create_connection(('127.0.0.1', 443), timeout=0.5):
                    break
            except OSError:
                if time.monotonic() >= deadline:
                    raise RuntimeError('Public relay listener did not become ready')
                time.sleep(0.1)
        check(port=443)
    except BaseException:
        apply(render())
        raise
    (ROOT / 'activated.json').write_text(json.dumps({'at': datetime.now(timezone.utc).isoformat(),
        'sha256': hashlib.sha256(CONF.read_bytes()).hexdigest()}))
    print('TCP_RELAY_ACTIVE; DNS still requires separate tested cutover')


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('action', choices=['stage', 'check', 'revoke', 'activate', 'rollback'])
    args = p.parse_args()
    identity()
    if args.action == 'stage': stage()
    elif args.action == 'check': check()
    elif args.action == 'revoke': revoke()
    elif args.action == 'activate': activate()
    else:
        data = json.loads((ROOT / 'staged.json').read_text())
        apply((Path(data['backup']) / 'nginx/nginx.conf').read_text())
        print('Restored prior hold; no TLS termination or public RU application')


if __name__ == '__main__':
    main()
