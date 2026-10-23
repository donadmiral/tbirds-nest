const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('../../supabase/tests/rpc-authorization/node_modules/@electric-sql/pglite');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const url = (n, file='photo.jpg', bucket='chat-media') => `https://project.supabase.co/storage/v1/object/public/${bucket}/${id(n)}/${file}?t=1723456789012`;
const migration = name => fs.readFileSync(path.join(__dirname,'../../supabase/migrations',name),'utf8');

test('private cutover enforces actual storage RLS while preserving authorized legacy readers', async () => {
 const db = new PGlite();
 try {
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE SCHEMA auth; CREATE SCHEMA storage;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 CREATE FUNCTION public.can_act_as(p uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT coalesce(p=auth.uid(),false) $$;
 CREATE FUNCTION public.studio_role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'recruiter'::text $$;
 CREATE TABLE conversations(id uuid PRIMARY KEY,is_group boolean,user_1 uuid,user_2 uuid,group_avatar_url text);
 CREATE TABLE conversation_members(conversation_id uuid,user_id uuid,PRIMARY KEY(conversation_id,user_id));
 CREATE FUNCTION public.is_conversation_member(c uuid,u uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT EXISTS(SELECT 1 FROM conversation_members WHERE conversation_id=c AND user_id=u) $$;
 CREATE TABLE messages(id uuid PRIMARY KEY,sender_id uuid,receiver_id uuid,conversation_id uuid,media_url text,thumbnail_url text,media_type text,view_limit smallint,forwarded_from_id uuid,deleted_at timestamptz);
 CREATE TABLE message_views(message_id uuid,user_id uuid,views integer,first_viewed_at timestamptz,PRIMARY KEY(message_id,user_id));
 CREATE TABLE blocked_users(blocker_id uuid,blocked_id uuid);
 CREATE TABLE call_sessions(call_type text,is_video boolean,agora_channel text,id uuid PRIMARY KEY,conversation_id uuid,initiator_id uuid,receiver_id uuid,is_group_call boolean,status text,created_at timestamptz DEFAULT now(),expires_at timestamptz,started_at timestamptz,ended_at timestamptz,duration_sec integer);
 CREATE TABLE call_participants(call_session_id uuid,user_id uuid,status text,joined_at timestamptz,left_at timestamptz,last_seen_at timestamptz,PRIMARY KEY(call_session_id,user_id));
 CREATE TABLE channel_messages(id uuid PRIMARY KEY,channel_id uuid,sender_id uuid,media_url text);
 CREATE TABLE channel_members(channel_id uuid,user_id uuid);
 CREATE FUNCTION public.social_can_read_channel(c uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT EXISTS(SELECT 1 FROM channel_members WHERE channel_id=c AND user_id=auth.uid()) $$;
 CREATE TABLE jobs(id uuid PRIMARY KEY,posted_by uuid);
 CREATE TABLE job_applications(id uuid PRIMARY KEY,job_id uuid,applicant_id uuid,cv_url text);
 CREATE TABLE storage.buckets(id text PRIMARY KEY,public boolean);
 CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text,PRIMARY KEY(bucket_id,name));
 ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
 GRANT USAGE ON SCHEMA public,auth,storage TO authenticated,anon;
 GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO authenticated,anon;
 -- Mimic the old broad public policies, which restrictive guards must defeat.
 CREATE POLICY old_public_read ON storage.objects FOR SELECT TO public USING(true);
 CREATE POLICY old_upload ON storage.objects FOR INSERT TO public WITH CHECK(true);
 CREATE POLICY old_update ON storage.objects FOR UPDATE TO public USING(true) WITH CHECK(true);
 CREATE POLICY old_delete ON storage.objects FOR DELETE TO public USING(true);
 INSERT INTO storage.buckets VALUES('chat-media',true),('chat-files',true),('unrelated',true);
 INSERT INTO conversations VALUES('${id(10)}',false,'${id(1)}','${id(2)}',null),('${id(11)}',true,'${id(1)}',null,null),('${id(12)}',false,'${id(2)}','${id(3)}',null);
 INSERT INTO conversation_members VALUES('${id(11)}','${id(1)}'),('${id(11)}','${id(2)}');
 INSERT INTO channel_members VALUES('${id(50)}','${id(2)}');
 INSERT INTO jobs VALUES('${id(60)}','${id(2)}');
 INSERT INTO storage.objects(bucket_id,name) VALUES ('chat-media','${id(1)}/photo.jpg'),('chat-media','${id(1)}/once.jpg'),('chat-media','${id(1)}/broadcast.jpg'),('chat-media','${id(1)}/avatar.jpg'),('chat-files','${id(1)}/cv.pdf'),('chat-media','${id(1)}/orphan.jpg'),('unrelated','public.txt');
 INSERT INTO channel_messages VALUES('${id(51)}','${id(50)}','${id(1)}','${url(1,'broadcast.jpg')}');
 INSERT INTO job_applications VALUES('${id(61)}','${id(60)}','${id(1)}','${url(1,'cv.pdf','chat-files')}');
 UPDATE conversations SET group_avatar_url='${url(1,'avatar.jpg')}' WHERE id='${id(11)}';`);
 await db.exec(migration('20261022211236_message_call_access.sql'));
 await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[id(1)]);
 await db.query(`INSERT INTO messages(id,sender_id,conversation_id,media_url,media_type) VALUES($1,$2,$3,$4,'image')`,[id(20),id(1),id(10),url(1)]);
 await db.query(`INSERT INTO messages(id,sender_id,conversation_id,media_url,media_type,view_limit) VALUES($1,$2,$3,$4,'image',1)`,[id(21),id(1),id(10),url(1,'once.jpg')]);
 await db.exec(migration('20261023185729_chat_storage_cutover_and_reference_guards.sql'));
 assert.deepEqual((await db.query("SELECT public FROM storage.buckets WHERE id LIKE 'chat-%'")).rows.map(r=>r.public),[false,false]);
 const as = async n => { await db.exec('RESET ROLE');await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[n ? id(n) : '']);await db.exec(n ? 'SET ROLE authenticated' : 'SET ROLE anon'); };
 const names = async () => (await db.query('SELECT name FROM storage.objects ORDER BY name')).rows.map(r=>r.name);
 await as(2);
 assert.deepEqual(await names(),['avatar.jpg','broadcast.jpg','cv.pdf','photo.jpg'].map(f=>`${id(1)}/${f}`).concat('public.txt').sort());
 await assert.rejects(db.query('INSERT INTO storage.objects(bucket_id,name) VALUES($1,$2)',['chat-media',`${id(1)}/forged.jpg`]),/row-level security/);
 await db.query('INSERT INTO storage.objects(bucket_id,name) VALUES($1,$2)',['chat-media',`${id(2)}/own.jpg`]);
 assert.equal((await db.query("UPDATE storage.objects SET name='changed' WHERE bucket_id='chat-media' RETURNING id")).rows.length,0);
 assert.equal((await db.query("DELETE FROM storage.objects WHERE bucket_id='chat-media' RETURNING id")).rows.length,0);
 // Removed members immediately lose both group-photo and broadcast signing access.
 await db.exec('RESET ROLE');
 await db.query('DELETE FROM conversation_members WHERE user_id=$1',[id(2)]);
 await db.query('DELETE FROM channel_members WHERE user_id=$1',[id(2)]);
 await as(2);assert.deepEqual(await names(),[`${id(1)}/cv.pdf`,`${id(1)}/photo.jpg`,'public.txt']);
 await as(3);assert.deepEqual(await names(),['public.txt']);
 await as(null);assert.deepEqual(await names(),['public.txt']);
 // Context references cannot launder another person's private file into access.
 await db.exec('RESET ROLE');await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[id(2)]);
 await assert.rejects(db.query('INSERT INTO channel_messages VALUES($1,$2,$3,$4)',[id(52),id(50),id(2),url(1)]),/attachment owner/);
 await assert.rejects(db.query('UPDATE conversations SET group_avatar_url=$1 WHERE id=$2',[url(1),id(11)]),/belong to the editor/);
 await assert.rejects(db.query('INSERT INTO job_applications VALUES($1,$2,$3,$4)',[id(62),id(60),id(2),url(1,'cv.pdf','chat-files')]),/attachment owner/);
 // Forwarding grants only the destination's current participants, not outsiders.
 await db.query(`INSERT INTO messages(id,sender_id,conversation_id,media_url,media_type,forwarded_from_id) VALUES($1,$2,$3,$4,'image',$5)`,[id(22),id(2),id(12),url(1),id(20)]);
 await as(3);assert.deepEqual(await names(),[`${id(1)}/photo.jpg`,'public.txt']);
 // Server timestamps cannot be forged, and group sweeping cannot end direct calls.
 await db.exec('RESET ROLE');
 await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[id(1)]);
 await db.exec(`ALTER TABLE call_sessions DISABLE TRIGGER call_context_guard; ALTER TABLE call_sessions DISABLE TRIGGER call_session_lifecycle_guard;
 INSERT INTO call_sessions(id,initiator_id,receiver_id,is_group_call,status,created_at,started_at) VALUES
 ('${id(70)}','${id(1)}','${id(2)}',false,'active',now()-interval '3 minutes',now()-interval '3 minutes'),
 ('${id(71)}','${id(1)}',null,true,'active',now()-interval '3 minutes',now()-interval '3 minutes');
 ALTER TABLE call_sessions ENABLE TRIGGER call_session_lifecycle_guard; ALTER TABLE call_sessions ENABLE TRIGGER call_context_guard;`);
 const before=(await db.query('SELECT started_at FROM call_sessions WHERE id=$1',[id(70)])).rows[0].started_at;
 await db.query("UPDATE call_sessions SET started_at=now()+interval '1 day',duration_sec=999999 WHERE id=$1",[id(70)]);
 assert.equal((await db.query('SELECT started_at FROM call_sessions WHERE id=$1',[id(70)])).rows[0].started_at.getTime(),before.getTime());
 await db.query('SELECT sweep_dead_calls()');
 assert.deepEqual((await db.query('SELECT status FROM call_sessions ORDER BY id')).rows.map(r=>r.status),['active','ended']);
 await db.query(`INSERT INTO call_participants(call_session_id,user_id,status,joined_at,last_seen_at) VALUES($1,$2,'joined',now(),now())`,[id(70),id(1)]);
 await db.query("UPDATE call_participants SET last_seen_at=now()+interval '1 year' WHERE call_session_id=$1",[id(70)]);
 assert.equal((await db.query("SELECT last_seen_at<=now() ok FROM call_participants WHERE call_session_id=$1",[id(70)])).rows[0].ok,true);
 await assert.rejects(db.query(`INSERT INTO call_sessions(id,conversation_id,initiator_id,receiver_id,is_group_call,status) VALUES($1,$2,$3,$4,false,'ringing')`,[id(72),id(12),id(1),id(2)]),/do not match/);
 await db.query('INSERT INTO blocked_users VALUES($1,$2)',[id(2),id(1)]);
 await assert.rejects(db.query(`INSERT INTO call_sessions(id,conversation_id,initiator_id,receiver_id,is_group_call,status) VALUES($1,$2,$3,$4,false,'ringing')`,[id(72),id(10),id(1),id(2)]),/not available/);
 await db.query('SELECT start_group_call($1,false)',[id(11)]);
 await assert.rejects(db.query('SELECT start_group_call($1,false)',[id(11)]),/already running/);

 } finally { await db.close(); }
});
