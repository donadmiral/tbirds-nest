const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { createHostRenderer } = require('../helpers/react-host-renderer.cjs');
const root = path.resolve(__dirname, '../..');
const base = 'https://media.test';
const noop = () => {};
const grant = (object = 'photo.jpg', token = 'a') => `${base}/functions/v1/media-content/story-media/owner/${object}?token=${token.repeat(64)}`;

function fixture(kind, initial = {}) {
  const host = createHostRenderer(), cache = new Map(), listeners = new Set();
  let session = { scope: 'viewer-a:1', owner: 'viewer-a', initialized: true, changed: false, ...initial };
  const navigation = { getSnapshot: () => session, getServerSnapshot: () => session,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); } };
  let gallery = [{ url: grant() }], gallerySetter, gallerySeen = false;
  const createClient = () => ({});
  const react = kind === 'article' ? { ...React, useEffect: noop, useState(initial) {
    if (initial === createClient) gallerySeen = false;
    const selected = Array.isArray(initial) && !gallerySeen;
    if (selected) gallerySeen = true;
    const value = React.useState(selected ? gallery : initial);
    if (selected) gallerySetter = value[1];
    return value;
  } } : React;
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const module = { exports: {} };
    const imports = name => {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return require('react/jsx-runtime');
      if (name === 'react-native') return { View: 'View', Text: 'Text', Platform: { OS: 'ios' } };
      if (name === 'expo-image') return { Image: 'Image' };
      if (name === 'expo-linear-gradient') return { LinearGradient: 'Gradient' };
      if (name === '@expo/vector-icons') return { Feather: 'Icon' };
      if (name === 'react-native-svg') return { default: 'Svg', ...Object.fromEntries(['Defs','Pattern','Rect','Path','Circle','Text'].map(key => [key,key])) };
      if (name === 'next/image') return { default: 'img' };
      if (name === 'next/link') return { default: 'Link' };
      if (name === 'next/navigation') return { useRouter: () => ({ push: noop }) };
      if (name === 'lucide-react') return new Proxy({}, { get: (_target, key) => key });
      if (name.endsWith('.module.css')) return { default: new Proxy({}, { get: (_target,key) => key }) };
      if (name.endsWith('/navigationCache')) return { getNavigationStore: () => navigation, navigationScope: () => session.scope, subscribeNavigationScope: navigation.subscribe };
      if (name.endsWith('/supabase')) return { SUPABASE_URL: base };
      if (name === '@/lib/supabase/client') return { createClient };
      if (name.endsWith('/VideoThumb')) return { default: 'VideoThumb' };
      if (name.endsWith('/DrawLayer')) return { DrawingLayer: 'DrawingLayer' };
      if (name.endsWith('/MemoryCoverInk')) return { MemoryCoverInk: 'MemoryCoverInk' };
      if (name === '@/lib/profileLookup') return { profilePath: () => '/author' };
      if (name === '@/lib/pollCheck') return { usePollFlag: () => false };
      if (name === '@/lib/usePostInteractions') return { usePostInteractions: () => ({ liked: false, bookmarked: false, likesCount: 0, bookmarksCount: 0, setLike: noop, setBookmark: noop }) };
      if (name === '@/lib/media') return { displayImageUrl: value => value };
      if (name.startsWith('@/components/')) return { [path.basename(name)]: path.basename(name) };
      if (name.startsWith('@/lib/')) return {};
      if (name.startsWith('.')) {
        const target = path.relative(root, path.resolve(root, path.dirname(file), name)) + (path.extname(name) ? '' : '.ts');
        return load(target);
      }
      throw Error(`Unexpected dependency ${name} in ${file}`);
    };
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'), {
      fileName: file, compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, { module, exports: module.exports, require: imports, console, URL, setTimeout, clearTimeout,
      process: { env: { NEXT_PUBLIC_SUPABASE_URL: base } } }, { filename: file });
    cache.set(file,module.exports);
    return module.exports;
  }
  const file = kind === 'native' ? 'src/components/memory/MemoryBookCover.tsx'
    : kind === 'web' ? 'web/components/memory/MemoryBookCover.tsx' : 'web/components/PostCard.tsx';
  const loaded = load(file), Component = loaded.default || loaded.MemoryBookCover || loaded.PostCard;
  const post = { post_id: 'post', author_id: 'author', author_name: 'Author', author_username: 'author',
    article_title: 'Article', content: 'Article text', media: [], products: [], created_at: '2026-11-04T00:00:00Z',
    likes_count: 0, comments_count: 0, reposts_count: 0, bookmarks_count: 0 };
  let props = kind === 'article' ? { post, inlineComments: false } : { title: 'Cover', design: 'keepsake', photoUrl: grant() };
  const render = () => { host.render(React.createElement(Component,props)); assert.deepEqual(host.errors.map(error => error.message),[]); };
  return { ...host,
    render,
    images: () => host.nodes().filter(node => node.type === 'Image' || node.type === 'img'),
    source: node => kind === 'native' ? node.props.source.uri : node.props.src,
    photo(uri, extra = {}) {
      if (kind === 'article') { gallery = uri ? [{ url: uri }] : []; host.update(() => gallerySetter(gallery)); }
      else { props = { ...props, photoUrl: uri, ...extra }; render(); }
      assert.deepEqual(host.errors.map(error => error.message),[]);
    },
    session(next) { host.update(() => { session = { ...session, ...next }; listeners.forEach(fn => fn()); }); render(); },
  };
}

