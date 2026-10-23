const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');

const NOW = 1_792_750_000;
class FixedDate extends Date {
  static now() { return NOW * 1000; }
}

function load(file) {
  const module = { exports: {} };
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
    esModuleInterop: true,
  } }).outputText;
  vm.runInNewContext(compiled, {
    module, exports: module.exports, URL, Buffer, Date: FixedDate,
    process: { env: {} },
    require: name => name === 'server-only' ? {} : require(name),
  }, { filename: file });
  return module.exports;
}

const { authEnvironment, trustedAuthOrigin } = load('lib/adminRecoveryPolicy.ts');
const { sealRecovery, openRecovery } = load('lib/adminRecoverySeal.ts');
const production = { NODE_ENV: 'production', VERCEL_ENV: 'production' };
const preview = {
  NODE_ENV: 'production', VERCEL_ENV: 'preview',
  VERCEL_URL: 'operations-a1b2c3-team.vercel.app',
  VERCEL_BRANCH_URL: 'operations-git-staging-team.vercel.app',
};
const SECRET = 'test-only-recovery-signing-secret-with-at-least-32-bytes';
const OTHER_SECRET = 'different-test-only-recovery-signing-secret-at-least-32-bytes';
const session = overrides => ({
  accessToken: 'test-access-token',
  refreshToken: 'test-refresh-token',
  userId: '00000000-0000-4000-8000-000000000001',
  sessionId: '00000000-0000-4000-8000-000000000002',
  expiresAt: NOW + 600,
  ...overrides,
});
const plain = value => JSON.parse(JSON.stringify(value));

test('sign-in identifies the actual configured Auth project without guessing unknown environments', () => {
  const qa = authEnvironment('https://uaulhuelcfkjwojtymmw.supabase.co');
  assert.equal(qa.label, 'QA test environment');
  assert.equal(qa.projectHost, 'uaulhuelcfkjwojtymmw.supabase.co');
  assert.match(qa.detail, /test/i);
  const live = authEnvironment('https://prlkikhckbifseosbukl.supabase.co');
  assert.equal(live.label, 'Production');
  assert.equal(live.projectHost, 'prlkikhckbifseosbukl.supabase.co');
  assert.ok(live.detail.length > 0);
  const unknown = authEnvironment('https://other-project.supabase.co');
  assert.equal(unknown.label, 'Unverified environment');
  assert.equal(unknown.projectHost, 'other-project.supabase.co');
  for (const url of ['', 'not a URL']) {
    const invalid = authEnvironment(url);
    assert.equal(invalid.label, 'Unverified environment');
    assert.equal(invalid.projectHost, '');
  }
});

test('recovery redirect is bound to the current deployment or an explicitly configured origin', () => {
  assert.equal(trustedAuthOrigin('https://operations-a1b2c3-team.vercel.app', preview), 'https://operations-a1b2c3-team.vercel.app');
  assert.equal(trustedAuthOrigin('https://operations-git-staging-team.vercel.app', preview), 'https://operations-git-staging-team.vercel.app');
  assert.equal(trustedAuthOrigin('https://admin.platinumcircles.app', production), 'https://admin.platinumcircles.app');
  assert.equal(trustedAuthOrigin('https://admin.platinumcircles.app', preview), null);
  const configured = { ...preview, ADMIN_AUTH_ORIGINS: 'https://review.example.invalid, https://staff.example.invalid' };
  assert.equal(trustedAuthOrigin('https://review.example.invalid', configured), 'https://review.example.invalid');
  assert.equal(trustedAuthOrigin('https://staff.example.invalid', configured), 'https://staff.example.invalid');
});

test('host lookalikes, arbitrary Vercel sites, credentials, paths and non-web schemes fail closed', () => {
  for (const candidate of [
    '', 'not a URL', '//operations-a1b2c3-team.vercel.app',
    'https://another-team.vercel.app',
    'https://operations-a1b2c3-team.vercel.app.attacker.invalid',
    'https://attacker-operations-a1b2c3-team.vercel.app',
    'https://operations-a1b2c3-team.vercel.app@attacker.invalid',
    'https://attacker@operations-a1b2c3-team.vercel.app',
    'https://operations-a1b2c3-team.vercel.app/reset-password',
    'https://operations-a1b2c3-team.vercel.app?next=https://attacker.invalid',
    'https://operations-a1b2c3-team.vercel.app#attacker',
    'http://operations-a1b2c3-team.vercel.app',
    'javascript:alert(1)', 'data:text/html,untrusted',
  ]) {
    assert.equal(trustedAuthOrigin(candidate, preview), null, candidate);
  }
});

