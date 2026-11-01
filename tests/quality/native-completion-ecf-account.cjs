const test = require('node:test');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

test('current iPhone account consumer rejects provenance changes and preserves preboot verification order', () => {
  execFileSync('python3', ['-c', String.raw`
import copy, hashlib, importlib.util, json, pathlib, tempfile, types, unittest
from unittest.mock import patch
root = pathlib.Path.cwd()
spec = importlib.util.spec_from_file_location('account', root / 'scripts/quality/completion-ios-ecf-account.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
binding = json.loads((root / 'scripts/quality/completion-ios-ecf-account.json').read_text())
manifest = json.loads((root / 'tests/native/audit/manifest.json').read_text())

class CurrentAccountBoundary(unittest.TestCase):
    def test_binding_accepts_only_current_producer(self):
        self.assertEqual(m.validate_binding(binding), binding)
        for key, invalid in [('applicationSourceCommit', m.JOURNEY.SOURCE), ('applicationSourceTree', m.JOURNEY.TREE),
                             ('producerRunId', m.JOURNEY.PRODUCER_RUN), ('producerArtifactId', 13065158785),
                             ('producerArtifactZipBytes', True), ('ready', False), ('schemaVersion', True),
                             ('appArchiveSha256', '0'*63), ('sourceReceiptSha256', None)]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                m.validate_binding({**binding, key: invalid})
        with self.assertRaises(ValueError):
            m.validate_binding({**binding, 'unexpected': True})

    def test_exact_original_account_partition(self):
        cases = m.selected_cases(manifest)
        self.assertEqual(len(cases), 27)
        self.assertIn('memory-capture-session', {case['id'] for case in cases})
        self.assertEqual({case['group'] for case in cases}, m.ACCOUNT_GROUPS)
        bad = copy.deepcopy(manifest)
        bad['cases'].pop()
        with self.assertRaises(ValueError): m.selected_cases(bad)
        bad = copy.deepcopy(manifest)
        bad['cases'][-1]['id'] = bad['cases'][0]['id']
        with self.assertRaises(ValueError): m.selected_cases(bad)

    def test_changed_source_path_and_alias_fail_before_execution(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = pathlib.Path(temporary)
            target = base / 'source.py'
            target.write_bytes(b'original')
            digest = hashlib.sha256(target.read_bytes()).hexdigest()
            source = {'hashes': {'source.py': digest}, 'audit': {'inputs': {'source.py': digest}}}
            self.assertEqual(m.verify_source_inputs(base, source), {'sourceInputs': 1, 'auditInputs': 1})
            target.write_bytes(b'changed')
            with self.assertRaises(ValueError): m.verify_source_inputs(base, source)
            target.write_bytes(b'original')
            (base / 'alias.py').symlink_to(target)
            for name in ['alias.py', '../source.py', str(target)]:
                with self.subTest(name=name), self.assertRaises(ValueError):
                    m.verify_source_inputs(base, {'hashes': {name: digest}, 'audit': {'inputs': {}}})
            with self.assertRaises(ValueError):
                m.verify_source_inputs(base, {'hashes': {'source.py': digest}, 'audit': {'inputs': {'source.py': 'f'*64}}})

    def test_immutable_checks_precede_owned_boot_and_no_postboot_query(self):
        events = []
        device = '24DB076B-2743-48CB-9F0F-ADC0E5C9C22A'
        producer = {'applicationSourceCommit': m.SOURCE, 'applicationSourceTree': m.TREE}
        prepared = {'device': device, 'sourceCommit': m.SOURCE, 'bootReady': True}
        def immutable(*args):
            self.assertEqual(events, [])
            events.append('immutable')
            return {'verified': True}
        def prepare(*args):
            self.assertEqual(events, ['immutable'])
            events.append('owned-create-and-boot')
            return prepared
        def runtime(actual, selected, receipt):
            self.assertEqual((actual, selected, receipt), (producer, device, prepared))
            self.assertEqual(events, ['immutable', 'owned-create-and-boot'])
            events.append('pure-receipt-verification')
            return {'postbootMetadataRead': False}
        helper = types.SimpleNamespace(verify_setup_immutable=immutable,
            compatibility_module=types.SimpleNamespace(verify_prepared_booted_runtime=runtime))
        created = types.SimpleNamespace(validate_device_identifier=lambda value: value)
        with patch.object(m.JOURNEY, 'prepare_simulator', prepare):
            result, proof = m.prepare_bound_device(pathlib.Path('app'), producer, object(), created, helper, [], pathlib.Path('setup'))
        self.assertEqual(result, prepared)
        self.assertEqual(events, ['immutable', 'owned-create-and-boot', 'pure-receipt-verification'])
        self.assertIs(proof['bootedRuntime']['postbootMetadataRead'], False)
        with self.assertRaises(ValueError):
            m.prepare_bound_device(pathlib.Path('app'), {**producer, 'applicationSourceCommit': m.JOURNEY.SOURCE}, object(), created, helper, [], pathlib.Path('setup'))

    def test_immutable_failure_cannot_create_a_device(self):
        producer = {'applicationSourceCommit': m.SOURCE, 'applicationSourceTree': m.TREE}
        def failed(*args): raise ValueError('wrong immutable SDK')
        helper = types.SimpleNamespace(verify_setup_immutable=failed)
        with patch.object(m.JOURNEY, 'prepare_simulator') as creation, self.assertRaises(ValueError):
            m.prepare_bound_device(pathlib.Path('app'), producer, object(), object(), helper, [], pathlib.Path('setup'))
        creation.assert_not_called()

    def test_partial_execution_remains_partial(self):
        cases = m.selected_cases(manifest)
        with tempfile.TemporaryDirectory() as temporary:
            path = pathlib.Path(temporary) / 'results.json'
            self.assertEqual(m.case_accounting(path, cases)['notAttempted'], 27)
            rows = [{'id': cases[0]['id'], 'attempts': 1, 'status': 'passed'},
                    {'id': cases[1]['id'], 'attempts': 1, 'status': 'running'}]
            path.write_text(json.dumps(rows))
            self.assertEqual(m.case_accounting(path, cases),
                {'expected': 27, 'attempted': 2, 'passed': 1, 'failed': 0, 'unfinished': 1, 'notAttempted': 25})
            rows[1]['attempts'] = 2
            path.write_text(json.dumps(rows))
            with self.assertRaises(ValueError): m.case_accounting(path, cases)
            rows[1]['attempts'] = True
            path.write_text(json.dumps(rows))
            with self.assertRaises(ValueError): m.case_accounting(path, cases)
            rows[1] = rows[0]
            path.write_text(json.dumps(rows))
            with self.assertRaises(ValueError): m.case_accounting(path, cases)

    def test_invalid_prepared_proof_cleans_up_only_its_created_device(self):
        device = '24DB076B-2743-48CB-9F0F-ADC0E5C9C22A'
        producer = {'applicationSourceCommit': m.SOURCE, 'applicationSourceTree': m.TREE}
        cleanup = []
        def failed(*args): raise ValueError('bad prepared proof')
        helper = types.SimpleNamespace(verify_setup_immutable=lambda *args: {},
            compatibility_module=types.SimpleNamespace(verify_prepared_booted_runtime=failed),
            setup_read=lambda args, stage, timeout, *rest: cleanup.append((args, timeout)),
            atomic_json=lambda *args: None)
        created = types.SimpleNamespace(validate_device_identifier=lambda value: value)
        with patch.object(m.JOURNEY, 'prepare_simulator', return_value={'device': device}), self.assertRaises(ValueError):
            m.prepare_bound_device(pathlib.Path('app'), producer, object(), created, helper, [], pathlib.Path('setup'))
        self.assertEqual(cleanup, [(['xcrun', 'simctl', operation, device], 20) for operation in ['shutdown', 'delete']])

unittest.main(argv=['current-account'], verbosity=2)
`], { cwd: path.resolve(__dirname, '../..'), stdio: 'inherit' });
});
