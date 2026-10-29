create index if not exists chat_payments_recipient_cursor on public.chat_payments(recipient_id,created_at desc,id desc);
create index if not exists marketplace_catalog_cursor on public.marketplace_listings(seller_id,created_at desc,id desc);

-- Atomic publishing with retry identities. Product titles/prices/links are read
-- from the seller's catalog, never trusted from a promotion's client payload.
create table marketplace_ops.publishing_requests (
 actor_id uuid not null references public.profiles(id) on delete cascade, request_key uuid not null, payload jsonb not null,
 post_id uuid references public.posts(id) on delete set null, promotion_id uuid references public.promoted_posts(id) on delete set null,
 created_at timestamptz not null default now(), primary key(actor_id,request_key)
);
alter table marketplace_ops.publishing_requests enable row level security;
revoke all on marketplace_ops.publishing_requests from public,anon,authenticated,service_role;

create function public.publish_product_carousel(p_expected_user uuid,p_request_key uuid,p_listing_ids uuid[],p_caption text default '')
returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); old marketplace_ops.publishing_requests; body jsonb; pid uuid; l public.marketplace_listings; item record; n integer;
begin
 if u is null then raise exception 'AUTH_REQUIRED'; end if;
 if u is distinct from p_expected_user then raise exception 'ACCOUNT_CHANGED'; end if;
 perform public.studio_require(array['owner','admin','editor']);
 n:=coalesce(cardinality(p_listing_ids),0);
 if p_request_key is null or n not between 1 and 10 or p_caption is null or length(p_caption)>10000 or n<>(select count(distinct id) from unnest(p_listing_ids) id) then raise exception 'INVALID_CAROUSEL'; end if;
 body:=jsonb_build_object('kind','carousel','ids',p_listing_ids,'caption',trim(p_caption));
 perform pg_advisory_xact_lock(hashtextextended(u::text||p_request_key::text,0));
 select * into old from marketplace_ops.publishing_requests where actor_id=u and request_key=p_request_key;
 if found then if old.payload<>body then raise exception 'IDEMPOTENCY_CONFLICT'; end if; if old.post_id is null then raise exception 'PUBLISHED_CONTENT_REMOVED'; end if; return old.post_id; end if;
 insert into public.posts(user_id,content,audience,is_exclusive,channel) values(u,trim(p_caption),'everyone',false,null) returning id into pid;
 for item in select id,ord from unnest(p_listing_ids) with ordinality x(id,ord) loop
  select * into l from public.marketplace_listings where id=item.id and seller_id=u and status='available' and stock_quantity>0 for share;
  if not found then raise exception 'CATALOG_ITEM_UNAVAILABLE'; end if;
  insert into public.post_products(post_id,sort_order,title,price,currency,image_url,listing_id,cta_label)
  values(pid,item.ord-1,l.title,l.price,l.currency,l.images[1],l.id,'View listing');
 end loop;
 insert into marketplace_ops.publishing_requests(actor_id,request_key,payload,post_id) values(u,p_request_key,body,pid);
 return pid;
end $$;

