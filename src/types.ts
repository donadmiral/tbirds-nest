/**
 * Global TypeScript types for PlatinumCircles.
 *
 * Shapes match schema.sql. Whenever you add a column to a table, update the
 * matching type here. Keeping this file accurate is what gives you type
 * safety across services, hooks, screens, and stores.
 */

// ─── Profile ─────────────────────────────────────────────────────────────────

export type Profile = {
  id: string;
  full_name: string | null;
  username: string | null;
  email?: string | null;
  avatar_url: string | null;
  bio?: string | null;
  location?: string | null;
  degree_program: string | null;
  graduation_year: number | null;
  cohort?: string | null;
  workplace?: string | null;
  school?: string | null;
  headline?: string | null;
  is_verified?: boolean;
  role?: 'student' | 'alumni' | 'faculty' | 'staff' | 'professional' | null;
  created_at?: string;
  updated_at?: string;
};

// ─── Posts ───────────────────────────────────────────────────────────────────

export type PostMedia = {
  id: string;
  post_id?: string;
  url: string;
  media_type: 'image' | 'video';
  width?: number | null;
  height?: number | null;
  sort_order: number;
};

export type Post = {
  id: string;
  user_id: string;
  content: string | null;
  body?: string | null;
  media_url?: string | null;
  location?: string | null;
  likes_count: number;
  comments_count: number;
  reposts_count: number;
  bookmarks_count: number;
  views_count?: number;
  created_at: string;
  updated_at?: string;
  profile?: Profile;
  post_media?: PostMedia[];
  media?: PostMedia[];
  is_liked?: boolean;
  is_bookmarked?: boolean;
  is_reposted?: boolean;
};

export type PostComment = {
  id: string;
  post_id: string;
  user_id: string;
  body: string;
  parent_comment_id?: string | null;
  likes_count?: number;
  created_at: string;
  profile?: Profile;
  replies?: PostComment[];
};

// ─── Messaging ───────────────────────────────────────────────────────────────

export type Conversation = {
  id: string;
  user_1: string | null;
  user_2: string | null;
  type?: 'direct' | 'group';
  is_group?: boolean;
  group_name?: string | null;
  group_emoji?: string | null;
  group_avatar_url?: string | null;
  last_message: string;
  last_message_time: string | null;
  created_at?: string;
};

export type Message = {
  id: string;
  conversation_id: string;
  sender_id: string | null;
  receiver_id: string | null;
  text: string | null;
  media_url?: string | null;
  media_type?: 'image' | 'video' | 'gif' | 'document' | 'audio' | null;
  reply_to_id?: string | null;
  forwarded_from_id?: string | null;
  delivered_at?: string | null;
  viewed_at?: string | null;
  read_at?: string | null;
  edited_at?: string | null;
  created_at: string;
};

// ─── Social graph ────────────────────────────────────────────────────────────

export type Connection = {
  id: string;
  sender_id: string;
  receiver_id: string;
  status: 'pending' | 'accepted';
  created_at: string;
  updated_at?: string;
};



// ─── Feature screens ─────────────────────────────────────────────────────────

export type MinglePost = {
  id: string;
  host_id: string;
  title: string;
  category: string;
  location: string;
  event_time: string;
  description: string | null;
  image_url: string | null;
  capacity?: number | null;
  created_at: string;
};

export type BirdsBusinessPost = {
  id: string;
  owner_id: string;
  business_name: string;
  category: string;
  location: string;
  description: string;
  offering: string;
  contact_info: string | null;
  website_url: string | null;
  image_url?: string | null;
  created_at: string;
};

export type StartupPost = {
  id: string;
  founder_id: string;
  startup_name: string;
  industry: string;
  stage: string;
  location: string;
  one_liner: string;
  description: string;
  funding_need: string | null;
  website: string | null;
  created_at: string;
};

export type JobPost = {
  id: string;
  poster_id: string;
  title: string;
  company: string;
  location: string;
  description: string;
  url?: string | null;
  employment_type?: 'full-time' | 'part-time' | 'internship' | 'contract' | null;
  created_at: string;
};

// ─── Calls ───────────────────────────────────────────────────────────────────

export type CallRecord = {
  id: string;
  caller_id: string;
  receiver_id: string;
  channel_id: string;
  status: 'ringing' | 'accepted' | 'declined' | 'ended' | 'missed';
  is_video?: boolean;
  started_at?: string | null;
  ended_at?: string | null;
  duration_secs?: number | null;
  created_at: string;
};