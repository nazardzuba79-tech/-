#!/usr/bin/env python3
"""Resume only the Beget TLS activation, preserving the failed issuance record.

Never issues another certificate, edits DNS, or accesses the primary API/DB.
"""
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import pwd
import shutil
import subprocess
import time

HOST = 'ru.voltextech.net'
IP = '185.23.35.226'


def command(args, timeout=15):
    p = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    return {'exit': p.returncode, 'stdout': p.stdout, 'stderr': p.stderr}


def state():
    return {
        'service': command(['systemctl', 'show', 'nginx', '--property=ActiveState,SubState,MainPID,Result']),
        'listeners': command(['ss', '-ltnp']),
        'errorTail': Path('/etc/nginx/voltex-rf/error.log').read_text()[-5000:],
    }


def main():
    raise RuntimeError('OWNER SECURITY HOLD: this former L7 activation is disabled; use the security hold only.')
    if os.geteuid() != 0:
        raise RuntimeError('Root required on the approved Beget node')
    addresses = json.loads(subprocess.check_output(['ip', '-j', 'address'], text=True))
    if not any(a.get('local') == IP for n in addresses for a in n.get('addr_info', [])):
        raise RuntimeError('Wrong node')
    os.umask(0o077)
    prior = json.loads(Path('/root/voltex-rf-stage2-result.json').read_text())
    if (prior.get('node') != 'voltex-ru-gateway-01' or prior.get('status') != 'FAILED'
            or prior.get('rollbackSyntaxExit') != 0 or prior.get('rollbackReloadExit') != 0):
        raise RuntimeError('Unexpected previous activation state; inspect manually')
    cert = Path('/etc/letsencrypt/live') / HOST / 'fullchain.pem'
    subprocess.run(['openssl', 'x509', '-in', str(cert), '-noout', '-checkend', '86400'], check=True)
    result_path = Path('/root/voltex-rf-activation-result.json')
    if result_path.exists():
        raise RuntimeError('Existing activation result; no automatic repeat')
    result = {'startedAt': datetime.now(timezone.utc).isoformat(), 'node': 'voltex-ru-gateway-01',
              'ip': IP, 'status': 'STARTED', 'before': state(), 'mainChanged': False,
              'scriptSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              'certificate': command(['openssl', 'x509', '-in', str(cert), '-noout',
                                      '-dates', '-subject', '-issuer', '-fingerprint', '-sha256'])}
    result_path.write_text(json.dumps(result, indent=2))
    root = Path('/opt/voltex-rf')
    config = Path('/etc/nginx/nginx.conf')
    backup = Path(json.loads(Path('/root/voltex-rf-stage1-result.json').read_text())['backup']) / 'before-existing-cert-activation.conf'
    backup.write_bytes(config.read_bytes())
    activated = False
    try:
        spec = importlib.util.spec_from_file_location('voltex_rf_render', root / 'render.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        candidate = config.with_name('nginx.conf.voltex-existing-cert')
        candidate.write_text(module.render())
        subprocess.run(['nginx', '-t', '-c', str(candidate)], check=True, timeout=15)
        os.replace(candidate, config)
        activated = True
        subprocess.run(['systemctl', 'reload', 'nginx'], check=True, timeout=20)
        # systemd ExecReload acknowledges the signal, not the new listener readiness.
        attempts = []
        for _ in range(20):
            probe = command(['curl', '--silent', '--show-error', '--fail', '--max-time', '2',
                '--noproxy', '*', '--resolve', HOST + ':443:127.0.0.1',
                'https://' + HOST + '/_voltex/health'], timeout=4)
            attempts.append(probe)
            if probe['exit'] == 0 and probe['stdout'].strip() == 'voltex-rf-gateway':
                break
            time.sleep(0.25)
        result.update(healthAttempts=attempts, after=state())
        if attempts[-1]['exit'] or attempts[-1]['stdout'].strip() != 'voltex-rf-gateway':
            raise RuntimeError('TLS health not ready within bounded readiness check')
        gid = pwd.getpwnam('www-data').pw_gid
        root.chmod(0o750)
        os.chown(root, 0, gid)
        for name in ('voltex-rf-monitor.service', 'voltex-rf-monitor.timer'):
            target = Path('/etc/systemd/system') / name
            shutil.copyfile(root / name, target)
            target.chmod(0o644)
        shutil.copyfile(root / 'logrotate.conf', '/etc/logrotate.d/voltex-rf')
        Path('/etc/logrotate.d/voltex-rf').chmod(0o644)
        subprocess.run(['systemctl', 'daemon-reload'], check=True, timeout=20)
        subprocess.run(['systemctl', 'enable', '--now', 'voltex-rf-monitor.timer', 'certbot.timer'], check=True, timeout=30)
        subprocess.run(['systemctl', 'start', 'voltex-rf-monitor.service'], check=True, timeout=20)
        result.update(status='TLS_LOCAL_HEALTH_PASS', appActivated=True,
                      configSha256=hashlib.sha256(config.read_bytes()).hexdigest(),
                      monitoring=command(['journalctl', '-u', 'voltex-rf-monitor.service', '-n', '8', '--no-pager']))
    except Exception as exc:
        result.update(status='FAILED', error=str(exc))
        if activated:
            config.write_bytes(backup.read_bytes())
            result['rollbackSyntax'] = command(['nginx', '-t'])
            if result['rollbackSyntax']['exit'] == 0:
                result['rollbackReload'] = command(['systemctl', 'reload', 'nginx'])
        raise
    finally:
        result['finishedAt'] = datetime.now(timezone.utc).isoformat()
        result_path.write_text(json.dumps(result, indent=2) + '\n')


if __name__ == '__main__':
    main()
