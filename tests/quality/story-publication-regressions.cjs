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
    './supabase': { supabase: client }, '../utils/publication': publication, '../stores/actorStore': actors,
    '../utils/sniffMedia': { resolveTrueMeta: async () => ({ ext: 'jpg', mime: 'image/jpeg', kind: 'image' }) },
    '../utils/uploadSafe': { ensureUploadSafe: async (uri) => ({ uri, ext: 'jpg', mime: 'image/jpeg' }) },
  }, {
    process: { env: { EXPO_PUBLIC_SUPABASE_URL: 'https://example.invalid', EXPO_PUBLIC_SUPABASE_ANON_KEY: 'synthetic' } },
    FormData: class { append() {} }, AbortController,
    setTimeout: () => 1, clearTimeout() {},
    fetch: async () => { calls.push({ upload: true }); return options.upload ? options.upload() : { ok: true }; },
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
