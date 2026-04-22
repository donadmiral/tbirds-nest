-- ============================================================
-- TBIRD'S NEST — FULL SUPABASE SCHEMA
-- Run this in Supabase SQL Editor
-- ============================================================

-- Enable extensions
create extension if not exists "uuid-ossp";
create extension if not exists "pg_trgm";

-- ============================================================
-- PROFILES
-- ============================================================
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null default '',
  username text unique,
  avatar_url text,
  bio text,
  degree_program text,
  graduation_year int,
  location text,
  interests text[],
  posts_count int not null default 0,
  connections_count int not null default 0,
  jobs_posted_count int not null default 0,
  events_joined_count int not null default 0,
  is_verified boolean not null default false,
  last_seen timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_profiles_username on public.profiles(username);
create index idx_profiles_full_name_trgm on public.profiles using gin(full_name gin_trgm_ops);

-- ============================================================
-- USER PRESENCE
-- ============================================================
create table public.user_presence (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  is_online boolean not null default false,
  last_seen timestamptz not null default now()
);

-- ============================================================
-- POSTS
-- ============================================================
create table public.posts (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  image_url text,
  likes_count int not null default 0,
  comments_count int not null default 0,
  shares_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_posts_user_id on public.posts(user_id);
create index idx_posts_created_at on public.posts(created_at desc);

-- ============================================================
-- POST LIKES
-- ============================================================
create table public.post_likes (
  id uuid primary key default uuid_generate_v4(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(post_id, user_id)
);

create index idx_post_likes_post_id on public.post_likes(post_id);
create index idx_post_likes_user_id on public.post_likes(user_id);

-- ============================================================
-- POST COMMENTS
-- ============================================================
create table public.post_comments (
  id uuid primary key default uuid_generate_v4(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create index idx_post_comments_post_id on public.post_comments(post_id);

-- ============================================================
-- POST SHARES
-- ============================================================
create table public.post_shares (
  id uuid primary key default uuid_generate_v4(),
  original_post_id uuid not null references public.posts(id) on delete cascade,
  shared_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ============================================================
-- CONNECTIONS
-- ============================================================
create table public.connection_requests (
  id uuid primary key default uuid_generate_v4(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  receiver_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(sender_id, receiver_id)
);

create index idx_conn_req_receiver on public.connection_requests(receiver_id);
create index idx_conn_req_sender on public.connection_requests(sender_id);

create table public.connections (
  id uuid primary key default uuid_generate_v4(),
  user_a uuid not null references public.profiles(id) on delete cascade,
  user_b uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(user_a, user_b)
);

create index idx_connections_user_a on public.connections(user_a);
create index idx_connections_user_b on public.connections(user_b);

-- ============================================================
-- CONVERSATIONS & MESSAGES
-- ============================================================
create table public.conversations (
  id uuid primary key default uuid_generate_v4(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message text,
  last_message_at timestamptz,
  last_sender_id uuid references public.profiles(id)
);

create table public.conversation_participants (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key(conversation_id, user_id)
);

create index idx_conv_participants_user on public.conversation_participants(user_id);

create table public.messages (
  id uuid primary key default uuid_generate_v4(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  deleted_by_sender boolean not null default false,
  created_at timestamptz not null default now()
);

create index idx_messages_conversation on public.messages(conversation_id, created_at asc);

create table public.message_reads (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key(message_id, user_id)
);

-- ============================================================
-- JOBS
-- ============================================================
create table public.jobs (
  id uuid primary key default uuid_generate_v4(),
  posted_by uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  company text not null,
  location text,
  description text not null,
  job_type text check (job_type in ('full-time','part-time','internship','contract','remote')),
  salary_range text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_jobs_posted_by on public.jobs(posted_by);
create index idx_jobs_created_at on public.jobs(created_at desc);
create index idx_jobs_title_trgm on public.jobs using gin(title gin_trgm_ops);
create index idx_jobs_company_trgm on public.jobs using gin(company gin_trgm_ops);

-- ============================================================
-- MENTORSHIP
-- ============================================================
create table public.mentor_profiles (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  expertise text[],
  industry text,
  availability text,
  bio text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.mentee_requests (
  id uuid primary key default uuid_generate_v4(),
  mentee_id uuid not null references public.profiles(id) on delete cascade,
  mentor_id uuid not null references public.profiles(id) on delete cascade,
  goals text not null,
  status text not null default 'pending' check (status in ('pending','accepted','rejected')),
  created_at timestamptz not null default now(),
  unique(mentee_id, mentor_id)
);

-- ============================================================
-- STARTUP & VC HUB
-- ============================================================
create table public.investor_profiles (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  firm_name text,
  investment_focus text[],
  check_size text,
  bio text,
  website url,
  created_at timestamptz not null default now()
);

create table public.founder_profiles (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  company_name text not null,
  stage text,
  industry text,
  bio text,
  website text,
  created_at timestamptz not null default now()
);

create table public.startups (
  id uuid primary key default uuid_generate_v4(),
  founder_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  description text not null,
  industry text,
  stage text,
  website text,
  logo_url text,
  seeking text,
  created_at timestamptz not null default now()
);

create index idx_startups_founder on public.startups(founder_id);

-- ============================================================
-- EVENTS
-- ============================================================
create table public.events (
  id uuid primary key default uuid_generate_v4(),
  created_by uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  description text,
  location text,
  event_date timestamptz not null,
  image_url text,
  attendees_count int not null default 0,
  created_at timestamptz not null default now()
);

create index idx_events_date on public.events(event_date asc);

create table public.event_attendees (
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key(event_id, user_id)
);

-- ============================================================
-- SUPPORT TRANSACTIONS
-- ============================================================
create table public.support_transactions (
  id uuid primary key default uuid_generate_v4(),
  from_user_id uuid references public.profiles(id),
  support_type text not null check (support_type in ('verified','direct','private')),
  amount numeric(10,2),
  message text,
  is_anonymous boolean not null default false,
  created_at timestamptz not null default now()
);

-- ============================================================
-- NOTIFICATIONS
-- ============================================================
create table public.notifications (
  id uuid primary key default uuid_generate_v4(),
  to_user_id uuid not null references public.profiles(id) on delete cascade,
  from_user_id uuid references public.profiles(id) on delete set null,
  type text not null check (type in (
    'connection_request','connection_accepted',
    'message','comment','like','event_joined','post_shared','mentee_request','mentor_accepted'
  )),
  title text not null,
  body text not null,
  ref_id uuid,
  ref_type text,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index idx_notifs_to_user on public.notifications(to_user_id, created_at desc);

-- ============================================================
-- FUNCTIONS & TRIGGERS
-- ============================================================

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', '')
  );
  insert into public.user_presence (user_id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Update posts_count on profile
create or replace function public.update_posts_count()
returns trigger language plpgsql as $$
begin
  if TG_OP = 'INSERT' then
    update public.profiles set posts_count = posts_count + 1 where id = NEW.user_id;
  elsif TG_OP = 'DELETE' then
    update public.profiles set posts_count = greatest(posts_count - 1, 0) where id = OLD.user_id;
  end if;
  return null;
end;
$$;

create trigger trg_posts_count
  after insert or delete on public.posts
  for each row execute function public.update_posts_count();

-- Update likes_count on posts
create or replace function public.update_likes_count()
returns trigger language plpgsql as $$
begin
  if TG_OP = 'INSERT' then
    update public.posts set likes_count = likes_count + 1 where id = NEW.post_id;
  elsif TG_OP = 'DELETE' then
    update public.posts set likes_count = greatest(likes_count - 1, 0) where id = OLD.post_id;
  end if;
  return null;
end;
$$;

create trigger trg_likes_count
  after insert or delete on public.post_likes
  for each row execute function public.update_likes_count();

-- Update comments_count on posts
create or replace function public.update_comments_count()
returns trigger language plpgsql as $$
begin
  if TG_OP = 'INSERT' then
    update public.posts set comments_count = comments_count + 1 where id = NEW.post_id;
  elsif TG_OP = 'DELETE' then
    update public.posts set comments_count = greatest(comments_count - 1, 0) where id = OLD.post_id;
  end if;
  return null;
end;
$$;

create trigger trg_comments_count
  after insert or delete on public.post_comments
  for each row execute function public.update_comments_count();

-- Update connections_count
create or replace function public.update_connections_count()
returns trigger language plpgsql as $$
begin
  if TG_OP = 'INSERT' then
    update public.profiles set connections_count = connections_count + 1 where id in (NEW.user_a, NEW.user_b);
  elsif TG_OP = 'DELETE' then
    update public.profiles set connections_count = greatest(connections_count - 1, 0) where id in (OLD.user_a, OLD.user_b);
  end if;
  return null;
end;
$$;

create trigger trg_connections_count
  after insert or delete on public.connections
  for each row execute function public.update_connections_count();

-- Update event attendees_count
create or replace function public.update_event_count()
returns trigger language plpgsql as $$
begin
  if TG_OP = 'INSERT' then
    update public.events set attendees_count = attendees_count + 1 where id = NEW.event_id;
    update public.profiles set events_joined_count = events_joined_count + 1 where id = NEW.user_id;
  elsif TG_OP = 'DELETE' then
    update public.events set attendees_count = greatest(attendees_count - 1, 0) where id = OLD.event_id;
    update public.profiles set events_joined_count = greatest(events_joined_count - 1, 0) where id = OLD.user_id;
  end if;
  return null;
end;
$$;

create trigger trg_event_count
  after insert or delete on public.event_attendees
  for each row execute function public.update_event_count();

-- Find or create conversation between two users
create or replace function public.find_or_create_conversation(user_a uuid, user_b uuid)
returns uuid language plpgsql security definer as $$
declare
  conv_id uuid;
begin
  select cp1.conversation_id into conv_id
  from public.conversation_participants cp1
  join public.conversation_participants cp2 on cp1.conversation_id = cp2.conversation_id
  where cp1.user_id = user_a and cp2.user_id = user_b
  limit 1;

  if conv_id is null then
    insert into public.conversations default values returning id into conv_id;
    insert into public.conversation_participants (conversation_id, user_id) values (conv_id, user_a), (conv_id, user_b);
  end if;

  return conv_id;
end;
$$;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table public.profiles enable row level security;
alter table public.user_presence enable row level security;
alter table public.posts enable row level security;
alter table public.post_likes enable row level security;
alter table public.post_comments enable row level security;
alter table public.post_shares enable row level security;
alter table public.connection_requests enable row level security;
alter table public.connections enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_participants enable row level security;
alter table public.messages enable row level security;
alter table public.message_reads enable row level security;
alter table public.jobs enable row level security;
alter table public.mentor_profiles enable row level security;
alter table public.mentee_requests enable row level security;
alter table public.investor_profiles enable row level security;
alter table public.founder_profiles enable row level security;
alter table public.startups enable row level security;
alter table public.events enable row level security;
alter table public.event_attendees enable row level security;
alter table public.support_transactions enable row level security;
alter table public.notifications enable row level security;

-- PROFILES
create policy "profiles_select_all" on public.profiles for select using (true);
create policy "profiles_insert_own" on public.profiles for insert with check (auth.uid() = id);
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id);

-- PRESENCE
create policy "presence_select_all" on public.user_presence for select using (true);
create policy "presence_upsert_own" on public.user_presence for all using (auth.uid() = user_id);

-- POSTS
create policy "posts_select_all" on public.posts for select using (true);
create policy "posts_insert_own" on public.posts for insert with check (auth.uid() = user_id);
create policy "posts_update_own" on public.posts for update using (auth.uid() = user_id);
create policy "posts_delete_own" on public.posts for delete using (auth.uid() = user_id);

-- POST LIKES
create policy "likes_select_all" on public.post_likes for select using (true);
create policy "likes_insert_own" on public.post_likes for insert with check (auth.uid() = user_id);
create policy "likes_delete_own" on public.post_likes for delete using (auth.uid() = user_id);

-- POST COMMENTS
create policy "comments_select_all" on public.post_comments for select using (true);
create policy "comments_insert_own" on public.post_comments for insert with check (auth.uid() = user_id);
create policy "comments_delete_own" on public.post_comments for delete using (auth.uid() = user_id);

-- POST SHARES
create policy "shares_select_all" on public.post_shares for select using (true);
create policy "shares_insert_own" on public.post_shares for insert with check (auth.uid() = shared_by);

-- CONNECTIONS
create policy "conn_req_select" on public.connection_requests for select using (auth.uid() = sender_id or auth.uid() = receiver_id);
create policy "conn_req_insert" on public.connection_requests for insert with check (auth.uid() = sender_id);
create policy "conn_req_update" on public.connection_requests for update using (auth.uid() = receiver_id);
create policy "conn_req_delete" on public.connection_requests for delete using (auth.uid() = sender_id or auth.uid() = receiver_id);
create policy "connections_select" on public.connections for select using (auth.uid() = user_a or auth.uid() = user_b);
create policy "connections_insert" on public.connections for insert with check (auth.uid() = user_a or auth.uid() = user_b);
create policy "connections_delete" on public.connections for delete using (auth.uid() = user_a or auth.uid() = user_b);

-- CONVERSATIONS & MESSAGES
create policy "conv_select" on public.conversations for select
  using (exists (select 1 from public.conversation_participants where conversation_id = id and user_id = auth.uid()));
create policy "conv_insert" on public.conversations for insert with check (true);
create policy "conv_update" on public.conversations for update
  using (exists (select 1 from public.conversation_participants where conversation_id = id and user_id = auth.uid()));

create policy "conv_participants_select" on public.conversation_participants for select
  using (exists (select 1 from public.conversation_participants cp where cp.conversation_id = conversation_id and cp.user_id = auth.uid()));
create policy "conv_participants_insert" on public.conversation_participants for insert with check (true);

create policy "messages_select" on public.messages for select
  using (exists (select 1 from public.conversation_participants where conversation_id = messages.conversation_id and user_id = auth.uid()));
create policy "messages_insert" on public.messages for insert
  with check (auth.uid() = sender_id and exists (select 1 from public.conversation_participants where conversation_id = messages.conversation_id and user_id = auth.uid()));
create policy "messages_update_own" on public.messages for update using (auth.uid() = sender_id);

create policy "reads_select" on public.message_reads for select using (auth.uid() = user_id);
create policy "reads_insert" on public.message_reads for insert with check (auth.uid() = user_id);

-- JOBS
create policy "jobs_select_all" on public.jobs for select using (true);
create policy "jobs_insert_own" on public.jobs for insert with check (auth.uid() = posted_by);
create policy "jobs_update_own" on public.jobs for update using (auth.uid() = posted_by);
create policy "jobs_delete_own" on public.jobs for delete using (auth.uid() = posted_by);

-- MENTORSHIP
create policy "mentor_select_all" on public.mentor_profiles for select using (true);
create policy "mentor_insert_own" on public.mentor_profiles for insert with check (auth.uid() = user_id);
create policy "mentor_update_own" on public.mentor_profiles for update using (auth.uid() = user_id);
create policy "mentee_req_select" on public.mentee_requests for select using (auth.uid() = mentee_id or auth.uid() = mentor_id);
create policy "mentee_req_insert" on public.mentee_requests for insert with check (auth.uid() = mentee_id);
create policy "mentee_req_update" on public.mentee_requests for update using (auth.uid() = mentor_id);

-- STARTUP & VC
create policy "investor_select_all" on public.investor_profiles for select using (true);
create policy "investor_insert_own" on public.investor_profiles for insert with check (auth.uid() = user_id);
create policy "investor_update_own" on public.investor_profiles for update using (auth.uid() = user_id);
create policy "founder_select_all" on public.founder_profiles for select using (true);
create policy "founder_insert_own" on public.founder_profiles for insert with check (auth.uid() = user_id);
create policy "startups_select_all" on public.startups for select using (true);
create policy "startups_insert_own" on public.startups for insert with check (auth.uid() = founder_id);
create policy "startups_update_own" on public.startups for update using (auth.uid() = founder_id);
create policy "startups_delete_own" on public.startups for delete using (auth.uid() = founder_id);

-- EVENTS
create policy "events_select_all" on public.events for select using (true);
create policy "events_insert_auth" on public.events for insert with check (auth.uid() = created_by);
create policy "events_update_own" on public.events for update using (auth.uid() = created_by);
create policy "event_attendees_select_all" on public.event_attendees for select using (true);
create policy "event_attendees_insert_own" on public.event_attendees for insert with check (auth.uid() = user_id);
create policy "event_attendees_delete_own" on public.event_attendees for delete using (auth.uid() = user_id);

-- SUPPORT
create policy "support_insert" on public.support_transactions for insert with check (true);
create policy "support_select_own" on public.support_transactions for select using (auth.uid() = from_user_id);

-- NOTIFICATIONS
create policy "notifs_select_own" on public.notifications for select using (auth.uid() = to_user_id);
create policy "notifs_insert" on public.notifications for insert with check (true);
create policy "notifs_update_own" on public.notifications for update using (auth.uid() = to_user_id);

-- ============================================================
-- ENABLE REALTIME
-- ============================================================
alter publication supabase_realtime add table public.posts;
alter publication supabase_realtime add table public.post_likes;
alter publication supabase_realtime add table public.post_comments;
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.notifications;
alter publication supabase_realtime add table public.connection_requests;
alter publication supabase_realtime add table public.user_presence;
alter publication supabase_realtime add table public.conversations;
