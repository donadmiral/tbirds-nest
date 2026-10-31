const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.join(__dirname, '../..');
function load(file, globals = {}) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module, exports: module.exports, Date, Map, Set, Error, JSON, AbortController, setTimeout, clearTimeout,
      require: name => load(path.join(path.dirname(file), name + '.ts'), globals), ...globals });
  return module.exports;
}
const { loadConversationTargets } = load('shared/conversationTargets.ts');
const { peopleSearchFilter, searchMessagePeople } = load('shared/peopleSearch.ts');
const { messagesBack, openChatFromComposer } = load('src/navigation/messagesNavigation.ts');
function fixture(options = {}) {
  const reads = [], rpcs = [];
  const people = [{ id: 'other', full_name: 'Person', username: 'person', avatar_url: null }];
  const data = {
    conversations: [
      { id: 'dm', user_1: 'me', user_2: 'other', is_group: false, context: 'personal' },
      { id: 'mismatched-legacy-type', type: 'direct', is_group: true, group_name: 'Team', group_type: 'community', group_ref_id: 'community' },
      { id: 'incoming', user_1: 'me', user_2: 'other', is_group: false, request_status: 'pending', request_sender_id: 'other' },
    ],
    conversation_members: [{ conversation_id: 'mismatched-legacy-type', user_id: 'me' }],
    profiles: people,
  };
  const client = {
    from(table) {
      assert.ok(!['communities', 'community_members'].includes(table), 'Private community tables must never be read from the client');
      const call = { table, filters: [], ranges: [] }; reads.push(call);
      const chain = {
        select(columns) { call.columns = columns; return chain; }, order() { return chain; }, limit() { return chain; },
        eq(key, value) { call.filters.push([key, value]); return chain; }, neq(key, value) { call.exclude = [key, value]; return chain; },
        in(key, values) { call.in = [key, values]; return chain; }, or(filter) { call.ranges.push(filter); return chain; },
        then(ok, bad) {
          if (options.hang === table) return new Promise(() => {});
          if (options.fail === table) return Promise.resolve({ data: null, error: { code: '42501' } }).then(ok, bad);
          let rows = data[table] || [];
          for (const [key, value] of call.filters) rows = rows.filter(row => row[key] === value);
          if (call.in) rows = rows.filter(row => call.in[1].includes(row[call.in[0]]));
          return Promise.resolve({ data: rows, error: null }).then(ok, bad);
        },
      }; return chain;
    },
    rpc(name, args) {
      rpcs.push({ name, args });
      if (options.rpcHang) return new Promise(() => {});
      return Promise.resolve(options.rpcFailure ? { error: { message: 'offline' }, data: null } : {
        data: options.communityPages?.[args.p_offset / 100] || [{ id: 'community', name: 'Community', is_member: true }, { id: 'not-joined', name: 'Other', is_member: false }], error: null,
      });
    },
  };
  return { client, reads, rpcs };
}
test('share selector uses safe directory RPC and canonical group flag, and omits unaccepted requests and duplicate community chats', async () => {
  const h = fixture(); const result = await loadConversationTargets(h.client, 'me');
  assert.deepEqual(Array.from(result.people, row => row.id), ['dm']);
  assert.deepEqual(Array.from(result.groups, row => row.id), ['mismatched-legacy-type']);
  assert.equal(result.communities.length, 0); assert.equal(result.warning, null);
  assert.equal(h.rpcs[0].name, 'get_communities_page');
  assert.ok(h.reads[0].filters.some(([key, value]) => key === 'is_group' && value === false));
});
test('community API outage keeps private and group destinations available with a retry warning', async () => {
  const result = await loadConversationTargets(fixture({ rpcFailure: true }).client, 'me');
  assert.equal(result.people.length, 1); assert.equal(result.groups.length, 1); assert.match(result.warning, /communities.*retry/);
});
test('profile lookup failure never offers an anonymous ambiguous target and does not hide groups', async () => {
  const result = await loadConversationTargets(fixture({ fail: 'profiles' }).client, 'me');
  assert.equal(result.people.length, 0); assert.equal(result.groups.length, 1); assert.match(result.warning, /people/);
});
test('memberships paginate beyond the first hundred with one consistent snapshot', async () => {
  const h = fixture({ communityPages: [Array.from({ length: 100 }, (_, i) => ({ id: 'member-' + i, is_member: true })), [{ id: 'member-100', is_member: true }, { id: 'public', is_member: false }]] });
  const result = await loadConversationTargets(h.client, 'me');
  assert.equal(result.communities.length, 101);
  assert.deepEqual(h.rpcs.map(call => call.args.p_offset), [0, 100]);
  assert.equal(h.rpcs[0].args.p_as_of, h.rpcs[1].args.p_as_of);
});
test('new message searches preserve literal punctuation and wildcard characters', async () => {
  assert.equal(peopleSearchFilter(' @a_b%,x '), 'full_name.ilike."%a\\\\_b\\\\%,x%",username.ilike."%a\\\\_b\\\\%,x%"');
  const h = fixture(); await searchMessagePeople(h.client, 'me', 'Don');
  assert.deepEqual(h.reads[0].exclude, ['id', 'me']);
  assert.match(h.reads[0].ranges[0], /Don/);
});
test('message composer next and cancel route deterministically without delayed navigation', () => {
  const calls = []; const nav = { popToTop: () => calls.push('clear composer'), navigate: (...args) => calls.push(args), goBack: () => calls.push('back'), canGoBack: () => true };
  openChatFromComposer(nav, { userId: 'recipient' });
  assert.deepEqual(calls, ['clear composer', ['Chat', { userId: 'recipient' }]]);
  messagesBack(nav); assert.equal(calls.at(-1), 'back');
  nav.canGoBack = () => false; messagesBack(nav);
  assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1))), ['Main', { screen: 'Messages', params: { screen: 'Conversations' } }]);
});

function clock() {
  const timers = new Map(); let next = 0;
  return {
    globals: { setTimeout(fn) { const id = ++next; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); } },
    expire() { const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); },
    get count() { return timers.size; },
  };
}
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
test('a stalled community read reaches partial results and releases its deadline', async () => {
  const time = clock();
  const loader = load('shared/conversationTargets.ts', time.globals).loadConversationTargets;
  const pending = loader(fixture({ rpcHang: true }).client, 'me');
  await settle();
  assert.equal(time.count, 1, 'completed direct and group reads clear their timers');
  time.expire();
  const result = await pending;
  assert.equal(result.people.length, 1); assert.equal(result.groups.length, 1);
  assert.match(result.warning, /communities.*retry/);
  assert.equal(time.count, 0);
});
test('a stalled new-recipient search becomes a retryable error', async () => {
  const time = clock();
  const search = load('shared/peopleSearch.ts', time.globals).searchMessagePeople;
  const pending = search(fixture({ hang: 'profiles' }).client, 'me', 'Don');
  const rejected = assert.rejects(pending, /Loading took too long/);
  await settle(); time.expire(); await rejected;
  assert.equal(time.count, 0);
});
test('read deadlines abort supported network requests and always clear the timer', async () => {
  const time = clock(); let signal;
  const read = load('shared/readDeadline.ts', time.globals).readWithDeadline;
  const pending = read({ abortSignal(value) { signal = value; return new Promise(() => {}); } });
  const rejected = assert.rejects(pending, /Loading took too long/);
  assert.equal(signal.aborted, false); time.expire(); await rejected;
  assert.equal(signal.aborted, true); assert.equal(time.count, 0);
});
