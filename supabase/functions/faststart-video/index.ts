import { createClient } from 'npm:@supabase/supabase-js@2.112.3';
import { createFaststartHandler } from './handler.ts';
import { faststartRemux } from './remux.ts';

const base = Deno.env.get('SUPABASE_URL')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const client = createClient(base, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
Deno.serve(createFaststartHandler({
  serviceKey,
  db: client,
  remux: faststartRemux,
  async download(bucket, path, version, lease) {
    const locator = [bucket, ...path.split('/')].map(encodeURIComponent).join('/');
    const url = new URL(`/storage/v1/object/authenticated/${locator}`, base);
    url.searchParams.set('faststart_version', version);
    url.searchParams.set('faststart_attempt', lease);
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey, 'Cache-Control': 'no-cache' },
      cache: 'no-store', signal: AbortSignal.timeout(45000),
    });
    if (!response.ok) throw new Error('Download unavailable');
    return { blob: await response.blob(), etag: response.headers.get('ETag') };
  },
  async update(bucket, path, bytes, contentType, metadata) {
    return client.storage.from(bucket).update(path, bytes, { contentType, metadata, upsert: false });
  },
}));
