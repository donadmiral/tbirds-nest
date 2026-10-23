const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

// These tests execute the real comment mutation handlers, count reconciler and
// PostCard subscriptions using synthetic service responses. No hosted writes.
const root = process.env.COMMENT_SOURCE_ROOT || path.join(__dirname, '..');
const compiled = file => ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText;
const commentSource = compiled('components/Comments.tsx');
const cardSource = compiled('components/PostCard.tsx');
const profileModule = { exports: {} };
vm.runInNewContext(compiled('lib/profileLookup.ts'), { module: profileModule, exports: profileModule.exports });
// Keep the new test helper available when running original component sources.
const helperSource = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../lib/commentCounts.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node)
  : Array.isArray(node) ? node.map(text).join('') : text(node?.props?.children ?? '');
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = async (...components) => {
  for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve));
  components.forEach(component => component.render());
};

function scenario(initialCount = 0) {
  const listeners = new Map(), alerts = [], writes = [], countReads = [];
  let total = initialCount, rows = [], threadError = null, insert = () => ({ error: null }), remove = () => ({ error: null });
  let readCount = () => ({ data: { comments_count: total }, error: null });
  class CustomEvent { constructor(type, options) { this.type = type; this.detail = options.detail; } }
  const window = {
    addEventListener(type, listener) { const set = listeners.get(type) || new Set(); set.add(listener); listeners.set(type, set); },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    dispatchEvent(event) { [...(listeners.get(event.type) || [])].forEach(listener => listener(event)); },
    confirm: () => true,
  };
  const client = {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'author' } } } }) },
    from(table) {
      let selection = '', operation = 'select', input;
      const chain = {
        select(value) { selection = value; return chain; },
        eq() { return chain; }, in() { return chain; }, order() { return chain; }, maybeSingle() { return chain; },
        insert(value) { operation = 'insert'; input = value; return chain; },
        delete() { operation = 'delete'; return chain; },
        then(ok, bad) { return Promise.resolve().then(() => {
          if (table === 'post_comments' && operation !== 'select') {
            writes.push({ operation, input }); return operation === 'insert' ? insert(input) : remove();
          }
          if (table === 'posts' && selection === 'comments_count') { countReads.push(true); return readCount(); }
          if (table === 'posts') return { data: { user_id: 'author', comment_policy: 'all' }, error: null };
          if (table === 'post_comments') return threadError ? { data: null, error: threadError } : { data: rows, error: null };
          return { data: [], error: null };
        }).then(ok, bad); },
      };
      return chain;
    },
  };
  const helperModule = { exports: {} };
  vm.runInNewContext(helperSource, { module: helperModule, exports: helperModule.exports, window, CustomEvent });
  const helper = helperModule.exports;

  function mount(kind, props) {
    const slots = []; let cursor = 0, tree, effects = [], stateWrites = 0;
    const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
    const hooks = {
      useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
        return [slots[i], next => { stateWrites++; slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
      useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
      useCallback(fn, deps) { const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { value: fn, deps }; return slots[i].value; },
      useEffect(fn, deps) { const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) {
        slots[i]?.cleanup?.(); slots[i] = { deps }; effects.push(() => { slots[i].cleanup = fn(); });
      } },
    };
    const runtime = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: 'Fragment' };
    const module = { exports: {} };
    vm.runInNewContext(kind === 'comments' ? commentSource : cardSource, {
      module, exports: module.exports, window, CustomEvent, alert: message => alerts.push(message), setTimeout, clearTimeout,
      require(id) {
        if (id === 'react') return hooks;
        if (id === 'react/jsx-runtime') return runtime;
        if (id === '@/lib/commentCounts') return helper;
        if (id === '@/lib/profileLookup') return profileModule.exports;
        if (id === '@/lib/supabase/client') return { createClient: () => client };
        if (id === '@/lib/pollCheck') return { usePollFlag: () => false };
        if (id === '@/lib/usePostInteractions') return { usePostInteractions: (_id, seed) => ({ ...seed, pending: false, error: null, uncertain: false }) };
        if (id === '@/lib/feed') return { timeAgo: () => 'now' };
        if (id === 'next/navigation') return { useRouter: () => ({ push() {} }) };
        if (id === 'next/link') return { default: 'Link' };
        return new Proxy({}, { get: (_, key) => String(key) });
      },
    });
    const render = () => { cursor = 0; tree = module.exports[kind === 'comments' ? 'Comments' : 'PostCard'](props); const pending = effects; effects = []; pending.forEach(fn => fn()); };
    const nodes = () => {
      const found = [];
      const walk = n => { if (!n || typeof n !== 'object') return; if (Array.isArray(n)) return n.forEach(walk);
        if (typeof n.type === 'function') return walk(n.type(n.props)); found.push(n); walk(n.props?.children); };
      walk(tree); return found;
    };
    const find = predicate => nodes().find(predicate);
    const click = label => { const node = find(n => n.type === 'button' && (text(n).trim() === label || n.props.title === label)); assert.ok(node, 'Missing button: ' + label); const result = node.props.onClick(); render(); return result; };
    const component = { render, find, click,
      draft(value) { find(n => n.type === 'textarea').props.onChange({ target: { value } }); render(); },
      props(value) { props = value; render(); },
      unmount() { slots.forEach(slot => slot?.cleanup?.()); },
      get total() { return text(find(n => n.type === 'button' && /^(Show|Hide) comments$/.test(n.props['aria-label'] || ''))).trim(); },
      get stateWrites() { return stateWrites; },
    };
    render(); return component;
  }
  const post = (id = 'post', count = initialCount) => ({ post_id: id, comments_count: count, content: 'Synthetic post', author_id: 'author', author_name: 'Author', author_username: 'author', likes_count: 0, reposts_count: 0, bookmarks_count: 0, media: [] });
  return { mount, post, helper, client, alerts, writes, countReads,
    set total(value) { total = value; }, set rows(value) { rows = value; }, set threadError(value) { threadError = value; },
    set insert(fn) { insert = fn; }, set remove(fn) { remove = fn; }, set readCount(fn) { readCount = fn; },
  };
}

