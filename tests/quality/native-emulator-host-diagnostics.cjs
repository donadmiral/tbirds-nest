const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const helper = path.resolve(__dirname, '../../scripts/quality/native-ui-emulator-host-diagnostics.py');
const prelude = String.raw`
import importlib.util, json, os, shutil, sys, time
from pathlib import Path
spec = importlib.util.spec_from_file_location('host_diagnostics', sys.argv[1])
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
c = json.loads(sys.argv[2])
m.PROC_ROOT = Path(c['proc'])
def invoke(phase, extra=None):
    args = [phase, '--pid', str(c['pid']), '--started-ns', c['started']]
    args += ['--sdk-root', c['sdk']] if phase == 'snapshot' else ['--gate-exit', str(c['gate'])]
    code = m.main(args + (extra or []))
    target = Path(m.LOG_DIRECTORY) / (m.IDENTITY_FILE if phase == 'snapshot' else m.RESULT_FILE)
    return {'exitCode': code, 'receipt': json.loads(target.read_text()) if target.is_file() else None}
def record(saved, **changes):
    identity = saved['identity']
    value = {'MESSAGE_ID': m.MESSAGE_ID, '_BOOT_ID': saved['bootId'],
        'COREDUMP_PID': str(identity['pid']), 'COREDUMP_UID': str(identity['uid']),
        'COREDUMP_EXE': identity['executable'], 'COREDUMP_SIGNAL': '11',
        'COREDUMP_SIGNAL_NAME': 'SIGSEGV', 'COREDUMP_TIMESTAMP': str(time.time_ns() // 1000),
        '__REALTIME_TIMESTAMP': str(time.time_ns() // 1000), '__MONOTONIC_TIMESTAMP': '123456789',
        'MESSAGE': 'Process crashed.\nStack trace of thread 123:\n#0  libSyntheticRenderer.so',
        'COREDUMP': 'CORE_SENTINEL', 'COREDUMP_ENVIRON': 'ENV_SENTINEL',
        'COREDUMP_CMDLINE': 'CMDLINE_SENTINEL', 'COREDUMP_PROC_MAPS': 'MAPS_SENTINEL',
        '__CURSOR': 'CURSOR_SENTINEL', 'UNEXPECTED': 'UNKNOWN_SENTINEL'}
    value.update(changes)
    return value
def response(data=b'', **changes):
    value = {'stdout': data, 'stderr': b'', 'returnCode': 0, 'timedOut': False,
             'stdoutLimitHit': False, 'stderrLimitHit': False}
    value.update(changes)
    return value
def use_records(records, **changes):
    calls = []
    def query(command, deadline):
        calls.append(command)
        data = b'\n'.join(json.dumps(item).encode() for item in records)
        return response(data, **changes)
    m.run_journal = query
    return calls
def emit(value):
    print(json.dumps(value))
`;

