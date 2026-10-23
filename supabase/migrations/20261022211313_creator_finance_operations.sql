-- Finance operations remain disabled until a reviewed provider deployment and
-- verified creator destinations are configured. Test and live records cannot mix.
begin;
alter table creator_finance.program add column environment text not null default 'live' check(environment in ('test','live'));
alter table creator_finance.payouts add column environment text not null default 'live' check(environment in ('test','live'));
alter table creator_finance.payouts add column lease_token uuid;
alter table creator_finance.payouts add column lease_until timestamptz;
alter table creator_finance.payouts add column dispatch_started_at timestamptz;
alter table creator_finance.payouts add column next_attempt_at timestamptz not null default now();
alter table creator_finance.payouts add column attempts integer not null default 0;
alter table creator_finance.payouts add column last_error text;
create index creator_payouts_recovery on creator_finance.payouts(environment,next_attempt_at,id) where status in ('requested','submitted','unknown');

create function creator_finance.payout_environment() returns trigger language plpgsql set search_path='' as $$
begin
  select environment into new.environment from creator_finance.program where singleton;
  return new;
end $$;
create trigger creator_payout_environment before insert on creator_finance.payouts for each row execute function creator_finance.payout_environment();
create function creator_finance.prevent_environment_change() returns trigger language plpgsql set search_path='' as $$
begin
  if new.environment<>old.environment and (exists(select 1 from creator_finance.ledger) or exists(select 1 from creator_finance.payouts)) then
    raise exception 'FINANCE_ENVIRONMENT_HAS_ACTIVITY';
  end if;
  return new;
end $$;
create trigger creator_environment_isolation before update on creator_finance.program for each row execute function creator_finance.prevent_environment_change();

-- Until the bank's live contract is approved, readiness cannot be enabled merely
-- by toggling a database flag. Retries can still read historical reservations.
alter function creator_finance.request_payout(uuid,text,text,uuid) rename to request_payout_base;
create function creator_finance.request_payout(p_expected_user uuid,p_currency text,p_amount_minor text,p_idempotency_key uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare uid uuid:=creator_finance.require_user();
begin
  if uid is distinct from p_expected_user then raise exception 'ACCOUNT_CHANGED'; end if;
  if p_amount_minor is null or p_amount_minor !~ '^[1-9][0-9]{0,15}$' or p_amount_minor::numeric>9007199254740991 then raise exception 'INVALID_AMOUNT'; end if;
  if not exists(select 1 from creator_finance.payouts where user_id=uid and idempotency_key=p_idempotency_key)
    and not exists(select 1 from creator_finance.program p join creator_finance.providers v on v.id=p.primary_provider
      where p.singleton and p.environment='test' and v.contract_version='crisp-payout-v1' and v.payouts_enabled) then raise exception 'PAYOUT_PROVIDER_NOT_READY'; end if;
  return creator_finance.request_payout_base(p_expected_user,p_currency,p_amount_minor,p_idempotency_key);
end $$;
-- SQL wrappers depend on object identity; recreate the wrapper to call the new
-- gate rather than the renamed historical function.
create or replace function public.creator_request_payout(p_expected_user uuid,p_currency text,p_amount_minor text,p_idempotency_key uuid)
returns uuid language sql security invoker set search_path='' as $$ select creator_finance.request_payout(p_expected_user,p_currency,p_amount_minor,p_idempotency_key); $$;
revoke all on function creator_finance.request_payout_base(uuid,text,text,uuid),creator_finance.request_payout(uuid,text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function creator_finance.request_payout(uuid,text,text,uuid) to authenticated;
alter function creator_finance.snapshot() rename to snapshot_base;
create function creator_finance.snapshot() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; env text; ready boolean;
begin
  result:=creator_finance.snapshot_base();
  select p.environment,p.environment='test' and v.contract_version='crisp-payout-v1' and v.payouts_enabled into env,ready
    from creator_finance.program p join creator_finance.providers v on v.id=p.primary_provider where p.singleton;
  return jsonb_set(result||jsonb_build_object('environment',env),'{provider,payouts_enabled}',to_jsonb(coalesce(ready,false)));
end $$;
create or replace function public.creator_monetization_snapshot() returns jsonb language sql security invoker set search_path='' as $$ select creator_finance.snapshot(); $$;
revoke all on function creator_finance.snapshot_base(),creator_finance.snapshot() from public,anon,authenticated,service_role;
grant execute on function creator_finance.snapshot() to authenticated;

-- Approved economic shares. A version is immutable once allocated; it is not a
-- promise of earnings or an instruction to enable enrollment.
create table creator_finance.revenue_policies(
  version text not null, kind text not null check(kind in ('ads','subscription','tip','gift','sponsorship','marketplace')),
  creator_bps integer not null check(creator_bps between 0 and 10000),
  basis text not null check(basis in ('eligible_net','genuine_tip')),
  primary key(version,kind)
);
insert into creator_finance.revenue_policies values
  ('2026-10-v1','ads',5500,'eligible_net'),('2026-10-v1','subscription',9000,'eligible_net'),
  ('2026-10-v1','tip',10000,'genuine_tip'),('2026-10-v1','gift',7000,'eligible_net'),
  ('2026-10-v1','sponsorship',9000,'eligible_net'),('2026-10-v1','marketplace',9500,'eligible_net');
alter table creator_finance.revenue_policies enable row level security;
revoke all on creator_finance.revenue_policies from public,anon,authenticated,service_role;
create trigger immutable_revenue_policies before update or delete on creator_finance.revenue_policies for each row execute function creator_finance.immutable_record();
create function public.creator_revenue_policy() returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('version','2026-10-v1','primary_provider','intobank','rounding','floor_to_minor_unit',
    'shares',(select jsonb_agg(jsonb_build_object('kind',kind,'creator_bps',creator_bps,'basis',basis) order by kind)
      from creator_finance.revenue_policies where version='2026-10-v1'));
$$;

-- Bounded, seek-based history. Cursors are owner-bound by the query, not trusted
-- client offsets. Ties use UUIDs so events are neither skipped nor duplicated.
create function creator_finance.statement(p_expected_user uuid,p_limit integer,p_before_at timestamptz,p_before_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=creator_finance.require_user(); records jsonb; last_at timestamptz; last_id uuid; more boolean;
begin
  if uid is distinct from p_expected_user then raise exception 'ACCOUNT_CHANGED'; end if;
  if p_limit is null or p_limit<1 or p_limit>100 or ((p_before_at is null)<>(p_before_id is null)) then raise exception 'INVALID_PAGE'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'created_at',x.created_at,'currency',x.currency,
    'amount_minor',x.amount_minor::text,'from',x.from_bucket,'to',x.to_bucket) order by x.created_at desc,x.id desc),'[]') into records
  from (select * from creator_finance.ledger l where l.user_id=uid and (p_before_at is null or (l.created_at,l.id)<(p_before_at,p_before_id))
    order by l.created_at desc,l.id desc limit p_limit) x;
  if jsonb_array_length(records)>0 then
    last_at:=(records->-1->>'created_at')::timestamptz;last_id:=(records->-1->>'id')::uuid;
    select exists(select 1 from creator_finance.ledger l where l.user_id=uid and (l.created_at,l.id)<(last_at,last_id)) into more;
  end if;
  return jsonb_build_object('user_id',uid,'environment',(select environment from creator_finance.program where singleton),'entries',records,
    'next_cursor',case when more then jsonb_build_object('created_at',last_at,'id',last_id) else null end);
