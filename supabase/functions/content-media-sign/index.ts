import { createClient } from 'npm:@supabase/supabase-js@2.112.3';
import { createContentMediaHandler } from './handler.ts';
import { mediaDeliveryUrl } from '../../../shared/mediaDelivery.ts';

const base = Deno.env.get('SUPABASE_URL')!;
const userClient = (request: Request) => createClient(base, Deno.env.get('SUPABASE_ANON_KEY')!, {
  global: { headers: { Authorization: request.headers.get('Authorization') || '' } },
  auth: { persistSession: false, autoRefreshToken: false },
});
Deno.serve(createContentMediaHandler({
  base,
  async authenticate(request) {
    const { data, error } = await userClient(request).auth.getUser();
    return !error && !!data.user && !data.user.is_anonymous;
  },
  async manifest(request, references) {
    // Authorization is evaluated with the caller's JWT, never the service role.
    const { data, error } = await userClient(request).rpc('content_media_manifest', { p_references: references });
    return error ? null : data;
  },
  async uploads(request, urls) {
    const { data, error } = await userClient(request).rpc('content_upload_manifest', { p_urls: urls });
    return error ? null : data;
  },
  async sign(bucket, paths, ttl) {
    const service = createClient(base, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await service.storage.from(bucket).createSignedUrls(paths, ttl);
    if (error) return null;
    return (data ?? []).flatMap(row => row.path && row.signedUrl && !row.error ? [{ path: row.path, signedUrl: row.signedUrl }] : []);
  },
  async deliver(request, references, uploads) {
    const { data, error } = await userClient(request).rpc('issue_content_media_delivery', { p_references: references, p_uploads: uploads });
    if (error || !Array.isArray(data)) return null;
    return {
      urls: data.map(row => ({ key: `${row.bucket_id}/${row.object_path}`, url: mediaDeliveryUrl(base, row.bucket_id, row.object_path, row.token) })),
      expiresAt: Math.min(Date.now() + 300000, ...data.map(row => Date.parse(row.expires_at))),
    };
  },
}));
