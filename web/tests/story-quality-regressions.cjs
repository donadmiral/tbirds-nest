const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');
const viewer = fs.readFileSync(path.join(__dirname, '../components/StoryViewer.tsx'), 'utf8');
const composer = fs.readFileSync(path.join(__dirname, '../components/StoryComposer.tsx'), 'utf8');
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const defer = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { resolve, promise }; };
function execute(source, globals) {
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(js, globals);
}
function effect(source, marker, end) {
  const location = source.indexOf(marker), start = source.lastIndexOf('  useEffect(() => {', location);
  const finish = source.indexOf(end, location) + end.length;
  assert.ok(start >= 0 && finish > start, marker);
  return source.slice(start, finish);
}
test('viewer arrow keys edit replies and only navigate outside editing controls', () => {
  const handlers = {}; let advance = 0, back = 0, close = 0, prevented = 0;
  execute(effect(viewer, '    function onKey(e: KeyboardEvent)', '  }, [advance, back, onClose]);'), {
    useEffect: fn => fn(), window: { addEventListener: (type, fn) => handlers[type] = fn },
    advance: () => advance++, back: () => back++, onClose: () => close++,
  });
  for (const key of ['ArrowLeft', 'ArrowRight', 'Escape']) handlers.keydown({ key, target: { closest: () => ({}) }, preventDefault: () => prevented++ });
  assert.deepEqual([advance, back, close, prevented], [0, 0, 0, 0]);
  handlers.keydown({ key: 'ArrowRight', target: { closest: () => null }, preventDefault: () => prevented++ });
  assert.equal(advance, 1); assert.equal(prevented, 1);
});
function playback(mediaType = 'image') {
  let tick, now = 0, progress = 0, advances = 0;
  const ready = { current: null };
  const player = { currentTime: 0, paused: true, ended: false };
  const globals = {
    document: { hidden: false }, callActive: () => false, playbackPausedRef: { current: false }, inputFocusedRef: { current: false }, overlayPausedRef: { current: false }, pauseNow() {},
    useEffect: fn => fn(), story: { id: 'story-1', media_type: mediaType, media_url: 'synthetic', duration_sec: 5 }, uid: 'viewer',
    setProgress: p => progress = p, stopTimer() {}, setMuted() {}, setClock() {},
    videoRef: { current: mediaType === 'video' ? player : null }, audioRef: { current: null },
    readyStoryRef: ready, durRef: { current: 0 }, startedAt: { current: 0 }, timerRef: { current: null },
    IMAGE_DURATION_MS: 5000, MAX_AUDIO_MS: 30000, Date: { now: () => now }, setInterval: fn => { tick = fn; return 1; }, advance: () => advances++,
  };
  execute(effect(viewer, '    const mtx = (story.media_transform', '  }, [story, advance, stopTimer]);'), globals);
  return { globals, ready, player, tick: time => { now = time; tick(); }, progress: () => progress, advances: () => advances };
}
test('loading time does not consume an image story duration', () => {
  const h = playback(); h.tick(20000); assert.equal(h.advances(), 0); assert.equal(h.progress(), 0);
  h.ready.current = 'story-1'; h.tick(22500); assert.equal(h.progress(), 0.5); assert.equal(h.advances(), 0);
  h.tick(25000); assert.equal(h.advances(), 1);
});
test('buffering or paused video follows its media clock rather than wall time', () => {
  const h = playback('video'); h.ready.current = 'story-1'; h.tick(30000); assert.equal(h.advances(), 0);
  h.player.currentTime = 2; h.tick(35000); assert.equal(h.progress(), 0.4);
});
test('resuming a paused video does not fall back to wall time or leak another timer', () => {
  const h = playback('video'); h.ready.current = 'story-1'; let tick, stopped = 0;
  const start = viewer.indexOf('  const resumeNow = useCallback('), end = viewer.indexOf('  const togglePlayback', start);
  execute(viewer.slice(start, end) + '\nresumeNow();', { ...h.globals,
    inputFocusedRef: { current: false }, overlayPausedRef: { current: false }, callActive: () => false,
    useCallback: fn => fn, playbackPausedRef: { current: true }, manualPauseRef: { current: false }, document: { hidden: false }, setPlaybackPaused() {}, heldRef: { current: true }, pausedAtRef: { current: 0.2 }, resumeDelayRef: { current: null },
    stopTimer: () => stopped++, setInterval: fn => { tick = fn; return 1; }, setTimeout: () => 1, clearTimeout() {},
    videoRef: { current: { ...h.player, play: async () => {} } },
  });
  tick(); assert.equal(stopped, 1); assert.equal(h.advances(), 0);
});
test('story recipient search ignores older results and clears results when empty', async () => {
  const pending = defer(); let results = [], cleanup, timer;
  const code = effect(composer, '    if (!q.trim() || !uid) return;', '  }, [q, uid]);');
  const base = { uid: 'viewer', ownerVersion: { current: 0 }, isCurrent: () => true, runBounded: value => value, useEffect: fn => cleanup = fn(), setResults: rows => results = rows, setError() {}, setTimeout: fn => { timer = fn; return 1; }, clearTimeout() {}, searchPeople: () => pending.promise };
  execute(code, { ...base, q: 'old query' }); timer(); cleanup();
  execute(code, { ...base, q: '' }); pending.resolve([{ id: 'old-person' }]); await flush();
  assert.equal(results.length, 0);
});
test('failed story recipient search is handled with a recoverable message', async () => {
  let message, timer;
  execute(effect(composer, '    if (!q.trim() || !uid) return;', '  }, [q, uid]);'), { uid: 'viewer', ownerVersion: { current: 0 }, isCurrent: () => true, runBounded: value => value, useEffect: fn => fn(), q: 'query', setResults() {}, setError: text => message = text, setTimeout: fn => { timer = fn; return 1; }, searchPeople: async () => { throw new Error('offline'); } });
  timer(); await flush(); assert.match(message, /Try searching again/);
});
function replyHarness({ messageError, changedSession = false } = {}) {
  let sendReply, messages = 0, text = 'My reply', error, resumed = 0, checks = 0;
  const globals = {
    inputFocusedRef: { current: false }, overlayPausedRef: { current: false },
    useCallback: fn => { sendReply = fn; return fn; }, story: { id: 'story-1', user_id: 'owner' }, uid: 'viewer', canReply: true,
    replyText: text, sendingReply: false, sendingReplyRef: { current: false }, currentStoryRef: { current: 'story-1' },
    setSendingReply() {}, setActionError: value => error = value, setReplyText: value => text = value, setReplyToast() {}, setTimeout: () => 1,
    resumeNow: () => resumed++, createClient: () => ({
      auth: { getSession: async () => ({ data: { session: { user: { id: changedSession && ++checks > 1 ? 'other-viewer' : 'viewer' } } } }) },
      from(table) {
        const builder = { select() { return builder; }, or() { return builder; }, eq() { return builder; }, maybeSingle() { return builder; }, single() { return builder; }, update() { return builder; }, insert() { if (table === 'messages') messages++; return builder; },
          then(ok, bad) { return Promise.resolve({ data: table === 'conversations' ? { id: 'conversation-1' } : null, error: table === 'messages' ? messageError : null }).then(ok, bad); } };
        return builder;
      },
    }),
  };
  const start = viewer.indexOf('  const sendReply = useCallback('), end = viewer.indexOf('\n  useEffect(() => {', start);
  execute(viewer.slice(start, end), globals);
  return { send: () => sendReply(), messages: () => messages, text: () => text, error: () => error, resumed: () => resumed };
}
test('story replies reject duplicate same-tick sends', async () => {
  const h = replyHarness(); await Promise.all([h.send(), h.send()]);
  assert.equal(h.messages(), 1); assert.equal(h.text(), ''); assert.equal(h.resumed(), 1);
});
test('failed story reply stays visible and does not claim it was sent', async () => {
  const h = replyHarness({ messageError: { message: 'Offline' } }); await h.send();
  assert.equal(h.text(), 'My reply'); assert.match(h.error(), /could not be confirmed/); assert.equal(h.resumed(), 0);
});
test('account switching before the reply insert prevents sending from the wrong account', async () => {
  const h = replyHarness({ changedSession: true }); await h.send();
  assert.equal(h.messages(), 0); assert.equal(h.text(), 'My reply');
});

