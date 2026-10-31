const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const text = n => n == null ? '' : typeof n === 'string' || typeof n === 'number' ? String(n) : Array.isArray(n) ? n.map(text).join('') : text(n.props?.children);
function host() {
  let cursor = 0; const slots = [], pending = [];
  const hooks = {
    useState(value) { const i = cursor++; if (!(i in slots)) slots[i] = typeof value === 'function' ? value() : value; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
    useRef(value) { const i = cursor++; return slots[i] ||= { current: value }; },
    useId() { return 'id-' + cursor++; },
    useEffect(fn, deps) { const i = cursor++; if (!slots[i] || !deps.every((v, j) => Object.is(v, slots[i].deps[j]))) { slots[i]?.cleanup?.(); slots[i] = { deps }; pending.push(() => { slots[i].cleanup = fn(); }); } },
  };
  return { hooks, render(fn) { cursor = 0; return fn(); }, commit() { pending.splice(0).forEach(fn => fn()); }, destroy() { slots.forEach(x => x?.cleanup?.()); } };
}
function load(file, h, imports, globals = {}) {
  const module = { exports: {} };
  let source = fs.readFileSync(file, 'utf8');
  if (file.endsWith('page.tsx')) source += '\nexport { ListingDetails };';
  const jsx = (type, props) => ({ type, props });
  vm.runInNewContext(ts.transpileModule(source, { fileName: file, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, {
    module, exports: module.exports, console, queueMicrotask, setTimeout, clearTimeout, ...globals,
    require(id) { if (id === 'react') return h.hooks; if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx }; if (id.endsWith('.module.css')) return new Proxy({}, { get: (_, k) => String(k) }); if (id in imports) return imports[id]; throw new Error(id); },
  });
  return module.exports;
}
function nodes(root) { const a = []; function walk(n) { if (!n || typeof n !== 'object') return; if (Array.isArray(n)) return n.forEach(walk); a.push(n); if (n.type !== 'Dialog' || n.props.open) walk(n.props?.children); } walk(root); return a; }
function listing(rpc) {
  const h = host(), calls = []; let tree;
  const client = { auth: { getSession: async () => ({ data: { session: { user: { id: 'buyer' } } } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) }, rpc: async (name, args) => { calls.push({ name, args }); return rpc ? rpc(name, args) : { data: 'conversation', error: null }; } };
  const imports = { 'next/image': 'img', 'next/link': 'a', 'next/navigation': { useParams: () => ({ id: 'listing' }), useRouter: () => ({ push() {} }) }, 'lucide-react': new Proxy({}, { get: (_, k) => k }), '@/lib/supabase/client': { createClient: () => client }, '@/lib/profileLookup': { profilePath: () => '/seller' }, '@/lib/market': { getListing: async () => ({ id: 'listing', seller_id: 'seller', title: 'Fixture item', images: [], status: 'available', currency: 'USD', price: 30 }), getSavedListingIds: async () => new Set(), toggleSaved() {}, priceLabel: x => '$' + x.price } };
  for (const name of ['PersonName', 'SellerTrust', 'MarketOrders', 'MarketReportForm', 'SellerReviews', 'RelativeTime']) imports['@/components/' + name] = { [name]: name };
  imports['@/components/ProductDialog'] = { ProductDialog: 'Dialog' };
  const { ListingDetails } = load(path.join(__dirname, '../app/market/[id]/page.tsx'), h, imports);
  const render = () => { tree = h.render(() => ListingDetails({ id: 'listing' })); h.commit(); };
  const all = () => nodes(tree), button = name => all().find(n => n.type === 'button' && text(n) === name);
  const click = name => { const b = button(name); assert.ok(b, name); if (!b.props.disabled) b.props.onClick(); render(); };
  const flush = async () => { for (let i = 0; i < 5; i++) { await new Promise(setImmediate); render(); } };
  render();
  return { calls, click, button, flush, render, dialog: () => all().find(n => n.type === 'Dialog' && n.props.title !== 'Block this seller?' && n.props.title !== 'Mark this item as sold?'), fill(value) { all().find(n => n.type === 'input').props.onChange({ target: { value } }); render(); }, value: () => all().find(n => n.type === 'input')?.props.value, submit() { all().find(n => n.type === 'form').props.onSubmit({ preventDefault() {} }); render(); }, destroy: h.destroy };
}
for (const review of [false, true]) test('explicit Cancel at ' + (review ? 'review' : 'compose') + ' preserves draft without RPC', async () => {
  const a = listing(); await a.flush(); a.click('Make offer'); a.fill('21.50'); if (review) a.submit(); a.click('Cancel'); assert.equal(a.dialog().props.open, false); assert.equal(a.calls.length, 0); a.click('Make offer'); assert.equal(a.value(), '21.50'); assert.equal(a.dialog().props.keyboardSafe, true); a.destroy();
});
test('busy submission blocks Cancel/close and duplicate dispatch, then confirms once', async () => {
  let finish; const held = new Promise(resolve => { finish = resolve; }); const a = listing(name => name === 'make_offer' ? held : Promise.resolve({ data: 'conversation', error: null })); await a.flush(); a.click('Make offer'); a.fill('21'); a.submit(); a.submit(); await a.flush(); assert.equal(a.button('Cancel').props.disabled, true); a.dialog().props.onClose(); a.render(); assert.equal(a.dialog().props.open, true); a.submit(); await a.flush(); assert.equal(a.calls.filter(x => x.name === 'make_offer').length, 1); finish({ error: null }); await a.flush(); assert.equal(a.dialog().props.open, false); a.click('Make offer'); assert.equal(a.value(), ''); a.destroy();
});
test('failed submission preserves review and allows Cancel/reopen with original draft', async () => {
  const a = listing(async () => { throw new Error('controlled failure'); }); await a.flush(); a.click('Make offer'); a.fill('21'); a.submit(); a.submit(); await a.flush(); assert.equal(a.button('Cancel').props.disabled, false); a.click('Cancel'); a.click('Make offer'); assert.equal(a.value(), '21'); a.destroy();
});
function dialog() {
  const h = host(), listeners = new Map(), properties = new Map(); let closed = 0, props, tree;
  const viewport = { height: 844, offsetTop: 0, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  const element = { open: false, style: { setProperty: (k, v) => properties.set(k, v), removeProperty: k => properties.delete(k) }, showModal() { this.open = true; }, close() { this.open = false; }, getBoundingClientRect: () => ({ left: 8, right: 382, top: 8, bottom: 400 }) };
  const { ProductDialog } = load(path.join(__dirname, '../components/ProductDialog.tsx'), h, { 'lucide-react': { X: 'svg' } }, { window: { visualViewport: viewport }, document: { activeElement: null, body: { style: { overflow: '' } } }, HTMLElement: class {} });
  function render(next) { props = next; tree = h.render(() => ProductDialog({ title: 'Offer', children: 'body', onClose: () => closed++, ...props })); tree.props.ref.current = element; h.commit(); }
  return { render, viewport, listeners, properties, get tree() { return tree; }, get closed() { return closed; }, destroy: h.destroy };
}
test('visual viewport updates height/offset and cleans both listeners and inline properties', () => {
  const a = dialog(); a.render({ open: true, keyboardSafe: true }); assert.equal(a.properties.get('--dialog-viewport-height'), '844px'); a.viewport.height = 320; a.viewport.offsetTop = 63; a.listeners.get('resize')(); assert.equal(a.properties.get('--dialog-viewport-height'), '320px'); assert.equal(a.properties.get('--dialog-viewport-top'), '63px'); a.destroy(); assert.equal(a.listeners.size, 0); assert.equal(a.properties.size, 0);
});
test('ordinary dialogs have no visual viewport listeners; Escape/backdrop respect busy', () => {
  const a = dialog(); a.render({ open: true, busy: true }); assert.equal(a.listeners.size, 0); a.tree.props.onCancel({ preventDefault() {} }); a.tree.props.onClick({ target: a.tree.props.ref.current, currentTarget: a.tree.props.ref.current, clientX: 0, clientY: 0 }); assert.equal(a.closed, 0); a.render({ open: true, busy: false }); a.tree.props.onCancel({ preventDefault() {} }); a.tree.props.onClick({ target: a.tree.props.ref.current, currentTarget: a.tree.props.ref.current, clientX: 0, clientY: 0 }); assert.equal(a.closed, 2); a.destroy();
});
