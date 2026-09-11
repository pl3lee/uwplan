import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace

spec = importlib.util.spec_from_file_location('production_deploy', Path(__file__).resolve().parents[1] / 'ops/production/deploy.py')
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)
DIGEST = 'sha256:' + 'a' * 64
REVISION = 'b' * 40
OLD_DIGEST = 'sha256:' + 'c' * 64
OLD_REVISION = 'd' * 40
WEB_DIGEST = 'sha256:' + 'e' * 64

class DeploymentTests(unittest.TestCase):
    def test_compose_uses_admitted_file_instead_of_shell_image_overrides(self):
        with tempfile.TemporaryDirectory() as temporary:
            release = Path(temporary) / 'release.env'
            release.write_bytes(deploy.Release(DIGEST, REVISION, WEB_DIGEST).encode())
            overrides = {key: 'untrusted-override' for key in (
                'UWPLAN_IMAGE', 'UWPLAN_API_IMAGE', 'UWPLAN_WEB_IMAGE',
                'RELEASE_DIGEST', 'RELEASE_WEB_DIGEST', 'RELEASE_REVISION')}
            with patch.dict(deploy.os.environ, {**overrides, 'PATH': '/usr/bin'}, clear=True), patch.object(deploy, 'run') as run:
                deploy.compose(release, 'up', '-d', 'api', 'web')
            self.assertEqual(run.call_args.kwargs['env'], {'PATH': '/usr/bin'})
            self.assertIn(str(release), run.call_args.args[0])
            self.assertIn(str(deploy.ROOT / 'compose.rewrite.yaml'), run.call_args.args[0])

    def test_readiness_requires_matching_web_and_api_identities(self):
        cases = [
            (DIGEST, REVISION, WEB_DIGEST, REVISION, True),
            (OLD_DIGEST, REVISION, WEB_DIGEST, REVISION, False),
            (DIGEST, OLD_REVISION, WEB_DIGEST, REVISION, False),
            (DIGEST, REVISION, OLD_DIGEST, REVISION, False),
            (DIGEST, REVISION, WEB_DIGEST, OLD_REVISION, False),
            (DIGEST, REVISION, None, None, False),
        ]
        for api_digest, api_revision, web_digest, web_revision, expected in cases:
            with self.subTest(api_digest=api_digest, api_revision=api_revision, web_digest=web_digest, web_revision=web_revision):
                def response(*args, **kwargs):
                    body = io.BytesIO(json.dumps({'status': 'ready', 'release': {'digest': api_digest, 'revision': api_revision}}).encode())
                    body.headers = {'X-UWPlan-Web-Release-Digest': web_digest, 'X-UWPlan-Web-Release-Revision': web_revision}
                    return body
                with patch.object(deploy.urllib.request, 'urlopen', side_effect=response), patch.object(deploy.time, 'sleep'):
                    self.assertEqual(deploy.ready(DIGEST, REVISION, WEB_DIGEST), expected)

    def test_paired_command_accepts_only_two_digests_and_one_revision(self):
        self.assertEqual(deploy.parse_command(f'deploy-pair {DIGEST} {WEB_DIGEST} {REVISION}'), (DIGEST, REVISION, WEB_DIGEST))
        for command in [
            f'deploy-pair {DIGEST} {REVISION}',
            f'deploy-pair {DIGEST} latest {REVISION}',
            f'deploy-pair {DIGEST} evil/repo@{WEB_DIGEST} {REVISION}',
            f'deploy-pair {DIGEST} {WEB_DIGEST} {REVISION};id',
            f'deploy-pair {DIGEST} {WEB_DIGEST} {REVISION} extra',
        ]:
            with self.subTest(command=command), self.assertRaises(ValueError):
                deploy.parse_command(command)

    def test_rejects_arbitrary_commands_and_injection(self):
        for command in ['bash', 'deploy latest main', f'deploy {DIGEST} {REVISION};id', f'deploy evil/repo@{DIGEST} {REVISION}', f'deploy {DIGEST} {REVISION} extra']:
            with self.subTest(command=command), self.assertRaises(ValueError):
                deploy.parse_command(command)
        self.assertEqual(deploy.parse_command(f'deploy {DIGEST} {REVISION}'), (DIGEST, REVISION))

    def exercise(self, ready_results, migrate_fails=False, frozen=False, architecture='amd64', web_digest=None, old_web_digest=None, web_revision=REVISION, candidate_stop_fails=False, candidate_remove_fails=False):
        with tempfile.TemporaryDirectory() as temporary:
            state = Path(temporary)
            release = state/'release.env'
            previous = f'UWPLAN_IMAGE={deploy.REPOSITORY}@{OLD_DIGEST}\nRELEASE_DIGEST={OLD_DIGEST}\nRELEASE_REVISION={OLD_REVISION}\n'.encode()
            if old_web_digest:
                previous = (f'UWPLAN_API_IMAGE={deploy.REPOSITORY}-api@{OLD_DIGEST}\n'
                            f'UWPLAN_WEB_IMAGE={deploy.REPOSITORY}-web@{old_web_digest}\n'
                            f'RELEASE_DIGEST={OLD_DIGEST}\nRELEASE_WEB_DIGEST={old_web_digest}\n'
                            f'RELEASE_REVISION={OLD_REVISION}\n').encode()
            release.write_bytes(previous)
            if frozen: (state/'frozen').touch()
            calls=[]
            def compose(env, *args):
                calls.append(args)
                if 'migrator' in args and migrate_fails: raise RuntimeError('migration rejected')
                if args == ('stop', 'api', 'web') and candidate_stop_fails: raise RuntimeError('stop failed')
                if args == ('rm', '--stop', '--force', 'api', 'web') and candidate_remove_fails: raise RuntimeError('remove failed')
                return SimpleNamespace(stdout=b'backup')
            def run(args):
                image_revision = web_revision if args[-1].startswith(f'{deploy.REPOSITORY}-web@') else REVISION
                return SimpleNamespace(stdout=json.dumps([{'Architecture':architecture, 'Config':{'Labels':{'org.opencontainers.image.revision':image_revision}}}]).encode())
            with patch.multiple(deploy, STATE=state, RELEASE=release), patch.object(deploy,'compose',side_effect=compose), patch.object(deploy,'run',side_effect=run), patch.object(deploy,'ready',side_effect=ready_results):
                error=None
                try: deploy.deploy(DIGEST,REVISION,web_digest) if web_digest else deploy.deploy(DIGEST,REVISION)
                except Exception as caught: error=caught
            return release.read_bytes(), previous, calls, error, list((state/'backups').glob('*.dump'))

    def test_paired_release_records_both_images_and_stops_the_legacy_writer(self):
        current, previous, calls, error, backups = self.exercise([True], web_digest=WEB_DIGEST)
        self.assertIsNone(error)
        self.assertEqual(current.decode(), (
            f'UWPLAN_API_IMAGE=docker.io/pl3lee/uwplan-api@{DIGEST}\n'
            f'UWPLAN_WEB_IMAGE=docker.io/pl3lee/uwplan-web@{WEB_DIGEST}\n'
            f'RELEASE_DIGEST={DIGEST}\n'
            f'RELEASE_WEB_DIGEST={WEB_DIGEST}\n'
            f'RELEASE_REVISION={REVISION}\n'
        ))
        self.assertEqual(len(backups), 1)
        stop = calls.index(('stop', 'app'))
        start = calls.index(('up', '-d', '--no-deps', '--force-recreate', 'api', 'web'))
        self.assertLess(stop, start)
        self.assertNotIn('down', [part for call in calls for part in call])

    def test_healthy_release_records_previous_and_backup(self):
        current,previous,calls,error,backups=self.exercise([True])
        self.assertIsNone(error)
        self.assertIn(DIGEST.encode(),current)
        self.assertEqual(len(backups),1)
        self.assertEqual(sum('app' in call for call in calls),1)

    def test_failed_pair_restores_legacy_without_reversing_schema(self):
        current, previous, calls, error, _ = self.exercise([False, True], web_digest=WEB_DIGEST)
        self.assertEqual(current, previous)
        self.assertIn('previous image restored', str(error))
        self.assertIn(('stop', 'api', 'web'), calls)
        self.assertEqual(calls[-1], ('up', '-d', '--no-deps', '--force-recreate', 'app'))
        self.assertEqual(sum('migrator' in call for call in calls), 1)
        self.assertFalse(any('down' in call for call in calls))

    def test_failed_pair_restores_both_previous_images(self):
        old_web = 'sha256:' + 'f' * 64
        current, previous, calls, error, _ = self.exercise([False, True], web_digest=WEB_DIGEST, old_web_digest=old_web)
        self.assertEqual(current, previous)
        self.assertIn(old_web.encode(), current)
        self.assertIn('previous image restored', str(error))
        self.assertEqual(calls[-1], ('up', '-d', '--no-deps', '--force-recreate', 'api', 'web'))
        self.assertEqual(sum('migrator' in call for call in calls), 1)

    def test_candidate_stop_failure_removes_only_candidate_containers_before_restoring(self):
        current, previous, calls, error, _ = self.exercise([False, True], web_digest=WEB_DIGEST, candidate_stop_fails=True)
        self.assertEqual(current, previous)
        self.assertIn('previous image restored', str(error))
        self.assertEqual(calls[-2:], [('rm', '--stop', '--force', 'api', 'web'),
                                     ('up', '-d', '--no-deps', '--force-recreate', 'app')])
        self.assertFalse(any('down' in call or '--volumes' in call for call in calls))

    def test_unstoppable_candidate_reports_recovery_failure_without_starting_other_writers(self):
        current, previous, calls, error, _ = self.exercise([False], web_digest=WEB_DIGEST, candidate_stop_fails=True, candidate_remove_fails=True)
        self.assertNotEqual(current, previous)
        self.assertIn('could not stop candidate services; manual recovery required', str(error))
        self.assertEqual(calls[-1], ('rm', '--stop', '--force', 'api', 'web'))
        self.assertNotIn(('up', '-d', '--no-deps', '--force-recreate', 'app'), calls)

    def test_mismatched_web_revision_is_rejected_before_backup_or_activation(self):
        current, previous, calls, error, backups = self.exercise([], web_digest=WEB_DIGEST, web_revision=OLD_REVISION)
        self.assertEqual(current, previous)
        self.assertIn('source revision mismatch', str(error))
        self.assertEqual(calls, [])
        self.assertEqual(backups, [])

    def test_failed_readiness_restores_previous_image(self):
        current,previous,calls,error,_=self.exercise([False,True])
        self.assertEqual(current,previous)
        self.assertIn('previous image restored',str(error))
        self.assertEqual(sum('app' in call for call in calls),2)

    def test_failed_migration_never_replaces_running_app(self):
        current,previous,calls,error,_=self.exercise([],migrate_fails=True)
        self.assertEqual(current,previous)
        self.assertIsNotNone(error)
        self.assertFalse(any('app' in call for call in calls))

    def test_frozen_rejects_all_operations(self):
        current,previous,calls,error,_=self.exercise([],frozen=True)
        self.assertEqual(current,previous)
        self.assertEqual(calls,[])
        self.assertIn('frozen',str(error))

    def test_wrong_architecture_is_rejected(self):
        current,previous,calls,error,_=self.exercise([],architecture='arm64')
        self.assertEqual(current,previous)
        self.assertEqual(calls,[])
        self.assertIn('architecture',str(error))

if __name__ == '__main__': unittest.main()
