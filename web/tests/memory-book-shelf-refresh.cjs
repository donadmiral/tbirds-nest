const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const compile = file => ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const walk = node => Array.isArray(node) ? node.flatMap(walk) : node && typeof node === 'object' ? [node, ...walk(node.props?.children)] : [];
const ticks = async () => { for (let n = 0; n < 12; n++) await Promise.resolve(); };

function fixture({ failCreate = false } = {}) {
  const shelf = [], reads = new Map(), writes = [];
  const events = { exports: {} };
  vm.runInNewContext(compile('web/lib/memoryBookEvents.ts'), events);
  const bus = events.exports;
  function picker(storyId, ownerId = 'owner-a') {
    let tree, cursor = 0, changed = false, currentOwner = ownerId;
    const slots = [], effects = [], authCallbacks = new Set();
    const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
    const react = {
      useState(initial) {
        const n = cursor++;
        if (!(n in slots)) slots[n] = typeof initial === 'function' ? initial() : initial;
        return [slots[n], next => { const value = typeof next === 'function' ? next(slots[n]) : next; if (!Object.is(value, slots[n])) { slots[n] = value; changed = true; } }];
      },
      useRef(initial) { const n = cursor++; return slots[n] ??= { current: initial }; },
      useEffect(fn, deps) {
        const n = cursor++;
        if (!same(slots[n]?.deps, deps)) { const old = slots[n]; slots[n] = { deps, cleanup: old?.cleanup }; effects.push(() => { slots[n].cleanup?.(); slots[n].cleanup = fn(); }); }
      },
    };
    react.useLayoutEffect = react.useEffect;
    const client = {
      auth: {
        getSession: async () => ({ data: { session: { user: { id: currentOwner } } } }),
        onAuthStateChange(fn) { authCallbacks.add(fn); return { data: { subscription: { unsubscribe: () => authCallbacks.delete(fn) } } }; },
      },
      async rpc(name, args) {
        writes.push({ name, args });
        if (name === 'create_memory_book_presentation') {
          if (failCreate) return { error: Error('Synthetic failure'), data: null };
          const book = { id: 'book-new', title: args.p_title, cover_color: 'cream', cover_design: args.p_cover_design, audience: 'profile', count: 1 };
          shelf.push(book); return { data: book.id, error: null };
        }
        if (name === 'add_memory_page') return { data: null, error: null };
        throw Error('Unexpected RPC ' + name);
      },
    };
    const module = { exports: {} };
    vm.runInNewContext(compile('web/components/SaveToMemory.tsx'), { exports: module.exports, queueMicrotask, require(name) {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: 'Fragment' };
      if (name === 'lucide-react') return { BookHeart: 'BookHeart', X: 'X' };
      if (name === '@/lib/supabase/client') return { createClient: () => client };
      if (name === '@/lib/memoryAlbum') return { getMemoryBooks: async owner => { reads.set(storyId, (reads.get(storyId) ?? 0) + 1); return { books: owner === 'owner-a' ? [...shelf] : [] }; } };
      if (name === '@/lib/memoryBookEvents') return bus;
      if (name.endsWith('/useMemoryDialog')) return { useMemoryDialog: () => ({ current: null }) };
      if (name.endsWith('/MemoryBookCover')) return { MemoryBookCover: 'MemoryBookCover' };
      if (name.endsWith('/memoryBookDesign')) return { memoryCoverMedia: () => ({}), memoryAudienceLabel: () => 'Everyone', MEMORY_FEATURED_DESIGNS: [{ id: 'postcard', label: 'Postcard' }] };
      throw Error('Unexpected import ' + name);
    } });
    const props = { storyId, ownerId, inline: true };
    function render() {
      for (let n = 0; n < 10; n++) { changed = false; cursor = 0; const node=module.exports.SaveToMemory(props);tree = typeof node?.type==='function'?node.type(node.props):node; while (effects.length) effects.shift()(); if (!changed) break; }
      return tree;
    }
    render();
    return {
      render,
      async flush() { for (let n = 0; n < 4; n++) { await ticks(); render(); } },
      nodes: () => walk(tree),
      title(value) { walk(tree).find(n => n.type === 'input').props.onChange({ target: { value } }); render(); },
      create() { walk(tree).find(n => n.type === 'button' && n.props.children === 'Create and add').props.onClick(); },
      book(label) { return walk(tree).find(n => n.type === 'button' && n.props['aria-label'] === label); },
      switchOwner(value) { currentOwner = value; for (const fn of authCallbacks) fn('SIGNED_IN', { user: { id: value } }); render(); },
      unmount() { slots.forEach(s => s?.cleanup?.()); },
    };
  }
  return { picker, reads, writes, bus };
}

test('creating a book for one clip refreshes the other live clip picker without adding its story', async () => {
  const f = fixture(), first = f.picker('story-1'), second = f.picker('story-2');
  try {
    await first.flush(); await second.flush();
    first.title('New shared shelf'); first.create(); await first.flush(); await second.flush();
    assert.equal(first.book('New shared shelf. Already added').props.disabled, true);
    assert.equal(second.book('New shared shelf. Add story to this book').props.disabled, false);
    assert.equal(f.writes.length, 1);
    second.book('New shared shelf. Add story to this book').props.onClick(); await second.flush();
    assert.equal(f.writes[1].name, 'add_memory_page');
    assert.equal(f.writes[1].args.p_story_id, 'story-2');
    assert.equal(second.book('New shared shelf. Already added').props.disabled, true);
  } finally { first.unmount(); second.unmount(); }
});

test('shelf refreshes stay owner-scoped and unsubscribe on account change and unmount', async () => {
  const f = fixture(), a = f.picker('story-a'), b = f.picker('story-b', 'owner-b');
  await a.flush(); await b.flush();
  const beforeB = f.reads.get('story-b');
  f.bus.notifyMemoryBookShelfChanged('owner-a'); await a.flush(); await b.flush();
  assert.equal(f.reads.get('story-b'), beforeB);
  a.switchOwner('owner-b'); const beforeA = f.reads.get('story-a');
  f.bus.notifyMemoryBookShelfChanged('owner-a'); await a.flush();
  assert.equal(f.reads.get('story-a'), beforeA);
  a.unmount(); b.unmount();
  f.bus.notifyMemoryBookShelfChanged('owner-b');
  assert.equal(f.reads.get('story-b'), beforeB);
});

test('failed creation preserves the title and never refreshes another clip as if a book existed', async () => {
  const f = fixture({ failCreate: true }), a = f.picker('story-1'), b = f.picker('story-2');
  try {
    await a.flush(); await b.flush(); const before = f.reads.get('story-2');
    a.title('Keep this title'); a.create(); await a.flush(); await b.flush();
    assert.equal(a.nodes().find(n => n.type === 'input').props.value, 'Keep this title');
    assert.ok(a.nodes().some(n => n.props?.role === 'alert'));
    assert.equal(f.reads.get('story-2'), before);
  } finally { a.unmount(); b.unmount(); }
});
