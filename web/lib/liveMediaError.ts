/** Daily's device events and browser media exceptions use different error shapes. */
export function liveMediaError(reason: unknown): string | null {
  if (!reason || typeof reason !== 'object') return null;
  const error = reason as { type?: unknown; name?: unknown; missingMedia?: unknown; blockedMedia?: unknown };
  const kind = error.type || error.name;
  const media = Array.isArray(error.missingMedia) ? error.missingMedia : Array.isArray(error.blockedMedia) ? error.blockedMedia : [];
  const device = media.length === 1 ? media[0] === 'audio' ? 'microphone' : 'camera' : 'camera or microphone';
  if (['not-found', 'NotFoundError', 'DevicesNotFoundError'].includes(String(kind))) {
    return `No ${device} was found. Connect a device and try again, or share your screen.`;
  }
  if (['permissions', 'NotAllowedError', 'PermissionDeniedError'].includes(String(kind))) {
    return `Your browser blocked ${device} access. Allow access in this site's browser settings, then try again.`;
  }
  if (['cam-in-use', 'mic-in-use', 'cam-mic-in-use', 'NotReadableError', 'TrackStartError'].includes(String(kind))) {
    return 'Your camera or microphone is unavailable or in use. Close other apps using it, then try again.';
  }
  if (['constraints', 'OverconstrainedError', 'ConstraintNotSatisfiedError'].includes(String(kind))) {
    return 'The selected media device could not use these settings. Choose another camera or microphone.';
  }
  if (kind === 'undefined-mediadevices') return 'This browser cannot access cameras or microphones. Open Live in a supported browser over a secure connection.';
  return null;
}
