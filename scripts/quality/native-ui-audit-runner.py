#!/usr/bin/env python3
"""Run independent cases against one already-built QA binary. No build/rebundle/sign."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

PACKAGE = 'app.platinumcircles.mobile.qa'


def sha256_file(path):
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for data in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(data)
    return result.hexdigest()


def binary_digest(path):
    if path.is_file():
        return sha256_file(path)
    result = hashlib.sha256()
    for file in sorted(path.rglob('*')):
        relative = file.relative_to(path).as_posix()
        if file.is_symlink():
            result.update(('link\0' + relative + '\0' + os.readlink(file) + '\0').encode())
        elif file.is_file():
            result.update(('file\0' + relative + '\0' + sha256_file(file) + '\0').encode())
    return result.hexdigest()


def validate_binary(manifest, binary, platform, source_commit, source_tree):
    expected = {'applicationSourceCommit': source_commit, 'applicationSourceTree': source_tree, 'platform': platform, 'packageId': PACKAGE,
                'kind': 'disposable-native-audit', 'configuration': 'Release'}
    for key, value in expected.items():
        if manifest.get(key) != value:
            raise ValueError('Binary manifest mismatch: ' + key)
    for key in ['auditManifestSha256', 'nativeCompatibility', 'toolchain', 'sourceReceiptSha256']:
        if not manifest.get(key):
            raise ValueError('Missing binary provenance: ' + key)
    if not binary.exists() or binary_digest(binary) != manifest.get('binarySha256'):
        raise ValueError('Built binary bytes do not match their retained manifest')
    if platform == 'ios' and (not binary.is_dir() or binary.suffix != '.app'):
        raise ValueError('An intact built Simulator .app is required')
    if platform == 'android' and (not binary.is_file() or binary.suffix != '.apk'):
        raise ValueError('The exact built QA APK is required')


def validate_junit(path, case):
    if not path.is_file() or not path.stat().st_size:
        return {'passed': False, 'issue': 'missing-or-empty-junit'}
    try:
        root = ET.parse(path).getroot()
        cases = list(root.iter('testcase'))
        if len(cases) != 1:
            raise ValueError('expected-one-executed-case')
        item = cases[0]
        if item.get('name') != case['name'] or item.get('status') != 'SUCCESS':
            raise ValueError('case-name-or-status-mismatch')
        expected_file = 'tests/native/audit/' + case['flow']
        if item.get('file') != expected_file:
            raise ValueError('case-file-mismatch')
        if any(list(root.iter(tag)) for tag in ['failure', 'error', 'skipped']):
            raise ValueError('failed-error-or-skipped-case')
        suites = list(root.iter('testsuite'))
        if len(suites) != 1 or suites[0].get('tests') != '1':
            raise ValueError('invalid-suite-count')
        for node in [root] + suites:
            for field in ['failures', 'errors', 'skipped', 'disabled']:
                if node.get(field, '0') != '0':
                    raise ValueError('nonzero-suite-' + field)
        return {'passed': True, 'executedCases': 1}
    except (ET.ParseError, ValueError, OSError) as error:
        return {'passed': False, 'issue': str(error)}


def validate_memory_cover_save(receipt):
    """Require a real committed edit and a later read of that edit.

    The pinned fixture appends one bookReads row synchronously for each
    successful navigation-book request. Correlate the complete request/read
    counts before using their order. Missing, failed or other-book reads cannot
    be silently skipped. No UI preview or sheet dismissal is persistence proof.
    """
    owner = '10000000-0000-4000-8000-000000000001'
    book = 'a0000000-0000-4000-8000-000000000002'
    save_rpc = 'save_memory_book_creative_presentation'
    save_path = '/rest/v1/rpc/' + save_rpc
    read_path = '/rest/v1/rpc/get_memory_book'
    requests, mutations, reads = (receipt.get(key) for key in ['requests', 'mutations', 'bookReads'])
    if any(not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows)
           for rows in [requests, mutations, reads]):
        raise ValueError('malformed-memory-save-receipt')
    saves = [(index, row) for index, row in enumerate(requests) if row.get('path') == save_path]
    committed = [row for row in mutations if row.get('rpc') == save_rpc]
    if len(saves) != 1 or len(committed) != 1:
        raise ValueError('memory-save-requires-one-committed-request')
    save_index, save_request = saves[0]
    saved = committed[0]
    if save_request.get('method') != 'POST' or save_request.get('owner') != owner:
        raise ValueError('memory-save-request-scope-mismatch')
    if (saved.get('id') != book or saved.get('owner') != owner
            or saved.get('title') != 'AUDIT BOOK TITLE'
            or type(saved.get('revision')) is not int or saved['revision'] != 1):
        raise ValueError('memory-save-commit-mismatch')
    read_requests = [(index, row) for index, row in enumerate(requests) if row.get('path') == read_path]
    if len(read_requests) != len(reads) or len(reads) < 2:
        raise ValueError('memory-save-read-correlation-missing')
    before, after = 0, 0
    for (index, request), read in zip(read_requests, reads):
        if (request.get('method') != 'POST' or request.get('owner') != owner
                or read.get('id') != book or read.get('owner') != owner
                or type(read.get('revision')) is not int):
            raise ValueError('memory-save-read-scope-mismatch')
        if index < save_index:
            if read['revision'] != 0 or read.get('title') != 'THE SMALL ADVENTURES':
                raise ValueError('memory-save-baseline-read-mismatch')
            before += 1
        else:
            if read['revision'] != saved['revision'] or read.get('title') != saved['title']:
                raise ValueError('memory-save-readback-mismatch')
            after += 1
    if not before or not after:
        raise ValueError('memory-save-ordered-readback-missing')
    return {'passed': True, 'saveRequestCount': 1, 'committedSaveCount': 1,
            'savedRevision': saved['revision'], 'readbacksAfterSave': after}


def validate_receipt(path, case):
    try:
        receipt = json.loads(path.read_text())
        if receipt.get('mode') != 'synthetic-native-ui' or receipt.get('networkForwarded') is not False:
            raise ValueError('incorrect-transport')
        audit = receipt.get('audit', {})
        diagnostics = audit.get('diagnostics', [])
        dropped = audit.get('diagnosticsDropped', 0)
        if not isinstance(diagnostics, list) or type(dropped) is not int or dropped < 0:
            raise ValueError('malformed-audit-diagnostics')
        if diagnostics or dropped:
            # A handled diagnostic RPC still reports a product error. Retain
            # only counts here; never copy its payload into the case result.
            return {'passed': False, 'issue': 'reported-client-error',
                    'diagnosticCount': len(diagnostics), 'diagnosticsDropped': dropped}
        if case['kind'] == 'signed-out-control':
            if audit.get('caseId') is not None or receipt.get('unhandled') or audit.get('rejected'):
                raise ValueError('unexpected-signed-out-fixture-state')
            return {'passed': True, 'requestCount': len(receipt.get('requests', [])), 'signedIn': False}
        if audit.get('caseId') != case['id'] or audit.get('scenario') != case['fixtureScenario']:
            raise ValueError('missing-or-wrong-case-receipt')
        if receipt.get('unhandled') or audit.get('rejected'):
            raise ValueError('unhandled-fixture-contract')
        memory_save = validate_memory_cover_save(receipt) if case['id'] == 'memory-cover-settings' else None
        if not any(row.get('path') == '/auth/v1/token' for row in receipt.get('requests', [])):
            raise ValueError('no-real-sdk-synthetic-signin')
        result = {'passed': True, 'requestCount': len(receipt['requests']),
                  'auditRequestCount': len(audit.get('requests', [])),
                  'auditMutationCount': len(audit.get('mutations', []))}
        if memory_save is not None:
            result['memorySave'] = memory_save
        return result
    except (OSError, ValueError, TypeError, KeyError) as error:
        return {'passed': False, 'issue': str(error)}


def command(args, **kwargs):
    return subprocess.run(args, check=False, **kwargs)


def run_owned(args, timeout, **kwargs):
    """Bound one owned CLI group, including descendants, without killing AUT."""
    process = subprocess.Popen(args, start_new_session=True, **kwargs)
    try:
        return subprocess.CompletedProcess(args, process.wait(timeout=timeout))
    except BaseException:
        # A CLI may fork children that outlive its leader. Always target this
        # newly owned group, then reap the leader; never a global adb/simulator.
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            process.wait(timeout=1)
        except subprocess.TimeoutExpired:
            pass
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait()
        raise


def ios_setup_helper():
    path = Path(__file__).with_name('native-ui-ios-audit-recovery.py')
    spec = importlib.util.spec_from_file_location('ios_bounded_setup', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def validate_device(platform, device, compatibility, binary=None, toolchain=None,
                    prepared=None, source_commit=None, source_tree=None,
                    binary_manifest_sha=None, preflight=None, preflight_sha=None):
    def read(args):
        return subprocess.check_output(args, stderr=subprocess.PIPE, timeout=30).decode().strip()
    if platform == 'android':
        if read(['adb', '-s', device, 'shell', 'getprop', 'ro.product.cpu.abi']) != compatibility['abi']:
            raise ValueError('Device ABI does not match the built binary')
        if read(['adb', '-s', device, 'shell', 'getprop', 'ro.build.version.sdk']) != compatibility['api']:
            raise ValueError('Device API does not match the audited image')
        if read(['adb', '-s', device, 'shell', 'id', '-u']) != '0':
            raise ValueError('The isolated AOSP diagnostic-root image is required for private synthetic receipts')
    else:
        if (binary is None or not toolchain or prepared is None or source_commit is None
                or source_tree is None or binary_manifest_sha is None or preflight is None or preflight_sha is None):
            raise ValueError('Actual Simulator app, producer toolchain and source-bound setup receipt are required')
        helper = Path(__file__).with_name('native-ui-ios-compatibility.py')
        spec = importlib.util.spec_from_file_location('ios_compatibility', helper)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        manifest = {'nativeCompatibility': compatibility, 'toolchain': toolchain,
                    'applicationSourceCommit': source_commit, 'applicationSourceTree': source_tree,
                    'binarySha256': binary_digest(binary)}
        runtime = module.verify_prepared_booted_runtime(manifest, device, prepared)
        spec = importlib.util.spec_from_file_location('immutable_preflight', Path(__file__).with_name('native-ui-ios-immutable-preflight.py'))
        verifier = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(verifier)
        immutable = verifier.verify_record(manifest, binary_manifest_sha, preflight, binary)
        verifier.verify_before_creation(prepared, preflight, preflight_sha)
        return {**immutable, **runtime,
                'immutableCompatibilityVerifiedBeforeDeviceCreation': True,
                'postbootImmutableProbesRepeated': False,
                'scope': 'Actual host/toolchain/Mach-O/signature checked before creation, with exact source/manifest/app bytes revalidated. Runtime/type/availability verified before boot and exact owned UUID bootstatus completed. No immutable probes or global metadata queries repeated after boot. Actual installation and app launch remain required.'}


def collect(platform, device, target):
    records = []
    for name in ['native-ui-receipt.json', 'native-ui-auth-diagnostics.json', 'native-ui-navigation-timing.json']:
        output = target / name
        if platform == 'android':
            with output.open('wb') as stream:
                result = command(['adb', '-s', device, 'exec-out', 'cat', '/data/user/0/' + PACKAGE + '/files/' + name], stdout=stream, stderr=subprocess.DEVNULL, timeout=30)
            ok = result.returncode == 0 and output.stat().st_size > 0
        else:
            result = command(['xcrun', 'simctl', 'get_app_container', device, PACKAGE, 'data'], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, timeout=30)
            source = Path(result.stdout.strip()) / 'Documents' / name if result.returncode == 0 else None
            ok = bool(source and source.is_file() and source.stat().st_size)
            if ok:
                shutil.copyfile(source, output)
        records.append({'file': name, 'collected': ok, 'bytes': output.stat().st_size if output.exists() else 0})
    memory = target / 'memory-capture'
    if platform == 'android':
        # AOSP diagnostic-root image, as required by the existing full UI job.
        result = command(['adb', '-s', device, 'pull', '/data/user/0/' + PACKAGE + '/files/native-memory-capture', str(memory)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30)
        records.append({'directory': 'memory-capture', 'collected': result.returncode == 0})
    elif source is not None:
        source_memory = source.parent / 'native-memory-capture'
        if source_memory.is_dir():
            shutil.copytree(source_memory, memory)
            records.append({'directory': 'memory-capture', 'collected': True})
    return records


def run_cases(cases, platform, device, output, execute=run_owned, collect_case=collect):
    results = []
    for case in cases:
        target = output / case['id']
        target.mkdir()
        row = {'id': case['id'], 'group': case['group'], 'kind': case['kind'], 'attempts': 1,
               'startedAtEpochMs': round(time.time() * 1000), 'status': 'running',
               'timeoutSeconds': (300 if case['kind'] == 'same-session-memory-capture' else 180)
                                 + (180 if platform == 'ios' else 0),
               'driverStartupBudgetSeconds': 180 if platform == 'ios' else 0}
        results.append(row)
        (output / 'results.json').write_text(json.dumps(results, indent=2) + '\n')
        args = ['maestro', '--device', device, 'test', '--format', 'junit', '--output', str(target / 'junit.xml'),
                '--debug-output', str(target / 'maestro'), '--test-output-dir', str(target / 'maestro'),
                'tests/native/audit/' + case['flow']]
        try:
            with (target / 'maestro.log').open('wb') as stream:
                row['exitCode'] = execute(args, timeout=row['timeoutSeconds'], stdout=stream, stderr=subprocess.STDOUT).returncode
        except subprocess.TimeoutExpired:
            row['exitCode'] = None
            row['timedOut'] = True
            row['executionIssue'] = 'case-timeout'
        except OSError as error:
            row['exitCode'] = None
            row['executionIssue'] = type(error).__name__
        # Always collect before the next independent flow clears its synthetic
        # app/keychain state. A device failure cannot silently skip later cases.
        try:
            row['collection'] = collect_case(platform, device, target)
        except (OSError, ValueError, subprocess.TimeoutExpired) as error:
            row['collectionIssue'] = type(error).__name__
        row['junit'] = validate_junit(target / 'junit.xml', case)
        row['fixture'] = validate_receipt(target / 'native-ui-receipt.json', case)
        row['mediaVerifierExitCode'] = None
        media_ok = True
        if case['kind'] == 'same-session-memory-capture':
            try:
                with (target / 'memory-verifier.log').open('wb') as stream:
                    row['mediaVerifierExitCode'] = execute(['python3', 'scripts/quality/verify-native-ui-memory.py', str(target / 'memory-capture'), platform], timeout=180, stdout=stream, stderr=subprocess.STDOUT).returncode
            except (OSError, subprocess.TimeoutExpired) as error:
                row['mediaVerifierIssue'] = type(error).__name__
            media_ok = row['mediaVerifierExitCode'] == 0
        row['status'] = 'passed' if row['exitCode'] == 0 and row['junit']['passed'] and row['fixture']['passed'] and media_ok else 'failed'
        row['finishedAtEpochMs'] = round(time.time() * 1000)
        (output / 'results.json').write_text(json.dumps(results, indent=2) + '\n')
    return results


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--platform', choices=['ios', 'android'], required=True)
    parser.add_argument('--device', required=True)
    parser.add_argument('--binary', type=Path, required=True)
    parser.add_argument('--binary-manifest', type=Path, required=True)
    parser.add_argument('--device-setup', type=Path)
    parser.add_argument('--immutable-preflight', type=Path)
    parser.add_argument('--expected-source', required=True)
    parser.add_argument('--expected-tree', required=True)
    parser.add_argument('--groups', default='all')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if os.environ.get('CI') != 'true':
        parser.error('Use only a disposable CI Simulator/Emulator.')
    manifest_path = Path('tests/native/audit/manifest.json')
    manifest = json.loads(manifest_path.read_text())
    binary_manifest = json.loads(args.binary_manifest.read_text())
    for value in [args.expected_source, args.expected_tree]:
        if len(value) != 40 or any(character not in '0123456789abcdef' for character in value):
            raise ValueError('An exact frozen commit and tree are required')
    validate_binary(binary_manifest, args.binary, args.platform, args.expected_source, args.expected_tree)
    if sha256_file(manifest_path) != binary_manifest['auditManifestSha256']:
        raise ValueError('Audit scenarios differ from the compiled binary')
    prepared = None
    preflight = None
    preflight_sha = None
    if args.platform == 'ios':
        if (args.device_setup is None or args.device_setup.is_symlink()
                or not args.device_setup.is_file() or not 0 < args.device_setup.stat().st_size <= 65536):
            raise ValueError('The fresh bounded iOS device-setup receipt is required')
        prepared = json.loads(args.device_setup.read_text())
        if args.immutable_preflight is None:
            raise ValueError('The actual preboot immutable preflight receipt is required')
        spec = importlib.util.spec_from_file_location('immutable_preflight', Path(__file__).with_name('native-ui-ios-immutable-preflight.py'))
        verifier = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(verifier)
        preflight, preflight_sha = verifier.read_receipt(args.immutable_preflight, binary_manifest,
            sha256_file(args.binary_manifest), args.binary)
    device_proof = validate_device(args.platform, args.device, binary_manifest['nativeCompatibility'],
                    binary=args.binary, toolchain=binary_manifest['toolchain'],
                    prepared=prepared, source_commit=args.expected_source, source_tree=args.expected_tree,
                    binary_manifest_sha=sha256_file(args.binary_manifest), preflight=preflight, preflight_sha=preflight_sha)
    selected = set(manifest['groups']) if args.groups == 'all' else set(args.groups.split(','))
    if not selected or not selected <= set(manifest['groups']):
        raise ValueError('Unknown or empty feature group selection')
    cases = [case for case in manifest['cases'] if case['group'] in selected]
    args.output.mkdir(parents=True, exist_ok=False)
    shutil.copyfile(args.binary_manifest, args.output / 'binary-manifest.json')
    shutil.copyfile(manifest_path, args.output / 'audit-manifest.json')
    if args.platform == 'ios':
        (args.output / 'device-setup.json').write_text(json.dumps(prepared, indent=2) + '\n')
        (args.output / 'device-compatibility.json').write_text(json.dumps(device_proof, indent=2) + '\n')
        (args.output / 'immutable-preflight.json').write_text(json.dumps(preflight, indent=2) + '\n')
    install = ['adb', '-s', args.device, 'install', '-r', str(args.binary)] if args.platform == 'android' else ['xcrun', 'simctl', 'install', args.device, str(args.binary)]
    # Install the same bytes once per feature shard. Never build, rebundle, or sign.
    if args.platform == 'ios':
        try:
            ios_setup_helper().setup_read(install, 'install', 120, [], args.output / 'install-commands.json')
            installed = True
        except (OSError, ValueError, subprocess.SubprocessError):
            installed = False
    else:
        installed = command(install).returncode == 0
    if not installed:
        (args.output / 'setup-failure.json').write_text(json.dumps({'stage': 'install', 'attemptedCases': 0, 'status': 'blocked'}) + '\n')
        return 1
    results = run_cases(cases, args.platform, args.device, args.output)
    summary = {'applicationSourceCommit': args.expected_source, 'applicationSourceTree': args.expected_tree, 'platform': args.platform, 'selectedGroups': sorted(selected),
               'unselectedGroups': sorted(set(manifest['groups']) - selected), 'attempted': len(results),
               'passed': sum(row['status'] == 'passed' for row in results),
               'failed': sum(row['status'] != 'passed' for row in results), 'allControlsAccepted': False}
    (args.output / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
    return int(summary['failed'] != 0)


if __name__ == '__main__':
    sys.exit(main())
