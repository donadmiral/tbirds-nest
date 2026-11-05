#!/usr/bin/env python3
"""Deliver one fixture URL while XCTest is inactive and observe the existing receipt."""
import json
from pathlib import Path
import re
import subprocess
import sys
import time


def events(receipt):
    rows = receipt.get('captureBoundaries')
    if receipt.get('mode') != 'synthetic-native-ui' or receipt.get('networkForwarded') is not False or receipt.get('captureBoundaryDropped') != 0 or not isinstance(rows, list):
        raise ValueError('Missing complete synthetic capture boundary receipt')
    if len(rows) > 32 or any(row.get('sequence') != index + 1 for index, row in enumerate(rows)):
        raise ValueError('Invalid capture boundary sequence')
    return rows


def ready(receipt, baseline):
    required = [('received', {'matched': True}), ('parsed', {'matched': True, 'expectedPath': True}),
                ('action-produced', {'matched': True}), ('mounted', {}),
                ('readback-complete', {'fulfilled': True, 'passed': True})]
    position = 0
    for row in events(receipt):
        if row['sequence'] <= baseline:
            continue
        phase, fields = required[position]
        if row.get('phase') == phase and all(row.get(key) is value for key, value in fields.items()):
            position += 1
            if position == len(required):
                return True
    return False


def read_receipt(path):
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 1024 * 1024:
        raise ValueError('Capture receipt is missing or exceeds its read budget')
    return json.loads(path.read_text())


def main():
    if len(sys.argv) != 2 or not re.fullmatch(r'[A-Fa-f0-9]{8}(?:-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12}', sys.argv[1]):
        raise ValueError('Exact owned Simulator UUID required')
    started = time.monotonic()
    remaining = lambda: max(.01, 15 - (time.monotonic() - started))
    proof = {'method': 'simctl-openurl-before-Maestro', 'attempts': 1, 'routeReceiptVerified': False}
    code = 1
    try:
        container = subprocess.check_output(['xcrun', 'simctl', 'get_app_container', sys.argv[1],
            'app.platinumcircles.mobile.qa', 'data'], timeout=remaining()).decode().strip()
        path = Path(container) / 'Documents/native-ui-receipt.json'
        baseline = len(events(read_receipt(path)))
        proof['baselineSequence'] = baseline
        subprocess.run(['xcrun', 'simctl', 'openurl', sys.argv[1], 'platinum-circles-qa://ui-fixture/memory'],
            capture_output=True, check=True, timeout=remaining())
        while time.monotonic() - started < 15:
            try:
                receipt = read_receipt(path)
                if ready(receipt, baseline):
                    proof.update(routeReceiptVerified=True, observedSequence=len(events(receipt)))
                    code = 0
                    break
            except (OSError, ValueError, TypeError, AttributeError):
                pass  # Native writes can be observed between truncation and completion.
            time.sleep(min(.1, remaining()))
        if code:
            proof['error'] = 'No fresh complete capture entry receipt within the 15-second handoff budget'
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        proof['error'] = type(error).__name__
    proof.update(exitCode=code, elapsedSeconds=time.monotonic() - started)
    Path('native-ui-logs/ios-memory-handoff.json').write_text(json.dumps(proof, indent=2) + '\n')
    return code


if __name__ == '__main__':
    sys.exit(main())
