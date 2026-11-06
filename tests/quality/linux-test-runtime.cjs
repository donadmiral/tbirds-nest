const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const YAML = require('yaml');
const root = path.resolve(__dirname, '../..');
const installer = path.join(root, 'scripts/quality/install-linux-test-runtime.sh');

function run(scenario, mode = 'media') {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'linux-runtime-check-'));
  const bin = path.join(temp, 'bin');
  fs.mkdirSync(bin);
  const cli = path.join(temp, 'playwright-cli.js');
  fs.writeFileSync(cli, '// Controlled CLI entry point for package setup only.\n');
  const commands = {
    uname: 'if [[ "$RUNTIME_SCENARIO" == darwin ]]; then printf "%s\\n" Darwin; else /usr/bin/uname "$@"; fi',
    dpkg: "printf '%s\\n' amd64",
    ffmpeg: 'printf "%s\\n" ffmpeg-check >> "$RUNTIME_CHECK/calls"; test -f "$RUNTIME_CHECK/media-ready"',
    ffprobe: 'printf "%s\\n" ffprobe-check >> "$RUNTIME_CHECK/calls"; test -f "$RUNTIME_CHECK/media-ready"; test "$RUNTIME_SCENARIO" != broken-media',
    unzip: 'printf "%s\\n" unzip-check >> "$RUNTIME_CHECK/calls"; test -f "$RUNTIME_CHECK/unzip-ready"',
    sudo: 'exec "$@"',
    'apt-get': `
      printf 'apt %s\\n' "$*" >> "$RUNTIME_CHECK/calls"
      test -n "$APT_CONFIG"
      cp "$APT_CONFIG" "$RUNTIME_CHECK/config"
      runtime_list="$(sed -n 's/^Dir::Etc::sourcelist "\\(.*\\)";$/\\1/p' "$APT_CONFIG")"
      cp "$runtime_list" "$RUNTIME_CHECK/sources"
      test "$RUNTIME_SCENARIO" != failed-download || exit 100
      if [[ " $* " == *' install '* ]]; then
        if [[ " $* " == *' ffmpeg:amd64 '* ]]; then touch "$RUNTIME_CHECK/media-ready"; fi
        if [[ " $* " == *' unzip:amd64 '* ]]; then touch "$RUNTIME_CHECK/unzip-ready"; fi
      fi`,
    node: `
      printf 'playwright %s\\n' "$*" >> "$RUNTIME_CHECK/calls"
      test "$1" = "$RUNTIME_CHECK/playwright-cli.js"
      test "$2" = install-deps && test "$3" = chromium
      test -n "$APT_CONFIG"
      test "$RUNTIME_SCENARIO" != failed-browser-deps || exit 101
      apt-get update
      apt-get install --yes --no-install-recommends controlled-complete-chromium-dependencies`,
  };
  for (const [name, body] of Object.entries(commands)) {
    fs.writeFileSync(path.join(bin, name), '#!/bin/bash\nset -eu\n' + body + '\n', { mode: 0o755 });
  }
  if (scenario === 'installed') {
    fs.writeFileSync(path.join(temp, 'media-ready'), '');
    fs.writeFileSync(path.join(temp, 'unzip-ready'), '');
  }
  const args = [installer, mode];
  if (mode !== 'media') args.push(cli);
  const result = spawnSync('bash', args, {
    cwd: root, encoding: 'utf8', timeout: 10000,
    env: { ...process.env, CI: scenario === 'outside-ci' ? 'false' : 'true',
      PATH: bin + path.delimiter + process.env.PATH, RUNNER_TEMP: temp,
      RUNTIME_CHECK: temp, RUNTIME_SCENARIO: scenario },
  });
  const read = name => fs.existsSync(path.join(temp, name)) ? fs.readFileSync(path.join(temp, name), 'utf8') : '';
  const evidence = { calls: read('calls'), config: read('config'), sources: read('sources'),
    leftover: fs.readdirSync(temp).filter(name => name.startsWith('platinum-linux-test.')) };
  fs.rmSync(temp, { recursive: true, force: true });
  return { ...result, ...evidence };
}

test('working ffmpeg and ffprobe avoid all package repository access', () => {
  const result = run('installed');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.calls, 'ffmpeg-check\nffprobe-check\n');
  assert.equal(result.config, '');
});

