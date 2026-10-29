// Run with: node --test tests/quality/jobs-market-regressions.cjs
// Uses synthetic rows only; the real service modules run with a local query double.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');

function loadModule(file, client, overrides = {}) {
  const source = process.env.QUALITY_BASE_REF
    ? execFileSync('git', ['show', `${process.env.QUALITY_BASE_REF}:${file}`], { cwd: root, encoding: 'utf8' })
    : fs.readFileSync(path.join(root, file), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} };
  const imports = {
    './supabase': { supabase: client },
    '@/lib/supabase/client': { createClient: () => client },
    './flagsService': { flagsService: { isEnabled: async () => true } },
    '../stores/actorStore': { authorId: (id) => id },
    ...overrides,
  };
  vm.runInNewContext(code, {
    module, exports: module.exports,
    require: (id) => {
      if (id === '../../shared/hiring') return loadModule('shared/hiring.ts', client);
      assert.ok(id in imports, `Unexpected import ${id}`); return imports[id];
    },
    console: { log() {} }, Date, Map, Set, Number, Error,
  }, { filename: file });
  return module.exports;
}

function mockClient({ rows = [], error = null, rpcError = null, user = { id: 'viewer' }, authError = null, ranked } = {}) {
  const queries = [];
  const calls = [];
  const client = {
    queries, calls,
    auth: { getUser: async () => ({ data: { user }, error: authError }) },
    rpc: async (name, args) => { calls.push({ name, args }); return { data: ranked ?? rows.map(({ id }) => ({ id })), error: rpcError }; },
    from(table) {
      const query = { table, operations: [], orders: [], filters: [], limit: Infinity, offset: 0 };
      queries.push(query);
      const builder = new Proxy({}, {
        get(_, method) {
          if (method === 'then') return (resolve, reject) => {
            let result = rows.slice();
            for (const [key, value] of query.filters) result = result.filter((row) => row[key] === value);
            result.sort((a, b) => {
              for (const [key, ascending] of query.orders) {
                if (a[key] !== b[key]) return (a[key] < b[key] ? -1 : 1) * (ascending ? 1 : -1);
              }
              return 0;
            });
            return Promise.resolve({ data: result.slice(query.offset, query.offset + query.limit), error }).then(resolve, reject);
          };
          return (...args) => {
            query.operations.push([method, ...args]);
            if (method === 'order') query.orders.push([args[0], args[1].ascending]);
            if (method === 'eq') query.filters.push(args);
            if (method === 'limit') query.limit = args[0];
            if (method === 'range') { query.offset = args[0]; query.limit = args[1] - args[0] + 1; }
            return builder;
          };
        },
      });
      return builder;
    },
  };
  return client;
}

const fixtures = [
  { id: 'new-expensive', status: 'available', created_at: '2026-10-03', price: 900, category: 'Home' },
  { id: 'old-cheap', status: 'available', created_at: '2026-10-01', price: 10, category: 'Home' },
  { id: 'middle', status: 'available', created_at: '2026-10-02', price: 100, category: 'Electronics' },
];

