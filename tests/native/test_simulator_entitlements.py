import importlib.util
from pathlib import Path
import plistlib
import struct
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.dont_write_bytecode = True
SPEC = importlib.util.spec_from_file_location('simulator_entitlements', ROOT / 'scripts/quality/native-ui-ios-entitlements.py')
READER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(READER)
APP_ID = 'local.' + READER.QA_BUNDLE


def executable(entitlements, platform=7, cpu=0x01000007, omit=None):
    sections = [(b'__entitlements', plistlib.dumps(entitlements)), (b'__ents_der', b'\x30\x00')]
    sections = [(name, value) for name, value in sections if name != omit]
    segment_size = 72 + len(sections) * 80
    command_size = 24 + segment_size
    offset = 32 + command_size
    header = struct.pack('<8I', 0xFEEDFACF, cpu, 3, 2, 2, command_size, 0, 0)
    version = struct.pack('<6I', 0x32, 24, platform, 0x120500, 0x120500, 0)
    segment = struct.pack('<2I16s4Q4I', 0x19, segment_size, b'__TEXT', 0, offset + sum(len(value) for _, value in sections),
                          0, offset + sum(len(value) for _, value in sections), 7, 5, len(sections), 0)
    table, payload = b'', b''
    for name, value in sections:
        table += struct.pack('<16s16s2Q8I', name, b'__TEXT', offset, len(value), offset, 0, 0, 0, 0, 0, 0, 0)
        payload += value
        offset += len(value)
    return header + version + segment + table + payload


class SimulatorEntitlements(unittest.TestCase):
    def inspect(self, entitlements=None, bundle=None, supported=None, binary=None):
        with tempfile.TemporaryDirectory(prefix='native-qa-entitlements-') as directory:
            app = Path(directory) / 'PlatinumQA.app'
            app.mkdir()
            (app / 'Info.plist').write_bytes(plistlib.dumps({'CFBundleIdentifier': bundle or READER.QA_BUNDLE,
                'CFBundleSupportedPlatforms': supported or ['iPhoneSimulator'], 'CFBundleExecutable': 'PlatinumQA'}))
            (app / 'PlatinumQA').write_bytes(binary if binary is not None else executable(
                entitlements if entitlements is not None else {'application-identifier': APP_ID}))
            return READER.inspect(app)

    def test_generated_application_identity_is_default_keychain_group(self):
        result = self.inspect()
        self.assertEqual(result['defaultKeychainAccessGroup'], APP_ID)
        self.assertEqual(result['platform'], 'iOS Simulator')
        self.assertEqual(set(result['embeddedSections']), {'__entitlements', '__ents_der'})
        self.assertFalse(result['keychainRuntimeAccepted'])
        self.assertFalse(result['derSemanticsDecoded'])

    def test_explicit_generated_keychain_group_is_reported(self):
        self.assertEqual(self.inspect({'application-identifier': APP_ID, 'keychain-access-groups': [APP_ID]})
                         ['defaultKeychainAccessGroup'], APP_ID)

    def test_other_apps_and_hardware_builds_are_rejected(self):
        for options in ({'bundle': 'app.platinumcircles.mobile'}, {'supported': ['iPhoneOS']}):
            with self.subTest(options=options), self.assertRaisesRegex(ValueError, 'disposable QA Simulator'):
                self.inspect(**options)

    def test_missing_wrong_or_unexpanded_application_identity_is_rejected(self):
        for entitlements in ({}, {'application-identifier': 'other.app'},
                             {'application-identifier': '$(AppIdentifierPrefix)' + READER.QA_BUNDLE}):
            with self.subTest(entitlements=entitlements), self.assertRaisesRegex(ValueError, 'application identifier'):
                self.inspect(entitlements)

    def test_invalid_keychain_groups_are_rejected(self):
        for groups in ('one-group', [123], [''], ['$(AppIdentifierPrefix)' + READER.QA_BUNDLE]):
            with self.subTest(groups=groups), self.assertRaisesRegex(ValueError, 'keychain access groups'):
                self.inspect({'application-identifier': APP_ID, 'keychain-access-groups': groups})

    def test_wrong_architecture_and_platform_are_rejected(self):
        for options in ({'cpu': 0x0100000C}, {'platform': 2}):
            with self.subTest(options=options), self.assertRaises(ValueError):
                self.inspect(binary=executable({'application-identifier': APP_ID}, **options))

    def test_both_simulated_sections_are_required(self):
        for omit in (b'__entitlements', b'__ents_der'):
            with self.subTest(omit=omit), self.assertRaisesRegex(ValueError, 'both simulated XML and DER'):
                self.inspect(binary=executable({'application-identifier': APP_ID}, omit=omit))

    def test_truncated_header_load_commands_and_payload_are_rejected(self):
        binary = executable({'application-identifier': APP_ID})
        for truncated in (binary[:8], binary[:40], binary[:-1]):
            with self.subTest(length=len(truncated)), self.assertRaises(ValueError):
                self.inspect(binary=truncated)

    def test_out_of_bounds_section_is_rejected(self):
        binary = bytearray(executable({'application-identifier': APP_ID}))
        struct.pack_into('<I', binary, 32 + 24 + 72 + 48, len(binary) + 100)
        with self.assertRaisesRegex(ValueError, 'entitlement bounds'):
            self.inspect(binary=bytes(binary))


if __name__ == '__main__':
    unittest.main()
