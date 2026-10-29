const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('./rpc-authorization/node_modules/@electric-sql/pglite');
const OWNER = '10000000-0000-4000-8000-000000000001';
const VIEWER = '10000000-0000-4000-8000-000000000002';
const BASE = 'https://example.supabase.co';
const ASSET = `${BASE}/storage/v1/object/public/story-media/${OWNER}/`;
let db, sequence = 0;
const id = () => `20000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`;
async function actor(user, claims, action, role = 'authenticated') {
  await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)", [user || '', JSON.stringify({ iss: BASE + '/auth/v1', ...claims })]);
  await db.exec(`set role ${role}`);
  try { return await action(); } finally { await db.exec('reset role'); }
}
const asViewer = action => actor(VIEWER, {}, action);
async function track(extra = {}) {
  const sid = id();
  const values = { id: sid, owner_id: OWNER, title: 'A cleared recording', url: `${ASSET}${sid}.m4a`, duration_sec: 90, source: 'original', rights_status: 'creator_attested', ...extra };
  const keys = Object.keys(values);
  await db.query(`insert into story_sounds(${keys.join(',')}) values(${keys.map((_, i) => '$' + (i + 1)).join(',')})`, Object.values(values));
  return values;
}
const allowed = (sid, use = 'post') => db.query('select sound_rights_allow($1,$2) ok', [sid, use]).then(r => r.rows[0].ok);
const selection = sid => ({ soundId: sid, startSec: 4, durationSec: 10, volume: 0.6, originalVolume: 0.3 });
test.before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema storage;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    grant usage on schema auth to authenticated,anon,service_role;
    create table profiles(id uuid primary key,deactivated_at timestamptz);
    insert into profiles(id) values('${OWNER}'),('${VIEWER}');
    create table blocked_users(blocker_id uuid,blocked_id uuid);
    create table story_sounds(id uuid primary key default gen_random_uuid(),owner_id uuid,title text,url text,duration_sec integer,source text,use_count integer default 0,rights_status text);
    alter table story_sounds enable row level security;
    grant select,insert,update,delete on story_sounds to authenticated;
    create table stories(id uuid primary key default gen_random_uuid(),user_id uuid,audio_url text,audio_duration_sec integer);
    create table post_media(id uuid primary key default gen_random_uuid(),post_id uuid,sort_order integer,edit jsonb);
    create table promoted_posts(id uuid primary key default gen_random_uuid(),post_id uuid);
    grant select,insert,update,delete on post_media,promoted_posts,stories to authenticated;
    create table storage.objects(bucket_id text,name text,owner_id text,owner uuid);
    create table manifest_fixture(entity_kind text,entity_id uuid,media_url text);
    create function content_media_manifest(p_references jsonb) returns table(entity_kind text,entity_id uuid,media_url text)
      language sql stable security definer set search_path='' as $$select * from public.manifest_fixture$$;
  `);
  await db.exec(fs.readFileSync(path.join(__dirname, '../migrations/20261026063625_soundtrack_rights_and_post_audio.sql'), 'utf8'));
});
test.after(() => db.close());

test('catalogue exposes approved current first-party sounds and denies anonymous users', async () => {
  const a = await track(), b = await track({ rights_status: 'unverified' });
  await asViewer(async () => {
    assert.equal(await allowed(a.id), true);
    assert.equal(await allowed(b.id), false);
    const result = await db.query('select * from list_playable_sounds($1,$2,$3)', ['post', a.title, 1]);
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].max_excerpt_sec, 30);
  });
  await actor(VIEWER, { is_anonymous: true }, async () => assert.equal(await allowed(a.id), false));
  await actor(null, {}, async () => assert.equal(await allowed(a.id), false));
  await actor(null, {}, async () => assert.rejects(() => db.query('select * from list_playable_sounds()'), /permission denied/), 'anon');
});
test('a catalogue record cannot grant playback on an external or encoded storage origin', async () => {
  for (const url of [`https://other.example/storage/v1/object/public/story-media/${OWNER}/music.m4a`, `${ASSET}%2e%2e/music.m4a`, `${ASSET}music.m4a?token=temporary`, `${ASSET}../music.m4a`]) {
    const t = await track({ url });
    assert.equal(await asViewer(() => allowed(t.id)), false);
  }
});
test('licensed records require agreement identity and a content digest', async () => {
  const t = await track({ rights_status: 'licensed' });
  assert.equal(await asViewer(() => allowed(t.id)), false);
  await db.query('update story_sounds set license_ref=$1,licensor=$2,asset_sha256=$3 where id=$4', ['agreement-1', 'Example rights holder', 'a'.repeat(64), t.id]);
  assert.equal(await asViewer(() => allowed(t.id)), true);
});
test('permitted use, release windows, expiry and revocation control new playback', async () => {
  const t = await track();
  await db.query("update story_sounds set permitted_uses=array['story'] where id=$1", [t.id]);
  assert.equal(await asViewer(() => allowed(t.id, 'post')), false);
  assert.equal(await asViewer(() => allowed(t.id, 'story')), true);
  await db.query("update story_sounds set rights_start=now()+interval '1 hour' where id=$1", [t.id]);
  assert.equal(await asViewer(() => allowed(t.id, 'story')), false);
  await db.query("update story_sounds set rights_start=null,rights_end=now()-interval '1 second' where id=$1", [t.id]);
  assert.equal(await asViewer(() => allowed(t.id, 'story')), false);
  await db.query('update story_sounds set rights_end=null,revoked_at=now() where id=$1', [t.id]);
  assert.equal(await asViewer(() => allowed(t.id, 'story')), false);
});
test('territory accepts only current server-managed claims, never user metadata', async () => {
  const t = await track();
  await db.query("update story_sounds set territories=array['ZW'] where id=$1", [t.id]);
  const current = { music_territory: 'zw', music_territory_verified_until: '2099-01-01T00:00:00Z' };
  assert.equal(await actor(VIEWER, { user_metadata: current }, () => allowed(t.id)), false);
  assert.equal(await actor(VIEWER, { app_metadata: current }, () => allowed(t.id)), true);
  for (const until of ['2000-01-01T00:00:00Z', 'not-a-date', null]) {
    assert.equal(await actor(VIEWER, { app_metadata: { ...current, music_territory_verified_until: until } }, () => allowed(t.id)), false);
  }
});
test('invalid or empty territory metadata cannot become an unrestricted licence', async () => {
  const t = await track();
  for (const territories of [[], [null], [''], ['Zimbabwe']]) {
    await assert.rejects(() => db.query('update story_sounds set territories=$1 where id=$2', [territories, t.id]), /sound_territories/);
  }
});
test('blocks in either direction remove reusable sounds', async () => {
  const t = await track();
  for (const pair of [[OWNER, VIEWER], [VIEWER, OWNER]]) {
    await db.query('insert into blocked_users values($1,$2)', pair);
    assert.equal(await asViewer(() => allowed(t.id)), false);
    await db.exec('delete from blocked_users');
  }
});
test('deactivated viewers and creators cannot receive a new soundtrack grant', async () => {
  const t = await track();
  for (const uid of [VIEWER, OWNER]) {
    await db.query('update profiles set deactivated_at=now() where id=$1', [uid]);
    assert.equal(await asViewer(() => allowed(t.id)), false);
    await db.query('update profiles set deactivated_at=null where id=$1', [uid]);
  }
});
test('selection returns canonical metadata and enforces the licensed excerpt and mix bounds', async () => {
  const t = await track();
  await asViewer(async () => {
    const draft = { ...selection(t.id), url: 'https://forged.example/audio', title: 'forged' };
    const result = await db.query('select validate_soundtrack($1,$2) edit', [JSON.stringify(draft), 'post']);
    assert.deepEqual(result.rows[0].edit, selection(t.id));
    for (const patch of [{ startSec: -1 }, { durationSec: 31 }, { startSec: 89 }, { volume: 1.01 }, { originalVolume: -0.1 }, { durationSec: 'NaN' }, { startSec: 'Infinity' }]) {
      await assert.rejects(() => db.query('select validate_soundtrack($1,$2)', [JSON.stringify({ ...selection(t.id), ...patch }), 'post']), /INVALID_SOUNDTRACK_RANGE/);
    }
  });
});
test('post soundtracks belong only to the first slide and ordinary edits remain valid', async () => {
  const t = await track(), post = id();
  await asViewer(async () => {
    for (const sort of [1, null]) await assert.rejects(() => db.query('insert into post_media(post_id,sort_order,edit) values($1,$2,$3)', [post, sort, JSON.stringify({ soundtrack: selection(t.id) })]), /SOUNDTRACK_BELONGS_ON_FIRST_SLIDE/);
    await db.query('insert into post_media(post_id,sort_order,edit) values($1,0,$2)', [post, JSON.stringify({ soundtrack: selection(t.id), rotation: 90 })]);
    await db.query('insert into post_media(post_id,sort_order,edit) values($1,1,$2)', [post, JSON.stringify({ rotation: 180 })]);
    assert.equal((await db.query('select count(*)::int n from post_media where post_id=$1', [post])).rows[0].n, 2);
  });
});
test('organic music cannot silently enter a paid promotion in either write order', async () => {
  const t = await track(), post = id(), alreadyPaid = id();
  await asViewer(async () => {
    await db.query('insert into post_media(post_id,sort_order,edit) values($1,0,$2)', [post, JSON.stringify({ soundtrack: selection(t.id) })]);
    await assert.rejects(() => db.query('insert into promoted_posts(post_id) values($1)', [post]), /PAID_SOUNDTRACK_NOT_ENABLED/);
    await db.query('insert into promoted_posts(post_id) values($1)', [alreadyPaid]);
    await assert.rejects(() => db.query('insert into post_media(post_id,sort_order,edit) values($1,0,$2)', [alreadyPaid, JSON.stringify({ soundtrack: selection(t.id) })]), /PAID_SOUNDTRACK_NOT_ENABLED/);
  });
});
test('story audio resolves its immutable asset and limits the excerpt', async () => {
  const t = await track();
  await db.query('update story_sounds set max_excerpt_sec=12 where id=$1', [t.id]);
  await asViewer(async () => {
    const result = await db.query('insert into stories(user_id,audio_url,audio_duration_sec) values($1,$2,300) returning audio_sound_id,audio_duration_sec', [VIEWER, t.url]);
    assert.equal(result.rows[0].audio_sound_id, t.id);
    assert.equal(result.rows[0].audio_duration_sec, 12);
  });
  await db.query('update story_sounds set revoked_at=now() where id=$1', [t.id]);
  await asViewer(() => assert.rejects(() => db.query('insert into stories(user_id,audio_url) values($1,$2)', [VIEWER, t.url]), /SOUND_UNAVAILABLE/));
});
test('direct voiceover cannot bypass first-party asset validation', async () => {
  await asViewer(() => assert.rejects(() => db.query('insert into stories(user_id,audio_url) values($1,$2)', [VIEWER, 'https://elsewhere.example/storage/v1/object/public/story-media/music.m4a']), /AUDIO_FIRST_PARTY_ORIGIN_REQUIRED/));
});
test('media capabilities omit revoked sounds without hiding ordinary media', async () => {
  const t = await track();
  await db.query('insert into manifest_fixture values($1,$2,$3),($4,$5,$6)', ['story', id(), t.url, 'post', id(), ASSET + 'photo.jpg']);
  assert.equal((await asViewer(() => db.query('select * from content_media_manifest($1)', ['[]']))).rows.length, 2);
  await db.query('update story_sounds set revoked_at=now() where id=$1', [t.id]);
  const result = await asViewer(() => db.query('select * from content_media_manifest($1)', ['[]']));
  assert.deepEqual(result.rows.map(r => r.media_url), [ASSET + 'photo.jpg']);
  await asViewer(() => assert.rejects(() => db.query('select * from content_media_manifest_before_sound_rights($1)', ['[]']), /permission denied/));
  await db.exec('delete from manifest_fixture');
});
test('catalogue rights and import operations cannot be changed by ordinary users', async () => {
  const t = await track();
  await actor(OWNER, {}, async () => {
    await assert.rejects(() => db.query("update story_sounds set rights_status='licensed' where id=$1", [t.id]), /permission denied/);
    await assert.rejects(() => db.query('select ingest_licensed_sound($1,$2)', [OWNER, '{}']), /permission denied/);
    await assert.rejects(() => db.query('insert into music_asset_origins values($1)', [BASE]), /permission denied/);
  });
});
test('licensed import verifies exact configured origin, stored owner and complete agreement', async () => {
  const file = `${OWNER}/import-${id()}.m4a`;
  await db.query('insert into storage.objects values($1,$2,$3,null)', ['story-media', file, OWNER]);
  const input = { provider: 'label', providerTrackId: id(), licenseRef: 'contract-1', licensor: 'Label', title: 'Licensed', durationSec: 120, maxExcerptSec: 30, sha256: 'a'.repeat(64), url: BASE + '/storage/v1/object/public/story-media/' + file, uses: ['post', 'memory_album'], territories: ['zw'] };
  await actor(null, {}, () => assert.rejects(() => db.query('select ingest_licensed_sound($1,$2)', [OWNER, JSON.stringify(input)]), /CLEARED_FIRST_PARTY_ASSET_REQUIRED/), 'service_role');
  await db.query('insert into music_asset_origins values($1)', [BASE]);
  await actor(null, {}, async () => {
    await assert.rejects(() => db.query('select ingest_licensed_sound($1,$2)', [VIEWER, JSON.stringify(input)]), /CLEARED_FIRST_PARTY_ASSET_REQUIRED/);
    await assert.rejects(() => db.query('select ingest_licensed_sound($1,$2)', [OWNER, JSON.stringify({ ...input, licenseRef: '' })]), /COMPLETE_LICENSE_METADATA_REQUIRED/);
    await assert.rejects(() => db.query('select ingest_licensed_sound($1,$2)', [OWNER, JSON.stringify({ ...input, territories: [] })]), /COMPLETE_LICENSE_METADATA_REQUIRED/);
    const result = await db.query('select ingest_licensed_sound($1,$2) id', [OWNER, JSON.stringify(input)]);
    const replay = await db.query('select ingest_licensed_sound($1,$2) id', [OWNER, JSON.stringify(input)]);
    assert.equal(result.rows[0].id, replay.rows[0].id);
  }, 'service_role');
});
test('asset replacement cannot detach existing media from its revocable rights record', async () => {
  const t = await track();
  await assert.rejects(() => db.query('update story_sounds set url=$1 where id=$2', [ASSET + 'replacement.m4a', t.id]), /SOUND_ASSET_IMMUTABLE_PUBLISH_NEW_VERSION/);
  await db.query('update story_sounds set revoked_at=now() where id=$1', [t.id]);
  assert.equal((await db.query('select count(*)::int n from music_rights_events where sound_id=$1', [t.id])).rows[0].n, 2);
});
