import importlib.util
import json
from pathlib import Path
import plistlib
import struct
import subprocess
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
    def inspect(self, entitlements=None, bundle=None, supported=None, binary=None, ios_target='intel-ios18.5'):
        with tempfile.TemporaryDirectory(prefix='native-qa-entitlements-') as directory:
            app = Path(directory) / 'PlatinumQA.app'
            app.mkdir()
            (app / 'Info.plist').write_bytes(plistlib.dumps({'CFBundleIdentifier': bundle or READER.QA_BUNDLE,
                'CFBundleSupportedPlatforms': supported or ['iPhoneSimulator'], 'CFBundleExecutable': 'PlatinumQA'}))
            (app / 'PlatinumQA').write_bytes(binary if binary is not None else executable(
                entitlements if entitlements is not None else {'application-identifier': APP_ID}))
            return READER.inspect(app, ios_target)

    def test_generated_application_identity_is_default_keychain_group(self):
        result = self.inspect()
        self.assertEqual(result['defaultKeychainAccessGroup'], APP_ID)
        self.assertEqual(result['platform'], 'iOS Simulator')
        self.assertEqual(result['architecture'], 'x86_64')
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

    def test_arm_target_accepts_only_its_thin_simulator_cpu_and_keeps_identity_guards(self):
        identity = {'application-identifier': APP_ID, 'keychain-access-groups': [APP_ID]}
        binary = executable(identity, cpu=0x0100000C)
        result = self.inspect(binary=binary, ios_target='arm64-ios26.2')
        self.assertEqual(result['architecture'], 'arm64')
        self.assertEqual(result['defaultKeychainAccessGroup'], APP_ID)
        self.assertEqual(result['simulatedEntitlements'], identity)
        self.assertEqual(set(result['embeddedSections']), {'__entitlements', '__ents_der'})
        self.assertTrue(result['hostSignatureEntitlementsAreSeparate'])
        self.assertFalse(result['keychainRuntimeAccepted'])
        for options in ({'cpu': 0x01000007}, {'cpu': 0x0100000C, 'platform': 2},
                        {'cpu': 0x0100000C, 'omit': b'__entitlements'},
                        {'cpu': 0x0100000C, 'omit': b'__ents_der'}):
            with self.subTest(options=options), self.assertRaises(ValueError):
                self.inspect(binary=executable(identity, **options), ios_target='arm64-ios26.2')
        for invalid in ({}, {'application-identifier': 'other.app'},
                        {'application-identifier': '$(AppIdentifierPrefix)' + READER.QA_BUNDLE},
                        {'application-identifier': APP_ID, 'keychain-access-groups': ['']}):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                self.inspect(binary=executable(invalid, cpu=0x0100000C), ios_target='arm64-ios26.2')

    def test_unknown_targets_and_fat_or_wrong_cpu_binaries_are_rejected(self):
        identity = {'application-identifier': APP_ID}
        for target in (None, '', 'arm64', 'auto', 'arm64-ios18.5'):
            with self.subTest(target=target), self.assertRaisesRegex(ValueError, 'Unsupported explicit'):
                self.inspect(ios_target=target)
        for target, cpu in (('intel-ios18.5', 0x01000007), ('arm64-ios26.2', 0x0100000C)):
            for mutation in ('fat', 'unknown-cpu', 'truncated', 'section-bounds'):
                binary = bytearray(executable(identity, cpu=cpu))
                if mutation == 'fat':
                    struct.pack_into('>I', binary, 0, 0xCAFEBABE)
                elif mutation == 'unknown-cpu':
                    struct.pack_into('<I', binary, 4, 12)
                elif mutation == 'truncated':
                    binary = binary[:40]
                else:
                    struct.pack_into('<I', binary, 32 + 24 + 72 + 48, len(binary) + 100)
                with self.subTest(target=target, mutation=mutation), self.assertRaises(ValueError):
                    self.inspect(binary=bytes(binary), ios_target=target)

    def test_actual_cli_requires_the_explicit_arm_target_and_preserves_intel_default(self):
        with tempfile.TemporaryDirectory(prefix='native-qa-entitlements-cli-') as directory:
            app = Path(directory) / 'PlatinumQA.app'
            app.mkdir()
            (app / 'Info.plist').write_bytes(plistlib.dumps({'CFBundleIdentifier': READER.QA_BUNDLE,
                'CFBundleSupportedPlatforms': ['iPhoneSimulator'], 'CFBundleExecutable': 'PlatinumQA'}))
            output = Path(directory) / 'report.json'
            command = [sys.executable, str(ROOT / 'scripts/quality/native-ui-ios-entitlements.py'), str(app), str(output)]
            for target, cpu, architecture in (('intel-ios18.5', 0x01000007, 'x86_64'), ('arm64-ios26.2', 0x0100000C, 'arm64')):
                (app / 'PlatinumQA').write_bytes(executable({'application-identifier': APP_ID}, cpu=cpu))
                selected = command if target == 'intel-ios18.5' else command + ['--ios-target', target]
                completed = subprocess.run(selected, capture_output=True, text=True, timeout=5)
                self.assertEqual(completed.returncode, 0, completed.stderr)
                self.assertEqual(json.loads(output.read_text())['architecture'], architecture)
                output.unlink()
            failed = subprocess.run(command, capture_output=True, text=True, timeout=5)
            self.assertNotEqual(failed.returncode, 0)
            self.assertIn('locked thin x86_64', failed.stderr)
            self.assertFalse(output.exists())


if __name__ == '__main__':
    unittest.main()
