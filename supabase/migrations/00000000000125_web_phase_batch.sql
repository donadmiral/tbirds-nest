-- 00000000000125_web_phase_batch.sql
-- Consolidated record of migrations 0125-0136, which ran through the SQL
-- editor during the web phase. Stub files 0126-0136 point here. Intermediate
-- get_feed drops (0130, 0131, 0133) are superseded; this file captures the
-- FINAL state of every object as of 0136. 0137 continues normal files.

-- 0125 call presence
alter table public.call_participants add column if not exists last_seen_at timestamptz;

-- 0126 promo objective
alter table public.promoted_posts add column if not exists objective text;

-- 0128 media columns through payloads (alt_text column itself)
alter table public.post_media add column if not exists alt_text text;
alter table public.post_media add column if not exists is_sensitive boolean;

-- 0129 fact check system
create table if not exists public.fact_checks (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 20 and 1000),
  sources text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (post_id, author_id)
);
create table if not exists public.fact_check_votes (
  fact_check_id uuid not null references public.fact_checks(id) on delete cascade,
  voter_id uuid not null references public.profiles(id) on delete cascade,
  helpful boolean not null,
  created_at timestamptz not null default now(),
  primary key (fact_check_id, voter_id)
);
alter table public.fact_checks enable row level security;
alter table public.fact_check_votes enable row level security;
drop policy if exists fact_checks_read on public.fact_checks;
create policy fact_checks_read on public.fact_checks for select using (auth.uid() is not null);
drop policy if exists fact_checks_insert on public.fact_checks;
create policy fact_checks_insert on public.fact_checks for insert with check (
  author_id = auth.uid()
  and not exists (select 1 from posts p where p.id = post_id and p.user_id = auth.uid())
);
drop policy if exists fact_checks_delete_own on public.fact_checks;
create policy fact_checks_delete_own on public.fact_checks for delete using (author_id = auth.uid());
drop policy if exists fact_check_votes_read on public.fact_check_votes;
create policy fact_check_votes_read on public.fact_check_votes for select using (auth.uid() is not null);
drop policy if exists fact_check_votes_write on public.fact_check_votes;
create policy fact_check_votes_write on public.fact_check_votes for insert with check (
  voter_id = auth.uid()
  and not exists (select 1 from fact_checks f where f.id = fact_check_id and f.author_id = auth.uid())
);
drop policy if exists fact_check_votes_update on public.fact_check_votes;
create policy fact_check_votes_update on public.fact_check_votes for update using (voter_id = auth.uid()) with check (voter_id = auth.uid());

create or replace function public.get_fact_checks(p_post_id uuid)
returns table (
  id uuid, body text, sources text[], created_at timestamptz,
  helpful_count int, not_helpful_count int, viewer_vote boolean, is_mine boolean, qualifies boolean
)
language sql stable security invoker set search_path = public
as $fn$
select f.id, f.body, f.sources, f.created_at,
  coalesce(sum(case when v.helpful then 1 else 0 end), 0)::int,
  coalesce(sum(case when not v.helpful then 1 else 0 end), 0)::int,
  (select mv.helpful from fact_check_votes mv where mv.fact_check_id = f.id and mv.voter_id = auth.uid()),
  (f.author_id = auth.uid()),
  (coalesce(sum(case when v.helpful then 1 else 0 end), 0) >= 3
   and coalesce(sum(case when v.helpful then 1 else 0 end), 0)
       > coalesce(sum(case when not v.helpful then 1 else 0 end), 0) * 2)
from fact_checks f
left join fact_check_votes v on v.fact_check_id = f.id
where f.post_id = p_post_id
group by f.id
order by 5 desc, f.created_at asc;
$fn$;

create or replace function public.rate_fact_check(p_id uuid, p_helpful boolean)
returns void language sql security invoker set search_path = public
as $fn$
insert into fact_check_votes (fact_check_id, voter_id, helpful)
values (p_id, auth.uid(), p_helpful)
on conflict (fact_check_id, voter_id) do update set helpful = excluded.helpful;
$fn$;

