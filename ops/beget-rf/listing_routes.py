#!/usr/bin/env python3
"""Narrow owner-approved RU-vhost fix for existing public listing GET routes."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
sys.path.insert(0, '/root')
import rf

EXPECTED = '4bb1cf3749c2f5b32450a1b776409992eb3e648a217feb80ef99b4990db19a83'
OLD_PATTERN = "~ ^/_voltex/market(?<voltex_ru_market>/(?:market/(?:display|listings|test-assets)(?:/[^?]*)?|cfd/display/[^?]*|health))$"
NEW_PATTERN = "~ \"^(?:/_voltex/market){1,2}(?<voltex_ru_market>/(?:market/(?:display|listings|test-assets|nrx)(?:/[^?]*)?|cfd/display/[^?]*|health))$\""
MAP_LINES = "  ~^(GET|HEAD):/api/v1/market/test\\-assets$ 1;\n  ~^(GET|HEAD):/api/v1/market/test\\-assets/[A-Za-z0-9_./:-]+$ 1;\n  ~^(GET|HEAD):/api/v1/market/test\\-assets/[A-Za-z0-9_./:-]+/candles$ 1;\n"
ROOT = rf.ROOT
VHOST = rf.VHOST
HOST = rf.HOST

def request(path, method='GET'):
    args = ['curl','--silent','--show-error','--max-time','15','--noproxy','*',
            '--path-as-is','--resolve',HOST+':18443:127.0.0.1',
            '-X',method,'-H','Origin: https://'+HOST,'-w','\n%{http_code}',
            'https://'+HOST+':18443'+path]
    result = rf.run(args,timeout=20)
    if result.returncode: raise RuntimeError('Transport failed for '+path)
    body, status = result.stdout.rsplit('\n',1)
    try: value=json.loads(body)
    except (ValueError,TypeError): value=None
    row={'method':method,'path':path,'status':int(status),
         'json':value is not None,'bodySha256':hashlib.sha256(body.encode()).hexdigest()}
    if isinstance(value,dict):
        row['catalogueShape']=isinstance(value.get('assets'),list) and isinstance(value.get('serverTime'),(int,float))
        row['publicError']=value.get('error') if isinstance(value.get('error'),str) and len(value['error'])<100 else None
    return row

def baseline():
    expected={
        '/api/v1/market/test-assets':403,
        '/_voltex/market/market/nrx':404,
        '/_voltex/market/_voltex/market/market/listings':404,
    }
    rows=[request(path) for path in expected]
    for row in rows:
        if row['status']!=expected[row['path']]: raise RuntimeError('Baseline drift for '+row['path'])
    return rows

def gate():
    rows=[]
    for path in ['/api/v1/market/test-assets','/_voltex/market/market/nrx',
                 '/_voltex/market/_voltex/market/market/nrx',
                 '/_voltex/market/market/listings',
                 '/_voltex/market/_voltex/market/market/listings']:
        row=request(path);row['pass']=row['status']==200 and row.get('catalogueShape') is True
        rows.append(row)
    for path in ['/api/v1/market/test-assets/ZZZ-UNKNOWN',
                 '/api/v1/market/test-assets/ZZZ-UNKNOWN/candles']:
        row=request(path);row['pass']=row['status']==404 and row.get('publicError')=='unknown_test_asset'
        rows.append(row)
    for path,expected in [
        ('/api/v1/admin/users',403),('/api/v1/kyc/me',403),
        ('/api/v1/%61dmin/users',403),('/api/v1/balances',401),
        ('/api/v1/not-reviewed',403),
        ('/_voltex/market/_voltex/market/internal/listings',403),
        ('/_voltex/market/_voltex/market/https://example.com',404),
    ]:
        row=request(path);row['pass']=row['status']==expected;rows.append(row)
    row=request('/api/v1/market/test-assets','POST')
    row['pass']=row['status']==403;rows.append(row)
    return rows

def apply():
    rf.identity()
    os.umask(0o077)
    if (ROOT/'public-routes-result.json').exists():
        raise RuntimeError('Already attempted; inspect receipt instead of repeating')
    old=VHOST.read_text()
    if hashlib.sha256(old.encode()).hexdigest()!=EXPECTED:
        raise RuntimeError('RU vhost drift: refuse overwrite')
    before=rf.primary_snapshot()
    initial=baseline()
    if old.count(OLD_PATTERN)!=1 or '\n}\nserver {' not in old:
        raise RuntimeError('Unexpected configuration structure')
    new=old.replace(OLD_PATTERN,NEW_PATTERN).replace('\n}\nserver {','\n'+MAP_LINES+'}\nserver {',1)
    # All existing private route guards, headers and bodies remain byte-identical.
    backup=ROOT/('public-routes-backup-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
    backup.mkdir(mode=0o700)
    shutil.copy2(VHOST,backup/'ru.conf')
    shutil.copy2(ROOT/'installed.json',backup/'installed.json')
    receipt={'at':datetime.now(timezone.utc).isoformat(),'baseline':initial,'backup':str(backup)}
    VHOST.write_text(new)
    try:
        check=rf.run(['nginx','-t'],timeout=15)
        if check.returncode: raise RuntimeError('nginx -t failed: '+check.stderr)
        subprocess.run(['systemctl','reload','nginx'],check=True,timeout=20)
        time.sleep(0.75)
        rows=gate()
        receipt['checks']=rows
        if not all(row['pass'] for row in rows): raise RuntimeError('Public-route acceptance failed')
        after=rf.primary_snapshot()
        if before['mainVhostSha256']!=after['mainVhostSha256'] or before['api']['commit']!=after['api']['commit']:
            raise RuntimeError('Primary vhost/runtime drift')
        old_start=datetime.fromisoformat(before['api']['startedAt'].replace('Z','+00:00'))
        new_start=datetime.fromisoformat(after['api']['startedAt'].replace('Z','+00:00'))
        if abs((old_start-new_start).total_seconds())>2: raise RuntimeError('Primary API restarted')
        installed=json.loads((ROOT/'installed.json').read_text())
        installed['vhostSha256']=hashlib.sha256(new.encode()).hexdigest()
        (ROOT/'installed.json').write_text(json.dumps(installed,indent=2))
        receipt.update(status='PASS',nginxSyntax=True,primaryUnchanged=True,
                       vhostSha256=installed['vhostSha256'])
    except BaseException as exc:
        VHOST.write_text(old)
        subprocess.run(['nginx','-t'],check=True,timeout=15)
        subprocess.run(['systemctl','reload','nginx'],check=True,timeout=20)
        receipt.update(status='FAIL_ROLLED_BACK',error=str(exc))
        (ROOT/'public-routes-result.json').write_text(json.dumps(receipt,indent=2))
        print(json.dumps(receipt,indent=2),flush=True)
        raise
    (ROOT/'public-routes-result.json').write_text(json.dumps(receipt,indent=2))
    print(json.dumps(receipt,indent=2),flush=True)

if __name__=='__main__':
    if sys.argv[1:]!=['apply']: raise SystemExit('Expected explicit apply on approved existing Hetzner')
    apply()
