/** Local browser regression transport. No hosted requests or credentials. */
import type { SupabaseClient } from '@supabase/supabase-js';
import * as social from './social-backend';
import * as commerce from './commerce-backend';
export * from './social-backend';

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { message: string; code?: string } | null };
type Request = { kind: string; name: string; action?: string; args?: unknown; fault: boolean; pinned?: boolean; cancellable?: boolean; aborted?: boolean };
const params = new URLSearchParams(location.search);
const wordAuthListeners = new Set<(event: string, session: ReturnType<typeof wordSession>) => void>();
const heldWordSessions: (() => void)[] = [], heldWordWrites: (() => void)[] = [], heldWordReads: (() => void)[] = [];
let wordSessionNumber = 1;
function wordSession() { const owner = social.fixture.owner(); return owner ? { user: { id: owner }, access_token: 'synthetic-word-session-' + wordSessionNumber } : null; }
const state = {
  mode: params.get('mode') || 'normal', target: params.get('target') || '',
  requests: [] as Request[], words: { hidden_words: ['existing'], muted_words: ['existing'] },
  wordUpdateMode: 'normal', wordReadMode: 'normal', holdWordSession: false, pendingWordSessions: 0,
  releaseWordSessions() { state.holdWordSession = false; heldWordSessions.splice(0).forEach(release => release()); },
  releaseWordWrites() { heldWordWrites.splice(0).forEach(release => release()); },
  releaseWordReads() { heldWordReads.splice(0).forEach(release => release()); },
  switchWordOwner(owner: string | null) { social.fixture.switchOwner(owner); wordSessionNumber++; wordAuthListeners.forEach(listener => listener(owner ? 'SIGNED_IN' : 'SIGNED_OUT', wordSession())); },
  replaceWordSession() { wordSessionNumber++; wordAuthListeners.forEach(listener => listener('SIGNED_IN', wordSession())); },
};
declare global { interface Window { __memberResilience: typeof state } }
window.__memberResilience = state;
const result = (data: unknown): Result => ({ data: structuredClone(data), error: null });
function failure(): Result {
  if (state.mode === 'rejected') throw new Error('Controlled request rejection');
  return { data: null, error: { message: 'Controlled request failure', code: 'FIXTURE' } };
}
function broken(kind: string, name: string, action = 'read') {
  return state.mode !== 'normal' && [kind + ':' + name, kind + ':' + name + ':' + action].includes(state.target);
}
function fluent(client: SupabaseClient, table: string) {
  const chain: [string, unknown[]][] = []; let action = 'read'; let cached: Promise<unknown> | null = null;
  const run = () => cached ??= Promise.resolve().then(async () => {
    const fault = broken('table', table, action);
    const request: Request = { kind: 'table', name: table, action, args: chain, fault };
    state.requests.push(request);
    if (fault) return failure();
    const columns = String(chain.find(([name]) => name === 'select')?.[1][0] || '');
    if (table === 'profiles' && action === 'read' && ['hidden_words', 'muted_words'].includes(columns)) {
      const signal = chain.find(([name]) => name === 'abortSignal')?.[1][0] as AbortSignal | undefined;
      request.pinned = chain.some(([name, args]) => name === 'setHeader' && args[0] === 'Authorization' && args[1] === 'Bearer ' + wordSession()?.access_token);
      request.cancellable = !!signal;
      signal?.addEventListener('abort', () => { request.aborted = true; }, { once: true });
      if (state.wordReadMode === 'rejected') throw new Error('Controlled word reconciliation rejection');
      if (state.wordReadMode === 'resolved') return { data: null, error: { message: 'Controlled word reconciliation failure' } };
      const row = result({ id: social.fixture.owner(), ...state.words });
      if (state.wordReadMode === 'held') await new Promise<void>(resolve => heldWordReads.push(resolve));
      return row;
    }
    if (table === 'profiles' && action === 'update') {
      const update = chain.find(([name]) => name === 'update')?.[1][0] as Row;
      const signal = chain.find(([name]) => name === 'abortSignal')?.[1][0] as AbortSignal | undefined;
      request.pinned = chain.some(([name, args]) => name === 'setHeader' && args[0] === 'Authorization' && args[1] === 'Bearer ' + wordSession()?.access_token);
      request.cancellable = !!signal;
      signal?.addEventListener('abort', () => { request.aborted = true; }, { once: true });
      if (state.wordUpdateMode !== 'held') for (const field of ['hidden_words', 'muted_words'] as const) {
        if (Array.isArray(update[field])) state.words[field] = [...update[field]] as string[];
      }
      // Deliberately ignore transport abort for held responses: the hook must
      // bound its own wait and fence a later acknowledgement as well.
      if (['held', 'committed-held'].includes(state.wordUpdateMode)) await new Promise<void>(resolve => heldWordWrites.push(resolve));
      return result(null);
    }
    if (table === 'member_strikes') return result([]);
    if (table === 'feature_flags') return result({ key: 'market', enabled: true });
    if (table === 'marketplace_listings' && action === 'insert') return result({ id: '30000000-0000-4000-8000-000000000001' });
    if (table === 'posts' && action === 'read' && (location.pathname.startsWith('/topic') || location.pathname === '/ads/new')) {
      return result([{ id: '20000000-0000-4000-8000-000000000001', user_id: social.OWNER, content: 'Existing promotion #CoastalStories', body: null, created_at: '2026-10-30T10:00:00Z', likes_count: 0, comments_count: 0 }]);
    }
    let query: unknown = client.from(table);
    for (const [method, args] of chain) {
      const fn = (query as Record<string, unknown>)[method];
      if (typeof fn !== 'function') throw new Error('Missing fixture method: ' + table + '.' + method);
      query = fn.apply(query, args);
    }
    return query;
  });
  const proxy: object = new Proxy({}, { get(_obj, key) {
    if (key === 'then') return (yes: (value: unknown) => unknown, no: (error: unknown) => unknown) => run().then(yes, no);
    return (...args: unknown[]) => { const method = String(key); if (['insert', 'update', 'upsert', 'delete'].includes(method)) action = method; chain.push([method, args]); return proxy; };
  } });
  return proxy;
}
export function createClient(): SupabaseClient {
  const client = location.pathname.startsWith('/market') ? commerce.createClient() : social.createClient();
  return new Proxy(client, { get(obj, key) {
    if (key === 'auth' && /\/settings\/(hidden|muted)-words/.test(location.pathname)) return {
      ...obj.auth,
      async getSession() {
        if (state.holdWordSession) { state.pendingWordSessions++; await new Promise<void>(resolve => heldWordSessions.push(resolve)); state.pendingWordSessions--; }
        return { data: { session: wordSession() }, error: null };
      },
      async getUser() { return { data: { user: wordSession()?.user ?? null }, error: null }; },
      onAuthStateChange(callback: (event: string, session: ReturnType<typeof wordSession>) => void) { wordAuthListeners.add(callback); return { data: { subscription: { unsubscribe() { wordAuthListeners.delete(callback); } } } }; },
    };
    if (key === 'from') return (table: string) => fluent(obj, table);
    if (key === 'rpc') return (name: string, args: Row) => {
      const work = Promise.resolve().then(() => {
        const fault = broken('rpc', name); state.requests.push({ kind: 'rpc', name, args, fault });
        if (fault) return failure();
        if (name === 'is_username_available') return result(true);
        if (name === 'get_channels') return result([{ id: '40000000-0000-4000-8000-000000000001', name: 'Audit channel', description: 'A populated channel fixture', icon_url: null, member_count: 3, is_member: false }]);
        return obj.rpc(name, args);
      });
      return Object.assign(work, { abortSignal: () => work, setHeader: () => work });
    };
    if (key === 'functions') return { invoke: (name: string, args: Row) => Promise.resolve().then(() => {
      const fault = broken('function', name); state.requests.push({ kind: 'function', name, args, fault });
      if (fault) return failure();
      return result({ business: { username: 'auditbusiness' } });
    }) };
    if (key === 'storage' && location.pathname === '/market/new') return { from: (bucket: string) => ({
      upload: (path: string, file: File) => Promise.resolve().then(() => {
        const fault = broken('storage', bucket); state.requests.push({ kind: 'storage', name: bucket, args: { bytes: file.size, mime: file.type }, fault });
        if (fault) return failure(); return result({ path });
      }),
      getPublicUrl: (path: string) => ({ data: { publicUrl: 'https://fixture.invalid/' + path } }),
    }) };
    return Reflect.get(obj, key);
  } });
}
