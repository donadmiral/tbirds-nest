// Real installed Supabase SDK; every response and credential is synthetic.
// No request can reach the network from this fixture.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { createClient, processLock } = require('@supabase/supabase-js');
const root = path.resolve(__dirname, '../..');
const base = 'https://media-cancellation.invalid';
const owner = '00000000-0000-4000-8000-000000000001';
const raw = `${base}/storage/v1/object/public/post-media/${owner}/photo.jpg`;
const signed = `${base}/storage/v1/object/sign/post-media/${owner}/photo.jpg?token=synthetic`;
const row = { id: owner, media_url: raw };
const turn = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const abortError = () => Object.assign(new Error('Synthetic transport aborted'), { name: 'AbortError' });
const expiry = Math.floor(Date.now() / 1000) + 3600;
const token = [Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url'), Buffer.from(JSON.stringify({ sub: owner, exp: expiry })).toString('base64url'), 'synthetic'].join('.');
const session = { access_token: token, refresh_token: 'synthetic-refresh', expires_at: expiry, token_type: 'bearer', user: { id: owner } };

function compile(file, additions = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, URL, Request, Response, AbortController, setTimeout, clearTimeout, console, ...additions });
  return module.exports;
}
const media = compile('shared/contentMedia.ts');
async function until(check) {
  for (let i = 0; i < 50 && !check(); i++) await turn();
  assert.ok(check(), 'expected the installed SDK to reach the synthetic phase');
}

function sdk({ holdUser = false, signerMode = 'ready' } = {}) {
  const key = `media-cancel-${Math.random()}`, storage = new Map([[key, JSON.stringify(session)]]);
  const calls = [], users = [], signers = [];
  let activeSigners = 0, peakSigners = 0;
  const body = () => JSON.stringify({ urls: [{ key: `post-media/${owner}/photo.jpg`, url: signed }], expiresAt: Date.now() + 300000 });
  const client = createClient(base, 'synthetic-public-key', {
    auth: {
      storageKey: key, autoRefreshToken: false, persistSession: true, detectSessionInUrl: false, lock: processLock,
      storage: { getItem: async name => storage.get(name) ?? null, setItem: async (name, value) => { storage.set(name, value); }, removeItem: async name => { storage.delete(name); } },
    },
    global: { fetch: async (input, init) => {
      const url = new URL(input); calls.push({ path: url.pathname, signal: init?.signal, authorization: new Headers(init?.headers).get('authorization') });
      if (url.pathname === '/auth/v1/user') {
        const response = () => new Response(JSON.stringify({ id: owner }), { headers: { 'Content-Type': 'application/json' } });
        if (!holdUser) return response();
        const gate = deferred(); users.push({ release: () => gate.resolve(response()) }); return gate.promise;
      }
      if (url.pathname !== '/functions/v1/content-media-sign') throw new Error('Unexpected synthetic request ' + url.pathname);
      activeSigners++; peakSigners = Math.max(peakSigners, activeSigners);
      const entry = { signal: init?.signal, aborted: false, finished: false };
      signers.push(entry);
      const finish = () => { if (!entry.finished) { entry.finished = true; activeSigners--; } };
      const response = () => new Response(body(), { headers: { 'Content-Type': 'application/json' } });
      if (signerMode === 'ready') { finish(); return response(); }
      if (signerMode === 'body') {
        let streamController;
        const stream = new ReadableStream({ start(controller) { streamController = controller; } });
        const abort = () => { entry.aborted = true; streamController.error(abortError()); finish(); };
        entry.signal?.addEventListener('abort', abort, { once: true });
        entry.release = () => { if (!entry.finished) { streamController.enqueue(new TextEncoder().encode(body())); streamController.close(); finish(); } };
        if (entry.signal?.aborted) abort();
        return new Response(stream, { headers: { 'Content-Type': 'application/json' } });
      }
      const gate = deferred();
      const abort = () => { entry.aborted = true; if (signerMode === 'abort') gate.reject(abortError()); };
      entry.signal?.addEventListener('abort', abort, { once: true });
      entry.release = () => gate.resolve(response());
      if (entry.signal?.aborted) abort();
      try { return await gate.promise; }
      finally { entry.signal?.removeEventListener('abort', abort); finish(); }
    } },
  });
  return {
    client, calls, users, signers,
    get activeSigners() { return activeSigners; }, get peakSigners() { return peakSigners; },
    releaseUsers() { users.splice(0).forEach(item => item.release()); },
    releaseSigners() { signers.forEach(item => item.release?.()); },
    async close() { this.releaseUsers(); this.releaseSigners(); await client.auth.stopAutoRefresh(); },
  };
}