test('a comment submission updates every mounted matching card with the server total, not a delta', async () => {
  const s = scenario(), count = deferred(); s.readCount = () => count.promise;
  const a = s.mount('card', { post: s.post() }), b = s.mount('card', { post: s.post() }), other = s.mount('card', { post: s.post('other', 3) });
  const comments = s.mount('comments', { postId: 'post' }); await flush(a, b, other, comments);
  comments.draft('New comment'); await comments.click('Send'); await flush(a, b, comments);
  assert.equal(a.total, '', 'no optimistic increment while the total is unknown');
  count.resolve({ data: { comments_count: 7 }, error: null }); await flush(a, b, other, comments);
  assert.equal(a.total, '7'); assert.equal(b.total, '7'); assert.equal(other.total, '3');
  assert.equal(s.writes.length, 1); assert.equal(s.writes[0].input.content, 'New comment');
  assert.equal(comments.find(n => n.type === 'textarea').props.value, '');
  assert.equal(s.countReads.length, 1, 'one reconciliation serves all mounted copies');
});

test('deleting a parent uses the server total after cascading reply deletion', async () => {
  const s = scenario(8);
  s.rows = [{ id: 'parent', user_id: 'author', body: 'Parent', parent_comment_id: null },
    { id: 'reply-a', user_id: 'author', body: 'Reply A', parent_comment_id: 'parent' },
    { id: 'reply-b', user_id: 'author', body: 'Reply B', parent_comment_id: 'parent' }];
  s.remove = () => { s.total = 5; s.rows = []; return { error: null }; };
  const card = s.mount('card', { post: s.post() }), comments = s.mount('comments', { postId: 'post' });
  await flush(card, comments); comments.click('More'); await comments.click('Delete'); await flush(card, comments);
  assert.equal(card.total, '5'); assert.equal(s.writes[0].operation, 'delete');
});

