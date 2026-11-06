// The migration that gives every video post a cover the apps read: it patches the two publication functions in place
// at their exact released statements, refuses to run against a function whose text moved, and gives the live clips
// already published their coverUrl without touching anything else.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.PGLITE_MODULE || path.join(__dirname, 'rpc-authorization/node_modules/@electric-sql/pglite/dist/index.cjs'));
const migration = fs.readFileSync(path.join(__dirname, '../migrations/20261106021500_video_posts_keep_their_cover.sql'), 'utf8');
const released = name => fs.readFileSync(path.join(__dirname, '../migrations', name), 'utf8');
// the exact statements the released functions carry, lifted from the migrations that created them
const clipInsert = released('20261103002857_live_clips_and_distribution.sql').split('\n').filter(line => line.includes("jsonb_build_object('liveClipId',c.id,'thumbnail',thumbnail,'duration'"));
const studioInsert = released('00000000000151_capture_functions.sql').match(/      insert into post_media \(post_id, url, media_type, width, height, sort_order\)\n      values \(v_post, m->>'url', coalesce\(m->>'media_type','image'\), \(m->>'width'\)::int, \(m->>'height'\)::int, i\);/);
assert.equal(clipInsert.length, 1, 'the released clip publication carries the insert this migration patches');
assert.ok(studioInsert, 'the released studio publication carries the insert this migration patches');

async function database() {
  const db = new PGlite();
  await db.exec(`
    create schema live_streams;
    create table public.post_media (id uuid primary key default gen_random_uuid(), post_id uuid not null, url text not null, media_type text, sort_order integer default 0, width integer, height integer, edit jsonb);
    create table public.studio_scheduled_posts (id uuid primary key, media jsonb);
    create function live_streams.clip_publish_one(p_id uuid) returns jsonb language plpgsql as $$
    declare c record; published uuid := p_id; url text := 'u'; thumbnail text := 't'; w integer := 1; h integer := 1;
    begin
     select p_id as id, 0 as start_ms, 1500 as end_ms into c;
     insert into public.post_media(post_id,url,media_type,sort_order,width,height,edit)
     ${clipInsert[0].trim()}
     return jsonb_build_object('ok', true);
    end $$;
    create function public.studio_publish_row(p_id uuid) returns uuid language plpgsql as $$
    declare r record; v_post uuid := p_id; m jsonb; i int := 0;
    begin
      select * into r from studio_scheduled_posts where id = p_id;
      for m in select * from jsonb_array_elements(coalesce(r.media,'[]'::jsonb)) loop
${studioInsert[0]}
        i := i + 1;
      end loop;
      return v_post;
    end $$;
  `);
  return db;
}

test('the patched functions write a cover; a clip post already published gains one; other rows are untouched', async () => {
  const db = await database();
  const post = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222', plain = '33333333-3333-4333-8333-333333333333';
  await db.query(`insert into public.post_media(post_id,url,media_type,edit) values
    ($1,'https://x.supabase.co/storage/v1/object/public/live-clips/a/horizontal.mp4','video','{"liveClipId":"c","thumbnail":"https://x.supabase.co/storage/v1/object/public/live-clips/a/thumbnail.jpg","duration":12.5}'),
    ($2,'https://x.supabase.co/storage/v1/object/public/post-media/u/v.mp4','video','{"thumbnail":"https://elsewhere.test/not-a-clip.jpg"}'),
    ($3,'https://x.supabase.co/storage/v1/object/public/post-media/u/p.jpg','image',null)`, [post, other, plain]);
  await db.exec(migration);
  const rows = (await db.query('select post_id, edit from public.post_media order by post_id')).rows;
  assert.equal(rows.find(r => r.post_id === post).edit.coverUrl, 'https://x.supabase.co/storage/v1/object/public/live-clips/a/thumbnail.jpg', 'a published clip gains its poster as coverUrl');
  assert.equal(rows.find(r => r.post_id === post).edit.thumbnail, 'https://x.supabase.co/storage/v1/object/public/live-clips/a/thumbnail.jpg', 'and keeps the name it had');
  assert.equal(rows.find(r => r.post_id === other).edit.coverUrl, undefined, 'a thumbnail that is not a live clip poster is left alone');
  assert.equal(rows.find(r => r.post_id === plain).edit, null, 'an image row is untouched');
  await db.query('select live_streams.clip_publish_one($1)', ['44444444-4444-4444-8444-444444444444']);
  const clip = (await db.query('select edit from public.post_media where post_id = $1', ['44444444-4444-4444-8444-444444444444'])).rows[0];
  assert.deepEqual(clip.edit, { liveClipId: '44444444-4444-4444-8444-444444444444', thumbnail: 't', coverUrl: 't', duration: 1.5 }, 'a newly published clip carries both names');
  await db.query(`insert into public.studio_scheduled_posts(id, media) values ($1, '[{"url":"https://x.supabase.co/storage/v1/object/public/post-media/u/s.mp4","media_type":"video","width":1280,"height":720,"edit":{"coverUrl":"https://x.supabase.co/storage/v1/object/public/post-media/u/s_cover.jpg","coverAt":0}},{"url":"https://x.supabase.co/storage/v1/object/public/post-media/u/i.jpg","media_type":"image"}]')`, ['55555555-5555-4555-8555-555555555555']);
  await db.query('select public.studio_publish_row($1)', ['55555555-5555-4555-8555-555555555555']);
  const studio = (await db.query('select edit, sort_order from public.post_media where post_id = $1 order by sort_order', ['55555555-5555-4555-8555-555555555555'])).rows;
  assert.deepEqual(studio.map(r => r.edit), [{ coverUrl: 'https://x.supabase.co/storage/v1/object/public/post-media/u/s_cover.jpg', coverAt: 0 }, null], 'a scheduled video keeps the recipe the planner saved; an image without one stays null');
});

test('the migration refuses a function whose statement has moved rather than patching the wrong text', async () => {
  const db = await database();
  await db.exec(`create or replace function live_streams.clip_publish_one(p_id uuid) returns jsonb language plpgsql as $$ begin return '{}'::jsonb; end $$;`);
  await assert.rejects(db.exec(migration), /LIVE_CLIP_PUBLISH_ANCHOR_MISSING/);
});
