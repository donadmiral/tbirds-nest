// Existing QA only. Credentials and capabilities stay in the private temporary state file.
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
const [phase, statePath] = process.argv.slice(2);
if (!['login', 'publish', 'probe', 'cleanup-storage'].includes(phase) || !statePath) throw new Error('phase and private state.json required');
const state = JSON.parse(await readFile(statePath, 'utf8')), root = dirname(statePath);
const env = JSON.parse(await readFile('eas.json', 'utf8')).build.preview.env;
const base = 'https://uaulhuelcfkjwojtymmw.supabase.co', key = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (state.projectId !== 'uaulhuelcfkjwojtymmw' || state.base !== base || env.EXPO_PUBLIC_APP_ENV !== 'qa' || env.EXPO_PUBLIC_SUPABASE_URL !== base) throw new Error('Existing QA only');
if (!key.startsWith('sb_publishable_') && JSON.parse(Buffer.from(key.split('.')[1] || '', 'base64url').toString()).role !== 'anon') throw new Error('Only publishable credentials are allowed');
const save = () => writeFile(statePath, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
const assert = (ok, message) => { if (!ok) throw new Error(message); };
async function request(path, { account, method = 'GET', json, bytes, headers = {} } = {}) {
  const url = new URL(path, base);
  assert(url.origin === base, 'Cross-origin request rejected');
  const started = Date.now();
  const response = await fetch(url, { method, redirect: 'error', signal: AbortSignal.timeout(30000),
    headers: { apikey: key, ...(account ? { Authorization: `Bearer ${account.accessToken}` } : {}),
      ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: json !== undefined ? JSON.stringify(json) : bytes });
  const body = Buffer.from(await response.arrayBuffer());
  return { status: response.status, bytes: body, json: () => JSON.parse(body.toString()),
    mime: response.headers.get('content-type')?.split(';')[0], elapsedMs: Date.now() - started };
}
try {
  if (phase === 'login') {
    for (const account of Object.values(state.accounts)) {
      const result = await request('/auth/v1/token?grant_type=password', { method: 'POST', json: { email: account.email, password: account.password } });
      assert(result.status === 200, 'QA GoTrue sign-in HTTP ' + result.status);
      const value = result.json();
      assert(value.user?.id === account.id && typeof value.access_token === 'string', 'Unexpected authenticated identity');
      const claims = JSON.parse(Buffer.from(value.access_token.split('.')[1], 'base64url').toString());
      assert(claims.sub === account.id && claims.session_id, 'Actual QA auth session required');
      account.accessToken = value.access_token;
      account.refreshToken = value.refresh_token;
    }
    await save();
    console.log(JSON.stringify({ phase, passed: true, accounts: 2 }));
  }
  if (phase === 'publish') {
    const author = state.accounts.author;
    for (const media of Object.values(state.media)) {
      if (media.uploaded) continue;
      const bytes = await readFile(join(root, media.file));
      assert(bytes.length === media.bytes && bytes.length < 262144 && createHash('sha256').update(bytes).digest('hex') === media.sha256, 'Exact bounded canary asset required');
      const result = await request('/storage/v1/object/post-media/' + media.path, { account: author, method: 'POST', bytes,
        headers: { 'Content-Type': media.mime, 'x-upsert': 'false' } });
      assert([200, 201].includes(result.status), 'QA Storage upload HTTP ' + result.status);
      media.uploaded = true;
      await save();
    }
    if (!state.published) {
      const post = await request('/rest/v1/posts', { account: author, method: 'POST', json: {
        id: state.postId, user_id: author.id, body: state.caption, content: state.caption,
        scope: 'global', audience: 'everyone', account_type: 'personal', is_exclusive: false,
      } });
      assert(post.status === 201, 'Public canary insert HTTP ' + post.status);
      state.published = true;
      await save();
    }
    for (const [kind, media] of Object.entries(state.media)) {
      if (media.attached) continue;
      const result = await request('/rest/v1/post_media', { account: author, method: 'POST', json: {
        id: media.id, post_id: state.postId, url: base + '/storage/v1/object/public/post-media/' + media.path,
        media_type: kind, sort_order: kind === 'image' ? 0 : 1, width: media.width, height: media.height,
        edit: { aspect: 'original' }, alt_text: 'Generated QA ' + kind + ' test pattern', is_sensitive: false,
      } });
      assert(result.status === 201, 'Canary attachment insert HTTP ' + result.status);
      media.attached = true;
      await save();
    }
    console.log(JSON.stringify({ phase, passed: true, posts: 1, sourceObjects: 2 }));
  }
  if (phase === 'probe') {
    const viewer = state.accounts.viewer;
    const feed = await request('/rest/v1/rpc/get_feed', { account: viewer, method: 'POST', json: { p_mode: 'for_you', p_limit: 20 } });
    assert(feed.status === 200, 'Canary feed HTTP ' + feed.status);
    const index = feed.json().findIndex(row => row.post_id === state.postId);
    assert(index === 0, 'Canary must be the actual first ranked feed post, observed index ' + index);
    const visibility = await request('/rest/v1/rpc/get_feed_visibility', { account: viewer, method: 'POST', json: { p_ids: [state.postId] } });
    assert(visibility.status === 200 && visibility.json()[0]?.snapshot_eligible === true, 'Server offline snapshot eligibility required');
    const grant = await request('/functions/v1/content-media-sign', { account: viewer, method: 'POST',
      json: { references: [{ kind: 'post', id: state.postId }], delivery: 'no-store' } });
    assert(grant.status === 200, 'QA media signing HTTP ' + grant.status);
    const signed = grant.json(), checks = [];
    assert(signed.expiresAt > Date.now() && signed.urls?.length === 2, 'Two actual expiring media capabilities required');
    for (const [kind, media] of Object.entries(state.media)) {
      const value = signed.urls.find(item => item.key === 'post-media/' + media.path);
      assert(value && /^[A-Za-z0-9_-]{1,128}$/.test(value.sourceVersion || ''), 'Immutable source version required for ' + kind);
      const url = new URL(value.url);
      assert(url.origin === base && url.pathname.startsWith('/functions/v1/media-content/') && /^[a-f0-9]{64}$/.test(url.searchParams.get('token') || ''), 'First-party revocable media capability required');
      const mediaResponse = await request(url, {});
      assert(mediaResponse.status === 200 && mediaResponse.bytes.length > 0 && mediaResponse.bytes.length < 524288 && mediaResponse.mime === media.mime, 'Authorized bounded media response required for ' + kind);
      media.sourceVersion = value.sourceVersion;
      media.deliveredBytes = mediaResponse.bytes.length;
      media.deliveredSha256 = createHash('sha256').update(mediaResponse.bytes).digest('hex');
      checks.push({ kind, mediaId: media.id, sourceVersion: value.sourceVersion, bytes: media.deliveredBytes,
        sha256: media.deliveredSha256, elapsedMs: mediaResponse.elapsedMs });
    }
    await save();
    const manifest = { runId: state.runId, projectId: state.projectId, postId: state.postId, caption: state.caption,
      accounts: Object.fromEntries(Object.entries(state.accounts).map(([role, account]) => [role, { id: account.id }])),
      firstRankedFeedPost: true, snapshotEligible: true, media: checks, physicalPhone: false };
    await writeFile(join(root, 'preflight.json'), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
    await writeFile(join(root, 'connected-canary.json'), JSON.stringify({ ...manifest, base, email: viewer.email, password: viewer.password }, null, 2) + '\n', { mode: 0o600 });
    console.log(JSON.stringify({ phase, passed: true, firstRankedFeedPost: true, snapshotEligible: true, authorizedOriginals: 2 }));
  }
  if (phase === 'cleanup-storage') {
    const expected = Object.values(state.media).map(media => media.path);
    const result = await request('/storage/v1/object/post-media', { account: state.accounts.author, method: 'DELETE',
      json: { prefixes: expected } });
    assert(result.status === 200, 'Exact QA source deletion HTTP ' + result.status);
    const removed = result.json();
    assert(Array.isArray(removed) && removed.length === expected.length
      && expected.every(path => removed.some(item => item?.name === path)), 'Storage did not acknowledge both exact source deletions. Independent readback is required.');
    console.log(JSON.stringify({ phase, passed: true, acknowledgedSourcePaths: expected.length,
      sourceDeletionReadbackRequired: true, derivativeCleanupRequiresVerification: true }));
  }
} catch (error) {
  await writeFile(join(root, 'phase-failure.json'), JSON.stringify({ phase, error: error.message }, null, 2) + '\n', { mode: 0o600 });
  console.error(JSON.stringify({ phase, passed: false, error: error.message }));
  process.exitCode = 1;
}
