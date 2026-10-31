#!/usr/bin/env python3
"""Bounded QA-only emulator identity and existing systemd crash-summary observation."""
import argparse
import contextlib
import json
import os
from pathlib import Path
import re
import selectors
import stat
import subprocess
import sys
import time


PROC_ROOT = Path('/proc')
LOG_DIRECTORY = 'native-ui-logs'
IDENTITY_FILE = 'emulator-process-identity.json'
RESULT_FILE = 'emulator-host-diagnostics.json'
SNAPSHOT_SECONDS = 1.0
COLLECT_SECONDS = 2.0
MAX_INPUT_BYTES = 64 * 1024
MAX_STDOUT_BYTES = 128 * 1024
MAX_STDERR_BYTES = 4 * 1024
MAX_MESSAGE_BYTES = 32 * 1024
MAX_RECORDS = 4
MAX_AGE_NS = 2 * 60 * 60 * 10**9
MESSAGE_ID = 'fc2e22bc6ee647b6b90729ab34a250b1'
JOURNAL_PREFIX = ('/usr/bin/sudo', '-n', '--', '/usr/bin/timeout',
                  '--signal=TERM', '--kill-after=0.2s', '1.5s', '/usr/bin/journalctl')
JOURNAL_FIELDS = ('MESSAGE_ID', 'COREDUMP_PID', 'COREDUMP_UID', 'COREDUMP_EXE',
                  'COREDUMP_SIGNAL', 'COREDUMP_SIGNAL_NAME', 'COREDUMP_TIMESTAMP',
                  'MESSAGE', '_BOOT_ID', '__REALTIME_TIMESTAMP', '__MONOTONIC_TIMESTAMP')
EXECUTABLE_RELATIVE_PATHS = (
    'emulator/emulator',
    'emulator/qemu/linux-x86_64/qemu-system-x86_64',
    'emulator/qemu/linux-x86_64/qemu-system-x86_64-headless',
)
DIRECTORY_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
FILE_FLAGS = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK


class Unavailable(Exception):
    """An allowlisted diagnostic reason, never an app acceptance result."""


def check_time(deadline):
    if time.monotonic() >= deadline:
        raise Unavailable('diagnostic-deadline')


def stable_file(a, b):
    return (a.st_dev, a.st_ino, a.st_uid, a.st_nlink, a.st_size,
            a.st_mtime_ns, a.st_ctime_ns) == (
        b.st_dev, b.st_ino, b.st_uid, b.st_nlink, b.st_size,
        b.st_mtime_ns, b.st_ctime_ns)


