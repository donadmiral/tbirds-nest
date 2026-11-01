"""One first launch on a proven fresh owned Simulator, with all UI checks intact."""
import hashlib
import math
from pathlib import Path
import re
import subprocess
import time

SOURCE = 'f5be97445ef7223baeb60dd10e8cded05630b6c1'
TREE = 'f54e192c3ef721d0207d840382f176185c8c4f5a'
FLOW = 'tests/native/diagnostics/ios-warm-reader-controls.yaml'
FLOW_SHA = '044a6809310e7e2344331491f8308b0a83ef3cb2e0127dd0c4c4792d9673c22f'
SIGNIN = 'tests/native/audit/flows/_signin.yaml'
SIGNIN_SHA = '847857016d5651ef0cfe7d57747c5ef3a08ad3e837492aa4b2f7fa250125993a'
REFERENCE = '../../../../baseline/tests/native/audit/flows/_signin.yaml'
FRESH_REFERENCE = '_fresh-owned-signin.yaml'
IOS_ORIGINAL = '      platform: iOS\n    commands:\n      - launchApp:\n          clearState: true\n          clearKeychain: true\n'
IOS_FRESH = IOS_ORIGINAL.replace('clearState: true', 'clearState: false')
STAGES = [
    ('compatibility-host-architecture', 30), ('compatibility-xcode-version', 30),
    ('compatibility-simulator-sdk', 30), ('compatibility-actual-mach-o', 30),
    ('compatibility-app-signature', 30), ('create-owned-device', 120),
    ('compatibility-available-runtimes', 30), ('compatibility-created-device', 30),
    ('boot', 120), ('bootstatus', 300), ('install', 120),
]


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def verify_first_install(manifest, prepared, records, helper):
    """Accept only this consumer's successful create/boot/first-install order."""
    if (manifest.get('applicationSourceCommit') != SOURCE
            or manifest.get('applicationSourceTree') != TREE
            or not isinstance(prepared, dict)
            or not re.fullmatch(r'Platinum completion [0-9a-f]{32}', prepared.get('name', ''))
            or not isinstance(records, list)
            or [(row.get('stage'), row.get('timeoutSeconds')) for row in records] != STAGES):
        raise ValueError('A unique owned device and exactly one original first install are required')
    ready = helper.compatibility_module.verify_prepared_booted_runtime(
        manifest, prepared.get('device'), prepared)
    previous = 0
    for row, (_, seconds) in zip(records, STAGES):
        start, end, elapsed = row.get('startedAtEpochMs'), row.get('finishedAtEpochMs'), row.get('elapsedSeconds')
        if (row.get('status') != 'completed' or type(row.get('exitCode')) is not int
                or row['exitCode'] != 0 or type(row.get('timeoutSeconds')) is not int
                or type(start) is not int or type(end) is not int
                or start < previous or end < start
                or type(elapsed) not in (int, float) or not math.isfinite(elapsed) or elapsed < 0):
            raise ValueError('Every actual setup and first-install command must have succeeded in order')
        previous = end
    if records[5].get('stdoutTail', '').strip() != prepared['device']:
        raise ValueError('The successful creation command must return the exact selected UUID')
    return ready


def prepare(tools_root, baseline, output, manifest, prepared, records, helper):
    """Materialize only the reviewed one-value change, never modify the baseline."""
    tools_root, baseline, output = Path(tools_root), Path(baseline), Path(output)
    ready = verify_first_install(manifest, prepared, records, helper)
    original_flow, original_signin = tools_root / FLOW, baseline / SIGNIN
    if digest(original_flow) != FLOW_SHA or digest(original_signin) != SIGNIN_SHA:
        raise ValueError('Both complete original diagnostic and sign-in files are required')
    if (original_flow.parent / REFERENCE).resolve(strict=True) != original_signin.resolve(strict=True):
        raise ValueError('The original flow must resolve to the separate exact baseline')
    flow, signin = original_flow.read_text(), original_signin.read_text()
    include = '- runFlow: ' + REFERENCE
    if flow.count(include) != 1 or signin.count(IOS_ORIGINAL) != 1:
        raise ValueError('Only the original first iOS launch may be adapted')
    execution_root = output / 'fresh-first-launch'
    execution_root.mkdir(exist_ok=False)
    executed_flow = execution_root / FLOW
    executed_flow.parent.mkdir(parents=True)
    executed_signin = executed_flow.parent / FRESH_REFERENCE
    executed_signin.write_text(signin.replace(IOS_ORIGINAL, IOS_FRESH, 1))
    executed_flow.write_text(flow.replace(include, '- runFlow: ' + FRESH_REFERENCE, 1))
    install = records[-1]
    record = {
        'schemaVersion': 1, 'kind': 'fresh-owned-device-first-sign-in',
        'applicationSourceCommit': SOURCE, 'applicationSourceTree': TREE,
        'binarySha256': manifest['binarySha256'], 'selectedDevice': prepared['device'],
        'ownedDeviceName': prepared['name'], 'readiness': ready,
        'firstInstall': dict(install), 'fullInstallStageWallSeconds':
            (install['finishedAtEpochMs'] - install['startedAtEpochMs']) / 1000,
        'innerTimerIncludesPopen': False, 'inclusive120SecondWallTimeClaimed': False,
        'originalFlow': FLOW, 'originalFlowSha256': FLOW_SHA,
        'executedFlowSha256': digest(executed_flow),
        'originalSignIn': SIGNIN, 'originalSignInSha256': SIGNIN_SHA,
        'executedSignInSha256': digest(executed_signin),
        'changes': ['First iOS launch clearState true to false',
                    'Resolve the original journey include to that disposable sign-in copy'],
        'clearKeychainPreserved': True, 'permissionsAndSignInAssertionsPreserved': True,
        'navigationAndReaderAssertionsPreserved': True,
        'wholeCliWatchdogSeconds': 600, 'readerDeadlineMs': 15000,
        'messagesFrameLimitMs': 1000, 'countedInBaseline85': False,
        'used': False,
        'scope': 'This one first launch follows successful creation, preboot identity checks, exact-UUID '
                 'bootstatus and the first app install. It omits only the duplicate iOS uninstall/reinstall. '
                 'Between-case isolation and all UI assertions remain unchanged.',
    }
    helper.atomic_json(output / 'fresh-first-signin.json', record)
    return {'record': record, 'executionRoot': execution_root,
            'originalFlow': original_flow, 'originalSignIn': original_signin,
            'executedFlow': executed_flow, 'executedSignIn': executed_signin}


