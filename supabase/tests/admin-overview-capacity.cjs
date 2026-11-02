// Opt-in synthetic cardinality check, not a production capacity certification.
// PC_TEST_PSQL/PGHOST/PGDATABASE must point at a disposable local pc_scale_* DB.
// PC_TEST_PROFILE_ROWS defaults to 100,000 (maximum 10,000,000).
// Writes only synthetic reporting tables in that database; no external traffic.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { LocalPsqlSession } = require('./local-psql-session.cjs');
const count = Number(process.env.PC_TEST_PROFILE_ROWS || 100000);
if (!Number.isSafeInteger(count) || count < 10000 || count > 10000000) throw new Error('Use 10,000–10,000,000 synthetic profiles.');
const migration = fs.readFileSync(path.join(__dirname, '../migrations/20261102062128_admin_overview_aggregates.sql'), 'utf8');
const AS_OF = "timestamptz '2026-11-02T01:02:03.456Z'";
const explainSql = (start, end, into) => {
  const from = migration.indexOf(start), to = migration.indexOf(end, from);
  assert.ok(from >= 0 && to > from);
  return migration.slice(from, to + end.length).replace(into, '').replaceAll('p_as_of', AS_OF);
};
const queries = {
  profile_counts: explainSql('  select jsonb_build_object(\n    \'members\'', 'from public.profiles p;', 'into profile_counts '),
  locations: explainSql('  with raw_locations as (', ') into location_counts;', 'into location_counts'),
  cohorts: explainSql("    select coalesce(jsonb_agg(to_jsonb(c)", ') c;', 'into cohort_counts'),
};
function scans(plan) {
  return [...(plan['Node Type'].includes('Scan') ? [{ node: plan['Node Type'], relation: plan['Relation Name'], index: plan['Index Name'], rows: plan['Actual Rows'], loops: plan['Actual Loops'], removed: plan['Rows Removed by Filter'] || 0 }] : []), ...(plan.Plans || []).flatMap(scans)];
}
async function run() {
  const db = new LocalPsqlSession();
  try {
    assert.equal(await db.query("select current_database() like 'pc_scale_%' and inet_server_addr() is null;"), 't');
    // Keep the test portable to minimal local PostgreSQL distributions that do
    // not bundle LLVM. This is a session setting, never a hosted change.
    await db.query("set statement_timeout='120s'; set timezone='UTC'; set jit=off;");
    await db.query(`drop function if exists public.admin_overview_summary(timestamptz,text);
      drop table if exists profiles,post_reports,listing_reports,user_reports,verification_applications cascade;
      create table profiles(id uuid,account_type text,is_verified boolean,verified_tier text,created_at timestamptz,last_seen timestamptz,location text);
      create table post_reports(created_at timestamptz); create table listing_reports(created_at timestamptz);
      create table user_reports(created_at timestamptz); create table verification_applications(created_at timestamptz,status text);
      do $$begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
        if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
        if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if; end$$;`);
    const seedStart = performance.now();
    await db.query(`insert into profiles select md5(n::text)::uuid,
      case when n%5=0 then 'business' else 'personal' end, n%3<>0,
      case n%3 when 0 then 'official' when 1 then 'business' else 'public_figure' end,
      ${AS_OF}-(n%1000)*interval '1 day',${AS_OF}-(n%1000)*interval '1 minute',
      case when n%10=0 then null else 'City '||(n%1000) end from generate_series(1,${count}) n;
      alter table profiles add primary key(id);
      insert into post_reports select ${AS_OF}-(n%365)*interval '1 day' from generate_series(1,100000) n;
      insert into listing_reports select * from post_reports; insert into user_reports select * from post_reports;
      insert into verification_applications select created_at,'submitted' from post_reports;
      analyze profiles; analyze post_reports; analyze listing_reports; analyze user_reports; analyze verification_applications;`);
    await db.query(migration);
    // The real migration supplies this index. Remove it only in the disposable
    // fixture to measure the same query before and after that change.
    await db.query('drop index public.profiles_created_at_reporting_idx;');
    const result = { synthetic: true, disclaimer: 'Local single-user read test on a narrow fixture, JIT disabled. No production, network, mixed load or global capacity claim.', profiles: count, seed_ms: Math.round(performance.now() - seedStart), version: await db.query('show server_version;'), plans: {} };
    for (const scope of ['dashboard', 'analytics']) {
      const start = performance.now();
      const text = await db.query(`select public.admin_overview_summary(${AS_OF},'${scope}');`);
      const report = JSON.parse(text); assert.equal(report.profiles.members, count);
      result[scope] = { elapsed_ms: Math.round(performance.now() - start), response_bytes: Buffer.byteLength(text), cohort_rows: report.cohorts?.length, location_rows: report.profiles.locations.length };
    }
    for (const [name, sql] of Object.entries(queries)) {
      const plan = JSON.parse(await db.query('explain (analyze,buffers,format json) ' + sql))[0];
      result.plans[name] = { execution_ms: plan['Execution Time'], scans: scans(plan.Plan), plan };
    }
    await db.query('create index profiles_created_at_reporting_idx on public.profiles(created_at); analyze profiles;');
    const plan = JSON.parse(await db.query('explain (analyze,buffers,format json) ' + queries.cohorts))[0];
    result.plans.cohorts_with_date_index = { execution_ms: plan['Execution Time'], scans: scans(plan.Plan), plan };
    const indexedStart = performance.now();
    const indexedText = await db.query(`select public.admin_overview_summary(${AS_OF},'analytics');`);
    assert.equal(JSON.parse(indexedText).profiles.members, count);
    result.analytics_with_date_index = { elapsed_ms: Math.round(performance.now() - indexedStart), response_bytes: Buffer.byteLength(indexedText) };
    const reportPath = process.env.PC_TEST_REPORT;
    if (reportPath) fs.writeFileSync(reportPath, JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify({ ...result, plans: Object.fromEntries(Object.entries(result.plans).map(([key, value]) => [key, { execution_ms: value.execution_ms, scans: value.scans }])) }, null, 2));
  } finally { await db.close(); }
}
if (require.main === module && process.env.PC_TEST_PSQL) {
  run().catch(error => { console.error(error); process.exitCode = 1; });
} else if (require.main === module) {
  console.log('Synthetic capacity check skipped: set PC_TEST_PSQL and an isolated Unix-socket pc_scale_* database to opt in.');
}
