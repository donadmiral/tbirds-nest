-- Server-only admin operations: live native MFA session, explicit roles,
-- transactional audit, replay-safe commands and resumable identity provisioning.
create schema if not exists admin_ops;
revoke all on schema admin_ops from public, anon, authenticated;
grant usage on schema admin_ops to service_role;

create table if not exists admin_ops.commands (
 command_key uuid primary key, actor_id uuid not null, operation text not null,
 payload jsonb not null, result jsonb, created_at timestamptz not null default now()
);
create table if not exists admin_ops.provisions (
 command_key uuid primary key, actor_id uuid not null, kind text not null check(kind in ('staff','business')),
 payload jsonb not null, auth_user_id uuid not null unique default gen_random_uuid(),
 provision_id uuid not null unique default gen_random_uuid(), email text not null,
 application_id uuid unique, completed_at timestamptz, created_at timestamptz not null default now()
);
create unique index if not exists admin_provisions_email on admin_ops.provisions(lower(email));
create table if not exists admin_ops.deletion_requests (
 id uuid primary key default gen_random_uuid(), user_id uuid not null unique,
 requested_by uuid not null, reason text not null,
 status text not null default 'retention_review' check(status in ('retention_review','erasing','completed','cancelled')),
 created_at timestamptz not null default now(), completed_at timestamptz
);
alter table admin_ops.commands enable row level security;
alter table admin_ops.provisions enable row level security;
alter table admin_ops.deletion_requests enable row level security;
revoke all on all tables in schema admin_ops from public, anon, authenticated, service_role;

create or replace function admin_ops.require_session(p_actor_id uuid,p_session_id uuid,p_permission text)
returns text language plpgsql security definer set search_path = '' as $$
declare r text;
begin
 -- The same native session used by the verified server token must still exist.
 if p_actor_id is null or p_session_id is null
    or not public.triniti_admin_session_check(p_actor_id,p_session_id)
    or not exists(select 1 from auth.sessions where id=p_session_id and user_id=p_actor_id and aal::text='aal2')
 then raise exception 'ACTIVE_ADMIN_SESSION_REQUIRED' using errcode='42501'; end if;
 perform 1 from auth.sessions s join auth.users u on u.id=s.user_id
 where s.id=p_session_id and s.user_id=p_actor_id and s.aal::text='aal2'
 and (s.not_after is null or s.not_after>now()) and u.deleted_at is null
 and (u.banned_until is null or u.banned_until<=now()) for share of s,u;
 if not found then raise exception 'ACTIVE_ADMIN_SESSION_REQUIRED' using errcode='42501'; end if;
 select role into r from public.admin_users where user_id=p_actor_id and active for share;
 if not coalesce(case p_permission
 when 'verification' then r=any(array['super_admin','platform_admin','verification_reviewer'])
 when 'user_moderate' then r=any(array['super_admin','platform_admin','trust_safety'])
 when 'post_moderate' then r=any(array['super_admin','platform_admin','trust_safety'])
 when 'market_moderate' then r=any(array['super_admin','platform_admin','market_reviewer'])
 when 'report_post' then r=any(array['super_admin','platform_admin','trust_safety'])
 when 'report_listing' then r=any(array['super_admin','platform_admin','trust_safety','market_reviewer'])
 when 'report_user' then r=any(array['super_admin','platform_admin','trust_safety'])
 when 'support' then r=any(array['super_admin','platform_admin','trust_safety','support_agent'])
 when 'ads' then r=any(array['super_admin','platform_admin','market_reviewer','finance_admin'])
 when 'system' then r=any(array['super_admin','platform_admin','ops_engineer'])
 when 'business_manage' then r='super_admin'
 when 'organization_manage' then r='super_admin'
 when 'staff_manage' then r='super_admin'
 when 'account_delete' then r='super_admin'
 when 'comment_delete' then r='super_admin'
 else false end,false) then raise exception 'ADMIN_PERMISSION_DENIED' using errcode='42501'; end if;
 return r;
