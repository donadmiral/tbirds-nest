#!/usr/bin/env python3
"""One-shot, source-separated diagnosis of Simulator setup; no app or UI test."""
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import platform
import re
import resource
import selectors
import signal
import subprocess
import sys
import time

SUPPORT_SHA = '428cdb8734e41c6a3a25ec1f6088a627ce6e26f911fe5496e1082e7c742592a2'
COMPATIBILITY_SHA = '0a6e65d5dbfbf883cc0d4b765011d1941dcd64c0972140e28d9d3d6564159ce9'
DEVELOPER = '/Applications/Xcode_16.4.app/Contents/Developer'
RUNTIME = 'com.apple.CoreSimulator.SimRuntime.iOS-18-5'
SERVICE = 'com.apple.CoreSimulator.CoreSimulatorService'
WATCHED = {'PerfPowerServices', 'powerd', 'ReportCrash', SERVICE, 'simdiskimaged', 'Simulator', 'launchd_sim'}
support_path = Path(__file__).with_name('native-ui-ios-audit-recovery.py')
for checked_path, expected_digest in [(support_path, SUPPORT_SHA), (support_path.with_name('native-ui-ios-compatibility.py'), COMPATIBILITY_SHA)]:
    if hashlib.sha256(checked_path.read_bytes()).hexdigest() != expected_digest:
        raise ValueError('Reviewed diagnostic support bytes changed before import')
spec = importlib.util.spec_from_file_location('setup_support', support_path)
support = importlib.util.module_from_spec(spec)
spec.loader.exec_module(support)


def process_rows(text):
    rows = []
    seen = set()
    lines = text.splitlines()
    if len(lines) > 8192:
        raise ValueError('process-count-limit')
    for line in lines:
        fields = line.strip().split(None, 4)
        if len(fields) != 5:
            raise ValueError('process-row-shape')
        pid, uid, cpu, rss, command = fields
        if not pid.isdigit() or not uid.isdigit() or not rss.isdigit():
            raise ValueError('process-numeric-shape')
        if int(pid) in seen:
            raise ValueError('duplicate-process-identity')
        seen.add(int(pid))
        percent = float(cpu)
        if not math.isfinite(percent) or not 0 <= percent <= 10000 or int(rss) > 2 ** 40:
            raise ValueError('process-value-range')
        name = Path(command).name[:128]
        rows.append({'pid': int(pid), 'uid': int(uid), 'cpuPercent': percent, 'rssKiB': int(rss), 'name': name})
    return rows


def bounded_process_projection(rows):
    selected = {row['pid']: row for row in sorted(rows, key=lambda x: x['cpuPercent'], reverse=True)[:12]}
    selected.update({row['pid']: row for row in sorted(rows, key=lambda x: x['rssKiB'], reverse=True)[:12]})
    watched = [row for row in rows if row['name'] in WATCHED]
    selected.update({row['pid']: row for row in watched[:16]})
    return {'observedProcessCount': len(rows), 'topCpuCount': min(len(rows), 12),
            'topRssCount': min(len(rows), 12), 'watchedCount': len(watched),
            'watchedOmitted': max(0, len(watched) - 16), 'processes': list(selected.values()),
            'cpuInterpretation': 'ps-reported process CPU percentage, not a calibrated interval measurement'}


def numeric_vm(text):
    result = {}
    page = re.search(r'page size of (\d+) bytes', text)
    if page:
        result['pageSizeBytes'] = int(page.group(1))
    for line in text.splitlines():
        if ':' not in line:
            continue
        name, value = line.rsplit(':', 1)
        value = value.strip().rstrip('.')
        if value.isdigit() and len(name) <= 96 and len(result) < 48:
            result[name] = int(value)
    return result


