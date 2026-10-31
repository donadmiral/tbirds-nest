-- Additive, private workflow records. Does not publish content, send messages,
-- provision Auth identities, activate ads, transfer money, or change buckets.
-- Apply only after the current account-erasure/staff-shell migrations.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';

do $preflight$
declare f record;
begin
 if current_user <> 'postgres' then raise exception 'WORKFLOW_POSTGRES_REQUIRED'; end if;
 if to_regnamespace('studio_workflow') is not null then raise exception 'WORKFLOW_TARGET_ALREADY_EXISTS'; end if;
 if to_regprocedure('account_erasure.assert_writable(uuid)') is null
  or to_regclass('admin_ops.staff_social_shells') is null
  or to_regclass('public.studio_session_members') is null then raise exception 'WORKFLOW_BASELINE_REQUIRED'; end if;
 if exists(select 1 from pg_namespace n where n.nspname in ('public','extensions')
  and (has_schema_privilege('anon',n.oid,'CREATE') or has_schema_privilege('authenticated',n.oid,'CREATE'))) then
  raise exception 'WORKFLOW_UNTRUSTED_SCHEMA_CREATE';
 end if;
 for f in select * from (values
  ('public.create_business_access_member(text)','cd2dea0933e6d25eb4a466ac54512921'),
  ('public.studio_bind_member(text)','e6a105ea022a3bfdfd3be142360162a3'),
  ('public.studio_business_info()','c2c8e3bcc4e12f7d50a528c2a294b22f'),
  ('public.studio_get_business()','e58a1c829899f0553923ae79d4f09367'),
  ('public.studio_create_member(text,text)','d85fa9f971f74d936cda252c0c79dd58'),
  ('public.studio_list_members()','4420194da77a8aadf542b77d001a316a'),
  ('public.studio_role()','d7f139e152efc0ae60d5d5fe08535509'),
  ('public.studio_set_device(uuid,text)','74854ac23d885f5cf2691a0a4524aea3'),
  ('public.studio_set_member_active(uuid,boolean)','173a48fa8d4c019d23948fbe3ac59161'),
  ('public.studio_set_member_role(uuid,text)','cac5eb83a55075cd0875683a2b01ab29'),
  ('public.studio_publish_row(uuid)','a35cde3e5e2ac5a111b503a265ba18cf'),
  ('public.studio_publish_due()','d7cdc3e707f6a8498f50f458b9811533'),
  ('public.studio_save_post(uuid,text,text,text,uuid,jsonb,jsonb,timestamp with time zone)','88162d57e80d3d478141bb25807d4df6')
 ) expected(signature,hash)
 loop
  if not exists(select 1 from pg_proc where oid=to_regprocedure(f.signature)
   and md5(pg_get_functiondef(oid))=f.hash and pg_get_userbyid(proowner)='postgres') then
   raise exception 'WORKFLOW_BASELINE_DRIFT: %',f.signature;
  end if;
  if exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
   where p.oid=to_regprocedure(f.signature) and acl.grantee not in (0,(select oid from pg_roles where rolname='postgres'),
    (select oid from pg_roles where rolname='anon'),(select oid from pg_roles where rolname='authenticated'),(select oid from pg_roles where rolname='service_role'))) then
   raise exception 'WORKFLOW_UNREVIEWED_GRANT: %',f.signature;
  end if;
 end loop;
 if has_function_privilege('anon','public.studio_publish_row(uuid)','EXECUTE')
  or has_function_privilege('authenticated','public.studio_publish_row(uuid)','EXECUTE')
  or has_function_privilege('anon','public.studio_publish_due()','EXECUTE')
  or has_function_privilege('authenticated','public.studio_publish_due()','EXECUTE') then
  raise exception 'WORKFLOW_INTERNAL_PUBLISHER_GRANT';end if;
 if has_table_privilege('anon','public.studio_session_members','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  or has_table_privilege('authenticated','public.studio_session_members','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  or not (select relrowsecurity from pg_class where oid='public.studio_session_members'::regclass)
  or exists(select 1 from pg_policy where polrelid='public.studio_session_members'::regclass) then
  raise exception 'WORKFLOW_SESSION_BINDING_ACCESS_DRIFT';end if;
 if exists(select business_id from public.business_access_members group by business_id having count(*) filter(where active and role='owner')=0) then
  raise exception 'WORKFLOW_OWNERLESS_TEAM_REVIEW_REQUIRED';end if;
end $preflight$;

create schema studio_workflow;
revoke all on schema studio_workflow from public, anon, authenticated, service_role;
create type studio_workflow.actor as (user_id uuid, session_id uuid, member_id uuid, actor_id uuid, role text, is_business boolean);

create table studio_workflow.newsroom (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references public.profiles(id) on delete cascade,
 title text not null check(length(title) between 1 and 160),
 brief text not null default '' check(length(brief)<=5000),
 assignee_id uuid references public.business_access_members(id) on delete set null,
 scheduled_post_id uuid references public.studio_scheduled_posts(id) on delete set null,
 rights_owner text not null default '' check(length(rights_owner)<=160),
 territory text not null default '' check(length(territory)<=160),
 rights_verified boolean not null default false,
 rights_expires_at timestamptz, embargo_at timestamptz, publish_at timestamptz,
 sponsor text not null default '' check(length(sponsor)<=160),
 paid_partnership boolean not null default false,
 state text not null default 'draft' check(state in ('draft','in_review','changes_requested','approved','scheduled','cancelled')),
 version integer not null default 1 check(version>0),
 created_by uuid not null, submitted_by uuid, submitted_at timestamptz,
 approved_by uuid, approved_at timestamptz,
 review_note text not null default '' check(length(review_note)<=2000),
 creative_hash text,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp()
);
create index newsroom_owner_cursor on studio_workflow.newsroom(owner_id, updated_at desc,id desc);
create index newsroom_assignee on studio_workflow.newsroom(assignee_id) where assignee_id is not null;
create unique index newsroom_one_active_assignment on studio_workflow.newsroom(scheduled_post_id)
 where scheduled_post_id is not null and state<>'cancelled';

create table studio_workflow.partnerships (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references public.profiles(id) on delete cascade,
 creator_id uuid not null references public.profiles(id) on delete cascade,
 title text not null check(length(title) between 1 and 160),
 brief text not null default '' check(length(brief)<=5000),
 deliverables text not null default '' check(length(deliverables)<=5000),
 disclosure text not null default '' check(length(disclosure)<=500),
 due_at timestamptz,
 fee_minor bigint check(fee_minor between 0 and 100000000000),
 currency text not null default 'USD' check(currency ~ '^[A-Z]{3}$'),
 state text not null default 'draft' check(state in ('draft','proposed','accepted','submitted','changes_requested','approved','declined','cancelled','closed')),
 version integer not null default 1 check(version>0),
 deliverable_version integer not null default 0 check(deliverable_version>=0),
 created_by uuid not null, approved_by uuid, approved_at timestamptz,
 publishing_granted boolean not null default false, publishing_expires_at timestamptz,
 paid_promotion_granted boolean not null default false, paid_promotion_expires_at timestamptz,
 permission_version integer,
 review_note text not null default '' check(length(review_note)<=2000),
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 check(owner_id<>creator_id)
);
create index partnership_owner_cursor on studio_workflow.partnerships(owner_id,updated_at desc,id desc);
create index partnership_creator_cursor on studio_workflow.partnerships(creator_id,updated_at desc,id desc);
create table studio_workflow.deliverables (
 partnership_id uuid not null references studio_workflow.partnerships(id) on delete cascade,
 version integer not null check(version>0),
 content text not null check(length(content) between 1 and 10000),
 post_id uuid references public.posts(id) on delete set null,
 post_hash text,
 submitted_at timestamptz not null default clock_timestamp(),
 primary key(partnership_id,version)
);
create index workflow_deliverable_post on studio_workflow.deliverables(post_id) where post_id is not null;
create table studio_workflow.events (
 id uuid primary key default gen_random_uuid(),
 newsroom_id uuid references studio_workflow.newsroom(id) on delete cascade,
 partnership_id uuid references studio_workflow.partnerships(id) on delete cascade,
 actor_user_id uuid references public.profiles(id) on delete set null,
 actor_member_id uuid, action text not null,
 note text not null default '' check(length(note)<=2000),
 at timestamptz not null default clock_timestamp(),
 check((newsroom_id is null)<>(partnership_id is null))
);
create index newsroom_events_cursor on studio_workflow.events(newsroom_id,at desc,id desc) where newsroom_id is not null;
create index partnership_events_cursor on studio_workflow.events(partnership_id,at desc,id desc) where partnership_id is not null;
create index workflow_events_actor on studio_workflow.events(actor_user_id) where actor_user_id is not null;
create table studio_workflow.commands (
 request_key uuid primary key,
 user_id uuid not null references public.profiles(id) on delete cascade,
 actor_id uuid not null, operation text not null, payload_hash text not null,
 entity_id uuid not null, created_at timestamptz not null default clock_timestamp()
);
create index workflow_commands_user on studio_workflow.commands(user_id,created_at);

do $private_tables$
declare r record;
begin
 for r in select c.oid::regclass name from pg_class c where c.relnamespace='studio_workflow'::regnamespace and c.relkind='r'
 loop
  execute format('alter table %s enable row level security',r.name);
  execute format('revoke all on %s from public,anon,authenticated,service_role',r.name);
 end loop;
end $private_tables$;

-- Roles come from the current database/session binding, never user_metadata.
-- The shared erasure lock precedes session and membership locks everywhere.
create function studio_workflow.context(p_expected_user uuid default null) returns studio_workflow.actor
language plpgsql security definer set search_path='' as $$
declare a studio_workflow.actor; member_row record;
begin
 a.user_id:=auth.uid();
 if a.user_id is null or (p_expected_user is not null and p_expected_user<>a.user_id)
  or coalesce(auth.jwt()->>'is_anonymous','false')<>'false' then
  raise exception 'WORKFLOW_ACTIVE_SESSION_REQUIRED' using errcode='42501';
 end if;
 perform account_erasure.assert_writable(a.user_id);
 begin a.session_id:=(auth.jwt()->>'session_id')::uuid; exception when others then a.session_id:=null; end;
 perform 1 from auth.sessions s join auth.users u on u.id=s.user_id
  where s.id=a.session_id and s.user_id=a.user_id and (s.not_after is null or s.not_after>clock_timestamp())
   and u.deleted_at is null and (u.banned_until is null or u.banned_until<=clock_timestamp()) for share of s,u;
 if not found then raise exception 'WORKFLOW_ACTIVE_SESSION_REQUIRED' using errcode='42501'; end if;
 select coalesce(p.account_type='business',false) into a.is_business from public.profiles p where p.id=a.user_id and p.deactivated_at is null for share;
 if not found then raise exception 'WORKFLOW_ACCOUNT_UNAVAILABLE' using errcode='42501'; end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('studio-access:'||a.user_id::text,0));
 if a.is_business and exists(select 1 from public.business_access_members m where m.business_id=a.user_id) then
  select m.id,m.role into member_row from public.studio_session_members s
   join public.business_access_members m on m.id=s.member_id and m.business_id=s.business_id
   where s.session_id=a.session_id::text and s.business_id=a.user_id and m.active for share of s,m;
  if not found or member_row.role not in ('owner','admin','editor','recruiter','support') then
   raise exception 'WORKFLOW_MEMBER_ACCESS_REQUIRED' using errcode='42501';
  end if;
  a.member_id:=member_row.id;a.role:=member_row.role;
 else a.role:='owner';end if;
 a.actor_id:=coalesce(a.member_id,a.user_id);
 return a;
