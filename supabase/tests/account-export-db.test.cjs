const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require(process.env.PGLITE_MODULE || path.join(__dirname,'rpc-authorization/node_modules/@electric-sql/pglite/dist/index.cjs'));
const A='10000000-0000-4000-8000-000000000001', B='10000000-0000-4000-8000-000000000002';
const P='20000000-0000-4000-8000-000000000001', Q='20000000-0000-4000-8000-000000000002';
let db;
before(async()=>{
 db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key,email text,created_at timestamptz,encrypted_password text);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema public,auth to authenticated,anon,service_role;
 create table public.profiles(id uuid,email text,full_name text,username text,avatar_url text,banner_url text,bio text,headline text,location text,interests text[],account_type text,profile_visibility text,degree_program text,graduation_year integer,institution text,workplace text,school text,created_at timestamptz,updated_at timestamptz,push_token text);
 create table public.posts(id uuid,user_id uuid,body text,content text,image_url text,media_url text,created_at timestamptz,updated_at timestamptz,scope text,account_type text,channel text,quoted_post_id uuid,thread_parent_id uuid,article_title text,read_minutes integer);
 create table public.post_media(id uuid,post_id uuid,url text,media_type text,sort_order integer,created_at timestamptz,width integer,height integer,alt_text text,is_sensitive boolean);
 create table public.post_comments(id uuid,post_id uuid,user_id uuid,body text,content text,parent_comment_id uuid,created_at timestamptz);
 create table public.post_likes(id uuid,post_id uuid,user_id uuid,created_at timestamptz);
 create table public.post_bookmarks(id uuid,post_id uuid,user_id uuid,created_at timestamp,collection_id uuid);
 create table public.post_reposts(id uuid,post_id uuid,user_id uuid,created_at timestamp);
 create table public.follows(id uuid,follower_id uuid,following_id uuid,created_at timestamptz);
 create table public.stories(id uuid,user_id uuid,media_url text,media_type text,thumbnail_url text,duration_sec integer,caption text,expires_at timestamptz,created_at timestamptz,stickers_json jsonb,text_background jsonb,media_transform jsonb,category text,dual_front_url text,dual_layout jsonb,allow_replies boolean,allow_reactions boolean,allow_sharing boolean,audience text,reach text);
 create table public.story_views(story_id uuid,user_id uuid,viewed_at timestamptz);
 create table public.messages(id uuid,conversation_id uuid,sender_id uuid,text text,media_url text,created_at timestamptz);
 create table public.marketplace_listings(id uuid,seller_id uuid,title text,description text,price numeric,currency text,category text,condition text,location_city text,images text[],status text,created_at timestamptz,updated_at timestamptz,delivery_available boolean,delivery_fee numeric,delivery_note text);
 create table public.job_applications(id uuid,job_id uuid,applicant_id uuid,status text,cover_note text,cover_letter text,applied_at timestamptz,updated_at timestamptz,interview_at timestamptz,interview_location text);
 create table public.support_tickets(id uuid,user_id uuid,subject text,message text,body text,kind text,status text,created_at timestamptz,updated_at timestamptz,resolution_note text,resolved_at timestamptz);
 create table public.blocked_users(blocker_id uuid,blocked_id uuid,created_at timestamptz);
 create table public.user_push_tokens(id uuid,user_id uuid,device_name text,platform text,created_at timestamp,expo_push_token text,voip_token text);
 grant select on all tables in schema public to authenticated;
 alter table public.posts enable row level security;
 insert into auth.users values('${A}','a@example.test',null,'secret-password'),('${B}','b@example.test',null,'secret-password');
 insert into public.profiles(id,email,push_token) values('${A}','a@example.test','secret-profile-token'),('${B}','b@example.test','secret-profile-token');
 insert into public.posts(id,user_id,body) values('${P}','${A}','own post'),('${Q}','${B}','foreign post');
 insert into public.post_media(id,post_id,url) values('${P}','${P}','own-media'),('${Q}','${Q}','foreign-media');
 insert into public.messages(id,sender_id,text) values('${P}','${A}','own message'),('${Q}','${B}','foreign message');
 insert into public.marketplace_listings(id,seller_id,title) values('${P}','${A}','own listing'),('${Q}','${B}','foreign listing');
 insert into public.stories(id,user_id,caption) values('${P}','${A}','own story'),('${Q}','${B}','foreign story');
 insert into public.story_views(story_id,user_id) values('${Q}','${A}'),('${P}','${B}');
 insert into public.user_push_tokens(id,user_id,device_name,expo_push_token,voip_token) values('${P}','${A}','test phone','secret-expo-token','secret-voip-token');`);
 await db.exec(fs.readFileSync(path.join(__dirname,'../migrations/20261022173052_account_export_snapshot.sql'),'utf8'));
 await db.exec(`create schema cron;
   create table cron.test_jobs(name text, cadence text, command text);
   create function cron.schedule(text,text,text) returns bigint language sql as
     $$ insert into cron.test_jobs values ($1,$2,$3) returning 1::bigint $$;`);
 await db.exec(fs.readFileSync(path.join(__dirname,'../migrations/20261106230356_private_account_export_parts.sql'),'utf8'));
});
after(async()=>{await db?.close();});
async function as(role,uid,run){await db.exec('begin');try{await db.query("select set_config('request.jwt.claim.sub',$1,true)",[uid||'']);await db.exec('set local role '+role);return await run();}finally{await db.exec('rollback');}}
async function snapshot(){return(await db.query('select public.account_export_snapshot() as value')).rows[0].value;}
test('caller-only rows include NULL timestamps and retained posts hidden by feed RLS',async()=>{
 await as('authenticated',A,async()=>{
  assert.equal((await db.query('select count(*)::integer as count from public.posts')).rows[0].count,0);
  const x=await snapshot();assert.equal(x.account.id,A);assert.equal(x.profile.id,A);assert.equal(x.posts.length,1);assert.equal(x.posts[0].body,'own post');assert.equal(x.posts[0].created_at,null);
  assert.equal(x.post_media[0].url,'own-media');assert.equal(x.messages_sent[0].text,'own message');assert.equal(x.listings[0].title,'own listing');assert.equal(x.story_views_given[0].story_id,Q);
  for(const [name,count] of Object.entries(x.collection_counts))assert.equal(count,x[name].length,name);
  assert.equal(Object.keys(x.collection_counts).length,16);assert.equal(x.export_status,'complete');assert.equal(x.records_through,x.exported_at);
  assert.doesNotMatch(JSON.stringify(x),/foreign|secret-/);
 });
 await as('authenticated',B,async()=>{const x=await snapshot();assert.equal(x.messages_sent[0].text,'foreign message');assert.equal(x.account.id,B);assert.equal(x.push_devices.length,0);});
});
test('anonymous, service and missing or deleted caller cannot export; no owner parameter exists',async()=>{
 for(const role of ['anon','service_role'])await assert.rejects(as(role,A,snapshot),/permission denied/);
 await assert.rejects(as('authenticated','',snapshot),/AUTH_REQUIRED/);
 await assert.rejects(as('authenticated','10000000-0000-4000-8000-000000000099',snapshot),/ACCOUNT_NOT_FOUND/);
 await assert.rejects(as('authenticated',A,()=>db.query('select public.account_export_snapshot($1)',[B])),/does not exist/);
});
test('SQL entrypoints are zero-argument STABLE, with definer limited to private schema',async()=>{
 const rows=(await db.query("select n.nspname,p.proname,p.provolatile,p.prosecdef,p.pronargs,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='account_export' and p.proname='snapshot') or (n.nspname='public' and p.proname='account_export_snapshot') order by n.nspname")).rows;
 assert.equal(rows.length,2);for(const r of rows){assert.equal(r.provolatile,'s');assert.equal(r.pronargs,0);assert.deepEqual(r.proconfig,['search_path=""']);}
 assert.equal(rows[0].prosecdef,true);assert.equal(rows[1].prosecdef,false);
});
test('rows beyond 5000 remain complete and crossing the combined cap fails',async()=>{
 await db.exec('begin');try{
  await db.exec(`insert into public.posts(id,user_id,body) select gen_random_uuid(),'${A}','extra' from generate_series(1,5000);`);
  await db.query("select set_config('request.jwt.claim.sub',$1,true)",[A]);
  const x=await snapshot();assert.equal(x.posts.length,5001);assert.equal(x.collection_counts.posts,5001);
  await db.exec(`insert into public.posts(id,user_id) select gen_random_uuid(),'${A}' from generate_series(1,45000);`);
  await assert.rejects(snapshot(),/EXPORT_TOO_LARGE/);
 }finally{await db.exec('rollback');}
});
test('oversized content fails before an archive can leave the database',async()=>{
 await db.exec('begin');try{
  await db.query("update public.posts set body=repeat('x',16777216) where id=$1",[P]);
  await db.query("select set_config('request.jwt.claim.sub',$1,true)",[A]);
  await assert.rejects(snapshot(),/EXPORT_TOO_LARGE/);
 }finally{await db.exec('rollback');}
});
test('one statement snapshot cannot mix in a write from its own data-modifying CTE',async()=>{
 await db.exec('begin');try{
  await db.query("select set_config('request.jwt.claim.sub',$1,true)",[A]);
  const row=(await db.query(`with inserted as (insert into public.posts(id,user_id,body) values(gen_random_uuid(),'${A}','inserted during statement') returning id) select (select count(*) from inserted)::integer as inserted,public.account_export_snapshot() as value`)).rows[0];
  assert.equal(row.inserted,1);assert.equal(row.value.posts.length,1);assert.equal((await snapshot()).posts.length,2);
 }finally{await db.exec('rollback');}
});

async function caller(uid) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [uid]);
  await db.exec('set local role authenticated');
}
async function requestArchive() {
  return (await db.query('select public.request_account_archive() as id')).rows[0].id;
}
async function readArchive(id, part = null) {
  return (await db.query('select public.read_account_archive($1,$2) as value',[id,part])).rows[0].value;
}
async function workOne() {
  await db.exec('reset role');
  return (await db.query('select account_export.work_one() as result')).rows[0].result;
}

test('multipart export covers every projected field, contains only caller data and stays immutable', async () => {
  await db.exec('begin');
  try {
    await caller(A);
    const expected = await snapshot();
    const job = await requestArchive();
    assert.equal(await requestArchive(), job);
    assert.equal((await readArchive(job)).status, 'queued');
    assert.equal(await workOne(), true);
    assert.equal(await workOne(), false);
    await db.query("update public.posts set body = 'later content' where id = $1", [P]);
    await caller(A);
    const manifest = await readArchive(job);
    assert.equal(manifest.status, 'ready');
    assert.equal(manifest.owner_id, A);
    assert.deepEqual(manifest.collection_counts, expected.collection_counts);
    const part = await readArchive(job, 0);
    assert.equal(part.next_part, null);
    assert.equal(Buffer.byteLength(part.content), manifest.byte_count);
    assert.doesNotMatch(part.content, /secret-|foreign|later content/);
    const lines = part.content.trimEnd().split('\n').map(line => JSON.parse(line));
    for (const [name, count] of Object.entries(manifest.collection_counts)) {
      const payloads = lines.filter(line => line.collection === name).map(line => line.record);
      assert.equal(payloads.length, count);
      assert.deepEqual(payloads, expected[name]);
    }
    for (const name of ['profile','account']) assert.deepEqual(lines.find(l => l.collection === name).record, expected[name]);
  } finally { await db.exec('rollback'); }
});

test('worker splits unicode and large individual rows, complete beyond the immediate record cap', async () => {
  await db.exec('begin');
  try {
    await db.exec(`insert into public.post_likes(id,user_id,post_id)
      select gen_random_uuid(),'${A}','${P}' from generate_series(1,50001)`);
    await db.query("update public.posts set body=repeat('😀',150000) where id=$1",[P]);
    await caller(A);
    const job = await requestArchive();
    await workOne();
    await caller(A);
    const manifest = await readArchive(job);
    assert.equal(manifest.collection_counts.likes,50001);
    assert.ok(manifest.part_count > 2);
    const chunks = [];
    for (let n = manifest.next_part; n !== null;) {
      const part = await readArchive(job, n);
      assert.equal(part.part_number, chunks.length);
      assert.equal(part.id, job);
      assert.equal(part.owner_id,A);
      assert.ok(Buffer.byteLength(part.content) <= 262144);
      if (!n) assert.deepEqual(await readArchive(job, n), part);
      chunks.push(part.content);
      n = part.next_part;
    }
    assert.equal(chunks.length, manifest.part_count);
    const archive = chunks.join('');
    assert.equal(Buffer.byteLength(archive), manifest.byte_count);
    const lines = archive.trimEnd().split('\n').map(line => JSON.parse(line));
    const ids = lines.filter(line => line.collection === 'likes').map(line => line.record.id);
    assert.equal(new Set(ids).size, 50001);
    assert.deepEqual(ids, [...ids].sort());
    assert.equal(lines.find(line => line.collection === 'posts').record.body,'😀'.repeat(150000));
  } finally { await db.exec('rollback'); }
});

test('foreign manifests, part guesses, SQL helpers, table reads and anonymous calls are denied', async () => {
  let job;
  try {
    await db.exec('begin'); await caller(A);
    job = await requestArchive(); await workOne(); await db.exec('commit');
    for (const part of [null,0]) {
      await assert.rejects(as('authenticated',B,() => readArchive(job,part)),/ARCHIVE_NOT_FOUND/);
    }
    for (const role of ['anon','service_role']) {
      await assert.rejects(as(role,A,requestArchive), /permission denied/);
      await assert.rejects(as(role,A,() => readArchive(job,0)), /permission denied/);
    }
    for (const sql of ['select * from account_export.parts','select * from account_export.jobs',
      'select account_export.work_one()',`select * from account_export.archive_rows('${B}')`]) {
      await assert.rejects(as('authenticated',A,() => db.query(sql)), /permission denied/);
    }
    for (const part of [-1,1]) await assert.rejects(as('authenticated',A,() => readArchive(job,part)), /PART_UNAVAILABLE/);
    await db.query("update account_export.jobs set expires_at=now()-interval '1 hour' where id=$1",[job]);
    await assert.rejects(as('authenticated',A,() => readArchive(job,0)), /ARCHIVE_NOT_FOUND/);
    await db.query('select account_export.work_one()');
    assert.equal((await db.query('select count(*)::integer as n from account_export.parts where job_id=$1',[job])).rows[0].n,0);
  } finally { if (job) await db.query('delete from account_export.jobs where id=$1',[job]); }
});
