import { supabase } from './supabase';
import { flagsService } from './flagsService';
import { authorId as currentAuthorId } from '../stores/actorStore';

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
  | 'freelance'
  | 'contract'
  | 'temporary';

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

export const STATUS_META: Record<ApplicationStatus, { label: string; color: string; bg: string }> = {
  applied:     { label: 'Applied',     color: '#2563EB', bg: '#EFF6FF' },
  viewed:      { label: 'Viewed',      color: '#7C3AED', bg: '#F5F3FF' },
  shortlisted: { label: 'Shortlisted', color: '#059669', bg: '#ECFDF5' },
  interview:   { label: 'Interview',   color: '#D97706', bg: '#FFFBEB' },
  rejected:    { label: 'Rejected',    color: '#DC2626', bg: '#FEF2F2' },
  accepted:    { label: 'Accepted',    color: '#059669', bg: '#ECFDF5' },
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
  applications_count: number;
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
  benefits?: string;
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

    let query = supabase.from('jobs').select('*').limit(limit);
    if (scope === 'global') {
      // Remote tab: remote roles only
      query = query.eq('remote_type', 'remote');
    } else if (scope === 'primary' && userId) {
      // Near me: match the job's location against the user's profile city
      const { data: prof } = await supabase.from('profiles').select('location').eq('id', userId).maybeSingle();
      const city = String(prof?.location || '').trim().split(',')[0].trim();
      if (city.length >= 3) query = query.ilike('location', '%' + city + '%');
    }
    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) {
      console.log('[jobsService.getJobs]', error.message);
      return [];
    }
    let rows: any[] = data || [];
    // Client-side sort (RPC returns ordered by created_at desc).
    switch (sortBy) {
      case 'popular':
        rows = rows.slice().sort((a, b) => {
          const aCount = a.applications_count ?? 0;
          const bCount = b.applications_count ?? 0;
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
        rows = rows.slice().sort((a, b) => {
          const num = (x: any) => { const m = String(x?.salary_range || '').replace(/,/g, '').match(/\d+/); return m ? parseInt(m[0], 10) : -1; };
          const d = num(b) - num(a);
          if (d !== 0) return d;
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        });
        break;
      case 'recent':
      default:
        rows = rows.slice().sort((a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
        break;
    }

    const withProfiles = await attachPosterProfiles(rows);
    
    return withProfiles as Job[];
  },

  async createJob(userId: string, input: CreateJobInput): Promise<Job> {
    if (!userId) throw new Error('userId is required');
    if (!(await flagsService.isEnabled('jobs'))) {
      throw new Error('Job posting is temporarily switched off by Platinum Circles operations.');
    }
    const { data, error } = await supabase
      .from('jobs')
      .insert({
        posted_by: currentAuthorId(userId) ?? userId,
        title: input.title,
        company: input.company,
        location: input.location || null,
        description: input.description,
        category: input.category,
        benefits: input.benefits || null,
        remote_type: input.remote_type || 'on_site',
        experience_level: input.experience_level || 'mid',
        industry: input.industry || null,
        salary_range: input.salary_range || null,
        visa_sponsorship: !!input.visa_sponsorship,
        urgent: !!input.urgent,
        verified: false,
        applications_count: 0,
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

  async getSavedJobs(userId: string): Promise<Job[]> {
    const ids = await this.getSavedJobIds(userId);
    if (ids.length === 0) return [];
    const { data, error } = await supabase.from('jobs').select('*').in('id', ids)
      .order('created_at', { ascending: false });
    if (error) { console.log('[jobsService.getSavedJobs]', error.message); return []; }
    return attachPosterProfiles(data || []);
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
    coverNote: string,
    cvUrl?: string | null,
    cvName?: string | null,
    phone?: string | null,
    portfolioUrl?: string | null
  ): Promise<{ app: JobApplication; updated: boolean }> {
    if (!userId || !jobId) throw new Error('Missing ids');
    const { data, error } = await supabase
      .from('job_applications')
      .insert({
        job_id: jobId,
        applicant_id: userId,
        status: 'applied',
        cover_note: coverNote?.trim() || null,
        cv_url: cvUrl || null,
        cv_name: cvName || null,
        applicant_phone: phone?.trim() || null,
        portfolio_url: portfolioUrl?.trim() || null,
      })
      .select()
      .single();
    if (error || !data) {
      if ((error as any)?.code === '23505') {
        // Already applied: update the application content, preserve the status
        // the recruiter may have set.
        const { data: upd, error: updErr } = await supabase
          .from('job_applications')
          .update({
            cover_note: coverNote?.trim() || null,
            cv_url: cvUrl || null,
            cv_name: cvName || null,
            applicant_phone: phone?.trim() || null,
            portfolio_url: portfolioUrl?.trim() || null,
            updated_at: new Date().toISOString(),
          })
          .eq('job_id', jobId).eq('applicant_id', userId)
          .select().single();
        if (updErr || !upd) throw updErr || new Error('Could not update application');
        return { app: upd as JobApplication, updated: true };
      }
      console.log('[jobsService.applyToJob]', error?.message);
      throw error || new Error('Apply failed');
    }
    // applications_count is owned by the sync_job_application_count trigger (0045); no client write.
    return { app: data as JobApplication, updated: false };
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

  async scheduleInterview(applicationId: string, at: string | null, location: string | null): Promise<void> {
    const { error } = await supabase
      .from('job_applications')
      .update({ interview_at: at, interview_location: location, updated_at: new Date().toISOString() })
      .eq('id', applicationId);
    if (error) throw error;
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

};
