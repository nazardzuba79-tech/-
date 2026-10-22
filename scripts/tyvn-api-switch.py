#!/usr/bin/env python3
"""TYVN (27 Oct 2026): prepare and check an API-only Compose switch. READ ONLY.

Nothing here starts, stops, recreates, pulls or builds anything, and nothing
touches PostgreSQL. It writes one small overlay file (no secrets) and checks it:

  overlay  --release-dir DIR --image sha256:<id> --sha <40-hex>
           Writes DIR/compose.tyvn-api.yaml: api-production.image and
           api-production.environment.VOLTEX_RELEASE_SHA, nothing else.

  check    --overlay FILE --sha <40-hex> [--profile cutover]
           Finds the ONE running api-production container, reads its Compose
           project, working dir, config files and env files from its labels,
           renders the effective config twice in memory (the running set, and
           the running set + overlay) and requires that exactly those two keys
           differ. Only key paths are printed — never a value, except the image
           reference and the release SHA, which are not secret. Then checks the
           new image (exists, revision label and VOLTEX_RELEASE_SHA == --sha,
           differs from the running image), that the new image runs exactly like
           the old one (user, entrypoint, command, working dir, ports, volumes,
           every ENV value and label except the release SHA / revision — only the
           names of differing fields are printed), and the rollback (the running
           image still exists; the running config's image resolves to it). Prints
           the switch and rollback commands; does not run them.

  --compose-files/--project/--project-dir/--env-file, --running-image and
  --no-docker replace the container discovery and the image checks for an
  offline self-test only (scripts/tyvn-api-switch-selftest.sh).

Exit 0 = READY TO SWITCH (still needs the owner's separate approval), 2 = BLOCKED.
"""
import argparse
import json
import os
import re
import shlex
import subprocess
import sys

SERVICE = 'api-production'
ALLOWED = {f'services.{SERVICE}.image', f'services.{SERVICE}.environment.VOLTEX_RELEASE_SHA'}
SHA = re.compile(r'^[0-9a-f]{40}$')
IMAGE_ID = re.compile(r'^sha256:[0-9a-f]{64}$')


def blocked(message):
    print(f'BLOCKED: {message}')
    sys.exit(2)


def run(cmd):
    """Runs a read-only command; its output stays in memory and is never printed on failure."""
    done = subprocess.run(cmd, capture_output=True, text=True)
    if done.returncode != 0:
        blocked(f'`{cmd[0]} {cmd[1]}` failed (exit {done.returncode}); run it by hand to see why — its output may hold secrets')
    return done.stdout


def flatten(value, prefix=''):
    if isinstance(value, dict):
        out = {}
        for key, item in value.items():
            out.update(flatten(item, f'{prefix}.{key}' if prefix else str(key)))
        return out
    if isinstance(value, list):
        out = {}
        for index, item in enumerate(value):
            out.update(flatten(item, f'{prefix}[{index}]'))
        return out or {prefix: []}
    return {prefix: value}


def changed_paths(before, after):
    a, b = flatten(before), flatten(after)
    return sorted(path for path in set(a) | set(b) if a.get(path, object()) != b.get(path, object()))


def compose_cmd(project, project_dir, files, env_files, profile):
    cmd = ['docker', 'compose', '-p', project, '--project-directory', project_dir]
    for env_file in env_files:
        cmd += ['--env-file', env_file]
    for file in files:
        cmd += ['-f', file]
    if profile:
        cmd += ['--profile', profile]
    return cmd


def write_overlay(args):
    if not SHA.fullmatch(args.sha):
        blocked('--sha must be the exact 40-hex reviewed commit')
    if not IMAGE_ID.fullmatch(args.image):
        blocked('--image must be the immutable image ID, sha256:<64 hex>, from `docker image inspect`')
    os.makedirs(args.release_dir, exist_ok=True)
    path = os.path.join(args.release_dir, 'compose.tyvn-api.yaml')
    if os.path.exists(path):
        blocked(f'{path} already exists; use a new release directory')
    with open(path, 'x', encoding='utf-8') as handle:
        handle.write(
            '# TYVN API-only switch overlay. Exactly two keys; every other setting comes from the running set.\n'
            f'services:\n  {SERVICE}:\n    image: {args.image}\n'
            f'    environment:\n      VOLTEX_RELEASE_SHA: "{args.sha}"\n')
    print(f'Wrote {path}')


def discover(args):
    if args.compose_files:
        return args.project, args.project_dir, args.compose_files.split(','), (args.env_file or []), args.running_image
    ids = run(['docker', 'ps', '-q', '--filter', f'label=com.docker.compose.service={SERVICE}']).split()
    if len(ids) != 1:
        blocked(f'expected exactly one running {SERVICE} container, got {len(ids)}')
    info = json.loads(run(['docker', 'inspect', ids[0]]))[0]
    labels = info['Config']['Labels']
    files = labels.get('com.docker.compose.project.config_files', '')
    if not files:
        blocked('the running container carries no Compose config_files label')
    env_files = [f for f in labels.get('com.docker.compose.project.environment_file', '').split(',') if f]
    return (labels['com.docker.compose.project'], labels['com.docker.compose.project.working_dir'],
            files.split(','), env_files, info['Image'])


