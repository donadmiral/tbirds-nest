-- Forward-only correction after the initial QA finance deployment.
-- Preserves every balance, payout, receipt and subscription record.
begin;

create or replace function creator_finance.payout_environment() returns trigger language plpgsql set search_path='' as $$
begin
  select environment into new.environment from creator_finance.program where singleton for share;
  return new;
end $$;

create or replace function creator_finance.lock_ledger_environment() returns trigger language plpgsql set search_path='' as $$
begin
  perform 1 from creator_finance.program where singleton for share;
  return new;
end $$;

create or replace function creator_finance.provider_dispatch_ready() returns boolean language sql immutable security definer set search_path='' as $$select false;$$;

create or replace function creator_finance.snapshot() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; env text; ready boolean;
begin
  result:=creator_finance.snapshot_base();
  select p.environment,p.environment='test' and v.contract_version='crisp-payout-v1' and v.payouts_enabled and creator_finance.provider_dispatch_ready() into env,ready
    from creator_finance.program p join creator_finance.providers v on v.id=p.primary_provider where p.singleton;
  return jsonb_set(result||jsonb_build_object('environment',env),'{provider,payouts_enabled}',to_jsonb(coalesce(ready,false)));
end $$;

create or replace function creator_finance.claim_payouts(p_worker uuid,p_limit integer,p_environment text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if p_worker is null or p_limit is null or p_limit<1 or p_limit>20 or p_environment is distinct from 'test' then raise exception 'INVALID_WORKER_REQUEST'; end if;
  with picked as (
    select q.id from creator_finance.payouts q join creator_finance.providers v on v.id=q.provider_id
    where q.environment=p_environment and q.status in ('requested','submitted','unknown') and q.next_attempt_at<=now()
      and (q.lease_until is null or q.lease_until<now())
      and (q.dispatch_started_at is not null or (v.contract_version='crisp-payout-v1' and v.payouts_enabled and creator_finance.provider_dispatch_ready()))
    order by q.next_attempt_at,q.id limit p_limit for update of q skip locked
  ), claimed as (
    update creator_finance.payouts q set lease_token=p_worker,lease_until=now()+interval '60 seconds',attempts=attempts+1
    from picked where q.id=picked.id returning q.*
  ) select coalesce(jsonb_agg(jsonb_build_object('id',id,'creator_id',user_id,'account_reference',external_account_ref,
      'provider_id',provider_id,'currency',currency,'amount_minor',amount_minor::text,'environment',environment,
      'status',status,'provider_reference',provider_reference,'dispatch_started',dispatch_started_at is not null)),'[]') into result from claimed;
  return result;
end $$;

create or replace function creator_finance.begin_dispatch(p_id uuid,p_lease uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare q creator_finance.payouts;
begin
  select * into q from creator_finance.payouts where id=p_id;
  if not found then return false; end if;
  perform 1 from creator_finance.enrollments e join auth.users u on u.id=e.user_id
    where e.user_id=q.user_id and e.status='approved' and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now()) for share of e;
  if not found then return false; end if;
  select * into q from creator_finance.payouts where id=p_id for update;
  if q.lease_token is distinct from p_lease or q.lease_until<now() or q.dispatch_started_at is not null
    or q.status<>'requested' or q.environment<>'test' or not creator_finance.provider_dispatch_ready() then return false; end if;
  perform 1 from creator_finance.providers where id=q.provider_id and payouts_enabled and contract_version='crisp-payout-v1' for share;
  if not found then return false; end if;
  perform 1 from creator_finance.payout_accounts where user_id=q.user_id and provider_id=q.provider_id and status='ready'
    and external_account_ref=q.external_account_ref for share;
  if not found then return false; end if;
  update creator_finance.payouts set dispatch_started_at=now(),updated_at=now() where id=p_id;
  return true;
end $$;

create or replace function creator_finance.request_payout_before_commerce(p_expected_user uuid,p_currency text,p_amount_minor text,p_idempotency_key uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare uid uuid:=creator_finance.require_user();
begin
  if uid is distinct from p_expected_user then raise exception 'ACCOUNT_CHANGED'; end if;
  if p_amount_minor is null or p_amount_minor !~ '^[1-9][0-9]{0,15}$' or p_amount_minor::numeric>9007199254740991 then raise exception 'INVALID_AMOUNT'; end if;
  if not exists(select 1 from creator_finance.payouts where user_id=uid and idempotency_key=p_idempotency_key)
    and not exists(select 1 from creator_finance.program p join creator_finance.providers v on v.id=p.primary_provider
      where p.singleton and p.environment='test' and v.contract_version='crisp-payout-v1' and v.payouts_enabled and creator_finance.provider_dispatch_ready()) then raise exception 'PAYOUT_PROVIDER_NOT_READY'; end if;
  return creator_finance.request_payout_base(p_expected_user,p_currency,p_amount_minor,p_idempotency_key);
end $$;

create or replace function creator_finance.prevent_environment_change() returns trigger language plpgsql set search_path='' as $$
begin
  if new.environment<>old.environment and (exists(select 1 from creator_finance.ledger) or exists(select 1 from creator_finance.payouts) or exists(select 1 from creator_finance.orders)) then
    raise exception 'FINANCE_ENVIRONMENT_HAS_ACTIVITY';
  end if;
  return new;
end $$;

create or replace function creator_finance.save_product(p_expected_user uuid,p_id uuid,p_kind text,p_title text,p_amount_minor text,p_period_days integer,p_active boolean)
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

create or replace function creator_finance.create_order(p_expected_user uuid,p_product uuid,p_expected_amount text,p_key uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare uid uuid:=creator_finance.require_user(); product creator_finance.products; prior creator_finance.orders; result uuid;
begin
  if uid is distinct from p_expected_user then raise exception 'ACCOUNT_CHANGED'; end if;
  if p_key is null or p_product is null then raise exception 'INVALID_ORDER'; end if;
  perform 1 from creator_finance.program where singleton for share;
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

create or replace function creator_finance.refund_order(p_order uuid,p_provider_reference text,p_event text,p_refunded_minor text,p_environment text)
returns text language plpgsql security definer set search_path='' as $$
declare o creator_finance.orders; allocation creator_finance.allocations; receipt creator_finance.commerce_receipts; payload jsonb;
  cumulative bigint; reversal bigint; remaining bigint; available bigint; taken bigint; v_bucket text; result text; q creator_finance.payouts;
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
  -- The enrollment lock excludes first-dispatch while we reclaim reservations
  -- that provably never left this system. Already dispatched money stays held.
  select coalesce(sum(amount_minor),0) into available from creator_finance.balances where user_id=o.creator_id and currency='USD' and bucket in ('pending','available','withheld');
  if available<remaining then
    for q in select * from creator_finance.payouts where user_id=o.creator_id and currency='USD' and status='requested' and dispatch_started_at is null order by created_at,id for update loop
      perform creator_finance.move(o.creator_id,'USD',q.amount_minor,'reserved','available','refund:'||o.id,'payout:cancel-refund:'||q.id);
      update creator_finance.payouts set status='rejected',last_error='CANCELLED_BEFORE_DISPATCH_FOR_REFUND',lease_token=null,lease_until=null,updated_at=now() where id=q.id;
      available:=available+q.amount_minor;
      exit when available>=remaining;
    end loop;
  end if;
  foreach v_bucket in array array['pending','available','withheld'] loop
    select amount_minor into available from creator_finance.balances where user_id=o.creator_id and currency='USD' and bucket=v_bucket;
    taken:=least(coalesce(available,0),remaining);
    if taken>0 then perform creator_finance.move(o.creator_id,'USD',taken,v_bucket,'reversed','refund:'||o.id,'refund:'||o.id||':'||cumulative||':'||v_bucket); remaining:=remaining-taken; end if;
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

create or replace function creator_finance.commerce_snapshot(p_expected_user uuid) returns jsonb language plpgsql security definer set search_path='' as $$
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

drop trigger if exists creator_ledger_environment on creator_finance.ledger;
create trigger creator_ledger_environment before insert on creator_finance.ledger for each row execute function creator_finance.lock_ledger_environment();
revoke all on function creator_finance.provider_dispatch_ready(),creator_finance.lock_ledger_environment(),creator_finance.request_payout_before_commerce(uuid,text,text,uuid) from public,anon,authenticated,service_role;
commit;
