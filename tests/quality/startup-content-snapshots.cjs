const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const base = 'https://fixture.supabase.co';
function compile(file, globals = {}) {
 const module = { exports: {} };
 const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
 vm.runInNewContext(code, { module, exports: module.exports, URL, Date, Promise, Set, Map, AbortController, ...globals });
 return module.exports;
}
function harness(disk = new Map(), start = Date.now()) {
 let now = start, timerId = 0;
 const timers = new Map();
 const clock = { setTimeout(fn, ms) { timers.set(++timerId, { fn, at: now + ms }); return timerId; }, clearTimeout(id) { timers.delete(id); } };
 const core = compile('src/services/startupSnapshotCore.ts', clock);
 const storage = area => ({ getItem: async key => disk.get(area + key) ?? null, setItem: async (key, value) => { disk.set(area + key, value); }, removeItem: async key => { disk.delete(area + key); } });
 const registry = core.createStartupSnapshotRegistry({ secure: storage('secure:'), public: storage('public:'), metadata: storage('metadata:') }, () => now);
 const snapshots = compile('src/services/startupContentSnapshots.ts', { process: { env: { EXPO_PUBLIC_SUPABASE_URL: base } }, require: name => name === './startupSnapshotCore' ? core : ({ createStartupSnapshot: (id, options) => registry.create(id, options) }) });
 return { ...snapshots, registry, disk, get now() { return now; }, async advance(ms) { now += ms; for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); } await Promise.resolve(); } };
}
const inbox = extra => ({ actorId: 'owner', rows: [{ id: 'chat', other_user_id: 'friend', other_name: 'Alice', other_username: 'alice', last_message: 'Ready for lunch?', last_message_time: new Date().toISOString(), unread_count: 2, is_group: false, is_pinned: false, is_muted: false, is_archived: false, context: 'personal', ...extra }] });
const note = extra => ({ notification_id: 'notice', type: 'comment', created_at: new Date().toISOString(), actor_id: 'friend', actor_name: 'Alice', message: 'Alice commented', body_preview: 'Looks good', post_id: 'post', data: { post_id: 'post' }, unread_in_group: 1, ...extra });

