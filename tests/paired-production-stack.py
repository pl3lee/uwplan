#!/usr/bin/env python3
"""Rehearse the actual deployer against an owned registry and Compose project."""
import base64
from datetime import datetime, timedelta, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / 'tests/fixtures/paired-release'
REGISTRY = 'registry:2@sha256:a3d8aaa63ed8681a604f1dea0aa03f100d5895b6a58ace528858a7b332415373'


def command(*args, input=None):
    result = subprocess.run(args, input=input, capture_output=True, timeout=600)
    if result.returncode:
        raise RuntimeError(f'{args[:3]} failed: {result.stderr.decode()[-1500:]}')
    return result.stdout


def metadata(image):
    return json.loads(command('docker', 'image', 'inspect', image))[0]


def port():
    with socket.socket() as reservation:
        reservation.bind(('127.0.0.1', 0))
        return reservation.getsockname()[1]


def main():
    sources = {name: os.environ[f'UWPLAN_{name.upper()}_IMAGE'] for name in ('legacy', 'api', 'web')}
    for image in sources.values():
        assert metadata(image)['Architecture'] == 'amd64', 'Use the production AMD64 artifacts'
    project = f'uwplan-paired-rehearsal-{uuid.uuid4().hex[:12]}'
    registry_name = f'{project}-registry'
    registry_created = False
    owned_tags = []
    with tempfile.TemporaryDirectory(prefix='uwplan-paired-rehearsal-') as temporary:
        work = Path(temporary)
        config = work / 'config'
        installed = work / 'installed'
        state = work / 'state'
        for directory in (config, installed, state):
            directory.mkdir(mode=0o700)
        web_port = port()
        origin = f'http://127.0.0.1:{web_port}'
        for filename in ('compose.yaml', 'compose.rewrite.yaml'):
            contents = (ROOT / 'ops/production' / filename).read_text()
            contents = contents.replace('127.0.0.1:5002:', f'127.0.0.1:{web_port}:')
            (installed / filename).write_text(contents)
        os.environ['UWPLAN_CONFIG_DIR'] = str(config)
        api_password = 'disposable-app-password'
        redis_password = 'disposable-redis-password'
        files = {
            'postgres-admin-password': 'disposable-admin-password',
            'migrator.env': 'DATABASE_URL=postgresql://postgres:disposable-admin-password@db:5432/uwplan\n',
            'api.env': (f'DATABASE_URL=postgresql://uwplan_app:{api_password}@db:5432/uwplan\n'
                        f'REDIS_URL=redis://:{redis_password}@redis:6379/0\nPUBLIC_ORIGIN={origin}\nOTEL_ENABLED=false\n'),
            'web.env': 'OTEL_ENABLED=false\n',
            'redis.env': f'REDIS_PASSWORD={redis_password}\n',
            'app.env': (f'DATABASE_URL=postgresql://uwplan_app:{api_password}@db:5432/uwplan\n'
                        'AUTH_SECRET=disposable-auth-secret\nAUTH_TRUST_HOST=true\n'
                        'AUTH_GOOGLE_ID=fixture-google\nAUTH_GOOGLE_SECRET=fixture-google-secret\n'
                        'AUTH_GITHUB_ID=fixture-github\nAUTH_GITHUB_SECRET=fixture-github-secret\n'),
        }
        for filename, contents in files.items():
            target = config / filename
            target.write_text(contents)
            target.chmod(0o600)
        spec = importlib.util.spec_from_file_location('release_admission', ROOT / 'ops/production/deploy.py')
        admission = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(admission)
        admission.ROOT = installed
        admission.STATE = state
        admission.RELEASE = state / 'release.env'
        admission.COMPOSE = ['docker', 'compose', '-p', project]
        admission.READINESS_URL = f'{origin}/api/ready'
        admission.READINESS_ATTEMPTS = 60
        admission.READINESS_INTERVAL = 0.25
        try:
            registry_port = port()
            command('docker', 'create', '--name', registry_name, '--network', 'host',
                    '-e', f'REGISTRY_HTTP_ADDR=127.0.0.1:{registry_port}', '--memory', '96m', REGISTRY)
            registry_created = True
            command('docker', 'start', registry_name)
            repository = f'127.0.0.1:{registry_port}/uwplan'
            admission.REPOSITORY = repository
            for attempt in range(40):
                try:
                    command('docker', 'exec', registry_name, 'wget', '-qO-', f'http://127.0.0.1:{registry_port}/v2/')
                    break
                except RuntimeError:
                    time.sleep(0.25)
            else:
                raise RuntimeError('Disposable registry did not start')

            def publish(source, suffix, tag):
                target = f'{repository}{suffix}:{tag}'
                command('docker', 'tag', source, target)
                owned_tags.append(target)
                command('docker', 'push', target)
                reference = next(value for value in metadata(target)['RepoDigests'] if value.startswith(f'{repository}{suffix}@'))
                assert metadata(reference)['Id'] == metadata(source)['Id'], 'Published digest must identify the source image'
                return reference.split('@', 1)[1]

            legacy_digest = publish(sources['legacy'], '', 'legacy')
            api_digest = publish(sources['api'], '-api', 'good')
            web_digest = publish(sources['web'], '-web', 'good')
            legacy_revision = metadata(sources['legacy'])['Config']['Labels']['org.opencontainers.image.revision']
            revision = metadata(sources['api'])['Config']['Labels']['org.opencontainers.image.revision']
            assert metadata(sources['web'])['Config']['Labels']['org.opencontainers.image.revision'] == revision
            legacy = admission.Release(legacy_digest, legacy_revision)
            pair = admission.Release(api_digest, revision, web_digest)
            admission.atomic_write(admission.RELEASE, legacy.encode())
            admission.compose(admission.RELEASE, 'up', '-d', '--wait', 'db')
            admission.compose(admission.RELEASE, '--profile', 'migration', 'run', '--rm', '--no-deps', 'migrator')

            def sql(statement, database='uwplan'):
                return admission.compose(admission.RELEASE, 'exec', '-T', 'db', 'psql', '-U', 'postgres', '-d', database,
                                         '-At', '-v', 'ON_ERROR_STOP=1', '-c', statement).stdout

            sql(f"CREATE ROLE uwplan_app LOGIN PASSWORD '{api_password}'; GRANT USAGE ON SCHEMA public TO uwplan_app; "
                'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO uwplan_app; '
                'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO uwplan_app;')
            sql((FIXTURES / 'seed.sql').read_text())
            admission.compose(admission.RELEASE, 'up', '-d', '--no-deps', 'app')
            assert admission.ready(legacy_digest, legacy_revision), 'Legacy fixture must be healthy before migration'
            print('Legacy application and representative saved data are ready', flush=True)

            def deploy(release):
                command_text = (f'deploy-pair {release.digest} {release.web_digest} {release.revision}' if release.web_digest
                                else f'deploy {release.digest} {release.revision}')
                admission.deploy(*admission.parse_command(command_text))

            deploy(pair)
            assert admission.RELEASE.read_bytes() == pair.encode()
            token = secrets.token_urlsafe(32)
            token_hash = base64.urlsafe_b64encode(hashlib.sha256(token.encode()).digest()).decode().rstrip('=')
            now = datetime.now(timezone.utc)
            session = json.dumps({'id': str(uuid.uuid4()), 'user_id': 'legacy-student', 'token_hash': token_hash,
                                  'created_at': now.isoformat(), 'expires_at': (now + timedelta(hours=1)).isoformat()})
            redis = admission.compose(admission.RELEASE, 'ps', '-q', 'redis').stdout.decode().strip()
            command('docker', 'exec', '-e', f'REDISCLI_AUTH={redis_password}', redis, 'redis-cli', 'SET',
                    f'uwplan:session:{token_hash}', session, 'EX', '3600')

            def request(path, body=None, legacy_cookie=False, method=None):
                cookie = 'authjs.session-token=legacy-release-session' if legacy_cookie else f'uwplan_session={token}'
                payload = json.dumps(body).encode() if body is not None else None
                req = urllib.request.Request(f'{origin}{path}', data=payload, method=method,
                    headers={'Cookie': cookie, 'Origin': origin, 'Content-Type': 'application/json'})
                with urllib.request.urlopen(req, timeout=10) as response:
                    return response.status, response.read()

            schedules = json.loads(request('/api/v1/schedules')[1])
            assert schedules == {'schedules': [{'id': '22222222-2222-4222-8222-222222222222', 'name': 'Saved release schedule'}]}
            csv = request('/api/v1/schedules/22222222-2222-4222-8222-222222222222/export')[1].decode()
            assert 'CS135 - Designing Functional Programs' in csv and 'CS136 - Elementary Algorithm Design' in csv
            assert 'Fall 2026' in csv and 'Winter 2027' in csv
            print('Paired release serves the legacy schedules, selections, and assignments', flush=True)

            bad_revision = hashlib.sha1((FIXTURES / 'bad-web.mjs').read_bytes()).hexdigest()
            bad_api = f'{project}-api:bad'
            bad_web = f'{project}-web:bad'
            owned_tags.extend((bad_api, bad_web))
            dockerfile = f'FROM {sources["api"]}\nLABEL org.opencontainers.image.revision={bad_revision}\n'
            command('docker', 'build', '--platform', 'linux/amd64', '-t', bad_api, '-', input=dockerfile.encode())
            command('docker', 'build', '--platform', 'linux/amd64', '--build-arg', f'WEB_IMAGE={sources["web"]}',
                    '--build-arg', f'RELEASE_REVISION={bad_revision}', '-f', str(FIXTURES / 'BadWeb.Dockerfile'),
                    '-t', bad_web, str(FIXTURES))
            bad = admission.Release(publish(bad_api, '-api', 'bad'), bad_revision, publish(bad_web, '-web', 'bad'))
            written = []
            write_errors = []
            stop = threading.Event()

            def write_from_candidate():
                deadline = time.monotonic() + 45
                while not stop.is_set() and time.monotonic() < deadline:
                    try:
                        with urllib.request.urlopen(admission.READINESS_URL, timeout=1) as response:
                            identity = json.load(response).get('release')
                            web_identity = response.headers.get('X-UWPlan-Web-Release-Digest')
                        if identity == {'digest': bad.digest, 'revision': bad.revision}:
                            assert web_identity == 'deliberately-invalid-release', f'Fault image did not serve the request: {web_identity}'
                            status, content = request('/api/v1/schedules', {'name': 'Written by rejected candidate'})
                            assert status == 201
                            written.append(json.loads(content))
                            return
                    except OSError:
                        time.sleep(0.1)
                    except Exception as error:
                        write_errors.append(error)
                        return
                if not stop.is_set():
                    write_errors.append(RuntimeError('Candidate never accepted the rehearsal write'))

            writer = threading.Thread(target=write_from_candidate)
            writer.start()
            rejected = None
            try:
                deploy(bad)
            except RuntimeError as error:
                rejected = error
            finally:
                stop.set()
                writer.join(timeout=12)
            assert not writer.is_alive() and not write_errors, write_errors
            assert written, 'Candidate must commit a write before rejection'
            assert rejected and 'previous image restored' in str(rejected), rejected
            assert admission.RELEASE.read_bytes() == pair.encode(), 'Rollback must restore both digests'
            assert written[0] in json.loads(request('/api/v1/schedules')[1])['schedules']
            print('Rejected candidate write survives rollback of both services', flush=True)

            deploy(legacy)
            html = request(f'/schedule?scheduleId={written[0]["id"]}', legacy_cookie=True)[1].decode()
            assert 'Written by rejected candidate' in html
            print('Retained legacy application can use data written by the rejected pair', flush=True)
            archive = max((state / 'backups').glob('*.dump'), key=lambda value: int(value.stem))
            admission.compose(admission.RELEASE, 'exec', '-T', 'db', 'createdb', '-U', 'postgres', 'restore_probe')
            db_container = admission.compose(admission.RELEASE, 'ps', '-q', 'db').stdout.decode().strip()
            command('docker', 'exec', '-i', db_container, 'pg_restore', '-U', 'postgres', '-d', 'restore_probe',
                    '--no-owner', '--no-acl', '--exit-on-error', input=archive.read_bytes())
            expected = {
                'user': {'id': 'legacy-student', 'role': 'user'},
                'providers': {'google': 'legacy-google-subject', 'github': '42'},
                'schedule_owner': 'legacy-student', 'template': 'Release degree requirements', 'free_choice': 'CS136',
                'selected_slots': ['55555555-5555-4555-8555-555555555555', '66666666-6666-4666-8666-666666666666'],
                'assignments': [{'code': 'CS135', 'term': 'Fall 2026'}, {'code': 'CS136', 'term': 'Winter 2027'}],
                'range': ['Fall', 2026, 'Spring', 2027], 'candidate_schedule': written[0]['id'],
            }
            for database in ('uwplan', 'restore_probe'):
                assert json.loads(sql((FIXTURES / 'relationships.sql').read_text(), database)) == expected
            print('Backup restoration preserves account links, ownership, templates, choices, assignments, and candidate writes', flush=True)
            sql('GRANT USAGE ON SCHEMA public TO uwplan_app; '
                'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO uwplan_app; '
                'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO uwplan_app;', 'restore_probe')
            admission.compose(admission.RELEASE, 'stop', 'app')
            api_environment = config / 'api.env'
            api_environment.write_text(api_environment.read_text().replace('@db:5432/uwplan', '@db:5432/restore_probe'))
            admission.atomic_write(admission.RELEASE, pair.encode())
            admission.compose(admission.RELEASE, 'up', '-d', '--no-deps', '--force-recreate', 'api', 'web')
            assert admission.ready(pair.digest, pair.revision, pair.web_digest)
            restored_schedules = json.loads(request('/api/v1/schedules')[1])['schedules']
            expected_schedules = [*schedules['schedules'], written[0]]
            assert sorted(restored_schedules, key=lambda item: item['id']) == sorted(expected_schedules, key=lambda item: item['id'])
            assert request('/api/v1/schedules/22222222-2222-4222-8222-222222222222/export')[1].decode() == csv
            status, content = request('/api/v1/schedules', {'name': 'Restored database write probe'})
            assert status == 201
            restored_write = json.loads(content)
            assert restored_write in json.loads(request('/api/v1/schedules')[1])['schedules']
            assert request(f'/api/v1/schedules/{restored_write["id"]}', method='DELETE')[0] == 204
            assert sorted(json.loads(request('/api/v1/schedules')[1])['schedules'], key=lambda item: item['id']) == sorted(expected_schedules, key=lambda item: item['id'])
            print('Restored database supports authenticated application reads, CSV export, writes, and deletion through the restricted role', flush=True)

        finally:
            cleanup_errors = []

            def cleanup(*args):
                try:
                    return command(*args)
                except Exception as error:
                    cleanup_errors.append(str(error))
                    return b''

            containers = cleanup('docker', 'ps', '-aq', '--filter', f'label=com.docker.compose.project={project}').decode().split()
            if containers:
                cleanup('docker', 'rm', '-fv', *containers)
            for kind in ('volume', 'network'):
                resources = cleanup('docker', kind, 'ls', '-q', '--filter', f'label=com.docker.compose.project={project}').decode().split()
                if resources:
                    cleanup('docker', kind, 'rm', *resources)
            if registry_created:
                cleanup('docker', 'rm', '-fv', registry_name)
            for tag in owned_tags:
                cleanup('docker', 'image', 'rm', tag)
            if cleanup_errors:
                print(f'Disposable project {project} cleanup errors: {cleanup_errors}', file=sys.stderr)
                if sys.exc_info()[0] is None:
                    raise RuntimeError('Rehearsal resources were not fully cleaned up')



if __name__ == '__main__':
    main()
