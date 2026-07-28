-- 0041: native sponsored posts + private-profile gate in get_feed
-- A sponsored item IS a post (same card, same likes/comments/insights).
-- promoted_posts marks a post as a campaign; get_active_promos picks eligible
-- ones server-side; the client interleaves them with a Sponsored label.
-- No auction: direct-sold slots, honest at this scale.

create table if not exists public.promoted_posts (
  id                uuid primary key default gen_random_uuid(),
  post_id           uuid not null references public.posts(id) on delete cascade,
  advertiser_id     uuid not null references public.profiles(id) on delete cascade,
  label             text not null default 'Sponsored',
  status            text not null default 'active' check (status in ('active','paused','ended')),
  starts_at         timestamptz not null default now(),
  ends_at           timestamptz,
  total_cap         int,
  impressions_count int not null default 0,
  clicks_count      int not null default 0,
  created_at        timestamptz not null default now()
);
create index if not exists idx_promoted_active on public.promoted_posts (status, starts_at);

alter table public.promoted_posts enable row level security;
drop policy if exists promoted_select on public.promoted_posts;
create policy promoted_select on public.promoted_posts
  for select to authenticated
  using (status = 'active' or can_act_as(advertiser_id));
drop policy if exists promoted_write on public.promoted_posts;
create policy promoted_write on public.promoted_posts
  for all to authenticated
  using (can_act_as(advertiser_id)) with check (can_act_as(advertiser_id));

create table if not exists public.ad_events (
  id         uuid primary key default gen_random_uuid(),
  promo_id   uuid not null references public.promoted_posts(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  kind       text not null check (kind in ('impression','click')),
  created_at timestamptz not null default now(),
  unique (promo_id, user_id, kind)
);
alter table public.ad_events enable row level security;
drop policy if exists ad_events_insert_own on public.ad_events;
create policy ad_events_insert_own on public.ad_events
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists ad_events_select_advertiser on public.ad_events;
create policy ad_events_select_advertiser on public.ad_events
  for select to authenticated
  using (exists (select 1 from promoted_posts pp
                 where pp.id = ad_events.promo_id and can_act_as(pp.advertiser_id)));

create or replace function public.bump_ad_counters()
returns trigger language plpgsql security definer set search_path = public
as $tg$
begin
  if new.kind = 'impression' then
    update promoted_posts set impressions_count = impressions_count + 1 where id = new.promo_id;
  else
    update promoted_posts set clicks_count = clicks_count + 1 where id = new.promo_id;
  end if;
  return new;
end;
$tg$;
drop trigger if exists trg_bump_ad_counters on public.ad_events;
create trigger trg_bump_ad_counters after insert on public.ad_events
  for each row execute function bump_ad_counters();

create or replace function public.record_ad_event(p_promo_id uuid, p_kind text)
returns void language sql security invoker set search_path = public
as $$
  insert into ad_events (promo_id, user_id, kind)
  values (p_promo_id, auth.uid(), p_kind)
  on conflict (promo_id, user_id, kind) do nothing;
$$;
grant execute on function public.record_ad_event(uuid, text) to authenticated;

create or replace function public.get_active_promos(p_limit int default 3)
returns table (
  post_id uuid, author_id uuid, content text, body text, media_url text,
  media jsonb, products jsonb, channel text, article_title text, read_minutes int,
  quoted_post_id uuid, thread_parent_id uuid, created_at timestamptz,
  likes_count int, comments_count int, reposts_count int, bookmarks_count int,
  views_count int, is_trending boolean,
  author_name text, author_username text, author_avatar text, author_verified boolean,
  promo_id uuid, promo_label text
)
language sql stable security invoker set search_path = public
as $fn$
select p.id, p.user_id, p.content, p.body, p.media_url,
  coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'url', m.url,
      'media_type', m.media_type, 'width', m.width, 'height', m.height,
      'sort_order', m.sort_order) order by m.sort_order nulls last)
    from post_media m where m.post_id = p.id), '[]'::jsonb),
  coalesce((select jsonb_agg(jsonb_build_object(
      'id', x.id, 'title', x.title, 'subtitle', x.subtitle, 'price', x.price,
      'currency', x.currency, 'image_url', x.image_url, 'listing_id', x.listing_id,
      'link_url', x.link_url, 'cta_label', x.cta_label, 'sort_order', x.sort_order)
      order by x.sort_order)
    from post_products x where x.post_id = p.id), '[]'::jsonb),
  p.channel, p.article_title, p.read_minutes, p.quoted_post_id, p.thread_parent_id,
  p.created_at, p.likes_count, p.comments_count, p.reposts_count, p.bookmarks_count,
  p.views_count, false,
  pr.full_name, pr.username, pr.avatar_url, pr.is_verified,
  pp.id, pp.label
