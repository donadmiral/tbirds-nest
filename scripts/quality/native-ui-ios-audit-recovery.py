#!/usr/bin/env python3
"""Run the retained b568 audit app/cases; observe without rebuilding or resigning."""
import argparse
import ctypes
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import platform
import plistlib
import resource
import selectors
import shutil
import signal
import stat
import subprocess
import sys
import tarfile
import threading
import time
import xml.etree.ElementTree as ET

SOURCE = 'b568bd7b75bd25ad919afd8eac8d52300a5c3fcc'
TREE = '24c1a151d852ced19f2198980412922ec4c7a4ed'
PRODUCER_RUN = 41229206389
RUNNER_SHA = 'b77ada1570ab2c78d27518c7b109eb06b802e8b6e86f737459beeb9b9bdf60f8'
MANIFEST_SHA = 'f0b37826ed8709e0772e5d9ea4d73d9e7ef48ab7d2894440608ab2e59848b1fe'
BINARY_SHA = '61aa632c9499117c7d0f7cc7901e58eb6470d7aeffb6d6eb41aad87119f79b65'
SOURCE_RECEIPT_SHA = '35d710d00324f3a2eb815f38b87bf95b24b3225a1aaad2e7985083cf3cba11fe'
PACKAGE = 'app.platinumcircles.mobile.qa'
DRIVER_PACKAGE = 'dev.mobile.maestro-driver-iosUITests.xctrunner'
RUNTIME = 'com.apple.CoreSimulator.SimRuntime.iOS-18-5'
TRACE_NAMES = ('native-ui-receipt.json', 'native-ui-auth-diagnostics.json')
MAX_TRACE_BYTES = 2 * 1024 * 1024
MAX_SAMPLE_BYTES = 2 * 1024 * 1024
BUSY_MARKER = b'Unable to perform work on main run loop, process main thread busy for 30.0s'


def digest(path):
    value = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()


def atomic_bytes(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_symlink() or path.parent.is_symlink():
        raise ValueError('Refuse a linked diagnostic destination')
    temporary = path.with_name(path.name + '.pending')
    try:
        with temporary.open('xb') as stream:
            stream.write(data)
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()


def atomic_json(path, value):
    atomic_bytes(path, (json.dumps(value, indent=2) + '\n').encode())


def stop_group(process):
    for sig, seconds in [(signal.SIGTERM, 0.3), (signal.SIGKILL, 0.3)]:
        try:
            os.killpg(process.pid, sig)
        except ProcessLookupError:
            pass
        try:
            process.wait(timeout=seconds)
        except subprocess.TimeoutExpired:
            continue
    process.wait()


def bounded_command(args, timeout=5, limit=128 * 1024):
    """Read a small owned command; bound both pipes, wall time, and children."""
    process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               start_new_session=True)
    chunks = {'stdout': bytearray(), 'stderr': bytearray()}
    started = time.monotonic()
    deadline = time.monotonic() + timeout
    leader_completed_before_eof = False
    with selectors.DefaultSelector() as poller:
        for name, stream in [('stdout', process.stdout), ('stderr', process.stderr)]:
            os.set_blocking(stream.fileno(), False)
            poller.register(stream, selectors.EVENT_READ, name)
        try:
            while poller.get_map():
                # A successful client can leave a service holding inherited
                # pipes. Drain bytes already available after the leader exits;
                # do not wait for that unrelated service to close its pipes.
                leader_finished = process.poll() is not None
                if leader_finished:
                    leader_completed_before_eof = True
                remaining = deadline - time.monotonic()
                if remaining <= 0 and not leader_finished:
                    error = subprocess.TimeoutExpired(args, timeout, output=bytes(chunks['stdout']), stderr=bytes(chunks['stderr']))
                    error.leader_exit_code = process.poll()
                    error.elapsed_seconds = time.monotonic() - started
                    raise error
                events = poller.select(0 if leader_finished else min(remaining, 0.1))
                if leader_finished and not events:
                    break
                for key, _ in events:
                    data = os.read(key.fileobj.fileno(), 8192)
                    if not data:
                        poller.unregister(key.fileobj)
                    else:
                        chunks[key.data].extend(data)
                        cap = limit if key.data == 'stdout' else 4096
                        if len(chunks[key.data]) > cap:
                            raise ValueError('Diagnostic command output limit exceeded')
            code = process.wait(timeout=max(0.01, deadline - time.monotonic()))
        except BaseException as error:
            if isinstance(error, subprocess.TimeoutExpired):
                error.output = bytes(chunks['stdout'])
                error.stderr = bytes(chunks['stderr'])
                error.leader_exit_code = process.poll()
                error.elapsed_seconds = time.monotonic() - started
            stop_group(process)
            raise
        finally:
            process.stdout.close()
            process.stderr.close()
    result = subprocess.CompletedProcess(args, code, bytes(chunks['stdout']), bytes(chunks['stderr']))
    result.leader_completed_before_pipe_eof = leader_completed_before_eof
    result.elapsed_seconds = time.monotonic() - started
    return result


