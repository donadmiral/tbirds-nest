const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../components/NavigationPopover.tsx'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;

function harness() {
  const frames = new Map(), windowEvents = new Map(), documentEvents = new Map(), slots = [];
  let cursor = 0, dirty = true, tree, pending = [], nextFrame = 0, renders = 0, reads = 0;
  let anchor = { right: 400, top: 40, bottom: 80 };
  class Node {
    constructor(parent = null) { this.parent = parent; this.focusCalls = []; }
    contains(node) { return !!node && (node === this || this.contains(node.parent)); }
    focus(options) { this.focusCalls.push(options); document.activeElement = this; }
    getClientRects() { return [{}]; }
    matches() { return false; }
  }
  const trigger = new Node(), panel = new Node(), child = new Node(panel), document = {
    body: new Node(), activeElement: null,
    addEventListener: (name, fn) => documentEvents.set(name, fn),
    removeEventListener: name => documentEvents.delete(name),
  };
  Object.assign(trigger, { getBoundingClientRect() { reads++; return anchor; } });
  Object.assign(panel, { offsetWidth: 200, offsetHeight: 180, querySelector: () => child, querySelectorAll: () => [child] });
  const same = (a, b) => !!a && !!b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const effect = (fn, deps) => {
    const index = cursor++, previous = slots[index];
    if (!previous || !same(previous.deps, deps)) {
      slots[index] = { deps };
      pending.push(() => { previous?.cleanup?.(); slots[index].cleanup = fn(); });
    }
  };
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], next => {
        const value = typeof next === 'function' ? next(slots[index]) : next;
        if (!Object.is(value, slots[index])) { slots[index] = value; dirty = true; }
      }];
    },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useId() { cursor++; return 'popover'; },
    useCallback(fn, deps) { const index = cursor++; if (!slots[index] || !same(slots[index].deps, deps)) slots[index] = { fn, deps }; return slots[index].fn; },
    useEffect: effect, useLayoutEffect: effect,
  };
  const jsx = (type, props) => ({ type, props });
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module, exports: module.exports, Node, document,
    window: { innerWidth: 1200, innerHeight: 800, addEventListener: (name, fn) => windowEvents.set(name, fn), removeEventListener: name => windowEvents.delete(name) },
    requestAnimationFrame: fn => { const id = ++nextFrame; frames.set(id, fn); return id; },
    cancelAnimationFrame: id => frames.delete(id),
    require(id) {
      if (id === 'react') return react;
      if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' };
      if (id === 'react-dom') return { createPortal: element => element };
      if (id === 'next/navigation') return { usePathname: () => '/home' };
      if (id.endsWith('.module.css')) return { popover: 'popover' };
      throw new Error('Unexpected dependency ' + id);
    },
  });
  const nodes = value => Array.isArray(value) ? value.flatMap(nodes) : value && typeof value === 'object' ? [value, ...nodes(value.props?.children)] : [];
  const props = { label: 'Test menu', trigger: 'Open', children: () => jsx('button', { children: 'Action' }) };
  const app = {
    trigger, panel, child,
    get reads() { return reads; }, get renders() { return renders; }, get queuedFrames() { return frames.size; },
    get position() { return nodes(tree).find(node => node.props?.role === 'dialog')?.props.style; },
    flush() {
      let loops = 0;
      while (dirty) {
        assert.ok(loops++ < 20, 'render settles'); dirty = false; cursor = 0; renders++;
        tree = module.exports.NavigationPopover(props);
        for (const node of nodes(tree)) if (node.props?.ref) node.props.ref.current = node.type === 'button' ? trigger : panel;
        const work = pending; pending = []; work.forEach(fn => fn());
      }
      return app;
    },
    open() { nodes(tree).find(node => node.type === 'button').props.onClick(); return app.flush(); },
    move(next) { anchor = next; },
    scroll(target = document.body) { windowEvents.get('scroll')?.({ type: 'scroll', target }); },
    resize() { windowEvents.get('resize')?.({ type: 'resize' }); },
    frame() { const work = [...frames.values()]; frames.clear(); work.forEach(fn => fn()); return app.flush(); },
    escape() { documentEvents.get('keydown')?.({ key: 'Escape', preventDefault() {} }); return app.flush(); },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
    hasScrollListener() { return windowEvents.has('scroll'); },
  };
  return app.flush();
}

test('scroll bursts schedule one menu measurement and unchanged anchors do not rerender', () => {
  const app = harness().open().frame(), before = { reads: app.reads, renders: app.renders };
  for (let index = 0; index < 30; index++) app.scroll();
  assert.equal(app.queuedFrames, 1); assert.equal(app.reads, before.reads);
  app.frame(); assert.equal(app.reads, before.reads + 1); assert.equal(app.renders, before.renders);
  for (let index = 0; index < 30; index++) app.scroll(app.child);
  assert.equal(app.queuedFrames, 0); assert.equal(app.reads, before.reads + 1);
  app.unmount();
});

test('moving anchors reposition once and pending work is cancelled when the menu closes', () => {
  const app = harness().open().frame();
  app.move({ right: 460, top: 100, bottom: 140 }); app.scroll(); app.resize(); app.frame();
  assert.equal(app.position.left, 260); assert.equal(app.position.top, 150);
  const reads = app.reads; app.scroll(); assert.equal(app.queuedFrames, 1);
  app.escape(); assert.equal(app.queuedFrames, 0); assert.equal(app.hasScrollListener(), false);
  app.frame(); assert.equal(app.reads, reads); assert.equal(app.position, undefined);
  assert.equal(app.child.focusCalls[0].preventScroll, true); assert.equal(app.trigger.focusCalls[0].preventScroll, true);
  app.unmount();
});
