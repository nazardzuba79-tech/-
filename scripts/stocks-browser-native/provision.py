"""Disposable CI only: authenticate and extract into a NEW root-owned prefix.

No apt installation, maintainer/lifecycle scripts, browser execution, policy change,
old installation chmod, or privileged Node/npm. Invoke with isolated Python (-I).
"""
import argparse
import base64
from contextlib import contextmanager
import email.utils
import gzip
import hashlib
import io
import json
import os
import pathlib
import re
import shutil
import signal
import stat
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent.parent
MANIFEST_BYTES = (HERE / 'manifest.json').read_bytes()
M = json.loads(MANIFEST_BYTES)
DEB_SHA256 = 'b7726070ca707965e9a17b38e4f15ba283bf6f65c339626c092862af7b19badc'
PREFIX = pathlib.Path('/usr/lib/voltex-stocks-browser-' + DEB_SHA256)
ENV = {'PATH': '/usr/bin:/bin', 'LANG': 'C', 'LC_ALL': 'C'}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def command(argv, *, data=None, cwd=None, timeout=30, max_bytes=1048576):
    # Output is kept in a private root file, bounded before it is read into memory.
    import tempfile
    with tempfile.TemporaryFile() as out, tempfile.TemporaryFile() as err:
        result = subprocess.run(argv, input=data, stdout=out, stderr=err, env=ENV,
                                cwd=cwd, timeout=timeout, check=False)
        require(out.tell() <= max_bytes and err.tell() <= 65536, 'bounded command output exceeded')
        out.seek(0)
        err.seek(0)
        output, error = out.read(), err.read()
        require(result.returncode == 0, 'command failed: ' + argv[0] + ': ' + error.decode(errors='replace')[-2048:])
        return output


def protected(target, regular=True):
    target = pathlib.Path(target)
    require(target.is_absolute() and target.resolve(strict=True) == target, 'protected path symlink/relative path')
    for item in [target, *target.parents]:
        value = item.lstat()
        require(value.st_uid == 0 and not value.st_mode & 0o022, 'root-owned non-writable ancestry required: ' + str(item))
        require(not stat.S_ISLNK(value.st_mode), 'protected path symlink')
        require(stat.S_ISREG(value.st_mode) if item == target and regular else stat.S_ISDIR(value.st_mode), 'protected path type')


def tool_proof(requested):
    resolved = pathlib.Path(requested).resolve(strict=True)
    protected(resolved)
    value = resolved.stat()
    require(value.st_size <= 64 * 1024 * 1024, 'bounded system tool')
    return {'requested': requested, 'resolved': str(resolved), 'sha256': digest(resolved.read_bytes()), 'bytes': value.st_size, 'mode': stat.S_IMODE(value.st_mode)}


def gpg_socket_bounds(home):
    """Linux sockaddr_un.sun_path includes the terminating NUL in its 108 bytes."""
    value = pathlib.PurePosixPath(home).as_posix()
    require(value == home and value.startswith('/') and '..' not in pathlib.PurePosixPath(value).parts and '\\' not in value and '\0' not in value, 'canonical absolute GNUPGHOME required')
    sizes = {suffix: len((value + '/' + suffix).encode('utf-8')) + 1
             for suffix in ['S.gpg-agent', 'S.gpg-agent.extra', 'S.gpg-agent.browser', 'S.gpg-agent.ssh']}
    require(all(size <= 108 for size in sizes.values()), 'GNUPGHOME exceeds Linux Unix-socket pathname bound')
    return sizes


def gpg_scratch_observation(directory):
    protected(directory, regular=False)  # Includes every real ancestor, /run and /.
    value = directory.lstat()
    return {'path': str(directory), 'resolved': str(directory.resolve(strict=True)),
            'uid': value.st_uid, 'gid': value.st_gid, 'mode': stat.S_IMODE(value.st_mode),
            'directory': stat.S_ISDIR(value.st_mode), 'symlink': stat.S_ISLNK(value.st_mode),
            'ino': value.st_ino, 'dev': value.st_dev}


