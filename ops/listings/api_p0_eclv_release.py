#!/usr/bin/env python3
"""Guarded five-module P0 overlay preserving the deployed ECLV image. No DB, migration or financial commands."""
import argparse, copy, hashlib, json, os, pathlib, re, subprocess, sys, time, urllib.request

CONTAINER = 'voltex-cutover-api-production-1'
BASE_SHA = '754de3fc5bbe5b00b96dd0504ed0d5eabd6c5683'
BASE_IMAGE = None
BASE_TAG = 'voltex-eclv-peak:' + BASE_SHA
OLD_HASHES = {'dist/api/routes/withdrawals.js': '357e8cb6008ef9e33afc4af565ad76760e16e80b22584365a7d157776b65331f', 'dist/api/routes/adminWithdrawals.js': 'cf023efbf477e39419e5cb76f7896befdce6f7f8f2c500578000b1c1b6ed9cdb', 'dist/services/WithdrawalService.js': '64e5a7f3d9f153a053a7d4a9116b42c63bc1b8dbe8d08243445b16f69674c894', 'dist/services/demoSpotAccess.js': '394fb408b03a7768983ffeb473cd5ef7c2bfc4e3509d70bbd6d87226a8110a45', 'dist/services/OrderService.js': 'bb0b2d6734dd2e882e240e82e7040ac8612c29628811b9461f71a728ad5456a3', 'dist/shared/listingScenarioControls.js': '23740b06c6bfcc6dfe1db031d28814f016bdceed81b58e27bd959b16407cc3b3', 'dist/services/testMarkets/simulationScenarioControls.js': '86edab1cd4bad85b80879f36f1b6a7e61e72eb185ee463c501a24fc7bd709afc'}

def run(args, timeout=90):
    p = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    if p.returncode: raise RuntimeError('Command failed safely: '+args[0]+' exit '+str(p.returncode))
    return p.stdout

def digest(value): return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()
def inspect(): return json.loads(run(['docker','inspect',CONTAINER]))[0]
def health():
    with urllib.request.urlopen('http://127.0.0.1:13020/health',timeout=5) as r: return json.load(r)

def assert_only_overlay(before, after, service, source_sha):
    old, new = copy.deepcopy(before), copy.deepcopy(after)
    assert service in old['services'] and service in new['services'], 'Service missing'
    assert new['services'][service]['environment']['VOLTEX_RELEASE_SHA'] == source_sha, 'Release identity mismatch'
    assert new['services'][service]['image'].startswith('voltex-api-p0:'), 'Wrong image'
    for config in [old,new]:
        config['services'][service].pop('image',None)
        config['services'][service].setdefault('environment',{}).pop('VOLTEX_RELEASE_SHA',None)
    assert old == new, 'Refused: changes beyond API image/release identity'

def runtime_signature(c):
    env = sorted(e for e in c['Config'].get('Env',[]) if not e.startswith('VOLTEX_RELEASE_SHA='))
    host = c['HostConfig']
    return {'env':env,'entrypoint':c['Config'].get('Entrypoint'),'cmd':c['Config'].get('Cmd'),
      'user':c['Config'].get('User'),'workdir':c['Config'].get('WorkingDir'),
      'mounts':sorted((m['Type'],m['Source'],m['Destination'],m.get('RW')) for m in c.get('Mounts',[])),
      'networkNames':sorted(c['NetworkSettings'].get('Networks',{})),
      'host':{k:host.get(k) for k in ['PortBindings','NetworkMode','RestartPolicy','Memory','NanoCpus','CpuQuota','CpuPeriod','ReadonlyRootfs','CapAdd','CapDrop','SecurityOpt']}}

