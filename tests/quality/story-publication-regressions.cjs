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
const originalSound = { id: 'verified-original', title: 'Voiceover', source: 'original', duration_sec: 12, max_excerpt_sec: 30 };
const originalUrl = 'https://example.invalid/storage/v1/object/public/music-audio/user-a/verified-original.m4a';
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
  const soundtrackPicker = load('shared/soundtrackPicker.ts', {}, { setTimeout, clearTimeout });
  const originalAvailability = load('shared/originalAudioAvailability.ts', { './soundtrackPicker': soundtrackPicker });
  const client = {
    auth: { getSession: async () => ({ data: { session: { user: { id: userId }, access_token: 'synthetic' } }, error: null }) },
    from(table) {
      const builder = {
        insert(row) { calls.push({ table, row }); return builder; },
        select() { return builder; }, in() { return builder; }, single() { return builder; },
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
      if (name === 'get_original_audio_capabilities') return options.capabilities ?? { data: { version: 1, uploadsEnabled: true }, error: null };
      if (options.rpc) return options.rpc(name, args);
      return { data: name === 'get_story_poll' ? { id: 'poll-1', options: [] } : name === 'get_playable_sound' ? [{ ...originalSound, id: args.p_sound_id, url: originalUrl }] : null, error: null };
    },
  };
  const actors = { authorId: () => actorId };
  const service = load('src/services/storiesService.ts', {
    '../../shared/musicAvailability': load('shared/musicAvailability.ts', {}),
    '../../shared/originalAudioAvailability': originalAvailability,
    '../../shared/soundtrackPicker': soundtrackPicker,
    '../../shared/contentMedia': { canonicalContentMedia: value => value },
    './supabase': { supabase: client }, '../utils/publication': publication, '../stores/actorStore': actors,
    './contentMedia': { hydrateStoryMedia: async rows => rows, hydrateSoundMedia: async rows => rows },
    './originalAudioService': { addOriginalAudio: async (uri, owner, audioOptions) => {
      calls.push({ originalUpload: true, uri, owner, options: audioOptions });
      return options.originalAudio ? options.originalAudio(uri, owner, audioOptions) : originalSound;
    } },
    '../utils/sniffMedia': { resolveTrueMeta: async () => ({ ext: 'jpg', mime: 'image/jpeg', kind: 'image' }) },
    '../utils/uploadSafe': { ensureUploadSafe: async (uri) => ({ uri, ext: 'jpg', mime: 'image/jpeg' }) },
  }, {
    process: { env: { EXPO_PUBLIC_SUPABASE_URL: 'https://example.invalid', EXPO_PUBLIC_SUPABASE_ANON_KEY: 'synthetic' } },
    FormData: class { fields = []; append(...args) { this.fields.push(args); } }, AbortController,
    setTimeout: options.setTimeout ?? (() => 1), clearTimeout: options.clearTimeout ?? (() => {}),
    fetch: async (url, request) => { calls.push({ upload: true, url, request }); return options.upload ? options.upload(url, request) : { ok: true }; },
  });
  const react = {
    useState(initial) { const key = slot++; if (!(key in values)) values[key] = typeof initial === 'function' ? initial() : initial; return [values[key], (value) => { values[key] = typeof value === 'function' ? value(values[key]) : value; }]; },
    useRef(initial) { const key = slot++; if (!(key in values)) values[key] = { current: initial }; return values[key]; },
    useEffect() {}, useCallback: (fn) => fn,
  };
  const native = {
    Alert: { alert: (...args) => alerts.push(args) },
    Animated: { timing: () => ({}), parallel: () => ({ start: (done) => done() }) },
  };
  hook = load('src/controllers/stories/usePublishOrchestrator.ts', {
    '../../../shared/storyMentions': load('shared/storyMentions.ts', {}),
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
    output = hook({ onPublished: options.onPublished, drafts, myId: userId, setDrafts: (update) => { drafts = typeof update === 'function' ? update(drafts) : update; render(); }, navigation: { canGoBack: () => true, goBack: () => navigations.push('back') }, closeBloom() {}, mediaOpacity: {}, mediaScale: {} });
    return output;
  };
  render();
  return {
    calls, alerts, success, navigations, render, service: service.storiesService,
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
  assert.equal(h.calls.filter(call => call.originalUpload).length, 0);
});
for (const [role, extra] of [
  ['photo_sticker', { stickers: [{ id: 'photo', kind: 'photo', photoUri: 'file:///sticker.jpg' }] }],
  ['front_photo', { dualFrontUri: 'file:///front.jpg' }],
  ['voiceover', { audio: { kind: 'voiceover', localUri: 'file:///voice.m4a', durationSec: 5, rightsAttested: true } }],
]) {
  test(`native failed ${role} keeps the draft and retry reuses the confirmed main upload`, async () => {
    let rejectAsset = true;
    const h = harness({ drafts: [draft('draft-a', { mediaType: 'image', localUri: 'file:///main.jpg', ...extra })], originalAudio: async () => {
      if (role === 'voiceover' && rejectAsset) throw new Error('Verified audio upload temporarily unavailable');
      return originalSound;
    }, upload: async (url) => {
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

test('book picker receives only confirmed publication IDs and does not navigate away first', async () => {
  const confirmed=[];
  const h=harness({onPublished: ids=>confirmed.push(Array.from(ids))});
  await h.render().publishAll();
  assert.equal(confirmed.length,1);assert.equal(confirmed[0][0],tableCalls(h,'stories')[0] && 'story-1');
  assert.equal(h.navigations.length,0);
});
test('typed story mentions exclude deleted handles and do not mistake email addresses for tags', () => {
  const {storyHandles,currentTextMentions,storyMentionIds}=load('shared/storyMentions.ts',{});
  assert.deepEqual(Array.from(storyHandles('mail@musa.test Hi @Musa, and @amy!')),['musa','amy']);
  const sticker={kind:'text',text:'Hello @amy',mentions:[{id:'a',username:'amy'},{id:'m',username:'musa'}]};
  assert.deepEqual(Array.from(currentTextMentions(sticker)).map(x=>x.id),['a']);
  assert.deepEqual(Array.from(storyMentionIds([sticker,{kind:'mention',mentionUserId:'a'},{kind:'mention',mentionUserId:'b'}])),['a','b']);
});
test('native whole-surface hold ends only its own pause and clears cancelled timers', () => {
  const source=fs.readFileSync(path.join(root,'src/screens/stories/StoryViewerScreen.tsx'),'utf8');
  const start=source.indexOf('  const surfaceHold = useRef');const end=source.indexOf('  const panResponder',start);
  const exported={};const timers=new Map();let next=0;const reasons=new Set(['reply']);
  const js=ts.transpileModule(source.slice(start,end)+'\nObject.assign(exported,{beginSurfaceHold,endSurfaceHold});',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(js,{exported,useRef:v=>({current:v}),useCallback:f=>f,useEffect(){},LONG_PRESS_MS:160,pauseFor:r=>reasons.add(r),resumeFrom:r=>reasons.delete(r),setTimeout:f=>{timers.set(++next,f);return next;},clearTimeout:id=>timers.delete(id)});
  exported.beginSurfaceHold({nativeEvent:{touches:[{}],pageX:10,pageY:10}});for(const fn of timers.values())fn();
  assert.deepEqual([...reasons],['reply','surfaceHold']);exported.endSurfaceHold();assert.deepEqual([...reasons],['reply']);
  timers.clear();exported.beginSurfaceHold({nativeEvent:{touches:[{}],pageX:10,pageY:10}});exported.endSurfaceHold();assert.equal(timers.size,0);
});

test('publishing resolves newly typed handles before saving even when editor lookup has not returned', async () => {
  const h=harness({drafts:[draft('a',{stickers:[{id:'text',kind:'text',text:'Hello @musa',mentions:[]} ]})],responses:{profiles:[{data:[{id:'m',username:'musa'}],error:null}]}});
  await h.render().publishAll();
  assert.equal(tableCalls(h,'stories')[0].row.stickers_json[0].mentions[0].id,'m');
  assert.equal(tableCalls(h,'story_mentions')[0].row[0].mentioned_user_id,'m');
});
test('mention lookup failure creates no partial story and remains retryable', async () => {
  const h=harness({drafts:[draft('a',{caption:'Hello @musa'})],responses:{profiles:[{data:null,error:{message:'offline'}}]}});
  await h.render().publishAll();assert.equal(tableCalls(h,'stories').length,0);assert.equal(h.drafts[0].uploadState,'error');
});

test('native reply controls are stored in the original story insert for each clip and default to allowed', async () => {
  const h = harness({ drafts: [draft('off', { allowReplies: false }), draft('default')] });
  await h.render().publishAll();
  const inserts = tableCalls(h, 'stories'); assert.equal(inserts.length,2); assert.equal(inserts[0].row.allow_replies,false); assert.equal(inserts[1].row.allow_replies,true);
});


test('shipping native publisher attaches verified originals with their excerpt and video mix while catalogue licensing is disabled', async () => {
  const availability = load('shared/musicAvailability.ts', {});
  assert.equal(availability.MUSIC_CATALOG_ENABLED, false);
  assert.equal(availability.ORIGINAL_AUDIO_ENABLED, true);
  for (const audio of [{ kind: 'sound', soundId: 'original-library-sound', startSec: 3, durationSec: 6 }, { kind: 'voiceover', localUri: 'file:original-audio.m4a', rightsAttested: true, addToSounds: true, durationSec: 10 }]) {
    const h = harness({ drafts: [draft('retained', { mediaType: 'video', localUri: 'file:video.mp4', audio, mediaTransform: { scale: 1, translateNX: 0, translateNY: 0, fit: 'contain', trimStart: 2, trimEnd: 8, mix: { orig: 65, music: 45 } } })] });
    await h.render().publishAll();
    const written = tableCalls(h, 'stories')[0]?.row;
    assert.ok(written); assert.equal(written.audio_url, originalUrl); assert.equal(written.audio_source, 'original');
    assert.equal(written.media_transform.mix.orig, 65); assert.equal(written.media_transform.mix.music, 45); assert.equal(written.media_transform.trimStart, 2);
    assert.equal(written.media_transform.audioStartSec, audio.startSec || 0);
    assert.equal(h.calls.filter(c => c.upload).length, 1);
    const resolution = h.calls.find(c => c.rpc === 'get_playable_sound');
    assert.equal(resolution.args.p_use, 'story'); assert.equal(resolution.args.p_sound_id, audio.soundId || originalSound.id);
    assert.equal(tableCalls(h, 'story_sounds').length, 0, 'the verified library service owns sound creation');
    const upload = h.calls.find(c => c.originalUpload);
    if (audio.kind === 'voiceover') {
      assert.equal(upload.owner, 'user-a'); assert.equal(upload.uri, audio.localUri);
      assert.equal(upload.options.rightsAttested, true); assert.equal(upload.options.reuseAllowed, true); assert.equal(upload.options.use, 'story');
    } else assert.equal(upload, undefined);
  }
});

test('native verified audio denial preserves the draft and never inserts a story with an unapproved sound', async () => {
  for (const audio of [
    { kind: 'sound', soundId: 'revoked-sound', startSec: 2, durationSec: 4 },
    { kind: 'voiceover', localUri: 'file:///owned.m4a', rightsAttested: true, durationSec: 5 },
  ]) {
    const h = harness({ drafts: [draft('denied-audio', { audio })], rpc: async name => ({ data: null, error: name === 'get_playable_sound' ? { code: '42501', message: 'Sound access denied' } : null }) });
    await h.render().publishAll();
    assert.equal(tableCalls(h, 'stories').length, 0);
    assert.equal(h.success.length, 0);
    assert.equal(h.drafts[0].uploadState, 'error');
    assert.equal(h.drafts[0].audio, audio);
  }
});

test('native audio publication and reads fail closed when the server capability is absent', async () => {
  const audio = { kind: 'sound', soundId: 'legacy-sound', startSec: 0, durationSec: 4 };
  const h = harness({ drafts: [draft('unready-audio', { audio })], capabilities: { data: null, error: { code: 'PGRST202', message: 'Could not find function' } } });
  await h.render().publishAll();
  assert.equal(tableCalls(h, 'stories').length, 0);
  assert.equal(h.calls.some(call => call.rpc === 'get_playable_sound' || call.originalUpload), false);
  assert.equal(h.drafts[0].uploadState, 'error'); assert.equal(h.drafts[0].audio, audio);
  assert.equal((await h.service.listStorySounds('original')).length, 0);
  await assert.rejects(h.service.getStorySound('legacy-sound'), /not available/);
  assert.equal(h.calls.some(call => call.rpc === 'get_playable_sound' || call.rpc === 'list_playable_sounds'), false);
});

test('native audio readers and publication reject catalogue and unverified legacy sources', async () => {
  for (const source of ['library', 'licensed', null]) {
    const legacy = { ...originalSound, source, url: originalUrl };
    const h = harness({ drafts: [draft('legacy-audio', { audio: { kind: 'sound', soundId: legacy.id, startSec: 0, durationSec: 4 } })], rpc: async () => ({ data: [legacy], error: null }) });
    assert.equal((await h.service.listStorySounds('original')).length, 0);
    assert.equal((await h.service.listStorySounds('library')).length, 0);
    await assert.rejects(h.service.getStorySound(legacy.id), /no longer available/);
    await h.render().publishAll();
    assert.equal(tableCalls(h, 'stories').length, 0);
    assert.equal(h.drafts[0].uploadState, 'error');
  }
});

test('native story audio keeps full track duration so later excerpts remain selectable', async () => {
  const sound = { ...originalSound, duration_sec: 180, max_excerpt_sec: 25, url: originalUrl };
  const h = harness({ rpc: async () => ({ data: [sound], error: null }) });
  const selected = await h.service.getStorySound(sound.id);
  assert.equal(selected.duration_sec, 180);
  assert.equal(selected.max_excerpt_sec, 25);
  const listed = await h.service.listStorySounds('original');
  assert.equal(listed[0].duration_sec, 180);
  assert.equal(listed[0].max_excerpt_sec, 25);
});

test('native story catalogue reads and publication require the explicit v2 server gate', async () => {
  const sound = { ...originalSound, source: 'library', url: originalUrl };
  const capabilities = { data: { version: 2, uploadsEnabled: false, catalogEnabled: true }, error: null };
  const audio = { kind: 'sound', soundId: sound.id, startSec: 0, durationSec: 4 };
  const h = harness({ capabilities, drafts: [draft('catalogue-audio', { audio })], rpc: async () => ({ data: [sound], error: null }) });
  assert.equal((await h.service.listStorySounds('library')).length, 1);
  assert.equal((await h.service.getStorySound(sound.id)).source, 'library');
  await h.render().publishAll();
  assert.equal(tableCalls(h, 'stories').length, 1);
  capabilities.data.catalogEnabled = false;
  assert.equal((await h.service.listStorySounds('library')).length, 0);
  await assert.rejects(h.service.getStorySound(sound.id), /no longer available/);
});

test('native account changes while verified original audio finishes prevent story publication', async () => {
  const audio = deferred();
  const h = harness({ drafts: [draft('pending-audio', { audio: { kind: 'voiceover', localUri: 'file:///owned.m4a', rightsAttested: true, durationSec: 5 } })], originalAudio: () => audio.promise });
  const publishing = h.render().publishAll(); await flush();
  assert.equal(h.calls.filter(call => call.originalUpload).length, 1);
  h.setUser('user-b'); audio.resolve(originalSound); await publishing;
  assert.equal(tableCalls(h, 'stories').length, 0); assert.equal(h.success.length, 0);
});


test('native Add yours joins only after a confirmed new story and retries the same saved story', async () => {
  let attempts = 0;
  const prompt = { id: 'joined-prompt', kind: 'addyours', text: 'Your view', nx: .5, ny: .3, addYoursOriginStoryId: 'origin-story', addYoursOriginStickerId: 'origin-prompt' };
  const h = harness({ drafts: [draft('join-draft', { stickers: [prompt] })], rpc: async (name, args) => {
    if (name === 'submit_sticker_response') return ++attempts === 1 ? { data: null, error: { code: '42501', message: 'Temporarily unavailable' } } : { data: { id: 'answer', text_value: args.p_text_value }, error: null };
    return { data: null, error: null };
  } });
  assert.equal(h.calls.length, 0);
  await h.render().publishAll();
  assert.equal(tableCalls(h, 'stories').length, 1); assert.equal(h.drafts[0].uploadState, 'error'); assert.equal(h.success.length, 0);
  assert.match(h.drafts[0].errorMsg, /story was saved.*Add yours/);
  const joined = h.calls.find(c => c.rpc === 'submit_sticker_response');
  assert.equal(joined.args.p_text_value, 'story-1'); assert.equal(joined.args.p_response_type, 'addyours');
  assert.ok(h.calls.indexOf(joined) > h.calls.findIndex(c => c.table === 'stories'));
  await h.render().publishAll();
  assert.equal(tableCalls(h, 'stories').length, 1); assert.equal(attempts, 2); assert.equal(h.drafts[0].uploadState, 'done');
});

test('native story speed persists even when it is the only non-default media edit', async () => {
  const h = harness({ drafts: [draft('speed-only', { mediaType: 'video', localUri: 'file:///video.mp4', mediaTransform: { scale: 1, translateNX: 0, translateNY: 0, fit: 'cover', speed: 1.5 } })] });
  await h.render().publishAll();
  assert.equal(tableCalls(h, 'stories')[0].row.media_transform.speed, 1.5);
});
