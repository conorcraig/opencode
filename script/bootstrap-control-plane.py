#!/usr/bin/env python3
"""Build the actual OpenCode checkout from pinned upstream and this source overlay."""
import argparse
import json
from pathlib import Path
import shutil
import subprocess
import sys


def run(arguments, cwd=None):
    subprocess.run(arguments, cwd=cwd, check=True)


def bootstrap(source, destination, install):
    manifest = json.loads((source / 'control-plane-upstream.json').read_text())
    if destination.exists():
        raise SystemExit('Destination already exists; choose a new directory to preserve existing work.')
    destination.mkdir(parents=True)
    run(['git', 'init', str(destination)])
    run(['git', 'remote', 'add', 'upstream', manifest['repository']], destination)
    run(['git', 'fetch', '--depth=1', 'upstream', manifest['commit']], destination)
    run(['git', 'checkout', '--detach', 'FETCH_HEAD'], destination)
    copied = []
    for relative in manifest['overlayPaths']:
        origin = source / relative
        if not origin.exists():
            continue
        target = destination / relative
        if origin.is_dir():
            shutil.copytree(origin, target, dirs_exist_ok=True,
                            ignore=shutil.ignore_patterns('node_modules', '__pycache__', '*.sqlite', '*.sqlite-*', 'credentials.json'))
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(origin, target)
        copied.append(relative)
    for name in ['control-plane-upstream.json', 'CONTROL-PLANE-SETUP.md']:
        if (source / name).exists():
            shutil.copy2(source / name, destination / name)
    print(f'Applied {len(copied)} source paths to {destination}', flush=True)
    if install:
        # New workspace packages can legitimately require a lockfile refresh.
        run(['bun', 'install'], destination)
    print('Source ready. See CONTROL-PLANE-SETUP.md for service and app commands.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('destination', type=Path)
    parser.add_argument('--no-install', action='store_true', help='Prepare source without installing dependencies')
    args = parser.parse_args()
    try:
        bootstrap(Path(__file__).resolve().parent.parent, args.destination.resolve(), not args.no_install)
    except subprocess.CalledProcessError as error:
        sys.exit(error.returncode)
