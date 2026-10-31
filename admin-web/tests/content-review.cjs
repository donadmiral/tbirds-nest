const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');
const root = path.join(__dirname, '..');
const postId = '10000000-0000-4000-8000-000000000001';
const ownerId = '10000000-0000-4000-8000-000000000002';
const raw = 'https://qa.example.invalid/storage/v1/object/public/post-media/owner/photo.jpg';
function load(file, overrides = {}, globals = {}) {
  const module = { exports: {} };
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, Date, URLSearchParams,
    require: name => Object.hasOwn(overrides, name) ? overrides[name] : require(name), ...globals }, { filename: file });
  return module.exports;
}
function harness({ deny = false, missing = false, failTable, count = 41, unbound = false, legacy = false, truncated = false } = {}) {
  const events = [];
  let authorized = false;
  const post = { id: postId, user_id: ownerId, scope: 'community', audience: 'only_me', is_exclusive: true, community_id: postId, archived_at: '2026-10-20T12:00:00Z', content: 'Private test post', body: null, media_url: legacy ? raw : null, created_at: '2026-10-18T12:00:00Z', likes_count: 1, comments_count: 41, shares_count: 0 };
  const api = load('lib/supabaseAdmin.ts', { 'server-only': {} }, { process: { env: {
    NEXT_PUBLIC_SUPABASE_URL: 'https://qa.example.invalid', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'placeholder', SUPABASE_SERVICE_ROLE_KEY: 'server-placeholder',
  } }, fetch: async (input, init = {}) => {
    assert.equal(authorized, true, 'permission must precede every service read');
    assert.equal(init.cache, 'no-store');
    const url = new URL(input);
    const table = url.pathname.split('/').pop();
    events.push({ table, query: url.searchParams });
    if (table === failTable) return new Response(JSON.stringify({ code: 'XX000', message: 'synthetic database outage' }), { status: 500 });
    let data;
    if (table === 'posts') data = missing ? null : post;
    else if (table === 'post_media') data = legacy ? [] : [
      { url: raw, media_type: 'image', width: 900, height: 1200, edit: { fit: 'contain' } },
      { url: raw.replace('photo.jpg', 'clip.mp4'), media_type: 'video', width: 1920, height: 1080, edit: { trimStart: 2, trimEnd: 7, coverUrl: raw.replace('photo.jpg', 'cover.jpg') } },
    ];
    else if (table === 'post_comments') data = [{ id: postId, user_id: ownerId, body: 'Review comment', content: null, created_at: post.created_at, media_url: null }];
    else if (table === 'post_reports') data = [{ id: postId, reason: 'Spam', status: 'open', created_at: post.created_at }];
    else if (table === 'profiles') data = [{ id: ownerId, full_name: 'QA member', username: 'qa_member', is_verified: false }];
    else throw new Error('Unexpected table ' + table);
    const total = table === 'post_comments' || table === 'post_reports' ? count : table === 'post_media' && truncated ? 1001 : Array.isArray(data) ? data.length : 1;
    return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json', 'content-range': `0-${Math.max(0, (Array.isArray(data) ? data.length : 1) - 1)}/${total}` } });
  } });
  const media = load('lib/media.ts', { 'server-only': {}, './supabaseAdmin': api, './publicMedia': {} });
  const contract = load('lib/contentReview.ts', {
    'server-only': {}, './supabaseAdmin': api, './media': media,
    './completeRead': load('lib/completeRead.ts', { 'server-only': {} }),
    './adminAuth': { requirePermission: async permission => { assert.equal(permission, 'post_moderate'); if (deny) throw new Error('denied'); authorized = true; events.push({ permission }); } },
    './moderationMedia': { resolveModerationMedia: async (values, kind, ids) => {
      assert.equal(authorized, true); assert.equal(kind, 'post'); assert.deepEqual(Array.from(ids), [postId]);
      return Object.fromEntries(values.filter(Boolean).filter(value => !unbound || !value.endsWith('photo.jpg')).map(value => [value, `/api/moderation-media?bound=${encodeURIComponent(value)}`]));
    } },
  });
  return { ...contract, events, post };
}
test('private, exclusive, community and archived posts open only through staff authorization', async () => {
  const h = harness(); const result = await h.loadContentReview(postId);
  assert.equal(result.post.audience, 'only_me'); assert.equal(result.post.is_exclusive, true); assert.ok(result.post.archived_at);
  assert.equal(h.events[0].permission, 'post_moderate');
  const filters = h.events.find(event => event.table === 'posts').query;
  assert.equal(filters.get('id'), 'eq.' + postId);
  for (const name of ['audience', 'scope', 'is_exclusive', 'community_id', 'archived_at']) assert.equal(filters.has(name), false);
  assert.equal(result.authors[ownerId].username, 'qa_member');
});
test('denied staff and malformed identifiers never issue a database query', async () => {
  const denied = harness({ deny: true }); await assert.rejects(denied.loadContentReview(postId), /denied/); assert.equal(denied.events.length, 0);
  const bad = harness(); assert.equal(await bad.loadContentReview('../private'), null); assert.equal(bad.events.filter(event => event.table).length, 0);
});
test('missing posts stop before media, comments or participant queries', async () => {
  const h = harness({ missing: true }); assert.equal(await h.loadContentReview(postId), null); assert.deepEqual(h.events.filter(event => event.table).map(event => event.table), ['posts']);
});
test('ordered gallery and video recipe use authenticated proxy URLs including the uploaded cover', async () => {
  const h = harness(); const review = await h.loadContentReview(postId);
  assert.equal(review.gallery.length, 2); assert.equal(review.gallery[0].width, 900); assert.equal(review.gallery[1].video, true);
  assert.equal(review.gallery[1].edit.trimStart, 2); assert.equal(review.gallery[1].edit.trimEnd, 7);
  assert.match(review.gallery[1].edit.coverUrl, /^\/api\/moderation-media\?/);
  assert.equal(h.events.find(event => event.table === 'post_media').query.get('order'), 'sort_order.asc');
});
test('legacy media is preserved while unbound attachments remain explicitly unavailable', async () => {
  const legacy = await harness({ legacy: true }).loadContentReview(postId); assert.equal(legacy.gallery.length, 1);
  const denied = await harness({ unbound: true }).loadContentReview(postId); assert.equal(denied.gallery.length, 1); assert.equal(denied.unavailableAttachments, 1);
});
test('conversation and reports use independent stable pages and exact counts', async () => {
  const h = harness(); const review = await h.loadContentReview(postId, 2, 3);
  assert.equal(review.commentCount, 41); assert.equal(review.reportCount, 41);
  for (const [table, offset] of [['post_comments', '20'], ['post_reports', '40']]) {
    const query = h.events.find(event => event.table === table).query;
    assert.equal(query.get('offset'), offset); assert.equal(query.get('limit'), '20'); assert.equal(query.get('order'), 'created_at.desc,id.asc'); assert.equal(query.get('post_id'), 'eq.' + postId);
  }
});
test('database errors and truncated attachments cannot be rendered as a complete or empty review', async () => {
  for (const failTable of ['posts', 'post_media', 'post_comments', 'post_reports', 'profiles']) await assert.rejects(harness({ failTable }).loadContentReview(postId), error => /synthetic database outage/.test(error.message));
  await assert.rejects(harness({ truncated: true }).loadContentReview(postId), /Post attachments is incomplete/);
});
test('page input is bounded and analytics links respect the moderation role', () => {
  const { reviewPage } = harness();
  for (const value of [undefined, 'bad', '-1', '1.5', 'Infinity']) assert.equal(reviewPage(value), 1);
  assert.equal(reviewPage('3'), 3); assert.equal(reviewPage('100001'), 100000);
  const permission = load('lib/permissions.ts');
  const Link = load('components/ContentReviewLink.tsx', { 'next/link': { default: 'Link' }, '@/lib/permissions': permission }).default;
  assert.equal(Link({ role: 'analyst', id: postId, children: 'content' }).type, 'div');
  assert.equal(Link({ role: 'trust_safety', id: postId, children: 'content' }).props.href, '/content/' + postId);
});
