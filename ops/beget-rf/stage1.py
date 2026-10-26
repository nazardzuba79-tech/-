#!/usr/bin/env python3
"""Dedicated new Beget node only: install official packages and ACME-only Nginx.

No DNS changes, TLS subscription agreement, app activation, credentials or
financial requests. Run only after confirming the node identity. Never on Hetzner.
"""
import base64
from datetime import datetime, timezone
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import urllib.request

EXPECTED_IP = '185.23.35.226'
# Filled only in the generated transfer file, from reviewed local files.
ASSETS = {}


def run(args, **kwargs):
    print('RUN', ' '.join(args), flush=True)
    return subprocess.run(args, check=True, timeout=600, **kwargs)


def main():
    raise RuntimeError('OWNER SECURITY HOLD: do not recreate the superseded ACME/L7 bootstrap.')
    if os.geteuid() != 0:
        raise RuntimeError('Root required on the new Beget node')
    os.umask(0o077)
    info = dict(line.split('=', 1) for line in Path('/etc/os-release').read_text().splitlines() if '=' in line)
    if info.get('ID') != 'ubuntu' or info.get('VERSION_ID') != '"24.04"':
        raise RuntimeError('Not the approved Ubuntu 24.04 node')
    addresses = json.loads(subprocess.check_output(['ip', '-j', 'address'], text=True))
    if not any(a.get('local') == EXPECTED_IP for n in addresses for a in n.get('addr_info', [])):
        raise RuntimeError('Not the approved Beget IP; refusing mutation')
    lock = open('/run/lock/voltex-rf-stage1.lock', 'w')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    result_path = Path('/root/voltex-rf-stage1-result.json')
    if result_path.exists():
        raise RuntimeError('Prior result exists: inspect it, never auto-repeat provisioning')
    if not ASSETS:
        raise RuntimeError('No verified transfer assets embedded')
    deploy = Path('/opt/voltex-rf')
    deploy.mkdir(mode=0o750, exist_ok=True)
    for name, asset in ASSETS.items():
        if name not in ('render.py', 'monitor.py', 'logrotate.conf',
                        'voltex-rf-monitor.service', 'voltex-rf-monitor.timer'):
            raise RuntimeError('Unexpected asset path')
        data = base64.b64decode(asset['base64'])
        if hashlib.sha256(data).hexdigest() != asset['sha256']:
            raise RuntimeError('Transfer checksum mismatch')
        (deploy / name).write_bytes(data)
        (deploy / name).chmod(0o644)
    log = open('/root/voltex-rf-stage1.log', 'a', buffering=1)
    sys.stdout = sys.stderr = log
    result = {'startedAt': datetime.now(timezone.utc).isoformat(),
              'node': 'voltex-ru-gateway-01', 'ip': EXPECTED_IP,
              'status': 'STARTED', 'dnsChanged': False, 'appActivated': False,
              'assetChecksums': {k: v['sha256'] for k, v in ASSETS.items()}}
    result_path.write_text(json.dumps(result, indent=2))
    installed = False
    backup = None
    try:
        env = dict(os.environ, DEBIAN_FRONTEND='noninteractive')
        run(['apt-get', 'update'], env=env)
        run(['apt-get', 'install', '-y', '--no-install-recommends',
             'nginx', 'certbot', 'ca-certificates', 'curl'], env=env)
        # Refuse to overwrite any unrelated site configuration.
        enabled = Path('/etc/nginx/sites-enabled')
        if enabled.exists() and any(p.name != 'default' for p in enabled.iterdir()):
            raise RuntimeError('Unexpected enabled site: manual review required')
        stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
        backup = Path('/root/voltex-rf-backup') / stamp
        backup.mkdir(parents=True, mode=0o700)
        with tarfile.open(backup / 'nginx-before.tar.gz', 'w:gz') as archive:
            archive.add('/etc/nginx', arcname='nginx')
        (backup / 'nginx.conf').write_bytes(Path('/etc/nginx/nginx.conf').read_bytes())
        (backup / 'nginx.conf.sha256').write_text(hashlib.sha256((backup / 'nginx.conf').read_bytes()).hexdigest())
        result['backup'] = str(backup)
        prefix = Path('/etc/nginx/voltex-rf')
        prefix.mkdir(mode=0o750, exist_ok=True)
        import pwd
        uid = pwd.getpwnam('www-data').pw_uid
        gid = pwd.getpwnam('www-data').pw_gid
        os.chown(prefix, 0, gid)
        for name in ('client', 'proxy'):
            p = prefix / name
            p.mkdir(mode=0o700, exist_ok=True)
            os.chown(p, uid, gid)
        for name in ('access.log', 'error.log'):
            p = prefix / name
            p.touch(exist_ok=True)
            p.chmod(0o640)
            os.chown(p, 0, gid)
        challenge = Path('/var/www/voltex-acme/.well-known/acme-challenge')
        challenge.mkdir(parents=True, mode=0o755, exist_ok=True)
        # umask 077 applies to all mkdir parents: grant traversal for Nginx.
        for p in (challenge, challenge.parent, challenge.parent.parent):
            p.chmod(0o755)
        probe = 'voltex-rf-stage1-' + ASSETS['render.py']['sha256'][:16]
        probe_file = challenge / 'voltex-gateway-preflight'
        probe_file.write_text(probe + '\n')
        probe_file.chmod(0o644)
        spec = importlib.util.spec_from_file_location('voltex_rf_render', deploy / 'render.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        candidate = Path('/etc/nginx/nginx.conf.voltex-candidate')
        candidate.write_text(module.render(bootstrap=True))
        run(['nginx', '-t', '-c', str(candidate)])
        os.replace(candidate, '/etc/nginx/nginx.conf')
        installed = True
        run(['systemctl', 'enable', '--now', 'nginx'])
        run(['systemctl', 'reload', 'nginx'])
        run(['systemctl', 'is-active', 'nginx'])
        req = urllib.request.Request('http://127.0.0.1/.well-known/acme-challenge/voltex-gateway-preflight',
                                     headers={'Host': 'ru.voltextech.net'})
        with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(req, timeout=10) as response:
            if response.read().decode().strip() != probe:
                raise RuntimeError('Local challenge response mismatch')
        result.update(status='ACME_HTTP_READY', challengePath='/.well-known/acme-challenge/voltex-gateway-preflight',
                      challengeValue=probe,
                      nginxVersion=subprocess.run(['nginx', '-v'], capture_output=True, text=True).stderr.strip())
        result['upstreamReads'] = []
        for url in ('https://voltextech.net', 'https://api.voltextech.net/health',
                    'https://market.voltextech.net/market/listings',
                    'https://api.kraken.com/0/public/Time',
                    'https://api.bybit.com/v5/market/tickers?category=linear&symbol=BTCUSDT'):
            row = {'url': url}
            try:
                with urllib.request.urlopen(url, timeout=15) as response:
                    data = response.read()
                    row.update(status=response.status, bytes=len(data), sha256=hashlib.sha256(data).hexdigest())
            except Exception as exc:
                row['error'] = str(exc)
            result['upstreamReads'].append(row)
    except Exception as exc:
        result.update(status='FAILED', error=str(exc))
        if installed and backup:
            Path('/etc/nginx/nginx.conf').write_bytes((backup / 'nginx.conf').read_bytes())
            restore = subprocess.run(['nginx', '-t'], capture_output=True, text=True)
            result['rollbackSyntaxExit'] = restore.returncode
            if restore.returncode == 0:
                result['rollbackReloadExit'] = subprocess.run(['systemctl', 'reload', 'nginx']).returncode
        raise
    finally:
        result['finishedAt'] = datetime.now(timezone.utc).isoformat()
        result_path.write_text(json.dumps(result, indent=2) + '\n')
        result_path.chmod(0o600)


if __name__ == '__main__':
    main()
