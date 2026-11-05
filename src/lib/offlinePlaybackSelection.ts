export type OfflinePlaybackSelection = { identity: string; mode: 'local' | 'network' | 'pending'; uri: string };

/** Finishing a background download must not replace a playing network source. */
export function selectOfflinePlayback(previous: OfflinePlaybackSelection | null, identity: string,
  remote: string, local: string | null, networkFailed = false): OfflinePlaybackSelection {
  const same = previous?.identity === identity ? previous : null;
  if (same?.mode === 'network' && remote && !networkFailed) return same;
  if (local) return { identity, mode: 'local', uri: local };
  return { identity, mode: remote ? 'network' : 'pending', uri: remote };
}
