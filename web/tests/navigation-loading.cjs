const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '../..');
function load(file, imports = {}, globals = {}) {
  const module = { exports: {} };
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const output = ts.transpileModule(source, { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(output, { module, exports: module.exports, URL, Map, Set, AbortController, setTimeout, clearTimeout, process: { env: { NEXT_PUBLIC_SUPABASE_URL: 'https://fixture.invalid' } }, require(name) { if (name in imports) return imports[name]; throw Error('Unexpected dependency: ' + name); }, ...globals });
  return module.exports;
}
const navigation = load('web/lib/navigation.ts');
const api = load('web/lib/navigationChromeMemory.ts', { './navigation': navigation });
const identity = { ownerId: 'A', name: 'Alice', username: 'alice', business: false, avatarUrl: 'https://fixture.invalid/storage/v1/object/public/avatars/A.png' };
function fixture() {
  let clock = 1000, session = { owner: 'A', scope: '1:A', revision: 1, initialized: true, changed: false };
  const cache = load('shared/navigationCache.ts').createNavigationCache({ clock: () => clock });
  cache.setScope(session.scope);
  const store = { cache, getSnapshot: () => session, getServerSnapshot: () => session, subscribe() { return () => {}; } };
  return { store, get session() { return session; }, change(next) { session = { ...session, ...next }; cache.setScope(session.scope); }, advance(ms) { clock += ms; } };
}
test('records only verified navigation fields and restores within the exact live owner/scope/revision', () => {
  const h = fixture();
  assert.equal(api.rememberNavigationChrome(h.store, h.session, { ...identity, privatePage: 'not navigation' }), true);
  const value = api.readNavigationChrome(h.store, h.session, '/jobs');
  assert.equal(value.name, 'Alice'); assert.equal(value.privatePage, undefined);
  const saved = h.store.cache.read(h.session.scope, 'shell:verified-navigation');
  assert.equal(saved.privatePage, undefined); assert.equal(saved.scope, '1:A'); assert.equal(saved.revision, 1);
  assert.equal(api.rememberNavigationChrome(h.store, h.session, { ...identity, ownerId: 'B' }), false);
});
test('sign-out, same-owner replacement and A to B to A invalidate old snapshots and late publications', () => {
  for (const changes of [[{ owner: null, scope: null, revision: 2 }], [{ owner: 'A', scope: '2:A', revision: 2 }], [{ owner: 'B', scope: '2:B', revision: 2 }, { owner: 'A', scope: '3:A', revision: 3 }]]) {
    const h = fixture(), captured = h.session;
    api.rememberNavigationChrome(h.store, captured, identity);
    changes.forEach(value => h.change(value));
    assert.equal(api.readNavigationChrome(h.store, h.session, '/jobs'), null);
    assert.equal(api.readNavigationChrome(h.store, captured, '/jobs'), null);
    assert.equal(api.rememberNavigationChrome(h.store, captured, identity), false);
  }
});
test('unresolved or sticky changed sessions reject both reads and new late server recorders independently of the root boundary', () => {
  for (const change of [{ initialized: false }, { changed: true }, { owner: null }, { scope: null }]) {
    const h = fixture(); api.rememberNavigationChrome(h.store, h.session, identity); h.change(change);
    assert.equal(api.readNavigationChrome(h.store, h.session, '/jobs'), null);
    assert.equal(api.rememberNavigationChrome(h.store, h.session, identity), false);
  }
});
test('cache age is bounded while routine same-session reads retain navigation', () => {
  const h = fixture(); api.rememberNavigationChrome(h.store, h.session, identity);
  h.advance(29 * 60000); assert.ok(api.readNavigationChrome(h.store, h.session, '/notifications'));
  h.advance(60000); assert.equal(api.readNavigationChrome(h.store, h.session, '/notifications'), null);
});
test('route allowlist covers current standard layouts; auth, public, professional and unknown profiles remain neutral', () => {
  const app = path.join(root, 'web/app');
  for (const entry of fs.readdirSync(app)) {
    if (entry === '[username]') continue;
    const layout = path.join(app, entry, 'layout.tsx');
    if (fs.existsSync(layout) && fs.readFileSync(layout, 'utf8').includes('<AppShell') && entry !== 'studio') {
      assert.equal(api.supportsNavigationChrome('/' + entry + '/detail', identity), true, entry);
    } else if (fs.existsSync(path.join(app, entry, 'page.tsx'))) {
      assert.equal(api.supportsNavigationChrome('/' + entry, { ...identity, username: entry }), false, entry);
    }
  }
  for (const p of ['/', '/login', '/auth/callback', '/studio/team', '/post/one', '/story/new', '/bob', '/alice/private', '/jobs-unrelated']) assert.equal(api.supportsNavigationChrome(p, identity), false, p);
  for (const p of ['/jobs', '/notifications', '/alice', '/alice/follows', '/A']) assert.equal(api.supportsNavigationChrome(p, identity), true, p);
});
test('expired, signed and opaque avatar locators are omitted without changing canonical public images', () => {
  for (const url of ['https://fixture.invalid/storage/v1/object/sign/avatars/photo?token=expired', 'https://fixture.invalid/storage/v1/object/sign/avatars/photo', 'https://fixture.invalid/storage/v1/object/authenticated/avatars/photo', 'https://fixture.invalid/functions/v1/media-content/avatars/photo?token=current', 'https://fixture.invalid/photo?X-Amz-Signature=old', 'https://user:password@fixture.invalid/photo', 'https://files.example.invalid/private/capability/synthetic-token/avatar.jpg', 'https://fixture.invalid/storage/v1/object/public/story-media/photo.png', 'javascript:alert(1)', 'blob:old', 'not a URL']) assert.equal(api.navigationAvatar(url), null, url);
  assert.equal(api.navigationAvatar(identity.avatarUrl), identity.avatarUrl);
});
function component(h, options = {}) {
  const icon = () => React.createElement('i');
  const Link = ({ href, children, prefetch, ...props }) => React.createElement('a', { href, ...props, 'data-prefetch': String(prefetch) }, children);
  return load('web/components/NavigationLoading.tsx', {
    react: options.react || React, 'react/jsx-runtime': require('react/jsx-runtime'), 'next/link': { default: Link }, 'next/image': { default: ({ unoptimized, ...props }) => React.createElement('img', props) },
    'next/navigation': { usePathname: () => options.path || '/jobs' }, 'lucide-react': new Proxy({}, { get: () => icon }),
    '@/lib/navigationCache': { getNavigationStore: () => h.store }, '@/lib/navigationChromeMemory': api, '@/lib/navigation': navigation,
    './NavigationActions': { NAV_ICONS: new Proxy({}, { get: () => icon }) }, './Wordmark': { Wordmark: () => 'Platinum Circles' },
    './NavigationChrome.module.css': { default: new Proxy({}, { get: (_, key) => key }) },
  }, { localStorage: { getItem: () => options.collapsed ? '1' : null } });
}
test('actual passive fallback has usable links and a status but no editable controls, legacy chrome hooks or global layers', () => {
  const h = fixture(); api.rememberNavigationChrome(h.store, h.session, identity);
  const { NavigationLoading } = component(h);
  const html = renderToStaticMarkup(React.createElement(NavigationLoading, null, 'Pending content'));
  assert.match(html, /data-navigation-loading="verified"/); assert.match(html, /href="\/jobs"/); assert.match(html, /Opening page/);
  assert.doesNotMatch(html, /<(input|textarea|button)|WebCallLayer|ScrollMemory|GlobalMediaLightbox/);
  assert.equal((html.match(/data-prefetch="false"/g) || []).length, 17);
  assert.match(html, /href="#loading-main-content"/); assert.match(html, /id="loading-main-content"/);
});
test('actual passive collapsed geometry is independent of the prior shell global class', () => {
  const h = fixture(); api.rememberNavigationChrome(h.store, h.session, identity);
  const { NavigationLoading } = component(h, { collapsed: true });
  const html = renderToStaticMarkup(React.createElement(NavigationLoading, null, 'Pending content'));
  assert.match(html, /class="sidebar collapsed"/); assert.match(html, /md:ml-\[76px\]/); assert.doesNotMatch(html, /class="frame"/);
});
test('actual public, auth, professional and unresolved fallback renders no remembered identity or navigation', () => {
  const h = fixture(); api.rememberNavigationChrome(h.store, h.session, identity);
  for (const route of ['/login', '/privacy', '/auth/callback', '/studio/team', '/other-profile']) {
    const { NavigationLoading } = component(h, { path: route });
    const html = renderToStaticMarkup(React.createElement(NavigationLoading, null, 'Pending content'));
    assert.match(html, /data-navigation-loading="neutral"/); assert.doesNotMatch(html, /Alice|alice|data-app-chrome/);
  }
  h.change({ initialized: false }); const { NavigationLoading } = component(h);
  assert.doesNotMatch(renderToStaticMarkup(React.createElement(NavigationLoading, null, 'Pending content')), /Alice|alice|data-app-chrome/);
});
test('actual recorder effect rejects session replacement between render and commit', () => {
  const h = fixture(); let effect;
  const { RememberNavigationChrome } = component(h, { react: { useState: init => [init()], useSyncExternalStore: (_s, get) => get(), useLayoutEffect: callback => { effect = callback; } } });
  RememberNavigationChrome({ identity });
  h.change({ owner: 'A', scope: '3:A', revision: 3 }); effect();
  assert.equal(api.readNavigationChrome(h.store, h.session, '/jobs'), null);
});
test('actual verified guest recorder clears stale chrome but a late clear cannot remove a replacement session snapshot', () => {
  const h = fixture(); let effect; api.rememberNavigationChrome(h.store, h.session, identity);
  const { RememberNavigationChrome } = component(h, { react: { useState: init => [init()], useSyncExternalStore: (_s, get) => get(), useLayoutEffect: callback => { effect = callback; } } });
  RememberNavigationChrome({ identity: null }); effect();
  assert.equal(api.readNavigationChrome(h.store, h.session, '/jobs'), null);
  RememberNavigationChrome({ identity: null }); h.change({ owner: 'A', scope: '3:A', revision: 3 });
  api.rememberNavigationChrome(h.store, h.session, { ...identity, name: 'New session' }); effect();
  assert.equal(api.readNavigationChrome(h.store, h.session, '/jobs').name, 'New session');
});
