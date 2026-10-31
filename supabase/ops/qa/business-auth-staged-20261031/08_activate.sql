-- Reviewed business-auth staged installation 8; source SHA256 66a842a61708dbbe5715352484f9bee0c42665e8d2d3418b1a06e65854723996.
-- No statement is hidden or encoded. Original destructive classifications are retained.
begin;
set local lock_timeout='3s';
set local statement_timeout='60s';
set local search_path=pg_catalog;
lock table public.profiles,auth.sessions in share row exclusive mode;

do $stage_guard$
declare stage_relation record;stage_rows bigint;
begin
 if current_user<>'postgres' then raise exception 'BUSINESS_AUTH_POSTGRES_REQUIRED';end if;
 if obj_description(to_regnamespace('business_auth'),'pg_namespace') is distinct from 'business-auth:66a842a61708dbbe5715352484f9bee0c42665e8d2d3418b1a06e65854723996:stage-7' then raise exception 'BUSINESS_AUTH_STAGE_ORDER';end if;
 if (select md5(coalesce(jsonb_agg(jsonb_build_array(k,n,v) order by k,n)::text,'[]')) from (
select 'schema' k,nspname::text n,jsonb_build_array(pg_get_userbyid(nspowner),nspacl::text) v from pg_namespace where nspname='business_auth'
union all select 'function',n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',jsonb_build_array(pg_get_functiondef(p.oid),pg_get_userbyid(p.proowner),p.proacl::text) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='business_auth' or (n.nspname,p.proname) in (('studio_workflow','context'),('public','studio_role'),('public','studio_bind_member'),('public','studio_set_device'),('public','resolve_media_delivery'),('public','triniti_admin_provision'),('public','business_session_allowed'),('public','business_auth_request_guard'),('public','triniti_business_signin_check'),('public','triniti_business_owner_access'),('public','triniti_business_finish_signin'),('public','triniti_business_cancel_signin'))
union all select 'relation',c.relname,jsonb_build_array(c.relkind,c.relrowsecurity,c.relforcerowsecurity,pg_get_userbyid(c.relowner),c.relacl::text) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='business_auth' and c.relkind in('r','p','v','m','f','S')
union all select 'column',c.relname||'.'||a.attnum::text,jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attidentity,a.attgenerated,pg_get_expr(d.adbin,d.adrelid)) from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum where n.nspname='business_auth' and c.relkind in('r','p') and a.attnum>0 and not a.attisdropped
union all select 'constraint',c.relname||'.'||t.conname,to_jsonb(pg_get_constraintdef(t.oid)) from pg_constraint t join pg_class c on c.oid=t.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='business_auth' and t.contype<>'n'
union all select 'index',c.relname,to_jsonb(pg_get_indexdef(c.oid)) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='business_auth' and c.relkind in('i','I')
union all select 'trigger',t.tgrelid::regclass::text||'.'||t.tgname,jsonb_build_array(pg_get_triggerdef(t.oid),t.tgenabled) from pg_trigger t where not t.tgisinternal and t.tgname like 'business_auth_%'
union all select 'policy',p.polrelid::regclass::text||'.'||p.polname,jsonb_build_array(p.polpermissive,p.polcmd,(select jsonb_agg(r.rolname order by r.rolname) from pg_roles r where r.oid=any(p.polroles)),pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid)) from pg_policy p where p.polname='business_session_required' or p.polrelid in(select oid from pg_class where relnamespace=to_regnamespace('business_auth'))
union all select 'hook',coalesce(r.rolname,'ALL')||':'||coalesce(d.datname,'ALL'),to_jsonb(c) from pg_db_role_setting s left join pg_roles r on r.oid=s.setrole left join pg_database d on d.oid=s.setdatabase cross join lateral unnest(s.setconfig) c where c like 'pgrst.db_pre_request=%' and c<>'pgrst.db_pre_request='
) inventory) is distinct from '070a20dc374c50741b19573e21822048' then raise exception 'BUSINESS_AUTH_STAGED_CATALOG_DRIFT';end if;
 for stage_relation in select oid::regclass name from pg_class where relnamespace=to_regnamespace('business_auth') and relkind='r' loop
  execute format('select count(*) from %s',stage_relation.name) into stage_rows;
  if stage_rows<>0 then raise exception 'BUSINESS_AUTH_STAGED_DATA_REVIEW: %',stage_relation.name;end if;
 end loop;
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','creator_finance','marketplace_ops','storage') and c.relkind='r' and not c.relrowsecurity and has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE')) then raise exception 'BUSINESS_AUTH_UNFENCED_TABLE_REVIEW';end if;
 if exists(select 1 from auth.sessions s join public.profiles p on p.id=s.user_id where p.account_type='business') then raise exception 'BUSINESS_AUTH_EXISTING_SESSIONS_CUTOVER_REQUIRED';end if;
