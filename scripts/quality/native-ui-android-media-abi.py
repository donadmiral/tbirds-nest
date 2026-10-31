#!/usr/bin/env python3
"""Verify the load-control ABI defined in the assembled APK, without executing it."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import struct
import sys
import zipfile

EXPO = 'Lexpo/modules/video/player/DefaultLoadControl;'
INTERFACE = 'Landroidx/media3/exoplayer/LoadControl;'
PLAYER = 'Landroidx/media3/exoplayer/analytics/PlayerId;'
ALLOCATOR = ('getAllocator', (PLAYER,), 'Landroidx/media3/exoplayer/upstream/Allocator;')
PRELOAD = ('shouldContinuePreloading', (PLAYER, 'Landroidx/media3/common/Timeline;',
           'Landroidx/media3/exoplayer/source/MediaSource$MediaPeriodId;', 'J'), 'Z')
SOURCE_HASH = 'f628d5385071a6c2139cd17d9c7adf833dfd27e6eef52958101558b2849deb0d'
GRADLE_HASH = '843508193c2f3d9e2bd214c01fe15f66a2684891058c8023ec3745fbc7e2e3f6'


def sha(data):
    return hashlib.sha256(data).hexdigest()


class Dex:
    """Read only class definitions and method prototypes (AOSP DEX 035–040)."""
    def __init__(self, data):
        self.data = data
        if len(data) < 112 or data[:8] not in [b'dex\n' + v + b'\0' for v in
                                               (b'035', b'037', b'038', b'039', b'040')]:
            raise ValueError('Unsupported or incomplete DEX header.')
        if self.u32(32) != len(data) or self.u32(36) != 112 or self.u32(40) != 0x12345678:
            raise ValueError('Invalid DEX size, header or byte order.')
        tables = struct.unpack_from('<12I', data, 56)
        self.tables = dict(zip(('strings', 'types', 'protos', 'fields', 'methods', 'classes'),
                               zip(tables[::2], tables[1::2])))
        for name, width in [('strings', 4), ('types', 4), ('protos', 12),
                            ('fields', 8), ('methods', 8), ('classes', 32)]:
            count, offset = self.tables[name]
            self.check(offset, count * width)
        self.strings = {}

    def check(self, offset, size):
        if offset < 0 or size < 0 or offset + size > len(self.data):
            raise ValueError('DEX range exceeds the retained file.')

    def u32(self, offset):
        self.check(offset, 4)
        return struct.unpack_from('<I', self.data, offset)[0]

    def leb(self, offset):
        value = 0
        for shift in range(0, 35, 7):
            self.check(offset, 1)
            byte = self.data[offset]
            offset += 1
            if shift == 28 and byte > 15:
                raise ValueError('Invalid DEX ULEB128 value.')
            value |= (byte & 127) << shift
            if not byte & 128:
                return value, offset
        raise ValueError('Unterminated DEX ULEB128 value.')

    def entry(self, table, index, width):
        count, offset = self.tables[table]
        if index < 0 or index >= count:
            raise ValueError('DEX table index is out of range.')
        return offset + index * width

    def string(self, index):
        if index not in self.strings:
            _, offset = self.leb(self.u32(self.entry('strings', index, 4)))
            end = self.data.find(b'\0', offset, min(offset + 65536, len(self.data)))
            if end < 0:
                raise ValueError('Missing or oversized DEX string terminator.')
            # All class descriptors/method names inspected here are ASCII.
            # Unrelated UTF-16 strings are not interpreted by this verifier.
            self.strings[index] = self.data[offset:end].decode('utf-8', errors='replace')
        return self.strings[index]

    def type(self, index):
        return self.string(self.u32(self.entry('types', index, 4)))

    def type_list(self, offset):
        if not offset:
            return []
        size = self.u32(offset)
        self.check(offset + 4, size * 2)
        return [self.type(struct.unpack_from('<H', self.data, offset + 4 + i * 2)[0])
                for i in range(size)]

    def method(self, index):
        owner, proto, name = struct.unpack_from('<HHI', self.data, self.entry('methods', index, 8))
        _, returns, arguments = struct.unpack_from('<3I', self.data, self.entry('protos', proto, 12))
        return {'owner': self.type(owner), 'name': self.string(name),
                'parameters': self.type_list(arguments), 'returns': self.type(returns)}

    def selected_classes(self):
        count, offset = self.tables['classes']
        result = []
        for i in range(count):
            klass, flags, parent, interfaces, _, _, data, _ = struct.unpack_from(
                '<8I', self.data, offset + i * 32)
            name = self.type(klass)
            if name not in (EXPO, INTERFACE):
                continue
            row = {'class': name, 'flags': flags,
                   'super': self.type(parent) if parent != 0xffffffff else None,
                   'interfaces': self.type_list(interfaces), 'methods': []}
            if data:
                counts = []
                for _ in range(4):
                    n, data = self.leb(data)
                    counts.append(n)
                # Every encoded member requires at least two bytes.
                if sum(counts) > len(self.data) // 2:
                    raise ValueError('Invalid DEX member count.')
                for _ in range(counts[0] + counts[1]):
                    _, data = self.leb(data)
                    _, data = self.leb(data)
                for kind, n in [('direct', counts[2]), ('virtual', counts[3])]:
                    method_index = 0
                    for _ in range(n):
                        difference, data = self.leb(data)
                        method_index += difference
                        access, data = self.leb(data)
                        code, data = self.leb(data)
                        method = self.method(method_index)
                        if method['owner'] != name:
                            raise ValueError('DEX method is defined under the wrong class.')
                        if code:
                            self.check(code, 16)
                            self.check(code + 16, self.u32(code + 12) * 2)
                        row['methods'].append({**method, 'flags': access,
                                               'hasCode': code != 0, 'kind': kind})
            result.append(row)
        return result


def signature(method):
    return method['name'], tuple(method['parameters']), method['returns']


def validate_classes(classes):
    selected = {}
    for row in classes:
        if row['class'] in selected:
            raise ValueError('Duplicate load-control class definitions across DEX files.')
        selected[row['class']] = row
    if set(selected) != {EXPO, INTERFACE}:
        raise ValueError('Both packaged Expo and Media3 load-control classes are required.')
    implementation, contract = selected[EXPO], selected[INTERFACE]
    if (implementation['super'] != 'Ljava/lang/Object;' or INTERFACE not in implementation['interfaces']
            or implementation['flags'] & 0x600 or not contract['flags'] & 0x200
            or contract['interfaces']):
        raise ValueError('The reviewed load-control class/interface hierarchy changed.')
    methods = {signature(m): m for m in implementation['methods']}
    contracts = {signature(m): m for m in contract['methods'] if m['kind'] == 'virtual'}
    if len(methods) != len(implementation['methods']) or len(contracts) != len([
            m for m in contract['methods'] if m['kind'] == 'virtual']):
        raise ValueError('Duplicate method definitions in a load-control class.')
    required = {sig for sig, m in contracts.items() if m['flags'] & 0x400} | {ALLOCATOR, PRELOAD}
    missing = []
    for sig in sorted(required):
        method = methods.get(sig)
        if sig not in contracts or not method or not method['hasCode'] or method['kind'] != 'virtual' \
                or not method['flags'] & 1 or method['flags'] & (0x400 | 0x8):
            missing.append(sig)
    # Check every Expo override that names an interface method, including
    # nonabstract defaults, so an old overload cannot silently lose behavior.
    names = {sig[0] for sig in contracts}
    mismatched = [sig for sig in methods if sig[0] in names and sig not in contracts]
    if missing or mismatched:
        raise ValueError('Packaged Expo/Media3 ABI mismatch: ' + json.dumps({
            'missingConcreteMethods': missing, 'obsoleteOverrides': mismatched}))
    return {'passed': True, 'abstractMethodsChecked': sum(bool(m['flags'] & 0x400)
                                                       for m in contracts.values()),
            'expoOverridesChecked': sum(sig[0] in names for sig in methods),
            'requiredSignatures': sorted(required)}


def inspect_apk(apk):
    classes = []
    with zipfile.ZipFile(apk) as archive:
        dex_files = [p for p in archive.infolist() if re.fullmatch(r'classes(?:[1-9][0-9]*)?\.dex', p.filename)]
        if not dex_files or len(dex_files) > 64 or len({p.filename for p in dex_files}) != len(dex_files):
            raise ValueError('Missing, duplicate or excessive APK DEX entries.')
        if sum(p.file_size for p in dex_files) > 512 * 1024 * 1024:
            raise ValueError('APK DEX input exceeds the inspection bound.')
        for info in dex_files:
            if info.file_size > 128 * 1024 * 1024:
                raise ValueError('A DEX entry exceeds the inspection bound.')
            data = archive.read(info)
            for row in Dex(data).selected_classes():
                classes.append({**row, 'dex': info.filename, 'dexSha256': sha(data)})
    return classes


def verify_source(root):
    package = json.loads((root / 'package.json').read_text())
    selected = package.get('expo', {}).get('autolinking', {}).get('android', {}).get('buildFromSource', [])
    if 'expo-video' not in selected:
        raise ValueError('Expo video must be explicitly built from its adapted Android source.')
    video = root / 'node_modules/expo-video'
    if json.loads((video / 'package.json').read_text())['version'] != '3.0.16':
        raise ValueError('Review the packaged ABI gate for the changed Expo video version.')
    expected = {'android/src/main/java/expo/modules/video/player/DefaultLoadControl.java': SOURCE_HASH,
                'android/build.gradle': GRADLE_HASH}
    for relative, expected_hash in expected.items():
        if sha((video / relative).read_bytes()) != expected_hash:
            raise ValueError('The reviewed Expo source/compile dependencies were not adapted: ' + relative)
    return {'expoVideoVersion': '3.0.16', 'buildFromSource': ['expo-video'], 'appliedHashes': expected}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apk', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--project-root', type=Path, default=Path.cwd())
    args = parser.parse_args()
    result = {'schema': 1, 'passed': False,
              'scope': 'Packaged class-definition ABI and adapted-source proof; not playback or encoded-media acceptance.'}
    try:
        result['apk'] = {'path': str(args.apk), 'sha256': sha(args.apk.read_bytes())}
        result['classes'] = inspect_apk(args.apk)
        result['abi'] = validate_classes(result['classes'])
        result['source'] = verify_source(args.project_root)
        result['passed'] = True
    except (OSError, ValueError, KeyError, struct.error, zipfile.BadZipFile) as error:
        result['error'] = str(error)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + '\n')
    if not result['passed']:
        print(result['error'], file=sys.stderr)
        return 1
    print('Packaged Expo load control implements the aligned Media3 ABI.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
