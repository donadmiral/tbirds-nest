"""Set one documented Settings switch on this CI job's newly created Simulator.

The two phases share one monotonic deadline. No application flow, credential,
private preference, keychain or host setting is changed by this helper.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import signal
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
BUDGET_SECONDS = 300
MAX_OUTPUT_BYTES = 4 * 1024 * 1024
MAESTRO_VERSION = '2.11.0'
MAESTRO_SOURCE = 'c8c361be1cc89b2e742f185466a302a22778be6b'
IOS_DRIVER_BLOB = '8af50e6b65d983437cdd3f81fe2c20dc0b1a6cb9'
HIERARCHY_BLOB = '04e371a0118ff4f681bb916d8ffb6e383dc3ae1a'
SETTINGS_APP = 'com.apple.Preferences'
SETTING = 'AutoFill Passwords and Passkeys'
OPEN_FLOW = 'tests/native/flows/ios-autofill-open.yaml'
DISABLE_FLOW = 'tests/native/flows/ios-autofill-disable.yaml'
BOUND_FILES = (
    'scripts/quality/native-ui-ios-autofill.py', OPEN_FLOW, DISABLE_FLOW,
    'tests/quality/native-ios-autofill.cjs', 'scripts/quality/test-ios-app-ui.sh',
)
TARGETS = {
    'intel-ios18.5': ('x86_64', '18.5', 'com.apple.CoreSimulator.SimDeviceType.iPhone-16'),
    'arm64-ios26.2': ('arm64', '26.2', 'com.apple.CoreSimulator.SimDeviceType.iPhone-17'),
}


class PreflightError(Exception):
    """Only fixed, non-sensitive error codes enter the retained receipt."""


def require(condition, code):
    if not condition:
        raise PreflightError(code)


def digest(value):
    return hashlib.sha256(value).hexdigest()


def bounded_json(path):
    data = path.read_bytes()
    require(len(data) <= MAX_OUTPUT_BYTES, 'evidence_size_limit')
    return json.loads(data)


def write_json(path, value, exclusive=False):
    with path.open('x' if exclusive else 'w') as output:
        json.dump(value, output, indent=2, sort_keys=True)
        output.write('\n')


def context(root, env, system=None, machine=None):
    target = env.get('PLATINUM_NATIVE_IOS_TARGET', 'intel-ios18.5')
    require(target in TARGETS, 'unsupported_target')
    arch, version, device_type = TARGETS[target]
    require((system or platform.system()) == 'Darwin'
            and (machine or platform.machine()) == arch, 'unsupported_host')
    require(env.get('CI') == 'true' and env.get('EXPO_PUBLIC_APP_ENV') == 'qa'
            and env.get('EXPO_PUBLIC_SUPABASE_URL') == 'https://uaulhuelcfkjwojtymmw.supabase.co'
            and env.get('EXPO_PUBLIC_SUPABASE_ANON_KEY') == 'native-ui-synthetic-no-provider-key',
            'not_disposable_qa')
    source, run, attempt = (env.get(key, '') for key in ('GITHUB_SHA', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT'))
    require(re.fullmatch(r'[a-f0-9]{40}', source) is not None
            and re.fullmatch(r'[1-9][0-9]*', run) is not None
            and re.fullmatch(r'[1-9][0-9]*', attempt) is not None, 'missing_job_identity')
    source_path = root / 'native-ui-logs/source.json'
    proof = bounded_json(source_path)
    require(isinstance(proof, dict) and proof.get('commit') == source
            and proof.get('workflowRun') == run and isinstance(proof.get('hashes'), dict),
            'source_identity_mismatch')
    hashes = {file: digest((root / file).read_bytes()) for file in BOUND_FILES}
    require(all(proof['hashes'].get(file) == value for file, value in hashes.items()),
            'preflight_source_mismatch')
    return {'sourceCommit': source, 'workflowRun': run, 'workflowAttempt': attempt,
            'sourceReceiptSha256': digest(source_path.read_bytes()), 'sourceHashes': hashes,
            'target': target, 'architecture': arch, 'runtimeVersion': version,
            'runtimeIdentifier': 'com.apple.CoreSimulator.SimRuntime.iOS-' + version.replace('.', '-'),
            'deviceTypeIdentifier': device_type, 'name': 'Platinum full app UI ' + run}


def verify_identity(ctx, device, runtimes, devices, state):
    require(isinstance(device, str) and re.fullmatch(r'[A-Fa-f0-9]{8}(?:-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12}', device)
            is not None, 'invalid_device_uuid')
    require(isinstance(runtimes, dict) and isinstance(runtimes.get('runtimes'), list), 'invalid_runtime_inventory')
    runtime_rows = [row for row in runtimes['runtimes'] if isinstance(row, dict)
                    and row.get('identifier') == ctx['runtimeIdentifier']]
    require(len(runtime_rows) == 1 and runtime_rows[0].get('isAvailable') is True
            and runtime_rows[0].get('version') == ctx['runtimeVersion'], 'runtime_mismatch')
    require(isinstance(devices, dict) and isinstance(devices.get('devices'), dict), 'invalid_device_inventory')
    selected = []
    for runtime, rows in devices['devices'].items():
        require(isinstance(rows, list), 'invalid_device_inventory')
        selected.extend((runtime, row) for row in rows if isinstance(row, dict) and row.get('udid') == device)
    require(len(selected) == 1, 'ambiguous_device')
    runtime, row = selected[0]
    require(runtime == ctx['runtimeIdentifier'] and row.get('deviceTypeIdentifier') == ctx['deviceTypeIdentifier']
            and row.get('isAvailable') is True and row.get('state') == state
            and row.get('name') == ctx['name'], 'device_identity_mismatch')
    return {'device': device, 'name': row['name'], 'runtimeIdentifier': runtime,
            'runtimeVersion': ctx['runtimeVersion'], 'deviceTypeIdentifier': row['deviceTypeIdentifier'],
            'state': state, 'isAvailable': True}


def switch_state(tree):
    """Pinned Maestro maps native value separately from its false default flag.

    A matching static label has no native0/1 value. It cannot prove an off switch.
    Any second value-bearing match or unknown value makes the state ambiguous.
    """
    pending, controls, visited = [tree], [], 0
    while pending:
        node = pending.pop()
        visited += 1
        require(visited <= 20000 and isinstance(node, dict), 'invalid_hierarchy')
        attributes = node.get('attributes')
        children = node.get('children', [])
        require(isinstance(attributes, dict) and isinstance(children, list), 'invalid_hierarchy')
        pending.extend(children)
        if attributes.get('accessibilityText') != SETTING:
            continue
        value = attributes.get('value', '')
        require(value in ('', '0', '1'), 'unknown_switch_value')
        if value == '':
            continue
        controls.append((node, attributes, value))
    require(len(controls) == 1, 'missing_or_ambiguous_switch')
    node, attributes, value = controls[0]
    checked = value == '1'
    require(node.get('enabled') is True and attributes.get('enabled') == 'true', 'disabled_switch')
    require(node.get('checked') is checked and attributes.get('checked') == str(checked).lower(),
            'inconsistent_switch_state')
    require(isinstance(attributes.get('bounds'), str) and attributes['bounds'], 'missing_switch_bounds')
    return {'label': SETTING, 'nativeValue': value, 'checked': checked, 'enabled': True,
            'bounds': attributes['bounds'], 'resourceId': attributes.get('resource-id', '')}


class Deadline:
    def __init__(self, started, now=time.monotonic):
        self.started, self.now = started, now
        require(isinstance(started, (int, float)) and not isinstance(started, bool), 'invalid_setup_clock')
        require(0 <= now() - started < BUDGET_SECONDS, 'setup_deadline')

    def remaining(self):
        remaining = BUDGET_SECONDS - (self.now() - self.started)
        require(0 < remaining <= BUDGET_SECONDS, 'setup_deadline')
        return remaining


class Commands:
    def __init__(self, root, env, directory, deadline):
        self.root, self.env, self.directory, self.deadline = root, env, directory, deadline

    def __call__(self, args, name):
        output = self.directory / name
        error = self.directory / (name + '.stderr.txt')
        with output.open('xb') as stdout, error.open('xb') as stderr:
            timeout = self.deadline.remaining()
            process = subprocess.Popen(args, cwd=self.root, env=self.env, stdout=stdout, stderr=stderr,
                                       start_new_session=True)
            try:
                status = process.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                # Stop this one command group before the existing trap deletes
                # the owned Simulator. There is no restart or second attempt.
                os.killpg(process.pid, signal.SIGKILL)
                process.wait(timeout=5)
                raise PreflightError('setup_deadline') from None
        require(status == 0, 'preflight_command_failed')
        self.deadline.remaining()
        require(output.stat().st_size <= MAX_OUTPUT_BYTES, 'evidence_size_limit')
        return output.read_bytes()


def inventory(ctx, device, state, run, suffix):
    runtimes = json.loads(run(['xcrun', 'simctl', 'list', 'runtimes', '--json'], suffix + '-runtimes.json'))
    devices = json.loads(run(['xcrun', 'simctl', 'list', 'devices', '--json'], suffix + '-devices.json'))
    return verify_identity(ctx, device, runtimes, devices, state)


def validate_ownership(ctx, device, owner, now=time.monotonic):
    expected = {'device': device, 'name': ctx['name'], 'runtimeIdentifier': ctx['runtimeIdentifier'],
                'runtimeVersion': ctx['runtimeVersion'], 'deviceTypeIdentifier': ctx['deviceTypeIdentifier'],
                'state': 'Shutdown', 'isAvailable': True}
    require(isinstance(owner, dict) and owner.get('context') == ctx and owner.get('device') == device
            and owner.get('budgetSeconds') == BUDGET_SECONDS
            and owner.get('verification') == expected, 'stale_ownership')
    # Reconstruct from the first phase's origin, never from the current time.
    return Deadline(owner.get('startedMonotonic'), now)


def test_command(device, flow, directory, name, reuse_driver):
    command = ['maestro', '--device', device, 'test']
    if reuse_driver:
        command.append('--no-reinstall-driver')
    return command + ['--format', 'junit', '--output', str(directory / (name + '.xml')),
                      '--debug-output', str(directory / name), '--test-output-dir', str(directory / name), flow]


def configure(ctx, device, owner, directory, run, now=time.monotonic):
    validate_ownership(ctx, device, owner, now)
    verification = inventory(ctx, device, 'Booted', run, 'booted')
    require(run(['maestro', '--version'], 'maestro-version.txt').decode().strip() == MAESTRO_VERSION,
            'maestro_version_mismatch')
    run(test_command(device, OPEN_FLOW, directory, 'open-settings', False), 'open-settings.log')
    hierarchy_command = ['maestro', '--device', device, 'hierarchy', '--no-reinstall-driver']
    before_hierarchy = run(hierarchy_command, 'before-hierarchy.json')
    run(['xcrun', 'simctl', 'io', device, 'screenshot', str(directory / 'before.png')], 'before-screenshot.log')
    before = switch_state(json.loads(before_hierarchy))
    changed = before['nativeValue'] == '1'
    if changed:
        run(test_command(device, DISABLE_FLOW, directory, 'disable-autofill', True), 'disable-autofill.log')
    after_hierarchy = run(hierarchy_command, 'after-hierarchy.json')
    run(['xcrun', 'simctl', 'io', device, 'screenshot', str(directory / 'after.png')], 'after-screenshot.log')
    after = switch_state(json.loads(after_hierarchy))
    require(after['nativeValue'] == '0' and after['checked'] is False, 'autofill_remains_on')
    validate_ownership(ctx, device, owner, now).remaining()
    return {'passed': True, 'phase': 'configured', 'deviceVerification': verification,
            'changed': changed, 'before': before, 'after': after,
            'maestro': {'version': MAESTRO_VERSION, 'sourceCommit': MAESTRO_SOURCE,
                        'iosDriverBlob': IOS_DRIVER_BLOB, 'hierarchyCommandBlob': HIERARCHY_BLOB}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('phase', choices=('verify-created', 'configure'))
    parser.add_argument('device')
    parser.add_argument('--runtime')
    args = parser.parse_args()
    directory = ROOT / 'native-ui-logs/ios-autofill-preflight'
    directory.mkdir(parents=True, exist_ok=True)
    result = {'schemaVersion': 1, 'passed': False, 'phase': args.phase, 'budgetSeconds': BUDGET_SECONDS,
              'settingsBundleIdentifier': SETTINGS_APP, 'setting': SETTING,
              'scope': 'Settings-only preflight on the fresh job-owned Simulator, before QA installation. No app-flow acceptance.'}
    started = None
    try:
        ctx = context(ROOT, os.environ)
        result['context'] = ctx
        require(re.fullmatch(r'[A-Fa-f0-9]{8}(?:-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12}', args.device)
                is not None, 'invalid_device_uuid')
        result['device'] = args.device
        if args.phase == 'verify-created':
            require(args.runtime == ctx['runtimeIdentifier'], 'runtime_argument_mismatch')
            require(not (directory / 'ownership.json').exists(), 'ownership_already_recorded')
            started = time.monotonic()
            run = Commands(ROOT, dict(os.environ), directory, Deadline(started))
            verification = inventory(ctx, args.device, 'Shutdown', run, 'created')
            write_json(directory / 'ownership.json', {'context': ctx, 'device': args.device,
                       'verification': verification, 'startedMonotonic': started,
                       'budgetSeconds': BUDGET_SECONDS}, exclusive=True)
            return 0
        require(args.runtime is None, 'unexpected_runtime_argument')
        owner = bounded_json(directory / 'ownership.json')
        deadline = validate_ownership(ctx, args.device, owner)
        started = owner['startedMonotonic']
        write_json(directory / 'configure-attempt.json', {'device': args.device,
                   'sourceCommit': ctx['sourceCommit'], 'attempts': 1}, exclusive=True)
        run = Commands(ROOT, dict(os.environ), directory, deadline)
        result.update(configure(ctx, args.device, owner, directory, run))
        result['evidence'] = {path.name: digest(path.read_bytes()) for path in
            (directory / name for name in ('ownership.json', 'before-hierarchy.json', 'before.png',
                                           'after-hierarchy.json', 'after.png'))}
        result['elapsedMs'] = round((time.monotonic() - started) * 1000)
        write_json(directory / 'result.json', result, exclusive=True)
        return 0
    except Exception as error:
        result['errorCode'] = str(error) if isinstance(error, PreflightError) else 'preflight_evidence_or_execution_failed'
        if started is not None:
            result['elapsedMs'] = round((time.monotonic() - started) * 1000)
        # Preserve any completed original result if a caller incorrectly tries
        # to repeat this setup. A rejection never replaces its earlier evidence.
        output = directory / ('result.json' if not (directory / 'result.json').exists() else 'rejected-repeat.json')
        if not output.exists():
            write_json(output, result, exclusive=True)
        print('Simulator AutoFill preflight failed: ' + result['errorCode'], file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
