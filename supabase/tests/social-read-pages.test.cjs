const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('./rpc-authorization/node_modules/@electric-sql/pglite');
const { pg_trgm } = require('./rpc-authorization/node_modules/@electric-sql/pglite/dist/contrib/pg_trgm.cjs');
const A='00000000-0000-4000-8000-000000000001', B='00000000-0000-4000-8000-000000000002', C='00000000-0000-4000-8000-000000000003';
const CH='10000000-0000-4000-8000-000000000001', MSG='20000000-0000-4000-8000-000000000001';
let db;
async function as(uid,sql,role='authenticated') {
 await db.exec('begin');
 try {await db.exec(`set local role ${role}`);await db.query("select set_config('request.jwt.claim.sub',$1,true)",[uid||'']);const r=await db.query(sql);await db.exec('commit');return r.rows;}
 catch(e){await db.exec('rollback');throw e;}
}
test.before(async()=>{
 db = new PGlite({extensions:{pg_trgm}});
 await db.exec(`create extension pg_trgm; create role anon; create role authenticated;
 create schema auth; create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`);
 await db.exec(fs.readFileSync(path.join(__dirname,'social-read-fixture.sql'),'utf8'));
 await db.exec(`create function public.community_is_member(cid uuid) returns boolean language sql stable as $$select exists(select 1 from community_members where community_id=cid and user_id=auth.uid())$$;
 create function public.community_is_mod(cid uuid) returns boolean language sql stable as $$select exists(select 1 from community_members where community_id=cid and user_id=auth.uid() and role in ('owner','moderator'))$$;
 create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid,bucket_id text,name text); alter table storage.objects enable row level security;
 grant select on all tables in schema public to authenticated;`);
 await db.exec(fs.readFileSync(path.join(__dirname,'../migrations/20261022211253_social_directory_history_quality.sql'),'utf8'));
 await db.exec(`insert into profiles(id,full_name,username,profile_visibility,created_at) values ('${A}','Alice','alice','public','2026-01-01'),('${B}','Bob','bob','public','2026-01-01'),('${C}','Carol','carol','public','2026-01-01');
 insert into channels(id,name,owner_id,status,audience,created_at,member_count) values('${CH}','Private club','${A}','active','followers','2026-01-01',2);
 insert into channel_members(channel_id,user_id,role) values('${CH}','${A}','owner'),('${CH}','${B}','member');
 insert into channel_messages(id,channel_id,sender_id,content,created_at) values('${MSG}','${CH}','${A}','Members only','2026-01-02');
 insert into channel_replies(id,message_id,user_id,content,created_at) select ('30000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'${MSG}','${B}','Reply '||i,'2026-01-03' from generate_series(1,45)i;`);
});
test.after(async()=>{await db?.close();});
test('every new read RPC compiles and executes against actual QA column types',async()=>{
 for (const [name,args] of [
  ['get_channels_page','null,20,0'],['get_communities_page','null,20,0'],['get_profile_posts_page',`'${A}',20,0`],['get_community_posts_page',`'${CH}',20,0`],
  ...['get_community_announcements_page','get_community_bans_page','get_community_invites_page','get_community_members_page','get_join_requests_page','get_sub_communities_page'].map(name=>[name,`'${CH}',20,0`]),
  ...['search_people_page','search_jobs_fts_page','search_listings_fts_page','search_media_page','search_articles_page','search_places_page'].map(name=>[name,"'test',20,0"]),
  ['search_posts_page',"'test','top',20,0"],['get_notifications_page','20,0'],['get_discover_page','null,false,20,0'],['get_trending_creators','10'],['get_channel_detail',`'${CH}'`],['get_channel_members_page',`'${CH}',20,0`]]) {
  try {await as(A,`select * from public.${name}(${args})`);} catch(e){throw new Error(name+': '+e.message);}
 }
});
test('legacy and paged channel replies enforce membership, block rules and active channel state',async()=>{
 assert.equal((await as(C,`select * from get_channel_replies('${MSG}')`)).length,0);
 assert.equal((await as(C,`select * from get_channel_replies_page('${MSG}')`)).length,0);
 assert.equal((await as(B,`select * from get_channel_replies('${MSG}')`)).length,40);
 await db.exec(`insert into blocked_users(blocker_id,blocked_id) values('${A}','${B}')`);
 assert.equal((await as(B,`select * from get_channel_replies_page('${MSG}')`)).length,0);
 await db.exec('delete from blocked_users');
 await db.exec(`update channels set status='archived' where id='${CH}'`);
 assert.equal((await as(B,`select * from get_channel_replies_page('${MSG}')`)).length,0);
 await db.exec(`update channels set status='active' where id='${CH}'`);
});
test('equal-timestamp reply pages have no missing or repeated rows',async()=>{
 const first=await as(B,`select * from get_channel_replies_page('${MSG}',null,40,null)`);
 const last=first.at(-1);
 const second=await as(B,`select * from get_channel_replies_page('${MSG}','2026-01-03',40,'${last.id}')`);
 assert.equal(first.length,40);assert.equal(second.length,5);assert.equal(new Set([...first,...second].map(x=>x.id)).size,45);
});
test('directory continuation is bounded, deterministic and input wildcards are literal',async()=>{
 await db.exec(`insert into channels(id,name,owner_id,status,audience,created_at,member_count) select ('40000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'Directory '||i,'${A}','active','everyone','2026-01-01',1 from generate_series(1,65)i`);
 const a=await as(B,`select * from get_channels_page('Directory',40,0)`),b=await as(B,`select * from get_channels_page('Directory',40,40)`);
 assert.equal(a.length,40);assert.equal(b.length,25);assert.equal(new Set([...a,...b].map(x=>x.id)).size,65);
 assert.equal((await as(B,`select * from get_channels_page('%',40,0)`)).length,0);
 assert.equal((await as(B,`select * from get_channels_page('Directory',-1,0)`)).length,1);
 await assert.rejects(()=>as(null,`select * from get_channels_page(null,20,0)`,'anon'),/permission denied/);
});
test('notification groups are paged after aggregation; requests and malformed metadata remain safe',async()=>{
 await db.exec(`insert into notifications(id,recipient_id,actor_id,type,created_at,data) select ('50000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'${A}','${B}','follow_request','2026-01-03',jsonb_build_object('request_id',i::text,'post_id','not-a-uuid') from generate_series(1,45)i;
 insert into notifications(id,recipient_id,actor_id,type,created_at,data) select ('60000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'${A}',case when i=1 then '${B}'::uuid else '${C}'::uuid end,'like','2026-01-04',jsonb_build_object('post_id','${MSG}') from generate_series(1,2)i;`);
 const a=await as(A,`select * from get_notifications_page(40,0,'2026-02-01')`),b=await as(A,`select * from get_notifications_page(40,40,'2026-02-01')`);
 assert.equal(a.length+b.length,46);assert.equal([...a,...b].filter(x=>x.type==='follow_request').length,45);
 const likes=[...a,...b].filter(x=>x.type==='like');assert.equal(likes.length,1);assert.equal(likes[0].others_count,1);
 assert.equal(new Set([...a,...b].map(x=>x.group_key)).size,46);
 assert.equal((await as(B,`select * from get_notifications_page(40,0)`)).length,0);
});
test('private channel object paths enforce uploader and channel roles',async()=>{
 const object=`${CH}/${A}/photo.jpg`;
 assert.equal((await as(A,`select social_channel_media_access('${object}',true) as ok`))[0].ok,true);
 assert.equal((await as(B,`select social_channel_media_access('${object}',true) as ok`))[0].ok,false);
 assert.equal((await as(B,`select social_channel_media_access('${object}',false) as ok`))[0].ok,true);
 assert.equal((await as(C,`select social_channel_media_access('${object}',false) as ok`))[0].ok,false);
 assert.equal((await as(A,`select social_channel_media_access('broken/path',false) as ok`))[0].ok,false);
});

