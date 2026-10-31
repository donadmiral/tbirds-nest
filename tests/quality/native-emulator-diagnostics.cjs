const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '../..');
const helper = path.join(root, 'scripts/quality/native-ui-emulator-diagnostics.py');
const runner = fs.readFileSync(path.join(root, 'scripts/quality/test-android-app-ui.sh'), 'utf8');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
let sequence = 0;

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'native-crashpad-test-'));
  const version = `91.2.${process.pid * 100 + ++sequence}`;
  const parent = path.join('/tmp', `android-${os.userInfo().username}`);
  fs.mkdirSync(parent, { recursive: true });
  const store = path.join(parent, `emu-crash-${version}.db`);
  fs.mkdirSync(store);
  const logs = path.join(directory, 'native-ui-logs');
  fs.mkdirSync(logs);
  const pid = 23456;
  const started = String((BigInt(Date.now()) - 1000n) * 1000000n);
  const log = `INFO | Android emulator version ${version}.0 (build_id 16740729)\nINFO | Storing crashdata in: ${store}, detection is enabled for process: ${pid}\n`;
  fs.writeFileSync(path.join(logs, 'emulator.log'), log);
  const environment = { ...process.env, CI: 'true', EXPO_PUBLIC_APP_ENV: 'qa', GITHUB_RUN_ID: '41211437305' };
  const output = path.join(logs, 'emulator-crashpad');
  t.after(() => {
    fs.rmSync(store, { recursive: true, force: true });
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return {
    directory, logs, store, output, version, pid, started, log, environment,
    file(name, bytes = 'synthetic crash bytes') {
      const file = path.join(store, name);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, bytes);
      return file;
    },
    run(options = {}) {
      const args = ['--pid', String(options.pid ?? pid), '--started-ns', options.started ?? started,
        '--gate-exit', String(options.gate ?? 1)];
      const result = spawnSync('python3', [helper, ...args], { cwd: directory,
        env: { ...environment, ...options.env }, encoding: 'utf8', timeout: 10000 });
      const manifestPath = path.join(output, 'manifest.json');
      const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath)) : null;
      return { result, manifest };
    },
  };
}

test('copies only current-run regular bytes with hashes and preserves original gate metadata', t => {
  const f = fixture(t);
  const bytes = Buffer.from('current synthetic minidump');
  f.file('pending/report.dmp', bytes);
  f.file('manifest.json', 'a store file cannot replace the collection manifest');
  const { result, manifest } = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(manifest.status, 'collected');
  assert.equal(manifest.gateExitCode, 1);
  assert.equal(manifest.emulatorPid, f.pid);
  assert.equal(manifest.source.path, f.store);
  assert.equal(manifest.source.version, f.version);
  assert.equal(manifest.filesCopied, 2);
  const entry = manifest.entries.find(x => x.path === 'pending/report.dmp');
  assert.equal(entry.sha256, hash(bytes));
  assert.deepEqual(fs.readFileSync(path.join(f.output, 'files/pending/report.dmp')), bytes);
  assert.equal(manifest.source.logSHA256, hash(Buffer.from(f.log)));
});

test('missing advertised store yields explicit unavailable evidence without a gate result', t => {
  const f = fixture(t);
  fs.rmdirSync(f.store);
  const { result, manifest } = f.run({ gate: 0 });
  assert.equal(result.status, 0);
  assert.equal(manifest.status, 'unavailable');
  assert.equal(manifest.gateExitCode, 0);
  assert.equal(manifest.filesCopied, 0);
});

test('skips files outside the current run window while accepting a fresh empty metadata file', t => {
  const f = fixture(t);
  const old = f.file('old.dmp');
  fs.utimesSync(old, new Date(1000), new Date(1000));
  const future = f.file('future.dmp');
  fs.utimesSync(future, new Date(Date.now() + 60000), new Date(Date.now() + 60000));
  f.file('settings.dat', '');
  const { manifest } = f.run();
  assert.equal(manifest.filesCopied, 1);
  assert.equal(manifest.entries.filter(x => x.reason === 'outside-current-run-time').length, 2);
  assert.equal(manifest.entries.find(x => x.path === 'settings.dat').sha256, hash(Buffer.alloc(0)));
});

