-- Creator monetization foundation. No provider execution, funding or eligibility
-- is invented here. IntoBank is primary; payouts remain disabled until a verified
-- creator-payout adapter and approved program contract are installed.
-- Review candidate only. No hosted migration is implied.
begin;
create schema if not exists creator_finance;
revoke all on schema creator_finance from public, anon, authenticated;

create table creator_finance.program (
  singleton boolean primary key default true check (singleton),
  enrollment_open boolean not null default false,
  terms_version text,
  terms_url text,
  primary_provider text not null default 'intobank',
  check (not enrollment_open or (nullif(terms_version, '') is not null and terms_url is not null and terms_url ~ '^https://[^/[:space:]]+(/[^[:space:]]*)?$'))
);
insert into creator_finance.program(singleton) values (true);
create table creator_finance.providers (
  id text primary key,
  display_name text not null,
  payouts_enabled boolean not null default false,
  currencies text[] not null default '{}',
  contract_version text,
  check (not payouts_enabled or nullif(contract_version, '') is not null)
);
insert into creator_finance.providers(id, display_name) values ('intobank', 'IntoBank');
alter table creator_finance.program add foreign key (primary_provider) references creator_finance.providers(id);
create table creator_finance.enrollments (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null check (status in ('interested','applied','approved','rejected','suspended')),
  accepted_terms_version text,
  accepted_terms_at timestamptz,
  public_reason text,
  updated_at timestamptz not null default now(),
  check (status not in ('applied','approved') or (accepted_terms_version is not null and accepted_terms_at is not null))
);
create table creator_finance.payout_accounts (
  user_id uuid not null references auth.users(id) on delete cascade,
  provider_id text not null references creator_finance.providers(id),
  status text not null check (status in ('pending','ready','restricted')),
  external_account_ref text not null,
  verified_at timestamptz,
  primary key(user_id, provider_id),
  unique(provider_id, external_account_ref),
  check (status <> 'ready' or verified_at is not null)
);
create table creator_finance.balances (
  user_id uuid not null references auth.users(id),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  bucket text not null check (bucket in ('pending','available','reserved','paid','withheld','reversed')),
  amount_minor bigint not null default 0 check (amount_minor >= 0),
  primary key(user_id, currency, bucket)
);
-- A movement is one immutable transfer between named subaccounts. 'funding' is
-- the external funding control account; it can only credit pending earnings.
create table creator_finance.ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  amount_minor bigint not null check (amount_minor > 0),
  from_bucket text not null,
  to_bucket text not null,
  source_ref text not null check (length(source_ref) between 1 and 240),
  idempotency_key text not null unique check (length(idempotency_key) between 1 and 240),
  created_at timestamptz not null default now(),
  check (from_bucket <> to_bucket),
  check (from_bucket in ('funding','pending','available','reserved','withheld')),
  check (to_bucket in ('pending','available','reserved','paid','withheld','reversed')),
  check (from_bucket <> 'funding' or to_bucket = 'pending')
);
-- Funding reference identifies a single verified creator allocation, not a batch.
create unique index creator_ledger_funding_once on creator_finance.ledger(source_ref) where from_bucket='funding';
create index creator_ledger_user_recent on creator_finance.ledger(user_id, created_at desc, id desc);
create table creator_finance.payouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  provider_id text not null references creator_finance.providers(id),
  external_account_ref text not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  amount_minor bigint not null check (amount_minor > 0),
  idempotency_key uuid not null,
  status text not null default 'requested' check (status in ('requested','submitted','unknown','completed','rejected')),
  provider_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, idempotency_key),
  unique(provider_id, provider_reference)
);
create index creator_payouts_user_recent on creator_finance.payouts(user_id, created_at desc, id desc);
create table creator_finance.receipts (
  provider_id text not null references creator_finance.providers(id),
  event_id text not null check (length(event_id) between 1 and 240),
  payout_id uuid not null references creator_finance.payouts(id),
  payload jsonb not null,
  received_at timestamptz not null default now(),
  primary key(provider_id, event_id)
);