for (const [platform, file, serviceKey] of [
  ['web', 'web/lib/market.ts', null],
  ['native', 'src/services/marketService.ts', 'marketService'],
]) {
  const service = (client) => { const mod = loadModule(file, client); return serviceKey ? mod[serviceKey] : mod; };
  const listings = (s, options) => s.getListings ? s.getListings(options) : s.listListings(options);
  const savedIds = (s) => s.getSavedListingIds ? s.getSavedListingIds() : s.getSavedIds();
  test(`${platform}: low price is the primary sort, even when the cheapest listing is older`, async () => {
    const results = await listings(service(mockClient({ rows: fixtures })), { sort: 'price_low', limit: 2 });
    assert.deepEqual(Array.from(results, (r) => r.id), ['old-cheap', 'middle']);
  });
  test(`${platform}: high price is the primary sort`, async () => {
    const rows = fixtures.map((r) => ({ ...r, created_at: r.id === 'old-cheap' ? '2026-10-10' : r.created_at }));
    const results = await listings(service(mockClient({ rows })), { sort: 'price_high' });
    assert.deepEqual(Array.from(results, (r) => r.id), ['new-expensive', 'middle', 'old-cheap']);
  });
  if (platform === 'native') test('native: later price-sorted pages continue after the first page', async () => {
    const results = await listings(service(mockClient({ rows: fixtures })), { sort: 'price_low', limit: 2, offset: 2 });
    assert.deepEqual(Array.from(results, (r) => r.id), ['new-expensive']);
  });
  test(`${platform}: the All category does not exclude every listing`, async () => {
    const results = await listings(service(mockClient({ rows: fixtures })), { category: 'All' });
    assert.equal(results.length, 3);
  });
  test(`${platform}: selected category still filters results`, async () => {
    const results = await listings(service(mockClient({ rows: fixtures })), { category: 'Electronics' });
    assert.deepEqual(Array.from(results, (r) => r.id), ['middle']);
  });
  test(`${platform}: ranked feed normalizes the All category`, async () => {
    const client = mockClient();
    await service(client).getMarketFeed({ category: 'All' });
    assert.equal(client.calls[0].args.p_category, null);
  });
  test(`${platform}: listing query errors remain distinguishable from no listings`, async () => {
    await assert.rejects(listings(service(mockClient({ error: new Error('offline') })), {}), /offline/);
  });
  test(`${platform}: ranking errors remain distinguishable from no listings`, async () => {
    await assert.rejects(service(mockClient({ rpcError: new Error('ranking unavailable') })).getMarketFeed({}), /ranking unavailable/);
  });
  test(`${platform}: ranked listing hydration failures are surfaced`, async () => {
    await assert.rejects(service(mockClient({ ranked: [{ id: 'a' }], error: new Error('hydration unavailable') })).getMarketFeed({}), /hydration unavailable/);
  });
  for (const on of [true, false]) test(`${platform}: failed ${on ? 'save' : 'unsave'} rejects so UI can roll back`, async () => {
    await assert.rejects(service(mockClient({ error: new Error('permission denied') })).toggleSaved('listing', on), /permission denied/);
  });
  test(`${platform}: signed out save cannot report success`, async () => {
    await assert.rejects(service(mockClient({ user: null })).toggleSaved('listing', true), /Sign in/);
  });
  test(`${platform}: public browsing permits an absent auth session`, async () => {
    const error = Object.assign(new Error('no session'), { name: 'AuthSessionMissingError' });
    assert.equal((await savedIds(service(mockClient({ user: null, authError: error })))).size, 0);
  });
  test(`${platform}: saved-list errors do not silently clear saved state`, async () => {
    await assert.rejects(savedIds(service(mockClient({ error: new Error('saved unavailable') }))), /saved unavailable/);
  });
  test(`${platform}: transient auth errors remain visible`, async () => {
    await assert.rejects(savedIds(service(mockClient({ user: null, authError: new Error('auth offline') }))), /auth offline/);
  });
}

for (const file of ['web/lib/jobs.ts', 'src/services/jobsService.ts']) {
  test(`${file}: deadline closes at the exact timestamp, without a 24-hour rounding window`, () => {
    const { isJobDeadlinePassed } = loadModule(file, mockClient());
    const deadline = '2026-10-17T10:30:00Z';
    const now = Date.parse(deadline);
    assert.equal(isJobDeadlinePassed(deadline, now - 1), false);
    assert.equal(isJobDeadlinePassed(deadline, now), true);
    assert.equal(isJobDeadlinePassed(deadline, now + 1), true);
    assert.equal(isJobDeadlinePassed(null, now), false);
    assert.equal(isJobDeadlinePassed('invalid', now), false);
  });
  test(`${file}: every supported hiring stage has its own label`, () => {
    const { STATUS_META } = loadModule(file, mockClient());
    for (const status of ['applied', 'viewed', 'shortlisted', 'screening', 'interview', 'offer', 'hired', 'accepted', 'rejected', 'withdrawn']) {
      assert.equal(STATUS_META[status]?.label.toLowerCase(), status);
    }
  });
}