test('reply submission preserves its parent and updates the whole-post total', async () => {
  const s = scenario(1);
  s.rows = [{ id: 'parent', user_id: 'author', body: 'Parent', parent_comment_id: null }];
  s.insert = () => { s.total = 2; return { error: null }; };
  const card = s.mount('card', { post: s.post() }), comments = s.mount('comments', { postId: 'post' });
  await flush(card, comments); comments.click('Reply'); comments.draft('A reply'); await comments.click('Send'); await flush(card, comments);
  assert.equal(s.writes[0].input.parent_comment_id, 'parent'); assert.equal(card.total, '2');
});

test('a rejected or no-op delete does not hide a retained comment or decrement its count', async () => {
  const s = scenario(1);
  s.rows = [{ id: 'parent', user_id: 'author', body: 'Retained', parent_comment_id: null }];
  s.remove = () => ({ error: { message: 'permission denied' } });
  const card = s.mount('card', { post: s.post() }), comments = s.mount('comments', { postId: 'post' });
  await flush(card, comments); comments.click('More'); await comments.click('Delete'); await flush(card, comments);
  assert.equal(card.total, '1'); assert.ok(comments.find(n => n.type === 'RichText' && n.props.text === 'Retained'));
  s.remove = () => ({ error: null });
  comments.click('More'); await comments.click('Delete'); await flush(card, comments);
  assert.equal(card.total, '1'); assert.ok(comments.find(n => n.type === 'RichText' && n.props.text === 'Retained'));
});

test('a rejected write retains its draft and the existing authoritative count', async () => {
  const s = scenario(4); s.insert = () => ({ error: { message: 'permission denied' } });
  const card = s.mount('card', { post: s.post() }), comments = s.mount('comments', { postId: 'post' });
  await flush(card, comments); comments.draft('Retain me'); await comments.click('Send'); await flush(card, comments);
  assert.equal(card.total, '4'); assert.equal(comments.find(n => n.type === 'textarea').props.value, 'Retain me');
  assert.equal(comments.find(n => n.type === 'button' && text(n) === 'Send').props.disabled, false);
  assert.ok(s.alerts.some(message => message.includes('permission denied')));
});

test('a failed reconciliation read preserves the previously visible thread', async () => {
  const s = scenario(1);
  s.rows = [{ id: 'parent', user_id: 'author', body: 'Retained thread', parent_comment_id: null }];
  s.insert = () => ({ error: { message: 'permission denied' }, status: 403 });
  const comments = s.mount('comments', { postId: 'post' }); await flush(comments);
  s.threadError = { message: 'temporary read failure' };
  comments.draft('Retain my draft'); await comments.click('Send'); await flush(comments);
  assert.ok(comments.find(n => n.type === 'RichText' && n.props.text === 'Retained thread'));
  assert.equal(comments.find(n => n.type === 'textarea').props.value, 'Retain my draft');
});

test('an uncertain write preserves the draft, releases Send, and reconciles a committed server result', async () => {
  const s = scenario(4); s.insert = () => { s.total = 5; throw new Error('response lost after commit'); };
  const card = s.mount('card', { post: s.post() }), comments = s.mount('comments', { postId: 'post' });
  await flush(card, comments); comments.draft('Uncertain'); await comments.click('Send'); await flush(card, comments);
  assert.equal(card.total, '5'); assert.equal(comments.find(n => n.type === 'textarea').props.value, 'Uncertain');
  assert.equal(comments.find(n => n.type === 'button' && text(n) === 'Send').props.disabled, false);
  assert.ok(s.alerts.some(message => message.includes('Check the thread before trying again')));
});

