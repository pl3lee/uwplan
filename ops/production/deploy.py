#!/usr/bin/python3
"""Root-owned forced-command deployer. CI supplies only an image digest and revision."""
import fcntl
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys
import time
import urllib.request

ROOT = Path('/opt/uwplan-production')
STATE = Path('/var/lib/uwplan-production')
REPOSITORY = 'docker.io/pl3lee/uwplan'
RELEASE = STATE / 'release.env'
COMPOSE = ['docker', 'compose', '-p', 'uwplan-production', '-f', str(ROOT / 'compose.yaml')]


def parse_command(command):
    words = shlex.split(command)
    if len(words) != 3 or words[0] != 'deploy':
        raise ValueError('Only deploy DIGEST REVISION is permitted')
    digest, revision = words[1:]
    if not re.fullmatch(r'sha256:[0-9a-f]{64}', digest):
        raise ValueError('Invalid digest')
    if not re.fullmatch(r'[0-9a-f]{40}', revision):
        raise ValueError('Invalid source revision')
    return digest, revision


def run(args, **kwargs):
    # Keep failed SQL and application environment out of CI output.
    result = subprocess.run(args, timeout=600, capture_output=True, **kwargs)
    if result.returncode:
        raise RuntimeError('Operation failed: ' + ' '.join(args[:3]))
    return result


def compose(env, *args):
    return run(COMPOSE + ['--env-file', str(env), *args])


def atomic_write(path, data):
    temporary = path.with_suffix('.tmp')
    with open(temporary, 'wb') as output:
        os.chmod(temporary, 0o600)
        output.write(data)
    os.replace(temporary, path)


def ready(digest, revision):
    for _ in range(60):
        try:
            with urllib.request.urlopen('http://127.0.0.1:5002/api/ready', timeout=3) as response:
                data = json.load(response)
            if data.get('status') == 'ready' and data.get('release') == {'digest': digest, 'revision': revision}:
                return True
        except Exception:
            pass
        time.sleep(2)
    return False


def release_identity(contents):
    values = dict(line.split('=', 1) for line in contents.decode().splitlines() if '=' in line)
    return values['RELEASE_DIGEST'], values['RELEASE_REVISION']


def deploy(digest, revision):
    os.umask(0o077)
    STATE.mkdir(mode=0o700, exist_ok=True)
    with open(STATE / 'deploy.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if (STATE / 'frozen').exists():
            raise RuntimeError('Deployments are frozen for migration')
        previous = RELEASE.read_bytes()
        image = f'{REPOSITORY}@{digest}'
        run(['docker', 'pull', '--platform', 'linux/amd64', image])
        metadata = json.loads(run(['docker', 'image', 'inspect', image]).stdout)[0]
        if metadata['Architecture'] != 'amd64' or metadata['Config']['Labels'].get('org.opencontainers.image.revision') != revision:
            raise RuntimeError('Image architecture or source revision mismatch')
        candidate = STATE / 'candidate.env'
        atomic_write(candidate, f'UWPLAN_IMAGE={image}\nRELEASE_DIGEST={digest}\nRELEASE_REVISION={revision}\n'.encode())
        backups = STATE / 'backups'
        backups.mkdir(mode=0o700, exist_ok=True)
        archive = compose(RELEASE, 'exec', '-T', 'db', 'pg_dump', '-U', 'postgres', '-d', 'uwplan', '-Fc', '--no-owner', '--no-acl').stdout
        atomic_write(backups / f'{time.time_ns()}.dump', archive)
        compose(candidate, '--profile', 'migration', 'run', '--rm', '--no-deps', 'migrator')
        # Schema changes are restricted by the image's expand-only migrator.
        # Ensure new objects remain accessible to the unprivileged application role.
        compose(candidate, 'exec', '-T', 'db', 'psql', '-U', 'postgres', '-d', 'uwplan', '-v', 'ON_ERROR_STOP=1', '-c',
                'GRANT USAGE ON SCHEMA public TO uwplan_app; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO uwplan_app; GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO uwplan_app;')
        try:
            atomic_write(RELEASE, candidate.read_bytes())
            compose(RELEASE, 'up', '-d', '--no-deps', '--force-recreate', 'app')
            if not ready(digest, revision):
                raise RuntimeError('Candidate failed readiness')
        except Exception:
            atomic_write(RELEASE, previous)
            compose(RELEASE, 'up', '-d', '--no-deps', '--force-recreate', 'app')
            if not ready(*release_identity(previous)):
                raise RuntimeError('Deployment and previous application readiness both failed')
            raise RuntimeError('Deployment rejected; previous image restored without reverting database writes')
        atomic_write(STATE / 'previous.env', previous)
        print(json.dumps({'status': 'deployed', 'digest': digest, 'revision': revision}))


if __name__ == '__main__':
    try:
        if len(sys.argv) != 2:
            raise ValueError('Expected one original SSH command')
        if sys.argv[1] == 'status':
            identity = release_identity(RELEASE.read_bytes())
            healthy = ready(*identity)
            print(json.dumps({'ready': healthy, 'frozen': (STATE / 'frozen').exists(), 'digest': identity[0], 'revision': identity[1]}))
            if not healthy: sys.exit(1)
        else:
            deploy(*parse_command(sys.argv[1]))
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