end $$;
create function studio_workflow.write_context(p_expected_user uuid) returns studio_workflow.actor
language plpgsql security definer set search_path='' as $$
begin
 if p_expected_user is null then raise exception 'WORKFLOW_ACTIVE_SESSION_REQUIRED' using errcode='42501';end if;
 return studio_workflow.context(p_expected_user);
end $$;
create function studio_workflow.require_roles(a studio_workflow.actor,p_roles text[]) returns void
language plpgsql security definer set search_path='' as $$
begin
 if a.role is null or not a.role=any(p_roles) then raise exception 'WORKFLOW_PERMISSION_DENIED' using errcode='42501';end if;
end $$;
create function studio_workflow.command_result(a studio_workflow.actor,p_key uuid,p_operation text,p_payload jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare prior studio_workflow.commands%rowtype;
begin
 if p_key is null then raise exception 'WORKFLOW_REQUEST_KEY_REQUIRED';end if;
 perform pg_advisory_xact_lock(hashtextextended('studio-command:'||p_key::text,0));
 select * into prior from studio_workflow.commands where request_key=p_key;
 if not found then return null;end if;
 if prior.user_id<>a.user_id or prior.actor_id<>a.actor_id or prior.operation<>p_operation
  or prior.payload_hash<>encode(extensions.digest(p_payload::text,'sha256'),'hex') then raise exception 'WORKFLOW_REQUEST_KEY_REUSED';end if;
 return prior.entity_id;
end $$;
create function studio_workflow.remember(a studio_workflow.actor,p_key uuid,p_operation text,p_payload jsonb,p_entity uuid) returns void
language sql security definer set search_path='' as $$
 insert into studio_workflow.commands(request_key,user_id,actor_id,operation,payload_hash,entity_id)
 values(p_key,a.user_id,a.actor_id,p_operation,encode(extensions.digest(p_payload::text,'sha256'),'hex'),p_entity);
$$;
create function studio_workflow.input(p_input jsonb,p_keys text[]) returns void
language plpgsql security definer set search_path='' as $$
begin
 if p_input is null or jsonb_typeof(p_input)<>'object' or octet_length(p_input::text)>24000
  or exists(select 1 from jsonb_object_keys(p_input) k where not k=any(p_keys)) then raise exception 'WORKFLOW_INVALID_INPUT';end if;
end $$;
create function studio_workflow.post_hash(p_post public.studio_scheduled_posts) returns text
language sql immutable set search_path='' as $$
 select encode(extensions.digest(jsonb_build_object('owner_id',p_post.owner_id,'content',p_post.content,'body',p_post.body,
  'category',p_post.category,'community_id',p_post.community_id,'media',p_post.media,'products',p_post.products)::text,'sha256'),'hex');
$$;
create function studio_workflow.event(a studio_workflow.actor,p_kind text,p_id uuid,p_action text,p_note text default '') returns void
language plpgsql security definer set search_path='' as $$
begin
 if p_kind not in ('newsroom','partnership') or length(coalesce(p_note,''))>2000 then raise exception 'WORKFLOW_INVALID_INPUT';end if;
 insert into studio_workflow.events(newsroom_id,partnership_id,actor_user_id,actor_member_id,action,note)
 values(case when p_kind='newsroom' then p_id end,case when p_kind='partnership' then p_id end,a.user_id,a.member_id,p_action,coalesce(p_note,''));
end $$;

create function studio_workflow.newsroom_json(p_id uuid,a studio_workflow.actor) returns jsonb
language plpgsql security definer set search_path='' as $$
declare n studio_workflow.newsroom%rowtype; post public.studio_scheduled_posts%rowtype;
begin
 select * into n from studio_workflow.newsroom where id=p_id and owner_id=a.user_id;
 if not found then raise exception 'WORKFLOW_NOT_FOUND' using errcode='42501';end if;
 select * into post from public.studio_scheduled_posts where id=n.scheduled_post_id and owner_id=a.user_id;
 return (to_jsonb(n)-'creative_hash')||jsonb_build_object(
  'post_status',post.status,'published_post_id',post.published_post_id,'post_error',post.error,
  'can_edit',a.role in ('owner','admin','editor') and n.state in ('draft','changes_requested'),
  'can_change_post',not exists(select 1 from studio_workflow.events e where e.newsroom_id=n.id and e.action='submit'),
  'can_submit',a.role in ('owner','admin','editor') and n.state in ('draft','changes_requested'),
  'can_review',a.role in ('owner','admin') and n.state='in_review' and n.submitted_by is distinct from a.actor_id,
  'can_schedule',a.role in ('owner','admin','editor') and n.state='approved',
  'can_cancel',a.role in ('owner','admin') and n.state<>'cancelled' and coalesce(post.status,'draft') not in ('publishing','published'),
  'can_withdraw',a.role in ('owner','admin','editor') and n.state='in_review' and n.submitted_by=a.actor_id,
  'events',coalesce((select jsonb_agg(to_jsonb(e) order by e.at desc,e.id desc) from (
   select id,action,note,actor_user_id,actor_member_id,at from studio_workflow.events where newsroom_id=n.id order by at desc,id desc limit 30)e),'[]'::jsonb));
end $$;
create function public.studio_newsroom_list(p_limit integer default 50,p_before_at timestamptz default null,p_before_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a studio_workflow.actor:=studio_workflow.context(); cap integer:=least(greatest(coalesce(p_limit,50),1),100); rows jsonb; total integer; cursor jsonb;
begin
 if not a.is_business then raise exception 'WORKFLOW_BUSINESS_REQUIRED' using errcode='42501';end if;
 perform studio_workflow.require_roles(a,array['owner','admin','editor']);
 if (p_before_at is null)<>(p_before_id is null) then raise exception 'WORKFLOW_INVALID_CURSOR';end if;
 with limited as (select n.id,n.updated_at from studio_workflow.newsroom n where n.owner_id=a.user_id
  and (p_before_at is null or (n.updated_at,n.id)<(p_before_at,p_before_id)) order by n.updated_at desc,n.id desc limit cap+1),
 page as (select * from limited order by updated_at desc,id desc limit cap)
 select coalesce((select jsonb_agg(studio_workflow.newsroom_json(id,a) order by updated_at desc,id desc) from page),'[]'::jsonb),
  (select count(*) from limited),(select jsonb_build_object('at',updated_at,'id',id) from page order by updated_at,id limit 1)
 into rows,total,cursor;
 return jsonb_build_object('items',rows,'has_more',total>cap,'next_cursor',case when total>cap then cursor end,'role',a.role,'member_id',a.member_id,
  'members',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'display_name',m.display_name,'role',m.role) order by m.display_name,m.id)
  from public.business_access_members m where m.business_id=a.user_id and m.active and m.role in ('owner','admin','editor')),'[]'::jsonb));
