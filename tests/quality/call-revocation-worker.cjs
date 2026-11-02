const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const NOW = Date.parse('2026-11-02T00:00:00Z');

function harness(options = {}) {
  let handler, elapsed = 0, active = 0, maximumConcurrency = 0, used = false;
  const requests = [], updates = [], rpcs = [];
  const pending = Array.from({ length: options.jobs ?? 1 }, (_, i) => ({
    id: i + 1, call_session_id: 'room-' + i, provider_user_id: 'old-admission-' + i, attempts: 2,
  }));
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [NOW + elapsed])); }
    static now() { return NOW + elapsed; }
  }
  const client = {
    async rpc(name, args) {
      rpcs.push({ name, args });
      if (name === 'validate_call_worker_token') {
        if (options.validatorFailure) return { error: Error('private failure detail') };
        if ('validatorData' in options) return { data: options.validatorData };
        const valid = args.p_token === 'one-use-worker-tick' && !used;
        if (valid && options.consume) used = true;
        return { data: valid };
      }
      if (name === 'sweep_dead_calls') return { error: options.sweepFailure ? Error('unavailable') : null };
      if (name === 'claim_call_revocations') return { data: pending.splice(0, args.p_limit), error: null };
      if (name === 'defer_call_worker') return { data: options.backoffFailure ? false : true, error: null };
      throw Error('Unexpected RPC ' + name);
    },
    from(table) {
      assert.equal(table, 'call_provider_revocations');
      return { update(value) {
        const update = { value, filters: [] }; updates.push(update);
        const q = { eq(key, val) { update.filters.push([key, val]); return q; },
          then(resolve, reject) { return Promise.resolve({ error: options.updateFailure ? Error('unavailable') : null }).then(resolve, reject); } };
        return q;
      } };
    },
  };
  const output = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../supabase/functions/daily-reconcile/index.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(output, { exports: {}, require: name => name.endsWith('/serviceRoleFetch.ts') ? { serviceRoleFetch: fetcher => fetcher } : { createClient: () => client }, Request, Response, AbortSignal, Date: Clock,
    Deno: { env: { get(key) {
      if (key in (options.env || {})) return options.env[key];
      return ({ SUPABASE_SERVICE_ROLE_KEY: 'service-key', SUPABASE_URL: 'https://synthetic.invalid', DAILY_API_KEY: 'synthetic-provider-key' })[key];
    } }, serve: fn => { handler = fn; } },
    fetch: async (url, init) => {
      requests.push({ url, body: JSON.parse(init.body), signal: init.signal });
      active++; maximumConcurrency = Math.max(maximumConcurrency, active);
      await new Promise(resolve => setImmediate(resolve));
      active--;
      if (options.advanceMs) elapsed += options.advanceMs;
      if (options.providerFailure) throw Error('synthetic network failure');
      return new Response('', { status: options.providerStatus || 200, headers: options.retryAfter ? { 'Retry-After': options.retryAfter } : {} });
    },
  });
  return { requests, updates, rpcs, pending, get maximumConcurrency() { return maximumConcurrency; },
    async run(token = 'one-use-worker-tick', method = 'POST') {
      const response = await handler(new Request('https://worker.invalid', { method, headers: token ? { Authorization: `Bearer ${token}` } : {} }));
      return { status: response.status, body: await response.json() };
    },
  };
}

test('authorization runs before cleanup and rejects user, service and obsolete environment credentials', async () => {
  const h = harness({ env: { CALL_RECONCILE_SECRET: 'obsolete-secret' } });
  for (const token of ['', 'user-token', 'service-key', 'obsolete-secret']) assert.equal((await h.run(token)).status, 401);
  assert.equal(h.requests.length, 0); assert.equal(h.updates.length, 0);
  assert.ok(h.rpcs.every(rpc => rpc.name === 'validate_call_worker_token'));
  const allowed = await h.run(); assert.equal(allowed.status, 200);
  assert.deepEqual(h.requests[0].body, { user_ids: ['old-admission-0'], ban: true });
  assert.ok(h.updates[0].value.completed_at);
  assert.deepEqual(h.updates[0].filters, [['id', 1], ['attempts', 2]]);
});

test('a consumed invocation capability cannot sweep or claim a second time', async () => {
  const h = harness({ consume: true });
  assert.equal((await h.run()).status, 200);
  const sweeps = h.rpcs.filter(rpc => rpc.name === 'sweep_dead_calls').length;
  assert.equal((await h.run()).status, 401);
  assert.equal(h.rpcs.filter(rpc => rpc.name === 'sweep_dead_calls').length, sweeps);
});