def read_command(args, timeout=5):
    result = bounded_command(args, timeout)
    if result.returncode:
        raise ValueError('Required diagnostic/setup command failed with exit ' + str(result.returncode))
    return result.stdout.decode().strip()


def setup_read(args, stage, timeout, records, output):
    """Keep bounded cold-start evidence without altering application deadlines."""
    row = {'stage': stage, 'timeoutSeconds': timeout, 'startedAtEpochMs': round(time.time() * 1000), 'status': 'running'}
    records.append(row)
    atomic_json(output, {'commands': records})
    def retain(stdout, stderr):
        for name, data in [('stdout', stdout or b''), ('stderr', stderr or b'')]:
            row[name + 'Bytes'] = len(data)
            row[name + 'Tail'] = data[-4096:].decode(errors='replace')
            row[name + 'Truncated'] = len(data) > 4096
    try:
        result = bounded_command(args, timeout)
        retain(result.stdout, result.stderr)
        row.update({'status': 'completed' if result.returncode == 0 else 'failed', 'exitCode': result.returncode,
                    'elapsedSeconds': result.elapsed_seconds, 'leaderCompletedBeforePipeEOF': result.leader_completed_before_pipe_eof})
        if result.returncode:
            raise ValueError('Simulator setup command failed with exit ' + str(result.returncode))
        return result.stdout.decode().strip()
    except subprocess.TimeoutExpired as error:
        retain(error.output, error.stderr)
        row.update({'status': 'timed-out', 'leaderExitCodeAtTimeout': getattr(error, 'leader_exit_code', None),
                    'elapsedSeconds': getattr(error, 'elapsed_seconds', None)})
        raise
    except BaseException as error:
        row.update({'status': 'failed' if isinstance(error, Exception) else 'interrupted', 'issue': type(error).__name__})
        raise
    finally:
        row['finishedAtEpochMs'] = round(time.time() * 1000)
        try:
            atomic_json(output, {'commands': records})
        except OSError:
            pass


def extract_app(archive, destination):
    """The verified baseline archive has regular files/directories only."""
    destination = Path(destination)
    if (destination / 'PlatinumQA.app').exists():
        raise ValueError('Refuse to reuse a previous extracted app')
    with tarfile.open(archive) as bundle:
        entries = bundle.getmembers()
        if len(entries) > 1000 or sum(item.size for item in entries) > 256 * 1024 * 1024:
            raise ValueError('Unexpected retained app archive size')
        for item in entries:
            path = Path(item.name)
            if not path.parts or path.parts[0] != 'PlatinumQA.app' or path.is_absolute() or '..' in path.parts:
                raise ValueError('App archive path escapes its root')
            if not (item.isfile() or item.isdir()):
                raise ValueError('Unexpected link or special file in the retained baseline app')
        bundle.extractall(destination, filter='data')
    return destination / 'PlatinumQA.app'


compatibility_path = Path(__file__).with_name('native-ui-ios-compatibility.py')
compatibility_spec = importlib.util.spec_from_file_location('ios_compatibility', compatibility_path)
compatibility_module = importlib.util.module_from_spec(compatibility_spec)
compatibility_spec.loader.exec_module(compatibility_module)


def verify_compatibility(app, manifest, device, read=read_command, host_system=None):
    return compatibility_module.verify_compatibility(app, manifest, device, read, host_system)