for (const kind of ['native','web','article']) {
  test(`${kind}: a recognized grant renewal updates the real image instance without replacing it`, () => {
    const h = fixture(kind); h.render();
    const image = h.images()[0]; assert.ok(image);
    const recyclingKey = image.props.recyclingKey;
    h.photo(grant('photo.jpg','b'));
    assert.equal(h.images()[0],image);
    assert.equal(h.source(image),grant('photo.jpg','b'));
    if (kind === 'native') { assert.equal(image.props.recyclingKey,recyclingKey); assert.equal(image.props.cachePolicy,'none'); }
    h.close();
  });

  test(`${kind}: different objects and image transformations replace the real image instance`, () => {
    const h = fixture(kind); h.render();
    const image = h.images()[0]; h.photo(grant('other.jpg'));
    const other = h.images()[0]; assert.notEqual(other,image);
    h.photo(grant('other.jpg') + '&width=400');
    assert.notEqual(h.images()[0],other);
    h.photo(undefined); assert.equal(h.images().length,0); h.close();
  });

  test(`${kind}: an account change hides unchanged private props until a new grant arrives`, () => {
    const h = fixture(kind); h.render();
    const old = h.images()[0];
    h.session({ scope: 'viewer-b:2', owner: 'viewer-b', changed: true });
    assert.equal(h.images().length,0);
    h.photo(grant('photo.jpg','b')); assert.ok(h.images()[0]); assert.notEqual(h.images()[0],old);
    h.session({ scope: 'viewer-a:3', owner: 'viewer-a' }); assert.equal(h.images().length,0);
    h.photo(grant('photo.jpg','c')); assert.ok(h.images()[0]);
    h.session({ scope: null, owner: null }); assert.equal(h.images().length,0); h.close();
  });
}

for (const kind of ['native','web']) {
  test(`${kind}: current image errors use authorized fallback and renewed requests ignore old errors`, () => {
    const h = fixture(kind); h.render();
    h.photo(grant(),{ fallbackPhotoUrl: grant('fallback.jpg') });
    const image = h.images()[0], oldError = image.props.onError;
    h.photo(grant('photo.jpg','b'));
    h.update(oldError); assert.equal(h.source(h.images()[0]),grant('photo.jpg','b'));
    h.update(h.images()[0].props.onError); assert.equal(h.source(h.images()[0]),grant('fallback.jpg'));
    h.update(h.images()[0].props.onError); assert.equal(h.images().length,0);
    h.photo(grant('photo.jpg','c')); assert.equal(h.source(h.images()[0]),grant('photo.jpg','c'));
    h.close();
  });
}

test('web cover binds an initial authorized image after session initialization without retaining it across later accounts', () => {
  const h = fixture('web',{scope:null,owner:null,initialized:false}); h.render();
  assert.equal(h.images().length,0);
  h.session({scope:'viewer-a:1',owner:'viewer-a',initialized:true}); assert.ok(h.images()[0]);
  h.session({scope:'viewer-b:2',owner:'viewer-b',changed:true}); assert.equal(h.images().length,0);
  h.close();
});
