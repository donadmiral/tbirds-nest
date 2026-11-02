/** Capabilities are ephemeral and stay in this small process-local readiness cache. */
type Ready = { source: string; hlsUrl: string; sourceVersion: string; expiresAt: number };
const ready = new Map<string, { value: Ready | null; until: number }>();
const pending = new Map<string, Promise<Ready | null>>();
let generation = 0;
export function adaptiveProbeUrl(source: string): string | null {
  try {
    const u = new URL(source);
    if (u.protocol !== 'https:' || u.username || u.password || !/^\/functions\/v1\/media-content\/(post-media|story-media)\/.+\.(mp4|mov|m4v)$/i.test(u.pathname) || !/^[0-9a-f]{64}$/.test(u.searchParams.get('token') || '')) return null;
    u.searchParams.set('stream', 'check'); return u.href;
  } catch { return null; }
}
export function clearAdaptiveMedia(): void { generation++; ready.clear(); }
export function knownAdaptiveMedia(source: string): Ready | null {
  const value = ready.get(source); return value && value.until > Date.now() ? value.value : null;
}
export async function resolveAdaptiveMedia(source: string, fetcher: typeof fetch = fetch): Promise<Ready | null> {
  const probe = adaptiveProbeUrl(source); if (!probe) return null;
  const hit = ready.get(source); if (hit && hit.until > Date.now()) return hit.value;
  const current = pending.get(source); if (current) return current;
  // Scrolling through many cards cannot queue unlimited readiness requests.
  if (pending.size >= 4) return null;
  const task = (async () => {
    const startedGeneration = generation;
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 1500);
    let value: Ready | null = null;
    try {
      const response = await fetcher(probe, { signal: controller.signal, cache: 'no-store', credentials: 'omit' });
      if (!response.ok || Number(response.headers.get('Content-Length')) > 4096) { await response.body?.cancel(); throw new Error('Readiness unavailable'); }
      let text: string;
      if (response.body?.getReader) {
        const reader = response.body.getReader(), chunks: Uint8Array[] = []; let bytes = 0;
        try { for (;;) { const next = await reader.read(); if (next.done) break; bytes += next.value.byteLength; if (bytes > 4096) throw new Error('Readiness budget'); chunks.push(next.value); } }
        finally { void reader.cancel().catch(() => {}); }
        const content = new Uint8Array(bytes); let offset = 0; for (const chunk of chunks) { content.set(chunk, offset); offset += chunk.byteLength; }
        text = new TextDecoder().decode(content);
      } else {
        // React Native's fetch can omit ReadableStream. The gateway emits an
        // explicit bounded length for this small discovery response.
        const declared = Number(response.headers.get('Content-Length'));
        if (!Number.isInteger(declared) || declared < 1 || declared > 4096) throw new Error('Missing readiness length');
        text = await response.text(); if (text.length > 4096) throw new Error('Readiness budget');
      }
      const data = JSON.parse(text), u = new URL(data.hlsUrl);
      if (data.ready === true && u.protocol === 'https:' && !u.username && !u.password && /^\/playback\/(post-media|story-media)\//.test(u.pathname)
        && decodeURIComponent(u.pathname) === decodeURIComponent(new URL(source).pathname.replace('/functions/v1/media-content/', '/playback/')) + '/master.m3u8'
        && u.searchParams.get('token') === new URL(source).searchParams.get('token') && typeof data.sourceVersion === 'string'
        && Number.isFinite(data.expiresAt) && data.expiresAt > Date.now() + 10000) value = { source, hlsUrl: u.href, sourceVersion: data.sourceVersion, expiresAt: data.expiresAt };
    } catch { /* Processing and gateway availability must not delay original playback. */ }
    finally { clearTimeout(timer); }
    if (startedGeneration !== generation) return null;
    ready.delete(source); ready.set(source, { value, until: value ? Math.min(value.expiresAt - 5000, Date.now() + 60000) : Date.now() + 30000 });
    while (ready.size > 128) ready.delete(ready.keys().next().value!);
    return value;
  })();
  pending.set(source, task);
  try { return await task; } finally { pending.delete(source); }
}
