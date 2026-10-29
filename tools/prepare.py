"""Assemble isolated test runtime from sealed bytes; never compile application code."""
from pathlib import Path
import hashlib,json,tarfile,zipfile,shutil,os
R=Path(__file__).resolve().parent.parent
I=R/'inputs'
pins=json.loads((I/'SHA256.json').read_text())
assert {p.name for p in I.iterdir() if p.is_file()}==set(pins)|{'SHA256.json'}
for name,digest in pins.items():assert hashlib.sha256((I/name).read_bytes()).hexdigest()==digest,name
def untar(src,dst):
    with tarfile.open(src) as a:
        for m in a.getmembers():
            assert m.isfile() or m.isdir()
            assert (dst/m.name).resolve().is_relative_to(dst.resolve())
        a.extractall(dst,filter='data')
def unzip(src,dst):
    with zipfile.ZipFile(src) as a:
        for n in a.namelist():assert (dst/n).resolve().is_relative_to(dst.resolve())
        a.extractall(dst)
untar(I/'installed-runtime.tar.gz',R/'baseline/api-installed')
untar(I/'VOLTEX-641-api-overlay.tar.gz',R/'artifacts')
unzip(I/'installed-frontend.zip',R/'baseline/frontend-dist')
unzip(I/'VOLTEX-641-frontend.zip',R/'frontend-git/frontend/dist')
shutil.copyfile(I/'apply-only-socials.sql',R/'artifacts/apply-only-socials.sql')
A=R/'api-source'; T=R/'runtime-candidate'; T.mkdir(exist_ok=True)
shutil.copytree(R/'baseline/api-installed/dist',T/'dist',dirs_exist_ok=True)
shutil.copytree(R/'baseline/api-installed/node_modules/.prisma/client',A/'node_modules/.prisma/client',dirs_exist_ok=True)
overlay=R/'artifacts/api-overlay'
manifest=json.loads((I/'api-manifest.json').read_text())
for name,digest in manifest['payload'].items():
    assert hashlib.sha256((overlay/name).read_bytes()).hexdigest()==digest,name
    if name.startswith('dist/'):dst=T/name
    elif name.startswith(('node_modules/','prisma/','src/')):dst=A/name
    else:continue
    dst.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(overlay/name,dst)
(T/'node_modules').symlink_to(A/'node_modules',target_is_directory=True)
(T/'frontend').symlink_to(R/'frontend-git/frontend',target_is_directory=True)
(T/'scripts').mkdir(exist_ok=True)
shutil.copyfile(R/'tools/qa-copy-socials-browser.cjs',T/'scripts/qa-copy-socials-browser.cjs')
test='src/api/routes/__tests__/copyStrategySocials.pg.test.ts'
(A/test).parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(R/'pr-source'/test,A/test)
test2='src/shared/__tests__/copyStrategySocials.test.ts'
(A/test2).parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(R/'pr-source'/test2,A/test2)
for filename, mappings in {
    'jest.rc2.cjs': {r'^\.\./copyStrategySocials$':'api/routes/copyStrategySocials.js',r'^\.\./\.\./\.\./services/copyTrading/strategyOwner$':'services/copyTrading/strategyOwner.js'},
    'jest.policy.cjs': {r'^\.\./copyStrategySocials$':'shared/copyStrategySocials.js'},
}.items():
    mapper={pattern:str(T/'dist'/module) for pattern,module in mappings.items()}
    (A/filename).write_text("module.exports={...require('./jest.config.js'),moduleNameMapper:"+json.dumps(mapper)+"};")
print('PASS: input checksums; exact API/frontend extraction; installed Linux client engine retained')