def setup_compatibility_reader(app, records, output):
    """Use the normal runner's 30s metadata-read budget and retain each boundary."""
    stages = {
        ('/usr/bin/uname', '-m'): 'host-architecture',
        ('xcodebuild', '-version'): 'xcode-version',
        ('xcrun', '--sdk', 'iphonesimulator', '--show-sdk-version'): 'simulator-sdk',
        ('xcrun', 'simctl', 'list', 'runtimes', '--json'): 'available-runtimes',
        ('xcrun', 'simctl', 'list', 'devices', '--json'): 'selected-device',
    }
    def read(args):
        stage = stages.get(tuple(args))
        if args[:2] == ['xcrun', 'lipo'] and len(args) == 4 and args[-1] == '-archs':
            stage = 'actual-mach-o'
        elif args == ['codesign', '--verify', '--deep', '--strict', str(app)]:
            stage = 'app-signature'
        if stage is None:
            raise ValueError('Unexpected compatibility metadata command')
        return setup_read(args, 'compatibility-' + stage, 30, records, output)
    return read


def verify_setup_immutable(app, manifest, records, output, host_system=None):
    return compatibility_module.verify_immutable_compatibility(
        app, manifest, setup_compatibility_reader(app, records, output), host_system)


def verify_setup_booted_runtime(app, manifest, device, records, output):
    return compatibility_module.verify_booted_runtime(
        manifest, device, setup_compatibility_reader(app, records, output))


def stable_json_bytes(path):
    path = Path(path)
    if path.parent.is_symlink():
        raise ValueError('Refuse a linked trace directory')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or not 0 < before.st_size <= MAX_TRACE_BYTES:
            raise ValueError('Trace must be a bounded nonempty regular file')
        data = bytearray()
        while len(data) <= MAX_TRACE_BYTES:
            chunk = os.read(fd, min(65536, MAX_TRACE_BYTES + 1 - len(data)))
            if not chunk:
                break
            data.extend(chunk)
        after = os.fstat(fd)
        identity = lambda value: (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns)
        if identity(before) != identity(after) or len(data) != before.st_size:
            raise ValueError('Trace changed during snapshot')
        value = json.loads(data)
        if not isinstance(value, dict):
            raise ValueError('Expected the existing structured trace object')
        return bytes(data)
    finally:
        os.close(fd)


def scoped_container(device, package, kind, read=read_command, device_root=None):
    root = device_root or (Path.home() / 'Library/Developer/CoreSimulator/Devices' / device / 'data')
    path = Path(read(['xcrun', 'simctl', 'get_app_container', device, package, kind], timeout=3)).resolve(strict=True)
    area = 'Data' if kind == 'data' else 'Bundle'
    expected = (root / 'Containers' / area / 'Application').resolve(strict=True)
    if not path.is_relative_to(expected) or path == expected:
        raise ValueError('Container is outside the selected simulator')
    return path


class ProcBsdInfo(ctypes.Structure):
    # Public xnu bsd/sys/proc_info.h, PROC_PIDTBSDINFO (3); no env/argv access.
    _fields_ = [(name, ctypes.c_uint32) for name in
                ['flags', 'status', 'xstatus', 'pid', 'ppid', 'uid', 'gid', 'ruid', 'rgid', 'svuid', 'svgid', 'reserved']]
    _fields_ += [('comm', ctypes.c_char * 16), ('name', ctypes.c_char * 32)]
    _fields_ += [(name, ctypes.c_uint32) for name in ['nfiles', 'pgid', 'jobc', 'tdev', 'tpgid']]
    _fields_ += [('nice', ctypes.c_int32), ('startSeconds', ctypes.c_uint64), ('startMicroseconds', ctypes.c_uint64)]


def process_identity(pid, library=None):
    library = library or ctypes.CDLL('/usr/lib/libproc.dylib', use_errno=True)
    info = ProcBsdInfo()
    size = library.proc_pidinfo(pid, 3, 0, ctypes.byref(info), ctypes.sizeof(info))
    path = ctypes.create_string_buffer(4096)
    count = library.proc_pidpath(pid, path, len(path))
    if size != ctypes.sizeof(info) or count <= 0 or info.pid != pid:
        return None
    return {'pid': pid, 'uid': int(info.uid), 'startSeconds': int(info.startSeconds),
            'startMicroseconds': int(info.startMicroseconds), 'executable': os.fsdecode(path.value)}


