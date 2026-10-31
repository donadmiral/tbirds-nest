#!/usr/bin/env python3
"""Inspect the real Intel Simulator executable, separately from its host signature."""
import hashlib
import json
from pathlib import Path
import plistlib
import struct
import sys

QA_BUNDLE = 'app.platinumcircles.mobile.qa'


def simulated_entitlements(data):
    if len(data) < 32:
        raise ValueError('Truncated Simulator Mach-O header.')
    magic, cpu, _, _, count, size, _, _ = struct.unpack_from('<8I', data)
    if magic != 0xFEEDFACF or cpu != 0x01000007:
        raise ValueError('Expected the locked thin x86_64 Simulator executable.')
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


def inspect(app):
    info_bytes = (app / 'Info.plist').read_bytes()
    info = plistlib.loads(info_bytes)
    if info.get('CFBundleIdentifier') != QA_BUNDLE or info.get('CFBundleSupportedPlatforms') != ['iPhoneSimulator']:
        raise ValueError('Entitlement verification is limited to the disposable QA Simulator app.')
    executable = info.get('CFBundleExecutable')
    if not isinstance(executable, str) or not executable or Path(executable).name != executable:
        raise ValueError('Invalid QA executable name.')
    binary = (app / executable).read_bytes()
    entitlements, sections = simulated_entitlements(binary)
    app_id = entitlements.get('application-identifier') or entitlements.get('com.apple.application-identifier')
    if not isinstance(app_id, str) or not (app_id == QA_BUNDLE or app_id.endswith('.' + QA_BUNDLE)) or '$(' in app_id:
        raise ValueError('Missing or incorrect generated QA Simulator application identifier.')
    groups = entitlements.get('keychain-access-groups', [])
    if not isinstance(groups, list) or any(not isinstance(group, str) or not group or '$(' in group for group in groups):
        raise ValueError('Invalid generated Simulator keychain access groups.')
    return {'bundleIdentifier': QA_BUNDLE, 'platform': 'iOS Simulator', 'architecture': 'x86_64',
            'executableSha256': hashlib.sha256(binary).hexdigest(), 'infoPlistSha256': hashlib.sha256(info_bytes).hexdigest(),
            'simulatedEntitlements': entitlements, 'embeddedSections': sections,
            'defaultKeychainAccessGroup': groups[0] if groups else app_id,
            'hostSignatureEntitlementsAreSeparate': True, 'derSectionPresent': True,
            'derSemanticsDecoded': False, 'keychainRuntimeAccepted': False}


if __name__ == '__main__':
    try:
        result = inspect(Path(sys.argv[1]))
        Path(sys.argv[2]).write_text(json.dumps(result, indent=2) + '\n')
        print('Verified generated QA Simulator application/keychain identity in embedded XML; DER section is present.')
    except (ValueError, OSError, IndexError, struct.error, plistlib.InvalidFileException) as error:
        raise SystemExit('Simulator entitlement verification failed: ' + str(error))