def validate_gpg_scratch(actual, expected):
    require(re.fullmatch(r'/run/vsg-[A-Za-z0-9_-]{6,16}', expected['path']), 'fixed short GPG scratch parent/name required')
    require(actual['path'] == actual['resolved'] == expected['path'], 'GPG scratch path identity changed')
    require(actual['uid'] == actual['gid'] == 0 and actual['mode'] == 0o700, 'GPG scratch must be root-owned 0700')
    require(actual['directory'] and not actual['symlink'], 'GPG scratch type changed')
    require(actual['ino'] == expected['ino'] and actual['dev'] == expected['dev'], 'GPG scratch inode/device changed')


@contextmanager
def temporary_gpg_homes(cleanup_proof):
    """No GC finalizer: cleanup always validates this process's exact allocation."""
    protected(pathlib.Path('/run'), regular=False)
    directory, expected = None, None
    try:
        directory = pathlib.Path(tempfile.mkdtemp(prefix='vsg-', dir='/run'))
        initial = gpg_scratch_observation(directory)
        expected = {key: initial[key] for key in ['path', 'ino', 'dev']}
        validate_gpg_scratch(initial, expected)
        homes = [directory / name for name in ['i', 't']]
        socket_sizes = []
        for home in homes:
            socket_sizes.extend(gpg_socket_bounds(home.as_posix()).values())
            home.mkdir(mode=0o700)
            protected(home, regular=False)
            require(stat.S_IMODE(home.lstat().st_mode) == 0o700, 'private GNUPGHOME mode')
        cleanup_proof.update({'status': 'PENDING', 'homes': 2, 'rootOwned': True, 'mode': '0700',
                              'maximumSocketBytesIncludingNul': max(socket_sizes), 'publicKeysOnly': True})
        yield homes
    finally:
        if directory is not None:
            try:
                require(expected is not None, 'GPG scratch ownership was not established')
                validate_gpg_scratch(gpg_scratch_observation(directory), expected)
                require(shutil.rmtree.avoids_symlink_attacks, 'symlink-safe GPG cleanup unavailable')
                shutil.rmtree(directory)
                require(not directory.exists(), 'GPG scratch cleanup incomplete')
                cleanup_proof['status'] = 'PASS'
            except BaseException as error:
                cleanup_proof.update({'status': 'FAIL', 'reason': str(error)})
                raise RuntimeError('owned GPG temporary-directory cleanup FAIL: ' + str(error)) from error


@contextmanager
def provision_signals():
    def stop(signum, _frame):
        raise RuntimeError('provision interrupted by signal ' + str(signum))
    previous = {}
    try:
        for signum in [signal.SIGTERM, signal.SIGINT]:
            previous[signum] = signal.getsignal(signum)
            signal.signal(signum, stop)
        yield
    finally:
        for signum, handler in previous.items():
            signal.signal(signum, handler)


def source_files(source_sha):
    require(re.fullmatch('[a-f0-9]{40}', source_sha), 'exact source SHA required')
    # cat-file does not invoke checkout filters. Compare actual source to commit
    # blobs, including assume-unchanged/skip-worktree paths; status is not proof.
    git = ['/usr/bin/git', '--no-replace-objects', '-c', 'safe.directory=' + str(ROOT), '-C', str(ROOT)]
    require(command(git + ['rev-parse', 'HEAD']).decode().strip() == source_sha, 'source HEAD mismatch')
    paths = command(git + ['ls-tree', '-r', '--name-only', source_sha, '--', 'scripts/stocks-browser-native']).decode().splitlines()
    paths += ['scripts/qa-stocks-public-nss.cjs', 'scripts/qa-stocks-browser-launch.cjs', 'scripts/qa-stocks-chrome-preflight.cjs']
    require('scripts/stocks-browser-native/provision.py' in paths, 'native sources must be committed before provisioning')
    rows, blobs = [], {}
    for name in sorted(set(paths)):
        require(re.fullmatch(r'scripts/[A-Za-z0-9_./-]+', name) and '..' not in pathlib.PurePosixPath(name).parts, 'source path')
        blob = command(git + ['cat-file', 'blob', source_sha + ':' + name], max_bytes=4 * 1024 * 1024)
        target = ROOT / name
        require(target.is_file() and not target.is_symlink() and target.read_bytes() == blob, 'source differs from exact Git blob: ' + name)
        rows.append({'path': name, 'sha256': digest(blob), 'bytes': len(blob)})
        blobs[name] = blob
    require(blobs['scripts/stocks-browser-native/manifest.json'] == MANIFEST_BYTES, 'captured manifest differs from exact source')
    require(M['prefix'] == str(PREFIX) and M['chrome']['sha256'] == DEB_SHA256, 'fixed reviewed package/prefix mismatch')
    return rows, blobs


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('download redirect prohibited')


