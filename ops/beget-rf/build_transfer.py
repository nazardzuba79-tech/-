#!/usr/bin/env python3
"""Build the exact standalone stage1 file for the authorized Beget file editor."""
import argparse
import base64
import hashlib
from pathlib import Path


def build():
    raise RuntimeError('OWNER SECURITY HOLD: no new ACME/L7 bootstrap transfer is permitted.')
    root = Path(__file__).resolve().parent
    assets = {}
    for name in ('render.py', 'monitor.py', 'logrotate.conf',
                 'voltex-rf-monitor.service', 'voltex-rf-monitor.timer'):
        data = (root / name).read_bytes()
        assets[name] = {'sha256': hashlib.sha256(data).hexdigest(),
                        'base64': base64.b64encode(data).decode()}
    source = (root / 'stage1.py').read_text()
    if source.count('ASSETS = {}') != 1:
        raise ValueError('Unexpected stage1 template')
    result = source.replace('ASSETS = {}', 'ASSETS = ' + repr(assets), 1)
    compile(result, 'voltex-stage1.py', 'exec')
    return result


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('output')
    args = p.parse_args()
    path = Path(args.output)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(build())
    print(hashlib.sha256(path.read_bytes()).hexdigest(), path)
