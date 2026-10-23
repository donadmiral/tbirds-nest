const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../../src/screens/stories/StoryViewerScreen.tsx'), 'utf8');
const start = source.indexOf('  const loadForCurrentUser = useCallback(');
const end = source.indexOf('\n  useEffect(() => { void loadForCurrentUser()', start);
const compiled = ts.transpileModule(source.slice(start, end) + '\nthis.load = loadForCurrentUser;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
function scenario({ cache = new Map(), fetchStories = async () => [{ id: 'fresh' }] } = {}) {
  const updates = { stories: [], viewers: [] };
  let fetches = 0;
  const context = {
    useCallback: fn => fn, currentUserId: 'author', myId: 'viewer', highlightId: null, resumeStoryIndex: -1,
    viewerRef: { current: 'viewer' }, loadGeneration: { current: 0 }, nextUserCache: { current: cache }, resumeConsumedRef: { current: false },
    setMediaReady() {}, setLoading() {}, setMediaError() {}, setStoryUser() {}, setStoryIndex() {},
    setStories: value => updates.stories.push(value), setLoadedViewer: value => updates.viewers.push(value),
    storiesService: { getUserStories: async () => { fetches++; return fetchStories(); } },
    supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'author' } }) }) }) }) },
  };
  vm.runInNewContext(compiled, context);
  return { ...context, updates, fetches: () => fetches };
}
test('native story cache is scoped to the signed-in viewer', async () => {
  const h = scenario({ cache: new Map([['previous-viewer:author', { stories: [{ id: 'private-old' }], profile: {} }]]) });
  await h.load();
  assert.equal(h.fetches(), 1);
  assert.equal(h.updates.stories.at(-1)[0].id, 'fresh');
});
test('native story cache refreshes expired capabilities instead of rendering them', async () => {
  const h = scenario({ cache: new Map([['viewer:author', { stories: [{ id: 'expired', _mediaExpiresAt: Date.now() - 1 }], profile: {} }]]) });
  await h.load();
  assert.equal(h.fetches(), 1);
  assert.equal(h.updates.stories.at(-1)[0].id, 'fresh');
});
test('a late native story read cannot repopulate media after an account switch', async () => {
  let resolve;
  const h = scenario({ fetchStories: () => new Promise(done => { resolve = done; }) });
  const pending = h.load();
  h.viewerRef.current = 'next-viewer';
  resolve([{ id: 'private-previous-viewer' }]);
  await pending;
  assert.equal(h.updates.stories.length, 0);
  assert.equal(h.updates.viewers.length, 0);
});
