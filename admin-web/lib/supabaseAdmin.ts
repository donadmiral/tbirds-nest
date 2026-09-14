import 'server-only';
import { createClient } from '@supabase/supabase-js';

function setting(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) throw new Error('Missing server configuration: ' + key);
  return value;
}
const options = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, { ...init, cache: 'no-store' }) },
};
export function serviceClient() {
  const client = createClient(setting('NEXT_PUBLIC_SUPABASE_URL'), setting('SUPABASE_SERVICE_ROLE_KEY'), options);
  const from = client.from.bind(client);
  client.from = ((table: string) => new Proxy(from(table), {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        const query = value.apply(target, args);
        return typeof query?.throwOnError === 'function' ? query.throwOnError() : query;
      };
    },
  })) as typeof client.from;
  return client;
}
export function anonClient() {
  return createClient(setting('NEXT_PUBLIC_SUPABASE_URL'), setting('NEXT_PUBLIC_SUPABASE_ANON_KEY'), options);
}
