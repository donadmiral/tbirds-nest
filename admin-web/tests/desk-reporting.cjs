const assert = require('node:assert/strict');
const test = require('node:test');
const { runPage, makeHarness, ADMIN, NOW } = require('./helpers/reportingFixture.cjs');
const { id, stamp, profiles, jobs, calls, stories, applications } = require('./helpers/reportingData.cjs');
const render = (name, options) => runPage(`admin-web/app/${name}/page.tsx`, options);
const card = (result, label) => result.cards.find(c => c.label === label)?.value;
const rendered = result => { assert.equal(result.outcome, 'rendered', result.error); return result; };
const tableCalls = (result, table, method) => result.calls.filter(c => c.path === `/rest/v1/${table}` && (!method || c.method === method));
const pageRead = (result, table) => tableCalls(result, table, 'GET').find(c => c.query.select === '*');
const rows = result => result.desks[0].rows;

test('Jobs counts all 10,030 roles exactly, including more than the API row cap', async () => {
  const records = jobs(10025).concat(jobs(5).map((j, i) => ({ ...j, id: id(20000 + i), created_at: stamp(10 * 1440) })));
  const r = rendered(await render('jobs', { tables: { jobs: records } }));
  assert.equal(card(r, 'Roles on the platform'), '10,030');
  assert.equal(card(r, 'Posted this week'), '10,025');
  assert.equal(card(r, 'Posted in 30 days'), '10,030');
  assert.equal(rows(r).length, 25);
  assert.equal(pageRead(r, 'jobs').query.limit, '25');
  assert.match(r.text, /1–25 of 10,030 roles/);
  assert.ok(tableCalls(r, 'jobs', 'HEAD').every(c => c.headers.prefer.includes('count=exact')));
});

test('Jobs second and last pages reach older roles with a deterministic tie order', async () => {
  const records = jobs(1051).map(j => ({ ...j, created_at: stamp(1) }));
  const second = rendered(await render('jobs', { tables: { jobs: records }, search: { page: '2' } }));
  assert.equal(pageRead(second, 'jobs').query.order, 'created_at.desc,id.desc');
  assert.equal(pageRead(second, 'jobs').query.offset, '25');
  assert.equal(rows(second)[0].id, id(1025));
  assert.equal(second.controls.find(c => c.text === 'Previous page').href, '/jobs');
  const last = rendered(await render('jobs', { tables: { jobs: records }, search: { page: '999999' } }));
  assert.equal(rows(last).length, 1);
  assert.equal(rows(last)[0].id, id(0));
  assert.equal(last.controls.some(c => c.text === 'Next page'), false);
  assert.match(last.text, /Page 43 of 43/);
});

test('Jobs server search finds older titles and counts/continues every filtered result', async () => {
  const records = jobs(1100).map((j, i) => ({ ...j, title: i >= 1069 ? 'Senior Archive role ' + i : j.title }));
  const r = rendered(await render('jobs', { tables: { jobs: records }, search: { q: 'archive', page: '2' } }));
  assert.equal(rows(r).length, 6);
  assert.equal(rows(r)[0].id, id(1094));
  assert.match(r.text, /26–31 of 31 matching roles/);
  assert.equal(card(r, 'Roles on the platform'), '1,100');
  assert.equal(r.controls.find(c => c.text === 'Previous page').href, '/jobs?q=archive');
  const search = r.forms.find(f => f.action === '/jobs');
  assert.deepEqual(search.fields.map(f => f.name), ['q'], 'new GET searches cannot carry the old page');
  assert.equal(search.fields[0].defaultValue, 'archive');
  assert.equal(pageRead(r, 'jobs').query.title, 'imatch.archive');
});

test('Jobs search escapes wildcard/regex/operator punctuation as literal title text', async () => {
  const literal = '100%_path\\A*(B)[C]{D}.?+$^|,title.eq.other';
  const records = jobs(1100);
  records[1099].title = `Lead ${literal} engineer`;
  const r = rendered(await render('jobs', { tables: { jobs: records }, search: { q: literal } }));
  assert.equal(rows(r).length, 1);
  assert.equal(rows(r)[0].id, records[1099].id);
  const filtered = tableCalls(r, 'jobs').filter(c => c.query.title);
  assert.equal(filtered.length, 2);
  assert.equal(filtered[0].query.title, filtered[1].query.title);
  assert.ok(filtered.every(c => !c.query.or && c.entries.filter(([k]) => k === 'title').length === 1));
});

