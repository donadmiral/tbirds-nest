const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const modules = new Map();
function load(relative) {
  const file = path.resolve(root, relative);
  if (modules.has(file)) return modules.get(file);
  const exports = {}; modules.set(file, exports);
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(js, { exports, require(name) { return load(path.relative(root, path.resolve(path.dirname(file), name + '.ts'))); } });
  return exports;
}
const { storyPhotoColorMatrix: matrix, IDENTITY_COLOR_MATRIX: identity, storyPhotoSpatialAdjust } = load('shared/storyColorMatrix.ts');
const { STORY_FILTERS } = load('shared/storyFilterAppearance.ts');
const initialize = require('canvaskit-wasm');
let CK;
test.before(async () => { CK = await initialize({ locateFile: file => require.resolve('canvaskit-wasm/bin/' + file) }); });
// This renders through Skia and reads the resulting RGBA pixels. It catches
// mismatched offset units and no-op/color-plane regressions that state tests miss.
function render(color, look) {
  const surface = CK.MakeSurface(2, 2), paint = new CK.Paint(), filter = CK.ColorFilter.MakeMatrix(matrix(look));
  paint.setColor(CK.Color4f(...color, 1)); paint.setColorFilter(filter);
  surface.getCanvas().drawRect(CK.XYWHRect(0, 0, 2, 2), paint); surface.flush();
  const image = surface.makeImageSnapshot();
  const pixel = Array.from(image.readPixels(0, 0, { width: 1, height: 1, colorType: CK.ColorType.RGBA_8888, alphaType: CK.AlphaType.Unpremul, colorSpace: CK.ColorSpace.SRGB }));
  image.delete(); paint.delete(); filter.delete(); surface.delete(); return pixel;
}
test('neutral edits and zero filter intensity leave the decoded pixels unchanged', () => {
  assert.deepEqual(Array.from(matrix(null)), Array.from(identity));
  assert.deepEqual(render([.2,.4,.6], null), [51,102,153,255]);
  assert.deepEqual(render([.2,.4,.6], { filterId: 'inkwell', filterAmt: 0 }), [51,102,153,255]);
});
test('brightness increases and decreases real channel values, retaining alpha', () => {
  assert.deepEqual(render([.2,.4,.6], { adjust: { bri: 100 } }), [102,204,255,255]);
  const dark = render([.2,.4,.6], { adjust: { bri: -100 } });
  assert.ok(Math.abs(dark[0] - 26) <= 1 && Math.abs(dark[1] - 51) <= 1 && Math.abs(dark[2] - 77) <= 1); assert.equal(dark[3], 255);
});
test('saturation and monochrome presets change pixel chroma rather than tinting it', () => {
  const gray = render([.8,.3,.1], { adjust: { sat: -100 } });
  assert.equal(gray[0], gray[1]); assert.equal(gray[1], gray[2]);
  const ink = render([.8,.3,.1], { filterId: 'inkwell' });
  assert.equal(ink[0], ink[1]); assert.equal(ink[1], ink[2]);
  assert.deepEqual(render([.8,.3,.1], { filterId: 'inkwell', filterAmt: null }), ink);
});
test('contrast, warmth, tint, fade and each tonal slider alter the actual photo', () => {
  const neutral = render([.2,.4,.6], null);
  for (const key of ['con','warm','tint','hi','sh','fade']) assert.notDeepEqual(render([.2,.4,.6], { adjust: { [key]: 80 } }), neutral, key);
  const contrastDark = render([.25,.25,.25], { adjust: { con: 100 } });
  const contrastLight = render([.75,.75,.75], { adjust: { con: 100 } });
  assert.ok(contrastDark[0] < 64 && contrastLight[0] > 191);
  const warm = render([.5,.5,.5], { adjust: { warm: 100 } }); assert.ok(warm[0] > warm[2]);
});
test('highlights and shadows depend on pixel luminance, not location on the canvas', () => {
  const dark = render([.1,.1,.1], null), light = render([.8,.8,.8], null);
  const shadowDark = render([.1,.1,.1], { adjust: { sh: 100 } }), shadowLight = render([.8,.8,.8], { adjust: { sh: 100 } });
  assert.ok(shadowDark[0] - dark[0] > shadowLight[0] - light[0]);
  const hiDark = render([.1,.1,.1], { adjust: { hi: 100 } }), hiLight = render([.8,.8,.8], { adjust: { hi: 100 } });
  assert.ok(hiLight[0] - light[0] > hiDark[0] - dark[0]);
});
test('every saved filter has finite Skia output and partial intensity changes its result', () => {
  for (const filter of STORY_FILTERS) {
    const full = render([.15,.45,.72], { filterId: filter.id }), half = render([.15,.45,.72], { filterId: filter.id, filterAmt: 50 });
    assert.notDeepEqual(full, half, filter.id);
    assert.equal(full[3], 255); assert.ok(matrix({ filterId: filter.id }).every(Number.isFinite));
  }
});
test('photo playback retains only spatial grain and vignette overlays, avoiding a second color grade', () => {
  assert.equal(storyPhotoSpatialAdjust({ bri: 60, con: 30, sat: -100 }), null);
  assert.deepEqual(JSON.parse(JSON.stringify(storyPhotoSpatialAdjust({ bri: 60, con: 30, sat: -100, grain: 15, vig: 40 }))), { grain: 15, vig: 40 });
});
