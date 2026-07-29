-- 0088 Trending Engine v2: the snapshot. Compute once on a schedule, serve
-- thousands from one indexed read. Honor math: unique engagers (never raw
-- counts), self-engagement excluded, quality weights, gravity decay, one
-- post per author, hard caps. The stories reader re-points here unchanged.

create table if not exists public.trending_snapshot (
  kind text not null check (kind in ('post','story')),
  ref_id uuid not null,
  user_id uuid not null,
  rank int not null,
  heat numeric not null,
  uniq_engagers int not null default 0,
  computed_at timestamptz not null default now(),
  primary key (kind, ref_id)
);
alter table public.trending_snapshot enable row level security;
drop policy if exists trending_snapshot_read on public.trending_snapshot;
create policy trending_snapshot_read on public.trending_snapshot
  for select to authenticated using (true);

create or replace function public.rebuild_trending_snapshot()
returns void language sql security definer set search_path = public
as $fn$
  delete from trending_snapshot;

  insert into trending_snapshot (kind, ref_id, user_id, rank, heat, uniq_engagers)
  select 'post', ref_id, author_id,
         row_number() over (order by heat desc, uniq desc), heat, uniq
  from (
    select distinct on (p.user_id)
      p.id as ref_id, p.user_id as author_id,
      ( (select count(distinct l.user_id) from post_likes l
          where l.post_id = p.id and l.user_id <> p.user_id) * 1.0
      + (select count(distinct c.user_id) from post_comments c
          where c.post_id = p.id and c.user_id <> p.user_id) * 2.5
      + (select count(distinct r.user_id) from post_reposts r
          where r.post_id = p.id and r.user_id <> p.user_id) * 2.0
      ) / power(greatest(extract(epoch from (now() - p.created_at)) / 3600.0, 1.0), 0.8) as heat,
      ( select count(distinct e.user_id) from (
          select user_id from post_likes where post_id = p.id
          union select user_id from post_comments where post_id = p.id
          union select user_id from post_reposts where post_id = p.id
        ) e where e.user_id <> p.user_id ) as uniq
    from posts p
    where p.created_at > now() - interval '72 hours'
      and coalesce(p.audience, 'everyone') = 'everyone'
    order by p.user_id, heat desc
  ) x
  where uniq >= 3
  order by heat desc
  limit 20;

  insert into trending_snapshot (kind, ref_id, user_id, rank, heat, uniq_engagers)
  select 'story', story_id, s_user, row_number() over (order by heat desc, views desc), heat, views
  from (
    select distinct on (s.user_id)
      s.id as story_id, s.user_id as s_user,
      (select count(*) from story_views v
        where v.story_id = s.id and v.user_id <> s.user_id)::int as views,
      (select count(*) from story_reactions r
        where r.story_id = s.id and r.user_id <> s.user_id)::int as reactions,
      ((select count(*) from story_views v
         where v.story_id = s.id and v.user_id <> s.user_id)
       + (select count(*) from story_reactions r
          where r.story_id = s.id and r.user_id <> s.user_id) * 2.0) as heat
    from stories s
    where s.created_at > now() - interval '24 hours'
      and coalesce(s.audience, 'everyone') = 'everyone'
    order by s.user_id, heat desc
  ) x
  where x.views >= 10 and x.reactions >= 1
  order by heat desc
  limit 6;
$fn$;

create or replace function public.get_trending_stories(p_limit int default 6)
returns table (
  story_id uuid, user_id uuid, full_name text, username text,
  avatar_url text, views int, reactions int, heat numeric
)
language sql stable security invoker set search_path = public
as $fn$
  select t.ref_id, t.user_id, p.full_name, p.username, p.avatar_url,
         t.uniq_engagers, 0, t.heat
  from trending_snapshot t
  join profiles p on p.id = t.user_id
  where t.kind = 'story'
  order by t.rank
  limit least(greatest(coalesce(p_limit, 6), 1), 6);
$fn$;

grant execute on function public.get_trending_stories(int) to authenticated;

do $do$ begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron not enabled here: %', sqlerrm;
  end;
  begin
    perform cron.schedule('trending-refresh', '*/3 * * * *',
      'select public.rebuild_trending_snapshot()');
  exception when others then
    raise notice 'cron schedule skipped: %', sqlerrm;
  end;
end $do$;

select public.rebuild_trending_snapshot();