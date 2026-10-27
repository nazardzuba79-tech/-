"""Build the minimal P0-fence hotfix overlay context; never connect to a server or DB.

Fails unless: the tree is committed; the five runtime modules equal the merged main
versions byte-for-byte (#620 5b80fc3e, #625 4ac8a45e); no other runtime source differs
from the live API 89c3ac00; schema, dependencies, bootstrap, listings, futures, private
trading, test markets, config, frontend and release identity are unchanged; tsc compiles.
"""
import hashlib, io, json, os, pathlib, subprocess, sys, tarfile

root = pathlib.Path(__file__).resolve().parents[1]
live = '89c3ac003b44a6a0e7630d2ecbe5d7164e85b683'
merged = {
    'api/routes/withdrawals': '5b80fc3e73eeef6b6e336441d425c9bbff987217',
    'api/routes/adminWithdrawals': '5b80fc3e73eeef6b6e336441d425c9bbff987217',
    'services/WithdrawalService': '5b80fc3e73eeef6b6e336441d425c9bbff987217',
    'services/demoSpotAccess': '5b80fc3e73eeef6b6e336441d425c9bbff987217',
    'services/OrderService': '4ac8a45eeeb19ed6cd4677021d677134c438674f',
}
runtime = list(merged)

def git(*args):
    return subprocess.check_output(['git', *args], cwd=root)

assert not git('status', '--porcelain', '--untracked-files=no').strip(), 'Commit reviewed source before packaging'
sha = git('rev-parse', 'HEAD').decode().strip()
for name, source in merged.items():
    assert git('show', sha + ':src/' + name + '.ts') == git('show', source + ':src/' + name + '.ts'), 'Merged source mismatch ' + name
changed = git('diff', '--name-only', live, sha, '--', 'src').decode().splitlines()
allowed = {'src/' + name + '.ts' for name in runtime}
assert all(p in allowed or '/__tests__/' in p for p in changed), 'Unapproved runtime module changed: ' + repr([p for p in changed if p not in allowed and '/__tests__/' not in p])
protected = ['prisma', 'package.json', 'package-lock.json', 'src/index.ts', 'src/buildCommit.ts', 'src/futures',
             'src/private-trading', 'src/services/listings', 'src/services/testMarkets', 'config', 'frontend', 'workers']
# Test files are not runtime and never enter the overlay.
subprocess.run(['git', 'diff', '--exit-code', '--quiet', live, sha, '--', *protected, ':(exclude)**/__tests__/**'], cwd=root, check=True)
node = os.environ.get('NODE', 'node')
subprocess.run([node, 'node_modules/typescript/bin/tsc', '--pretty', 'false'], cwd=root, check=True)

recipe = (root / 'release/api-p0-hotfix/Dockerfile').read_bytes()
copy_lines = [l for l in recipe.decode('utf-8').splitlines() if l.startswith('COPY ')]
expected = ['COPY --chown=1000:1000 --chmod=0644 overlay/' + n + e + ' /app/dist/' + n + e for n in runtime for e in ['.js', '.js.map']]
assert copy_lines == expected, 'Dockerfile COPY lines must be exactly the five modules (UID1000, 0644)'

out = root / 'output' / 'api-p0-hotfix'
out.mkdir(parents=True, exist_ok=True)
archive = out / ('api-p0-hotfix-' + sha + '.tar')
manifest = {'liveApi': live, 'releaseSha': sha, 'mergedSources': merged, 'migrationFilesIncluded': 0,
            'protectedSourceUnchanged': True, 'flags': {'DEMO_SPOT_ENABLED': 'false', 'DEMO_LIQUIDITY_ENABLED': 'false',
            'DEMO_WITHDRAWAL_GUARD_ENABLED': 'false', 'SIMULATION_SPOT_DEMO_SETTLEMENT_ENABLED': 'false'}, 'files': []}
with tarfile.open(archive, 'w', format=tarfile.PAX_FORMAT) as tar:
    info = tarfile.TarInfo('Dockerfile'); info.size = len(recipe); info.mode = 0o644; info.mtime = 0
    tar.addfile(info, io.BytesIO(recipe))
    for directory in ['overlay', 'overlay/api', 'overlay/api/routes', 'overlay/services']:
        info = tarfile.TarInfo(directory + '/'); info.type = tarfile.DIRTYPE; info.mode = 0o755; info.uid = info.gid = 1000; info.mtime = 0
        tar.addfile(info)
    for name in runtime:
        for ext in ['.js', '.js.map']:
            payload = (root / 'dist' / (name + ext)).read_bytes()
            target = 'overlay/' + name + ext
            info = tarfile.TarInfo(target); info.size = len(payload); info.mode = 0o644; info.uid = info.gid = 1000; info.mtime = 0
            tar.addfile(info, io.BytesIO(payload))
            manifest['files'].append({'path': target, 'sha256': hashlib.sha256(payload).hexdigest(), 'bytes': len(payload)})
manifest['archive'] = archive.name
manifest['archiveSha256'] = hashlib.sha256(archive.read_bytes()).hexdigest()
(out / 'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
print(json.dumps({k: manifest[k] for k in ['releaseSha', 'archive', 'archiveSha256', 'migrationFilesIncluded']}))
