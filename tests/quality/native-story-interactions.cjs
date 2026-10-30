const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
function moduleSource(source, imports = {}, context = {}) {
  const exports = {};
  vm.runInNewContext(compile(source), { exports, require(name) { assert.ok(name in imports, 'Unexpected import ' + name); return imports[name]; }, ...context });
  return exports;
}
const viewer = fs.readFileSync(path.join(root, 'src/screens/stories/StoryViewerScreen.tsx'), 'utf8');
const ast = ts.createSourceFile('StoryViewerScreen.tsx', viewer, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function callback(name, context) {
  let source;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) source = node.initializer.arguments[0].getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast); assert.ok(source, name);
  return moduleSource('export const run = ' + source, {}, context).run;
}
function scopeHarness() {
  let cursor = 0, effect;
  const refs = [];
  const store = { session: { user: { id: 'auth-a' } }, profile: { id: 'viewer-a' } };
  const hook = moduleSource(fs.readFileSync(path.join(root, 'src/hooks/useStoryInteractionScope.ts'), 'utf8'), {
    react: { useRef(value) { return refs[cursor++] ||= { current: value }; }, useCallback: fn => fn, useEffect(fn) { effect ||= fn; } },
    '../stores/authStore': { useAuthStore: { getState: () => store } },
  }).useStoryInteractionScope;
  let actor = 'viewer-a', story = 'story-a', capture;
  const render = () => { cursor = 0; capture = hook(actor, story); };
  render(); let cleanup = effect();
  return { capture: (viewerId, storyId) => capture(viewerId, storyId), store,
    move(nextActor, nextStory) { actor = nextActor; story = nextStory; store.profile = actor ? { id: actor } : null; render(); },
    unmount() { cleanup(); }, remountEffects() { cleanup(); cleanup = effect(); },
  };
}

test('native story completions belong to one visit, including account return and effect remount', () => {
  const h = scopeHarness(), first = h.capture('viewer-a', 'story-a'); assert.equal(first(), true);
  h.move('viewer-a', 'story-b'); assert.equal(first(), false);
  h.move('viewer-a', 'story-a'); assert.equal(first(), false);
  const second = h.capture('viewer-a', 'story-a'); h.remountEffects(); assert.equal(second(), false);
  const third = h.capture('viewer-a', 'story-a'); h.unmount(); assert.equal(third(), false);
});
test('native story identity checks reject old controls and session changes before a render', () => {
  const h = scopeHarness(); assert.equal(h.capture('other', 'story-a')(), false);
  const current = h.capture('viewer-a', 'story-a'); h.store.session = null; assert.equal(current(), false);
});

function scenario(overrides = {}) {
  const scope = scopeHarness(), events = [], alerts = [], timers = new Map(), calls = [];
  const context = {
    currentStory: { id: 'story-a', user_id: 'author' }, currentStoryId: 'story-a', currentStoryOwner: 'viewer-a', myId: 'viewer-a',
    captureInteraction: scope.capture, reactionBusyRef: { current: new Set() }, reactionRevision: { current: 0 }, reactionsLoaded: { current: true },
    myReactionsRef: { current: new Set() }, toastTimer: { current: null }, pollReadRevision: { current: 0 }, pollVoteBusy: { current: new Set() },
    pollVotersRequest: { current: 0 }, viewersOpen: false,
    poll: { poll_id: 'poll-a', story_id: 'story-a', options: [{ id: 'yes' }, { id: 'no' }], my_vote: null, total_votes: 0 }, pollRef: { current: null },
    storiesService: {
      getMyReactions: async () => { calls.push('read-reactions'); return []; },
      toggleReaction: async () => { calls.push('toggle'); return { reacted: true }; },
      voteStoryPoll: async (id, option) => { calls.push(['vote', id, option]); return { poll_id: id, story_id: 'story-a', my_vote: option }; },
      getStoryPollVoters: async (id, option) => { calls.push(['voters', id, option]); return [{ user_id: 'voter' }]; },
      ...overrides,
    },
    Haptics: { impactAsync: async () => {}, ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' } },
    Alert: { alert: (...args) => alerts.push(args) },
    setTimeout(fn) { const id = timers.size + 1; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); },
    pauseFor: reason => events.push(['pause', reason]), resumeFrom: reason => events.push(['resume', reason]), closeViewersList: () => {},
  };
  for (const name of ['setMyReactions', 'setReactionToast', 'setVotingOptionId', 'setPoll', 'setPollVotersOptionId', 'setPollVotersOpen', 'setLoadingPollVoters', 'setPollVotersError', 'setPollVoters']) context[name] = value => events.push([name, value]);
  context.refreshReactions = callback('refreshReactions', context);
  return { scope, context, events, alerts, timers, calls,
    react: callback('handleReaction', context), refresh: context.refreshReactions,
    vote: callback('handlePollVote', context), voters: callback('openPollVoters', context), closeVoters: callback('closePollVoters', context),
  };
}

