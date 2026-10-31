"""Verify a freshly created, pinned Simulator before its first boot."""
import json
import re

RUNTIME = 'com.apple.CoreSimulator.SimRuntime.iOS-18-5'
VERSION = '18.5'
DEVICE_TYPE = 'com.apple.CoreSimulator.SimDeviceType.iPhone-16'


def validate_device_identifier(value):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Fa-f0-9]{8}(?:-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12}', value):
        raise ValueError('Creation must return exactly one device UUID')
    return value


def verify_created_device(manifest, device, read):
    """Read actual metadata once while the owned device is still shut down."""
    validate_device_identifier(device)
    expected = manifest['nativeCompatibility']
    if expected.get('abi') != 'x86_64' or expected.get('runtimeIdentifier') != RUNTIME:
        raise ValueError('The pinned Intel iOS18.5 runtime is required')
    runtimes = json.loads(read(['xcrun', 'simctl', 'list', 'runtimes', '--json']))
    if not isinstance(runtimes, dict) or not isinstance(runtimes.get('runtimes'), list):
        raise ValueError('Missing runtime inventory')
    selected_runtime = [row for row in runtimes['runtimes'] if isinstance(row, dict) and row.get('identifier') == RUNTIME]
    if len(selected_runtime) != 1 or selected_runtime[0].get('isAvailable') is not True or selected_runtime[0].get('version') != VERSION:
        raise ValueError('Exactly one available original runtime/version is required')
    inventory = json.loads(read(['xcrun', 'simctl', 'list', 'devices', '--json']))
    if not isinstance(inventory, dict) or not isinstance(inventory.get('devices'), dict):
        raise ValueError('Missing created-device inventory')
    selected = []
    for runtime, rows in inventory['devices'].items():
        if not isinstance(rows, list):
            raise ValueError('Malformed device inventory')
        selected.extend((runtime, row) for row in rows if isinstance(row, dict) and row.get('udid') == device)
    if len(selected) != 1:
        raise ValueError('The returned UUID must identify exactly one device')
    runtime, row = selected[0]
    if (runtime != RUNTIME or row.get('deviceTypeIdentifier') != DEVICE_TYPE
            or row.get('isAvailable') is not True or row.get('state') != 'Shutdown'):
        raise ValueError('The freshly created device must be the available original iPhone16 in Shutdown')
    return {'runtimeIdentifier': RUNTIME, 'runtimeVersion': VERSION, 'selectedDevice': device,
            'deviceTypeIdentifier': DEVICE_TYPE, 'stateAtVerification': 'Shutdown',
            'runtimeAvailabilityVerified': True,
            'scope': 'Fresh runtime and created-device identity verified before boot. Exact-UUID boot readiness remains required.'}
