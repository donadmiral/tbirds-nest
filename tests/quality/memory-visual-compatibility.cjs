const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const modules = new Map();
function load(file) {
  const absolute = path.resolve(root, file);
  if (modules.has(absolute)) return modules.get(absolute);
  const module = {exports: {}};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(absolute, 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
  }).outputText, {AbortController, setTimeout, clearTimeout, module, exports: module.exports,
    require: name => load(path.resolve(path.dirname(absolute), name + '.ts'))});
  modules.set(absolute, module.exports);
  return module.exports;
}
const persistence = load('shared/memoryBookPersistence.ts');
const creative = load('shared/memoryBookCreative.ts');
const plain = value => JSON.parse(JSON.stringify(value));
const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const album = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const story = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const requestId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const missing = {code: 'PGRST202', message: 'Could not find the function public.get_memory_book_creative_capabilities without parameters in the schema cache'};
const draft = () => ({title: ' Days ', subtitle: ' Winter ', color: 'cream', design: 'postcard', coverStoryId: story,
  artwork: creative.memoryCoverArtwork(), film: creative.memoryFilmSettings()});
function fixture(capability = {data: null, error: missing}) {
  const calls = [], ownerChecks = [];
  let user = owner, listener, onWrite = () => {}, outcome;
  const client = {
    auth: {getSession: async () => ({data: {session: {user: {id: user}, access_token: 'fixture-jwt'}}, error: null}),
      getUser: async token => {ownerChecks.push(token); return {data: {user: {id: user}}, error: null};},
      onAuthStateChange: callback => {listener = callback; return {data: {subscription: {unsubscribe() {listener = undefined;}}}};}},
    rpc(name, args) {
      const call = {name, args, headers: {}, signal: null}; calls.push(call);
      const req = {setHeader(name, value) {call.headers[name] = value; return req;},
        abortSignal(signal) {call.signal = signal; return req;},
        then(resolve, reject) {return Promise.resolve().then(() => {
          if (name === 'get_memory_book_creative_capabilities') return capability;
          onWrite();
          if (outcome) return outcome;
          return {data: name === 'create_memory_book_presentation' ? album : null, error: null};
        }).then(resolve, reject);}};
      return req;
    },
  };
  return {client, calls, ownerChecks, setOutcome: value => {outcome = value;}, setUser: value => {user = value;},
    onWrite: callback => {onWrite = callback;}, emit: value => {user = value; listener?.('SIGNED_IN', {user: {id: value}});}};
}
const saveOptions = () => ({ownerId: owner, albumId: album, revision: -1, audience: 'only_me', draft: draft(), isCurrent: () => true});
const createOptions = () => ({ownerId: owner, requestId, storyIds: [story, owner], draft: draft(), isCurrent: () => true});
const writes = f => f.calls.filter(call => call.name !== 'get_memory_book_creative_capabilities');

test('structurally absent creative endpoint selects original-film defaults without sharing mutable objects', async () => {
  const f = fixture(), first = await persistence.loadMemoryBookDefaultFilmSettings(f.client);
  assert.deepEqual(plain(first), plain(creative.LEGACY_MEMORY_FILM_SETTINGS));
  first.originalAudio = false;
  assert.equal((await persistence.loadMemoryBookDefaultFilmSettings(f.client)).originalAudio, true);
});

test('installed creative endpoint retains automatic-film defaults', async () => {
  const f = fixture({data: {version: 1, supported: true}, error: null});
  assert.deepEqual(plain(await persistence.loadMemoryBookDefaultFilmSettings(f.client)), plain(creative.DEFAULT_MEMORY_FILM_SETTINGS));
});

test('visual save sends the exact existing seven arguments and confirms no invented revision', async () => {
  const f = fixture(), options = saveOptions();
  const result = await persistence.saveMemoryCreativeBook(f.client, options);
  assert.deepEqual(writes(f).map(call => call.name), ['save_memory_book_presentation']);
  assert.deepEqual(plain(writes(f)[0].args), {p_title: 'Days', p_subtitle: 'Winter', p_cover_color: 'cream',
    p_cover_design: 'postcard', p_cover_story_id: story, p_album: album, p_audience: 'only_me'});
  assert.deepEqual(plain(result), {id: album, persistence: 'visual', presentation_revision: null, cover_artwork: null, film_settings: null});
  assert.equal(writes(f)[0].headers.Authorization, 'Bearer fixture-jwt');
  assert.deepEqual(f.ownerChecks, ['fixture-jwt', 'fixture-jwt']);
  assert.equal(writes(f)[0].signal.aborted, true);
});

