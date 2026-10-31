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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--platform', choices=['ios', 'android'], required=True)
    parser.add_argument('--binary', type=Path, required=True)
    parser.add_argument('--source', required=True)
    parser.add_argument('--tree', required=True)
    parser.add_argument('--source-receipt', type=Path, default=Path('native-ui-logs/source.json'))
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if os.environ.get('CI') != 'true' or not all(re.fullmatch('[0-9a-f]{40}', value) for value in [args.source, args.tree]):
        raise ValueError('Exact frozen CI commit/tree required')
    if output(['git', 'rev-parse', 'HEAD']) != args.source or output(['git', 'rev-parse', 'HEAD^{tree}']) != args.tree:
        raise ValueError('Build checkout does not match the declared frozen source/tree')
    source = json.loads(args.source_receipt.read_text())
    if source.get('commit') != args.source or source.get('audit', {}).get('applicationSourceCommit') != args.source:
        raise ValueError('Missing or mismatched audited build provenance')
    manifest = Path('tests/native/audit/manifest.json')
    if source['audit']['manifestSha256'] != runner.sha256_file(manifest):
        raise ValueError('Audit scenarios changed after preparation')
    if args.platform == 'ios':
        info = plistlib.loads((args.binary / 'Info.plist').read_bytes())
        if info.get('CFBundleIdentifier') != runner.PACKAGE or info.get('DTPlatformName') != 'iphonesimulator':
            raise ValueError('Expected the Simulator QA app')
        executable = args.binary / info['CFBundleExecutable']
        architectures = output(['xcrun', 'lipo', str(executable), '-archs']).split()
        if architectures != ['x86_64']:
            raise ValueError('The current audited Simulator runtime requires x86_64')
        output(['codesign', '--verify', '--deep', '--strict', str(args.binary)])
        native = {'abi': 'x86_64', 'runtimeIdentifier': 'com.apple.CoreSimulator.SimRuntime.iOS-18-5',
                  'minimumOSVersion': info.get('MinimumOSVersion'), 'sdk': info.get('DTSDKName'),
                  'bundleVersion': info.get('CFBundleVersion'), 'platform': 'iphonesimulator'}
        toolchain = {'xcode': output(['xcodebuild', '-version']), 'sdkVersion': output(['xcrun', '--sdk', 'iphonesimulator', '--show-sdk-version'])}
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
    result = {'schemaVersion': 1, 'kind': 'disposable-native-audit', 'configuration': 'Release',
              'applicationSourceCommit': args.source, 'applicationSourceTree': args.tree,
              'platform': args.platform, 'packageId': runner.PACKAGE, 'binaryName': args.binary.name,
              'binarySha256': runner.binary_digest(args.binary), 'auditManifestSha256': runner.sha256_file(manifest),
              'sourceReceiptSha256': runner.sha256_file(args.source_receipt), 'nativeCompatibility': native,
              'toolchain': toolchain, 'rebuildPerCase': False, 'resignOrRebundlePermitted': False}
    with args.output.open('x') as stream:
        json.dump(result, stream, indent=2)
        stream.write('\n')


if __name__ == '__main__':
    main()
