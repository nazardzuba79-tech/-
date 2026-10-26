#!/usr/bin/env python3
"""Apply TLS on the existing Beget node ONLY AFTER owner agrees to LE terms.

Prepared code is not authorization. DNS cutover is performed separately in
Cloudflare's visible ru record editor; this script never edits DNS or main.
"""
import argparse
from datetime import datetime, timezone
import importlib.util
import json
import os
from pathlib import Path
import pwd
import shutil
import socket
import subprocess
import urllib.request

DIRECTORY = 'https://acme-v02.api.letsencrypt.org/directory'
APPROVED_TERMS = 'https://letsencrypt.org/documents/LE-SA-v1.8-July-06-2026.pdf'
HOST = 'ru.voltextech.net'
IP = '185.23.35.226'


def main():
    raise RuntimeError('OWNER SECURITY HOLD: Beget TLS termination and private routes are forbidden. Do not activate this superseded design.')
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--owner-agreed-le-20260706', action='store_true')
    args = p.parse_args()
    if not args.owner_agreed_le_20260706:
        p.error('Owner confirmation of the exact LE agreement is required; no action performed')
    if os.geteuid() != 0:
        raise RuntimeError('Root required on the existing approved Beget node')
    addresses = json.loads(subprocess.check_output(['ip', '-j', 'address'], text=True))
    if not any(a.get('local') == IP for n in addresses for a in n.get('addr_info', [])):
        raise RuntimeError('Wrong node; refusing changes')
    os.umask(0o077)
    prior = json.loads(Path('/root/voltex-rf-stage1-result.json').read_text())
    if prior.get('status') != 'ACME_HTTP_READY' or prior.get('ip') != IP:
        raise RuntimeError('Stage1 evidence mismatch')
    result_path = Path('/root/voltex-rf-stage2-result.json')
    if result_path.exists():
        raise RuntimeError('Existing stage2 result: inspect, do not repeat automatically')
    with urllib.request.urlopen(DIRECTORY, timeout=15) as response:
        actual_terms = json.load(response).get('meta', {}).get('termsOfService')
    if actual_terms != APPROVED_TERMS:
        raise RuntimeError('Issuer terms changed; new owner agreement needed')
    ips = {a[4][0] for a in socket.getaddrinfo(HOST, 443, type=socket.SOCK_STREAM)}
    if ips != {IP}:
        raise RuntimeError('DNS is not exclusively the approved IPv4; wait/inspect before issuance')
    root = Path('/opt/voltex-rf')
    result = {'startedAt': datetime.now(timezone.utc).isoformat(), 'node': 'voltex-ru-gateway-01',
              'ip': IP, 'status': 'STARTED', 'terms': actual_terms,
              'mainChanged': False, 'dnsEditedByScript': False}
    result_path.write_text(json.dumps(result, indent=2))
    backup = Path(prior['backup']) / 'bootstrap-before-tls.conf'
    backup.write_bytes(Path('/etc/nginx/nginx.conf').read_bytes())
    activated = False
    try:
        # Run once. Do not retry failed issuance or silently register under new terms.
        subprocess.run(['certbot', 'certonly', '--webroot', '-w', '/var/www/voltex-acme',
            '-d', HOST, '--non-interactive', '--agree-tos', '--register-unsafely-without-email',
            '--server', DIRECTORY], check=True, timeout=180)
        spec = importlib.util.spec_from_file_location('voltex_rf_render', root / 'render.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        candidate = Path('/etc/nginx/nginx.conf.voltex-tls-candidate')
        candidate.write_text(module.render())
        subprocess.run(['nginx', '-t', '-c', str(candidate)], check=True, timeout=15)
        os.replace(candidate, '/etc/nginx/nginx.conf')
        activated = True
        subprocess.run(['systemctl', 'reload', 'nginx'], check=True, timeout=20)
        health = subprocess.check_output(['curl', '--fail', '--silent', '--show-error',
            '--noproxy', '*', '--max-time', '10', '--resolve', HOST + ':443:127.0.0.1',
            'https://' + HOST + '/_voltex/health'], text=True)
        if health.strip() != 'voltex-rf-gateway':
            raise RuntimeError('Verified local TLS health mismatch')
        gid = pwd.getpwnam('www-data').pw_gid
        root.chmod(0o750)
        os.chown(root, 0, gid)
        for name in ('voltex-rf-monitor.service', 'voltex-rf-monitor.timer'):
            shutil.copyfile(root / name, Path('/etc/systemd/system') / name)
            (Path('/etc/systemd/system') / name).chmod(0o644)
        shutil.copyfile(root / 'logrotate.conf', '/etc/logrotate.d/voltex-rf')
        Path('/etc/logrotate.d/voltex-rf').chmod(0o644)
        subprocess.run(['systemctl', 'daemon-reload'], check=True, timeout=20)
        subprocess.run(['systemctl', 'enable', '--now', 'voltex-rf-monitor.timer', 'certbot.timer'],
                       check=True, timeout=30)
        subprocess.run(['systemctl', 'start', 'voltex-rf-monitor.service'], check=True, timeout=20)
        result.update(status='TLS_LOCAL_HEALTH_PASS', appActivated=True,
                      fullBrowserQa='PENDING', rfResidentialQa='PENDING',
                      certificateRenewalDryRun='PENDING')
    except Exception as exc:
        result.update(status='FAILED', error=str(exc))
        if activated:
            Path('/etc/nginx/nginx.conf').write_bytes(backup.read_bytes())
            check = subprocess.run(['nginx', '-t'], capture_output=True, text=True)
            result['rollbackSyntaxExit'] = check.returncode
            if check.returncode == 0:
                result['rollbackReloadExit'] = subprocess.run(['systemctl', 'reload', 'nginx']).returncode
        raise
    finally:
        result['finishedAt'] = datetime.now(timezone.utc).isoformat()
        result_path.write_text(json.dumps(result, indent=2) + '\n')
        result_path.chmod(0o600)


if __name__ == '__main__':
    main()
