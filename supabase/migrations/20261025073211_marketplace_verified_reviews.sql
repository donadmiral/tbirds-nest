-- Reviews are bound to a completed order. Legacy unbound reviews are retained
-- for staff inspection but never represented as verified purchases.
alter table public.seller_reviews add column if not exists order_id uuid references marketplace_ops.orders(id);
alter table public.seller_reviews add column if not exists content_version integer not null default 1 check(content_version>0);
alter table public.seller_reviews add column if not exists moderation_status text not null default 'visible' check (moderation_status in ('visible','hidden'));
alter table public.seller_reviews drop constraint if exists seller_reviews_seller_id_reviewer_id_listing_id_key;
create unique index if not exists seller_reviews_order_key on public.seller_reviews(order_id) where order_id is not null;
create index if not exists seller_reviews_visible_page on public.seller_reviews(seller_id,created_at desc,id desc) include(rating) where order_id is not null and moderation_status='visible';
alter table public.seller_reviews enable row level security;
drop policy if exists seller_reviews_read on public.seller_reviews;
drop policy if exists seller_reviews_write on public.seller_reviews;
create policy seller_reviews_verified_read on public.seller_reviews for select to authenticated using (order_id is not null and moderation_status='visible');
revoke insert,update,delete on public.seller_reviews from public,anon,authenticated,service_role;

-- Keep the report outcome when an account or its review is erased. The staff
-- queue can explicitly dismiss missing targets without restoring deleted data.
create table public.seller_review_reports (
 id uuid primary key default gen_random_uuid(), review_id uuid references public.seller_reviews(id) on delete set null,
 reporter_id uuid references public.profiles(id) on delete set null, reason text not null check(reason in ('fake','harassment','private_information','irrelevant','other')),
 detail text not null default '' check(length(detail)<=1000), status text not null default 'open' check(status in ('open','dismissed','hidden','restored')),
 resolved_by uuid references public.profiles(id) on delete set null, resolved_at timestamptz, created_at timestamptz not null default now(),
 review_version integer not null check(review_version>0),
 unique(review_id,reporter_id,review_version)
);
create index seller_review_reports_reporter on public.seller_review_reports(reporter_id) where reporter_id is not null;
create index seller_review_reports_resolver on public.seller_review_reports(resolved_by) where resolved_by is not null;
create index marketplace_review_eligible_orders on marketplace_ops.orders(buyer_id,seller_id,completed_at desc,id desc) where completed_at is not null and reservation='committed';
create index seller_review_reports_page on public.seller_review_reports(created_at desc,id desc);
create index seller_review_reports_open_page on public.seller_review_reports(status,created_at desc,id desc);
alter table public.seller_review_reports enable row level security;
revoke all on public.seller_review_reports from public,anon,authenticated,service_role;

create or replace function public.get_seller_rating(p_seller_id uuid)
returns table(avg_rating numeric,review_count integer,five integer,four integer,three integer,two integer,one integer)
language sql stable security invoker set search_path='' as $$
 select round(avg(rating)::numeric,2),count(*)::int,count(*) filter(where rating=5)::int,count(*) filter(where rating=4)::int,
 count(*) filter(where rating=3)::int,count(*) filter(where rating=2)::int,count(*) filter(where rating=1)::int
 from public.seller_reviews where seller_id=p_seller_id and order_id is not null and moderation_status='visible'
$$;

create function public.seller_review_page(p_seller_id uuid,p_listing_id uuid default null,p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 20)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; n integer:=least(greatest(coalesce(p_limit,20),1),50);
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
 if (p_before_at is null)<>(p_before_id is null) then raise exception 'INVALID_CURSOR'; end if;
 with page as (
  select r.id,r.order_id,r.rating,r.comment,r.created_at,r.reviewer_id,
   jsonb_build_object('id',p.id,'full_name',p.full_name,'avatar_url',p.avatar_url) reviewer
  from public.seller_reviews r left join public.profiles p on p.id=r.reviewer_id
  where r.seller_id=p_seller_id and r.order_id is not null and r.moderation_status='visible'
   and (p_before_at is null or (r.created_at,r.id)<(p_before_at,p_before_id))
  order by r.created_at desc,r.id desc limit n+1
 ), shown as(select * from page order by created_at desc,id desc limit n)
 select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(s) order by s.created_at desc,s.id desc) from shown s),'[]'::jsonb),
 'has_more',(select count(*)>n from page),'next_cursor',(select jsonb_build_object('created_at',created_at,'id',id) from shown order by created_at,id limit 1),
 'summary',(select jsonb_build_object('avg_rating',coalesce(round(avg(rating)::numeric,2),0),'review_count',count(*),'five',count(*) filter(where rating=5),'four',count(*) filter(where rating=4),'three',count(*) filter(where rating=3),'two',count(*) filter(where rating=2),'one',count(*) filter(where rating=1)) from public.seller_reviews where seller_id=p_seller_id and order_id is not null and moderation_status='visible'),
 'eligible_orders',coalesce((select jsonb_agg(to_jsonb(e)) from (
  select o.id,o.title,o.completed_at,r.rating,r.comment,r.moderation_status from marketplace_ops.orders o
  left join public.seller_reviews r on r.order_id=o.id
  where o.buyer_id=auth.uid() and o.seller_id=p_seller_id and o.completed_at is not null and o.reservation='committed'
   and (p_listing_id is null or o.listing_id=p_listing_id)
  order by o.completed_at desc,o.id desc limit 50
 ) e),'[]'::jsonb)) into result;
 return result;