function fixture(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'native-host-journal-test-'));
  const logs = path.join(directory, 'native-ui-logs');
  const proc = path.join(directory, 'proc');
  const sdk = path.join(directory, 'android-sdk');
  const pid = 23456;
  const processDirectory = path.join(proc, String(pid));
  const boot = path.join(proc, 'sys/kernel/random');
  const exe = path.join(sdk, 'emulator/qemu/linux-x86_64/qemu-system-x86_64');
  fs.mkdirSync(logs);
  fs.mkdirSync(processDirectory, { recursive: true });
  fs.mkdirSync(boot, { recursive: true });
  fs.mkdirSync(path.dirname(exe), { recursive: true });
  fs.writeFileSync(exe, 'synthetic executable identity only\n', { mode: 0o755 });
  fs.symlinkSync(exe, path.join(processDirectory, 'exe'));
  fs.writeFileSync(path.join(boot, 'boot_id'), '8aab3bd8-73cd-4899-a162-f812dd667788\n');
  const fields = ['S', ...Array(18).fill('0'), '678901', ...Array(30).fill('0')];
  fs.writeFileSync(path.join(processDirectory, 'stat'), `${pid} (qemu name) with parens) ${fields.join(' ')}\n`);
  fs.writeFileSync(path.join(processDirectory, 'status'), `Name:\tqemu\nUid:\t${Array(4).fill(process.getuid()).join('\t')}\n`);
  const config = { proc, sdk, pid, gate: options.gate ?? 1, started: String((BigInt(Date.now()) - 1000n) * 1000000n) };
  const environment = { ...process.env, CI: 'true', EXPO_PUBLIC_APP_ENV: 'qa', GITHUB_RUN_ID: '41218724056' };
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return {
    directory, logs, proc, sdk, exe, processDirectory, config,
    run(body, overrides = {}) {
      const result = spawnSync('python3', ['-B', '-c', prelude + body, helper,
        JSON.stringify({ ...config, ...overrides.config })], { cwd: directory,
        env: { ...environment, ...overrides.env }, encoding: 'utf8', timeout: 6000, maxBuffer: 1024 * 1024 });
      assert.equal(result.status, 0, result.stderr || String(result.error));
      return { value: JSON.parse(result.stdout), stderr: result.stderr };
    },
  };
}

test('snapshots the live QA process with exact executable inode, start ticks and boot identity', t => {
  const f = fixture(t);
  const { value } = f.run('emit(invoke("snapshot"))');
  assert.equal(value.exitCode, 0);
  const receipt = value.receipt;
  assert.equal(receipt.status, 'available');
  assert.equal(receipt.identity.pid, f.config.pid);
  assert.equal(receipt.identity.uid, process.getuid());
  assert.equal(receipt.identity.executable, f.exe);
  assert.equal(receipt.identity.executableInode, fs.statSync(f.exe).ino);
  assert.equal(receipt.identity.startTicks, '678901');
  assert.equal(receipt.bootId, '8aab3bd873cd4899a162f812dd667788');
  assert.ok(BigInt(receipt.snapshotUnixNs) >= BigInt(f.config.started));
  assert.equal(receipt.limits.seconds, 1);
});

test('rejects non-QA, non-CI, missing run, invalid PID, future and stale launch contexts before reading', async t => {
  const cases = [
    { env: { EXPO_PUBLIC_APP_ENV: 'production' } },
    { env: { CI: 'false' } },
    { env: { GITHUB_RUN_ID: '' } },
    { config: { pid: 0 } },
    { config: { started: String((BigInt(Date.now()) + 60000n) * 1000000n) } },
    { config: { started: '1000000000' } },
  ];
  for (const [i, change] of cases.entries()) {
    await t.test(`guard ${i + 1}`, child => {
      const f = fixture(child);
      const { value } = f.run('emit(invoke("snapshot"))', change);
      assert.equal(value.exitCode, 2);
      assert.equal(value.receipt, null);
      assert.deepEqual(fs.readdirSync(f.logs), []);
    });
  }
});

test('rejects a different UID, dead process and noncanonical emulator executable', async t => {
  const changes = [
    "(m.PROC_ROOT / str(c['pid']) / 'status').write_text('Uid:\\t999999\\t999999\\t999999\\t999999\\n')",
    "p=m.PROC_ROOT/str(c['pid'])/'stat'; p.write_text(p.read_text().replace(') S ', ') Z '))",
    "p=m.PROC_ROOT/str(c['pid'])/'exe'; p.unlink(); p.symlink_to(sys.executable)",
  ];
  for (const [i, change] of changes.entries()) {
    await t.test(`identity ${i + 1}`, child => {
      const f = fixture(child);
      const { value } = f.run(`${change}\nemit(invoke('snapshot'))`);
      assert.equal(value.receipt.status, 'unavailable');
      assert.ok(['process-uid-mismatch', 'process-not-live', 'unexpected-emulator-executable'].includes(value.receipt.reason));
      assert.equal(value.receipt.identity, undefined);
    });
  }
});

