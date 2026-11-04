const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');

function moduleFrom(file, imports = {}) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module, exports: module.exports, URL, Map, Set, console, require: name => { if (name in imports) return imports[name]; throw Error('Unexpected import ' + name); } });
  return module.exports;
}
const { createScreenReadGuard, isReadAccessDenied, requireReadRows } = moduleFrom('shared/readContinuity.ts');
const { replaceContentMedia } = moduleFrom('shared/contentMedia.ts');
const base = 'https://media.test';
const privateUrl = base + '/storage/v1/object/sign/post-media/post/image.jpg?token=old';
const publicUrl = 'https://public.test/image.jpg';
const deferred = () => {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
};

// Execute the actual screen callback, with state and network boundaries supplied.
// This exercises the production branch ordering rather than matching source text.
function callback(file, name, globals) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name && node.initializer) {
      if (ts.isCallExpression(node.initializer) && node.initializer.expression.getText(ast) === 'useCallback') found = node.initializer.arguments[0].getText(ast);
      else if (ts.isArrowFunction(node.initializer)) found = node.initializer.getText(ast);
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.ok(found, `${file} callback ${name} exists`);
  const context = { ...globals, console, Promise, Set, Map, Array, Error };
  vm.runInNewContext(ts.transpileModule('globalThis.run = ' + found, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, context);
  return context.run;
}

function client(handler) {
  const make = (table, rpc = false, args = undefined) => {
    const request = { table, rpc, args, calls: [] };
    const query = { then(resolve, reject) { return Promise.resolve().then(() => handler(request)).then(resolve, reject); } };
    for (const method of ['select', 'eq', 'in', 'not', 'is', 'or', 'order', 'limit', 'maybeSingle', 'single']) {
      query[method] = (...args) => { request.calls.push([method, ...args]); return query; };
    }
    return query;
  };
  return { from: table => make(table), rpc: (name, args) => make(name, true, args) };
}

function stateSetters(state) {
  return Object.fromEntries(Object.keys(state).map(key => [
    'set' + key[0].toUpperCase() + key.slice(1),
    value => { state[key] = typeof value === 'function' ? value(state[key]) : value; },
  ]));
}

function messageScreen(kind) {
  const state = { saved: [], rows: [], loading: true, refreshing: false, loadError: null };
  const reads = createScreenReadGuard('viewer');
  const calls = [];
  let read = () => ({ data: [], error: null });
  let signAvatars = async rows => rows;
  const load = callback(`src/screens/messages/${kind}MessagesScreen.tsx`, 'load', {
    userId: 'viewer', myId: 'viewer', reads, isReadAccessDenied, requireReadRows,
    ...stateSetters(state), supabase: client(request => { calls.push(request); return read(request); }),
    orderTimeout: value => Promise.resolve(value), bounded: value => Promise.resolve(value),
    signGroupAvatars: rows => signAvatars(rows), isChatMediaUrl: url => typeof url === 'string' && url.includes('/chat-media/'),
  });
  return { state, reads, calls, load, respond: fn => { read = fn; }, signer: fn => { signAvatars = fn; } };
}

for (const kind of ['Saved', 'Starred']) {
  const key = kind === 'Saved' ? 'saved' : 'rows';
  test(`${kind}: background failure preserves loaded content, denial and successful empty results clear it`, async () => {
    const r = messageScreen(kind);
    const existing = [{ id: 'existing' }];
    r.state[key] = existing; r.state.loading = false;
    const pending = deferred(); r.respond(() => pending.promise);
    const work = r.load();
    assert.equal(r.state[key], existing);
    assert.equal(r.state.loading, false);
    pending.resolve({ data: null, error: { message: 'Network temporarily unavailable' } });
    await work;
    assert.equal(r.state[key], existing);
    assert.match(r.state.loadError, /retry/);
    r.respond(() => ({ data: null, error: { code: '42501' } }));
    await r.load();
    assert.equal(r.state[key].length, 0);
    r.state[key] = existing;
    r.respond(() => ({ data: [], error: null }));
    await r.load();
    assert.equal(r.state[key].length, 0);
    assert.equal(r.state.loadError, null);
  });

  test(`${kind}: a late failure cannot overwrite a newer successful read`, async () => {
    const r = messageScreen(kind), old = deferred();
    r.respond(() => old.promise);
    const first = r.load();
    await Promise.resolve(); await Promise.resolve();
    r.respond(() => ({ data: [], error: null }));
    await r.load();
    old.resolve({ data: null, error: { status: 403 } }); await first;
    assert.equal(r.state.loadError, null);
    assert.equal(r.state.loading, false);
  });

  test(`${kind}: old account and blurred screen responses cannot commit`, async () => {
    for (const change of [reads => { reads.setScope('another'); reads.setScope('viewer'); }, reads => reads.invalidate()]) {
      const r = messageScreen(kind), pending = deferred();
      r.respond(() => pending.promise);
      const work = r.load();
      change(r.reads);
      r.state[key] = [{ id: 'new-state' }];
      pending.resolve({ data: [], error: null }); await work;
      assert.equal(r.state[key][0].id, 'new-state');
      assert.equal(r.state.loading, true);
    }
  });
}

test('Saved: text previews complete without signing unused message attachments', async () => {
  const r = messageScreen('Saved');
  const rows = [{ id: 'saved', message: { id: 'message', media_url: privateUrl, media_type: 'image' } }];
  r.respond(() => ({ data: rows, error: null }));
  await r.load();
  assert.equal(r.state.saved, rows);
  assert.equal(r.calls.length, 1);
  assert.equal(r.state.loading, false);
});

test('Starred: enrichment failure keeps known names and successful deletion removes old content', async () => {
  const r = messageScreen('Starred');
  const existing = [{ id: 'old', sender_name: 'Known sender' }];
  r.state.rows = existing; r.state.loading = false;
  r.respond(request => request.table === 'starred_messages'
    ? { data: [{ id: 'star', conversation_id: 'chat', msg: { id: 'message', sender_id: 'sender' } }], error: null }
    : { data: null, error: { message: 'Temporary connection failure' } });
  await r.load();
  assert.equal(r.state.rows, existing);
  assert.match(r.state.loadError, /retry/);
  r.respond(() => ({ data: [], error: null }));
  await r.load();
  assert.equal(r.state.rows.length, 0);
});

test('Starred: author and conversation previews load without signing message attachments', async () => {
  const r = messageScreen('Starred');
  r.respond(request => {
    if (request.table === 'starred_messages') return { data: [{ id: 'star', conversation_id: 'chat', msg: { id: 'message', sender_id: 'sender', media_url: privateUrl } }], error: null };
    if (request.table === 'conversations') return { data: [{ id: 'chat', is_group: false, user_1: 'viewer', user_2: 'sender' }], error: null };
    return { data: [{ id: 'sender', full_name: 'Known sender', avatar_url: publicUrl }], error: null };
  });
  await r.load();
  assert.equal(r.state.rows[0].sender_name, 'Known sender');
  assert.equal(r.state.rows[0].other_party.avatar_url, publicUrl);
  assert.equal(r.state.loading, false);
});

function postScreen(options = {}) {
  const state = {
    post: { id: 'post', content: 'Visible post', media_url: privateUrl, author: { id: 'author' } },
    galleryImages: [{ url: privateUrl }, { url: publicUrl }], linkPreview: { image_url: privateUrl, title: 'Link' },
    threadAbove: [{ id: 'parent' }], threadBelow: [{ id: 'child' }], postCollabs: [{ id: 'collaborator' }],
    collabInvite: false, likedPost: true, viewerIndex: null, loading: false, notFound: false, loadError: null,
  };
  const identityRef = { current: { postId: 'post', userId: 'viewer' } }, loadEpoch = { current: 0 };
  let read = request => {
    if (request.rpc) return { data: true, error: null };
    if (request.table === 'posts') return { data: request.calls.some(call => call[0] === 'eq' && call[1] === 'id')
      ? { id: 'post', user_id: 'author', content: 'Updated post', media_url: publicUrl, article_title: 'Article', link_url: 'https://link.test' } : [], error: null };
    if (request.table === 'profiles') return { data: { id: 'author', full_name: 'Author' }, error: null };
    if (request.table === 'post_collaborators') return { data: null, error: { message: 'Optional lookup unavailable' } };
    if (request.table === 'link_previews') return { data: null, error: { message: 'Optional lookup unavailable' } };
    if (request.table === 'articles') return { data: null, error: { message: 'Optional lookup unavailable' } };
    return { data: null, error: null };
  };
  let hydrate = async rows => rows;
  const setters = stateSetters(state), queued = [];
  if (options.deferFunctional) for (const key of ['Post', 'GalleryImages', 'LinkPreview']) {
    const set = setters['set' + key]; setters['set' + key] = value => typeof value === 'function' ? queued.push(() => set(value)) : set(value);
  }
  const load = callback('src/screens/feed/PostScreen.tsx', 'load', {
    postId: 'post', userId: 'viewer', identityRef, loadEpoch, isReadAccessDenied, requireReadRows,
    ...setters, supabase: client(request => read(request)),
    bounded: value => Promise.resolve(value), hydratePostMedia: rows => hydrate(rows),
    withoutPrivateMedia: rows => replaceContentMedia(rows, base, new Map()),
  });
  return { state, load, identityRef, flush: () => queued.splice(0).forEach(run => run()), respond: fn => { read = fn; }, hydrate: fn => { hydrate = fn; } };
}

test('Post: a transient refresh preserves the card, gallery and thread', async () => {
  const r = postScreen(), original = r.state.post, gallery = r.state.galleryImages;
  r.respond(() => ({ data: null, error: { message: 'Temporary connection failure' } }));
  await r.load();
  assert.equal(r.state.post, original);
  assert.equal(r.state.galleryImages, gallery);
  assert.equal(r.state.threadAbove[0].id, 'parent');
  assert.match(r.state.loadError, /retry/);
});

test('Post: denied and missing posts clear the card and every visible detail', async () => {
  for (const mode of ['denied', 'missing']) {
    const r = postScreen();
    r.respond(request => request.rpc
      ? { data: mode === 'missing', error: null }
      : { data: null, error: null });
    await r.load();
    assert.equal(r.state.post, null);
    assert.equal(r.state.galleryImages.length, 0);
    assert.equal(r.state.linkPreview, null);
    assert.equal(r.state.postCollabs.length, 0);
    assert.equal(r.state.threadAbove.length, 0);
    assert.equal(r.state.notFound, true);
  }
});

test('Post: an optional request failure does not erase an unrelated existing gallery or preview', async () => {
  const r = postScreen(), gallery = r.state.galleryImages, preview = r.state.linkPreview;
  await r.load();
  assert.equal(r.state.post.content, 'Updated post');
  assert.equal(r.state.galleryImages, gallery);
  assert.equal(r.state.linkPreview, preview);
  assert.match(r.state.loadError, /details/);
});

test('Post: failed signing strips old private capabilities while preserving text and public media', async () => {
  const r = postScreen();
  r.hydrate(async () => { throw Error('Signing failed'); });
  await r.load();
  assert.equal(r.state.post.content, 'Visible post');
  assert.equal(r.state.post.media_url, null);
  assert.equal(r.state.galleryImages.length, 1);
  assert.equal(r.state.galleryImages[0].url, publicUrl);
  assert.equal(r.state.linkPreview.image_url, null);
  assert.equal(r.state.linkPreview.title, 'Link');
});

test('Post: a completed read for a previous post cannot change current content', async () => {
  const r = postScreen(), pending = deferred();
  r.respond(() => pending.promise);
  const work = r.load();
  r.identityRef.current = { postId: 'another-post', userId: 'viewer' };
  r.state.post = { id: 'another-post' };
  pending.resolve({ data: false, error: null }); await work;
  assert.equal(r.state.post.id, 'another-post');
  assert.equal(r.state.notFound, false);
});

function scopedList(file, key) {
  const state = { [key]: [{ id: 'retained' }], loading: false, refreshing: false, loadError: null };
  const reads = createScreenReadGuard(file.includes('YourActivity') ? 'viewer:likes' : 'viewer');
  let response = { data: [], error: null };
  const read = () => typeof response === 'function' ? response() : response;
  const load = callback(file, 'load', {
    userId: 'viewer', myId: 'viewer', kind: 'likes', reads, isReadAccessDenied, requireReadRows,
    TABS: [{ key: 'likes', table: 'post_likes' }],
    ...stateSetters(state), supabase: client(read),
    orderTimeout: value => Promise.resolve(value),
    hydratePostMedia: async rows => rows,
    withoutPrivateMedia: rows => replaceContentMedia(rows, base, new Map()),
    jobsService: { getSavedJobs: async () => { const result = await read(); if (result.error) throw result.error; return result.data; } },
  });
  return { state, reads, load, respond: value => { response = value; } };
}

for (const [name, file, key] of [
  ['Saved jobs', 'src/screens/jobs/SavedJobsScreen.tsx', 'jobs'],
  ['Your activity', 'src/screens/profile/YourActivityScreen.tsx', 'items'],
  ['Login activity', 'src/screens/profile/LoginActivityScreen.tsx', 'rows'],
  ['Muted stories', 'src/screens/profile/MutedStoriesScreen.tsx', 'rows'],
  ['Archive', 'src/screens/profile/ArchiveScreen.tsx', 'rows'],
  ['Message requests', 'src/screens/messages/MessageRequestsScreen.tsx', 'requests'],
  ['Follow requests', 'src/screens/profile/FollowRequestsScreen.tsx', 'requests'],
]) {
  test(`${name}: transient read failures retain content, successful empties and denial clear it`, async () => {
    const r = scopedList(file, key), retained = r.state[key];
    const pending = deferred();
    r.respond(() => pending.promise);
    const work = r.load();
    assert.equal(r.state[key], retained);
    pending.resolve({ data: null, error: { message: 'Network failed' } }); await work;
    assert.equal(r.state[key], retained);
    assert.ok(r.state.loadError);
    r.respond({ data: [], error: null }); await r.load();
    assert.equal(r.state[key].length, 0);
    r.state[key] = retained;
    r.respond({ data: null, error: { code: '42501' } }); await r.load();
    assert.equal(r.state[key].length, 0);
    assert.equal(r.state.loading, false);
  });

  test(`${name}: a late response cannot overwrite another account or filter`, async () => {
    const r = scopedList(file, key), pending = deferred();
    r.respond(() => pending.promise);
    const work = r.load();
    r.reads.setScope('another-viewer:filter');
    r.reads.setScope('viewer:scope');
    r.state[key] = [{ id: 'current-state' }];
    pending.resolve({ data: [], error: null }); await work;
    assert.equal(r.state[key][0].id, 'current-state');
  });
}

function community(overrides = {}) {
  const state = { posts: [{ post_id: 'retained' }], announcements: [{ id: 'announcement' }], subs: [{ id: 'sub' }],
    info: { is_member: true }, commentsFor: { post_id: 'retained' }, loading: false, loadError: null,
    eName: '', eDesc: '', eRules: '', eMode: '', eColor: '', eCat: null };
  const reads = Object.fromEntries(['posts', 'info', 'extras', 'refresh'].map(key => [key, createScreenReadGuard('viewer:community')]));
  let handler = () => ({ data: [], error: null });
  const globals = { ...stateSetters(state), reads, readScope: 'viewer:community', communityId: 'community',
    isReadAccessDenied, requireReadRows, orderTimeout: value => Promise.resolve(value), supabase: client(request => handler(request)), ...overrides };
  return { state, reads, respond: fn => { handler = fn; },
    load: callback('src/screens/channels/CommunityScreen.tsx', 'loadPosts', globals),
    info: callback('src/screens/channels/CommunityScreen.tsx', 'loadInfo', globals),
    extras: callback('src/screens/channels/CommunityScreen.tsx', 'loadExtras', globals) };
}

test('Community: a failed post refresh preserves the list, explicit denial and successful empty clear it', async () => {
  const r = community(), retained = r.state.posts;
  r.respond(() => ({ data: null, error: { message: 'Network failed' } })); await r.load();
  assert.equal(r.state.posts, retained);
  assert.match(r.state.loadError, /retry/);
  r.respond(() => ({ data: [], error: null })); await r.load();
  assert.equal(r.state.posts.length, 0);
  r.state.posts = retained;
  r.respond(() => ({ data: null, error: { status: 403 } })); await r.load();
  assert.equal(r.state.posts.length, 0);
  assert.equal(r.state.commentsFor, null);
});

test('Community: membership revocation cancels a pending post response and clears private details', async () => {
  const r = community(), pending = deferred();
  r.respond(request => request.table === 'get_community_posts' ? pending.promise : { data: [{ is_member: false, name: 'Community' }], error: null });
  const work = r.load(); await r.info();
  pending.resolve({ data: [{ post_id: 'stale-private-post' }], error: null }); await work;
  assert.equal(r.state.posts.length, 0);
  assert.equal(r.state.announcements.length, 0);
  assert.equal(r.state.subs.length, 0);
  assert.equal(r.state.info.is_member, false);
});

test('Community: an optional announcement error does not blank retained announcements or successful sub-communities', async () => {
  const r = community(), retained = r.state.announcements;
  r.respond(request => request.table === 'get_community_announcements'
    ? { data: null, error: { message: 'Network failed' } }
    : { data: [{ id: 'updated-sub' }], error: null });
  await r.extras();
  assert.equal(r.state.announcements, retained);
  assert.equal(r.state.subs[0].id, 'updated-sub');
});

test('Community: a queued pagination update cannot append a previous account or community page', async () => {
  let queued;
  const r = community({ setPosts: update => { queued = update; } });
  r.respond(() => ({ data: [{ post_id: 'private-old-page' }], error: null }));
  await r.load('cursor');
  assert.equal(typeof queued, 'function');
  assert.deepEqual(Array.from(queued([{ post_id: 'retained' }]), row => row.post_id), ['retained', 'private-old-page']);
  r.reads.posts.setScope('another-viewer:another-community');
  const current = [{ post_id: 'current-community' }];
  assert.equal(queued(current), current);
});

for (const failed of ['announcements', 'subs']) for (const mode of ['malformed', 'transport']) {
  test(`Community: ${failed} ${mode} failure cannot hide sibling access denial`, async () => {
    const r = community(), retained = r.state[failed];
    const denied = failed === 'announcements' ? 'subs' : 'announcements';
    r.respond(request => {
      const key = request.table === 'get_community_announcements' ? 'announcements' : 'subs';
      if (key === denied) return { data: null, error: { code: '42501', message: 'Access denied' } };
      if (mode === 'transport') throw new Error('Network unavailable');
      return { data: null, error: null };
    });
    await r.extras();
    assert.equal(r.state[failed], retained);
    assert.equal(r.state[denied].length, 0);
    assert.match(r.state.loadError, /retry/);
  });
}

function applicants() {
  const state = { apps: [{ id: 'retained' }], counts: { all: 1 }, cursor: { id: 'cursor' }, loading: false, loadingMore: false, err: null };
  const generation = { current: 0 };
  let read = async () => ({ applications: [], counts: { all: 0 }, has_more: false });
  const load = callback('src/screens/jobs/ApplicantsScreen.tsx', 'load', {
    ...stateSetters(state), generation, morePending: { current: false }, job: { id: 'job' }, userId: 'viewer', filter: 'all',
    supabase: {}, loadApplicantPage: () => read(), orderTimeout: value => Promise.resolve(value), isReadAccessDenied, requireReadRows,
  });
  return { state, generation, load, respond: fn => { read = fn; } };
}

test('Applicants: reloading after a status change retains cards and counts through a transient failure', async () => {
  const r = applicants(), retained = r.state.apps, counts = r.state.counts;
  const pending = deferred(); r.respond(() => pending.promise);
  const work = r.load();
  assert.equal(r.state.apps, retained); assert.equal(r.state.counts, counts);
  pending.resolve(Promise.reject(Error('Network failed'))); await work;
  assert.equal(r.state.apps, retained); assert.equal(r.state.counts, counts);
  assert.ok(r.state.err);
  r.respond(async () => { throw { code: '42501', message: 'No longer permitted' }; }); await r.load();
  assert.equal(r.state.apps.length, 0); assert.equal(r.state.counts.all, 0); assert.equal(r.state.cursor, null);
});

test('Applicants: a late read for a previous filter cannot overwrite the new filter', async () => {
  const r = applicants(), pending = deferred(); r.respond(() => pending.promise);
  const work = r.load(); r.generation.current++;
  r.state.apps = [{ id: 'new-filter' }];
  pending.resolve({ applications: [], counts: { all: 0 }, has_more: false }); await work;
  assert.equal(r.state.apps[0].id, 'new-filter');
});

test('Applicant read failures preserve denial metadata for both native and web screens', async () => {
  const { loadApplicantPage } = moduleFrom('shared/hiring.ts');
  const failure = { code: '42501', status: 403, message: 'Permission revoked' };
  await assert.rejects(loadApplicantPage({ rpc: async () => ({ data: null, error: failure }) }, '11111111-1111-1111-1111-111111111111'), error => error === failure);
});

test('known API denial codes clear retained private data, while transport errors remain recoverable', () => {
  for (const code of ['42501', 'PGRST301', 'PGRST302', 'PGRST303', 'AUTH_REQUIRED', 'ACCESS_DENIED', 'FORBIDDEN']) assert.equal(isReadAccessDenied({ code }), true, code);
  assert.equal(isReadAccessDenied({ context: { status: 403 } }), true);
  for (const message of ['ACCESS_DENIED', 'AUTH_REQUIRED', 'UNAUTHORIZED', 'permission denied for table', 'JWT expired', 'JWT invalid', 'Please sign in again']) assert.equal(isReadAccessDenied({ code: 'P0001', message }), true, message);
  assert.equal(isReadAccessDenied(Error('Connection failed while loading media')), false);
  for (const value of [null, Error('Network failed'), { status: 500 }, { code: 'PGRST000' }]) assert.equal(isReadAccessDenied(value), false);
});

test('old callback invocation cannot acquire a new account scope or cancel its current read', () => {
  const reads = createScreenReadGuard('new-account');
  const current = reads.begin('new-account');
  assert.equal(reads.begin('old-account')(), false);
  assert.equal(reads.capture('old-account')(), false);
  assert.equal(current(), true);
});

test('malformed successful list responses are errors and do not erase retained rows', async () => {
  for (const kind of ['Saved', 'Starred']) {
    const r = messageScreen(kind), key = kind === 'Saved' ? 'saved' : 'rows';
    const previous = [{ id: 'visible' }]; r.state[key] = previous;
    r.respond(() => ({ data: null, error: null })); await r.load();
    assert.equal(r.state[key], previous); assert.ok(r.state.loadError);
  }
  for (const [file, key] of [
    ['profile/YourActivityScreen.tsx', 'items'], ['profile/LoginActivityScreen.tsx', 'rows'],
    ['profile/MutedStoriesScreen.tsx', 'rows'], ['profile/ArchiveScreen.tsx', 'rows'],
    ['messages/MessageRequestsScreen.tsx', 'requests'], ['profile/FollowRequestsScreen.tsx', 'requests'],
  ]) {
    const r = scopedList('src/screens/' + file, key), previous = r.state[key];
    r.respond({ data: null, error: null }); await r.load();
    assert.equal(r.state[key], previous, file); assert.ok(r.state.loadError, file);
  }
});

test('Starred: failed private avatar renewal cannot be undone by a later profile lookup failure', async () => {
  const r = messageScreen('Starred');
  r.state.rows = [{ id: 'star', sender_name: 'Existing sender', conv: { id: 'chat', group_avatar_url: 'old-private-grant' } }];
  r.respond(request => {
    if (request.table === 'starred_messages') return { data: [{ id: 'star', conversation_id: 'chat', msg: { id: 'message', sender_id: 'sender' } }], error: null };
    if (request.table === 'conversations') return { data: [{ id: 'chat', is_group: true, group_avatar_url: 'https://media.test/storage/v1/object/public/chat-media/group/avatar.jpg' }], error: null };
    return { data: null, error: { message: 'Profile lookup unavailable' } };
  });
  r.signer(async rows => rows.map(row => ({ ...row, group_avatar_url: null })));
  await r.load();
  assert.equal(r.state.rows[0].sender_name, 'Existing sender');
  assert.equal(r.state.rows[0].conv.group_avatar_url, null);
  assert.ok(r.state.loadError);
});

test('Post: queued signing-failure cleanup cannot strip a later post after the route changes', async () => {
  const r = postScreen({ deferFunctional: true });
  r.hydrate(async () => { throw Error('Signing failed'); });
  await r.load();
  r.identityRef.current = { postId: 'new-post', userId: 'viewer' };
  r.state.post = { id: 'new-post', media_url: privateUrl };
  r.state.galleryImages = [{ url: privateUrl }]; r.state.linkPreview = { image_url: privateUrl };
  r.flush();
  assert.equal(r.state.post.media_url, privateUrl);
  assert.equal(r.state.galleryImages[0].url, privateUrl);
  assert.equal(r.state.linkPreview.image_url, privateUrl);
});

test('My applications preserves API denial metadata instead of masking it as a network error', async () => {
  const { loadMyApplicationPage } = moduleFrom('shared/hiring.ts');
  const failure = { code: 'PGRST301', message: 'JWT expired' };
  await assert.rejects(loadMyApplicationPage({ rpc: async () => ({ data: null, error: failure }) }), error => error === failure);
});

test('call history service does not turn a failed or malformed backend read into an empty history', async () => {
  let result = { data: null, error: { code: '42501', message: 'Permission denied' } };
  const { callService } = moduleFrom('src/services/callService.ts', {
    './supabase': { supabase: client(() => result) }, '../../shared/readContinuity': { requireReadRows },
  });
  await assert.rejects(callService.listRecentCalls('viewer'), error => error === result.error);
  result = { data: null, error: null };
  await assert.rejects(callService.listRecentCalls('viewer'), /incomplete/);
  result = { data: [], error: null };
  assert.equal((await callService.listRecentCalls('viewer')).length, 0);
});

test('saved job service validates the saved IDs, job rows and poster profiles before replacing a list', async () => {
  let malformed = 'job_saves';
  const { jobsService } = moduleFrom('src/services/jobsService.ts', {
    './supabase': { supabase: client(request => ({ data: request.table === malformed ? null : {
      job_saves: [{ job_id: 'job' }], jobs: [{ id: 'job', posted_by: 'poster' }], profiles: [{ id: 'poster', full_name: 'Poster' }],
    }[request.table], error: null })) },
    './flagsService': { flagsService: {} }, '../stores/actorStore': { authorId: value => value },
    '../../shared/hiring': {}, '../../shared/readContinuity': { requireReadRows },
  });
  for (malformed of ['job_saves', 'jobs', 'profiles']) await assert.rejects(jobsService.getSavedJobs('viewer'), /incomplete/);
  malformed = null;
  assert.equal((await jobsService.getSavedJobs('viewer'))[0].profile.full_name, 'Poster');
});

function searchScreen() {
  const contentMedia = moduleFrom('shared/contentMedia.ts');
  const { reuseFeedMediaGrants } = moduleFrom('shared/feedMediaReuse.ts', { './contentMedia': contentMedia });
  const { normalizeProfilePost } = moduleFrom('src/utils/profilePost.ts');
  const locator = base + '/storage/v1/object/public/post-media/post/image.jpg';
  const grant = base + '/functions/v1/media-content/post-media/post/image.jpg?token=' + 'a'.repeat(64);
  const raw = { id: 'post', user_id: 'author', content: 'Visible post', post_media: [{ id: 'image', url: locator, media_type: 'image' }] };
  const authorized = normalizeProfilePost({ ...raw, post_media: [{ ...raw.post_media[0], url: grant }], _mediaExpiresAt: Date.now() + 180000 });
  const state = { people: [{ id: 'person' }], posts: [authorized], jobs: [], listings: [{ id: 'listing', seller_id: 'seller' }], loading: false, errors: {}, visibleScope: 'viewer:query:top' };
  let hydrate = async () => [authorized];
  const load = callback('src/screens/feed/SearchScreen.tsx', 'runSearch', {
    myId: 'viewer', postMode: 'top', identity: { current: {} }, request: { current: 0 }, mounted: { current: true },
    searchScope: { current: 'viewer:query:top' }, resultsScope: { current: 'viewer:query:top' },
    ...stateSetters(state), isReadAccessDenied, requireReadRows, normalizeProfilePost,
    profileRead: value => Promise.resolve(value), hydratePostMedia: rows => hydrate(rows),
    withoutPrivateMedia: rows => contentMedia.replaceContentMedia(rows, base, new Map()),
    retainFeedMedia: (old, incoming, before, next) => reuseFeedMediaGrants(old, incoming, base, before, next),
    supabase: client(request => request.table === 'blocked_users' ? { data: [], error: null }
      : request.table === 'search_posts' ? { data: [raw], error: null }
      : request.table === 'search_jobs_fts' || request.table === 'log_search_event' ? { data: [], error: null }
      : { data: null, error: Error('Temporary lookup error') }),
  });
  return { state, load: () => load('query'), grant, hydrate: fn => { hydrate = fn; } };
}

test('Search: retry retains same-query people, listings and still-valid image grants while media renews', async () => {
  const r = searchScreen(), pending = deferred();
  r.hydrate(() => pending.promise);
  const work = r.load();
  for (let i = 0; i < 30; i++) await Promise.resolve();
  assert.equal(r.state.people[0].id, 'person'); assert.equal(r.state.listings[0].id, 'listing');
  assert.equal(r.state.posts[0].media[0].url, r.grant);
  pending.resolve([r.state.posts[0]]); await work;
  assert.equal(r.state.posts[0].media[0].url, r.grant);
});

test('Search: expiry and failed reauthorization remove old private grants instead of rendering raw locators', async () => {
  const r = searchScreen(), pending = deferred();
  r.state.posts[0]._mediaExpiresAt = Date.now() - 1000;
  r.hydrate(() => pending.promise);
  const work = r.load();
  for (let i = 0; i < 30; i++) await Promise.resolve();
  assert.equal(r.state.posts[0].media.length, 0);
  pending.resolve(Promise.reject(Error('Signing failed'))); await work;
  assert.equal(r.state.posts[0].media.length, 0);
  assert.ok(r.state.errors.posts);
});

test('Article reader retains rendered media on a metadata outage but clears it on denial or failed signing', async () => {
  for (const mode of ['metadata-outage', 'denied', 'signing-failure']) {
    const existing = { article: { media_url: privateUrl }, gallery: [{ url: privateUrl }] };
    const state = { result: existing, error: null };
    const load = callback('src/screens/feed/ArticleReaderScreen.tsx', 'load', {
      alive: true, generation: 0, source: { postId: 'post' }, viewer: 'viewer', ...stateSetters(state), isReadAccessDenied,
      supabase: client(request => mode === 'metadata-outage' ? { data: null, error: Error('Network failed') }
        : mode === 'denied' ? { data: null, error: { code: '42501' } }
        : { data: request.table === 'articles' ? { current_revision_id: 'revision' } : { content: { images: [{ url: privateUrl }] } }, error: null }),
      hydratePostMedia: async () => { throw Error('Signing failed'); },
    });
    await load();
    assert.equal(state.result, mode === 'metadata-outage' ? existing : null, mode);
    assert.match(state.error, /retry/);
  }
});
