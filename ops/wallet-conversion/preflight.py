#!/usr/bin/env python3
"""READ ONLY compatibility check. Never builds, deploys, restarts, migrates or changes flags."""
import argparse, copy, hashlib, json, pathlib, re, subprocess, urllib.request

API = 'voltex-cutover-api-production-1'
DB = 'voltex-cutover-db-1'
BASE = '210aefacb319374194392624d75b312b87b42e94'
IMAGE = 'sha256:07a4c3e07ff36d17eb611e4d7a5a86bbbd1c2e36eaf7b1c9f041ef774b9d2a77'

def run(args):
    p = subprocess.run(args, capture_output=True, text=True, timeout=30, check=False)
    if p.returncode: raise RuntimeError('Read-only command failed; output withheld')
    return p.stdout

def validate(snapshot, manifest):
    expected = manifest['productionBase']
    assert expected['source'] == BASE and expected['image'] == IMAGE, 'Unexpected release base'
    assert snapshot['image'] == IMAGE and snapshot['health'] == {'status': 'ok', 'commit': BASE}, 'Live API changed'
    assert snapshot['entrypoint'] == ['node', '/opt/operations/runtime-bootstrap.cjs'], 'Bootstrap changed'
    assert snapshot['cmd'] == ['node', 'dist/index.js'], 'Startup changed or migration command introduced'
    assert snapshot['node'] == 'v22.23.3' and snapshot['apiHealthy'] and snapshot['dbHealthy'], 'Runtime not compatible/healthy'
    assert snapshot['composeCount'] == 14 and snapshot['composeExist'] and snapshot['rollbackExists'], 'Compose/rollback changed'
    assert not snapshot['runtimeOverlaid'], 'Runtime file mount needs separate review'
    assert snapshot['hashes'] == expected['runtimeHashes'], 'Protected runtime fingerprints changed'
    flags = snapshot['flags']
    on = (True, 'true', '1', 1)
    off = (False, 'false', '0', 0, '', None)
    assert flags.get('WALLET_CONVERSION_ENABLED') in off and not flags.get('reservesConfigured'), 'Conversion or ordinary Balance admission already enabled'
    assert flags.get('SIMULATION_SPOT_DEMO_SETTLEMENT_ENABLED') in off, 'Unrelated financial activation'
    for key in ['DEMO_SPOT_ENABLED', 'DEMO_LIQUIDITY_ENABLED', 'DEMO_WITHDRAWAL_GUARD_ENABLED']:
        assert flags.get(key) in on, 'Existing demo safety dependency changed'

def self_test():
    manifest = {'productionBase': {'source': BASE, 'image': IMAGE, 'runtimeHashes': {'dist/index.js': 'a'*64}}}
    good = {'image': IMAGE, 'health': {'status': 'ok', 'commit': BASE}, 'entrypoint': ['node', '/opt/operations/runtime-bootstrap.cjs'],
            'cmd': ['node', 'dist/index.js'], 'node': 'v22.23.3', 'apiHealthy': True, 'dbHealthy': True,
            'composeCount': 14, 'composeExist': True, 'rollbackExists': True, 'runtimeOverlaid': False,
            'hashes': {'dist/index.js': 'a'*64}, 'flags': {'DEMO_SPOT_ENABLED': 'true', 'DEMO_LIQUIDITY_ENABLED': 'true', 'DEMO_WITHDRAWAL_GUARD_ENABLED': 'true'}}
    validate(good, manifest)
    bad = [('image', 'other'), ('cmd', ['sh', '-c', 'prisma migrate deploy']), ('composeCount', 15),
           ('rollbackExists', False), ('runtimeOverlaid', True), ('hashes', {}), ('dbHealthy', False)]
    for key, value in bad:
        item = copy.deepcopy(good); item[key] = value
        try: validate(item, manifest)
        except AssertionError: continue
        raise AssertionError('Guard accepted ' + key)
    for flag in ['WALLET_CONVERSION_ENABLED', 'reservesConfigured', 'SIMULATION_SPOT_DEMO_SETTLEMENT_ENABLED']:
        item = copy.deepcopy(good); item['flags'][flag] = True
        try: validate(item, manifest)
        except AssertionError: continue
        raise AssertionError('Guard accepted financial activation ' + flag)
    print('preflight safety: 1 positive / 10 negative cases PASS; no Docker or network calls')

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--manifest'); ap.add_argument('--self-test', action='store_true'); args = ap.parse_args()
    if args.self_test: return self_test()
    assert args.manifest, 'A pinned release manifest is required'
    manifest = json.loads(pathlib.Path(args.manifest).read_text())
    paths = manifest['productionBase']['runtimeHashes']
    assert len(paths) == 16 and all(re.fullmatch(r'dist/[A-Za-z0-9_/.]+\.js', name) and '..' not in name and re.fullmatch('[a-f0-9]{64}', digest) for name, digest in paths.items()), 'Invalid fingerprint manifest'
    api = json.loads(run(['docker', 'inspect', API]))[0]; db = json.loads(run(['docker', 'inspect', DB]))[0]
    files = api['Config']['Labels']['com.docker.compose.project.config_files'].split(',')
    with urllib.request.urlopen('http://127.0.0.1:13020/health', timeout=5) as response: health = json.load(response)
    flag_reader = "const fs=require('fs');const c=JSON.parse(fs.readFileSync('/run/secrets/production_config','utf8'));const names=['WALLET_CONVERSION_ENABLED','DEMO_SPOT_ENABLED','DEMO_LIQUIDITY_ENABLED','DEMO_WITHDRAWAL_GUARD_ENABLED','SIMULATION_SPOT_DEMO_SETTLEMENT_ENABLED'];console.log(JSON.stringify({...Object.fromEntries(names.map(k=>[k,c[k]??process.env[k]??null])),reservesConfigured:!!(c.WALLET_CONVERSION_RESERVES??process.env.WALLET_CONVERSION_RESERVES)}));"
    hashes = {line.split()[1].removeprefix('/app/'): line.split()[0] for line in run(['docker', 'exec', API, 'sha256sum', *('/app/'+name for name in paths)]).splitlines()}
    snapshot = {'image': api['Image'], 'health': {'status': health.get('status'), 'commit': health.get('commit')},
                'entrypoint': api['Config'].get('Entrypoint'), 'cmd': api['Config'].get('Cmd'),
                'node': run(['docker', 'exec', API, 'node', '-p', 'process.version']).strip(),
                'apiHealthy': api['State']['Health']['Status'] == 'healthy', 'dbHealthy': db['State']['Health']['Status'] == 'healthy',
                'composeCount': len(files), 'composeExist': all(f.startswith('/opt/voltex-precutover/') and pathlib.Path(f).is_file() for f in files),
                'runtimeOverlaid': any(m['Destination'] == '/app' or m['Destination'].startswith('/app/dist') for m in api.get('Mounts', [])),
                'rollbackExists': json.loads(run(['docker', 'image', 'inspect', IMAGE]))[0]['Id'] == IMAGE,
                'hashes': hashes, 'flags': json.loads(run(['docker', 'exec', API, 'node', '-e', flag_reader]))}
    validate(snapshot, manifest)
    print(json.dumps({'status': 'PRECHECK_PASS_NOT_DEPLOYMENT_PERMISSION', 'source': BASE, 'fingerprints': len(hashes), 'composeFiles': len(files), 'financialWrites': 0}))

if __name__ == '__main__': main()
