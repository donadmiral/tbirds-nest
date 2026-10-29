const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.PGLITE_MODULE || './rpc-authorization/node_modules/@electric-sql/pglite');
const A='10000000-0000-4000-8000-000000000001', B='10000000-0000-4000-8000-000000000002';
let db;
const migration=fs.readFileSync(path.join(__dirname,'../migrations/20261023190601_platinum_storage_bootstrap.sql'),'utf8');
async function actor(uid,sql,params=[],role='authenticated') {
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid||'']);
 await db.exec(`set role ${role}`);
 try {return await db.query(sql,params);} finally {await db.exec('reset role');}
}
test.before(async()=>{
 db=new PGlite();
 await db.exec(`create role anon; create role authenticated; create schema auth; create schema storage;
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
 create function public.can_act_as(target uuid) returns boolean language sql stable as $$ select auth.uid()=target $$;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner_id text,owner uuid, unique(bucket_id,name));
 alter table storage.objects enable row level security;
 grant usage on schema auth,storage to anon,authenticated;
 grant select,insert,update,delete on storage.objects to anon,authenticated;
 create policy legacy_all on storage.objects for all to anon,authenticated using(true) with check(true);
 create policy chat_guard on storage.objects as restrictive for all to anon,authenticated using(bucket_id not in ('chat-media','chat-files')) with check(bucket_id not in ('chat-media','chat-files'));
 insert into storage.buckets values('story-media','story-media',true,104857600,array['image/jpeg']);
 `);
 await db.exec(migration);
});
test.beforeEach(async()=>{await db.exec('truncate storage.objects');});
test.after(async()=>db.close());
test('bootstrap is repeatable, creates private protected buckets and preserves existing visibility',async()=>{
 await db.exec(migration);
 const rows=(await db.query('select * from storage.buckets order by id')).rows;
 assert.equal(rows.length,7);
 for(const id of ['post-media','media','chat-media','chat-files']) assert.equal(rows.find(r=>r.id===id).public,false);
 for(const id of ['avatars','market-media','story-media']) assert.equal(rows.find(r=>r.id===id).public,true);
 assert.equal(Number(rows.find(r=>r.id==='chat-files').file_size_limit),25*1024*1024);
 assert.equal(rows.find(r=>r.id==='chat-files').allowed_mime_types,null);
 assert.ok(rows.find(r=>r.id==='story-media').allowed_mime_types.includes('audio/webm'));
});
test('owner upload works and foreign actor paths or forged ownership cannot bypass legacy permissive policies',async()=>{
 await actor(A,'insert into storage.objects(bucket_id,name,owner_id) values($1,$2,$3)',['post-media',`${A}/photo.jpg`,A]);
 await assert.rejects(()=>actor(A,'insert into storage.objects(bucket_id,name,owner_id) values($1,$2,$3)',['post-media',`${B}/photo.jpg`,A]),/row-level security/);
 await assert.rejects(()=>actor(A,'insert into storage.objects(bucket_id,name,owner_id) values($1,$2,$3)',['avatars',`${A}/photo.jpg`,B]),/row-level security/);
});
test('private object direct reads are owner-only despite old public-read policies',async()=>{
 await actor(A,'insert into storage.objects(bucket_id,name,owner_id) values($1,$2,$3)',['post-media',`${A}/photo.jpg`,A]);
 assert.equal((await actor(A,'select * from storage.objects')).rows.length,1);
 assert.equal((await actor(B,'select * from storage.objects')).rows.length,0);
 assert.equal((await actor(null,'select * from storage.objects',[],'anon')).rows.length,0);
});
test('protected content objects cannot be overwritten or deleted by client accounts',async()=>{
 await actor(A,'insert into storage.objects(bucket_id,name,owner_id) values($1,$2,$3)',['post-media',`${A}/photo.jpg`,A]);
 assert.equal((await actor(A,"update storage.objects set name=$1 returning id",[`${A}/changed.jpg`])).rows.length,0);
 assert.equal((await actor(A,'delete from storage.objects returning id')).rows.length,0);
});
test('public catalog accepts native and web listing paths while uploads remain owner-bound',async()=>{
 for(const bucket of ['market-media','avatars']) await actor(A,'insert into storage.objects(bucket_id,name,owner_id) values($1,$2,$3)',[bucket,`${bucket==='market-media'?'listings/':''}${A}/photo.jpg`,A]);
 assert.equal((await actor(null,'select * from storage.objects',[],'anon')).rows.length,2);
 await assert.rejects(()=>actor(B,'insert into storage.objects(bucket_id,name,owner_id) values($1,$2,$3)',['market-media',`listings/${A}/foreign.jpg`,B]),/row-level security/);
 assert.equal((await actor(B,"update storage.objects set name=$1 returning id",[`${B}/changed.jpg`])).rows.length,0);
 assert.equal((await actor(B,'delete from storage.objects returning id')).rows.length,0);
});
test('anonymous uploads and traversal are refused, unrelated chat restrictions remain intact',async()=>{
 for(const name of [`${A}/../photo.jpg`,`${A}//photo.jpg`,`${A}/%2e%2e/photo.jpg`]) await assert.rejects(()=>actor(A,'insert into storage.objects(bucket_id,name,owner_id) values($1,$2,$3)',['avatars',name,A]),/row-level security/);
 await assert.rejects(()=>actor(null,'insert into storage.objects(bucket_id,name,owner_id) values($1,$2,$3)',['avatars',`${A}/anon.jpg`,A],'anon'),/row-level security/);
 await assert.rejects(()=>actor(A,'insert into storage.objects(bucket_id,name,owner_id) values($1,$2,$3)',['chat-media',`${A}/chat.jpg`,A]),/row-level security/);
});