end $$;

-- Load the exact current creative for review independently of the Planner's
-- latest-page limit. The list does not copy every media payload into each row.
create function public.studio_newsroom_get(p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a studio_workflow.actor:=studio_workflow.context();result jsonb;post jsonb;
begin
 if not a.is_business then raise exception 'WORKFLOW_BUSINESS_REQUIRED' using errcode='42501';end if;
 perform studio_workflow.require_roles(a,array['owner','admin','editor']);
 result:=studio_workflow.newsroom_json(p_id,a);
 select jsonb_build_object('id',s.id,'content',s.content,'body',s.body,'media',s.media,'products',s.products,
  'status',s.status,'publish_at',s.publish_at,'category',s.category,'community_id',s.community_id)
 into post from public.studio_scheduled_posts s where s.id=(result->>'scheduled_post_id')::uuid and s.owner_id=a.user_id;
 return result||jsonb_build_object('post',post);
end $$;

create function public.studio_newsroom_save(p_expected_user uuid,p_request_key uuid,p_id uuid,p_version integer,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a studio_workflow.actor:=studio_workflow.write_context(p_expected_user); n studio_workflow.newsroom%rowtype;
 prior uuid; original_post_id uuid; post public.studio_scheduled_posts%rowtype; payload jsonb:=jsonb_build_object('id',p_id,'version',p_version,'input',p_input);
begin
 if not a.is_business then raise exception 'WORKFLOW_BUSINESS_REQUIRED' using errcode='42501';end if;
 perform studio_workflow.require_roles(a,array['owner','admin','editor']);
 perform studio_workflow.input(p_input,array['title','brief','assignee_id','scheduled_post_id','rights_owner','territory','rights_verified','rights_expires_at','embargo_at','publish_at','sponsor','paid_partnership']);
 prior:=studio_workflow.command_result(a,p_request_key,'newsroom.save',payload);
 if prior is not null then return studio_workflow.newsroom_json(prior,a);end if;
 if p_id is not null then
  select * into n from studio_workflow.newsroom where id=p_id and owner_id=a.user_id for update;
  if not found then raise exception 'WORKFLOW_NOT_FOUND' using errcode='42501';end if;
  if p_version is distinct from n.version then raise exception 'WORKFLOW_VERSION_CHANGED';end if;
  if n.state not in ('draft','changes_requested') then raise exception 'WORKFLOW_EDIT_REQUIRES_DRAFT';end if;
  original_post_id:=n.scheduled_post_id;
 else
  if p_version is not null then raise exception 'WORKFLOW_INVALID_VERSION';end if;
  n.id:=gen_random_uuid();n.owner_id:=a.user_id;n.version:=0;n.created_by:=a.actor_id;n.created_at:=clock_timestamp();
 end if;
 n.title:=btrim(coalesce(p_input->>'title',''));n.brief:=coalesce(p_input->>'brief','');
 n.assignee_id:=nullif(p_input->>'assignee_id','')::uuid;n.scheduled_post_id:=nullif(p_input->>'scheduled_post_id','')::uuid;
 if p_id is not null and original_post_id is distinct from n.scheduled_post_id
  and exists(select 1 from studio_workflow.events where newsroom_id=n.id and action='submit') then
  raise exception 'WORKFLOW_REVIEWED_POST_LINK_LOCKED';end if;
 n.rights_owner:=btrim(coalesce(p_input->>'rights_owner',''));n.territory:=btrim(coalesce(p_input->>'territory',''));
 n.rights_verified:=coalesce((p_input->>'rights_verified')::boolean,false);
 n.rights_expires_at:=nullif(p_input->>'rights_expires_at','')::timestamptz;n.embargo_at:=nullif(p_input->>'embargo_at','')::timestamptz;
 n.publish_at:=nullif(p_input->>'publish_at','')::timestamptz;n.sponsor:=btrim(coalesce(p_input->>'sponsor',''));
 n.paid_partnership:=coalesce((p_input->>'paid_partnership')::boolean,false);
 if n.title='' or length(n.title)>160 or length(n.brief)>5000 or length(n.rights_owner)>160 or length(n.territory)>160 or length(n.sponsor)>160
  or (n.paid_partnership and n.sponsor='') or (n.sponsor<>'' and not n.paid_partnership)
  or (n.rights_expires_at is not null and not isfinite(n.rights_expires_at)) or (n.embargo_at is not null and not isfinite(n.embargo_at))
  or (n.publish_at is not null and not isfinite(n.publish_at)) then raise exception 'WORKFLOW_INVALID_INPUT';end if;
 if n.assignee_id is not null and not exists(select 1 from public.business_access_members where id=n.assignee_id and business_id=a.user_id and active and role in ('owner','admin','editor')) then
  raise exception 'WORKFLOW_ASSIGNEE_UNAVAILABLE';end if;
 if n.scheduled_post_id is not null then
  select * into post from public.studio_scheduled_posts where id=n.scheduled_post_id and owner_id=a.user_id for update;
  if not found or post.status not in ('draft','failed','cancelled') then raise exception 'WORKFLOW_DRAFT_UNAVAILABLE';end if;
 end if;
 n.state:='draft';n.version:=n.version+1;n.updated_at:=clock_timestamp();n.review_note:='';
 n.submitted_by:=null;n.submitted_at:=null;n.approved_by:=null;n.approved_at:=null;n.creative_hash:=null;
 if p_id is null then insert into studio_workflow.newsroom select n.*;
 else update studio_workflow.newsroom set (title,brief,assignee_id,scheduled_post_id,rights_owner,territory,rights_verified,rights_expires_at,embargo_at,publish_at,sponsor,paid_partnership,state,version,updated_at,review_note,submitted_by,submitted_at,approved_by,approved_at,creative_hash)=
  (n.title,n.brief,n.assignee_id,n.scheduled_post_id,n.rights_owner,n.territory,n.rights_verified,n.rights_expires_at,n.embargo_at,n.publish_at,n.sponsor,n.paid_partnership,n.state,n.version,n.updated_at,n.review_note,null,null,null,null,null) where id=n.id;end if;
 perform studio_workflow.event(a,'newsroom',n.id,case when p_id is null then 'created' else 'edited' end);
 perform studio_workflow.remember(a,p_request_key,'newsroom.save',payload,n.id);
 return studio_workflow.newsroom_json(n.id,a);
end $$;

create function public.studio_newsroom_transition(p_expected_user uuid,p_request_key uuid,p_id uuid,p_version integer,p_action text,p_note text default '') returns jsonb
language plpgsql security definer set search_path='' as $$
declare a studio_workflow.actor:=studio_workflow.write_context(p_expected_user); n studio_workflow.newsroom%rowtype; post public.studio_scheduled_posts%rowtype;
 prior uuid; payload jsonb:=jsonb_build_object('id',p_id,'version',p_version,'action',p_action,'note',coalesce(p_note,''));
begin
 if not a.is_business then raise exception 'WORKFLOW_BUSINESS_REQUIRED' using errcode='42501';end if;
 perform studio_workflow.require_roles(a,case when p_action in ('approve','request_changes','cancel') then array['owner','admin'] else array['owner','admin','editor'] end);
 if p_action not in ('submit','withdraw','request_changes','approve','schedule','cancel') or length(coalesce(p_note,''))>2000 then raise exception 'WORKFLOW_INVALID_ACTION';end if;
 prior:=studio_workflow.command_result(a,p_request_key,'newsroom.transition',payload);
 if prior is not null then return studio_workflow.newsroom_json(prior,a);end if;
 select * into n from studio_workflow.newsroom where id=p_id and owner_id=a.user_id for update;
 if not found then raise exception 'WORKFLOW_NOT_FOUND' using errcode='42501';end if;
 if n.version is distinct from p_version then raise exception 'WORKFLOW_VERSION_CHANGED';end if;
 if n.scheduled_post_id is not null then select * into post from public.studio_scheduled_posts where id=n.scheduled_post_id and owner_id=a.user_id for update;end if;
 if p_action='submit' then
  if n.state not in ('draft','changes_requested') then raise exception 'WORKFLOW_INVALID_TRANSITION';end if;
  if post.id is null or post.status not in ('draft','failed','cancelled') then raise exception 'WORKFLOW_DRAFT_REQUIRED';end if;
  if not n.rights_verified or n.rights_owner='' or n.territory='' then raise exception 'WORKFLOW_RIGHTS_REQUIRED';end if;
  if n.paid_partnership and strpos(lower(coalesce(post.content,'')||E'\n'||coalesce(post.body,'')),lower('Paid partnership with '||n.sponsor))=0 then
   raise exception 'WORKFLOW_DISCLOSURE_REQUIRED';end if;
  n.state:='in_review';n.submitted_by:=a.actor_id;n.submitted_at:=clock_timestamp();n.creative_hash:=studio_workflow.post_hash(post);
  n.approved_by:=null;n.approved_at:=null;n.review_note:='';
 elsif p_action='withdraw' then
  if n.state<>'in_review' or n.submitted_by is distinct from a.actor_id then raise exception 'WORKFLOW_INVALID_TRANSITION';end if;
  n.state:='draft';n.creative_hash:=null;
 elsif p_action in ('request_changes','approve') then
  if n.state<>'in_review' then raise exception 'WORKFLOW_INVALID_TRANSITION';end if;
  if n.submitted_by=a.actor_id then raise exception 'WORKFLOW_INDEPENDENT_REVIEW_REQUIRED';end if;
  if p_action='request_changes' then
   if length(btrim(coalesce(p_note,'')))<3 then raise exception 'WORKFLOW_REVIEW_NOTE_REQUIRED';end if;
   n.state:='changes_requested';n.creative_hash:=null;
  else
   if post.id is null or n.creative_hash is distinct from studio_workflow.post_hash(post) then raise exception 'WORKFLOW_CREATIVE_CHANGED';end if;
   n.state:='approved';n.approved_by:=a.actor_id;n.approved_at:=clock_timestamp();
  end if;
  n.review_note:=coalesce(p_note,'');
 elsif p_action='schedule' then
  if n.state<>'approved' then raise exception 'WORKFLOW_INVALID_TRANSITION';end if;
  if post.id is null or post.status not in ('draft','failed','cancelled') or n.creative_hash is distinct from studio_workflow.post_hash(post) then raise exception 'WORKFLOW_CREATIVE_CHANGED';end if;
  if n.publish_at is null or n.publish_at<=clock_timestamp() or n.publish_at>clock_timestamp()+interval '1 year'
   or (n.embargo_at is not null and n.publish_at<n.embargo_at) then raise exception 'WORKFLOW_INVALID_SCHEDULE';end if;
  if not n.rights_verified or n.rights_owner='' or n.territory='' or (n.rights_expires_at is not null and n.rights_expires_at<=n.publish_at) then raise exception 'WORKFLOW_RIGHTS_EXPIRED';end if;
  n.state:='scheduled';
 elsif p_action='cancel' then
  if n.state='cancelled' or post.status in ('publishing','published') then raise exception 'WORKFLOW_INVALID_TRANSITION';end if;
  n.state:='cancelled';
 end if;
 n.version:=n.version+1;n.updated_at:=clock_timestamp();
 update studio_workflow.newsroom set state=n.state,version=n.version,updated_at=n.updated_at,submitted_by=n.submitted_by,submitted_at=n.submitted_at,
  approved_by=n.approved_by,approved_at=n.approved_at,review_note=n.review_note,creative_hash=n.creative_hash where id=n.id;
 if p_action='schedule' then
  update public.studio_scheduled_posts set status='scheduled',publish_at=n.publish_at,error=null,updated_at=clock_timestamp() where id=post.id;
 elsif p_action='cancel' and post.id is not null then
  update public.studio_scheduled_posts set status='cancelled',updated_at=clock_timestamp() where id=post.id;
 end if;
 perform studio_workflow.event(a,'newsroom',n.id,p_action,p_note);
 perform studio_workflow.remember(a,p_request_key,'newsroom.transition',payload,n.id);
 return studio_workflow.newsroom_json(n.id,a);
end $$;

-- Existing Planner/publisher entry points cannot bypass an attached approval.
-- The checked creative stays immutable during review and scheduling.
-- Every workflow state change for a linked post first holds that post's UPDATE
-- lock. This trigger runs under the same row lock and deliberately does not
-- acquire a newsroom-row lock (which would invert the transition lock order).
create function studio_workflow.guard_editorial_post() returns trigger
language plpgsql security definer set search_path='' as $$
declare n studio_workflow.newsroom%rowtype;
begin
 select * into n from studio_workflow.newsroom where scheduled_post_id=old.id
  order by (state='cancelled'),created_at desc,id desc limit 1;
 if not found then return case when tg_op='DELETE' then old else new end;end if;
 if tg_op='DELETE' then
  if n.state<>'cancelled' then raise exception 'WORKFLOW_CANCEL_BEFORE_DELETE';end if;
  return old;
 end if;
 if old.status='published' and (new.status<>'published' or new.published_post_id is distinct from old.published_post_id) then
  raise exception 'WORKFLOW_ALREADY_PUBLISHED';end if;
 if studio_workflow.post_hash(new) is distinct from studio_workflow.post_hash(old) and n.state in ('in_review','approved','scheduled') then
  raise exception 'WORKFLOW_WITHDRAW_BEFORE_EDIT';end if;
 if new.status in ('scheduled','publishing','published') then
  if n.state<>'scheduled' or n.creative_hash is distinct from studio_workflow.post_hash(new) or new.publish_at is distinct from n.publish_at then
   raise exception 'WORKFLOW_APPROVAL_REQUIRED';end if;
  if not n.rights_verified or n.rights_owner='' or n.territory='' or (n.rights_expires_at is not null and n.rights_expires_at<=greatest(clock_timestamp(),n.publish_at)) then
   raise exception 'WORKFLOW_RIGHTS_EXPIRED';end if;
  if n.embargo_at is not null and n.publish_at<n.embargo_at then raise exception 'WORKFLOW_EMBARGO_ACTIVE';end if;
  if new.status in ('publishing','published') and clock_timestamp()<greatest(n.publish_at,coalesce(n.embargo_at,n.publish_at)) then
   raise exception 'WORKFLOW_EMBARGO_ACTIVE';end if;
 elsif n.state='scheduled' and new.status not in ('failed') then raise exception 'WORKFLOW_CANCEL_IN_NEWSROOM';end if;
 return new;
end $$;
create trigger studio_editorial_post_guard before update or delete on public.studio_scheduled_posts
 for each row execute function studio_workflow.guard_editorial_post();

-- A public-post link is a reviewed source, not an evergreen approval for any
-- later caption/media changes. Engagement counters are intentionally excluded.
create function studio_workflow.creator_post_hash(p_id uuid,p_creator uuid) returns text
language sql stable security definer set search_path='' as $$
 select encode(extensions.digest(jsonb_build_object('id',p.id,'owner',p.user_id,'content',p.content,'body',p.body,'category',p.category,
  'image_url',p.image_url,'media_url',p.media_url,'article_title',p.article_title,'read_minutes',p.read_minutes,'link_url',p.link_url,
  'innovation_field',p.innovation_field,'innovation_stage',p.innovation_stage,'channel',p.channel,'scope',p.scope,
  'media',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'url',m.url,'type',m.media_type,'width',m.width,'height',m.height,'order',m.sort_order,
   'edit',m.edit,'alt_text',m.alt_text,'is_sensitive',m.is_sensitive,'role',m.role) order by m.sort_order,m.id) from public.post_media m where m.post_id=p.id),'[]'::jsonb),
  'articles',coalesce((select jsonb_agg(to_jsonb(ar)-array['created_at','updated_at']::text[] order by ar.id) from public.articles ar where ar.linked_post_id=p.id),'[]'::jsonb),
  'poll',coalesce((select to_jsonb(po)-'created_at' from public.post_polls po where po.post_id=p.id),'{}'::jsonb),
  'poll_options',coalesce((select jsonb_agg(to_jsonb(op) order by op.sort_order,op.id) from public.post_poll_options op where op.post_id=p.id),'[]'::jsonb),
  'media_tags',coalesce((select jsonb_agg(to_jsonb(mt)-'created_at' order by mt.id) from public.post_media_tags mt where mt.post_id=p.id),'[]'::jsonb),
  'products',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'title',r.title,'subtitle',r.subtitle,'price',r.price,'currency',r.currency,'image',r.image_url,
   'listing',r.listing_id,'link',r.link_url,'cta',r.cta_label,'order',r.sort_order) order by r.sort_order,r.id) from public.post_products r where r.post_id=p.id),'[]'::jsonb))::text,'sha256'),'hex')
 from public.posts p join public.profiles pr on pr.id=p.user_id
 where p.id=p_id and p.user_id=p_creator and p.audience='everyone' and p.community_id is null
  and p.archived_at is null and not coalesce(p.is_exclusive,false) and p.institution_id is null and p.affiliation_id is null
  and p.quoted_post_id is null and p.thread_parent_id is null
  and pr.deactivated_at is null and coalesce(pr.profile_visibility,'public')<>'private'
  and not exists(select 1 from admin_ops.removals where content_id=p_id and kind='post');