def find_process(executable, read=read_command, identify=process_identity):
    candidates = read(['/bin/ps', '-axo', 'pid=,uid=']).splitlines()
    if len(candidates) > 8192:
        raise ValueError('Unexpected host process inventory size')
    found = []
    for line in candidates:
        fields = line.split()
        if len(fields) != 2 or not all(value.isdigit() for value in fields):
            raise ValueError('Unexpected PID inventory format')
        pid, uid = map(int, fields)
        if uid != os.getuid():
            continue
        identity = identify(pid)
        if identity and identity['uid'] == os.getuid() and identity['executable'] == str(executable):
            found.append(identity)
    if len(found) != 1:
        raise ValueError('Expected one exact selected-simulator process')
    return found[0]


def sample_process(identity, target, identify=process_identity, execute=bounded_command):
    if identify(identity['pid']) != identity or identity['uid'] != os.getuid():
        raise ValueError('Process identity changed before sampling')
    target = Path(target)
    temporary = target.with_name(target.name + '.partial')
    if temporary.exists() or target.exists():
        raise ValueError('Refuse repeated process sampling')
    result = None
    issue = None
    try:
        result = execute([sys.executable, str(Path(__file__).resolve()), '_sample-child',
                          str(identity['pid']), str(temporary)], timeout=8, limit=4096)
    except (OSError, ValueError, subprocess.TimeoutExpired) as error:
        issue = type(error).__name__
    same = identify(identity['pid']) == identity
    complete = bool(result and result.returncode == 0 and same and temporary.is_file() and 0 < temporary.stat().st_size <= MAX_SAMPLE_BYTES)
    record = {'pid': identity['pid'], 'uid': identity['uid'],
              'startSeconds': identity['startSeconds'], 'startMicroseconds': identity['startMicroseconds'],
              'executableName': Path(identity['executable']).name, 'identityStable': same,
              'durationSeconds': 3, 'intervalMilliseconds': 10, 'wallBudgetSeconds': 8,
              'exitCode': result.returncode if result else None, 'issue': issue, 'complete': complete}
    if complete:
        os.replace(temporary, target)
        record.update({'file': target.name, 'bytes': target.stat().st_size, 'sha256': digest(target)})
    elif temporary.exists():
        temporary.unlink()
    return record


