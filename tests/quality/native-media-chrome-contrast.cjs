const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = process.env.PLATINUM_MEDIA_CHROME_SOURCE || path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
function evaluate(source, requireModule = () => ({}), globals = {}) {
  const module = { exports: {} };
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  vm.runInNewContext(output, { module, exports: module.exports, require: requireModule, ...globals });
  return module.exports;
}
const light = evaluate(read('src/constants/tokens/light.ts')).light;
const dark = evaluate(read('src/constants/tokens/dark.ts')).dark;
const lightsOut = evaluate(read('src/constants/tokens/lightsOut.ts'), () => ({ dark })).lightsOut;
function sheet(file, palette) {
  const source = read(file), tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression; const globals = {};
  for (const statement of tree.statements) if (ts.isVariableStatement(statement)) for (const item of statement.declarationList.declarations) {
    if (ts.isStringLiteral(item.initializer || {})) globals[item.name.getText(tree)] = item.initializer.text;
    if (item.name.getText(tree) === 's') expression = item.initializer.getText(tree);
  }
  assert(expression, 'Actual stylesheet is required');
  return evaluate('export const value = ' + expression, undefined, { ...globals, themedSheet: factory => factory(palette), StyleSheet: { create: styles => styles, absoluteFillObject: {} } }).value;
}
function rgba(value) {
  if (!value || value === 'transparent') return [0, 0, 0, 0];
  if (value.startsWith('#')) {
    let hex = value.slice(1); if (hex.length < 5) hex = [...hex].map(x => x + x).join('');
    assert([6, 8].includes(hex.length));
    return [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16)).concat(hex.length === 8 ? parseInt(hex.slice(6), 16) / 255 : 1);
  }
  const m = /^rgba?\(([^)]+)\)$/.exec(value); assert(m, value);
  const values = m[1].split(',').map(Number); return values.length === 3 ? [...values, 1] : values;
}
const blend = (front, back, opacity = 1) => { const a = front[3] * opacity; return front.slice(0, 3).map((v, i) => v * a + back[i] * (1 - a)); };
const luminance = rgb => rgb.map(n => { const s = n / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [.2126, .7152, .0722][i], 0);
const contrast = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
const pixels = [0, 64, 128, 192, 255].flatMap(r => [0, 64, 128, 192, 255].flatMap(g => [0, 64, 128, 192, 255].map(b => [r, g, b])));
const observations = [];
function checkPair(name, color, background, opacity, minimum, { overlay, groupBackground } = {}) {
  let worst = Infinity;
  for (const pixel of pixels) {
    let restingBack = blend(rgba(background), pixel);
    if (overlay) restingBack = blend(rgba(overlay), restingBack);
    const restingFront = blend(rgba(color), restingBack);
    // Fullscreen buttons fade over the unchanged video. Story touch opacity
    // fades the entire tile, including its image, over the feed canvas.
    const outside = groupBackground ? rgba(groupBackground).slice(0, 3) : pixel;
    const back = restingBack.map((v, i) => v * opacity + outside[i] * (1 - opacity));
    const front = restingFront.map((v, i) => v * opacity + outside[i] * (1 - opacity));
    worst = Math.min(worst, contrast(front, back));
  }
  observations.push({ name, color, background, overlay, groupBackground, opacity, minimum, worst, sampledMediaPixels: pixels.length });
  assert(worst >= minimum, `${name}: ${worst.toFixed(4)} < ${minimum}`);
}
for (const [mode, palette] of Object.entries({ light, dark, lightsOut })) {
  test('actual fullscreen labels and controls retain contrast over bright/dark/colored media in ' + mode, () => {
    const s = sheet('src/components/FullscreenVideo.tsx', palette);
    checkPair(mode + ' skip label', s.btnLbl.color, s.btn.backgroundColor, .7, 4.5);
    checkPair(mode + ' elapsed', s.time.color, s.bottom.backgroundColor, 1, 4.5);
    checkPair(mode + ' duration', s.timeDim.color, s.bottom.backgroundColor, 1, 4.5);
    checkPair(mode + ' ripple', s.rippleTxt.color, s.rippleDisc.backgroundColor, 1, 4.5);
    checkPair(mode + ' close', '#FFFFFF', s.close.backgroundColor, .8, 3);
    checkPair(mode + ' play', '#FFFFFF', s.btnCenter.backgroundColor, .7, 3);
    checkPair(mode + ' position knob', s.knob.backgroundColor, s.bottom.backgroundColor, 1, 3, { overlay: s.track.backgroundColor });
    checkPair(mode + ' position fill', s.fill.backgroundColor, s.bottom.backgroundColor, 1, 3, { overlay: s.track.backgroundColor });
  });
  test('actual story labels have a bounded backdrop in ' + mode, () => {
    const s = sheet('src/components/TrendingStoriesRail.tsx', palette);
    // FeedScreen's SafeAreaView uses surface.canvas; intervening rail/list
    // wrappers are transparent. Ignore the extra dark gradient conservatively.
    checkPair(mode + ' story name', s.tileName.color, s.tileFoot.backgroundColor, .85, 4.5, { groupBackground: palette.surface.canvas });
    checkPair(mode + ' story views', s.tileViews.color, s.tileFoot.backgroundColor, .85, 4.5, { groupBackground: palette.surface.canvas });
  });
}
test('actual TierName can inherit readable media text while retaining its normal verification colors elsewhere', () => {
  let tier = null;
  const colors = { public_figure: '#1D7A38', business: '#5B6470', official: '#B08D3F' };
  const runtime = { jsx: (type, props) => ({ type, props }) };
  const module = evaluate(read('src/components/TierName.tsx'), name => name === 'react/jsx-runtime' ? runtime : name === 'react-native' ? { Text: 'Text' } : name === './VerifiedBadge' ? { useVerifiedTier: () => tier, getTierColor: key => colors[key] || null } : {});
  for (tier of [null, ...Object.keys(colors)]) {
    const media = module.default({ text: 'Visible name', userId: 'fixture-user', baseStyle: { color: '#FFFFFF' }, colorMode: 'inherit' });
    assert.equal(Object.assign({}, ...media.props.style.filter(Boolean)).color, '#FFFFFF', String(tier));
    const normal = module.default({ text: 'Name', userId: 'fixture-user', baseStyle: { color: '#18294C' } });
    assert.equal(Object.assign({}, ...normal.props.style.filter(Boolean)).color, colors[tier] || '#18294C');
  }
  const tree = ts.createSourceFile('rail.tsx', read('src/components/TrendingStoriesRail.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let matched = false;
  function visit(node) {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(tree) === 'TierName') matched = node.attributes.properties.some(prop => ts.isJsxAttribute(prop) && prop.name.getText(tree) === 'colorMode' && prop.initializer?.text === 'inherit');
    ts.forEachChild(node, visit);
  }
  visit(tree); assert(matched, 'The actual story tile must select the readable name mode');
});
test.after(() => {
  if (process.env.PLATINUM_MEDIA_CHROME_OUTPUT) fs.writeFileSync(process.env.PLATINUM_MEDIA_CHROME_OUTPUT, JSON.stringify({ scope: 'Actual source style factories, real TierName render and inspected opacity/background composition. Not native pixel, font-scale or device acceptance.', observations }, null, 2) + '\n');
});