test('same-frame native reaction taps send one toggle and late completion cannot change another story', async () => {
  const pending = deferred(); let count = 0;
  const h = scenario({ toggleReaction: () => { count++; return pending.promise; } });
  const first = h.react('heart'); await h.react('heart'); assert.equal(count, 1);
  h.scope.move('viewer-a', 'story-b'); h.events.length = 0;
  pending.resolve({ reacted: true }); await first;
  for (const timer of h.timers.values()) timer();
  assert.equal(h.events.length, 0); assert.equal(h.context.reactionBusyRef.current.size, 0);
});

test('native reaction failure cannot roll back a later account or write after unmount', async () => {
  for (const move of [h => h.scope.move('viewer-b', 'story-a'), h => h.scope.unmount()]) {
    const pending = deferred(), h = scenario({ toggleReaction: () => pending.promise });
    const first = h.react('heart'); move(h); h.events.length = 0;
    pending.reject(new Error('offline')); await first;
    assert.equal(h.events.length, 0); assert.equal(h.alerts.length, 0);
  }
});

test('a reaction read started before a mutation cannot replace its confirmed selection', async () => {
  const pending = deferred(), h = scenario({ getMyReactions: () => pending.promise });
  h.context.currentStoryOwner = 'author';
  // Extracted callbacks preserve their actual primitive closure values.
  h.context.refreshReactions = callback('refreshReactions', h.context);
  const read = h.context.refreshReactions();
  await h.react('heart'); pending.resolve([]); await read;
  assert.equal(h.context.myReactionsRef.current.has('heart'), true);
});

test('failed initial reaction hydration prevents a blind toggle', async () => {
  let toggles = 0;
  const h = scenario({ getMyReactions: async () => { throw new Error('denied'); }, toggleReaction: async () => { toggles++; return { reacted: true }; } });
  h.context.reactionsLoaded.current = false;
  await h.react('heart'); assert.equal(toggles, 0); assert.equal(h.alerts[0][0], 'Reactions unavailable');
});

test('a pending initial reaction read cannot submit as the next signed-in viewer', async () => {
  const pending = deferred(); let toggles = 0;
  const h = scenario({ getMyReactions: () => pending.promise, toggleReaction: async () => { toggles++; return { reacted: true }; } });
  h.context.reactionsLoaded.current = false;
  const work = h.react('heart'); h.scope.move('viewer-b', 'story-a'); pending.resolve([]); await work;
  assert.equal(toggles, 0); assert.equal(h.events.length, 0);
});

test('an uncertain reaction offers a status read without replaying the toggle', async () => {
  let toggles = 0, reads = 0;
  const h = scenario({ toggleReaction: async () => { toggles++; throw new Error('lost response'); }, getMyReactions: async () => { reads++; return ['heart']; } });
  h.context.currentStoryOwner = 'author';
  h.context.refreshReactions = callback('refreshReactions', h.context);
  const run = callback('handleReaction', h.context);
  await run('heart'); assert.equal(h.context.myReactionsRef.current.has('heart'), false);
  h.alerts[0][2].find(action => action.text === 'Check status').onPress(); await flush();
  assert.equal(toggles, 1); assert.equal(reads, 1); assert.equal(h.context.myReactionsRef.current.has('heart'), true);
});

test('native poll same-frame duplicate taps submit one vote and use the returned server record', async () => {
  const pending = deferred(); let count = 0;
  const h = scenario({ voteStoryPoll: () => { count++; return pending.promise; } });
  const first = h.vote('yes'); await h.vote('no'); assert.equal(count, 1);
  pending.resolve({ poll_id: 'poll-a', story_id: 'story-a', my_vote: 'yes' }); await first;
  assert.equal(h.events.find(event => event[0] === 'setPoll')[1].my_vote, 'yes');
  assert.deepEqual(h.events.at(-1), ['setVotingOptionId', null]);
});

test('late native poll success and failure do not affect the next story', async () => {
  for (const succeeds of [true, false]) {
    const pending = deferred(), h = scenario({ voteStoryPoll: () => pending.promise });
    const first = h.vote('yes'); h.scope.move('viewer-a', 'story-b'); h.events.length = 0;
    if (succeeds) pending.resolve({ poll_id: 'poll-a', story_id: 'story-a', my_vote: 'yes' }); else pending.reject(new Error('denied'));
    await first; assert.equal(h.events.length, 0); assert.equal(h.alerts.length, 0); assert.equal(h.context.pollVoteBusy.current.size, 0);
  }
});

