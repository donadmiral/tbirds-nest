-- Disposable local test database only. Never load this fixture into a project.
do $$ begin
  if current_database() <> 'pc_scale_feed' then raise exception 'Use pc_scale_feed only'; end if;
end $$;
drop schema if exists feed_live cascade;
drop schema if exists realtime cascade;
drop schema if exists auth cascade;
drop schema public cascade;
create schema public;
create schema auth;
create schema realtime;
do $$ begin
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
end $$;
grant usage on schema public, auth, realtime to authenticated, anon, service_role;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function realtime.topic() returns text language sql stable as $$ select current_setting('fixture.topic', true) $$;
create table public.profiles(id uuid primary key, full_name text, username text,
  profile_visibility text default 'public', is_verified boolean default false, deactivated_at timestamptz, last_seen timestamptz);
create table public.posts(id uuid primary key, user_id uuid not null, content text, body text,
  likes_count integer default 0, comments_count integer default 0, reposts_count integer default 0,
  bookmarks_count integer default 0, shares_count integer default 0, views_count integer default 0,
  audience text default 'everyone', community_id uuid, is_exclusive boolean default false, archived_at timestamptz,
  rls_allowed boolean default true);
create table public.post_comments(id uuid primary key, post_id uuid, user_id uuid, body text,
  created_at timestamptz default now(), parent_comment_id uuid, hidden boolean default false);
create table public.post_likes(post_id uuid, user_id uuid, primary key(post_id,user_id));
create table public.post_bookmarks(post_id uuid, user_id uuid, primary key(post_id,user_id));
create table public.post_reposts(post_id uuid, user_id uuid, primary key(post_id,user_id));
create table public.follows(follower_id uuid, following_id uuid, primary key(follower_id,following_id));
create table public.blocked_users(blocker_id uuid, blocked_id uuid, primary key(blocker_id,blocked_id));
create table public.hidden_posts(post_id uuid, user_id uuid, primary key(post_id,user_id));
create table public.muted_authors(author_id uuid, user_id uuid, primary key(author_id,user_id));
create table public.post_mentions(post_id uuid, mentioned_user_id uuid, primary key(post_id,mentioned_user_id));
create table public.community_members(community_id uuid, user_id uuid, primary key(community_id,user_id));
create table realtime.messages(id bigserial primary key, topic text not null, extension text not null default 'broadcast', payload jsonb);
alter table realtime.messages enable row level security;
-- Deliberately broad pre-existing policies test the new restrictive guards.
create policy fixture_broad_read on realtime.messages for select to public using(true);
create policy fixture_broad_send on realtime.messages for insert to public with check(true);
grant select, insert on realtime.messages to authenticated, anon;
grant usage on sequence realtime.messages_id_seq to authenticated, anon;
create table public.fixture_broadcasts(topic text, event text, payload jsonb, private boolean);
create function realtime.send(payload jsonb, event text, topic text, private boolean)
returns void language plpgsql as $$ begin
  if current_setting('fixture.fail_send', true)='on' then raise exception 'Synthetic send failure'; end if;
  if current_setting('fixture.slow_send', true)='on' then
    perform pg_advisory_lock(742001);
    perform pg_advisory_unlock(742001);
  end if;
  insert into public.fixture_broadcasts values(topic, event, payload, private);
end $$;
grant select on all tables in schema public to authenticated;
grant insert, update, delete on public.posts, public.post_comments, public.profiles, public.follows, public.blocked_users to authenticated;