create function public.create_promotion(p_expected_user uuid,p_request_key uuid,p_kind text,p_content_id uuid default null,p_text text default '',p_objective text default 'views',p_days integer default 7,p_total_cap integer default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); old marketplace_ops.publishing_requests; body jsonb; pid uuid; promo uuid; l public.marketplace_listings; j public.jobs;
begin
 if u is null then raise exception 'AUTH_REQUIRED'; end if;
 if u is distinct from p_expected_user then raise exception 'ACCOUNT_CHANGED'; end if;
 perform public.studio_require(array['owner','admin','editor']);
 if p_request_key is null or p_kind is null or p_kind not in ('post','listing','job','new') or p_text is null or length(p_text)>10000 or p_days is null or p_days not in (0,3,7,14) or p_objective is null or p_objective not in ('views','followers','website_visits','messages','market_sales','job_applications') or (p_total_cap is not null and p_total_cap<1) then raise exception 'INVALID_PROMOTION'; end if;
 body:=jsonb_build_object('kind',p_kind,'content_id',p_content_id,'text',trim(p_text),'objective',p_objective,'days',p_days,'cap',p_total_cap);
 perform pg_advisory_xact_lock(hashtextextended(u::text||p_request_key::text,0));
 select * into old from marketplace_ops.publishing_requests where actor_id=u and request_key=p_request_key;
 if found then if old.payload<>body then raise exception 'IDEMPOTENCY_CONFLICT'; end if; if old.promotion_id is null then raise exception 'PROMOTION_REMOVED'; end if; return old.promotion_id; end if;
 if p_kind='post' then
  select id into pid from public.posts where id=p_content_id and user_id=u and audience='everyone' and not coalesce(is_exclusive,false) for share;
  if pid is null then raise exception 'PUBLIC_OWNED_POST_REQUIRED'; end if;
 elsif p_kind='new' then
  if length(trim(p_text))=0 then raise exception 'POST_TEXT_REQUIRED'; end if;
  insert into public.posts(user_id,content,audience,is_exclusive,channel) values(u,trim(p_text),'everyone',false,null) returning id into pid;
 elsif p_kind='listing' then
  select * into l from public.marketplace_listings where id=p_content_id and seller_id=u and status='available' and stock_quantity>0 for share;
  if not found then raise exception 'CATALOG_ITEM_UNAVAILABLE'; end if;
  insert into public.posts(user_id,content,audience,is_exclusive,channel) values(u,l.title,'everyone',false,null) returning id into pid;
  insert into public.post_products(post_id,sort_order,title,price,currency,image_url,listing_id,cta_label) values(pid,0,l.title,l.price,l.currency,l.images[1],l.id,'View listing');
 else
  select * into j from public.jobs where id=p_content_id and posted_by=u and (deadline is null or deadline>now()) for share;
  if not found then raise exception 'OPEN_OWNED_JOB_REQUIRED'; end if;
  insert into public.posts(user_id,content,audience,is_exclusive,channel) values(u,'We are hiring: '||j.title||coalesce(' · '||j.location,'')||E'\n\nApply using the job card below.','everyone',false,null) returning id into pid;
  insert into public.post_products(post_id,sort_order,title,subtitle,link_url,cta_label) values(pid,0,j.title,j.company,'/jobs/'||j.id,'View job');
 end if;
 insert into public.promoted_posts(post_id,advertiser_id,label,objective,ends_at,total_cap) values(pid,u,'Sponsored',p_objective,case when p_days=0 then null else now()+make_interval(days=>p_days) end,p_total_cap) returning id into promo;
 insert into marketplace_ops.publishing_requests(actor_id,request_key,payload,post_id,promotion_id) values(u,p_request_key,body,pid,promo);
 return promo;
end $$;

-- Aggregate in Postgres instead of transferring up to thousands of individual
-- impressions. All events for these UTC days contribute, including high volumes.
create index if not exists ad_events_promo_created on public.ad_events(promo_id,created_at);
create function public.promo_daily_performance(p_expected_user uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u uuid:=auth.uid(); result jsonb; first_day date:=(now() at time zone 'UTC')::date-29;
begin
 if u is null then raise exception 'AUTH_REQUIRED'; end if;
 if u is distinct from p_expected_user then raise exception 'ACCOUNT_CHANGED'; end if;
 with events as (
 select (e.created_at at time zone 'UTC')::date as event_day,count(*) filter(where e.kind='impression') impressions,count(*) filter(where e.kind='click') clicks
 from public.ad_events e join public.promoted_posts p on p.id=e.promo_id where p.advertiser_id=u and e.created_at>=first_day::timestamp at time zone 'UTC' and e.created_at<=now() group by 1
 ), days as (select first_day+s as event_day from generate_series(0,29) s)
 select jsonb_agg(jsonb_build_object('day',d.event_day::text,'impressions',coalesce(e.impressions,0),'clicks',coalesce(e.clicks,0)) order by d.event_day) into result from days d left join events e using(event_day);
 return result;
end $$;

create function public.business_receipts(p_before timestamptz default null,p_before_id uuid default null,p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u uuid:=auth.uid(); n integer:=least(greatest(coalesce(p_limit,50),1),100); result jsonb;
begin
 if u is null then raise exception 'AUTH_REQUIRED'; end if;
 if (p_before is null)<>(p_before_id is null) then raise exception 'INVALID_CURSOR'; end if;
 with page as (
 select p.* from public.chat_payments p where p.recipient_id=u and (p_before is null or (p.created_at,p.id)<(p_before,p_before_id)) order by p.created_at desc,p.id desc limit n+1
 ), shown as (select * from page order by created_at desc,id desc limit n)
 select jsonb_build_object('rows',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'amount',p.amount::text,'amount_minor',(p.amount*100)::bigint::text,'currency',p.currency,'status',p.status,'note',p.note,'tx_id',p.tx_id,'created_at',p.created_at,'completed_at',p.completed_at,'conversation_id',p.conversation_id,'order_id',p.order_id,'payer_id',payer.id,'payer_name',payer.full_name,'payer_username',payer.username,'payer_avatar',payer.avatar_url,'listing_id',l.id,'listing_title',l.title,'listing_image',l.images[1]) order by p.created_at desc,p.id desc) from shown p left join public.profiles payer on payer.id=p.sender_id left join public.marketplace_listings l on l.id=p.listing_id),'[]'::jsonb),
 'has_more',(select count(*)>n from page),'next_cursor',(select jsonb_build_object('created_at',created_at,'id',id) from shown order by created_at,id limit 1)) into result;
 return result;
