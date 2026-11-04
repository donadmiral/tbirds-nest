#!/usr/bin/env python3
"""Bind an already-built audit app to the frozen source and toolchain. No signing."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import plistlib
import re
import subprocess
import zipfile

spec = importlib.util.spec_from_file_location('audit_runner', Path(__file__).with_name('native-ui-audit-runner.py'))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


def output(args):
    return subprocess.check_output(args, stderr=subprocess.PIPE, timeout=30).decode().strip()


def source_provenance(source, commit, kind, receipt):
    if source.get('commit') != commit:
        raise ValueError('Build provenance does not match the declared source')
    if kind == 'disposable-native-audit':
        manifest = Path('tests/native/audit/manifest.json')
        if (source.get('audit', {}).get('applicationSourceCommit') != commit
                or source['audit'].get('manifestSha256') != runner.sha256_file(manifest)):
            raise ValueError('Missing or mismatched audited build provenance')
        return {'auditManifestSha256': runner.sha256_file(manifest)}
    if (source.get('audit') is not None or source.get('mode') !=
            'Complete production App and screens with isolated synthetic transports and a CI-only capture route'):
        raise ValueError('Expected the normal synthetic full-app journey provenance')
    hashes = source.get('hashes', {})
    required = ['App.tsx', 'package.json', 'package-lock.json', 'app.config.js',
                'tests/native/entry.js', 'tests/native/backend-fixture.cjs',
                'tests/native/flows/navigation.yaml', 'tests/native/flows/feed-video.yaml']
    if any(not re.fullmatch('[0-9a-f]{64}', str(hashes.get(name, ''))) for name in required):
        raise ValueError('Missing application or fixture source hashes')
    fixtures = {name: digest for name, digest in hashes.items() if name.startswith('tests/native/')}
    for name, digest in fixtures.items():
        if '..' in Path(name).parts or runner.sha256_file(Path(name)) != digest:
            raise ValueError('Synthetic fixture changed after preparation: ' + name)
    overlays = source.get('overlays', [])
    if not overlays:
        raise ValueError('Missing the explicit full-app overlays')
    for overlay in overlays:
        retained = Path(overlay['retained'])
        if (retained.is_absolute() or '..' in retained.parts or retained.parts[0] != 'overlays'
                or runner.sha256_file(receipt.parent / retained) != overlay['after']
                or runner.sha256_file(Path(overlay['file'])) != overlay['after']):
            raise ValueError('Prepared full-app overlay changed')
    return {'fixtureHashes': fixtures, 'fixtureMode': source['mode'],
            'producerScriptSha256': runner.sha256_file(Path(__file__)),
            'testOnly': True, 'userDistributionPermitted': False}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--platform', choices=['ios', 'android'], required=True)
    parser.add_argument('--binary', type=Path, required=True)
    parser.add_argument('--source', required=True)
    parser.add_argument('--tree', required=True)
    parser.add_argument('--source-receipt', type=Path, default=Path('native-ui-logs/source.json'))
    parser.add_argument('--kind', choices=['disposable-native-audit', 'disposable-native-full-app'],
                        default='disposable-native-audit')
    parser.add_argument('--ios-target', choices=['intel-ios18.5', 'arm64-ios26.2'], default='intel-ios18.5')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if os.environ.get('CI') != 'true' or not all(re.fullmatch('[0-9a-f]{40}', value) for value in [args.source, args.tree]):
        raise ValueError('Exact frozen CI commit/tree required')
    if output(['git', 'rev-parse', 'HEAD']) != args.source or output(['git', 'rev-parse', 'HEAD^{tree}']) != args.tree:
        raise ValueError('Build checkout does not match the declared frozen source/tree')
    source = json.loads(args.source_receipt.read_text())
    provenance = source_provenance(source, args.source, args.kind, args.source_receipt)
    if args.platform == 'ios':
        spec = importlib.util.spec_from_file_location('binary_ios_compatibility', Path(__file__).with_name('native-ui-ios-compatibility.py'))
        compatibility = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(compatibility)
        target = compatibility.TARGETS[args.ios_target]
        info = plistlib.loads((args.binary / 'Info.plist').read_bytes())
        if info.get('CFBundleIdentifier') != runner.PACKAGE or info.get('DTPlatformName') != 'iphonesimulator':
            raise ValueError('Expected the Simulator QA app')
        executable = args.binary / info['CFBundleExecutable']
        architectures = output(['xcrun', 'lipo', str(executable), '-archs']).split()
        if output(['/usr/bin/uname', '-m']) != target['abi'] or architectures != [target['abi']]:
            raise ValueError('The actual build host and Simulator executable must match the declared native target')
        if info.get('DTSDKName') != 'iphonesimulator' + target['sdkVersion']:
            raise ValueError('The actual built app SDK differs from the declared target')
        output(['codesign', '--verify', '--deep', '--strict', str(args.binary)])
        native = {'targetId': args.ios_target, 'abi': target['abi'], 'runtimeIdentifier': target['runtimeIdentifier'],
                  'deviceTypeIdentifier': target['deviceTypeIdentifier'],
                  'minimumOSVersion': info.get('MinimumOSVersion'), 'sdk': info.get('DTSDKName'),
                  'bundleVersion': info.get('CFBundleVersion'), 'version': info.get('CFBundleShortVersionString'),
                  'platform': 'iphonesimulator'}
        toolchain = {'xcode': output(['xcodebuild', '-version']), 'sdkVersion': output(['xcrun', '--sdk', 'iphonesimulator', '--show-sdk-version'])}
        if toolchain != {'xcode': target['xcode'], 'sdkVersion': target['sdkVersion']}:
            raise ValueError('The actual producer toolchain differs from the declared target')
    else:
        sdk = Path(os.environ.get('ANDROID_HOME') or os.environ.get('ANDROID_SDK_ROOT') or '')
        candidates = sorted(sdk.glob('build-tools/*/aapt'))
        if not candidates:
            raise ValueError('Installed Android aapt is required to inspect the actual APK')
        badging = output([str(candidates[-1]), 'dump', 'badging', str(args.binary)])
        if not re.search(r"^package: name='" + re.escape(runner.PACKAGE) + "'", badging, re.M):
            raise ValueError('APK package does not match the QA app')
        with zipfile.ZipFile(args.binary) as archive:
            entries = archive.namelist()
            if len(archive.read('assets/index.android.bundle')) < 100000 or not any(name.startswith('lib/x86_64/') for name in entries):
                raise ValueError('Missing complete JS bundle or Emulator native ABI')
        native = {'abi': 'x86_64', 'api': '35', 'image': 'system-images;android-35;default;x86_64',
                  'packageBadging': next(line for line in badging.splitlines() if line.startswith('package:'))}
        toolchain = {'aapt': output([str(candidates[-1]), 'version']), 'java': subprocess.run(['java', '-version'], capture_output=True, timeout=30, check=True).stderr.decode().strip()}
    # Bind the native inputs as well as the exact final app bytes. Consumers
    # supply the separately frozen expected commit/tree and scenario hash.
    native['configurationInputs'] = {name: digest for name, digest in source['hashes'].items()
                                      if name in ['package-lock.json', 'app.config.js'] or name.startswith('modules/boomerang/')}
    result = {'schemaVersion': 1, 'kind': args.kind, 'configuration': 'Release',
              'applicationSourceCommit': args.source, 'applicationSourceTree': args.tree,
              'platform': args.platform, 'packageId': runner.PACKAGE, 'binaryName': args.binary.name,
              'binarySha256': runner.binary_digest(args.binary), **provenance,
              'sourceReceiptSha256': runner.sha256_file(args.source_receipt), 'nativeCompatibility': native,
              'toolchain': toolchain, 'rebuildPerCase': False, 'resignOrRebundlePermitted': False}
    with args.output.open('x') as stream:
        json.dump(result, stream, indent=2)
        stream.write('\n')


if __name__ == '__main__':
    main()