test('visual create preserves exact story order and accepts the legacy server-assigned UUID', async () => {
  const f = fixture(), result = await persistence.createMemoryCreativeBook(f.client, createOptions());
  assert.equal(result.id, album); assert.notEqual(result.id, requestId);
  assert.deepEqual(writes(f).map(call => call.name), ['create_memory_book_presentation']);
  assert.deepEqual(plain(writes(f)[0].args), {p_title: 'Days', p_subtitle: 'Winter', p_cover_color: 'cream',
    p_cover_design: 'postcard', p_cover_story_id: story, p_story_ids: [story, owner]});
  assert.equal(writes(f)[0].headers.Authorization, 'Bearer fixture-jwt');
  assert.equal(result.presentation_revision, null);
});

test('denial, malformed response, network failure and a missing nested function never permit a legacy write', async () => {
  for (const capability of [
    {data: {version: 1, supported: false}, error: null}, {data: null, error: null},
    {data: {version: 2, supported: true}, error: null},
    {data: null, error: {code: '42501', message: 'permission denied'}},
    {data: null, error: {code: '', message: 'Failed to fetch'}},
    {data: null, error: {code: '42883', message: 'function memory_creative.actor() does not exist'}},
    {data: null, error: {code: 'PGRST202', message: 'Could not find the function public.other without parameters in the schema cache'}},
    {data: null, error: {code: 'PGRST202'}},
  ]) {
    const f = fixture(capability);
    await assert.rejects(persistence.saveMemoryCreativeBook(f.client, saveOptions()), /Creative book saving is unavailable/);
    await assert.rejects(persistence.loadMemoryBookDefaultFilmSettings(f.client), /Creative book saving is unavailable/);
    assert.equal(writes(f).length, 0);
  }
});

test('a missing revision still rejects saving when the creative contract is installed', async () => {
  const f = fixture({data: {version: 1, supported: true}, error: null});
  await assert.rejects(persistence.saveMemoryCreativeBook(f.client, saveOptions()), /Reload the book/);
  assert.equal(writes(f).length, 0);
});

test('a previously known creative revision cannot be discarded after capability disappearance', async () => {
  for (const revision of [0, 4]) {
    const f = fixture();
    await assert.rejects(persistence.saveMemoryCreativeBook(f.client, {...saveOptions(), revision}), /Reload the book/);
    assert.equal(writes(f).length, 0);
  }
});

test('legacy fallback never drops cover edits, v2 drawings, automatic films, ordering or audio choices', async () => {
  const variants = [
    value => {value.artwork.inscription = 'Remember';}, value => {value.artwork.photo.x = .3;},
    value => {value.artwork.showDate = false;}, value => {value.artwork = creative.personalizeMemoryCover(value.artwork);},
    value => {value.film = {...creative.DEFAULT_MEMORY_FILM_SETTINGS};},
    value => {value.film.order = 'chronological';}, value => {value.film.originalAudio = false;},
  ];
  for (const change of variants) for (const create of [false, true]) {
    const f = fixture(), value = draft(); change(value); const before = JSON.stringify(value);
    await assert.rejects(create ? persistence.createMemoryCreativeBook(f.client, {...createOptions(), draft: value})
      : persistence.saveMemoryCreativeBook(f.client, {...saveOptions(), draft: value}), /saving is unavailable/);
    assert.equal(writes(f).length, 0); assert.equal(JSON.stringify(value), before);
  }
});

