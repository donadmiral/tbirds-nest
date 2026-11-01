#!/usr/bin/env python3
"""Inspect the selected Simulator executable, separately from its host signature."""
import argparse
import hashlib
import json
from pathlib import Path
import plistlib
import struct

QA_BUNDLE = 'app.platinumcircles.mobile.qa'
TARGETS = {
    'intel-ios18.5': ('x86_64', 0x01000007),
    'arm64-ios26.2': ('arm64', 0x0100000C),
}


def target_architecture(ios_target):
    if not isinstance(ios_target, str) or ios_target not in TARGETS:
        raise ValueError('Unsupported explicit Simulator entitlement target.')
    return TARGETS[ios_target]


def simulated_entitlements(data, ios_target='intel-ios18.5'):
    architecture, expected_cpu = target_architecture(ios_target)
    if len(data) < 32:
        raise ValueError('Truncated Simulator Mach-O header.')
    magic, cpu, _, _, count, size, _, _ = struct.unpack_from('<8I', data)
    if magic != 0xFEEDFACF or cpu != expected_cpu:
        raise ValueError('Expected the locked thin ' + architecture + ' Simulator executable.')
    end = 32 + size
    if count > 4096 or end > len(data):
        raise ValueError('Invalid Simulator load-command bounds.')
    cursor, platform, sections = 32, None, {}
    for _ in range(count):
        if cursor + 8 > end:
            raise ValueError('Truncated Simulator load command.')
        command, length = struct.unpack_from('<2I', data, cursor)
        if length < 8 or cursor + length > end:
            raise ValueError('Invalid Simulator load-command length.')
        if command == 0x32:  # LC_BUILD_VERSION
            if length < 24:
                raise ValueError('Truncated Simulator build-version command.')
            platform = struct.unpack_from('<I', data, cursor + 8)[0]
        if command == 0x19:  # LC_SEGMENT_64
            if length < 72:
                raise ValueError('Truncated Simulator segment.')
            number = struct.unpack_from('<I', data, cursor + 64)[0]
            if 72 + number * 80 > length:
                raise ValueError('Invalid Simulator section-table bounds.')
            for index in range(number):
                section = cursor + 72 + index * 80
                name = data[section:section + 16].split(b'\0')[0]
                segment = data[section + 16:section + 32].split(b'\0')[0]
                if segment != b'__TEXT' or name not in (b'__entitlements', b'__ents_der'):
                    continue
                byte_count = struct.unpack_from('<Q', data, section + 40)[0]
                offset = struct.unpack_from('<I', data, section + 48)[0]
                if not byte_count or byte_count > 1024 * 1024 or offset < end or offset + byte_count > len(data):
                    raise ValueError('Invalid embedded Simulator entitlement bounds.')
                if name in sections:
                    raise ValueError('Duplicate embedded Simulator entitlement section.')
                sections[name] = data[offset:offset + byte_count]
        cursor += length
    if cursor != end or platform != 7:  # PLATFORM_IOSSIMULATOR
        raise ValueError('Expected an iOS Simulator binary with valid load commands.')
    if b'__entitlements' not in sections or b'__ents_der' not in sections:
        raise ValueError('Xcode did not embed both simulated XML and DER entitlements.')
    value = plistlib.loads(sections[b'__entitlements'].rstrip(b'\0'))
    if not isinstance(value, dict):
        raise ValueError('Embedded Simulator entitlements are not a dictionary.')
    return value, {name.decode(): {'bytes': len(content), 'sha256': hashlib.sha256(content).hexdigest()}
                   for name, content in sections.items()}


def inspect(app, ios_target='intel-ios18.5'):
    architecture, _ = target_architecture(ios_target)
    info_bytes = (app / 'Info.plist').read_bytes()
    info = plistlib.loads(info_bytes)
    if info.get('CFBundleIdentifier') != QA_BUNDLE or info.get('CFBundleSupportedPlatforms') != ['iPhoneSimulator']:
        raise ValueError('Entitlement verification is limited to the disposable QA Simulator app.')
    executable = info.get('CFBundleExecutable')
    if not isinstance(executable, str) or not executable or Path(executable).name != executable:
        raise ValueError('Invalid QA executable name.')
    binary = (app / executable).read_bytes()
    entitlements, sections = simulated_entitlements(binary, ios_target)
    app_id = entitlements.get('application-identifier') or entitlements.get('com.apple.application-identifier')
    if not isinstance(app_id, str) or not (app_id == QA_BUNDLE or app_id.endswith('.' + QA_BUNDLE)) or '$(' in app_id:
        raise ValueError('Missing or incorrect generated QA Simulator application identifier.')
    groups = entitlements.get('keychain-access-groups', [])
    if not isinstance(groups, list) or any(not isinstance(group, str) or not group or '$(' in group for group in groups):
        raise ValueError('Invalid generated Simulator keychain access groups.')
    return {'bundleIdentifier': QA_BUNDLE, 'platform': 'iOS Simulator', 'architecture': architecture,
            'executableSha256': hashlib.sha256(binary).hexdigest(), 'infoPlistSha256': hashlib.sha256(info_bytes).hexdigest(),
            'simulatedEntitlements': entitlements, 'embeddedSections': sections,
            'defaultKeychainAccessGroup': groups[0] if groups else app_id,
            'hostSignatureEntitlementsAreSeparate': True, 'derSectionPresent': True,
            'derSemanticsDecoded': False, 'keychainRuntimeAccepted': False}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('app', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--ios-target', choices=TARGETS, default='intel-ios18.5')
    args = parser.parse_args()
    try:
        result = inspect(args.app, args.ios_target)
        args.output.write_text(json.dumps(result, indent=2) + '\n')
        print('Verified generated QA Simulator application/keychain identity in embedded XML; DER section is present.')
    except (ValueError, OSError, IndexError, struct.error, plistlib.InvalidFileException) as error:
        raise SystemExit('Simulator entitlement verification failed: ' + str(error))
