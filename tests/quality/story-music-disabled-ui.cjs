const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
function compile(file, imports = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText, {
    exports, require(name) { if (!(name in imports)) throw Error(name); return imports[name]; },
  });
  return exports;
}
const availability = compile('shared/musicAvailability.ts');
const runtime = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
const walk = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(walk) : [node, ...walk(node.props?.children)];
test('shipping web sound tray mounts only a working original-video volume control with no audio hooks', () => {
  const { StoryAudioEditor } = compile('web/components/StoryAudioEditor.tsx', {
    '../../shared/musicAvailability': availability,
    react: new Proxy({}, { get() { return () => { throw Error('Music hooks must not run'); }; } }),
    'react/jsx-runtime': runtime, 'lucide-react': {}, '@/lib/storyAudio': {},
    './StoryStudio.module.css': { default: {} },
  });
  const changes = [], props = { owner: 'owner', value: { kind: 'sound', soundId: 'old' }, isVideo: true, disabled: false, mix: { orig: 62 }, onMixChange: value => changes.push(value), onChange() {}, onBusyChange() {} };
  const nodes = walk(StoryAudioEditor(props)), input = nodes.find(n => n.type === 'input');
  assert.equal(input.props['aria-label'], 'Video sound volume'); assert.equal(input.props.value, 62);
  input.props.onChange({ target: { value: '37' } }); assert.equal(changes[0].orig, 37);
  assert.equal(nodes.some(n => n.type === 'audio' || n.props.type === 'file'), false);
  assert.equal(StoryAudioEditor({ ...props, isVideo: false }), null);
});

test('shipping native sound mix exposes only original video volume and mute', () => {
  const source = fs.readFileSync(path.join(root, 'src/components/stories/storyPanels.tsx'), 'utf8');
  const start = source.indexOf('export function AudioMixSheet('), end = source.indexOf('\nexport ', start + 10);
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source.slice(start, end), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText, {
    exports, require: () => runtime, MUSIC_CATALOG_ENABLED: availability.MUSIC_CATALOG_ENABLED,
    pp: {}, View: 'View', Text: 'Text', TouchableOpacity: 'Button', Feather: 'Icon', MiniSlider: 'Slider',
  });
  const changed = [], props = { visible: true, isVideo: true, hasMusic: true, mix: { orig: 62, music: 75 }, onChange: value => changed.push(value), onClose() {} };
  const nodes = walk(exports.AudioMixSheet(props)), sliders = nodes.filter(n => n.type === 'Slider');
  assert.equal(sliders.length, 1); assert.equal(sliders[0].props.value, 62);
  sliders[0].props.onChange(38); assert.equal(changed[0].orig, 38);
  nodes.find(n => n.type === 'Button' && walk(n).some(c => c.type === 'Icon')).props.onPress();
  assert.equal(changed[1].orig, 0);
  assert.equal(nodes.some(n => n.type === 'Text' && n.props.children === 'Music'), false);
  assert.equal(exports.AudioMixSheet({ ...props, isVideo: false }), null);
});
