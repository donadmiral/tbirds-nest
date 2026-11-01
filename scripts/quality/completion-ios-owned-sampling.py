#!/usr/bin/env python3
"""Read-only failure samples of the two exact owned Simulator processes."""
import ctypes
import importlib.util
import os
from pathlib import Path
import plistlib
import re
import time

SOURCE = 'f5be97445ef7223baeb60dd10e8cded05630b6c1'
MAX_PROCESS_IDS = 8192
UUID = re.compile(r'[A-Fa-f0-9]{8}(?:-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12}')


def owned_processes(helper, device, devices_root=None, library=None):
    """Select only current-user app/driver bundles inside one verified UUID."""
    if not isinstance(device, str) or not UUID.fullmatch(device):
        raise ValueError('An exact owned Simulator UUID is required')
    devices_root = devices_root or Path.home() / 'Library/Developer/CoreSimulator/Devices'
    selected_root = Path(devices_root).resolve(strict=True) / device
    if selected_root.resolve(strict=True) != selected_root:
        raise ValueError('The owned Simulator UUID contains a symbolic link')
    applications = selected_root / 'data/Containers/Bundle/Application'
    if applications.resolve(strict=True) != applications:
        raise ValueError('The owned Simulator application root contains a symbolic link')
    roles = {
        helper.PACKAGE: ('app', 'PlatinumQA'),
        helper.DRIVER_PACKAGE: ('driver', 'maestro-driver-iosUITests-Runner'),
    }
    library = library or ctypes.CDLL('/usr/lib/libproc.dylib', use_errno=True)
    library.proc_listallpids.argtypes = [ctypes.c_void_p, ctypes.c_int]
    library.proc_listallpids.restype = ctypes.c_int
    library.proc_pidinfo.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_uint64,
                                    ctypes.c_void_p, ctypes.c_int]
    library.proc_pidinfo.restype = ctypes.c_int
    library.proc_pidpath.argtypes = [ctypes.c_int, ctypes.c_void_p, ctypes.c_uint32]
    library.proc_pidpath.restype = ctypes.c_int
    pids = (ctypes.c_int * MAX_PROCESS_IDS)()
    count = library.proc_listallpids(pids, ctypes.sizeof(pids))
    if not 0 < count < MAX_PROCESS_IDS:
        raise ValueError('Missing or truncated public process inventory')
    found = {'app': [], 'driver': []}
    seen = set()
    for pid in pids[:count]:
        if pid <= 0 or pid in seen:
            continue
        seen.add(pid)
        info = helper.ProcBsdInfo()
        size = library.proc_pidinfo(pid, 3, 0, ctypes.byref(info), ctypes.sizeof(info))
        if size != ctypes.sizeof(info) or info.pid != pid or info.uid != os.getuid():
            continue
        identity = helper.process_identity(pid, library)
        if (not identity or identity['pid'] != pid or identity['uid'] != os.getuid()
                or identity['startSeconds'] != info.startSeconds
                or identity['startMicroseconds'] != info.startMicroseconds):
            continue
        executable = Path(identity['executable'])
        bundle = executable.parent
        if (not executable.is_absolute() or bundle.parent.parent != applications
                or not UUID.fullmatch(bundle.parent.name) or bundle.suffix != '.app'):
            continue
        try:
            if executable.resolve(strict=True) != executable or not executable.is_file():
                continue
            metadata = bundle / 'Info.plist'
            if metadata.is_symlink() or not 0 < metadata.stat().st_size <= 65536:
                continue
            declared = plistlib.loads(metadata.read_bytes())
            role = roles.get(declared.get('CFBundleIdentifier'))
            if (role is None or declared.get('CFBundleExecutable') != executable.name
                    or executable.name != role[1] or bundle.name != role[1] + '.app'):
                continue
        except (OSError, ValueError, plistlib.InvalidFileException):
            continue
        found[role[0]].append(identity)
    return found


def capture_failed_reader_threads(helper, device, target, budget, *, manifest, prepared,
                                  devices_root=None, library=None):
    """Match the original callback API; diagnostics can never change its verdict."""
    record = {'trigger': 'reader-diagnostic-failed', 'changesVerdict': False,
              'samples': [], 'attempted': False, 'startedAtEpochMs': round(time.time() * 1000),
              'processInventory': 'public-libproc-in-process',
              'readsProcessArguments': False, 'readsProcessEnvironment': False,
              'startsSimulatorMetadataClients': False, 'readsBundleInfoPlist': True,
              'samplePairBudget': 1}
    writable = False

    def persist():
        if writable:
            try:
                helper.atomic_json(target / 'sampling.json', record)
            except OSError as error:
                record['persistenceIssue'] = type(error).__name__

    try:
        if budget.get('used') is not False:
            record['issue'] = 'sample-pair-budget-already-used'
            return record
        target = Path(target)
        if manifest.get('applicationSourceCommit') != SOURCE:
            raise ValueError('Only the exact bound producer is permitted')
        path = Path(__file__).with_name('native-ui-ios-compatibility.py')
        spec = importlib.util.spec_from_file_location('owned_sample_compatibility', path)
        compatibility = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(compatibility)
        compatibility.verify_prepared_booted_runtime(manifest, device, prepared)
        budget['used'] = True
        target.mkdir(exist_ok=False)
        writable = True
        record['attempted'] = True
        persist()
        found = owned_processes(helper, device, devices_root, library)
        for role in ['app', 'driver']:
            if len(found[role]) != 1:
                record['samples'].append({'role': role, 'complete': False,
                                          'issue': 'ExpectedOneOwnedProcess', 'matches': len(found[role])})
                persist()
                continue
            try:
                # Existing helper revalidates PID/UID/start-time/path before
                # and after its three-second sample, with an eight-second
                # command wait budget. No global service is signaled.
                sample = helper.sample_process(found[role][0], target / (role + '.sample.txt'))
                record['samples'].append({'role': role, **sample})
            except Exception as error:
                record['samples'].append({'role': role, 'complete': False, 'issue': type(error).__name__})
            persist()
    except Exception as error:
        record['issue'] = type(error).__name__
    finally:
        record['finishedAtEpochMs'] = round(time.time() * 1000)
        persist()
    return record
