const {test,before,after,beforeEach}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('./rpc-authorization/node_modules/@electric-sql/pglite');
const {pgcrypto}=require('./rpc-authorization/node_modules/@electric-sql/pglite/dist/contrib/pgcrypto.cjs');
const {LocalPsqlSession}=require('./local-psql-session.cjs');
function realDatabase(){
 if(process.env.PGDATABASE!=='pc_scale_private_hls')throw new Error('Dedicated pc_scale_private_hls database required');
 const session=new LocalPsqlSession();
 const literal=x=>x===null?'null':typeof x==='number'?String(x):"'"+String(x).replaceAll("'","''")+"'";
 return {exec:sql=>session.query(sql),close:()=>session.close(),query:async(sql,args=[])=>{
  const command=sql.replace(/\$(\d+)/g,(_,n)=>literal(args[Number(n)-1]));
  if(/^explain\b/i.test(command)){const result=await session.query(command);return {rows:[{'QUERY PLAN':JSON.parse(result)}]};}
  if(!/^select\b/i.test(command)){await session.query(command);return {rows:[]};}
  const result=await session.query("select coalesce(json_agg(result),'[]'::json) from ("+command+") result");return {rows:JSON.parse(result)};
 }};
}
const id=n=>`90000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const A=id(1),B=id(2),X=id(3),S=id(4),S2=id(5),M=id(6),O=id(7),R=id(8),C=id(9),R2=id(10);
const file=A+'/private.mp4',url='https://qa.supabase.co/storage/v1/object/public/chat-media/'+file;
let db;
const exec=sql=>db.exec(sql),query=(sql,args)=>db.query(sql,args),value=async(sql,args)=>(await query(sql,args)).rows[0]?.value;
const claims=async(uid=B,sid=S,role='authenticated')=>query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:uid,session_id:sid,role})]);
const open=()=>value('select public.open_chat_hls_v1($1,$2) value',[M,R]);
const close=()=>value('select public.close_chat_hls_v1($1,$2) value',[M,R]);
const read=a=>value('select public.read_chat_hls_v1($1,$2,$3,$4,$5) value',[M,R,'source-v1',a.leaseId,'r0/seg00000.ts']);
before(async()=>{
 db=process.env.PC_TEST_PSQL?realDatabase():new PGlite({extensions:{pgcrypto}});
 if(process.env.PC_TEST_PSQL){const proof=await query('select version(),inet_server_addr()');assert.match(proof.rows[0].version,/PostgreSQL 17\./);assert.equal(proof.rows[0].inet_server_addr,null);}
 await exec(fs.readFileSync(path.join(__dirname,'media-processing-fixture.sql'),'utf8'));
 await exec(`alter table auth.users add column banned_until timestamptz;create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
 create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
 create table profiles(id uuid primary key,deactivated_at timestamptz);
 create table conversations(id uuid primary key,user_1 uuid,user_2 uuid,is_group boolean default false);
 create table conversation_members(conversation_id uuid,user_id uuid);
 create table business_members(business_id uuid,member_id uuid);
 create function org_role_for_profile(uuid) returns text language sql as $$select null::text$$;
 create function org_delegated_scopes(uuid) returns text[] language sql as $$select array[]::text[]$$;
 create table blocked_users(blocker_id uuid,blocked_id uuid);
 create table messages(id uuid primary key,sender_id uuid,conversation_id uuid,media_url text,media_type text,view_limit smallint,deleted_at timestamptz,thumbnail_url text,media_access_verified boolean default false);
 create table chat_media_view_grants(user_id uuid,request_id uuid,message_id uuid,expires_at timestamptz default now()+interval '2 minutes',remaining integer,primary key(user_id,request_id));
 create table message_views(message_id uuid,user_id uuid,views integer,first_viewed_at timestamptz,primary key(message_id,user_id));
 create schema account_erasure;create table account_erasure.jobs(id uuid primary key,user_id uuid,state text);
 insert into storage.buckets(id,name,public) values('chat-media','chat-media',false),('chat-files','chat-files',false);`);
 await exec(fs.readFileSync(path.join(__dirname,'private-hls-deployed-contracts-20261105.sql'),'utf8'));
 for(const name of ['20261102071532_durable_media_processing_v1.sql','20261102090521_adaptive_media_renditions_v2.sql','20261102100428_media_broker_scoped_credentials_v2.sql','20261105044918_adaptive_media_admission_backfill_v2.sql','20261105152331_adaptive_media_batch_readiness.sql'])await exec(fs.readFileSync(path.join(__dirname,'../migrations',name),'utf8'));
 await exec(fs.readFileSync(path.join(__dirname,'published-clip-renditions-fixture.sql'),'utf8'));
 await exec(fs.readFileSync(path.join(__dirname,'../migrations/20261105153608_published_live_clip_renditions.sql'),'utf8'));
 await exec(fs.readFileSync(path.join(__dirname,'../migrations/20261105155600_private_chat_adaptive_delivery.sql'),'utf8'));
});
after(()=>db?.close());
beforeEach(async()=>{
 await exec(`reset role;truncate private_hls.limited_bindings,private_hls.grants,chat_media_view_grants,messages,conversations,conversation_members,business_members,message_views,blocked_users,account_erasure.jobs,media_renditions.publications,media_renditions.assets,media_renditions.attempts,media_renditions.jobs,storage.objects,auth.sessions,auth.users,profiles cascade;
 update private_hls.settings set enabled=true;update media_renditions.settings set admission_enabled=true,worker_enabled=true,delivery_enabled=true,maintenance_enabled=true;
 insert into auth.users(id) values('${A}'),('${B}'),('${X}');insert into profiles(id) values('${A}'),('${B}'),('${X}');insert into auth.sessions values('${S}','${B}',null),('${S2}','${B}',null);insert into conversations(id,user_1,user_2) values('${C}','${A}','${B}');
 insert into storage.objects(id,bucket_id,name,version,owner_id,metadata) values('${O}','chat-media','${file}','source-v1','${A}','{"size":1000,"eTag":"source-etag","mimetype":"video/mp4"}');
 insert into messages(id,sender_id,conversation_id,media_url,media_type,view_limit,deleted_at) values('${M}','${A}','${C}','${url}','video',null,null);`);
 await claims(B,S,'service_role');
 const j=await value('select claim_media_rendition_v2() value');assert.ok(j);
 const assets=[{name:'master.m3u8',mime:'application/vnd.apple.mpegurl',playlist:'#EXTM3U\nr0/index.m3u8\n'},{name:'r0/index.m3u8',mime:'application/vnd.apple.mpegurl',playlist:'#EXTM3U\n#EXTINF:4.0,\nseg00000.ts\n#EXT-X-ENDLIST\n'},{name:'r0/seg00000.ts',mime:'video/mp2t'},{name:'fallback.mp4',mime:'video/mp4'}].map(a=>({...a,bytes:100,sha256:'a'.repeat(64)}));
 await value('select register_media_rendition_assets_v2($1,$2,$3,$4) value',[j.job_id,j.lease_id,j.attempt,JSON.stringify(assets)]);
 for(const a of assets)await query("insert into storage.objects(bucket_id,name,version,metadata,user_metadata) values('adaptive-media',$1,'out-v1',$2,$3)",[j.output_prefix+a.name,JSON.stringify({size:100,eTag:'out-etag'}),JSON.stringify({processing_lease_id:j.lease_id,sha256:a.sha256})]);
 assert.equal(await value("select finish_media_rendition_v2($1,$2,$3,'ready',$4) value",[j.job_id,j.lease_id,j.attempt,JSON.stringify({width:640,height:360,duration:4})]),true);
 await claims();
});
test('ordinary chat uses exact authenticated session, original source and registered assets',async()=>{
 const a=await open();assert.equal(a.sourceVersion,'source-v1');assert.equal((await read(a)).name,'r0/seg00000.ts');
 await claims(B,S2);assert.equal(await read(a),null);await claims(X,S);assert.equal(await open(),null);await claims();
 assert.equal(await value('select read_chat_hls_v1($1,$2,$3,$4,$5) value',[M,R,'changed',a.leaseId,'r0/seg00000.ts']),null);
 assert.equal(await value('select read_chat_hls_v1($1,$2,$3,$4,$5) value',[M,R,'source-v1',a.leaseId,'../../source.mp4']),null);
});
test('close before delayed open is terminal, and close after open revokes every child',async()=>{
 assert.equal(await close(),true);assert.equal(await open(),null);await query('delete from private_hls.grants');const a=await open();assert.equal(await close(),true);assert.equal(await read(a),null);assert.equal(await open(),null);
});
test('membership, blocks, deletion, session revocation and current source checks are not cached',async()=>{
 const a=await open();await query('insert into blocked_users values($1,$2)',[B,A]);assert.equal(await read(a),null);await exec('truncate blocked_users');
 await query('update conversations set user_2=$1',[X]);assert.equal(await read(a),null);await query('update conversations set user_2=$1',[B]);
 await query('update auth.sessions set not_after=now()-interval \'1 second\' where id=$1',[S]);assert.equal(await read(a),null);await query('update auth.sessions set not_after=null where id=$1',[S]);
 await query('update storage.objects set version=$1 where id=$2',['replacement',O]);assert.equal(await read(a),null);assert.equal(await value('select state value from media_renditions.jobs limit 1'),'cancelled');
});
test('limited grants never open implicitly or increase counters; exact new binding is required',async()=>{
 await exec('update messages set view_limit=1');assert.equal(await open(),null);
 const consumed=await query('select * from claim_chat_media_view($1,$2)',[M,R]);assert.equal(consumed.rows[0].remaining,0);
 assert.equal(await value('select count(*)::int value from private_hls.limited_bindings'),1);
 const a=await open();assert.ok(a);assert.ok(await read(a));assert.ok(await read(a));assert.equal(await value('select remaining value from chat_media_view_grants'),0);assert.equal(await value('select views value from message_views'),1);
 await query('update chat_media_view_grants set expires_at=now()-interval \'1 second\'');assert.equal(await read(a),null);
});
test('legacy grants without new immutable binding keep original fallback and never gain HLS',async()=>{
 await exec('update messages set view_limit=1');await claims(B,'90000000-0000-4000-8000-000000000999');
 await query('insert into chat_media_view_grants values($1,$2,$3,now()+interval \'2 minutes\',0)',[B,R,M]);await claims();assert.equal(await open(),null);
});
test('expired grant, foreign source owner and corrupt ready assets fail closed',async()=>{
 const a=await open();await query('update private_hls.grants set expires_at=now()-interval \'1 second\'');assert.equal(await read(a),null);
 await exec('delete from private_hls.grants');await query('update storage.objects set owner_id=$1 where id=$2',[X,O]);assert.equal(await open(),null);
});
test('erasure cancels leases and cannot complete until every derivative is absent',async()=>{
 const a=await open();await query("insert into account_erasure.jobs values($1,$2,'queued')",[id(30),A]);assert.equal(await read(a),null);
 assert.equal(await value('select private_hls.owner_erasure_ready($1) value',[A]),false);
 assert.equal(await value('select fixture_fails($1) value',["update account_erasure.jobs set state='completed',user_id=null where id='"+id(30)+"'"]),true);
 await claims(B,S,'service_role');const rows=await value('select claim_media_rendition_cleanup_v2(2) value');assert.equal(rows.length,1);
 assert.equal(await value('select finish_media_rendition_cleanup_v2($1,$2) value',[rows[0].lease_id,rows[0].cleanup_lease]),false);
 await exec("delete from storage.objects where bucket_id='adaptive-media'");assert.equal(await value('select finish_media_rendition_cleanup_v2($1,$2) value',[rows[0].lease_id,rows[0].cleanup_lease]),true);
 assert.equal(await value('select private_hls.owner_erasure_ready($1) value',[A]),true);await query("update account_erasure.jobs set state='completed',user_id=null where id=$1",[id(30)]);
});
test('private schema and worker APIs remain unavailable to ordinary clients',async()=>{
 for(const role of ['anon','authenticated']){
  assert.equal(await value(`select has_table_privilege('${role}','private_hls.grants','select') value`),false);
  assert.equal(await value(`select has_function_privilege('${role}','public.backfill_chat_hls_v1(uuid,integer,boolean)','execute') value`),false);
 }
 assert.equal(await value("select has_function_privilege('anon','public.open_chat_hls_v1(uuid,uuid)','execute') value"),false);
 assert.equal(await value("select has_function_privilege('service_role','public.open_chat_hls_v1(uuid,uuid)','execute') value"),false);
 assert.equal(await value("select has_function_privilege('authenticated','public.open_chat_hls_v1(uuid,uuid)','execute') value"),true);
});
test('deployed group and business delegation chain is rechecked after membership removal',async()=>{
 await exec('update conversations set is_group=true');await query('insert into conversation_members values($1,$2)',[C,B]);
 const a=await open();assert.ok(a);await exec('truncate conversation_members');assert.equal(await read(a),null);
 await exec('update conversations set is_group=false');await query('update conversations set user_2=$1',[X]);await query('insert into business_members values($1,$2)',[X,B]);assert.ok(await read(a));
 await exec('truncate business_members');assert.equal(await read(a),null);
});
test('private-v2 cutover excludes limited derivatives and a 20000-message lookup uses the partial locator index',async()=>{
 await exec('update messages set view_limit=1;create schema private_media');assert.equal(await value('select private_hls.source_snapshot($1,$2) value',[O,'source-v1']),null);await exec('drop schema private_media');
 await exec(`alter table messages disable trigger private_hls_message_change;insert into messages(id,sender_id,conversation_id,media_url,media_type)
 select gen_random_uuid(),'${A}','${C}','https://qa.supabase.co/storage/v1/object/public/chat-media/${A}/video-'||i||'.mp4','video' from generate_series(1,20000) i;alter table messages enable trigger private_hls_message_change;analyze messages;`);
 const plan=(await query("explain (format json) select id from messages where public.chat_object_path(media_url)=$1 and deleted_at is null and media_type='video'",['chat-media/'+file])).rows[0]['QUERY PLAN'];
 assert.match(JSON.stringify(plan),/private_hls_message_video_locator/);
});
test('disabled HLS and unsupported legacy attachments leave original view grants unchanged',async()=>{
 await exec("update private_hls.settings set enabled=false;update messages set view_limit=1,media_type='image'");
 const result=(await query('select * from claim_chat_media_view($1,$2)',[M,R])).rows[0];assert.equal(result.url,url);assert.equal(result.remaining,0);
 assert.equal(await value('select views value from message_views'),1);assert.equal(await value('select count(*)::int value from private_hls.limited_bindings'),0);assert.equal(await open(),null);
});
test('inactive tombstones expire only after their capability window and per-user admission remains bounded',async()=>{
 await close();await query("update private_hls.grants set expires_at=now()-interval '1 hour'");assert.equal(await open(),null);
 await exec('delete from private_hls.grants');
 await query(`insert into private_hls.grants(user_id,request_id,session_id,message_id,expires_at,closed_at)
 select $1,gen_random_uuid(),$2,$3,now()+interval '10 minutes',now() from generate_series(1,128)`,[B,S,M]);assert.equal(await open(),null);assert.equal(await close(),false);
 await query("update private_hls.grants set expires_at=now()-interval '25 hours'");assert.ok(await open());assert.equal(await value('select count(*)::int value from private_hls.grants'),1);
});
