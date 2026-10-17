// Count related rows inside the page query. Returning follower/strike IDs and
// counting that result in JavaScript would silently undercount at the API row cap.
// Explicit FK names distinguish the two directions of the follows relationship.
export const USER_DIRECTORY_SELECT = 'id, full_name, username, email, avatar_url, account_type, is_verified, verified_tier, verified_category, created_at, deactivated_at, suspended_reason, restricted_until, follower_counts:follows!follows_following_id_fkey(count), following_counts:follows!follows_follower_id_fkey(count), strike_counts:member_strikes!member_strikes_user_id_fkey(count)';

function embeddedCount(value: unknown): number {
  // A count-only to-many embed always returns one aggregate row, including zero.
  // Missing or malformed counts must fail rather than look like a clean account.
  if (!Array.isArray(value) || value.length !== 1 || value[0] === null || typeof value[0] !== 'object') {
    throw new Error('Member counts could not be verified. Please retry.');
  }
  const count: unknown = value[0].count;
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
    throw new Error('Member counts could not be verified. Please retry.');
  }
  return count;
}

export function withDirectoryCounts<T extends { follower_counts: unknown; following_counts: unknown; strike_counts: unknown }>(row: T) {
  const { follower_counts, following_counts, strike_counts, ...profile } = row;
  return {
    ...profile,
    followers: embeddedCount(follower_counts),
    following: embeddedCount(following_counts),
    strikes: embeddedCount(strike_counts),
  };
}
