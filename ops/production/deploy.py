#!/usr/bin/python3
"""Root-owned forced-command deployer. CI supplies only an image digest and revision."""
import fcntl
from dataclasses import dataclass
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
COMPOSE = ['docker', 'compose', '-p', 'uwplan-production']
ARCHITECTURE = 'amd64'
READINESS_URL = 'http://127.0.0.1:5002/api/ready'
READINESS_ATTEMPTS = 60
READINESS_INTERVAL = 2


@dataclass(frozen=True)
class Release:
    digest: str
    revision: str
    web_digest: str | None = None

    @property
    def images(self):
        if self.web_digest:
            return (f'{REPOSITORY}-api@{self.digest}', f'{REPOSITORY}-web@{self.web_digest}')
        return (f'{REPOSITORY}@{self.digest}',)

    @property
    def services(self):
        return ('api', 'web') if self.web_digest else ('app',)

    def encode(self):
        if self.web_digest:
            return (f'UWPLAN_API_IMAGE={self.images[0]}\nUWPLAN_WEB_IMAGE={self.images[1]}\n'
                    f'RELEASE_DIGEST={self.digest}\nRELEASE_WEB_DIGEST={self.web_digest}\n'
                    f'RELEASE_REVISION={self.revision}\n').encode()
        return (f'UWPLAN_IMAGE={self.images[0]}\nRELEASE_DIGEST={self.digest}\n'
                f'RELEASE_REVISION={self.revision}\n').encode()

    @classmethod
    def decode(cls, contents):
        values = dict(line.split('=', 1) for line in contents.decode().splitlines() if '=' in line)
        return cls(values['RELEASE_DIGEST'], values['RELEASE_REVISION'], values.get('RELEASE_WEB_DIGEST'))


def parse_command(command):
    words = shlex.split(command)
    if len(words) == 3 and words[0] == 'deploy':
        digest, revision = words[1:]
        web_digest = None
    elif len(words) == 4 and words[0] == 'deploy-pair':
        digest, web_digest, revision = words[1:]
    else:
        raise ValueError('Only deploy DIGEST REVISION or deploy-pair API_DIGEST WEB_DIGEST REVISION is permitted')
    for value in [digest] + ([web_digest] if web_digest else []):
        if not re.fullmatch(r'sha256:[0-9a-f]{64}', value):
            raise ValueError('Invalid digest')
    if not re.fullmatch(r'[0-9a-f]{40}', revision):
        raise ValueError('Invalid source revision')
    return (digest, revision, web_digest) if web_digest else (digest, revision)


def run(args, **kwargs):
    # Keep failed SQL and application environment out of CI output.
    result = subprocess.run(args, timeout=600, capture_output=True, **kwargs)
    if result.returncode:
        raise RuntimeError('Operation failed: ' + ' '.join(args[:3]))
    return result


def compose(env, *args):
    filename = 'compose.rewrite.yaml' if Release.decode(env.read_bytes()).web_digest else 'compose.yaml'
    command = COMPOSE + ['-f', str(ROOT / filename)]
    return run(command + ['--env-file', str(env), *args])


def atomic_write(path, data):
    temporary = path.with_suffix('.tmp')
    with open(temporary, 'wb') as output:
        os.chmod(temporary, 0o600)
        output.write(data)
    os.replace(temporary, path)


def ready(digest, revision, web_digest=None):
    for _ in range(READINESS_ATTEMPTS):
        try:
            with urllib.request.urlopen(READINESS_URL, timeout=3) as response:
                data = json.load(response)
                web_matches = not web_digest or (
                    response.headers.get('X-UWPlan-Web-Release-Digest') == web_digest and
                    response.headers.get('X-UWPlan-Web-Release-Revision') == revision)
            if web_matches and data.get('status') == 'ready' and data.get('release') == {'digest': digest, 'revision': revision}:
                return True
        except Exception:
            pass
        time.sleep(READINESS_INTERVAL)
    return False


def release_identity(contents):
    release = Release.decode(contents)
    identity = (release.digest, release.revision)
    return (*identity, release.web_digest) if release.web_digest else identity


def deploy(digest, revision, web_digest=None):
    os.umask(0o077)
    STATE.mkdir(mode=0o700, exist_ok=True)
    with open(STATE / 'deploy.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if (STATE / 'frozen').exists():
            raise RuntimeError('Deployments are frozen for migration')
        previous = RELEASE.read_bytes()
        old_release = Release.decode(previous)
        new_release = Release(digest, revision, web_digest)
        for image in new_release.images:
            run(['docker', 'pull', '--platform', f'linux/{ARCHITECTURE}', image])
            metadata = json.loads(run(['docker', 'image', 'inspect', image]).stdout)[0]
            if metadata['Architecture'] != ARCHITECTURE or metadata['Config']['Labels'].get('org.opencontainers.image.revision') != revision:
                raise RuntimeError('Image architecture or source revision mismatch')
        candidate = STATE / 'candidate.env'
        atomic_write(candidate, new_release.encode())
        compose(candidate, 'config', '--quiet')
        if web_digest:
            compose(candidate, 'up', '-d', '--no-deps', '--wait', 'redis')
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
            # Stop both writers before changing a paired release, including a
            # transition to or from the retained legacy application.
            if web_digest or old_release.web_digest:
                compose(RELEASE, 'stop', *old_release.services)
            atomic_write(RELEASE, candidate.read_bytes())
            compose(RELEASE, 'up', '-d', '--no-deps', '--force-recreate', *new_release.services)
            if not ready(*release_identity(new_release.encode())):
                raise RuntimeError('Candidate failed readiness')
        except Exception:
            if web_digest or old_release.web_digest:
                compose(candidate, 'stop', *new_release.services)
            atomic_write(RELEASE, previous)
            compose(RELEASE, 'up', '-d', '--no-deps', '--force-recreate', *old_release.services)
            if not ready(*release_identity(previous)):
                raise RuntimeError('Deployment and previous application readiness both failed')
            raise RuntimeError('Deployment rejected; previous image restored without reverting database writes')
        atomic_write(STATE / 'previous.env', previous)
        print(json.dumps({'status': 'deployed', 'digest': digest, 'revision': revision,
                          **({'web_digest': web_digest} if web_digest else {})}))


if __name__ == '__main__':
    try:
        if len(sys.argv) != 2:
            raise ValueError('Expected one original SSH command')
        if sys.argv[1] == 'status':
            identity = release_identity(RELEASE.read_bytes())
            healthy = ready(*identity)
            print(json.dumps({'ready': healthy, 'frozen': (STATE / 'frozen').exists(), 'digest': identity[0], 'revision': identity[1],
                              **({'web_digest': identity[2]} if len(identity) == 3 else {})}))
            if not healthy: sys.exit(1)
        else:
            deploy(*parse_command(sys.argv[1]))
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