end $$;

create function public.submit_seller_review(p_expected_user uuid,p_order_id uuid,p_rating integer,p_comment text default '')
returns uuid language plpgsql security definer set search_path='' as $$
declare o marketplace_ops.orders; r public.seller_reviews; rid uuid;
begin
 if auth.uid() is null or auth.uid() is distinct from p_expected_user then raise exception 'ACCOUNT_CHANGED'; end if;
 if p_rating is null or p_rating not between 1 and 5 or p_comment is null or length(p_comment)>2000 then raise exception 'INVALID_REVIEW'; end if;
 select * into o from marketplace_ops.orders where id=p_order_id for share;
 if not found or o.buyer_id<>auth.uid() or o.seller_id=auth.uid() or o.completed_at is null or o.reservation<>'committed' then raise exception 'COMPLETED_PURCHASE_REQUIRED'; end if;
 perform pg_advisory_xact_lock(hashtextextended('review:'||p_order_id::text,0));
 select * into r from public.seller_reviews where order_id=o.id for update;
 if found and r.moderation_status='hidden' then raise exception 'REVIEW_UNDER_MODERATION'; end if;
 insert into public.seller_reviews(order_id,seller_id,reviewer_id,listing_id,rating,comment)
 values(o.id,o.seller_id,auth.uid(),o.listing_id,p_rating,nullif(btrim(p_comment),''))
 on conflict(order_id) where order_id is not null do update set rating=excluded.rating,comment=excluded.comment,
 content_version=public.seller_reviews.content_version+case when (public.seller_reviews.rating,public.seller_reviews.comment) is distinct from (excluded.rating,excluded.comment) then 1 else 0 end,
 updated_at=case when (public.seller_reviews.rating,public.seller_reviews.comment) is distinct from (excluded.rating,excluded.comment) then now() else public.seller_reviews.updated_at end
 returning id into rid;
 return rid;
end $$;

create function public.report_seller_review(p_expected_user uuid,p_review_id uuid,p_reason text,p_detail text default '')
returns uuid language plpgsql security definer set search_path='' as $$
declare rid uuid; version integer;
begin
 if auth.uid() is null or auth.uid() is distinct from p_expected_user then raise exception 'ACCOUNT_CHANGED'; end if;
 if p_reason is null or p_reason not in ('fake','harassment','private_information','irrelevant','other') or p_detail is null or length(p_detail)>1000 then raise exception 'INVALID_REPORT'; end if;
 select content_version into version from public.seller_reviews where id=p_review_id and reviewer_id<>auth.uid() and order_id is not null and moderation_status='visible' for share;
 if not found then raise exception 'REVIEW_UNAVAILABLE'; end if;
 insert into public.seller_review_reports(review_id,reporter_id,reason,detail,review_version) values(p_review_id,auth.uid(),p_reason,btrim(p_detail),version)
 on conflict(review_id,reporter_id,review_version) do nothing returning id into rid;
 if rid is null then select id into rid from public.seller_review_reports where review_id=p_review_id and reporter_id=auth.uid() and review_version=version; end if;
 return rid;
end $$;

-- Listing report content is caller-bound. Resolved reports cannot be rewritten
-- by the reporter into a fabricated moderation outcome.
revoke insert,update,delete on public.listing_reports from public,anon,authenticated;
create function public.report_market_listing(p_expected_user uuid,p_listing_id uuid,p_reason text,p_detail text default '')
returns uuid language plpgsql security definer set search_path='' as $$
declare rid uuid;
begin
 if auth.uid() is null or auth.uid() is distinct from p_expected_user then raise exception 'ACCOUNT_CHANGED'; end if;
 if p_reason is null or p_reason not in ('scam','prohibited','misleading','inappropriate','duplicate','other') or p_detail is null or length(p_detail)>1000 then raise exception 'INVALID_REPORT'; end if;
 if not exists(select 1 from public.marketplace_listings where id=p_listing_id and seller_id<>auth.uid() and status in ('available','sold','pending')) then raise exception 'LISTING_UNAVAILABLE'; end if;
 insert into public.listing_reports(listing_id,reporter_id,reason,detail) values(p_listing_id,auth.uid(),p_reason,nullif(btrim(p_detail),''))
 on conflict(listing_id,reporter_id) do nothing returning id into rid;
 if rid is null then select id into rid from public.listing_reports where listing_id=p_listing_id and reporter_id=auth.uid(); end if;
 return rid;
end $$;