test('native poll rejects a stale option and a malformed success without displaying a vote', async () => {
  const h = scenario({ voteStoryPoll: async () => ({ poll_id: 'another-poll', story_id: 'story-a' }) });
  await h.vote('missing'); assert.equal(h.events.length, 0);
  await h.vote('yes'); assert.equal(h.events.some(event => event[0] === 'setPoll'), false); assert.equal(h.alerts[0][0], 'Vote not confirmed');
});

test('closing native poll voters invalidates late response and late failure', async () => {
  for (const succeeds of [true, false]) {
    const pending = deferred(), h = scenario({ getStoryPollVoters: () => pending.promise });
    const first = h.voters('yes'); h.closeVoters(); h.events.length = 0;
    if (succeeds) pending.resolve([{ user_id: 'private-old-result' }]); else pending.reject(new Error('denied'));
    await first; assert.equal(h.events.length, 0);
  }
});

test('only the latest native voter option may populate the open sheet', async () => {
  const first = deferred(), next = deferred();
  const h = scenario({ getStoryPollVoters: (_id, option) => option === 'yes' ? first.promise : next.promise });
  const a = h.voters('yes'), b = h.voters('no'); h.events.length = 0;
  next.resolve([{ user_id: 'no-voter' }]); await b; first.resolve([{ user_id: 'yes-voter' }]); await a;
  assert.equal(h.events.filter(event => event[0] === 'setPollVoters').length, 1);
  assert.equal(h.events.find(event => event[0] === 'setPollVoters')[1][0].user_id, 'no-voter');
});

test('voter load errors produce a retry state instead of an empty vote count', async () => {
  const h = scenario({ getStoryPollVoters: async () => { throw new Error('offline'); } });
  await h.voters('yes'); assert.ok(h.events.some(event => event[0] === 'setPollVotersError' && event[1]));
  assert.deepEqual(h.events.at(-1), ['setLoadingPollVoters', false]);
});

test('story reaction service propagates a failed read instead of fabricating an empty reaction set', async () => {
  const source = fs.readFileSync(path.join(root, 'src/services/storiesService.ts'), 'utf8');
  const serviceAst = ts.createSourceFile('service.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let method;
  function visit(node) { if (ts.isMethodDeclaration(node) && node.name.getText(serviceAst) === 'getMyReactions') method = node.getText(serviceAst); ts.forEachChild(node, visit); }
  visit(serviceAst); assert.ok(method);
  const get = moduleSource(method.replace('async getMyReactions(', 'export async function getMyReactions('), {}, { supabase: { rpc: async () => ({ error: { message: 'denied' } }) } }).getMyReactions;
  await assert.rejects(get('story-a'), /could not be loaded/);
});

const jsx = (type, props) => ({ type, props });
const PollCard = moduleSource(fs.readFileSync(path.join(root, 'src/components/stories/PollCard.tsx'), 'utf8'), {
  react: { useCallback: fn => fn, useMemo: fn => fn(), useEffect() {} }, 'react/jsx-runtime': { jsx, jsxs: jsx },
  'react-native': { View: 'View', Text: 'Text', TouchableOpacity: 'TouchableOpacity', StyleSheet: { create: value => value } },
  'react-native-reanimated': { Easing: { bezier: () => {} } },
}).default;
function nodes(tree, result = []) {
  if (!tree || typeof tree !== 'object') return result;
  if (Array.isArray(tree)) { tree.forEach(child => nodes(child, result)); return result; }
  result.push(tree); nodes(tree.props?.children, result); return result;
}
function options(tree) { return nodes(tree).filter(node => typeof node.type === 'function'); }
test('native poll card shows saving without claiming a server vote and becomes retryable after failure', () => {
  const votes = [], poll = { poll_id: 'poll-a', question: 'Choice?', my_vote: null, total_votes: 0, options: [{ id: 'yes', label: 'Yes', vote_count: 0 }] };
  const props = { poll, isOwn: false, onVote: option => votes.push(option), onOpenVoters() {} };
  const before = options(PollCard(props))[0]; before.props.onPress();
  const pending = options(PollCard({ ...props, votingOptionId: 'yes' }))[0];
  assert.equal(pending.props.chosen, false); assert.equal(pending.props.disabled, true); assert.equal(pending.props.busy, true);
  pending.props.onPress(); assert.equal(votes.length, 1);
  const afterFailure = options(PollCard(props))[0]; assert.equal(afterFailure.props.disabled, false); assert.equal(afterFailure.props.chosen, false);
  afterFailure.props.onPress(); assert.deepEqual(votes, ['yes', 'yes']);
  const confirmed = options(PollCard({ ...props, poll: { ...poll, my_vote: 'yes', total_votes: 1, options: [{ id: 'yes', label: 'Yes', vote_count: 1 }] } }))[0];
  assert.equal(confirmed.props.chosen, true); assert.equal(confirmed.props.pct, 1); assert.equal(confirmed.props.disabled, true);
});
