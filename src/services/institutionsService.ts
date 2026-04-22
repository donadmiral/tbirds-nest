import { supabase } from './supabase';

export type Institution = {
  id: string;
  name: string;
  short_name: string | null;
  country: string;
  city: string | null;
  state: string | null;
  website: string | null;
  logo_url: string | null;
  parent_id: string | null;
  is_verified: boolean;
  is_active: boolean;
};

export type ProfileInstitution = {
  id: string;
  institution_id: string;
  institution_name: string;
  institution_short_name: string | null;
  institution_logo_url: string | null;
  relationship_type: 'current' | 'alumni' | 'past' | 'prospective' | 'faculty' | 'staff';
  start_year: number | null;
  end_year: number | null;
  is_primary: boolean;
  verified_via_email: boolean;
};

export type Affiliation = {
  id: string;
  name: string;
  kind: 'fraternity' | 'sorority' | 'club' | 'cohort' | 'organization' | 'team' | 'honor_society' | 'other';
  institution_id: string | null;
  description: string | null;
  logo_url: string | null;
  is_official: boolean;
  member_count: number;
};

export type ProfileAffiliation = {
  id: string;
  affiliation_id: string;
  affiliation_name: string;
  kind: Affiliation['kind'];
  institution_id: string | null;
  institution_name: string | null;
  logo_url: string | null;
  role: 'member' | 'officer' | 'founder' | 'alumni';
  is_official: boolean;
  joined_at: string;
};

export type DomainMatch = {
  institution_id: string;
  institution_name: string;
  matched_domain: string;
};

export const institutionsService = {
  /**
   * Search institutions by name or short_name. Used by sign-up picker.
   * Returns top 20 active institutions ranked by trigram similarity.
   */
  async search(query: string, limit = 20): Promise<Institution[]> {
    const q = query.trim();
    if (q.length === 0) {
      // Empty query: return a default set of most-popular institutions
      const { data, error } = await supabase
        .from('institutions')
        .select('*')
        .eq('is_active', true)
        .order('name', { ascending: true })
        .limit(limit);
      if (error) throw error;
      return (data || []) as Institution[];
    }
    // Non-empty: ilike on name or short_name
    const { data, error } = await supabase
      .from('institutions')
      .select('*')
      .eq('is_active', true)
      .or(`name.ilike.%${q}%,short_name.ilike.%${q}%`)
      .order('name', { ascending: true })
      .limit(limit);
    if (error) throw error;
    return (data || []) as Institution[];
  },

  /**
   * Look up institution by email domain. Null if no match.
   * Used during sign-up to auto-suggest the school and verify.
   */
  async matchEmailToInstitution(email: string): Promise<DomainMatch | null> {
    const { data, error } = await supabase.rpc('match_email_to_institution', { p_email: email });
    if (error) {
      console.log('[matchEmailToInstitution]', error.message);
      return null;
    }
    return (data && data[0]) || null;
  },

  /**
   * Pull full institution row by id. Used when rendering a profile.
   */
  async getById(id: string): Promise<Institution | null> {
    const { data, error } = await supabase
      .from('institutions')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return (data as Institution) || null;
  },

  /**
   * All institutions a user is linked to, with full details joined.
   */
  async getProfileInstitutions(profileId: string): Promise<ProfileInstitution[]> {
    const { data, error } = await supabase.rpc('get_profile_institutions', { p_profile_id: profileId });
    if (error) throw error;
    return (data || []) as ProfileInstitution[];
  },

  /**
   * Claim an institution. Auto-verified if email domain matches.
   * If it is the caller's first institution, it becomes primary.
   */
  async claim(params: {
    institutionId: string;
    relationshipType?: ProfileInstitution['relationship_type'];
    startYear?: number | null;
    endYear?: number | null;
    makePrimary?: boolean;
  }): Promise<string> {
    const { data, error } = await supabase.rpc('claim_institution', {
      p_institution_id: params.institutionId,
      p_relationship_type: params.relationshipType || 'current',
      p_start_year: params.startYear ?? null,
      p_end_year: params.endYear ?? null,
      p_make_primary: params.makePrimary ?? false,
    });
    if (error) throw error;
    return data as string;
  },

  /**
   * Switch primary institution. Atomic on the server.
   */
  async setPrimary(institutionId: string): Promise<void> {
    const { error } = await supabase.rpc('set_primary_institution', {
      p_institution_id: institutionId,
    });
    if (error) throw error;
  },

  /**
   * Remove a linked institution entirely. Cannot remove the primary one.
   */
  async remove(institutionId: string, profileId: string): Promise<void> {
    const { data: row } = await supabase
      .from('profile_institutions')
      .select('is_primary')
      .eq('profile_id', profileId)
      .eq('institution_id', institutionId)
      .maybeSingle();
    if (row?.is_primary) {
      throw new Error('Cannot remove your primary institution. Switch primary first.');
    }
    const { error } = await supabase
      .from('profile_institutions')
      .delete()
      .eq('profile_id', profileId)
      .eq('institution_id', institutionId);
    if (error) throw error;
  },

  /**
   * Request a new institution be added. For now inserts as unverified;
   * admin reviews in Supabase and flips is_verified when legitimate.
   */
  async requestNewInstitution(params: {
    name: string;
    country?: string;
    city?: string;
    state?: string;
    website?: string;
    createdBy: string;
  }): Promise<Institution> {
    const { data, error } = await supabase
      .from('institutions')
      .insert({
        name: params.name.trim(),
        country: (params.country || 'US').trim(),
        city: params.city?.trim() || null,
        state: params.state?.trim() || null,
        website: params.website?.trim() || null,
        is_verified: false,
        is_active: true,
        created_by: params.createdBy,
      })
      .select()
      .single();
    if (error) throw error;
    return data as Institution;
  },
};

