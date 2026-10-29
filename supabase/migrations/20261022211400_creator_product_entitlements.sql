-- Creator commerce contract. Test settlement only until an approved live
-- capture/refund adapter and applicable store billing are installed. No client
-- may declare a charge paid, mint an entitlement, or write an earning.
begin;
create or replace function creator_finance.require_user() returns uuid language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();
begin
  if uid is null or not exists(select 1 from auth.users where id=uid and deleted_at is null and (banned_until is null or banned_until<=now())) then raise exception 'AUTH_REQUIRED'; end if;
  return uid;
end $$;

create table creator_finance.commerce_config (
  singleton boolean primary key default true check(singleton),
  sandbox_enabled boolean not null default false,
  currency text not null default 'USD' check(currency='USD')
);
insert into creator_finance.commerce_config(singleton) values(true);
create table creator_finance.products (
  id uuid primary key default gen_random_uuid(), creator_id uuid not null references auth.users(id),
  kind text not null check(kind in ('subscription','tip','gift')),
  title text not null check(length(title) between 1 and 120),
  amount_minor bigint not null check(amount_minor between 1 and 1000000),
  currency text not null default 'USD' check(currency='USD'),
  period_days integer check(period_days between 1 and 366), active boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check((kind='subscription')=(period_days is not null))
);
create index creator_products_owner on creator_finance.products(creator_id,created_at desc,id desc);
create table creator_finance.orders (
  id uuid primary key default gen_random_uuid(), buyer_id uuid not null references auth.users(id),
  creator_id uuid not null references auth.users(id), product_id uuid not null references creator_finance.products(id),
  kind text not null check(kind in ('subscription','tip','gift')), title text not null,
  amount_minor bigint not null check(amount_minor>0), currency text not null check(currency='USD'), period_days integer,
  environment text not null check(environment='test'), idempotency_key uuid not null,
  state text not null default 'pending' check(state in ('pending','paid','partially_refunded','refunded','cancelled')),
  provider_reference text unique, refunded_minor bigint not null default 0 check(refunded_minor>=0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(buyer_id,idempotency_key), check(buyer_id<>creator_id), check(refunded_minor<=amount_minor)
);
create index creator_orders_buyer on creator_finance.orders(buyer_id,created_at desc,id desc);
create index creator_orders_creator on creator_finance.orders(creator_id,created_at desc,id desc);
create table creator_finance.commerce_receipts (
  provider_id text not null check(provider_id='intobank'), event_id text not null check(length(event_id) between 1 and 240),
  order_id uuid not null references creator_finance.orders(id), payload jsonb not null,
  created_at timestamptz not null default now(), primary key(provider_id,event_id)
);
create trigger immutable_commerce_receipts before update or delete on creator_finance.commerce_receipts for each row execute function creator_finance.immutable_record();
create table creator_finance.allocations (
  id uuid primary key default gen_random_uuid(), creator_id uuid not null references auth.users(id),
  source_ref text not null unique check(length(source_ref) between 1 and 240),
  kind text not null, policy_version text not null, currency text not null check(currency='USD'),
  gross_minor bigint not null check(gross_minor>0), deductions_minor bigint not null check(deductions_minor>=0),
  creator_minor bigint not null check(creator_minor>=0), platform_minor bigint not null check(platform_minor>=0),
  created_at timestamptz not null default now(),
  foreign key(policy_version,kind) references creator_finance.revenue_policies(version,kind),
  check(gross_minor=deductions_minor+creator_minor+platform_minor)
);
create trigger immutable_allocations before update or delete on creator_finance.allocations for each row execute function creator_finance.immutable_record();
-- A paid-out earning cannot be erased. Uncovered confirmed refunds become an
-- explicit receivable; new earnings offset it before becoming withdrawable.
create table creator_finance.receivables (
  creator_id uuid primary key references auth.users(id), amount_minor bigint not null default 0 check(amount_minor>=0)
);
create table creator_finance.receivable_events (
  id uuid primary key default gen_random_uuid(), creator_id uuid not null references auth.users(id),
  amount_minor bigint not null check(amount_minor<>0), evidence_ref text not null unique,
  created_at timestamptz not null default now()
);
create trigger immutable_receivable_events before update or delete on creator_finance.receivable_events for each row execute function creator_finance.immutable_record();
create table creator_finance.subscription_periods (
  order_id uuid primary key references creator_finance.orders(id), buyer_id uuid not null references auth.users(id),
  creator_id uuid not null references auth.users(id), starts_at timestamptz not null, ends_at timestamptz not null,
  revoked_at timestamptz, check(ends_at>starts_at)
);
create index creator_subscription_access on creator_finance.subscription_periods(buyer_id,creator_id,ends_at) where revoked_at is null;
-- Orders and paid grants must never move to a different environment.
create or replace function creator_finance.prevent_environment_change() returns trigger language plpgsql set search_path='' as $$
begin
  if new.environment<>old.environment and (exists(select 1 from creator_finance.ledger) or exists(select 1 from creator_finance.payouts) or exists(select 1 from creator_finance.orders)) then
    raise exception 'FINANCE_ENVIRONMENT_HAS_ACTIVITY';
  end if;
  return new;
end $$;
alter table creator_finance.commerce_config enable row level security;
alter table creator_finance.products enable row level security;
alter table creator_finance.orders enable row level security;
alter table creator_finance.commerce_receipts enable row level security;
alter table creator_finance.allocations enable row level security;
alter table creator_finance.receivables enable row level security;
alter table creator_finance.receivable_events enable row level security;
alter table creator_finance.subscription_periods enable row level security;
revoke all on creator_finance.commerce_config,creator_finance.products,creator_finance.orders,creator_finance.commerce_receipts,creator_finance.allocations,creator_finance.receivables,creator_finance.receivable_events,creator_finance.subscription_periods from public,anon,authenticated,service_role;

create function creator_finance.commerce_ready() returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from creator_finance.program p cross join creator_finance.commerce_config c where p.singleton and c.singleton and p.environment='test' and c.sandbox_enabled);
$$;
alter function creator_finance.request_payout(uuid,text,text,uuid) rename to request_payout_before_commerce;
create function creator_finance.request_payout(p_expected_user uuid,p_currency text,p_amount_minor text,p_idempotency_key uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare uid uuid:=creator_finance.require_user();
begin
  if uid is distinct from p_expected_user then raise exception 'ACCOUNT_CHANGED'; end if;
  perform 1 from creator_finance.enrollments where user_id=uid for update;
  if not exists(select 1 from creator_finance.payouts where user_id=uid and idempotency_key=p_idempotency_key)
    and exists(select 1 from creator_finance.receivables where creator_id=uid and amount_minor>0) then raise exception 'OUTSTANDING_REFUND_BALANCE'; end if;
  return creator_finance.request_payout_before_commerce(p_expected_user,p_currency,p_amount_minor,p_idempotency_key);
end $$;
create or replace function public.creator_request_payout(p_expected_user uuid,p_currency text,p_amount_minor text,p_idempotency_key uuid)
returns uuid language sql security invoker set search_path='' as $$select creator_finance.request_payout(p_expected_user,p_currency,p_amount_minor,p_idempotency_key);$$;
revoke all on function creator_finance.request_payout_before_commerce(uuid,text,text,uuid),creator_finance.request_payout(uuid,text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function creator_finance.request_payout(uuid,text,text,uuid) to authenticated;
create function public.creator_commerce_capabilities() returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('environment',p.environment,'provider','intobank','purchases_enabled',creator_finance.commerce_ready(),
    'recurring_enabled',false,'currency','USD','reason',case when creator_finance.commerce_ready() then 'sandbox_only' else 'provider_capture_not_enabled' end)
  from creator_finance.program p where p.singleton;
$$;
create function creator_finance.save_product(p_expected_user uuid,p_id uuid,p_kind text,p_title text,p_amount_minor text,p_period_days integer,p_active boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare uid uuid:=creator_finance.require_user(); result uuid;
begin
  if uid is distinct from p_expected_user then raise exception 'ACCOUNT_CHANGED'; end if;
  perform 1 from creator_finance.enrollments where user_id=uid and status='approved' for update;
  if not found then raise exception 'CREATOR_NOT_APPROVED'; end if;
  if p_id is null or p_kind is null or p_kind not in ('subscription','tip','gift') or nullif(trim(p_title),'') is null or length(p_title)>120
    or p_amount_minor is null or p_amount_minor !~ '^[1-9][0-9]{0,6}$' or p_amount_minor::bigint>1000000 or p_active is null
    or (p_kind='subscription' and (p_period_days is null or p_period_days not between 1 and 366)) or (p_kind<>'subscription' and p_period_days is not null) then raise exception 'INVALID_PRODUCT'; end if;
  if not exists(select 1 from creator_finance.products where id=p_id) and (select count(*) from creator_finance.products where creator_id=uid)>=100 then raise exception 'PRODUCT_LIMIT_REACHED'; end if;
  insert into creator_finance.products(id,creator_id,kind,title,amount_minor,period_days,active)
    values(p_id,uid,p_kind,trim(p_title),p_amount_minor::bigint,p_period_days,p_active)
    on conflict(id) do update set title=excluded.title,amount_minor=excluded.amount_minor,period_days=excluded.period_days,active=excluded.active,updated_at=now()
      where creator_finance.products.creator_id=uid and creator_finance.products.kind=excluded.kind returning id into result;
  if result is null then raise exception 'PRODUCT_NOT_OWNED_OR_KIND_CHANGED'; end if;
  return result;
end $$;
create function creator_finance.create_order(p_expected_user uuid,p_product uuid,p_expected_amount text,p_key uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare uid uuid:=creator_finance.require_user(); product creator_finance.products; prior creator_finance.orders; result uuid;
begin
  if uid is distinct from p_expected_user then raise exception 'ACCOUNT_CHANGED'; end if;
  if p_key is null or p_product is null then raise exception 'INVALID_ORDER'; end if;
  perform pg_advisory_xact_lock(hashtextextended(uid::text||p_key::text,0));
  select * into prior from creator_finance.orders where buyer_id=uid and idempotency_key=p_key;
  if found then
    if prior.product_id<>p_product or prior.amount_minor::text is distinct from p_expected_amount then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return prior.id;
  end if;
  if not creator_finance.commerce_ready() then raise exception 'PURCHASES_NOT_ENABLED'; end if;
  select * into product from creator_finance.products where id=p_product and active;
  if not found then raise exception 'PRODUCT_UNAVAILABLE'; end if;
  if product.creator_id=uid then raise exception 'SELF_PURCHASE_FORBIDDEN'; end if;
  perform 1 from creator_finance.enrollments e join auth.users u on u.id=e.user_id where e.user_id=product.creator_id and e.status='approved' and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now()) for share of e;
  if not found then raise exception 'CREATOR_NOT_APPROVED'; end if;
  select * into product from creator_finance.products where id=p_product and active for share;
  if not found then raise exception 'PRODUCT_UNAVAILABLE'; end if;
  if product.amount_minor::text is distinct from p_expected_amount then raise exception 'PRICE_CHANGED'; end if;
  insert into creator_finance.orders(buyer_id,creator_id,product_id,kind,title,amount_minor,currency,period_days,environment,idempotency_key)
    values(uid,product.creator_id,product.id,product.kind,product.title,product.amount_minor,product.currency,product.period_days,'test',p_key) returning id into result;
  return result;
end $$;

-- Internal trusted allocation. Service adapters cannot choose the creator share.
create function creator_finance.allocate_revenue(p_creator uuid,p_kind text,p_gross bigint,p_deductions bigint,p_source text)
returns uuid language plpgsql security definer set search_path='' as $$
declare policy creator_finance.revenue_policies; prior creator_finance.allocations; share bigint; allocation uuid; debt bigint; offset_minor bigint;
begin
  perform 1 from creator_finance.enrollments where user_id=p_creator for update;
  if not found then raise exception 'CREATOR_NOT_ENROLLED'; end if;
  select * into prior from creator_finance.allocations where source_ref=p_source;
  if found then
    if (prior.creator_id,prior.kind,prior.gross_minor,prior.deductions_minor) is distinct from (p_creator,p_kind,p_gross,p_deductions) then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return prior.id;
  end if;
  select * into policy from creator_finance.revenue_policies where version='2026-10-v1' and kind=p_kind;
  if not found or p_gross is null or p_gross<=0 or p_deductions is null or p_deductions<0 or p_deductions>p_gross
    or (p_kind='tip' and p_deductions<>0) then raise exception 'INVALID_REVENUE'; end if;
  share:=floor((p_gross::numeric-p_deductions)*policy.creator_bps/10000)::bigint;
  insert into creator_finance.allocations(creator_id,source_ref,kind,policy_version,currency,gross_minor,deductions_minor,creator_minor,platform_minor)
    values(p_creator,p_source,p_kind,policy.version,'USD',p_gross,p_deductions,share,p_gross-p_deductions-share) returning id into allocation;
  if share>0 then
    perform creator_finance.move(p_creator,'USD',share,'funding','pending',p_source,'allocation:'||allocation);
    select amount_minor into debt from creator_finance.receivables where creator_id=p_creator for update;
    offset_minor:=least(coalesce(debt,0),share);
    if offset_minor>0 then
      perform creator_finance.move(p_creator,'USD',offset_minor,'pending','reversed',p_source,'receivable-offset:'||allocation);
      update creator_finance.receivables set amount_minor=amount_minor-offset_minor where creator_id=p_creator;
      insert into creator_finance.receivable_events(creator_id,amount_minor,evidence_ref) values(p_creator,-offset_minor,'allocation:'||allocation);
    end if;
  end if;
  return allocation;
end $$;

-- Only canonical, independently verified provider evidence may reach this
-- service entry point. There is deliberately no customer-facing settle API.
create function creator_finance.settle_order(p_order uuid,p_buyer uuid,p_provider_reference text,p_event text,p_currency text,p_amount_minor text,p_deductions_minor text,p_environment text)
returns text language plpgsql security definer set search_path='' as $$
declare o creator_finance.orders; receipt creator_finance.commerce_receipts; payload jsonb; start_time timestamptz;
begin
  select * into o from creator_finance.orders where id=p_order;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  perform 1 from creator_finance.enrollments where user_id=o.creator_id for update;
  select * into o from creator_finance.orders where id=p_order for update;
  if p_environment is distinct from 'test' or o.environment<>p_environment or p_buyer is distinct from o.buyer_id or p_currency is distinct from o.currency
    or p_amount_minor is distinct from o.amount_minor::text or p_deductions_minor is null or p_deductions_minor !~ '^(0|[1-9][0-9]{0,18})$'
    or nullif(p_provider_reference,'') is null or length(p_provider_reference)>200 or nullif(p_event,'') is null then raise exception 'RECEIPT_MISMATCH'; end if;
  payload:=jsonb_build_object('order',p_order,'buyer',p_buyer,'reference',p_provider_reference,'currency',p_currency,'amount',p_amount_minor,'deductions',p_deductions_minor,'environment',p_environment,'operation','capture');
  select * into receipt from creator_finance.commerce_receipts where provider_id='intobank' and event_id=p_event;
  if found then
    if receipt.payload is distinct from payload then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return o.state;
  end if;
  if o.state<>'pending' then raise exception 'ORDER_ALREADY_RESOLVED'; end if;
  perform creator_finance.allocate_revenue(o.creator_id,o.kind,o.amount_minor,p_deductions_minor::bigint,'order:'||o.id);
  insert into creator_finance.commerce_receipts(provider_id,event_id,order_id,payload) values('intobank',p_event,o.id,payload);
  update creator_finance.orders set state='paid',provider_reference=p_provider_reference,updated_at=now() where id=o.id;
  if o.kind='subscription' then
    -- Serialize buyer/creator grants so two successful purchases extend access.
    perform pg_advisory_xact_lock(hashtextextended(o.buyer_id::text||o.creator_id::text,0));
    select greatest(now(),coalesce(max(ends_at),now())) into start_time from creator_finance.subscription_periods where buyer_id=o.buyer_id and creator_id=o.creator_id and revoked_at is null;
    insert into creator_finance.subscription_periods(order_id,buyer_id,creator_id,starts_at,ends_at) values(o.id,o.buyer_id,o.creator_id,start_time,start_time+make_interval(days=>o.period_days));
  end if;
  return 'paid';
end $$;

create function creator_finance.refund_order(p_order uuid,p_provider_reference text,p_event text,p_refunded_minor text,p_environment text)
returns text language plpgsql security definer set search_path='' as $$
declare o creator_finance.orders; allocation creator_finance.allocations; receipt creator_finance.commerce_receipts; payload jsonb;
  cumulative bigint; reversal bigint; remaining bigint; available bigint; taken bigint; v_bucket text; result text;
begin
  select * into o from creator_finance.orders where id=p_order;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  perform 1 from creator_finance.enrollments where user_id=o.creator_id for update;
  select * into o from creator_finance.orders where id=p_order for update;
  if p_environment is distinct from 'test' or o.environment<>p_environment or p_provider_reference is distinct from o.provider_reference
    or p_provider_reference is null or p_refunded_minor is null or p_refunded_minor !~ '^[1-9][0-9]{0,18}$' or nullif(p_event,'') is null then raise exception 'RECEIPT_MISMATCH'; end if;
  cumulative:=p_refunded_minor::bigint;
  payload:=jsonb_build_object('order',p_order,'reference',p_provider_reference,'refunded',p_refunded_minor,'environment',p_environment,'operation','refund');
  select * into receipt from creator_finance.commerce_receipts where provider_id='intobank' and event_id=p_event;
  if found then
    if receipt.payload is distinct from payload then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return o.state;
  end if;
  if o.state not in ('paid','partially_refunded') or cumulative<=o.refunded_minor or cumulative>o.amount_minor then raise exception 'INVALID_REFUND'; end if;
  select * into allocation from creator_finance.allocations where source_ref='order:'||o.id;
  reversal:=floor(allocation.creator_minor::numeric*cumulative/o.amount_minor)::bigint-floor(allocation.creator_minor::numeric*o.refunded_minor/o.amount_minor)::bigint;
  remaining:=reversal;
  foreach v_bucket in array array['pending','available','withheld'] loop
    select amount_minor into available from creator_finance.balances where user_id=o.creator_id and currency='USD' and bucket=v_bucket;
    taken:=least(coalesce(available,0),remaining);
    if taken>0 then perform creator_finance.move(o.creator_id,'USD',taken,v_bucket,'reversed','refund:'||o.id,'refund:'||p_event||':'||v_bucket); remaining:=remaining-taken; end if;
  end loop;
  if remaining>0 then
    insert into creator_finance.receivables(creator_id,amount_minor) values(o.creator_id,remaining) on conflict(creator_id) do update set amount_minor=creator_finance.receivables.amount_minor+excluded.amount_minor;
    insert into creator_finance.receivable_events(creator_id,amount_minor,evidence_ref) values(o.creator_id,remaining,'refund:'||p_event);
  end if;
  result:=case when cumulative=o.amount_minor then 'refunded' else 'partially_refunded' end;
  update creator_finance.orders set refunded_minor=cumulative,state=result,updated_at=now() where id=o.id;
  if result='refunded' then update creator_finance.subscription_periods set revoked_at=now() where order_id=o.id; end if;
  insert into creator_finance.commerce_receipts(provider_id,event_id,order_id,payload) values('intobank',p_event,o.id,payload);
  return result;
end $$;

create function public.creator_has_active_subscription(p_creator uuid,p_viewer uuid) returns boolean language sql stable security definer set search_path='' as $$
  select p_viewer=auth.uid() and exists(select 1 from creator_finance.subscription_periods s
    join creator_finance.enrollments e on e.user_id=s.creator_id and e.status='approved'
    join auth.users u on u.id=s.buyer_id and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now())
    where s.creator_id=p_creator and s.buyer_id=p_viewer and s.revoked_at is null and s.starts_at<=now() and s.ends_at>now());
$$;
create function creator_finance.commerce_snapshot(p_expected_user uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=creator_finance.require_user(); result jsonb;
begin
  if uid is distinct from p_expected_user then raise exception 'ACCOUNT_CHANGED'; end if;
  select jsonb_build_object('user_id',uid,'capabilities',public.creator_commerce_capabilities(),
    'refund_balance_minor',coalesce((select amount_minor::text from creator_finance.receivables where creator_id=uid),'0'),
    'products',coalesce((select jsonb_agg(x.item) from (select jsonb_build_object('id',id,'kind',kind,'title',title,'amount_minor',amount_minor::text,'active',active,'period_days',period_days) item from creator_finance.products where creator_id=uid order by created_at desc,id desc limit 100)x),'[]'::jsonb),
    'purchases',coalesce((select jsonb_agg(x.item) from (select jsonb_build_object('id',id,'title',title,'kind',kind,'amount_minor',amount_minor::text,'refunded_minor',refunded_minor::text,'state',state,'created_at',created_at) item from creator_finance.orders where buyer_id=uid order by created_at desc,id desc limit 50)x),'[]'::jsonb),
    'subscriptions',coalesce((select jsonb_agg(jsonb_build_object('creator_id',s.creator_id,'starts_at',s.starts_at,'ends_at',s.ends_at,'auto_renew',false)) from (select creator_id,starts_at,ends_at from creator_finance.subscription_periods where buyer_id=uid and revoked_at is null and ends_at>now() order by starts_at,order_id limit 100)s),'[]'::jsonb)
  ) into result;
  return result;
end $$;

create function public.creator_save_product(p_expected_user uuid,p_id uuid,p_kind text,p_title text,p_amount_minor text,p_period_days integer,p_active boolean) returns uuid language sql security invoker set search_path='' as $$select creator_finance.save_product(p_expected_user,p_id,p_kind,p_title,p_amount_minor,p_period_days,p_active);$$;
create function public.creator_create_order(p_expected_user uuid,p_product uuid,p_expected_amount text,p_key uuid) returns uuid language sql security invoker set search_path='' as $$select creator_finance.create_order(p_expected_user,p_product,p_expected_amount,p_key);$$;
create function public.creator_commerce_snapshot(p_expected_user uuid) returns jsonb language sql security invoker set search_path='' as $$select creator_finance.commerce_snapshot(p_expected_user);$$;
-- Deployment-specific capture adapters must authenticate the provider and call
-- these private operations. They are not exposed as Data API customer routes.
revoke all on function creator_finance.commerce_ready(),creator_finance.save_product(uuid,uuid,text,text,text,integer,boolean),creator_finance.create_order(uuid,uuid,text,uuid),creator_finance.allocate_revenue(uuid,text,bigint,bigint,text),creator_finance.settle_order(uuid,uuid,text,text,text,text,text,text),creator_finance.refund_order(uuid,text,text,text,text),creator_finance.commerce_snapshot(uuid) from public,anon,authenticated,service_role;
revoke all on function public.creator_commerce_capabilities(),public.creator_has_active_subscription(uuid,uuid),public.creator_save_product(uuid,uuid,text,text,text,integer,boolean),public.creator_create_order(uuid,uuid,text,uuid),public.creator_commerce_snapshot(uuid) from public,anon,authenticated,service_role;
grant execute on function public.creator_commerce_capabilities(),public.creator_has_active_subscription(uuid,uuid),public.creator_save_product(uuid,uuid,text,text,text,integer,boolean),public.creator_create_order(uuid,uuid,text,uuid),public.creator_commerce_snapshot(uuid) to authenticated;
grant execute on function creator_finance.save_product(uuid,uuid,text,text,text,integer,boolean),creator_finance.create_order(uuid,uuid,text,uuid),creator_finance.commerce_snapshot(uuid) to authenticated;
grant execute on function creator_finance.settle_order(uuid,uuid,text,text,text,text,text,text),creator_finance.refund_order(uuid,text,text,text,text) to service_role;
commit;
