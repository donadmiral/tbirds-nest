// Compiled declarations and calculated contrast for known media surfaces.
// This deliberately does not simulate layout, a browser, or the full cascade.
/* eslint-disable @typescript-eslint/no-require-imports -- Node runs this standalone regression as CommonJS. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { before, test } = require('node:test');
const postcss = require('postcss');
const tailwind = require('@tailwindcss/postcss');
const ts = require('typescript');
const web = path.join(__dirname, '..');
const source = process.env.THEATER_SOURCE_ROOT || web;

function component(file) {
  const tree = ts.createSourceFile(file, fs.readFileSync(path.join(source, 'components', file), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const elements = [], constants = new Map();
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) constants.set(node.name.text, node.initializer);
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) elements.push(node);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  function value(node) {
    if (!node) return '';
    if (ts.isStringLiteralLike(node)) return node.text;
    if (ts.isJsxExpression(node) || ts.isParenthesizedExpression(node)) return value(node.expression);
    if (ts.isIdentifier(node)) return value(constants.get(node.text));
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) return value(node.left) + value(node.right);
    if (ts.isConditionalExpression(node)) return value(node.whenTrue) + ' ' + value(node.whenFalse);
    return '';
  }
  const opening = node => ts.isJsxElement(node) ? node.openingElement : node;
  const attr = (node, name) => value(opening(node).attributes.properties.find(p => ts.isJsxAttribute(p) && p.name.text === name)?.initializer);
  return { tag: node => opening(node).tagName.getText(tree), text: node => node.getText(tree), attr,
    classes: node => attr(node, 'className'), find(predicate) { const node = elements.find(predicate); assert.ok(node, 'Missing fixture in '+file); return node; } };
}
const gallery = component('MediaGallery.tsx'), player = component('VideoPlayer.tsx'), comments = component('Comments.tsx'), menu = component('PostMenu.tsx');
const dialog = gallery.find(n => gallery.attr(n, 'role') === 'dialog');
const pick = (c, predicate) => c.classes(c.find(predicate));
const classes = {
  theater: gallery.classes(dialog),
  sidebar: pick(gallery, n => gallery.tag(n) === 'aside'),
  handle: pick(gallery, n => n.pos >= dialog.pos && gallery.tag(n) === 'span' && gallery.classes(n).includes('text-[12px]') && gallery.text(n).includes('author_username')),
  footer: pick(gallery, n => gallery.tag(n) === 'Link' && gallery.text(n).includes('Open the full post')),
  next: pick(gallery, n => n.pos >= dialog.pos && gallery.attr(n, 'aria-label') === 'Next media'),
  zoom: pick(gallery, n => gallery.attr(n, 'aria-label') === 'Reset zoom'),
  comments: pick(gallery, n => gallery.tag(n) === 'div' && gallery.classes(n).includes('[&_*]:text-white')),
  menu: pick(gallery, n => gallery.tag(n) === 'span' && gallery.text(n).includes('<PostMenu')),
  player: pick(player, n => player.attr(n, 'aria-label') === 'Video player'),
  control: pick(player, n => player.attr(n, 'aria-label') === 'Back 10 seconds'),
  select: pick(player, n => player.tag(n) === 'select'),
  textarea: pick(comments, n => comments.tag(n) === 'textarea'),
  send: pick(comments, n => comments.tag(n) === 'button' && comments.classes(n).includes('bg-pearl')),
  commentMenu: pick(comments, n => comments.tag(n) === 'span' && comments.classes(n).includes('bg-navy')),
  copyComment: pick(comments, n => comments.tag(n) === 'button' && comments.text(n).includes('Copy text')),
  popup: pick(menu, n => menu.tag(n) === 'div' && menu.classes(n).includes('bg-white')),
  popupItem: pick(menu, n => menu.tag(n) === 'button' && menu.text(n).includes('Copy post text')),
};
let compiled;
before(async () => {
  const css = fs.readFileSync(path.join(source, 'app/globals.css'), 'utf8').replace('@import "tailwindcss";', '@import "tailwindcss" source(none);')
    + '\n@source inline(' + JSON.stringify(Object.values(classes).join(' ')) + ');';
  compiled = (await postcss([tailwind({ base: web })]).process(css, { from: path.join(web, 'app/globals.css') })).root;
});
const resolve = (value, vars) => {
  for (let i = 0; i < 10 && value?.includes('var('); i++) value = value.replace(/var\((--[\w-]+)\)/g, (_, key) => vars[key] ?? '');
  return value;
};
function rule(selector) {
  const result = {};
  compiled.walkRules(node => {
    if (node.selectors.includes(selector)) for (const d of node.nodes || []) if (d.type === 'decl') result[d.prop] = d.value;
  });
  return result;
}
function scope(vars, selector) { return { ...vars, ...rule(selector) }; }
function scene(dark) {
  let vars = scope({}, ':root');
  if (dark) vars = scope(vars, '.dark');
  const page = { ...vars };
  if (classes.theater.split(/\s+/).includes('theater')) { vars = scope(vars, '.theater'); if (dark) vars = scope(vars, '.dark .theater'); }
  let video = { ...vars }, inlineVideo = { ...page };
  if (classes.player.split(/\s+/).includes('video-player')) {
    video = scope(video, '.video-player');
    inlineVideo = scope(inlineVideo, '.video-player');
  }
  return { page, theater: vars, video, inlineVideo };
}
// Read actual compiled utility declarations, including Tailwind's nested hover
// and color-mix fallback. Callers explicitly apply the known scoped overrides.
function utility(className, prop, vars, variant = '') {
  let result;
  for (const token of className.split(/\s+/)) {
    if (variant ? !token.startsWith(variant+':') : token.includes(':')) continue;
    compiled.walkRules(node => {
      const selector = node.selector.replace(/\\(.)/g, '$1'), prefix = '.'+token;
      if (selector !== prefix && ![':', ' ', '>'].some(suffix => selector.startsWith(prefix+suffix))) return;
      node.walkDecls(prop, d => { result = resolve(d.value, vars); });
    });
  }
  return result;
}
function color(value) {
  assert.ok(value, 'Missing compiled color declaration');
  if (value === 'transparent') return [0,0,0,0];
  if (/^#[\da-f]{3,8}$/i.test(value)) { let hex = value.slice(1); if (hex.length === 3) hex = hex.split('').map(c=>c+c).join(''); return [...[0,2,4].map(i=>parseInt(hex.slice(i,i+2),16)), hex.length === 8 ? parseInt(hex.slice(6),16)/255 : 1]; }
  const mix = value.match(/^color-mix\(in (?:srgb|oklab), (.+) ([\d.]+)%, transparent\)$/);
  if (mix) { const c = color(mix[1]); c[3] *= Number(mix[2])/100; return c; }
  if (/^rgba?\(/.test(value)) { const values = value.match(/[\d.]+/g).map(Number); return values.length === 3 ? [...values,1] : values; }
  throw new Error('Unsupported calculated color: '+value);
}
const over = (fg, bg) => fg.slice(0,3).map((c,i)=>c*fg[3]+bg[i]*(1-fg[3])).concat(1);
const luminance = c => c.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
const ratio = (a,b) => (Math.max(luminance(a),luminance(b))+.05)/(Math.min(luminance(a),luminance(b))+.05);
function contrast(label, foreground, background, backdrop = '#0b0b0d', minimum = 4.5, opacity = 1) {
  const base = color(backdrop), bg = over(color(background), base), fg = over(color(foreground), bg);
  const actualBg = over([...bg.slice(0,3), opacity], base), actualFg = over([...fg.slice(0,3), opacity], base);
  const value = ratio(actualFg, actualBg);
  assert.ok(value >= minimum, `${label}: ${value.toFixed(2)}:1 < ${minimum}:1`);
}
const varsFor = (parent, key, selector) => classes[key].split(/\s+/).includes(selector.slice(1)) ? scope(parent, selector) : parent;
const focusColor = vars => resolve(rule(':focus-visible').outline, vars)?.split(/\s+/).at(-1);
const opacityValue = value => value?.endsWith('%') ? parseFloat(value)/100 : Number(value);
for (const dark of [false, true]) {
  const mode = dark ? 'dark' : 'light';
  test(`${mode}: sidebar text and focus use readable colors`, () => {
    const { theater } = scene(dark), bg = utility(classes.sidebar, 'background-color', theater);
    for (const key of ['handle','footer']) {
      contrast(key, utility(classes[key], 'color', theater), bg);
      const hover = utility(classes[key], 'color', theater, 'hover');
      if (hover) contrast(key+' hover', hover, bg);
    }
    contrast('sidebar focus', focusColor(theater), bg, '#0b0b0d', 3);
  });
  test(`${mode}: actual player/media controls retain contrast over white media`, () => {
    const { theater, video, inlineVideo } = scene(dark);
    for (const [key, vars] of [['control', video], ['control', inlineVideo], ['next', theater], ['zoom', theater]]) {
      const fg = utility(classes[key], 'color', vars);
      contrast(key, fg, utility(classes[key], 'background-color', vars), '#ffffff');
      contrast(key+' hover', fg, utility(classes[key], 'background-color', vars, 'hover'), '#ffffff');
    }
    contrast('player focus', focusColor(video), '#0b0b0d', '#0b0b0d', 3);
    assert.match(rule('.video-player :focus-visible')['box-shadow'] || '', /0 0 0 3px #0b0b0d/, 'Focus has a dark outer edge over bright media');
  });
  test(`${mode}: native speed select and options use readable fixed colors`, () => {
    const { video, inlineVideo } = scene(dark);
    for (const vars of [video, inlineVideo]) {
      for (const selector of ['.video-player select', '.video-player select option']) {
        const declarations = rule(selector);
        contrast(selector, resolve(declarations.color, vars), resolve(declarations['background-color'], vars));
        assert.equal(declarations['color-scheme'], 'dark');
      }
      contrast('speed focus', focusColor(vars), resolve(rule('.video-player select')['background-color'], vars), '#0b0b0d', 3);
    }
  });
  test(`${mode}: comment Send overrides descendant white, with readable placeholder and menu`, () => {
    const { theater } = scene(dark), vars = varsFor(theater, 'comments', '.theater-comments');
    const bg = utility(classes.sidebar, 'background-color', theater);
    assert.ok(utility(classes.comments, 'color', vars, '[&_*]'), 'Existing descendant white rule is compiled');
    const send = rule('.theater-comments button.bg-pearl');
    contrast('Send', resolve(send.color, vars), utility(classes.send, 'background-color', vars), bg);
    contrast('Send hover', resolve(send.color, vars), utility(classes.send, 'background-color', vars), bg, 4.5, opacityValue(utility(classes.send, 'opacity', vars, 'hover')));
    const disabledOpacity = rule('.theater-comments button.bg-pearl:disabled').opacity ?? utility(classes.send, 'opacity', vars, 'disabled');
    contrast('Send disabled', resolve(send.color, vars), utility(classes.send, 'background-color', vars), bg, 4.5, opacityValue(disabledOpacity));
    const inputBg = utility(classes.comments, 'background-color', vars, '[&_textarea]');
    contrast('placeholder', resolve(rule('.theater-comments textarea::placeholder').color, vars), inputBg, bg);
    const menuBg = utility(classes.commentMenu, 'background-color', vars);
    contrast('comment menu text and inherited icon', utility(classes.copyComment, 'color', vars), menuBg, bg);
    contrast('comment menu hover', utility(classes.copyComment, 'color', vars), utility(classes.copyComment, 'background-color', vars, 'hover'), menuBg);
    // The scoped override must be unlayered to beat the descendant utility.
    compiled.walkRules(node => { if (node.selector === '.theater-comments button.bg-pearl') assert.equal(node.parent.type, 'root'); });
  });
  test(`${mode}: popup and its dark-surface trigger have separate focus colors`, () => {
    const { theater } = scene(dark), vars = varsFor(theater, 'menu', '.theater-menu');
    const bg = utility(classes.popup, 'background-color', vars), fg = utility(classes.popupItem, 'color', vars);
    contrast('popup text', fg, bg);
    contrast('popup hover', fg, utility(classes.popupItem, 'background-color', vars, 'hover'), bg);
    contrast('popup focus', focusColor(vars), bg, '#ffffff', 3);
    const triggerVars = scope(vars, '.theater-menu > div > button');
    const sidebar = utility(classes.sidebar, 'background-color', theater);
    contrast('trigger', utility(classes.menu, 'color', vars, '[&>div>button:first-of-type]'), sidebar);
    contrast('trigger hover', utility(classes.menu, 'color', vars, '[&>div>button:first-of-type:hover]'), utility(classes.menu, 'background-color', vars, '[&>div>button:first-of-type:hover]'), sidebar);
    contrast('trigger focus', focusColor(triggerVars), sidebar, '#0b0b0d', 3);
  });
}
test('ordinary page colors still change while the media palette stays fixed', () => {
  const light = scene(false), dark = scene(true);
  assert.notEqual(light.page['--color-ink'], dark.page['--color-ink']);
  for (const key of ['--color-ink','--color-navy','--color-white','--color-porcelain','--focus-ring']) {
    assert.equal(resolve(light.theater[key], light.theater), resolve(dark.theater[key], dark.theater), 'theater '+key);
    assert.equal(resolve(light.video[key], light.video), resolve(dark.video[key], dark.video), 'video '+key);
    assert.equal(resolve(light.inlineVideo[key], light.inlineVideo), resolve(dark.inlineVideo[key], dark.inlineVideo), 'inline video '+key);
  }
});
