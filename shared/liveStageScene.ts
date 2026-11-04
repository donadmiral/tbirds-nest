export type LiveStageScene = {
  preset: 'host' | 'interview' | 'grid' | 'game' | 'screen';
  participant_id?: string;
  participant_ids?: string[];
  automatic?: true;
};

export type LiveStageParticipant = { session_id: string; user_id?: string | null };

// Coalesce participant bursts before issuing one scene command. Consumers also
// serialize commands and use the canonical scene key, not participant objects,
// as their effect dependency so mic/video updates do not re-direct the stream.
export const LIVE_STAGE_SCENE_SETTLE_MS = 750;

const providerId = (value: unknown): string | null => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  ? value.toLowerCase() : null;

/** Select only connected provider identities. Backend admission remains authoritative. */
export function automaticLiveStageScene({ participants, hostUserId, allowedGuestIds = [], maxMembers = 12, manualPreset = null }: {
  participants: readonly LiveStageParticipant[];
  /** Daily's host participant.user_id, not the account/profile UUID. */
  hostUserId: string;
  /** Trusted provider identities for accepted guests, supplied by the server. */
  allowedGuestIds?: readonly string[];
  maxMembers?: number;
  /** Any explicit layout suspends automatic guest selection until cleared. */
  manualPreset?: string | null;
}): LiveStageScene | null {
  if (manualPreset !== null) return null;
  const host = providerId(hostUserId);
  if (!host) return null;
  const acceptedGuests = new Set(allowedGuestIds.map(providerId).filter((id): id is string => id !== null));
  const connected = new Set(participants.filter(p => typeof p.session_id === 'string' && !!p.session_id)
    .map(p => providerId(p.user_id)).filter((id): id is string => id !== null && (id === host || acceptedGuests.has(id))));
  if (!connected.has(host)) return null;
  const limit = Number.isFinite(maxMembers) ? Math.min(12, Math.max(1, Math.floor(maxMembers))) : 12;
  const ids = [host, ...[...connected].filter(id => id !== host).sort()].slice(0, limit);
  if (ids.length === 1) return { preset: 'host', participant_id: host, automatic: true };
  // The provider adds the host to an interview. Featuring the host here would
  // deduplicate to a single camera and silently hide the invited guest.
  if (ids.length === 2) return { preset: 'interview', participant_id: ids[1], automatic: true };
  return { preset: 'grid', participant_ids: ids, automatic: true };
}

export function stableLiveStageSceneKey(scene: LiveStageScene | null): string {
  if (!scene) return '';
  return JSON.stringify({ preset: scene.preset,
    ...(scene.automatic ? { automatic: true } : {}),
    ...(scene.participant_id ? { participant_id: scene.participant_id } : {}),
    ...(scene.participant_ids ? { participant_ids: scene.participant_ids } : {}) });
}
