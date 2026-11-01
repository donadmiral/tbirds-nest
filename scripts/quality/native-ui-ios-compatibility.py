"""Verify an intact Simulator app against its explicit native host/runtime."""
import json
from pathlib import Path
import platform
import plistlib
import re

PACKAGE = 'app.platinumcircles.mobile.qa'
TARGETS = {
    'intel-ios18.5': {'abi': 'x86_64', 'runtimeIdentifier': 'com.apple.CoreSimulator.SimRuntime.iOS-18-5',
                     'runtimeVersion': '18.5', 'deviceTypeIdentifier': 'com.apple.CoreSimulator.SimDeviceType.iPhone-16',
                     'xcode': 'Xcode 16.4\nBuild version 16F6', 'sdkVersion': '18.5'},
    'arm64-ios26.2': {'abi': 'arm64', 'runtimeIdentifier': 'com.apple.CoreSimulator.SimRuntime.iOS-26-2',
                     'runtimeVersion': '26.2', 'deviceTypeIdentifier': 'com.apple.CoreSimulator.SimDeviceType.iPhone-17',
                     'xcode': 'Xcode 26.3\nBuild version 17C529', 'sdkVersion': '26.2'},
}


def expected_target(manifest):
    expected = manifest.get('nativeCompatibility', {})
    if not isinstance(expected, dict):
        raise ValueError('An explicit supported Simulator target is required')
    selected = [(key, value) for key, value in TARGETS.items()
                if expected.get('abi') == value['abi'] and expected.get('runtimeIdentifier') == value['runtimeIdentifier']]
    if len(selected) != 1:
        raise ValueError('Unsupported Simulator compatibility')
    identifier, target = selected[0]
    # Historical Intel manifests predate these two fields. A new ARM app must
    # declare both, so an old x86 artifact cannot be reinterpreted as ARM.
    if (expected.get('targetId', identifier if identifier == 'intel-ios18.5' else None) != identifier
            or expected.get('deviceTypeIdentifier', target['deviceTypeIdentifier'] if identifier == 'intel-ios18.5' else None) != target['deviceTypeIdentifier']):
        raise ValueError('The declared Simulator target identity differs')
    return {'targetId': identifier, **target}


def expected_runtime(manifest):
    return expected_target(manifest)['runtimeIdentifier']


def verify_immutable_compatibility(app, manifest, read, host_system=None):
    """Check actual host/toolchain/app bytes without starting a Simulator."""
    expected = manifest['nativeCompatibility']
    target = expected_target(manifest)
    architecture = target['abi']
    if (host_system or platform.system()) != 'Darwin' or read(['/usr/bin/uname', '-m']) != architecture:
        raise ValueError('The native host architecture must match the compiled Simulator app')
    if (manifest['toolchain']['xcode'] != target['xcode']
            or manifest['toolchain']['sdkVersion'] != target['sdkVersion']):
        raise ValueError('The toolchain must match the explicit Simulator target')
    if read(['xcodebuild', '-version']) != manifest['toolchain']['xcode']:
        raise ValueError('Xcode differs from the binary producer')
    if read(['xcrun', '--sdk', 'iphonesimulator', '--show-sdk-version']) != manifest['toolchain']['sdkVersion']:
        raise ValueError('Simulator SDK differs from the binary producer')
    info = plistlib.loads((app / 'Info.plist').read_bytes())
    executable = info.get('CFBundleExecutable', '')
    if info.get('CFBundleIdentifier') != PACKAGE or info.get('DTPlatformName') != 'iphonesimulator' or not executable or Path(executable).name != executable:
        raise ValueError('The actual app is not the expected Simulator bundle')
    if (expected['sdk'] != 'iphonesimulator' + target['sdkVersion']
            or info.get('DTSDKName') != expected['sdk'] or info.get('MinimumOSVersion') != expected['minimumOSVersion']):
        raise ValueError('The actual app SDK/deployment metadata differs')
    if read(['xcrun', 'lipo', str(app / executable), '-archs']).split() != [architecture]:
        raise ValueError('The actual app Mach-O architecture differs')
    read(['codesign', '--verify', '--deep', '--strict', str(app)])
    return {'hostArchitecture': architecture, 'actualExecutableArchitecture': architecture,
            'xcode': manifest['toolchain']['xcode'], 'sdkVersion': manifest['toolchain']['sdkVersion'],
            'codeSignatureVerified': True, 'guestUnameInvoked': False,
            'scope': 'Actual host, producer toolchain, Simulator bundle metadata, Mach-O and signature. Runtime/device checks remain required.'}


