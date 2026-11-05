import { isMediaDeliveryCapability, mediaDeliveryObject } from '../../shared/mediaDelivery';

export const PREVIEW_TTL = 24 * 60 * 60_000;
export const PREVIEW_BUDGET = 24_576;
export type FeedPreview = { postId: string; mediaId: string; object: string; uri: string; width: number; height: number; mediaType: string; expiresAt: number };
export type PreviewEnvelope = { version: 1; identity: string; expiresAt: number; key: CryptoKey; iv: Uint8Array; encrypted: ArrayBuffer };
export type PreviewStorage = { read(): Promise<PreviewEnvelope | null>; write(value: PreviewEnvelope): Promise<void>; clear(): Promise<void> };
type Row = { post_id: string; media?: { id: string; url: string; width?: number | null; height?: number | null; media_type?: string | null; is_sensitive?: boolean | null; edit?: { coverUrl?: string | null; sensitive?: boolean }; [key: string]: unknown }[]; [key: string]: unknown };

export function previewObject(url: string, base: string): string | null {
  if (isMediaDeliveryCapability(url, base)) {
    const object = mediaDeliveryObject(url, base);
    return object?.bucket === 'post-media' ? object.key : null;
  }
  try {
    const parsed = new URL(url);
    if (parsed.origin !== new URL(base).origin || parsed.search || parsed.hash || parsed.username || parsed.password) return null;
    const match = parsed.pathname.match(/^\/storage\/v1\/object\/public\/post-media\/(.+)$/);
    return match && !/(?:^|\/)\.{1,2}(?:\/|$)|[%\\\x00-\x1f]/.test(decodeURIComponent(match[1])) ? `post-media/${decodeURIComponent(match[1])}` : null;
  } catch { return null; }
}
const jpeg = (value: unknown): value is string => typeof value === 'string' && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(value) && value.length <= PREVIEW_BUDGET;
const dimensions = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 100_000;

