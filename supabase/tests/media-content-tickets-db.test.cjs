const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { before, after, beforeEach, afterEach, test } = require('node:test');
const { LocalPsqlSession } = require('./local-psql-session.cjs');

if (!process.env.PC_TEST_PSQL && !process.env.PC_TEST_PGLITE) test('content ticket prerequisites require isolated PostgreSQL', { skip: true }, () => {});
else {
  const root = path.resolve(__dirname, '../..');
  const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261102163428_production_content_media_tickets.sql'), 'utf8');
  const chatMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20261105172326_chat_media_ticket_delivery_completion.sql'), 'utf8');
  const versionMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20261105180908_content_media_ticket_versions_v2.sql'), 'utf8');
  const chatForward = chatMigration.replace(/^begin;$/m, '').replace(/^commit;$/m, '');
  const preflight = migration.match(/do \$preflight\$[\s\S]*?\$preflight\$;/)[0];
  const preservation = fs.readFileSync(path.join(root, 'supabase/ops/production-content-media-tickets-20261102/preservation.sql'), 'utf8');
  const id = n => `72000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const users = { owner: id(1), viewer: id(2), stranger: id(3) };
  const sessions = { owner: id(101), viewer: id(102), stranger: id(103) };
  const literal = value => "'" + String(value).replaceAll("'", "''") + "'";
  const json = value => literal(JSON.stringify(value)) + '::jsonb';
  let db, initialState, installedState, chatBefore, chatAfter, versionBefore, versionAfter, guardResults = [];
  const query = sql => db.query(sql);
  const value = async sql => { const text = await query(sql); return text ? JSON.parse(text) : null; };
  const attempt = command => value(`select public.fixture_ticket_try(${literal(command)})`);
  async function as(name, sql, { role = 'authenticated', claims = {} } = {}) {
    const jwt = { sub: users[name] || null, role, session_id: sessions[name] || null, is_anonymous: false, ...claims };
    await query(`set local role ${role}; select set_config('request.jwt.claim.sub',${literal(jwt.sub || '')},true),set_config('request.jwt.claim.role',${literal(jwt.role)},true),set_config('request.jwt.claims',${literal(JSON.stringify(jwt))},true)`);
    try {
      const result = await attempt(sql);
      // Observe the callee's claims before the harness restores anything.
      assert.deepEqual(await value("select jsonb_build_object('sub',auth.uid(),'role',auth.role(),'claims',auth.jwt())"),
        { sub: jwt.sub, role: jwt.role, claims: jwt });
      return result;
    }
    finally { if (!db.ended) await query("reset role;select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claim.role','service_role',true),set_config('request.jwt.claims','{\"role\":\"service_role\"}',true)"); }
  }
  async function issue(name, entity, options) {
    return as(name, `select coalesce(jsonb_agg(t),'[]'::jsonb) from public.issue_content_media_delivery(${json([{ kind: 'post', id: entity }])},null) t`, options);
  }
  const issueV2 = (name, entity, options) => as(name, `select coalesce(jsonb_agg(t),'[]'::jsonb) from public.issue_content_media_delivery_v2(${json([{ kind: 'post', id: entity }])},null) t`, options);
  async function redeem(ticket) {
    return as(null, `select public.resolve_media_delivery(${literal(ticket.token)},${literal(ticket.bucket_id)},${literal(ticket.object_path)})`, { role: 'service_role' });
  }
  async function object(n = 1, owner = users.owner, bucket = 'post-media') {
    const objectId = id(1000 + n), objectPath = `${users.owner}/ticket-${n}.mp4`, version = `version-${n}`;
    await query(`insert into storage.objects(id,bucket_id,name,owner_id,owner,version) values('${objectId}',${literal(bucket)},${literal(objectPath)},${owner ? literal(owner) : 'null'},${owner ? literal(owner) : 'null'},${literal(version)})`);
    return { id: objectId, bucket, path: objectPath, version, url: `https://fixture.supabase.co/storage/v1/object/public/${bucket}/${objectPath}` };
  }
  async function post(media, audience = 'everyone', n = 1) {
    const entity = id(2000 + n);
    await query(`insert into public.posts(id,user_id,body,scope,audience,media_url) values('${entity}','${users.owner}','Synthetic ticket test','global',${literal(audience)},${literal(media.url)})`);
    return entity;
  }
  const enable = () => query('update media_delivery.prerequisite_settings set enabled=true where singleton');
  const issued = async (name, entity) => {
    const response = await issue(name, entity); assert.equal(response.ok, true, response.error); assert.equal(response.value.length, 1); return response.value[0];
  };
  async function chat(media, { limited = false, n = 1 } = {}) {
    let conversation = await value(`select to_jsonb(id) from public.conversations where user_1='${users.owner}' and user_2='${users.viewer}' limit 1`);
    if (!conversation) conversation = await value(`insert into public.conversations(user_1,user_2) values('${users.owner}','${users.viewer}') returning to_jsonb(id)`);
    const response = await as('owner', `insert into public.messages(id,conversation_id,sender_id,receiver_id,media_url,media_type,view_limit) values('${id(3000+n)}','${conversation}','${users.owner}','${users.viewer}',${literal(media.url)},'image',${limited ? 1 : 'null'}) returning to_jsonb(id)`);
    assert.equal(response.ok, true, response.error);
    return { id: response.value, conversation };
  }
  const issueChat = (name, message, options) => as(name, `select coalesce(jsonb_agg(t),'[]'::jsonb) from public.issue_chat_media_delivery(array['${message.id}'::uuid]) t`, options);
  const issueObject = (name, url, options) => as(name, `select coalesce(jsonb_agg(t),'[]'::jsonb) from public.issue_chat_object_delivery(array[${literal(url)}]) t`, options);
  const chatIssued = async message => {
    const response = await issueChat('viewer', message); assert.equal(response.ok, true, response.error); assert.equal(response.value.length, 1); return response.value[0];
  };
  const preservedChatState = `select jsonb_build_object(
    'content_issuer',(select pg_get_functiondef(p.oid)||p.proacl::text from pg_proc p where oid='public.issue_content_media_delivery(jsonb,jsonb)'::regprocedure),
    'settings',(select to_jsonb(s) from media_delivery.prerequisite_settings s),
    'buckets',(select jsonb_agg(to_jsonb(b) order by id) from storage.buckets b),
    'storage_policies',(select jsonb_agg(to_jsonb(p) order by oid) from pg_policy p where polrelid='storage.objects'::regclass))`;
  const preservedVersionState = `select jsonb_build_object(
    'functions',(select md5(string_agg(pg_get_functiondef(p.oid)||coalesce(p.proacl::text,''),E'\\n' order by p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname in('public','auth','media_delivery','live_streams') and p.prokind='f' and p.proname<>'issue_content_media_delivery_v2'),
    'settings',(select to_jsonb(s) from media_delivery.prerequisite_settings s),
    'buckets',(select jsonb_agg(to_jsonb(b) order by id) from storage.buckets b),
    'policies',(select jsonb_agg(to_jsonb(p) order by oid) from pg_policy p))`;

  before(async () => {
    if (process.env.PC_TEST_PSQL) {
      assert.equal(process.env.PGDATABASE, 'pc_scale_media_tickets', 'Dedicated disposable database required');
      db = new LocalPsqlSession();
    } else {
      const { PGlite } = require('./rpc-authorization/node_modules/@electric-sql/pglite');
      const { extensions } = await import('./rpc-authorization/live-schema-fixture.mjs');
      const engine = new PGlite({ extensions });
      db = { query: async sql => (await engine.exec(sql)).flatMap(result => result.rows.map(row => Object.values(row).map((item, index) => [114, 3802].includes(result.fields[index].dataTypeID) ? JSON.stringify(item) : String(item ?? '')).join('|'))).join('\n'), close: () => engine.close() };
    }
    await query("set client_min_messages='warning';do $$begin if not exists(select 1 from pg_roles where rolname='postgres') then create role postgres superuser;end if;end$$;set role postgres;drop publication if exists supabase_realtime;do $$declare n record;begin for n in select nspname from pg_namespace where nspname not like 'pg_%' and nspname<>'information_schema' loop execute format('drop schema %I cascade',n.nspname);end loop;end$$;create schema public");
    const { loadDeployedMediaBaseline } = await import('./rpc-authorization/deployed-media-baseline.mjs');
    const adapter = { exec: sql => query(sql.replace(/create role (anon|authenticated|service_role);/g, (_, role) => `do $$begin if not exists(select 1 from pg_roles where rolname='${role}') then create role ${role};end if;end$$;`)) };
    assert.deepEqual(await loadDeployedMediaBaseline(adapter), { units: 25, repairs: 4 });
    await query('grant usage on schema public to anon,authenticated,service_role');
    await query("create function public.fixture_ticket_try(command text) returns jsonb language plpgsql as $$declare result jsonb;begin execute command into result;return jsonb_build_object('ok',true,'value',result);exception when others then return jsonb_build_object('ok',false,'error',sqlerrm,'code',sqlstate);end$$;grant execute on function public.fixture_ticket_try(text) to anon,authenticated,service_role");
    for (const [name, user] of Object.entries(users)) {
      await query(`insert into auth.users(id,email) values('${user}','ticket-${name}@example.invalid');insert into public.profiles(id,username,full_name,email,profile_visibility) values('${user}','ticket_${name}','Synthetic ${name}','ticket-${name}@example.invalid','public') on conflict(id) do update set username=excluded.username,profile_visibility='public';insert into auth.sessions(id,user_id,aal) values('${sessions[name]}','${user}','aal1')`);
    }
    for (const [label, mutation, error] of [
      ['existing full or partial delivery', 'create schema media_delivery', 'CONTENT_TICKETS_EXISTING_DELIVERY_REQUIRES_FORWARD_RECONCILIATION'],
      ['business authority requires reviewed forward contract', 'create schema business_auth', 'CONTENT_TICKETS_BUSINESS_AUTH_REQUIRES_FORWARD_RECONCILIATION'],
      ['canonical authority ACL drift', 'grant execute on function public.content_media_manifest(jsonb) to anon', 'CONTENT_TICKETS_CANONICAL_BASELINE_CHANGED'],
      ['missing managed session revocation field', 'alter table auth.users drop column banned_until', 'CONTENT_TICKETS_AUTH_COLUMNS_REQUIRED'],
    ]) {
      await query('begin'); await query(mutation);
      const response = await attempt(preflight); assert.equal(response.ok, false); assert.ok(response.error.includes(error), response.error);
      await query('rollback'); guardResults.push(label);
    }
    // The actual compatible reader package goes first, as it will in production.
    await query(fs.readFileSync(path.join(root, 'supabase/migrations/20261102162736_production_compatible_paged_readers.sql'), 'utf8'));
    initialState = await value(preservation);
    await query(migration);
    installedState = await value(preservation);
    // The deployed channel extension must survive the ordinary-chat catch-up.
    await query("alter table media_delivery.tickets drop constraint tickets_source_kind_check;alter table media_delivery.tickets add constraint tickets_source_kind_check check(source_kind in('post','story','sound','story_draft','memory_album','highlight','upload','channel_message'))");
    chatBefore = await value(preservedChatState);
    await query(chatMigration);
    chatAfter = await value(preservedChatState);
    versionBefore = await value(preservedVersionState);
    await query(versionMigration);
    versionAfter = await value(preservedVersionState);
  });
  beforeEach(() => query("begin;reset role;set request.jwt.claim.role='service_role';set request.jwt.claims='{\"role\":\"service_role\"}';set request.jwt.claim.sub=''"));
  afterEach(() => query('rollback'));
  after(() => db?.close());

  test('installs after real compatible readers with every existing public/Auth function, bucket and Storage policy preserved', async () => {
    assert.deepEqual(installedState, initialState);
    assert.equal(await value("select to_jsonb(count(*)) from storage.buckets where id in('post-media','story-media','media','chat-media','chat-files') and public"), 5);
    assert.equal(await value("select to_regnamespace('account_erasure') is not null or to_regnamespace('music_library') is not null".replace('select ', 'select to_jsonb(') + ')'), false);
    assert.deepEqual(await value('select to_jsonb(s) from media_delivery.prerequisite_settings s'), { singleton: true, enabled: false });
    const entity = await post(await object()); const response = await issue('viewer', entity);
    assert.equal(response.ok, false); assert.equal(response.error, 'MEDIA_CONTENT_DELIVERY_NOT_READY');
    assert.equal(await value('select to_jsonb(count(*)) from media_delivery.tickets'), 0);
  });
  test('installation guards reject existing delivery, business authority, canonical ACL drift and missing Auth revocation fields', () => assert.equal(guardResults.length, 4));
  test('versioned issuance is additive, authenticated-only and leaves every existing function, policy and flag unchanged', async () => {
    assert.deepEqual(versionAfter, versionBefore);
    for (const role of ['anon', 'authenticated', 'service_role']) {
      assert.equal(await value(`select to_jsonb(has_function_privilege('${role}','public.issue_content_media_delivery_v2(jsonb,jsonb)','execute'))`), role === 'authenticated');
      assert.equal((await as('viewer', 'select to_jsonb(count(*)) from media_delivery.tickets', { role })).ok, false);
    }
    const entity = await post(await object());
    const response = await issueV2('viewer', entity);
    assert.equal(response.ok, false); assert.equal(response.error, 'MEDIA_CONTENT_DELIVERY_NOT_READY');
    assert.equal(await value('select to_jsonb(count(*)) from media_delivery.tickets'), 0);
  });
  test('versioned issuance sees its own inserted ticket and returns the exact replacement version on the next request', async () => {
    await enable(); const media = await object(), entity = await post(media);
    const first = await issueV2('viewer', entity); assert.equal(first.ok, true, first.error); assert.equal(first.value.length, 1);
    const ticket = first.value[0]; assert.equal(ticket.object_version, media.version);
    assert.deepEqual(Object.keys(ticket).sort(), ['bucket_id', 'expires_at', 'object_path', 'object_version', 'token']);
    const stored = await value(`select jsonb_build_object('user_id',user_id,'session_id',session_id,'version',object_version,'bucket',bucket_id,'path',object_path,'expires_at',expires_at) from media_delivery.tickets where token_digest=extensions.digest(${literal(ticket.token)},'sha256')`);
    assert.deepEqual(stored, { user_id: users.viewer, session_id: sessions.viewer, version: ticket.object_version, bucket: ticket.bucket_id, path: ticket.object_path, expires_at: ticket.expires_at });
    await query(`update storage.objects set version='replacement-v2' where id='${media.id}'`);
    assert.equal((await redeem(ticket)).value, null);
    const second = await issueV2('viewer', entity); assert.equal(second.ok, true, second.error); assert.equal(second.value.length, 1);
    assert.equal(second.value[0].object_version, 'replacement-v2'); assert.notEqual(second.value[0].token, ticket.token);
    assert.equal((await redeem(second.value[0])).value.version, 'replacement-v2');
    const legacy = await issued('viewer', entity); assert.equal(legacy.object_version, undefined, 'The existing RPC shape remains unchanged');
  });
  test('versioned issuance retains role, live session, audience, block and object-owner authorization', async () => {
    await enable(); const media = await object(), entity = await post(media, 'followers');
    assert.deepEqual((await issueV2('viewer', entity)).value, []);
    await query(`insert into public.follows(follower_id,following_id) values('${users.viewer}','${users.owner}')`);
    assert.equal((await issueV2('viewer', entity)).value.length, 1);
    for (const role of ['anon', 'service_role']) assert.equal((await issueV2('viewer', entity, { role })).code, '42501');
    for (const claims of [{ is_anonymous: true }, { session_id: null }, { session_id: id(9999) }, { session_id: sessions.owner }]) {
      const response = await issueV2('viewer', entity, { claims }); assert.equal(response.code, '42501'); assert.equal(response.error, 'MEDIA_SESSION_REQUIRED');
    }
    await query(`update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='${sessions.viewer}'`);
    assert.equal((await issueV2('viewer', entity)).error, 'MEDIA_SESSION_REQUIRED');
    await query(`update auth.sessions set not_after=null where id='${sessions.viewer}';insert into public.blocked_users(blocker_id,blocked_id) values('${users.owner}','${users.viewer}')`);
    assert.deepEqual((await issueV2('viewer', entity)).value, []);
    await query(`delete from public.blocked_users;update storage.objects set owner='${users.stranger}',owner_id='${users.stranger}' where id='${media.id}'`);
    assert.deepEqual((await issueV2('viewer', entity)).value, []);
  });
  test('versioned issuance delegates input caps and upload ownership without adding private-chat capabilities', async () => {
    await enable(); const media = await object(), entity = await post(media);
    for (const [references, uploads] of [[null, null], [[{ kind: 'post', id: entity }], [media.url]], [Array.from({ length: 101 }, () => ({ kind: 'post', id: entity })), null]]) {
      assert.equal((await as('viewer', `select coalesce(jsonb_agg(t),'[]'::jsonb) from public.issue_content_media_delivery_v2(${references === null ? 'null' : json(references)},${uploads === null ? 'null' : json(uploads)}) t`)).ok, false);
    }
    const upload = (name, url) => as(name, `select coalesce(jsonb_agg(t),'[]'::jsonb) from public.issue_content_media_delivery_v2(null,${json([url])}) t`);
    assert.deepEqual((await upload('viewer', media.url)).value, []);
    const owned = await upload('owner', media.url); assert.equal(owned.ok, true, owned.error); assert.equal(owned.value[0].object_version, media.version);
    const privateMedia = await object(2, users.owner, 'chat-media');
    const excluded = await upload('owner', privateMedia.url); assert.ok(!excluded.ok || excluded.value.length === 0);
  });
  test('versioned issuance refuses a ticket for another user or session even if a faulty issuer returns it', async () => {
    await enable(); const entity = await post(await object()), ticket = await issued('owner', entity);
    await query(`create or replace function public.issue_content_media_delivery(p_references jsonb default null,p_uploads jsonb default null)
      returns table(bucket_id text,object_path text,token text,expires_at timestamptz) language sql security definer set search_path='' as $body$
      select ${literal(ticket.bucket_id)}::text,${literal(ticket.object_path)}::text,${literal(ticket.token)}::text,${literal(ticket.expires_at)}::timestamptz $body$`);
    const foreign = await issueV2('viewer', entity); assert.equal(foreign.ok, false); assert.equal(foreign.error, 'CONTENT_DELIVERY_TICKET_VERSION_UNAVAILABLE');
    await query(`update media_delivery.tickets set user_id='${users.viewer}' where token_digest=extensions.digest(${literal(ticket.token)},'sha256')`);
    const wrongSession = await issueV2('viewer', entity); assert.equal(wrongSession.ok, false); assert.equal(wrongSession.error, 'CONTENT_DELIVERY_TICKET_VERSION_UNAVAILABLE');
  });
  test('issuer is authenticated-only; resolver service-only; every private table/helper is unavailable to client and service roles', async () => {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      assert.equal(await value(`select to_jsonb(has_function_privilege('${role}','public.issue_content_media_delivery(jsonb,jsonb)','execute'))`), role === 'authenticated');
      assert.equal(await value(`select to_jsonb(has_function_privilege('${role}','public.resolve_media_delivery(text,text,text)','execute'))`), role === 'service_role');
      for (const table of ['tickets', 'prerequisite_settings']) assert.equal((await as('viewer', `select to_jsonb(count(*)) from media_delivery.${table}`, { role })).ok, false);
      assert.equal(await value(`select to_jsonb(has_function_privilege('${role}','media_delivery.require_session()','execute'))`), false);
    }
  });
  test('follower access is checked on issuance and again on every ticket redemption', async () => {
    await enable(); const media = await object(), entity = await post(media, 'followers');
    assert.deepEqual((await issue('viewer', entity)).value, []);
    await query(`insert into public.follows(follower_id,following_id) values('${users.viewer}','${users.owner}')`);
    const ticket = await issued('viewer', entity); assert.match(ticket.token, /^[0-9a-f]{64}$/);
    assert.deepEqual((await redeem(ticket)).value, { bucket: media.bucket, path: media.path, version: media.version, expiresAt: ticket.expires_at });
    await query(`delete from public.follows where follower_id='${users.viewer}' and following_id='${users.owner}'`);
    assert.equal((await redeem(ticket)).value, null);
  });
  test('anonymous, missing, wrong-owner and expired sessions cannot issue tickets', async () => {
    await enable(); const entity = await post(await object());
    for (const claims of [{ is_anonymous: true }, { session_id: id(999) }, { session_id: sessions.owner }]) {
      const response = await issue('viewer', entity, { claims }); assert.equal(response.ok, false); assert.equal(response.error, 'MEDIA_SESSION_REQUIRED');
    }
    await query(`update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='${sessions.viewer}'`);
    assert.equal((await issue('viewer', entity)).error, 'MEDIA_SESSION_REQUIRED');
  });
  test('exact object ID, version, owner, path and expiry pin the bytes; replacements cannot inherit a ticket', async () => {
    await enable(); const media = await object(), entity = await post(media), ticket = await issued('viewer', entity);
    assert.equal((await redeem({ ...ticket, object_path: `${users.owner}/wrong.mp4` })).value, null);
    assert.equal((await redeem({ ...ticket, token: 'f'.repeat(64) })).value, null);
    await query(`update storage.objects set version='replacement' where id='${media.id}'`); assert.equal((await redeem(ticket)).value, null);
    const current = await issued('viewer', entity);
    await query(`update storage.objects set owner='${users.stranger}',owner_id='${users.stranger}' where id='${media.id}'`);
    assert.equal((await redeem(current)).value, null); assert.deepEqual((await issue('viewer', entity)).value, []);
    await query(`update storage.objects set owner='${users.owner}',owner_id='${users.owner}' where id='${media.id}'`);
    const expiring = await issued('viewer', entity); await query("update media_delivery.tickets set expires_at=clock_timestamp()-interval '1 second'"); assert.equal((await redeem(expiring)).value, null);
  });
  test('block, session deletion, ban, identity deletion and readiness shutdown revoke tickets while restoring caller claims', async () => {
    await enable(); const media = await object(), entity = await post(media), ticket = await issued('viewer', entity);
    await query(`insert into public.blocked_users(blocker_id,blocked_id) values('${users.owner}','${users.viewer}')`); assert.equal((await redeem(ticket)).value, null);
    await query(`delete from public.blocked_users where blocker_id='${users.owner}' and blocked_id='${users.viewer}'`);
    for (const column of ['banned_until', 'deleted_at']) {
      await query(`update auth.users set ${column}=clock_timestamp()+interval '1 day' where id='${users.viewer}'`); assert.equal((await redeem(ticket)).value, null);
      await query(`update auth.users set ${column}=null where id='${users.viewer}'`);
    }
    await query('update media_delivery.prerequisite_settings set enabled=false'); assert.equal((await redeem(ticket)).value, null); await enable();
    assert.ok((await redeem(ticket)).value);
    await query(`delete from auth.sessions where id='${sessions.viewer}'`); assert.equal((await redeem(ticket)).value, null);
    assert.deepEqual(await value("select jsonb_build_object('sub',auth.uid(),'role',auth.role(),'claims',auth.jwt())"), { sub: null, role: 'service_role', claims: { role: 'service_role' } });
  });
  test('upload issuance requires exact ownership and never admits chat or music-audio objects', async () => {
    await enable(); const media = await object();
    const upload = (name, url) => as(name, `select coalesce(jsonb_agg(t),'[]'::jsonb) from public.issue_content_media_delivery(null,${json([url])}) t`);
    assert.deepEqual((await upload('viewer', media.url)).value, []); const owned = await upload('owner', media.url); assert.equal(owned.ok, true); assert.equal(owned.value.length, 1);
    assert.ok((await redeem(owned.value[0])).value);
    for (const bucket of ['chat-media', 'chat-files', 'music-audio']) {
      if (bucket === 'music-audio') await query("insert into storage.buckets(id,name,public) values('music-audio','music-audio',false)");
      const excluded = await object(10 + ['chat-media', 'chat-files', 'music-audio'].indexOf(bucket), users.owner, bucket);
      const result = await upload('owner', excluded.url); assert.ok(!result.ok || result.value.length === 0);
    }
    assert.equal(await value("select to_jsonb(count(*)) from media_delivery.tickets where bucket_id not in('post-media','story-media','media')"), 0);
  });
  test('reviewed ownerless legacy snapshots preserve reads but never become upload ownership', async () => {
    await enable(); const media = await object(1, null), entity = await post(media);
    await query(`insert into content_media_legacy.snapshots(entity_kind,entity_id,author_id,publication_created_at,object_id,bucket_id,object_path,canonical_url,object_version) select 'post',p.id,p.user_id,p.created_at,o.id,o.bucket_id,o.name,${literal(media.url)},o.version from public.posts p cross join storage.objects o where p.id='${entity}' and o.id='${media.id}'`);
    const ticket = await issued('viewer', entity); assert.ok((await redeem(ticket)).value);
    await query('update content_media_legacy.snapshots set revoked_at=clock_timestamp()'); assert.equal((await redeem(ticket)).value, null);
  });
  test('expiry cleanup is bounded even when stale tickets exceed a normal request budget', async () => {
    await enable(); const entity = await post(await object()), ticket = await issued('viewer', entity);
    await query(`insert into media_delivery.tickets select extensions.digest(g::text,'sha256'),user_id,session_id,object_id,object_version,object_owner,bucket_id,object_path,source_kind,source_id,source_url,clock_timestamp()-interval '1 hour',created_at from media_delivery.tickets cross join generate_series(1,2005)g where token_digest=extensions.digest(${literal(ticket.token)},'sha256')`);
    await issued('viewer', entity);
    assert.equal(await value("select to_jsonb(count(*)) from media_delivery.tickets where expires_at<clock_timestamp()-interval '5 minutes'"), 5);
  });
  test('chat catch-up is repeatable and preserves existing content, disabled readiness, channel kind and Storage policies', async () => {
    assert.deepEqual(chatAfter, chatBefore);
    await query(chatForward);
    assert.deepEqual(await value(preservedChatState), chatBefore);
    const constraint = await value("select to_jsonb(pg_get_constraintdef(oid)) from pg_constraint where conrelid='media_delivery.tickets'::regclass and conname='tickets_source_kind_check'");
    for (const kind of ['channel_message', 'chat', 'chat_object']) assert.ok(constraint.includes(`'${kind}'`));
    for (const role of ['anon', 'authenticated', 'service_role']) {
      for (const signature of ['public.issue_chat_media_delivery(uuid[])', 'public.issue_chat_object_delivery(text[])'])
        assert.equal(await value(`select to_jsonb(has_function_privilege('${role}','${signature}','execute'))`), role === 'authenticated');
      for (const signature of ['public.chat_locator_unrestricted(text)', 'public.can_read_legacy_chat_object(text,text)'])
        assert.equal(await value(`select to_jsonb(has_function_privilege('${role}','${signature}','execute'))`), false);
    }
  });
  test('ordinary chat tickets require current membership and never consume or admit limited-view messages', async () => {
    await enable();
    const media = await object(1, users.owner, 'chat-media'), message = await chat(media);
    assert.deepEqual((await issueChat('stranger', message)).value, []);
    const ticket = await chatIssued(message); assert.match(ticket.token, /^[0-9a-f]{64}$/);
    assert.equal((await redeem(ticket)).value.version, media.version);
    const limited = await chat(await object(2, users.owner, 'chat-media'), { limited: true, n: 2 });
    assert.deepEqual((await issueChat('viewer', limited)).value, []);
    assert.equal(await value('select to_jsonb(count(*)) from public.message_views'), 0);
    assert.equal(await value('select to_jsonb(count(*)) from public.chat_media_view_grants'), 0);
  });
  test('ordinary chat redemption rechecks membership, deletion, exact source, live session and deadline', async () => {
    await enable(); const media = await object(1, users.owner, 'chat-media'), message = await chat(media), ticket = await chatIssued(message);
    await query(`update public.conversations set user_2='${users.stranger}' where id='${message.conversation}'`);
    assert.equal((await redeem(ticket)).value, null);
    await query(`update public.conversations set user_2='${users.viewer}' where id='${message.conversation}'`);
    assert.ok((await redeem(ticket)).value);
    await query(`update storage.objects set version='replacement' where id='${media.id}'`); assert.equal((await redeem(ticket)).value, null);
    const current = await chatIssued(message);
    await query(`update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='${sessions.viewer}'`); assert.equal((await redeem(current)).value, null);
    await query(`update auth.sessions set not_after=null where id='${sessions.viewer}'`);
    await query("update media_delivery.tickets set expires_at=clock_timestamp()-interval '1 second'"); assert.equal((await redeem(current)).value, null);
    const beforeDeletion = await chatIssued(message);
    await query(`update public.messages set deleted_at=clock_timestamp() where id='${message.id}'`); assert.equal((await redeem(beforeDeletion)).value, null);
  });
  test('group avatars require current membership while view-limited locators cannot become ordinary object tickets', async () => {
    await enable(); const media = await object(1, users.owner, 'chat-media');
    const group = await value(`insert into public.conversations(user_1,user_2,is_group,group_avatar_url) values('${users.owner}','${users.viewer}',true,${literal(media.url)}) returning to_jsonb(id)`);
    await query(`insert into public.conversation_members(conversation_id,user_id) values('${group}','${users.owner}'),('${group}','${users.viewer}')`);
    assert.deepEqual((await issueObject('stranger', media.url)).value, []);
    const response = await issueObject('viewer', media.url); assert.equal(response.ok, true, response.error); assert.equal(response.value.length, 1);
    const ticket = response.value[0]; assert.ok((await redeem(ticket)).value);
    await query(`delete from public.conversation_members where conversation_id='${group}' and user_id='${users.viewer}'`);
    assert.equal((await redeem(ticket)).value, null); assert.deepEqual((await issueObject('viewer', media.url)).value, []);
    const limitedMedia = await object(2, users.owner, 'chat-media'); await chat(limitedMedia, { limited: true, n: 2 });
    assert.deepEqual((await issueObject('viewer', limitedMedia.url)).value, []);
    assert.equal(await value('select to_jsonb(count(*)) from public.message_views'), 0);
  });
  test('both chat issuers retain readiness, session validation, input caps and role restrictions', async () => {
    const media = await object(1, users.owner, 'chat-media'), message = await chat(media);
    for (const response of [await issueChat('viewer', message), await issueObject('owner', media.url)]) {
      assert.equal(response.ok, false); assert.equal(response.error, 'MEDIA_CONTENT_DELIVERY_NOT_READY');
    }
    await enable();
    for (const call of [options => issueChat('viewer', message, options), options => issueObject('owner', media.url, options)]) {
      for (const role of ['anon', 'service_role']) assert.equal((await call({ role })).code, '42501');
      const response = await call({ claims: { session_id: id(9999) } }); assert.equal(response.code, '42501'); assert.equal(response.error, 'MEDIA_SESSION_REQUIRED');
    }
    for (const [signature, argument] of [
      ['issue_chat_media_delivery', `array_fill('${message.id}'::uuid,array[101])`],
      ['issue_chat_object_delivery', `array_fill(${literal(media.url)},array[101])`],
    ]) assert.equal((await as('viewer', `select to_jsonb(t) from public.${signature}(${argument}) t`)).ok, false);
    const ticket = await chatIssued(message); await query('update media_delivery.prerequisite_settings set enabled=false');
    assert.equal((await redeem(ticket)).value, null);
  });
  test('chat cleanup cannot delete more than 2000 stale capabilities per request', async () => {
    await enable(); const message = await chat(await object(1, users.owner, 'chat-media')), ticket = await chatIssued(message);
    await query(`insert into media_delivery.tickets select extensions.digest(g::text,'sha256'),user_id,session_id,object_id,object_version,object_owner,bucket_id,object_path,source_kind,source_id,source_url,clock_timestamp()-interval '1 hour',created_at from media_delivery.tickets cross join generate_series(1,2005)g where token_digest=extensions.digest(${literal(ticket.token)},'sha256')`);
    await chatIssued(message);
    assert.equal(await value("select to_jsonb(count(*)) from media_delivery.tickets where expires_at<clock_timestamp()-interval '5 minutes'"), 5);
  });
  test('a fixed cleanup cutoff reaches an empty expiry index range without scanning fresh ticket rows', async () => {
    await enable(); const message = await chat(await object(1, users.owner, 'chat-media')), ticket = await chatIssued(message);
    await query(`insert into media_delivery.tickets select extensions.digest(g::text,'sha256'),user_id,session_id,object_id,object_version,object_owner,bucket_id,object_path,source_kind,source_id,source_url,clock_timestamp()+interval '1 hour',created_at from media_delivery.tickets cross join generate_series(1,10000)g where token_digest=extensions.digest(${literal(ticket.token)},'sha256');analyze media_delivery.tickets`);
    const cutoff = await value("select to_jsonb(clock_timestamp()-interval '5 minutes')");
    const response = await attempt(`explain(analyze,buffers,format json) with expired as(select stale.token_digest from media_delivery.tickets stale where stale.expires_at<${literal(cutoff)}::timestamptz order by stale.expires_at,stale.token_digest limit 2000 for update skip locked) delete from media_delivery.tickets t using expired e where t.token_digest=e.token_digest`);
    assert.equal(response.ok, true, response.error);
    const nodes = []; const walk = node => { if (!node || typeof node !== 'object') return; if (node['Node Type']) nodes.push(node); for (const child of Object.values(node)) if (Array.isArray(child)) child.forEach(walk); else if (child && typeof child === 'object') walk(child); }; walk(response.value);
    const range = nodes.find(node => node['Index Name'] === 'media_delivery_ticket_expiry' && node['Index Cond']);
    assert.ok(range, 'Expected an indexed expiry range'); assert.equal(range['Actual Rows'], 0);
    assert.ok(nodes.every(node => node['Node Type'] !== 'Seq Scan' || node['Actual Loops'] === 0), 'Fresh tickets must not be scanned for empty cleanup');
    assert.equal(await value('select to_jsonb(count(*)) from media_delivery.tickets'), 10001);
  });
  test('chat catch-up refuses an unreviewed resolver instead of replacing its authority', async () => {
    const original = await value("select to_jsonb(pg_get_functiondef('public.resolve_media_delivery(text,text,text)'::regprocedure))");
    await query(original.replace('declare g media_delivery.tickets%rowtype;', 'declare g media_delivery.tickets%rowtype; -- Unreviewed fixture drift\n'));
    const response = await attempt(chatForward.match(/do \$preflight\$[\s\S]*?\$preflight\$;/)[0]);
    assert.equal(response.ok, false); assert.equal(response.error, 'CHAT_TICKETS_RESOLVER_BASELINE_CHANGED');
  });
  test('QA forward installation preserves its business-session check and works without a production readiness table', async () => {
    await query('drop table media_delivery.prerequisite_settings;create schema business_auth;create table business_auth.accounts(business_id uuid primary key);create table business_auth.fixture_sessions(user_id uuid,session_id uuid);create function business_auth.session_allowed(p_user uuid,p_session uuid) returns boolean language sql as $$select exists(select 1 from business_auth.fixture_sessions where user_id=p_user and session_id=p_session)$$');
    await query(fs.readFileSync(path.join(root, 'supabase/tests/chat-media-ticket-qa-contracts-20261105.sql'), 'utf8'));
    const before = await value("select to_jsonb(pg_get_functiondef('public.resolve_media_delivery(text,text,text)'::regprocedure))");
    await query(chatForward);
    assert.equal(await value("select to_jsonb(pg_get_functiondef('public.resolve_media_delivery(text,text,text)'::regprocedure))"), before);
    const message = await chat(await object(1, users.owner, 'chat-media')), ticket = await chatIssued(message);
    assert.ok((await redeem(ticket)).value);
    await query(`insert into business_auth.accounts values('${users.viewer}')`);
    assert.equal((await redeem(ticket)).value, null);
    await query(`insert into business_auth.fixture_sessions values('${users.viewer}','${sessions.viewer}')`);
    assert.ok((await redeem(ticket)).value);
    await query(`delete from business_auth.fixture_sessions where user_id='${users.viewer}'`);
    assert.equal((await redeem(ticket)).value, null);
  });
}