test('does not follow file/directory symlinks, hardlinks or FIFOs', t => {
  const f = fixture(t);
  const secret = path.join(f.directory, 'outside');
  fs.writeFileSync(secret, 'outside sentinel');
  fs.symlinkSync(secret, path.join(f.store, 'file-link'));
  fs.symlinkSync(f.directory, path.join(f.store, 'directory-link'));
  fs.linkSync(secret, path.join(f.store, 'hard-link'));
  assert.equal(spawnSync('mkfifo', [path.join(f.store, 'pipe')]).status, 0);
  const { manifest } = f.run();
  assert.equal(manifest.filesCopied, 0);
  assert.equal(manifest.bytesRead, 0);
  assert.deepEqual(new Set(manifest.entries.map(x => x.reason)),
    new Set(['symlink', 'foreign-owner-or-hardlink', 'not-regular-file']));
  assert.equal(fs.readFileSync(secret, 'utf8'), 'outside sentinel');
});

test('rejects a symlink in the advertised store path', t => {
  const f = fixture(t);
  fs.rmdirSync(f.store);
  fs.symlinkSync(f.directory, f.store);
  const { manifest } = f.run();
  assert.equal(manifest.status, 'unavailable');
  assert.equal(manifest.filesCopied, 0);
});

test('refuses a symlinked log directory without writing through it', t => {
  const f = fixture(t);
  const outside = path.join(f.directory, 'outside-logs');
  fs.mkdirSync(outside);
  fs.rmSync(f.logs, { recursive: true });
  fs.symlinkSync(outside, f.logs);
  const { result, manifest } = f.run();
  assert.equal(result.status, 2);
  assert.equal(manifest, null);
  assert.deepEqual(fs.readdirSync(outside), []);
});

test('refuses a preexisting output directory or symlink', async t => {
  for (const symlink of [false, true]) {
    await t.test(symlink ? 'symlink' : 'directory', child => {
      const f = fixture(child);
      const outside = path.join(f.directory, 'outside-output');
      fs.mkdirSync(outside);
      if (symlink) fs.symlinkSync(outside, f.output);
      else fs.mkdirSync(f.output);
      const { result, manifest } = f.run();
      assert.equal(result.status, 2);
      assert.equal(manifest, null);
      assert.deepEqual(fs.readdirSync(outside), []);
    });
  }
});

test('rejects a mismatched PID, different path/version or ambiguous process marker', async t => {
  const changes = {
    pid: f => f.log.replace(`process: ${f.pid}`, `process: ${f.pid + 1}`),
    path: f => f.log.replace(f.store, '/tmp/unrelated-diagnostics'),
    version: f => f.log.replace(`version ${f.version}.0`, 'version 1.2.3.0'),
    longVersion: f => f.log.replace(`version ${f.version}.0`, `version 1.2.${'9'.repeat(10000)}.0`),
    duplicate: f => f.log + f.log.split('\n')[1] + '\n',
  };
  for (const [name, change] of Object.entries(changes)) {
    await t.test(name, child => {
      const f = fixture(child);
      f.file('report.dmp');
      fs.writeFileSync(path.join(f.logs, 'emulator.log'), change(f));
      const { manifest } = f.run();
      assert.equal(manifest.status, 'rejected');
      assert.equal(manifest.filesCopied, 0);
      assert.equal(manifest.bytesRead, 0);
      assert.ok(fs.statSync(path.join(f.output, 'manifest.json')).size < 16000);
    });
  }
});

test('requires current CI/QA/run identity and a plausible launch boundary', async t => {
  const cases = [
    { env: { CI: 'false' } }, { env: { EXPO_PUBLIC_APP_ENV: 'prod' } },
    { env: { GITHUB_RUN_ID: '' } }, { started: '1' },
    { started: String((BigInt(Date.now()) + 60000n) * 1000000n) },
  ];
  for (const [index, options] of cases.entries()) {
    await t.test(String(index), child => {
      const f = fixture(child);
      const { manifest } = f.run(options);
      assert.equal(manifest.status, 'rejected');
      assert.equal(manifest.filesCopied, 0);
    });
  }
});