-- 0131 polls, editing, owner update
alter table public.posts add column if not exists edited_at timestamptz;
drop policy if exists posts_owner_update on public.posts;
create policy posts_owner_update on public.posts
for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create table if not exists public.post_polls (
  post_id uuid primary key references public.posts(id) on delete cascade,
  ends_at timestamptz not null default now() + interval '24 hours',
  created_at timestamptz not null default now()
);
create table if not exists public.post_poll_options (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.post_polls(post_id) on delete cascade,
  label text not null check (char_length(label) between 1 and 60),
  sort_order int not null default 0
);
create table if not exists public.post_poll_votes (
  post_id uuid not null references public.post_polls(post_id) on delete cascade,
  option_id uuid not null references public.post_poll_options(id) on delete cascade,
  voter_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, voter_id)
);
alter table public.post_polls enable row level security;
alter table public.post_poll_options enable row level security;
alter table public.post_poll_votes enable row level security;
drop policy if exists post_polls_read on public.post_polls;
create policy post_polls_read on public.post_polls for select using (auth.uid() is not null);
drop policy if exists post_polls_insert on public.post_polls;
create policy post_polls_insert on public.post_polls for insert with check (
  exists (select 1 from posts p where p.id = post_id and p.user_id = auth.uid())
);
drop policy if exists post_poll_options_read on public.post_poll_options;
create policy post_poll_options_read on public.post_poll_options for select using (auth.uid() is not null);
drop policy if exists post_poll_options_insert on public.post_poll_options;
create policy post_poll_options_insert on public.post_poll_options for insert with check (
  exists (select 1 from posts p where p.id = post_id and p.user_id = auth.uid())
);
drop policy if exists post_poll_votes_read on public.post_poll_votes;
create policy post_poll_votes_read on public.post_poll_votes for select using (auth.uid() is not null);
drop policy if exists post_poll_votes_insert on public.post_poll_votes;
create policy post_poll_votes_insert on public.post_poll_votes for insert with check (
  voter_id = auth.uid() and exists (select 1 from post_polls pl where pl.post_id = post_poll_votes.post_id and now() < pl.ends_at)
);
create or replace function public.get_poll(p_post_id uuid)
returns table (option_id uuid, label text, votes int, viewer_vote uuid, ends_at timestamptz, total int)
language sql stable security invoker set search_path = public
as $fn$
select o.id, o.label,
  (select count(*)::int from post_poll_votes v where v.option_id = o.id),
  (select mv.option_id from post_poll_votes mv where mv.post_id = p_post_id and mv.voter_id = auth.uid()),
  pl.ends_at,
  (select count(*)::int from post_poll_votes v2 where v2.post_id = p_post_id)
from post_poll_options o
join post_polls pl on pl.post_id = o.post_id
where o.post_id = p_post_id
order by o.sort_order;
$fn$;
create or replace function public.vote_poll(p_post_id uuid, p_option_id uuid)
returns void language sql security invoker set search_path = public
as $fn$
insert into post_poll_votes (post_id, option_id, voter_id)
values (p_post_id, p_option_id, auth.uid());
$fn$;

-- 0132 pinned posts
alter table public.profiles add column if not exists pinned_post_id uuid references public.posts(id) on delete set null;

-- 0133 post categories
alter table public.posts add column if not exists category text;

-- 0134 author muting
create table if not exists public.muted_authors (
  user_id uuid not null references public.profiles(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, author_id)
);
alter table public.muted_authors enable row level security;
drop policy if exists muted_authors_own on public.muted_authors;
create policy muted_authors_own on public.muted_authors
for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 0135 market alerts
create table if not exists public.market_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  query text not null check (char_length(query) between 2 and 80),
  max_price numeric,
  city text,
  created_at timestamptz not null default now()
);
alter table public.market_alerts enable row level security;
drop policy if exists market_alerts_own on public.market_alerts;
create policy market_alerts_own on public.market_alerts
for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create or replace function public.notify_market_alerts()
returns trigger language plpgsql security definer set search_path = public
as $fn$
begin
  insert into notifications (recipient_id, actor_id, type, message, data)
  select a.user_id, new.seller_id, 'market_alert',
         'listed a match for your alert',
         jsonb_build_object('listing_id', new.id, 'alert_id', a.id, 'query', a.query, 'title', new.title)
  from market_alerts a
  where a.user_id <> new.seller_id
    and (new.title ilike '%' || a.query || '%' or coalesce(new.description, '') ilike '%' || a.query || '%')
    and (a.max_price is null or new.price is null or new.price <= a.max_price)
    and (a.city is null or coalesce(new.location_city, '') ilike '%' || a.city || '%')
  on conflict do nothing;
  return new;
