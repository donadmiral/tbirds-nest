type Staff = { user_id: string };
type Identity = { id: string; email?: string | null; last_sign_in_at?: string | null };

/** Bounded identity lookups preserve order and fail on missing identities. */
export async function staffIdentities<T extends Identity>(
  staff: Staff[],
  lookup: (id: string) => Promise<{ data: { user: T | null }; error: unknown }>,
): Promise<T[]> {
  const identities: T[] = new Array(staff.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(4, staff.length) }, async () => {
    while (cursor < staff.length) {
      const index = cursor++;
      const expected = staff[index].user_id;
      const result = await lookup(expected);
      if (result.error || !result.data.user || result.data.user.id !== expected) {
        throw new Error('Staff identity lookup failed. Retry the directory.');
      }
      identities[index] = result.data.user;
    }
  }));
  return identities;
}
