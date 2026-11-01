const assert = require('node:assert/strict');
const test = require('node:test');
const { runPage, TARGET } = require('./helpers/reportingFixture.cjs');
const { id, stamp } = require('./helpers/reportingData.cjs');
const origin = 'https://platinum-admin-fixture.invalid';
const raw = path => origin + '/storage/v1/object/public/post-media/' + TARGET + '/' + path;
const posts = count => Array.from({ length: count }, (_, i) => ({ id: id(i), user_id: TARGET, content: 'Post ' + i, body: null, media_url: null, created_at: stamp(i), likes_count: 1, comments_count: 0, shares_count: 0 }));
const page = options => runPage('admin-web/app/content/page.tsx', options);
const read = (r, table) => r.calls.filter(c => c.path === '/rest/v1/' + table && c.method === 'GET');
const rendered = r => { assert.equal(r.outcome, 'rendered', r.error); return r; };

test('content pages fetch 25 stable posts before attachments and retain navigation beyond the old 200-post slice', async () => {
  const r = rendered(await page({ tables: { posts: posts(1051) }, search: { page: '9' } }));
  assert.equal(r.desks[0].rows.length, 25);
  assert.equal(r.desks[0].rows[0].id, id(200));
  assert.equal(read(r, 'posts')[0].query.order, 'created_at.desc,id.desc');
  assert.equal(read(r, 'posts')[0].query.offset, '200');
  assert.equal(read(r, 'posts')[0].query.limit, '25');
  assert.equal(r.cards.find(c => c.label === 'Posts on the platform').value, '1,051');
  assert.equal(r.cards.find(c => c.label === 'Posted this week').value, '1,051');
  assert.equal(r.controls.find(c => c.text === 'Next page').href, '/content?page=10');
  const ids = r.desks[0].rows.map(row => row.id).join(',');
  for (const table of ['post_media', 'post_reports']) assert.equal(read(r, table)[0].query.post_id, 'in.(' + ids + ')');
  assert.equal(read(r, 'trending_snapshot')[0].query.ref_id, 'in.(' + ids + ')');
  assert.equal(read(r, 'admin_audit_log')[0].query.limit, '6');
  assert.match(r.text, /201–225 of 1,051 posts/);
});

test('extensionless video sources and authored posters remain associated with their exact post', async () => {
  const source = raw('opaque-video'), cover = raw('selected-cover.jpg');
  const r = rendered(await page({
    tables: { posts: posts(1), post_media: [{ id: id(50), post_id: id(0), url: source, media_type: 'video/mp4', sort_order: 0, edit: { coverUrl: cover }, width: 1080, height: 1920 }] },
    rpc: { admin_bound_content_media_manifest: args => {
      assert.deepEqual(args.p_entity_ids, [id(0)]);
      return [{ entity_id: id(0), bucket_id: 'post-media', object_path: TARGET + '/opaque-video' }, { entity_id: id(0), bucket_id: 'post-media', object_path: TARGET + '/selected-cover.jpg' }];
    } },
  }));
  const row = r.desks[0].rows[0], media = row.detail.gallery[0];
  assert.equal(media.video, true);
  for (const value of [media.url, media.edit.coverUrl, row.cells[0].poster]) {
    const u = new URL(value, 'https://admin.example.test');
    assert.equal(u.pathname, '/api/moderation-media');
    assert.equal(u.searchParams.get('id'), id(0));
  }
  assert.equal(row.cells[0].poster, media.edit.coverUrl);
  assert.doesNotMatch(JSON.stringify(row.detail.gallery), /object\/public/);
});

test('content author reads start before a delayed media grant and authorization cannot be bypassed', { timeout: 2000 }, async () => {
  let release;
  const held = new Promise(resolve => { release = resolve; });
  let profilesStarted = false, manifestStarted;
  const started = new Promise(resolve => { manifestStarted = resolve; });
  const pending = page({
    tables: { posts: posts(1), post_media: [{ id: id(50), post_id: id(0), url: raw('photo.jpg'), media_type: 'image', sort_order: 0 }] },
    beforeRead: async call => {
      if (call.path === '/rest/v1/profiles') profilesStarted = true;
      if (call.path === '/rest/v1/rpc/admin_bound_content_media_manifest') { manifestStarted(); await held; }
    },
    rpc: { admin_bound_content_media_manifest: [] },
  });
  await started;
  try { assert.equal(profilesStarted, true); } finally { release(); }
  const r = rendered(await pending); assert.equal(r.desks[0].rows[0].detail.gallery.length, 0);
  const denied = await page({ role: null, tables: { posts: posts(1) } });
  assert.equal(denied.outcome, 'redirect'); assert.equal(read(denied, 'posts').length, 0);
});

test('missing counts and truncated attachment lists cannot masquerade as complete content', async () => {
  const missing = await page({ tables: { posts: posts(1) }, omitCount: call => call.path === '/rest/v1/posts' && call.method === 'HEAD' });
  assert.equal(missing.outcome, 'threw'); assert.match(missing.error, /counts could not be loaded/);
  const rows = Array.from({ length: 1001 }, (_, index) => ({ id: id(index + 20), post_id: id(0), url: raw(index + '.jpg'), media_type: 'image', sort_order: index }));
  const clipped = await page({ tables: { posts: posts(1), post_media: rows } });
  assert.equal(clipped.outcome, 'threw'); assert.match(clipped.error, /Post attachments is incomplete/);
});

test('failed post, author, report or trend reads cannot become an empty or falsely clean moderation page', async () => {
  for (const table of ['posts', 'profiles', 'post_reports', 'trending_snapshot']) {
    const r = await page({ tables: { posts: posts(1) }, respond: call => {
      if (call.path === '/rest/v1/' + table && call.method === 'GET') return new Response(JSON.stringify({ code: 'XXFIX', message: 'Synthetic read unavailable' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
    } });
    assert.equal(r.outcome, 'threw', table);
    assert.match(r.error, /Synthetic read unavailable/);
  }
});
