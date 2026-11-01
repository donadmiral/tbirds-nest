"""Verify a freshly created, pinned Simulator before its first boot."""
import json
import importlib.util
from pathlib import Path
import re

RUNTIME = 'com.apple.CoreSimulator.SimRuntime.iOS-18-5'
VERSION = '18.5'
DEVICE_TYPE = 'com.apple.CoreSimulator.SimDeviceType.iPhone-16'


def expected_target(manifest):
    spec = importlib.util.spec_from_file_location('created_device_compatibility', Path(__file__).with_name('native-ui-ios-compatibility.py'))
    compatibility = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(compatibility)
    return compatibility.expected_target(manifest)


def validate_device_identifier(value):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Fa-f0-9]{8}(?:-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12}', value):
        raise ValueError('Creation must return exactly one device UUID')
    return value


def verify_created_device(manifest, device, read):
    """Read actual metadata once while the owned device is still shut down."""
    validate_device_identifier(device)
    expected = expected_target(manifest)
    runtime, version, device_type = expected['runtimeIdentifier'], expected['runtimeVersion'], expected['deviceTypeIdentifier']
    runtimes = json.loads(read(['xcrun', 'simctl', 'list', 'runtimes', '--json']))
    if not isinstance(runtimes, dict) or not isinstance(runtimes.get('runtimes'), list):
        raise ValueError('Missing runtime inventory')
    selected_runtime = [row for row in runtimes['runtimes'] if isinstance(row, dict) and row.get('identifier') == runtime]
    if len(selected_runtime) != 1 or selected_runtime[0].get('isAvailable') is not True or selected_runtime[0].get('version') != version:
        raise ValueError('Exactly one available original runtime/version is required')
    inventory = json.loads(read(['xcrun', 'simctl', 'list', 'devices', '--json']))
    if not isinstance(inventory, dict) or not isinstance(inventory.get('devices'), dict):
        raise ValueError('Missing created-device inventory')
    selected = []
    for inventory_runtime, rows in inventory['devices'].items():
        if not isinstance(rows, list):
            raise ValueError('Malformed device inventory')
        selected.extend((inventory_runtime, row) for row in rows if isinstance(row, dict) and row.get('udid') == device)
    if len(selected) != 1:
        raise ValueError('The returned UUID must identify exactly one device')
    selected_runtime_id, row = selected[0]
    if (selected_runtime_id != runtime or row.get('deviceTypeIdentifier') != device_type
            or row.get('isAvailable') is not True or row.get('state') != 'Shutdown'):
        raise ValueError('The freshly created device must match its pinned available type/runtime in Shutdown')
    return {'runtimeIdentifier': runtime, 'runtimeVersion': version, 'selectedDevice': device,
            'deviceTypeIdentifier': device_type, 'stateAtVerification': 'Shutdown',
            'runtimeAvailabilityVerified': True,
            'scope': 'Fresh runtime and created-device identity verified before boot. Exact-UUID boot readiness remains required.'}
