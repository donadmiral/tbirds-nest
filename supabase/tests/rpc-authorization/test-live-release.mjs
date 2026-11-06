import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { extensions } from './live-schema-fixture.mjs';
import { loadDeployedMediaBaseline, source } from './deployed-media-baseline.mjs';

const releasePath = 'supabase/ops/live-release-20261103/release.sql';
const scalar = async (db, sql) => Object.values((await db.query(sql)).rows[0] || {})[0];
async function baseline() {
  const db = new PGlite({ extensions });
  await loadDeployedMediaBaseline(db);
  await db.exec('alter table auth.users add column if not exists is_anonymous boolean default false');
  await db.exec(await source('supabase/migrations/20261102163428_production_content_media_tickets.sql'));
  return db;
}

test('atomic release installs together on the production schema and preserves disabled gates', async () => {
  const db = await baseline();
  try {
    await db.exec(await source(releasePath));
    const settings = await scalar(db, 'select to_jsonb(s) from live_streams.settings s');
    assert.equal(settings.stage_enabled, false);
    assert.equal(settings.delivery_enabled, false);
    assert.equal(settings.recording_enabled, false);
    assert.equal(await scalar(db, 'select enabled from live_streams.clip_runtime'), false);
    assert.ok(await scalar(db, "select to_regprocedure('public.live_interaction_command(uuid,text,jsonb,uuid)')"));
    assert.ok(await scalar(db, "select to_regprocedure('public.live_clip_command(uuid,uuid,text,jsonb,uuid)')"));
    assert.ok(await scalar(db, "select to_regprocedure('live_streams.content_manifest_base_v1(jsonb)')"));
    assert.equal(await scalar(db, "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='live_streams' and c.relkind='r' and not c.relrowsecurity"), 0);
    assert.equal(await scalar(db, "select has_function_privilege('authenticated','public.live_claim_clip_jobs(integer)','execute')"), false);
    assert.equal(await scalar(db, "select has_function_privilege('anon','public.live_clip_get(uuid)','execute')"), false);
  } finally { await db.close(); }
});

test('existing Live installation and extended chat ticket constraints survive the forward release', async () => {
  const db = await baseline();
  try {
    await db.exec(await source('supabase/migrations/20261103000609_live_portable_control_plane.sql'));
    await db.exec("update live_streams.settings set create_enabled=false,chat_enabled=false; alter table media_delivery.tickets drop constraint tickets_source_kind_check; alter table media_delivery.tickets add constraint tickets_source_kind_check check(source_kind in ('post','story','sound','story_draft','memory_album','highlight','upload','chat','chat_object'))");
    const before = await scalar(db, 'select to_jsonb(s) from live_streams.settings s');
    await db.exec(await source(releasePath));
    assert.deepEqual(await scalar(db, 'select to_jsonb(s) from live_streams.settings s'), before);
    const constraint = await scalar(db, "select pg_get_constraintdef(oid) from pg_constraint where conrelid='media_delivery.tickets'::regclass and conname='tickets_source_kind_check'");
    for (const kind of ['post','story','chat','chat_object','channel_message']) assert.ok(constraint.includes(`'${kind}'`), kind);
    assert.equal(await scalar(db, "select has_function_privilege('authenticated','live_streams.content_manifest_base_v1(jsonb)','execute')"), false);
    assert.equal(await scalar(db, "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='live_directory'"), 1);
  } finally { await db.close(); }
});

test('review bundle hashes identify the exact six migration sources', async () => {
  const manifest = JSON.parse(await source('supabase/ops/live-release-20261103/source-manifest.json'));
  assert.equal(manifest.units.length, 6);
  assert.equal(manifest.activation, 'off');
  assert.equal(manifest.measured_capacity, false);
  for (const unit of manifest.units) {
    const text = await source(unit.path);
    assert.equal(createHash('sha256').update(text).digest('hex'), unit.sha256, unit.path);
    assert.equal(Buffer.byteLength(text), unit.bytes, unit.path);
  }
  assert.equal(createHash('sha256').update(await source(releasePath)).digest('hex'), manifest.release_sha256);
});
