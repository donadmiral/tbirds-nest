#!/usr/bin/env python3
"""Acquire root on the disposable QA emulator, with one bounded transport recovery."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import time

SERIAL = 'emulator-5556'

def root_device(adb, output, execute=subprocess.run, clock=time.monotonic):
    if os.environ.get('CI') != 'true' or os.environ.get('EXPO_PUBLIC_APP_ENV') != 'qa':
        raise ValueError('Root recovery requires disposable QA CI')
    if not Path(adb).is_absolute() or Path(adb).name != 'adb':
        raise ValueError('Use the explicit SDK adb')
    deadline = clock() + 60
    records = []
    receipt = {'device': SERIAL, 'deadlineSeconds': 60, 'maximumRootAttempts': 2,
               'maximumReconnects': 1, 'success': False, 'commands': records}

    def call(args):
        remaining = deadline - clock()
        if remaining <= 0:
            raise ValueError('Shared root recovery deadline exhausted')
        response = execute([adb, '-s', SERIAL, *args], capture_output=True, text=True,
                           timeout=min(20, remaining))
        text = (response.stdout + response.stderr).strip()
        records.append({'args': args, 'exitCode': response.returncode, 'output': text[:1200]})
        return response.returncode, text

    def require(args, expected):
        code, text = call(args)
        if code or text != expected:
            raise ValueError('Emulator identity or root verification failed: ' + ' '.join(args))

    def acquire():
        code, text = call(['root'])
        if code:
            return code, text
        code, text = call(['wait-for-device'])
        if code:
            return code, text
        code, text = call(['shell', 'id', '-u'])
        if not code and text == '0':
            return 0, '0'
        return code or 1, text

    try:
        require(['shell', 'getprop', 'ro.kernel.qemu'], '1')
        require(['shell', 'getprop', 'ro.product.cpu.abi'], 'x86_64')
        require(['shell', 'getprop', 'ro.build.version.sdk'], '35')
        code, text = acquire()
        if code:
            if not re.search(r'\b(closed|offline)\b|device .+ not found|no devices/emulators found', text, re.I):
                raise ValueError('Non-transient root failure: ' + text)
            # Only this already-verified disposable emulator transport is reset.
            call(['reconnect'])
            require(['wait-for-device'], '')
            require(['shell', 'getprop', 'ro.kernel.qemu'], '1')
            require(['shell', 'getprop', 'ro.product.cpu.abi'], 'x86_64')
            require(['shell', 'getprop', 'ro.build.version.sdk'], '35')
            code, text = acquire()
            if code:
                raise ValueError('Root recovery failed: ' + text)
        receipt['success'] = True
        receipt['verifiedUid'] = 0
    finally:
        output.write_text(json.dumps(receipt, indent=2) + '\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--adb', required=True)
    args = parser.parse_args()
    root_device(args.adb, Path('native-ui-logs/adb-root-recovery.json'))
