/** Keep a profile URL literal when matching its case-insensitive username. */
export function usernameLookupPattern(username: string): string {
  return username.replace(/[\\%_]/g, "\\$&");
}

/** A route must never display a different account returned by a pattern alias. */
export function matchesUsername(profile: { username: string | null } | null, username: string): boolean {
  return typeof profile?.username === "string" && profile.username.toLowerCase() === username.toLowerCase();
}

/** UUID routes keep members without a chosen handle reachable. */
export function isProfileId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function profilePath(username?: string | null, userId?: string | null): string {
  const handle = username?.trim();
  if (handle) return "/" + encodeURIComponent(handle);
  return userId && isProfileId(userId) ? "/" + userId : "/search";
}