def download(url, destination, maximum, expected_sha=None, expected_size=None, integrity=None):
    require(url.startswith(('https://dl.google.com/', 'https://registry.npmjs.org/')), 'unreviewed public source')
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    sha256, sha512, total, deadline = hashlib.sha256(), hashlib.sha512(), 0, time.monotonic() + 180
    with opener.open(url, timeout=30) as response, destination.open('xb') as output:
        require(response.status == 200 and response.url == url, 'unexpected download response')
        while True:
            require(time.monotonic() < deadline, 'download deadline exceeded')
            block = response.read(131072)
            if not block:
                break
            total += len(block)
            require(total <= maximum, 'download size bound')
            sha256.update(block)
            sha512.update(block)
            output.write(block)
    if expected_size is not None:
        require(total == expected_size, 'download exact size mismatch')
    if expected_sha is not None:
        require(sha256.hexdigest() == expected_sha, 'download exact SHA256 mismatch')
    if integrity is not None:
        require(integrity == 'sha512-' + base64.b64encode(sha512.digest()).decode(), 'npm lock integrity mismatch')
    os.chmod(destination, 0o644)  # Newly created file only.
    return {'sha256': sha256.hexdigest(), 'bytes': total}


def pinned_metadata(source_blobs):
    """Exact original public snapshot, captured from the already admitted Git SHA."""
    result = {}
    for name, key in [('google-key.asc', 'key'), ('InRelease', 'inRelease'), ('Packages.gz', 'packages')]:
        raw = source_blobs.get('scripts/stocks-browser-native/metadata/' + name)
        require(isinstance(raw, bytes), 'committed public metadata absent: ' + name)
        require(len(raw) == M[key]['bytes'] and digest(raw) == M[key]['sha256'], 'committed public metadata pin mismatch: ' + name)
        result[name] = raw
    return result


def stage_metadata(verification, snapshots):
    # Preserve the live-key update/revocation admission: a changed official key
    # fails its original pin; a stored key alone cannot silently replace it.
    pin = M['key']
    key_file = verification / 'google-key.asc'
    download(pin['url'], key_file, pin['bytes'], pin['sha256'], pin['bytes'])
    require(key_file.read_bytes() == snapshots['google-key.asc'], 'fresh official key differs from committed public key')
    # Release/index URLs are mutable. Their original signed bytes are versioned
    # source, then verified by the unchanged GPG + expiry/72h chain below.
    for name in ['InRelease', 'Packages.gz']:
        with (verification / name).open('xb') as output:
            output.write(snapshots[name])


def field(text, name):
    rows = [line[len(name) + 1:].strip() for line in text.splitlines() if line.startswith(name + ':')]
    require(len(rows) == 1, 'unique metadata field: ' + name)
    return rows[0]


