import { createClient } from 'npm:@supabase/supabase-js@2.112.3';
import { createMediaContentHandler } from './handler.ts';
import { serviceRoleFetch } from '../_shared/serviceRoleFetch.ts';
const base = Deno.env.get('SUPABASE_URL')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const backendFetch = serviceRoleFetch(fetch, serviceKey);
const client = createClient(base, serviceKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: backendFetch } });
// Streaming has the handler's startup/read-idle deadlines. Do not give an
// entire long-lived media response the short database request timeout.
const mediaFetch: typeof fetch = (input, init) => {
  const headers = new Headers(init?.headers);
  if (serviceKey.startsWith('sb_secret_')) { headers.set('apikey', serviceKey); headers.delete('Authorization'); }
  return fetch(input, { ...init, headers });
};
Deno.serve(createMediaContentHandler({ base, serviceKey, fetch: mediaFetch,
  async resolve(token, bucket, path, signal) {
    const { data, error } = await client.rpc('resolve_media_delivery', { p_token: token, p_bucket: bucket, p_path: path }).abortSignal(signal);
    if (error) throw new Error('Media authorization unavailable');
    return data;
  },
  ...(Deno.env.get('MEDIA_VARIANT_DELIVERY') === 'true' ? {
    async resolveVariant(token: string, bucket: string, path: string, version: string, signal: AbortSignal) {
      const { data, error } = await client.rpc('resolve_media_variant_for_ticket_v1', { p_token: token, p_bucket: bucket, p_path: path, p_source_version: version }).abortSignal(signal);
      if (error) throw new Error('Media variant lookup unavailable');
      return data;
    },
  } : {}),
  diagnostic(event) {
    // Successful requests expose phase timings in Server-Timing. Log slow
    // starts and failures without capabilities, object paths or private data.
    if (event.outcome === 'timeout' || event.outcome === 'error' || (event.outcome === 'ready' && event.elapsedMs >= 2000)) {
      console.warn(JSON.stringify({ event: 'media_delivery', ...event }));
    }
  },
}));
