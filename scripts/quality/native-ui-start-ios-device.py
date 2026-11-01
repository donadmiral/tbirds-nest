#!/usr/bin/env python3
"""Boot one exact disposable CI Simulator with bounded, recorded setup."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import uuid

RUNTIME = 'com.apple.CoreSimulator.SimRuntime.iOS-18-5'
DEVICE_TYPE = 'com.apple.CoreSimulator.SimDeviceType.iPhone-16'


def select_existing(inventory):
    if not isinstance(inventory, dict) or not isinstance(inventory.get('devices'), dict):
        raise ValueError('Missing Simulator inventory')
    devices = inventory['devices'].get(RUNTIME, [])
    if not isinstance(devices, list):
        raise ValueError('Malformed pinned runtime inventory')
    eligible = [row for row in devices if isinstance(row, dict)
                and row.get('isAvailable') is True and row.get('state') == 'Shutdown'
                and row.get('deviceTypeIdentifier') == DEVICE_TYPE]
    eligible.sort(key=lambda row: row.get('udid', ''))
    return eligible[0]['udid'] if eligible else None


def prepare(manifest, read, run, helper):
    expected = manifest.get('nativeCompatibility', {})
    if expected.get('abi') != 'x86_64' or expected.get('runtimeIdentifier') != RUNTIME:
        raise ValueError('The pinned Intel iPhone16/iOS18.5 runtime is required')
    # Initialize the service through one owned device creation before its
    # metadata reads. Cold global inventory previously exceeded30seconds.
    name = 'Platinum completion ' + uuid.uuid4().hex
    device = read(['xcrun', 'simctl', 'create', name, DEVICE_TYPE, RUNTIME], 120).strip()
    helper.validate_device_identifier(device)
    try:
        verification = helper.verify_created_device(manifest, device, lambda args: read(args, 30))
        run(['xcrun', 'simctl', 'boot', device], 120)
        run(['xcrun', 'simctl', 'bootstatus', device, '-b'], 300)
    except BaseException:
        for operation in ['shutdown', 'delete']:
            try:
                run(['xcrun', 'simctl', operation, device], 20)
            except (OSError, ValueError, subprocess.SubprocessError):
                pass
        raise
    return {'device': device, 'created': True, 'name': name,
            'deviceTypeIdentifier': DEVICE_TYPE, 'runtimeIdentifier': RUNTIME,
            'verification': verification,
            'bootReady': True, 'sourceCommit': manifest.get('applicationSourceCommit')}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--cleanup-device')
    args = parser.parse_args()
    if os.environ.get('CI') != 'true':
        raise ValueError('Use only a disposable CI Simulator')
    spec = importlib.util.spec_from_file_location('created_device', Path(__file__).with_name('native-ui-ios-created-device.py'))
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    spec = importlib.util.spec_from_file_location('bounded_setup', Path(__file__).with_name('native-ui-ios-audit-recovery.py'))
    bounded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(bounded)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    manifest = json.loads(args.manifest.read_text())
    if args.cleanup_device is not None:
        if (args.output.is_symlink() or not args.output.is_file()
                or not 0 < args.output.stat().st_size <= 65536):
            raise ValueError('Owned-device cleanup requires the original setup receipt')
        prepared = json.loads(args.output.read_text())
        bounded.compatibility_module.verify_prepared_booted_runtime(manifest, args.cleanup_device, prepared)
        records = []
        evidence = args.output.with_name(args.output.stem + '-cleanup.json')
        completed = True
        for operation in ['shutdown', 'delete']:
            try:
                bounded.setup_read(['xcrun', 'simctl', operation, args.cleanup_device],
                                   operation, 20, records, evidence)
            except (OSError, ValueError, subprocess.SubprocessError):
                completed = False
        bounded.atomic_json(evidence, {'device': args.cleanup_device,
            'sourceCommit': manifest['applicationSourceCommit'], 'commands': records,
            'completed': completed})
        return int(not completed)
    records = []
    evidence = args.output.with_name(args.output.stem + '-commands.json')
    def read(command, timeout):
        return bounded.setup_read(command, 'simulator-' + command[2], timeout, records, evidence)
    run = read
    result = prepare(manifest, read, run, helper)
    bounded.atomic_json(args.output, result)
    print(result['device'])
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