def signing_proof(status, listing, now):
    rows = [line.split() for line in status.splitlines() if line]
    bad = {'BADSIG', 'ERRSIG', 'NO_PUBKEY', 'EXPSIG', 'EXPKEYSIG', 'REVKEYSIG', 'KEYEXPIRED', 'SIGEXPIRED', 'FAILURE', 'ERROR', 'NODATA'}
    require(all(len(row) > 1 and row[0] == '[GNUPG:]' and row[1] not in bad for row in rows), 'GPG rejected signature')
    valid = [row for row in rows if row[1] == 'VALIDSIG']
    require(len(valid) == 1, 'one valid GPG signature required')
    row = valid[0]
    signer, created, expires = row[2], int(row[4]) * 1000, int(row[5]) * 1000
    require(re.fullmatch('[A-F0-9]{40}', signer) and (signer == M['googlePrimaryFingerprint'] or row[-1] == M['googlePrimaryFingerprint']), 'pinned Google signing primary required')
    require(row[9] in ['8', '9', '10', '11'], 'weak signature digest')
    require(0 < created <= now + M['metadataFutureToleranceMs'] and now - created <= M['metadataMaximumAgeMs'], 'signature timestamp')
    require(expires == 0 or expires > now, 'signature expired')
    entries, current = [], None
    for line in listing.splitlines():
        parts = line.split(':')
        if parts[0] in ['pub', 'sub']:
            current = {'type': parts[0], 'validity': parts[1], 'created': int(parts[5] or '0') * 1000, 'expires': int(parts[6] or '0') * 1000}
            entries.append(current)
        elif parts[0] == 'fpr' and current is not None and 'fingerprint' not in current:
            current['fingerprint'] = parts[9]
    primaries = [entry for entry in entries if entry['type'] == 'pub']
    keys = [entry for entry in entries if entry.get('fingerprint') == signer]
    require(len(primaries) == 1 and primaries[0].get('fingerprint') == M['googlePrimaryFingerprint'] and len(keys) == 1, 'exact imported signing key required')
    for entry in [primaries[0], keys[0]]:
        require(entry['validity'] not in ['r', 'e', 'd', 'i'], 'invalid/revoked/expired key')
        require(0 < entry['created'] <= now + M['metadataFutureToleranceMs'] and (entry['expires'] == 0 or entry['expires'] > now), 'key validity window')
    return {'primary': M['googlePrimaryFingerprint'], 'signer': signer, 'created': created, 'expires': expires}


def release_proof(text, packages, now):
    require(field(text, 'Origin') == 'Google LLC' and field(text, 'Suite') == 'stable' and field(text, 'Codename') == 'stable', 'Release identity')
    date = int(email.utils.parsedate_to_datetime(field(text, 'Date')).timestamp() * 1000)
    require(date <= now + M['metadataFutureToleranceMs'] and now - date <= M['metadataMaximumAgeMs'], 'Release timestamp')
    if re.search('^Valid-Until:', text, re.M):
        require(email.utils.parsedate_to_datetime(field(text, 'Valid-Until')).timestamp() * 1000 > now, 'Release expired')
    sections = re.split(r'^SHA256:\s*$', text, flags=re.M)
    require(len(sections) == 2, 'one Release SHA256 section')
    matches = []
    for line in sections[1].splitlines()[1:]:
        if line and not line[0].isspace():
            break
        row = re.fullmatch(r'\s+([a-f0-9]{64})\s+(\d+)\s+(\S+)\s*', line)
        if row and row[3] == M['packages']['path']:
            matches.append(row)
    require(len(matches) == 1 and matches[0][1] == M['packages']['sha256'] and int(matches[0][2]) == M['packages']['bytes'], 'Packages must match signed Release')
    with gzip.GzipFile(fileobj=io.BytesIO(packages)) as stream:
        raw = stream.read(1048577)
    require(len(raw) <= 1048576, 'bounded Packages metadata')
    entries = [entry for entry in re.split(r'\n\n+', raw.decode()) if re.search('^Package: google-chrome-stable$', entry, re.M)]
    require(len(entries) == 1, 'unique Google Chrome package')
    for key, expected in {'Package': M['chrome']['name'], 'Version': M['chrome']['version'], 'Architecture': 'amd64', 'Filename': M['chrome']['filename'], 'SHA256': M['chrome']['sha256'], 'Size': str(M['chrome']['bytes'])}.items():
        require(field(entries[0], key) == expected, 'authenticated package field mismatch: ' + key)
    return {'date': date, 'packagesSha256': M['packages']['sha256'], 'packagesBytes': M['packages']['bytes']}


