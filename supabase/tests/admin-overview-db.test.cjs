const { test, before, beforeEach, afterEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('./rpc-authorization/node_modules/@electric-sql/pglite');
const NOW = Date.parse('2026-11-02T01:02:03.456Z'), DAY = 86400000;
const iso = value => new Date(value).toISOString();
const id = n => '20000000-0000-4000-8000-' + String(n).padStart(12, '0');
const locations = [' New\tYork ', 'new\u00a0york', 'İSTANBUL', 'i\u0307stanbul', 'ΟΣ', 'ος', '\ufeffParis\u3000', 'PARIS', '  ', null, 'Nairobi', 'London', 'Lagos', 'Cape Town', 'Montréal', 'Accra', 'Tokyo'];
const profiles = Array.from({ length: 10025 }, (_, n) => ({
  id: id(n), account_type: n % 5 === 0 ? 'business' : 'personal', is_verified: n % 3 !== 0,
  verified_tier: ['official', 'business', 'public_figure', null][n % 4],
  created_at: iso(NOW - (n % 80) * DAY),
  last_seen: n % 6 === 0 ? null : iso(NOW - (n % 80) * DAY + (n % 36) * DAY),
  location: locations[n % locations.length],
}));
// Exact millisecond boundaries, a future record and JS Date's microsecond truncation.
profiles.push(
  { ...profiles[1], id: id(20001), created_at: iso(NOW - 70 * DAY), last_seen: iso(NOW - 63 * DAY) },
  { ...profiles[1], id: id(20002), created_at: iso(NOW - 70 * DAY - 1), last_seen: null },
  { ...profiles[1], id: id(20003), created_at: iso(NOW + DAY), last_seen: iso(NOW + 29 * DAY) },
  { ...profiles[1], id: id(20004), created_at: '2026-10-12T00:00:00.000900Z', last_seen: '2026-10-19T00:00:00.000100Z' },
);
const reportTimes = Array.from({ length: 6001 }, (_, n) => ({ created_at: iso(NOW - (n % 34) * DAY) }));
for (const days of [7, 14, 30]) for (const offset of [-1, 0, 1]) reportTimes.push({ created_at: iso(NOW - days * DAY + offset) });
reportTimes.push({ created_at: iso(NOW + DAY) });
const applications = reportTimes.map((r, n) => ({ ...r, status: ['submitted', 'under_review', 'approved', 'rejected'][n % 4] }));
let db;
const migration = fs.readFileSync(path.join(__dirname, '../migrations/20261102062128_admin_overview_aggregates.sql'), 'utf8');
async function summary(scope = 'analytics') {
  return (await db.query('select admin_overview_summary($1,$2) value', [iso(NOW), scope])).rows[0].value;
}
function locationReference() {
  const groups = new Map();
  for (const p of profiles) {
    const label = (p.location || '').replace(/\s+/g, ' ').trim();
    if (!label) continue;
    const key = label.toLowerCase();
    groups.set(key, (groups.get(key) || 0) + 1);
  }
  return groups;
}
function cohortReference() {
  const groups = new Map();
  for (const p of profiles.filter(p => Date.parse(p.created_at) >= NOW - 70 * DAY)) {
    const d = new Date(p.created_at); d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7);
    const week = d.toISOString().slice(0, 10);
    if (!groups.has(week)) groups.set(week, { week, size: 0, kept: [0, 0, 0, 0] });
    const cohort = groups.get(week); cohort.size++;
    if (p.last_seen) [7, 14, 21, 28].forEach((mark, i) => {
      if ((new Date(p.last_seen).getTime() - new Date(p.created_at).getTime()) / DAY >= mark) cohort.kept[i]++;
    });
  }
  return [...groups.values()].sort((a, b) => b.week.localeCompare(a.week));
}
function weeklyReference(values) {
  const recent = values.filter(r => Date.parse(r.created_at) >= NOW - 30 * DAY);
  const days = Array.from({ length: 30 }, (_, i) => iso(NOW - (29 - i) * DAY).slice(0, 10));
  return {
    series: days.map(day => recent.filter(r => r.created_at.slice(0, 10) === day).length),
    week: recent.filter(r => Date.parse(r.created_at) >= NOW - 7 * DAY).length,
    previous_week: recent.filter(r => Date.parse(r.created_at) >= NOW - 14 * DAY && Date.parse(r.created_at) < NOW - 7 * DAY).length,
  };
}
before(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table profiles(id uuid primary key,account_type text,is_verified boolean,verified_tier text,created_at timestamptz,last_seen timestamptz,location text);
    create table post_reports(created_at timestamptz); create table listing_reports(created_at timestamptz);
    create table user_reports(created_at timestamptz); create table verification_applications(created_at timestamptz,status text);`);
  await db.query(`insert into profiles select * from jsonb_to_recordset($1::jsonb) as p(id uuid,account_type text,is_verified boolean,verified_tier text,created_at timestamptz,last_seen timestamptz,location text)`, [JSON.stringify(profiles)]);
  for (const table of ['post_reports', 'listing_reports', 'user_reports']) {
    await db.query(`insert into ${table} select * from jsonb_to_recordset($1::jsonb) as r(created_at timestamptz)`, [JSON.stringify(reportTimes)]);
  }
  await db.query('insert into verification_applications select * from jsonb_to_recordset($1::jsonb) as r(created_at timestamptz,status text)', [JSON.stringify(applications)]);
  await db.exec(migration);
});
beforeEach(async () => db.exec('begin;'));
afterEach(async () => db.exec('rollback; reset role;'));
after(async () => db?.close());

test('more than 10,000 profiles produce exact fresh totals and a small summary', async () => {
  const result = await summary();
  assert.equal(result.profiles.members, profiles.length);
  assert.equal(result.profiles.businesses, profiles.filter(p => p.account_type === 'business').length);
  assert.equal(result.profiles.verified, profiles.filter(p => p.is_verified).length);
  assert.equal(result.profiles.business_verified, profiles.filter(p => p.is_verified && p.account_type === 'business').length);
  assert.equal(result.profiles.active, profiles.filter(p => p.last_seen && Date.parse(p.last_seen) >= NOW - 5 * 60000).length);
  assert.ok(JSON.stringify(result).length < 10000);
  assert.equal(result.profiles.locations.length, 8);
  assert.ok(!JSON.stringify(result).includes(profiles[0].id));
});

test('Unicode whitespace/case grouping matches the previous JavaScript location counts', async () => {
  const result = await summary();
  const expected = locationReference();
  assert.equal(result.profiles.located, [...expected.values()].reduce((a, b) => a + b, 0));
  for (const l of result.profiles.locations) assert.equal(l.n, expected.get(l.label.toLowerCase()), l.label);
  assert.deepEqual(result.profiles.locations.map(l => l.n), [...expected.values()].sort((a, b) => b - a).slice(0, 8));
  assert.ok(result.profiles.locations.some(l => l.label.toLowerCase() === 'i\u0307stanbul'));
  assert.ok(result.profiles.locations.some(l => l.label.toLowerCase() === 'ος'));
});

test('tiers exceed the old 2,000 cap and cohorts exceed 5,000 without truncation', async () => {
  const result = await summary();
  const tiers = new Map();
  profiles.filter(p => p.is_verified).forEach(p => { const key = p.verified_tier || 'unrecorded'; tiers.set(key, (tiers.get(key) || 0) + 1); });
  assert.deepEqual(result.tiers, [...tiers].sort(([a], [b]) => a.localeCompare(b)).map(([key, n]) => ({ key, n })));
  assert.deepEqual(result.cohorts, cohortReference());
  assert.ok(result.cohorts.reduce((n, c) => n + c.size, 0) > 5000);
});

test('report/app series preserve rolling windows, UTC calendar days and future-row semantics', async () => {
  const result = await summary('dashboard');
  const expectedReports = weeklyReference([...reportTimes, ...reportTimes, ...reportTimes]);
  assert.deepEqual(result.reports, expectedReports);
  assert.deepEqual(result.verifications, {
    ...weeklyReference(applications), total: applications.length,
    reached_review: applications.filter(a => ['under_review', 'approved', 'rejected'].includes(a.status)).length,
    approved: applications.filter(a => a.status === 'approved').length,
    rejected: applications.filter(a => a.status === 'rejected').length,
  });
  assert.equal(result.reports.series.length, 30);
  assert.equal(result.cohorts, undefined);
});

test('session timezone and DST cannot alter UTC report definitions', async () => {
  const analytics = await summary(); const dashboard = await summary('dashboard');
  await db.exec("set local timezone='America/New_York';");
  assert.deepEqual(await summary(), analytics);
  assert.deepEqual(await summary('dashboard'), dashboard);
});

test('profile inserts, edits and deletes are reflected immediately without a stale cache', async () => {
  await db.query("insert into profiles(id,account_type,is_verified,verified_tier,location,created_at,last_seen) values($1,'business',true,'official','New York',$2,$2)", [id(30000), iso(NOW)]);
  let result = await summary();
  assert.equal(result.profiles.members, profiles.length + 1);
  assert.equal(result.profiles.located, [...locationReference().values()].reduce((a, b) => a + b, 0) + 1);
  await db.query('update profiles set is_verified=false,location=null where id=$1', [id(30000)]);
  result = await summary();
  assert.equal(result.profiles.verified, profiles.filter(p => p.is_verified).length);
  await db.query('delete from profiles where id=$1', [id(30000)]);
  assert.equal((await summary()).profiles.members, profiles.length);
});

test('only the staff service can call the report; invalid or oversized input fails closed', async () => {
  for (const role of ['anon', 'authenticated']) {
    await db.exec('savepoint denied; set local role ' + role);
    await assert.rejects(summary(), /permission denied/);
    await db.exec('rollback to savepoint denied; reset role;');
  }
  await db.exec('set local role service_role;');
  assert.equal((await summary()).profiles.members, profiles.length);
  await db.exec('reset role;');
  for (const [time, scope] of [[null, 'dashboard'], ['infinity', 'dashboard'], [iso(NOW), 'other']]) {
    await db.exec('savepoint invalid;');
    await assert.rejects(db.query('select admin_overview_summary($1,$2)', [time, scope]), /INVALID_REPORT_ARGUMENT/);
    await db.exec('rollback to savepoint invalid;');
  }
  await db.exec(`insert into profiles(id,created_at) select gen_random_uuid(),timestamptz '2030-01-07' + n * interval '1 week' from generate_series(1,1001) n;`);
  await assert.rejects(summary(), /REPORT_DIMENSIONS_EXCEED_LIMIT/);
});
