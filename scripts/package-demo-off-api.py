"""Build a minimal inactive-image context; never connect to a server or DB."""
import hashlib
import io
import json
import pathlib
import subprocess
import tarfile

root = pathlib.Path(__file__).resolve().parents[1]
base = '6f082a98d0c97c28215e6c5c8056b786d6fa6c99'
claude = 'a7593324be9118cfda91ee8fc6bad0b6ff3acba9'
previous = 'c86e47bfd8e19ced5527177eec07ac3adcb9a98a'
identity = '18dd73224d5ad02407a8635e51354e46da7228f2'
runtime = [
    'api/routes/demoTrading', 'api/routes/orders', 'api/routes/withdrawals', 'api/routes/adminWithdrawals', 'index',
    'services/AdminUserDeletionService', 'services/DemoLiquidity', 'services/DemoTradingService',
    'services/OrderService', 'services/SpotBookTransaction', 'services/demoSpotAccess', 'services/WithdrawalService',
]
def git(*args):
    return subprocess.check_output(['git', *args], cwd=root)
assert not git('status','--porcelain','--untracked-files=no').strip(), 'Commit reviewed source before packaging'
sha = git('rev-parse','HEAD').decode().strip()
for name in runtime:
    if name != 'index':
        assert git('show',sha+':src/'+name+'.ts') == git('show',claude+':src/'+name+'.ts'), 'Claude source mismatch '+name
# Retain only the previously reviewed demo wiring, never full-main Stocks/Futures wiring.
assert git('show',sha+':src/index.ts') == git('show',previous+':src/index.ts'), 'Production bootstrap changed'
for path in ['src/buildCommit.ts', 'src/__tests__/buildCommit.test.ts']:
    assert git('show',sha+':'+path) == git('show',identity+':'+path), 'Release identity regression '+path
allowed_source = {'src/'+name+'.ts' for name in runtime}
changed_source = git('diff','--name-only',base,sha,'--','src').decode().splitlines()
assert all(path in allowed_source or '/__tests__/' in path for path in changed_source), 'Unapproved production module changed'
protected = ['prisma','package.json','package-lock.json','src/futures','src/private-trading',
             'src/services/listings','src/services/testMarkets','config/test-markets','frontend','src/buildCommit.ts']
subprocess.run(['git','diff','--exit-code',base,sha,'--',*protected],cwd=root,check=True,stdout=subprocess.DEVNULL)
subprocess.run(['C:/Program Files/nodejs/node.exe','node_modules/typescript/bin/tsc','--pretty','false'],cwd=root,check=True)
out = root/'output'/'demo-off-release'; out.mkdir(parents=True,exist_ok=True)
archive = out/('api-overlay-'+sha+'.tar')
manifest = {'baseApi':base,'releaseSha':sha,'mergedMain':claude,'previousCandidate':previous,'identityPr606':identity,
            'baseImage':'sha256:b81b093eb9529db8b68a9aa3c668eb4f3282764741cd03efb431cdfe5b96d012',
            'flags':{'DEMO_SPOT_ENABLED':'false','DEMO_LIQUIDITY_ENABLED':'false','DEMO_WITHDRAWAL_GUARD_ENABLED':'false','VITE_DEMO_SPOT_ENABLED':'false'},
            'protectedSourceUnchanged':True,'migrationFilesIncluded':0,'files':[]}
with tarfile.open(archive,'w',format=tarfile.PAX_FORMAT) as tar:
    recipe=(root/'release/demo-off/Dockerfile').read_bytes()
    copy_lines = [line for line in recipe.decode('utf-8').splitlines() if line.startswith('COPY ')]
    expected_copy_lines = [
        'COPY --chown=1000:1000 --chmod=0644 overlay/'+name+ext+' /app/dist/'+name+ext
        for name in runtime for ext in ['.js', '.js.map']
    ]
    assert copy_lines == expected_copy_lines, 'Missing UID1000 readable per-file COPY; refusing to package'
    info=tarfile.TarInfo('Dockerfile');info.size=len(recipe);info.mode=0o644;tar.addfile(info,io.BytesIO(recipe))
    # Include parent directories explicitly so unpacking is portable across Windows/Linux.
    for directory in ['overlay', 'overlay/api', 'overlay/api/routes', 'overlay/services']:
        info = tarfile.TarInfo(directory+'/')
        info.type=tarfile.DIRTYPE;info.mode=0o755;info.uid=1000;info.gid=1000
        tar.addfile(info)
    for name in runtime:
        for extension in ['.js','.js.map']:
            p=root/'dist'/(name+extension); payload=p.read_bytes()
            target='overlay/'+name+extension
            info=tarfile.TarInfo(target);info.size=len(payload);info.mode=0o644;info.uid=1000;info.gid=1000;tar.addfile(info,io.BytesIO(payload))
            manifest['files'].append({'path':target,'sha256':hashlib.sha256(payload).hexdigest(),'bytes':len(payload),'uid':1000,'gid':1000,'mode':'0644'})
manifest['archive']=archive.name
manifest['archiveSha256']=hashlib.sha256(archive.read_bytes()).hexdigest()
manifest['archiveBytes']=archive.stat().st_size
(out/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
print(json.dumps({k:manifest[k] for k in ['releaseSha','archive','archiveSha256','archiveBytes','migrationFilesIncluded','protectedSourceUnchanged']}))