test('rejects a process start-tick change during the snapshot', t => {
  const f = fixture(t);
  const { value } = f.run(String.raw`
original = m.read_at
reads = 0
def changed(fd, name, *args, **kwargs):
    global reads
    data = original(fd, name, *args, **kwargs)
    if name == 'stat':
        reads += 1
        if reads > 1:
            return data.replace(b'678901', b'678902')
    return data
m.read_at = changed
emit(invoke('snapshot'))
`);
  assert.equal(value.receipt.reason, 'process-identity-changed');
  assert.equal(value.receipt.status, 'unavailable');
});

test('makes one fixed noninteractive journal query and retains only the explicit field allowlist', t => {
  const f = fixture(t, { gate: 17 });
  const { value } = f.run(String.raw`
saved = invoke('snapshot')['receipt']
calls = use_records([record(saved)])
result = invoke('collect')
emit({'result': result, 'calls': calls})
`);
  const receipt = value.result.receipt;
  assert.equal(receipt.status, 'available');
  assert.equal(receipt.gateExitCode, 17);
  assert.equal(receipt.processAtCollection, 'same-start-ticks');
  assert.equal(value.calls.length, 1);
  const command = value.calls[0];
  assert.deepEqual(command.slice(0, 8), ['/usr/bin/sudo', '-n', '--', '/usr/bin/timeout',
    '--signal=TERM', '--kill-after=0.2s', '1.5s', '/usr/bin/journalctl']);
  assert.ok(command.includes('--all'));
  assert.ok(command.includes('--lines=4'));
  assert.ok(command.includes(`COREDUMP_PID=${f.config.pid}`));
  assert.ok(command.includes(`COREDUMP_UID=${process.getuid()}`));
  assert.ok(command.includes(`COREDUMP_EXE=${f.exe}`));
  assert.ok(command.includes('--boot=8aab3bd873cd4899a162f812dd667788'));
  assert.ok(command.some(x => x === '--output-fields=MESSAGE_ID,COREDUMP_PID,COREDUMP_UID,COREDUMP_EXE,COREDUMP_SIGNAL,COREDUMP_SIGNAL_NAME,COREDUMP_TIMESTAMP,MESSAGE,_BOOT_ID,__REALTIME_TIMESTAMP,__MONOTONIC_TIMESTAMP'));
  assert.ok(!command.some(x => /^(?:_PID|_UID|_EXE)=/.test(x)));
  assert.equal(receipt.records[0].COREDUMP_SIGNAL, '11');
  assert.match(receipt.records[0].MESSAGE, /libSyntheticRenderer\.so/);
  const retained = JSON.stringify(receipt);
  assert.doesNotMatch(retained, /CORE_SENTINEL|ENV_SENTINEL|CMDLINE_SENTINEL|MAPS_SENTINEL|CURSOR_SENTINEL|UNKNOWN_SENTINEL/);
  assert.equal(receipt.queryResult.stdout, undefined);
  assert.equal(receipt.queryResult.stderr, undefined);
});

test('allows a departed process while retaining the captured identity and original successful gate', t => {
  const f = fixture(t, { gate: 0 });
  const { value } = f.run(String.raw`
saved = invoke('snapshot')['receipt']
shutil.rmtree(m.PROC_ROOT / str(c['pid']))
calls = use_records([record(saved)])
emit(invoke('collect'))
`);
  assert.equal(value.receipt.status, 'available');
  assert.equal(value.receipt.processAtCollection, 'not-present');
  assert.equal(value.receipt.gateExitCode, 0);
});

