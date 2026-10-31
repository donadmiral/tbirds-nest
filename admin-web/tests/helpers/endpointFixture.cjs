/* Route acceptance harness. The real route, Auth/session/role modules, recovery
 * code, permission table and installed Supabase SDK execute. Only request-local
 * cookies/navigation and the synthetic Auth/PostgREST/Storage transport differ. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require('typescript');
const { createRequire } = require('node:module');
const ADMIN = path.resolve(__dirname, '../..');
const req = createRequire(path.join(ADMIN, 'package.json'));
const ACTOR = '10000000-0000-4000-8000-000000000001';
const SESSION = '10000000-0000-4000-8000-000000000002';
const OBJECT = '10000000-0000-4000-8000-000000000003';
const SITE = 'https://admin-endpoint.example.invalid';
const PROVIDER = 'https://provider-endpoint.example.invalid';
const SECRET = 'synthetic-endpoint-service-key-for-local-tests-only';
const response = (body, status = 200, headers = {}) => new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

function endpointHarness(options = {}) {
  const calls = [], unhandled = [], loaded = [], cookieWrites = [], timers = [], stored = new Map();
  const now = Math.floor(Date.now() / 1000);
  const claims = { sub: ACTOR, session_id: SESSION, exp: now + 3600, aal: 'aal1', amr: [{ method: options.method || 'password', timestamp: now }], ...options.claims };
  const token = 'synthetic.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.synthetic';
  const user = { id: ACTOR, email: 'endpoint-staff@example.invalid', aud: 'authenticated', role: 'authenticated', created_at: new Date().toISOString(), app_metadata: {}, user_metadata: {}, factors: [] };
  const session = { access_token: token, refresh_token: 'synthetic-endpoint-refresh', expires_at: now + 3600, expires_in: 3600, token_type: 'bearer', user };
  const environment = { NODE_ENV: 'production', VERCEL_ENV: 'preview', ADMIN_AUTH_ORIGINS: SITE,
    NEXT_PUBLIC_SUPABASE_URL: PROVIDER, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'synthetic-endpoint-anon-key', SUPABASE_SERVICE_ROLE_KEY: SECRET, ...options.env };
  if (options.signedIn !== false) stored.set('pc_admin_token', token);
  const jar = { get: key => stored.has(key) ? { value: stored.get(key) } : undefined,
    set(key, value, config) { cookieWrites.push({ key, config }); if (config?.maxAge === 0) stored.delete(key); else stored.set(key, value); },
    delete(key) { stored.delete(key); } };
  let challenge = null, redeemed = false, userReads = 0, sessionReads = 0;
  async function fetchFixture(input, init = {}) {
    const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url);
    const method = init.method || input.method || 'GET';
    const call = { method, path: url.pathname, query: Object.fromEntries(url.searchParams), headers: Object.fromEntries(new Headers(init.headers || input.headers)), body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
      cache: init.cache, redirect: init.redirect, signal: init.signal };
    calls.push(call);
    if (url.origin !== PROVIDER) { unhandled.push(call); throw new Error('Unplanned external request'); }
    if (url.pathname === '/auth/v1/user' && method === 'GET') {
      userReads++;
      return options.authError || (options.revokeAfterFirstUserRead && userReads > 1) ? response({ message: 'Synthetic Auth rejection' }, 401) : response(user);
    }
    if (url.pathname === '/rest/v1/rpc/triniti_admin_session_check') {
      sessionReads++;
      return response(options.sessionActive !== false && !(options.revokeAfterFirstSessionRead && sessionReads > 1));
    }
    if (url.pathname === '/rest/v1/admin_users' && method === 'GET') {
      if (Object.keys(call.query).sort().join(',') !== 'select,user_id' || call.query.select !== 'role,active' || call.query.user_id !== 'eq.' + ACTOR) {
        unhandled.push(call); throw new Error('Unexpected staff-role query');
      }
      return response([{ role: options.role || 'super_admin', active: options.active !== false }]);
    }
    if (url.pathname === '/auth/v1/recover' && method === 'POST') {
      challenge = call.body.code_challenge;
      return response({});
    }
    if (url.pathname === '/auth/v1/token' && method === 'POST' && call.query.grant_type === 'pkce') {
      const actual = crypto.createHash('sha256').update(call.body.code_verifier || '').digest('base64url');
      if (options.exchangeError || redeemed || call.body.auth_code !== 'synthetic-recovery-code' || actual !== challenge) return response({ code: 'flow_state_expired', msg: 'Synthetic exchange rejection' }, 400);
      redeemed = true;
      return response(session);
    }
    if (url.pathname === '/auth/v1/logout' && method === 'POST') return response({});
    const handled = await options.respond?.(call);
    if (handled !== undefined) return handled;
    unhandled.push(call);
    throw new Error('Unplanned endpoint request ' + method + ' ' + url.pathname);
  }
  const modules = new Map();
  function load(file) {
    let full = path.isAbsolute(file) ? file : path.join(ADMIN, file);
    if (!path.extname(full)) full += '.ts';
    if (modules.has(full)) return modules.get(full).exports;
    const mod = { exports: {} }; modules.set(full, mod); loaded.push(path.relative(ADMIN, full));
    const code = ts.transpileModule(fs.readFileSync(full, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    const local = name => {
      if (name === 'server-only') return {};
      if (name === 'next/headers') return { cookies: async () => jar, headers: async () => new Headers({ origin: SITE }) };
      if (name === 'next/navigation') return { redirect: url => { throw Object.assign(new Error('REDIRECT ' + url), { redirect: url }); }, notFound: () => { throw new Error('NOT_FOUND'); } };
      if (name.startsWith('@/')) return load(path.join(ADMIN, name.slice(2)));
      if (name.startsWith('.')) return load(path.resolve(path.dirname(full), name));
      return req(name);
    };
    vm.runInNewContext(code, { module: mod, exports: mod.exports, require: local, process: { env: environment }, fetch: fetchFixture,
      Buffer, URL, URLSearchParams, Request, Response, Headers, FormData, File, Blob, TextEncoder, TextDecoder,
      AbortSignal, AbortController, setTimeout: (fn, ms) => { timers.push(ms); return setTimeout(fn, options.fastDeadline ? 1 : ms); }, clearTimeout, Date, Promise, Map, Set, WeakMap, Uint8Array, Array, Object, String, Number, Math, Error, TypeError, RegExp, JSON, console, crypto: crypto.webcrypto }, { filename: full });
    return mod.exports;
  }
  return { load, calls, unhandled, loaded, stored, cookieWrites, timers, token, session, environment,
    request(route, init = {}) { return new (req('next/server').NextRequest)(SITE + route, init); },
    async startRecovery() {
      const client = await load('lib/adminRecovery.ts').recoveryPkceClient();
      const result = await client.auth.resetPasswordForEmail(user.email, { redirectTo: SITE + '/reset-password/callback' });
      if (result.error) throw result.error;
    } };
}
module.exports = { endpointHarness, response, ACTOR, SESSION, OBJECT, SITE, PROVIDER, SECRET };