end $$;

create function public.business_catalog(p_before timestamptz default null,p_before_id uuid default null,p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u uuid:=auth.uid(); n integer:=least(greatest(coalesce(p_limit,50),1),100); result jsonb;
begin
 if u is null then raise exception 'AUTH_REQUIRED'; end if;
 if (p_before is null)<>(p_before_id is null) then raise exception 'INVALID_CURSOR'; end if;
 with page as (select l.* from public.marketplace_listings l where l.seller_id=u and l.status<>'removed' and (p_before is null or (l.created_at,l.id)<(p_before,p_before_id)) order by l.created_at desc,l.id desc limit n+1),shown as(select * from page order by created_at desc,id desc limit n)
 select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(l)||jsonb_build_object('price',l.price::text,'hidden',l.hidden_at is not null,'pending_offers',(select count(*) from public.listing_offers o where o.listing_id=l.id and o.status='pending' and o.proposer_id<>u),'sold_count',(select count(*) from public.chat_payments p where p.listing_id=l.id and p.recipient_id=u and p.status='completed'),'in_posts',(select count(*) from public.post_products pp where pp.listing_id=l.id)) order by l.created_at desc,l.id desc) from shown l),'[]'::jsonb), 'has_more',(select count(*)>n from page),'next_cursor',(select jsonb_build_object('created_at',created_at,'id',id) from shown order by created_at,id limit 1)) into result;
 return result;
end $$;

create function public.set_listing_stock(p_expected_user uuid,p_listing_id uuid,p_available integer,p_expected_available integer) returns integer language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); n integer;
begin
 if u is null then raise exception 'AUTH_REQUIRED'; end if;
 if u is distinct from p_expected_user then raise exception 'ACCOUNT_CHANGED'; end if;
 perform public.studio_require(array['owner','admin','editor']);
 if p_available is null or p_available not between 0 and 1000000 then raise exception 'INVALID_STOCK'; end if;
 update public.marketplace_listings set stock_quantity=p_available where id=p_listing_id and seller_id=u and stock_quantity=p_expected_available returning stock_quantity into n;
 if not found then raise exception 'LISTING_NOT_FOUND'; end if;
 return n;
end $$;

revoke all on function public.publish_product_carousel(uuid,uuid,uuid[],text),public.create_promotion(uuid,uuid,text,uuid,text,text,integer,integer),public.promo_daily_performance(uuid),public.business_receipts(timestamptz,uuid,integer),public.business_catalog(timestamptz,uuid,integer),public.set_listing_stock(uuid,uuid,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.publish_product_carousel(uuid,uuid,uuid[],text),public.create_promotion(uuid,uuid,text,uuid,text,text,integer,integer),public.promo_daily_performance(uuid),public.business_receipts(timestamptz,uuid,integer),public.business_catalog(timestamptz,uuid,integer),public.set_listing_stock(uuid,uuid,integer,integer) to authenticated;
