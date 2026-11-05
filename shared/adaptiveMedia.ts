/** Capabilities are ephemeral and stay in this small process-local readiness cache. */
type Ready = { source: string; hlsUrl: string; sourceVersion: string; expiresAt: number };
const ready = new Map<string, { value: Ready | null; until: number }>();
const pending = new Map<string, { task: Promise<Ready | null>; controller: AbortController; id: object }>();
let generation = 0;
// Only immutable rendered clip formats can enter the published-content lane.
const liveClipPath = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/){4}(?:horizontal|vertical)\.mp4$/;

/** Seeded by the authorized signing response before the first player mounts. */
export function acceptAdaptiveMedia(grants: Array<{ source: string; hlsUrl: string; sourceVersion: string; expiresAt: number }>): void {
  for (const grant of grants.slice(0, 128)) {
    const value = validateAdaptiveMedia(grant.source, { ...grant, ready: true });
    if (!value) continue;
    pending.get(grant.source)?.controller.abort();
    pending.delete(grant.source);
    ready.delete(grant.source);
    ready.set(grant.source, { value, until: Math.min(value.expiresAt - 5000, Date.now() + 60000) });
  }
  while (ready.size > 128) ready.delete(ready.keys().next().value!);
}

function validateAdaptiveMedia(source: string, data: any): Ready | null {
  try {
    if (!adaptiveProbeUrl(source)) return null;
    const original = new URL(source), u = new URL(data.hlsUrl);
    return data.ready === true && u.protocol === 'https:' && !u.username && !u.password && !u.hash
      && /^\/playback\/(post-media|story-media|live-clips)\//.test(u.pathname)
      && decodeURIComponent(u.pathname) === decodeURIComponent(original.pathname.replace('/functions/v1/media-content/', '/playback/')) + '/master.m3u8'
      && [...u.searchParams.keys()].every(key => key === 'token') && u.searchParams.getAll('token').length === 1 && u.searchParams.get('token') === original.searchParams.get('token')
      && typeof data.sourceVersion === 'string' && data.sourceVersion.length > 0 && data.sourceVersion.length <= 128
      && Number.isFinite(data.expiresAt) && data.expiresAt > Date.now() + 10000
      ? { source, hlsUrl: u.href, sourceVersion: data.sourceVersion, expiresAt: data.expiresAt } : null;
  } catch { return null; }
}
export function adaptiveProbeUrl(source: string): string | null {
  try {
    const u = new URL(source);
    const clip = u.pathname.match(/^\/functions\/v1\/media-content\/live-clips\/(.+)$/);
    const permitted = /^\/functions\/v1\/media-content\/(post-media|story-media)\/.+\.(mp4|mov|m4v)$/i.test(u.pathname)
      || !!(clip && liveClipPath.test(clip[1]) && !u.hash && [...u.searchParams.keys()].every(key => key === 'token'));
    if (u.protocol !== 'https:' || u.username || u.password || !permitted || u.searchParams.getAll('token').length !== 1 || !/^[0-9a-f]{64}$/.test(u.searchParams.get('token') || '')) return null;
    u.searchParams.set('stream', 'check'); return u.href;
  } catch { return null; }
}
export function clearAdaptiveMedia(): void {
  generation++; ready.clear();
  for (const request of pending.values()) request.controller.abort();
  pending.clear();
}
export function knownAdaptiveMedia(source: string): Ready | null {
  const value = ready.get(source); return value && value.until > Date.now() ? value.value : null;
}
export async function resolveAdaptiveMedia(source: string, fetcher: typeof fetch = fetch): Promise<Ready | null> {
  const probe = adaptiveProbeUrl(source); if (!probe) return null;
  const hit = ready.get(source); if (hit && hit.until > Date.now()) return hit.value;
  const current = pending.get(source); if (current) return current.task;
  // Scrolling through many cards cannot queue unlimited readiness requests.
  if (pending.size >= 4) return null;
  const startedGeneration = generation, controller = new AbortController(), requestId = {};
  const task = (async () => {
    const timer = setTimeout(() => controller.abort(), 1500);
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
      value = validateAdaptiveMedia(source, JSON.parse(text));
    } catch { /* Processing and gateway availability must not delay original playback. */ }
    finally { clearTimeout(timer); }
    if (startedGeneration !== generation) return null;
    if (pending.get(source)?.id !== requestId) return knownAdaptiveMedia(source);
    ready.delete(source); ready.set(source, { value, until: value ? Math.min(value.expiresAt - 5000, Date.now() + 60000) : Date.now() + 30000 });
    while (ready.size > 128) ready.delete(ready.keys().next().value!);
    return value;
  })();
  pending.set(source, { task, controller, id: requestId });
  try { return await task; } finally { if (pending.get(source)?.task === task) pending.delete(source); }
}
