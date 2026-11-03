-- Explicit database-owner operations, never a scheduler or user-facing API.
-- The transport token is random, single-use, expires in two minutes, and is
-- stored here only as a SHA-256 digest. No Daily/signing secret is copied to SQL.
set local lock_timeout = '3s';
set local statement_timeout = '30s';

create table live_streams.provider_operations (
  id uuid primary key default gen_random_uuid(),
  action text not null check (action in ('register_webhook', 'verify_storage')),
  reason text not null check (char_length(btrim(reason)) between 8 and 240),
  requested_by text not null default session_user,
  project_origin text not null check (project_origin ~ '^https://[a-z0-9]{20}[.]supabase[.]co$'),
  token_digest bytea not null unique check (octet_length(token_digest) = 32),
  request_id bigint unique,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  claimed_at timestamptz,
  finished_at timestamptz,
  succeeded boolean,
  result jsonb,
  check (expires_at > created_at and expires_at <= created_at + interval '2 minutes'),
  check (claimed_at is null or claimed_at >= created_at),
  check (finished_at is null or (claimed_at is not null and finished_at >= claimed_at)),
  check ((finished_at is null and succeeded is null and result is null)
    or (finished_at is not null and succeeded is not null and jsonb_typeof(result) = 'object'))
);
create index live_provider_operations_active on live_streams.provider_operations(expires_at) where finished_at is null;
create index live_provider_operations_recent on live_streams.provider_operations(created_at desc);
alter table live_streams.provider_operations enable row level security;
revoke all on live_streams.provider_operations from public, anon, authenticated, service_role;

-- SECURITY INVOKER is intentional: only the database owner has table/queue
-- privileges. Even an accidental extra EXECUTE grant cannot mint a token.
create function live_streams.enqueue_provider_operation(p_action text, p_reason text)
returns jsonb language plpgsql security invoker set search_path = '' as $body$
declare origin text; issued timestamptz := clock_timestamp(); token text;
  operation_id uuid := gen_random_uuid(); dispatched bigint;
begin
  if p_action is null or p_action not in ('register_webhook','verify_storage')
    or p_reason is null or char_length(btrim(p_reason)) not between 8 and 240 then
    raise exception 'INVALID_PROVIDER_OPERATION';
  end if;
  perform pg_advisory_xact_lock(20261103,50013);
  select project_origin into origin from live_streams.worker_settings where singleton;
  if origin is null or origin !~ '^https://[a-z0-9]{20}[.]supabase[.]co$' then raise exception 'PROVIDER_ORIGIN_NOT_CONFIGURED'; end if;
  if exists(select 1 from live_streams.provider_operations where finished_at is null and expires_at > issued)
    or exists(select 1 from live_streams.provider_operations where created_at > issued - interval '55 seconds') then
    return null;
  end if;
  token := 'pc_live_config_' || encode(extensions.gen_random_bytes(32),'hex');
  insert into live_streams.provider_operations(id,action,reason,requested_by,project_origin,token_digest,created_at,expires_at)
    values(operation_id,p_action,btrim(p_reason),session_user,origin,extensions.digest(token,'sha256'),issued,issued + interval '2 minutes');
  select net.http_post(url := origin || '/functions/v1/live-provider-configure',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || token),
    body := '{}'::jsonb, timeout_milliseconds := 60000) into dispatched;
  update live_streams.provider_operations set request_id = dispatched where id = operation_id;
  return jsonb_build_object('operation_id',operation_id,'request_id',dispatched);
end $body$;
revoke all on function live_streams.enqueue_provider_operation(text,text) from public, anon, authenticated, service_role;

create function public.claim_live_provider_operation_v1(p_token text, p_project_origin text)
returns jsonb language plpgsql security definer set search_path = '' as $body$
declare claimed timestamptz := clock_timestamp(); operation live_streams.provider_operations%rowtype;
begin
  if auth.jwt()->>'role' is distinct from 'service_role' or p_token is null or p_token !~ '^pc_live_config_[a-f0-9]{64}$'
    or p_project_origin is null or p_project_origin !~ '^https://[a-z0-9]{20}[.]supabase[.]co$' then return null; end if;
  update live_streams.provider_operations set claimed_at = claimed
    where token_digest = extensions.digest(p_token,'sha256') and project_origin = p_project_origin
      and claimed_at is null and finished_at is null and expires_at > claimed + interval '60 seconds'
    returning * into operation;
  if not found then return null; end if;
  return jsonb_build_object('operation_id',operation.id,'action',operation.action,
    'project_origin',operation.project_origin,'expires_at',operation.expires_at);
end $body$;