class Probe:
    def __init__(self, output):
        self.output = Path(output)
        self.records = {'commands': [], 'snapshots': [], 'diagnostic': None,
                        'samplingAfterTimeoutCanAffectObservedState': True,
                        'observationOverhead': 'Each before/after snapshot adds up to three bounded 3s reads plus local processing. Samples add work after an already-failed verdict. A successful probe alone cannot establish a cure of the prior host delay.',
                        'applicationOrReaderAcceptance': False}

    def persist(self):
        support.atomic_json(self.output / 'probe.json', self.records)

    def read(self, args, timeout=3, limit=256 * 1024):
        value = support.bounded_command(args, timeout=timeout, limit=limit)
        if value.returncode:
            raise ValueError('diagnostic-command-nonzero')
        return value.stdout.decode()

    def snapshot(self, label, deadline=None):
        started = time.monotonic()
        item = {'label': label, 'atEpochMs': round(time.time() * 1000), 'issues': {}}
        rows = []
        def read(args):
            budget = min(3, deadline - time.monotonic()) if deadline else 3
            if budget <= 0:
                raise TimeoutError('diagnostic-window-ended')
            return self.read(args, timeout=budget)
        try:
            raw = read(['/usr/sbin/sysctl', '-n', 'hw.memsize', 'hw.logicalcpu', 'vm.loadavg']).splitlines()
            if len(raw) != 3 or not raw[0].isdigit() or not raw[1].isdigit():
                raise ValueError('host-metric-shape')
            load = [float(x) for x in raw[2].strip('{} ').split()]
            if len(load) != 3 or not all(math.isfinite(x) and x >= 0 for x in load):
                raise ValueError('host-load-shape')
            item['physicalMemoryBytes'], item['logicalCpuCount'], item['loadAverage'] = int(raw[0]), int(raw[1]), load
        except (OSError, ValueError, TimeoutError, subprocess.TimeoutExpired) as error:
            item['issues']['sysctl'] = type(error).__name__
        try:
            item['vmCounters'] = numeric_vm(read(['/usr/bin/vm_stat']))
        except (OSError, ValueError, TimeoutError, subprocess.TimeoutExpired) as error:
            item['issues']['vm'] = type(error).__name__
        try:
            rows = process_rows(read(['/bin/ps', '-axo', 'pid=,uid=,%cpu=,rss=,comm=']))
            item.update(bounded_process_projection(rows))
        except (OSError, ValueError, TimeoutError, subprocess.TimeoutExpired) as error:
            item['issues']['processes'] = type(error).__name__
        item['elapsedSeconds'] = time.monotonic() - started
        item['finishedAtEpochMs'] = round(time.time() * 1000)
        self.records['snapshots'].append(item)
        self.persist()
        return rows

    def service_identity(self, rows, deadline):
        identities = []
        candidates = [row for row in rows if row['name'] == SERVICE and row['uid'] == os.getuid()]
        if len(candidates) != 1:
            return None, {'issue': 'missing-or-ambiguous-same-user-service', 'candidateCount': len(candidates)}
        for row in candidates:
            identity = support.process_identity(row['pid'])
            if identity and identity['uid'] == os.getuid() and Path(identity['executable']).name == SERVICE:
                identities.append(identity)
        if len(identities) != 1:
            return None, {'issue': 'missing-or-ambiguous-same-user-service', 'candidateCount': len(identities)}
        identity = identities[0]
        # A process name alone is insufficient. Verify Apple's signature and the
        # exact service identifier before sampling; no other-user process is read.
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return None, {'issue': 'diagnostic-window-ended'}
        try:
            self.read(['/usr/bin/codesign', '--verify', '--strict', '-R',
                       '=anchor apple and identifier "' + SERVICE + '"', identity['executable']],
                      timeout=min(4, remaining), limit=4096)
            if support.process_identity(identity['pid']) != identity:
                raise ValueError('service-identity-changed')
            return identity, {'appleSignatureVerified': True, 'uid': identity['uid'], 'pid': identity['pid'],
                              'executable': identity['executable'], 'startSeconds': identity['startSeconds'],
                              'startMicroseconds': identity['startMicroseconds']}
        except (OSError, ValueError, subprocess.TimeoutExpired) as error:
            return None, {'issue': type(error).__name__}

    def diagnose(self, process):
        if self.records['diagnostic'] is not None:
            return
        if not self.records['commands'] or self.records['commands'][-1]['status'] != 'timed-out':
            raise ValueError('diagnosis-requires-persisted-timeout')
        started = time.monotonic()
        deadline = started + 25
        result = {'startedAtEpochMs': round(time.time() * 1000), 'wallBudgetSeconds': 25,
                  'originalTimeoutAlreadyPersisted': True, 'samples': [], 'noServiceRestart': True}
        self.records['diagnostic'] = result
        self.persist()
        try:
            # Capture the exact still-live child of this probe, not a name match.
            try:
                owned = support.process_identity(process.pid) if process.poll() is None else None
                if not owned or owned['uid'] != os.getuid() or os.getpgid(process.pid) != process.pid:
                    owned = None
            except OSError:
                owned = None
            if owned is None:
                result['ownedCommandIssue'] = 'leader-exited-or-identity-not-owned'
            rows = self.snapshot('at-original-timeout', deadline)
            service, result['service'] = self.service_identity(rows, deadline)
            for role, identity in [('owned-command', owned), ('core-simulator-service', service)]:
                if identity is None:
                    continue
                remaining = deadline - time.monotonic()
                if remaining < 1:
                    result['samples'].append({'role': role, 'complete': False, 'issue': 'diagnostic-window-ended'})
                    continue
                def execute(args, timeout, limit):
                    budget = min(timeout, deadline - time.monotonic())
                    if budget <= 0:
                        raise subprocess.TimeoutExpired(args, 0)
                    return support.bounded_command(args, timeout=budget, limit=limit)
                sample = support.sample_process(identity, self.output / (role + '.sample.txt'), execute=execute)
                result['samples'].append({'role': role, **sample})
        except (OSError, ValueError, subprocess.TimeoutExpired) as error:
            result['issue'] = type(error).__name__
        finally:
            result['elapsedSeconds'] = time.monotonic() - started
            result['leaderExitCodeAfterObservation'] = process.poll()
            self.persist()

    def run_stage(self, stage, args, timeout, diagnose=False):
        row = {'stage': stage, 'timeoutSeconds': timeout, 'startedAtEpochMs': round(time.time() * 1000), 'status': 'running'}
        self.records['commands'].append(row)
        self.persist()
        process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
        data = {'stdout': bytearray(), 'stderr': bytearray()}
        started = time.monotonic()
        deadline = started + timeout
        def retain():
            for key, value in data.items():
                row[key + 'Bytes'] = len(value)
                row[key + 'Tail'] = bytes(value[-4096:]).decode(errors='replace')
                row[key + 'Truncated'] = len(value) > 4096
            row['elapsedSecondsAtVerdict'] = time.monotonic() - started
        with selectors.DefaultSelector() as selector:
            for name, pipe in [('stdout', process.stdout), ('stderr', process.stderr)]:
                os.set_blocking(pipe.fileno(), False)
                selector.register(pipe, selectors.EVENT_READ, name)
            try:
                while selector.get_map():
                    finished = process.poll() is not None
                    remaining = deadline - time.monotonic()
                    if remaining <= 0 and not finished:
                        raise subprocess.TimeoutExpired(args, timeout)
                    events = selector.select(0 if finished else min(.1, remaining))
                    if finished and not events:
                        break
                    for key, _ in events:
                        chunk = os.read(key.fileobj.fileno(), 8192)
                        if not chunk:
                            selector.unregister(key.fileobj)
                        else:
                            data[key.data].extend(chunk)
                            if len(data[key.data]) > (128 * 1024 if key.data == 'stdout' else 4096):
                                raise ValueError('setup-output-limit')
                code = process.wait(timeout=max(.01, deadline - time.monotonic()))
                retain()
                row.update({'status': 'completed' if code == 0 else 'failed', 'exitCode': code})
                if code:
                    raise ValueError('setup-command-nonzero')
                return bytes(data['stdout']).decode().strip()
            except BaseException as error:
                retain()
                row.update({'status': 'timed-out' if isinstance(error, subprocess.TimeoutExpired) else 'failed',
                            'issue': type(error).__name__, 'leaderExitCodeAtVerdict': process.poll()})
                self.persist()  # The original failed verdict precedes sampling and cleanup.
                if diagnose and isinstance(error, subprocess.TimeoutExpired):
                    try:
                        self.diagnose(process)
                    except Exception as observation_error:
                        row['diagnosticIssue'] = type(observation_error).__name__
                support.stop_group(process)
                raise
            finally:
                process.stdout.close()
                process.stderr.close()
                row['finishedAtEpochMs'] = round(time.time() * 1000)
                self.persist()