def dependencies(deb):
    controls = {}
    for name in ['Package', 'Version', 'Architecture', 'Depends', 'Pre-Depends']:
        controls[name] = command(['/usr/bin/dpkg-deb', '-f', str(deb), name]).decode().strip()
    require(controls['Package'] == M['chrome']['name'] and controls['Version'] == M['chrome']['version'] and controls['Architecture'] == 'amd64', 'signed deb control identity')
    accepted = []
    for group in (controls['Pre-Depends'] + ',' + controls['Depends']).split(','):
        if not group.strip():
            continue
        found = None
        for alternative in group.split('|'):
            match = re.fullmatch(r'\s*([a-z0-9][a-z0-9+.-]*)(?::(?:any|amd64))?\s*(?:\((>=|<=|=|>>|<<)\s*([^()\s]+)\))?\s*', alternative)
            require(match is not None, 'unsupported dependency expression: ' + alternative)
            name, operator, minimum = match.groups()
            try:
                state = command(['/usr/bin/dpkg-query', '-W', '-f=${db:Status-Status}\t${Version}', name]).decode().split('\t')
                require(len(state) == 2 and state[0] == 'installed', 'dependency not installed')
                if operator:
                    command(['/usr/bin/dpkg', '--compare-versions', state[1], operator, minimum])
                found = {'name': name, 'version': state[1], 'requirement': alternative.strip()}
                break
            except ValueError:
                continue
        require(found is not None, 'DEPENDENCY_MISSING: ' + group.strip())
        accepted.append(found)
    return accepted


def extract_npm(archive, destination):
    destination.mkdir(mode=0o755)
    count, total, seen = 0, 0, set()
    with tarfile.open(archive, mode='r:gz') as tar:
        for member in tar:
            require(member.name.startswith('package/'), 'npm package root')
            relative = pathlib.PurePosixPath(member.name[8:])
            require(not relative.is_absolute() and '..' not in relative.parts, 'unsafe npm path')
            if str(relative) == '.':
                require(member.isdir(), 'npm root type')
                continue
            name = str(relative)
            require(name not in seen, 'duplicate npm member')
            seen.add(name)
            count += 1
            require(count <= 20000, 'npm member bound')
            target = destination / relative
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True, mode=0o755)
                continue
            require(member.isfile() and not member.issym() and not member.islnk(), 'npm links/special files prohibited')
            total += member.size
            require(0 <= member.size <= 64 * 1024 * 1024 and total <= 256 * 1024 * 1024, 'npm extraction byte bound')
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
            with tar.extractfile(member) as source, target.open('xb') as output:
                shutil.copyfileobj(source, output, 131072)
            require(target.stat().st_size == member.size, 'npm extracted size')
            os.chmod(target, 0o755 if member.mode & 0o111 else 0o644)


def inventory(directory, relative_to):
    rows, total = [], 0
    for item in sorted(directory.rglob('*')):
        value = item.lstat()
        require(not stat.S_ISLNK(value.st_mode) and value.st_uid == 0 and not value.st_mode & 0o022, 'payload path permissions/type')
        if item.is_dir():
            continue
        require(item.is_file() and value.st_size <= 1024 * 1024 * 1024, 'payload file bound/type')
        total += value.st_size
        require(len(rows) < 20000 and total <= 3 * 1024 * 1024 * 1024, 'payload inventory bound')
        h = hashlib.sha256()
        with item.open('rb') as stream:
            for block in iter(lambda: stream.read(131072), b''):
                h.update(block)
        rows.append({'path': item.relative_to(relative_to).as_posix(), 'sha256': h.hexdigest(), 'bytes': value.st_size, 'mode': stat.S_IMODE(value.st_mode)})
    return rows


def owned_executable(value):
    return value == str(PREFIX) or value.startswith(str(PREFIX) + '/')


def no_owned_processes():
    deadline, examined, active = time.monotonic() + 3, 0, []
    for entry in pathlib.Path('/proc').iterdir():
        if not entry.name.isdigit():
            continue
        examined += 1
        require(examined <= 20000 and time.monotonic() < deadline, 'bounded process cleanup proof exceeded')
        try:
            executable = os.readlink(entry / 'exe')
        except FileNotFoundError:
            continue  # Exited process or a kernel thread without a userspace exe.
        except ProcessLookupError:
            continue
        except OSError as error:
            raise ValueError('process cleanup proof unavailable: ' + str(error.errno)) from error
        if owned_executable(executable):
            active.append(int(entry.name))
    require(not active, 'owned Chrome process still running; no broad kill: ' + ','.join(map(str, active[:32])))


