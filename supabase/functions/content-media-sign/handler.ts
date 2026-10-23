import { CONTENT_UUID, contentObject, isContentCapability, type ContentReference } from '../../../shared/contentMedia.ts';

type Dependencies = {
  base: string;
  authenticate(request: Request): Promise<boolean>;
  manifest(request: Request, references: ContentReference[]): Promise<Array<{ media_url: string }> | null>;
  uploads?(request: Request, urls: string[]): Promise<Array<{ media_url: string }> | null>;
  sign(bucket: string, paths: string[], ttl: number): Promise<Array<{ path: string; signedUrl: string }> | null>;
};
const TTL = 300;
export function createContentMediaHandler(deps: Dependencies) {
  return async (request: Request) => {
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return json(405, { error: 'Use POST.' });
    try {
      if (!await deps.authenticate(request)) return json(401, { error: 'Authentication required.' });
      if (Number(request.headers.get('content-length')) > 16000) return json(413, { error: 'Request too large.' });
      const text = await request.text();
      if (text.length > 16000) return json(413, { error: 'Request too large.' });
      let body;
      try { body = JSON.parse(text); } catch { return json(400, { error: 'Invalid request.' }); }
      if (!body || typeof body !== 'object') return json(400, { error: 'Valid content references required.' });
      let manifest: Array<{ media_url: string }> | null;
      if (body.uploads !== undefined) {
        if (body.references !== undefined || !Array.isArray(body.uploads) || !body.uploads.length || body.uploads.length > 100 || body.uploads.some((url: unknown) => typeof url !== 'string' || !contentObject(url, deps.base))) return json(400, { error: 'Valid upload references required.' });
        if (!deps.uploads) return json(503, { error: 'Upload previews are not available. Try again.' });
        manifest = await deps.uploads(request, body.uploads);
      } else {
        if (!Array.isArray(body.references) || !body.references.length || body.references.length > 100 || body.references.some((ref: ContentReference) => !ref || !['post', 'story', 'sound', 'story_draft', 'memory_album', 'highlight'].includes(ref.kind) || typeof ref.id !== 'string' || !CONTENT_UUID.test(ref.id))) return json(400, { error: 'Valid content references required.' });
        manifest = await deps.manifest(request, body.references);
      }
      if (!manifest) return json(503, { error: 'Media access is unavailable. Try again.' });
      const objects = new Map<string, { bucket: string; path: string; key: string }>();
      for (const row of manifest) {
        const object = typeof row.media_url === 'string' ? contentObject(row.media_url, deps.base) : null;
        if (object) objects.set(object.key, object);
      }
      if (objects.size > 2000) return json(413, { error: 'Too many media references. Request fewer posts.' });
      const urls: Array<{ key: string; url: string }> = [];
      for (const bucket of new Set([...objects.values()].map(object => object.bucket))) {
        const paths = [...objects.values()].filter(object => object.bucket === bucket).map(object => object.path);
        for (let index = 0; index < paths.length; index += 100) {
          const batch = paths.slice(index, index + 100);
          const signed = await deps.sign(bucket, batch, TTL);
          if (!signed) return json(503, { error: 'Media access is unavailable. Try again.' });
          for (const row of signed) {
            if (!batch.includes(row.path)) continue;
            const object = contentObject(row.signedUrl, deps.base);
            if (object?.bucket === bucket && object.path === row.path && isContentCapability(row.signedUrl, deps.base)) urls.push({ key: object.key, url: row.signedUrl });
          }
        }
      }
      return json(200, { urls, expiresAt: Date.now() + TTL * 1000 });
    } catch { return json(503, { error: 'Media access is unavailable. Try again.' }); }
  };
}
