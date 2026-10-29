const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../lib/storyPresentation.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleState = { exports: {} };
vm.runInNewContext(code, { module: moduleState, exports: moduleState.exports, URL, Set, Map, Promise });
const { storyPresentationSource, resolveStoryPresentations } = moduleState.exports;
const storyId = '10000000-0000-4000-8000-000000000001';
const postId = '20000000-0000-4000-8000-000000000001';
const url = path => 'https://qa.example.test/storage/v1/object/public/' + path;
const ownPhoto = url('story-media/owner/photo.jpg'), postPhoto = url('post-media/owner/post.jpg');
const story = overrides => ({ id: storyId, media_type: 'text', media_url: null, caption: null, ...overrides });
const postSticker = overrides => ({ kind: 'post', postId, postMediaUrl: postPhoto, postMediaType: 'image', postText: 'The actual shared post', postAuthorAvatar: url('avatars/author/avatar.jpg'), ...overrides });
const plain = value => JSON.parse(JSON.stringify(value));

test('story review retains the published crop, color treatment and trim without copying private draft fields', async () => {
  const input = story({media_type:'video',media_url:ownPhoto,filter_id:'platinum_golden_hour',media_transform:{fit:'cover',scale:1.3,translateNX:.1,trimStart:2,trimEnd:8,filterAmt:65,adjust:{warm:24,con:Infinity,evil:'url'},coverUrl:'private-draft',soundtrack:{url:'private-audio'}}});
  const [result] = await resolveStoryPresentations([input],async () => ({[ownPhoto]:'signed:story-photo'}));
  assert.deepEqual(plain(result.gallery[0].edit),{aspectRatio:9/16,fit:'cover',scale:1.3,translateNX:.1,trimStart:2,trimEnd:8,filterAmt:65,filterId:'platinum_golden_hour',adjust:{warm:24}});
  assert.equal(JSON.stringify(result.gallery).includes('private'),false);
});

test('text stories stay text and never promote avatars, links, thumbnails or audio into media', async () => {
  const input = story({
    avatar_url: url('avatars/owner/avatar.jpg'), thumbnail_url: ownPhoto,
    audio_url: url('media/owner/song.mp3'), link_url: 'https://example.test/cover.jpg',
    stickers_json: [
      { kind: 'text', text: 'A quiet afternoon' },
      { kind: 'mention', postAuthorAvatar: url('avatars/friend/avatar.jpg') },
      { kind: 'link', url: 'https://example.test/another.jpg' },
    ],
  });
  const selected = storyPresentationSource(input);
  assert.equal(selected.kind, 'Text'); assert.equal(selected.caption, 'A quiet afternoon');
  assert.equal(selected.references.length, 0);
  const [result] = await resolveStoryPresentations([input], () => { throw Error('Text must not request a media grant'); });
  assert.equal(result.mediaCount, 0); assert.equal(result.gallery.length, 0);
});

test('primary media and inline photo/video assets produce a deduplicated story-authorized gallery', async () => {
  const extraPhoto = url('story-media/owner/extra.jpg'), video = url('story-media/owner/video-object');
  const calls = [];
  const [result] = await resolveStoryPresentations([story({ media_type: 'image', media_url: ownPhoto, thumbnail_url: url('story-media/owner/poster.jpg'),
    stickers_json: [{ kind: 'photo', photoUrl: extraPhoto }, { kind: 'photo', photoUri: extraPhoto }, { kind: 'video', videoUrl: video }],
  })], async (values, kind, ids) => {
    calls.push({ values: [...values], kind, ids: [...ids] });
    return Object.fromEntries(values.map(value => [value, 'signed:' + value]));
  });
  assert.deepEqual(calls, [{ values: [ownPhoto, extraPhoto, video], kind: 'story', ids: [storyId] }]);
  assert.equal(result.kind, 'Video'); assert.equal(result.mediaCount, 3);
  assert.deepEqual(plain(result.gallery.map(item => item.video)), [false, false, true]);
});

test('a text-backed shared-post story uses its post binding, caption and dimensions rather than its author avatar', async () => {
  const calls = [];
  const [result] = await resolveStoryPresentations([story({ stickers_json: [postSticker({ postMediaWidth: 1200, postMediaHeight: 800 })] })], async (values, kind, ids) => {
    calls.push({ values: [...values], kind, ids: [...ids] });
    return { [postPhoto]: 'signed:post-photo' };
  });
  assert.deepEqual(calls, [{ values: [postPhoto], kind: 'post', ids: [postId] }]);
  assert.equal(result.kind, 'Shared post'); assert.equal(result.caption, 'The actual shared post');
  assert.equal(result.mediaCount, 1);
  assert.deepEqual(plain(result.gallery), [{ url: 'signed:post-photo', video: false, width: 1200, height: 800 }]);
});

test('an unauthorized embedded post never inherits a story capability or falls back to its raw URL', async () => {
  const calls = [];
  const [result] = await resolveStoryPresentations([story({ media_type: 'image', media_url: ownPhoto, stickers_json: [postSticker()] })], async (values, kind, ids) => {
    calls.push({ values: [...values], kind, ids: [...ids] });
    return kind === 'story' ? { [ownPhoto]: 'signed:story-photo', [postPhoto]: 'not-a-post-grant' } : {};
  });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.find(call => call.kind === 'post').ids, [postId]);
  assert.deepEqual(plain(result.gallery.map(item => item.url)), ['signed:story-photo']);
  assert.equal(result.kind, 'Shared post');
  assert.equal(JSON.stringify(result.gallery).includes(postPhoto), false);
});

test('post-shaped metadata without a rendered post kind and valid post ID cannot request post grants', async () => {
  const [result] = await resolveStoryPresentations([story({ stickers_json: [
    postSticker({ kind: 'link' }), postSticker({ postId: 'not-an-id' }), postSticker({ kind: undefined }),
  ] })], () => { throw Error('Invalid post reference must not request a grant'); });
  assert.equal(result.kind, 'Text'); assert.equal(result.mediaCount, 0); assert.equal(result.gallery.length, 0);
});

test('video type hints and video URLs are recognized inside shared posts while caption fallbacks remain real content', () => {
  for (const sticker of [postSticker({ postMediaType: 'video', postMediaUrl: url('post-media/owner/opaque') }), postSticker({ postMediaType: null, postMediaUrl: url('post-media/owner/CLIP.MOV?download=1') })]) {
    const selected = storyPresentationSource(story({ caption: 'My own caption', stickers_json: [sticker] }));
    assert.equal(selected.kind, 'Shared post'); assert.equal(selected.references[0].video, true);
    assert.equal(selected.caption, 'My own caption');
  }
  assert.equal(storyPresentationSource(story({ stickers_json: [postSticker({ postText: '', postArticleTitle: 'A published article' })] })).caption, 'A published article');
});