def cleanup(source_sha, run_id, source_verified=False):
    if not source_verified:
        source_files(source_sha)  # Authenticate captured prefix/manifest before privileged cleanup.
    no_owned_processes()
    require(not PREFIX.is_symlink(), 'owned prefix must not be a symlink')
    if not PREFIX.exists():
        return {'status': 'ABSENT'}
    protected(PREFIX, regular=False)
    marker = PREFIX / 'owned-install.json'
    protected(marker)
    value = json.loads(marker.read_text())
    st = PREFIX.stat()
    require(value == {'sourceSha': source_sha, 'runId': run_id, 'prefix': str(PREFIX), 'ino': st.st_ino, 'dev': st.st_dev}, 'cleanup ownership identity mismatch')
    require(shutil.rmtree.avoids_symlink_attacks, 'symlink-safe recursive cleanup unavailable')
    shutil.rmtree(PREFIX)
    require(not PREFIX.exists(), 'native cleanup incomplete')
    no_owned_processes()
    return {'status': 'REMOVED_OWNED_PREFIX'}


def provision(source_sha, run_id):
    require(sys.platform == 'linux' and os.uname().machine == 'x86_64' and os.getuid() == os.geteuid() == 0, 'root linux/amd64 provisioner only')
    require(sys.flags.isolated, 'isolated Python -I required')
    require(re.fullmatch(r'\d+-\d+', run_id), 'exact CI run/attempt identity')
    require(pathlib.Path('/etc/os-release').read_text().find('VERSION_ID="22.04"') >= 0, 'Ubuntu22.04 only')
    interpreter = pathlib.Path('/usr/bin/python3').resolve(strict=True)
    protected(interpreter)
    require(pathlib.Path(sys.executable).resolve() == interpreter, 'official system interpreter required')
    tools = [tool_proof(tool) for tool in ['/usr/bin/python3', '/usr/bin/git', '/usr/bin/gpg', '/usr/bin/dpkg-deb', '/usr/bin/dpkg-query', '/usr/bin/dpkg']]
    sources, source_blobs = source_files(source_sha)
    snapshots = pinned_metadata(source_blobs)
    protected(PREFIX.parent, regular=False)
    require(not PREFIX.exists() and not PREFIX.is_symlink(), 'fresh native installation prefix required')
    os.umask(0o022)
    PREFIX.mkdir(mode=0o755)
    st = PREFIX.stat()
    (PREFIX / 'owned-install.json').write_text(json.dumps({'sourceSha': source_sha, 'runId': run_id, 'prefix': str(PREFIX), 'ino': st.st_ino, 'dev': st.st_dev}) + '\n')
    try:
        verification = PREFIX / 'verification'
        verification.mkdir(mode=0o755)
        stage_metadata(verification, snapshots)
        gpg_cleanup = {'status': 'NOT_CREATED'}
        with temporary_gpg_homes(gpg_cleanup) as (import_home, trusted_home):
            original = ['/usr/bin/gpg', '--batch', '--no-options', '--homedir', str(import_home), '--no-auto-key-retrieve', '--no-autostart']
            command(original + ['--import', str(verification / 'google-key.asc')])
            exported = command(original + ['--export', M['googlePrimaryFingerprint']])
            trusted = ['/usr/bin/gpg', '--batch', '--no-options', '--homedir', str(trusted_home), '--no-auto-key-retrieve', '--no-autostart']
            command(trusted + ['--import'], data=exported)
            listing = command(trusted + ['--with-colons', '--fingerprint', '--fingerprint', '--list-keys']).decode()
            status = command(trusted + ['--status-fd', '1', '--output', str(verification / 'Release'), '--decrypt', str(verification / 'InRelease')]).decode()
            signature = signing_proof(status, listing, int(time.time() * 1000))
            release = release_proof((verification / 'Release').read_text(), (verification / 'Packages.gz').read_bytes(), int(time.time() * 1000))
            os.chmod(verification / 'Release', 0o644)  # New authenticated plaintext output only.
            (verification / 'gpg-status.txt').write_text(status)
            (verification / 'key-listing.txt').write_text(listing)
        require(gpg_cleanup['status'] == 'PASS', 'GPG temporary-directory cleanup must pass')
        (verification / 'gpg-scratch-cleanup.json').write_text(json.dumps(gpg_cleanup) + '\n')
        deb = verification / 'google-chrome.deb'
        pin = M['chrome']
        download('https://dl.google.com/linux/chrome/deb/' + pin['filename'], deb, pin['bytes'], pin['sha256'], pin['bytes'])
        deps = dependencies(deb)
        (PREFIX / 'chrome').mkdir(mode=0o755)
        extraction_source = source_blobs['scripts/stocks-browser-native/extract.py']
        command([str(interpreter), '-I', '-c', extraction_source.decode(), str(deb), str(PREFIX / 'chrome')], timeout=120, max_bytes=4 * 1024 * 1024)
        playwright = PREFIX / 'playwright'
        (playwright / 'node_modules').mkdir(parents=True, mode=0o755)
        for filename, pin_key in [('package.json', 'playwrightPackage'), ('package-lock.json', 'playwrightLock')]:
            raw = source_blobs['scripts/stocks-browser-native/playwright/' + filename]
            require(digest(raw) == M[pin_key]['sha256'] and len(raw) == M[pin_key]['bytes'], 'Playwright source lock changed')
            (playwright / filename).write_bytes(raw)
        lock = json.loads((playwright / 'package-lock.json').read_text())
        npm_archives = []
        for name in ['playwright', 'playwright-core']:
            entry = lock['packages']['node_modules/' + name]
            require(entry['version'] == M['playwrightVersion'] and entry['resolved'] == 'https://registry.npmjs.org/' + name + '/-/' + name + '-' + M['playwrightVersion'] + '.tgz', 'exact Playwright archive required')
            archive = verification / (name + '.tgz')
            record = download(entry['resolved'], archive, 32 * 1024 * 1024, integrity=entry['integrity'])
            npm_archives.append({'path': 'verification/' + archive.name, 'integrity': entry['integrity'], **record})
            extract_npm(archive, playwright / 'node_modules' / name)
            require(json.loads((playwright / 'node_modules' / name / 'package.json').read_text())['version'] == M['playwrightVersion'], 'extracted Playwright version')
        (verification / 'manifest.json').write_bytes(MANIFEST_BYTES)
        require(source_files(source_sha)[0] == sources, 'source mutation during provisioning')
        files = inventory(PREFIX / 'chrome', PREFIX) + inventory(playwright, PREFIX)
        proof = {'schema': 1, 'status': 'PASS_AUTHENTICATED_EXTRACTION', 'prefix': str(PREFIX), 'executable': str(PREFIX / 'chrome/chrome'),
                 'package': pin, 'playwrightVersion': M['playwrightVersion'], 'sourceSha': source_sha, 'runId': run_id,
                 'manifestSha256': digest(MANIFEST_BYTES), 'sourceFiles': sources, 'signature': signature, 'release': release,
                 'dependencies': deps, 'tools': tools, 'gpgScratchCleanup': gpg_cleanup, 'npmArchives': npm_archives, 'files': files,
                 'limitations': ['Existing distro dependencies verified by package versions; runtime loader and actual renderer sandbox remain qualification gates.', 'No claim of kernel-level network egress isolation on the native VM.']}
        (PREFIX / 'installation.json').write_text(json.dumps(proof, indent=2) + '\n')
        return {'status': proof['status'], 'prefix': str(PREFIX), 'sourceSha': source_sha, 'runId': run_id, 'payloadFiles': len(files), 'browserExecuted': False, 'hostPolicyChanged': False}
    except BaseException as error:
        try:
            result = cleanup(source_sha, run_id, source_verified=True)
        except BaseException as cleanup_error:
            raise RuntimeError('native provisioning failed; owned-prefix cleanup FAIL: ' + str(cleanup_error)) from error
        raise RuntimeError('native provisioning failed; cleanup ' + result['status'] + ': ' + str(error)) from error


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source-sha', required=True)
    parser.add_argument('--run-id', required=True)
    parser.add_argument('--cleanup', action='store_true')
    args = parser.parse_args()
    require(re.fullmatch('[a-f0-9]{40}', args.source_sha) and re.fullmatch(r'\d+-\d+', args.run_id), 'exact cleanup/provision identity')
    require(os.getuid() == os.geteuid() == 0 and sys.flags.isolated, 'root isolated interpreter required')
    with provision_signals():
        print(json.dumps(cleanup(args.source_sha, args.run_id) if args.cleanup else provision(args.source_sha, args.run_id)))


if __name__ == '__main__':
    main()