end $$;
revoke all on function admin_ops.require_session(uuid,uuid,text) from public,anon,authenticated;
grant execute on function admin_ops.require_session(uuid,uuid,text) to service_role;

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
   select p.id into target from public.profiles p where lower(p.username)=lower(ltrim(btrim(p_payload->>'username'),'@')) and p.deactivated_at is null;
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
revoke all on function public.triniti_platinum_admin_command(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.triniti_platinum_admin_command(uuid,uuid,uuid,text,jsonb) to service_role;

alter table admin_ops.provisions add column if not exists snapshot jsonb not null default '{}'::jsonb;
create unique index if not exists admin_provisions_username on admin_ops.provisions(lower(snapshot->>'desired_username')) where kind='business';

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
   if application.applicant_id is null or not exists(select 1 from public.profiles where id=application.applicant_id and deactivated_at is null) then raise exception 'BUSINESS_OWNER_REQUIRED'; end if;
   username_value:=lower(btrim(application.desired_username));
   if username_value !~ '^[a-z0-9_]{3,32}$' then raise exception 'INVALID_BUSINESS_USERNAME'; end if;
   if exists(select 1 from public.profiles where lower(username)=username_value) then raise exception 'USERNAME_ALREADY_IN_USE'; end if;
   snapshot_value:=jsonb_build_object('applicant_id',application.applicant_id,'company_name',application.company_name,'desired_username',username_value,'category',application.category,'description',application.description);
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
  or lower(auth_user.email) is distinct from j.email or auth_user.deleted_at is not null then raise exception 'PROVISION_IDENTITY_MISMATCH'; end if;
 if j.kind='staff' then
  insert into public.profiles(id,email,full_name,account_type) values(j.auth_user_id,j.email,'','personal') on conflict(id) do nothing;
  insert into public.admin_users(user_id,role,created_by) values(j.auth_user_id,j.payload->>'role',p_actor_id);
 else
  select * into application from public.business_applications where id=j.application_id for update;
  if application.status<>'submitted' then raise exception 'APPLICATION_NOT_PENDING'; end if;
  if application.applicant_id::text is distinct from j.snapshot->>'applicant_id'
   or lower(btrim(application.desired_username)) is distinct from j.snapshot->>'desired_username' then raise exception 'APPLICATION_CHANGED'; end if;
  if not exists(select 1 from public.profiles where id=application.applicant_id and deactivated_at is null) then raise exception 'BUSINESS_OWNER_REQUIRED'; end if;
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
revoke all on function public.triniti_admin_provision(uuid,uuid,uuid,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.triniti_admin_provision(uuid,uuid,uuid,text,jsonb,text) to service_role;

-- Existing comment-count triggers inherit the caller search path. Qualify their
-- relations so moderation can keep its empty, safe search path.

CREATE OR REPLACE FUNCTION "public"."update_comment_count"() RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
CALLED ON NULL INPUT
PARALLEL UNSAFE
COST 100
SET search_path TO ''
AS $qa_source$
begin
  if tg_op = 'INSERT' then
    update public.posts set comments_count = comments_count + 1 where id = new.post_id;
  elsif tg_op = 'DELETE' then
    update public.posts set comments_count = comments_count - 1 where id = old.post_id;
  end if;
  return null;
end;
$qa_source$;

CREATE OR REPLACE FUNCTION "public"."sync_post_comment_count"() RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
CALLED ON NULL INPUT
PARALLEL UNSAFE
COST 100
SET search_path TO ''
AS $qa_source$
begin
  if tg_op = 'INSERT' then
    update public.posts
    set comments_count = (
      select count(*) from public.post_comments where post_id = new.post_id
    )
    where id = new.post_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.posts
    set comments_count = (
      select count(*) from public.post_comments where post_id = old.post_id
    )
    where id = old.post_id;
    return old;
  end if;
  return null;
end;
$qa_source$;

CREATE OR REPLACE FUNCTION "public"."sync_post_comments_count"() RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
CALLED ON NULL INPUT
PARALLEL UNSAFE
COST 100
SET search_path TO ''
AS $qa_source$
begin
  -- Only count top-level comments (not replies)
  update public.posts set comments_count = (
    select count(*) from public.post_comments
    where post_id = coalesce(NEW.post_id, OLD.post_id)
    and parent_comment_id is null
  ) where id = coalesce(NEW.post_id, OLD.post_id);
  return coalesce(NEW, OLD);
end;
$qa_source$;

create index if not exists deletion_requests_created on admin_ops.deletion_requests(created_at desc,id);
create or replace function public.triniti_admin_deletion_requests(p_actor_id uuid,p_session_id uuid,p_page integer default 1)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 perform admin_ops.require_session(p_actor_id,p_session_id,'account_delete');
 if p_page is null or p_page not between 1 and 10000 then raise exception 'INVALID_PAGE'; end if;
 select jsonb_build_object('rows',coalesce((
  select jsonb_agg(to_jsonb(r)) from (
   select d.id,d.user_id,d.reason,d.status,d.created_at,d.completed_at,p.full_name,p.username
   from admin_ops.deletion_requests d left join public.profiles p on p.id=d.user_id
   order by d.created_at desc,d.id limit 50 offset (p_page-1)*50
  ) r),'[]'::jsonb),'total',(select count(*) from admin_ops.deletion_requests)) into result;
 return result;
end $$;
revoke all on function public.triniti_admin_deletion_requests(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.triniti_admin_deletion_requests(uuid,uuid,integer) to service_role;