test('the database validator must return a strict boolean and fail closed', async () => {
  for (const validatorData of [false, 'true', [true], { valid: true }, null]) {
    const h = harness({ validatorData }); assert.equal((await h.run()).status, 401);
    assert.equal(h.rpcs.length, 1); assert.equal(h.requests.length, 0);
  }
  const h = harness({ validatorFailure: true, env: { CALL_RECONCILE_SECRET: 'obsolete-secret' } });
  assert.equal((await h.run('obsolete-secret')).status, 503); assert.equal(h.rpcs.length, 1);
});

test('provider failures keep the original durable job retryable without changing admission identity', async () => {
  for (const options of [{ providerStatus: 503 }, { providerFailure: true }]) {
    const h = harness(options); const result = await h.run();
    assert.equal(result.status, 200); assert.equal(result.body.completed, 0);
    assert.equal(h.updates[0].value.completed_at, undefined);
    assert.ok(Date.parse(h.updates[0].value.available_at) > NOW);
    assert.equal(h.updates[0].value.last_error, 'provider revocation failed');
    assert.deepEqual(h.updates[0].filters, [['id', 1], ['attempts', 2]]);
  }
});

test('missing rooms are idempotent completion and failed completion persistence is not reported complete', async () => {
  const absent = harness({ providerStatus: 404 }); assert.equal((await absent.run()).body.completed, 1);
  const failed = harness({ updateFailure: true }); assert.equal((await failed.run()).body.completed, 0);
});

test('draining obeys the explicit job and claim budgets and never exceeds five concurrent requests', async () => {
  const defaultBudget = harness({ jobs: 300 });
  const defaultResult = await defaultBudget.run();
  assert.equal(defaultResult.body.claims, 3); assert.equal(defaultResult.body.processed, 150);
  assert.equal(defaultBudget.maximumConcurrency, 5);
  const jobBudget = harness({ jobs: 300, env: { CALL_REVOCATION_MAX_JOBS: '7', CALL_REVOCATION_MAX_CLAIMS: '10' } });
  assert.equal((await jobBudget.run()).body.processed, 7);
  assert.equal(jobBudget.rpcs.find(rpc => rpc.name === 'claim_call_revocations').args.p_limit, 7);
  const claimBudget = harness({ jobs: 300, env: { CALL_REVOCATION_MAX_JOBS: '500', CALL_REVOCATION_MAX_CLAIMS: '2' } });
  assert.equal((await claimBudget.run()).body.processed, 100);
});

test('429 honors Retry-After seconds or HTTP dates and stops further batches and claims', async () => {
  for (const retryAfter of ['120', new Date(NOW + 120000).toUTCString()]) {
    const h = harness({ jobs: 100, providerStatus: 429, retryAfter });
    const result = await h.run();
    assert.equal(result.body.throttled, true); assert.equal(result.body.claims, 1);
    assert.equal(result.body.claimed, 50); assert.equal(result.body.processed, 5); assert.equal(result.body.deferred, 45);
    assert.equal(h.updates.length, 5);
    assert.ok(h.updates.every(update => Date.parse(update.value.available_at) >= NOW + 120000));
    const pause = h.rpcs.filter(rpc => rpc.name === 'defer_call_worker');
    assert.equal(pause.length, 1); assert.ok(Date.parse(pause[0].args.p_until) >= NOW + 120000);
    assert.equal(h.maximumConcurrency, 5);
  }
});

test('failure to persist a provider-wide pause cannot report successful cleanup or claim more work', async () => {
  const h = harness({ jobs: 100, providerStatus: 429, retryAfter: '120', backoffFailure: true });
  assert.equal((await h.run()).status, 503);
  assert.equal(h.rpcs.filter(rpc => rpc.name === 'claim_call_revocations').length, 1);
  assert.equal(h.requests.length, 5);
});

test('the wall-clock budget stops new work and leaves unattempted leased jobs untouched', async () => {
  const h = harness({ jobs: 100, advanceMs: 60000 }); const result = await h.run();
  assert.equal(result.body.deadlineReached, true); assert.equal(result.body.claims, 1);
  assert.equal(result.body.processed, 5); assert.equal(result.body.deferred, 45);
  assert.equal(h.updates.length, 5);
});

test('non-POST requests and a failed prerequisite sweeper never contact the provider', async () => {
  const h = harness(); assert.equal((await h.run('', 'GET')).status, 405); assert.equal(h.rpcs.length, 0);
  const failed = harness({ sweepFailure: true }); assert.equal((await failed.run()).status, 503); assert.equal(failed.requests.length, 0);
});
