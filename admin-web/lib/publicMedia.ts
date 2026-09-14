/** Explicit public content buckets. Chat files and identity documents are excluded. */
const CONTENT_BUCKETS = new Set(['media', 'avatars', 'mingle-images', 'mingle-media', 'business-media', 'startup-media', 'story-media', 'post-media', 'market-media']);
export function publicMediaUrl(raw: string, base: string, publicBuckets: ReadonlySet<string>): string | null {
  if (!raw || raw.length > 4096) return null;
  try {
    const origin = new URL(base);
    const value = raw.trim();
    let bucket: string;
    let path: string;
    if (/^https?:\/\//i.test(value)) {
      const url = new URL(value);
      if (url.origin !== origin.origin || url.username || url.password) return null;
      const match = url.pathname.match(/^\/storage\/v1\/(?:object|render\/image)\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/);
      if (!match) return null;
      bucket = decodeURIComponent(match[1]);
      path = decodeURIComponent(match[2]);
    } else {
      if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('/') || value.includes('?') || value.includes('#')) return null;
      const slash = value.indexOf('/');
      if (slash < 1) return null;
      bucket = value.slice(0, slash);
      path = decodeURIComponent(value.slice(slash + 1));
    }
    if (!CONTENT_BUCKETS.has(bucket) || !publicBuckets.has(bucket)) return null;
    if (/[\\\x00-\x1f\x7f]/.test(path) || path.split('/').some(part => !part || part === '.' || part === '..')) return null;
    return origin.origin + '/storage/v1/object/public/' + encodeURIComponent(bucket) + '/' + path.split('/').map(encodeURIComponent).join('/');
  } catch { return null; }
}