def verify_files(state):
    record = state['record']
    for path, expected in [(state['originalFlow'], FLOW_SHA), (state['originalSignIn'], SIGNIN_SHA),
                           (state['executedFlow'], record['executedFlowSha256']),
                           (state['executedSignIn'], record['executedSignInSha256'])]:
        if digest(path) != expected:
            raise ValueError('Original or disposable first-launch source changed')
    original_flow, copied_flow = state['originalFlow'].read_text(), state['executedFlow'].read_text()
    original_signin, copied_signin = state['originalSignIn'].read_text(), state['executedSignIn'].read_text()
    if (copied_flow.replace('- runFlow: ' + FRESH_REFERENCE, '- runFlow: ' + REFERENCE, 1) != original_flow
            or copied_signin.replace(IOS_FRESH, IOS_ORIGINAL, 1) != original_signin
            or (state['executedFlow'].parent / FRESH_REFERENCE).resolve(strict=True)
               != state['executedSignIn'].resolve(strict=True)):
        raise ValueError('The execution copy may differ only at the reviewed first-launch boundary')


def run(state, diagnostic, helper, runner, execute, baseline, output, device, scenarios, budget):
    """Reuse the original diagnostic with explicit executed-source provenance."""
    record = state['record']
    if record['used'] or device != record['selectedDevice']:
        raise ValueError('A first-launch exemption is one-use and belongs to its exact device')
    verify_files(state)
    execution_root = state['executionRoot']
    original_verify, original_sha = diagnostic.verify_direct_reader_flow, diagnostic.WARM_CONTROLS_SHA
    if diagnostic.WARM_CONTROLS_FLOW != FLOW or original_sha != FLOW_SHA:
        raise ValueError('The original diagnostic identity must remain unchanged')

    def verify_copied_flow(root, source, relative, expected_sha):
        if (Path(root) != execution_root or Path(source) != Path(baseline) or relative != FLOW
                or expected_sha != record['executedFlowSha256']):
            raise ValueError('Unexpected first-launch flow verification request')
        verify_files(state)
        return {'reference': FRESH_REFERENCE, 'baselinePath': SIGNIN,
                'originalSha256': SIGNIN_SHA, 'sha256': record['executedSignInSha256'],
                'resolvedBeforeMaestro': True, 'freshOwnedFirstInstall': True,
                'clearState': False, 'clearKeychain': True}

    def execute_once(command, **options):
        target = Path(output) / 'diagnostic-warm-reader-controls'
        expected = ['maestro', '--device', device, 'test', '--format', 'junit',
                    '--output', str(target / 'junit.xml'), '--debug-output', str(target / 'maestro'),
                    '--test-output-dir', str(target / 'maestro'), FLOW]
        if (record['used'] or command != expected or set(options) != {'timeout', 'cwd', 'stdout', 'stderr'}
                or type(options['timeout']) is not int or options['timeout'] != 600
                or Path(options['cwd']) != execution_root or options['stderr'] != subprocess.STDOUT):
            raise ValueError('Only one original full journey within its unchanged watchdog is permitted')
        verify_files(state)
        record['used'] = True
        record['attemptedAtEpochMs'] = round(time.time() * 1000)
        helper.atomic_json(Path(output) / 'fresh-first-signin.json', record)
        try:
            return execute(command, **options)
        finally:
            verify_files(state)
            record['sourceUnchangedAfterAttempt'] = True
            helper.atomic_json(Path(output) / 'fresh-first-signin.json', record)

    try:
        diagnostic.verify_direct_reader_flow = verify_copied_flow
        diagnostic.WARM_CONTROLS_SHA = record['executedFlowSha256']
        result = diagnostic.run_warm_reader_controls_diagnostic(helper, runner, execute_once,
            baseline, execution_root, output, device, scenarios, budget)
        result['freshFirstSignIn'] = record
        helper.atomic_json(Path(output) / 'diagnostic-warm-reader-controls/result.json', result)
        return result
    finally:
        diagnostic.verify_direct_reader_flow = original_verify
        diagnostic.WARM_CONTROLS_SHA = original_sha