class Observer:
    """First/latest valid snapshots and at most one sampled pair per shard."""
    def __init__(self, device, target, app_log, sample_budget, expected_case=None,
                 container=scoped_container, sample=sample_process, finder=find_process):
        self.device, self.target, self.app_log = device, Path(target), Path(app_log)
        self.sample_budget, self.container, self.sample, self.finder = sample_budget, container, sample, finder
        self.stop = threading.Event()
        self.thread = None
        self.offset = self.app_log.stat().st_size if self.app_log.exists() else 0
        self.carry = b''
        self.expected_case = expected_case
        self.records = {'polls': 0, 'snapshots': {}, 'sampleTrigger': None, 'samples': [], 'observerErrors': 0,
                        'expectedCaseId': expected_case, 'diagnosticSnapshotsAreNotFinalCaseReceipts': True}
        self.target.mkdir(parents=True, exist_ok=False)

    def snapshot(self, label='latest'):
        self.records['polls'] += 1
        try:
            directory = self.container(self.device, PACKAGE, 'data') / 'Documents'
        except (OSError, ValueError, subprocess.TimeoutExpired) as error:
            self.records['containerIssue'] = type(error).__name__
            self.persist()
            return
        fixture_match = None
        for name in TRACE_NAMES:
            key = label + '/' + name
            try:
                data = stable_json_bytes(directory / name)
                if name == 'native-ui-receipt.json':
                    fixture_match = json.loads(data).get('audit', {}).get('caseId') == self.expected_case if self.expected_case else None
                for folder in ([label, 'first'] if not (self.target / 'first' / name).exists() else [label]):
                    atomic_bytes(self.target / folder / name, data)
                    self.records['snapshots'][folder + '/' + name] = {'collected': True, 'latestAttemptCollected': True,
                        'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(), 'atEpochMs': round(time.time() * 1000),
                        'fixtureCaseMatchesExpectedAtThisPoll': fixture_match,
                        'caseAttribution': 'matching-fixture-observed' if fixture_match and name == 'native-ui-receipt.json' else 'not-established'}
            except (OSError, ValueError, json.JSONDecodeError) as error:
                # Preserve the last valid bytes; report a failed latest attempt separately.
                self.records['snapshots'].setdefault(key, {}).update({'lastAttemptIssue': type(error).__name__,
                    'latestAttemptCollected': False, 'lastAttemptAtEpochMs': round(time.time() * 1000)})
        self.persist()

    def persist(self):
        atomic_json(self.target / 'observation.json', self.records)

    def inspect_stall(self):
        if self.sample_budget['used'] or not self.app_log.is_file():
            return
        with self.app_log.open('rb') as stream:
            size = os.fstat(stream.fileno()).st_size
            if size < self.offset:
                self.offset = 0
                self.carry = b''
            if size - self.offset > 256 * 1024:
                self.records['logBytesSkipped'] = self.records.get('logBytesSkipped', 0) + size - self.offset - 256 * 1024
                self.offset = size - 256 * 1024
                self.carry = b''
            stream.seek(self.offset)
            data = stream.read(256 * 1024)
            self.offset = stream.tell()
        data = self.carry + data
        self.carry = data[-(len(BUSY_MARKER) - 1):]
        if BUSY_MARKER not in data:
            return
        self.sample_budget['used'] = True
        self.records['sampleTrigger'] = {'kind': 'exact-main-run-loop-busy-30s-log', 'atEpochMs': round(time.time() * 1000)}
        self.snapshot('at-stall')
        for role, package in [('app', PACKAGE), ('driver', DRIVER_PACKAGE)]:
            if self.stop.is_set():
                break
            try:
                bundle = self.container(self.device, package, 'app')
                info = plistlib.loads((bundle / 'Info.plist').read_bytes())
                name = info.get('CFBundleExecutable', '')
                if info.get('CFBundleIdentifier') != package or not name or Path(name).name != name:
                    raise ValueError('Unexpected selected process bundle')
                executable = (bundle / name).resolve(strict=True)
                if not executable.is_relative_to(bundle):
                    raise ValueError('Executable escaped its selected bundle')
                record = self.sample(self.finder(executable), self.target / (role + '.sample.txt'))
                record['role'] = role
                self.records['samples'].append(record)
            except (OSError, ValueError, subprocess.TimeoutExpired) as error:
                self.records['samples'].append({'role': role, 'complete': False, 'issue': type(error).__name__})
            self.persist()

    def loop(self):
        while not self.stop.is_set():
            try:
                self.snapshot()
                self.inspect_stall()
            except Exception:
                # Observations cannot turn a failed test into a pass or replace its error.
                self.records['observerErrors'] += 1
            if self.stop.wait(5):
                break

    def start(self):
        self.thread = threading.Thread(target=self.loop, daemon=True)
        self.thread.start()

    def finish(self):
        self.stop.set()
        self.thread.join(timeout=45)
        if self.thread.is_alive():
            self.records['observerShutdownIssue'] = 'observer-still-active'
            return
        self.snapshot('after-case')


def diagnostic_junit(path):
    try:
        root = ET.parse(path).getroot()
        cases, suites = list(root.iter('testcase')), list(root.iter('testsuite'))
        if len(cases) != 1 or len(suites) != 1 or suites[0].get('tests') != '1':
            raise ValueError('Expected one executed diagnostic case')
        if cases[0].get('name') != 'Diagnostic warm tabs then saved memory reader' or cases[0].get('file') != 'tests/native/diagnostics/ios-warm-tabs-reader.yaml' or cases[0].get('status') != 'SUCCESS':
            raise ValueError('Diagnostic case identity/status mismatch')
        if any(list(root.iter(tag)) for tag in ['failure', 'error', 'skipped']):
            raise ValueError('Diagnostic failure/error/skip')
        if any(node.get(field, '0') != '0' for node in [root] + suites for field in ['failures', 'errors', 'skipped', 'disabled']):
            raise ValueError('Nonzero diagnostic suite failures')
        return {'passed': True}
    except (OSError, ValueError, ET.ParseError) as error:
        return {'passed': False, 'issue': type(error).__name__}