test('native: applicant query failures surface to the employer retry state', async () => {
  const { jobsService } = loadModule('src/services/jobsService.ts', mockClient({ error: new Error('applicants unavailable') }));
  await assert.rejects(jobsService.getApplicationsForJob('job'), /applicants unavailable/);
});
test('native: my applications surface a failed page instead of reporting an empty history', async () => {
  const client = mockClient({ rpcError: new Error('applications unavailable') });
  const { jobsService } = loadModule('src/services/jobsService.ts', client);
  await assert.rejects(jobsService.getMyApplications('viewer'), /applications unavailable/);
  assert.equal(client.calls[0].name, 'my_application_page');
  assert.equal(client.calls[0].args.p_limit, 25);
});

for (const method of ['getJobs', 'getSavedJobs', 'getSavedJobIds', 'getAppliedJobIds']) test(`native: ${method} preserves an unavailable response for the retry UI`, async () => {
  const { jobsService } = loadModule('src/services/jobsService.ts', mockClient({ error: new Error('jobs unavailable') }));
  await assert.rejects(jobsService[method](method === 'getJobs' ? {} : 'viewer'), /jobs unavailable/);
});
test('native: open-role availability and popularity ordering are applied before the page limit', async () => {
  const client = mockClient({ rows: [{ id: 'old', applications_count: 20, created_at: '2026-01-01' }, { id: 'new', applications_count: 1, created_at: '2026-10-01' }] });
  const { jobsService } = loadModule('src/services/jobsService.ts', client);
  const jobs = await jobsService.getJobs({ sortBy: 'popular', limit: 1 });
  assert.equal(jobs[0].id, 'old');
  assert.match(client.queries[0].operations.find(([op]) => op === 'or')[1], /^deadline\.is\.null,deadline\.gt\./);
});
test('native: Near me requires a city instead of returning every location', async () => {
  const { jobsService } = loadModule('src/services/jobsService.ts', mockClient());
  await assert.rejects(jobsService.getJobs({ scope: 'primary', userId: 'viewer' }), /Add your city/);
});

function publishingClient({ actor = null, authenticatedAs = 'owner', identityError = null, onAuthorize } = {}) {
  const writes = [];
  const client = {
    auth: { getUser: async () => {
      await onAuthorize?.();
      return { data: { user: authenticatedAs ? { id: authenticatedAs } : null }, error: identityError };
    } },
    from(table) {
      assert.equal(table, 'jobs');
      let payload;
      const query = { insert(value) { payload = value; writes.push(value); return query; }, select() { return query; }, async single() { return { data: { id: 'new-job', ...payload }, error: null }; } };
      return query;
    },
  };
  const { jobsService } = loadModule('src/services/jobsService.ts', client, { '../stores/actorStore': { authorId: fallback => actor ?? fallback } });
  return { service: jobsService, writes, setActor(value) { actor = value; } };
}
const jobInput = { title: 'Engineer', company: 'Example', description: 'Role description', category: 'full_time' };

