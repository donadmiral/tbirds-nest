import { supabase } from './supabase';

export type MentorKind = 'student_mentor' | 'alumni' | 'faculty' | 'staff';
export type MentorshipRole = 'mentor' | 'mentee';
export type RequestStatus = 'pending' | 'accepted' | 'declined' | 'withdrawn' | 'expired';
export type MentorshipStatus = 'active' | 'ended';
export type GoalStatus = 'open' | 'in_progress' | 'completed' | 'abandoned';
export type MeetingStatus = 'scheduled' | 'completed' | 'cancelled';
export type MeetingKind = 'video' | 'in_person' | 'phone';
export type EndReason = 'completed' | 'mentor_ended' | 'mentee_ended' | 'inactive';

export type MentorListItem = {
  profile_id: string;
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
  headline: string | null;
  mentor_kind: MentorKind;
  bio: string | null;
  expertise_tags: string[];
  help_with: string[];
  availability_note: string | null;
  max_active_mentees: number;
  active_mentees: number;
  has_capacity: boolean;
};

export type MentorProfileDetail = MentorListItem & {
  my_request_status: RequestStatus | null;
  my_mentorship_id: string | null;
};

export type MyMentorProfile = {
  profile_id: string;
  institution_id: string | null;
  is_active: boolean;
  bio: string | null;
  expertise_tags: string[];
  help_with: string[];
  availability_note: string | null;
  max_active_mentees: number;
  mentor_kind: MentorKind;
  created_at: string;
  updated_at: string;
};

export type IncomingRequest = {
  request_id: string;
  mentee_id: string;
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
  headline: string | null;
  message: string;
  focus_areas: string[];
  requested_at: string;
};

export type OutgoingRequest = {
  request_id: string;
  mentor_id: string;
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
  mentor_kind: MentorKind | null;
  status: RequestStatus;
  message: string;
  requested_at: string;
  responded_at: string | null;
  response_note: string | null;
};

export type MyMentorship = {
  mentorship_id: string;
  role: MentorshipRole;
  partner_id: string;
  partner_name: string | null;
  partner_username: string | null;
  partner_avatar: string | null;
  partner_headline: string | null;
  mentor_kind: MentorKind | null;
  conversation_id: string | null;
  started_at: string;
  ended_at: string | null;
  goals_open: number;
  goals_completed: number;
  meetings_upcoming: number;
};

export type MentorshipDetail = {
  mentorship_id: string;
  mentor_id: string;
  mentee_id: string;
  mentor_name: string | null;
  mentor_username: string | null;
  mentor_avatar: string | null;
  mentee_name: string | null;
  mentee_username: string | null;
  mentee_avatar: string | null;
  mentor_kind: MentorKind | null;
  conversation_id: string | null;
  status: MentorshipStatus;
  started_at: string;
  ended_at: string | null;
  end_reason: EndReason | null;
  my_role: MentorshipRole;
};