def observed_call(run, make_observer, command, timeout, **kwargs):
    """Observation failure cannot replace the original call, value or exception."""
    observer = None
    try:
        observer = make_observer()
        observer.start()
    except Exception:
        observer = None
    try:
        return run(command, timeout, **kwargs)
    finally:
        if observer:
            try:
                observer.finish()
            except Exception:
                pass


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--baseline', type=Path, required=True)
    parser.add_argument('--recovery-source', required=True)
    parser.add_argument('--groups', required=True)
    args = parser.parse_args()
    if os.environ.get('CI') != 'true' or os.environ.get('EXPO_PUBLIC_APP_ENV') != 'qa' or os.environ.get('EXPO_PUBLIC_SUPABASE_ANON_KEY') != 'native-ui-synthetic-no-provider-key':
        raise ValueError('Only the existing isolated synthetic QA environment is supported')
    if platform.system() != 'Darwin' or len(args.recovery_source) != 40 or any(x not in '0123456789abcdef' for x in args.recovery_source):
        raise ValueError('An exact recovery commit on macOS is required')
    tools_root = Path(__file__).resolve().parents[2]
    if read_command(['git', '-C', str(tools_root), 'rev-parse', 'HEAD']) != args.recovery_source:
        raise ValueError('Recovery helper checkout differs from its recorded source')
    baseline = args.baseline.resolve(strict=True)
    os.chdir(baseline)
    if read_command(['git', 'rev-parse', 'HEAD']) != SOURCE or read_command(['git', 'rev-parse', 'HEAD^{tree}']) != TREE:
        raise ValueError('Baseline checkout differs from the binary source')
    read_command(['git', 'diff', '--exit-code', 'HEAD'])
    runner_path = baseline / 'scripts/quality/native-ui-audit-runner.py'
    manifest_path = baseline / 'tests/native/audit/manifest.json'
    if digest(runner_path) != RUNNER_SHA or digest(manifest_path) != MANIFEST_SHA:
        raise ValueError('Original runner/scenarios must remain unchanged')
    spec = importlib.util.spec_from_file_location('original_audit_runner', runner_path)
    runner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(runner)
    binary_dir = baseline / 'native-audit-binary'
    manifest = json.loads((binary_dir / 'binary-manifest.json').read_text())
    if manifest.get('binarySha256') != BINARY_SHA or manifest.get('sourceReceiptSha256') != SOURCE_RECEIPT_SHA or digest(binary_dir / 'source.json') != SOURCE_RECEIPT_SHA or manifest.get('auditManifestSha256') != MANIFEST_SHA:
        raise ValueError('Retained binary/source/scenario provenance differs')
    app = extract_app(binary_dir / 'qa.app.tar.gz', binary_dir)
    runner.validate_binary(manifest, app, 'ios', SOURCE, TREE)
    scenarios = json.loads(manifest_path.read_text())
    groups = set(args.groups.split(','))
    if not groups or not groups <= set(scenarios['groups']):
        raise ValueError('Unknown or empty feature group selection')
    cases = [case for case in scenarios['cases'] if case['group'] in groups]
    output = baseline / 'native-audit-results'
    output.mkdir(exist_ok=False)
    logs = baseline / 'native-ui-logs'
    logs.mkdir(exist_ok=True)
    for source, name in [(binary_dir / 'binary-manifest.json', 'binary-manifest.json'), (manifest_path, 'audit-manifest.json')]:
        shutil.copyfile(source, output / name)
    provenance = {'schemaVersion': 1, 'kind': 'original-binary-ios-audit-diagnostic-recovery',
        'applicationSourceCommit': SOURCE, 'applicationSourceTree': TREE, 'producerRunId': PRODUCER_RUN,
        'binarySha256': BINARY_SHA, 'sourceReceiptSha256': manifest['sourceReceiptSha256'],
        'auditManifestSha256': MANIFEST_SHA, 'originalRunnerSha256': RUNNER_SHA,
        'recoverySourceCommit': args.recovery_source, 'recoveryRunId': os.environ.get('GITHUB_RUN_ID'),
        'recoveryRunAttempt': os.environ.get('GITHUB_RUN_ATTEMPT'), 'helperSha256': digest(Path(__file__)),
        'compatibilityHelperSha256': digest(compatibility_path),
        'workflowSha256': digest(tools_root / '.github/workflows/native-audit-ios-recovery.yml'),
        'selectedGroups': sorted(groups), 'selectedCaseCount': len(cases),
        'rebuild': False, 'rebundle': False, 'resign': False, 'originalCasesUnchanged': True,
        'diagnosticLimits': {'snapshotIntervalSeconds': 5, 'maxTraceBytesPerFile': MAX_TRACE_BYTES,
            'samplePairsPerShard': 1, 'sampleSecondsPerProcess': 3, 'sampleIntervalMilliseconds': 10,
            'sampleWallBudgetSeconds': 8, 'sampleBytesPerProcess': MAX_SAMPLE_BYTES,
            'nativeBodiesReadAgain': False, 'coreEnvironmentArgvOrHeapCaptured': False},
        'coverageLimit': 'Original memory cases enter the reader directly. One separately reported diagnostic uses three existing warm-tab cycles followed by Profile/shelf/book. It is a related path, not the identical original single-cycle full journey; isolated success cannot establish its cure.',
        'observationOverhead': 'Snapshots add bounded file/command work; sample briefly suspends threads at each sampling interval. Original test deadlines and outcomes are not adjusted.'}
    atomic_json(output / 'recovery-provenance.json', provenance)
    device = None
    log_process = None
    active_observer = None
    budget = {'used': False}
    old_handlers = {}
    def cancel(signum, _frame):
        raise SystemExit(128 + signum)
    for sig in [signal.SIGINT, signal.SIGTERM]:
        old_handlers[sig] = signal.signal(sig, cancel)
    result = 1
    setup_records = []
    try:
        provenance['immutableCompatibilityVerification'] = verify_setup_immutable(
            app, manifest, setup_records, output / 'setup-commands.json')
        atomic_json(output / 'recovery-provenance.json', provenance)
        device = setup_read(['xcrun', 'simctl', 'create', 'Platinum retained audit ' + os.environ.get('GITHUB_RUN_ID', ''),
                             'com.apple.CoreSimulator.SimDeviceType.iPhone-16', RUNTIME], 'create', 120,
                            setup_records, output / 'setup-commands.json')
        setup_read(['xcrun', 'simctl', 'boot', device], 'boot', 120, setup_records, output / 'setup-commands.json')
        setup_read(['xcrun', 'simctl', 'bootstatus', device, '-b'], 'bootstatus', 300, setup_records, output / 'setup-commands.json')
        provenance['bootedRuntimeVerification'] = verify_setup_booted_runtime(
            app, manifest, device, setup_records, output / 'setup-commands.json')
        provenance['compatibilityVerification'] = {
            **provenance['immutableCompatibilityVerification'], **provenance['bootedRuntimeVerification'],
            'scope': 'Actual host/toolchain/app verified before Simulator creation; live selected runtime/device verified after boot. App launch remains required.'}
        provenance['device'] = device
        atomic_json(output / 'recovery-provenance.json', provenance)
        if runner.binary_digest(app) != BINARY_SHA:
            raise ValueError('Verified app bytes changed before installation')
        read_command(['xcrun', 'simctl', 'install', device, str(app)], timeout=120)
        with (logs / 'app.log').open('wb') as log_file:
            log_process = subprocess.Popen(['xcrun', 'simctl', 'spawn', device, 'log', 'stream', '--style', 'compact', '--level', 'info',
                '--predicate', 'process == "PlatinumQA"'], stdout=log_file, stderr=subprocess.STDOUT, start_new_session=True)
        case_paths = {'tests/native/audit/' + case['flow']: case for case in cases}
        def execute(command, timeout, **kwargs):
            nonlocal active_observer
            if command[0] != 'maestro':
                return runner.run_owned(command, timeout, **kwargs)
            case = case_paths[command[-1]]
            def make_observer():
                nonlocal active_observer
                active_observer = Observer(device, output / case['id'] / 'diagnostics', logs / 'app.log', budget,
                                           expected_case=case.get('fixtureCaseId', case['id']))
                return active_observer
            try:
                return observed_call(runner.run_owned, make_observer, command, timeout, **kwargs)
            finally:
                active_observer = None
        diagnostic = None
        if 'memory' in groups:
            relative = 'tests/native/diagnostics/ios-warm-tabs-reader.yaml'
            source = tools_root / relative
            destination = baseline / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            if destination.exists():
                raise ValueError('The separate diagnostic path must not replace a baseline file')
            shutil.copyfile(source, destination)
            case_paths[relative] = {'id': 'diagnostic-warm-tabs-reader', 'fixtureCaseId': 'navigation-warm-tabs'}
            target = output / 'diagnostic-warm-tabs-reader'
            target.mkdir()
            diagnostic = {'kind': 'additional-related-path-diagnostic', 'countedInBaseline85': False,
                'flowSha256': digest(destination), 'timeoutSeconds': 600, 'attempts': 1,
                'startedAtEpochMs': round(time.time() * 1000)}
            atomic_json(target / 'result.json', diagnostic)
            with (target / 'maestro.log').open('wb') as stream:
                try:
                    diagnostic['exitCode'] = execute(['maestro', '--device', device, 'test', '--format', 'junit',
                        '--output', str(target / 'junit.xml'), '--debug-output', str(target / 'maestro'),
                        '--test-output-dir', str(target / 'maestro'), relative], timeout=600,
                        stdout=stream, stderr=subprocess.STDOUT).returncode
                except subprocess.TimeoutExpired:
                    diagnostic.update({'exitCode': None, 'timedOut': True})
                except OSError as error:
                    diagnostic.update({'exitCode': None, 'executionIssue': type(error).__name__})
            try:
                diagnostic['collection'] = runner.collect('ios', device, target)
            except (OSError, ValueError, subprocess.TimeoutExpired) as error:
                diagnostic['collectionIssue'] = type(error).__name__
            fixture_case = next(case for case in scenarios['cases'] if case['id'] == 'navigation-warm-tabs')
            diagnostic['fixture'] = runner.validate_receipt(target / 'native-ui-receipt.json', fixture_case)
            diagnostic['junit'] = diagnostic_junit(target / 'junit.xml')
            diagnostic['passed'] = diagnostic.get('exitCode') == 0 and diagnostic['fixture']['passed'] and diagnostic['junit']['passed']
            diagnostic['finishedAtEpochMs'] = round(time.time() * 1000)
            atomic_json(target / 'result.json', diagnostic)
        results = runner.run_cases(cases, 'ios', device, output, execute=execute)
        summary = {'applicationSourceCommit': SOURCE, 'applicationSourceTree': TREE, 'platform': 'ios',
            'selectedGroups': sorted(groups), 'unselectedGroups': sorted(set(scenarios['groups']) - groups),
            'attempted': len(results), 'passed': sum(row['status'] == 'passed' for row in results),
            'failed': sum(row['status'] != 'passed' for row in results), 'allControlsAccepted': False}
        atomic_json(output / 'summary.json', summary)
        result = int(summary['failed'] != 0 or (diagnostic is not None and not diagnostic['passed']))
        read_command(['git', 'diff', '--exit-code', 'HEAD'])
        if digest(runner_path) != RUNNER_SHA or digest(manifest_path) != MANIFEST_SHA or runner.binary_digest(app) != BINARY_SHA:
            raise ValueError('Original case/source/binary bytes changed during recovery')
        return result
    finally:
        # Periodic copies already exist if the job is hard-killed. This is a final
        # bounded best-effort observation before deleting the selected device.
        try:
            if active_observer:
                active_observer.finish()
            if device:
                last = Observer(device, output / 'exit-diagnostics', logs / 'app.log', {'used': True})
                last.snapshot('exit')
        except Exception:
            pass
        if log_process:
            stop_group(log_process)
        if device:
            for action in ['shutdown', 'delete']:
                try:
                    bounded_command(['xcrun', 'simctl', action, device], timeout=10)
                except (OSError, ValueError, subprocess.TimeoutExpired):
                    pass
        for sig, handler in old_handlers.items():
            signal.signal(sig, handler)


if __name__ == '__main__':
    if len(sys.argv) == 4 and sys.argv[1] == '_sample-child':
        # Exec a fixed public macOS utility in a fresh child, avoiding preexec_fn
        # in the observer thread. No sudo, debugger injection, or core capture.
        pid = int(sys.argv[2])
        if platform.system() != 'Darwin' or os.environ.get('CI') != 'true' or pid <= 1:
            raise SystemExit(2)
        resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_SAMPLE_BYTES, MAX_SAMPLE_BYTES))
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        os.execv('/usr/bin/sample', ['/usr/bin/sample', str(pid), '3', '10', '-file', sys.argv[3]])
    sys.exit(main())