test('an already-cancelled operation performs no Auth or signing work, including empty rows', async () => {
  const h = sdk(), controller = new AbortController();
  await h.client.auth.getSession();
  const original = h.client.auth.getSession.bind(h.client.auth); let sessionCalls = 0;
  h.client.auth.getSession = (...args) => { sessionCalls++; return original(...args); };
  controller.abort();
  try {
    await assert.rejects(media.hydrateContentMedia(h.client, base, [row], 'post', controller.signal), { name: 'AbortError' });
    await assert.rejects(media.hydrateContentMedia(h.client, base, [], 'post', controller.signal), { name: 'AbortError' });
    await assert.rejects(media.hydrateOwnerUploadMedia(h.client, base, [row], controller.signal), { name: 'AbortError' });
    assert.equal(sessionCalls, 0); assert.equal(h.calls.length, 0);
  } finally { await h.close(); }
});

test('cancelling a non-abortable Auth phase retains the operation until real SDK completion and never signs', async () => {
  const h = sdk({ holdUser: true }), controller = new AbortController();
  const work = media.hydrateContentMedia(h.client, base, [row], 'post', controller.signal);
  let settled = false; work.then(() => { settled = true; }, () => { settled = true; });
  const rejected = assert.rejects(work, { name: 'AbortError' });
  try {
    await until(() => h.users.length === 1);
    controller.abort(); await turn(); await turn();
    assert.equal(settled, false, 'cancellation cannot hide a still-running Auth transport');
    assert.equal(h.signers.length, 0);
    h.releaseUsers(); await rejected;
    assert.equal(h.signers.length, 0, 'no signing may start after the held Auth phase finishes');
  } finally { controller.abort(); await h.close(); await Promise.allSettled([work]); }
});

test('the actual SDK aborts all active signing transports and starts no remaining batch', async () => {
  const h = sdk({ signerMode: 'abort' }), controller = new AbortController();
  const rows = Array.from({ length: 201 }, (_, i) => ({ ...row, id: `10000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}` }));
  const work = media.hydrateContentMedia(h.client, base, rows, 'post', controller.signal);
  const rejected = assert.rejects(work, { name: 'AbortError' });
  try {
    await until(() => h.signers.length === 3); controller.abort(); await rejected;
    assert.equal(h.signers.length, 3, 'five pending reference batches must not all start');
    assert.equal(h.peakSigners, 3); assert.equal(h.activeSigners, 0);
    assert.ok(h.signers.every(item => item.signal instanceof AbortSignal && item.aborted));
    assert.ok(h.calls.filter(item => item.path.includes('/functions/')).every(item => item.authorization === `Bearer ${token}`));
  } finally { controller.abort(); await h.close(); await Promise.allSettled([work]); }
});

test('an abort-ignoring signing transport stays accounted for until the actual SDK invocation settles', async () => {
  const h = sdk({ signerMode: 'ignore' }), controller = new AbortController();
  const work = media.hydrateContentMedia(h.client, base, [row], 'post', controller.signal);
  let settled = false; work.then(() => { settled = true; }, () => { settled = true; });
  const rejected = assert.rejects(work, { name: 'AbortError' });
  try {
    await until(() => h.signers.length === 1); controller.abort(); await turn(); await turn();
    assert.equal(h.signers[0].aborted, true); assert.equal(h.activeSigners, 1);
    assert.equal(settled, false, 'do not race a rejection against still-active transport');
    h.releaseSigners(); await rejected; assert.equal(h.activeSigners, 0);
  } finally { controller.abort(); await h.close(); await Promise.allSettled([work]); }
});