-- Private tables have no client grants. Enable RLS as defense in depth, including
-- for any future accidental Data API exposure. Writes use reviewed functions.
alter table creator_finance.program enable row level security;
alter table creator_finance.providers enable row level security;
alter table creator_finance.enrollments enable row level security;
alter table creator_finance.payout_accounts enable row level security;
alter table creator_finance.balances enable row level security;
alter table creator_finance.ledger enable row level security;
alter table creator_finance.payouts enable row level security;
alter table creator_finance.receipts enable row level security;
revoke all on all tables in schema creator_finance from public, anon, authenticated, service_role;

create function creator_finance.immutable_record() returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'FINANCE_RECORD_IMMUTABLE'; end $$;
create trigger immutable_ledger before update or delete on creator_finance.ledger for each row execute function creator_finance.immutable_record();
create trigger immutable_receipt before update or delete on creator_finance.receipts for each row execute function creator_finance.immutable_record();

-- Locks the creator enrollment row, giving all money mutations one lock order.
-- This internal primitive is not granted to client or service roles.
create function creator_finance.move(p_user uuid, p_currency text, p_amount bigint, p_from text, p_to text, p_source text, p_key text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare existing creator_finance.ledger; movement uuid;
begin
  if p_user is null or p_currency is null or p_currency !~ '^[A-Z]{3}$' or p_amount is null or p_amount <= 0
    or nullif(p_source,'') is null or nullif(p_key,'') is null then raise exception 'INVALID_MOVEMENT'; end if;
  perform 1 from creator_finance.enrollments where user_id=p_user for update;
  if not found then raise exception 'CREATOR_NOT_ENROLLED'; end if;
  select * into existing from creator_finance.ledger where idempotency_key=p_key;
  if found then
    if (existing.user_id,existing.currency,existing.amount_minor,existing.from_bucket,existing.to_bucket,existing.source_ref)
      is distinct from (p_user,p_currency,p_amount,p_from,p_to,p_source) then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return existing.id;
  end if;
  if p_from='funding' and exists(select 1 from creator_finance.ledger where from_bucket='funding' and source_ref=p_source) then
    raise exception 'FUNDING_REFERENCE_ALREADY_RECORDED';
  end if;
  if p_from <> 'funding' then
    update creator_finance.balances set amount_minor=amount_minor-p_amount
      where user_id=p_user and currency=p_currency and bucket=p_from and amount_minor>=p_amount;
    if not found then raise exception 'INSUFFICIENT_BALANCE'; end if;
  end if;
  insert into creator_finance.balances(user_id,currency,bucket,amount_minor) values(p_user,p_currency,p_to,p_amount)
    on conflict(user_id,currency,bucket) do update set amount_minor=creator_finance.balances.amount_minor+excluded.amount_minor;
  insert into creator_finance.ledger(user_id,currency,amount_minor,from_bucket,to_bucket,source_ref,idempotency_key)
    values(p_user,p_currency,p_amount,p_from,p_to,p_source,p_key) returning id into movement;
  return movement;
end $$;

create function creator_finance.require_user() returns uuid language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null or not exists(select 1 from auth.users where id=uid) then raise exception 'AUTH_REQUIRED'; end if;
  return uid;
end $$;
create function creator_finance.register_interest(p_expected_user uuid) returns text language plpgsql security definer set search_path = '' as $$
declare uid uuid := creator_finance.require_user(); state text;
begin
  if uid is distinct from p_expected_user then raise exception 'ACCOUNT_CHANGED'; end if;
  insert into creator_finance.enrollments(user_id,status) values(uid,'interested') on conflict(user_id) do nothing;
  select status into state from creator_finance.enrollments where user_id=uid;
  return state;
end $$;
create function creator_finance.apply(p_expected_user uuid,p_terms_version text) returns text language plpgsql security definer set search_path = '' as $$
declare uid uuid := creator_finance.require_user(); p creator_finance.program; state text;
begin
  if uid is distinct from p_expected_user then raise exception 'ACCOUNT_CHANGED'; end if;
  select * into p from creator_finance.program where singleton for share;
  if not p.enrollment_open then raise exception 'ENROLLMENT_CLOSED'; end if;
  if p_terms_version is distinct from p.terms_version then raise exception 'TERMS_CHANGED'; end if;
  insert into creator_finance.enrollments(user_id,status) values(uid,'interested') on conflict(user_id) do nothing;
  select status into state from creator_finance.enrollments where user_id=uid for update;
  if state='interested' then
    update creator_finance.enrollments set status='applied',accepted_terms_version=p_terms_version,
      accepted_terms_at=now(),updated_at=now() where user_id=uid;
    return 'applied';
  end if;
  return state;
end $$;

create function creator_finance.snapshot() returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := creator_finance.require_user(); result jsonb;
begin
  select jsonb_build_object(
    'user_id',uid,'as_of',now(),
    'program',jsonb_build_object('enrollment_open',p.enrollment_open,'terms_version',p.terms_version,'terms_url',p.terms_url),
    'provider',jsonb_build_object('id',v.id,'name',v.display_name,'payouts_enabled',v.payouts_enabled,'currencies',v.currencies),
    'enrollment',coalesce((select jsonb_build_object('status',e.status,'reason',e.public_reason) from creator_finance.enrollments e where e.user_id=uid),jsonb_build_object('status','not_enrolled','reason',null)),
    'payout_account',coalesce((select jsonb_build_object('status',a.status,'verified_at',a.verified_at) from creator_finance.payout_accounts a where a.user_id=uid and a.provider_id=v.id),jsonb_build_object('status','not_configured','verified_at',null)),
    'balances',coalesce((select jsonb_agg(jsonb_build_object('currency',b.currency,'bucket',b.bucket,'amount_minor',b.amount_minor::text) order by b.currency,b.bucket) from creator_finance.balances b where b.user_id=uid),'[]'::jsonb),
    'recent_earnings',coalesce((select jsonb_agg(x.item order by x.created_at desc,x.id desc) from (select l.id,l.created_at,jsonb_build_object('id',l.id,'created_at',l.created_at,'currency',l.currency,'amount_minor',l.amount_minor::text,'from',l.from_bucket,'to',l.to_bucket) item from creator_finance.ledger l where l.user_id=uid order by l.created_at desc,l.id desc limit 25) x),'[]'::jsonb),
    'recent_payouts',coalesce((select jsonb_agg(x.item order by x.created_at desc,x.id desc) from (select q.id,q.created_at,jsonb_build_object('id',q.id,'created_at',q.created_at,'currency',q.currency,'amount_minor',q.amount_minor::text,'status',q.status,'provider_id',q.provider_id,'provider_reference',q.provider_reference) item from creator_finance.payouts q where q.user_id=uid order by q.created_at desc,q.id desc limit 20) x),'[]'::jsonb)
  ) into result from creator_finance.program p join creator_finance.providers v on v.id=p.primary_provider where p.singleton;
  if result is null then raise exception 'MONETIZATION_UNAVAILABLE'; end if;
  return result;
end $$;

create function creator_finance.request_payout(p_expected_user uuid,p_currency text,p_amount_minor text,p_idempotency_key uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare uid uuid := creator_finance.require_user(); amount bigint; v creator_finance.providers;
  account creator_finance.payout_accounts; prior creator_finance.payouts; payout uuid; state text;
begin
  if uid is distinct from p_expected_user then raise exception 'ACCOUNT_CHANGED'; end if;
  if p_amount_minor is null or p_amount_minor !~ '^[1-9][0-9]{0,18}$' or p_idempotency_key is null then raise exception 'INVALID_AMOUNT'; end if;
  amount:=p_amount_minor::bigint;
  select status into state from creator_finance.enrollments where user_id=uid for update;
  select * into prior from creator_finance.payouts where user_id=uid and idempotency_key=p_idempotency_key;
  if found then
    if (prior.currency,prior.amount_minor) is distinct from (p_currency,amount) then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return prior.id;
  end if;
  if state is distinct from 'approved' then raise exception 'CREATOR_NOT_APPROVED'; end if;
  select v1.* into v from creator_finance.providers v1 join creator_finance.program p on p.primary_provider=v1.id where p.singleton for share of v1;
  if not coalesce(v.payouts_enabled,false) then raise exception 'PAYOUT_PROVIDER_NOT_READY'; end if;
  if p_currency is null or not(p_currency=any(v.currencies)) then raise exception 'UNSUPPORTED_CURRENCY'; end if;
  select * into account from creator_finance.payout_accounts where user_id=uid and provider_id=v.id for share;
  if account.status is distinct from 'ready' then raise exception 'PAYOUT_ACCOUNT_NOT_READY'; end if;
  insert into creator_finance.payouts(user_id,provider_id,external_account_ref,currency,amount_minor,idempotency_key)
    values(uid,v.id,account.external_account_ref,p_currency,amount,p_idempotency_key) returning id into payout;
  perform creator_finance.move(uid,p_currency,amount,'available','reserved',payout::text,'payout:reserve:'||payout);
  return payout;
end $$;

-- Trusted server entry points. No API for an ordinary client to mint earnings,
-- approve itself, change provider readiness, or declare a payout settled.
-- Funding evidence must be validated by a future approved funding adapter before
-- calling this function. Its source_ref is a stable reconciliation reference.
create function creator_finance.record_funded_earning(p_user uuid,p_currency text,p_amount_minor text,p_funding_ref text,p_key text)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if p_currency is distinct from 'USD' then raise exception 'UNSUPPORTED_CURRENCY'; end if;
  if p_amount_minor is null or p_amount_minor !~ '^[1-9][0-9]{0,18}$' then raise exception 'INVALID_AMOUNT'; end if;
  return creator_finance.move(p_user,p_currency,p_amount_minor::bigint,'funding','pending',p_funding_ref,'earning:'||p_key);
end $$;
create function creator_finance.move_earning(p_user uuid,p_currency text,p_amount_minor text,p_from text,p_to text,p_evidence_ref text,p_key text)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if p_currency is distinct from 'USD' or p_amount_minor is null or p_amount_minor !~ '^[1-9][0-9]{0,18}$' then raise exception 'INVALID_AMOUNT_OR_CURRENCY'; end if;
  if not ((p_from='pending' and p_to in ('available','withheld','reversed')) or
    (p_from='available' and p_to in ('withheld','reversed')) or (p_from='withheld' and p_to in ('available','reversed'))) then raise exception 'INVALID_EARNING_TRANSITION'; end if;
  return creator_finance.move(p_user,p_currency,p_amount_minor::bigint,p_from,p_to,p_evidence_ref,'adjustment:'||p_key);
end $$;

-- Call only after authenticating and verifying the provider's canonical receipt.
-- Unknown outcomes leave funds reserved. A rejected outcome is permitted only
-- when the provider guarantees no movement; HTTP failure alone is not rejection.
create function creator_finance.reconcile_payout(p_id uuid,p_provider text,p_event text,p_reference text,p_account_ref text,p_currency text,p_amount_minor text,p_status text)
returns text language plpgsql security definer set search_path = '' as $$
declare q creator_finance.payouts; receipt creator_finance.receipts; payload jsonb;
begin
  select * into q from creator_finance.payouts where id=p_id;
  if not found then raise exception 'PAYOUT_NOT_FOUND'; end if;
  perform 1 from creator_finance.enrollments where user_id=q.user_id for update;
  select * into q from creator_finance.payouts where id=p_id for update;
  if (q.provider_id,q.external_account_ref,q.currency,q.amount_minor::text) is distinct from (p_provider,p_account_ref,p_currency,p_amount_minor)
    or p_status is null or p_status not in ('submitted','unknown','completed','rejected')
    or nullif(p_event,'') is null or nullif(p_reference,'') is null then raise exception 'RECEIPT_MISMATCH'; end if;
  if q.provider_reference is not null and q.provider_reference<>p_reference then raise exception 'RECEIPT_MISMATCH'; end if;
  payload:=jsonb_build_object('id',p_id,'reference',p_reference,'account',p_account_ref,'currency',p_currency,'amount_minor',p_amount_minor,'status',p_status);
  select * into receipt from creator_finance.receipts where provider_id=p_provider and event_id=p_event;
  if found then
    if receipt.payload is distinct from payload then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return q.status;
  end if;
  if q.status in ('completed','rejected') and q.status<>p_status then raise exception 'FINAL_PAYOUT_CONFLICT'; end if;
  if q.status='unknown' and p_status='submitted' then raise exception 'STALE_PAYOUT_EVENT'; end if;
  insert into creator_finance.receipts(provider_id,event_id,payout_id,payload) values(p_provider,p_event,p_id,payload);
  if q.status not in ('completed','rejected') then
    if p_status='completed' then perform creator_finance.move(q.user_id,q.currency,q.amount_minor,'reserved','paid',p_reference,'payout:complete:'||q.id);
    elsif p_status='rejected' then perform creator_finance.move(q.user_id,q.currency,q.amount_minor,'reserved','available',p_reference,'payout:reject:'||q.id); end if;
    update creator_finance.payouts set status=p_status,provider_reference=p_reference,updated_at=now() where id=p_id;
  end if;
  return p_status;
end $$;

-- Narrow invoker wrappers expose only caller-bound operations to the Data API.
create function public.creator_monetization_snapshot() returns jsonb language sql security invoker set search_path = '' as $$ select creator_finance.snapshot(); $$;
create function public.creator_register_interest(p_expected_user uuid) returns text language sql security invoker set search_path = '' as $$ select creator_finance.register_interest(p_expected_user); $$;
create function public.creator_apply(p_expected_user uuid,p_terms_version text) returns text language sql security invoker set search_path = '' as $$ select creator_finance.apply(p_expected_user,p_terms_version); $$;
create function public.creator_request_payout(p_expected_user uuid,p_currency text,p_amount_minor text,p_idempotency_key uuid) returns uuid language sql security invoker set search_path = '' as $$ select creator_finance.request_payout(p_expected_user,p_currency,p_amount_minor,p_idempotency_key); $$;
revoke all on all functions in schema creator_finance from public, anon, authenticated, service_role;
revoke all on function public.creator_monetization_snapshot(),public.creator_register_interest(uuid),public.creator_apply(uuid,text),public.creator_request_payout(uuid,text,text,uuid) from public,anon;
grant usage on schema creator_finance to authenticated,service_role;
grant execute on function creator_finance.snapshot(),creator_finance.register_interest(uuid),creator_finance.apply(uuid,text),creator_finance.request_payout(uuid,text,text,uuid) to authenticated;
grant execute on function public.creator_monetization_snapshot(),public.creator_register_interest(uuid),public.creator_apply(uuid,text),public.creator_request_payout(uuid,text,text,uuid) to authenticated;
grant execute on function creator_finance.record_funded_earning(uuid,text,text,text,text),creator_finance.move_earning(uuid,text,text,text,text,text,text),creator_finance.reconcile_payout(uuid,text,text,text,text,text,text,text) to service_role;
-- No grants to configure readiness or write money tables. Operational adapters
-- must be reviewed separately; adding providers never rewrites historical rows.
commit;