for (const status of [0, 503]) test(`a returned transport/server error (${status}) reports uncertain submission and reconciles`, async () => {
  const s = scenario(4);
  s.insert = () => { s.total = 5; return { error: { message: 'response unavailable' }, status }; };
  const card = s.mount('card', { post: s.post() }), comments = s.mount('comments', { postId: 'post' });
  await flush(card, comments); comments.draft('Uncertain'); await comments.click('Send'); await flush(card, comments);
  assert.equal(card.total, '5'); assert.equal(comments.find(n => n.type === 'textarea').props.value, 'Uncertain');
  assert.ok(s.alerts.some(message => message.includes('Could not confirm whether your comment was sent')));
  assert.equal(comments.find(n => n.type === 'button' && text(n) === 'Send').props.disabled, false);
});

test('a returned transport error reports uncertain deletion and reconciles its committed result', async () => {
  const s = scenario(1);
  s.rows = [{ id: 'parent', user_id: 'author', body: 'Parent', parent_comment_id: null }];
  s.remove = () => { s.total = 0; s.rows = []; return { error: { message: 'response lost' }, status: 0 }; };
  const card = s.mount('card', { post: s.post() }), comments = s.mount('comments', { postId: 'post' });
  await flush(card, comments); comments.click('More'); await comments.click('Delete'); await flush(card, comments);
  assert.equal(card.total, '');
  assert.ok(s.alerts.some(message => message.includes('Could not confirm whether the comment was deleted')));
});

test('failed count reads do not turn a successful comment into an error or reset its card', async () => {
  const s = scenario(4); s.readCount = async () => { throw new Error('offline'); };
  const card = s.mount('card', { post: s.post() }), comments = s.mount('comments', { postId: 'post' });
  await flush(card, comments); comments.draft('Accepted'); await comments.click('Send'); await flush(card, comments);
  assert.equal(card.total, '4'); assert.equal(comments.find(n => n.type === 'textarea').props.value, '');
  assert.deepEqual(s.alerts, []);
  for (const result of [{ data: null, error: null }, { data: { comments_count: 0 }, error: { message: 'denied' } }, { data: { comments_count: -1 }, error: null }, { data: { comments_count: '5' }, error: null }]) {
    s.readCount = async () => result; await s.helper.refreshCommentCount(s.client, 'post'); await flush(card);
    assert.equal(card.total, '4');
  }
});

test('newer reads win, repeated totals do not double count, and stale feed props reconcile', async () => {
  const s = scenario(1), old = deferred(), recent = deferred();
  const card = s.mount('card', { post: s.post() }); await flush(card);
  s.readCount = () => old.promise; const first = s.helper.refreshCommentCount(s.client, 'post'); await flush();
  s.readCount = () => recent.promise; const second = s.helper.refreshCommentCount(s.client, 'post'); await flush();
  recent.resolve({ data: { comments_count: 9 }, error: null }); await second; await flush(card);
  old.resolve({ data: { comments_count: 8 }, error: null }); await first; await flush(card);
  assert.equal(card.total, '9');
  s.readCount = async () => ({ data: { comments_count: 9 }, error: null });
  await s.helper.refreshCommentCount(s.client, 'post'); await flush(card); assert.equal(card.total, '9');
  const seedRead = deferred(); s.readCount = () => seedRead.promise;
  card.props({ post: s.post('post', 2) }); assert.equal(card.total, '9', 'late seed cannot regress a confirmed total');
  seedRead.resolve({ data: { comments_count: 10 }, error: null }); await flush(card); assert.equal(card.total, '10');
  card.props({ post: s.post('other', 3) }); assert.equal(card.total, '3', 'a recycled card does not carry totals to another post');
});

test('a mutation completing after its editor unmounts still updates other copies', async () => {
  const s = scenario(1), write = deferred(); s.insert = () => write.promise;
  const card = s.mount('card', { post: s.post() }), comments = s.mount('comments', { postId: 'post' });
  await flush(card, comments); comments.draft('Delayed'); const pending = comments.click('Send'); await flush(); comments.unmount();
  s.total = 2; write.resolve({ error: null }); await pending; await flush(card); assert.equal(card.total, '2');
  card.unmount(); const before = card.stateWrites;
  s.total = 3; await s.helper.refreshCommentCount(s.client, 'post'); await flush(); assert.equal(card.stateWrites, before);
});