/** Only small, explicitly public raster previews enter this encrypted store. */
export function createFeedPreviewCache(options: { storage: PreviewStorage; crypto: Crypto; base: string; now?: () => number;
  raster: (source: string, signal: AbortSignal) => Promise<{ uri: string; width: number; height: number } | null> }) {
  const now = options.now ?? Date.now;
  let identity: string | null = null, owner: string | null = null, generation = 0, initialized = false;
  let snapshot: { owner: string | null; previews: FeedPreview[] } = { owner: null, previews: [] };
  let ready: Promise<void> = Promise.resolve(), writes: Promise<unknown> = Promise.resolve();
  let controller: AbortController | null = null, timer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();
  const enqueue = (action: () => Promise<unknown>) => { writes = writes.catch(() => {}).then(action); return writes; };
  const valid = (token: number) => token === generation && !!identity;
  const publish = (previews: FeedPreview[]) => {
    if (timer) clearTimeout(timer);
    snapshot = { owner, previews }; listeners.forEach(fn => fn());
    if (previews.length) timer = setTimeout(() => { void clear(); }, Math.max(0, Math.min(...previews.map(item => item.expiresAt)) - now()));
  };
  const clear = async () => { generation++; controller?.abort(); publish([]); await enqueue(() => options.storage.clear()); };
  const hash = async (value: string) => Array.from(new Uint8Array(await options.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, '0')).join('');
  const setSession = (nextOwner: string | null, nextIdentity: string | null) => {
    if (initialized && identity === nextIdentity && owner === nextOwner) return ready;
    const first = !initialized; initialized = true; identity = nextIdentity; owner = nextOwner;
    const token = ++generation; controller?.abort(); publish([]);
    ready = (async () => {
      try {
        if (!identity || !owner) { await enqueue(() => options.storage.clear()); return; }
        const expected = await hash(identity); if (!valid(token)) return;
        if (!first) { await enqueue(() => options.storage.clear()); return; }
        await writes; const record = await options.storage.read(); if (!valid(token)) return;
        if (!record || record.version !== 1 || record.identity !== expected || !Number.isFinite(record.expiresAt) || record.expiresAt <= now() || record.expiresAt > now() + PREVIEW_TTL
          || record.key?.extractable !== false || record.iv?.byteLength !== 12 || record.encrypted?.byteLength > PREVIEW_BUDGET + 4096) {
          await enqueue(() => options.storage.clear()); return;
        }
        const plaintext = await options.crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(record.iv) }, record.key, record.encrypted);
        if (!valid(token)) return;
        const parsed = JSON.parse(new TextDecoder().decode(plaintext));
        if (!Array.isArray(parsed) || parsed.length > 3) throw Error('Invalid preview');
        let bytes = 0;
        const previews: FeedPreview[] = parsed.filter(item => item && typeof item.postId === 'string' && item.postId.length <= 80 && typeof item.mediaId === 'string' && item.mediaId.length <= 80
          && typeof item.object === 'string' && item.object.startsWith('post-media/') && item.object.length <= 1100
          && jpeg(item.uri) && dimensions(item.width) && dimensions(item.height) && ['image', 'video'].includes(item.mediaType)
          && item.expiresAt === record.expiresAt && (bytes += item.uri.length) <= PREVIEW_BUDGET);
        publish(previews);
      } catch { if (valid(token)) await enqueue(() => options.storage.clear()).catch(() => {}); }
    })();
    return ready;
  };
  const write = async (account: string, rows: Row[], eligible: Set<string>): Promise<void> => {
    const token = generation; await ready;
    if (!valid(token) || owner !== account) return;
    const forbidden = new Set(rows.filter(row => !eligible.has(row.post_id) || row.is_sensitive || row.is_ephemeral || row.view_once || row.is_view_once
      || row.media?.some(media => media.is_sensitive || media.edit?.sensitive || media.is_ephemeral || media.view_once || media.is_view_once)).map(row => row.post_id));
    if (snapshot.previews.some(item => forbidden.has(item.postId))) { await clear(); return write(account, rows, eligible); }
    controller?.abort(); const run = controller = new AbortController();
    const expiresAt = now() + PREVIEW_TTL, previews: FeedPreview[] = []; let bytes = 0, attempts = 0;
    for (const row of rows.slice(0, 20)) {
      if (attempts === 3 || !valid(token) || run.signal.aborted) break;
      const media = row.media?.[0];
      if (!eligible.has(row.post_id) || typeof row.post_id !== 'string' || row.post_id.length > 80 || !media || typeof media.id !== 'string' || media.id.length > 80 || row.is_sensitive || row.is_ephemeral || row.view_once || row.is_view_once
        || media.is_sensitive || media.edit?.sensitive || media.is_ephemeral || media.view_once || media.is_view_once) continue;
      const object = previewObject(media.url, options.base);
      const source = media.media_type === 'video' ? media.edit?.coverUrl : media.media_type === 'image' ? media.url : null;
      if (!object || !source || !previewObject(source, options.base)) continue;
      attempts++;
      try {
        const previous = snapshot.previews.find(item => item.postId === row.post_id && item.mediaId === media.id && item.object === object && item.expiresAt > now());
        const raster = previous ?? await options.raster(source, run.signal);
        if (!valid(token) || run.signal.aborted) return;
        if (!raster || !jpeg(raster.uri) || !dimensions(raster.width) || !dimensions(raster.height) || bytes + raster.uri.length > PREVIEW_BUDGET) continue;
        bytes += raster.uri.length;
        previews.push({ postId: row.post_id, mediaId: media.id, object, uri: raster.uri,
          width: dimensions(media.width) ? media.width : raster.width, height: dimensions(media.height) ? media.height : raster.height,
          mediaType: media.media_type!, expiresAt });
      } catch { /* Cross-origin and unavailable media cannot block the feed. */ }
    }
    if (!valid(token) || run.signal.aborted) return;
    // A failed optional capture does not discard a still-current useful preview.
    if (!previews.length) return;
    try {
      const key = await options.crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      const iv = options.crypto.getRandomValues(new Uint8Array(12));
      const encrypted = await options.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(previews)));
      const identityHash = await hash(identity!);
      if (!valid(token) || run.signal.aborted) return;
      publish(previews);
      await enqueue(async () => { if (valid(token) && !run.signal.aborted) await options.storage.write({ version: 1, identity: identityHash, expiresAt, key, iv, encrypted }); });
    } catch { /* Restricted storage and crypto environments remain usable. */ }
  };
  return { setSession, write, clear, ready: () => ready,
    getSnapshot: () => snapshot.previews.some(item => item.expiresAt <= now()) ? EMPTY_PREVIEWS : snapshot, getServerSnapshot: () => EMPTY_PREVIEWS,
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; } };
}
const EMPTY_PREVIEWS: { owner: string | null; previews: FeedPreview[] } = { owner: null, previews: [] };