RELEASE_ONLY = {'env': 'VOLTEX_RELEASE_SHA', 'labels': 'org.opencontainers.image.revision'}


def image_facts(reference):
    data = json.loads(run(['docker', 'image', 'inspect', reference]))[0]
    config = data['Config']
    env = dict(item.split('=', 1) for item in (config.get('Env') or []) if '=' in item)
    labels = config.get('Labels') or {}
    runtime = {key: config.get(key) for key in ('User', 'Entrypoint', 'Cmd', 'WorkingDir', 'ExposedPorts', 'Volumes', 'StopSignal', 'Healthcheck')}
    runtime['env'] = {k: v for k, v in env.items() if k != RELEASE_ONLY['env']}
    runtime['labels'] = {k: v for k, v in labels.items() if k != RELEASE_ONLY['labels']}
    return {'id': data['Id'], 'revision': labels.get(RELEASE_ONLY['labels']), 'release_sha': env.get(RELEASE_ONLY['env']), 'runtime': runtime}


def runtime_differences(old, new):
    """Names (never values) of what would make the new image start differently from the old one."""
    out = []
    for key in sorted(set(old) | set(new)):
        if key in ('env', 'labels'):
            out += [f'{key}.{name}' for name in sorted(set(old[key]) | set(new[key])) if old[key].get(name) != new[key].get(name)]
        elif old.get(key) != new.get(key):
            out.append(key)
    return out


def check(args):
    if not SHA.fullmatch(args.sha):
        blocked('--sha must be the exact 40-hex reviewed commit')
    project, project_dir, files, env_files, running_image = discover(args)
    overlay = os.path.abspath(args.overlay)
    if overlay in files:
        blocked('the overlay is already part of the running Compose set')
    base = compose_cmd(project, project_dir, files, env_files, args.profile)
    with_overlay = compose_cmd(project, project_dir, files + [overlay], env_files, args.profile)
    before = json.loads(run(base + ['config', '--format', 'json']))
    after = json.loads(run(with_overlay + ['config', '--format', 'json']))
    if SERVICE not in before.get('services', {}):
        blocked(f'{SERVICE} is absent from the rendered config; pass the --profile the running stack uses')
    diff = changed_paths(before, after)
    print(f'Compose project {project}; {len(files)} running file(s) + overlay; changed key paths:')
    for path in diff:
        print(f'  {path}')
    if set(diff) != ALLOWED:
        blocked('the overlay must change exactly ' + ' and '.join(sorted(ALLOWED)))
    old_image, new_image = before['services'][SERVICE]['image'], after['services'][SERVICE]['image']
    old_sha = before['services'][SERVICE].get('environment', {}).get('VOLTEX_RELEASE_SHA')
    new_sha = after['services'][SERVICE]['environment']['VOLTEX_RELEASE_SHA']
    print(f'  image: {old_image} -> {new_image}')
    print(f'  VOLTEX_RELEASE_SHA: {old_sha} -> {new_sha}')
    if new_sha != args.sha:
        blocked('the overlay SHA differs from --sha')
    if not args.no_docker:
        new, old = image_facts(new_image), image_facts(old_image)
        if new['revision'] != args.sha or new['release_sha'] != args.sha:
            blocked('the new image revision label / VOLTEX_RELEASE_SHA is not --sha')
        if new['id'] == running_image:
            blocked('the new image is the running image')
        differs = runtime_differences(old['runtime'], new['runtime'])
        if differs:
            blocked('the new image would start differently from the running one: ' + ', '.join(differs))
        print('New image runs like the old one: same user, entrypoint, command, working dir, ports, volumes, ENV and labels (release SHA aside).')
        if old['id'] != running_image:
            blocked(f'the running config image resolves to {old["id"]}, not the running {running_image}: '
                    'a rollback by the old config would start a different image')
        print(f'New image {new["id"]} (revision {args.sha}); rollback image {running_image} present.')
    up = ['up', '-d', '--no-deps', '--no-build', '--pull', 'never', SERVICE]
    print('READY TO SWITCH — only after the owner\'s separate approval:')
    print('  switch:   ' + shlex.join(with_overlay + up))
    print('  rollback: ' + shlex.join(base + up))
    print('Nothing was started, stopped, recreated, pulled or built.')


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest='command', required=True)
    o = sub.add_parser('overlay')
    o.add_argument('--release-dir', required=True)
    o.add_argument('--image', required=True)
    o.add_argument('--sha', required=True)
    c = sub.add_parser('check')
    c.add_argument('--overlay', required=True)
    c.add_argument('--sha', required=True)
    c.add_argument('--profile', default='cutover')
    c.add_argument('--compose-files')
    c.add_argument('--project', default='voltex-cutover')
    c.add_argument('--project-dir', default='.')
    c.add_argument('--env-file', action='append')
    c.add_argument('--running-image')
    c.add_argument('--no-docker', action='store_true')
    args = parser.parse_args()
    if args.command == 'check' and args.no_docker and not args.compose_files:
        parser.error('--no-docker is for the offline self-test and needs --compose-files')
    (write_overlay if args.command == 'overlay' else check)(args)


if __name__ == '__main__':
    main()