test('rejects stale run, changed boot, launch mismatch and a reused PID without issuing a query', async t => {
  const changes = [
    "os.environ['GITHUB_RUN_ID'] = '999999999'",
    "(m.PROC_ROOT/'sys/kernel/random/boot_id').write_text('9aab3bd8-73cd-4899-a162-f812dd667788\\n')",
    "c['started'] = str(int(c['started']) + 1)",
    "p=m.PROC_ROOT/str(c['pid'])/'stat'; p.write_text(p.read_text().replace('678901', '678902'))",
  ];
  for (const [i, change] of changes.entries()) {
    await t.test(`collection guard ${i + 1}`, child => {
      const f = fixture(child);
      const { value } = f.run(`saved=invoke('snapshot')['receipt']\ncalls=use_records([record(saved)])\n${change}\nemit({'result':invoke('collect'),'calls':calls})`);
      assert.equal(value.result.receipt.status, 'unavailable');
      assert.deepEqual(value.calls, []);
    });
  }
});

test('rejects a process identity race during collection', t => {
  const f = fixture(t);
  const { value } = f.run(String.raw`
saved = invoke('snapshot')['receipt']
calls = use_records([record(saved)])
original = m.read_at
reads = 0
def changed(fd, name, *args, **kwargs):
    global reads
    data = original(fd, name, *args, **kwargs)
    if name == 'stat':
        reads += 1
        if reads > 1:
            return data.replace(b'678901', b'678902')
    return data
m.read_at = changed
emit({'result':invoke('collect'), 'calls':calls})
`);
  assert.equal(value.result.receipt.reason, 'process-identity-changed');
  assert.deepEqual(value.calls, []);
});

test('refuses linked or oversized snapshot input and never queries from it', async t => {
  const changes = [
    "p=Path(m.LOG_DIRECTORY)/m.IDENTITY_FILE; target=Path('outside.json'); p.rename(target); p.symlink_to(target.resolve())",
    "p=Path(m.LOG_DIRECTORY)/m.IDENTITY_FILE; os.link(p, 'extra-link.json')",
    "p=Path(m.LOG_DIRECTORY)/m.IDENTITY_FILE; p.write_bytes(b'x'*(m.MAX_INPUT_BYTES+1))",
  ];
  for (const [i, change] of changes.entries()) {
    await t.test(`input guard ${i + 1}`, child => {
      const f = fixture(child);
      const { value } = f.run(`saved=invoke('snapshot')['receipt']\ncalls=use_records([record(saved)])\n${change}\nemit({'result':invoke('collect'),'calls':calls})`);
      assert.equal(value.result.receipt.status, 'unavailable');
      assert.deepEqual(value.calls, []);
    });
  }
});

test('refuses symlinked output and log directories without overwriting outside bytes', async t => {
  for (const where of ['file', 'directory']) {
    await t.test(where, child => {
      const f = fixture(child);
      const outside = path.join(f.directory, 'outside');
      if (where === 'file') {
        fs.writeFileSync(outside, 'original sentinel');
        fs.symlinkSync(outside, path.join(f.logs, 'emulator-process-identity.json'));
      } else {
        fs.mkdirSync(outside);
        fs.rmdirSync(f.logs);
        fs.symlinkSync(outside, f.logs);
      }
      const { value } = f.run(String.raw`
code=m.main(['snapshot','--pid',str(c['pid']),'--started-ns',c['started'],'--sdk-root',c['sdk']])
emit({'exitCode':code})
`);
      assert.equal(value.exitCode, 2);
      if (where === 'file') assert.equal(fs.readFileSync(outside, 'utf8'), 'original sentinel');
      else assert.deepEqual(fs.readdirSync(outside), []);
    });
  }
});

