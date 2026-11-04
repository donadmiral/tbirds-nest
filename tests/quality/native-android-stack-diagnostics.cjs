const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const root = path.resolve(__dirname, '../..');
const relative = 'scripts/quality/native-ui-android-stack-diagnostics.py';
const helper = path.join(root, relative);
const packageName = 'app.platinumcircles.mobile.qa';
const source = '8be96f4a29b4e7a210240bf4c04c5b9ec506f31e';
const prelude = String.raw`
import importlib.util, json, os, sys, time
from pathlib import Path
spec=importlib.util.spec_from_file_location('stack_diagnostics',sys.argv[1])
m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
c=json.loads(sys.argv[2]); calls=[]
trace=('----- pid 2408 at 2026-11-04 17:31:40 -----\n'
       'Cmd line: app.platinumcircles.mobile.qa\n'
       'Build fingerprint: PRIVATE_FINGERPRINT\n'
       'Heap: PRIVATE_HEAP_SENTINEL\n'
       '"main" prio=5 tid=1 Blocked\n'
       '  | sysTid=2408 nice=0\n'
       '  native: #00 pc 00000abc /apex/com.android.runtime/lib64/bionic/libc.so (syscall+28)\n'
       '  at android.view.ViewGroup.addViewInner(ViewGroup.java:5321)\n'
       '  - waiting to lock <0x123abc> (a java.lang.Object) held by thread 7\n'
       '  raw secret: SECRET_VALUE\n'
       '  at unsafe.Class.method(https://private.invalid/TOKEN_SENTINEL)\n'
       '  native: #01 pc 0000abcd /system/lib64/libart.so (https://private.invalid/token=SENTINEL)\n'
       '\n"mqt_js" prio=5 tid=7 Native\n'
       '  | sysTid=2459 nice=0\n'
       '  at com.swmansion.rnscreens.NativeProxy.notifyScreenRemoved(NativeProxy.kt:64)\n'
       '\n"https://PRIVATE_THREAD_SENTINEL" prio=5 tid=9 Native\n'
       '  at unsafe.Class.method(File.java:1)\n')
def response(data, code=0, **changes):
    result={'stdout':data,'stderrBytes':0,'timedOut':False,'limitHit':False,'exitCode':code,'elapsedMs':1}
    result.update(changes); return result
def transport(argv, seconds, maximum):
    calls.append({'argv':argv,'seconds':seconds,'maximum':maximum})
    index=len(calls)
    if index==1: return response(c.get('properties','0\n1\n35\nx86_64\n').encode())
    if index==2: return response(c.get('pid','2408\n').encode())
    if index==3:
        fields=['S']+['0']*18+['678901']+['0']*20
        return response(c.get('cmdline','app.platinumcircles.mobile.qa').encode()+b'\0'+('2408 (main) '+' '.join(fields)+'\n').encode())
    if index==4:
        body=trace.replace('pid 2408 at','pid 9999 at') if c.get('wrongDump') else trace
        if c.get('noMain'): body=body.replace('"main"','"unselected"')
        if c.get('extraFrames'): body=body.replace('  raw secret: SECRET_VALUE',('\n'.join('  at android.view.ViewGroup.method(File.java:1)' for _ in range(100))))
        return response(body.encode(),c.get('dumpExit',0),timedOut=c.get('dumpTimeout',False),limitHit=c.get('dumpLimit',False))
    raise AssertionError('Unexpected additional adb request')
m.command=transport
def invoke():
    code=m.main(['--adb','/fixture/android/platform-tools/adb','--device',c.get('device','emulator-5556'),'--flow-exit',str(c.get('flowExit',1))])
    p=Path('native-ui-logs/android-failure-stacks.json')
    return {'exitCode':code,'receipt':json.loads(p.read_text()) if p.exists() else None,'calls':calls}
def emit(value): print(json.dumps(value))
`;

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'native-android-stack-'));
  fs.mkdirSync(path.join(directory, 'native-ui-logs'));
  const manifest = { commit: source, workflowRun: '41874644908', hashes: {
    [relative]: crypto.createHash('sha256').update(fs.readFileSync(helper)).digest('hex'),
  } };
  fs.writeFileSync(path.join(directory, 'native-ui-logs/source.json'), JSON.stringify(manifest));
  fs.writeFileSync(path.join(directory, 'native-ui-logs/flow-results.json'), JSON.stringify({ flows: [
    { name: 'navigation', attempts: 1, exitCode: 1 },
    { name: 'memory-capture', attempts: 1, exitCode: 1 },
  ] }));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return { directory, run(config = {}, body = 'emit(invoke())', env = {}) {
    const result = spawnSync('python3', ['-B', '-c', prelude + body, helper, JSON.stringify(config)], {
      cwd: directory, encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024,
      env: { ...process.env, CI: 'true', EXPO_PUBLIC_APP_ENV: 'qa',
        EXPO_PUBLIC_SUPABASE_URL: 'https://uaulhuelcfkjwojtymmw.supabase.co',
        EXPO_PUBLIC_SUPABASE_ANON_KEY: 'native-ui-synthetic-no-provider-key',
        ANDROID_SERIAL: 'emulator-5556', GITHUB_SHA: source, GITHUB_RUN_ID: '41874644908', ...env },
    });
    assert.equal(result.status, 0, result.stderr || String(result.error));
    return JSON.parse(result.stdout);
  } };
}

