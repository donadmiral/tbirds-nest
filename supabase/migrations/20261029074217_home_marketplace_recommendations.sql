-- Home uses one compact recommendation shelf instead of individual listing posts.
-- Depends on verified order reviews and the existing marketplace order lifecycle.
begin;

create index if not exists marketplace_home_available
 on public.marketplace_listings(updated_at desc,id desc)
 where status='available' and hidden_at is null and stock_quantity>0;
create index if not exists marketplace_completed_seller
 on marketplace_ops.orders(seller_id,completed_at desc)
 where completed_at is not null and reservation='committed';

create or replace function public.home_marketplace_recommendations(p_limit integer default 8)
returns table(id uuid,title text,price numeric,currency text,image_url text,location_city text,
 seller_id uuid,seller_name text,seller_verified boolean,rating numeric,review_count integer,completed_sales integer)
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
 return query
 with eligible as materialized (
  select l.*,p.full_name,p.username,coalesce(p.is_verified,false) verified
  from public.marketplace_listings l join public.profiles p on p.id=l.seller_id
  where l.status='available' and l.hidden_at is null and l.stock_quantity>0
   and p.deactivated_at is null and (p.restricted_until is null or p.restricted_until<=now())
   and l.seller_id<>auth.uid() and l.price>=0
   and coalesce(l.images[1],'') like 'https://%'
   and not exists(select 1 from public.blocked_users b
    where (b.blocker_id=auth.uid() and b.blocked_id=l.seller_id)
       or (b.blocked_id=auth.uid() and b.blocker_id=l.seller_id))
   and not exists(select 1 from public.muted_authors m where m.user_id=auth.uid() and m.author_id=l.seller_id)
  order by l.updated_at desc,l.id desc limit 400
 ), sellers as materialized (
  select distinct e.seller_id from eligible e
 ), reputation as materialized (
  select s.seller_id,r.average,r.reviews,o.sales,
   (coalesce(r.total,0)+17.5)/(r.reviews+5.0) weighted_rating
  from sellers s
  cross join lateral (select round(avg(r.rating)::numeric,2) average,count(*)::integer reviews,
    sum(r.rating)::numeric total from public.seller_reviews r
    where r.seller_id=s.seller_id and r.order_id is not null and r.moderation_status='visible') r
  cross join lateral (select count(*)::integer sales from marketplace_ops.orders o
    where o.seller_id=s.seller_id and o.completed_at is not null and o.reservation='committed') o
 ), ranked as (
  select e.*,r.average,r.reviews,r.sales,
   r.weighted_rating+case when e.verified then 0.15 else 0 end
      +least(ln(1+r.sales::numeric)*0.03,0.15) trust_score,
   row_number() over(partition by e.seller_id order by e.updated_at desc,e.id desc) seller_slot
  from eligible e join reputation r on r.seller_id=e.seller_id
 )
 select r.id,r.title,r.price,r.currency,r.images[1],r.location_city,r.seller_id,
  coalesce(nullif(r.full_name,''),nullif(r.username,''),'Seller'),r.verified,r.average,r.reviews,r.sales
 from ranked r where r.seller_slot<=2
 order by r.trust_score desc,r.reviews desc,r.updated_at desc,r.id desc
 limit least(greatest(coalesce(p_limit,8),1),12);
end $$;
revoke all on function public.home_marketplace_recommendations(integer) from public,anon;
grant execute on function public.home_marketplace_recommendations(integer) to authenticated;

-- Patch the existing visibility-aware feed without replacing its environment's
-- media, audience, block, mute, ranking or pagination contracts.
do $$
declare definition text; marker text:='where p.community_id is null';
 addition text:='where p.community_id is null
    and not exists (select 1 from public.post_products home_market_product
      where home_market_product.post_id=p.id and (home_market_product.listing_id is not null
        or home_market_product.link_url ~* ''^/market/[0-9a-f-]+([?#]|$)''))';
begin
 definition:=pg_get_functiondef('public.get_feed(text,double precision,uuid,integer)'::regprocedure);
 if position('home_market_product' in definition)=0 then
  if (length(definition)-length(replace(definition,marker,'')))/length(marker)<>1 then
   raise exception 'HOME_FEED_FILTER_REQUIRES_REVIEW';
  end if;
  execute replace(definition,marker,addition);
 end if;
end $$;
commit;
