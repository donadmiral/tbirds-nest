import { createClient } from 'npm:@supabase/supabase-js@2.112.3';
import { createMusicFinalizeHandler } from './handler.ts';
const base = Deno.env.get('SUPABASE_URL')!, key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const service = createClient(base, key, { auth: { persistSession: false, autoRefreshToken: false } });
const caller = (request: Request, signal: AbortSignal) => createClient(base, Deno.env.get('SUPABASE_ANON_KEY')!, {
  global: { headers: { Authorization: request.headers.get('Authorization') || '' }, fetch: (input, init) => fetch(input, { ...init, signal }) },
  auth: { persistSession: false, autoRefreshToken: false },
});
Deno.serve(createMusicFinalizeHandler({
  async getUpload(request, id, signal) {
    const client = caller(request, signal), { data: identity, error: authError } = await client.auth.getUser();
    if (authError || !identity.user || identity.user.is_anonymous) return null;
    const { data, error } = await client.rpc('get_original_audio_upload', { p_request_id: id }).abortSignal(signal);
    return error || data?.ownerId !== identity.user.id ? null : data;
  },
  async object(upload) { return upload.objectVersion ? { version: upload.objectVersion } : null; },
  download: (upload, signal) => fetch(`${base}/storage/v1/object/authenticated/music-audio/${upload.path}`, {
    headers: { Authorization: `Bearer ${key}`, apikey: key, 'Cache-Control': 'no-store' }, signal,
  }),
  async finish(upload, duration, sha256, version, signal) {
    const { data, error } = await service.rpc('finish_original_audio_upload', {
      p_request_id: upload.id, p_owner: upload.ownerId, p_duration: duration, p_sha256: sha256, p_object_version: version,
    }).abortSignal(signal);
    return error ? null : data;
  },
  async digest(bytes) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(byte => byte.toString(16).padStart(2, '0')).join(''); },
}));