test('Jobs empty literal search, bounded input, and malformed page never invent results', async () => {
  const r = rendered(await render('jobs', { tables: { jobs: jobs(30) }, search: { q: ' not found ', page: ['2', '3'] } }));
  assert.equal(rows(r).length, 0);
  assert.match(r.text, /No matching roles on this page · Page 1 of 1/);
  assert.equal(r.controls.some(c => c.text === 'Next page'), false);
  const limited = rendered(await render('jobs', { search: { q: 'x'.repeat(150), page: 'NaN' } }));
  assert.equal(limited.forms.find(f => f.action === '/jobs').fields[0].defaultValue.length, 120);
  assert.equal(pageRead(limited, 'jobs').query.offset, '0');
});

test('Jobs page aggregates and filters explicitly describe only its bounded roles', async () => {
  const r = rendered(await render('jobs', { tables: { jobs: jobs(30) } }));
  assert.equal(card(r, 'Remote or hybrid on this page'), '25');
  assert.equal(card(r, 'Companies on this page'), '5');
  assert.match(r.desks[0].searchHint, /this page/);
  assert.match(r.text, /Companies by role count on this page/);
  assert.equal(r.desks[0].pageSize, 25);
});

test('Calls totals/weekly/live counts include sessions beyond the old 400-row slice', async () => {
  const records = calls(1401); records[1400].status = 'ringing';
  const r = rendered(await render('calls', { tables: { call_sessions: records }, search: { page: '2' } }));
  assert.equal(card(r, 'Sessions on file'), '1,401');
  assert.equal(card(r, 'This week'), '1,401');
  assert.equal(card(r, 'Live right now'), '1');
  assert.equal(rows(r).length, 25);
  assert.equal(rows(r)[0].id, id(25));
  assert.equal(pageRead(r, 'call_sessions').query.order, 'created_at.desc,id.desc');
  assert.match(r.text, /26–50 of 1,401 sessions/);
});

test('Calls rates, durations and charts name their page scope', async () => {
  const r = rendered(await render('calls', { tables: { call_sessions: calls(60) } }));
  assert.equal(card(r, 'Answer rate on this page'), '100.0%');
  assert.equal(card(r, 'Average talk time on this page'), '1:00');
  assert.match(r.text, /Sessions on this page during the last 30 days/);
  assert.match(r.text, /Connected time as the caller on this page/);
  assert.match(r.desks[0].searchHint, /this page/);
});

test('Stories live and retained totals count beyond the API cap; second page stays bounded', async () => {
  const r = rendered(await render('stories', { tables: { stories: stories(1201) }, search: { page: '2' } }));
  assert.equal(card(r, 'Stories on file'), '1,201');
  assert.equal(card(r, 'Live right now'), '1,201');
  assert.equal(card(r, 'Views on this page'), '50');
  assert.equal(rows(r).length, 25);
  assert.equal(rows(r)[0].id, id(25));
  assert.equal(pageRead(r, 'stories').query.order, 'created_at.desc,id.desc');
  assert.equal(tableCalls(r, 'admin_audit_log')[0].query.limit, '6');
});

test('Stories expired-24h count uses expiry (lower exclusive, now inclusive), not creation date', async () => {
  const records = stories(4).map((s, i) => ({ ...s, created_at: stamp(i ? 1 : 2880), expires_at: [stamp(60), stamp(2880), stamp(1440), stamp(0)][i] }));
  const r = rendered(await render('stories', { tables: { stories: records } }));
  assert.equal(card(r, 'Expired in the last 24 hours'), '2');
  assert.equal(card(r, 'Live right now'), '0');
  const read = tableCalls(r, 'stories', 'HEAD').find(c => c.entries.some(([k, v]) => k === 'expires_at' && v.startsWith('lte.')));
  assert.deepEqual(read.entries.filter(([k]) => k === 'expires_at'), [['expires_at', 'gt.' + new Date(NOW - 86400000).toISOString()], ['expires_at', 'lte.' + new Date(NOW).toISOString()]]);
  assert.equal(read.query.created_at, undefined);
});

test('Verification pending count is exact beyond 1,000; only one 25-applicant page gets safety reads', async () => {
  const apps = applications(1001);
  const r = rendered(await render('queue', { tables: { verification_applications: apps, profiles: profiles(1001) }, search: { page: '2' } }));
  assert.equal(card(r, 'Pending review'), '1,001');
  assert.equal(card(r, 'All requests'), '1,001');
  const pending = rows(r).filter(row => row.tabs.includes('pending'));
  assert.equal(pending.length, 25);
  assert.equal(pending[0].id, id(25));
  assert.equal(tableCalls(r, 'member_strikes', 'HEAD').length, 25);
  assert.equal(pageRead(r, 'verification_applications').query.order, 'created_at.asc,id.asc');
  assert.match(r.text, /26–50 of 1,001 pending requests/);
});

