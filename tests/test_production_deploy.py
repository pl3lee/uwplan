import importlib.util
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

class DeploymentTests(unittest.TestCase):
    def test_rejects_arbitrary_commands_and_injection(self):
        for command in ['bash', 'deploy latest main', f'deploy {DIGEST} {REVISION};id', f'deploy evil/repo@{DIGEST} {REVISION}', f'deploy {DIGEST} {REVISION} extra']:
            with self.subTest(command=command), self.assertRaises(ValueError):
                deploy.parse_command(command)
        self.assertEqual(deploy.parse_command(f'deploy {DIGEST} {REVISION}'), (DIGEST, REVISION))

    def exercise(self, ready_results, migrate_fails=False, frozen=False, architecture='amd64'):
        with tempfile.TemporaryDirectory() as temporary:
            state = Path(temporary)
            release = state/'release.env'
            previous = f'UWPLAN_IMAGE={deploy.REPOSITORY}@{OLD_DIGEST}\nRELEASE_DIGEST={OLD_DIGEST}\nRELEASE_REVISION={OLD_REVISION}\n'.encode()
            release.write_bytes(previous)
            if frozen: (state/'frozen').touch()
            calls=[]
            def compose(env, *args):
                calls.append(args)
                if 'migrator' in args and migrate_fails: raise RuntimeError('migration rejected')
                return SimpleNamespace(stdout=b'backup')
            def run(args):
                return SimpleNamespace(stdout=json.dumps([{'Architecture':architecture, 'Config':{'Labels':{'org.opencontainers.image.revision':REVISION}}}]).encode())
            with patch.multiple(deploy, STATE=state, RELEASE=release), patch.object(deploy,'compose',side_effect=compose), patch.object(deploy,'run',side_effect=run), patch.object(deploy,'ready',side_effect=ready_results):
                error=None
                try: deploy.deploy(DIGEST,REVISION)
                except Exception as caught: error=caught
            return release.read_bytes(), previous, calls, error, list((state/'backups').glob('*.dump'))

    def test_healthy_release_records_previous_and_backup(self):
        current,previous,calls,error,backups=self.exercise([True])
        self.assertIsNone(error)
        self.assertIn(DIGEST.encode(),current)
        self.assertEqual(len(backups),1)
        self.assertEqual(sum('app' in call for call in calls),1)

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