test('native job publishing writes the verified signed-in owner used by the hiring RPCs', async () => {
  const h = publishingClient();
  const job = await h.service.createJob('owner', jobInput);
  assert.equal(job.posted_by, 'owner'); assert.equal(h.writes.length, 1); assert.equal(h.writes[0].posted_by, 'owner');
});
test('native job publishing permits a signed-in business account when it is also the posting owner', async () => {
  const h = publishingClient({ actor: 'business-account', authenticatedAs: 'business-account' });
  await h.service.createJob('business-account', jobInput);
  assert.equal(h.writes[0].posted_by, 'business-account');
});
test('native job publishing blocks a delegated organization before creating an unmanageable job', async () => {
  const h = publishingClient({ actor: 'managed-organization' });
  await assert.rejects(h.service.createJob('owner', jobInput), /managed organization.*not available yet/);
  assert.equal(h.writes.length, 0);
});
test('a caller cannot substitute the selected actor ID for the authenticated job owner', async () => {
  const h = publishingClient({ actor: 'managed-organization', authenticatedAs: 'owner' });
  await assert.rejects(h.service.createJob('managed-organization', jobInput), /signed-in account changed/);
  assert.equal(h.writes.length, 0);
});
test('changing the posting actor during authorization prevents job publication', async () => {
  let h;
  h = publishingClient({ onAuthorize: () => h.setActor('managed-organization') });
  await assert.rejects(h.service.createJob('owner', jobInput), /managed organization.*not available yet/);
  assert.equal(h.writes.length, 0);
});
test('failed account verification cannot publish a job using the cached profile owner', async () => {
  const h = publishingClient({ identityError: new Error('Identity unavailable') });
  await assert.rejects(h.service.createJob('owner', jobInput), /Identity unavailable/);
  assert.equal(h.writes.length, 0);
});
test('native: recruiter updates cannot overwrite a withdrawn application', async () => {
  const client = mockClient();
  const { jobsService } = loadModule('src/services/jobsService.ts', client);
  await jobsService.updateApplicationStatus('application', 'interview');
  assert.ok(client.queries[0].operations.some(([operation, column, value]) => operation === 'neq' && column === 'status' && value === 'withdrawn'));
  assert.ok(client.queries[0].operations.some(([operation]) => operation === 'single'));
});

function listingCardHarness(toggleSaved) {
  const file = 'web/components/ListingCard.tsx';
  const source = process.env.QUALITY_BASE_REF
    ? execFileSync('git', ['show', `${process.env.QUALITY_BASE_REF}:${file}`], { cwd: root, encoding: 'utf8' })
    : fs.readFileSync(path.join(root, file), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const hooks = [];
  let cursor = 0;
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = initial;
      return [hooks[index], (value) => { hooks[index] = typeof value === 'function' ? value(hooks[index]) : value; }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = { current: initial };
      return hooks[index];
    },
  };
  const imports = {
    react,
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    'next/link': { default: 'link' },
    'lucide-react': { Heart: 'heart' },
    '@/lib/market': { toggleSaved, priceLabel: () => '$10' },
    '@/components/RelativeTime': { RelativeTime: 'time' },
    '@/lib/media': { displayImageUrl: (url) => url },
  };
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, alert() {}, require: (id) => {
    assert.ok(id in imports, `Unexpected import ${id}`);
    return imports[id];
  } }, { filename: file });
  function findButton(node) {
    if (!node || typeof node !== 'object') return null;
    if (node.type === 'button') return node;
    const children = Array.isArray(node.props?.children) ? node.props.children : [node.props?.children];
    for (const child of children) { const found = findButton(child); if (found) return found; }
    return null;
  }
  return () => {
    cursor = 0;
    return findButton(module.exports.ListingCard({
      l: { id: 'listing', status: 'available', images: [], created_at: '2026-10-17', price: 10, currency: 'USD' },
      saved: false, viewerId: 'viewer',
    }));
  };
}

test('listing card: failed unsave restores a previous successful save without a parent callback', async () => {
  let calls = 0;
  const render = listingCardHarness(async () => { if (++calls === 2) throw new Error('offline'); });
  const click = { preventDefault() {}, stopPropagation() {} };
  await render().props.onClick(click);
  assert.equal(render().props.title, 'Unsave');
  await render().props.onClick(click);
  assert.equal(render().props.title, 'Unsave');
});

test('listing card: rapid repeated clicks send only one pending save', async () => {
  let calls = 0;
  let resolve;
  const render = listingCardHarness(() => { calls++; return new Promise((done) => { resolve = done; }); });
  const click = { preventDefault() {}, stopPropagation() {} };
  const first = render().props.onClick(click);
  const second = render().props.onClick(click);
  assert.equal(calls, 1);
  resolve();
  await Promise.all([first, second]);
  assert.equal(render().props.title, 'Unsave');
});
