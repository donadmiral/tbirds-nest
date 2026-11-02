const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { runPage, makeHarness, ADMIN, NOW } = require('./helpers/reportingFixture.cjs');
const { profiles } = require('./helpers/reportingData.cjs');
function summary(scope = 'dashboard') {
  const common = {
    version: 1, as_of: new Date(NOW).toISOString(),
    profiles: {
      members: 10025, businesses: 2005, verified: 6001, business_verified: 1001, active: 823,
      located: 9999, locations: [{ label: 'Nairobi', n: 4000 }, { label: 'London', n: 3000 }],
    },
  };
  return scope === 'dashboard' ? { ...common,
    reports: { series: Array(30).fill(200), week: 1500, previous_week: 1000 },
    verifications: { series: Array(30).fill(210), week: 1900, previous_week: 900, total: 7001, reached_review: 4000, approved: 3000, rejected: 500 },
  } : { ...common,
    tiers: [{ key: 'official', n: 4001 }, { key: 'public_figure', n: 2000 }],
    cohorts: [{ week: '2026-10-05', size: 6000, kept: [3000, 2200, 1800, 1600] }],
  };
}
const rpcCall = result => result.calls.filter(c => c.path === '/rest/v1/rpc/admin_overview_summary');
function nodes(tree, type) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(n => nodes(n, type));
  return [...(tree.type === type ? [tree] : []), ...nodes(tree.props?.children, type)];
}

test('dashboard renders exact aggregates past the API row limit with one bounded RPC', async () => {
  const r = await runPage('admin-web/app/dashboard/page.tsx', {
    tables: { profiles: profiles(10025) }, rpc: { admin_overview_summary: summary() },
  });
  assert.equal(r.outcome, 'rendered', r.error);
  assert.match(r.tree.props.sub, /10K members on file/);
  assert.match(r.text, /Total members 10K/);
  assert.match(r.text, /Active now 823/);
  assert.match(r.text, /Applications received 7,001/);
  assert.match(r.text, /Nairobi/);
  assert.equal(rpcCall(r).length, 1);
  assert.deepEqual(rpcCall(r)[0].body, { p_as_of: new Date(NOW).toISOString(), p_scope: 'dashboard' });
  const profileReads = r.calls.filter(c => c.path === '/rest/v1/profiles');
  assert.ok(profileReads.every(c => c.query.limit === '6' || c.query.id?.startsWith('in.')));
  assert.ok(!r.calls.some(c => ['location', 'created_at', 'created_at,last_seen', 'verified_tier'].includes(c.query.select)));
  const sparks = nodes(r.tree, 'component:Spark').map(n => n.props.values);
  assert.ok(sparks.some(values => values.length === 30 && values.every(n => n === 200)));
  assert.ok(sparks.some(values => values.length === 30 && values.every(n => n === 210)));
});

test('analytics keeps tier, location and cohort figures while fetching no raw profile population', async () => {
  const r = await runPage('admin-web/app/analytics/page.tsx', { rpc: { admin_overview_summary: summary('analytics') } });
  assert.equal(r.outcome, 'rendered', r.error);
  assert.equal(rpcCall(r).length, 1);
  assert.equal(rpcCall(r)[0].body.p_scope, 'analytics');
  assert.ok(!r.calls.some(c => c.path === '/rest/v1/profiles'));
  assert.match(r.text, /6000/);
  assert.match(r.text, /50%|50\.0%/);
  assert.match(r.text, /Nairobi/);
  const slices = nodes(r.tree, 'component:Donut').flatMap(n => n.props.slices || []);
  assert.match(r.text, /Platinum seal 4001/);
  assert.ok(slices.some(s => s.label === 'Verified members' && s.value === 6001));
});

for (const scope of ['dashboard', 'analytics']) {
  test(`${scope} never renders zero or partial statistics after a summary error`, async () => {
    for (const value of [null, { ...summary(scope), version: 999 }, { ...summary(scope), profiles: { ...summary(scope).profiles, members: '10025' } }, { __status: 500, body: { message: 'Summary unavailable' } }]) {
      const r = await runPage(`admin-web/app/${scope}/page.tsx`, { rpc: { admin_overview_summary: value } });
      assert.equal(r.outcome, 'threw');
      assert.match(r.error, /[Oo]verview statistics/);
      assert.equal(r.tree, undefined);
    }
  });
}

test('overview parser refuses missing buckets, unsafe integers and inconsistent cohort counts', async () => {
  for (const [scope, transform] of [
    ['dashboard', value => { value.reports.series.pop(); }],
    ['dashboard', value => { value.verifications.approved = -1; }],
    ['analytics', value => { value.profiles.members = Number.MAX_SAFE_INTEGER + 1; }],
    ['analytics', value => { value.cohorts[0].kept[0] = 7000; }],
    ['analytics', value => { value.as_of = new Date(NOW - 1).toISOString(); }],
  ]) {
    const response = summary(scope); transform(response);
    const h = makeHarness({ rpc: { admin_overview_summary: response } });
    const client = h.load(path.join(ADMIN, 'lib/supabaseAdmin.ts')).serviceClient();
    const { loadAdminOverview } = h.load(path.join(ADMIN, 'lib/adminOverview.ts'));
    await assert.rejects(loadAdminOverview(client, scope, NOW), /could not be confirmed/);
  }
});

test('desk permissions are checked before the reporting RPC', async () => {
  const dashboard = await runPage('admin-web/app/dashboard/page.tsx', { role: 'support_agent' });
  assert.equal(dashboard.outcome, 'rendered', dashboard.error);
  assert.match(dashboard.tree.props.sub, /Open a desk assigned to your role/);
  assert.equal(rpcCall(dashboard).length, 0);
  const analytics = await runPage('admin-web/app/analytics/page.tsx', { role: 'support_agent' });
  assert.notEqual(analytics.outcome, 'rendered');
  assert.equal(rpcCall(analytics).length, 0);
});
