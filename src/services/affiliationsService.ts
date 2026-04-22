import { supabase } from './supabase';

export type AffiliationKind =
  | 'fraternity' | 'sorority' | 'club' | 'cohort'
  | 'organization' | 'team' | 'honor_society' | 'other';

export type AffiliationPostMode = 'interactive' | 'informative';
export type AffiliationJoinMode = 'open' | 'request';
export type AffiliationRole = 'member' | 'officer' | 'admin' | 'founder' | 'alumni';

export type Affiliation = {
  id: string;
  name: string;
  kind: AffiliationKind;
  description: string | null;
  logo_url: string | null;
  institution_id: string | null;
  institution_name: string | null;
  is_official: boolean;
  member_count: number;
  created_by: string | null;
  created_at: string;
  post_mode?: AffiliationPostMode;
  join_mode?: AffiliationJoinMode;
  conversation_id?: string | null;
  is_member?: boolean;
  my_role?: AffiliationRole | null;
};

export type AffiliationBrowseMode = 'all' | 'my-school' | 'global' | 'joined';

export type AffiliationMember = {
  profile_id: string;
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
  role: AffiliationRole;
  joined_at: string;
};

export type PendingJoinRequest = {
  request_id: string;
  user_id: string;
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
  institution_name: string | null;
  message: string | null;
  requested_at: string;
};

// Shared enrichment helper
async function enrichList(
  rawList: any[],
  userId: string | null
): Promise<Affiliation[]> {
  const instIds = Array.from(new Set(rawList.map(r => r.institution_id).filter(Boolean))) as string[];
  const instMap: Record<string, string> = {};
  if (instIds.length > 0) {
    const { data: insts } = await supabase
      .from('institutions')
      .select('id, name')
      .in('id', instIds);
    (insts || []).forEach((i: any) => { instMap[i.id] = i.name; });
  }

  let membershipMap: Record<string, { role: AffiliationRole }> = {};
  if (userId) {
    const { data: memberships } = await supabase
      .from('profile_affiliations')
      .select('affiliation_id, role, left_at')
      .eq('profile_id', userId)
      .is('left_at', null);
    (memberships || []).forEach((m: any) => {
      membershipMap[m.affiliation_id] = { role: m.role };
    });
  }

  return rawList.map(r => ({
    ...r,
    institution_name: r.institution_id ? (instMap[r.institution_id] || null) : null,
    is_member: !!membershipMap[r.id],
    my_role: (membershipMap[r.id]?.role as AffiliationRole) || null,
  }));
}

export async function listAffiliations(
  mode: AffiliationBrowseMode,
  userId: string | null
): Promise<Affiliation[]> {
  let institutionIds: string[] = [];
  if (userId) {
    const { data: myInsts } = await supabase
      .from('profile_institutions')
      .select('institution_id, is_primary')
      .eq('profile_id', userId);
    institutionIds = (myInsts || []).map((r: any) => r.institution_id).filter(Boolean);
  }

  let query = supabase
    .from('affiliations')
    .select('id, name, kind, description, logo_url, institution_id, is_official, member_count, created_by, created_at, post_mode, join_mode, conversation_id');

  if (mode === 'my-school') {
    if (institutionIds.length === 0) return [];
    query = query.in('institution_id', institutionIds);
  } else if (mode === 'global') {
    query = query.is('institution_id', null);
  }

  const { data: rows, error } = await query.order('member_count', { ascending: false }).limit(200);
  if (error) {
    console.log('[Affiliations list error]', error);
    return [];
  }

  let enriched = await enrichList((rows || []) as any[], userId);
  if (mode === 'joined') enriched = enriched.filter(a => a.is_member);
  return enriched;
}

export async function searchAffiliations(
  q: string,
  userId: string | null
): Promise<Affiliation[]> {
  const trimmed = q.trim();
  if (trimmed.length < 2) return [];

  const { data: rows, error } = await supabase
    .from('affiliations')
    .select('id, name, kind, description, logo_url, institution_id, is_official, member_count, created_by, created_at, post_mode, join_mode, conversation_id')
    .ilike('name', `%${trimmed}%`)
    .order('member_count', { ascending: false })
    .limit(30);

  if (error) {
    console.log('[Affiliations search error]', error);
    return [];
  }
  return enrichList((rows || []) as any[], userId);
}

export async function getAffiliationById(
  id: string,
  userId: string | null
): Promise<Affiliation | null> {
  const { data: row, error } = await supabase
    .from('affiliations')
    .select('id, name, kind, description, logo_url, institution_id, is_official, member_count, created_by, created_at, post_mode, join_mode, conversation_id')
    .eq('id', id)
    .single();

  if (error || !row) {
    console.log('[getAffiliationById error]', error);
    return null;
  }
  const [enriched] = await enrichList([row], userId);
  return enriched;
}

