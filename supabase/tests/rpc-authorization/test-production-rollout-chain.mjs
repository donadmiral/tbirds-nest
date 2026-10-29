import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { extensions, loadLiveSchema } from './live-schema-fixture.mjs';
import { captureMusicState, assertMusicUnchanged } from './non-music-release-assertions.mjs';

const root = new URL('../../../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('supabase/ops/production-rollout-20261029.json', root), 'utf8'));
const db = new PGlite({ extensions });
let currentUnit = 'live schema fixture';
try {
  await loadLiveSchema(db);
  await db.exec("alter table auth.users add column if not exists created_at timestamptz default now(); alter table storage.objects add column if not exists version text; alter table storage.objects add column if not exists user_metadata jsonb; grant usage on schema auth to authenticated; insert into storage.buckets(id,name,public) values('chat-media','chat-media',true),('chat-files','chat-files',true),('post-media','post-media',true),('story-media','story-media',true),('media','media',true),('avatars','avatars',true),('market-media','market-media',true);");
  assert.equal(manifest.musicInfrastructureExcluded, true);
  assert.equal(manifest.financeInfrastructureExcluded, true);
  assert.equal(manifest.scope, 'profile-story-post-memory-visual-only');
  assert.notEqual(manifest.reviewStatus, 'superseded-do-not-apply');
  const originalMusic = await captureMusicState(db);
  const musicFingerprintSql = await readFile(new URL('supabase/ops/check-production-music-unchanged.sql', root), 'utf8');
  const originalMusicFingerprints = await db.exec(musicFingerprintSql);
  const excludedFingerprintSql = await readFile(new URL('supabase/ops/check-production-excluded-unchanged.sql', root), 'utf8');
  let excludedStateAtResume;
  const baseline = (await db.query("select proname,md5(pg_get_functiondef(oid)) as definition_md5 from pg_proc where pronamespace='public'::regnamespace and proname in ('get_feed','get_memory_albums','get_memory_book','start_group_call','sweep_dead_calls','guard_payment_receipt_message','preserve_chat_payment_record','post_payment_message') order by proname")).rows;
  for (const [name, expected] of Object.entries(manifest.productionBaselineFunctionMd5)) {
    assert.equal(baseline.find(row => row.proname === name)?.definition_md5, expected, `Production baseline differs: ${name}`);
  }
  const originalBuckets = (await db.query('select id,public from storage.buckets order by id')).rows;
  const excludedPaths = new Set(manifest.excluded.map(entry => entry.path));
  let appliedPrefixVerified = false;
  for (const unit of manifest.units) {
    currentUnit = unit.name;
    const sources = [];
    for (const entry of unit.files) {
      assert.equal(excludedPaths.has(entry.path), false, `Excluded source included: ${entry.path}`);
      assert.doesNotMatch(entry.path, /story_sound_rights|story_soundtrack_authoring|soundtrack_rights_and_post_audio|memory_book_design_and_soundtrack/);
      const sql = await readFile(new URL(entry.path, root), 'utf8');
      assert.equal(createHash('sha256').update(sql).digest('hex'), entry.sha256, `Reviewed source changed: ${entry.path}`);
      sources.push(sql);
    }
    await db.exec(sources.length > 1 ? `begin;\n${sources.join('\n')}\ncommit;` : sources[0]);
    if (unit.order === manifest.productionResumeAfterUnit) {
      await assertMusicUnchanged(db, originalMusic);
      assert.equal((await db.query("select to_regprocedure('public.open_legacy_chat_media(uuid,uuid)') is not null as present")).rows[0].present, true);
      assert.equal((await db.query("select pg_get_function_result('public.consume_media_view(uuid)'::regprocedure) as shape")).rows[0].shape, 'TABLE(url text, remaining integer)');
      if (manifest.productionResumeFunctionMd5) {
        for (const [signature, hash] of Object.entries(manifest.productionResumeFunctionMd5)) {
          assert.equal((await db.query('select md5(pg_get_functiondef(to_regprocedure($1))) as hash', [signature])).rows[0].hash, hash, `Applied prefix differs: ${signature}`);
        }
      }
      const resumeResults = await db.exec(await readFile(new URL('supabase/ops/check-production-resume.sql', root), 'utf8'));
      const resume = resumeResults[0].rows[0].resume;
      for (const row of [...resume.function_checks, ...resume.relation_checks]) {
        assert.equal(row.matches, true, `Resume gate failed: ${row.signature || row.name}`);
      }
      for (const [name, allowed] of Object.entries(resume.exclusions)) assert.equal(allowed, true, name);
      excludedStateAtResume = await db.exec(excludedFingerprintSql);
      for (const [name, absent] of Object.entries(excludedStateAtResume[0].rows[0].excluded_state.held_relations)) assert.equal(absent, true, name);
      appliedPrefixVerified = true;
    }
  }
  assert.equal(appliedPrefixVerified, true);
  await assertMusicUnchanged(db, originalMusic);
  assert.deepEqual(await db.exec(musicFingerprintSql), originalMusicFingerprints, 'Hosted music fingerprint check must stay unchanged');
  assert.deepEqual(await db.exec(excludedFingerprintSql), excludedStateAtResume, 'Excluded finance, market, hiring, admin and Storage state must remain unchanged after the applied prefix');
  const required = [
    'public.publish_story_v2(uuid,uuid,jsonb)',
    'public.content_media_manifest(jsonb)',
    'public.content_upload_manifest(jsonb)',
    'public.get_memory_albums(uuid)',
    'public.get_memory_book(uuid)',
    'public.open_legacy_chat_media(uuid,uuid)',
    'public.consume_media_view(uuid)',
    'public.account_export_snapshot()',
    'public.start_group_call_membership(uuid,boolean)',
    'public.join_group_call_membership(uuid)',
    'public.leave_group_call_membership(uuid,uuid)',
    'public.get_feed_visibility(uuid[])',
    'public.feed_media_access_allowed(uuid)',
  ];
  for (const signature of required) {
    assert.ok((await db.query('select to_regprocedure($1) as rpc', [signature])).rows[0].rpc, signature);
  }
  assert.equal((await db.query("select to_regnamespace('private_media') as schema")).rows[0].schema, null);
  assert.equal((await db.query("select to_regprocedure('public.triniti_admin_single_owner_access(uuid)') as rpc")).rows[0].rpc, null);
  for (const bucket of originalBuckets) {
    assert.equal((await db.query('select public from storage.buckets where id=$1', [bucket.id])).rows[0].public, bucket.public, `${bucket.id} visibility changed`);
  }
  assert.equal((await db.query('select enrollment_open from creator_finance.program')).rows[0].enrollment_open, false);
  for (const provider of (await db.query('select payouts_enabled from creator_finance.providers')).rows) {
    assert.equal(provider.payouts_enabled, false);
  }
  const postflightResults = await db.exec(await readFile(new URL('supabase/ops/check-production-postflight.sql', root), 'utf8'));
  const postflight = postflightResults[0].rows[0].postflight;
  for (const rpc of postflight.client_rpc_checks) {
    assert.equal(rpc.exists && rpc.authenticated_can_execute && !rpc.anon_can_execute, true, `Unexpected client RPC boundary: ${rpc.signature}`);
  }
  assert.equal(postflight.legacy_result_compatible, true);
  for (const [name, allowed] of Object.entries(postflight.registry_client_permissions)) assert.equal(allowed, false, name);
  for (const [name, held] of Object.entries(postflight.held_changes)) assert.equal(held, true, name);
  console.log(JSON.stringify({ ok: true, units: manifest.units.length, sourceFiles: manifest.units.reduce((n, u) => n + u.files.length, 0), alreadyAppliedUnits: manifest.productionResumeAfterUnit, remainingUnits: manifest.units.length - manifest.productionResumeAfterUnit, heldMigrations: manifest.excluded.length, musicInfrastructureUnchanged: true, excludedFinanceMarketHiringAdminStorageUnchanged: true, privateMediaSchemaAbsent: true, originalBucketVisibilityPreserved: true, baselineFunctionHashes: baseline }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ ok: false, phase: currentUnit, message: error.message }));
  process.exitCode = 1;
} finally {
  await db.close();
}
