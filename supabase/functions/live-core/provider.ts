// Daily REST contract verified against the official HLS, room, VCS and webhook
// docs on 2026-11-02. No viewer joins the private production room.
export type LiveScene = { preset: 'host' | 'grid' | 'interview' | 'game' | 'screen'; participant_id?: string; participant_ids?: string[] };
export type StageIdentity = { provider_identity: string; user_id: string; role: string };
export type Presence = { id: string; userId: string; mtgSessionId?: string };
export type ProviderContext = {
  session_id: string; state: string; host_id: string; audience: string; recording_enabled: boolean;
  room_name: string; instance_id: string; playback_path: string | null; role: string; provider_identity: string | null;
  allowed_participants: StageIdentity[]; max_stage_members: number; action?: 'start' | 'stop' | 'scene';
  payload?: { scene: LiveScene; reason?: string }; lease_id?: string; completed?: boolean; result?: unknown;
};
export type LiveProviderConfig = {
  dailyKey: string; endpointName: string; bucket: string; region: string; assumeRoleArn: string;
  cdnOrigin: string; signerUrl: string; signerSecret: string; webhookSecret: string; domainId: string;
  workerSecret: string;
};
export const validUuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export function validScene(value: unknown): value is LiveScene {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const s = value as LiveScene;
  return ['host','grid','interview','game','screen'].includes(s.preset)
    && (s.participant_id === undefined || validUuid(s.participant_id))
    && (s.participant_ids === undefined || Array.isArray(s.participant_ids) && s.participant_ids.length <= 12 && s.participant_ids.every(validUuid))
    && Object.keys(s).every(k => ['preset','participant_id','participant_ids'].includes(k));
}
export function hlsEndpoint(config: LiveProviderConfig, context: ProviderContext) {
  if (!config.bucket || !config.region || !/^arn:aws:iam::\d{12}:role\/[A-Za-z0-9+=,.@_/-]+$/.test(config.assumeRoleArn)
    || !/^[A-Za-z0-9_-]{1,64}$/.test(config.endpointName) || !validUuid(context.session_id)) throw new Error('PROVIDER_NOT_READY');
  return {
    name: config.endpointName, type: 'hls', hls_config: {
      save_hls_recording: context.recording_enabled,
      variants: [
        { width: 1920, height: 1080, fps: 30, bitrate: 2500, iframe_only: false },
        { width: 1280, height: 720, fps: 30, bitrate: 1500, iframe_only: false },
        { width: 640, height: 360, fps: 24, bitrate: 700, iframe_only: false },
        { width: 320, height: 180, fps: 24, bitrate: 200, iframe_only: false },
      ],
      storage: { bucket_name: config.bucket, bucket_region: config.region, assume_role_arn: config.assumeRoleArn,
        path_template: `live/${context.session_id}/{instance_id}` },
    },
  };
}
export function buildLiveLayout(scene: LiveScene, context: ProviderContext, presence: Presence[], start: boolean) {
  if (!validScene(scene) || !Array.isArray(presence) || presence.length > context.max_stage_members) throw new Error('INVALID_SCENE');
  const authorized = new Set(context.allowed_participants.map(p => p.provider_identity));
  const allowed = presence.filter(p => validUuid(p.id) && authorized.has(p.userId));
  const hostIdentities = new Set(context.allowed_participants.filter(p => p.user_id === context.host_id && p.role === 'host').map(p => p.provider_identity));
  const host = allowed.find(p => hostIdentities.has(p.userId));
  const resolve = (id: string) => allowed.find(p => p.userId === id || p.id === id);
  let selected: Presence[];
  if (scene.preset === 'host') {
    const target = scene.participant_id ? resolve(scene.participant_id) : host;
    if (!target) throw new Error('SOURCE_NOT_CONNECTED'); selected = [target];
  } else if (scene.preset === 'grid') {
    const ids = scene.participant_ids ?? (scene.participant_id ? [scene.participant_id] : []);
    if (!ids.length) throw new Error('SELECT_STAGE_SOURCES');
    selected = ids.map(id => { const p = resolve(id); if (!p) throw new Error('SOURCE_NOT_CONNECTED'); return p; });
  } else {
    const featured = scene.participant_id ? resolve(scene.participant_id) : host;
    if (!featured || !host) throw new Error('SOURCE_NOT_CONNECTED');
    selected = scene.preset === 'screen' ? [featured] : [host, featured];
  }
  selected = [...new Map(selected.map(p => [p.id, p])).values()];
  const ids = selected.map(p => p.id);
  // Every update repeats both allowlists. Omitting them resets Daily to all
  // participants and can expose backstage cameras or microphones.
  const layout: Record<string, unknown> = {
    preset: 'custom', ...(start ? { composition_id: 'daily:baseline' } : {}),
    participants: { video: ids, audio: ids },
    composition_params: {
      mode: scene.preset === 'grid' ? 'grid' : scene.preset === 'interview' ? 'split' : scene.preset === 'game' ? 'pip' : 'single',
      'videoSettings.preferScreenshare': ['game','screen'].includes(scene.preset),
      'videoSettings.omitExtraScreenshares': true,
      'videoSettings.maxCamStreams': ids.length,
      'videoSettings.preferredParticipantIds': ids.join(','),
      'videoSettings.scaleMode': 'fit',
      'videoSettings.scaleModeForScreenshare': 'fit',
      'videoSettings.showParticipantLabels': false,
      'videoSettings.grid.highlightDominant': false,
    },
  };
  return { layout, published: selected.map(p => ({ session_id: p.id, provider_identity: p.userId })) };
}
function base64Bytes(value: string): ArrayBuffer {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error('INVALID_SIGNATURE');
  // A fresh ArrayBuffer is accepted by WebCrypto in both the Edge runtime and
  // TypeScript versions that distinguish SharedArrayBuffer-backed views.
  return Uint8Array.from(atob(value), c => c.charCodeAt(0)).buffer as ArrayBuffer;
}
export async function verifyDailyWebhook(event: unknown, timestamp: string | null, signature: string | null, secret: string, now = Date.now()): Promise<boolean> {
  try {
    if (!timestamp || !/^\d{10,13}$/.test(timestamp) || !signature || !secret) return false;
    const issued = Number(timestamp) * (timestamp.length > 10 ? 1 : 1000);
    if (!Number.isSafeInteger(issued) || Math.abs(now - issued) > 300000) return false;
    const keyBytes = base64Bytes(secret); if (keyBytes.byteLength < 32) return false;
    const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    return crypto.subtle.verify('HMAC', key, base64Bytes(signature), new TextEncoder().encode(`${timestamp}.${JSON.stringify(event)}`));
  } catch { return false; }
}
export async function sha256(value: string) {
  const hash = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
export function validPlaybackPath(path: unknown, session: string): path is string {
  if (typeof path !== 'string' || !validUuid(session)) return false;
  const parts = path.split('/');
  return parts.length === 4 && parts[0] === 'live' && parts[1] === session && validUuid(parts[2]) && parts[3] === 'master.m3u8';
}
export function safeHttpsOrigin(value: string): string | null {
  try { const u=new URL(value); return u.protocol==='https:' && !u.username && !u.password && !u.search && !u.hash && (u.pathname==='/' || !u.pathname) ? u.origin : null; } catch { return null; }
}
