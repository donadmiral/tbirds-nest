/* Actual exported actions, Auth/session/permission helpers and the admin's
 * installed SDK. All HTTP is intercepted at a synthetic origin; no provider
 * credentials, email, account creation, password reset or payment is executed. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const ADMIN = path.resolve(__dirname, '../..');
const req = createRequire(path.join(ADMIN, 'package.json'));
const ts = req('typescript');
const ACTOR = '10000000-0000-4000-8000-000000000001';
const SESSION = '20000000-0000-4000-8000-000000000002';
const KEY = '30000000-0000-4000-8000-000000000003';
const TARGET = '40000000-0000-4000-8000-000000000004';
const FACTOR = '50000000-0000-4000-8000-000000000005';
const PROVISION = '60000000-0000-4000-8000-000000000006';
const PROVIDER = 'https://custom-action.example.invalid';
const SITE = 'https://admin-action.example.invalid';
const response = (body, status = 200) => new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function form(fields = {}) { const data = new FormData(); for (const [key, values] of Object.entries(fields)) for (const value of Array.isArray(values) ? values : [values]) data.append(key, value); return data; }

function customActionHarness(options = {}) {
  const calls = [], loaded = [], unhandled = [], revalidated = [], cookieWrites = [], stored = new Map(), modules = new Map();
  const now = Math.floor(Date.now() / 1000);
  const claims = { sub: ACTOR, session_id: SESSION, exp: now + 3600, aal: 'aal1', amr: [{ method: 'password', timestamp: now }], ...options.claims };
  const tokenFor = extra => Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url') + '.' + Buffer.from(JSON.stringify({ ...claims, ...extra })).toString('base64url') + '.fixture';
  const token = tokenFor({});
  const user = { id: ACTOR, email: 'synthetic-staff@example.invalid', aud: 'authenticated', role: 'authenticated', created_at: new Date().toISOString(), app_metadata: {}, user_metadata: {}, factors: options.factors || [] };
  const sessionFor = extra => ({ access_token: tokenFor(extra), refresh_token: 'synthetic-action-refresh', expires_at: now + 3600, expires_in: 3600, token_type: 'bearer', user });
  const session = sessionFor({});
  const environment = { NODE_ENV: 'production', VERCEL_ENV: 'preview', ADMIN_AUTH_ORIGINS: SITE, NEXT_PUBLIC_SUPABASE_URL: PROVIDER, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'synthetic-anon', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-local-service-key-never-a-provider-credential', ...options.env };
  if (options.signedIn !== false) { stored.set('pc_admin_token', token); stored.set('pc_admin_refresh', session.refresh_token); }
  const jar = { get: key => stored.has(key) ? { value: stored.get(key) } : undefined, set(key, value, settings) { cookieWrites.push({ key, settings }); stored.set(key, value); }, delete(key) { stored.delete(key); } };
  async function fetchFixture(input, init = {}) {
    const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url);
    const call = { path: url.pathname, method: init.method || 'GET', query: Object.fromEntries(url.searchParams), headers: Object.fromEntries(new Headers(init.headers)), body: typeof init.body === 'string' ? JSON.parse(init.body) : null };
    calls.push(call);
    if (url.origin !== PROVIDER) { unhandled.push(call); throw new Error('External request rejected'); }
    const result = await options.respond?.(call, { user, session, sessionFor });
    if (result !== undefined) return result;
    if (call.path === '/auth/v1/user' && call.method === 'GET') return options.authError ? response({ message: 'Synthetic authorization rejection' }, 401) : response(user);
    if (call.path === '/rest/v1/rpc/triniti_admin_session_check') return response(options.sessionActive !== false);
    if (call.path === '/rest/v1/admin_users' && call.method === 'GET') return response([{ role: options.role || 'super_admin', active: options.active !== false }]);
    if (call.path === '/auth/v1/token' && call.query.grant_type === 'password') return response(session);
    if (call.path === '/auth/v1/logout' && call.method === 'POST') return response({});
    if (call.path === '/auth/v1/factors' && call.method === 'POST') return response({ id: FACTOR, type: 'totp', totp: { qr_code: 'synthetic-qr', secret: 'synthetic-test-secret', uri: 'otpauth://synthetic' } });
    if (call.path.startsWith('/auth/v1/factors/') && call.method === 'DELETE') return response({});
    if (call.path.endsWith('/challenge')) return response({ id: 'synthetic-challenge', expires_at: now + 60 });
    if (call.path.endsWith('/verify')) return response(sessionFor({ aal: 'aal2' }));
    unhandled.push(call); throw new Error(`Unplanned action transport: ${call.method} ${call.path}`);
  }
  function load(file) {
    let full = path.isAbsolute(file) ? file : path.join(ADMIN, file);
    if (!path.extname(full)) full += '.ts';
    if (modules.has(full)) return modules.get(full).exports;
    const module = { exports: {} }; modules.set(full, module); loaded.push(path.relative(ADMIN, full));
    const local = name => {
      if (name === 'server-only') return {};
      if (name === 'next/headers') return { cookies: async () => jar, headers: async () => new Headers({ origin: options.origin || SITE }) };
      if (name === 'next/cache') return { revalidatePath: (...args) => revalidated.push(args) };
      if (name === 'next/navigation') return { redirect: url => { throw Object.assign(new Error('REDIRECT ' + url), { redirect: url }); }, notFound: () => { throw new Error('NOT_FOUND'); } };
      if (name.startsWith('@/')) return load(path.join(ADMIN, name.slice(2)));
      if (name.startsWith('.')) return load(path.resolve(path.dirname(full), name));
      return req(name);
    };
    const code = ts.transpileModule(fs.readFileSync(full, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    vm.runInNewContext(code, { module, exports: module.exports, require: local, process: { env: environment }, fetch: fetchFixture,
      Buffer, URL, URLSearchParams, Request, Response, Headers, FormData, File, Blob, TextEncoder, TextDecoder, AbortSignal, AbortController,
      setTimeout, clearTimeout, Date, Promise, Map, Set, WeakMap, Uint8Array, Array, Object, String, Number, Math, Error, TypeError, RegExp, JSON, console, crypto: crypto.webcrypto }, { filename: full });
    return module.exports;
  }
  return { load, calls, loaded, unhandled, revalidated, cookieWrites, stored, token, user, session, sessionFor };
}
module.exports = { customActionHarness, form, response, ACTOR, SESSION, KEY, TARGET, FACTOR, PROVISION, ADMIN };