export type Goal = {
  id: string;
  mentorship_id: string;
  title: string;
  description: string | null;
  target_date: string | null;
  status: GoalStatus;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type Meeting = {
  id: string;
  mentorship_id: string;
  title: string;
  scheduled_at: string;
  location: string | null;
  kind: MeetingKind;
  status: MeetingStatus;
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export const MENTOR_KIND_LABEL: Record<MentorKind, string> = {
  student_mentor: 'Student mentor',
  alumni: 'Alumni',
  faculty: 'Faculty',
  staff: 'Staff',
};

export const HELP_WITH_OPTIONS = [
  'Career advice',
  'Resume review',
  'Interview prep',
  'Networking intros',
  'Industry knowledge',
  'Entrepreneurship',
  'Graduate school',
  'Work-life balance',
  'Leadership',
  'Accountability',
];

// ---- Mentor profile ----

export async function upsertMentorProfile(params: {
  bio: string;
  expertiseTags: string[];
  helpWith: string[];
  availabilityNote: string;
  maxActiveMentees: number;
  mentorKind: MentorKind;
  isActive: boolean;
}): Promise<MyMentorProfile> {
  const { data, error } = await supabase.rpc('upsert_mentor_profile', {
    p_bio: params.bio || null,
    p_expertise_tags: params.expertiseTags,
    p_help_with: params.helpWith,
    p_availability_note: params.availabilityNote || null,
    p_max_active_mentees: params.maxActiveMentees,
    p_mentor_kind: params.mentorKind,
    p_is_active: params.isActive,
  });
  if (error) throw error;
  return data as MyMentorProfile;
}

export async function getMyMentorProfile(): Promise<MyMentorProfile | null> {
  const { data, error } = await supabase.rpc('get_my_mentor_profile');
  if (error) { console.log('[getMyMentorProfile]', error.message); return null; }
  return (data as MyMentorProfile) || null;
}

// ---- Mentor discovery ----

export async function listMentors(params: {
  search?: string;
  kind?: MentorKind | null;
  limit?: number;
} = {}): Promise<MentorListItem[]> {
  const { data, error } = await supabase.rpc('list_mentors', {
    p_search: params.search || null,
    p_kind: params.kind || null,
    p_limit: params.limit ?? 50,
  });
  if (error) { console.log('[listMentors]', error.message); return []; }
  return (data || []) as MentorListItem[];
}

export async function getMentorProfile(mentorId: string): Promise<MentorProfileDetail | null> {
  const { data, error } = await supabase.rpc('get_mentor_profile', { p_mentor_id: mentorId });
  if (error) { console.log('[getMentorProfile]', error.message); return null; }
  const arr = (data || []) as MentorProfileDetail[];
  return arr[0] || null;
}

// ---- Requests ----

export async function requestMentorship(params: {
  mentorId: string;
  message: string;
  focusAreas: string[];
}): Promise<string> {
  const { data, error } = await supabase.rpc('request_mentorship', {
    p_mentor_id: params.mentorId,
    p_message: params.message,
    p_focus_areas: params.focusAreas,
  });
  if (error) throw error;
  return data as string;
}

export async function getIncomingRequests(): Promise<IncomingRequest[]> {
  const { data, error } = await supabase.rpc('get_incoming_mentorship_requests');
  if (error) { console.log('[getIncomingRequests]', error.message); return []; }
  return (data || []) as IncomingRequest[];
}

export async function getOutgoingRequests(): Promise<OutgoingRequest[]> {
  const { data, error } = await supabase.rpc('get_outgoing_mentorship_requests');
  if (error) { console.log('[getOutgoingRequests]', error.message); return []; }
  return (data || []) as OutgoingRequest[];
}

export async function acceptMentorshipRequest(requestId: string): Promise<string> {
  const { data, error } = await supabase.rpc('accept_mentorship_request', { p_request_id: requestId });
  if (error) throw error;
  return data as string;
}

export async function declineMentorshipRequest(requestId: string, note?: string): Promise<void> {
  const { error } = await supabase.rpc('decline_mentorship_request', {
    p_request_id: requestId,
    p_note: note || null,
  });
  if (error) throw error;
}

export async function withdrawMentorshipRequest(requestId: string): Promise<void> {
  const { error } = await supabase.rpc('withdraw_mentorship_request', { p_request_id: requestId });
  if (error) throw error;
}

// ---- Mentorships ----

export async function listMyMentorships(status: MentorshipStatus | null = 'active'): Promise<MyMentorship[]> {
  const { data, error } = await supabase.rpc('list_my_mentorships', { p_status: status });
  if (error) { console.log('[listMyMentorships]', error.message); return []; }
  return (data || []) as MyMentorship[];
}

export async function getMentorshipDetail(mentorshipId: string): Promise<MentorshipDetail | null> {
  const { data, error } = await supabase.rpc('get_mentorship_detail', { p_mentorship_id: mentorshipId });
  if (error) { console.log('[getMentorshipDetail]', error.message); return null; }
  const arr = (data || []) as MentorshipDetail[];
  return arr[0] || null;
}

export async function endMentorship(mentorshipId: string, reason: EndReason = 'completed'): Promise<void> {
  const { error } = await supabase.rpc('end_mentorship', {
    p_mentorship_id: mentorshipId,
    p_reason: reason,
  });
  if (error) throw error;
}

// ---- Goals ----

export async function listGoals(mentorshipId: string): Promise<Goal[]> {
  const { data, error } = await supabase.rpc('list_mentorship_goals', { p_mentorship_id: mentorshipId });
  if (error) { console.log('[listGoals]', error.message); return []; }
  return (data || []) as Goal[];
}

export async function createGoal(params: {
  mentorshipId: string;
  title: string;
  description?: string;
  targetDate?: string | null;
}): Promise<Goal> {
  const { data: sess } = await supabase.auth.getSession();
  const userId = sess?.session?.user?.id;
  if (!userId) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('mentorship_goals')
    .insert({
      mentorship_id: params.mentorshipId,
      title: params.title,
      description: params.description || null,
      target_date: params.targetDate || null,
      created_by: userId,
    })
    .select()
    .single();
  if (error || !data) throw error || new Error('Could not create goal');
  return data as Goal;
}

export async function updateGoalStatus(goalId: string, status: GoalStatus): Promise<void> {
  const { error } = await supabase
    .from('mentorship_goals')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', goalId);
  if (error) throw error;
}

export async function deleteGoal(goalId: string): Promise<void> {
  const { error } = await supabase.from('mentorship_goals').delete().eq('id', goalId);
  if (error) throw error;
}

// ---- Meetings ----

export async function listMeetings(mentorshipId: string): Promise<Meeting[]> {
  const { data, error } = await supabase.rpc('list_mentorship_meetings', { p_mentorship_id: mentorshipId });
  if (error) { console.log('[listMeetings]', error.message); return []; }
  return (data || []) as Meeting[];
}

export async function createMeeting(params: {
  mentorshipId: string;
  title: string;
  scheduledAt: string;
  kind: MeetingKind;
  location?: string;
}): Promise<Meeting> {
  const { data: sess } = await supabase.auth.getSession();
  const userId = sess?.session?.user?.id;
  if (!userId) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('mentorship_meetings')
    .insert({
      mentorship_id: params.mentorshipId,
      title: params.title,
      scheduled_at: params.scheduledAt,
      kind: params.kind,
      location: params.location || null,
      created_by: userId,
    })
    .select()
    .single();
  if (error || !data) throw error || new Error('Could not create meeting');
  return data as Meeting;
}

export async function updateMeetingStatus(meetingId: string, status: MeetingStatus, notes?: string): Promise<void> {
  const patch: any = { status, updated_at: new Date().toISOString() };
  if (notes !== undefined) patch.notes = notes;
  const { error } = await supabase.from('mentorship_meetings').update(patch).eq('id', meetingId);
  if (error) throw error;
}

export async function deleteMeeting(meetingId: string): Promise<void> {
  const { error } = await supabase.from('mentorship_meetings').delete().eq('id', meetingId);
  if (error) throw error;
}