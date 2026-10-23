"""Build a minimal inactive-image context; never connect to a server or DB."""
import hashlib
import io
import json
import pathlib
import subprocess
import tarfile

root = pathlib.Path(__file__).resolve().parents[1]
base = '6f082a98d0c97c28215e6c5c8056b786d6fa6c99'
claude = 'a93b2d3c1f5a8816e0135a5ba6ab6e555d9b342f'
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
protected = ['prisma','package.json','package-lock.json','src/futures','src/private-trading',
             'src/services/listings','src/services/testMarkets','config/test-markets','frontend','src/buildCommit.ts']
subprocess.run(['git','diff','--exit-code',base,sha,'--',*protected],cwd=root,check=True,stdout=subprocess.DEVNULL)
subprocess.run(['C:/Program Files/nodejs/node.exe','node_modules/typescript/bin/tsc','--pretty','false'],cwd=root,check=True)
out = root/'output'/'demo-off-release'; out.mkdir(parents=True,exist_ok=True)
archive = out/('api-overlay-'+sha+'.tar')
manifest = {'baseApi':base,'releaseSha':sha,'claudeHead':claude,
            'baseImage':'sha256:b81b093eb9529db8b68a9aa3c668eb4f3282764741cd03efb431cdfe5b96d012',
            'flags':{'DEMO_SPOT_ENABLED':'false','DEMO_LIQUIDITY_ENABLED':'false','DEMO_WITHDRAWAL_GUARD_ENABLED':'false','VITE_DEMO_SPOT_ENABLED':'false'},
            'protectedSourceUnchanged':True,'migrationFilesIncluded':0,'files':[]}
with tarfile.open(archive,'w',format=tarfile.PAX_FORMAT) as tar:
    recipe=(root/'release/demo-off/Dockerfile').read_bytes()
    info=tarfile.TarInfo('Dockerfile');info.size=len(recipe);info.mode=0o644;tar.addfile(info,io.BytesIO(recipe))
    for name in runtime:
        for extension in ['.js','.js.map']:
            p=root/'dist'/(name+extension); payload=p.read_bytes()
            target='overlay/'+name+extension
            info=tarfile.TarInfo(target);info.size=len(payload);info.mode=0o644;tar.addfile(info,io.BytesIO(payload))
            manifest['files'].append({'path':target,'sha256':hashlib.sha256(payload).hexdigest(),'bytes':len(payload)})
manifest['archive']=archive.name
manifest['archiveSha256']=hashlib.sha256(archive.read_bytes()).hexdigest()
manifest['archiveBytes']=archive.stat().st_size
(out/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
print(json.dumps({k:manifest[k] for k in ['releaseSha','archive','archiveSha256','archiveBytes','migrationFilesIncluded','protectedSourceUnchanged']}))
