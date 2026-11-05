-- Return the immutable original version with the capability that already pins it.
-- HLS readiness is optional and must never determine whether originals can be
-- matched to an account-bound encrypted cache after an authorized refresh.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $preflight$
begin
  if to_regprocedure('public.issue_content_media_delivery(jsonb,jsonb)') is null
     or to_regprocedure('media_delivery.require_session()') is null
     or to_regclass('media_delivery.tickets') is null then
    raise exception 'CONTENT_DELIVERY_VERSION_PREREQUISITES_REQUIRED';
  end if;
  if not has_function_privilege('authenticated', 'public.issue_content_media_delivery(jsonb,jsonb)', 'execute')
     or has_function_privilege('anon', 'public.issue_content_media_delivery(jsonb,jsonb)', 'execute')
     or has_function_privilege('service_role', 'public.issue_content_media_delivery(jsonb,jsonb)', 'execute') then
    raise exception 'CONTENT_DELIVERY_VERSION_ISSUER_ACL_CHANGED';
  end if;
end $preflight$;

create function public.issue_content_media_delivery_v2(p_references jsonb default null, p_uploads jsonb default null)
returns table(bucket_id text, object_path text, token text, expires_at timestamptz, object_version text)
language plpgsql security definer set search_path = '' as $$
declare
  sid uuid := media_delivery.require_session();
  viewer uuid := auth.uid();
  issued record;
  version text;
begin
  -- The existing issuer remains the sole authority for readiness, reference
  -- limits, ownership, audience and published-clip eligibility. Do not replace
  -- it or expose the ticket table to any client role.
  for issued in select * from public.issue_content_media_delivery(p_references, p_uploads) loop
    -- Keep this as a separate PL/pgSQL statement. An outer query joining an
    -- issuing function to tickets can use a snapshot predating its inserts.
    -- The primary-key digest lookup adds no Storage scan or readiness wait.
    select t.object_version into version
    from media_delivery.tickets t
    where t.token_digest = extensions.digest(issued.token, 'sha256')
      and t.user_id = viewer and t.session_id = sid
      and t.bucket_id = issued.bucket_id and t.object_path = issued.object_path
      and t.expires_at = issued.expires_at and t.expires_at > clock_timestamp();
    if not found or version is null or length(version) not between 1 and 128 then
      raise exception 'CONTENT_DELIVERY_TICKET_VERSION_UNAVAILABLE' using errcode = '55000';
    end if;
    return query select issued.bucket_id, issued.object_path, issued.token, issued.expires_at, version;
  end loop;
end $$;
revoke all on function public.issue_content_media_delivery_v2(jsonb,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.issue_content_media_delivery_v2(jsonb,jsonb) to authenticated;

notify pgrst, 'reload schema';
commit;