export async function requestToJoinAffiliation(
  affiliationId: string,
  message?: string | null
): Promise<'joined' | 'requested' | 'already_member' | 'already_requested'> {
  const { data, error } = await supabase.rpc('request_to_join_affiliation', {
    p_affiliation_id: affiliationId,
    p_message: message ?? null,
  });
  if (error) throw error;
  return data as any;
}

export async function leaveAffiliation(
  affiliationId: string,
  userId: string
): Promise<void> {
  const { error } = await supabase
    .from('profile_affiliations')
    .delete()
    .eq('profile_id', userId)
    .eq('affiliation_id', affiliationId);
  if (error) throw error;
}

export async function createAffiliation(params: {
  name: string;
  kind: AffiliationKind;
  description: string | null;
  institutionId: string | null;
  userId: string;
}): Promise<Affiliation> {
  const { data: inserted, error } = await supabase
    .from('affiliations')
    .insert({
      name: params.name.trim(),
      kind: params.kind,
      description: params.description?.trim() || null,
      institution_id: params.institutionId,
      is_official: false,
      created_by: params.userId,
    })
    .select('id, name, kind, description, logo_url, institution_id, is_official, member_count, created_by, created_at, post_mode, join_mode, conversation_id')
    .single();

  if (error || !inserted) throw error || new Error('Could not create affiliation');

  await supabase.from('profile_affiliations').insert({
    profile_id: params.userId,
    affiliation_id: inserted.id,
    role: 'founder',
    joined_at: new Date().toISOString(),
  });

  const [enriched] = await enrichList([inserted], params.userId);
  return enriched;
}

export async function getUserPrimaryInstitution(userId: string): Promise<{ id: string; name: string } | null> {
  const { data } = await supabase
    .from('profile_institutions')
    .select('institution_id, is_primary, institutions!institution_id(id, name)')
    .eq('profile_id', userId)
    .eq('is_primary', true)
    .maybeSingle();

  if (!data?.institutions) return null;
  const inst: any = Array.isArray(data.institutions) ? data.institutions[0] : data.institutions;
  return inst ? { id: inst.id, name: inst.name } : null;
}

export async function getAffiliationMembers(affiliationId: string): Promise<AffiliationMember[]> {
  const { data, error } = await supabase.rpc('get_affiliation_members', {
    p_affiliation_id: affiliationId,
  });
  if (error) {
    console.log('[getAffiliationMembers error]', error);
    return [];
  }
  return (data || []) as AffiliationMember[];
}

export async function getPendingJoinRequests(affiliationId: string): Promise<PendingJoinRequest[]> {
  const { data, error } = await supabase.rpc('get_pending_join_requests', {
    p_affiliation_id: affiliationId,
  });
  if (error) {
    console.log('[getPendingJoinRequests error]', error);
    return [];
  }
  return (data || []) as PendingJoinRequest[];
}

export async function getPendingJoinRequestCount(affiliationId: string): Promise<number> {
  const { count, error } = await supabase
    .from('affiliation_join_requests')
    .select('id', { count: 'exact', head: true })
    .eq('affiliation_id', affiliationId)
    .eq('status', 'pending');
  if (error) return 0;
  return count ?? 0;
}

export async function approveJoinRequest(requestId: string): Promise<void> {
  const { error } = await supabase.rpc('approve_join_request', { p_request_id: requestId });
  if (error) throw error;
}

export async function declineJoinRequest(requestId: string): Promise<void> {
  const { error } = await supabase.rpc('decline_join_request', { p_request_id: requestId });
  if (error) throw error;
}

export async function kickAffiliationMember(affiliationId: string, userId: string): Promise<void> {
  const { error } = await supabase.rpc('kick_affiliation_member', {
    p_affiliation_id: affiliationId,
    p_user_id: userId,
  });
  if (error) throw error;
}

export async function setAffiliationMemberRole(
  affiliationId: string,
  userId: string,
  newRole: 'member' | 'officer' | 'admin'
): Promise<void> {
  const { error } = await supabase.rpc('set_affiliation_member_role', {
    p_affiliation_id: affiliationId,
    p_user_id: userId,
    p_new_role: newRole,
  });
  if (error) throw error;
}

export async function setAffiliationPostMode(
  affiliationId: string,
  postMode: AffiliationPostMode
): Promise<void> {
  const { error } = await supabase.rpc('set_affiliation_post_mode', {
    p_affiliation_id: affiliationId,
    p_post_mode: postMode,
  });
  if (error) throw error;
}

export async function setAffiliationJoinMode(
  affiliationId: string,
  joinMode: AffiliationJoinMode
): Promise<void> {
  const { error } = await supabase.rpc('set_affiliation_join_mode', {
    p_affiliation_id: affiliationId,
    p_join_mode: joinMode,
  });
  if (error) throw error;
}

export function isAdminRole(role: AffiliationRole | null | undefined): boolean {
  return role === 'admin' || role === 'officer' || role === 'founder';
}