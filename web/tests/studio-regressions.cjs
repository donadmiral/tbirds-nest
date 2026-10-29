const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Exercise the real page loaders and click handlers with synthetic RPC replies.
// No network, browser session, live business, or payment is used.
function harness(file, rpc) {
  const slots = []; let cursor = 0; let effects = []; let tree;
  const timers = new Map(); let nextTimer = 0;
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useMemo(fn, deps) { const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { value: fn(), deps }; return slots[i].value; },
    useCallback(fn, deps) { return hooks.useMemo(() => fn, deps); },
    useEffect(fn, deps) { const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) { slots[i]?.cleanup?.(); slots[i] = { deps }; effects.push(() => { slots[i].cleanup = fn(); }); } },
  };
  const client = { rpc };
  const runtime = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: 'Fragment' };
  const stubs = new Proxy({}, { get: (_, key) => String(key) });
  function requireMock(id) {
    if (id === 'react') return hooks;
    if (id === 'react/jsx-runtime') return runtime;
    if (id === '@/lib/supabase/client') return { createClient: () => client };
    if (id === '@/components/StudioShell') return { useStudio: () => ({ me: { role: 'owner' } }) };
    if (id === '@/lib/studio') return { can: () => true };
    if (id === '@/lib/profileLookup') {
      const mod={exports:{}};
      vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../lib/profileLookup.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{module:mod,exports:mod.exports});
      return mod.exports;
    }
    if (id.endsWith('/shared/commerceMoney')) return require('../../shared/commerceMoney.ts');
    if (id.endsWith('/shared/marketOrders')) return require('../../shared/marketOrders.ts');
    if (id === '@/lib/media') return { displayImageUrl: x => x };
    if (id.endsWith('/LoadError')) return { StudioLoadError: 'StudioLoadError' };
    if (id === 'next/link') return { default: 'Link' };
    return stubs;
  }
  const moduleObject = { exports: {} };
  const output = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(output, { require: requireMock, module: moduleObject, exports: moduleObject.exports, alert() {}, confirm: () => true,
    setTimeout: fn => { const id = ++nextTimer; timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id), console });
  const render = () => { cursor = 0; tree = moduleObject.exports.default(); const pending = effects; effects = []; pending.forEach(fn => fn()); return tree; };
  const nodes = () => { const out = []; const walk = node => { if (!node || typeof node !== 'object') return; if (Array.isArray(node)) return node.forEach(walk); out.push(node); walk(node.props?.children); }; walk(tree); return out; };
  const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); render(); };
  const find = predicate => nodes().find(predicate);
  const runTimers = () => { const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); };
  return { render, flush, find, nodes, runTimers, get tree() { return tree; } };
}
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join('') : text(node?.props?.children ?? '');

