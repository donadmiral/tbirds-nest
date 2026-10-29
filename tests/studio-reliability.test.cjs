const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
function compile(source, globals = {}) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, { module, exports: module.exports, ...globals });
  return module.exports;
}
const { saveStudioDraft } = compile(read('shared/studioDraftRetry.ts'));
const validation = compile(read('shared/studioValidation.ts'));
function store() {
  const rows = new Map();
  return { rows, getItem: async key => rows.get(key) ?? null, setItem: async (key, value) => { rows.set(key, value); }, removeItem: async key => { rows.delete(key); } };
}
function deferred() { let resolve, reject; const promise = new Promise((ok, no) => { resolve = ok; reject = no; }); return { promise, resolve, reject }; }
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

test('a lost new-draft response retains the persistent key and retries the same account and payload', async () => {
  const storage = store(); const calls = []; let fail = true; let ids = 0;
  const client = { rpc: async (name, args) => { calls.push({ name, args }); if (fail) throw new Error('response lost'); return { data: 'saved-draft', error: null }; } };
  const input = { ownerId: 'business-a', content: 'Opening tomorrow', media: [] };
  await assert.rejects(saveStudioDraft(client, input, storage, () => `key-${++ids}`), /response lost/);
  assert.equal(storage.rows.size, 1);
  // A new helper invocation has no component memory: the key comes from storage.
  fail = false;
  assert.equal(await saveStudioDraft(client, { ...input }, storage, () => `key-${++ids}`), 'saved-draft');
  assert.equal(calls[0].name, 'studio_save_post_once');
  assert.equal(calls[0].args.p_request_key, calls[1].args.p_request_key);
  assert.equal(calls[1].args.p_expected_user, 'business-a');
  assert.equal(ids, 1); assert.equal(storage.rows.size, 0);
});

test('changed content gets a new creation identity and other accounts never reuse pending identities', async () => {
  const storage = store(); const calls = []; let id = 0;
  const client = { rpc: async (_, args) => { calls.push(args); return { data: null, error: { message: 'offline' } }; } };
  for (const input of [{ ownerId: 'a', content: 'First' }, { ownerId: 'a', content: 'Revised' }, { ownerId: 'b', content: 'Revised' }]) {
    await assert.rejects(saveStudioDraft(client, input, storage, () => `key-${++id}`));
  }
  assert.equal(new Set(calls.map(c => c.p_request_key)).size, 3);
  assert.equal(storage.rows.size, 2);
});

test('existing drafts use their known ID, and failed persistence prevents unsafe new creation', async () => {
  const calls = [];
  const client = { rpc: async (name, args) => { calls.push({ name, args }); return { data: 'draft', error: null }; } };
  const brokenStore = { getItem: async () => { throw new Error('storage blocked'); }, setItem() {}, removeItem() {} };
  await saveStudioDraft(client, { ownerId: 'a', id: 'draft', content: 'Edit' }, brokenStore, () => 'unused');
  assert.equal(calls[0].name, 'studio_save_post'); assert.equal(calls[0].args.p_id, 'draft');
  await assert.rejects(saveStudioDraft(client, { ownerId: 'a', content: 'Create' }, brokenStore, () => 'key'), /recovery/);
  assert.equal(calls.length, 1);
});

test('an absent server save ID never clears recovery, and confirmation cannot clear a newer pending save', async () => {
  const storage = store();
  await assert.rejects(saveStudioDraft({ rpc: async () => ({ data: null, error: null }) }, { ownerId: 'a', content: 'One' }, storage, () => 'first'), /not confirmed/);
  assert.equal(storage.rows.size, 1);
  const pending = deferred();
  const saved = saveStudioDraft({ rpc: () => pending.promise }, { ownerId: 'a', content: 'One' }, storage, () => 'unused');
  await flush();
  await storage.setItem('pc:studio:draft-retry:v1:a', JSON.stringify({ key: 'newer', payload: 'new' }));
  pending.resolve({ data: 'draft', error: null });
  await saved;
  assert.equal(JSON.parse([...storage.rows.values()][0]).key, 'newer');
});

test('campaign dates, budget and delivery cap reject invalid or silently normalized values', () => {
  for (const value of ['2026-02-31 09:00', '2026-13-01 12:00', '2026-10-29 25:00', '2026-10-29 09:65', '2026-1-2 9:00']) assert.equal(validation.parseStudioLocalDate(value), null);
  assert.equal(validation.parseStudioLocalDate('2028-02-29T09:30').getDate(), 29);
  const input = { name: 'Autumn', currency: 'USD', budget: '10.50', starts_at: '2026-11-01T09:00', ends_at: '2026-11-02T09:00' };
  assert.equal(validation.validateCampaignInput(input).budget, 10.5);
  for (const budget of ['-1', 'NaN', 'Infinity', '1.123', '1e4', '9'.repeat(40)]) assert.throws(() => validation.validateCampaignInput({ ...input, budget }));
  assert.throws(() => validation.validateCampaignInput({ ...input, ends_at: input.starts_at }));
  assert.throws(() => validation.validateCampaignInput({ ...input, currency: 'bad' }));
  for (const cap of ['-1', '0', '1.5', '1e4', '2147483648']) assert.throws(() => validation.parseImpressionCap(cap));
  assert.equal(validation.parseImpressionCap('42'), 42); assert.equal(validation.parseImpressionCap(''), null);
});

