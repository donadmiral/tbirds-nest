const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('./rpc-authorization/node_modules/@electric-sql/pglite');
const A='81000000-0000-4000-8000-000000000001',B='81000000-0000-4000-8000-000000000002',C='81000000-0000-4000-8000-000000000003';
const POST='82000000-0000-4000-8000-000000000001',GROUP='83000000-0000-4000-8000-000000000001',GROUPPOST='82000000-0000-4000-8000-000000000002';
const migration=fs.readFileSync(path.join(__dirname,'../migrations/20261026064639_post_media_edit_projections.sql'),'utf8');
const signatures=['get_feed(text,double precision,uuid,integer)','get_discover_page(text,boolean,integer,integer,timestamp with time zone)','get_profile_posts(uuid,timestamp with time zone,integer)','get_profile_posts_page(uuid,integer,integer,timestamp with time zone)','get_community_posts(uuid,timestamp with time zone,integer)','get_community_posts_page(uuid,integer,integer,timestamp with time zone)','search_posts(text,text,timestamp with time zone,uuid,integer)','search_posts_page(text,text,integer,integer,timestamp with time zone)'];
const edit={rotation:90,flipX:true,scale:1.25,translateNX:.05,filterId:'warm',filterAmt:55,adjust:{bri:10},trimStart:2,trimEnd:9,speed:1.5,coverUrl:'https://example.test/cover.jpg',soundtrack:{soundId:'84000000-0000-4000-8000-000000000001',startSec:3,durationSec:6,volume:.7,originalVolume:.3}};
const accessMigration=fs.readFileSync(path.join(__dirname,'../migrations/20261028153700_discover_media_access_guards.sql'),'utf8');
let db,before,afterProjection;
async function as(uid,sql){await db.exec('begin');try{await db.query("select set_config('request.jwt.claim.sub',$1,true)",[uid]);await db.query("select set_config('request.jwt.claim.role','authenticated',true)");await db.exec('set local role authenticated');const r=await db.query(sql);await db.exec('commit');return r.rows;}catch(e){await db.exec('rollback');throw e;}}
async function definitions(){const result=[];for(const s of signatures)result.push((await db.query('select pg_get_functiondef($1::regprocedure) source,proacl::text acl from pg_proc where oid=$1::regprocedure',['public.'+s])).rows[0]);return result;}
test.before(async()=>{
 const {extensions,loadLiveSchema}=await import('./rpc-authorization/live-schema-fixture.mjs');db=new PGlite({extensions});await loadLiveSchema(db);await db.exec("grant usage on schema auth to authenticated;grant execute on all functions in schema auth to authenticated;");
 for(const name of fs.readdirSync(path.join(__dirname,'../migrations')).filter(n=>/^202610(22|23|25)\d+.*\.sql$/.test(n)).sort())await db.exec(fs.readFileSync(path.join(__dirname,'../migrations',name),'utf8'));
 before=await definitions();await db.exec(migration);afterProjection=await definitions();await db.exec(accessMigration);
 await db.exec(`insert into auth.users(id,email) values('${A}','author@example.test'),('${B}','viewer@example.test'),('${C}','stranger@example.test');
 insert into profiles(id,email,full_name,username) values('${A}','author@example.test','Projection author','projection_author'),('${B}','viewer@example.test','Viewer','projection_viewer'),('${C}','stranger@example.test','Stranger','projection_stranger') on conflict(id) do update set full_name=excluded.full_name,username=excluded.username;
 insert into communities(id,name,created_by,owner_id,status,join_mode) values('${GROUP}','Projection group','${A}','${A}','active','open');
 insert into community_members(community_id,user_id,role,status) values('${GROUP}','${A}','owner','active'),('${GROUP}','${B}','member','active') on conflict do nothing;
 insert into posts(id,user_id,content,category,created_at,community_id) values('${POST}','${A}','Projection test public','comedy','2026-01-01',null),('${GROUPPOST}','${A}','Projection test group','comedy','2026-01-01','${GROUP}');`);
 for(const [i,post] of [POST,GROUPPOST].entries())await db.query('insert into post_media(id,post_id,url,media_type,width,height,sort_order,is_sensitive,alt_text,edit) values($1,$2,$3,$4,1920,1080,0,true,$5,$6)',[`85000000-0000-4000-8000-00000000000${i+1}`,post,'https://example.test/video.mp4','video','An edited sample',edit]);
});
test.after(async()=>{await db?.close();});
test('all eight real read RPCs preserve the full media editing recipe and metadata',async()=>{
 for(const sql of ["get_feed('latest',null,null,20)","get_discover_page('comedy',true,20,0,'2026-02-01')",`get_profile_posts('${A}',null,20)`,`get_profile_posts_page('${A}',20,0,'2026-02-01')`,`get_community_posts('${GROUP}',null,20)`,`get_community_posts_page('${GROUP}',20,0,'2026-02-01')`,"search_posts('Projection','latest',null,null,20)","search_posts_page('Projection','latest',20,0,'2026-02-01')"]){
  const rows=await as(B,'select * from '+sql);assert.ok(rows.length,sql+' has a visible fixture');const m=rows.find(r=>r.post_id===POST||r.post_id===GROUPPOST)?.media?.[0];assert.ok(m,sql);assert.deepEqual(m.edit,edit,sql);assert.equal(m.is_sensitive,true,sql);assert.equal(m.alt_text,'An edited sample',sql);assert.ok(m.id,sql);assert.equal(m.sort_order,0,sql);
 }
});
test('projection migration preserves function grants, privacy predicates and ranking and is repeatable',async()=>{
 const after=afterProjection;
 for(let i=0;i<before.length;i++){
  assert.equal(after[i].acl,before[i].acl,signatures[i]);
  const normalize=s=>s.replace(/, '(?:edit|alt_text|is_sensitive|id|sort_order)', (?:m|pm)\.(?:edit|alt_text|is_sensitive|id|sort_order)/g,'');
  assert.equal(normalize(after[i].source),normalize(before[i].source),signatures[i]);
 }
 const guarded=await definitions();await db.exec(migration);await db.exec(accessMigration);assert.deepEqual(await definitions(),guarded);
});
test('Discover and media helper never reveal blocked, private or excluded posts',async()=>{
 const query="select * from get_discover_page(null,false,20,0,'2026-02-01')";
 assert.ok((await as(B,query)).some(r=>r.post_id===POST));
 await db.exec(`insert into hidden_posts(user_id,post_id) values('${B}','${POST}')`);assert.ok(!(await as(B,query)).some(r=>r.post_id===POST));await db.exec('delete from hidden_posts');
 await db.exec(`insert into blocked_users(blocker_id,blocked_id) values('${A}','${B}')`);assert.equal((await as(B,query)).length,0);assert.deepEqual((await as(B,`select feed_media_json('${POST}') as media`))[0].media,[]);await db.exec('delete from blocked_users');
 await db.exec(`update profiles set profile_visibility='private' where id='${A}'`);assert.equal((await as(B,query)).length,0);await db.exec(`update profiles set profile_visibility='public' where id='${A}'`);
 assert.equal((await as(C,`select * from get_community_posts_page('${GROUP}',20,0,'2026-02-01')`)).length,0);
});
test('Discover and its media helper withhold exclusive and deactivated-account content',async()=>{
 const query="select * from get_discover_page('comedy',true,20,0,'2026-02-01')";
 await db.exec(`update posts set is_exclusive=true where id='${POST}'`);
 assert.equal((await as(B,query)).length,0);
 assert.deepEqual((await as(B,`select feed_media_json('${POST}') media`))[0].media,[]);
 assert.equal((await as(A,query)).length,1);
 await db.exec(`update posts set is_exclusive=false where id='${POST}';update profiles set deactivated_at=now() where id='${A}'`);
 assert.equal((await as(B,query)).length,0);
 await db.exec(`update profiles set deactivated_at=null where id='${A}'`);
});
test('Discover continuation traverses all equal-date rows and retains an anchored set',async()=>{
 await db.exec(`insert into posts(id,user_id,content,category,created_at) select ('86000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'${A}','Page fixture '||i,'science','2026-01-02' from generate_series(1,47)i;`);
 const first=await as(B,"select * from get_discover_page('science',false,20,0,'2026-02-01')");
 await db.exec(`insert into posts(id,user_id,content,category,created_at) values('86000000-0000-4000-8000-000000000099','${A}','Newer fixture','science','2026-03-01')`);
 const next=await as(B,"select * from get_discover_page('science',false,20,20,'2026-02-01')"),last=await as(B,"select * from get_discover_page('science',false,20,40,'2026-02-01')");
 assert.equal(first.length,20);assert.equal(next.length,20);assert.equal(last.length,7);assert.equal(new Set([...first,...next,...last].map(r=>r.post_id)).size,47);
});
test('media helper keeps empty posts as arrays and rejects anonymous access',async()=>{
 assert.deepEqual((await as(B,"select feed_media_json('00000000-0000-4000-8000-000000000000') as media"))[0].media,[]);
 await db.exec('set role anon');try{await assert.rejects(()=>db.query(`select feed_media_json('${POST}')`),/permission denied/);}finally{await db.exec('reset role');}
});
