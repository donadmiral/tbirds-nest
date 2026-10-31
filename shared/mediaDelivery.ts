const BUCKETS = ['post-media', 'story-media', 'media', 'chat-media', 'chat-files'];
export function mediaDeliveryUrl(base: string, bucket: string, path: string, token: string): string {
  return `${new URL(base).origin}/functions/v1/media-content/${encodeURIComponent(bucket)}/${path.split('/').map(encodeURIComponent).join('/')}?token=${encodeURIComponent(token)}`;
}
export function mediaDeliveryObject(value: string, base: string): { bucket: string; path: string; key: string } | null {
  try {
    const url = new URL(value);
    if (url.origin !== new URL(base).origin || url.username || url.password || url.hash) return null;
    const match = url.pathname.match(/^\/functions\/v1\/media-content\/([^/]+)\/(.+)$/);
    if (!match || !BUCKETS.includes(match[1])) return null;
    const path = decodeURIComponent(match[2]);
    if (!path || path.length > 1024 || /[%\\\u0000-\u001f]/.test(path) || path.split('/').some(part => !part || part === '.' || part === '..')) return null;
    return { bucket: match[1], path, key: `${match[1]}/${path}` };
  } catch { return null; }
}
export function isMediaDeliveryCapability(value: string, base: string): boolean {
  return !!mediaDeliveryObject(value, base) && /^[0-9a-f]{64}$/.test(new URL(value).searchParams.get('token') || '');
}
export function privateImageCachePolicy(value?: string | null): 'none' | 'memory-disk' {
  return value && /\/(?:storage\/v1\/(?:object|render\/image)\/(?:sign|authenticated)\/(?:post-media|story-media|media|chat-media|chat-files)|functions\/v1\/media-content)\/|\/functions\/v1\/limited-media-file(?:[/?]|$)/.test(value)
    ? 'none' : 'memory-disk';
}