def unique_object(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError('duplicate-json-key')
        value[key] = item
    return value


def read_at(directory_fd, name, deadline, maximum=MAX_INPUT_BYTES, owned=False):
    check_time(deadline)
    fd = os.open(name, FILE_FLAGS, dir_fd=directory_fd)
    try:
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or before.st_size > maximum:
            raise Unavailable('unsafe-or-oversized-input')
        if owned and (before.st_uid != os.getuid() or before.st_nlink != 1):
            raise Unavailable('input-owner-or-hardlink')
        chunks, size = [], 0
        while True:
            check_time(deadline)
            part = os.read(fd, min(8192, maximum + 1 - size))
            if not part:
                break
            chunks.append(part)
            size += len(part)
            if size > maximum:
                raise Unavailable('input-byte-limit')
        if not stable_file(before, os.fstat(fd)):
            raise Unavailable('input-changed-during-read')
        return b''.join(chunks)
    finally:
        os.close(fd)


def boot_id(deadline):
    fd = os.open(PROC_ROOT / 'sys/kernel/random', DIRECTORY_FLAGS)
    try:
        value = read_at(fd, 'boot_id', deadline, 64).decode('ascii').strip()
    finally:
        os.close(fd)
    if not re.fullmatch(r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}', value):
        raise Unavailable('invalid-boot-id')
    return value.replace('-', '')


def process_stat(data, pid):
    text = data.decode('ascii')
    end = text.rfind(')')
    if end < 0 or not text.startswith(str(pid) + ' ('):
        raise Unavailable('invalid-process-stat')
    fields = text[end + 1:].split()
    if len(fields) < 20 or not fields[19].isdigit() or int(fields[19]) <= 0:
        raise Unavailable('invalid-process-start-ticks')
    return {'state': fields[0], 'startTicks': fields[19]}


def process_uid(data):
    match = re.search(rb'^Uid:\s+([0-9]+)\s+([0-9]+)\s+([0-9]+)\s+([0-9]+)\s*$', data, re.M)
    if not match or any(int(value) != os.getuid() for value in match.groups()):
        raise Unavailable('process-uid-mismatch')
    return os.getuid()


def validated_executable(process_fd, sdk_root):
    executable = os.readlink('exe', dir_fd=process_fd)
    if len(executable) > 4096 or not os.path.isabs(executable):
        raise Unavailable('invalid-emulator-executable')
    sdk = os.path.realpath(sdk_root)
    allowed = {str(Path(sdk) / item) for item in EXECUTABLE_RELATIVE_PATHS}
    if executable not in allowed or os.path.realpath(executable) != executable:
        raise Unavailable('unexpected-emulator-executable')
    expected = os.stat(executable, follow_symlinks=False)
    actual = os.stat('exe', dir_fd=process_fd, follow_symlinks=True)
    if (not stat.S_ISREG(expected.st_mode) or not expected.st_mode & 0o111
            or expected.st_uid not in (0, os.getuid())
            or (expected.st_dev, expected.st_ino) != (actual.st_dev, actual.st_ino)):
        raise Unavailable('emulator-executable-identity-mismatch')
    return executable, expected.st_dev, expected.st_ino


def snapshot_process(pid, sdk_root, deadline):
    process_fd = os.open(PROC_ROOT / str(pid), DIRECTORY_FLAGS)
    try:
        if os.fstat(process_fd).st_uid != os.getuid():
            raise Unavailable('process-directory-owner-mismatch')
        before = process_stat(read_at(process_fd, 'stat', deadline), pid)
        if before['state'] in ('Z', 'X', 'x'):
            raise Unavailable('process-not-live')
        uid = process_uid(read_at(process_fd, 'status', deadline))
        executable = validated_executable(process_fd, sdk_root)
        after = process_stat(read_at(process_fd, 'stat', deadline), pid)
        process_uid(read_at(process_fd, 'status', deadline))
        after_executable = validated_executable(process_fd, sdk_root)
        check_time(deadline)
        if before['startTicks'] != after['startTicks'] or executable != after_executable:
            raise Unavailable('process-identity-changed')
        if after['state'] in ('Z', 'X', 'x'):
            raise Unavailable('process-not-live')
        return {'pid': pid, 'uid': uid, 'executable': executable[0],
                'executableDevice': executable[1], 'executableInode': executable[2],
                'startTicks': before['startTicks'], 'clockTicksPerSecond': os.sysconf('SC_CLK_TCK'),
                'sdkRoot': os.path.realpath(sdk_root)}
    finally:
        os.close(process_fd)


def context(args):
    if sys.platform != 'linux' or os.environ.get('CI') != 'true' or os.environ.get('EXPO_PUBLIC_APP_ENV') != 'qa':
        raise Unavailable('requires-disposable-linux-qa-ci')
    run = os.environ.get('GITHUB_RUN_ID', '')
    now = time.time_ns()
    if (not re.fullmatch(r'[1-9][0-9]{0,19}', run) or not 0 < args.pid < 2**31
            or not now - MAX_AGE_NS <= args.started_ns <= now):
        raise Unavailable('invalid-current-run-identity')
    return {'runId': run, 'emulatorPid': args.pid, 'launchUnixNs': str(args.started_ns)}


@contextlib.contextmanager
def logs_directory():
    fd = os.open(LOG_DIRECTORY, DIRECTORY_FLAGS)
    try:
        if os.fstat(fd).st_uid != os.getuid():
            raise Unavailable('log-directory-owner-mismatch')
        yield fd
    finally:
        os.close(fd)


def write_receipt(name, receipt):
    data = (json.dumps(receipt, indent=2) + '\n').encode()
    with logs_directory() as directory:
        fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=directory)
        try:
            view = memoryview(data)
            while view:
                count = os.write(fd, view)
                if count <= 0:
                    raise OSError('short write')
                view = view[count:]
        finally:
            os.close(fd)