function reactionHarness({ session = 'viewer', fail = false } = {}) {
  const pending = defer(); let react, reactions = new Set(), calls = 0, error;
  const currentStoryRef = { current: 'story-a' };
  const globals = {
    useCallback: fn => { react = fn; return fn; }, story: { id: 'story-a' }, uid: 'viewer', canReact: true,
    myReactions: new Set(), reactionRequests: { current: new Set() }, reactionVersion: { current: 0 }, currentStoryRef,
    setMyReactions: value => { reactions = typeof value === 'function' ? value(reactions) : value; },
    setHeartBurst() {}, setTimeout: () => 1, REACTION_EMOJIS: ['heart'], setActionError: value => error = value,
    createClient: () => ({ auth: { getSession: async () => ({ data: { session: { user: { id: session } } } }) } }),
    toggleStoryReaction: async () => { calls++; if (fail) throw new Error('offline'); return pending.promise; },
  };
  const start = viewer.indexOf('  const react = useCallback('), end = viewer.indexOf('\n  const sendReply =', start);
  execute(viewer.slice(start, end), globals);
  return { send: emoji => react(emoji), pending, currentStoryRef, calls: () => calls, reactions: () => [...reactions], error: () => error,
    switchStory(id) { currentStoryRef.current = id; reactions = new Set(['new-story-reaction']); } };
}
test('a repeated reaction tap sends only one toggle until its result arrives', async () => {
  const h = reactionHarness(); const first = h.send('heart'); const duplicate = h.send('heart');
  await flush(); assert.equal(h.calls(), 1);
  h.pending.resolve({ reacted: true }); await Promise.all([first, duplicate]);
  assert.deepEqual(h.reactions(), ['heart']);
});
test('a late reaction response cannot replace the next story reaction state', async () => {
  const h = reactionHarness(); const first = h.send('heart'); await flush();
  h.switchStory('story-b'); h.pending.resolve({ reacted: true }); await first;
  assert.deepEqual(h.reactions(), ['new-story-reaction']);
});
test('parallel different emoji responses preserve both reactions', async () => {
  const h = reactionHarness(); const first = h.send('heart'); const second = h.send('smile'); await flush();
  h.pending.resolve({ reacted: true }); await Promise.all([first, second]);
  assert.deepEqual(h.reactions().sort(), ['heart', 'smile']);
});
test('a rejected reaction restores state and surfaces its failure', async () => {
  const h = reactionHarness({ fail: true }); await h.send('heart');
  assert.deepEqual(h.reactions(), []); assert.match(h.error(), /could not be confirmed/);
});
test('an account change prevents a story reaction write', async () => {
  const h = reactionHarness({ session: 'another-viewer' }); await h.send('heart');
  assert.equal(h.calls(), 0); assert.deepEqual(h.reactions(), []);
});
test('Back on the first story does not stop its playback timer', () => {
  let stopped = 0, changed = false;
  const start = viewer.indexOf('  const back = useCallback('), end = viewer.indexOf('\n  const pauseNow', start);
  execute(viewer.slice(start, end) + '\nback();', { useCallback: fn => fn, itemIdx: 0, userIdx: 0,
    stopTimer: () => stopped++, setItemIdx: () => changed = true, setUserIdx: () => changed = true });
  assert.equal(stopped, 0); assert.equal(changed, false);
});
test('advancing a story clears its private reply and viewer sheet', () => {
  let reply = 'Reply intended for A', sheet = true, toast = true;
  execute(effect(viewer, '    readyStoryRef.current = null;', '  }, [story?.id]);'), {
    useEffect: fn => fn(), playbackPausedRef: { current: true }, manualPauseRef: { current: true }, holdPausedRef: { current: true }, holdConsumedClickRef: { current: false }, setPlaybackPaused() {}, story: { id: 'story-b' }, readyStoryRef: { current: 'story-a' }, heldRef: { current: true },
    holdRef: { current: null }, resumeDelayRef: { current: null }, setLoadedStoryId() {}, setFailedStoryId() {}, setActionError() {},
    setReplyText: value => reply = value, setReplyToast: value => toast = value, setViewersOpen: value => sheet = value, setMoreOpen() {}, setMemoryOpen() {}, setHeartBurst() {},
  });
  assert.equal(reply, ''); assert.equal(sheet, false); assert.equal(toast, false);
});

