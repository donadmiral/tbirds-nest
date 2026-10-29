import { readWithDeadline } from './readDeadline';

export type ConversationTarget = {
  id: string;
  otherId: string | null;
  name: string;
  username: string | null;
  avatar: string | null;
  emoji: string | null;
  group: boolean;
  community: boolean;
};
export type ConversationTargets = { people: ConversationTarget[]; groups: ConversationTarget[]; communities: ConversationTarget[]; warning: string | null };
type Client = { from(table: string): any; rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: any; error: unknown }> };
type Result = { data: any[] | null; error: unknown };

// Each destination type is independent. A community lookup must not make a
// person's working private conversations disappear from the send sheet.
export async function loadConversationTargets(client: Client, userId: string): Promise<ConversationTargets> {
  if (!userId) throw new Error('Sign in to share to a conversation.');
  const failed = new Set<string>();
  const read = async (label: string, query: PromiseLike<Result>): Promise<any[]> => {
    try {
      const result = await readWithDeadline(query);
      if (result.error || !Array.isArray(result.data)) throw result.error || new Error('Invalid response');
      return result.data;
    } catch { failed.add(label); return []; }
  };
  const readCommunities = async () => {
    const rows = new Map<string, any>();
    const asOf = new Date().toISOString();
    // The established directory API orders memberships first. Continue across
    // full member pages; do not silently omit people with more than 100 groups.
    for (let offset = 0; ; offset += 100) {
      const page = await read('communities', client.rpc('get_communities_page', { p_query: null, p_limit: 100, p_offset: offset, p_as_of: asOf }));
      for (const row of page) if (row.is_member) rows.set(row.id, row);
      if (page.length < 100 || page.some(row => !row.is_member)) break;
    }
    return [...rows.values()];
  };
  const [direct, membership, communityRows] = await Promise.all([
    read('people', client.from('conversations').select('id,user_1,user_2,last_message_time,request_status,request_sender_id')
      .eq('is_group', false).or('context.is.null,context.eq.personal')
      .or(`user_1.eq.${userId},user_2.eq.${userId}`).order('last_message_time', { ascending: false }).limit(50)),
    read('groups', client.from('conversation_members').select('conversation_id').eq('user_id', userId).limit(100)),
    readCommunities(),
  ]);
  const directRows = direct.filter(row => {
    const otherId = row.user_1 === userId ? row.user_2 : row.user_1;
    return otherId && otherId !== userId && row.request_status !== 'rejected'
      && !(row.request_status === 'pending' && row.request_sender_id === otherId);
  });
  const unique = (rows: any[], key: string) => [...new Set(rows.map(row => row[key]).filter(Boolean))];
  const otherIds = [...new Set(directRows.map(row => row.user_1 === userId ? row.user_2 : row.user_1))];
  const groupIds = unique(membership, 'conversation_id');
  const [profiles, groups] = await Promise.all([
    otherIds.length ? read('people', client.from('profiles').select('id,full_name,username,avatar_url').in('id', otherIds)) : [],
    groupIds.length ? read('groups', client.from('conversations').select('id,group_name,group_emoji,group_type,group_ref_id,last_message_time')
      .eq('is_group', true).or('context.is.null,context.eq.personal').in('id', groupIds).order('last_message_time', { ascending: false }).limit(50)) : [],
  ]);
  const peopleById = new Map(profiles.map(profile => [profile.id, profile]));
  const linkedCommunities = new Set(groups.filter(row => row.group_type === 'community').map(row => row.group_ref_id));
  const people = directRows.flatMap(row => {
    const otherId = row.user_1 === userId ? row.user_2 : row.user_1;
    const profile = peopleById.get(otherId);
    // Do not offer an ambiguous "Member" target when identity failed to load.
    if (!profile) return [];
    return [{ id: row.id, otherId, name: profile.full_name || profile.username || 'Member', username: profile.username || null,
      avatar: profile.avatar_url || null, emoji: null, group: false, community: false }];
  });
  if (failed.size === 3) throw new Error('Your conversations could not be loaded. Please retry.');
  return {
    people,
    groups: groups.map(row => ({ id: row.id, otherId: null, name: row.group_name || 'Group', username: null, avatar: null,
      emoji: row.group_emoji || null, group: true, community: false })),
    communities: communityRows.filter(row => row.is_member && !linkedCommunities.has(row.id)).map(row => ({ id: row.id, otherId: null,
      name: row.name || 'Community', username: null, avatar: null, emoji: row.emoji || null, group: false, community: true })),
    warning: failed.size ? `Some ${[...failed].join(' and ')} could not be loaded. You can use the available conversations or retry.` : null,
  };
}
