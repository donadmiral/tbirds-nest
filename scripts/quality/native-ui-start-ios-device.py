#!/usr/bin/env python3
"""Boot one exact disposable CI Simulator with bounded, recorded setup."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys

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
    inventory = json.loads(read(['xcrun', 'simctl', 'list', 'devices', '--json'], 30))
    device = select_existing(inventory)
    created = device is None
    if created:
        device = read(['xcrun', 'simctl', 'create',
                       'Platinum completion ' + os.environ.get('GITHUB_RUN_ID', 'local'),
                       DEVICE_TYPE, RUNTIME], 120).strip()
    helper.validate_device_identifier(device)
    verification = helper.verify_created_device(manifest, device, lambda args: read(args, 30))
    try:
        run(['xcrun', 'simctl', 'boot', device], 120)
        run(['xcrun', 'simctl', 'bootstatus', device, '-b'], 300)
    except BaseException:
        try:
            run(['xcrun', 'simctl', 'shutdown', device], 20)
        except (OSError, subprocess.SubprocessError):
            pass
        raise
    return {'device': device, 'created': created, 'verification': verification,
            'bootReady': True, 'sourceCommit': manifest.get('applicationSourceCommit')}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if os.environ.get('CI') != 'true':
        raise ValueError('Use only a disposable CI Simulator')
    spec = importlib.util.spec_from_file_location('created_device', Path(__file__).with_name('native-ui-ios-created-device.py'))
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    read = lambda command, timeout: subprocess.check_output(command, text=True, stderr=subprocess.PIPE, timeout=timeout)
    run = lambda command, timeout: subprocess.run(command, check=True, stdout=sys.stderr, stderr=sys.stderr, timeout=timeout)
    result = prepare(json.loads(args.manifest.read_text()), read, run, helper)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + '\n')
    print(result['device'])


if __name__ == '__main__':
    main()
