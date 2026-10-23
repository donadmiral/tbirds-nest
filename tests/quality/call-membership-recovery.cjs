const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { PGlite } = require('../../supabase/tests/rpc-authorization/node_modules/@electric-sql/pglite');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
test('group-call recovery fences a delayed leave to its own admission and cannot evict a rejoin or another user', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO authenticated;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      CREATE FUNCTION can_act_as(p uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT coalesce(p=auth.uid(),false) $$;
      CREATE TABLE conversations(id uuid PRIMARY KEY,is_group boolean,user_1 uuid,user_2 uuid);
      CREATE TABLE conversation_members(conversation_id uuid,user_id uuid,PRIMARY KEY(conversation_id,user_id));
      CREATE FUNCTION is_conversation_member(c uuid,u uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT EXISTS(SELECT 1 FROM conversation_members WHERE conversation_id=c AND user_id=u) $$;
      CREATE TABLE messages(id uuid PRIMARY KEY,sender_id uuid,receiver_id uuid,conversation_id uuid,media_url text,thumbnail_url text,media_type text,view_limit smallint,forwarded_from_id uuid,deleted_at timestamptz);
      CREATE TABLE message_views(message_id uuid,user_id uuid,views integer,first_viewed_at timestamptz,PRIMARY KEY(message_id,user_id));
      CREATE TABLE call_sessions(id uuid PRIMARY KEY,conversation_id uuid,initiator_id uuid,receiver_id uuid,is_group_call boolean,status text,created_at timestamptz DEFAULT now(),expires_at timestamptz,started_at timestamptz,ended_at timestamptz,duration_sec integer);
      CREATE TABLE call_participants(call_session_id uuid,user_id uuid,status text,joined_at timestamptz,left_at timestamptz,last_seen_at timestamptz,PRIMARY KEY(call_session_id,user_id));
      INSERT INTO conversations VALUES('${id(10)}',true,'${id(1)}',null);
      INSERT INTO conversation_members VALUES('${id(10)}','${id(1)}'),('${id(10)}','${id(2)}');`);
    for (const file of ['20261022211236_message_call_access.sql', '20261023193500_call_membership_recovery.sql']) await db.exec(fs.readFileSync(path.join(__dirname, '../../supabase/migrations', file), 'utf8'));
    const as = user => db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [user ? id(user) : '']);
    const value = async (sql, args = []) => (await db.query(sql, args)).rows[0];
    await as(1);
    await db.query(`INSERT INTO call_sessions(id,conversation_id,initiator_id,is_group_call,status,expires_at) VALUES($1,$2,$3,true,'ringing',now()+interval '90 seconds')`, [id(20), id(10), id(1)]);
    await db.query('SELECT join_group_call($1)', [id(20)]);
    await as(2); const admission = await value('SELECT join_group_call_membership($1) identity', [id(20)]);
    const first = (await value('SELECT provider_identity FROM call_participants WHERE call_session_id=$1 AND user_id=$2', [id(20), id(2)])).provider_identity;
    assert.equal(admission.identity, first);
    // Existing start RPC creates/resolves the canonical session. Its wrapper
    // must return that session and the newly admitted identity atomically.
    await db.exec(`CREATE FUNCTION public.start_group_call(uuid,boolean) RETURNS uuid LANGUAGE sql AS $$ SELECT '${id(20)}'::uuid $$;`);
    // The first device's close was offline. A new admission still needs its own identity.
    const started = (await value('SELECT start_group_call_membership($1,false) admission', [id(10)])).admission;
    const second = (await value('SELECT provider_identity FROM call_participants WHERE call_session_id=$1 AND user_id=$2', [id(20), id(2)])).provider_identity;
    assert.notEqual(first, second);
    assert.equal(started.session_id, id(20)); assert.equal(started.provider_identity, second);
    assert.equal((await value('SELECT count(*)::int n FROM call_provider_revocations WHERE provider_user_id=$1', [first])).n, 1);
    assert.equal((await value('SELECT leave_group_call_membership($1,$2) closed', [id(20), first])).closed, false);
    assert.equal((await value('SELECT status FROM call_participants WHERE call_session_id=$1 AND user_id=$2', [id(20), id(2)])).status, 'joined');
    await as(3);
    assert.equal((await value('SELECT leave_group_call_membership($1,$2) closed', [id(20), second])).closed, false);
    await assert.rejects(db.query('SELECT join_group_call($1)', [id(20)]), /Not a member/);
    await as(2); await db.exec('SET ROLE authenticated');
    await assert.rejects(db.query('UPDATE call_participants SET provider_identity=$1', [id(99)]), /permission denied/);
    await assert.rejects(db.query("UPDATE call_participants SET status='joined'"), /permission denied/);
    assert.equal((await value('SELECT leave_group_call_membership($1,$2) closed', [id(20), second])).closed, true);
    assert.equal((await value('SELECT leave_group_call_membership($1,$2) closed', [id(20), second])).closed, false);
    await assert.rejects(db.query('SELECT leave_group_call_membership($1,NULL)', [id(20)]), /Membership identity required/);
    await db.exec('RESET ROLE');
    assert.equal((await value('SELECT status FROM call_sessions WHERE id=$1', [id(20)])).status, 'active');
    await as(1);
    const creator = (await value('SELECT provider_identity FROM call_participants WHERE call_session_id=$1 AND user_id=$2', [id(20), id(1)])).provider_identity;
    assert.equal((await value('SELECT leave_group_call_membership($1,$2) closed', [id(20), creator])).closed, true);
    assert.equal((await value('SELECT status FROM call_sessions WHERE id=$1', [id(20)])).status, 'ended');
    await as(null); await assert.rejects(db.query('SELECT leave_group_call_membership($1,$2)', [id(20), creator]), /Authentication required/);
    await db.exec('SET ROLE anon'); await assert.rejects(db.query('SELECT leave_group_call_membership($1,$2)', [id(20), creator]), /permission denied/);
  } finally { await db.close(); }
});
