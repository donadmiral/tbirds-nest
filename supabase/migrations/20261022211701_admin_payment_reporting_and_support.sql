begin;
set local lock_timeout='3s';
create index if not exists chat_payments_created_page_idx on public.chat_payments(created_at desc,id desc);
create index if not exists chat_payments_status_created_idx on public.chat_payments(status,created_at desc,id desc);
-- Only the verified staff server can execute this report. No financial writes.
create or replace function public.admin_payment_report(p_status text default 'all',p_query text default '',p_before timestamptz default null,p_before_id uuid default null,p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; size integer:=greatest(1,least(coalesce(p_limit,50),100)); q text:=trim(coalesce(p_query,''));
begin
 if length(q)>100 or p_status is null or p_status not in ('all','completed','failed','pending','processing','refunded','cancelled','marketplace','direct','in_flight') then raise exception 'INVALID_FILTER'; end if;
 if (p_before is null)<>(p_before_id is null) then raise exception 'INVALID_CURSOR'; end if;
 with selected as materialized (
  select c.id,c.sender_id,c.recipient_id,c.amount::text,c.currency,c.status,c.tx_id,c.note,c.error,c.listing_id,c.created_at,c.completed_at,
   a.full_name sender_name,a.username sender_username,a.avatar_url sender_avatar,
   b.full_name recipient_name,b.username recipient_username,b.avatar_url recipient_avatar
  from public.chat_payments c left join public.profiles a on a.id=c.sender_id left join public.profiles b on b.id=c.recipient_id
  where (p_status='all' or c.status=p_status or (p_status='marketplace' and c.listing_id is not null) or (p_status='direct' and c.listing_id is null) or (p_status='in_flight' and c.status in ('pending','processing')))
   and (q='' or strpos(lower(concat_ws(' ',c.id::text,c.tx_id,c.amount::text,a.full_name,a.username,b.full_name,b.username)),lower(q))>0)
   and (p_before is null or (c.created_at,c.id)<(p_before,p_before_id))
  order by c.created_at desc,c.id desc limit size+1
 ), visible as (select * from selected order by created_at desc,id desc limit size)
 select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(v) order by created_at desc,id desc) from visible v),'[]'),
  'has_more',(select count(*)>size from selected),'next_cursor',(select jsonb_build_object('created_at',created_at,'id',id) from visible order by created_at,id limit 1)) into result;
 return result;
end; $$;

create or replace function public.admin_payment_summary()
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
  'status_counts',(select coalesce(jsonb_object_agg(status,n),'{}') from (select status,count(*) n from public.chat_payments group by status) s),
  'completed_week',(select count(*) from public.chat_payments where status='completed' and coalesce(completed_at,created_at)>=now()-interval '7 days'),
  'failed_week',(select count(*) from public.chat_payments where status='failed' and created_at>=now()-interval '7 days'),
  'failed_previous_week',(select count(*) from public.chat_payments where status='failed' and created_at>=now()-interval '14 days' and created_at<now()-interval '7 days'),
  'volume_week',(select coalesce(jsonb_agg(jsonb_build_object('currency',currency,'amount',amount::text,'average',average::text)),'[]') from (select coalesce(nullif(upper(currency),''),'UNKNOWN') currency,sum(amount) amount,round(avg(amount),2) average from public.chat_payments where status='completed' and coalesce(completed_at,created_at)>=now()-interval '7 days' group by 1) v),
  'volume_all',(select coalesce(jsonb_agg(jsonb_build_object('currency',currency,'amount',amount::text)),'[]') from (select coalesce(nullif(upper(currency),''),'UNKNOWN') currency,sum(amount) amount from public.chat_payments where status='completed' group by 1) v),
  'days',(select coalesce(jsonb_agg(to_jsonb(d) order by day),'[]') from (select (created_at at time zone 'UTC')::date::text as day,count(*) filter(where status='completed') completed,count(*) filter(where status='failed') failed,count(*) filter(where status in ('pending','processing')) other from public.chat_payments where created_at>=(date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')-interval '29 days' group by 1) d),
  'top_recipients',(select coalesce(jsonb_agg(to_jsonb(r) order by total desc,id),'[]') from (select c.recipient_id id,p.full_name,p.username,count(*) total from public.chat_payments c left join public.profiles p on p.id=c.recipient_id where c.status='completed' group by c.recipient_id,p.full_name,p.username order by total desc,c.recipient_id limit 6) r)
 );
$$;
revoke all on function public.admin_payment_report(text,text,timestamptz,uuid,integer),public.admin_payment_summary() from public,anon,authenticated;
grant execute on function public.admin_payment_report(text,text,timestamptz,uuid,integer),public.admin_payment_summary() to service_role;
commit;
