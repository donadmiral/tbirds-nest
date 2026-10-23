-- Marketplace orders are separate from transfers. Only a verified Chat Pay receipt
-- can turn a reserved order into a paid order; no escrow or delivery carrier is implied.
create schema if not exists marketplace_ops;
revoke all on schema marketplace_ops from public, anon, authenticated, service_role;
alter default privileges in schema marketplace_ops revoke all on tables from public, anon, authenticated, service_role;
alter default privileges in schema marketplace_ops revoke execute on functions from public;

alter table public.marketplace_listings add column if not exists stock_quantity integer not null default 1 check (stock_quantity >= 0);
create table marketplace_ops.orders (
  id uuid primary key default gen_random_uuid(), request_key uuid not null,
  buyer_id uuid not null references public.profiles(id), seller_id uuid not null references public.profiles(id),
  listing_id uuid not null references public.marketplace_listings(id),
  conversation_id uuid references public.conversations(id),
  title text not null, image_url text, quantity integer not null check (quantity between 1 and 100),
  unit_minor bigint not null check (unit_minor > 0), delivery_minor bigint not null check (delivery_minor >= 0),
  total_minor bigint not null check (total_minor > 0), currency text not null check (currency in ('USD','ZWG')),
  fulfilment text not null check (fulfilment in ('pickup','delivery')), instructions text not null default '',
  status text not null default 'requested' check (status in ('requested','awaiting_payment','paid','ready','in_transit','completed','cancelled','declined','return_requested','return_approved','returned','disputed')),
  reservation text not null default 'none' check (reservation in ('none','reserved','released','committed')),
  payment_id uuid references public.chat_payments(id) deferrable initially deferred,
  version integer not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  expires_at timestamptz, completed_at timestamptz,
  unique (buyer_id,request_key), check (buyer_id <> seller_id), check (total_minor=unit_minor*quantity+delivery_minor)
);
create index market_orders_buyer_page on marketplace_ops.orders(buyer_id,created_at desc,id desc);
create index market_orders_seller_page on marketplace_ops.orders(seller_id,created_at desc,id desc);
create index market_orders_listing on marketplace_ops.orders(listing_id,created_at desc,id desc);
create table marketplace_ops.events (
  id bigint generated always as identity primary key, order_id uuid not null references marketplace_ops.orders(id),
  actor_id uuid references public.profiles(id), kind text not null, note text not null default '', created_at timestamptz not null default now()
);
create index market_order_events on marketplace_ops.events(order_id,id);
alter table marketplace_ops.orders enable row level security;
alter table marketplace_ops.events enable row level security;
revoke all on all tables in schema marketplace_ops from public,anon,authenticated,service_role;
revoke all on all sequences in schema marketplace_ops from public,anon,authenticated,service_role;
alter table public.chat_payments add column if not exists order_id uuid references marketplace_ops.orders(id);
create index if not exists chat_payments_order on public.chat_payments(order_id) where order_id is not null;

create function marketplace_ops.as_json(o marketplace_ops.orders) returns jsonb language sql stable set search_path='' as $$
 select to_jsonb(o) || jsonb_build_object('unit_minor',o.unit_minor::text,'delivery_minor',o.delivery_minor::text,'total_minor',o.total_minor::text)
$$;