test('visual writes validate the live owner before sending and after acknowledgement', async () => {
  for (const create of [false, true]) for (const timing of ['before', 'after']) {
    const f = fixture(); if (timing === 'before') f.setUser(story); else f.onWrite(() => f.setUser(story));
    await assert.rejects(create ? persistence.createMemoryCreativeBook(f.client, createOptions())
      : persistence.saveMemoryCreativeBook(f.client, saveOptions()), /session changed/);
    assert.equal(writes(f).length, timing === 'before' ? 0 : 1);
  }
});

test('account round trips abort visual writes and never acknowledge the returned book', async () => {
  for (const create of [false, true]) {
    const f = fixture(); f.onWrite(() => {f.emit(story); f.emit(owner);});
    await assert.rejects(create ? persistence.createMemoryCreativeBook(f.client, createOptions())
      : persistence.saveMemoryCreativeBook(f.client, saveOptions()), /session changed/);
    assert.equal(writes(f)[0].signal.aborted, true);
  }
});

test('an installed creative mutation error never falls through to the legacy mutation', async () => {
  const f = fixture({data: {version: 1, supported: true}, error: null});
  f.setOutcome({data: null, error: missing});
  await assert.rejects(persistence.saveMemoryCreativeBook(f.client, {...saveOptions(), revision: 3}));
  assert.deepEqual(writes(f).map(call => call.name), ['save_memory_book_creative_presentation']);
});

test('legacy save confirms only the actual void contract, with no retries after errors', async () => {
  for (const outcome of [{data: {}, error: null}, {data: true, error: null}, {data: undefined, error: null},
    {data: null, error: {code: '42501', message: 'BOOK_NOT_OWNED'}}]) {
    const f = fixture(); f.setOutcome(outcome);
    await assert.rejects(persistence.saveMemoryCreativeBook(f.client, saveOptions()));
    assert.equal(writes(f).length, 1);
  }
});

test('legacy create refuses missing, malformed or arbitrary object acknowledgements', async () => {
  for (const data of [null, '', 'not-a-uuid', {id: album}]) {
    const f = fixture(); f.setOutcome({data, error: null});
    await assert.rejects(persistence.createMemoryCreativeBook(f.client, createOptions()), /could not be confirmed/);
    assert.equal(writes(f).length, 1);
  }
});

test('creative acknowledgement cannot discard the exact requested film or audio settings', async () => {
  for (const create of [false, true]) {
    const f = fixture({data: {version: 1, supported: true}, error: null});
    f.setOutcome({data: {id: create ? requestId : album, presentation_revision: 4,
      cover_artwork: creative.memoryCoverArtwork(), film_settings: {...creative.LEGACY_MEMORY_FILM_SETTINGS, originalAudio: false}}, error: null});
    await assert.rejects(create ? persistence.createMemoryCreativeBook(f.client, createOptions())
      : persistence.saveMemoryCreativeBook(f.client, {...saveOptions(), revision: 3}), /could not be confirmed/);
  }
});

test('callers that explicitly require a creative backend remain strict on a visual deployment', async () => {
  const f = fixture();
  await assert.rejects(persistence.requireMemoryCreativeBackend(f.client), /Creative book saving is unavailable/);
  assert.equal(writes(f).length, 0);
});

test('a hanging capability load has a deadline and aborts the underlying request', async () => {
  const timers = [], module = {exports: {}};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, 'shared/memoryBookPersistence.ts'), 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
  }).outputText, {AbortController, setTimeout: (callback, delay) => {timers.push({callback, delay}); return timers.length;}, clearTimeout() {},
    module, exports: module.exports, require: () => creative});
  let signal;
  const request = {abortSignal(value) {signal = value; return request;}, then() {return new Promise(() => {});}};
  const pending = module.exports.loadMemoryBookDefaultFilmSettings({rpc: () => request});
  assert.equal(timers.length, 1); assert.equal(timers[0].delay, 10000); assert.equal(signal.aborted, false);
  timers[0].callback();
  await assert.rejects(pending, /Creative book saving is unavailable/);
  assert.equal(signal.aborted, true);
});

test('the mutation lifetime also owns the capability request abort signal', async () => {
  const f = fixture();
  await persistence.saveMemoryCreativeBook(f.client, saveOptions());
  assert.equal(f.calls[0].signal, writes(f)[0].signal);
  assert.equal(f.calls[0].signal.aborted, true);
});
