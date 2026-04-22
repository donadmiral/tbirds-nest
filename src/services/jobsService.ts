import { supabase } from './supabase';

/**
 * Canonical jobs service. Every jobs call in the app goes through this.
 * Matches the live schema in Supabase:
 *   jobs, job_applications, job_saves, job_recommendations, job_referrals.
 */

export type JobCategory =
  | 'full_time'
  | 'part_time'
  | 'internship'
  | 'volunteering'
  | 'startup'
  | 'freelance';

export type ApplicationStatus =
  | 'applied'
  | 'viewed'
  | 'shortlisted'
  | 'interview'
  | 'rejected'
  | 'accepted';

export type RemoteType = 'on_site' | 'hybrid' | 'remote';
export type ExperienceLevel = 'entry' | 'mid' | 'senior' | 'executive';
export type JobScope = 'primary' | 'all' | 'global';

export type PosterLite = {
  id: string;
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
};

export type Job = {
  id: string;
  posted_by: string;
  title: string;
  company: string;
  location: string | null;
  description: string;
  job_type: string | null;
  salary_range: string | null;
  created_at: string;
  updated_at: string;
  category: JobCategory | null;
  remote_type: RemoteType | null;
  experience_level: ExperienceLevel | null;
  industry: string | null;
  visa_sponsorship: boolean;
  urgent: boolean;
  verified: boolean;
  application_count: number;
  apply_url: string | null;
  deadline: string | null;
  institution_id: string | null;
  scope: 'institution' | 'global' | null;
  profile?: PosterLite | null;
  institution_name?: string | null;
};

export type JobApplication = {
  id: string;
  job_id: string;
  applicant_id: string;
  status: ApplicationStatus;
  cover_note: string | null;
  cover_letter: string | null;
  applied_at: string;
  updated_at: string | null;
  job?: Job;
  applicant?: PosterLite & { degree_program?: string | null; cohort?: string | null };
};

export type JobRecommendation = {
  id: string;
  job_id: string;
  recommender_id: string;
  recommended_name: string;
  recommended_contact: string | null;
  message: string | null;
  created_at: string;
  recommender?: PosterLite;
};

export type JobReferral = {
  id: string;
  job_id: string;
  referrer_id: string;
  referred_id: string;
  note: string | null;
  status: string;
  created_at: string;
};

export type CreateJobInput = {
  title: string;
  company: string;
  location?: string;
  description: string;
  category: JobCategory;
  remote_type?: RemoteType;
  experience_level?: ExperienceLevel;
  industry?: string;
  salary_range?: string;
  visa_sponsorship?: boolean;
  urgent?: boolean;
  apply_url?: string;
  deadline?: string;
  scope?: 'institution' | 'global';
};

type GetJobsOpts = {
  sortBy?: 'recent' | 'popular' | 'salary' | 'urgent';
  scope?: JobScope;
  userId?: string;
  limit?: number;
};

async function attachPosterProfiles(rows: any[]): Promise<Job[]> {
  if (!rows || rows.length === 0) return [];
  const posterIds = Array.from(new Set(rows.map(j => j.posted_by).filter(Boolean)));
  if (posterIds.length === 0) return rows as Job[];
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, full_name, username, avatar_url')
    .in('id', posterIds);
  const map: Record<string, PosterLite> = {};
  (profiles || []).forEach((p: any) => { map[p.id] = p; });
  return rows.map(j => ({ ...j, profile: map[j.posted_by] || null })) as Job[];
}

async function attachInstitutionNames(rows: any[]): Promise<any[]> {
  if (!rows || rows.length === 0) return rows;
  const instIds = Array.from(new Set(rows.map(j => j.institution_id).filter(Boolean)));
  if (instIds.length === 0) return rows;
  const { data: insts } = await supabase
    .from('institutions')
    .select('id, name, short_name')
    .in('id', instIds);
  const im: Record<string, any> = {};
  (insts || []).forEach((i: any) => { im[i.id] = i; });
  return rows.map(j => ({
    ...j,
    institution_name: j.institution_id ? (im[j.institution_id]?.short_name || im[j.institution_id]?.name || null) : null,
  }));
}

