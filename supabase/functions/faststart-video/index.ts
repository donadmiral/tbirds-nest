import { createClient } from 'npm:@supabase/supabase-js@2.112.3';
import { createDurableFaststartHandler } from './durable.ts';
import { createLegacyServiceAuthorizer } from '../_shared/legacyServiceAuthorization.ts';
import { serviceRoleFetch } from '../_shared/serviceRoleFetch.ts';
const base = Deno.env.get('SUPABASE_URL')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const backendFetch = serviceRoleFetch(fetch, serviceKey);
const client = createClient(base, serviceKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: backendFetch } });
Deno.serve(createDurableFaststartHandler({
  serviceKey,
  authorizeLegacyService: createLegacyServiceAuthorizer({ base, publicKey: Deno.env.get('SUPABASE_ANON_KEY') || '', fetch }),
  async rpc(name, args, signal) {
    const { data, error } = await client.rpc(name, args).abortSignal(signal);
    if (error) throw new Error('Media job state unavailable'); return data;
  },
  async download(job, signal) {
    const locator = [job.source_bucket, ...job.source_path.split('/')].map(encodeURIComponent).join('/');
    const url = new URL(`/storage/v1/object/authenticated/${locator}`, base);
    url.searchParams.set('source_version', job.source_version); url.searchParams.set('attempt', job.lease_id);
    return backendFetch(url, { headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey,
      'Cache-Control': 'no-store', 'Accept-Encoding': 'identity' }, cache: 'no-store', redirect: 'error', signal });
  },
  async upload(job, bytes, signal) {
    // Never update/upsert the original. The reserved path is unique to this
    // lease, and the SQL guard makes completed output paths immutable.
    const uploadClient = createClient(base, serviceKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: serviceRoleFetch(fetch, serviceKey, signal) } });
    const { error } = await uploadClient.storage.from(job.output_bucket).upload(job.output_path, bytes, {
      contentType: job.source_mime, upsert: false, cacheControl: '0',
      metadata: { processing_job_id: job.job_id, processing_lease_id: job.lease_id, source_id: job.source_id, source_version: job.source_version },
    });
    if (error) throw new Error('Derived upload unavailable');
  },
  async remove(bucket, path, signal) {
    const cleanupClient = createClient(base, serviceKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: serviceRoleFetch(fetch, serviceKey, signal) } });
    const { error } = await cleanupClient.storage.from(bucket).remove([path]);
    if (error) throw new Error('Derived cleanup unavailable');
  },
}));
