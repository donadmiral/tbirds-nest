const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const helper = path.join(root, 'scripts/quality/native-ui-emulator-graphics.py');
const runner = fs.readFileSync(path.join(root, 'scripts/quality/test-android-app-ui.sh'), 'utf8');
const host = 'OpenGL vendor string: Mesa/X.org\nOpenGL renderer string: llvmpipe (LLVM 20.1.2, 256 bits)\n';
const emulator = 'INFO | emuglConfig_init: vulkan_mode_selected:host gles_mode_selected:host\n'
  + 'INFO | Graphics Adapter Vendor Mesa/X.org\n'
  + 'INFO | Graphics Adapter Android Emulator OpenGL ES Translator (llvmpipe (LLVM 20.1.2, 256 bits))\n'
  + 'INFO | Graphics API Version OpenGL ES 3.2 (4.5 (Core Profile) Mesa 25.0.7)\n';

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'native-graphics-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const logs = path.join(directory, 'native-ui-logs');
  fs.mkdirSync(logs);
  fs.writeFileSync(path.join(logs, 'host-graphics.log'), host);
  fs.writeFileSync(path.join(logs, 'emulator.log'), emulator);
  return { directory, logs,
    run(phase = 'emulator') {
      const result = spawnSync('python3', [helper, phase], { cwd: directory, encoding: 'utf8', timeout: 5000 });
      assert.equal(result.error, undefined);
      const receipt = JSON.parse(fs.readFileSync(path.join(logs, phase === 'host' ? 'host-graphics.json' : 'emulator-graphics.json')));
      return { ...result, receipt };
    },
    replace(name, value) { fs.writeFileSync(path.join(logs, name), value); },
  };
}

test('graphics verification requires both the host and emulator LLVMpipe contexts', t => {
  const f = fixture(t);
  const preflight = f.run('host');
  assert.equal(preflight.status, 0, preflight.stderr);
  assert.equal(preflight.receipt.passed, true);
  assert.equal(preflight.receipt.inputs.length, 1);
  const actual = f.run();
  assert.equal(actual.status, 0, actual.stderr);
  assert.equal(actual.receipt.passed, true);
  assert.equal(actual.receipt.inputs.length, 2);
  assert.equal(actual.receipt.emulator.selectedGlesMode, 'host');
  assert.match(actual.receipt.emulator.renderer, /llvmpipe/);
  assert.equal(actual.receipt.requested.guestVulkan, false);
});

for (const [name, file, value] of [
  ['the actual b5 SwiftShader GLES signature', 'emulator.log', emulator.replace('gles_mode_selected:host', 'gles_mode_selected:swiftshader').replace('Mesa/X.org', 'Google (Google Inc.)').replace(/llvmpipe \(LLVM 20.1.2, 256 bits\)/g, 'Google SwiftShader').replace('3.2 (4.5 (Core Profile) Mesa 25.0.7)', '3.0 (OpenGL ES 3.0 SwiftShader 4.0.0.1)')],
  ['a hardware host renderer', 'host-graphics.log', host.replace('llvmpipe', 'NVIDIA')],
  ['a missing host vendor', 'host-graphics.log', host.split('\n').slice(1).join('\n')],
  ['an empty host renderer followed by unrelated LLVMpipe text', 'host-graphics.log', host.replace('OpenGL renderer string: ', 'OpenGL renderer string:\n')],
  ['an empty host vendor followed by unrelated Mesa text', 'host-graphics.log', host.replace('OpenGL vendor string: ', 'OpenGL vendor string:\n')],
  ['an ambiguous host renderer', 'host-graphics.log', host + 'OpenGL renderer string: llvmpipe (other)\n'],
  ['SwiftShader disguised by a llvmpipe substring', 'host-graphics.log', host.replace('llvmpipe', 'llvmpipe SwiftShader')],
  ['missing emulator mode evidence', 'emulator.log', emulator.split('\n').slice(1).join('\n')],
  ['a mode field continued on another line', 'emulator.log', emulator.replace('host gles_mode_selected:', 'host\ngles_mode_selected:')],
  ['an empty emulator vendor followed by unrelated Mesa text', 'emulator.log', emulator.replace('Graphics Adapter Vendor ', 'Graphics Adapter Vendor\n')],
  ['an empty emulator version followed by unrelated GLES text', 'emulator.log', emulator.replace('Graphics API Version ', 'Graphics API Version\n')],
  ['a later automatic mode fallback', 'emulator.log', emulator + 'INFO | emuglConfig_init: vulkan_mode_selected:swiftshader gles_mode_selected:swiftshader\n'],
  ['a non-LLVMpipe emulator context despite a good host probe', 'emulator.log', emulator.replace('llvmpipe', 'Google SwiftShader')],
  ['an ambiguous emulator renderer', 'emulator.log', emulator + 'INFO | Graphics Adapter llvmpipe (second)\n'],
  ['GLES below the existing 3.0 context', 'emulator.log', emulator.replace('OpenGL ES 3.2', 'OpenGL ES 2.0')],
  ['a SwiftShader GLES version', 'emulator.log', emulator.replace('Mesa 25.0.7', 'SwiftShader 4.0.0.1')],
  ['an empty log', 'emulator.log', ''],
  ['an oversized log', 'emulator.log', emulator + 'x'.repeat(1024 * 1024)],
]) {
  test(`graphics verification rejects ${name}`, t => {
    const f = fixture(t);
    f.replace(file, value);
    const result = f.run();
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.receipt.passed, false);
    assert.equal(typeof result.receipt.failure, 'string');
  });
}

