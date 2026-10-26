#!/usr/bin/env python3
"""Narrow lifecycle work for the already installed owner-approved RU vhost only."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import urllib.request
import sys
sys.path.insert(0, '/root')
import rf

ROOT = rf.ROOT
HOST = rf.HOST
STAGING = 'https://acme-staging-v02.api.letsencrypt.org/directory'
RENEWAL = Path('/etc/letsencrypt/renewal') / (HOST + '.conf')
STATE = ROOT / 'renewal-prepared.json'


def prepare():
    before = rf.primary_snapshot()
    if STATE.exists():
        raise RuntimeError('Prepared already: inspect saved state, never repeat registration blindly')
    if set(p.name for p in RENEWAL.parent.glob('*.conf')) != {HOST + '.conf'}:
        raise RuntimeError('Other LE renewal configurations exist: do not alter shared renewal scheduling')
    original = json.loads((ROOT / 'installed.json').read_text())
    if hashlib.sha256(rf.VHOST.read_bytes()).hexdigest() != original['vhostSha256']:
        raise RuntimeError('RU vhost drift; inspect first')
    backup = ROOT / ('renewal-backup-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
    backup.mkdir(mode=0o700)
    shutil.copy2(RENEWAL, backup / 'renewal.conf')
    shutil.copy2(rf.VHOST, backup / 'ru.conf')
    with urllib.request.urlopen(STAGING, timeout=15) as r:
        if json.load(r).get('meta', {}).get('termsOfService') != rf.TERMS:
            raise RuntimeError('Staging LE terms differ from owner-accepted agreement')
    subprocess.run(['certbot', 'register', '--non-interactive', '--agree-tos',
        '--register-unsafely-without-email', '--server', STAGING], check=True, timeout=60)
    accounts = list(Path('/etc/letsencrypt/accounts/acme-staging-v02.api.letsencrypt.org/directory').glob('*/regr.json'))
    if len(accounts) != 1: raise RuntimeError('Ambiguous staging accounts')
    staging_account = json.loads(accounts[0].read_text())['uri']
    # Only the ACME challenge HTTP listener, reachable from the approved relay.
    subprocess.run(['ufw', 'allow', 'proto', 'tcp', 'from', rf.BEGET_IP,
                    'to', 'any', 'port', '18080'], check=True, timeout=15)
    previous = rf.VHOST.read_text()
    rf.VHOST.write_text(previous.replace('    proxy_hide_header Cache-Control;',
        '    proxy_hide_header Alt-Svc;\n    proxy_hide_header Cache-Control;'))
    try:
        subprocess.run(['nginx','-t'],check=True,timeout=15)
        subprocess.run(['systemctl','reload','nginx'],check=True,timeout=20)
        after = rf.primary_snapshot()
        if before['mainVhostSha256'] != after['mainVhostSha256'] or before['api']['commit'] != after['api']['commit']:
            raise RuntimeError('Primary changed')
    except BaseException:
        rf.VHOST.write_text(previous)
        subprocess.run(['nginx','-t'],check=True,timeout=15)
        subprocess.run(['systemctl','reload','nginx'],check=True,timeout=20)
        raise
    original['vhostSha256'] = hashlib.sha256(rf.VHOST.read_bytes()).hexdigest()
    (ROOT / 'installed.json').write_text(json.dumps(original,indent=2))
    STATE.write_text(json.dumps({'backup':str(backup),'stagingAccount':staging_account,'before':before},indent=2))
    production_account = json.loads((ROOT / 'prepared.json').read_text())['account']
    print('CAA_PRODUCTION=letsencrypt.org;validationmethods=dns-01,http-01;accounturi='+production_account)
    print('CAA_STAGING=letsencrypt.org;validationmethods=http-01;accounturi='+staging_account)
    print('Private ACME account keys stay on Hetzner; add both exact bound records before test')


def test():
    from configobj import ConfigObj
    state = json.loads(STATE.read_text())
    renewal = ConfigObj(str(RENEWAL))
    params = renewal['renewalparams']
    params['authenticator'] = 'webroot'
    params['pref_challs'] = ['http-01']
    params['webroot_path'] = [str(ROOT / 'acme')]
    params['webroot_map'] = {HOST:str(ROOT / 'acme')}
    for key in list(params):
        if key.startswith('manual_'): del params[key]
    params['renew_hook'] = '/usr/sbin/nginx -t && /bin/systemctl reload nginx'
    renewal.write()
    result = rf.run(['certbot','renew','--cert-name',HOST,'--dry-run','--non-interactive',
        '--no-random-sleep-on-renew','--run-deploy-hooks'], timeout=180)
    (ROOT / 'renewal-test.json').write_text(json.dumps({'at':datetime.now(timezone.utc).isoformat(),
        'code':result.returncode,'stdout':result.stdout,'stderr':result.stderr},indent=2))
    print(result.stdout); print(result.stderr)
    if result.returncode:
        shutil.copy2(Path(state['backup'])/'renewal.conf',RENEWAL)
        raise RuntimeError('Renewal dry-run failed: previous manual renewal config restored')
    subprocess.run(['systemctl','enable','--now','certbot.timer'],check=True,timeout=20)
    current = rf.primary_snapshot()
    if current['mainVhostSha256'] != state['before']['mainVhostSha256']:
        raise RuntimeError('Primary vhost drift')
    print('RU_AUTOMATIC_RENEWAL_DRY_RUN_PASS; primary vhost unchanged; no key on Beget')


if __name__ == '__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('action',choices=['prepare','test'])
    args=p.parse_args();rf.identity();os.umask(0o077)
    if args.action=='prepare':prepare()
    else:test()