def snapshot(args, receipt, deadline):
    if not args.sdk_root or not os.path.isabs(args.sdk_root):
        raise Unavailable('absolute-sdk-root-required')
    before_boot = boot_id(deadline)
    identity = snapshot_process(args.pid, args.sdk_root, deadline)
    if before_boot != boot_id(deadline):
        raise Unavailable('boot-changed-during-snapshot')
    receipt.update(status='available', identity=identity, bootId=before_boot,
                   snapshotUnixNs=str(time.time_ns()))


def load_identity(args, receipt, deadline):
    with logs_directory() as directory:
        raw = read_at(directory, IDENTITY_FILE, deadline, owned=True)
    saved = json.loads(raw, object_pairs_hook=unique_object)
    if not isinstance(saved, dict):
        raise Unavailable('invalid-snapshot-object')
    if (saved.get('schemaVersion') != 1 or saved.get('phase') != 'snapshot'
            or saved.get('status') != 'available' or saved.get('runId') != receipt['runId']
            or saved.get('emulatorPid') != args.pid or saved.get('launchUnixNs') != str(args.started_ns)):
        raise Unavailable('snapshot-run-mismatch-or-unavailable')
    identity = saved.get('identity', {})
    if (not isinstance(identity, dict) or identity.get('pid') != args.pid or identity.get('uid') != os.getuid()
            or not isinstance(identity.get('startTicks'), str)
            or not re.fullmatch(r'[1-9][0-9]{0,19}', identity['startTicks'])):
        raise Unavailable('snapshot-process-mismatch')
    sdk = identity.get('sdkRoot')
    executable = identity.get('executable')
    if (not isinstance(sdk, str) or not os.path.isabs(sdk)
            or executable not in {str(Path(sdk) / item) for item in EXECUTABLE_RELATIVE_PATHS}):
        raise Unavailable('snapshot-executable-mismatch')
    captured = saved.get('snapshotUnixNs')
    if not isinstance(captured, str) or not captured.isdigit() or not args.started_ns <= int(captured) <= time.time_ns():
        raise Unavailable('snapshot-time-mismatch')
    if saved.get('bootId') != boot_id(deadline):
        raise Unavailable('snapshot-boot-mismatch')
    # A departed process is expected. If the number is already live again, it
    # must still identify the exact captured process; never query a reused PID.
    try:
        fd = os.open(PROC_ROOT / str(args.pid), DIRECTORY_FLAGS)
    except FileNotFoundError:
        receipt['processAtCollection'] = 'not-present'
    else:
        try:
            current = process_stat(read_at(fd, 'stat', deadline), args.pid)
            if os.fstat(fd).st_uid != identity['uid'] or current['startTicks'] != identity['startTicks']:
                raise Unavailable('pid-reused-or-owner-changed')
            if current['state'] not in ('Z', 'X', 'x'):
                process_uid(read_at(fd, 'status', deadline))
                current_exe = validated_executable(fd, sdk)
                if current_exe != (executable, identity.get('executableDevice'), identity.get('executableInode')):
                    raise Unavailable('process-executable-changed')
            after = process_stat(read_at(fd, 'stat', deadline), args.pid)
            if after['startTicks'] != current['startTicks']:
                raise Unavailable('process-identity-changed')
            check_time(deadline)
            receipt['processAtCollection'] = 'same-start-ticks'
        finally:
            os.close(fd)
    return saved