(async () => {
  let helperFailure = true;
  const helperModule = { exports: {} };
  const helperClient = { auth: { getSession: async () => ({ data: { session: { user: { id: 'synthetic-user' } } } }) }, rpc: async () => ({ data: null, error: helperFailure ? { message: 'offline' } : null }) };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../lib/studio.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports: helperModule.exports, module: helperModule, require: id => id === '@/lib/supabase/client' ? { createClient: () => helperClient } : {} });
  for (const name of ['studioMe', 'studioHome', 'myListings', 'getAutoReplies']) {
    await assert.rejects(helperModule.exports[name](), error => error.message === 'offline', name + ' must surface resolved RPC errors');
  }
  helperFailure = false;
  assert.equal((await helperModule.exports.getAutoReplies()).welcome_enabled, false, 'a genuine empty automation configuration still has safe defaults');

  let fail = true;
  const listing = { id: 'synthetic-listing', title: 'Retained listing', price: 20, currency: 'USD', category: 'Other', images: [], status: 'available', pending_offers: 0, sold_count: 0, in_posts: 0 };
  const commerce = harness('app/studio/commerce/page.tsx', async name => {
    if (fail && name === 'business_receipts') return { data: null, error: { message: 'offline' } };
    return { data: name === 'business_catalog' ? {rows:[listing],next_cursor:null,has_more:false} : name === 'business_receipts' ? {rows:[],next_cursor:null,has_more:false} : {}, error: null };
  });
  commerce.render(); await commerce.flush();
  assert.ok(commerce.find(n => n.type === 'StudioLoadError').props.message, 'RPC errors must be visible');
  assert.equal(text(commerce.tree).includes('No listings here yet'), false, 'failed load is not an empty catalog');
  fail = false; commerce.find(n => n.type === 'StudioLoadError').props.retry(); await commerce.flush();
  assert.ok(text(commerce.tree).includes('Retained listing'), 'retry loads catalog');
  fail = true; commerce.find(n => n.type === 'StudioLoadError').props.retry(); await commerce.flush();
  assert.ok(text(commerce.tree).includes('Retained listing'), 'failed refresh retains successful data');

  let reviewFail = true; const writes = [];
  const review = { id: 'synthetic-review', rating: 5, body: 'Useful', name: 'Fixture', username: 'fixture', created_at: '2026-10-01', reply: 'Original reply', helpful_count: 0 };
  const reviews = harness('app/studio/reviews/page.tsx', async (name, args) => {
    if (name === 'studio_reply_review') { writes.push(args); return { error: null }; }
    if (reviewFail) return { data: null, error: { message: 'offline' } };
    return { data: { average: 5, count: 1, distribution: { 5: 1 }, reviews: [review] }, error: null };
  });
  reviews.render(); await reviews.flush();
  assert.ok(reviews.find(n => n.type === 'StudioLoadError').props.message);
  assert.equal(text(reviews.tree).includes('Loading'), false, 'failed reviews load exits spinner');
  reviewFail = false; reviews.find(n => n.type === 'StudioLoadError').props.retry(); await reviews.flush();
  reviews.find(n => n.type === 'button' && text(n) === 'Edit reply').props.onClick(); reviews.render();
  reviews.find(n => n.type === 'button' && text(n) === 'Remove reply').props.onClick(); await reviews.flush();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].p_body, '', 'remove must not resubmit the stale draft');
  assert.equal(writes[0].p_review, review.id);

  let releaseOld;
  const person = name => ({ id: name, name, username: name, followed_at: '2026-10-01', paid: 0, messages: 0 });
  const audience = harness('app/studio/audience/page.tsx', async (name, args) => {
    if (name === 'studio_audience') return args.p_q
      ? { data: [person('Current result')], error: null }
      : new Promise(resolve => { releaseOld = () => resolve({ data: [person('Stale result')], error: null }); });
    return { data: name === 'studio_leads' ? [] : { followers: 1, labels: {}, top_cities: [] }, error: null };
  });
  audience.render(); audience.runTimers();
  audience.find(n => n.type === 'input' && n.props.placeholder === 'Search followers').props.onChange({ target: { value: 'current' } });
  audience.render(); audience.runTimers(); await audience.flush();
  assert.ok(text(audience.tree).includes('Current result'));
  releaseOld(); await audience.flush();
  assert.ok(text(audience.tree).includes('Current result'), 'late old filter result cannot replace the current result');
  assert.equal(text(audience.tree).includes('Stale result'), false);
  let campaignsFail=true, postsFail=true;
  const campaign={id:'campaign',name:'Retained campaign',budget:10,currency:'USD',status:'draft',ads:[],impressions:0,clicks:0};
  const ads=harness('app/studio/ads/page.tsx', async name => {
    if(name==='studio_campaigns') { if(campaignsFail) throw new Error('offline'); return {data:[campaign],error:null}; }
    if(name==='studio_my_posts_for_ads') return postsFail ? {data:null,error:{message:'offline'}} : {data:[],error:null};
    return {data:null,error:null};
  });
  ads.render();await ads.flush();
  assert.ok(ads.find(n=>n.type==='StudioLoadError').props.message);
  assert.equal(text(ads.tree).includes('No campaigns yet'),false);
  campaignsFail=false;ads.find(n=>n.type==='StudioLoadError').props.retry();await ads.flush();
  assert.ok(text(ads.tree).includes('Retained campaign'));
  campaignsFail=true;ads.find(n=>n.type==='StudioLoadError').props.retry();await ads.flush();
  assert.ok(text(ads.tree).includes('Retained campaign'),'a failed refresh retains loaded campaigns');
  ads.find(n=>n.type==='button'&&text(n).includes('Add ad')).props.onClick();await ads.flush();
  assert.equal(text(ads.tree).includes('No posts yet'),false,'failed post picker is not an empty list');
  const pickerError=ads.nodes().filter(n=>n.type==='StudioLoadError').at(-1);assert.ok(pickerError.props.message);
  postsFail=false;pickerError.props.retry();await ads.flush();assert.ok(text(ads.tree).includes('No posts yet'));
  console.log('Studio regression checks passed, including RPC errors, retries, retained data, review removal, out-of-order results, and campaign/post picker failures.');
})().catch(error => { console.error(error); process.exitCode = 1; });
