const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '../..');
const complete = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://synthetic-backend.example.invalid',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'synthetic-public-key-never-log',
  SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-secret-never-log',
};

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'platinum-build-env-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function run(app, cwd, config = {}, npmBuild = false) {
  const env = { PATH: process.env.PATH, NODE_ENV: 'production', ...config };
  const result = npmBuild
    ? spawnSync('npm', ['--prefix', path.join(root, app), 'run', 'build'], { cwd, env, encoding: 'utf8' })
    : spawnSync(process.execPath, [path.join(root, app, 'scripts/check-build-env.cjs')], { cwd, env, encoding: 'utf8' });
  assert.equal(result.error, undefined);
  const output = result.stdout + result.stderr;
  // Include supplied invalid inputs: errors must never echo configuration values.
  for (const value of [...Object.values(complete), ...Object.values(config)]) {
    if (value.trim()) assert.ok(!output.includes(value), 'Configuration value leaked to output');
  }
  return { status: result.status, output };
}

for (const app of ['web', 'admin-web']) {
  const required = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'];
  if (app === 'admin-web') required.push('SUPABASE_SERVICE_ROLE_KEY');

  test(`${app}: missing configuration identifies every required name`, (t) => {
    const result = run(app, fixture(t));
    assert.equal(result.status, 1);
    for (const name of required) assert.ok(result.output.includes(name));
  });

  test(`${app}: partial and whitespace-only configuration fails without logging values`, (t) => {
    const dir = fixture(t);
    for (const name of required) {
      const result = run(app, dir, { ...complete, [name]: '  ' });
      assert.equal(result.status, 1);
      assert.ok(result.output.includes('missing required environment variables: ' + name));
      for (const other of required.filter((candidate) => candidate !== name)) {
        assert.ok(!result.output.includes(other));
      }
    }
  });

  test(`${app}: complete synthetic configuration passes without authenticating or logging keys`, (t) => {
    const result = run(app, fixture(t), complete);
    assert.equal(result.status, 0);
    assert.match(result.output, /required variables are present/);
  });

  test(`${app}: local HTTP backend URLs remain supported`, (t) => {
    const result = run(app, fixture(t), { ...complete, NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321' });
    assert.equal(result.status, 0);
  });

  test(`${app}: malformed and non-HTTP URLs fail with the variable name only`, (t) => {
    const dir = fixture(t);
    for (const url of ['private-invalid-url-marker', '/relative-private-marker', 'file:///private-marker']) {
      const result = run(app, dir, { ...complete, NEXT_PUBLIC_SUPABASE_URL: url });
      assert.equal(result.status, 1);
      assert.match(result.output, /NEXT_PUBLIC_SUPABASE_URL must be an absolute HTTP\(S\) URL/);
    }
  });

  test(`${app}: production env files load with process values taking precedence`, (t) => {
    const dir = fixture(t);
    fs.writeFileSync(path.join(dir, '.env.production.local'), Object.entries(complete).map(([name, value]) => `${name}=${value}`).join('\n'));
    assert.equal(run(app, dir).status, 0);
    fs.appendFileSync(path.join(dir, '.env.production.local'), '\nNEXT_PUBLIC_SUPABASE_URL=invalid-file-url-marker\n');
    assert.equal(run(app, dir, complete).status, 0);
  });

  test(`${app}: npm build stops before Next compilation when configuration is absent`, (t) => {
    const result = run(app, fixture(t), {}, true);
    assert.equal(result.status, 1);
    assert.match(result.output, /check-build-env\.cjs/);
    assert.match(result.output, /missing required environment variables/);
    assert.ok(!result.output.includes('> next build'));
  });
}
