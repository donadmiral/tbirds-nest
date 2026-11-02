const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { before, after, beforeEach, afterEach, test } = require('node:test');
const { LocalPsqlSession } = require('./local-psql-session.cjs');

if (!process.env.PC_TEST_PSQL) test('content ticket prerequisites require isolated PostgreSQL', { skip: true }, () => {});
else {
  const root = path.resolve(__dirname, '../..');
  const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261102163428_production_content_media_tickets.sql'), 'utf8');
  const preflight = migration.match(/do \$preflight\$[\s\S]*?\$preflight\$;/)[0];
  const preservation = fs.readFileSync(path.join(root, 'supabase/ops/production-content-media-tickets-20261102/preservation.sql'), 'utf8');
  const id = n => `72000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const users = { owner: id(1), viewer: id(2), stranger: id(3) };
  const sessions = { owner: id(101), viewer: id(102), stranger: id(103) };
  const literal = value => "'" + String(value).replaceAll("'", "''") + "'";
  const json = value => literal(JSON.stringify(value)) + '::jsonb';
  let db, initialState, installedState, guardResults = [];
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

  before(async () => {
    assert.equal(process.env.PGDATABASE, 'pc_scale_media_tickets', 'Dedicated disposable database required');
    db = new LocalPsqlSession();
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
}
