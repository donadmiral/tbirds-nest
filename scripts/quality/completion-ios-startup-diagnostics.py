#!/usr/bin/env python3
"""Bounded, read-only evidence while the first CoreSimulator client is live."""
import os
from pathlib import Path
import subprocess
import threading
import time

PROCESS_NAMES = {'simctl', 'com.apple.CoreSimulator.CoreSimulatorService', 'simdiskimaged', 'Simulator'}
PROCESS_ROOTS = ('/Applications/Xcode_', '/Library/Developer/', '/System/Library/')


def selected_processes(rows, identify, uid):
    """Read executable identity, never process arguments or environment."""
    selected = []
    for line in rows.splitlines():
        parts = line.split(None, 5)
        if len(parts) != 6 or not all(value.isdigit() for value in parts[:3]):
            raise ValueError('Unexpected read-only process inventory')
        pid, ppid, owner = map(int, parts[:3])
        if owner not in (0, uid):
            continue
        identity = identify(pid)
        if not identity or identity['pid'] != pid or identity['uid'] != owner:
            continue
        executable = identity['executable']
        if Path(executable).name not in PROCESS_NAMES or not executable.startswith(PROCESS_ROOTS):
            continue
        selected.append({**identity, 'parentPid': ppid, 'state': parts[3],
                         'processElapsed': parts[4], 'cpuTime': parts[5]})
    if len(selected) > 16:
        raise ValueError('Unexpected number of Simulator service processes')
    return selected


def capture_startup(helper, target):
    """Record live owned clients/services and at most two three-second samples."""
    target = Path(target)
    target.mkdir(exist_ok=False)
    record = {'schemaVersion': 1, 'kind': 'read-only-core-simulator-client-diagnostic',
              'startedAtEpochMs': round(time.time() * 1000), 'changesVerdict': False,
              'appLaunched': False, 'readsProcessArguments': False,
              'readsProcessEnvironment': False, 'samples': [],
              'jobConfiguration': {name: os.environ.get(name) for name in
                                   ['DEVELOPER_DIR', 'ImageOS', 'ImageVersion', 'RUNNER_ARCH', 'RUNNER_OS']}}
    helper.atomic_json(target / 'diagnostic.json', record)
    try:
        rows = helper.read_command(['/bin/ps', '-axo', 'pid=,ppid=,uid=,stat=,etime=,time='], timeout=2)
        record['processes'] = selected_processes(rows, helper.process_identity, os.getuid())
        helper.atomic_json(target / 'diagnostic.json', record)
        record['toolPaths'] = {}
        for role, command in [('systemDeveloperDirectory', ['/usr/bin/xcode-select', '-p']),
                              ('selectedSimctl', ['/usr/bin/xcrun', '--find', 'simctl'])]:
            try:
                record['toolPaths'][role] = {'value': helper.read_command(command, timeout=2)}
            except (OSError, ValueError, subprocess.SubprocessError) as error:
                record['toolPaths'][role] = {'issue': type(error).__name__}
        helper.atomic_json(target / 'diagnostic.json', record)
        # Observe the actual first client and service during the existing
        # create budget. Each reviewed sample is bounded to eight seconds.
        for name in ['simctl', 'com.apple.CoreSimulator.CoreSimulatorService']:
            matches = [row for row in record['processes']
                       if Path(row['executable']).name == name and row['uid'] == os.getuid()]
            if len(matches) != 1:
                record['samples'].append({'role': name, 'complete': False,
                                          'issue': 'ExpectedOneOwnedProcess', 'matches': len(matches)})
                continue
            identity = {key: matches[0][key] for key in
                        ['pid', 'uid', 'startSeconds', 'startMicroseconds', 'executable']}
            try:
                sample = helper.sample_process(identity, target / (name + '.sample.txt'))
                record['samples'].append({'role': name, **sample})
            except (OSError, ValueError, subprocess.SubprocessError) as error:
                record['samples'].append({'role': name, 'complete': False, 'issue': type(error).__name__})
            helper.atomic_json(target / 'diagnostic.json', record)
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        record['issue'] = type(error).__name__
    finally:
        record['finishedAtEpochMs'] = round(time.time() * 1000)
        helper.atomic_json(target / 'diagnostic.json', record)


def observed_read(command, timeout, read, capture, delay_seconds=10):
    """Observe one unchanged command; never retry it or replace its outcome."""
    done = threading.Event()

    def observe():
        if done.wait(delay_seconds):
            return
        try:
            capture()
        except Exception:
            # A diagnostic must never mask the command's own result.
            pass

    observer = threading.Thread(target=observe, daemon=True)
    observer.start()
    try:
        return read(command, timeout)
    finally:
        done.set()
        # The fixed probes total at most 26 seconds including owned-command
        # cleanup. Give them bounded time before any app work can start.
        observer.join(timeout=30)