test('graphics verification rejects a symlinked log instead of reading another file', t => {
  const f = fixture(t);
  const target = path.join(f.directory, 'outside.log');
  fs.writeFileSync(target, emulator);
  fs.unlinkSync(path.join(f.logs, 'emulator.log'));
  fs.symlinkSync(target, path.join(f.logs, 'emulator.log'));
  const result = f.run();
  assert.equal(result.status, 1);
  assert.equal(result.receipt.passed, false);
});

test('an appended live log retains a verifiable prefix', t => {
  const f = fixture(t);
  const script = `import importlib.util,json,os\nspec=importlib.util.spec_from_file_location('graphics',${JSON.stringify(helper)})\nm=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)\noriginal=os.fstat\ncalls=0\ndef changing(fd):\n global calls\n calls+=1\n if calls==2:\n  with open('native-ui-logs/emulator.log','a') as out:out.write('INFO | unrelated later append\\n')\n return original(fd)\nm.os.fstat=changing\ntext,meta=m.read_log('emulator.log')\nprint(json.dumps({'renderer':m.emulator_fields(text),'meta':meta}))\n`;
  const result = spawnSync('python3', ['-c', script], { cwd: f.directory, encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 0, result.stderr);
  const value = JSON.parse(result.stdout);
  assert.equal(value.meta.bytes, Buffer.byteLength(emulator));
  assert.ok(value.meta.sizeAfterRead > value.meta.bytes);
  assert.match(value.renderer.renderer, /llvmpipe/);
});

test('graphics verification replaces an earlier success with a failed receipt', t => {
  const f = fixture(t);
  assert.equal(f.run().status, 0);
  fs.unlinkSync(path.join(f.logs, 'emulator.log'));
  assert.equal(f.run().status, 1);
  const saved = JSON.parse(fs.readFileSync(path.join(f.logs, 'emulator-graphics.json')));
  assert.equal(saved.passed, false);
});

test('Xvfb teardown remains bounded and preserves the original acceptance status', async t => {
  const cleanup = runner.slice(runner.indexOf('cleanup() {'), runner.indexOf('trap cleanup EXIT'));
  for (const gate of [0, 23]) {
    await t.test(`original exit ${gate}`, t => {
      const f = fixture(t);
      const work = path.join(f.directory, 'work');
      fs.mkdirSync(work);
      const script = `set -euo pipefail\nwork_dir="$FAKE_WORK"\nemulator_pid=''\nlog_pid=''\nvideo_pid=''\nxvfb_pid=''\n${cleanup}\ntrap cleanup EXIT\nbash -c 'trap "" TERM; exec sleep 30' &\nxvfb_pid=$!\nsleep 0.1\nexit ${gate}\n`;
      const started = Date.now();
      const result = spawnSync('bash', ['-c', script], { cwd: f.directory,
        env: { ...process.env, FAKE_WORK: work }, encoding: 'utf8', timeout: 5000 });
      assert.equal(result.error, undefined);
      assert.equal(result.status, gate, result.stderr);
      assert.ok(Date.now() - started < 4500);
      assert.equal(fs.existsSync(work), false);
    });
  }
});