test('rejects stale, symlinked and oversized emulator logs before reading a store', async t => {
  for (const kind of ['stale', 'symlink', 'oversized']) {
    await t.test(kind, child => {
      const f = fixture(child);
      const log = path.join(f.logs, 'emulator.log');
      if (kind === 'stale') fs.utimesSync(log, new Date(1000), new Date(1000));
      if (kind === 'oversized') fs.truncateSync(log, 1024 * 1024 + 1);
      if (kind === 'symlink') {
        const elsewhere = path.join(f.directory, 'elsewhere.log');
        fs.renameSync(log, elsewhere);
        fs.symlinkSync(elsewhere, log);
      }
      const { manifest } = f.run();
      assert.ok(['unavailable', 'rejected'].includes(manifest.status));
      assert.equal(manifest.filesCopied, 0);
    });
  }
});

test('per-file limit rejects an oversized sparse file without reading it', t => {
  const f = fixture(t);
  const file = f.file('oversized.dmp', '');
  fs.truncateSync(file, 16 * 1024 * 1024 + 1);
  const { manifest } = f.run();
  assert.equal(manifest.bytesRead, 0);
  assert.equal(manifest.filesCopied, 0);
  assert.ok(manifest.limitsHit.includes('fileBytes'));
  assert.equal(manifest.entries[0].reason, 'file-size-limit');
});

test('total bytes are bounded across multiple individually valid files', t => {
  const f = fixture(t);
  for (let i = 0; i < 3; i += 1) fs.truncateSync(f.file(`part-${i}.dmp`, ''), 16 * 1024 * 1024);
  const { manifest } = f.run();
  assert.equal(manifest.bytesRead, 32 * 1024 * 1024);
  assert.equal(manifest.bytesCopied, manifest.bytesRead);
  assert.equal(manifest.filesCopied, 2);
  assert.ok(manifest.limitsHit.includes('totalReadBytes'));
  assert.equal(manifest.entries.filter(x => x.reason === 'total-read-limit').length, 1);
});

test('entry and nesting bounds prevent unbounded enumeration', async t => {
  await t.test('entries', child => {
    const f = fixture(child);
    for (let i = 0; i < 140; i += 1) f.file(`empty-${i}`, '');
    const { manifest } = f.run();
    assert.equal(manifest.entriesExamined, 128);
    assert.ok(manifest.limitsHit.includes('entries'));
    assert.equal(manifest.filesCopied, 128);
  });
  await t.test('depth', child => {
    const f = fixture(child);
    f.file('a/b/c/d/e/f/g/report.dmp');
    const { manifest } = f.run();
    assert.equal(manifest.filesCopied, 0);
    assert.ok(manifest.limitsHit.includes('depth'));
    assert.ok(manifest.entries.some(x => x.reason === 'depth-limit-or-foreign-directory'));
  });
});

