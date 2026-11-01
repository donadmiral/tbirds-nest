const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, imports = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, URL, require: name => { if (!(name in imports)) throw Error(name); return imports[name]; } });
  return exports;
}
const content = load('shared/contentMedia.ts');
const { reuseFeedMediaGrants } = load('shared/feedMediaReuse.ts', { './contentMedia': content });
const base = 'https://fixture.supabase.co', now = 1_000_000;
const canonical = name => `${base}/storage/v1/object/public/post-media/owner/${name}`;
const signed = name => `${base}/functions/v1/media-content/post-media/owner/${name}?token=${'a'.repeat(64)}`;
function row(signedUrls = false) {
  const url = signedUrls ? signed : canonical;
  return { id: 'post-a', user_id: 'author', content: 'A caption', likes_count: 1,
    media: [{ id: 'clip', url: url('clip.mp4'), media_type: 'video', sort_order: 0, edit: { coverUrl: url('cover.jpg'), trimStart: 0 } }],
    ...(signedUrls ? { _mediaExpiresAt: now + 180_000 } : {}) };
}
const reuse = (old, incoming, previous = 'account-a:1', next = previous) => reuseFeedMediaGrants([old], [incoming], base, previous, next, now)[0];

test('fresh feed counts retain the same authorized video and cover URLs without altering metadata', () => {
  const old = row(true), incoming = { ...row(), likes_count: 9 };
  const result = reuse(old, incoming);
  assert.equal(result.likes_count, 9);
  assert.equal(result.media[0].url, old.media[0].url);
  assert.equal(result.media[0].edit.coverUrl, old.media[0].edit.coverUrl);
  assert.equal(result._mediaExpiresAt, old._mediaExpiresAt);
  assert.equal(incoming.media[0].url, canonical('clip.mp4'));
});
test('expired, soon-expiring, nonfinite and implausibly long grants must be renewed', () => {
  for (const expiry of [undefined, now - 1, now + 60_000, NaN, Infinity, now + 300_001]) {
    const incoming = row();
    assert.equal(reuse({ ...row(true), _mediaExpiresAt: expiry }, incoming), incoming);
  }
});
test('an account switch or a new session for the same account cannot reuse old capabilities', () => {
  const incoming = row();
  for (const [oldScope, newScope] of [[null, null], ['account-a:1', 'account-b:2'], ['account-a:1', 'account-a:3']]) {
    assert.equal(reuse(row(true), incoming, oldScope, newScope), incoming);
  }
});
test('different posts, authors, uploaded media, covers and edit recipes receive fresh grants', () => {
  for (const changed of [
    { ...row(), id: 'post-b' }, { ...row(), user_id: 'other' },
    { ...row(), media: [{ ...row().media[0], url: canonical('replacement.mp4') }] },
    { ...row(), media: [{ ...row().media[0], edit: { coverUrl: canonical('new-cover.jpg'), trimStart: 0 } }] },
    { ...row(), media: [{ ...row().media[0], edit: { coverUrl: canonical('cover.jpg'), trimStart: 1 } }] },
  ]) assert.equal(reuse(row(true), changed), changed);
});
test('partial grants and legacy storage tokens never masquerade as a reusable complete media set', () => {
  const old = row(true), incoming = row();
  old.media[0].edit.coverUrl = canonical('cover.jpg');
  assert.equal(reuse(old, incoming), incoming);
  const legacy = row(true);
  legacy.media[0].url = `${base}/storage/v1/object/sign/post-media/owner/clip.mp4?token=legacy`;
  assert.equal(reuse(legacy, incoming), incoming);
});
test('article inline images retain exact current capabilities and new inline media cannot borrow one', () => {
  const old = { ...row(true), content: `Article ![photo](${signed('inline.jpg')})` };
  const incoming = { ...row(), content: `Article ![photo](${canonical('inline.jpg')})` };
  assert.equal(reuse(old, incoming).content, old.content);
  const changed = { ...incoming, content: `Article ![photo](${canonical('other.jpg')})` };
  assert.equal(reuse(old, changed), changed);
});