test('an allowlist does not authorize subdomains, suffix matches, or wildcard patterns', () => {
  const env = { ...preview, ADMIN_AUTH_ORIGINS: 'https://staff.example.invalid, https://*.vercel.app' };
  for (const candidate of [
    'https://other.staff.example.invalid',
    'https://staff.example.invalid.attacker.invalid',
    'https://arbitrary.vercel.app',
  ]) {
    assert.equal(trustedAuthOrigin(candidate, env), null, candidate);
  }
});

test('localhost recovery is limited to a development runtime', () => {
  assert.equal(trustedAuthOrigin('http://localhost:3000', { NODE_ENV: 'development' }), 'http://localhost:3000');
  for (const env of [preview, production, { NODE_ENV: 'production', ADMIN_AUTH_ORIGINS: 'http://localhost:3000' }]) {
    assert.equal(trustedAuthOrigin('http://localhost:3000', env), null);
  }
  assert.equal(trustedAuthOrigin('http://localhost.attacker.invalid:3000', { NODE_ENV: 'development' }), null);
});

test('a sealed recovery session preserves identity and tokens only until its exact expiry', () => {
  const original = session();
  const cookie = sealRecovery(original, SECRET);
  assert.equal(typeof cookie, 'string');
  assert.ok(Buffer.byteLength(cookie, 'utf8') <= 3840);
  assert.deepEqual(plain(openRecovery(cookie, SECRET, NOW)), original);
  assert.deepEqual(plain(openRecovery(cookie, SECRET, NOW + 599)), original);
  assert.equal(openRecovery(cookie, SECRET, NOW + 600), null);
  assert.equal(openRecovery(cookie, SECRET, NOW + 601), null);
});

test('recovery seals cannot be accepted under a different signing key', () => {
  const cookie = sealRecovery(session(), SECRET);
  assert.equal(openRecovery(cookie, OTHER_SECRET, NOW), null);
});

test('tampering with any part of a recovery cookie cannot alter its identity or extend its life', () => {
  const cookie = sealRecovery(session(), SECRET);
  for (const index of [0, Math.floor(cookie.length / 3), Math.floor(cookie.length * 2 / 3), cookie.length - 2]) {
    const replacement = cookie[index] === 'A' ? 'B' : 'A';
    const tampered = cookie.slice(0, index) + replacement + cookie.slice(index + 1);
    assert.equal(openRecovery(tampered, SECRET, NOW), null, `tampered byte ${index}`);
  }
  assert.equal(openRecovery(cookie + '.unexpected', SECRET, NOW), null);
  assert.equal(openRecovery(cookie.slice(0, -12), SECRET, NOW), null);
});

test('missing, malformed and oversized recovery cookies return a rejection without throwing', () => {
  for (const cookie of ['', '.', 'v1', 'v1..', 'v2.invalid.invalid', 'not-json.not-a-signature', 'A'.repeat(3841)]) {
    assert.equal(openRecovery(cookie, SECRET, NOW), null);
  }
});

test('a valid signature cannot grant a recovery window longer than ten minutes', () => {
  let cookie;
  try {
    cookie = sealRecovery(session({ expiresAt: NOW + 601 }), SECRET);
  } catch {
    // Rejection while sealing is also safe, provided ordinary sessions work above.
    return;
  }
  assert.equal(openRecovery(cookie, SECRET, NOW), null);
});

test('signed but incomplete or invalid recovery claims are not accepted', () => {
  for (const changes of [
    { accessToken: '' }, { refreshToken: '' }, { userId: '' }, { sessionId: '' },
    { expiresAt: NOW }, { expiresAt: NOW - 1 }, { expiresAt: NOW + 0.5 },
    { expiresAt: '1792750010' }, { expiresAt: Infinity },
  ]) {
    let cookie;
    try { cookie = sealRecovery(session(changes), SECRET); }
    catch { continue; }
    assert.equal(openRecovery(cookie, SECRET, NOW), null, JSON.stringify(changes));
  }
});

test('sealing refuses cookies that would exceed the browser cookie budget', () => {
  assert.throws(() => sealRecovery(session({ accessToken: 'A'.repeat(4000) }), SECRET));
});