test('a real source mutation during read discards the partial copy and consumes its read budget', t => {
  const f = fixture(t);
  const file = f.file('changing.dmp', Buffer.alloc(1024 * 1024, 0x53));
  const script = `import importlib.util,os,sys\nspec=importlib.util.spec_from_file_location('collector',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)\ntarget=sys.argv[2];inode=os.stat(target).st_ino;original=os.read;changed=False\ndef mutate(fd,count):\n global changed\n data=original(fd,count)\n if os.fstat(fd).st_ino==inode and not changed:\n  changed=True\n  with open(target,'ab') as out:out.write(b'X')\n return data\nm.os.read=mutate\nraise SystemExit(m.main(sys.argv[3:]))\n`;
  const result = spawnSync('python3', ['-c', script, helper, file, '--pid', String(f.pid),
    '--started-ns', f.started, '--gate-exit', '1'], { cwd: f.directory, env: f.environment, encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(fs.readFileSync(path.join(f.output, 'manifest.json')));
  assert.equal(manifest.filesCopied, 0);
  assert.equal(manifest.bytesRead, 1024 * 1024);
  assert.equal(manifest.entries[0].reason, 'copy-incomplete-or-changed');
  assert.deepEqual(fs.readdirSync(path.join(f.output, 'files')), []);
});

test('actual prelaunch diagnostics remain best effort when the CLI or metadata output fails', async t => {
  const setup = runner.match(/emulator_version_status=0\n[\s\S]*?(?=\nemulator_started_ns=)/)[0];
  for (const unavailableOutput of [false, true]) {
    await t.test(unavailableOutput ? 'metadata output unavailable' : 'CLI failures retained', child => {
      const f = fixture(child);
      const sdk = path.join(f.directory, 'sdk');
      fs.mkdirSync(path.join(sdk, 'emulator'), { recursive: true });
      fs.writeFileSync(path.join(sdk, 'emulator/emulator'),
        '#!/bin/sh\nprintf \'%s\\n\' "$@" >> "$CLI_CALLS"\nexit 77\n', { mode: 0o755 });
      const calls = path.join(f.directory, 'cli-calls.txt');
      const metadata = path.join(f.logs, 'emulator-cli-metadata.json');
      if (unavailableOutput) fs.mkdirSync(metadata);
      const script = `set -euo pipefail\nandroid_sdk="$FAKE_SDK"\n${setup}\nprintf reached > diagnostic-continuation.txt\n`;
      const result = spawnSync('bash', ['-c', script], { cwd: f.directory,
        env: { ...f.environment, FAKE_SDK: sdk, CLI_CALLS: calls }, encoding: 'utf8', timeout: 5000 });
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(fs.readFileSync(calls, 'utf8').trim().split('\n'), ['-version', '-help-gpu']);
      assert.equal(fs.readFileSync(path.join(f.directory, 'diagnostic-continuation.txt'), 'utf8'), 'reached');
      if (!unavailableOutput) assert.deepEqual(JSON.parse(fs.readFileSync(metadata)),
        { versionExitCode: 77, gpuHelpExitCode: 77 });
    });
  }
});

test('the actual runner cleanup preserves success and failure when diagnostic collection fails', async t => {
  const cleanup = runner.match(/cleanup\(\) \{[\s\S]*?\n\}\ntrap cleanup EXIT/)[0];
  for (const gate of [0, 7]) {
    await t.test(`gate ${gate}`, child => {
      const f = fixture(child);
      const bin = path.join(f.directory, 'bin');
      fs.mkdirSync(bin);
      const adb = path.join(bin, 'adb');
      const python = path.join(bin, 'python3');
      fs.writeFileSync(adb, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
      fs.writeFileSync(python, '#!/bin/sh\nprintf \'%s\\n\' "$@" > "$DIAGNOSTIC_ARGS"\nexit 77\n', { mode: 0o755 });
      const work = path.join(f.directory, 'work');
      fs.mkdirSync(work);
      const argsPath = path.join(f.directory, 'diagnostic-args.txt');
      const script = `set -euo pipefail\nadb_bin="$FAKE_ADB"\nwork_dir="$FAKE_WORK"\nemulator_pid=''\nemulator_started_ns="$FAKE_STARTED"\nlog_pid=''\nvideo_pid=''\n${cleanup}\nsleep 30 &\nemulator_pid=$!\nexit ${gate}\n`;
      const result = spawnSync('bash', ['-c', script], { cwd: f.directory,
        env: { ...f.environment, PATH: bin + path.delimiter + process.env.PATH,
          FAKE_ADB: adb, FAKE_WORK: work, FAKE_STARTED: f.started, DIAGNOSTIC_ARGS: argsPath },
        encoding: 'utf8', timeout: 5000 });
      assert.equal(result.status, gate, result.stderr);
      const args = fs.readFileSync(argsPath, 'utf8').trim().split('\n');
      assert.equal(args[0], 'scripts/quality/native-ui-emulator-diagnostics.py');
      assert.equal(args[args.indexOf('--gate-exit') + 1], String(gate));
      assert.equal(args[args.indexOf('--started-ns') + 1], f.started);
      assert.equal(fs.existsSync(work), false);
    });
  }
});
