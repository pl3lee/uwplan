#!/usr/bin/env python3
"""Stage reviewed telemetry configuration as root; CI still admits the release.

Usage: sudo python3 stage-observability.py --token-env /secure/existing.env
Run from an extracted, reviewed checkout containing ops/production/.
"""
import argparse
import fcntl
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import time

ROOT = Path('/opt/uwplan-production')
CONFIG = Path('/etc/uwplan-production')
STATE = Path('/var/lib/uwplan-production')
DEPLOYER = Path('/usr/local/sbin/uwplan-deploy')
SOURCE = Path(__file__).resolve().parent
IMAGE = 'otel/opentelemetry-collector-contrib:0.160.0@sha256:799dc6cf12c96192af37b5bdba804da8c10b3bc563b43cb90c3f3c58d9572ad6'


def run(args, **kwargs):
    result = subprocess.run(args, capture_output=True, timeout=300, **kwargs)
    if result.returncode:
        # Config diagnostics can contain credentials; do not echo them.
        raise RuntimeError('Staging validation failed: ' + ' '.join(args[:3]))


def stage(token_env):
    if os.geteuid() != 0:
        raise RuntimeError('Run this staging command as root')
    os.umask(0o077)
    values = dict(line.split('=', 1) for line in token_env.read_text().splitlines() if '=' in line)
    token = values.get('POSTHOG_PROJECT_TOKEN', '')
    if not re.fullmatch(r'phc_[A-Za-z0-9_-]+', token):
        raise ValueError('Expected a PostHog project ingestion token in the supplied env file')
    with open(STATE / 'deploy.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with tempfile.TemporaryDirectory(prefix='uwplan-observability-') as temporary:
            work = Path(temporary)
            env = work / 'observability.env'
            env.write_text('POSTHOG_PROJECT_TOKEN=' + token + '\n')
            env.chmod(0o600)
            for name in ('api.env', 'web.env', 'redis.env', 'migrator.env', 'postgres-admin-password'):
                (work / name).symlink_to(CONFIG / name)
            run(['docker', 'run', '--rm', '--read-only', '--cap-drop=ALL',
                 '--security-opt=no-new-privileges:true', '--tmpfs', '/var/lib/otelcol',
                 '--env-file', str(env), '-e', 'POSTHOG_OTLP_ENDPOINT=https://us.i.posthog.com/i',
                 '-v', f'{SOURCE}/observability/otel-collector.yaml:/etc/otelcol/config.yaml:ro',
                 IMAGE, 'validate', '--config=/etc/otelcol/config.yaml'])
            # Only the retained release file supplies image identities.
            environment = {'PATH': os.environ['PATH'], 'UWPLAN_CONFIG_DIR': str(work)}
            run(['docker', 'compose', '-p', 'uwplan-production', '-f', str(SOURCE / 'compose.rewrite.yaml'),
                 '--env-file', str(STATE / 'release.env'), 'config', '--quiet'], env=environment)
            files = {
                ROOT / 'compose.rewrite.yaml': SOURCE / 'compose.rewrite.yaml',
                ROOT / 'observability/otel-collector.yaml': SOURCE / 'observability/otel-collector.yaml',
                DEPLOYER: SOURCE / 'deploy.py',
                CONFIG / 'observability.env': env,
            }
            backup = STATE / f'observability-backup-{time.time_ns()}'
            backup.mkdir(mode=0o700)
            for destination in files:
                if destination.exists():
                    copy = backup / str(destination).lstrip('/')
                    copy.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(destination, copy)
            installed = []
            try:
                for destination, source in files.items():
                    destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                    staging = destination.with_suffix(destination.suffix + '.staging')
                    shutil.copyfile(source, staging)
                    staging.chmod(0o755 if destination.name == 'uwplan-deploy' else 0o600)
                    os.replace(staging, destination)
                    installed.append(destination)
            except Exception:
                for destination in reversed(installed):
                    previous = backup / str(destination).lstrip('/')
                    if previous.exists():
                        shutil.copy2(previous, destination)
                    else:
                        destination.unlink()
                raise
            print(f'Staged validated PostHog configuration. Rollback files: {backup}')
            print('Running applications are unchanged. Admit the reviewed release through CI/CD.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--token-env', type=Path, required=True)
    stage(parser.parse_args().token_env)
