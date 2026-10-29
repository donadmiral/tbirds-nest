const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const compile = file => ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
function moduleFrom(file, context = {}) { const exports = {}; vm.runInNewContext(compile(file), { exports, ...context }); return exports; }
const geometry = moduleFrom('web/lib/storyEditorPostFit.ts');
const { sharedPostFrame } = moduleFrom('shared/storyPresentation.ts');
const nodes = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
const sticker = extra => ({ id: 'post', kind: 'post', text: '', nx: .5, ny: .5, scale: 1, rotation: 0, color: '#fff', postId: 'source', postText: 'Caption', postMediaUrl: 'authorized.jpg', postMediaWidth: 1080, postMediaHeight: 1920, ...extra });
const rect = (width, height, top = 0) => ({ width, height, top, bottom: top + height, left: 0, right: width });

function assertFits(input, result) {
  assert.ok(result && result.scale > 0 && result.scale <= 1);
  const half = input.cardHeight * result.scale / 2;
  assert.ok(result.ny * input.stageHeight - half >= input.top + 12 - .001, 'caption clears the top controls');
  assert.ok(result.ny * input.stageHeight + half <= input.bottom - 12 + .001, 'entire footer clears the dock');
  assert.ok(input.cardWidth * result.scale <= input.stageWidth - 24 + .001, 'card clears the stage edges');
}

test('the measured QA portrait card clears the actual dock, without a magic default scale', () => {
  const input = { stageWidth: 470.25, stageHeight: 836, cardWidth: 352, cardHeight: 626, top: 60, bottom: 746 - 70 };
  const result = geometry.fitStoryEditorPost(input);
  assertFits(input, result);
  assert.equal(70 + result.ny * 836 + 626 * result.scale / 2, 734);
  assert.notEqual(result.scale, 1);
});

for (const [width, height, top, dockHeight] of [[390, 844, 72, 194], [320, 568, 60, 178], [470, 836, 60, 160], [760, 430, 64, 166]]) {
  test(`portrait and landscape posts fit ${width}×${height} with the measured ${dockHeight}px dock`, () => {
    for (const [mediaWidth, mediaHeight] of [[1080, 1920], [1920, 1080]]) {
      const frame = sharedPostFrame({ stageWidth: width, stageHeight: height, mediaWidth, mediaHeight, caption: 'A full caption', hasMedia: true });
      const input = { stageWidth: width, stageHeight: height, cardWidth: frame.width, cardHeight: frame.height, top, bottom: height - dockHeight };
      assertFits(input, geometry.fitStoryEditorPost(input));
    }
  });
}
test('hidden, missing and overlapping layout measurements do not create invalid saved coordinates', () => {
  const input = { stageWidth: 390, stageHeight: 844, cardWidth: 300, cardHeight: 600, top: 60, bottom: 650 };
  for (const extra of [{ stageWidth: 0 }, { stageHeight: 0 }, { cardWidth: 0 }, { cardHeight: NaN }, { top: 650 }]) {
    assert.equal(geometry.fitStoryEditorPost({ ...input, ...extra }), null);
  }
});

