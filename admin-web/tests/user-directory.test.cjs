const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');

const root = path.join(__dirname, '..');
function load(file, overrides = {}, globals = {}) {
  const module = { exports: {} };
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  vm.runInNewContext(compiled, {
    module, exports: module.exports, URLSearchParams, Date,
    require: name => Object.hasOwn(overrides, name) ? overrides[name] : require(name),
    ...globals,
  }, { filename: file });
  return module.exports;
}

const directory = load('lib/userDirectory.ts');
const permissions = load('lib/permissions.ts');
function member(index) {
  return {
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    full_name: `Member ${index}`, username: `member${index}`, email: `member${index}@example.invalid`,
    avatar_url: null, account_type: 'personal', is_verified: false, verified_tier: null,
    verified_category: null, created_at: '2026-10-01T00:00:00Z', deactivated_at: null,
    suspended_reason: null, restricted_until: null,
    follower_counts: [{ count: index === 0 ? 5_000_001 : index }],
    following_counts: [{ count: index === 0 ? 2_500 : 0 }],
    strike_counts: [{ count: index === 0 ? 1_001 : 0 }],
  };
}

function harness({ rows = Array.from({ length: 25 }, (_, i) => member(i)), role = 'super_admin', deny = false, fail = false, total = 100 } = {}) {
  const requests = [];
  let authorized = false;
  const api = load('lib/supabaseAdmin.ts', { 'server-only': {} }, {
    process: { env: {
      NEXT_PUBLIC_SUPABASE_URL: 'https://qa.example.invalid',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'publishable-placeholder',
      SUPABASE_SERVICE_ROLE_KEY: 'server-placeholder',
    } },
    fetch: async (input, init = {}) => {
      assert.equal(authorized, true, 'authorization must precede all directory reads');
      assert.equal(init.cache, 'no-store');
      const url = new URL(input);
      const method = init.method || 'GET';
      requests.push({ url, method, headers: new Headers(init.headers) });
      const isPage = url.pathname.endsWith('/profiles') && method === 'GET';
      if (isPage && fail) return new Response(JSON.stringify({ code: 'PGRST200', message: 'Relationship unavailable' }), { status: 400 });
      if (method === 'HEAD') return new Response(null, { status: 200, headers: { 'content-range': '*/100' } });
      const body = isPage ? rows : [];
      return new Response(JSON.stringify(body), { status: 200, headers: {
        'content-type': 'application/json',
        'content-range': body.length ? `0-${body.length - 1}/${total}` : `*/${total}`,
      } });
    },
  });
  const page = load('app/users/page.tsx', {
    'next/link': { default: 'Link' },
    'next/navigation': { redirect() { throw new Error('redirect'); } },
    '@/lib/adminAuth': { async requireDesk(desk) {
      assert.equal(desk, '/users');
      if (deny) throw new Error('forbidden');
      authorized = true;
      return { id: 'staff', role };
    } },
    '@/lib/permissions': permissions,
    '@/lib/supabaseAdmin': api,
    '@/lib/userDirectory': directory,
    '@/components/Shell': { default: 'Shell' },
    '@/components/UsersDesk': { default: 'UsersDesk' },
  }).default;
  return { requests, render: async (params = {}) => page({ searchParams: Promise.resolve(params) }) };
}

