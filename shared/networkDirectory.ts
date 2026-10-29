type Read = <T>(query: PromiseLike<T>) => Promise<T>;

/** Keep independent directory failures visible without hiding healthy sections. */
export async function readNetworkDirectory(client: any, userId: string, read: Read = async value => await value) {
  const rows = async (query: any): Promise<any[]> => {
    const result: any = await read(query);
    if (result.error) throw result.error;
    return Array.isArray(result.data) ? result.data : [];
  };
  const communities = async () => {
    const result: any[] = [], asOf = new Date().toISOString();
    for (let offset = 0; ; offset += 100) {
      const page = await rows(client.rpc('get_communities_page', { p_query: null, p_limit: 100, p_offset: offset, p_as_of: asOf }));
      result.push(...page);
      if (page.length < 100) return result;
    }
  };
  const [people, follows, requests, community, clubs, clubMembers] = await Promise.allSettled([
    rows(client.from('profiles').select('id, full_name, username, bio, location, degree_program, graduation_year, avatar_url, workplace, school, headline').neq('id', userId).order('full_name', { ascending: true })),
    rows(client.from('follows').select('following_id').eq('follower_id', userId)),
    rows(client.from('follow_requests').select('target_id').eq('requester_id', userId).eq('status', 'pending')),
    communities(),
    rows(client.from('clubs').select('id, name, emoji, description, member_count').order('name')),
    rows(client.from('club_members').select('club_id').eq('user_id', userId)),
  ]);
  const errors: Partial<Record<'all' | 'communities' | 'clubs', string>> = {};
  if (people.status === 'rejected' || follows.status === 'rejected' || requests.status === 'rejected') errors.all = 'People and follow details could not load. Please retry.';
  if (community.status === 'rejected') errors.communities = 'Communities could not load. Please retry.';
  if (clubs.status === 'rejected' || clubMembers.status === 'rejected') errors.clubs = 'Clubs and membership details could not load. Please retry.';
  return {
    people: !errors.all && people.status === 'fulfilled' ? people.value : null,
    follows: !errors.all && follows.status === 'fulfilled' ? follows.value : null,
    requests: !errors.all && requests.status === 'fulfilled' ? requests.value : null,
    communities: community.status === 'fulfilled' ? community.value : null,
    clubs: !errors.clubs && clubs.status === 'fulfilled' ? clubs.value : null,
    clubMembers: !errors.clubs && clubMembers.status === 'fulfilled' ? clubMembers.value : null,
    errors,
  };
}