def private_write(path, data):
    fd=os.open(str(path),os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
    with os.fdopen(fd,'w') as f: json.dump(data,f,indent=2); f.write('\n')

def memory_guard():
    values=dict(line.split(':',1) for line in pathlib.Path('/proc/meminfo').read_text().splitlines())
    assert int(values['MemAvailable'].split()[0]) >= 1024*1024, 'Available server RAM below1GiB'

def public_payload_modes(release, names):
    # Only the pinned, non-secret build payload is readable by the image's
    # unprivileged Node user. The host release root/plans remain private.
    for name in names:
        p=release/name
        assert p.is_file() and not p.is_symlink(), 'Unexpected payload file'
        p.chmod(0o644)
        for parent in p.parents:
            if parent==release: break
            parent.chmod(0o755)

def compose_context(c):
    labels=c['Config']['Labels']; files=labels['com.docker.compose.project.config_files'].split(',')
    assert files and all(p.startswith('/opt/voltex-precutover/') and pathlib.Path(p).is_file() for p in files), 'Unexpected compose stack'
    project=labels['com.docker.compose.project']; service=labels['com.docker.compose.service']
    assert project=='voltex-cutover' and service=='api-production', 'Unexpected target'
    # The observed production service belongs to the existing cutover profile.
    # Selecting it for config/up does not start other services: up names ONLY it.
    args=['docker','compose','--profile','cutover','-p',project]
    for f in files: args += ['-f',f]
    return args,service

def authoritative_base_image():
    previous=pathlib.Path('/opt/voltex-precutover/releases/eclv-peak-754de3fc5bbe.prepared/applied.json')
    d=json.loads(previous.read_text())
    assert d['source']==BASE_SHA and d['health']=='ok' and d['runtimeConfigurationPreserved'] is True, 'ECLV receipt changed'
    assert re.fullmatch('sha256:[a-f0-9]{64}',d['image']), 'Invalid ECLV immutable image'
    return d['image']

def assert_financial_flags(flags):
    on=(True,'true','1',1)
    off=(False,'false','0',0,'',None)
    for name in ['DEMO_SPOT_ENABLED','DEMO_LIQUIDITY_ENABLED','DEMO_WITHDRAWAL_GUARD_ENABLED']:
        assert flags.get(name) in on, 'Observed production flag changed: '+name
    assert flags.get('SIMULATION_SPOT_DEMO_SETTLEMENT_ENABLED') in off, 'New simulation settlement must remain OFF'

def production_flags_match():
    code="const fs=require('fs');const c=JSON.parse(fs.readFileSync('/run/secrets/production_config','utf8'));const names=['DEMO_SPOT_ENABLED','DEMO_LIQUIDITY_ENABLED','DEMO_WITHDRAWAL_GUARD_ENABLED','SIMULATION_SPOT_DEMO_SETTLEMENT_ENABLED'];console.log(JSON.stringify(Object.fromEntries(names.map(k=>[k,c[k]??process.env[k]??null]))));"
    assert_financial_flags(json.loads(run(['docker','exec',CONTAINER,'node','-e',code])))

def main():
    global BASE_IMAGE
    BASE_IMAGE=authoritative_base_image()
    ap=argparse.ArgumentParser();ap.add_argument('mode',choices=['prepare','apply']);ap.add_argument('source_sha');a=ap.parse_args()
    assert re.fullmatch('[a-f0-9]{40}',a.source_sha), 'Exact source SHA required'
    release=pathlib.Path('/opt/voltex-precutover/releases/p0-fences-'+a.source_sha[:12]+'.prepared')
    plan_file=release/'release-plan.json';overlay=release/'compose.p0-fences.json'
    c=inspect(); h=health()
    if h.get('commit')==a.source_sha:
        assert plan_file.is_file() and c['Image']==json.loads(plan_file.read_text())['newImage'], 'Applied identity mismatch'
        print(json.dumps({'result':'ALREADY_APPLIED','source':a.source_sha}));return
    assert c['Image']==BASE_IMAGE and h.get('status')=='ok' and h.get('commit')==BASE_SHA, 'Production base changed'
    assert c['Config'].get('Entrypoint')==['node','/opt/operations/runtime-bootstrap.cjs'], 'Bootstrap changed'
    assert c['Config'].get('Cmd')==['node','dist/index.js'], 'Unexpected startup/migration command'
    assert c.get('State',{}).get('Health',{}).get('Status')=='healthy', 'API is not healthy'
    memory_guard();production_flags_match();args,service=compose_context(c)
    hashes=run(['docker','exec',CONTAINER,'sha256sum',*OLD_HASHES]).splitlines()
    assert {line.split()[1]:line.split()[0] for line in hashes}==OLD_HASHES, 'Production modules changed'
    assert run(['docker','image','inspect',BASE_TAG,'--format','{{.Id}}']).strip()==BASE_IMAGE, 'Rollback image changed'
    before=json.loads(run(args+['config','--format','json']))
    assert before['services'][service].get('profiles')==['cutover'], 'Production service profile changed'
    assert before['services'][service].get('command')==['node','dist/index.js'], 'Compose startup is not the observed direct Node command'
    if a.mode=='prepare':
        release.mkdir(mode=0o700,parents=True,exist_ok=True)
        raw='https://raw.githubusercontent.com/nazardzuba79-tech/-/'+a.source_sha+'/ops/listings/api-p0-eclv/'
        with urllib.request.urlopen(raw+'payload-sha256.json',timeout=20) as r: payload=json.load(r)
        expected={'dist/services/OrderService.js', 'dist/api/routes/adminWithdrawals.js', 'dist/services/WithdrawalService.js.map', 'dist/services/demoSpotAccess.js', 'dist/api/routes/withdrawals.js', 'dist/services/OrderService.js.map', 'dist/services/WithdrawalService.js', 'dist/services/demoSpotAccess.js.map', 'dist/api/routes/withdrawals.js.map', 'Dockerfile', 'dist/api/routes/adminWithdrawals.js.map'}
        assert set(payload)==expected and all(re.fullmatch('[a-f0-9]{64}',v) for v in payload.values()), 'Unexpected payload inventory'
        for name,sha in payload.items():
            p=release/name;p.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
            with urllib.request.urlopen(raw+name,timeout=20) as r: body=r.read(600000)
            assert hashlib.sha256(body).hexdigest()==sha, 'Payload checksum mismatch'
            p.write_bytes(body);p.chmod(0o600)
        public_payload_modes(release, expected)
        tag='voltex-api-p0:'+a.source_sha
        run(['docker','build','--pull=false','--network=none','--label','org.opencontainers.image.revision='+a.source_sha,'-t',tag,str(release)],timeout=120)
        image=run(['docker','image','inspect',tag,'--format','{{.Id}}']).strip()
        private_write(overlay,{'services':{service:{'image':tag,'environment':{'VOLTEX_RELEASE_SHA':a.source_sha}}}})
        after=json.loads(run(args+['-f',str(overlay),'config','--format','json']))
        assert_only_overlay(before,after,service,a.source_sha)
        plan={'source':a.source_sha,'baseSource':BASE_SHA,'oldImage':BASE_IMAGE,'newImage':image,'overlay':str(overlay),
          'composeArgs':args,'service':service,'runtimeSignature':digest(runtime_signature(c)),
          'resolvedBeforeSignature':digest(before),'resolvedAfterSignature':digest(after),'onlyImageAndReleaseIdentityChange':True,
          'productionChanged':False,'payloadSha256':payload}
        private_write(plan_file,plan)
        print(json.dumps({'result':'PREPARED_NOT_DEPLOYED','source':a.source_sha,'oldImage':BASE_IMAGE,'newImage':image,'onlyImageAndReleaseIdentityChange':True}));return
    assert plan_file.is_file(), 'Prepare first';plan=json.loads(plan_file.read_text())
    assert plan['source']==a.source_sha and plan['composeArgs']==args and plan['runtimeSignature']==digest(runtime_signature(c)), 'Prepared target changed'
    after=json.loads(run(args+['-f',str(overlay),'config','--format','json']))
    assert_only_overlay(before,after,service,a.source_sha)
    assert plan['resolvedBeforeSignature']==digest(before) and plan['resolvedAfterSignature']==digest(after), 'Resolved configuration changed'
    assert run(['docker','image','inspect',after['services'][service]['image'],'--format','{{.Id}}']).strip()==plan['newImage'], 'Prepared image changed'
    try:
        run(args+['-f',str(overlay),'up','--no-build','--no-deps','--pull','never','-d',service],timeout=90)
        deadline=time.monotonic()+90
        while time.monotonic()<deadline:
            current=inspect()
            assert current['Image']==plan['newImage'], 'Unexpected image after restart'
            assert digest(runtime_signature(current))==plan['runtimeSignature'], 'Runtime/bootstrap/finance configuration changed'
            try: ok=health().get('commit')==a.source_sha and current.get('State',{}).get('Health',{}).get('Status')=='healthy'
            except Exception: ok=False
            if ok:
                private_write(release/'applied.json',{'source':a.source_sha,'image':plan['newImage'],'health':'ok','runtimeConfigurationPreserved':True})
                print(json.dumps({'result':'APPLIED_HEALTHY','source':a.source_sha,'image':plan['newImage'],'runtimeConfigurationPreserved':True}));return
            time.sleep(2)
        raise RuntimeError('Health did not become ready')
    except Exception:
        # At this stage the owner Draft is still OLD. Restore only this API.
        run(args+['up','--no-build','--no-deps','--pull','never','-d',service],timeout=90)
        print(json.dumps({'result':'API_ROLLBACK_REQUESTED','source':BASE_SHA}));raise

if __name__=='__main__':
    try: main()
    except Exception as e: print(type(e).__name__+': '+str(e),file=sys.stderr);sys.exit(1)
