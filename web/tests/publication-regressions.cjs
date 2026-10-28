const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
function load(file, imports = {}, globals = {}) {
  const exports = {};
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(js, { exports, require: (name) => imports[name] ?? {}, console, setTimeout, clearTimeout, ...globals }, { filename: file });
  return exports;
}
const webPublication = load(path.join(root, 'lib/publication.ts'));
for (const [surface, file] of [['web', path.join(root, 'lib/publication.ts')], ['native', path.join(root, '../src/utils/publication.ts')]]) {
  const { PublicationAttempt } = load(file);
  test(`${surface}: retry resumes failed child without re-inserting parent or confirmed siblings`, async () => {
    const attempt = new PublicationAttempt();
    let posts = 0, media = 0, tags = 0;
    const publish = async () => {
      const post = await attempt.write('post', async () => ({ data: { id: ++posts }, error: null }));
      await attempt.write('media', async () => ({ data: ++media, error: null }));
      await attempt.write('tags', async () => ({ data: null, error: ++tags === 1 ? { code: '42501', message: 'Denied' } : null }));
      return post.id;
    };
    await assert.rejects(publish);
    assert.equal(await publish(), 1);
    assert.deepEqual([posts, media, tags], [1, 1, 2]);
  });
  for (const error of [{ message: 'Failed to fetch' }, { code: '08007', message: 'Unknown transaction resolution' }, { code: '40003', message: 'Unknown statement completion' }, { code: 'PGRST116', message: 'No confirmed row' }]) {
    test(`${surface}: ${error.code ?? 'network error'} blocks an unconfirmed write from replay`, async () => {
      const attempt = new PublicationAttempt();
      let calls = 0;
      const work = () => { calls++; return Promise.resolve({ data: null, error }); };
      await assert.rejects(() => attempt.write('story', work));
      await assert.rejects(() => attempt.write('story', work));
      assert.equal(attempt.uncertain, true);
      assert.equal(calls, 1);
    });
  }
  test(`${surface}: a thrown transport failure blocks replay`, async () => {
    const attempt = new PublicationAttempt();
    let calls = 0;
    const work = async () => { calls++; throw new Error('Disconnected'); };
    await assert.rejects(() => attempt.write('story', work));
    await assert.rejects(() => attempt.write('story', work));
    assert.equal(calls, 1);
  });
}

// Exercise real Composer event handlers with synthetic React state and database
// responses. No browser session, network, or production content is used.
function harness(responses) {
  let slot = 0;
  const values = [];
  const calls = [];
  const draft = new Map();
  const state = (initial) => {
    const key = slot++;
    if (!(key in values)) values[key] = typeof initial === 'function' ? initial() : initial;
    return [values[key], (value) => { values[key] = typeof value === 'function' ? value(values[key]) : value; }];
  };
  const react = { useState: state, useRef: (value) => state(() => ({ current: value }))[0], useEffect() {}, useMemo: (fn) => fn() };
  const jsx = (type, props) => ({ type, props });
  const client = {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'author' } } } }) },
    from(table) {
      const builder = {
        insert(payload) { calls.push({ table, payload }); return builder; },
        upsert(payload, options) { calls.push({ table, payload, options }); return builder; },
        select() { return builder; }, single() { return builder; },
        then(resolve, reject) {
          const queue = responses[table] || [];
          return Promise.resolve(queue.shift() ?? { data: null, error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
  const imports = new Proxy({
    react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    '@/lib/supabase/client': { createClient: () => client },
    '@/lib/publication': webPublication,
    '@/lib/categories': { CATEGORIES: [] },
    '@/lib/stories': { STORY_FILTERS: [] },
  }, { get: (target, key) => target[key] ?? {} });
  const globals = { crypto: require('node:crypto').webcrypto, localStorage: { getItem: (key) => draft.get(key), setItem: (key, value) => draft.set(key, value), removeItem: (key) => draft.delete(key) }, URL: { revokeObjectURL() {} } };
  let posted = 0;
  const { Composer } = load(path.join(root, 'components/Composer.tsx'), imports, globals);
  const render = () => { slot = 0; return Composer({ onPosted: () => { posted++; } }); };
  const all = (node) => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(all) : [node, ...all(node.props?.children)];
  const text = (node) => typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join('') : node?.props ? text(node.props.children) : '';
  const button = (tree, label) => all(tree).findLast((n) => n.type === 'button' && text(n) === label);
  const input = (tree, placeholder) => all(tree).find((n) => n.props?.placeholder === placeholder);
  const preparePoll = () => {
    button(render(), ' Poll').props.onClick();
    input(render(), 'What is happening?').props.onChange({ target: { value: 'Question' } });
    input(render(), 'Option 1').props.onChange({ target: { value: 'One' } });
    input(render(), 'Option 2').props.onChange({ target: { value: 'Two' } });
  };
  return { render, button, input, preparePoll, calls, posted: () => posted, all, text };
}
test('Composer retains poll draft on child failure; Retry only saves missing options', async () => {
  const h = harness({ posts: [{ data: { id: 'post-1' }, error: null }], post_polls: [{ data: null, error: null }], post_poll_options: [{ data: null, error: { code: '42501', message: 'Options denied' } }, { data: null, error: null }] });
  h.preparePoll();
  await h.button(h.render(), 'Post').props.onClick();
  assert.equal(h.posted(), 0);
  assert.equal(h.input(h.render(), 'What is happening?').props.value, 'Question');
  await h.button(h.render(), 'Retry').props.onClick();
  assert.equal(h.posted(), 1);
  assert.deepEqual(h.calls.map((x) => x.table), ['posts', 'post_polls', 'post_poll_options', 'post_poll_options']);
});
test('Composer refuses same-tick duplicate submissions', async () => {
  const h = harness({ posts: [{ data: { id: 'post-1' }, error: null }] });
  h.button(h.render(), 'Post').props.onClick();
  h.input(h.render(), 'What is happening?').props.onChange({ target: { value: 'Text' } });
  const submit = h.button(h.render(), 'Post').props.onClick;
  await Promise.all([submit(), submit()]);
  assert.equal(h.calls.filter((x) => x.table === 'posts').length, 1);
  assert.equal(h.posted(), 1);
});
test('Composer retains stable IDs when a lost response is safely retried', async () => {
  const h = harness({ posts: [{ data: null, error: { message: 'Failed to fetch' } }] });
  h.button(h.render(), 'Post').props.onClick();
  h.input(h.render(), 'What is happening?').props.onChange({ target: { value: 'Keep this draft' } });
  await h.button(h.render(), 'Post').props.onClick();
  assert.equal(h.posted(), 0);
  assert.equal(h.input(h.render(), 'What is happening?').props.value, 'Keep this draft');
  await h.button(h.render(), 'Retry').props.onClick();
  assert.equal(h.posted(), 1);
  assert.equal(h.calls[0].payload[0].id, h.calls[1].payload[0].id);
  assert.equal(h.calls[1].options.ignoreDuplicates, true);
});

test('idempotent writes can retry lost responses but keep confirmed checkpoints', async()=>{const {PublicationAttempt}=webPublication;const p=new PublicationAttempt();let calls=0;await assert.rejects(()=>p.writeIdempotent('stable',async()=>{calls++;throw Error('lost');}));assert.equal(p.uncertain,false);await p.writeIdempotent('stable',async()=>{calls++;return{data:'same-id',error:null};});assert.equal(await p.writeIdempotent('stable',async()=>{throw Error('must not replay');}),'same-id');assert.equal(calls,2);});
