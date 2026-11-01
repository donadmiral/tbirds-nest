import { createClient } from 'npm:@supabase/supabase-js@2.112.3';
import { createMediaContentHandler } from './handler.ts';
const base = Deno.env.get('SUPABASE_URL')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const client = createClient(base, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
Deno.serve(createMediaContentHandler({ base, serviceKey, fetch,
  async resolve(token, bucket, path, signal) {
    const { data, error } = await client.rpc('resolve_media_delivery', { p_token: token, p_bucket: bucket, p_path: path }).abortSignal(signal);
    if (error) throw new Error('Media authorization unavailable');
    return data;
  },
  diagnostic(event) {
    // Successful requests expose phase timings in Server-Timing. Log slow
    // starts and failures without capabilities, object paths or private data.
    if (event.outcome === 'timeout' || event.outcome === 'error' || (event.outcome === 'ready' && event.elapsedMs >= 2000)) {
      console.warn(JSON.stringify({ event: 'media_delivery', ...event }));
    }
  },
}));