create function public.create_market_order(p_expected_user uuid, p_listing_id uuid, p_request_key uuid, p_quantity integer default 1, p_fulfilment text default 'pickup', p_instructions text default '')
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); l public.marketplace_listings; o marketplace_ops.orders; fee bigint;
begin
 if u is null then raise exception 'AUTH_REQUIRED'; end if;
 if u is distinct from p_expected_user then raise exception 'ACCOUNT_CHANGED'; end if;
 if p_request_key is null or p_quantity is null or p_quantity not between 1 and 100 or p_fulfilment is null or p_fulfilment not in ('pickup','delivery') or p_instructions is null or length(p_instructions)>1000 then raise exception 'INVALID_ORDER'; end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text||p_request_key::text,0));
 select * into o from marketplace_ops.orders where buyer_id=u and request_key=p_request_key;
 if found then
   if o.listing_id<>p_listing_id or o.quantity<>p_quantity or o.fulfilment<>p_fulfilment or o.instructions<>trim(p_instructions) then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
   return marketplace_ops.as_json(o);
 end if;
 perform marketplace_ops.release_expired(p_listing_id);
 select * into l from public.marketplace_listings where id=p_listing_id for share;
 if not found or l.status<>'available' or l.stock_quantity<p_quantity or l.price<=0 or l.currency not in ('USD','ZWG') then raise exception 'LISTING_UNAVAILABLE'; end if;
 if l.seller_id=u then raise exception 'CANNOT_BUY_OWN_LISTING'; end if;
 if exists(select 1 from public.blocked_users b where (b.blocker_id=u and b.blocked_id=l.seller_id) or (b.blocker_id=l.seller_id and b.blocked_id=u)) then raise exception 'ORDER_NOT_AVAILABLE'; end if;
 if p_fulfilment='delivery' and (not coalesce(l.delivery_available,false) or length(trim(p_instructions))<5) then raise exception 'DELIVERY_DETAILS_REQUIRED'; end if;
 fee:=case when p_fulfilment='delivery' then round(coalesce(l.delivery_fee,0)*100)::bigint else 0 end;
 if fee<0 or l.price*100<>trunc(l.price*100) then raise exception 'INVALID_LISTING_PRICE'; end if;
 insert into marketplace_ops.orders(request_key,buyer_id,seller_id,listing_id,title,image_url,quantity,unit_minor,delivery_minor,total_minor,currency,fulfilment,instructions)
 values(p_request_key,u,l.seller_id,l.id,l.title,l.images[1],p_quantity,(l.price*100)::bigint,fee,(l.price*100)::bigint*p_quantity+fee,l.currency,p_fulfilment,trim(p_instructions)) returning * into o;
 insert into marketplace_ops.events(order_id,actor_id,kind) values(o.id,u,'requested');
 return marketplace_ops.as_json(o);
end $$;

create function public.get_market_orders(p_role text default 'all',p_listing_id uuid default null,p_before timestamptz default null,p_before_id uuid default null,p_limit integer default 30)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u uuid:=auth.uid(); result jsonb; n integer:=least(greatest(coalesce(p_limit,30),1),100);
begin
 if u is null then raise exception 'AUTH_REQUIRED'; end if;
 if p_role is null or p_role not in ('all','buyer','seller') or (p_before is null)<>(p_before_id is null) then raise exception 'INVALID_CURSOR'; end if;
 with page as (
  select o.* from marketplace_ops.orders o where (o.buyer_id=u or o.seller_id=u)
   and (p_role='all' or (p_role='buyer' and o.buyer_id=u) or (p_role='seller' and o.seller_id=u))
   and (p_listing_id is null or o.listing_id=p_listing_id)
   and (p_before is null or (o.created_at,o.id)<(p_before,p_before_id)) order by o.created_at desc,o.id desc limit n+1
 ), shown as (select * from page order by created_at desc,id desc limit n)
 select jsonb_build_object('rows',coalesce((select jsonb_agg(marketplace_ops.as_json(s) order by s.created_at desc,s.id desc) from shown s),'[]'::jsonb),
   'has_more',(select count(*)>n from page), 'next_cursor',(select jsonb_build_object('created_at',created_at,'id',id) from shown order by created_at,id limit 1)) into result;
 return result;
end $$;