test('Verification safety reads execute at most four concurrently and preserve real counts', async () => {
  let active = 0, peak = 0;
  const r = rendered(await render('queue', {
    tables: { verification_applications: applications(30), profiles: profiles(30), member_strikes: [{ id: id(500), user_id: id(0) }] },
    beforeRead: async call => {
      if (!call.path.endsWith('/member_strikes')) return;
      active++; peak = Math.max(peak, active);
      await new Promise(resolve => setImmediate(resolve)); active--;
    },
  }));
  assert.equal(peak, 4); assert.equal(active, 0);
  assert.equal(rows(r).find(row => row.id === id(0)).detail.stats.find(s => s.label === 'Strikes').value, '1');
  assert.equal(rows(r).find(row => row.id === id(1)).detail.stats.find(s => s.label === 'Strikes').value, '0');
});

test('Verification missing safety counts fail before showing review actions', async () => {
  const r = await render('queue', { tables: { verification_applications: applications(10) }, omitCount: call => call.path.endsWith('/member_strikes') });
  assert.equal(r.outcome, 'threw');
  assert.match(r.error, /safety history/);
  assert.equal(r.desks, undefined);
});

test('Verification provider failure stops scheduling additional safety reads', async () => {
  let started = 0, release;
  const held = new Promise(resolve => { release = resolve; });
  const pending = render('queue', {
    tables: { verification_applications: applications(25) },
    beforeRead: async call => { if (call.path.endsWith('/member_strikes') && ++started > 1) await held; },
    respond: call => call.path.endsWith('/member_strikes') ? new Response(JSON.stringify({ message: 'Safety read failed', code: 'XXAUD' }), { status: 400 }) : undefined,
  });
  try { const r = await pending; assert.equal(r.outcome, 'threw'); assert.equal(started, 4); }
  finally { release(); }
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(started, 4);
});

test('Verification truncated referral evidence fails rather than understating vouches', async () => {
  const refs = Array.from({ length: 1001 }, (_, i) => ({ application_id: id(0), referrer_id: id(2000 + i), note: null }));
  const r = await render('queue', { tables: { verification_applications: applications(1), verification_referrals: refs } });
  assert.equal(r.outcome, 'threw');
  assert.match(r.error, /Complete verification referrals/);
});

test('Verification decision median is explicitly the latest 60 while all statuses remain exact', async () => {
  const decided = applications(70).map((a, i) => ({ ...a, id: id(2000 + i), applicant_id: id(2000 + i), status: i < 36 ? 'approved' : 'rejected', created_at: stamp(120), decided_at: stamp(i) }));
  const r = rendered(await render('queue', { tables: { verification_applications: applications(30).concat(decided) } }));
  assert.equal(card(r, 'All requests'), '100');
  assert.equal(card(r, 'Approved'), '36');
  assert.equal(card(r, 'Rejected'), '34');
  assert.equal(r.cards.find(c => c.label === 'Median recent decision').note, 'latest 60 decisions, up to 60');
  assert.equal(rows(r).filter(row => row.tabs.includes('decided')).length, 60);
});

for (const [name, table] of [['jobs', 'jobs'], ['calls', 'call_sessions'], ['stories', 'stories'], ['queue', 'verification_applications']]) {
  test(`${name}: missing count is unavailable, not zero or a page-length total`, async () => {
    const r = await render(name, { omitCount: call => call.path === '/rest/v1/' + table && call.method === 'HEAD' });
    assert.equal(r.outcome, 'threw'); assert.equal(r.cards, undefined);
  });
  test(`${name}: failed bounded row read never renders a partial report`, async () => {
    const r = await render(name, { respond: call => call.path === '/rest/v1/' + table && call.method === 'GET' ? new Response(JSON.stringify({ message: 'Required page unavailable', code: 'XXAUD' }), { status: 400 }) : undefined });
    assert.equal(r.outcome, 'threw'); assert.equal(r.cards, undefined);
  });
  test(`${name}: unauthenticated visitor cannot issue report reads`, async () => {
    const r = await render(name, { role: null });
    assert.equal(r.outcome, 'redirect'); assert.equal(tableCalls(r, table).length, 0);
  });
}

test('Page/query identity changes reset Desk selection rather than retaining an old form', async () => {
  const data = { tables: { jobs: jobs(50) } };
  const first = rendered(await render('jobs', data));
  const next = rendered(await render('jobs', { ...data, search: { page: '2' } }));
  const searched = rendered(await render('jobs', { ...data, search: { q: 'Role' } }));
  assert.notEqual(first.desks[0].key, next.desks[0].key);
  assert.notEqual(first.desks[0].key, searched.desks[0].key);
});

test('Exact-count helper rejects malformed/nonfinite/negative provider metadata', () => {
  const { exactCount } = makeHarness().load(ADMIN + '/lib/deskReporting.ts');
  for (const count of [null, NaN, Infinity, -1, 1.2, '4']) assert.throws(() => exactCount({ count, error: null }, 'Unavailable'), /Unavailable/);
  assert.equal(exactCount({ count: 0, error: null }, 'Unavailable'), 0);
});