export const jobsService = {
  /**
   * Fetch jobs, optionally scoped to a user's institution set.
   * - scope 'primary': jobs from user's primary institution only
   * - scope 'all': user's institutions + global
   * - scope 'global': global only
   * When scope + userId supplied, uses get_scoped_jobs RPC.
   * Otherwise falls back to the plain jobs query (RLS still applies).
   */
  async getJobs(opts: GetJobsOpts = {}): Promise<Job[]> {
    const { sortBy = 'recent', scope, userId, limit = 100 } = opts;

    let rows: any[] = [];

    if (scope && userId) {
      const { data, error } = await supabase.rpc('get_scoped_jobs', {
        p_user_id: userId,
        p_mode: scope,
        p_limit: limit,
        p_before: null,
      });
      if (error) {
        console.log('[jobsService.getJobs rpc]', error.message);
        return [];
      }
      rows = data || [];
    } else {
      let query = supabase.from('jobs').select('*').limit(limit);
      const { data, error } = await query.order('created_at', { ascending: false });
      if (error) {
        console.log('[jobsService.getJobs]', error.message);
        return [];
      }
      rows = data || [];
    }

    // Client-side sort (RPC returns ordered by created_at desc).
    switch (sortBy) {
      case 'popular':
        rows = rows.slice().sort((a, b) => {
          const aCount = a.application_count ?? 0;
          const bCount = b.application_count ?? 0;
          if (bCount !== aCount) return bCount - aCount;
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        });
        break;
      case 'urgent':
        rows = rows.slice().sort((a, b) => {
          if (a.urgent !== b.urgent) return a.urgent ? -1 : 1;
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        });
        break;
      case 'salary':
      case 'recent':
      default:
        rows = rows.slice().sort((a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
        break;
    }

    const withProfiles = await attachPosterProfiles(rows);
    const withInstitutions = await attachInstitutionNames(withProfiles);
    return withInstitutions as Job[];
  },

  async createJob(userId: string, input: CreateJobInput): Promise<Job> {
    if (!userId) throw new Error('userId is required');
    const { data, error } = await supabase
      .from('jobs')
      .insert({
        posted_by: userId,
        title: input.title,
        company: input.company,
        location: input.location || null,
        description: input.description,
        category: input.category,
        remote_type: input.remote_type || 'on_site',
        experience_level: input.experience_level || 'mid',
        industry: input.industry || null,
        salary_range: input.salary_range || null,
        visa_sponsorship: !!input.visa_sponsorship,
        urgent: !!input.urgent,
        verified: false,
        application_count: 0,
        apply_url: input.apply_url || null,
        deadline: input.deadline || null,
        scope: input.scope || 'institution',
      })
      .select()
      .single();
    if (error || !data) {
      console.log('[jobsService.createJob]', error?.message);
      throw error || new Error('Insert failed');
    }
    return data as Job;
  },

  async deleteJob(jobId: string): Promise<void> {
    const { error } = await supabase.from('jobs').delete().eq('id', jobId);
    if (error) {
      console.log('[jobsService.deleteJob]', error.message);
      throw error;
    }
  },

  async saveJob(userId: string, jobId: string): Promise<void> {
    const { error } = await supabase
      .from('job_saves')
      .insert({ user_id: userId, job_id: jobId });
    if (error && !String(error.message || '').toLowerCase().includes('duplicate')) {
      console.log('[jobsService.saveJob]', error.message);
      throw error;
    }
  },

  async unsaveJob(userId: string, jobId: string): Promise<void> {
    const { error } = await supabase
      .from('job_saves')
      .delete()
      .eq('user_id', userId)
      .eq('job_id', jobId);
    if (error) {
      console.log('[jobsService.unsaveJob]', error.message);
      throw error;
    }
  },

  async getSavedJobIds(userId: string): Promise<string[]> {
    const { data, error } = await supabase
      .from('job_saves')
      .select('job_id')
      .eq('user_id', userId);
    if (error) {
      console.log('[jobsService.getSavedJobIds]', error.message);
      return [];
    }
    return (data || []).map((r: any) => r.job_id);
  },

  async applyToJob(
    userId: string,
    jobId: string,
    coverNote: string
  ): Promise<JobApplication> {
    if (!userId || !jobId) throw new Error('Missing ids');
    const { data, error } = await supabase
      .from('job_applications')
      .insert({
        job_id: jobId,
        applicant_id: userId,
        status: 'applied',
        cover_note: coverNote?.trim() || null,
      })
      .select()
      .single();
    if (error || !data) {
      console.log('[jobsService.applyToJob]', error?.message);
      throw error || new Error('Apply failed');
    }
    try {
      const { data: j } = await supabase
        .from('jobs')
        .select('application_count')
        .eq('id', jobId)
        .single();
      if (j) {
        await supabase
          .from('jobs')
          .update({ application_count: (j.application_count || 0) + 1 })
          .eq('id', jobId);
      }
    } catch {
      // non-fatal, display field only
    }
    return data as JobApplication;
  },

  async getAppliedJobIds(userId: string): Promise<Record<string, ApplicationStatus>> {
    const { data, error } = await supabase
      .from('job_applications')
      .select('job_id, status')
      .eq('applicant_id', userId);
    if (error) {
      console.log('[jobsService.getAppliedJobIds]', error.message);
      return {};
    }
    const out: Record<string, ApplicationStatus> = {};
    (data || []).forEach((r: any) => {
      out[r.job_id] = r.status as ApplicationStatus;
    });
    return out;
  },

  async getMyApplications(userId: string): Promise<JobApplication[]> {
    const { data, error } = await supabase
      .from('job_applications')
      .select('*')
      .eq('applicant_id', userId)
      .order('applied_at', { ascending: false });
    if (error) {
      console.log('[jobsService.getMyApplications]', error.message);
      return [];
    }
    if (!data || data.length === 0) return [];
    const jobIds = Array.from(new Set(data.map((a: any) => a.job_id)));
    const { data: jobsData } = await supabase
      .from('jobs')
      .select('*')
      .in('id', jobIds);
    const jobMap: Record<string, Job> = {};
    (jobsData || []).forEach((j: any) => { jobMap[j.id] = j as Job; });
    return data.map((a: any) => ({ ...a, job: jobMap[a.job_id] })) as JobApplication[];
  },

  async getApplicationsForJob(jobId: string): Promise<JobApplication[]> {
    const { data, error } = await supabase
      .from('job_applications')
      .select('*')
      .eq('job_id', jobId)
      .order('applied_at', { ascending: false });
    if (error) {
      console.log('[jobsService.getApplicationsForJob]', error.message);
      return [];
    }
    if (!data || data.length === 0) return [];
    const applicantIds = Array.from(new Set(data.map((a: any) => a.applicant_id)));
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name, username, avatar_url, degree_program')
      .in('id', applicantIds);
    const pm: Record<string, any> = {};
    (profiles || []).forEach((p: any) => { pm[p.id] = p; });
    return data.map((a: any) => ({
      ...a,
      applicant: pm[a.applicant_id] || null,
    })) as JobApplication[];
  },

  async updateApplicationStatus(
    applicationId: string,
    status: ApplicationStatus
  ): Promise<void> {
    const { error } = await supabase
      .from('job_applications')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', applicationId);
    if (error) {
      console.log('[jobsService.updateApplicationStatus]', error.message);
      throw error;
    }
  },

  async createRecommendation(input: {
    jobId: string;
    recommenderId: string;
    recommendedName: string;
    recommendedContact?: string;
    message?: string;
  }): Promise<JobRecommendation> {
    const { data, error } = await supabase
      .from('job_recommendations')
      .insert({
        job_id: input.jobId,
        recommender_id: input.recommenderId,
        recommended_name: input.recommendedName,
        recommended_contact: input.recommendedContact || null,
        message: input.message || null,
      })
      .select()
      .single();
    if (error || !data) {
      console.log('[jobsService.createRecommendation]', error?.message);
      throw error || new Error('Recommendation insert failed');
    }
    return data as JobRecommendation;
  },

  async getRecommendationsForJob(jobId: string): Promise<JobRecommendation[]> {
    const { data, error } = await supabase
      .from('job_recommendations')
      .select('*')
      .eq('job_id', jobId)
      .order('created_at', { ascending: false });
    if (error) {
      console.log('[jobsService.getRecommendationsForJob]', error.message);
      return [];
    }
    if (!data || data.length === 0) return [];
    const ids = Array.from(new Set(data.map((r: any) => r.recommender_id)));
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name, username, avatar_url')
      .in('id', ids);
    const pm: Record<string, PosterLite> = {};
    (profiles || []).forEach((p: any) => { pm[p.id] = p; });
    return data.map((r: any) => ({
      ...r,
      recommender: pm[r.recommender_id] || null,
    })) as JobRecommendation[];
  },

  async referUser(input: {
    referrerId: string;
    referredId: string;
    jobId: string;
    note: string;
  }): Promise<void> {
    const { error } = await supabase.from('job_referrals').insert({
      job_id: input.jobId,
      referrer_id: input.referrerId,
      referred_id: input.referredId,
      note: input.note?.trim() || null,
      status: 'pending',
    });
    if (error) {
      console.log('[jobsService.referUser]', error.message);
      throw error;
    }
  },

  /**
   * Open or create a DM with a job poster. Uses the server start_dm RPC
   * which handles same-school vs cross-school logic and respects RLS.
   */
  async getOrCreateConversationWithPoster(
    userId: string,
    posterId: string
  ): Promise<string> {
    if (!userId || !posterId) throw new Error('Missing user ids');
    const { data, error } = await supabase.rpc('start_dm', {
      p_receiver_id: posterId,
    });
    if (error || !data) {
      console.log('[jobsService.getOrCreateConversationWithPoster]', error?.message);
      throw error || new Error('Conversation create failed');
    }
    return data as string;
  },
};

// Legacy wrapper kept for any other caller that still imports this name.
export async function getOrCreateConversation(user1: string, user2: string) {
  if (!user1 || !user2) return null;
  try {
    const { data, error } = await supabase.rpc('start_dm', { p_receiver_id: user2 });
    if (error || !data) {
      console.log('CREATE_CONVERSATION_ERROR', error?.message);
      return null;
    }
    const { data: conv } = await supabase
      .from('conversations')
      .select('*')
      .eq('id', data)
      .single();
    return conv || null;
  } catch (e: any) {
    console.log('CREATE_CONVERSATION_ERROR', e?.message);
    return null;
  }
}