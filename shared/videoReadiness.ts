/** A bounded in-memory buffer pool. Each player stays bound to one exact URL. */
export type PreparedVideoSource = { uri: string; expiresAt?: number | null };
export type BufferPlayer = {
  readonly status?: string;
  pause(): void;
  release(): void;
  replaceAsync(source: { uri: string; useCaching: boolean }): Promise<void>;
  addListener?(event: 'statusChange', listener: (event: { status: string }) => void): { remove(): void };
};
export type PreparedVideo<P> = {
  uri: string; identity: number; player: P; ready: boolean; failed: boolean; disposed: boolean;
  expiresAt: number; touchedAt: number;
};

export function createVideoReadinessPool<P extends BufferPlayer>(
  create: () => P,
  onChange: (entry: PreparedVideo<P>) => void,
  options: { clock?: () => number; maxPlayers?: number; ttlMs?: number; timeoutMs?: number } = {},
) {
  const clock = options.clock ?? Date.now;
  const maxPlayers = Math.max(1, options.maxPlayers ?? 3);
  const ttlMs = options.ttlMs ?? 45_000;
  const entries = new Map<string, PreparedVideo<P>>();
  const deadlines = new Map<PreparedVideo<P>, ReturnType<typeof setTimeout>>();
  const subscriptions = new Map<PreparedVideo<P>, { remove(): void }>();
  let identity = 0;
  let activeUri: string | null = null;

  const drop = (entry: PreparedVideo<P>) => {
    if (entry.disposed) return;
    entry.disposed = true;
    const timer = deadlines.get(entry);
    if (timer) clearTimeout(timer);
    deadlines.delete(entry);
    subscriptions.get(entry)?.remove();
    subscriptions.delete(entry);
    if (entries.get(entry.uri) === entry) entries.delete(entry.uri);
    onChange(entry);
    try { entry.player.pause(); } catch {}
    try { entry.player.release(); } catch {}
  };
  const prune = () => {
    for (const entry of entries.values()) {
      if (entry.uri !== activeUri && entry.expiresAt <= clock()) drop(entry);
    }
    while (entries.size >= maxPlayers) {
      const oldest = [...entries.values()].filter(entry => entry.uri !== activeUri)
        .sort((a, b) => a.touchedAt - b.touchedAt)[0];
      if (!oldest) break;
      drop(oldest);
    }
  };
  const prepare = (source: PreparedVideoSource, keepActive = false) => {
    const now = clock();
    const hit = entries.get(source.uri);
    if (hit && !hit.failed && (hit.expiresAt > now || keepActive)) {
      hit.touchedAt = now;
      return hit;
    }
    if (hit) drop(hit);
    prune();
    const entry: PreparedVideo<P> = {
      uri: source.uri, identity: ++identity, player: create(), ready: false, failed: false, disposed: false,
      expiresAt: Math.min(now + ttlMs, source.expiresAt ?? Infinity), touchedAt: now,
    };
    entries.set(source.uri, entry);
    const settled = (failed: boolean) => {
      if (entry.disposed || entry.failed) return;
      const timer = deadlines.get(entry);
      if (timer) clearTimeout(timer);
      deadlines.delete(entry);
      entry.ready = !failed;
      entry.failed = failed;
      if (failed) { try { entry.player.pause(); } catch {} }
      onChange(entry);
    };
    deadlines.set(entry, setTimeout(() => settled(true), options.timeoutMs ?? 12_000));
    const listener = entry.player.addListener?.('statusChange', event => {
      if (event.status === 'error') settled(true);
      else if (event.status === 'readyToPlay') settled(false);
    });
    if (listener) subscriptions.set(entry, listener);
    // A new source never replaces the contents of a player visible elsewhere.
    // The native buffers are ephemeral. No persistent video cache is enabled.
    Promise.resolve().then(() => {
      if (!entry.disposed) return entry.player.replaceAsync({ uri: source.uri, useCaching: false });
    }).then(() => {
      if (entry.disposed) return;
      if (!entry.player.addListener || entry.player.status === 'readyToPlay') settled(false);
    }).catch(() => settled(true));
    return entry;
  };

  return {
    claim(uri: string) {
      const keepActive = activeUri === uri;
      if (activeUri !== uri) {
        const previous = activeUri ? entries.get(activeUri) : null;
        try { previous?.player.pause(); } catch {}
      }
      activeUri = uri;
      return prepare({ uri }, keepActive);
    },
    prefetch(sources: PreparedVideoSource[]) {
      const seen = new Set<string>();
      for (const source of sources) {
        if (!source.uri || seen.has(source.uri) || source.uri === activeUri || (source.expiresAt ?? Infinity) <= clock()) continue;
        if (seen.size >= maxPlayers - 1) break;
        seen.add(source.uri);
        prepare(source);
      }
    },
    reload(uri: string) {
      const old = entries.get(uri);
      if (old) drop(old);
      activeUri = uri;
      return prepare({ uri });
    },
    release() {
      const entry = activeUri ? entries.get(activeUri) : null;
      try { entry?.player.pause(); } catch {}
      activeUri = null;
    },
    clear() { activeUri = null; for (const entry of entries.values()) drop(entry); },
    peek: (uri: string) => entries.get(uri) ?? null,
    size: () => entries.size,
  };
}

/** Warm only nearby authorized ordinary feed videos. Never touch view-once media. */
export function upcomingFeedVideos(rows: Array<{ media?: unknown; _mediaExpiresAt?: unknown }>, start: number, enabled: boolean): PreparedVideoSource[] {
  if (!enabled) return [];
  const sources: PreparedVideoSource[] = [];
  const seen = new Set<string>();
  for (const row of rows.slice(Math.max(0, start), Math.max(0, start) + 4)) {
    for (const media of (Array.isArray(row.media) ? row.media : []).slice(0, 2)) {
      if (!media || media.media_type !== 'video' || media.is_sensitive || media.edit?.sensitive || media.view_once || media.is_view_once || media.is_ephemeral) continue;
      const uri = media.url;
      if (typeof uri !== 'string' || !/^https:\/\//i.test(uri) || /\/limited-media-file(?:[/?]|$)|\/(?:chat-media|chat-files)\//i.test(uri) || seen.has(uri)) continue;
      seen.add(uri);
      sources.push({ uri, expiresAt: typeof row._mediaExpiresAt === 'number' ? row._mediaExpiresAt : null });
      if (sources.length === 2) return sources;
    }
  }
  return sources;
}
