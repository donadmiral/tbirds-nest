const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const {PGlite}=require('../../supabase/tests/rpc-authorization/node_modules/@electric-sql/pglite');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('recruiter pagination reports all status counts and decisions enforce ownership, concurrency, withdrawal and exactly-once notifications',async()=>{
 const db=new PGlite();try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE SCHEMA auth;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 CREATE FUNCTION studio_require(text[]) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF; END;$$;
 CREATE TABLE jobs(id uuid PRIMARY KEY,posted_by uuid,title text);
 CREATE TABLE profiles(id uuid PRIMARY KEY,full_name text,username text,avatar_url text,bio text,location text);
 CREATE TABLE job_applications(id uuid PRIMARY KEY,job_id uuid,applicant_id uuid,status text,applied_at timestamptz,updated_at timestamptz,interview_at timestamptz,interview_location text);
 CREATE TABLE studio_applicant_tags(application_id uuid,tag text);
 CREATE TABLE business_access_members(id uuid,display_name text);
 CREATE TABLE studio_applicant_notes(id uuid,application_id uuid,body text,created_at timestamptz,author_member_id uuid);
 CREATE TABLE notifications(id bigint GENERATED ALWAYS AS IDENTITY,recipient_id uuid,actor_id uuid,type text,message text,data jsonb);
 INSERT INTO jobs VALUES('${id(10)}','${id(1)}','Engineer');
 INSERT INTO profiles VALUES('${id(2)}','Applicant','applicant',null,'Bio','Harare');`);
 await db.exec(fs.readFileSync(path.join(__dirname,'../../supabase/migrations/20261022211637_hiring_workflow_quality.sql'),'utf8'));
 for(let i=100;i<162;i++)await db.query('INSERT INTO job_applications(id,job_id,applicant_id,status,applied_at,updated_at) VALUES($1,$2,$3,$4,$5,$5)',[id(i),id(10),id(2),i<130?'applied':'screening','2026-01-01T12:00:00.123456Z']);
 const as=user=>db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[id(user)]);
 const value=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
 await as(3);await assert.rejects(db.query('SELECT studio_applicant_page($1)',[id(10)]),/Only the job owner/);
 await as(1);let cursor=null,all=[];
 do{const page=(await value('SELECT studio_applicant_page($1,$2,$3,$4,$5) page',[id(10),'all',cursor?.applied_at??null,cursor?.id??null,25])).page;
 assert.equal(page.counts.all,62);assert.equal(page.counts.applied,30);assert.ok(page.applications.length<=25);all.push(...page.applications);cursor=page.cursor;}while(cursor);
 assert.equal(all.length,62);assert.equal(new Set(all.map(row=>row.id)).size,62);
 const screened=(await value('SELECT studio_applicant_page($1,$2) page',[id(10),'screening'])).page;assert.equal(screened.counts.screening,32);assert.ok(screened.applications.every(row=>row.status==='screening'));
 const at='2027-01-01T10:00:00Z';let scheduled=(await value('SELECT studio_schedule_interview($1,$2,$3,$4,$5) app',[id(100),at,' Harare ',all.find(row=>row.id===id(100)).updated_at,'applied'])).app;
 assert.equal(scheduled.status,'interview');assert.equal(scheduled.interview_location,'Harare');assert.equal((await value('SELECT count(*)::int n FROM notifications')).n,1);
 await db.query('SELECT studio_schedule_interview($1,$2,$3,$4,$5)',[id(100),at,'Harare','2026-01-01T12:00:00.123456Z','applied']);assert.equal((await value('SELECT count(*)::int n FROM notifications')).n,1);
 await assert.rejects(db.query('SELECT studio_schedule_interview($1,$2,$3,$4,$5)',[id(100),'2027-02-01','Elsewhere','2026-01-01T12:00:00.123456Z','applied']),/Application changed/);
 await assert.rejects(db.query('SELECT studio_schedule_interview($1,$2,$3)',[id(101),'2020-01-01','office']),/future interview/);
 await db.query('UPDATE job_applications SET status=$1 WHERE id=$2',['withdrawn',id(102)]);
 await assert.rejects(db.query('SELECT studio_schedule_interview($1,$2,$3)',[id(102),at,'office']),/withdrawn/);
 await assert.rejects(db.query('SELECT studio_set_stage($1,$2)',[id(102),'hired']),/withdrawn/);
 await assert.rejects(db.query('UPDATE job_applications SET status=$1 WHERE id=$2',['applied',id(102)]),/cannot be reopened/);
 await as(3);await assert.rejects(db.query('SELECT studio_schedule_interview($1,$2,$3)',[id(103),at,'office']),/Not your application/);
 await as(1);await db.query('SELECT studio_update_application($1,$2,$3,$4)',[id(103),'offer','applied','2026-01-01T12:00:00.123456Z']);
 await db.query('SELECT studio_set_stage($1,$2)',[id(103),'offer']);assert.equal((await value('SELECT count(*)::int n FROM notifications')).n,2);
 await db.query('SELECT studio_schedule_interview($1,$2,$3)',[id(100),null,null]);assert.equal((await value('SELECT status FROM job_applications WHERE id=$1',[id(100)])).status,'screening');
 }finally{await db.close();}
});
function helper(){const module={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../../shared/hiring.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,Date});return module.exports;}
test('shared clients pass full cursor and concurrency tokens; invalid deep links cannot fetch',async()=>{
 const h=helper(),calls=[],client={rpc:async(name,args)=>{calls.push({name,args});return {data:name==='studio_applicant_page'?{applications:[],counts:{all:2500},has_more:false,cursor:null}:{id:id(100),status:'interview'}};}};
 await assert.rejects(h.loadApplicantPage(client,'not-a-job'));assert.equal(calls.length,0);
 await h.loadApplicantPage(client,id(10),'screening',{id:id(100),applied_at:'2026-01-01T00:00:00Z'});assert.equal(calls[0].args.p_limit,25);assert.equal(calls[0].args.p_before_id,id(100));
 await h.saveInterview(client,{id:id(100),status:'applied',updated_at:'2026-01-01T00:00:00Z'},'2027-01-01T10:00:00Z','Harare');assert.equal(calls[1].args.p_expected_status,'applied');assert.ok(calls[1].args.p_expected_updated_at);
 const merged=h.mergeApplicants([{id:'1',status:'old'}],[{id:'1',status:'new'},{id:'2'}]);assert.equal(merged.length,2);assert.equal(merged[0].status,'new');
});