test('rejects wrong journal process, owner, executable, boot, message ID or crash interval', t => {
  const f = fixture(t);
  const { value } = f.run(String.raw`
saved=invoke('snapshot')['receipt']
changes=[{'COREDUMP_PID':str(c['pid']+1)}, {'COREDUMP_UID':'999999999'},
 {'COREDUMP_EXE':'/usr/bin/unrelated'}, {'_BOOT_ID':'f'*32}, {'MESSAGE_ID':'f'*32},
 {'COREDUMP_TIMESTAMP':str(int(c['started'])//1000-1)},
 {'COREDUMP_TIMESTAMP':str(time.time_ns()//1000+60_000_000)}]
results=[m.selected_records(json.dumps(record(saved,**change)).encode(),saved,time.time_ns()) for change in changes]
emit(results)
`);
  assert.equal(value.length, 7);
  for (const [records, rejected, incomplete] of value) {
    assert.deepEqual(records, []);
    assert.equal(rejected, 1);
    assert.equal(incomplete, true);
  }
});

test('rejects malformed, duplicate and ambiguous typed journal fields', t => {
  const f = fixture(t);
  const { value } = f.run(String.raw`
saved=invoke('snapshot')['receipt']
valid=json.dumps(record(saved)).encode()
inputs=[b'{', b'[]', valid[:-1]+b',"COREDUMP_PID":"23456"}',
 json.dumps(record(saved,COREDUMP_PID=[str(c['pid'])])).encode(),
 json.dumps(record(saved,COREDUMP_SIGNAL='0')).encode(),
 json.dumps(record(saved,COREDUMP_SIGNAL='129')).encode(),
 json.dumps(record(saved,COREDUMP_TIMESTAMP=12345)).encode()]
emit([m.selected_records(data,saved,time.time_ns()) for data in inputs])
`);
  for (const [records, rejected, incomplete] of value) {
    assert.deepEqual(records, []);
    assert.equal(rejected, 1);
    assert.equal(incomplete, true);
  }
});

test('bounds UTF-8 message bytes and marks absent message and possible record truncation', t => {
  const f = fixture(t);
  const { value } = f.run(String.raw`
saved=invoke('snapshot')['receipt']
calls=use_records([record(saved,MESSAGE='\u20ac'*20000), record(saved,MESSAGE=None),
                  record(saved),record(saved),record(saved)])
emit(invoke('collect'))
`);
  assert.equal(value.receipt.status, 'ambiguous');
  assert.equal(value.receipt.records.length, 4);
  assert.equal(value.receipt.recordLimitPossiblyReached, true);
  assert.equal(value.receipt.records[0].messageTruncated, true);
  assert.ok(Buffer.byteLength(value.receipt.records[0].MESSAGE) <= 32768);
  assert.equal(value.receipt.records[1].messageUnavailable, true);
});

test('no saved record remains unavailable and preserves a successful gate', t => {
  const f = fixture(t, { gate: 0 });
  const { value } = f.run("invoke('snapshot')\ncalls=use_records([])\nemit({'result':invoke('collect'),'calls':calls})");
  assert.equal(value.result.receipt.status, 'unavailable');
  assert.equal(value.result.receipt.reason, 'no-matching-saved-crash-record');
  assert.equal(value.result.receipt.gateExitCode, 0);
  assert.equal(value.calls.length, 1);
});

test('permission denial, missing tool, failure and timeout are explicit and never retry', async t => {
  const cases = [
    ["return response(stderr=b'sudo: a password is required SECRET',returnCode=1)", 'journal-permission-denied'],
    ["raise FileNotFoundError('SECRET')", 'journal-tool-unavailable'],
    ["return response(stderr=b'opaque failure SECRET',returnCode=2)", 'journal-command-failed'],
    ["return response(returnCode=124,timedOut=True)", 'journal-query-timeout'],
  ];
  for (const [body, reason] of cases) {
    await t.test(reason, child => {
      const f = fixture(child);
      const { value } = f.run(`invoke('snapshot')\ncalls=[]\ndef query(command,deadline):\n    calls.append(command)\n    ${body}\nm.run_journal=query\nemit({'result':invoke('collect'),'calls':calls})`);
      assert.equal(value.result.receipt.status, 'unavailable');
      assert.equal(value.result.receipt.reason, reason);
      assert.equal(value.calls.length, 1);
      assert.doesNotMatch(JSON.stringify(value), /SECRET/);
    });
  }
});