create function public.get_market_order(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u uuid:=auth.uid(); o marketplace_ops.orders;
begin
 if u is null then raise exception 'AUTH_REQUIRED'; end if;
 select * into o from marketplace_ops.orders where id=p_id and (buyer_id=u or seller_id=u);
 if not found then raise exception 'ORDER_NOT_FOUND'; end if;
 return marketplace_ops.as_json(o)||jsonb_build_object('events',coalesce((select jsonb_agg(to_jsonb(e) order by e.id) from marketplace_ops.events e where e.order_id=o.id),'[]'::jsonb));
end $$;

create function public.market_order_action(p_expected_user uuid,p_id uuid,p_version integer,p_action text,p_note text default '')
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); o marketplace_ops.orders; l public.marketplace_listings; next_status text; cid uuid;
begin
 if u is null then raise exception 'AUTH_REQUIRED'; end if;
 if u is distinct from p_expected_user then raise exception 'ACCOUNT_CHANGED'; end if;
 if p_note is null or length(p_note)>1000 then raise exception 'INVALID_NOTE'; end if;
 select * into o from marketplace_ops.orders where id=p_id and (buyer_id=u or seller_id=u) for update;
 if not found then raise exception 'ORDER_NOT_FOUND'; end if;
 if p_version is distinct from o.version then raise exception 'ORDER_CHANGED_REFRESH'; end if;
 if u=o.seller_id then perform public.studio_require(array['owner','admin','editor']); end if;
 if p_action='accept' and u=o.seller_id and o.status='requested' then
  perform marketplace_ops.release_expired(o.listing_id);
  select * into l from public.marketplace_listings where id=o.listing_id for update;
  if l.status<>'available' or l.stock_quantity<o.quantity then raise exception 'INSUFFICIENT_STOCK'; end if;
  if (l.price*100)::bigint<>o.unit_minor or l.currency<>o.currency or (o.fulfilment='delivery' and (not coalesce(l.delivery_available,false) or round(coalesce(l.delivery_fee,0)*100)::bigint<>o.delivery_minor)) then raise exception 'LISTING_CHANGED_REQUEST_NEW_ORDER'; end if;
  cid:=public.start_dm_ctx(o.buyer_id,'market',o.listing_id);
  update public.marketplace_listings set stock_quantity=stock_quantity-o.quantity where id=o.listing_id;
  o.reservation:='reserved'; o.expires_at:=now()+interval '24 hours'; o.conversation_id:=cid; next_status:='awaiting_payment';
 elsif p_action='decline' and u=o.seller_id and o.status='requested' then next_status:='declined';
 elsif p_action='cancel' and o.status in ('requested','awaiting_payment') then
  if o.payment_id is not null then raise exception 'PAYMENT_PENDING_CHECK_STATUS'; end if;
  next_status:='cancelled';
 elsif p_action='expire' and o.status='awaiting_payment' and o.expires_at<=now() then
  if o.payment_id is not null then raise exception 'PAYMENT_PENDING_CHECK_STATUS'; end if;
  next_status:='cancelled';
 elsif p_action='ready' and u=o.seller_id and o.status='paid' then next_status:='ready';
 elsif p_action='dispatch' and u=o.seller_id and o.fulfilment='delivery' and o.status='ready' then
  if length(trim(p_note))<5 then raise exception 'DELIVERY_REFERENCE_REQUIRED'; end if; next_status:='in_transit';
 elsif p_action='complete' and u=o.buyer_id and (o.status='in_transit' or (o.status='ready' and o.fulfilment='pickup')) then next_status:='completed'; o.completed_at:=now();
 elsif p_action='request_return' and u=o.buyer_id and o.status='completed' then
  if length(trim(p_note))<5 then raise exception 'REASON_REQUIRED'; end if; next_status:='return_requested';
 elsif p_action='approve_return' and u=o.seller_id and o.status='return_requested' then
  if length(trim(p_note))<5 then raise exception 'RETURN_INSTRUCTIONS_REQUIRED'; end if; next_status:='return_approved';
 elsif p_action='returned' and u=o.seller_id and o.status='return_approved' then next_status:='returned';
 elsif p_action='dispute' and o.status in ('paid','ready','in_transit','completed','return_requested','return_approved','returned') then
  if length(trim(p_note))<5 then raise exception 'REASON_REQUIRED'; end if; next_status:='disputed';
 else raise exception 'ACTION_NOT_ALLOWED'; end if;
 if next_status in ('cancelled','declined') and o.reservation='reserved' then
  update public.marketplace_listings set stock_quantity=stock_quantity+o.quantity where id=o.listing_id; o.reservation:='released';
 end if;
 update marketplace_ops.orders set status=next_status,reservation=o.reservation,expires_at=o.expires_at,conversation_id=o.conversation_id,completed_at=o.completed_at,version=version+1,updated_at=now() where id=o.id returning * into o;
 insert into marketplace_ops.events(order_id,actor_id,kind,note) values(o.id,u,p_action,trim(p_note));
 return marketplace_ops.as_json(o);
end $$;

