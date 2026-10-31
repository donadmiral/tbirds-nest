-- QA-only forward upgrade for the exact 29 October uaulhuelcfkjwojtymmw catalog.
-- The existing QA database already has admin tables, grants and guard triggers.
-- No reset, collision-guard bypass, account creation, grants to app callers, or row edits.
-- This file is outside supabase/migrations so it cannot run in a production db push.
begin;
set local lock_timeout='3s';
set local search_path=public,extensions;

do $preflight$
declare actual jsonb; expected record;
begin
 select catalog into actual from (select jsonb_build_object('functions',(select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'md5',md5(pg_get_functiondef(p.oid)),'definition',pg_get_functiondef(p.oid),'acl',p.proacl::text) order by p.oid::regprocedure::text) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='admin_ops' or n.nspname='public' and (p.proname like 'triniti_%admin%' or p.proname in ('update_comment_count','sync_post_comment_count','sync_post_comments_count','admin_support_triage_read','admin_support_triage_update','admin_seller_review_reports','moderate_seller_review'))),'tables',(select jsonb_agg(jsonb_build_object('name',c.relname,'rls',c.relrowsecurity,'acl',c.relacl::text,'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid)) order by a.attnum) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),'constraints',(select jsonb_agg(pg_get_constraintdef(oid) order by conname) from pg_constraint where conrelid=c.oid and contype<>'n'),'indexes',(select jsonb_agg(indexdef order by indexname) from pg_indexes where schemaname='admin_ops' and tablename=c.relname)) order by c.relname) from pg_class c where c.relnamespace=to_regnamespace('admin_ops') and c.relkind='r'),'triggers',(select jsonb_agg(jsonb_build_object('table',t.tgrelid::regclass::text,'name',t.tgname,'definition',pg_get_triggerdef(t.oid),'enabled',t.tgenabled) order by t.tgname,t.tgrelid::regclass::text) from pg_trigger t join pg_proc p on p.oid=t.tgfoid where not t.tgisinternal and p.pronamespace=to_regnamespace('admin_ops')),'policies',(select jsonb_agg(to_jsonb(p) order by tablename,policyname) from pg_policies p where schemaname in ('admin_ops') or schemaname='public' and tablename in ('verification_applications','user_reports','admin_users','admin_audit_log')),'preserved_counts',jsonb_build_object('auth_users',(select count(*) from auth.users),'admin_users',(select count(*) from public.admin_users),'profiles',(select count(*) from public.profiles),'storage_objects',(select count(*) from storage.objects))) catalog) captured;
 if md5((actual-'functions'-'preserved_counts')::text) is distinct from '1037d3e0ac21d797e6dd7dd17c987581'
  or jsonb_array_length(actual->'functions') is distinct from 22 then
  raise exception 'QA_ADMIN_STRUCTURE_DRIFT';
 end if;
 for expected in select * from (values
  ('admin_ops.capture_removal()','bf89643fce4a977f7de52ba97b865109','{postgres=X/postgres}'),
  ('admin_ops.guard_profile_verification()','da38b04a1e00c632e71780ad9d345775','{postgres=X/postgres}'),
  ('admin_ops.guard_removed_content()','c8c3e0d6501a7578b8938fc99a3583bf','{postgres=X/postgres}'),
  ('admin_ops.guard_verification_application()','4d4d16b1a6dd927221712611704c93dd','{postgres=X/postgres}'),
  ('admin_ops.lock_staff_governance()','1b7f11a1cbf1774df91fe6b9b4e3dbde','{postgres=X/postgres}'),
  ('admin_ops.require_session(uuid,uuid,text)','2a59dac44760254e1f2e730c6154d9a9','{postgres=X/postgres,service_role=X/postgres}'),
  ('admin_ops.retire_single_owner_access()','0265fc0e11a6d0883344834031322a52','{postgres=X/postgres}'),
  ('admin_ops.single_owner_access(uuid)','db2a58f26c3594cc97390083bbe87566','{postgres=X/postgres}'),
  ('admin_ops.sync_verification_revocation()','61fceb5d957ba77a9cb069c440d69a98','{postgres=X/postgres}'),
  ('admin_ops.validate_verification_evidence(text,text,jsonb)','f35f12d5375657ddd58b88c4073b3266','{postgres=X/postgres}'),
  ('public.admin_seller_review_reports(uuid,uuid,timestamp with time zone,uuid,text)','1d53c63fc9a4e88440c7b6ca4e302b4a','{postgres=X/postgres,service_role=X/postgres}'),
  ('public.admin_support_triage_read(uuid[])','86ae7abaa9f2bd5ff3fdfc6c86a29871','{postgres=X/postgres,service_role=X/postgres}'),
  ('public.admin_support_triage_update(uuid,uuid,uuid,uuid,integer,uuid,text,text,boolean,text)','78f68a7cd4804f5dc4235924fd62668c','{postgres=X/postgres,service_role=X/postgres}'),
  ('public.moderate_seller_review(uuid,uuid,uuid,uuid,text,text,integer)','b4d0a3bc989f29d8f8426ea490354014','{postgres=X/postgres,service_role=X/postgres}'),
  ('public.sync_post_comment_count()','d2ec097054f70c24afe98fbcdea421fb','{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
  ('public.sync_post_comments_count()','3ab906717a2fdc32cb379516b859d48b','{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
  ('public.triniti_admin_deletion_requests(uuid,uuid,integer)','88a277b95fa24808ceee76ceb57ef7c2','{postgres=X/postgres,service_role=X/postgres}'),
  ('public.triniti_admin_provision(uuid,uuid,uuid,text,jsonb,text)','7a9c7b0543fb78d555b2a7a1478c667c','{postgres=X/postgres,service_role=X/postgres}'),
  ('public.triniti_admin_session_check(uuid,uuid)','ba2e1c694288129ee94d8b6d06746eef','{postgres=X/postgres,service_role=X/postgres}'),
  ('public.triniti_admin_single_owner_access(uuid,uuid)','5bb6dd8695914cf8fb4f460be6e663e0','{postgres=X/postgres,service_role=X/postgres}'),
  ('public.triniti_platinum_admin_command(uuid,uuid,uuid,text,jsonb)','9db1e605fc51a9e2b7860abee91f1a43','{postgres=X/postgres,service_role=X/postgres}'),
  ('public.update_comment_count()','008f18da2039b8c91219ed1ac989aafb','{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}')
 ) as definitions(signature,definition_md5,acl) loop
  if to_regprocedure(expected.signature) is null or
   md5(pg_get_functiondef(to_regprocedure(expected.signature))) is distinct from expected.definition_md5 or
   (select proacl::text from pg_proc where oid=to_regprocedure(expected.signature)) is distinct from expected.acl then
   raise exception 'QA_ADMIN_DEFINITION_OR_GRANT_DRIFT: %',expected.signature;
  end if;
 end loop;
end $preflight$;

create or replace function public.triniti_platinum_admin_command(
 p_actor_id uuid,p_session_id uuid,p_key uuid,p_operation text,p_payload jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
#variable_conflict use_variable
declare perm text; allowed text[]; id uuid; target uuid; old jsonb; after_row jsonb;
 c admin_ops.commands%rowtype; application_row public.verification_applications%rowtype;
 report jsonb; reason text:=nullif(btrim(p_payload->>'reason'),''); role_name text;
 target_kind text; target_text text; status_value text; changed integer; days integer;
 result_value jsonb; field_name text;
begin
 if p_key is null or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>32768 then
  raise exception 'INVALID_COMMAND' using errcode='22023'; end if;
 -- One staff-governance lock precedes actor row locks in every staff change.
 -- This prevents two simultaneous changes removing the last super administrator.
 if p_operation in ('setStaffRole','deactivateStaff','adminDeleteAccount','suspendUser','issueStrike') then
  perform pg_advisory_xact_lock(77123,1);
 end if;
 case p_operation
 when 'approveApplication','rejectApplication','revokeVerification' then perm:='verification'; allowed:=array['id','reason'];
 when 'suspendUser','restoreUser' then perm:='user_moderate'; allowed:=array['id','reason'];
 when 'issueStrike','liftRestriction' then perm:='user_moderate'; allowed:=array['uid','level','days','reason'];
 when 'dismissReport' then
  if p_payload->>'table' not in ('post_reports','listing_reports') or p_payload->>'table' is null then raise exception 'INVALID_REPORT_TABLE'; end if;
  perm:=case when p_payload->>'table'='listing_reports' then 'report_listing' else 'report_post' end; allowed:=array['rid','table'];
 when 'removeReportedPost' then perm:='report_post'; allowed:=array['rid','pid'];
 when 'removeReportedListing' then perm:='report_listing'; allowed:=array['rid','lid'];
 when 'resolveUserReport' then perm:='report_user'; allowed:=array['rid','outcome'];
 when 'adminRemovePost' then perm:='post_moderate'; allowed:=array['pid'];
 when 'adminRemoveStory' then perm:='post_moderate'; allowed:=array['sid'];
 when 'adminRemoveListing' then perm:='market_moderate'; allowed:=array['lid'];
 when 'adminRemoveComment' then perm:='comment_delete'; allowed:=array['cid'];
 when 'resolveTicket' then perm:='support'; allowed:=array['tid','rid'];
 when 'setTicketStatus','sendTicketReply' then perm:='support'; allowed:=array['tid','status','body'];
 when 'approveCampaign','rejectCampaign','adminEndCampaign' then perm:='ads'; allowed:=array['id','reason'];
 when 'setStaffRole','deactivateStaff' then perm:='staff_manage'; allowed:=array['uid','role'];
 when 'toggleFlag' then perm:='system'; allowed:=array['key','to'];
 when 'publishAnnouncement' then perm:='system'; allowed:=array['title','body'];
 when 'retireAnnouncement' then perm:='system'; allowed:=array['id'];
 when 'addBlockedWord','removeBlockedWord' then perm:='system'; allowed:=array['word'];
 when 'rejectBusinessApplication' then perm:='business_manage'; allowed:=array['id','reason'];
 when 'archiveOrganization','restoreOrganization','adminTransferOwnership' then perm:='organization_manage'; allowed:=array['id','username'];
 when 'adminDeleteAccount' then perm:='account_delete'; allowed:=array['id','reason','confirm'];
 else raise exception 'UNKNOWN_ADMIN_OPERATION' using errcode='22023';
 end case;
 perform admin_ops.require_session(p_actor_id,p_session_id,perm);
 for field_name in select jsonb_object_keys(p_payload) loop
  if not field_name=any(allowed) or jsonb_typeof(p_payload->field_name)<>'string' then raise exception 'INVALID_COMMAND_FIELD' using errcode='22023'; end if;
 end loop;
 insert into admin_ops.commands(command_key,actor_id,operation,payload)
 values(p_key,p_actor_id,p_operation,p_payload) on conflict do nothing;
 select * into c from admin_ops.commands where command_key=p_key for update;
 if c.actor_id<>p_actor_id or c.operation<>p_operation or c.payload<>p_payload then raise exception 'COMMAND_KEY_REUSED' using errcode='22023'; end if;
 if c.result is not null then return c.result; end if;
 target_kind:=perm;
 if p_operation in ('rejectApplication','suspendUser','issueStrike','rejectCampaign','rejectBusinessApplication','adminDeleteAccount') and (reason is null or length(reason)>2000) then raise exception 'REASON_REQUIRED' using errcode='22023'; end if;
 if p_payload ? 'id' then id:=(p_payload->>'id')::uuid;
 elsif p_payload ? 'uid' then id:=(p_payload->>'uid')::uuid;
 elsif p_payload ? 'rid' then id:=(p_payload->>'rid')::uuid;
 elsif p_payload ? 'pid' then id:=(p_payload->>'pid')::uuid;
 elsif p_payload ? 'lid' then id:=(p_payload->>'lid')::uuid;
 elsif p_payload ? 'sid' then id:=(p_payload->>'sid')::uuid;
 elsif p_payload ? 'cid' then id:=(p_payload->>'cid')::uuid;
 elsif p_payload ? 'tid' then id:=(p_payload->>'tid')::uuid;
 end if;
 target_text:=id::text;
 case
 when p_operation in ('approveApplication','rejectApplication') then
  select * into application_row from public.verification_applications where verification_applications.id=id for update;
  if not found then raise exception 'TARGET_NOT_FOUND'; end if;
  if application_row.status not in ('submitted','under_review') then raise exception 'APPLICATION_NOT_PENDING'; end if;
  old:=to_jsonb(application_row); target_kind:='verification_application';
  if p_operation='approveApplication' then
   update public.profiles set is_verified=true,verified_tier=application_row.tier,verified_category=application_row.category,updated_at=now() where profiles.id=application_row.applicant_id;
   if not found then raise exception 'TARGET_NOT_FOUND'; end if;
  end if;
  update public.verification_applications set status=case when p_operation='approveApplication' then 'approved' else 'rejected' end,
   reviewer_id=p_actor_id,decision_reason=reason,decided_at=now() where verification_applications.id=id returning to_jsonb(verification_applications.*) into after_row;
 when p_operation in ('suspendUser','restoreUser','revokeVerification','issueStrike','liftRestriction','adminDeleteAccount') then
  select to_jsonb(p) into old from public.profiles p where p.id=id for update;
  if old is null then raise exception 'TARGET_NOT_FOUND'; end if; target_kind:='profile';
  if p_operation in ('suspendUser','issueStrike','adminDeleteAccount') and exists(select 1 from public.admin_users where user_id=id and active) then raise exception 'ACTIVE_STAFF_DELETION_FORBIDDEN'; end if;
  if p_operation='revokeVerification' then
   update public.profiles set is_verified=false,verified_tier=null,verified_category=null,updated_at=now() where profiles.id=id;
  elsif p_operation in ('restoreUser','liftRestriction') then
   if exists(select 1 from admin_ops.deletion_requests where user_id=id and status<>'cancelled') then raise exception 'DELETION_REVIEW_REQUIRED'; end if;
   if p_operation='restoreUser' then
    update public.profiles set deactivated_at=null,suspended_reason=null,suspended_by=null,updated_at=now() where profiles.id=id;
    update auth.users set banned_until=null,updated_at=now() where users.id=id;
   else update public.profiles set restricted_until=null,updated_at=now() where profiles.id=id; end if;
  elsif p_operation='adminDeleteAccount' then
   if p_payload->>'confirm' is distinct from 'DELETE' then raise exception 'DELETE_CONFIRMATION_REQUIRED'; end if;
   if exists(select 1 from public.org_memberships where user_id=id and role='owner' and (expires_at is null or expires_at>now()))
      or exists(select 1 from public.business_members where member_id=id and role='owner') then raise exception 'TRANSFER_ORGANIZATION_OWNERSHIP_FIRST'; end if;
   insert into admin_ops.deletion_requests(user_id,requested_by,reason) values(id,p_actor_id,reason)
    on conflict(user_id) do update set status='retention_review',requested_by=excluded.requested_by,reason=excluded.reason where deletion_requests.status='cancelled';
   update public.profiles set deactivated_at=now(),suspended_reason=reason,suspended_by=p_actor_id,push_token=null,updated_at=now() where profiles.id=id;
   update auth.users set banned_until='infinity',updated_at=now() where users.id=id;
   delete from auth.sessions where user_id=id;
  else
   if p_operation='issueStrike' then
    if p_payload->>'level' is null or p_payload->>'level' not in ('warn','restrict','suspend','ban') then raise exception 'INVALID_STRIKE_LEVEL'; end if;
    if p_payload->>'level'='restrict' then
     days:=(p_payload->>'days')::integer;
     if days is null or days not between 1 and 90 then raise exception 'INVALID_RESTRICTION_DAYS'; end if;
    end if;
    insert into public.member_strikes(user_id,level,reason,issued_by,expires_at)
    values(id,p_payload->>'level',reason,p_actor_id,case when days is not null then now()+make_interval(days=>days) else null end);
   end if;
   if p_operation='suspendUser' or p_payload->>'level' in ('suspend','ban') then
    update public.profiles set deactivated_at=now(),suspended_reason=reason,suspended_by=p_actor_id,push_token=null,updated_at=now() where profiles.id=id;
    update auth.users set banned_until='infinity',updated_at=now() where users.id=id;
    delete from auth.sessions where user_id=id;
   elsif p_payload->>'level'='restrict' then
    update public.profiles set restricted_until=greatest(restricted_until,now()+make_interval(days=>days)),updated_at=now() where profiles.id=id;
   end if;
  end if;
  select to_jsonb(p) into after_row from public.profiles p where p.id=id;
 when p_operation in ('dismissReport','removeReportedPost','removeReportedListing','resolveUserReport') then
  if p_operation='removeReportedPost' or (p_operation='dismissReport' and p_payload->>'table'='post_reports') then
   select to_jsonb(r) into report from public.post_reports r where r.id=id for update; target_kind:='post_report';
  elsif p_operation='resolveUserReport' then
   select to_jsonb(r) into report from public.user_reports r where r.id=id for update; target_kind:='user_report';
  else select to_jsonb(r) into report from public.listing_reports r where r.id=id for update; target_kind:='listing_report'; end if;
  if report is null then raise exception 'TARGET_NOT_FOUND'; end if;
  if report->>'status'<>'open' then raise exception 'REPORT_NOT_OPEN'; end if; old:=report;
  status_value:=case when p_operation='dismissReport' then 'dismissed' when p_operation='resolveUserReport' then p_payload->>'outcome' else 'actioned' end;
  if status_value is null or status_value not in ('actioned','dismissed') then raise exception 'INVALID_REPORT_OUTCOME'; end if;
  if p_operation='removeReportedPost' then
   target:=(p_payload->>'pid')::uuid;
   if target is null or target is distinct from (report->>'post_id')::uuid then raise exception 'REPORT_TARGET_MISMATCH'; end if;
   delete from public.posts where posts.id=target;
  elsif p_operation='removeReportedListing' then
   target:=(p_payload->>'lid')::uuid;
   if target is null or target is distinct from (report->>'listing_id')::uuid then raise exception 'REPORT_TARGET_MISMATCH'; end if;
   update public.marketplace_listings set status='removed',hidden_at=now(),updated_at=now() where marketplace_listings.id=target;
  end if;
  if target_kind='post_report' then update public.post_reports set status=status_value,resolved_by=p_actor_id,resolved_at=now() where post_reports.id=id;
  elsif target_kind='listing_report' then update public.listing_reports set status=status_value,resolved_by=p_actor_id,resolved_at=now() where listing_reports.id=id;
  else update public.user_reports set status='closed',resolved_by=p_actor_id,resolved_at=now() where user_reports.id=id; end if;
  after_row:=report||jsonb_build_object('status',case when target_kind='user_report' then 'closed' else status_value end,'resolution_outcome',status_value,'resolved_by',p_actor_id,'resolved_at',now());
 when p_operation in ('adminRemovePost','adminRemoveStory','adminRemoveListing','adminRemoveComment') then
  if p_operation='adminRemovePost' then delete from public.posts where posts.id=id returning to_jsonb(posts.*) into old; target_kind:='post';
  elsif p_operation='adminRemoveStory' then delete from public.stories where stories.id=id returning to_jsonb(stories.*) into old; target_kind:='story';
  elsif p_operation='adminRemoveComment' then delete from public.post_comments where post_comments.id=id returning to_jsonb(post_comments.*) into old; target_kind:='comment';
  else
   select to_jsonb(l) into old from public.marketplace_listings l where l.id=id for update;
   update public.marketplace_listings set status='removed',hidden_at=now(),updated_at=now() where marketplace_listings.id=id returning to_jsonb(marketplace_listings.*) into after_row; target_kind:='listing';
  end if;
  if old is null then raise exception 'TARGET_NOT_FOUND'; end if;
 when p_operation in ('resolveTicket','setTicketStatus','sendTicketReply') then
  if p_payload ? 'tid' and p_payload ? 'rid' and p_payload->>'tid' is distinct from p_payload->>'rid' then raise exception 'INVALID_COMMAND_FIELD'; end if;
  select to_jsonb(t) into old from public.support_tickets t where t.id=id for update;
  if old is null then raise exception 'TARGET_NOT_FOUND'; end if; target_kind:='support_ticket';
  if p_operation='sendTicketReply' then
   if length(btrim(coalesce(p_payload->>'body',''))) not between 1 and 10000 then raise exception 'INVALID_REPLY'; end if;
   insert into public.support_messages(ticket_id,sender,body,sender_id) values(id,'ops',btrim(p_payload->>'body'),p_actor_id);
   status_value:='pending';
  else status_value:=case when p_operation='resolveTicket' then 'solved' else p_payload->>'status' end; end if;
  if status_value is null or status_value not in ('open','pending','solved') then raise exception 'INVALID_TICKET_STATUS'; end if;
  update public.support_tickets set status=status_value,updated_at=now(),
   resolved_by=case when status_value='solved' then p_actor_id else null end,
   resolved_at=case when status_value='solved' then now() else null end
   where support_tickets.id=id returning to_jsonb(support_tickets.*) into after_row;
 when p_operation in ('approveCampaign','rejectCampaign','adminEndCampaign') then
  select to_jsonb(s) into old from public.studio_campaigns s where s.id=id for update;
  if old is null then raise exception 'TARGET_NOT_FOUND'; end if; target_kind:='campaign';
  if p_operation<>'adminEndCampaign' and old->>'status'<>'submitted' then raise exception 'APPLICATION_NOT_PENDING'; end if;
  if p_operation='adminEndCampaign' and old->>'status' not in ('approved','live','paused') then raise exception 'CAMPAIGN_NOT_ACTIVE'; end if;
  -- Content approval never manufactures payment evidence. Provider callbacks own funding.
  update public.studio_campaigns set status=case p_operation when 'approveCampaign' then 'approved' when 'rejectCampaign' then 'rejected' else 'ended' end,
   review_note=reason,reviewed_at=now(),updated_at=now() where studio_campaigns.id=id returning to_jsonb(studio_campaigns.*) into after_row;
 when p_operation in ('setStaffRole','deactivateStaff') then
  select to_jsonb(u) into old from public.admin_users u where u.user_id=id for update;
  if old is null then raise exception 'TARGET_NOT_FOUND'; end if; target_kind:='staff'; role_name:=p_payload->>'role';
  if p_operation='setStaffRole' and (role_name is null or role_name not in ('super_admin','platform_admin','trust_safety','support_agent','ops_engineer','market_reviewer','jobs_reviewer','verification_reviewer','finance_admin','analyst','auditor_readonly')) then raise exception 'INVALID_STAFF_ROLE'; end if;
  if (old->>'active')::boolean and old->>'role'='super_admin' and (p_operation='deactivateStaff' or role_name<>'super_admin')
    and not exists(select 1 from public.admin_users where active and role='super_admin' and user_id<>id) then raise exception 'LAST_SUPER_ADMIN'; end if;
  update public.admin_users set role=case when p_operation='setStaffRole' then role_name else role end,active=case when p_operation='deactivateStaff' then false else active end
   where user_id=id returning to_jsonb(admin_users.*) into after_row;
  if p_operation='deactivateStaff' then delete from auth.sessions where user_id=id; end if;
 when p_operation='toggleFlag' then
  if p_payload->>'to' is null or p_payload->>'to' not in ('on','off') then raise exception 'INVALID_FLAG_VALUE'; end if;
  target_kind:='feature_flag'; target_text:=p_payload->>'key';
  select to_jsonb(f) into old from public.feature_flags f where key=target_text for update;
  if old is null then raise exception 'TARGET_NOT_FOUND'; end if;
  update public.feature_flags set enabled=p_payload->>'to'='on',updated_by=p_actor_id,updated_at=now() where key=target_text returning to_jsonb(feature_flags.*) into after_row;
 when p_operation='publishAnnouncement' then
  if length(btrim(coalesce(p_payload->>'title',''))) not between 1 and 200 or length(btrim(coalesce(p_payload->>'body',''))) not between 1 and 5000 then raise exception 'INVALID_ANNOUNCEMENT'; end if;
  insert into public.announcements(title,body,created_by) values(btrim(p_payload->>'title'),btrim(p_payload->>'body'),p_actor_id) returning to_jsonb(announcements.*),announcements.id into after_row,id;
  target_kind:='announcement'; target_text:=id::text;
 when p_operation='retireAnnouncement' then
  select to_jsonb(a) into old from public.announcements a where a.id=id for update;
  if old is null then raise exception 'TARGET_NOT_FOUND'; end if;
  update public.announcements set active=false where announcements.id=id returning to_jsonb(announcements.*) into after_row; target_kind:='announcement';
 when p_operation in ('addBlockedWord','removeBlockedWord') then
  target_text:=lower(btrim(p_payload->>'word')); target_kind:='blocked_word';
  if target_text is null or length(target_text) not between 2 and 200 then raise exception 'INVALID_BLOCKED_WORD'; end if;
  select to_jsonb(w) into old from public.blocked_words w where word=target_text for update;
  if p_operation='addBlockedWord' then insert into public.blocked_words(word,added_by) values(target_text,p_actor_id) on conflict(word) do nothing;
   select to_jsonb(w) into after_row from public.blocked_words w where word=target_text;
  else delete from public.blocked_words where word=target_text; if not found then raise exception 'TARGET_NOT_FOUND'; end if; end if;
 when p_operation='rejectBusinessApplication' then
  select to_jsonb(b) into old from public.business_applications b where b.id=id for update;
  if old is null then raise exception 'TARGET_NOT_FOUND'; end if; target_kind:='business_application';
  if old->>'status'<>'submitted' then raise exception 'APPLICATION_NOT_PENDING'; end if;
  if exists(select 1 from admin_ops.provisions where application_id=id) then raise exception 'APPLICATION_PROVISIONING'; end if;
  update public.business_applications set status='rejected',decision_reason=reason,decided_by=p_actor_id,decided_at=now() where business_applications.id=id returning to_jsonb(business_applications.*) into after_row;
 when p_operation in ('archiveOrganization','restoreOrganization','adminTransferOwnership') then
  select to_jsonb(o) into old from public.organizations o where o.id=id for update;
  if old is null then raise exception 'TARGET_NOT_FOUND'; end if; target_kind:='organization';
  if p_operation='adminTransferOwnership' then
   select p.id into target from public.profiles p join auth.users u on u.id=p.id
   where lower(p.username)=lower(ltrim(btrim(p_payload->>'username'),'@')) and p.deactivated_at is null
    and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now()) for share of p,u;
   if target is null then raise exception 'TARGET_NOT_FOUND'; end if;
   update public.org_memberships set role='admin' where org_id=id and role='owner' and user_id<>target;
   insert into public.org_memberships(org_id,user_id,role,invited_by) values(id,target,'owner',p_actor_id)
    on conflict(org_id,user_id) do update set role='owner',expires_at=null;
   insert into public.org_audit_log(org_id,actor_id,action,target_type,target_id,meta)
    values(id,p_actor_id,'ownership_transferred','user',target::text,jsonb_build_object('admin_override',true));
   after_row:=old||jsonb_build_object('owner_id',target);
  else
   update public.organizations set archived_at=case when p_operation='archiveOrganization' then now() else null end where organizations.id=id returning to_jsonb(organizations.*) into after_row;
   if p_operation='archiveOrganization' then delete from public.org_delegations where principal_org_id=id or client_org_id=id; end if;
   insert into public.org_audit_log(org_id,actor_id,action,target_type,target_id) values(id,p_actor_id,p_operation,'organization',id::text);
  end if;
 end case;
 insert into public.admin_audit_log(admin_id,action,target_kind,target_id,reason,before,after)
 values(p_actor_id,p_operation,target_kind,target_text,reason,old,after_row);
 result_value:=jsonb_build_object('success',true,'command_key',p_key,'target_id',target_text);
 if p_operation='adminDeleteAccount' then result_value:=result_value||jsonb_build_object('deletion_status','retention_review'); end if;
 update admin_ops.commands set result=result_value where command_key=p_key;
 return result_value;
end $$;

create or replace function public.triniti_admin_provision(
 p_actor_id uuid,p_session_id uuid,p_key uuid,p_kind text,p_payload jsonb,p_phase text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare j admin_ops.provisions%rowtype; application public.business_applications%rowtype;
 email_value text; username_value text; new_id uuid; snapshot_value jsonb:='{}'::jsonb;
 role_value text; result_value jsonb; auth_user auth.users%rowtype;
begin
 perform pg_advisory_xact_lock(77123,1);
 perform admin_ops.require_session(p_actor_id,p_session_id,case p_kind when 'staff' then 'staff_manage' when 'business' then 'business_manage' else '' end);
 if p_key is null or p_kind not in ('staff','business') or p_phase not in ('reserve','finish') or p_phase is null
  or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>4096 then raise exception 'INVALID_PROVISION'; end if;
 if p_kind='staff' then
  if (select count(*) from jsonb_object_keys(p_payload))<>3 or not p_payload ?& array['email','role','password_digest']
   or exists(select 1 from jsonb_each(p_payload) v where jsonb_typeof(v.value)<>'string') then raise exception 'INVALID_PROVISION'; end if;
  email_value:=lower(btrim(p_payload->>'email')); role_value:=p_payload->>'role';
  if email_value is null or length(email_value)>254 or email_value !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
   or p_payload->>'password_digest' !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_PROVISION'; end if;
  if role_value is null or role_value not in ('super_admin','platform_admin','trust_safety','support_agent','ops_engineer','market_reviewer','jobs_reviewer','verification_reviewer','finance_admin','analyst','auditor_readonly') then raise exception 'INVALID_STAFF_ROLE'; end if;
 else
  if (select count(*) from jsonb_object_keys(p_payload))<>1 or jsonb_typeof(p_payload->'id') is distinct from 'string' then raise exception 'INVALID_PROVISION'; end if;
 end if;
 select * into j from admin_ops.provisions where command_key=p_key for update;
 if found then
  if j.actor_id<>p_actor_id or j.kind<>p_kind or j.payload<>p_payload then raise exception 'COMMAND_KEY_REUSED'; end if;
 else
  if p_phase<>'reserve' then raise exception 'PROVISION_NOT_RESERVED'; end if;
  if p_kind='business' then
   select * into application from public.business_applications where id=(p_payload->>'id')::uuid for update;
   if not found then raise exception 'TARGET_NOT_FOUND'; end if;
   if application.status<>'submitted' then raise exception 'APPLICATION_NOT_PENDING'; end if;
   if application.applicant_id is null or not exists(select 1 from public.profiles p join auth.users u on u.id=p.id where p.id=application.applicant_id
    and p.deactivated_at is null and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now()) for share of p,u) then raise exception 'BUSINESS_OWNER_REQUIRED'; end if;
   username_value:=lower(btrim(application.desired_username));
   if username_value !~ '^[a-z0-9_]{3,32}$' then raise exception 'INVALID_BUSINESS_USERNAME'; end if;
   if exists(select 1 from public.profiles where lower(username)=username_value) then raise exception 'USERNAME_ALREADY_IN_USE'; end if;
   snapshot_value:=jsonb_build_object('applicant_id',application.applicant_id,'company_name',application.company_name,'desired_username',username_value,'category',application.category,'description',application.description,'contact_email',lower(btrim(application.contact_email)));
   -- Business identities are delegated, not extra passwords for the owner's email.
   -- Their contact email stays on the application; the non-deliverable identity
   -- cannot consume or take over an existing personal login.
   new_id:=gen_random_uuid(); email_value:='business+'||new_id::text||'@accounts.platinumcircles.invalid';
  else
   if exists(select 1 from auth.users where lower(email)=email_value) then raise exception 'EMAIL_ALREADY_IN_USE'; end if;
   new_id:=gen_random_uuid();
  end if;
  insert into admin_ops.provisions(command_key,actor_id,kind,payload,auth_user_id,email,application_id,snapshot)
  values(p_key,p_actor_id,p_kind,p_payload,new_id,email_value,case when p_kind='business' then application.id else null end,snapshot_value) returning * into j;
 end if;
 result_value:=jsonb_build_object('success',true,'command_key',p_key,'provision_id',j.provision_id,'auth_user_id',j.auth_user_id,'email',j.email,'complete',j.completed_at is not null);
 if j.completed_at is not null or p_phase='reserve' then return result_value; end if;
 select * into auth_user from auth.users where id=j.auth_user_id for update;
 if not found or auth_user.raw_app_meta_data->>'triniti_provision_id' is distinct from j.provision_id::text
  or lower(auth_user.email) is distinct from j.email or auth_user.deleted_at is not null
  or (j.kind='staff' and auth_user.banned_until>now()) then raise exception 'PROVISION_IDENTITY_MISMATCH'; end if;
 if j.kind='staff' then
  insert into public.profiles(id,email,full_name,account_type) values(j.auth_user_id,j.email,'','personal') on conflict(id) do nothing;
  insert into public.admin_users(user_id,role,created_by) values(j.auth_user_id,j.payload->>'role',p_actor_id);
 else
  select * into application from public.business_applications where id=j.application_id for update;
  if application.status<>'submitted' then raise exception 'APPLICATION_NOT_PENDING'; end if;
  if application.applicant_id::text is distinct from j.snapshot->>'applicant_id'
   or lower(btrim(application.desired_username)) is distinct from j.snapshot->>'desired_username'
   or application.company_name is distinct from j.snapshot->>'company_name'
   or application.category is distinct from j.snapshot->>'category'
   or application.description is distinct from j.snapshot->>'description'
   or lower(btrim(application.contact_email)) is distinct from j.snapshot->>'contact_email' then raise exception 'APPLICATION_CHANGED'; end if;
  if not exists(select 1 from public.profiles p join auth.users u on u.id=p.id where p.id=application.applicant_id
    and p.deactivated_at is null and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now()) for share of p,u) then raise exception 'BUSINESS_OWNER_REQUIRED'; end if;
  insert into public.profiles(id,email,full_name,username,bio,account_type,account_class,is_verified,verified_tier,verified_category)
  values(j.auth_user_id,j.email,j.snapshot->>'company_name',j.snapshot->>'desired_username',j.snapshot->>'description','business','organization',true,'business',j.snapshot->>'category')
  on conflict(id) do update set full_name=excluded.full_name,username=excluded.username,bio=excluded.bio,account_type='business',account_class='organization',is_verified=true,verified_tier='business',verified_category=excluded.verified_category,updated_at=now();
  insert into public.business_members(business_id,member_id,role) values(j.auth_user_id,application.applicant_id,'owner');
  update public.business_applications set status='approved',decided_by=p_actor_id,decided_at=now(),decision_reason=null where id=application.id;
  -- A business account is controlled through delegated membership, not sign-in.
  update auth.users set banned_until='infinity',updated_at=now() where id=j.auth_user_id;
 end if;
 insert into public.admin_audit_log(admin_id,action,target_kind,target_id,after)
 values(p_actor_id,case when j.kind='staff' then 'inviteStaff' else 'approveBusinessApplication' end,j.kind,j.auth_user_id::text,
  jsonb_build_object('provision_id',j.provision_id,'application_id',j.application_id,'role',j.payload->>'role'));
 update admin_ops.provisions set completed_at=now() where command_key=p_key;
 return result_value||jsonb_build_object('complete',true);
end $$;

create or replace function admin_ops.guard_removed_content() returns trigger
language plpgsql security definer set search_path='' as $$
declare id_value uuid; kind_value text;
begin
 -- Only trusted service workers may perform a separately reviewed restoration.
 -- A SECURITY DEFINER user RPC still carries the authenticated JWT role here.
 if current_setting('role',true) not in ('anon','authenticated')
   and coalesce(auth.role(),'')='service_role' then return coalesce(new,old); end if;
 kind_value:=case tg_table_name when 'posts' then 'post' when 'stories' then 'story'
  when 'post_comments' then 'comment' when 'marketplace_listings' then 'listing' end;
 if tg_op='INSERT' then id_value:=new.id;else id_value:=old.id;end if;
 if exists(select 1 from admin_ops.removals where kind=kind_value and content_id=id_value) then
  if tg_op='INSERT' or tg_op='DELETE' then raise exception 'CONTENT_REMOVED_BY_MODERATOR' using errcode='42501';end if;
  if kind_value='listing' and (new.id is distinct from old.id or new.seller_id is distinct from old.seller_id
   or new.status is distinct from 'removed' or new.hidden_at is null) then
   raise exception 'CONTENT_REMOVED_BY_MODERATOR' using errcode='42501';
  end if;
 end if;
 -- Owner-created hidden rows also cannot inherit a previously removed id.
 if tg_op='UPDATE' and new.id is distinct from old.id
  and exists(select 1 from admin_ops.removals where kind=kind_value and content_id=new.id) then
  raise exception 'CONTENT_REMOVED_BY_MODERATOR' using errcode='42501';
 end if;
 return coalesce(new,old);
end $$;

create or replace function admin_ops.validate_verification_evidence(p_tier text, p_category text, p_evidence jsonb)
returns void language plpgsql immutable set search_path='' as $$
declare link jsonb; value text;
begin
 if p_tier is null or p_tier not in ('public_figure','business','official') then raise exception 'VERIFICATION_TIER_INVALID'; end if;
 if length(btrim(coalesce(p_category,''))) not between 2 and 120 then raise exception 'VERIFICATION_CATEGORY_REQUIRED'; end if;
 if jsonb_typeof(p_evidence) is distinct from 'object'
   or jsonb_typeof(p_evidence->'statement') is distinct from 'string'
   or length(btrim(p_evidence->>'statement')) not between 20 and 2000 then
   raise exception 'VERIFICATION_STATEMENT_REQUIRED';
 end if;
 if jsonb_typeof(p_evidence->'links') is distinct from 'array' then raise exception 'VERIFICATION_EVIDENCE_LINK_REQUIRED'; end if;
 if jsonb_array_length(p_evidence->'links') not between 1 and 8 then raise exception 'VERIFICATION_EVIDENCE_LINK_REQUIRED'; end if;
 for link in select * from jsonb_array_elements(p_evidence->'links') loop
  value := link #>> '{}';
  if jsonb_typeof(link) <> 'string' or length(value)>2048
    or value !~* '^https?://[^/@[:space:]]+([/?#][^[:space:]]*)?$'
    or value ~ '[[:cntrl:]]' or strpos(value,chr(92))>0 then raise exception 'VERIFICATION_EVIDENCE_URL_INVALID'; end if;
 end loop;
 if p_tier='official' and (jsonb_typeof(p_evidence->'office') is distinct from 'string'
   or length(btrim(p_evidence->>'office')) not between 3 and 200) then raise exception 'VERIFICATION_OFFICE_REQUIRED'; end if;
end $$;

create or replace function public.admin_support_triage_read(p_ids uuid[])
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object(
  'ticket_id',t.id,'assigned_to',s.assigned_to,'assigned_name',p.full_name,
  'priority',coalesce(s.priority,'normal'),'queue',coalesce(s.queue,'general'),
  'escalated',coalesce(s.escalated,false),'version',coalesce(s.version,0),
  'support_commands_available',coalesce(has_function_privilege('service_role',to_regprocedure('public.triniti_platinum_admin_command(uuid,uuid,uuid,text,jsonb)'),'EXECUTE'),false),
  'response_due_at',case when t.status='open' and coalesce(m.sender,'user')<>'ops' then
   coalesce(m.created_at,t.created_at)+case coalesce(s.priority,'normal') when 'urgent' then interval '15 minutes' when 'high' then interval '1 hour' when 'low' then interval '72 hours' else interval '24 hours' end end
 )),'[]') from public.support_tickets t
 left join admin_ops.support_triage s on s.ticket_id=t.id
 left join public.profiles p on p.id=s.assigned_to
 left join lateral(select sender,created_at from public.support_messages where ticket_id=t.id order by created_at desc,id desc limit 1) m on true
 where t.id=any(p_ids) and cardinality(p_ids)<=100;
$$;

create or replace function public.admin_support_triage_update(
 p_actor_id uuid,p_session_id uuid,p_key uuid,p_ticket_id uuid,p_version integer,
 p_assigned_to uuid,p_priority text,p_queue text,p_escalated boolean,p_reason text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare payload jsonb; saved admin_ops.commands%rowtype; previous jsonb; result_value jsonb; current_version integer;
begin
 perform admin_ops.require_session(p_actor_id,p_session_id,'support');
 if p_key is null or p_ticket_id is null or p_version is null or p_version<0
   or p_priority is null or p_priority not in ('urgent','high','normal','low')
   or p_queue is null or p_queue not in ('general','account','payments','safety','marketplace')
   or p_escalated is null or coalesce(length(trim(p_reason)),0) not between 3 and 2000
 then raise exception 'INVALID_TRIAGE';end if;
 payload:=jsonb_build_object('ticket_id',p_ticket_id,'version',p_version,'assigned_to',p_assigned_to,'priority',p_priority,'queue',p_queue,'escalated',p_escalated,'reason',trim(p_reason));
 insert into admin_ops.commands(command_key,actor_id,operation,payload) values(p_key,p_actor_id,'supportTriage',payload) on conflict do nothing;
 select * into saved from admin_ops.commands where command_key=p_key for update;
 if saved.actor_id<>p_actor_id or saved.operation<>'supportTriage' or saved.payload<>payload then raise exception 'COMMAND_CONFLICT';end if;
 if saved.result is not null then return saved.result;end if;
 perform 1 from public.support_tickets where id=p_ticket_id for update;
 if not found then raise exception 'TARGET_NOT_FOUND';end if;
 if p_assigned_to is not null then
  perform 1 from public.admin_users where user_id=p_assigned_to and active and role in ('super_admin','platform_admin','trust_safety','support_agent') for share;
  if not found then raise exception 'INVALID_ASSIGNEE';end if;
 end if;
 select to_jsonb(s),s.version into previous,current_version from admin_ops.support_triage s where ticket_id=p_ticket_id;
 if coalesce(current_version,0)<>p_version then raise exception 'TRIAGE_CHANGED';end if;
 insert into admin_ops.support_triage(ticket_id,assigned_to,priority,queue,escalated)
 values(p_ticket_id,p_assigned_to,p_priority,p_queue,p_escalated)
 on conflict(ticket_id) do update set assigned_to=excluded.assigned_to,priority=excluded.priority,queue=excluded.queue,escalated=excluded.escalated,version=admin_ops.support_triage.version+1,updated_at=now();
 select to_jsonb(s) into result_value from admin_ops.support_triage s where ticket_id=p_ticket_id;
 insert into public.admin_audit_log(admin_id,action,target_kind,target_id,reason,before,after)
 values(p_actor_id,'supportTriage','support_ticket',p_ticket_id::text,trim(p_reason),previous,result_value);
 result_value:=jsonb_build_object('success',true,'command_key',p_key,'version',(result_value->>'version')::integer);
 update admin_ops.commands set result=result_value where command_key=p_key;
 return result_value;
end;$$;

-- Preserve service-only command access and private trigger helpers.
revoke all on function public.triniti_platinum_admin_command(uuid,uuid,uuid,text,jsonb),
 public.triniti_admin_provision(uuid,uuid,uuid,text,jsonb,text),
 public.admin_support_triage_read(uuid[]),
 public.admin_support_triage_update(uuid,uuid,uuid,uuid,integer,uuid,text,text,boolean,text)
 from public,anon,authenticated;
grant execute on function public.triniti_platinum_admin_command(uuid,uuid,uuid,text,jsonb),
 public.triniti_admin_provision(uuid,uuid,uuid,text,jsonb,text),
 public.admin_support_triage_read(uuid[]),
 public.admin_support_triage_update(uuid,uuid,uuid,uuid,integer,uuid,text,text,boolean,text) to service_role;
revoke all on function admin_ops.guard_removed_content(),
 admin_ops.validate_verification_evidence(text,text,jsonb),
 public.update_comment_count(),public.sync_post_comment_count(),public.sync_post_comments_count()
 from public,anon,authenticated,service_role;

notify pgrst, 'reload schema';
commit;
