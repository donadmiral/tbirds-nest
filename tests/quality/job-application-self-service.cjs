const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { PGlite } = require('../../supabase/tests/rpc-authorization/node_modules/@electric-sql/pglite');
const root = path.join(__dirname, '../..');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    GRANT USAGE ON SCHEMA auth TO authenticated,anon;
    CREATE FUNCTION studio_require(text[]) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF; END;$$;
    CREATE TABLE jobs(id uuid PRIMARY KEY,posted_by uuid,title text);
    CREATE TABLE profiles(id uuid PRIMARY KEY,full_name text,username text,avatar_url text,bio text,location text);
    CREATE TABLE job_applications(id uuid PRIMARY KEY,job_id uuid,applicant_id uuid,status text,applied_at timestamptz,updated_at timestamptz,interview_at timestamptz,interview_location text,cover_note text);
    CREATE TABLE studio_applicant_tags(application_id uuid,tag text);
    CREATE TABLE business_access_members(id uuid,display_name text);
    CREATE TABLE studio_applicant_notes(id uuid,application_id uuid,body text,created_at timestamptz,author_member_id uuid);
    CREATE TABLE notifications(id bigint GENERATED ALWAYS AS IDENTITY,recipient_id uuid,actor_id uuid,type text,message text,data jsonb);
    ALTER TABLE job_applications ENABLE ROW LEVEL SECURITY;
    CREATE POLICY own_read ON job_applications FOR SELECT USING(applicant_id=auth.uid() OR EXISTS(SELECT 1 FROM jobs WHERE jobs.id=job_id AND posted_by=auth.uid()));
    CREATE POLICY own_update ON job_applications FOR UPDATE USING(applicant_id=auth.uid());
    CREATE POLICY job_apps_delete ON job_applications FOR DELETE USING(applicant_id=auth.uid());
    GRANT SELECT,UPDATE,DELETE ON job_applications TO authenticated;
    GRANT SELECT ON jobs TO authenticated;
    INSERT INTO jobs VALUES('${id(10)}','${id(1)}','Engineer');
    INSERT INTO profiles VALUES('${id(2)}','Applicant','applicant',null,'Bio','Harare');
  `);
  await db.exec(fs.readFileSync(path.join(root, 'supabase/migrations/20261022211637_hiring_workflow_quality.sql'), 'utf8'));
  await db.exec(fs.readFileSync(path.join(root, 'supabase/migrations/20261025073234_applicant_self_service_quality.sql'), 'utf8'));
  return db;
}
const as = async (db, user) => {
  await db.exec('RESET ROLE');
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [user ? id(user) : '']);
  await db.exec('SET ROLE authenticated');
};
const scalar = async (db, sql, args = []) => (await db.query(sql, args)).rows[0];

test('applicant pages are private, bounded and stable across ties, inserts and null legacy dates', async () => {
  const db = await fixture();
  try {
    for (let i = 100; i < 162; i++) await db.query('INSERT INTO job_applications(id,job_id,applicant_id,status,applied_at,updated_at) VALUES($1,$2,$3,$4,$5,$5)',
      [id(i),id(10),id(2),i < 130 ? 'applied' : 'screening', i < 160 ? '2026-01-01T12:00:00.123456Z' : null]);
    await db.query('INSERT INTO job_applications(id,job_id,applicant_id,status,applied_at) VALUES($1,$2,$3,$4,now())', [id(500),id(10),id(3),'applied']);
    await as(db, 2);
    let cursor = null, all = [], pages = 0;
    do {
      const page = (await scalar(db, 'SELECT my_application_page($1,$2,$3,$4) page', ['all',cursor?.applied_at ?? null,cursor?.id ?? null,25])).page;
      assert.ok(page.applications.length <= 25);
      assert.ok(page.applications.every(row => row.applicant_id === id(2)));
      all.push(...page.applications); cursor = page.cursor;
      if (++pages === 1) {
        await db.exec('RESET ROLE');
        await db.query('INSERT INTO job_applications(id,job_id,applicant_id,status,applied_at) VALUES($1,$2,$3,$4,now())', [id(600),id(10),id(2),'applied']);
        await db.exec('SET ROLE authenticated');
      }
    } while (cursor);
    assert.equal(all.length, 62); assert.equal(new Set(all.map(a => a.id)).size, 62);
    assert.equal(all.at(-1).applied_at, null);
    assert.equal(all[0].job.title, 'Engineer');
    const filtered = (await scalar(db, "SELECT my_application_page('screening',null,null,500) page")).page;
    assert.equal(filtered.applications.length, 32);
    assert.ok(filtered.applications.every(a => a.status === 'screening'));
    assert.equal((await scalar(db, 'SELECT my_application_page($1,$2,$3,$4) page', ['all',null,null,500])).page.applications.length,50);
    await assert.rejects(db.query("SELECT my_application_page('all',now(),null)"), /complete finite page cursor/);
    await assert.rejects(db.query("SELECT my_application_page('all','infinity',$1)", [id(100)]), /complete finite page cursor/);
    await as(db, 3);
    assert.equal((await scalar(db, 'SELECT my_application_page() page')).page.applications.length,1);
    await as(db, null);
    await assert.rejects(db.query('SELECT my_application_page()'), /Authentication required/);
  } finally { await db.close(); }
});

test('withdrawal requires applicant ownership and fresh state; retry retains history with one audit event and receipt', async () => {
  const db = await fixture();
  try {
    await db.query(`INSERT INTO job_applications VALUES($1,$2,$3,'interview',$4,$4,'2027-01-01','Harare','Original application')`, [id(100),id(10),id(2),'2026-01-01']);
    await db.query(`INSERT INTO job_applications VALUES($1,$2,$3,'hired',$4,$4,null,null,'Hired')`, [id(101),id(10),id(2),'2026-01-01']);
    await as(db, 1);
    await assert.rejects(db.query('SELECT withdraw_job_application($1,$2,$3)', [id(100),'interview','2026-01-01']), /Not your application/);
    await as(db, 3);
    await assert.rejects(db.query('SELECT withdraw_job_application($1,$2,$3)', [id(100),'interview','2026-01-01']), /Not your application/);
    await as(db, 2);
    await assert.rejects(db.query('SELECT withdraw_job_application($1,$2,$3)', [id(100),'applied','2026-01-01']), /Application changed/);
    await assert.rejects(db.query('SELECT withdraw_job_application($1,$2,$3)', [id(100),'interview','2025-01-01']), /Application changed/);
    await assert.rejects(db.query('SELECT withdraw_job_application($1,$2,$3)', [id(101),'hired','2026-01-01']), /already closed/);
    const saved = (await scalar(db, 'SELECT withdraw_job_application($1,$2,$3) app', [id(100),'interview','2026-01-01'])).app;
    assert.equal(saved.status,'withdrawn'); assert.equal(saved.interview_location,'Harare');
    assert.equal(saved.cover_note,'Original application'); assert.ok(saved.interview_at);
    const replay = (await scalar(db, 'SELECT withdraw_job_application($1,$2,$3) app', [id(100),'interview','2026-01-01'])).app;
    assert.equal(replay.updated_at,saved.updated_at);
    assert.equal((await scalar(db, 'SELECT count(*)::int n FROM job_application_events')).n,1);
    await assert.rejects(db.query('DELETE FROM job_applications WHERE id=$1',[id(100)]),/permission denied/);
    await assert.rejects(db.query('DELETE FROM job_application_events'),/permission denied/);
    await assert.rejects(db.query("UPDATE job_applications SET status='applied' WHERE id=$1",[id(100)]),/cannot be reopened/);
    await as(db, 3);
    assert.equal((await scalar(db, 'SELECT count(*)::int n FROM job_application_events')).n,0);
    await as(db, 1);
    assert.equal((await scalar(db, 'SELECT count(*)::int n FROM job_application_events')).n,1);
    await db.exec('RESET ROLE');
    const receipt = (await db.query('SELECT * FROM notifications')).rows;
    assert.equal(receipt.length,1); assert.equal(receipt[0].recipient_id,id(1));
    assert.equal(receipt[0].data.status,'withdrawn');
    const event = (await db.query('SELECT * FROM job_application_events')).rows[0];
    assert.equal(event.actor_id,id(2)); assert.equal(event.previous_status,'interview');
    await db.exec('SET ROLE anon');
    await assert.rejects(db.query('SELECT my_application_page()'),/permission denied/);
    await assert.rejects(db.query('SELECT withdraw_job_application($1)',[id(100)]),/permission denied/);
  } finally { await db.close(); }
});

function helpers() {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,'shared/hiring.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,Date});
  return module.exports;
}
test('application clients propagate errors, validate pagination and send concurrency tokens', async () => {
  const h = helpers(), calls = [];
  const client = { rpc: async (name,args) => {
    calls.push({name,args});
    return {data: name === 'my_application_page' ? {applications:[],has_more:false,cursor:null} : {id:args.p_application,status:'withdrawn'}};
  }};
  await h.loadMyApplicationPage(client,{id:id(100),applied_at:'2026-01-01'},'interview');
  assert.equal(calls[0].args.p_before_id,id(100)); assert.equal(calls[0].args.p_limit,25);
  assert.equal(calls[0].args.p_status,'interview');
  const saved = await h.withdrawApplication(client,{id:id(100),status:'interview',updated_at:'2026-01-01',job:{title:'Engineer'}});
  assert.equal(saved.job.title,'Engineer'); assert.equal(calls[1].args.p_expected_status,'interview');
  assert.equal(calls[1].args.p_expected_updated_at,'2026-01-01');
  await assert.rejects(h.loadMyApplicationPage({rpc:async()=>({error:{message:'Network unavailable'}})}),/Network unavailable/);
  await assert.rejects(h.loadMyApplicationPage({rpc:async()=>({data:{applications:[],has_more:true,cursor:null}})}),/could not be loaded/);
  await assert.rejects(h.withdrawApplication({rpc:async()=>({error:{code:'40001'}})},{id:id(100),status:'interview'}),/changed/);
  for(const status of ['hired','accepted','rejected','withdrawn']) assert.equal(h.canWithdrawApplication(status),false);
  assert.equal(h.canWithdrawApplication('interview'),true);
});
