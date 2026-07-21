import { supabase } from './supabase';

export type CampusMomentPrompt = {
  id: string;
  institution_id: string | null;
  prompt_text: string;
  prompt_date: string;
  window_start: string;
  window_end: string;
  my_post_id: string | null;
  my_story_id: string | null;
  my_is_late: boolean | null;
  total_posts: number;
};

export type CampusMomentFeedItem = {
  post_id: string;
  story_id: string;
  user_id: string;
  is_late: boolean;
  late_seconds: number;
  posted_at: string;
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
};

export const campusMomentService = {
  async getTodaysMoment(institutionId: string): Promise<CampusMomentPrompt | null> {
    const { data, error } = await supabase.rpc('get_todays_moment', {
      p_institution_id: institutionId,
    });
    if (error) {
      console.log('[campusMomentService.getTodaysMoment]', error.message);
      return null;
    }
    if (!data || (Array.isArray(data) && data.length === 0)) return null;
    const row = Array.isArray(data) ? data[0] : data;
    return row as CampusMomentPrompt;
  },

  async getMomentFeed(promptId: string): Promise<CampusMomentFeedItem[]> {
    const { data, error } = await supabase.rpc('get_moment_feed', {
      p_prompt_id: promptId,
    });
    if (error) {
      console.log('[campusMomentService.getMomentFeed]', error.message);
      return [];
    }
    return (data || []) as CampusMomentFeedItem[];
  },

  async postCampusMoment(promptId: string, storyId: string): Promise<any> {
    const { data, error } = await supabase.rpc('post_campus_moment', {
      p_prompt_id: promptId,
      p_story_id: storyId,
    });
    if (error) {
      console.log('[campusMomentService.postCampusMoment]', error.message);
      throw error;
    }
    return data;
  },

  async getUserInstitutionId(userId: string): Promise<{ id: string; name: string | null } | null> {
    const { data: primary } = await supabase
      .from('profile_institutions')
      .select('institution_id')
      .eq('profile_id', userId)
      .eq('is_primary', true)
      .limit(1)
      .maybeSingle();

    let institutionId: string | null = primary?.institution_id || null;

    if (!institutionId) {
      const { data: oldest } = await supabase
        .from('profile_institutions')
        .select('institution_id')
        .eq('profile_id', userId)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      institutionId = oldest?.institution_id || null;
    }

    if (!institutionId) return null;

    const { data: inst } = await supabase
      .from('institutions')
      .select('name')
      .eq('id', institutionId)
      .maybeSingle();

    return { id: institutionId, name: inst?.name || null };
  },
};