def verify_booted_runtime(manifest, device, read):
    """Check the live selected device after boot, without querying build tools."""
    runtime = expected_runtime(manifest)
    runtimes = json.loads(read(['xcrun', 'simctl', 'list', 'runtimes', '--json']))['runtimes']
    selected_runtime = [row for row in runtimes if row.get('identifier') == runtime and row.get('isAvailable')]
    version = runtime.rsplit('.iOS-', 1)[1].replace('-', '.')
    if len(selected_runtime) != 1 or selected_runtime[0].get('version') != version:
        raise ValueError('The original available iOS runtime is required')
    devices = json.loads(read(['xcrun', 'simctl', 'list', 'devices', '--json']))['devices']
    selected = [row for row in devices.get(runtime, []) if row.get('udid') == device and row.get('state') == 'Booted']
    if len(selected) != 1:
        raise ValueError('The selected device is not booted in the original runtime')
    return {'runtimeIdentifier': runtime, 'runtimeVersion': version, 'selectedDevice': device,
            'scope': 'Live available runtime/version and the exact selected Booted device. App launch remains required.'}


def verify_prepared_booted_runtime(manifest, device, prepared):
    """Validate the original preboot identity plus exact-UUID readiness proof."""
    runtime = expected_runtime(manifest)
    version = runtime.rsplit('.iOS-', 1)[1].replace('-', '.')
    source = manifest.get('applicationSourceCommit')
    device_type = expected_target(manifest)['deviceTypeIdentifier']
    if (not isinstance(device, str)
            or not re.fullmatch(r'[A-Fa-f0-9]{8}(?:-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12}', device)
            or not isinstance(source, str) or not re.fullmatch(r'[0-9a-f]{40}', source)
            or not isinstance(prepared, dict)):
        raise ValueError('An exact source-bound owned Simulator setup receipt is required')
    verified = prepared.get('verification')
    if (not isinstance(verified, dict) or prepared.get('device') != device
            or prepared.get('created') is not True or prepared.get('bootReady') is not True
            or prepared.get('sourceCommit') != source
            or prepared.get('runtimeIdentifier') != runtime
            or prepared.get('deviceTypeIdentifier') != device_type
            or verified.get('selectedDevice') != device
            or verified.get('runtimeIdentifier') != runtime
            or verified.get('runtimeVersion') != version
            or verified.get('deviceTypeIdentifier') != device_type
            or verified.get('runtimeAvailabilityVerified') is not True
            or verified.get('stateAtVerification') != 'Shutdown'):
        raise ValueError('Verified preboot identity and completed exact-UUID boot readiness are required')
    return {'runtimeIdentifier': runtime, 'runtimeVersion': version, 'selectedDevice': device,
            'deviceTypeIdentifier': device_type, 'prebootRuntimeAvailabilityVerified': True,
            'exactUuidBootstatusCompleted': True, 'postbootMetadataRead': False,
            'postbootIdentityAndVersionReadFromDevice': False,
            'globalInventoryRepeatedAfterBoot': False, 'guestArchitectureMeasured': False,
            'proofMethod': 'verified-preboot-identity-and-completed-exact-uuid-bootstatus',
            'scope': 'Exact runtime/version/type/availability verified before boot; boot and blocking bootstatus completed for that owned UUID. No postboot metadata read is claimed. Actual installation and app launch remain required.'}


def verify_compatibility(app, manifest, device, read, host_system=None):
    immutable = verify_immutable_compatibility(app, manifest, read, host_system)
    runtime = verify_booted_runtime(manifest, device, read)
    return {**immutable, **runtime,
            'scope': 'Matching native host, exact runtime, actual Simulator Mach-O and signature. App launch is still a required case action.'}
