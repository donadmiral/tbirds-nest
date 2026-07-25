-- 0014_post_products.sql
-- Product cards attached to a post, rendered as a horizontal carousel.
-- Structured exactly like post_media: ordered rows belonging to a post, so
-- likes, comments, reach, insights and trending all work on a product post
-- with no new code.
--
-- A card points at either an internal marketplace listing or an external URL.
-- The internal path is the one X cannot copy: the product opens in-app with the
-- seller's rating attached and IntoBank payment available in chat.
--
-- Deliberately NOT restricted to business accounts. A market seller
-- carouselling their own listings is a legitimate use and makes this testable
-- before business logins exist.

create table if not exists public.post_products (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references public.posts(id) on delete cascade,
  sort_order  int  not null default 0,
  title       text not null,
  subtitle    text,
  price       numeric,
  currency    text default 'USD',
  image_url   text,
  listing_id  uuid references public.marketplace_listings(id) on delete set null,
  link_url    text,
  cta_label   text default 'View',
  created_at  timestamptz not null default now(),
  constraint post_products_currency_check check (currency in ('USD', 'ZWG')),
  constraint post_products_price_check check (price is null or price >= 0),
  -- a card must go somewhere
  constraint post_products_destination_check check (listing_id is not null or link_url is not null)
);

create index if not exists idx_post_products_post on public.post_products (post_id, sort_order);
create index if not exists idx_post_products_listing on public.post_products (listing_id) where listing_id is not null;

alter table public.post_products enable row level security;

drop policy if exists post_products_select on public.post_products;
create policy post_products_select on public.post_products
  for select to authenticated using (true);

drop policy if exists post_products_write_author on public.post_products;
create policy post_products_write_author on public.post_products
  for all to authenticated
  using (exists (select 1 from posts p where p.id = post_products.post_id and p.user_id = auth.uid()))
  with check (exists (select 1 from posts p where p.id = post_products.post_id and p.user_id = auth.uid()));

-- The compatibility view from 0007 has no remaining code references.
drop view if exists public.comment_likes;

/**
 * Replace a post's product cards in one call. The composer builds the array
 * client side and saves once, rather than inserting card by card and leaving a
 * half-saved post if the connection drops.
 */
create or replace function public.set_post_products(p_post_id uuid, p_products jsonb)
returns int
language plpgsql security invoker set search_path = public
as $fn$
declare
  v_me uuid := auth.uid();
  v_author uuid;
  v_count int;
begin
  if v_me is null then raise exception 'Not authenticated'; end if;
  select user_id into v_author from posts where id = p_post_id;
  if v_author is null then raise exception 'Post not found'; end if;
  if v_author <> v_me then raise exception 'Only the author can set products'; end if;

  delete from post_products where post_id = p_post_id;

  insert into post_products (post_id, sort_order, title, subtitle, price, currency,
                             image_url, listing_id, link_url, cta_label)
  select p_post_id,
         coalesce((elem->>'sort_order')::int, ord - 1),
         elem->>'title',
         nullif(elem->>'subtitle', ''),
         nullif(elem->>'price', '')::numeric,
         coalesce(nullif(elem->>'currency', ''), 'USD'),
         nullif(elem->>'image_url', ''),
         nullif(elem->>'listing_id', '')::uuid,
         nullif(elem->>'link_url', ''),
         coalesce(nullif(elem->>'cta_label', ''), 'View')
  from jsonb_array_elements(coalesce(p_products, '[]'::jsonb)) with ordinality as t(elem, ord);

  select count(*) into v_count from post_products where post_id = p_post_id;
  return v_count;
end;
$fn$;

grant execute on function public.set_post_products(uuid, jsonb) to authenticated;

-- ── get_feed now carries product cards ──────────────────────────────────────
drop function if exists public.get_feed(text, double precision, uuid, int);

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