def main():
    if (platform.system() != 'Darwin' or os.environ.get('CI') != 'true'
            or os.environ.get('DEVELOPER_DIR') != DEVELOPER):
        raise ValueError('Use only the selected disposable Intel macOS CI host')
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    output = Path('ios-setup-diagnostics')
    output.mkdir(exist_ok=False)
    probe = Probe(output)
    probe.records['sourceCommit'] = os.environ.get('GITHUB_SHA')
    probe.records['runId'] = os.environ.get('GITHUB_RUN_ID')
    probe.records['runnerImage'] = {name: os.environ.get(name) for name in ['ImageOS', 'ImageVersion', 'RUNNER_ARCH']}
    if any(value is not None and (len(value) > 128 or not value.isprintable()) for value in probe.records['runnerImage'].values()):
        raise ValueError('Invalid allowlisted runner image metadata')
    probe.records['scope'] = 'Setup only. No app binary, build, signing, account, Maestro or reader case.'
    device = None
    def cancel(signum, _frame):
        raise SystemExit(128 + signum)
    old_handlers = {sig: signal.signal(sig, cancel) for sig in [signal.SIGINT, signal.SIGTERM]}
    try:
        if probe.run_stage('host-architecture', ['/usr/bin/uname', '-m'], 30) != 'x86_64':
            raise ValueError('Expected Intel host')
        if probe.run_stage('xcode-version', ['xcodebuild', '-version'], 30, diagnose=True) != 'Xcode 16.4\nBuild version 16F6':
            raise ValueError('Expected original Xcode')
        if probe.run_stage('sdk-version', ['xcrun', '--sdk', 'iphonesimulator', '--show-sdk-version'], 30, diagnose=True) != '18.5':
            raise ValueError('Expected original Simulator SDK')
        probe.snapshot('before-create')
        created = probe.run_stage('create', ['xcrun', 'simctl', 'create', 'Platinum setup diagnosis ' + os.environ.get('GITHUB_RUN_ID', ''),
                                            'com.apple.CoreSimulator.SimDeviceType.iPhone-16', RUNTIME], 120, diagnose=True)
        if not re.fullmatch(r'[A-Fa-f0-9]{8}(?:-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12}', created):
            raise ValueError('Invalid created device identity')
        device = created
        probe.records['selectedDevice'] = device
        probe.snapshot('before-boot')
        probe.run_stage('boot', ['xcrun', 'simctl', 'boot', device], 120, diagnose=True)
        probe.run_stage('bootstatus', ['xcrun', 'simctl', 'bootstatus', device, '-b'], 300, diagnose=True)
        probe.snapshot('after-boot')
        value = json.loads(probe.run_stage('list-runtimes', ['xcrun', 'simctl', 'list', 'runtimes', '--json'], 30, diagnose=True))
        found = [row for row in value['runtimes'] if row.get('identifier') == RUNTIME and row.get('isAvailable') and row.get('version') == '18.5']
        if len(found) != 1:
            raise ValueError('Expected available original runtime')
        probe.records['setupReadPassed'] = True
        return 0
    except (OSError, ValueError, subprocess.TimeoutExpired) as error:
        probe.records['failure'] = {'issue': type(error).__name__, 'beforeCleanup': True}
        probe.persist()
        return 1
    finally:
        probe.persist()
        if device:
            for action in ['shutdown', 'delete']:
                try:
                    support.bounded_command(['xcrun', 'simctl', action, device], timeout=10, limit=4096)
                except (OSError, ValueError, subprocess.TimeoutExpired):
                    pass
        for sig, handler in old_handlers.items():
            signal.signal(sig, handler)


if __name__ == '__main__':
    sys.exit(main())