from promoted_posts pp
join posts p    on p.id = pp.post_id
join profiles pr on pr.id = p.user_id
where pp.status = 'active'
  and now() >= pp.starts_at
  and (pp.ends_at is null or now() <= pp.ends_at)
  and (pp.total_cap is null or pp.impressions_count < pp.total_cap)
  and coalesce(p.audience, 'everyone') = 'everyone'
  and not exists (select 1 from blocked_users b
                  where (b.blocker_id = auth.uid() and b.blocked_id = p.user_id)
                     or (b.blocker_id = p.user_id and b.blocked_id = auth.uid()))
order by pp.created_at desc
limit least(coalesce(p_limit, 3), 5);
$fn$;
grant execute on function public.get_active_promos(int) to authenticated;

-- ── get_feed: audience gate kept, private-profile gate ADDED ──
create or replace function public.get_feed(
  p_mode       text default 'for_you',
  p_cursor_key double precision default null,
  p_cursor_id  uuid default null,
  p_limit      int default 20
)
returns table (
  post_id uuid, author_id uuid, content text, body text, media_url text,
  media jsonb, products jsonb, channel text, article_title text, read_minutes int,
  quoted_post_id uuid, thread_parent_id uuid, created_at timestamptz,
  likes_count int, comments_count int, reposts_count int, bookmarks_count int,
  views_count int, is_trending boolean,
  author_name text, author_username text, author_avatar text,
  author_verified boolean, author_kind text,
  viewer_liked boolean, viewer_bookmarked boolean, viewer_reposted boolean,
  viewer_follows boolean, sort_key double precision
)
language sql stable security invoker set search_path = public
as $fn$
with viewer as (select auth.uid() as uid),
recent_velocity as (
  select coalesce(percentile_cont(0.9) within group (
           order by (coalesce(likes_count,0) + coalesce(comments_count,0) + coalesce(reposts_count,0))
                    / greatest(extract(epoch from (now() - created_at)) / 3600.0, 1.0)
         ), 0) as cutoff
  from posts where created_at > now() - interval '72 hours'
),
affinity as (
  select p.user_id as author_id, count(*)::int as n
  from post_likes pl join posts p on p.id = pl.post_id
  where pl.user_id = (select uid from viewer)
    and pl.created_at > now() - interval '30 days'
  group by p.user_id
),
candidates as (
  select p.id, p.user_id, p.content, p.body, p.media_url, p.channel,
         p.article_title, p.read_minutes, p.quoted_post_id, p.thread_parent_id,
         p.created_at, p.likes_count, p.comments_count, p.reposts_count,
         p.bookmarks_count, p.views_count
  from posts p
  where (p_mode <> 'innovation' or p.channel = 'innovation')
    and (p_mode <> 'for_you'    or p.created_at > now() - interval '365 days')
    and not exists (select 1 from hidden_posts h
                    where h.post_id = p.id and h.user_id = (select uid from viewer))
    and not exists (select 1 from blocked_users b
                    where (b.blocker_id = (select uid from viewer) and b.blocked_id = p.user_id)
                       or (b.blocker_id = p.user_id and b.blocked_id = (select uid from viewer)))
    and not exists (select 1 from profiles px
                    where px.id = p.user_id
                      and px.profile_visibility = 'private'
                      and px.id <> (select uid from viewer)
                      and not exists (select 1 from follows f2
                                      where f2.follower_id = (select uid from viewer)
                                        and f2.following_id = p.user_id))
    and (
      coalesce(p.audience, 'everyone') = 'everyone'
      or p.user_id = (select uid from viewer)
      or (p.audience = 'followers' and exists (
            select 1 from follows f
            where f.following_id = p.user_id and f.follower_id = (select uid from viewer)))
      or (p.audience = 'mentioned' and exists (
            select 1 from post_mentions pm
            where pm.post_id = p.id and pm.mentioned_user_id = (select uid from viewer)))
      or (p.audience = 'verified' and exists (
            select 1 from profiles vp
            where vp.id = (select uid from viewer) and vp.is_verified))
    )
),
enriched as (
  select c.*, pr.full_name, pr.username, pr.avatar_url, pr.is_verified, pr.account_type,
    (fl.follower_id is not null) as follows,
    (lk.user_id is not null) as liked,
    (bk.user_id is not null) as bookmarked,
    (rp.user_id is not null) as reposted,
    (sn.post_id is not null) as seen,
    coalesce(af.n, 0) as affinity_n,
    (coalesce(c.likes_count,0) + coalesce(c.comments_count,0) + coalesce(c.reposts_count,0)) as engagements,
    (coalesce(c.likes_count,0) + coalesce(c.comments_count,0) + coalesce(c.reposts_count,0))
      / greatest(extract(epoch from (now() - c.created_at)) / 3600.0, 1.0) as velocity
  from candidates c
  join profiles pr on pr.id = c.user_id
  left join follows fl        on fl.following_id = c.user_id and fl.follower_id = (select uid from viewer)
  left join post_likes lk     on lk.post_id = c.id and lk.user_id = (select uid from viewer)
  left join post_bookmarks bk on bk.post_id = c.id and bk.user_id = (select uid from viewer)
  left join post_reposts rp   on rp.post_id = c.id and rp.user_id = (select uid from viewer)
  left join post_seen sn      on sn.post_id = c.id and sn.user_id = (select uid from viewer)
  left join affinity af       on af.author_id = c.user_id
),
base as (
  select e.*,
    (e.created_at > now() - interval '72 hours'
      and e.engagements >= 3
      and e.velocity >= (select cutoff from recent_velocity)
      and (select cutoff from recent_velocity) > 0) as trending,
    case when p_mode = 'for_you' then
      ( (coalesce(e.likes_count,0) * 1.0)
      + (coalesce(e.comments_count,0) * 2.5)
      + (coalesce(e.reposts_count,0) * 2.0) + 1.0 )
      / power((extract(epoch from (now() - e.created_at)) / 3600.0) + 2.0, 1.5)
      * (case when e.follows then 3.0 else 1.0 end)
      * (1.0 + least(e.affinity_n, 5) * 0.15)
      * (case when e.seen then 0.15 else 1.0 end)
    else extract(epoch from e.created_at) end as raw_score
  from enriched e
),
diversified as (
  select b.*,
    case when p_mode = 'for_you'
      then b.raw_score * power(0.55::double precision,
             (row_number() over (partition by b.user_id order by b.raw_score desc) - 1))
      else b.raw_score
    end as sort_key
  from base b
)
select d.id, d.user_id, d.content, d.body, d.media_url,
  coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'url', m.url,
      'media_type', m.media_type, 'width', m.width, 'height', m.height,
      'sort_order', m.sort_order) order by m.sort_order nulls last)
    from post_media m where m.post_id = d.id), '[]'::jsonb),
  coalesce((select jsonb_agg(jsonb_build_object(
      'id', pp.id, 'title', pp.title, 'subtitle', pp.subtitle,
      'price', pp.price, 'currency', pp.currency, 'image_url', pp.image_url,
      'listing_id', pp.listing_id, 'link_url', pp.link_url,
      'cta_label', pp.cta_label, 'sort_order', pp.sort_order)
      order by pp.sort_order)
    from post_products pp where pp.post_id = d.id), '[]'::jsonb),
  d.channel, d.article_title, d.read_minutes, d.quoted_post_id, d.thread_parent_id,
  d.created_at, d.likes_count, d.comments_count, d.reposts_count, d.bookmarks_count,
  d.views_count, d.trending,
  d.full_name, d.username, d.avatar_url, d.is_verified, d.account_type,
  d.liked, d.bookmarked, d.reposted, d.follows, d.sort_key
from diversified d
where p_cursor_key is null or (d.sort_key, d.id) < (p_cursor_key, p_cursor_id)
order by d.sort_key desc, d.id desc
limit least(coalesce(p_limit, 20), 50);
$fn$;

grant execute on function public.get_feed(text, double precision, uuid, int) to authenticated;