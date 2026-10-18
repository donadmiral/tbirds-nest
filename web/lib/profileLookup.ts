/** Keep a profile URL literal when matching its case-insensitive username. */
export function usernameLookupPattern(username: string): string {
  return username.replace(/[\\%_]/g, "\\$&");
}

/** A route must never display a different account returned by a pattern alias. */
export function matchesUsername(profile: { username: string | null } | null, username: string): boolean {
  return typeof profile?.username === "string" && profile.username.toLowerCase() === username.toLowerCase();
}