function elements(tree, type) {
  if (tree === null || tree === undefined || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(node => elements(node, type));
  return [...(tree.type === type ? [tree] : []), ...elements(tree.props?.children, type)];
}

test('25 members use one directory request with exact embedded counts, not 75 secondary requests', async () => {
  const h = harness();
  const tree = await h.render();
  assert.equal(h.requests.length, 6); // page + four dashboard totals + permitted appeals
  for (const request of h.requests) {
    assert.equal(request.headers.get('authorization'), 'Bearer server-placeholder');
    assert.equal(request.headers.get('apikey'), 'server-placeholder');
  }
  const page = h.requests.find(r => r.method === 'GET' && r.url.pathname.endsWith('/profiles'));
  assert.ok(page.headers.get('prefer').includes('count=exact'));
  assert.match(page.url.searchParams.get('select'), /follower_counts:follows!follows_following_id_fkey\(count\)/);
  assert.match(page.url.searchParams.get('select'), /following_counts:follows!follows_follower_id_fkey\(count\)/);
  assert.match(page.url.searchParams.get('select'), /strike_counts:member_strikes!member_strikes_user_id_fkey\(count\)/);
  assert.equal(h.requests.some(r => /\/(follows|member_strikes)$/.test(r.url.pathname)), false);
  const rows = elements(tree, 'UsersDesk')[0].props.rows;
  assert.equal(rows.length, 25);
  assert.equal(rows[0].followers, 5_000_001);
  assert.equal(rows[0].following, 2_500);
  assert.equal(rows[0].strikes, 1_001);
  assert.equal(rows[1].following, 0);
  assert.equal(rows[0].email, 'member0@example.invalid');
  assert.equal('follower_counts' in rows[0], false);
});

test('search escaping, stable ordering, page boundaries and navigation remain intact', async () => {
  const h = harness({ total: 100 });
  const q = '  A%_\\,"name  ';
  const tree = await h.render({ q, page: '3' });
  const page = h.requests[0].url.searchParams;
  const term = '%' + q.trim().slice(0, 160).replace(/[\\%_]/g, '\\$&') + '%';
  const literal = JSON.stringify(term);
  assert.equal(page.get('or'), `(full_name.ilike.${literal},username.ilike.${literal},email.ilike.${literal})`);
  assert.equal(page.get('order'), 'created_at.desc,id.asc');
  assert.equal(page.get('offset'), '50');
  assert.equal(page.get('limit'), '25');
  const links = elements(tree, 'Link').filter(link => new URL(link.props.href, 'https://example.invalid').pathname === '/users');
  assert.deepEqual(links.map(link => new URL(link.props.href, 'https://example.invalid').searchParams.get('page')), ['2', '4']);
  assert.equal(new URL(links[0].props.href, 'https://example.invalid').searchParams.get('q'), q);
});

test('roles without support access do not load or display appeals', async () => {
  const h = harness({ role: 'verification_reviewer' });
  const tree = await h.render();
  assert.equal(h.requests.length, 5);
  assert.equal(h.requests.some(r => r.url.pathname.endsWith('/support_tickets')), false);
  assert.equal(elements(tree, 'UsersDesk')[0].props.appeals.length, 0);
});

test('an authorization rejection sends no database requests', async () => {
  const h = harness({ deny: true });
  await assert.rejects(h.render(), /forbidden/);
  assert.equal(h.requests.length, 0);
});

test('database failures propagate to the existing error boundary instead of zero counts', async () => {
  const h = harness({ fail: true });
  await assert.rejects(h.render(), error => error.message === 'Relationship unavailable');
});

test('malformed, missing, truncated and unsafe count values fail closed', async () => {
  for (const field of ['follower_counts', 'following_counts', 'strike_counts']) {
    for (const invalid of [undefined, null, [], [{ count: 0 }, { count: 1 }], [null], [{}], [{ count: '1' }], [{ count: -1 }], [{ count: 1.5 }], [{ count: Number.MAX_SAFE_INTEGER + 1 }]]) {
      const row = member(0);
      row[field] = invalid;
      await assert.rejects(harness({ rows: [row] }).render(), /Member counts could not be verified/);
    }
  }
});

test('empty search results need no secondary lookups and do not invent members', async () => {
  const h = harness({ rows: [], total: 0 });
  const tree = await h.render({ page: 'invalid' });
  assert.equal(h.requests.length, 6);
  assert.equal(h.requests[0].url.searchParams.get('offset'), '0');
  assert.equal(elements(tree, 'UsersDesk').length, 0);
  assert.deepEqual(elements(tree, 'Link').map(link => link.props.href), ['/users/deletions']);
});