-- The bridge uses service credentials. These triggers independently validate the
-- payment binding, close races between cancellation/payment, and protect snapshots.
create function marketplace_ops.bind_payment() returns trigger language plpgsql security definer set search_path='' as $$
declare o marketplace_ops.orders;
begin
 if tg_op='UPDATE' then
  if old.order_id is not null and (new.order_id,new.listing_id,new.sender_id,new.recipient_id,new.conversation_id,new.amount,new.currency) is distinct from (old.order_id,old.listing_id,old.sender_id,old.recipient_id,old.conversation_id,old.amount,old.currency) then raise exception 'ORDER_PAYMENT_IMMUTABLE'; end if;
  return new;
 end if;
 if new.listing_id is not null and new.order_id is null then raise exception 'MARKET_ORDER_REQUIRED'; end if;
 if new.order_id is null then return new; end if;
 select * into o from marketplace_ops.orders where id=new.order_id for update;
 if not found or o.buyer_id<>new.sender_id or o.seller_id<>new.recipient_id or o.listing_id is distinct from new.listing_id or o.conversation_id is distinct from new.conversation_id or o.currency<>new.currency or o.total_minor<>new.amount*100 then raise exception 'ORDER_PAYMENT_MISMATCH'; end if;
 if o.status<>'awaiting_payment' or o.reservation<>'reserved' or o.payment_id is not null or o.expires_at<=now() or new.status<>'pending' then raise exception 'ORDER_NOT_PAYABLE'; end if;
 update marketplace_ops.orders set payment_id=new.id,version=version+1,updated_at=now() where id=o.id;
 insert into marketplace_ops.events(order_id,actor_id,kind) values(o.id,new.sender_id,'payment_pending');
 return new;
end $$;
create trigger market_bind_payment before insert or update on public.chat_payments for each row execute function marketplace_ops.bind_payment();
create function marketplace_ops.apply_payment_receipt() returns trigger language plpgsql security definer set search_path='' as $$
declare o marketplace_ops.orders;
begin
 if new.order_id is null or new.status is not distinct from old.status then return new; end if;
 select * into o from marketplace_ops.orders where id=new.order_id for update;
 if o.payment_id is distinct from new.id then raise exception 'ORDER_PAYMENT_MISMATCH'; end if;
 if old.status<>'pending' then raise exception 'FINAL_ORDER_PAYMENT_IMMUTABLE'; end if;
 if new.status='completed' then
  if nullif(new.tx_id,'') is null then raise exception 'PAYMENT_RECEIPT_REQUIRED'; end if;
  update marketplace_ops.orders set status='paid',reservation='committed',version=version+1,updated_at=now() where id=o.id;
  insert into marketplace_ops.events(order_id,kind) values(o.id,'payment_completed');
 elsif new.status='failed' then
  update marketplace_ops.orders set payment_id=null,version=version+1,updated_at=now() where id=o.id;
  insert into marketplace_ops.events(order_id,kind) values(o.id,'payment_failed');
 end if;
 return new;
end $$;
create trigger market_apply_payment_receipt after update on public.chat_payments for each row execute function marketplace_ops.apply_payment_receipt();