create function public.finish_live_provider_operation_v1(p_token text, p_succeeded boolean, p_result jsonb)
returns boolean language plpgsql security definer set search_path = '' as $body$
declare finished timestamptz := clock_timestamp(); code text; matched uuid; operation_action text;
begin
  if auth.jwt()->>'role' is distinct from 'service_role' or p_succeeded is null
    or p_token is null or p_token !~ '^pc_live_config_[a-f0-9]{64}$'
    or coalesce(jsonb_typeof(p_result),'') <> 'object' or octet_length(p_result::text) > 2048 then return false; end if;
  if p_result - array['code','resource_id','mutation_attempted','configuration_matches','cleanup_confirmed','provider_status','provider_error','provider_reason'] <> '{}'::jsonb
    or coalesce(jsonb_typeof(p_result->'code'),'') <> 'string'
    or coalesce(jsonb_typeof(p_result->'mutation_attempted'),'') <> 'boolean' then return false; end if;
  code := p_result->>'code';
  if code not in ('WEBHOOK_REGISTERED','WEBHOOK_ALREADY_CONFIGURED','STORAGE_VERIFIED',
    'PROVIDER_CONFIG_INVALID','PROVIDER_RESPONSE_INVALID','PROVIDER_REQUEST_FAILED','PROVIDER_REQUEST_REJECTED',
    'PROVIDER_TIMEOUT','PROVIDER_DOMAIN_MISMATCH','PROVIDER_WEBHOOK_CONFLICT','PROVIDER_VERIFICATION_FAILED',
    'STORAGE_VERIFICATION_FAILED','STORAGE_CLEANUP_UNCONFIRMED','INVALID_OPERATION','DATABASE_UNAVAILABLE','COMPLETION_UNCONFIRMED') then return false; end if;
  if p_succeeded is distinct from (code in ('WEBHOOK_REGISTERED','WEBHOOK_ALREADY_CONFIGURED','STORAGE_VERIFIED')) then return false; end if;
  if p_result ? 'resource_id' and (coalesce(jsonb_typeof(p_result->'resource_id'),'') <> 'string'
    or p_result->>'resource_id' !~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$') then return false; end if;
  if p_result ? 'configuration_matches' and jsonb_typeof(p_result->'configuration_matches') <> 'boolean' then return false; end if;
  if p_result ? 'cleanup_confirmed' and jsonb_typeof(p_result->'cleanup_confirmed') <> 'boolean' then return false; end if;
  if p_result ? 'provider_status' and (jsonb_typeof(p_result->'provider_status') <> 'number'
    or p_result->>'provider_status' !~ '^[1-5][0-9]{2}$') then return false; end if;
  if p_result ? 'provider_error' and (jsonb_typeof(p_result->'provider_error') <> 'string'
    or p_result->>'provider_error' not in ('invalid-request-error','authentication-error','authorization-error','not-found-error','rate-limit-error','unclassified')) then return false; end if;
  if p_result ? 'provider_reason' and (jsonb_typeof(p_result->'provider_reason') <> 'string'
    or p_result->>'provider_reason' not in ('billing_required','role_assumption_denied','storage_access_denied','configuration_invalid','unclassified')) then return false; end if;
  select action into operation_action from live_streams.provider_operations
    where token_digest = extensions.digest(p_token,'sha256') and claimed_at is not null and finished_at is null and expires_at > finished for update;
  if not found then return false; end if;
  if p_succeeded and (not (p_result ? 'resource_id') or p_result->'configuration_matches' is distinct from 'true'::jsonb
    or (operation_action = 'register_webhook' and code not in ('WEBHOOK_REGISTERED','WEBHOOK_ALREADY_CONFIGURED'))
    or (operation_action = 'verify_storage' and (code <> 'STORAGE_VERIFIED' or p_result->'cleanup_confirmed' is distinct from 'true'::jsonb))) then return false; end if;
  update live_streams.provider_operations set finished_at = finished, succeeded = p_succeeded, result = p_result
    where token_digest = extensions.digest(p_token,'sha256') and claimed_at is not null and finished_at is null and expires_at > finished returning id into matched;
  return matched is not null;
end $body$;
revoke all on function public.claim_live_provider_operation_v1(text,text), public.finish_live_provider_operation_v1(text,boolean,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_live_provider_operation_v1(text,text), public.finish_live_provider_operation_v1(text,boolean,jsonb) to service_role;

comment on table live_streams.provider_operations is 'Owner-issued, audited, short-lived provider setup operations; no reusable credentials or provider responses.';
comment on function live_streams.enqueue_provider_operation(text,text) is 'Owner only. Explicit register_webhook or verify_storage; no scheduler, arbitrary target, or provider payload.';