end $stage_guard$;
alter function business_auth.business_session_allowed() set schema public;
alter function business_auth.business_auth_request_guard() set schema public;
alter function business_auth.triniti_business_signin_check(text,text,text,text,text) set schema public;
alter function business_auth.triniti_business_owner_access(uuid,uuid,uuid,text,text,text,boolean,uuid) set schema public;
alter function business_auth.triniti_business_finish_signin(uuid,uuid,uuid,text) set schema public;
alter function business_auth.triniti_business_cancel_signin(uuid,uuid,uuid) set schema public;
create trigger business_auth_register_account after insert or update of account_type on public.profiles
 for each row execute function business_auth.register_account();
create trigger business_auth_revoke_member before delete or update of active,code_hash on public.business_access_members
 for each row execute function business_auth.revoke_member_sessions();
create trigger business_auth_revoke_device before delete or update of status on public.business_devices
 for each row execute function business_auth.revoke_device_sessions();
create trigger business_auth_revoke_owner before delete or update on public.business_members
 for each row execute function business_auth.revoke_owner_sessions();
create trigger business_auth_cleanup_session before delete on auth.sessions for each row execute function business_auth.cleanup_session();
-- Retain an internal UUID marker if a profile is later removed or reclassified:
-- a previously issued business JWT must not become an ordinary personal JWT.
insert into business_auth.accounts(business_id) select id from public.profiles where account_type='business';

-- Every request and non-Data-API RLS read must check the same authoritative
-- binding. Personal/anonymous/staff behavior returns true unchanged.
revoke all on function public.business_session_allowed(),public.business_auth_request_guard() from public,anon,authenticated,service_role;
grant execute on function public.business_session_allowed(),public.business_auth_request_guard() to anon,authenticated,service_role;
do $rls$
declare t record;
begin
 for t in select c.oid::regclass name from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where c.relkind='r' and c.relrowsecurity and (n.nspname in('public','creator_finance','marketplace_ops','storage') or (n.nspname='realtime' and c.relname='messages'))
 loop
  execute format('create policy business_session_required on %s as restrictive for all to authenticated using ((select public.business_session_allowed())) with check ((select public.business_session_allowed()))',t.name);
 end loop;
end $rls$;
alter role authenticator set pgrst.db_pre_request='public.business_auth_request_guard';