function handler(file, component, name, globals) {
  const ast = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const target = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === component);
  let expression;
  function visit(node) { if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) expression = node.initializer.getText(ast); ts.forEachChild(node, visit); }
  visit(target.body);
  assert.ok(expression, `${component}.${name} exists`);
  return compile(`exports.run = ${expression}`, globals).run;
}
for (const platform of ['native', 'web']) test(`${platform} Planner serializes same-tick publishes and retains the draft ID after publish failure`, async () => {
  const saved = deferred(); const inputs = []; const alerts = []; let confirmed = false; let closed = 0;
  const editingId = { current: null };
  const working = { current: false };
  const common = { working, editingId, mounted: { current: true }, editorVersion: { current: 2 }, setBusy() {}, setOpen: () => { closed++; }, load: async () => {}, content: 'Hello', media: [], products: [], category: null, when: '', parseLocal: validation.parseStudioLocalDate, parseStudioLocalDate: validation.parseStudioLocalDate };
  const save = async input => { inputs.push(input); return inputs.length === 1 ? saved.promise : 'draft-one'; };
  const publish = async () => confirmed ? 'post-one' : null;
  const globals = platform === 'native' ? { ...common, canPublish: true, meId: 'owner', currentOwner: { current: 'owner' }, saveStudioDraft: (_, input) => save(input), supabase: { rpc: async () => ({ data: await publish(), error: null }) }, AsyncStorage: {}, randomUUID() {}, setEditId() {}, reset() {}, Alert: { alert: (...message) => alerts.push(message) } }
    : { ...common, accountId: 'owner', editor: true, d: { content: 'Hello', body: '', media: [], products: [], category: null, community: null, publishAt: '' }, savePost: save, publishNow: publish, setD() {}, empty: () => ({}), alert: message => alerts.push(message) };
  const run = platform === 'native' ? handler('src/screens/studio/StudioScreen.tsx', 'PlannerSeg', 'save', globals) : handler('web/app/studio/planner/page.tsx', 'PlannerPage', 'save', globals);
  const first = run('now'); await run('now'); assert.equal(inputs.length, 1);
  saved.resolve('draft-one'); await first;
  assert.equal(editingId.current, 'draft-one'); assert.equal(closed, 0); assert.equal(alerts.length, 1); assert.equal(working.current, false);
  confirmed = true; await run('now');
  assert.equal(inputs[1].id, 'draft-one'); assert.equal(closed, 1);
});

function resourceHarness() {
  const slots = []; let index = 0; let pending = []; let owner = 'one'; let fetch;
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => v === b[i]);
  const react = {
    useRef(value) { const i = index++; return slots[i] ?? (slots[i] = { current: value }); },
    useState(value) { const i = index++; if (!(i in slots)) slots[i] = value; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
    useCallback(fn, deps) { const i = index++; if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { deps, value: fn }; return slots[i].value; },
    useEffect(fn, deps) { const i = index++; if (!slots[i] || !same(slots[i].deps, deps)) { pending.push(() => { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; }); } },
  };
  const { useStudioResource } = compile(read('src/hooks/useStudioResource.ts'), { require: name => name === 'react' ? react : { useAuthStore: selector => selector({ session: { user: { id: owner } }, profile: { id: owner } }) } });
  function render(next = fetch, account = owner) { fetch = next; owner = account; index = 0; const value = useStudioResource(fetch, 'Unable to load'); const effects = pending; pending = []; effects.forEach(fn => fn()); return value; }
  return { render };
}
test('Studio resources discard stale search and account responses while preserving refresh failures as errors', async () => {
  const h = resourceHarness(); const old = deferred(); const latest = deferred();
  const first = () => old.promise; const second = () => latest.promise;
  h.render(first); const staleReload = h.render().reload;
  const changed = h.render(second); assert.equal(changed.data, null); assert.equal(changed.loading, true);
  await staleReload(); // A late mutation's old callback must not cancel the newer request.
  old.resolve(['old']); latest.resolve(['new']); await flush();
  assert.equal(h.render().data[0], 'new');
  const other = deferred(); const third = () => other.promise;
  assert.equal(h.render(third, 'other').data, null);
  other.reject(new Error('offline')); await flush();
  assert.equal(h.render().data, null); assert.equal(h.render().error, 'Unable to load'); assert.equal(h.render().loading, false);
});
test('a failed Studio refresh keeps the last confirmed data and shows a retryable error', async () => {
  const h = resourceHarness(); let fail = false;
  const fetch = async () => { if (fail) throw new Error('offline'); return [7]; };
  h.render(fetch); await flush();
  assert.equal(h.render().data[0], 7);
  fail = true; await h.render().reload();
  const value = h.render(); assert.equal(value.data[0], 7); assert.equal(value.error, 'Unable to load'); assert.equal(value.loading, false);
});
