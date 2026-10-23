// Run after npm ci --prefix supabase/tests/rpc-authorization:
// node tests/profile-mention-lookup.test.cjs
// Add --baseline to exercise the original handler with the same PostgreSQL fixtures.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const { before, after, test } = require('node:test');
const ts = require('typescript');
const { createClient } = require('@supabase/supabase-js');
const root = path.resolve(__dirname, '..');
const { PGlite } = createRequire(path.join(root, 'supabase/tests/rpc-authorization/package.json'))('@electric-sql/pglite');
const db = new PGlite();
const fixtures = [
  ['decoy', 'musaXtest'], ['exact', 'musa_test'], ['case', 'Legacy_Name'],
  ['missing-decoy', 'missingXuser'], ['ordinary', 'ordinary'],
  ['percent-decoy', 'rateANYvalue'], ['percent', 'rate%value'],
  ['slash-decoy', 'slash_name'], ['slash', 'slash\\_name'],
];
before(async () => {
  await db.exec('create table profiles (ordinal serial primary key, id text not null, username text not null)');
  for (const [id, username] of fixtures) await db.query('insert into profiles (id, username) values ($1, $2)', [id, username]);
});
after(() => db.close());
function compile(source, globals = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, ...globals });
  return module.exports;
}
const lookup = compile(fs.readFileSync(path.join(root, 'src/utils/profileLookup.ts'), 'utf8'));
const source = process.argv.includes('--baseline')
  ? execFileSync('git', ['show', 'a339deebb88568fbe25385fbc761a58345f90674'], { cwd: root, encoding: 'utf8' })
  : fs.readFileSync(path.join(root, 'src/screens/feed/PostScreen.tsx'), 'utf8');
const ast = ts.createSourceFile('PostScreen.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let handler;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'handleMentionTap') handler = node.initializer.getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(handler, 'real mention-tap handler exists');
function harness() {
  const navigation = [], alerts = [], urls = [];
  const client = createClient('https://mention-fixture.invalid', 'test-only-public-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async input => {
      const url = new URL(input); urls.push(url);
      assert.equal(url.pathname, '/rest/v1/profiles');
      const filter = url.searchParams.get('username'); assert.ok(filter.startsWith('ilike.'));
      const pattern = filter.slice(6).replace(/\*/g, '%');
      const { rows } = await db.query('select id, username from profiles where username ilike $1 order by ordinal', [pattern]);
      return new Response(JSON.stringify(rows), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } },
  });
  const { run } = compile('export const run = ' + handler, {
    supabase: client, ...lookup,
    navigation: { navigate: (route, args) => navigation.push({ route, args }) },
    Alert: { alert: (title, message) => alerts.push({ title, message }) },
  });
  return { run, navigation, alerts, urls };
}
for (const [input, expected] of [
  ['musa_test', 'exact'], ['MUSA_TEST', 'exact'], ['legacy_name', 'case'],
  ['missing_user', null], ['ordinary', 'ordinary'],
  ['rate%value', 'percent'], ['slash\\_name', 'slash'], ['%', null], ['*', null],
]) {
  test(`mention ${JSON.stringify(input)} opens only ${expected || 'no account'}`, async () => {
    const h = harness(); await h.run(input);
    if (expected) {
      assert.equal(h.navigation.length, 1); assert.equal(h.navigation[0].route, 'UserProfile');
      assert.equal(h.navigation[0].args.userId, expected); assert.equal(h.alerts.length, 0);
    } else {
      assert.equal(h.navigation.length, 0); assert.equal(h.alerts.length, 1); assert.equal(h.alerts[0].title, 'Not found');
    }
  });
}
test('native SDK transports the escaped underscore literally', async () => {
  const h = harness(); await h.run('musa_test');
  assert.equal(h.urls[0].searchParams.get('username'), 'ilike.musa\\_test');
});
test('a PostgREST star alias that matches exactly one unrelated account is rejected', async () => {
  const h = harness(); await h.run('ord*');
  assert.equal(h.navigation.length, 0); assert.equal(h.alerts[0].title, 'Not found');
});