test('ordinary encrypted previews survive process restart and never use public storage', async () => {
 const first = harness(); await first.registry.setAccount('owner');
 await first.inboxStartup.write('owner', inbox()); await first.notificationStartup.write('owner', [note()]);
 await first.advance(12 * 60 * 60000);
 const second = harness(first.disk, first.now); await second.registry.setAccount('owner');
 await second.registry.hydrate('owner');
 assert.equal(second.inboxStartup.peek('owner').rows[0].last_message, 'Ready for lunch?');
 assert.equal(second.notificationStartup.peek('owner')[0].body_preview, 'Looks good');
 assert.equal(second.inboxStartup.peek('another'), null);
 assert.ok(![...first.disk.keys()].some(key => key.startsWith('public:')));
});
test('snapshots strip credentials, grants, limited-view payloads and private avatars', async () => {
 const h = harness(); await h.registry.setAccount('owner');
 await h.inboxStartup.write('owner', { actorId: 'owner', rows: [inbox({ other_avatar: base + '/storage/v1/object/sign/chat-media/private?token=secret', credential: 'do-not-save' }).rows[0], inbox({ id: 'limited', view_limit: 1 }).rows[0], inbox({ id: 'deleted', deleted_at: new Date().toISOString() }).rows[0]] });
 const saved = h.inboxStartup.peek('owner'); assert.equal(saved.rows.length, 1); assert.equal(saved.rows[0].other_avatar, null);
 await h.notificationStartup.write('owner', [note({ post_thumb: base + '/functions/v1/media-content/post-media/a?token=secret', data: { post_id: 'post', credential: 'do-not-save', signed_url: 'private' } }), note({ notification_id: 'ephemeral', data: { view_once: true } })]);
 const value = h.notificationStartup.peek('owner'); assert.equal(value.length, 1); assert.equal(value[0].post_thumb, null);
 const serialized = [...h.disk.values()].join(' '); assert.doesNotMatch(serialized, /do-not-save|token=secret|signed_url/);
});
test('only same-origin unsigned public profile avatars survive sanitization', () => {
 const h = harness(), good = base + '/storage/v1/object/public/avatars/alice.jpg';
 assert.equal(h.sanitizeInboxStartup(inbox({ other_avatar: good })).rows[0].other_avatar, good);
 for (const value of [good + '?token=secret', good.replace('fixture.supabase.co', 'other.invalid'), base + '/storage/v1/object/public/post-media/private.jpg']) assert.equal(h.sanitizeInboxStartup(inbox({ other_avatar: value })).rows[0].other_avatar, null);
});
test('logout and account changes erase old snapshots and their delayed observers cannot read them', async () => {
 const h = harness(); await h.registry.setAccount('owner'); await h.inboxStartup.write('owner', inbox());
 await h.registry.setAccount('another'); assert.equal(h.inboxStartup.peek('owner'), null);
 const cold = harness(h.disk); await cold.registry.setAccount('owner'); await cold.inboxStartup.hydrate('owner'); assert.equal(cold.inboxStartup.peek('owner'), null);
 await cold.inboxStartup.write('owner', inbox()); await cold.registry.setAccount(null);
 assert.ok(![...h.disk.keys()].some(key => key.startsWith('secure:')));
});
test('expiry invalidates cached previews and reports the change to mounted consumers', async () => {
 const h = harness(); await h.registry.setAccount('owner'); await h.notificationStartup.write('owner', [note()]);
 let calls = 0; const stop = h.notificationStartup.subscribe(() => calls++);
 await h.advance(24 * 60 * 60000); assert.equal(h.notificationStartup.peek('owner'), null); assert.equal(calls, 1); stop();
});
test('story cache rejects expired stories and keeps author metadata without media bytes', () => {
 const h = harness();
 const row = { user_id: 'friend', full_name: 'Alice', username: 'alice', latest_story_id: 'story', latest_story_at: new Date().toISOString(), latest_story_expires_at: new Date(Date.now() + 60000).toISOString(), story_count: 1, unseen_count: 1, has_unseen: true, media_url: 'private', avatar_url: base + '/storage/v1/object/public/avatars/alice.jpg' };
 const saved = h.sanitizeStoryStartup({ actorId: 'owner', rows: [row, { ...row, user_id: 'expired', latest_story_at: new Date(Date.now() - 90000000).toISOString(), latest_story_expires_at: new Date(Date.now() - 1).toISOString() }] });
 assert.equal(saved.rows.length, 1); assert.equal(saved.rows[0].has_unseen, true); assert.equal(saved.rows[0].media_url, undefined);
});
test('maximum-size text retains a bounded useful snapshot rather than exceeding secure storage', async () => {
 const h = harness(); await h.registry.setAccount('owner');
 const rows = Array.from({ length: 1000 }, (_, index) => note({ notification_id: 'notice-' + index, message: '字'.repeat(1000), body_preview: '字'.repeat(1000), post_text: '字'.repeat(1000) }));
 await h.notificationStartup.write('owner', rows);
 const saved = h.notificationStartup.peek('owner'); assert.ok(saved?.length > 0 && saved.length <= 30);
 const raw = [...h.disk.entries()].find(([key]) => key.includes('notifications'))[1]; assert.ok(Buffer.byteLength(raw) <= 24576);
});
test('story snapshot expires at the earliest authoritative story expiry, before the 24 hour ceiling', async () => {
 const h = harness(); await h.registry.setAccount('owner');
 const row = { user_id: 'friend', full_name: 'Alice', latest_story_id: 'story', latest_story_at: new Date().toISOString(), latest_story_expires_at: new Date(Date.now() + 60000).toISOString(), story_count: 1, has_unseen: true };
 await h.storyStartup.all.write('owner', { actorId: 'owner', rows: [row] });
 assert.equal(h.storyStartup.all.peek('owner').rows.length, 1);
 await h.advance(61000); assert.equal(h.storyStartup.all.peek('owner'), null);
});
test('story expiry lookup uses one bounded authorized read and excludes missing, denied and expired rows', async () => {
 const calls = [], timers = new Map(); let response, timer = 0;
 const api = compile('src/services/storyStartup.ts', {
  setTimeout: fn => { timers.set(++timer, fn); return timer; }, clearTimeout: id => timers.delete(id),
  require: () => ({ supabase: { from(table) { const call = { table }; calls.push(call); const query = {
    select(columns) { call.columns = columns; return query; }, in(column, values) { call.column = column; call.values = values; return query; },
    abortSignal(signal) { call.signal = signal; return Promise.resolve(response); },
  }; return query; } } }),
 });
 const rows = Array.from({ length: 50 }, (_, n) => ({ user_id: 'user-' + n, latest_story_id: 'story-' + n }));
 response = { data: [{ id: 'story-0', expires_at: new Date(Date.now() + 60000).toISOString() }, { id: 'story-1', expires_at: new Date(Date.now() - 1).toISOString() }], error: null };
 const saved = await api.readStoryStartup(rows); assert.equal(calls.length, 1); assert.equal(calls[0].values.length, 30);
 assert.equal(calls[0].columns, 'id,expires_at'); assert.equal(saved.length, 1); assert.equal(saved[0].latest_story_id, 'story-0'); assert.equal(timers.size, 0);
 response = { data: null, error: { code: '42501' } }; await assert.rejects(api.readStoryStartup(rows));
 assert.equal(timers.size, 0);
});
test('inbox snapshot admission omits disappearing, missing and unverified conversation settings in one bounded read', async () => {
 const calls = []; let response;
 const api = compile('src/services/inboxStartup.ts', { setTimeout, clearTimeout,
  require: () => ({ supabase: { from(table) { const call = { table }; calls.push(call); const query = {
    select(columns) { call.columns = columns; return query; }, in(column, values) { call.values = values; return query; },
    abortSignal(signal) { call.signal = signal; return Promise.resolve(response); },
  }; return query; } } }),
 });
 const rows = Array.from({ length: 50 }, (_, n) => ({ id: 'chat-' + n, last_message: 'Preview' }));
 response = { data: [{ id: 'chat-0', disappearing_seconds: null }, { id: 'chat-1', disappearing_seconds: 86400 }, { id: 'chat-2' }], error: null };
 const saved = await api.readInboxStartup(rows); assert.equal(calls.length, 1); assert.equal(calls[0].values.length, 30);
 assert.equal(saved.length, 1); assert.equal(saved[0].id, 'chat-0');
 response = { data: null, error: { code: '42501' } }; await assert.rejects(api.readInboxStartup(rows));
});
