/** Keep a profile mention literal when matching its case-insensitive username. */
export function usernameLookupPattern(username: string): string {
  return username.replace(/[\\%_]/g, '\\$&');
}

/** A mention must never navigate to a different account from a pattern alias. */
export function matchesUsername(profile: { username: string | null } | null, username: string): boolean {
  return typeof profile?.username === 'string' && profile.username.toLowerCase() === username.toLowerCase();
}
