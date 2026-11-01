#!/usr/bin/env python3
"""Verify the original tab-to-reader path in the exact fresh completion app."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import uuid

SOURCE = 'f5be97445ef7223baeb60dd10e8cded05630b6c1'
TREE = 'f54e192c3ef721d0207d840382f176185c8c4f5a'
PRODUCER_RUN = 41259529351
RUNNER_SHA = '2eebacb4baca5b5231367c749fba465e13235c85a1d8dee4b5503eb72dbde3b4'
BINDING_FIELDS = {
    'schemaVersion', 'ready', 'applicationSourceCommit', 'applicationSourceTree',
    'producerRunId', 'producerArtifactName', 'producerArtifactId',
    'producerArtifactZipSha256', 'producerArtifactZipBytes', 'appArchiveSha256',
    'binaryManifestSha256', 'binarySha256', 'sourceReceiptSha256',
}


def digest(path):
    value = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for part in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(part)
    return value.hexdigest()


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def validate_binding(value):
    if not isinstance(value, dict) or set(value) != BINDING_FIELDS:
        raise ValueError('An exact verified completion producer binding is required')
    expected = {'schemaVersion': 1, 'ready': True, 'applicationSourceCommit': SOURCE,
                'applicationSourceTree': TREE, 'producerRunId': PRODUCER_RUN,
                'producerArtifactName': 'native-audit-ios-binary'}
    if any(type(value.get(key)) is not type(item) or value.get(key) != item for key, item in expected.items()):
        raise ValueError('The fresh completion producer does not match or is not ready')
    for key in ['producerArtifactId', 'producerArtifactZipBytes']:
        if type(value[key]) is not int or value[key] <= 0:
            raise ValueError('A verified positive artifact identity and byte size are required')
    for key in ['producerArtifactZipSha256', 'appArchiveSha256', 'binaryManifestSha256',
                'binarySha256', 'sourceReceiptSha256']:
        if not isinstance(value[key], str) or not re.fullmatch('[0-9a-f]{64}', value[key]):
            raise ValueError('Every digest must come from independently verified producer bytes')
    return value


def verify_download(binary_dir, binding, scenario_manifest):
    validate_binding(binding)
    for name, key in [('source.json', 'sourceReceiptSha256'),
                      ('binary-manifest.json', 'binaryManifestSha256'),
                      ('qa.app.tar.gz', 'appArchiveSha256')]:
        if digest(binary_dir / name) != binding[key]:
            raise ValueError('The downloaded producer file differs: ' + name)
    manifest = json.loads((binary_dir / 'binary-manifest.json').read_text())
    expected = {'applicationSourceCommit': SOURCE, 'applicationSourceTree': TREE,
                'platform': 'ios', 'binarySha256': binding['binarySha256'],
                'sourceReceiptSha256': binding['sourceReceiptSha256'],
                'auditManifestSha256': digest(scenario_manifest)}
    if any(manifest.get(key) != value for key, value in expected.items()):
        raise ValueError('The producer manifest does not match the reviewed completion source')
    source = json.loads((binary_dir / 'source.json').read_text())
    if (source.get('commit') != SOURCE or source.get('workflowRun') != str(PRODUCER_RUN)
            or source.get('audit', {}).get('applicationSourceCommit') != SOURCE):
        raise ValueError('The retained source receipt does not bind the exact producer')
    return manifest


def prepare_simulator(manifest, starter, created, helper, records, output):
    """Create one owned pinned device before querying cold service metadata."""
    startup = load_module('completion_cold_startup', Path(__file__).with_name('completion-ios-startup-diagnostics.py'))
    expected = manifest.get('nativeCompatibility', {})
    if (expected.get('abi') != 'x86_64' or expected.get('runtimeIdentifier') != created.RUNTIME
            or starter.RUNTIME != created.RUNTIME or starter.DEVICE_TYPE != created.DEVICE_TYPE):
        raise ValueError('Only the original Intel iPhone16/iOS18.5 device may be created')
    name = 'Platinum completion ' + uuid.uuid4().hex
    command = ['xcrun', 'simctl', 'create', name, created.DEVICE_TYPE, created.RUNTIME]
    # Successful retained jobs created a device before metadata, using this
    # same 120s budget. A cold create previously took 42.69s; the new first
    # 30s inventory read failed while its client was still awaiting a response.
    device = created.validate_device_identifier(startup.observed_read(command, 120,
        lambda args, seconds: helper.setup_read(args, 'create-owned-device', seconds, records, output),
        lambda: startup.capture_startup(helper, Path(output).parent / 'cold-startup')))
    ownership = {'device': device, 'created': True, 'name': name,
                 'deviceTypeIdentifier': created.DEVICE_TYPE, 'runtimeIdentifier': created.RUNTIME,
                 'sourceCommit': manifest.get('applicationSourceCommit')}
    helper.atomic_json(Path(output).parent / 'device-ownership.json', ownership)
    def metadata(command):
        stage = 'compatibility-available-runtimes' if command[3] == 'runtimes' else 'compatibility-created-device'
        return helper.setup_read(command, stage, 30, records, output)
    try:
        verification = created.verify_created_device(manifest, device, metadata)
        helper.setup_read(['xcrun', 'simctl', 'boot', device], 'boot', 120, records, output)
        helper.setup_read(['xcrun', 'simctl', 'bootstatus', device, '-b'], 'bootstatus', 300, records, output)
    except BaseException:
        ownership['cleanupAfterSetupFailure'] = []
        for operation in ['shutdown', 'delete']:
            try:
                helper.setup_read(['xcrun', 'simctl', operation, device], operation, 20, records, output)
                ownership['cleanupAfterSetupFailure'].append({'operation': operation, 'completed': True})
            except (OSError, ValueError, subprocess.SubprocessError) as error:
                ownership['cleanupAfterSetupFailure'].append({'operation': operation, 'completed': False,
                                                              'issue': type(error).__name__})
        helper.atomic_json(Path(output).parent / 'device-ownership.json', ownership)
        raise
    return {**ownership, 'verification': verification, 'bootReady': True}


def verify_selected_booted_runtime(manifest, prepared, created, helper, records, output):
    """Read live identity/version from the exact already-verified owned device."""
    device = created.validate_device_identifier(prepared.get('device'))
    expected = manifest.get('nativeCompatibility', {})
    verified = prepared.get('verification', {})
    if (manifest.get('applicationSourceCommit') != SOURCE
            or expected.get('abi') != 'x86_64' or expected.get('runtimeIdentifier') != created.RUNTIME
            or prepared.get('created') is not True or prepared.get('bootReady') is not True
            or prepared.get('sourceCommit') != manifest.get('applicationSourceCommit')
            or prepared.get('runtimeIdentifier') != created.RUNTIME
            or prepared.get('deviceTypeIdentifier') != created.DEVICE_TYPE
            or verified.get('selectedDevice') != device
            or verified.get('runtimeIdentifier') != created.RUNTIME
            or verified.get('runtimeVersion') != created.VERSION
            or verified.get('deviceTypeIdentifier') != created.DEVICE_TYPE
            or verified.get('runtimeAvailabilityVerified') is not True
            or verified.get('stateAtVerification') != 'Shutdown'):
        raise ValueError('Exact owned-device metadata and completed boot readiness are required')
    if any(name in os.environ for name in
           ['SIMCTL_CHILD_SIMULATOR_UDID', 'SIMCTL_CHILD_SIMULATOR_RUNTIME_VERSION']):
        raise ValueError('Caller overrides cannot supply the Simulator identity or runtime evidence')
    startup = load_module('completion_live_runtime', Path(__file__).with_name('completion-ios-startup-diagnostics.py'))
    actual = {}
    for variable, expected_value in [('SIMULATOR_UDID', device), ('SIMULATOR_RUNTIME_VERSION', created.VERSION)]:
        stage = 'postboot-' + variable.lower()
        actual[variable] = startup.observed_read(['xcrun', 'simctl', 'getenv', device, variable], 30,
            lambda command, seconds: helper.setup_read(command, stage, seconds, records, output),
            lambda: startup.capture_startup(helper, Path(output).parent / stage))
        if actual[variable] != expected_value:
            raise ValueError('The live selected Simulator ' + variable + ' differs')
    return {'runtimeIdentifier': created.RUNTIME, 'runtimeVersion': actual['SIMULATOR_RUNTIME_VERSION'],
            'selectedDevice': actual['SIMULATOR_UDID'], 'deviceTypeIdentifier': created.DEVICE_TYPE,
            'prebootRuntimeAvailabilityVerified': True, 'exactUuidBootstatusCompleted': True,
            'postbootIdentityAndVersionReadFromDevice': True, 'globalInventoryRepeatedAfterBoot': False,
            'guestArchitectureMeasured': False,
            'scope': 'Pinned runtime/type/availability verified before boot; bootstatus completed for that owned UUID; live running-device UDID and runtime version then matched exactly. Host/app ABI is checked separately. App launch remains required.'}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--artifact-id', action='store_true')
    parser.add_argument('--baseline', type=Path)
    parser.add_argument('--consumer-source')
    args = parser.parse_args()
    tools_root = Path(__file__).resolve().parents[2]
    binding = validate_binding(json.loads(Path(__file__).with_suffix('.json').read_text()))
    if args.artifact_id:
        print(binding['producerArtifactId'])
        return 0
    if (os.environ.get('CI') != 'true' or os.environ.get('EXPO_PUBLIC_APP_ENV') != 'qa'
            or os.environ.get('EXPO_PUBLIC_SUPABASE_URL') != 'https://uaulhuelcfkjwojtymmw.supabase.co'
            or os.environ.get('EXPO_PUBLIC_SUPABASE_ANON_KEY') != 'native-ui-synthetic-no-provider-key'):
        raise ValueError('Only the disposable synthetic QA Simulator is permitted')
    if args.baseline is None or not re.fullmatch('[0-9a-f]{40}', args.consumer_source or ''):
        parser.error('An exact original source checkout and consumer commit are required')
    baseline = args.baseline.resolve(strict=True)
    def git(folder, revision):
        return subprocess.check_output(['git', '-C', str(folder), 'rev-parse', revision], text=True, timeout=30).strip()
    if git(baseline, 'HEAD') != SOURCE or git(baseline, 'HEAD^{tree}') != TREE or git(tools_root, 'HEAD') != args.consumer_source:
        raise ValueError('Source or consumer checkout identity differs')
    scripts = baseline / 'scripts/quality'
    if digest(scripts / 'native-ui-audit-runner.py') != RUNNER_SHA:
        raise ValueError('The original source-bound audit runner changed')
    runner = load_module('completion_original_runner', scripts / 'native-ui-audit-runner.py')
    diagnostic = load_module('completion_original_journey', tools_root / 'scripts/quality/native-ui-ios-d46-recovery.py')
    helper = diagnostic.load_helpers(tools_root / 'scripts/quality')
    starter = load_module('completion_device_starter', scripts / 'native-ui-start-ios-device.py')
    created = load_module('completion_created_device', scripts / 'native-ui-ios-created-device.py')
    timing = load_module('completion_app_timing', tools_root / 'docs/quality/completion-20261101/native_runtime_analysis.py')
    binary_dir = baseline / 'native-audit-binary'
    scenario_manifest = baseline / 'tests/native/audit/manifest.json'
    manifest = verify_download(binary_dir, binding, scenario_manifest)
    diagnostic.verify_direct_reader_flow(tools_root, baseline, diagnostic.WARM_CONTROLS_FLOW, diagnostic.WARM_CONTROLS_SHA)
    app = helper.extract_app(binary_dir / 'qa.app.tar.gz', binary_dir)
    runner.validate_binary(manifest, app, 'ios', SOURCE, TREE)
    output = baseline / 'native-completion-results'
    output.mkdir(exist_ok=False)
    shutil.copyfile(binary_dir / 'binary-manifest.json', output / 'binary-manifest.json')
    records = []
    setup = output / 'setup-commands.json'
    proof = {'kind': 'source-bound-original-navigation-and-reader', 'applicationSourceCommit': SOURCE,
             'applicationSourceTree': TREE, 'producerRunId': PRODUCER_RUN, 'producerBinding': binding,
             'consumerSourceCommit': args.consumer_source, 'consumerRunId': os.environ.get('GITHUB_RUN_ID'),
             'rebuild': False, 'rebundle': False, 'resign': False, 'countedInBaseline85': False,
             'passed': False}
    device = None
    logger = None
    result = 1
    try:
        proof['immutableCompatibility'] = helper.verify_setup_immutable(app, manifest, records, setup)
        def metadata(command, timeout):
            return helper.setup_read(command, 'simulator-setup', timeout, records, setup)
        prepared = prepare_simulator(manifest, starter, created, helper, records, setup)
        device = prepared['device']
        helper.atomic_json(output / 'device-setup.json', prepared)
        proof['bootedRuntime'] = verify_selected_booted_runtime(manifest, prepared, created, helper, records, setup)
        metadata(['xcrun', 'simctl', 'install', device, str(app)], 120)
        with (output / 'app.log').open('wb') as log:
            logger = subprocess.Popen(['xcrun', 'simctl', 'spawn', device, 'log', 'stream', '--style', 'compact',
                '--level', 'info', '--predicate', 'process == "PlatinumQA"'], stdout=log, stderr=subprocess.STDOUT,
                start_new_session=True)
            os.chdir(baseline)
            observed = diagnostic.run_warm_reader_controls_diagnostic(helper, runner, runner.run_owned,
                baseline, tools_root, output, device, json.loads(scenario_manifest.read_text()), {'used': False})
            proof['diagnostic'] = observed
            timing_file = output / 'diagnostic-warm-reader-controls/native-ui-navigation-timing.json'
            proof['appTiming'] = timing.analyze_timing(json.loads(timing_file.read_text()),
                observed['startedAtEpochMs'], observed['finishedAtEpochMs'], expected_visits=1)
            command_files = [file for file in (output / 'diagnostic-warm-reader-controls/maestro').rglob('commands.json')
                             if file.parent.name == diagnostic.WARM_CONTROLS_NAME]
            if len(command_files) != 1:
                raise ValueError('Expected one complete original journey command trace')
            proof['readerTiming'] = timing.analyze_reader_commands(json.loads(command_files[0].read_text()),
                observed['startedAtEpochMs'], observed['finishedAtEpochMs'])
            runner.validate_binary(manifest, app, 'ios', SOURCE, TREE)
            verify_download(binary_dir, binding, scenario_manifest)
            subprocess.run(['git', '-C', str(baseline), 'diff', '--exit-code', 'HEAD', '--'], check=True,
                           stdout=subprocess.DEVNULL, timeout=30)
            proof['unchangedSourceAndBinaryAfterRun'] = True
            proof['passed'] = (observed['passed'] and proof['appTiming']['withinLimit']
                               and proof['readerTiming']['withinOriginalDeadline'])
            result = int(not proof['passed'])
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        proof['executionIssue'] = type(error).__name__
        proof['executionDetail'] = str(error)[:1000]
        raise
    finally:
        if logger is not None:
            helper.stop_group(logger)
        if device is not None:
            proof['cleanup'] = []
            for operation in ['shutdown', 'delete']:
                try:
                    helper.setup_read(['xcrun', 'simctl', operation, device], operation, 20, records, setup)
                    proof['cleanup'].append({'operation': operation, 'completed': True})
                except (OSError, ValueError, subprocess.SubprocessError) as error:
                    proof['cleanup'].append({'operation': operation, 'completed': False, 'issue': type(error).__name__})
        helper.atomic_json(output / 'completion-proof.json', proof)
    print(json.dumps({'passed': proof['passed'], 'applicationSourceCommit': SOURCE,
                      'originalJourneyPassed': proof.get('diagnostic', {}).get('passed'),
                      'appTiming': proof.get('appTiming')}, indent=2))
    return result


if __name__ == '__main__':
    raise SystemExit(main())
