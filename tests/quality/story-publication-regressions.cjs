// Real native story service + orchestrator, with synthetic React/native/database
// adapters. No device, network, storage service, or user content is accessed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
function load(file, imports, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: (name) => {
    if (!(name in imports)) throw new Error(`Unexpected import ${name}`);
    return imports[name];
  }, console: { log() {}, error() {} }, ...globals }, { filename: file });
  return exports;
}
function draft(id = 'draft-a', extra = {}) {
  return { id, mediaType: 'text', localUri: null, thumbnailUri: null, mediaFit: null, textBgId: null, caption: 'Original', scope: 'global', audience: 'everyone', uploadState: 'idle', mediaTransform: null, category: null, textBackground: null, ...extra };
}
function harness(options = {}) {
  let userId = 'user-a', actorId = 'user-a', drafts = options.drafts ?? [draft()];
  let slot = 0, hook, output;
  const values = [], calls = [], alerts = [], success = [], navigations = [];
  const queues = options.responses ?? {};
  const publication = load('src/utils/publication.ts', {});
  const client = {
    auth: { getSession: async () => ({ data: { session: { user: { id: userId }, access_token: 'synthetic' } }, error: null }) },
    from(table) {
      const builder = {
        insert(row) { calls.push({ table, row }); return builder; },
        select() { return builder; }, single() { return builder; },
        then(resolve, reject) {
          const response = queues[table]?.shift();
          const last = calls.filter((c) => c.table === table).at(-1)?.row;
          const data = table === 'stories' ? { id: `story-${calls.filter((c) => c.table === 'stories').length}`, ...last }
            : table === 'story_polls' ? { id: 'poll-1' } : null;
          return Promise.resolve(response ?? { data, error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
    rpc: async (name, args) => {
      calls.push({ rpc: name, args });
      return { data: name === 'get_story_poll' ? { id: 'poll-1', options: [] } : null, error: null };
    },
  };
  const actors = { authorId: () => actorId };
  const service = load('src/services/storiesService.ts', {
    '../../shared/contentMedia': { canonicalContentMedia: value => value },
    './supabase': { supabase: client }, '../utils/publication': publication, '../stores/actorStore': actors,
    './contentMedia': { hydrateStoryMedia: async rows => rows, hydrateSoundMedia: async rows => rows },
    '../utils/sniffMedia': { resolveTrueMeta: async () => ({ ext: 'jpg', mime: 'image/jpeg', kind: 'image' }) },
    '../utils/uploadSafe': { ensureUploadSafe: async (uri) => ({ uri, ext: 'jpg', mime: 'image/jpeg' }) },
  }, {
    process: { env: { EXPO_PUBLIC_SUPABASE_URL: 'https://example.invalid', EXPO_PUBLIC_SUPABASE_ANON_KEY: 'synthetic' } },
    FormData: class { fields = []; append(...args) { this.fields.push(args); } }, AbortController,
    setTimeout: options.setTimeout ?? (() => 1), clearTimeout: options.clearTimeout ?? (() => {}),
    fetch: async (url, request) => { calls.push({ upload: true, url, request }); return options.upload ? options.upload(url, request) : { ok: true }; },
  });
  const react = {
    useState(initial) { const key = slot++; if (!(key in values)) values[key] = initial; return [values[key], (value) => { values[key] = typeof value === 'function' ? value(values[key]) : value; }]; },
    useRef(initial) { const key = slot++; if (!(key in values)) values[key] = { current: initial }; return values[key]; },
    useEffect() {}, useCallback: (fn) => fn,
  };
  const native = {
    Alert: { alert: (...args) => alerts.push(args) },
    Animated: { timing: () => ({}), parallel: () => ({ start: (done) => done() }) },
  };
  hook = load('src/controllers/stories/usePublishOrchestrator.ts', {
    react, 'react-native': native,
    'expo-haptics': { impactAsync: async () => {}, notificationAsync: async () => {}, ImpactFeedbackStyle: { Medium: 'medium' }, NotificationFeedbackType: { Success: 'success' } },
    'react-native-flash-message': { showMessage: (message) => success.push(message) },
    '../../services/storiesService': service,
    '../../services/supabase': { supabase: client },
    '../../constants/tokens': { duration: { medium: 1 } },
    '../../utils/publication': publication, '../../stores/actorStore': actors,
  }).usePublishOrchestrator;
  const render = () => {
    slot = 0;
    output = hook({ drafts, myId: userId, setDrafts: (update) => { drafts = typeof update === 'function' ? update(drafts) : update; render(); }, navigation: { canGoBack: () => true, goBack: () => navigations.push('back') }, closeBloom() {}, mediaOpacity: {}, mediaScale: {} });
    return output;
  };
  render();
  return {
    calls, alerts, success, navigations, render,
    get drafts() { return drafts; },
    changeDrafts(update) { drafts = update(drafts); render(); },
    setActor(id) { actorId = id; }, setUser(id) { userId = id; render(); },
  };
}
const tableCalls = (h, table) => h.calls.filter((c) => c.table === table);
const poll = { question: 'Question', options: ['One', 'Two'] };

test('native poll child rejection keeps the original story and retries only its missing child', async () => {
  const h = harness({ drafts: [draft('draft-a', { pollData: poll })], responses: { story_poll_options: [{ data: null, error: { code: '42501', message: 'Denied' } }] } });
  await h.render().publishAll();
  assert.equal(h.drafts[0].uploadState, 'error'); assert.equal(h.success.length, 0); assert.equal(h.navigations.length, 0);
  await h.render().publishAll();
  assert.equal(h.drafts[0].uploadState, 'done');
  assert.equal(tableCalls(h, 'stories').length, 1); assert.equal(tableCalls(h, 'story_polls').length, 1); assert.equal(tableCalls(h, 'story_poll_options').length, 2);
  assert.equal(h.success.length, 1);
});
test('native selected-recipient failure does not produce success or insert a new story on retry', async () => {
  const h = harness({ drafts: [draft('draft-a', { audience: 'only_with', sharedWith: ['person-a', 'person-a'] })], responses: { story_shared_with: [{ data: null, error: { code: '42501', message: 'Denied' } }] } });
  await h.render().publishAll(); assert.equal(h.success.length, 0);
  await h.render().publishAll();
  assert.equal(tableCalls(h, 'stories').length, 1); assert.equal(tableCalls(h, 'story_shared_with').length, 2);
  assert.equal(tableCalls(h, 'story_shared_with')[1].row.length, 1);
  assert.equal(tableCalls(h, 'story_shared_with')[1].row[0].story_id, 'story-1');
});
test('native actor changes during an upload prevent the base story insert', async () => {
  const upload = deferred(); const h = harness({ drafts: [draft('draft-a', { mediaType: 'image', localUri: 'file:///synthetic.jpg' })], upload: () => upload.promise });
  const pending = h.render().publishAll(); await flush(); assert.equal(h.calls.some((c) => c.upload), true);
  h.setActor('business-b'); upload.resolve({ ok: true }); await pending;
  assert.equal(tableCalls(h, 'stories').length, 0); assert.equal(h.success.length, 0); assert.equal(h.drafts[0].uploadState, 'error');
});
test('native account changes during an upload prevent the base story insert', async () => {
  const upload = deferred(); const h = harness({ drafts: [draft('draft-a', { mediaType: 'image', localUri: 'file:///synthetic.jpg' })], upload: () => upload.promise });
  const pending = h.render().publishAll(); await flush(); h.setUser('user-b'); upload.resolve({ ok: true }); await pending;
  assert.equal(tableCalls(h, 'stories').length, 0); assert.equal(h.success.length, 0);
});
test('native partial retry rejects changed audience and leaves the original story untouched', async () => {
  const h = harness({ drafts: [draft('draft-a', { pollData: poll })], responses: { story_poll_options: [{ data: null, error: { code: '42501', message: 'Denied' } }] } });
  await h.render().publishAll();
  h.changeDrafts((rows) => rows.map((d) => ({ ...d, audience: 'only_with', sharedWith: ['person-a'] })));
  await h.render().publishAll();
  assert.equal(h.success.length, 0); assert.equal(tableCalls(h, 'stories').length, 1); assert.equal(tableCalls(h, 'story_poll_options').length, 1);
  assert.match(h.drafts[0].errorMsg, /draft changed/i);
});
test('native draft reorder during upload updates the original draft by id', async () => {
  const upload = deferred(); const h = harness({ drafts: [draft('draft-a', { mediaType: 'image', localUri: 'file:///synthetic.jpg' }), draft('draft-b', { uploadState: 'done' })], upload: () => upload.promise });
  const pending = h.render().publishAll(); await flush(); h.changeDrafts((rows) => [...rows].reverse()); upload.resolve({ ok: true }); await pending;
  assert.equal(h.drafts.find((d) => d.id === 'draft-a').uploadState, 'done');
  assert.equal(tableCalls(h, 'stories').length, 1);
});
test('native lost insert response locks replay and keeps the draft visible', async () => {
  const h = harness({ responses: { stories: [{ data: null, error: { message: 'Failed to fetch' } }] } });
  await h.render().publishAll(); assert.equal(h.render().canPublish, false); await h.render().publishAll();
  assert.equal(tableCalls(h, 'stories').length, 1); assert.equal(h.success.length, 0); assert.equal(h.drafts[0].uploadState, 'error');
});
test('native same-tick duplicate publish calls perform one insert', async () => {
  const h = harness(); const submit = h.render().publishAll;
  await Promise.all([submit(), submit()]); assert.equal(tableCalls(h, 'stories').length, 1); assert.equal(h.success.length, 1);
});
test('native mention rejection remains a failure until the same story is completed', async () => {
  const h = harness({ drafts: [draft('draft-a', { hiddenMentions: [{ id: 'person-a', username: 'synthetic' }] })], responses: { story_mentions: [{ data: null, error: { code: '42501', message: 'Denied' } }] } });
  await h.render().publishAll(); assert.equal(h.success.length, 0);
  await h.render().publishAll(); assert.equal(tableCalls(h, 'stories').length, 1); assert.equal(tableCalls(h, 'story_mentions').length, 2); assert.equal(h.success.length, 1);
});

test('native voiceover publication requires rights attestation before any upload', async () => {
  const h = harness({ drafts: [draft('draft-a', { audio: { kind: 'voiceover', localUri: 'file:///voice.m4a', durationSec: 5 } })] });
  await h.render().publishAll();
  assert.equal(h.success.length, 0); assert.equal(tableCalls(h, 'stories').length, 0);
  assert.equal(h.calls.filter(call => call.upload).length, 0);
});
for (const [role, extra] of [
  ['photo_sticker', { stickers: [{ id: 'photo', kind: 'photo', photoUri: 'file:///sticker.jpg' }] }],
  ['front_photo', { dualFrontUri: 'file:///front.jpg' }],
  ['voiceover', { audio: { kind: 'voiceover', localUri: 'file:///voice.m4a', durationSec: 5, rightsAttested: true } }],
]) {
  test(`native failed ${role} keeps the draft and retry reuses the confirmed main upload`, async () => {
    let rejectAsset = true;
    const h = harness({ drafts: [draft('draft-a', { mediaType: 'image', localUri: 'file:///main.jpg', ...extra })], upload: async (url) => {
      if (url.includes(`_${role}.`) && rejectAsset) return { ok: false, status: 503 };
      return { ok: true };
    }});
    await h.render().publishAll();
    assert.equal(h.success.length, 0); assert.equal(tableCalls(h, 'stories').length, 0);
    assert.equal(h.drafts[0].uploadState, 'error');
    rejectAsset = false;
    await h.render().publishAll();
    assert.equal(h.success.length, 1); assert.equal(tableCalls(h, 'stories').length, 1);
    assert.equal(h.calls.filter(c => c.url?.includes('_media.')).length, 1);
    const row = tableCalls(h, 'stories')[0].row;
    if (role === 'photo_sticker') {
      assert.match(row.stickers_json[0].photoUrl, /^https:/);
      assert.equal(row.stickers_json[0].photoUri, undefined);
      assert.equal(h.drafts[0].stickers[0].photoUri, 'file:///sticker.jpg');
    }
    if (role === 'front_photo') assert.match(row.dual_front_url, /^https:/);
    if (role === 'voiceover') assert.match(row.audio_url, /^https:/);
  });
}
test('native asset uploads are bounded to three, deduplicated, and all finish before story insert', async () => {
  let active = 0, peak = 0;
  const gates = [];
  const stickers = Array.from({ length: 5 }, (_, i) => ({ id: `sticker-${i}`, kind: 'photo', photoUri: `file:///sticker-${i < 2 ? 0 : i}.jpg` }));
  const h = harness({ drafts: [draft('draft-a', { stickers })], upload: async () => {
    active++; peak = Math.max(peak, active);
    const gate = deferred(); gates.push(gate); await gate.promise; active--; return { ok: true };
  }});
  const sharing = h.render().publishAll(); await flush();
  assert.ok(active > 1 && active <= 3); assert.equal(tableCalls(h, 'stories').length, 0);
  for (let round = 0; round < 5; round++) { gates.forEach(g => g.resolve()); await flush(); }
  await sharing;
  assert.ok(peak <= 3); assert.equal(h.calls.filter(c => c.upload).length, 4);
  assert.equal(h.success.length, 1); assert.equal(tableCalls(h, 'stories')[0].row.stickers_json.length, 5);
});
test('native failed upload always clears its abort timer', async () => {
  let cleared = 0;
  const h = harness({ drafts: [draft('draft-a', { mediaType: 'image', localUri: 'file:///main.jpg' })], upload: async () => { throw new Error('Offline'); }, clearTimeout: () => { cleared++; } });
  await h.render().publishAll(); assert.equal(cleared, 1); assert.equal(tableCalls(h, 'stories').length, 0);
});
test('simultaneous sticker transforms merge against the current draft after reorder', () => {
  const { updateDraftStickers } = load('src/controllers/stories/stickerDraftUpdates.ts', {});
  let drafts = [draft('other', { stickers: [] }), draft('original', { stickers: [{ id: 'sticker', nx: 0.5, ny: 0.5, scale: 1, rotation: 0 }] })];
  for (const patch of [{ nx: 0.7, ny: 0.6 }, { scale: 1.8 }, { rotation: 1.2 }]) {
    drafts = updateDraftStickers(drafts, 'original', current => current.map(sticker => ({ ...sticker, ...patch })));
  }
  assert.equal(drafts[1].stickers[0].nx, 0.7); assert.equal(drafts[1].stickers[0].scale, 1.8); assert.equal(drafts[1].stickers[0].rotation, 1.2);
  assert.equal(drafts[0].stickers.length, 0);
  drafts[1].uploadState = 'uploading';
  const locked = updateDraftStickers(drafts, 'original', []);
  assert.equal(locked[1], drafts[1]);
});