test('output caps and rejected records are partial rather than successful attribution', async t => {
  for (const flag of ['stdoutLimitHit', 'stderrLimitHit', 'malformed']) {
    await t.test(flag, child => {
      const f = fixture(child);
      const change = flag === 'malformed' ? "return response(b'{')" : `return response(${flag}=True)`;
      const { value } = f.run(`invoke('snapshot')\ndef query(command,deadline):\n    ${change}\nm.run_journal=query\nemit(invoke('collect'))`);
      assert.equal(value.receipt.status, 'partial');
      assert.equal(value.receipt.reason, flag === 'malformed' ? 'journal-record-rejected' : 'journal-output-limit');
    });
  }
});

test('actual subprocess reader drains a normal child without prematurely terminating it', t => {
  const f = fixture(t);
  const { value } = f.run(String.raw`
command=[sys.executable,'-c',"import os,time; os.write(1,b'bounded data'); os.close(1); os.close(2); time.sleep(.03)"]
observed=m.run_journal(command,time.monotonic()+1)
emit({**{k:v for k,v in observed.items() if k not in ('stdout','stderr')},'text':observed['stdout'].decode()})
`);
  assert.equal(value.returnCode, 0);
  assert.equal(value.timedOut, false);
  assert.equal(value.text, 'bounded data');
});

test('actual subprocess reader enforces independent stdout and stderr byte caps', async t => {
  for (const stream of ['stdout', 'stderr']) {
    await t.test(stream, child => {
      const f = fixture(child);
      const fd = stream === 'stdout' ? 1 : 2;
      const { value } = f.run(`command=[sys.executable,'-c',"import os,time; os.write(${fd},b'x'*200000); time.sleep(30)"]\nstarted=time.monotonic()\nobserved=m.run_journal(command,started+2)\nemit({**{k:v for k,v in observed.items() if k not in ('stdout','stderr')},'stdoutBytes':len(observed['stdout']),'stderrBytes':len(observed['stderr']),'elapsed':time.monotonic()-started})`);
      assert.equal(value[`${stream}LimitHit`], true);
      assert.equal(value[`${stream}Bytes`], stream === 'stdout' ? 131072 : 4096);
      assert.ok(value.elapsed < 2.2);
      assert.ok(Number.isInteger(value.returnCode));
    });
  }
});

test('actual subprocess reader terminates a stalled child even when TERM is ignored', t => {
  const f = fixture(t);
  const { value } = f.run(String.raw`
command=[sys.executable,'-c','import signal,time; signal.signal(signal.SIGTERM,signal.SIG_IGN); time.sleep(30)']
started=time.monotonic()
observed=m.run_journal(command,started+.5)
emit({**{k:v for k,v in observed.items() if k not in ('stdout','stderr')},'elapsed':time.monotonic()-started})
`);
  assert.equal(value.timedOut, true);
  assert.equal(value.returnCode, -9);
  assert.ok(value.elapsed < 0.8);
});

test('snapshot and collection budgets reject expired work without issuing a query', t => {
  const f = fixture(t);
  const { value } = f.run(String.raw`
saved=invoke('snapshot')['receipt']
calls=use_records([record(saved)])
args=type('Args',(),{'pid':c['pid'],'started_ns':int(c['started']),'sdk_root':c['sdk'],'gate_exit':1})()
results=[]
for operation in (m.snapshot,m.collect):
    try:
        operation(args,{'runId':os.environ['GITHUB_RUN_ID']},time.monotonic()-1)
    except m.Unavailable as error:
        results.append(str(error))
emit({'reasons':results,'calls':calls})
`);
  assert.deepEqual(value.reasons, ['diagnostic-deadline', 'diagnostic-deadline']);
  assert.deepEqual(value.calls, []);
});
