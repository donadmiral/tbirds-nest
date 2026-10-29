const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const test = require('node:test');

function load(name) {
  const module = { exports: {} };
  const source = fs.readFileSync(path.join(__dirname, '../lib/' + name + '.ts'), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module, exports: module.exports, URLSearchParams });
  return module.exports;
}
const { deploymentEnvironment, completeRecordedPayments } = load('operationsReporting');
const { supportSearch, supportSubjectPattern, supportHref, supportMap } = load('supportReporting');

test('Supabase configuration allows staff to enroll and verify the TOTP required by admin desks', () => {
  const config = fs.readFileSync(path.join(__dirname, '../../supabase/config.toml'), 'utf8');
  const totp = config.match(/^\[auth\.mfa\.totp\]\s*\n([\s\S]*?)(?=^\[|$(?![\s\S]))/m)?.[1];
  assert.ok(totp, 'The TOTP Auth configuration must exist');
  for (const setting of ['enroll_enabled', 'verify_enabled']) {
    const values = [...totp.matchAll(new RegExp(`^${setting}\\s*=\\s*(true|false)\\s*(?:#.*)?$`, 'gm'))];
    assert.equal(values.length, 1, `${setting} must be configured exactly once in the TOTP section`);
    assert.equal(values[0][1], 'true', `${setting} must allow first-time staff to reach AAL2`);
  }
});

test('only explicit deployment metadata labels production', () => {
  assert.equal(deploymentEnvironment('production', 'production').label, 'Production');
  assert.equal(deploymentEnvironment('preview', 'production').label, 'Preview');
  assert.equal(deploymentEnvironment(undefined, 'production').label, 'Environment unverified');
  assert.equal(deploymentEnvironment(undefined, 'development').label, 'Development');
});

test('financial totals reject errors and capped results instead of reporting partial money', () => {
  const data = [{ currency: 'USD', paid_amount: 20 }];
  for (const result of [{ data, count: 2, error: null }, { data, count: 1, error: {} }, { data: null, count: 0, error: null }, { data, count: null, error: null }]) {
    assert.equal(completeRecordedPayments(result), null);
  }
  assert.equal(completeRecordedPayments({ data: [{ currency: 'USD', paid_amount: 'invalid' }], count: 1, error: null }), null);
  assert.equal(completeRecordedPayments({ data: [{ currency: 'USD', paid_amount: -1 }], count: 1, error: null }), null);
  assert.equal(completeRecordedPayments({ data: [], count: 0, error: null }).length, 0);
});

test('financial totals keep currencies and unknown currency separate', () => {
  const result = completeRecordedPayments({ data: [
    { currency: ' usd ', paid_amount: '10.50' }, { currency: 'USD', paid_amount: 2 },
    { currency: 'ZWG', paid_amount: 30 }, { currency: null, paid_amount: 5 },
  ], count: 4, error: null });
  assert.equal(JSON.stringify(result), JSON.stringify([
    { currency: 'Unknown currency', amount: 5 }, { currency: 'USD', amount: 12.5 }, { currency: 'ZWG', amount: 30 },
  ]));
});

test('recorded payment totals reject missing or unsafe amounts and sum cents exactly', () => {
  for (const paid_amount of [null, '', ' ', '900719925474099.99', '0.001', Infinity]) {
    assert.equal(completeRecordedPayments({ data: [{ currency: 'USD', paid_amount }], count: 1, error: null }), null);
  }
  const result = completeRecordedPayments({ data: [{ currency: 'USD', paid_amount: 0.1 }, { currency: 'USD', paid_amount: 0.2 }], count: 2, error: null });
  assert.equal(result[0].amount, 0.3);
});

test('support URL inputs are bounded and search wildcard characters stay literal', () => {
  assert.equal(supportSearch({ page: '-5', status: 'anything' }).page, 1);
  assert.equal(supportSearch({ page: ['2'], status: 'anything' }).status, 'open');
  assert.equal(supportSearch({ page: '3', q: '  billing  ', status: 'pending' }).q, 'billing');
  assert.equal(supportSearch({ q: 'a'.repeat(200) }).q.length, 120);
  assert.equal(supportSubjectPattern('50%_off'), '%50\\%\\_off%');
  assert.equal(supportHref(2, 'a&b', 'open'), '/support?status=open&page=2&q=a%26b');
});

test('message lookups stay bounded and preserve ticket order', async () => {
  let active = 0, peak = 0;
  const result = await supportMap(Array.from({ length: 28 }, (_, i) => i), async value => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setImmediate(resolve));
    active--; return value * 2;
  });
  assert.equal(peak, 5);
  assert.equal(JSON.stringify(result), JSON.stringify(Array.from({ length: 28 }, (_, i) => i * 2)));
  assert.equal((await supportMap([], async value => value)).length, 0);
});