create function public.get_market_checkout(p_listing_id uuid,p_seller_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u uuid:=auth.uid(); o marketplace_ops.orders; n integer;
begin
 if u is null then raise exception 'AUTH_REQUIRED'; end if;
 select count(*) into n from marketplace_ops.orders where buyer_id=u and seller_id=p_seller_id and listing_id=p_listing_id and status='awaiting_payment' and (expires_at>now() or payment_id is not null);
 if n<>1 then raise exception 'OPEN_ORDER_FROM_MARKETPLACE'; end if;
 select * into o from marketplace_ops.orders where buyer_id=u and seller_id=p_seller_id and listing_id=p_listing_id and status='awaiting_payment' and (expires_at>now() or payment_id is not null);
 return marketplace_ops.as_json(o);
end $$;

revoke all on function marketplace_ops.as_json(marketplace_ops.orders),marketplace_ops.bind_payment(),marketplace_ops.apply_payment_receipt() from public,anon,authenticated,service_role;
revoke all on function public.create_market_order(uuid,uuid,uuid,integer,text,text),public.get_market_orders(text,uuid,timestamptz,uuid,integer),public.get_market_order(uuid),public.market_order_action(uuid,uuid,integer,text,text),public.get_market_checkout(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.create_market_order(uuid,uuid,uuid,integer,text,text),public.get_market_orders(text,uuid,timestamptz,uuid,integer),public.get_market_order(uuid),public.market_order_action(uuid,uuid,integer,text,text),public.get_market_checkout(uuid,uuid) to authenticated;

create function marketplace_ops.release_expired(p_listing_id uuid) returns integer language plpgsql security definer set search_path='' as $$
declare o marketplace_ops.orders; n integer:=0;
begin
 for o in select * from marketplace_ops.orders where listing_id=p_listing_id and status='awaiting_payment' and reservation='reserved' and payment_id is null and expires_at<=now() order by id for update skip locked loop
  update marketplace_ops.orders set status='cancelled',reservation='released',version=version+1,updated_at=now() where id=o.id;
  update public.marketplace_listings set stock_quantity=stock_quantity+o.quantity where id=o.listing_id;
  insert into marketplace_ops.events(order_id,kind,note) values(o.id,'expired','Unpaid reservation expired'); n:=n+1;
 end loop;
 return n;
end $$;
revoke all on function marketplace_ops.release_expired(uuid) from public,anon,authenticated,service_role;

-- Called only by the admin server, after its staff-session authorization gate.
create function public.admin_market_orders(p_status text default 'disputed',p_before timestamptz default null,p_before_id uuid default null,p_limit integer default 30)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; n integer:=least(greatest(coalesce(p_limit,30),1),100);
begin
 if (p_before is null)<>(p_before_id is null) then raise exception 'INVALID_CURSOR'; end if;
 with page as (select o.* from marketplace_ops.orders o where (p_status='all' or o.status=p_status) and (p_before is null or (o.created_at,o.id)<(p_before,p_before_id)) order by o.created_at desc,o.id desc limit n+1),shown as(select * from page order by created_at desc,id desc limit n)
 select jsonb_build_object('rows',coalesce((select jsonb_agg(marketplace_ops.as_json(o)||jsonb_build_object('buyer_name',b.full_name,'seller_name',s.full_name) order by o.created_at desc,o.id desc) from shown o left join public.profiles b on b.id=o.buyer_id left join public.profiles s on s.id=o.seller_id),'[]'::jsonb),'has_more',(select count(*)>n from page),'next_cursor',(select jsonb_build_object('created_at',created_at,'id',id) from shown order by created_at,id limit 1)) into result;
 return result;
end $$;
create function public.admin_market_order_detail(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare o marketplace_ops.orders;
begin
 select * into o from marketplace_ops.orders where id=p_id;
 if not found then raise exception 'ORDER_NOT_FOUND'; end if;
 return marketplace_ops.as_json(o)||jsonb_build_object('events',coalesce((select jsonb_agg(to_jsonb(e) order by e.id) from marketplace_ops.events e where e.order_id=o.id),'[]'::jsonb),'payment',(select jsonb_build_object('id',p.id,'status',p.status,'tx_id',p.tx_id,'amount',p.amount::text,'currency',p.currency) from public.chat_payments p where p.id=o.payment_id));
end $$;
revoke all on function public.admin_market_orders(text,timestamptz,uuid,integer),public.admin_market_order_detail(uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_market_orders(text,timestamptz,uuid,integer),public.admin_market_order_detail(uuid) to service_role;

create function marketplace_ops.notify_event() returns trigger language plpgsql security definer set search_path='' as $$
declare o marketplace_ops.orders; recipient uuid;
begin
 select * into o from marketplace_ops.orders where id=new.order_id;
 if new.kind='payment_pending' then return new; end if;
 foreach recipient in array array[o.buyer_id,o.seller_id] loop
  if recipient is distinct from new.actor_id then
   insert into public.notifications(recipient_id,actor_id,type,message,data)
   values(recipient,new.actor_id,'market_order',o.title||': '||replace(new.kind,'_',' '),jsonb_build_object('listing_id',o.listing_id,'order_id',o.id,'event',new.kind));
  end if;
 end loop;
 return new;
end $$;
revoke all on function marketplace_ops.notify_event() from public,anon,authenticated,service_role;
create trigger market_order_event_notify after insert on marketplace_ops.events for each row execute function marketplace_ops.notify_event();
