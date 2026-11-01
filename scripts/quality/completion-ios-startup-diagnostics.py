#!/usr/bin/env python3
"""Bounded, read-only evidence while the first CoreSimulator client is live."""
import ctypes
import os
from pathlib import Path
import subprocess
import threading
import time

PROCESS_NAMES = {'simctl', 'com.apple.CoreSimulator.CoreSimulatorService', 'simdiskimaged', 'Simulator'}
PROCESS_ROOTS = ('/Applications/Xcode_', '/Library/Developer/', '/System/Library/')
MAX_PROCESS_IDS = 8192


def direct_processes(helper, uid, library=None):
    """Read the public libproc PID table without starting another host client."""
    library = library or ctypes.CDLL('/usr/lib/libproc.dylib', use_errno=True)
    library.proc_listallpids.argtypes = [ctypes.c_void_p, ctypes.c_int]
    library.proc_listallpids.restype = ctypes.c_int
    library.proc_pidinfo.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_uint64,
                                    ctypes.c_void_p, ctypes.c_int]
    library.proc_pidinfo.restype = ctypes.c_int
    library.proc_pidpath.argtypes = [ctypes.c_int, ctypes.c_void_p, ctypes.c_uint32]
    library.proc_pidpath.restype = ctypes.c_int
    pids = (ctypes.c_int * MAX_PROCESS_IDS)()
    # proc_listallpids takes bytes and returns a PID count, unlike proc_listpids.
    count = library.proc_listallpids(pids, ctypes.sizeof(pids))
    if not 0 < count < MAX_PROCESS_IDS:
        raise ValueError('Missing or truncated public process inventory')
    selected = []
    seen = set()
    for pid in pids[:count]:
        if pid <= 0 or pid in seen:
            continue
        seen.add(pid)
        info = helper.ProcBsdInfo()
        size = library.proc_pidinfo(pid, 3, 0, ctypes.byref(info), ctypes.sizeof(info))
        if size != ctypes.sizeof(info) or info.pid != pid or info.uid not in (0, uid):
            continue
        identity = helper.process_identity(pid, library)
        if (not identity or identity['uid'] != info.uid or identity['pid'] != pid
                or identity['startSeconds'] != info.startSeconds
                or identity['startMicroseconds'] != info.startMicroseconds):
            continue
        executable = identity['executable']
        if Path(executable).name not in PROCESS_NAMES or not executable.startswith(PROCESS_ROOTS):
            continue
        selected.append({**identity, 'parentPid': int(info.ppid),
                         'bsdStatus': int(info.status), 'processGroupId': int(info.pgid)})
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
              'readsProcessEnvironment': False, 'samples': [], 'processSnapshots': [],
              'processInventory': 'public-libproc-in-process',
              'jobConfiguration': {name: os.environ.get(name) for name in
                                   ['DEVELOPER_DIR', 'ImageOS', 'ImageVersion', 'RUNNER_ARCH', 'RUNNER_OS']}}
    helper.atomic_json(target / 'diagnostic.json', record)
    try:
        def snapshot(label):
            rows = direct_processes(helper, os.getuid())
            record['processSnapshots'].append({'label': label,
                'atEpochMs': round(time.time() * 1000), 'processes': rows})
            helper.atomic_json(target / 'diagnostic.json', record)
            return rows
        record['processes'] = snapshot('before-samples')
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
        snapshot('after-samples')
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