function draftHarness(rows) {
  let people = [{ id: 'old' }], error = null, busy = null;
  const request = { current: 0 }, lock = { current: false };
  const start = composer.indexOf('  async function applyDraft('), end = composer.indexOf('\n  async function pickFile', start);
  const globals = {
    uid: 'viewer', ownerVersion: { current: 0 }, isCurrent: () => true, assertOwner() {}, runBounded: value => value, busyRef: lock, publication: { current: null }, draftRequest: request,
    setBusy: value => busy = value, setError: value => error = value, setPeople: value => people = value,
    hydrateStoryDraftMedia: async rows => rows, replacePreview() {}, setAudioDraft() {},
    setClips() {}, setActiveClipId() {}, setAllowReplies() {}, setComposeStep() {}, setStickers() {}, setTransform() {}, setBackground() {}, setEditorKey() {}, setFilterId() {}, setDraftId() {}, setMediaUrl() {}, setMediaType() {}, setDurationSec() {}, setCaption() {}, setAudience() {},
    publicationError: failure => failure.message,
    supabase: { from: () => ({ select: () => ({ in: async () => ({ data: rows, error: null }) }) }) },
  };
  execute(composer.slice(start, end) + '\nthis.apply = applyDraft;', globals);
  return { apply: globals.apply, people: () => people, error: () => error, busy: () => busy, lock };
}
test('a saved private story never silently drops unavailable selected recipients', async () => {
  const h = draftHarness([{ id: 'first' }]);
  await h.apply({ id: 'draft', user_id: 'viewer', media_type: 'image', audience: 'only_with', shared_with: ['first', 'missing'] });
  assert.equal(h.people().length, 0); assert.match(h.error(), /Choose them again before sharing/);
  assert.equal(h.busy(), null); assert.equal(h.lock.current, false);
});
test('a saved private story restores its complete selected audience', async () => {
  const h = draftHarness([{ id: 'first' }, { id: 'second' }]);
  await h.apply({ id: 'draft', user_id: 'viewer', media_type: 'image', audience: 'only_with', shared_with: ['first', 'second'] });
  assert.deepEqual(h.people().map(person => person.id), ['first', 'second']); assert.equal(h.error(), null);
});