test('missing media uses signed official archives and verifies both final binaries', () => {
  const result = run('missing');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.calls, /apt update --error-on=any/);
  assert.match(result.calls, /apt install --yes --no-install-recommends ffmpeg:amd64/);
  assert.match(result.calls, /ffmpeg-check\nffprobe-check\n$/);
  assert.match(result.config, /Acquire::Retries "1"/);
  assert.match(result.config, /Acquire::http::Timeout "20"/);
  assert.match(result.config, /Acquire::https::Timeout "20"/);
  assert.match(result.config, /APT::Update::Error-Mode "any"/);
  assert.match(result.config, /Dir::Etc::sourceparts "-"/);
  assert.equal((result.sources.match(/signed-by=\/usr\/share\/keyrings\/ubuntu-archive-keyring.gpg/g) || []).length, 3);
  assert.match(result.sources, /https:\/\/archive\.ubuntu\.com\/ubuntu noble main restricted universe multiverse/);
  assert.match(result.sources, /https:\/\/archive\.ubuntu\.com\/ubuntu noble-updates/);
  assert.match(result.sources, /https:\/\/security\.ubuntu\.com\/ubuntu noble-security/);
  assert.doesNotMatch(result.sources + result.config, /azure\.archive|trusted=yes|allow-unauthenticated|AllowInsecure/);
  assert.deepEqual(result.leftover, []);
});

test('failed package download stops setup and removes its temporary sources', () => {
  const result = run('failed-download');
  assert.equal(result.status, 100);
  assert.doesNotMatch(result.calls, /apt install|playwright/);
  assert.deepEqual(result.leftover, []);
});

test('a still-broken binary after installation remains a failed prerequisite', () => {
  const result = run('broken-media');
  assert.notEqual(result.status, 0);
  assert.match(result.calls, /apt install.*\nffmpeg-check\nffprobe-check\n$/);
  assert.deepEqual(result.leftover, []);
});

test('browser-only setup preserves the complete CLI dependency install and inherited apt configuration', () => {
  const result = run('missing', 'browser');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.calls, /playwright \/.*\/playwright-cli\.js install-deps chromium/);
  assert.match(result.calls, /apt install --yes --no-install-recommends controlled-complete-chromium-dependencies/);
  assert.match(result.calls, /apt install --yes --no-install-recommends unzip:amd64/);
  assert.doesNotMatch(result.calls, /ffmpeg/);
  assert.match(result.config, /APT::Update::Error-Mode "any"/);
  assert.deepEqual(result.leftover, []);
});

test('combined browser and media setup verifies every required runtime', () => {
  const result = run('missing', 'browser-media');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.calls, /apt install --yes --no-install-recommends ffmpeg:amd64 unzip:amd64/);
  assert.match(result.calls, /playwright \/.* install-deps chromium/);
  assert.match(result.calls, /unzip-check\nffmpeg-check\nffprobe-check\n$/);
  assert.deepEqual(result.leftover, []);
});

test('Playwright dependency failure cannot become a successful browser prerequisite', () => {
  const result = run('failed-browser-deps', 'browser');
  assert.equal(result.status, 101);
  assert.deepEqual(result.leftover, []);
});

test('package setup refuses execution outside disposable CI', () => {
  const result = run('outside-ci');
  assert.equal(result.status, 2);
  assert.equal(result.calls, '');
});

test('the Ubuntu package installer refuses a Darwin runner before touching packages', () => {
  const result = run('darwin');
  assert.equal(result.status, 2);
  assert.equal(result.calls, '');
});

test('workflows bound package setup and retain full browser and media acceptance', () => {
  const workflow = name => YAML.parse(fs.readFileSync(path.join(root, '.github/workflows', name), 'utf8'));
  const release = workflow('live-release-acceptance.yml');
  const baseline = release.jobs['browser-baseline'];
  const connected = release.jobs['connected-host-viewer'];
  const bound = /timeout --signal=TERM --kill-after=10s 300s bash scripts\/quality\/install-linux-test-runtime\.sh/;
  for (const job of [baseline, connected]) {
    assert.equal(job['timeout-minutes'], 15);
    const setup = job.steps.find(step => step.name?.startsWith('Install ') && step.run?.includes('install-linux-test-runtime'));
    assert.match(setup.run, bound);
    assert.match(setup.run, /bash scripts\/quality\/install-browser-test-runtime\.sh/);
  }
  assert.match(baseline.steps.find(step => step.name === 'Install browser and media runtime').run, /browser-media web\/node_modules\/playwright\/cli\.js/);
  assert.match(connected.steps.find(step => step.name === 'Install verified browser runtime').run, /\.sh browser web\/node_modules\/playwright\/cli\.js/);
  assert.match(connected.steps.find(step => step.name === 'Real QA host, follower, outsider and streaming provider acceptance').run, /live-connected-run\.cjs/);
  const browser = workflow('browser-quality.yml');
  const browserSetup = Object.values(browser.jobs).flatMap(job => job.steps || []).find(step => step.id === 'browser_tools');
  assert.match(browserSetup.run, bound);
  assert.match(browserSetup.run, /browser-media web\/node_modules\/playwright\/cli\.js/);
  const typecheck = workflow('typecheck.yml');
  const media = Object.values(typecheck.jobs).flatMap(job => job.steps || []).filter(step => step.run?.includes('install-linux-test-runtime.sh media'));
  assert.equal(media.length, 2);
  for (const step of media) assert.match(step.run, bound);
  assert.match(media.find(step => step.name === 'Test adaptive media processing').run, /node --test workers\/media-renditions\/test\/\*\.test\.mjs/);
});
