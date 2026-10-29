-- Column types captured read-only from the QA database; no user data.
CREATE TABLE public.blocked_users (
  blocker_id uuid,
  blocked_id uuid,
  created_at timestamp with time zone
);
CREATE TABLE public.channel_members (
  channel_id uuid,
  user_id uuid,
  role text,
  notification_level text,
  muted boolean,
  last_read_message_id uuid,
  joined_at timestamp with time zone
);
CREATE TABLE public.channel_message_reactions (
  message_id uuid,
  user_id uuid,
  emoji text,
  created_at timestamp with time zone
);
CREATE TABLE public.channel_messages (
  id uuid,
  channel_id uuid,
  sender_id uuid,
  content text,
  media_url text,
  media_type text,
  reply_count integer,
  created_at timestamp with time zone,
  is_prompt boolean
);
CREATE TABLE public.channel_poll_options (
  id uuid,
  message_id uuid,
  label text,
  position integer
);
CREATE TABLE public.channel_poll_votes (
  message_id uuid,
  user_id uuid,
  option_id uuid,
  created_at timestamp with time zone
);
CREATE TABLE public.channel_polls (
  message_id uuid,
  ends_at timestamp with time zone
);
CREATE TABLE public.channel_replies (
  id uuid,
  message_id uuid,
  user_id uuid,
  content text,
  created_at timestamp with time zone
);
CREATE TABLE public.channels (
  id uuid,
  owner_id uuid,
  name text,
  description text,
  icon_url text,
  audience text,
  replies_enabled boolean,
  member_count integer,
  status text,
  created_at timestamp with time zone
);
CREATE TABLE public.communities (
  id uuid,
  name text,
  emoji text,
  description text,
  created_by uuid,
  member_count integer,
  created_at timestamp with time zone,
  owner_id uuid,
  icon_url text,
  cover_color text,
  rules text,
  category text,
  join_mode text,
  last_activity_at timestamp with time zone,
  status text,
  conversation_id uuid,
  parent_id uuid
);
CREATE TABLE public.community_announcements (
  id uuid,
  community_id uuid,
  author_id uuid,
  body text,
  created_at timestamp with time zone
);
CREATE TABLE public.community_bans (
  community_id uuid,
  user_id uuid,
  banned_by uuid,
  reason text,
  created_at timestamp with time zone
);
CREATE TABLE public.community_invites (
  community_id uuid,
  user_id uuid,
  invited_by uuid,
  status text,
  created_at timestamp with time zone,
  responded_at timestamp with time zone
);
CREATE TABLE public.community_join_requests (
  community_id uuid,
  user_id uuid,
  message text,
  created_at timestamp with time zone
);
CREATE TABLE public.community_members (
  id uuid,
  community_id uuid,
  user_id uuid,
  joined_at timestamp with time zone,
  role text,
  status text,
  invited_by uuid,
  status_at timestamp with time zone
);
CREATE TABLE public.fact_check_votes (
  fact_check_id uuid,
  voter_id uuid,
  helpful boolean,
  created_at timestamp with time zone
);
CREATE TABLE public.fact_checks (
  id uuid,
  post_id uuid,
  author_id uuid,
  body text,
  sources text[],
  created_at timestamp with time zone
);
CREATE TABLE public.follows (
  id uuid,
  follower_id uuid,
  following_id uuid,
  created_at timestamp with time zone,
  account_type text
);
CREATE TABLE public.hidden_posts (
  user_id uuid,
  post_id uuid,
  created_at timestamp with time zone
);
CREATE TABLE public.jobs (
  id uuid,
  posted_by uuid,
  title text,
  company text,
  location text,
  description text,
  job_type text,
  salary_range text,
  created_at timestamp with time zone,
  updated_at timestamp with time zone,
  category text,
  remote_type text,
  experience_level text,
  industry text,
  visa_sponsorship boolean,
  urgent boolean,
  verified boolean,
  applications_count integer,
  apply_url text,
  deadline timestamp with time zone,
  benefits text,
  search_tsv tsvector
);
CREATE TABLE public.link_previews (
  url text,
  title text,
  description text,
  image_url text,
  domain text,
  fetched_at timestamp with time zone
);
CREATE TABLE public.marketplace_listings (
  id uuid,
  seller_id uuid,
  title text,
  description text,
  price numeric(12,2),
  currency text,
  category text,
  condition text,
  location_city text,
  images text[],
  status text,
  created_at timestamp with time zone,
  updated_at timestamp with time zone,
  report_count integer,
  hidden_at timestamp with time zone,
  delivery_available boolean,
  delivery_fee numeric,
  delivery_note text,
  search_tsv tsvector
);
CREATE TABLE public.notifications (
  id uuid,
  recipient_id uuid,
  actor_id uuid,
  type text,
  message text,
  read_at timestamp with time zone,
  data jsonb,
  created_at timestamp with time zone,
  body_preview text,
  account_type text
);
CREATE TABLE public.post_bookmarks (
  id uuid,
  post_id uuid,
  user_id uuid,
  created_at timestamp without time zone,
  collection_id uuid
);
CREATE TABLE public.post_likes (
  id uuid,
  post_id uuid,
  user_id uuid,
  created_at timestamp with time zone
);
CREATE TABLE public.post_media (
  id uuid,
  post_id uuid,
  url text,
  media_type text,
  sort_order integer,
  created_at timestamp with time zone,
  width integer,
  height integer,
  is_sensitive boolean,
  alt_text text,
  edit jsonb,
  role text
);
CREATE TABLE public.post_mentions (
  id uuid,
  post_id uuid,
  mentioned_user_id uuid,
  mentioned_username text,
  created_at timestamp with time zone
);
CREATE TABLE public.post_polls (
  post_id uuid,
  ends_at timestamp with time zone,
  created_at timestamp with time zone
);
CREATE TABLE public.post_products (
  id uuid,
  post_id uuid,
  sort_order integer,
  title text,
  subtitle text,
  price numeric,
  currency text,
  image_url text,
  listing_id uuid,
  link_url text,
  cta_label text,
  created_at timestamp with time zone
);
CREATE TABLE public.post_reposts (
  id uuid,
  post_id uuid,
  user_id uuid,
  created_at timestamp without time zone
);
CREATE TABLE public.post_seen (
  user_id uuid,
  post_id uuid,
  seen_at timestamp with time zone
);
CREATE TABLE public.posts (
  id uuid,
  user_id uuid,
  body text,
  image_url text,
  likes_count integer,
  comments_count integer,
  shares_count integer,
  created_at timestamp with time zone,
  updated_at timestamp with time zone,
  content text,
  reposts_count integer,
  bookmarks_count integer,
  media_url text,
  views_count integer,
  institution_id uuid,
  scope text,
  affiliation_id uuid,
  is_exclusive boolean,
  account_type text,
  channel text,
  quoted_post_id uuid,
  thread_parent_id uuid,
  article_title text,
  read_minutes integer,
  audience text,
  link_url text,
  innovation_field text,
  innovation_stage text,
  edited_at timestamp with time zone,
  category text,
  search_tsv tsvector,
  community_id uuid,
  is_community_pinned boolean,
  comment_policy text,
  archived_at timestamp with time zone
);
CREATE TABLE public.profiles (
  id uuid,
  email text,
  full_name text,
  username text,
  avatar_url text,
  bio text,
  degree_program text,
  graduation_year integer,
  location text,
  interests text[],
  posts_count integer,
  connections_count integer,
  jobs_posted_count integer,
  events_joined_count integer,
  is_verified boolean,
  last_seen timestamp with time zone,
  created_at timestamp with time zone,
  updated_at timestamp with time zone,
  role text,
  profile_visibility text,
  notif_messages boolean,
  notif_connections boolean,
  notif_jobs boolean,
  push_token text,
  cohort_year integer,
  cohort text,
  workplace text,
  school text,
  other_schools text,
  headline text,
  graduation_semester text,
  is_verified_school_user boolean,
  email_domain text,
  deactivated_at timestamp with time zone,
  account_type text,
  institution text,
  is_verified_institution boolean,
  banner_url text,
  notif_prefs jsonb,
  verified_tier text,
  verified_category text,
  suspended_reason text,
  suspended_by uuid,
  restricted_until timestamp with time zone,
  pinned_post_id uuid,
  search_tsv tsvector,
  account_class text,
  affiliated_org_id uuid,
  account_labels jsonb,
  links jsonb,
  hidden_words text[],
  muted_words text[],
  quiet_from smallint,
  quiet_to smallint,
  quiet_tz_offset_min smallint,
  sensitive_content text
);
CREATE TABLE public.trending_snapshot (
  kind text,
  ref_id uuid,
  user_id uuid,
  rank integer,
  heat numeric,
  uniq_engagers integer,
  computed_at timestamp with time zone
);

CREATE TABLE public.muted_authors(user_id uuid,author_id uuid);
