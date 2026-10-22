// Run after npm ci --prefix supabase/tests/rpc-authorization:
// node web/tests/profile-lookup-regressions.cjs
// Add --baseline to exercise the pre-fix route blobs against the same fixtures.
// Uses the pinned PGlite test dependency already present in this repository.
// Real Supabase query URLs feed an isolated PostgreSQL fixture. No network calls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const { before, after, test } = require('node:test');
const ts = require('typescript');
const { createClient } = require('@supabase/supabase-js');
const root = path.resolve(__dirname, '../..');
const { PGlite } = createRequire(path.join(root, 'supabase/tests/rpc-authorization/package.json'))('@electric-sql/pglite');
const db = new PGlite();
const baselines = {
  'app/[username]/page.tsx': '7c60e1db3135c668d2d38d66bd0903858ec1fa7c',
  'app/[username]/follows/page.tsx': 'e6f798c8481ccdf4dd2af6b15ddf15b566e49df2',
};
const fixtures = [
  ['decoy', 'musaXtest'], ['exact', 'musa_test'], ['case', 'Legacy_Name'],
  ['missing-decoy', 'missingXuser'], ['percent-decoy', 'rateANYvalue'], ['percent', 'rate%value'],
  ['slash-decoy', 'slash_name'], ['slash', 'slash\\_name'], ['ordinary', 'ordinary'],
  ['12345678-1234-1234-1234-123456789abc', null],
];
before(async () => {
  await db.exec('create table profiles (ordinal serial primary key, id text not null, username text, full_name text not null)');
  for (const [id, username] of fixtures) await db.query('insert into profiles (id, username, full_name) values ($1, $2, $3)', [id, username, id + ' name']);
});
after(() => db.close());
const flush = () => new Promise(setImmediate);
function compile(file, requireModule, append = '') {
  const source = process.argv.includes('--baseline') && baselines[file]
    ? execFileSync('git', ['show', baselines[file]], { cwd: root, encoding: 'utf8' })
    : fs.readFileSync(path.join(root, 'web', file), 'utf8');
  const code = ts.transpileModule(source + append, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: requireModule }, { filename: file });
  return module.exports;
}
const lookup = compile('lib/profileLookup.ts', require);
function harness(username) {
  const urls = [], effects = [], state = [];
  let slot = 0, pending = Promise.resolve();
  const client = createClient('https://profile-fixture.invalid', 'test-only-public-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async input => {
      const url = new URL(input); urls.push(url);
      assert.equal(url.pathname, '/rest/v1/profiles');
      assert.equal(url.searchParams.get('limit'), '1');
      const filter = url.searchParams.get('username');
      if (url.searchParams.has('id')) {
        pending = db.query('select id, username, full_name from profiles where id = $1 limit 1', [url.searchParams.get('id').slice(3)]);
        const { rows } = await pending;
        return new Response(JSON.stringify(rows), {status:200,headers:{'Content-Type':'application/json'}});
      }
      assert.ok(filter.startsWith('ilike.'));
      // PostgREST documents '*' as an alias for '%' in like/ilike filters.
      const pattern = filter.slice(6).replace(/\*/g, '%');
      pending = db.query('select id, username, full_name from profiles where username ilike $1 order by ordinal limit 1', [pattern]);
      const { rows } = await pending;
      return new Response(JSON.stringify(rows), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } },
  });
  client.auth.getSession = async () => ({ data: { session: null }, error: null });
  const react = {
    useState(initial) { const key = slot++; state[key] = typeof initial === 'function' ? initial() : initial; return [state[key], value => { state[key] = typeof value === 'function' ? value(state[key]) : value; }]; },
    useEffect(fn) { effects.push(fn); }, useCallback(fn) { return fn; }, useMemo(fn) { return fn(); }, useRef(value) { return {current:value}; },
  };
  const jsx = (type, props) => ({ type, props });
  const imports = {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'next/navigation': { useParams: () => ({ username }), useSearchParams: () => new URLSearchParams() },
    '@/lib/supabase/server': { createClient: async () => client },
    '@/lib/supabase/client': { createClient: () => client },
    '@/lib/profileLookup': lookup,
  };
  const requireModule = id => imports[id] ?? new Proxy({}, { get: (_, key) => String(key) });
  return {
    urls,
    async profile() {
      return compile('app/[username]/page.tsx', requireModule, '\nexport { loadProfile };').loadProfile(username);
    },
    async metadata() {
      return compile('app/[username]/page.tsx', requireModule).generateMetadata({ params: Promise.resolve({ username }) });
    },
    async followsTarget() {
      compile('app/[username]/follows/page.tsx', requireModule).default();
      effects[0]();
      await flush(); await pending; await flush();
      return state[0];
    },
  };
}
for (const [input, expected] of [
  ['musa_test', 'exact'], ['MUSA_TEST', 'exact'], ['legacy_name', 'case'],
  ['missing_user', null], ['rate%value', 'percent'], ['slash\\_name', 'slash'],
  ['ordinary', 'ordinary'], ['*', null], ['%', null],
  ['12345678-1234-1234-1234-123456789abc', '12345678-1234-1234-1234-123456789abc'],
]) {
  for (const route of ['profile', 'followsTarget']) {
    test(`${route}: ${JSON.stringify(input)} resolves only ${expected || 'no account'}`, async () => {
      const result = await harness(input)[route]();
      assert.equal(result?.id ?? null, expected);
    });
  }
}
test('profile metadata uses the intended account with an underscore', async () => {
  const h = harness('MUSA_TEST');
  const metadata = await h.metadata();
  assert.equal(metadata.title, 'exact name (@musa_test) on Platinum Circles');
});
test('Supabase transmits escaped underscore and backslash as literal query data', async () => {
  const h = harness('slash\\_name'); await h.profile();
  assert.equal(h.urls[0].searchParams.get('username'), 'ilike.slash\\\\\\_name');
});

test('handleless profile links use its stable identity and omit empty handles in metadata', async () => {
  const id = '12345678-1234-1234-1234-123456789abc';
  assert.equal(lookup.profilePath(null, id), '/' + id);
  assert.equal(lookup.profilePath('musa_test', id), '/musa_test');
  assert.equal(lookup.profilePath(null, null), '/search');
  const meta = await harness(id).metadata();
  assert.ok(!meta.title.includes('@'));
});