export const affiliationsService = {
  /**
   * Search affiliations, optionally scoped to an institution.
   * Pass null institutionId to also include global affiliations.
   */
  async search(query: string, institutionId: string | null, limit = 20): Promise<Affiliation[]> {
    const q = query.trim();
    let builder = supabase
      .from('affiliations')
      .select('*')
      .order('member_count', { ascending: false })
      .limit(limit);

    if (institutionId) {
      // Include both institution-specific AND global affiliations
      builder = builder.or(`institution_id.eq.${institutionId},institution_id.is.null`);
    }

    if (q.length > 0) {
      builder = builder.ilike('name', `%${q}%`);
    }

    const { data, error } = await builder;
    if (error) throw error;
    return (data || []) as Affiliation[];
  },

  async getProfileAffiliations(profileId: string): Promise<ProfileAffiliation[]> {
    const { data, error } = await supabase.rpc('get_profile_affiliations', { p_profile_id: profileId });
    if (error) throw error;
    return (data || []) as ProfileAffiliation[];
  },

  /**
   * Create a new affiliation. Anyone authenticated can create one;
   * is_official stays false until admin flips it.
   */
  async create(params: {
    name: string;
    kind: Affiliation['kind'];
    institutionId: string | null;
    description?: string;
    createdBy: string;
  }): Promise<Affiliation> {
    const { data, error } = await supabase
      .from('affiliations')
      .insert({
        name: params.name.trim(),
        kind: params.kind,
        institution_id: params.institutionId,
        description: params.description?.trim() || null,
        is_official: false,
        created_by: params.createdBy,
      })
      .select()
      .single();
    if (error) throw error;
    return data as Affiliation;
  },

  async join(affiliationId: string, role: ProfileAffiliation['role'] = 'member'): Promise<string> {
    const { data, error } = await supabase.rpc('join_affiliation', {
      p_affiliation_id: affiliationId,
      p_role: role,
    });
    if (error) throw error;
    return data as string;
  },

  async leave(affiliationId: string): Promise<void> {
    const { error } = await supabase.rpc('leave_affiliation', {
      p_affiliation_id: affiliationId,
    });
    if (error) throw error;
  },
};