test('cancellation also reaches response-body reading after signing response headers arrive', async () => {
  const h = sdk({ signerMode: 'body' }), controller = new AbortController();
  const work = media.hydrateContentMedia(h.client, base, [row], 'post', controller.signal);
  const rejected = assert.rejects(work, { name: 'AbortError' });
  try {
    await until(() => h.signers.length === 1); await turn();
    assert.equal(h.activeSigners, 1); controller.abort(); await rejected;
    assert.equal(h.activeSigners, 0); assert.equal(h.signers[0].aborted, true);
  } finally { controller.abort(); await h.close(); await Promise.allSettled([work]); }
});

test('the signing deadline aborts actual I/O instead of only abandoning its promise', async () => {
  const timers = new Map(); let sequence = 0;
  const controlled = compile('shared/contentMedia.ts', {
    setTimeout(fn, ms) { assert.equal(ms, 20000); const id = ++sequence; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  const h = sdk({ signerMode: 'abort' }), controller = new AbortController();
  const work = controlled.hydrateContentMedia(h.client, base, [row], 'post', controller.signal);
  const rejected = assert.rejects(work, /Media access timed out/);
  try {
    await until(() => h.signers.length === 1); assert.equal(timers.size, 1);
    for (const fn of [...timers.values()]) fn(); await rejected;
    assert.equal(h.signers[0].aborted, true); assert.equal(h.activeSigners, 0); assert.equal(timers.size, 0);
    assert.equal(controller.signal.aborted, false, 'an internal deadline must not abort its owner');
  } finally { controller.abort(); await h.close(); await Promise.allSettled([work]); }
});

test('web hydration forwards the optional signal while omitted-signal callers keep signed results', async () => {
  const h = sdk({ signerMode: 'abort' }), controller = new AbortController();
  const web = compile('web/lib/contentMedia.ts', {
    process: { env: { NEXT_PUBLIC_SUPABASE_URL: base } },
    require(name) {
      if (name === '../../shared/adaptiveMedia') return { acceptAdaptiveMedia() {} };
      if (name === '../../shared/contentMedia') return media;
      if (name === './supabase/client') return { createClient: () => h.client };
      if (name === '../../shared/feedMediaReuse') return {};
      throw new Error('Unexpected module ' + name);
    },
  });
  const work = web.hydratePostMedia([row], h.client, controller.signal);
  const rejected = assert.rejects(work, { name: 'AbortError' });
  try {
    await until(() => h.signers.length === 1); controller.abort(); await rejected;
    assert.equal(h.signers[0].aborted, true);
  } finally { controller.abort(); await h.close(); await Promise.allSettled([work]); }
  const ready = sdk();
  try {
    const [result] = await web.hydratePostMedia([row], ready.client);
    assert.equal(result.media_url, signed); assert.ok(result._mediaExpiresAt > Date.now());
    assert.equal(ready.signers[0].signal, undefined, 'existing invocation shape remains unchanged without a signal');
  } finally { await ready.close(); }
});

test('all web hydration adapters preserve their previous client argument and forward cancellation', async () => {
  const calls = [], client = {}, controller = new AbortController();
  const web = compile('web/lib/contentMedia.ts', {
    process: { env: { NEXT_PUBLIC_SUPABASE_URL: base } },
    require(name) {
      if (name === '../../shared/adaptiveMedia') return { acceptAdaptiveMedia() {} };
      if (name === '../../shared/contentMedia') return {
        hydrateContentMedia(...args) { calls.push(args); return args[2]; },
        hydrateOwnerUploadMedia(...args) { calls.push(args); return args[2]; },
      };
      if (name === './supabase/client') return { createClient: () => client };
      if (name === '../../shared/feedMediaReuse') return {};
      throw new Error(name);
    },
  });
  for (const method of ['hydratePostMedia', 'hydrateStoryMedia', 'hydrateStoryDraftMedia', 'hydrateMemoryAlbumMedia', 'hydrateHighlightMedia', 'hydrateUploadMedia', 'hydrateSoundMedia']) {
    const rows = [row]; assert.equal(web[method](rows, client, controller.signal), rows);
    const args = calls.pop(); assert.equal(args[0], client); assert.equal(args[1], base); assert.equal(args[2], rows); assert.equal(args.at(-2), controller.signal); assert.equal(typeof args.at(-1), 'function');
  }
});
