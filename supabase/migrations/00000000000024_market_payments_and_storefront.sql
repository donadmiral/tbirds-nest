-- 0024_market_payments_and_storefront.sql
-- Three things Market needs: a payment that knows what it bought, delivery as an
-- option rather than an assumption, and a seller's listings reachable from their
-- profile.
--
-- Deliberately NOT built: escrow, held funds, order states, disputes. Payment
-- here is one trusted person paying another without leaving the app. Adding a
-- lifecycle later is a new table, not a rewrite of this one.

-- ── delivery, optional, collection by default ──────────────────────────────
alter table public.marketplace_listings
  add column if not exists delivery_available boolean not null default false,
  add column if not exists delivery_fee numeric,
  add column if not exists delivery_note text;

do $$
begin
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.marketplace_listings'::regclass
                   and conname = 'marketplace_listings_delivery_fee_check') then
    alter table public.marketplace_listings
      add constraint marketplace_listings_delivery_fee_check
      check (delivery_fee is null or delivery_fee >= 0);
  end if;
end $$;

-- ── a payment that knows what it was for ───────────────────────────────────
alter table public.chat_payments
  add column if not exists listing_id uuid references public.marketplace_listings(id) on delete set null;

create index if not exists idx_chat_payments_listing
  on public.chat_payments (listing_id) where listing_id is not null;

-- ── a seller's shop ────────────────────────────────────────────────────────
create or replace function public.get_seller_listings(
  p_seller_id uuid,
  p_cursor    timestamptz default null,
  p_limit     int default 20,
  p_include_sold boolean default false
)
returns table (
  listing_id uuid, title text, description text,
  price numeric, currency text, category text, condition text,
  location_city text, images text[], status text,
  delivery_available boolean, delivery_fee numeric,
  created_at timestamptz
)
language sql stable security invoker set search_path = public
as $fn$
  select l.id, l.title, l.description, l.price, l.currency, l.category, l.condition,
         l.location_city, l.images, l.status,
         l.delivery_available, l.delivery_fee, l.created_at
  from marketplace_listings l
  where l.seller_id = p_seller_id
    and (p_include_sold or l.status = 'available')
    and (p_cursor is null or l.created_at < p_cursor)
  order by l.created_at desc
  limit least(coalesce(p_limit, 20), 50);
$fn$;

grant execute on function public.get_seller_listings(uuid, timestamptz, int, boolean) to authenticated;

-- ── a Listings tab needs to know whether to appear ─────────────────────────
-- Return type unchanged (jsonb), so no drop needed.
create or replace function public.get_profile(p_profile_id uuid)
returns jsonb
language plpgsql stable security invoker set search_path = public
as $fn$
declare
  v_me uuid := auth.uid();
  v_row profiles;
  v_follows boolean;
  v_requested boolean;
  v_reach int;
  v_result jsonb;
begin
  select * into v_row from profiles where id = p_profile_id;
  if v_row.id is null then raise exception 'Profile not found'; end if;

  v_follows := exists (select 1 from follows
                       where follower_id = v_me and following_id = p_profile_id);
  v_requested := exists (select 1 from follow_requests
                         where requester_id = v_me and target_id = p_profile_id
                           and status = 'pending');

  if v_me = p_profile_id then
    select count(distinct s.user_id) into v_reach
    from post_seen s join posts p on p.id = s.post_id
    where p.user_id = p_profile_id;
  else
    v_reach := null;
  end if;

  select jsonb_build_object(
    'id', v_row.id,
    'full_name', v_row.full_name,
    'username', v_row.username,
    'avatar_url', v_row.avatar_url,
    'banner_url', v_row.banner_url,
    'bio', v_row.bio,
    'headline', v_row.headline,
    'workplace', v_row.workplace,
    'location', v_row.location,
    'email', v_row.email,
    'role', v_row.role,
    'degree_program', v_row.degree_program,
    'profile_visibility', coalesce(v_row.profile_visibility, 'public'),
    'account_type', coalesce(v_row.account_type, 'personal'),
    'is_verified', coalesce(v_row.is_verified, false),
    'joined_at', v_row.created_at,
    'created_at', v_row.created_at,
    'is_self', (v_me = p_profile_id),
    'viewer_follows', v_follows,
    'viewer_requested', v_requested,
    'can_view_content', (v_me = p_profile_id)
                          or coalesce(v_row.profile_visibility, 'public') <> 'private'
                          or v_follows,
    'counts', jsonb_build_object(
      'posts',     (select count(*) from posts   where user_id = p_profile_id),
      'followers', (select count(*) from follows where following_id = p_profile_id),
      'following', (select count(*) from follows where follower_id = p_profile_id),
      'reach',     v_reach,
      'media',     (select count(*) from posts p2
                     where p2.user_id = p_profile_id
                       and (p2.media_url is not null
                            or exists (select 1 from post_media m where m.post_id = p2.id))),
      'reposts',   (select count(*) from post_reposts   where user_id = p_profile_id),
      'saved',     (select count(*) from post_bookmarks where user_id = p_profile_id),
      'listings',  (select count(*) from marketplace_listings
                     where seller_id = p_profile_id and status = 'available')
    ),
    'seller_rating', (select jsonb_build_object(
                        'avg', round(coalesce(avg(rating), 0)::numeric, 1),
                        'count', count(*))
                      from seller_reviews where seller_id = p_profile_id),
    'business', case when coalesce(v_row.account_type, 'personal') = 'business' then (
      select jsonb_build_object(
        'category', b.category, 'address', b.address, 'phone', b.phone,
        'email', b.email, 'website', b.website, 'social_links', b.social_links,
        'hours', b.hours,
        'avg_rating', b.avg_rating, 'review_count', b.review_count,
        'is_verified', b.is_verified)
      from business_profiles b where b.profile_id = p_profile_id
    ) else null end,
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', pr.id, 'full_name', pr.full_name,
               'username', pr.username, 'avatar_url', pr.avatar_url, 'role', m.role))
      from business_members m
      join profiles pr on pr.id = m.member_id
      where m.business_id = p_profile_id), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$fn$;

grant execute on function public.get_profile(uuid) to authenticated;