#!/usr/bin/env python3
"""Verify immutable iOS build inputs before creating or booting any Simulator."""
import argparse
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import re

STAGES = ['compatibility-host-architecture', 'compatibility-xcode-version',
          'compatibility-simulator-sdk', 'compatibility-actual-mach-o',
          'compatibility-app-signature']


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def verify_record(manifest, manifest_sha, proof, binary=None):
    """Require actual successful bounded probes bound to unchanged build inputs."""
    fields = {'schemaVersion', 'kind', 'applicationSourceCommit', 'applicationSourceTree',
              'binaryManifestSha256', 'binarySha256', 'binaryPath', 'developerDirectory',
              'immutableCompatibility', 'commands'}
    if not isinstance(proof, dict) or set(proof) != fields:
        raise ValueError('An exact immutable iOS preflight receipt is required')
    expected = {'schemaVersion': 1, 'kind': 'native-ios-immutable-preflight',
                'applicationSourceCommit': manifest.get('applicationSourceCommit'),
                'applicationSourceTree': manifest.get('applicationSourceTree'),
                'binaryManifestSha256': manifest_sha, 'binarySha256': manifest.get('binarySha256')}
    if any(type(proof.get(key)) is not type(value) or proof.get(key) != value for key, value in expected.items()):
        raise ValueError('Immutable preflight does not match this exact source, manifest and binary')
    for key, length in [('applicationSourceCommit', 40), ('applicationSourceTree', 40),
                        ('binaryManifestSha256', 64), ('binarySha256', 64)]:
        if not isinstance(proof[key], str) or not re.fullmatch('[0-9a-f]{' + str(length) + '}', proof[key]):
            raise ValueError('Immutable preflight requires exact source and byte identities')
    if (not isinstance(proof['binaryPath'], str) or not Path(proof['binaryPath']).is_absolute()
            or proof['developerDirectory'] != os.environ.get('DEVELOPER_DIR')):
        raise ValueError('The original absolute app path and selected developer directory are required')
    if binary is not None and str(Path(binary).resolve(strict=True)) != proof['binaryPath']:
        raise ValueError('Immutable preflight belongs to a different app path')
    actual = proof['immutableCompatibility']
    compatibility = load_module('immutable_target_compatibility', Path(__file__).with_name('native-ui-ios-compatibility.py'))
    target = compatibility.expected_target(manifest)
    architecture = target['abi']
    if manifest['toolchain'] != {'xcode': target['xcode'], 'sdkVersion': target['sdkVersion']}:
        raise ValueError('The preflight toolchain must match the explicit Simulator target')
    expected_actual = {'hostArchitecture': architecture, 'actualExecutableArchitecture': architecture,
                       'xcode': manifest['toolchain']['xcode'], 'sdkVersion': manifest['toolchain']['sdkVersion'],
                       'codeSignatureVerified': True, 'guestUnameInvoked': False}
    if (not isinstance(actual, dict)
            or any(type(actual.get(key)) is not type(value) or actual.get(key) != value
                   for key, value in expected_actual.items())):
        raise ValueError('Actual host, Xcode, SDK, Mach-O and signature proof is required')
    commands = proof['commands']
    if (not isinstance(commands, list) or len(commands) != len(STAGES)
            or any(not isinstance(row, dict) for row in commands)
            or [row.get('stage') for row in commands] != STAGES):
        raise ValueError('The exact five actual preboot immutable probes are required')
    outputs = [architecture, manifest['toolchain']['xcode'], manifest['toolchain']['sdkVersion'], architecture]
    previous = 0
    for index, row in enumerate(commands):
        start, finish, elapsed = row.get('startedAtEpochMs'), row.get('finishedAtEpochMs'), row.get('elapsedSeconds')
        if (row.get('status') != 'completed' or type(row.get('exitCode')) is not int or row['exitCode'] != 0
                or type(row.get('timeoutSeconds')) is not int or row['timeoutSeconds'] != 30
                or type(start) is not int or type(finish) is not int or start < previous or finish < start
                or type(elapsed) not in (int, float) or not math.isfinite(elapsed) or elapsed < 0):
            raise ValueError('Every immutable probe must have completed within its original command contract')
        if index < 4 and (row.get('stdoutTruncated') is not False
                          or not isinstance(row.get('stdoutTail'), str)
                          or row['stdoutTail'].strip() != outputs[index]):
            raise ValueError('Immutable probe output does not match the compiled app')
        previous = finish
    return actual


def read_receipt(path, manifest, manifest_sha, binary=None):
    path = Path(path)
    if path.is_symlink() or not path.is_file() or not 0 < path.stat().st_size <= 65536:
        raise ValueError('The original immutable preflight receipt is unavailable')
    proof = json.loads(path.read_text())
    verify_record(manifest, manifest_sha, proof, binary)
    return proof, digest(path)


def verify_before_creation(prepared, proof, proof_sha):
    finished = proof['commands'][-1]['finishedAtEpochMs']
    observed = prepared.get('immutablePreflightFinishedAtEpochMs')
    before_create = prepared.get('createdAfterImmutablePreflightAtEpochMs')
    if (prepared.get('immutablePreflightSha256') != proof_sha
            or type(observed) is not int or observed != finished
            or type(before_create) is not int or before_create < finished):
        raise ValueError('The owned device must have been created after this exact immutable preflight')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--binary', type=Path, required=True)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--expected-source', required=True)
    parser.add_argument('--expected-tree', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if os.environ.get('CI') != 'true' or os.environ.get('EXPO_PUBLIC_APP_ENV') != 'qa':
        raise ValueError('Immutable preflight is restricted to the disposable QA audit')
    if any(not re.fullmatch('[0-9a-f]{40}', value) for value in [args.expected_source, args.expected_tree]):
        raise ValueError('Exact frozen source and tree identities are required')
    scripts = Path(__file__).parent
    runner = load_module('immutable_binary_verifier', scripts / 'native-ui-audit-runner.py')
    bounded = load_module('immutable_bounded_setup', scripts / 'native-ui-ios-audit-recovery.py')
    manifest = json.loads(args.manifest.read_text())
    runner.validate_binary(manifest, args.binary, 'ios', args.expected_source, args.expected_tree)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    if args.output.exists() or args.output.is_symlink():
        raise ValueError('An immutable preflight receipt may only be written once')
    commands = []
    evidence = args.output.with_name(args.output.stem + '-commands.json')
    actual = bounded.verify_setup_immutable(args.binary, manifest, commands, evidence)
    proof = {'schemaVersion': 1, 'kind': 'native-ios-immutable-preflight',
             'applicationSourceCommit': args.expected_source, 'applicationSourceTree': args.expected_tree,
             'binaryManifestSha256': digest(args.manifest), 'binarySha256': manifest['binarySha256'],
             'binaryPath': str(args.binary.resolve(strict=True)), 'developerDirectory': os.environ.get('DEVELOPER_DIR'),
             'immutableCompatibility': actual, 'commands': commands}
    verify_record(manifest, digest(args.manifest), proof, args.binary)
    bounded.atomic_json(args.output, proof)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
