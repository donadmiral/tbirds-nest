const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const presentationModule={exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../../shared/memoryStoryPresentation.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:presentationModule,exports:presentationModule.exports});
const creativeModule={exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../../shared/memoryBookCreative.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:creativeModule,exports:creativeModule.exports});
const readerModule={exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../../shared/memoryReaderRequest.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:readerModule,exports:readerModule.exports,AbortController,setTimeout,clearTimeout});
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function scenario(platform) {
  const file = platform === 'web' ? 'web/components/MemoryAlbum.tsx' : 'src/screens/profile/MemoryAlbumScreen.tsx';
  const source = fs.readFileSync(path.join(__dirname, '../..', file), 'utf8');
  const start = source.indexOf('  const load = useCallback(async () => {');
  const end = source.indexOf('\n  const loadMore', start);
  assert.ok(start >= 0 && end > start);
  const request = deferred(), albums = [], errors = [];
  request.promise.abortSignal = signal => { request.signal = signal; return request.promise; };
  const scope = {
    ...readerModule.exports, readerRequest: { current: null }, authScopeRevision: 0,
    memoryAlbumStoryLayers:presentationModule.exports.memoryAlbumStoryLayers,
    ...creativeModule.exports,settingsOpen:{current:false},setDesign(){},setCoverArtwork(){},setFilmSettings(){},setPresentationRevision(){},
    useCallback: fn => fn, authReady: true, ownerId: 'album-owner', uid: 'viewer', viewerId: 'viewer', albumIdParam: 'album-id',
    loadGeneration: { current: 0 }, viewerRef: { current: 'viewer' }, reactionScope: { current: { revision: 0, readRevision: 0, changes: new Map() } },
    getMemoryBook: () => request.promise,
    supabase: { rpc: () => request.promise }, hydrateMemoryAlbumMedia: async rows => rows.map(row => ({...row, signed: true})),
    setAlbum: value => albums.push(value), setLoadError: value => errors.push(value), setLoading() {}, setPlayingUrl() {}, setLikedPages() {}, setReactionRead() {},
    setTitle() {}, setSubtitle() {}, setCoverStoryId() {}, setColor() {}, setAud() {}, setBookId() {},
  };
  Object.assign(scope, { AbortController, moreRequest: { current: null }, completeRequest: { current: null }, fullBookMode: { current: false }, completeIntent: { current: 0 }, pendingTurn: { current: null },
    setLoadingPages() {}, setPreparingBook() {}, setRefreshingBook() {}, setIdx() {}, idxRef: { current: 0 }, indexRef: { current: 0 }, albumRef: { current: null }, displayedAlbum: { current: null },
    filmVisibleRef: { current: false }, memoryBookHasMore: () => false, mediaScope: { current: null }, request: { current: null },
    session: { scope: 'viewer-session' }, store: { getSnapshot: () => ({ scope: 'viewer-session' }) },
    readMemoryBookFirst: async () => { const { data, error } = await request.promise; if (error) throw error; return data; },
  });
  scope.supabase.auth = { getSession: async () => ({ data: { session: { user: { id: 'viewer' }, access_token: 'test' } }, error: null }) };
  const compiled = ts.transpileModule(source.slice(start, end) + '\nthis.load = load;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(compiled, scope);
  return { scope, request, albums, errors, finish(data) { request.resolve(platform === 'web' ? data : {data, error: null}); } };
}
for (const platform of ['web', 'native']) {
  test(`${platform} album loader commits authorized media`, async () => {
    const h = scenario(platform), work = h.scope.load(); h.finish({id: 'album-id', pages: [], media: 'authorized'}); await work;
    assert.equal(h.albums.at(-1).media, 'authorized'); if (platform === 'native') assert.equal(h.albums.at(-1).signed, true);
  });
  test(`${platform} late album read cannot restore an old account's media`, async () => {
    const h = scenario(platform), work = h.scope.load(); h.scope.loadGeneration.current++; h.scope.viewerRef.current = 'next-viewer'; h.finish({id: 'private-old', pages: []}); await work;
    assert.equal(h.albums.length, 0);
  });
  test(`${platform} failed album authorization clears media and offers retry`, async () => {
    const h = scenario(platform), work = h.scope.load(); h.request.reject(new Error('denied')); await work;
    assert.equal(h.albums.at(-1), null); assert.match(h.errors.at(-1), /retry/i);
  });
}
