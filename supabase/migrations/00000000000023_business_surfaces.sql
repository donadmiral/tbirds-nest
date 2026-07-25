-- 0023_business_surfaces.sql
-- Reads for the business profile's Products and Reviews tabs, plus writing a
-- review.
--
-- Note on the join: business_reviews.business_id references business_profiles.id,
-- the extension row's own id, not the business's profiles.id. Every caller here
-- takes the profile id and resolves it, so no screen has to know that.

-- ── catalogue: every product card the business has ever posted ─────────────
create or replace function public.get_business_products(
  p_business_id uuid,
  p_limit int default 60
)
returns table (
  product_id uuid, post_id uuid, title text, subtitle text,
  price numeric, currency text, image_url text,
  listing_id uuid, link_url text, cta_label text, posted_at timestamptz
)
language sql stable security invoker set search_path = public
as $fn$
  select pp.id, pp.post_id, pp.title, pp.subtitle, pp.price, pp.currency,
         pp.image_url, pp.listing_id, pp.link_url, pp.cta_label, p.created_at
  from post_products pp
  join posts p on p.id = pp.post_id
  where p.user_id = p_business_id
  order by p.created_at desc, pp.sort_order
  limit least(coalesce(p_limit, 60), 200);
$fn$;

grant execute on function public.get_business_products(uuid, int) to authenticated;

-- ── reviews, newest first, with the reviewer attached ─────────────────────
create or replace function public.get_business_reviews(
  p_business_id uuid,
  p_limit int default 30
)
returns table (
  review_id uuid, rating smallint, body text, created_at timestamptz,
  reviewer_id uuid, reviewer_name text, reviewer_username text, reviewer_avatar text,
  is_mine boolean
)
language sql stable security invoker set search_path = public
as $fn$
  select r.id, r.rating, r.body, r.created_at,
         pr.id, pr.full_name, pr.username, pr.avatar_url,
         (r.user_id = auth.uid())
  from business_reviews r
  join business_profiles b on b.id = r.business_id
  join profiles pr on pr.id = r.user_id
  where b.profile_id = p_business_id
  order by (r.user_id = auth.uid()) desc, r.created_at desc
  limit least(coalesce(p_limit, 30), 100);
$fn$;

grant execute on function public.get_business_reviews(uuid, int) to authenticated;

-- ── write or replace your own review ──────────────────────────────────────
create or replace function public.set_business_review(
  p_business_id uuid,
  p_rating smallint,
  p_body text default null
) returns jsonb
language plpgsql security invoker set search_path = public
as $fn$
declare
  v_me uuid := auth.uid();
  v_bp uuid;
begin
  if v_me is null then raise exception 'Not authenticated'; end if;
  if p_rating < 1 or p_rating > 5 then raise exception 'Rating must be 1 to 5'; end if;

  -- Nobody reviews their own business. The rating is worthless otherwise.
  if is_business_member(p_business_id) then
    raise exception 'You cannot review a business you manage';
  end if;

  select id into v_bp from business_profiles where profile_id = p_business_id;
  if v_bp is null then raise exception 'That profile is not a business'; end if;

  insert into business_reviews (business_id, user_id, rating, body)
  values (v_bp, v_me, p_rating, nullif(trim(p_body), ''))
  on conflict (user_id, business_id) do update
    set rating = excluded.rating, body = excluded.body, updated_at = now();

  return jsonb_build_object(
    'rating', p_rating,
    'avg_rating', (select avg_rating from business_profiles where id = v_bp),
    'review_count', (select review_count from business_profiles where id = v_bp));
end;
$fn$;

grant execute on function public.set_business_review(uuid, smallint, text) to authenticated;

create or replace function public.delete_business_review(p_business_id uuid)
returns void
language plpgsql security invoker set search_path = public
as $fn$
declare v_bp uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select id into v_bp from business_profiles where profile_id = p_business_id;
  if v_bp is null then return; end if;
  delete from business_reviews where business_id = v_bp and user_id = auth.uid();
end;
$fn$;

grant execute on function public.delete_business_review(uuid) to authenticated;