test('one source-bound failure dump checks the existing emulator and exact QA process before retaining selected frames', t => {
  const f = fixture(t), result = f.run();
  assert.equal(result.exitCode, 0); assert.equal(result.receipt.status, 'available');
  assert.equal(result.receipt.source, source); assert.equal(result.receipt.flowExitCode, 1);
  assert.deepEqual(result.receipt.process, { pid: 2408, startTicks: '678901', package: packageName });
  assert.equal(result.calls.length, 4);
  assert.ok(result.calls.every(call => call.argv.slice(0, 4).join(' ') === '/fixture/android/platform-tools/adb -s emulator-5556 exec-out'));
  assert.ok(result.calls.slice(0, 3).every(call => call.seconds <= 2));
  assert.ok(result.calls[3].seconds <= 8);
  const script = result.calls[3].argv.at(-1);
  assert.match(script, /cmdline.*tr -d '\\000'/);
  assert.match(script, /awk '\{print \$22\}' \/proc\/2408\/stat.*678901/);
  assert.match(script, /exec \/system\/bin\/timeout -k 1 6 \/system\/bin\/debuggerd -j 2408$/);
  assert.equal((script.match(/debuggerd/g) || []).length, 1);
  assert.doesNotMatch(script, /run-as|kill -|force-stop|am start|\/data\/anr|tombstones/);
  assert.deepEqual(result.receipt.threads.map(thread => thread.name), ['main', 'mqt_js']);
  assert.equal(result.receipt.threads[0].systemThreadId, 2408);
  assert.ok(result.receipt.threads[0].frames.some(frame => typeof frame === 'string' && frame.includes('held by thread 7')));
  assert.doesNotMatch(JSON.stringify(result.receipt), /PRIVATE_|SECRET_VALUE|TOKEN_SENTINEL|SENTINEL|https:\/\/private/);
  assert.ok(result.receipt.commands.every(command => !('stdout' in command) && !('stderr' in command)));
});

for (const [label, config, env] of [
  ['successful flow', { flowExit: 0 }, {}], ['other device', { device: 'emulator-5554' }, {}],
  ['production', {}, { EXPO_PUBLIC_APP_ENV: 'production' }],
  ['provider key', {}, { EXPO_PUBLIC_SUPABASE_ANON_KEY: 'provider-key-sentinel' }],
  ['different source', {}, { GITHUB_SHA: 'a'.repeat(40) }],
]) test(`rejects ${label} before any device request`, t => {
  const result = fixture(t).run(config, 'emit(invoke())', env);
  assert.equal(result.exitCode, 2); assert.equal(result.receipt, null); assert.deepEqual(result.calls, []);
});

test('requires both original flows to finish and the exact prepared helper hash', async t => {
  for (const [name, file, mutate] of [
    ['unfinished capture', 'flow-results.json', data => { data.flows[1].exitCode = null; }],
    ['changed helper', 'source.json', data => { data.hashes[relative] = '0'.repeat(64); }],
  ]) await t.test(name, child => {
    const f = fixture(child), p = path.join(f.directory, 'native-ui-logs', file), data = JSON.parse(fs.readFileSync(p));
    mutate(data); fs.writeFileSync(p, JSON.stringify(data));
    const result = f.run(); assert.equal(result.exitCode, 2); assert.deepEqual(result.calls, []);
  });
});

for (const [label, config, expected, count] of [
  ['non-root emulator', { properties: '2000\n1\n35\nx86_64\n' }, 'unexpected-emulator-or-root-identity', 1],
  ['two processes', { pid: '2408 2409\n' }, 'missing-or-ambiguous-qa-process', 2],
  ['different package', { cmdline: 'other.app' }, 'qa-process-command-mismatch', 3],
  ['process changed', { dumpExit: 43 }, 'qa-process-changed-before-dump', 4],
  ['wrong dump identity', { wrongDump: true }, 'dump-process-identity-mismatch', 4],
  ['no main stack', { noMain: true }, 'main-thread-stack-unavailable', 4],
]) test(`records ${label} without a replacement dump`, t => {
  const result = fixture(t).run(config);
  assert.equal(result.receipt.status, 'unavailable'); assert.equal(result.receipt.reason, expected);
  assert.equal(result.calls.length, count); assert.equal(result.receipt.flowExitCode, 1);
  assert.equal(result.receipt.threads, undefined);
});