def journal_command(saved, until_ns):
    identity = saved['identity']
    return [*JOURNAL_PREFIX, '--no-pager', '--quiet', '--all', '--output=json',
            '--output-fields=' + ','.join(JOURNAL_FIELDS), '--lines=' + str(MAX_RECORDS),
            '--boot=' + saved['bootId'], '--since=@' + str(int(saved['launchUnixNs']) // 10**9),
            '--until=@' + str(until_ns // 10**9 + 1),
            'MESSAGE_ID=' + MESSAGE_ID, 'COREDUMP_PID=' + str(identity['pid']),
            'COREDUMP_UID=' + str(identity['uid']), 'COREDUMP_EXE=' + identity['executable']]


def run_journal(command, deadline):
    result = {'stdout': b'', 'stderr': b'', 'returnCode': None,
              'timedOut': False, 'stdoutLimitHit': False, 'stderrLimitHit': False}
    process = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, start_new_session=True,
                               env={'PATH': '/usr/bin:/bin', 'LC_ALL': 'C', 'SYSTEMD_COLORS': '0',
                                    'SYSTEMD_URLIFY': '0', 'SYSTEMD_PAGER': 'cat'})
    selector = selectors.DefaultSelector()
    try:
        for name in ('stdout', 'stderr'):
            selector.register(getattr(process, name), selectors.EVENT_READ, name)
        read_deadline = deadline - 0.15
        while selector.get_map():
            remaining = read_deadline - time.monotonic()
            if remaining <= 0:
                result['timedOut'] = True
                break
            for key, _ in selector.select(min(0.05, remaining)):
                name = key.data
                maximum = MAX_STDOUT_BYTES if name == 'stdout' else MAX_STDERR_BYTES
                chunk = os.read(key.fileobj.fileno(), min(8192, maximum + 1 - len(result[name])))
                if not chunk:
                    selector.unregister(key.fileobj)
                    continue
                result[name] += chunk
                if len(result[name]) > maximum:
                    result[name] = result[name][:maximum]
                    result[name + 'LimitHit'] = True
                    break
            if result['stdoutLimitHit'] or result['stderrLimitHit']:
                break
        if process.poll() is None and not (result['timedOut'] or result['stdoutLimitHit'] or result['stderrLimitHit']):
            try:
                process.wait(timeout=max(0.001, read_deadline - time.monotonic()))
            except subprocess.TimeoutExpired:
                result['timedOut'] = True
        if process.poll() is None:
            with contextlib.suppress(ProcessLookupError):
                process.terminate()
            try:
                process.wait(timeout=max(0.001, min(0.08, deadline - time.monotonic())))
            except subprocess.TimeoutExpired:
                with contextlib.suppress(ProcessLookupError):
                    process.kill()
        try:
            result['returnCode'] = process.wait(timeout=max(0.001, deadline - time.monotonic()))
        except subprocess.TimeoutExpired:
            result['timedOut'] = True
        if result['returnCode'] in (124, 137):
            result['timedOut'] = True
    finally:
        selector.close()
        for stream in (process.stdout, process.stderr):
            stream.close()
        if process.poll() is None:
            with contextlib.suppress(ProcessLookupError):
                process.kill()
    return result


def selected_records(data, saved, until_ns):
    records, rejected, incomplete = [], 0, False
    identity = saved['identity']
    for line in data.splitlines()[:MAX_RECORDS]:
        if not line.strip():
            continue
        try:
            value = json.loads(line, object_pairs_hook=unique_object)
            expected = {'MESSAGE_ID': MESSAGE_ID, '_BOOT_ID': saved['bootId'],
                        'COREDUMP_PID': str(identity['pid']), 'COREDUMP_UID': str(identity['uid']),
                        'COREDUMP_EXE': identity['executable']}
            if not isinstance(value, dict) or any(value.get(key) != item for key, item in expected.items()):
                raise ValueError('identity')
            when = value.get('COREDUMP_TIMESTAMP')
            signal = value.get('COREDUMP_SIGNAL')
            if (not isinstance(when, str) or not re.fullmatch(r'[0-9]{1,20}', when)
                    or not int(saved['launchUnixNs']) // 1000 <= int(when) <= until_ns // 1000
                    or not isinstance(signal, str) or not re.fullmatch(r'[0-9]{1,3}', signal)
                    or not 0 < int(signal) <= 128):
                raise ValueError('time-or-signal')
            clean = dict(expected)
            clean.update(COREDUMP_TIMESTAMP=when, COREDUMP_SIGNAL=signal)
            for key in ('COREDUMP_SIGNAL_NAME', '__REALTIME_TIMESTAMP', '__MONOTONIC_TIMESTAMP'):
                item = value.get(key)
                if isinstance(item, str) and len(item) <= 64:
                    clean[key] = item
            message = value.get('MESSAGE')
            if isinstance(message, str):
                raw = message.encode('utf8')
                clean['MESSAGE'] = raw[:MAX_MESSAGE_BYTES].decode('utf8', errors='ignore')
                clean['messageTruncated'] = len(raw) > MAX_MESSAGE_BYTES
            else:
                clean['messageUnavailable'] = True
            records.append(clean)
        except (ValueError, TypeError, UnicodeError):
            rejected += 1
            incomplete = True
    return records, rejected, incomplete


def collect(args, receipt, deadline):
    if args.gate_exit is None or not 0 <= args.gate_exit <= 255:
        raise Unavailable('gate-exit-required')
    receipt['gateExitCode'] = args.gate_exit
    saved = load_identity(args, receipt, deadline)
    until_ns = time.time_ns()
    receipt.update(identity=saved['identity'], bootId=saved['bootId'],
                   snapshotUnixNs=saved['snapshotUnixNs'], queryUntilUnixNs=str(until_ns))
    command = journal_command(saved, until_ns)
    receipt['query'] = command
    try:
        observed = run_journal(command, deadline)
    except FileNotFoundError:
        raise Unavailable('journal-tool-unavailable') from None
    receipt['queryResult'] = {key: value for key, value in observed.items() if key not in ('stdout', 'stderr')}
    receipt['queryResult'].update(stdoutBytes=len(observed['stdout']), stderrBytes=len(observed['stderr']))
    records, rejected, incomplete = selected_records(observed['stdout'], saved, until_ns)
    receipt.update(records=records, rejectedRecords=rejected,
                   recordLimitPossiblyReached=len(observed['stdout'].splitlines()) >= MAX_RECORDS)
    if observed['timedOut']:
        receipt.update(status='unavailable', reason='journal-query-timeout')
    elif observed['stdoutLimitHit'] or observed['stderrLimitHit']:
        receipt.update(status='partial', reason='journal-output-limit')
    elif observed['returnCode'] != 0:
        denied = re.search(rb'permission|not allowed|password|sudoers|not permitted', observed['stderr'], re.I)
        receipt.update(status='unavailable', reason='journal-permission-denied' if denied else 'journal-command-failed')
    elif incomplete:
        receipt.update(status='partial', reason='journal-record-rejected')
    elif len(records) > 1:
        receipt.update(status='ambiguous', reason='multiple-matching-crash-records')
    elif records:
        receipt['status'] = 'available'
    else:
        receipt.update(status='unavailable', reason='no-matching-saved-crash-record')


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('phase', choices=('snapshot', 'collect'))
    parser.add_argument('--pid', type=int, required=True)
    parser.add_argument('--started-ns', type=int, required=True)
    parser.add_argument('--sdk-root')
    parser.add_argument('--gate-exit', type=int)
    args = parser.parse_args(argv)
    began = time.monotonic()
    try:
        current = context(args)
    except Unavailable:
        print('Host diagnostics unavailable: current Linux QA CI identity is required.', file=sys.stderr)
        return 2
    budget = SNAPSHOT_SECONDS if args.phase == 'snapshot' else COLLECT_SECONDS
    receipt = {'schemaVersion': 1, 'phase': args.phase, **current, 'status': 'unavailable',
               'limits': {'seconds': budget, 'inputBytes': MAX_INPUT_BYTES,
                          'stdoutBytes': MAX_STDOUT_BYTES, 'stderrBytes': MAX_STDERR_BYTES,
                          'records': MAX_RECORDS, 'messageBytes': MAX_MESSAGE_BYTES},
               'limitsOfInterpretation': [
                   'Diagnostic only; original required flow, evidence and decoder status remains authoritative.',
                   'Saved journal identity/time fields do not contain a process-start-ticks equality proof.',
                   'No matching record may mean unavailable permissions, an unsupported handler, in-flight processing or no saved summary.',
                   'No core, environment, command line, process memory or mapped-library contents are read or retained.',
               ]}
    try:
        if args.phase == 'snapshot':
            snapshot(args, receipt, began + budget)
        else:
            collect(args, receipt, began + budget)
    except Unavailable as error:
        receipt.update(status='unavailable', reason=str(error))
    except (OSError, ValueError, TypeError, KeyError, UnicodeError) as error:
        receipt.update(status='unavailable', reason='diagnostic-input-or-tool-unavailable',
                       errorType=type(error).__name__)
    receipt['elapsedMs'] = round((time.monotonic() - began) * 1000, 3)
    try:
        write_receipt(IDENTITY_FILE if args.phase == 'snapshot' else RESULT_FILE, receipt)
    except (OSError, Unavailable):
        print('Host diagnostic receipt unavailable; original gate result is unchanged.', file=sys.stderr)
        return 2
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