$$;
create function studio_workflow.deliverable_unchanged(p_id uuid,p_creator uuid,p_version integer) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce((select (d.post_hash is null and d.post_id is null)
  or (d.post_hash is not null and d.post_id is not null and d.post_hash=studio_workflow.creator_post_hash(d.post_id,p_creator))
  from studio_workflow.deliverables d where d.partnership_id=p_id and d.version=p_version),false);
$$;
create function studio_workflow.partnership_json(p_id uuid,a studio_workflow.actor,p_detail boolean default true) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p studio_workflow.partnerships%rowtype; is_creator boolean; source_unchanged boolean;
begin
 select * into p from studio_workflow.partnerships where id=p_id and (owner_id=a.user_id or (creator_id=a.user_id and state<>'draft'));
 if not found then raise exception 'WORKFLOW_NOT_FOUND' using errcode='42501';end if;
 is_creator:=p.creator_id=a.user_id;
 if not is_creator then perform studio_workflow.require_roles(a,array['owner','admin','editor']);end if;
 source_unchanged:=studio_workflow.deliverable_unchanged(p.id,p.creator_id,p.deliverable_version);
 return to_jsonb(p)||jsonb_build_object(
  'creator_username',(select username from public.profiles where id=p.creator_id),
  'creator_name',(select full_name from public.profiles where id=p.creator_id),
  'owner_name',(select full_name from public.profiles where id=p.owner_id),
  'is_creator',is_creator,
  'can_edit',not is_creator and a.role in ('owner','admin','editor') and p.state='draft',
  'can_propose',not is_creator and a.role in ('owner','admin') and p.state='draft',
  'can_review',not is_creator and a.role in ('owner','admin') and p.state='submitted',
  'can_deliver',is_creator and (p.state in ('accepted','changes_requested') or (p.state in ('submitted','approved') and not source_unchanged)),
  'can_accept',is_creator and p.state='proposed',
  'can_cancel',not is_creator and a.role in ('owner','admin') and p.state not in ('closed','cancelled','declined'),
  'can_withdraw',is_creator and p.state in ('accepted','submitted','changes_requested','approved'),
  'can_close',not is_creator and a.role in ('owner','admin') and p.state='approved',
  'can_grant_permission',is_creator and p.state='approved' and p.deliverable_version>0 and source_unchanged,
  'source_unchanged',source_unchanged,
  'publishing_permission_recorded',p.publishing_granted,
  'paid_promotion_permission_recorded',p.paid_promotion_granted,
  'publishing_granted',coalesce(p.publishing_granted and p.permission_version=p.deliverable_version and p.publishing_expires_at>clock_timestamp() and p.state='approved' and source_unchanged,false),
  'paid_promotion_granted',coalesce(p.paid_promotion_granted and p.permission_version=p.deliverable_version and p.paid_promotion_expires_at>clock_timestamp() and p.state='approved' and source_unchanged,false),
  'versions',coalesce((select jsonb_agg(to_jsonb(d) order by d.version desc) from (
   select version,content,post_id,submitted_at from studio_workflow.deliverables where partnership_id=p.id order by version desc limit case when p_detail then 10 else 1 end)d),'[]'::jsonb),
  'events',coalesce((select jsonb_agg(to_jsonb(e) order by e.at desc,e.id desc) from (
   select id,action,note,actor_user_id,actor_member_id,at from studio_workflow.events where partnership_id=p.id order by at desc,id desc limit case when p_detail then 30 else 1 end)e),'[]'::jsonb));