end $$;
create function public.creator_statement(p_expected_user uuid,p_limit integer default 50,p_before_at timestamptz default null,p_before_id uuid default null)
returns jsonb language sql security invoker set search_path='' as $$ select creator_finance.statement(p_expected_user,p_limit,p_before_at,p_before_id); $$;

-- Each claim is an expiring lease. The database records dispatch intent before
-- the HTTP call. An expired lease recovers through GET, never a second transfer.
create function creator_finance.claim_payouts(p_worker uuid,p_limit integer,p_environment text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if p_worker is null or p_limit is null or p_limit<1 or p_limit>20 or p_environment is distinct from 'test' then raise exception 'INVALID_WORKER_REQUEST'; end if;
  with picked as (
    select q.id from creator_finance.payouts q join creator_finance.providers v on v.id=q.provider_id
    where q.environment=p_environment and q.status in ('requested','submitted','unknown') and q.next_attempt_at<=now()
      and (q.lease_until is null or q.lease_until<now())
      and (q.dispatch_started_at is not null or (v.contract_version='crisp-payout-v1' and v.payouts_enabled))
    order by q.next_attempt_at,q.id limit p_limit for update of q skip locked
  ), claimed as (
    update creator_finance.payouts q set lease_token=p_worker,lease_until=now()+interval '60 seconds',attempts=attempts+1
    from picked where q.id=picked.id returning q.*
  ) select coalesce(jsonb_agg(jsonb_build_object('id',id,'creator_id',user_id,'account_reference',external_account_ref,
      'provider_id',provider_id,'currency',currency,'amount_minor',amount_minor::text,'environment',environment,
      'status',status,'provider_reference',provider_reference,'dispatch_started',dispatch_started_at is not null)),'[]') into result from claimed;
  return result;
end $$;
create function public.creator_claim_payouts(p_worker uuid,p_limit integer,p_environment text) returns jsonb
language sql security invoker set search_path='' as $$ select creator_finance.claim_payouts(p_worker,p_limit,p_environment); $$;

create function creator_finance.begin_dispatch(p_id uuid,p_lease uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare q creator_finance.payouts;
begin
  select * into q from creator_finance.payouts where id=p_id;
  if not found then return false; end if;
  perform 1 from creator_finance.enrollments e join auth.users u on u.id=e.user_id
    where e.user_id=q.user_id and e.status='approved' and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now()) for share of e;
  if not found then return false; end if;
  select * into q from creator_finance.payouts where id=p_id for update;
  if q.lease_token is distinct from p_lease or q.lease_until<now() or q.dispatch_started_at is not null
    or q.status<>'requested' or q.environment<>'test' then return false; end if;
  perform 1 from creator_finance.providers where id=q.provider_id and payouts_enabled and contract_version='crisp-payout-v1' for share;
  if not found then return false; end if;
  perform 1 from creator_finance.payout_accounts where user_id=q.user_id and provider_id=q.provider_id and status='ready'
    and external_account_ref=q.external_account_ref for share;
  if not found then return false; end if;
  update creator_finance.payouts set dispatch_started_at=now(),updated_at=now() where id=p_id;
  return true;
end $$;
create function public.creator_begin_payout_dispatch(p_id uuid,p_lease uuid) returns boolean language sql security invoker set search_path='' as $$ select creator_finance.begin_dispatch(p_id,p_lease); $$;

create function creator_finance.finish_attempt(p_id uuid,p_lease uuid,p_outcome jsonb,p_error text)
returns text language plpgsql security definer set search_path='' as $$
declare q creator_finance.payouts; result text; incoming text; event_key text;
begin
  select * into q from creator_finance.payouts where id=p_id;
  if not found then raise exception 'PAYOUT_NOT_FOUND'; end if;
  perform 1 from creator_finance.enrollments where user_id=q.user_id for update;
  select * into q from creator_finance.payouts where id=p_id for update;
  if q.lease_token is distinct from p_lease or p_lease is null then raise exception 'STALE_PAYOUT_LEASE'; end if;
  if p_outcome is not null then
    if p_outcome->>'environment' is distinct from q.environment or p_outcome->>'payout_id' is distinct from q.id::text then raise exception 'RECEIPT_MISMATCH'; end if;
    incoming:=p_outcome->>'status'; event_key:=p_outcome->>'event_id';
    -- A later pending poll must not pretend that an uncertain transfer restarted.
    if q.status='unknown' and incoming='submitted' then incoming:='unknown'; event_key:=event_key||':retained_unknown'; end if;
    result:=creator_finance.reconcile_payout(q.id,p_outcome->>'provider_id',event_key,p_outcome->>'reference',
      p_outcome->>'account_reference',p_outcome->>'currency',p_outcome->>'amount_minor',incoming);
  else
    result:=case when q.dispatch_started_at is not null and q.status='requested' then 'unknown' else q.status end;
    update creator_finance.payouts set status=result where id=q.id;
  end if;
  update creator_finance.payouts set lease_token=null,lease_until=null,updated_at=now(),
    next_attempt_at=now()+make_interval(secs=>least(3600,60*greatest(1,attempts))),
    last_error=case when p_error is null then null else left(p_error,80) end where id=q.id;
  return result;
end $$;
create function public.creator_finish_payout_attempt(p_id uuid,p_lease uuid,p_outcome jsonb,p_error text default null) returns text
language sql security invoker set search_path='' as $$ select creator_finance.finish_attempt(p_id,p_lease,p_outcome,p_error); $$;

revoke all on function creator_finance.payout_environment(),creator_finance.prevent_environment_change(),creator_finance.statement(uuid,integer,timestamptz,uuid),
  creator_finance.claim_payouts(uuid,integer,text),creator_finance.begin_dispatch(uuid,uuid),creator_finance.finish_attempt(uuid,uuid,jsonb,text) from public,anon,authenticated,service_role;
revoke all on function public.creator_statement(uuid,integer,timestamptz,uuid),public.creator_revenue_policy(),public.creator_claim_payouts(uuid,integer,text),
  public.creator_begin_payout_dispatch(uuid,uuid),public.creator_finish_payout_attempt(uuid,uuid,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function creator_finance.statement(uuid,integer,timestamptz,uuid),public.creator_statement(uuid,integer,timestamptz,uuid),public.creator_revenue_policy() to authenticated;
grant execute on function creator_finance.claim_payouts(uuid,integer,text),creator_finance.begin_dispatch(uuid,uuid),creator_finance.finish_attempt(uuid,uuid,jsonb,text),
  public.creator_claim_payouts(uuid,integer,text),public.creator_begin_payout_dispatch(uuid,uuid),public.creator_finish_payout_attempt(uuid,uuid,jsonb,text) to service_role;
commit;
