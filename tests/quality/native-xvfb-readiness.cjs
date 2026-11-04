'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const root = path.resolve(__dirname, '../..');
const helper = path.join(root, 'scripts/quality/native-ui-xvfb-readiness.py');
const runner = fs.readFileSync(path.join(root, 'scripts/quality/test-android-app-ui.sh'), 'utf8');
const load = `import importlib.util,json,os,pathlib,tempfile,sys\nsys.dont_write_bytecode=True\nspec=importlib.util.spec_from_file_location('ready',${JSON.stringify(helper)})\nm=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)\n`;
function python(body, cwd = root) {
  const result = spawnSync('python3', ['-c', load + body], { cwd, encoding: 'utf8', timeout: 5000 });
  assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
function scenario(expression, alive = 'True') {
  return python(`now=[0.0]\nsleeps=[]\ndef sleep(seconds):\n sleeps.append(seconds);now[0]+=seconds\ndef read(path):return ${expression}\ndef alive(pid):return ${alive}\nr=m.wait_for_display(123,pathlib.Path('synthetic-display'),clock=lambda:now[0],sleep=sleep,alive=alive,read=read)\nprint(json.dumps({'receipt':r,'sleeps':sleeps}))\n`);
}

test('the same process can publish its display after the previous five-second limit', () => {
  const r = scenario("('valid','7') if now[0]>=12 else ('empty',None)");
  assert.equal(r.receipt.outcome, 'ready'); assert.equal(r.receipt.displayNumber, '7');
  assert.ok(r.receipt.elapsedMs >= 12000 && r.receipt.elapsedMs < 12200);
  assert.ok(r.sleeps.every(value => value > 0 && value <= .1));
});

test('a partial numeric write waits for its newline instead of passing or failing early', () => {
  const r = scenario("('valid','12') if now[0]>=.3 else ('incomplete',None)");
  assert.equal(r.receipt.outcome, 'ready'); assert.ok(r.receipt.elapsedMs >= 300);
  assert.equal(r.receipt.displayLineState, 'valid');
});

test('actual process exit fails immediately even if a stale valid display line exists', () => {
  const r = scenario("('valid','4')", 'False');
  assert.equal(r.receipt.outcome, 'process-exited'); assert.equal(r.receipt.processAlive, false);
  assert.equal(r.receipt.elapsedMs, 0); assert.deepEqual(r.sleeps, []);
  assert.equal(r.receipt.displayNumber, null);
});

test('process death while waiting fails before the setup deadline', () => {
  const r = scenario("('empty',None)", 'now[0] < .2');
  assert.equal(r.receipt.outcome, 'process-exited'); assert.equal(r.receipt.elapsedMs, 200);
});

for (const state of ['invalid', 'invalid-file', 'oversized']) test(state + ' fails without waiting or echoing a value', () => {
  const r = scenario(`('${state}',None)`);
  assert.equal(r.receipt.outcome, 'invalid-display-line'); assert.deepEqual(r.sleeps, []);
  assert.equal(r.receipt.displayLineState, state); assert.equal(r.receipt.displayNumber, null);
});

for (const state of ['missing', 'empty', 'incomplete']) test(state + ' times out with explicit retained state at thirty seconds', () => {
  const r = scenario(`('${state}',None)`);
  assert.equal(r.receipt.outcome, 'timeout'); assert.equal(r.receipt.elapsedMs, 30000);
  assert.equal(r.receipt.budgetMs, 30000); assert.equal(r.receipt.displayLineState, state);
  assert.equal(r.receipt.processAlive, true); assert.equal(r.receipt.displayNumber, null);
});

test('the actual line reader accepts one complete ASCII numeric line and rejects malformed complete input', () => {
  const results = python(`values=[b'',b'12',b'12\\n',b'0\\n',b'12\\r\\n',b'private-value\\n',b'2\\n3\\n',b'9'*65]\nout=[]\nwith tempfile.TemporaryDirectory() as directory:\n p=pathlib.Path(directory)/'display'\n for value in values:\n  p.write_bytes(value);out.append(m.display_line(p))\n p.unlink();out.append(m.display_line(p))\n target=pathlib.Path(directory)/'private';target.write_bytes(b'7\\n');p.symlink_to(target)\n try:m.display_line(p);out.append(['symlink-read',None])\n except OSError:out.append(['symlink-rejected',None])\nprint(json.dumps(out))\n`);
  assert.deepEqual(results, [['empty', null], ['incomplete', null], ['valid', '12'], ['valid', '0'],
    ['invalid', null], ['invalid', null], ['invalid', null], ['oversized', null], ['missing', null], ['symlink-rejected', null]]);
});

test('native process observation identifies a live process and a reaped child', () => {
  const result = python(`import subprocess\nlive=m.process_alive(os.getpid())\nchild=subprocess.Popen(['true']);child.wait()\nprint(json.dumps({'live':live,'exited':m.process_alive(child.pid)}))\n`);
  assert.deepEqual(result, { live: true, exited: false });
});

test('the command retains failure evidence before returning the original setup failure status', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'xvfb-readiness-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const display = path.join(directory, 'display'); fs.writeFileSync(display, 'private-value\n');
  const result = spawnSync('python3', [helper, '--pid', String(process.pid), '--display-file', display],
    { cwd: directory, encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 1); assert.equal(result.stdout, '');
  const value = JSON.parse(fs.readFileSync(path.join(directory, 'native-ui-logs/xvfb-readiness.json')));
  assert.equal(value.outcome, 'invalid-display-line'); assert.equal(value.displayLineState, 'invalid');
  assert.equal(JSON.stringify(value).includes('private-value'), false);
  assert.equal(result.stderr.includes('private-value'), false);
});

test('the command retains readiness before returning the same numeric display to the caller', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'xvfb-readiness-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const display = path.join(directory, 'display'); fs.writeFileSync(display, '8\n');
  const result = spawnSync('python3', [helper, '--pid', String(process.pid), '--display-file', display],
    { cwd: directory, encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 0); assert.equal(result.stdout, '8\n');
  const value = JSON.parse(fs.readFileSync(path.join(directory, 'native-ui-logs/xvfb-readiness.json')));
  assert.equal(value.outcome, 'ready'); assert.equal(value.processAlive, true);
  assert.equal(value.displayNumber, '8');
});

test('the runner retains one Xvfb launch, graphics checks and cleanup with the explicit media platform argument', () => {
  // Exact unchanged regions from reviewed source 7ac01587bbda9b23ae23b471c237b78d5d1c0f36.
  // Hashes also work in CI's depth-one checkout without fetching parent history.
  const sha = value => crypto.createHash('sha256').update(value).digest('hex');
  const start = value => value.indexOf('xvfb_pid=$!\n') + 'xvfb_pid=$!\n'.length;
  const end = value => value.indexOf('native_ui_display=":$native_ui_display_number"');
  const media = 'python3 scripts/quality/verify-native-ui-memory.py';
  const platformCommand = media + ' native-ui-logs/memory-capture android || memory_status=$?';
  assert.equal(runner.split(platformCommand).length, 2);
  // Only this reviewed verifier argument is normalized before checking the
  // original suffix. Every launch, graphics, cleanup and acceptance line stays bound.
  const normalized = runner.replace(platformCommand, media + ' || memory_status=$?');
  assert.equal(sha(runner.slice(0, start(runner))), 'ca53a9997527b345e73354c674a91226a534ef0a679879fed22106a07c7615ab');
  assert.equal(sha(normalized.slice(end(normalized))), '90a28d372c520bb8c50d6ec1660d3aaf2367e4ccd5df98dccffd5a4fd3430813');
  assert.equal((runner.match(/Xvfb -displayfd/g) || []).length, 1);
  assert.equal((runner.match(/python3 scripts\/quality\/native-ui-xvfb-readiness.py/g) || []).length, 1);
  assert.ok(runner.indexOf('native-ui-xvfb-readiness.py') < runner.indexOf('timeout 10 glxinfo -B'));
});