create function public.admin_seller_review_reports(p_actor_id uuid,p_session_id uuid,p_before_at timestamptz default null,p_before_id uuid default null,p_status text default 'open')
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 perform admin_ops.require_session(p_actor_id,p_session_id,'report_listing');
 if p_status is null or p_status not in ('open','all') then raise exception 'INVALID_STATUS'; end if;
 if (p_before_at is null)<>(p_before_id is null) then raise exception 'INVALID_CURSOR'; end if;
 with page as(
 select t.*,r.seller_id,r.reviewer_id,r.rating,r.comment,r.moderation_status,r.order_id,r.content_version as current_version
 from public.seller_review_reports t left join public.seller_reviews r on r.id=t.review_id
 where (p_status='all' or t.status='open') and (p_before_at is null or (t.created_at,t.id)<(p_before_at,p_before_id)) order by t.created_at desc,t.id desc limit 51
 ), shown as(select * from page order by created_at desc,id desc limit 50)
 select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(s) order by created_at desc,id desc) from shown s),'[]'::jsonb),
 'has_more',(select count(*)>50 from page),'next_cursor',(select jsonb_build_object('created_at',created_at,'id',id) from shown order by created_at,id limit 1)) into result;
 return result;
end $$;

create function public.moderate_seller_review(p_actor_id uuid,p_session_id uuid,p_key uuid,p_report_id uuid,p_action text,p_reason text,p_expected_version integer default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare t public.seller_review_reports; new_report public.seller_review_reports; old_review public.seller_reviews; new_review public.seller_reviews; c admin_ops.commands; payload jsonb; result jsonb;
begin
 perform admin_ops.require_session(p_actor_id,p_session_id,'report_listing');
 if p_key is null or p_action is null or p_action not in ('hide','dismiss','restore') or p_reason is null or length(btrim(p_reason))<3 or length(p_reason)>1000 then raise exception 'INVALID_MODERATION'; end if;
 payload:=jsonb_build_object('report_id',p_report_id,'action',p_action,'reason',btrim(p_reason),'version',p_expected_version);
 perform pg_advisory_xact_lock(hashtextextended(p_key::text,0));
 select * into c from admin_ops.commands where command_key=p_key;
 if found then
  if c.actor_id<>p_actor_id or c.operation<>'moderate_seller_review' or c.payload<>payload then raise exception 'COMMAND_KEY_REUSED'; end if;
  return c.result;
 end if;
 select * into t from public.seller_review_reports where id=p_report_id for update;
 if not found then raise exception 'REPORT_NOT_FOUND'; end if;
 select * into old_review from public.seller_reviews where id=t.review_id for update;
 if not found and p_action<>'dismiss' then raise exception 'REVIEW_UNAVAILABLE'; end if;
 if p_action<>'dismiss' and p_expected_version is distinct from old_review.content_version then raise exception 'REVIEW_CHANGED_REFRESH'; end if;
 if p_action in ('hide','dismiss') and t.status<>'open' then raise exception 'REPORT_ALREADY_RESOLVED'; end if;
 if p_action='restore' and old_review.moderation_status<>'hidden' then raise exception 'REVIEW_NOT_HIDDEN'; end if;
 if p_action<>'dismiss' then update public.seller_reviews set moderation_status=case when p_action='hide' then 'hidden' else 'visible' end,updated_at=now() where id=t.review_id; end if;
 select * into new_review from public.seller_reviews where id=t.review_id;
 update public.seller_review_reports set status=case p_action when 'hide' then 'hidden' when 'restore' then 'restored' else 'dismissed' end,resolved_by=p_actor_id,resolved_at=now() where id=t.id returning * into new_report;
 insert into public.admin_audit_log(admin_id,action,target_kind,target_id,reason,before,after)
 values(p_actor_id,'seller_review_'||p_action,'seller_review_report',t.id::text,btrim(p_reason),jsonb_build_object('report',to_jsonb(t),'review',to_jsonb(old_review)),jsonb_build_object('report',to_jsonb(new_report),'review',to_jsonb(new_review)));
 result:=jsonb_build_object('success',true,'command_key',p_key);
 insert into admin_ops.commands(command_key,actor_id,operation,payload,result) values(p_key,p_actor_id,'moderate_seller_review',payload,result);
 return result;
end $$;
revoke all on function public.seller_review_page(uuid,uuid,timestamptz,uuid,integer),public.submit_seller_review(uuid,uuid,integer,text),public.report_seller_review(uuid,uuid,text,text),public.report_market_listing(uuid,uuid,text,text) from public,anon;
grant execute on function public.seller_review_page(uuid,uuid,timestamptz,uuid,integer),public.submit_seller_review(uuid,uuid,integer,text),public.report_seller_review(uuid,uuid,text,text),public.report_market_listing(uuid,uuid,text,text) to authenticated;
revoke all on function public.admin_seller_review_reports(uuid,uuid,timestamptz,uuid,text),public.moderate_seller_review(uuid,uuid,uuid,uuid,text,text,integer) from public,anon,authenticated;
grant execute on function public.admin_seller_review_reports(uuid,uuid,timestamptz,uuid,text),public.moderate_seller_review(uuid,uuid,uuid,uuid,text,text,integer) to service_role;
