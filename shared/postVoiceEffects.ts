/** Creative voice presets change pitch and pace together. The original track
 * stays attached to its video, so trim, captions and lip movement stay in sync. */
export type PostVoiceEffect = 'original' | 'chipmunk' | 'deep';
export type PostPlaybackRecipe = {
  speed?: number | null;
  voiceEffect?: PostVoiceEffect | null;
  muted?: boolean;
  trimStart?: number | null;
  trimEnd?: number | null;
};

export const POST_VOICE_EFFECTS = [
  { id: 'original', label: 'Original', description: 'Keep your natural voice', rate: 1 },
  { id: 'chipmunk', label: 'Chipmunk', description: 'Higher voice, faster pace', rate: 1.5 },
  { id: 'deep', label: 'Deep', description: 'Lower voice, slower pace', rate: .75 },
] as const;

export function normalizePostPlayback(value: unknown): PostPlaybackRecipe {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const number = (key: string) => typeof input[key] === 'number' && Number.isFinite(input[key]) ? input[key] as number : null;
  return {
    speed: Math.max(.25, Math.min(3, number('speed') ?? 1)),
    voiceEffect: input.voiceEffect === 'chipmunk' || input.voiceEffect === 'deep' ? input.voiceEffect : 'original',
    muted: input.muted === true,
    trimStart: Math.max(0, number('trimStart') ?? 0),
    trimEnd: number('trimEnd'),
  };
}

export function postPlaybackSettings(recipe?: PostPlaybackRecipe | null, viewerRate = 1) {
  const value = normalizePostPlayback(recipe);
  const preset = POST_VOICE_EFFECTS.find(item => item.id === value.voiceEffect) ?? POST_VOICE_EFFECTS[0];
  const multiplier = Number.isFinite(viewerRate) && viewerRate > 0 ? viewerRate : 1;
  return { rate: Math.max(.25, Math.min(4, (value.speed ?? 1) * preset.rate * multiplier)), preservesPitch: preset.id === 'original' };
}

/** Both HTMLMediaElement and Expo Video expose these properties. Always reset
 * pitch preservation when a shared player switches back to an original clip. */
export function applyPostPlayback(player: { playbackRate: number; preservesPitch?: boolean; webkitPreservesPitch?: boolean }, recipe?: PostPlaybackRecipe | null, viewerRate = 1) {
  const settings = postPlaybackSettings(recipe, viewerRate);
  player.preservesPitch = settings.preservesPitch;
  if ('webkitPreservesPitch' in player) player.webkitPreservesPitch = settings.preservesPitch;
  player.playbackRate = settings.rate;
  return settings;
}