do $existing_functions$
declare source text;anchor text;
begin
 source:=pg_get_functiondef('studio_workflow.context(uuid)'::regprocedure);
 anchor:=' perform account_erasure.assert_writable(a.user_id);';
 if position(anchor in source)=0 then raise exception 'BUSINESS_AUTH_CONTEXT_ANCHOR';end if;
 source:=replace(source,anchor,E' if not public.business_session_allowed() then raise exception \'WORKFLOW_ACTIVE_SESSION_REQUIRED\' using errcode=\'42501\';end if;\n'||anchor);
 execute source;
 source:=pg_get_functiondef('public.studio_role()'::regprocedure);
 anchor:=' if uid is null or coalesce(auth.jwt()->>''is_anonymous'',''false'')<>''false'' then return null;end if;';
 if position(anchor in source)=0 then raise exception 'BUSINESS_AUTH_ROLE_ANCHOR';end if;
 source:=replace(source,anchor,anchor||E'\n if not public.business_session_allowed() then return null;end if;');execute source;
 source:=pg_get_functiondef('public.studio_set_device(uuid,text)'::regprocedure);
 anchor:='declare a studio_workflow.actor:=studio_workflow.context();d public.business_devices%rowtype;';
 if position(anchor in source)=0 then raise exception 'BUSINESS_AUTH_DEVICE_LOCK_ANCHOR';end if;
 source:=replace(source,anchor,'declare a studio_workflow.actor;d public.business_devices%rowtype;');
 source:=replace(source,E'begin\n perform studio_workflow.require_roles',E'begin\n if auth.uid() is null then raise exception \'WORKFLOW_ACTIVE_SESSION_REQUIRED\' using errcode=\'42501\';end if;\n perform account_erasure.assert_writable(auth.uid());\n perform pg_advisory_xact_lock(hashtextextended(\'studio-access:\'||auth.uid()::text,0));\n a:=studio_workflow.context();\n perform studio_workflow.require_roles');
 execute source;
 source:=pg_get_functiondef('public.resolve_media_delivery(text,text,text)'::regprocedure);
 anchor:=' if not coalesce(allowed,false) then return null;end if;';
 if position(anchor in source)=0 then raise exception 'BUSINESS_AUTH_MEDIA_RESOLVER_ANCHOR';end if;
 source:=replace(source,anchor,' if not coalesce(allowed,false) or (exists(select 1 from business_auth.accounts where business_id=g.user_id) and not business_auth.session_allowed(g.user_id,g.session_id)) then return null;end if;');
 execute source;
 source:=pg_get_functiondef('public.triniti_admin_provision(uuid,uuid,uuid,text,jsonb,text)'::regprocedure);
 anchor:='  update auth.users set banned_until=''infinity'',updated_at=now() where id=j.auth_user_id;';
 if position(anchor in source)=0 then raise exception 'BUSINESS_AUTH_PROVISION_ANCHOR';end if;
 source:=replace(source,anchor,'  -- The random-password, non-deliverable business identity opens only through a bound member/device session. Existing banned identities are never enabled here.');
 execute source;
end $existing_functions$;

create or replace function public.studio_bind_member(p_code text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a studio_workflow.actor:=studio_workflow.context();m public.business_access_members%rowtype;
begin
 if not a.is_business or a.member_id is null or length(coalesce(p_code,'')) not between 4 and 200 then
  raise exception 'BUSINESS_SIGNIN_REQUIRED' using errcode='42501';end if;
 select * into m from public.business_access_members where id=a.member_id and business_id=a.user_id and active
  and upper(code_hash)=upper(encode(extensions.digest(upper(btrim(p_code)),'sha256'),'hex'));
 if not found then raise exception 'BUSINESS_SEAT_SWITCH_REQUIRES_SIGNIN' using errcode='42501';end if;
 return jsonb_build_object('member_id',m.id,'role',m.role,'display_name',m.display_name);
end $$;
revoke all on all functions in schema business_auth from public,anon,authenticated,service_role;
do $service_grants$
declare f record;
begin
 for f in select p.oid::regprocedure name from pg_proc p where p.pronamespace='public'::regnamespace
  and p.proname in('triniti_business_signin_check','triniti_business_owner_access','triniti_business_finish_signin','triniti_business_cancel_signin')
 loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.name);
  execute format('grant execute on function %s to service_role',f.name);
 end loop;
end $service_grants$;
notify pgrst,'reload schema';
notify pgrst,'reload config';
comment on schema business_auth is null;

commit;
