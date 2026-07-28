-- 0070: Zimbabwe-suited market ranking. Same-city listings first (collection
-- dominates), then recency; available before sold; hidden and removed never.

create or replace function public.get_market_feed(
  p_category text default null,
  p_search text default null,
  p_city text default null,
  p_limit int default 30,
  p_offset int default 0
)
returns setof marketplace_listings
language sql stable security definer set search_path = public
as $fn$
  select l.*
  from marketplace_listings l
  where l.status = 'available'
    and l.hidden_at is null
    and (p_category is null or l.category = p_category)
    and (p_search is null or l.title ilike '%' || p_search || '%'
         or l.description ilike '%' || p_search || '%')
  order by
    (p_city is not null and l.location_city ilike p_city) desc,
    l.created_at desc
  limit p_limit offset p_offset;
$fn$;

grant execute on function public.get_market_feed(text, text, text, int, int) to authenticated;