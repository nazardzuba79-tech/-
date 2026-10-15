"""Extract only the authenticated Chrome payload into a new root-owned prefix.
No package scripts, symlinks, capabilities or setuid/setgid modes are installed.
"""
import hashlib, json, os, pathlib, subprocess, sys, tarfile

archive, destination = sys.argv[1:]
assert os.geteuid() == 0 and pathlib.Path(destination).is_dir()
assert not list(pathlib.Path(destination).iterdir())
process = subprocess.Popen(['/usr/bin/dpkg-deb', '--fsys-tarfile', archive], stdout=subprocess.PIPE, stderr=sys.stderr)
total = 0
files = []
seen = set()
try:
    with tarfile.open(fileobj=process.stdout, mode='r|') as stream:
        for member in stream:
            name = member.name.removeprefix('./')
            assert not name.startswith('/') and '..' not in pathlib.PurePosixPath(name).parts
            if not name.startswith('opt/google/chrome/'):
                continue
            relative = name[len('opt/google/chrome/'):]
            if not relative:
                continue
            assert relative not in seen and len(seen) < 20000
            seen.add(relative)
            target = pathlib.Path(destination, relative)
            assert target.is_relative_to(destination)
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True, mode=0o755)
                continue
            assert member.isfile(), 'Unreviewed Chrome payload type: ' + relative
            assert 0 <= member.size <= 1024 * 1024 * 1024
            total += member.size
            assert total <= 2 * 1024 * 1024 * 1024
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
            digest = hashlib.sha256()
            source = stream.extractfile(member)
            count = 0
            with target.open('xb') as output:
                while True:
                    block = source.read(128 * 1024)
                    if not block:
                        break
                    count += len(block)
                    assert count <= member.size
                    digest.update(block)
                    output.write(block)
            assert count == member.size
            mode = 0o755 if member.mode & 0o111 else 0o644
            os.chmod(target, mode)  # Only a newly extracted file; never existing host Chrome.
            files.append({'path': 'chrome/' + relative, 'sha256': digest.hexdigest(), 'bytes': count, 'mode': mode})
    assert process.wait(timeout=30) == 0
    assert any(row['path'] == 'chrome/chrome' for row in files)
    print(json.dumps(files))
finally:
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=3)