end $$;
create function public.studio_partnerships_list(p_limit integer default 50,p_before_at timestamptz default null,p_before_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a studio_workflow.actor:=studio_workflow.context();cap integer:=least(greatest(coalesce(p_limit,50),1),100);rows jsonb;total integer;cursor jsonb;
begin
 if a.is_business then perform studio_workflow.require_roles(a,array['owner','admin','editor']);end if;
 if (p_before_at is null)<>(p_before_id is null) then raise exception 'WORKFLOW_INVALID_CURSOR';end if;
 with limited as (select p.id,p.updated_at from studio_workflow.partnerships p where
  (p.owner_id=a.user_id or (p.creator_id=a.user_id and p.state<>'draft'))
  and (p_before_at is null or (p.updated_at,p.id)<(p_before_at,p_before_id)) order by p.updated_at desc,p.id desc limit cap+1),
 page as (select * from limited order by updated_at desc,id desc limit cap)
 select coalesce((select jsonb_agg(studio_workflow.partnership_json(id,a,false) order by updated_at desc,id desc) from page),'[]'::jsonb),
 (select count(*) from limited),(select jsonb_build_object('at',updated_at,'id',id) from page order by updated_at,id limit 1)
 into rows,total,cursor;
 return jsonb_build_object('items',rows,'has_more',total>cap,'next_cursor',case when total>cap then cursor end,'role',a.role,'member_id',a.member_id);
end $$;

create function public.studio_partnership_get(p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a studio_workflow.actor:=studio_workflow.context();
begin return studio_workflow.partnership_json(p_id,a);end $$;

-- Blocking or account closure prevents starting or expanding a collaboration.
-- Existing participants may still decline, cancel, withdraw or revoke consent.
create function studio_workflow.participants_available(p_owner uuid,p_creator uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.blocked_users where (blocker_id=p_owner and blocked_id=p_creator) or (blocker_id=p_creator and blocked_id=p_owner))
  or (select count(*) from public.profiles p join auth.users u on u.id=p.id where p.id in (p_owner,p_creator)
   and p.deactivated_at is null and u.deleted_at is null and (u.banned_until is null or u.banned_until<=clock_timestamp())
   and not exists(select 1 from account_erasure.jobs j where j.user_id=p.id and j.state<>'completed')
   and not exists(select 1 from admin_ops.staff_social_shells s where s.user_id=p.id))<>2 then
  raise exception 'WORKFLOW_PARTICIPANT_UNAVAILABLE' using errcode='42501';end if;
end $$;

create function public.studio_partnership_save(p_expected_user uuid,p_request_key uuid,p_id uuid,p_version integer,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a studio_workflow.actor:=studio_workflow.write_context(p_expected_user);p studio_workflow.partnerships%rowtype;prior uuid;creator uuid;
 payload jsonb:=jsonb_build_object('id',p_id,'version',p_version,'input',p_input);
begin
 if not a.is_business then raise exception 'WORKFLOW_BUSINESS_REQUIRED' using errcode='42501';end if;
 perform studio_workflow.require_roles(a,array['owner','admin','editor']);
 perform studio_workflow.input(p_input,array['title','brief','deliverables','creator_username','due_at','fee_minor','currency','disclosure']);
 prior:=studio_workflow.command_result(a,p_request_key,'partnership.save',payload);
 if prior is not null then return studio_workflow.partnership_json(prior,a);end if;
 if p_id is not null then
  select * into p from studio_workflow.partnerships where id=p_id and owner_id=a.user_id for update;
  if not found then raise exception 'WORKFLOW_NOT_FOUND' using errcode='42501';end if;
  if p.version is distinct from p_version then raise exception 'WORKFLOW_VERSION_CHANGED';end if;
  if p.state<>'draft' then raise exception 'WORKFLOW_EDIT_REQUIRES_DRAFT';end if;
 else
  if p_version is not null then raise exception 'WORKFLOW_INVALID_VERSION';end if;
  p.id:=gen_random_uuid();p.owner_id:=a.user_id;p.version:=0;p.created_at:=clock_timestamp();p.created_by:=a.actor_id;
 end if;
 select id into creator from public.profiles where lower(username)=lower(ltrim(btrim(coalesce(p_input->>'creator_username','')),'@'))
  and account_type is distinct from 'business' and deactivated_at is null and id<>a.user_id
  and (coalesce(profile_visibility,'public')<>'private' or exists(select 1 from public.follows where follower_id=a.user_id and following_id=profiles.id))
  and not exists(select 1 from admin_ops.staff_social_shells where user_id=profiles.id);
 if creator is null then raise exception 'WORKFLOW_CREATOR_UNAVAILABLE';end if;
 -- Match public/follower profile discovery and block rules explicitly because
 -- this private-schema RPC executes with definer privileges.
 if not exists(select 1 from auth.users where id=creator and deleted_at is null and (banned_until is null or banned_until<=clock_timestamp())) then
  raise exception 'WORKFLOW_CREATOR_UNAVAILABLE';end if;
 if exists(select 1 from public.blocked_users where (blocker_id=a.user_id and blocked_id=creator) or (blocker_id=creator and blocked_id=a.user_id)) then
  raise exception 'WORKFLOW_CREATOR_UNAVAILABLE';end if;
 p.creator_id:=creator;p.title:=btrim(coalesce(p_input->>'title',''));p.brief:=coalesce(p_input->>'brief','');
 p.deliverables:=coalesce(p_input->>'deliverables','');p.disclosure:=btrim(coalesce(p_input->>'disclosure',''));
 p.due_at:=nullif(p_input->>'due_at','')::timestamptz;p.fee_minor:=nullif(p_input->>'fee_minor','')::bigint;p.currency:=upper(coalesce(nullif(p_input->>'currency',''),'USD'));
 if p.title='' or length(p.title)>160 or length(p.brief)>5000 or length(p.deliverables)>5000 or length(p.disclosure)>500
  or p.currency !~ '^[A-Z]{3}$' or (p.fee_minor is not null and (p.fee_minor<0 or p.fee_minor>100000000000))
  or (p.due_at is not null and (not isfinite(p.due_at) or p.due_at<=clock_timestamp())) then raise exception 'WORKFLOW_INVALID_INPUT';end if;
 p.state:='draft';p.version:=p.version+1;p.updated_at:=clock_timestamp();p.deliverable_version:=0;
 p.publishing_granted:=false;p.paid_promotion_granted:=false;p.publishing_expires_at:=null;p.paid_promotion_expires_at:=null;p.permission_version:=null;p.review_note:='';
 if p_id is null then insert into studio_workflow.partnerships select p.*;
 else update studio_workflow.partnerships set creator_id=p.creator_id,title=p.title,brief=p.brief,deliverables=p.deliverables,disclosure=p.disclosure,
  due_at=p.due_at,fee_minor=p.fee_minor,currency=p.currency,version=p.version,updated_at=p.updated_at where id=p.id;end if;
 perform studio_workflow.event(a,'partnership',p.id,case when p_id is null then 'created' else 'edited' end);
 perform studio_workflow.remember(a,p_request_key,'partnership.save',payload,p.id);
 return studio_workflow.partnership_json(p.id,a);
end $$;

create function public.studio_partnership_transition(p_expected_user uuid,p_request_key uuid,p_id uuid,p_version integer,p_action text,p_note text default '') returns jsonb
language plpgsql security definer set search_path='' as $$
declare a studio_workflow.actor:=studio_workflow.write_context(p_expected_user);p studio_workflow.partnerships%rowtype;prior uuid;is_creator boolean;
 payload jsonb:=jsonb_build_object('id',p_id,'version',p_version,'action',p_action,'note',coalesce(p_note,''));
begin
 if p_action not in ('propose','accept','decline','withdraw','request_changes','approve','cancel','close') or length(coalesce(p_note,''))>2000 then raise exception 'WORKFLOW_INVALID_ACTION';end if;
 select * into p from studio_workflow.partnerships where id=p_id and (owner_id=a.user_id or (creator_id=a.user_id and state<>'draft'));
 if not found then raise exception 'WORKFLOW_NOT_FOUND' using errcode='42501';end if;
 is_creator:=p.creator_id=a.user_id;
 if p_action in ('accept','decline','withdraw') then
  if not is_creator then raise exception 'WORKFLOW_CREATOR_PERMISSION_REQUIRED' using errcode='42501';end if;
 else
  if is_creator then raise exception 'WORKFLOW_BUSINESS_REVIEW_REQUIRED' using errcode='42501';end if;
  perform studio_workflow.require_roles(a,array['owner','admin']);
 end if;
 prior:=studio_workflow.command_result(a,p_request_key,'partnership.transition',payload);
 if prior is not null then return studio_workflow.partnership_json(prior,a);end if;
 select * into p from studio_workflow.partnerships where id=p_id and (owner_id=a.user_id or (creator_id=a.user_id and state<>'draft')) for update;
 if not found then raise exception 'WORKFLOW_NOT_FOUND' using errcode='42501';end if;
 if p.version is distinct from p_version then raise exception 'WORKFLOW_VERSION_CHANGED';end if;
 if p_action in ('propose','accept','request_changes','approve') then perform studio_workflow.participants_available(p.owner_id,p.creator_id);end if;
 if p_action='propose' then
  if p.state<>'draft' or btrim(p.brief)='' or btrim(p.deliverables)='' or p.disclosure='' then raise exception 'WORKFLOW_BRIEF_INCOMPLETE';end if;
  if p.due_at is not null and p.due_at<=clock_timestamp() then raise exception 'WORKFLOW_DUE_DATE_PASSED';end if;
  p.state:='proposed';
 elsif p_action in ('accept','decline') then
  if p.state<>'proposed' then raise exception 'WORKFLOW_INVALID_TRANSITION';end if;
  p.state:=case when p_action='accept' then 'accepted' else 'declined' end;
 elsif p_action in ('request_changes','approve') then
  if p.state<>'submitted' or p.deliverable_version=0 then raise exception 'WORKFLOW_INVALID_TRANSITION';end if;
  if p_action='request_changes' then
   if length(btrim(coalesce(p_note,'')))<3 then raise exception 'WORKFLOW_REVIEW_NOTE_REQUIRED';end if;
   p.state:='changes_requested';
  else
   if not studio_workflow.deliverable_unchanged(p.id,p.creator_id,p.deliverable_version) then raise exception 'WORKFLOW_DELIVERABLE_CHANGED';end if;
   p.state:='approved';p.approved_by:=a.actor_id;p.approved_at:=clock_timestamp();
  end if;
  p.review_note:=coalesce(p_note,'');
 elsif p_action='cancel' then
  if p.state in ('closed','cancelled','declined') then raise exception 'WORKFLOW_INVALID_TRANSITION';end if;
  p.state:='cancelled';
 elsif p_action='withdraw' then
  if p.state not in ('accepted','submitted','changes_requested','approved') then raise exception 'WORKFLOW_INVALID_TRANSITION';end if;
  p.state:='cancelled';
 elsif p_action='close' then
  if p.state<>'approved' then raise exception 'WORKFLOW_INVALID_TRANSITION';end if;
  p.state:='closed';
 end if;
 p.version:=p.version+1;p.updated_at:=clock_timestamp();
 update studio_workflow.partnerships set state=p.state,version=p.version,updated_at=p.updated_at,approved_by=p.approved_by,approved_at=p.approved_at,
  review_note=p.review_note,publishing_granted=false,paid_promotion_granted=false,publishing_expires_at=null,paid_promotion_expires_at=null,permission_version=null where id=p.id;
 perform studio_workflow.event(a,'partnership',p.id,p_action,p_note);
 perform studio_workflow.remember(a,p_request_key,'partnership.transition',payload,p.id);
 return studio_workflow.partnership_json(p.id,a);
end $$;

create function public.studio_partnership_deliver(p_expected_user uuid,p_request_key uuid,p_id uuid,p_version integer,p_content text,p_post_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a studio_workflow.actor:=studio_workflow.write_context(p_expected_user);p studio_workflow.partnerships%rowtype;prior uuid;source_hash text;
 payload jsonb:=jsonb_build_object('id',p_id,'version',p_version,'content',p_content,'post_id',p_post_id);
begin
 select * into p from studio_workflow.partnerships where id=p_id and creator_id=a.user_id and state<>'draft';
 if not found then raise exception 'WORKFLOW_CREATOR_PERMISSION_REQUIRED' using errcode='42501';end if;
 prior:=studio_workflow.command_result(a,p_request_key,'partnership.deliver',payload);
 if prior is not null then return studio_workflow.partnership_json(prior,a);end if;
 select * into p from studio_workflow.partnerships where id=p_id and creator_id=a.user_id and state<>'draft' for update;
 if not found then raise exception 'WORKFLOW_CREATOR_PERMISSION_REQUIRED' using errcode='42501';end if;
 if p.version is distinct from p_version then raise exception 'WORKFLOW_VERSION_CHANGED';end if;
 if p.state not in ('accepted','changes_requested') and not (p.state in ('submitted','approved') and not studio_workflow.deliverable_unchanged(p.id,p.creator_id,p.deliverable_version)) then raise exception 'WORKFLOW_INVALID_TRANSITION';end if;
 perform studio_workflow.participants_available(p.owner_id,p.creator_id);
 if coalesce(btrim(p_content),'')='' or length(p_content)>10000 then raise exception 'WORKFLOW_DELIVERABLE_REQUIRED';end if;
 if p.deliverable_version>=50 then raise exception 'WORKFLOW_VERSION_LIMIT_REACHED';end if;
 if p_post_id is not null then
  source_hash:=studio_workflow.creator_post_hash(p_post_id,a.user_id);
  if source_hash is null then raise exception 'WORKFLOW_PUBLIC_OWN_POST_REQUIRED';end if;
 end if;
 p.deliverable_version:=p.deliverable_version+1;
 insert into studio_workflow.deliverables(partnership_id,version,content,post_id,post_hash) values(p.id,p.deliverable_version,p_content,p_post_id,source_hash);
 update studio_workflow.partnerships set state='submitted',version=version+1,updated_at=clock_timestamp(),deliverable_version=p.deliverable_version,
  publishing_granted=false,paid_promotion_granted=false,publishing_expires_at=null,paid_promotion_expires_at=null,permission_version=null,
  approved_by=null,approved_at=null,review_note='' where id=p.id;
 perform studio_workflow.event(a,'partnership',p.id,'deliverable_submitted');
 perform studio_workflow.remember(a,p_request_key,'partnership.deliver',payload,p.id);
 return studio_workflow.partnership_json(p.id,a);
end $$;

create function public.studio_partnership_permission(p_expected_user uuid,p_request_key uuid,p_id uuid,p_version integer,p_permission text,p_granted boolean,p_expires_at timestamptz default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a studio_workflow.actor:=studio_workflow.write_context(p_expected_user);p studio_workflow.partnerships%rowtype;prior uuid;
 payload jsonb:=jsonb_build_object('id',p_id,'version',p_version,'permission',p_permission,'granted',p_granted,'expires_at',p_expires_at);
begin
 select * into p from studio_workflow.partnerships where id=p_id and creator_id=a.user_id and state<>'draft';
 if not found then raise exception 'WORKFLOW_CREATOR_PERMISSION_REQUIRED' using errcode='42501';end if;
 if p_permission not in ('publishing','paid_promotion') or p_granted is null then raise exception 'WORKFLOW_INVALID_ACTION';end if;
 prior:=studio_workflow.command_result(a,p_request_key,'partnership.permission',payload);
 if prior is not null then return studio_workflow.partnership_json(prior,a);end if;
 select * into p from studio_workflow.partnerships where id=p_id and creator_id=a.user_id and state<>'draft' for update;
 if not found then raise exception 'WORKFLOW_CREATOR_PERMISSION_REQUIRED' using errcode='42501';end if;
 if p.version is distinct from p_version then raise exception 'WORKFLOW_VERSION_CHANGED';end if;
 if p_granted and (p.state<>'approved' or p.deliverable_version=0) then raise exception 'WORKFLOW_APPROVED_DELIVERABLE_REQUIRED';end if;
 if p_granted and not studio_workflow.deliverable_unchanged(p.id,p.creator_id,p.deliverable_version) then raise exception 'WORKFLOW_DELIVERABLE_CHANGED';end if;
 if p_granted then perform studio_workflow.participants_available(p.owner_id,p.creator_id);end if;
 if p_granted and (p_expires_at is null or not isfinite(p_expires_at) or p_expires_at<=clock_timestamp() or p_expires_at>clock_timestamp()+interval '1 year') then
  raise exception 'WORKFLOW_PERMISSION_EXPIRY_REQUIRED';end if;
 update studio_workflow.partnerships set
  publishing_granted=case when p_permission='publishing' then p_granted else publishing_granted end,
  publishing_expires_at=case when p_permission='publishing' then case when p_granted then p_expires_at end else publishing_expires_at end,
  paid_promotion_granted=case when p_permission='paid_promotion' then p_granted else paid_promotion_granted end,
  paid_promotion_expires_at=case when p_permission='paid_promotion' then case when p_granted then p_expires_at end else paid_promotion_expires_at end,
  permission_version=deliverable_version,version=version+1,updated_at=clock_timestamp() where id=p.id;
 perform studio_workflow.event(a,'partnership',p.id,p_permission||case when p_granted then '_granted' else '_revoked' end);
 perform studio_workflow.remember(a,p_request_key,'partnership.permission',payload,p.id);
 return studio_workflow.partnership_json(p.id,a);
end $$;

-- Business access is a role-controlled operation, not an owner-id-only table
-- write. The raw access-code hashes are never exposed to app clients.
revoke all on public.business_access_members,public.business_devices,public.business_signin_log,public.studio_session_members from public,anon,authenticated;
create table studio_workflow.access_events (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references public.profiles(id) on delete cascade,
 actor_member_id uuid, target_id uuid, action text not null,
 before_state jsonb, after_state jsonb,
 created_at timestamptz not null default clock_timestamp()
);
alter table studio_workflow.access_events enable row level security;
revoke all on studio_workflow.access_events from public,anon,authenticated,service_role;
create index studio_access_events_owner on studio_workflow.access_events(owner_id,created_at desc,id desc);

create or replace function public.studio_role() returns text
language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=auth.uid();sid uuid;is_business boolean;r text;
begin
 if uid is null or coalesce(auth.jwt()->>'is_anonymous','false')<>'false' then return null;end if;
 begin sid:=(auth.jwt()->>'session_id')::uuid;exception when others then return null;end;
 if not exists(select 1 from auth.sessions s join auth.users u on u.id=s.user_id where s.id=sid and s.user_id=uid
  and (s.not_after is null or s.not_after>now()) and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now()))
  or exists(select 1 from account_erasure.jobs where user_id=uid and state<>'completed')
  or exists(select 1 from admin_ops.staff_social_shells where user_id=uid) then return null;end if;
 select coalesce(account_type='business',false) into is_business from public.profiles where id=uid and deactivated_at is null;
 if not found then return null;end if;
 if not is_business or not exists(select 1 from public.business_access_members where business_id=uid) then return 'owner';end if;
 select m.role into r from public.studio_session_members s join public.business_access_members m on m.id=s.member_id and m.business_id=s.business_id
  where s.session_id=sid::text and s.business_id=uid and m.active;
 return case when r in ('owner','admin','editor','recruiter','support') then r else null end;
end $$;

create or replace function public.studio_bind_member(p_code text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();sid uuid;m public.business_access_members%rowtype;v_hash text;
begin
 if uid is null or coalesce(auth.jwt()->>'is_anonymous','false')<>'false' or length(coalesce(p_code,'')) not between 4 and 200 then
  raise exception 'WORKFLOW_ACTIVE_SESSION_REQUIRED' using errcode='42501';end if;
 perform account_erasure.assert_writable(uid);
 begin sid:=(auth.jwt()->>'session_id')::uuid;exception when others then sid:=null;end;
 perform 1 from auth.sessions s join auth.users u on u.id=s.user_id where s.id=sid and s.user_id=uid
  and (s.not_after is null or s.not_after>clock_timestamp()) and u.deleted_at is null and (u.banned_until is null or u.banned_until<=clock_timestamp()) for share of s,u;
 if not found or not exists(select 1 from public.profiles where id=uid and account_type='business' and deactivated_at is null) then
  raise exception 'WORKFLOW_ACTIVE_SESSION_REQUIRED' using errcode='42501';end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('studio-access:'||uid::text,0));
 v_hash:=upper(encode(extensions.digest(upper(btrim(p_code)),'sha256'),'hex'));
 select * into m from public.business_access_members where business_id=uid and active and upper(code_hash)=v_hash for update;
 if not found then raise exception 'Code not recognised' using errcode='42501';end if;
 insert into public.studio_session_members(session_id,business_id,member_id) values(sid::text,uid,m.id)
  on conflict(session_id) do update set member_id=excluded.member_id,business_id=excluded.business_id,bound_at=clock_timestamp();
 update public.business_access_members set last_sign_in_at=clock_timestamp() where id=m.id;
 return jsonb_build_object('member_id',m.id,'role',m.role,'display_name',m.display_name);
end $$;

create or replace function public.studio_list_members()
returns table(id uuid,display_name text,role text,active boolean,last_sign_in_at timestamptz,created_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare a studio_workflow.actor:=studio_workflow.context();
begin
 perform studio_workflow.require_roles(a,array['owner','admin']);
 return query select m.id,m.display_name,m.role,m.active,m.last_sign_in_at,m.created_at
  from public.business_access_members m where m.business_id=a.user_id order by m.created_at,m.id;
end $$;

create or replace function public.studio_create_member(p_name text,p_role text default 'admin') returns text
language plpgsql security definer set search_path='' as $$
declare a studio_workflow.actor;new_id uuid:=gen_random_uuid();raw_code text;code text;first_member boolean;
begin
 if auth.uid() is null then raise exception 'WORKFLOW_ACTIVE_SESSION_REQUIRED' using errcode='42501';end if;
 perform account_erasure.assert_writable(auth.uid());
 perform pg_advisory_xact_lock(hashtextextended('studio-access:'||auth.uid()::text,0));
 a:=studio_workflow.context();perform studio_workflow.require_roles(a,array['owner']);
 if not a.is_business then raise exception 'WORKFLOW_BUSINESS_REQUIRED';end if;
 if length(btrim(coalesce(p_name,''))) not between 1 and 100 or p_role not in ('owner','admin','editor','recruiter','support') then raise exception 'WORKFLOW_INVALID_INPUT';end if;
 first_member:=not exists(select 1 from public.business_access_members where business_id=a.user_id);
 if first_member and p_role<>'owner' then raise exception 'WORKFLOW_FIRST_MEMBER_MUST_BE_OWNER';end if;
 if (select count(*) from public.business_access_members where business_id=a.user_id)>=500 then raise exception 'WORKFLOW_TEAM_LIMIT_REACHED';end if;
 raw_code:=upper(encode(extensions.gen_random_bytes(12),'hex'));
 code:=substr(raw_code,1,6)||'-'||substr(raw_code,7,6)||'-'||substr(raw_code,13,6)||'-'||substr(raw_code,19,6);
 insert into public.business_access_members(id,business_id,display_name,role,code_hash)
  values(new_id,a.user_id,btrim(p_name),p_role,encode(extensions.digest(code,'sha256'),'hex'));
 if first_member then
  insert into public.studio_session_members(session_id,business_id,member_id) values(a.session_id::text,a.user_id,new_id)
  on conflict(session_id) do update set member_id=excluded.member_id,business_id=excluded.business_id,bound_at=clock_timestamp();
 end if;
 insert into studio_workflow.access_events(owner_id,actor_member_id,target_id,action,after_state)
  values(a.user_id,a.member_id,new_id,'member_created',jsonb_build_object('role',p_role,'active',true));
 return code;
end $$;
create function public.studio_create_member(p_expected_user uuid,p_name text,p_role text) returns text
language plpgsql security definer set search_path='' as $$
begin
 if p_expected_user is null or auth.uid() is distinct from p_expected_user then
  raise exception 'WORKFLOW_ACTIVE_SESSION_REQUIRED' using errcode='42501';end if;
 return public.studio_create_member(p_name,p_role);
end $$;
create or replace function public.create_business_access_member(p_name text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare code text;role_name text;
begin
 role_name:=case when exists(select 1 from public.business_access_members where business_id=auth.uid()) then 'support' else 'owner' end;
 code:=public.studio_create_member(p_name,role_name);
 return jsonb_build_object('code',code);
end $$;

create or replace function public.studio_set_member_role(p_member uuid,p_role text) returns void
language plpgsql security definer set search_path='' as $$
declare a studio_workflow.actor;m public.business_access_members%rowtype;
begin
 if auth.uid() is null then raise exception 'WORKFLOW_ACTIVE_SESSION_REQUIRED' using errcode='42501';end if;
 perform account_erasure.assert_writable(auth.uid());perform pg_advisory_xact_lock(hashtextextended('studio-access:'||auth.uid()::text,0));
 a:=studio_workflow.context();perform studio_workflow.require_roles(a,array['owner']);
 if p_role not in ('owner','admin','editor','recruiter','support') then raise exception 'WORKFLOW_INVALID_INPUT';end if;
 select * into m from public.business_access_members where id=p_member and business_id=a.user_id for update;
 if not found then raise exception 'WORKFLOW_MEMBER_UNAVAILABLE';end if;
 if m.active and m.role='owner' and p_role<>'owner' and not exists(select 1 from public.business_access_members where business_id=a.user_id and id<>m.id and active and role='owner') then
  raise exception 'WORKFLOW_LAST_OWNER';end if;
 update public.business_access_members set role=p_role where id=m.id;
 insert into studio_workflow.access_events(owner_id,actor_member_id,target_id,action,before_state,after_state)
 values(a.user_id,a.member_id,m.id,'member_role_changed',jsonb_build_object('role',m.role),jsonb_build_object('role',p_role));
end $$;
create or replace function public.studio_set_member_active(p_member uuid,p_active boolean) returns void
language plpgsql security definer set search_path='' as $$
declare a studio_workflow.actor;m public.business_access_members%rowtype;
begin
 if auth.uid() is null then raise exception 'WORKFLOW_ACTIVE_SESSION_REQUIRED' using errcode='42501';end if;
 perform account_erasure.assert_writable(auth.uid());perform pg_advisory_xact_lock(hashtextextended('studio-access:'||auth.uid()::text,0));
 a:=studio_workflow.context();perform studio_workflow.require_roles(a,array['owner']);
 if p_active is null then raise exception 'WORKFLOW_INVALID_INPUT';end if;
 select * into m from public.business_access_members where id=p_member and business_id=a.user_id for update;
 if not found then raise exception 'WORKFLOW_MEMBER_UNAVAILABLE';end if;
 if m.active and m.role='owner' and not p_active and not exists(select 1 from public.business_access_members where business_id=a.user_id and id<>m.id and active and role='owner') then
  raise exception 'WORKFLOW_LAST_OWNER';end if;
 update public.business_access_members set active=p_active where id=m.id;
 if not p_active then delete from public.studio_session_members where member_id=m.id;end if;
 insert into studio_workflow.access_events(owner_id,actor_member_id,target_id,action,before_state,after_state)
 values(a.user_id,a.member_id,m.id,'member_access_changed',jsonb_build_object('active',m.active),jsonb_build_object('active',p_active));
end $$;

create or replace function public.studio_set_device(p_device uuid,p_action text) returns void
language plpgsql security definer set search_path='' as $$
declare a studio_workflow.actor:=studio_workflow.context();d public.business_devices%rowtype;
begin
 perform studio_workflow.require_roles(a,array['owner','admin']);
 if p_action not in ('approve','remove') then raise exception 'WORKFLOW_INVALID_ACTION';end if;
 select * into d from public.business_devices where id=p_device and business_id=a.user_id for update;
 if not found then raise exception 'WORKFLOW_DEVICE_UNAVAILABLE';end if;
 -- Keep a rejected registration as pending. Deleting the last registration
 -- could cause an old sign-in flow to trust it as a new first device again.
 update public.business_devices set status=case when p_action='approve' then 'approved' else 'pending' end,
  approved_at=case when p_action='approve' then clock_timestamp() end where id=d.id;
 insert into studio_workflow.access_events(owner_id,actor_member_id,target_id,action,before_state,after_state)
 values(a.user_id,a.member_id,d.id,'device_'||p_action,jsonb_build_object('status',d.status),
  jsonb_build_object('status',case when p_action='approve' then 'approved' else 'pending' end));
end $$;

-- Preserve public profile/business settings for every bound role; access
-- records and device identifiers are visible only to owners/administrators.
create or replace function public.studio_get_business() returns jsonb
language plpgsql security definer set search_path='' as $$
declare a studio_workflow.actor:=studio_workflow.context();can_manage boolean;
begin
 can_manage:=a.role in ('owner','admin');
 return jsonb_build_object(
  'profile',(select jsonb_build_object('id',id,'full_name',full_name,'username',username,'bio',bio,'avatar_url',avatar_url,'is_verified',is_verified) from public.profiles where id=a.user_id),
  'business',(select jsonb_build_object('id',id,'category',category,'location',location,'address',address,'phone',phone,'email',email,'website',website,
   'social_links',coalesce(social_links,'{}'::jsonb),'hours',hours,'is_verified',is_verified,'avg_rating',avg_rating,'review_count',review_count)
   from public.business_profiles where profile_id=a.user_id limit 1),
  'members',case when can_manage then coalesce((select jsonb_agg(to_jsonb(m) order by m.created_at,m.id) from (
   select id,display_name,role,active,last_sign_in_at,created_at from public.business_access_members where business_id=a.user_id order by created_at,id limit 500)m),'[]'::jsonb) else '[]'::jsonb end,
  'devices',case when can_manage then coalesce((select jsonb_agg(to_jsonb(d) order by d.created_at desc,d.id) from (
   select id,device_id,label,status,created_at,approved_at from public.business_devices where business_id=a.user_id order by created_at desc,id limit 200)d),'[]'::jsonb) else '[]'::jsonb end,
  'signins',case when can_manage then coalesce((select jsonb_agg(to_jsonb(s) order by s.created_at desc,s.id) from (
   select id,member_name,device_id,created_at from public.business_signin_log where business_id=a.user_id order by created_at desc,id limit 20)s),'[]'::jsonb) else '[]'::jsonb end,
  'role',a.role,
  'activity',case when can_manage then coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at desc,e.id desc) from (
   select id,actor_member_id,target_id,action,before_state,after_state,created_at from studio_workflow.access_events where owner_id=a.user_id order by created_at desc,id desc limit 30)e),'[]'::jsonb) else '[]'::jsonb end);
end $$;
create or replace function public.studio_business_info() returns jsonb
language sql security definer set search_path='' as $$select public.studio_get_business()$$;

-- No default PUBLIC execution on any new private helper, including types.
revoke all on all functions in schema studio_workflow from public,anon,authenticated,service_role;
revoke all on type studio_workflow.actor from public,anon,authenticated,service_role;
do $grants$
declare f record;
begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in ('studio_newsroom_list','studio_newsroom_get','studio_newsroom_save','studio_newsroom_transition',
   'studio_partnerships_list','studio_partnership_get','studio_partnership_save','studio_partnership_transition','studio_partnership_deliver','studio_partnership_permission',
   'studio_role','studio_bind_member','studio_list_members','studio_create_member','studio_set_member_active','studio_set_member_role',
   'create_business_access_member','studio_set_device','studio_business_info','studio_get_business')
 loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  execute format('grant execute on function %s to authenticated',f.signature);
 end loop;
end $grants$;
commit;
