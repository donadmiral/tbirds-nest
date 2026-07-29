-- 0102 The measurement spine. app_events for future funnels, and
-- daily_stats computed nightly from the activity tables that already
-- exist - with thirty days backfilled right now, so the trend is real
-- from the first minute. No invented numbers anywhere.

create table if not exists public.app_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  name text not null,
  props jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now()
);
create index if not exists app_events_name_time on public.app_events (name, created_at);
create index if not exists app_events_user_time on public.app_events (user_id, created_at);
alter table public.app_events enable row level security;
drop policy if exists "events_insert_own" on public.app_events;
create policy "events_insert_own" on public.app_events
  for insert to authenticated with check (user_id = auth.uid());

create table if not exists public.daily_stats (
  day date primary key,
  dau integer not null default 0,
  new_signups integer not null default 0,
  posts integer not null default 0,
  comments integer not null default 0,
  likes integer not null default 0,
  messages integer not null default 0,
  stories integer not null default 0,
  listings integer not null default 0,
  jobs integer not null default 0,
  computed_at timestamp with time zone not null default now()
);
alter table public.daily_stats enable row level security;

create or replace function public.rebuild_daily_stats(p_day date)
returns void language sql security definer set search_path = public
as $fn$
  insert into daily_stats (day, dau, new_signups, posts, comments, likes, messages, stories, listings, jobs, computed_at)
  select
    p_day,
    (select count(distinct actor) from (
       select user_id as actor from posts where created_at >= p_day and created_at < p_day + 1
       union select user_id from post_comments where created_at >= p_day and created_at < p_day + 1
       union select user_id from post_likes where created_at >= p_day and created_at < p_day + 1
       union select sender_id from messages where created_at >= p_day and created_at < p_day + 1
       union select user_id from stories where created_at >= p_day and created_at < p_day + 1
       union select user_id from story_views where viewed_at >= p_day and viewed_at < p_day + 1
     ) a where actor is not null),
    (select count(*) from profiles where created_at >= p_day and created_at < p_day + 1),
    (select count(*) from posts where created_at >= p_day and created_at < p_day + 1),
    (select count(*) from post_comments where created_at >= p_day and created_at < p_day + 1),
    (select count(*) from post_likes where created_at >= p_day and created_at < p_day + 1),
    (select count(*) from messages where created_at >= p_day and created_at < p_day + 1),
    (select count(*) from stories where created_at >= p_day and created_at < p_day + 1),
    (select count(*) from marketplace_listings where created_at >= p_day and created_at < p_day + 1),
    (select count(*) from jobs where created_at >= p_day and created_at < p_day + 1),
    now()
  on conflict (day) do update set
    dau = excluded.dau, new_signups = excluded.new_signups, posts = excluded.posts,
    comments = excluded.comments, likes = excluded.likes, messages = excluded.messages,
    stories = excluded.stories, listings = excluded.listings, jobs = excluded.jobs,
    computed_at = now();
$fn$;

do $do$
declare d int;
begin
  for d in 0..29 loop
    perform public.rebuild_daily_stats(current_date - d);
  end loop;
  begin
    perform cron.schedule('daily-stats', '10 0 * * *',
      'select public.rebuild_daily_stats(current_date - 1); select public.rebuild_daily_stats(current_date);');
  exception when others then
    raise notice 'cron schedule skipped: %', sqlerrm;
  end;
end $do$;