end;
$fn$;
drop trigger if exists trg_notify_market_alerts on public.marketplace_listings;
create trigger trg_notify_market_alerts
after insert on public.marketplace_listings
for each row execute function public.notify_market_alerts();

-- 0136 bookmark folders
create table if not exists public.bookmark_collections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  created_at timestamptz not null default now(),
  unique (user_id, name)
);
alter table public.bookmark_collections enable row level security;
drop policy if exists bookmark_collections_own on public.bookmark_collections;
create policy bookmark_collections_own on public.bookmark_collections
for all using (user_id = auth.uid()) with check (user_id = auth.uid());
alter table public.post_bookmarks add column if not exists collection_id uuid references public.bookmark_collections(id) on delete set null;

-- FINAL get_profile_posts (0132 state)
drop function if exists public.get_profile_posts(uuid, timestamptz, integer);
create or replace function public.get_profile_posts(
  p_profile_id uuid, p_cursor timestamptz default null, p_limit int default 20
)
returns table (
  post_id uuid, content text, body text, media_url text, media jsonb, products jsonb,
  channel text, article_title text, read_minutes int, created_at timestamptz,
  likes_count int, comments_count int, reposts_count int, bookmarks_count int, views_count int,
  viewer_liked boolean, viewer_bookmarked boolean, viewer_reposted boolean, is_pinned boolean
)
language sql stable set search_path = public
as $fn$
with viewer as (select auth.uid() as uid),
allowed as (
  select ((select uid from viewer) = p_profile_id)
      or coalesce(pr.profile_visibility, 'public') <> 'private'
      or exists (select 1 from follows f
                 where f.follower_id = (select uid from viewer)
                   and f.following_id = p_profile_id) as ok
  from profiles pr where pr.id = p_profile_id
),
pin as (select pinned_post_id from profiles where id = p_profile_id)
select p.id, p.content, p.body, p.media_url,
  coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'url', m.url,
      'media_type', m.media_type, 'width', m.width, 'height', m.height,
      'alt_text', m.alt_text, 'is_sensitive', m.is_sensitive,
      'sort_order', m.sort_order) order by m.sort_order nulls last)
    from post_media m where m.post_id = p.id), '[]'::jsonb),
  coalesce((select jsonb_agg(jsonb_build_object(
      'id', pp.id, 'title', pp.title, 'subtitle', pp.subtitle, 'price', pp.price,
      'currency', pp.currency, 'image_url', pp.image_url, 'listing_id', pp.listing_id,
      'link_url', pp.link_url, 'cta_label', pp.cta_label, 'sort_order', pp.sort_order,
      'listing_status', ml.status)
      order by pp.sort_order)
    from post_products pp
    left join marketplace_listings ml on ml.id = pp.listing_id
    where pp.post_id = p.id), '[]'::jsonb),
  p.channel, p.article_title, p.read_minutes, p.created_at,
  p.likes_count, p.comments_count, p.reposts_count, p.bookmarks_count, p.views_count,
  (lk.user_id is not null), (bk.user_id is not null), (rp.user_id is not null),
  (p.id = (select pinned_post_id from pin))
from posts p
left join post_likes lk     on lk.post_id = p.id and lk.user_id = (select uid from viewer)
left join post_bookmarks bk on bk.post_id = p.id and bk.user_id = (select uid from viewer)
left join post_reposts rp   on rp.post_id = p.id and rp.user_id = (select uid from viewer)
where p.user_id = p_profile_id
  and (select ok from allowed)
  and not exists (select 1 from blocked_users b
                  where (b.blocker_id = (select uid from viewer) and b.blocked_id = p.user_id)
                     or (b.blocker_id = p.user_id and b.blocked_id = (select uid from viewer)))
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
  and (p_cursor is null or p.created_at < p_cursor)
order by (case when p_cursor is null and p.id = (select pinned_post_id from pin) then 0 else 1 end),
         p.created_at desc
limit least(coalesce(p_limit, 20), 50);
$fn$;

-- FINAL get_feed (0134 state): see 00000000000137 companion note; definition
-- captured verbatim from the live database at consolidation time is identical
-- to the 0134 editor run recorded in the project transcripts.