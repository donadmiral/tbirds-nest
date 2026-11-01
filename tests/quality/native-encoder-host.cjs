const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const YAML = require('yaml');
const root = path.resolve(__dirname, '../..');

function setup(scenario) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'encoder-host-check-'));
  const bin = path.join(temp, 'bin'); fs.mkdirSync(bin);
  const commands = {
    dpkg: "printf '%s\\n' amd64",
    'dpkg-query': `if [[ "$*" == *'db:Status-Status'* ]]; then
      [[ -f "$HOST_CHECK/installed" ]] || exit 1
      printf '%s' installed
    else printf '%s\\n' 'libpulse0:amd64 controlled-version'; fi`,
    python3: `printf '%s\\n' load >> "$HOST_CHECK/calls"
      [[ -f "$HOST_CHECK/installed" && "$HOST_SCENARIO" != broken-library ]]`,
    sudo: 'exec "$@"',
    'apt-get': `printf '%s\\n' "$*" >> "$HOST_CHECK/calls"
      [[ "$HOST_SCENARIO" != failed-download ]] || exit 100
      if [[ " $* " == *' install '* ]]; then touch "$HOST_CHECK/installed"; fi`,
  };
  for (const [name, body] of Object.entries(commands)) fs.writeFileSync(path.join(bin, name), '#!/bin/bash\nset -eu\n' + body + '\n', { mode: 0o755 });
  if (scenario === 'installed') fs.writeFileSync(path.join(temp, 'installed'), '');
  const result = spawnSync('bash', ['scripts/quality/install-android-encoder-host.sh'], {
    cwd: root, encoding: 'utf8', timeout: 10000,
    env: { ...process.env, CI: scenario === 'outside-ci' ? 'false' : 'true', PATH: bin + path.delimiter + process.env.PATH,
      RUNNER_TEMP: temp, HOST_CHECK: temp, HOST_SCENARIO: scenario },
  });
  const calls = fs.existsSync(path.join(temp, 'calls')) ? fs.readFileSync(path.join(temp, 'calls'), 'utf8') : '';
  const leftover = fs.readdirSync(temp).filter(name => name.startsWith('platinum-encoder-host.'));
  fs.rmSync(temp, { recursive: true, force: true });
  return { ...result, calls, leftover };
}

test('an already installed loadable host library avoids all repository work', () => {
  const result = setup('installed');
  assert.equal(result.status, 0, result.stderr); assert.equal(result.calls, 'load\n');
});
test('a missing library requires bounded official installation and a final loader check', () => {
  const result = setup('missing');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.calls, /Acquire::Retries=1.*Acquire::http::Timeout=20.*Acquire::https::Timeout=20.*update --error-on=any/);
  assert.match(result.calls, /install --yes --no-install-recommends libpulse0:amd64\nload\n$/);
  assert.deepEqual(result.leftover, []);
});
test('a failed package download cannot reach native encoder acceptance', () => {
  const result = setup('failed-download');
  assert.equal(result.status, 100); assert.doesNotMatch(result.calls, / install /); assert.deepEqual(result.leftover, []);
});
test('package installation without a loadable library remains a failed prerequisite', () => {
  const result = setup('broken-library');
  assert.notEqual(result.status, 0); assert.match(result.calls, /install.*\nload\n$/); assert.deepEqual(result.leftover, []);
});
test('host package setup refuses execution outside disposable CI', () => {
  const result = setup('outside-ci'); assert.equal(result.status, 2); assert.equal(result.calls, '');
});
test('workflow hard-bounds only host setup and retains the complete actual emulator gate', () => {
  const workflow = YAML.parse(fs.readFileSync(path.join(root, '.github/workflows/android-native-compile.yml'), 'utf8'));
  const job = workflow.jobs['android-story-export'];
  const setup = job.steps.find(step => step.name === 'Install the emulator host audio library');
  assert.equal(setup['timeout-minutes'], 6);
  assert.match(setup.run, /timeout --signal=TERM --kill-after=10s 300s bash scripts\/quality\/install-android-encoder-host.sh/);
  assert.match(setup.run, /tee android-story-export-logs\/host-dependencies.log/);
  assert.equal(job.steps.find(step => step.name === 'Exercise the actual story and memory encoders in an isolated emulator').run, 'bash scripts/quality/test-android-story-audio.sh');
  assert.equal(job.steps.at(-1).if, 'always()');
  const script = fs.readFileSync(path.join(root, 'scripts/quality/install-android-encoder-host.sh'), 'utf8');
  assert.doesNotMatch(script, /allow-unauthenticated|trusted=yes|AllowInsecure|azure\.archive\.ubuntu\.com/);
  assert.equal((script.match(/signed-by=\/usr\/share\/keyrings\/ubuntu-archive-keyring.gpg/g) || []).length, 3);
});