function editor({ value = [sticker()], autoCommit = true, ...layoutOverrides } = {}) {
  const layout = { width: 470, height: 836, pageTop: 70, topbarBottom: 60, dockTop: 676, cardWidth: 352, cardHeight: 626, ...layoutOverrides };
  let cursor = 0, dirty = true, tree, effects = [], slots = [];
  const observers = [], writes = [], cards = new Map();
  const equal = (a, b) => a && b && a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
  const hooks = {
    useRef(v) { const i = cursor++; return slots[i] ??= { current: v }; },
    useState(v) { const i = cursor++; if (!(i in slots)) slots[i] = typeof v === 'function' ? v() : v; return [slots[i], next => { const nextValue = typeof next === 'function' ? next(slots[i]) : next; if (!Object.is(nextValue, slots[i])) { slots[i] = nextValue; dirty = true; } }]; },
    useEffect(fn, deps) { const i = cursor++; if (!slots[i] || !equal(slots[i].deps, deps)) { const prior = slots[i]; slots[i] = { deps }; effects.push(() => { prior?.cleanup?.(); slots[i].cleanup = fn(); }); } },
  };
  const stage = { get clientWidth() { return layout.width; }, get clientHeight() { return layout.height; }, getBoundingClientRect: () => rect(layout.width, layout.height, layout.pageTop), querySelectorAll: () => [...cards.values()] };
  const topbar = { getBoundingClientRect: () => rect(layout.width, 44, layout.pageTop + layout.topbarBottom - 44) };
  const dock = { getBoundingClientRect: () => rect(layout.width, layout.height - layout.dockTop, layout.pageTop + layout.dockTop) };
  class ResizeObserver { constructor(callback) { this.callback = callback; this.observed = []; this.active = true; observers.push(this); } observe(element) { this.observed.push(element); } disconnect() { this.active = false; } }
  const fit = moduleFrom('web/components/useStoryPostEditorFit.ts', { require: p => p === 'react' ? hooks : geometry, ResizeObserver });
  const canvas = moduleFrom('shared/storyCanvas.ts');
  const imports = {
    react: hooks, 'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    './useStoryPostEditorFit': fit, './StoryStudio.module.css': { default: new Proxy({}, { get: (_, key) => key }) },
    '../../shared/storyCanvas': canvas, '../../shared/musicAvailability': { MUSIC_CATALOG_ENABLED: false },
    './storyTextAppearance': { stickerCss: () => ({}) }, './StoryEngine': { DrawSvg: 'DrawSvg', extraFontCss: () => ({}), STICKER_ANIM_CSS: '' },
    '@/components/StoryStickerPreview': { StoryStickerPreview: 'StoryStickerPreview' },
    '../../shared/storyMentions': { storyHandles: () => [], currentTextMentions: () => [] },
  };
  const { StoryEditor } = moduleFrom('web/components/StoryEditor.tsx', {
    require: p => imports[p] || new Proxy({}, { get: (_, key) => key }),
    document: { activeElement: null, body: { style: {} }, addEventListener() {}, removeEventListener() {} }, window: {},
    HTMLElement: class {}, requestAnimationFrame: () => 0, cancelAnimationFrame() {}, setTimeout, clearTimeout,
  });
  const props = { value, children: null, onChange(next) { writes.push(next); if (autoCommit) { props.value = next; dirty = true; } } };
  function render() {
    let count = 0;
    while (dirty) {
      assert.ok(++count < 30, 'automatic fit must settle without a render loop'); dirty = false; cursor = 0;
      tree = StoryEditor(props);
      for (const node of nodes(tree)) {
        if (node.props.ref && ['stage', 'topbar', 'dock'].includes(node.props.className)) node.props.ref.current = { stage, topbar, dock }[node.props.className];
        if (node.props['data-story-post-id']) {
          const id = node.props['data-story-post-id'];
          if (!cards.has(id)) cards.set(id, { dataset: { storyPostId: id }, get offsetWidth() { return layout.cardWidth; }, get offsetHeight() { return layout.cardHeight; }, parentElement: stage, setPointerCapture() {}, hasPointerCapture: () => true });
        }
      }
      const pending = effects; effects = []; pending.forEach(fn => fn());
    }
    return tree;
  }
  return {
    props, writes, observers, layout, cards,
    get tree() { return render(); },
    resize(next = {}) { Object.assign(layout, next); for (const observer of observers.filter(x => x.active)) observer.callback(); return render(); },
    update(value) { props.value = value; dirty = true; return render(); },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}

test('actual editor wiring persists the fitted metadata and observes controls plus the complete card', () => {
  const h = editor(); const tree = h.tree;
  assert.equal(h.writes.length, 1);
  const saved = h.props.value[0];
  assertFits({ stageWidth: 470, stageHeight: 836, cardWidth: 352, cardHeight: 626, top: 60, bottom: 676 }, saved);
  const button = nodes(tree).find(n => n.props['data-story-post-id'] === 'post');
  assert.equal(button.props.style.top, `${saved.ny * 100}%`);
  assert.match(button.props.style.transform, new RegExp(`scale\\(${saved.scale}\\)`));
  assert.equal(h.observers[0].observed.length, 4);
  for (let i = 0; i < 10; i++) h.resize();
  assert.equal(h.writes.length, 1, 'unchanged ResizeObserver deliveries do not rewrite metadata');
  h.resize({ dockTop: 630, cardHeight: 670 });
  assertFits({ stageWidth: 470, stageHeight: 836, cardWidth: 352, cardHeight: 670, top: 60, bottom: 630 }, h.props.value[0]);
  h.unmount(); assert.ok(h.observers.every(observer => !observer.active));
});
test('owner pointer placement remains unchanged after a viewport resize', () => {
  const h = editor(); h.tree;
  const button = () => nodes(h.tree).find(n => n.props['data-story-post-id'] === 'post');
  const target = h.cards.get('post');
  button().props.onPointerDown({ button: 0, pointerId: 1, clientX: 100, clientY: 200, currentTarget: target });
  button().props.onPointerMove({ pointerId: 1, clientX: 130, clientY: 180, currentTarget: target });
  button().props.onPointerUp();
  const placed = JSON.stringify(h.props.value[0]); const writes = h.writes.length;
  h.resize({ height: 568, width: 320, dockTop: 390, cardHeight: 358 });
  assert.equal(JSON.stringify(h.props.value[0]), placed); assert.equal(h.writes.length, writes); h.unmount();
});
test('saved placements, keyboard edits and external restored edits are not overwritten', () => {
  const saved = sticker({ ny: .3, scale: .75 }); const existing = editor({ value: [saved] }); existing.tree; existing.resize({ dockTop: 500 });
  assert.equal(existing.writes.length, 0); assert.equal(existing.props.value[0], saved); existing.unmount();
  const h = editor(); nodes(h.tree).find(n => n.props['data-story-post-id'] === 'post').props.onKeyDown({ key: 'ArrowUp', shiftKey: false, preventDefault() {} });
  const moved = JSON.stringify(h.props.value); const writes = h.writes.length; h.resize({ dockTop: 500 });
  assert.equal(JSON.stringify(h.props.value), moved); assert.equal(h.writes.length, writes); h.unmount();
  const other = editor(); other.tree; other.update([sticker({ nx: .35, ny: .25, scale: .8 })]); const count = other.writes.length; other.resize({ dockTop: 500 });
  assert.equal(other.writes.length, count); assert.equal(other.props.value[0].nx, .35); other.unmount();
});
test('pending parent updates do not cause duplicate writes or defeat an owner replacement', () => {
  const h = editor({ autoCommit: false }); h.tree; h.resize(); h.resize(); assert.equal(h.writes.length, 1);
  h.update([sticker({ nx: .2, ny: .25, scale: .7 })]); h.resize({ dockTop: 500 }); assert.equal(h.writes.length, 1); h.unmount();
});
test('a hidden editor waits for visible measurements before fitting', () => {
  const h = editor({ width: 0, height: 0 }); h.tree; assert.equal(h.writes.length, 0);
  h.resize({ width: 470, height: 836 }); assert.equal(h.writes.length, 1); h.unmount();
});
test('multiline preview captions include their real footer height in fitting', () => {
  const hooks = { useRef: () => ({ current: null }), useState: v => [v, () => {}], useEffect() {} };
  const { SharedPostStory } = moduleFrom('web/components/SharedPostStory.tsx', { require: p => p === 'react' ? hooks : p === 'react/jsx-runtime' ? { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) } : p.endsWith('storyPresentation') ? { sharedPostFrame } : new Proxy({}, { get: (_, key) => key }) });
  const s = sticker({ postText: 'A\nB\nC' });
  const preview = SharedPostStory({ sticker: s, paused: true, preview: true });
  assert.equal(preview.props.style.height, undefined, 'fixed height would let the footer overflow without ResizeObserver seeing it');
  assert.ok(preview.props.style.minHeight > 0);
  const actualHeight = preview.props.style.minHeight + 44; // Three rendered lines, instead of a one-line character-count estimate.
  const h = editor({ value: [s], cardHeight: actualHeight }); h.tree;
  assertFits({ stageWidth: 470, stageHeight: 836, cardWidth: 352, cardHeight: actualHeight, top: 60, bottom: 676 }, h.props.value[0]);
  h.resize({ cardHeight: actualHeight + 80, dockTop: 610 });
  assertFits({ stageWidth: 470, stageHeight: 836, cardWidth: 352, cardHeight: actualHeight + 80, top: 60, bottom: 610 }, h.props.value[0]); h.unmount();
});
