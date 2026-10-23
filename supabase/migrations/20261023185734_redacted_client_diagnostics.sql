-- Devices cannot select diagnostics or submit raw stack traces and arbitrary identities.
-- This migration does not delete historical reports.
revoke all on public.client_errors from anon, authenticated;
drop policy if exists "cerr_insert_any" on public.client_errors;
create index if not exists client_errors_user_recent_idx on public.client_errors(user_id, created_at desc);

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.report_client_error(p_report jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_category text;
  v_source text;
  v_platform text;
  v_version text;
begin
  if v_user is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_report is null or jsonb_typeof(p_report) <> 'object' or octet_length(p_report::text) > 2048 then return false; end if;
  v_category := p_report->>'category';
  if v_category is null or v_category <> all(array['Error','TypeError','RangeError','ReferenceError','SyntaxError','URIError','EvalError','AbortError','TimeoutError','NetworkError','AuthError','PostgrestError','StorageError','UnknownError']) then v_category := 'UnknownError'; end if;
  v_source := p_report->>'source';
  if v_source is null or v_source <> all(array['render','global','promise','feed','unknown']) then v_source := 'unknown'; end if;
  v_platform := p_report->>'platform';
  if v_platform is null or v_platform <> all(array['ios','android','web','admin','unknown']) then v_platform := 'unknown'; end if;
  v_version := p_report->>'appVersion';
  if v_version is null or v_version !~ '^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}(-[a-z0-9.]{1,16})?$' then v_version := null; end if;
  -- Serialize the per-account budget across tabs/devices, including simultaneous requests.
  perform pg_advisory_xact_lock(hashtextextended('client-diagnostics:' || v_user::text, 0));
  if (select count(*) from public.client_errors where user_id=v_user and created_at > now()-interval '10 minutes') >= 10 then return false; end if;
  if exists (select 1 from public.client_errors where user_id=v_user and created_at > now()-interval '1 minute'
      and message=v_category and platform=v_platform and context->>'source'=v_source) then return false; end if;
  insert into public.client_errors(user_id,message,stack,context,platform,app_version)
  values(v_user,v_category,null,jsonb_build_object('version',1,'source',v_source,'fatal',coalesce(p_report->'fatal'='true'::jsonb,false)),v_platform,v_version);
  return true;
end; $$;
revoke all on function private.report_client_error(jsonb) from public, anon;
grant execute on function private.report_client_error(jsonb) to authenticated;

create or replace function public.report_client_error(p_report jsonb)
returns boolean language sql security invoker set search_path = '' as $$
  select private.report_client_error(p_report);
$$;
revoke all on function public.report_client_error(jsonb) from public, anon;
grant execute on function public.report_client_error(jsonb) to authenticated;