test('retains a bounded partial main stack without calling a timeout or truncated result complete', t => {
  const result = fixture(t).run({ dumpTimeout: true, dumpLimit: true, extraFrames: true });
  assert.equal(result.receipt.status, 'partial'); assert.equal(result.calls.length, 4);
  assert.equal(result.receipt.threads[0].frames.length, 64);
  assert.equal(result.receipt.threads[0].truncated, true);
});

test('retains a native-only main stack with the ART BuildId suffix', t => {
  const result = fixture(t).run({}, String.raw`
native_only=('----- pid 2408 at 2026-11-04 17:31:40 -----\n'
             'Cmd line: app.platinumcircles.mobile.qa\n'
             '"main" prio=5 tid=1 Native\n'
             '  | sysTid=2408 nice=0\n'
             '  native: #00 pc 00000abc /apex/com.android.runtime/lib64/bionic/libc.so (syscall+28) (BuildId: abc123def456)\n')
emit(m.selected_threads(native_only.encode(),2408))
`);
  assert.equal(result.length, 1); assert.equal(result[0].frames.length, 1);
  assert.equal(result[0].frames[0].module, 'libc.so');
  assert.equal(result[0].frames[0].symbol, 'syscall+28) (BuildId: abc123def456');
  assert.equal(result[0].systemThreadId, 2408);
});

test('retains the bridgeless JavaScript queue name from the installed React Native sources', t => {
  const rn = path.join(root, 'node_modules/react-native');
  const instance = fs.readFileSync(path.join(rn, 'ReactAndroid/src/main/java/com/facebook/react/runtime/ReactInstance.kt'), 'utf8');
  const queue = fs.readFileSync(path.join(rn, 'ReactAndroid/src/main/java/com/facebook/react/bridge/queue/MessageQueueThreadImpl.kt'), 'utf8');
  assert.match(instance, /MessageQueueThreadSpec\.newBackgroundThreadSpec\("v_js"\)/);
  assert.match(queue, /"mqt_\$name"/);
  const result = fixture(t).run({}, 'emit(m.selected_threads(trace.replace(\'"mqt_js"\', \'"mqt_v_js"\').encode(),2408))');
  const javascript = result.find(thread => thread.name === 'mqt_v_js');
  assert.equal(javascript.systemThreadId, 2459);
  assert.deepEqual(javascript.frames, ['at com.swmansion.rnscreens.NativeProxy.notifyScreenRemoved(NativeProxy.kt:64)']);
});

test('real command transport enforces the time and byte caps without retaining stderr', t => {
  const result = fixture(t).run({}, String.raw`
spec2=importlib.util.spec_from_file_location('unmodified_stack_transport',sys.argv[1])
actual=importlib.util.module_from_spec(spec2); spec2.loader.exec_module(actual)
slow=actual.command([sys.executable,'-c','import time; time.sleep(10)'],0.1,1024)
large=actual.command([sys.executable,'-c','import sys; sys.stdout.write("x"*2000000); sys.stdout.flush()'],1,1024)
error=actual.command([sys.executable,'-c','import sys; sys.stderr.write("PRIVATE_STDERR_SENTINEL"); sys.exit(3)'],1,1024)
for value in [slow,large,error]: value['stdoutBytes']=len(value.pop('stdout'))
emit({'slow':slow,'large':large,'error':error})
`);
  assert.equal(result.slow.timedOut, true); assert.ok(result.slow.elapsedMs < 1500);
  assert.equal(result.large.limitHit, true); assert.equal(result.large.stdoutBytes, 1024);
  assert.equal(result.error.exitCode, 3); assert.ok(result.error.stderrBytes > 0);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_STDERR_SENTINEL/);
});

test('integration stays after both flows and before evidence and preserves the source runner outside its single block', () => {
  const runner = fs.readFileSync(path.join(root, 'scripts/quality/test-android-app-ui.sh'), 'utf8');
  const start = runner.indexOf('if (( flow_status != 0 )); then\n');
  const end = runner.indexOf('\nevidence_status=0\n', start);
  assert.ok(start > runner.indexOf('bash scripts/quality/run-native-ui-flows.sh'));
  assert.ok(end > start);
  const block = runner.slice(start, end + 1);
  assert.match(block, /timeout --signal=TERM --kill-after=1s 15s python3/);
  assert.match(block, /\|\| true\nfi\n$/);
  const original = runner.slice(0, start) + runner.slice(end + 1);
  assert.equal(crypto.createHash('sha256').update(original).digest('hex'), '7043d1a9114b688134e670b88d706c75df6ab5a4e6cd5901660920b066bf70bb');
});