test('profile pinned and equal-date posts remain unique beyond the first page',async()=>{
 await db.exec(`insert into posts(id,user_id,content,created_at,audience) select ('70000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'${A}','Profile post '||i,'2026-01-03','everyone' from generate_series(1,45)i;
 update posts set created_at='2025-01-01' where id='70000000-0000-4000-8000-000000000001';
 update profiles set pinned_post_id='70000000-0000-4000-8000-000000000001' where id='${A}';`);
 const a=await as(B,`select * from get_profile_posts_page('${A}',20,0,'2026-02-01')`),b=await as(B,`select * from get_profile_posts_page('${A}',20,20,'2026-02-01')`),c=await as(B,`select * from get_profile_posts_page('${A}',20,40,'2026-02-01')`);
 assert.equal(a[0].is_pinned,true);assert.equal(new Set([...a,...b,...c].map(x=>x.post_id)).size,45);
 await db.exec(`insert into posts(id,user_id,content,created_at,audience) values('70000000-0000-4000-8000-000000000099','${A}','Newer','2026-03-01','everyone')`);
 assert.equal((await as(B,`select * from get_profile_posts_page('${A}',20,20,'2026-02-01')`))[0].post_id,b[0].post_id);
});
test('channel message history and realtime policies enforce the same boundary',async()=>{
 await db.exec(`insert into channel_messages(id,channel_id,sender_id,content,created_at) select ('80000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'${CH}','${A}','Update '||i,'2026-01-04' from generate_series(1,45)i;`);
 const a=await as(B,`select * from get_channel_messages_page('${CH}',40)`),last=a.at(-1);
 const b=await as(B,`select * from get_channel_messages_page('${CH}',40,'2026-01-04','${last.id}')`);
 assert.equal(new Set([...a,...b].map(x=>x.id)).size,46);
 assert.equal((await as(C,`select * from channel_messages where channel_id='${CH}'`)).length,0);
 assert.equal((await as(C,`select * from channel_replies where message_id='${MSG}'`)).length,0);
 assert.equal((await as(B,`select * from channel_messages where channel_id='${CH}'`)).length,46);
});
test('Discover filters category and video before paging and honors muted authors',async()=>{
 await db.exec(`update posts set category='comedy' where user_id='${A}'; insert into post_media(id,post_id,url,media_type) values('90000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000002','https://example.test/video.mp4','video');`);
 const visible=await as(B,`select * from get_discover_page('comedy',true,20,0,'2026-02-01')`);assert.equal(visible.length,1);
 assert.equal((await as(B,`select * from get_discover_page('science',true,20,0,'2026-02-01')`)).length,0);
 await db.exec(`insert into muted_authors(user_id,author_id) values('${B}','${A}')`);
 assert.equal((await as(B,`select * from get_discover_page('comedy',true,20,0,'2026-02-01')`)).length,0);
 await db.exec('delete from muted_authors');
});
