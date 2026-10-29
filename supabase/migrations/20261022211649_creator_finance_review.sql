begin;
create table creator_finance.review_commands(
  actor_id uuid not null, request_key uuid not null, payload jsonb not null,
  result jsonb not null, created_at timestamptz not null default now(), primary key(actor_id,request_key)
);
alter table creator_finance.review_commands enable row level security;
revoke all on creator_finance.review_commands from public,anon,authenticated,service_role;
create trigger immutable_review_commands before update or delete on creator_finance.review_commands for each row execute function creator_finance.immutable_record();
create index creator_enrollment_review_queue on creator_finance.enrollments(updated_at desc,user_id desc);

create function creator_finance.require_staff(p_actor uuid,p_session uuid) returns void language plpgsql stable security definer set search_path='' as $$
begin
  -- Same native-session trust boundary used by the existing staff application.
  if not coalesce(public.triniti_admin_session_check(p_actor,p_session),false) or not exists(
    select 1 from public.admin_users where user_id=p_actor and active and role in ('super_admin','platform_admin','finance_admin')
  ) then raise exception 'ACTIVE_FINANCE_SESSION_REQUIRED'; end if;
  if not exists(select 1 from auth.sessions where id=p_session and user_id=p_actor and aal::text='aal2') then raise exception 'MFA_REQUIRED'; end if;
end $$;
create function public.creator_finance_admin_snapshot(p_actor uuid,p_session uuid,p_before_at timestamptz default null,p_before_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare rows jsonb; cursor_at timestamptz; cursor_id uuid; more boolean;
begin
  perform creator_finance.require_staff(p_actor,p_session);
  if (p_before_at is null)<>(p_before_id is null) then raise exception 'INVALID_PAGE'; end if;
  select coalesce(jsonb_agg(to_jsonb(e) order by e.updated_at desc,e.user_id desc),'[]') into rows from (
    select user_id,status,accepted_terms_version,public_reason,updated_at from creator_finance.enrollments
    where p_before_at is null or (updated_at,user_id)<(p_before_at,p_before_id)
    order by updated_at desc,user_id desc limit 50) e;
  if jsonb_array_length(rows)>0 then
    cursor_at:=(rows->-1->>'updated_at')::timestamptz;cursor_id:=(rows->-1->>'user_id')::uuid;
    select exists(select 1 from creator_finance.enrollments where (updated_at,user_id)<(cursor_at,cursor_id)) into more;
  end if;
  return jsonb_build_object('enrollments',rows,'environment',(select environment from creator_finance.program where singleton),
    'enrollment_open',(select enrollment_open from creator_finance.program where singleton),'policy',public.creator_revenue_policy(),
    'next_cursor',case when more then jsonb_build_object('updated_at',cursor_at,'user_id',cursor_id) else null end,
    'payouts',coalesce((select jsonb_agg(to_jsonb(q)) from (select id,user_id,provider_id,currency,amount_minor::text,environment,status,provider_reference,
      created_at,updated_at,attempts,last_error from creator_finance.payouts order by created_at desc,id desc limit 50)q),'[]'));
end $$;
create function public.creator_finance_review(p_actor uuid,p_session uuid,p_key uuid,p_user uuid,p_expected_updated_at timestamptz,p_status text,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare original creator_finance.enrollments; previous creator_finance.review_commands; payload jsonb; result jsonb;
begin
  perform creator_finance.require_staff(p_actor,p_session);
  if p_key is null or p_user is null or p_expected_updated_at is null or nullif(btrim(p_reason),'') is null or length(p_reason)>2000
    or p_status not in ('approved','rejected','suspended') then raise exception 'INVALID_REVIEW'; end if;
  if p_actor=p_user then raise exception 'SELF_REVIEW_FORBIDDEN'; end if;
  payload:=jsonb_build_object('user_id',p_user,'expected_updated_at',p_expected_updated_at,'status',p_status,'reason',btrim(p_reason));
  perform pg_advisory_xact_lock(hashtextextended(p_actor::text||p_key::text,0));
  select * into previous from creator_finance.review_commands where actor_id=p_actor and request_key=p_key;
  if found then
    if previous.payload is distinct from payload then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return previous.result;
  end if;
  select * into original from creator_finance.enrollments where user_id=p_user for update;
  if not found then raise exception 'CREATOR_NOT_ENROLLED'; end if;
  if original.updated_at is distinct from p_expected_updated_at then raise exception 'CREATOR_REVIEW_CHANGED'; end if;
  if not ((original.status='applied' and p_status in ('approved','rejected'))
    or (original.status='approved' and p_status='suspended') or (original.status='suspended' and p_status='approved')) then raise exception 'INVALID_REVIEW_TRANSITION'; end if;
  update creator_finance.enrollments set status=p_status,public_reason=btrim(p_reason),updated_at=clock_timestamp() where user_id=p_user;
  result:=jsonb_build_object('success',true,'command_key',p_key,'user_id',p_user,'status',p_status);
  insert into public.admin_audit_log(admin_id,action,target_kind,target_id,reason,before,after)
    values(p_actor,'creator_finance_review','creator',p_user::text,btrim(p_reason),to_jsonb(original),jsonb_build_object('status',p_status));
  insert into creator_finance.review_commands(actor_id,request_key,payload,result) values(p_actor,p_key,payload,result);
  return result;
end $$;
revoke all on function creator_finance.require_staff(uuid,uuid),public.creator_finance_admin_snapshot(uuid,uuid,timestamptz,uuid),
  public.creator_finance_review(uuid,uuid,uuid,uuid,timestamptz,text,text) from public,anon,authenticated,service_role;
grant execute on function public.creator_finance_admin_snapshot(uuid,uuid,timestamptz,uuid),public.creator_finance_review(uuid,uuid,uuid,uuid,timestamptz,text,text) to service_role;
commit;
