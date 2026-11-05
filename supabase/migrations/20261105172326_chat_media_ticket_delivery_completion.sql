-- Complete existing ordinary-chat no-store tickets without replacing the
-- content authorization chain, the readiness flag, or the limited-view grant.
-- Source fingerprints refuse an unreviewed baseline. QA's existing business
-- session check and production's readiness gate are preserved verbatim.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $preflight$
declare signature text; fingerprint text; baseline jsonb;
begin
 foreach signature in array array['media_delivery.require_session()',
  'public.chat_media_manifest(uuid[])','public.chat_object_path(text)',
  'public.can_read_chat_object(text,text)','public.can_access_chat_conversation(uuid)',
  'public.social_can_read_channel(uuid)','public.studio_role()'] loop
  if to_regprocedure(signature) is null then raise exception 'CHAT_TICKETS_PREREQUISITE_MISSING: %',signature;end if;
 end loop;
 if to_regclass('media_delivery.tickets') is null then raise exception 'CHAT_TICKETS_TABLE_MISSING';end if;
 select md5(prosrc) into fingerprint from pg_proc where oid=to_regprocedure('media_delivery.issue(text,text,uuid,uuid)');
 if fingerprint is null or fingerprint not in('06ecfee711fe5d28a3fb38e507e3401b','0ebaedeaded2112da609f33e07f91fa4') then
  raise exception 'CHAT_TICKETS_ISSUER_BASELINE_CHANGED';end if;
 select md5(prosrc) into fingerprint from pg_proc where oid=to_regprocedure('public.resolve_media_delivery(text,text,text)');
 if fingerprint is null or fingerprint not in('5384ffa037d180f74969c8c00a6a4dc0','5d323413e971c44e049a29057662fd5d',
  '89776cbc3f64c180bffb5589f56e737e','ad13482b7786c2279b8f1aac969a2a30') then
  raise exception 'CHAT_TICKETS_RESOLVER_BASELINE_CHANGED';end if;
 select jsonb_build_object(
  'content_issuer',(select pg_get_functiondef(p.oid)||coalesce(p.proacl::text,'') from pg_proc p where p.oid=to_regprocedure('public.issue_content_media_delivery(jsonb,jsonb)')),
  'session_helper',(select pg_get_functiondef(p.oid)||coalesce(p.proacl::text,'') from pg_proc p where p.oid=to_regprocedure('media_delivery.require_session()')),
  'chat_authority',(select md5(string_agg(pg_get_functiondef(p.oid)||coalesce(p.proacl::text,''),E'\n' order by p.oid)) from pg_proc p where p.oid in(
   to_regprocedure('public.chat_media_manifest(uuid[])'),to_regprocedure('public.can_access_chat_conversation(uuid)'),
   to_regprocedure('public.can_read_chat_object(text,text)'),to_regprocedure('public.social_can_read_channel(uuid)'),to_regprocedure('public.studio_role()'))),
  'storage_policies',(select coalesce(jsonb_agg(to_jsonb(p) order by p.oid),'[]') from pg_policy p where polrelid in('storage.objects'::regclass,'storage.buckets'::regclass)),
  'bucket_visibility',(select jsonb_agg(jsonb_build_object('id',id,'public',public) order by id) from storage.buckets)
 ) into baseline;
 perform set_config('platinum.chat_ticket_baseline',baseline::text,true);
end $preflight$;

-- Missing private helpers copy the existing QA authority. Existing helpers and
-- their ACLs remain unchanged. New helpers are callable only by definer RPCs.
do $helper$
begin
 if to_regprocedure('public.can_read_legacy_chat_object(text,text)') is null then
  execute $definition$CREATE OR REPLACE FUNCTION public.can_read_legacy_chat_object(p_bucket text, p_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 SELECT auth.uid() IS NOT NULL AND (
  (p_bucket='chat-media' AND EXISTS (
    SELECT 1 FROM public.channel_messages m WHERE public.chat_object_path(m.media_url)=p_bucket||'/'||p_name
      AND split_part(p_name,'/',1)=m.sender_id::text AND public.social_can_read_channel(m.channel_id)))
  OR (p_bucket='chat-media' AND EXISTS (
    SELECT 1 FROM public.conversations c WHERE c.is_group AND public.chat_object_path(c.group_avatar_url)=p_bucket||'/'||p_name
      AND public.can_access_chat_conversation(c.id)))
  OR (p_bucket='chat-files' AND EXISTS (
    SELECT 1 FROM public.job_applications a JOIN public.jobs j ON j.id=a.job_id
    WHERE public.chat_object_path(a.cv_url)=p_bucket||'/'||p_name AND split_part(p_name,'/',1)=a.applicant_id::text
      AND (a.applicant_id=auth.uid() OR (j.posted_by=auth.uid() AND public.studio_role() IN ('owner','admin','recruiter')))))
 );
$function$
;$definition$;
  execute 'revoke all on function public.can_read_legacy_chat_object(text,text) from public,anon,authenticated,service_role';
 elsif (select md5(prosrc) from pg_proc where oid='public.can_read_legacy_chat_object(text,text)'::regprocedure)<>'21d7f139ef693667b39b9f5ef82bd8be' then
  raise exception 'CHAT_TICKETS_CHAT_HELPER_BASELINE_CHANGED: public.can_read_legacy_chat_object(text,text)';
 end if;
end $helper$;

do $helper$
begin
 if to_regprocedure('public.chat_locator_unrestricted(text)') is null then
  execute $definition$CREATE OR REPLACE FUNCTION public.chat_locator_unrestricted(p_locator text)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select p_locator is null or not exists(select 1 from public.messages m where m.view_limit is not null
  and (public.chat_object_path(m.media_url)=p_locator or public.chat_object_path(m.thumbnail_url)=p_locator));
$function$
;$definition$;
  execute 'revoke all on function public.chat_locator_unrestricted(text) from public,anon,authenticated,service_role';
 elsif (select md5(prosrc) from pg_proc where oid='public.chat_locator_unrestricted(text)'::regprocedure)<>'0aa4fa9966b6c2a59457030f6fe8eaad' then
  raise exception 'CHAT_TICKETS_CHAT_HELPER_BASELINE_CHANGED: public.chat_locator_unrestricted(text)';
 end if;
end $helper$;

-- Add only the two chat source kinds to the existing expression. In particular,
-- retain channel_message and any other reviewed existing source kinds.
do $constraint$
declare existing text;
begin
 select pg_get_expr(conbin,conrelid) into existing from pg_constraint
  where conrelid='media_delivery.tickets'::regclass and conname='tickets_source_kind_check' and contype='c' and convalidated;
 if existing is null then raise exception 'CHAT_TICKETS_SOURCE_CONSTRAINT_MISSING';end if;
 if strpos(existing,'''chat''')=0 or strpos(existing,'''chat_object''')=0 then
  alter table media_delivery.tickets drop constraint tickets_source_kind_check;
  execute format('alter table media_delivery.tickets add constraint tickets_source_kind_check check ((%s) or source_kind in (''chat'',''chat_object''))',existing);
 end if;
end $constraint$;

-- These are the same two branch additions already installed on QA. Replace
-- only the exact inspected production bodies, leaving every other byte intact.
do $forward$
declare definition text; fingerprint text;
begin
 select md5(prosrc),pg_get_functiondef(oid) into fingerprint,definition from pg_proc
  where oid='media_delivery.issue(text,text,uuid,uuid)'::regprocedure;
 if fingerprint='06ecfee711fe5d28a3fb38e507e3401b' then
  definition:=replace(definition,'(post-media|story-media|media)','(post-media|story-media|media|chat-media|chat-files)');
  definition:=replace(definition,'p_kind<>''upload''','p_kind not in (''upload'',''chat'',''chat_object'')');
  execute definition;
 end if;
 select md5(prosrc),pg_get_functiondef(oid) into fingerprint,definition from pg_proc
  where oid='public.resolve_media_delivery(text,text,text)'::regprocedure;
 if fingerprint='5384ffa037d180f74969c8c00a6a4dc0' then
  definition:=replace(definition,$needle$

 else
  select exists(select 1 from public.content_media_manifest$needle$,$branch$
 elsif g.source_kind='chat' then
  select exists(select 1 from public.chat_media_manifest(array[g.source_id]) m where m.view_limit is null and g.source_url in(m.media_url,m.thumbnail_url)) into allowed;
 elsif g.source_kind='chat_object' then
  allowed:=g.object_owner=g.user_id::text or (public.chat_locator_unrestricted(g.bucket_id||'/'||g.object_path)
   and (public.can_read_chat_object(g.bucket_id,g.object_path) or public.can_read_legacy_chat_object(g.bucket_id,g.object_path)));
 else
  select exists(select 1 from public.content_media_manifest$branch$);
  execute definition;
 end if;
 if (select md5(prosrc) from pg_proc where oid='media_delivery.issue(text,text,uuid,uuid)'::regprocedure)<>'0ebaedeaded2112da609f33e07f91fa4'
  or (select md5(prosrc) from pg_proc where oid='public.resolve_media_delivery(text,text,text)'::regprocedure) not in(
   '5d323413e971c44e049a29057662fd5d','89776cbc3f64c180bffb5589f56e737e','ad13482b7786c2279b8f1aac969a2a30') then
  raise exception 'CHAT_TICKETS_FORWARD_BODY_MISMATCH';end if;
end $forward$;

create or replace function public.issue_chat_media_delivery(p_message_ids uuid[])
returns table(message_id uuid,media_url text,bucket_id text,object_path text,token text,expires_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare sid uuid:=media_delivery.require_session();r record;u text;
 cleanup_before timestamptz:=clock_timestamp()-interval '5 minutes';
begin
 if coalesce(cardinality(p_message_ids),0) not between 1 and 100 then raise exception 'At most 100 message references';end if;
 if to_regclass('media_delivery.prerequisite_settings') is not null then
  if not exists(select 1 from media_delivery.prerequisite_settings where singleton and enabled) then
   raise exception 'MEDIA_CONTENT_DELIVERY_NOT_READY' using errcode='55000';end if;
 end if;
 -- Match the existing production content-ticket cleanup budget.
 with expired as(select stale.token_digest from media_delivery.tickets stale
  where stale.expires_at<cleanup_before
  order by stale.expires_at,stale.token_digest limit 2000 for update skip locked)
 delete from media_delivery.tickets t using expired e where t.token_digest=e.token_digest;
 for r in select * from public.chat_media_manifest(p_message_ids) where view_limit is null loop
  for u in select distinct x from unnest(array[r.media_url,r.thumbnail_url]) x where x is not null loop
   return query select r.id,u,t.* from media_delivery.issue(u,'chat',r.id,sid) t;
  end loop;
 end loop;
end $$;
revoke all on function public.issue_chat_media_delivery(uuid[]) from public,anon,service_role;
grant execute on function public.issue_chat_media_delivery(uuid[]) to authenticated;

create or replace function public.issue_chat_object_delivery(p_urls text[])
returns table(bucket_id text,object_path text,token text,expires_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare sid uuid:=media_delivery.require_session();u text;loc text; b text;p text;
 cleanup_before timestamptz:=clock_timestamp()-interval '5 minutes';
begin
 if coalesce(cardinality(p_urls),0) not between 1 and 100 then raise exception 'At most 100 references';end if;
 if to_regclass('media_delivery.prerequisite_settings') is not null then
  if not exists(select 1 from media_delivery.prerequisite_settings where singleton and enabled) then
   raise exception 'MEDIA_CONTENT_DELIVERY_NOT_READY' using errcode='55000';end if;
 end if;
 -- Match the existing production content-ticket cleanup budget.
 with expired as(select stale.token_digest from media_delivery.tickets stale
  where stale.expires_at<cleanup_before
  order by stale.expires_at,stale.token_digest limit 2000 for update skip locked)
 delete from media_delivery.tickets t using expired e where t.token_digest=e.token_digest;
 for u in select distinct unnest(p_urls) loop
  loc:=public.chat_object_path(u);if loc is null then continue;end if;
  b:=split_part(loc,'/',1);p:=substring(loc from position('/' in loc)+1);
  if exists(select 1 from storage.objects o where o.bucket_id=b and o.name=p and coalesce(o.owner_id,o.owner::text)=auth.uid()::text)
   or (public.chat_locator_unrestricted(loc) and (public.can_read_chat_object(b,p) or public.can_read_legacy_chat_object(b,p))) then
   return query select * from media_delivery.issue(u,'chat_object',null,sid);
  end if;
 end loop;
end $$;
revoke all on function public.issue_chat_object_delivery(text[]) from public,anon,service_role;
grant execute on function public.issue_chat_object_delivery(text[]) to authenticated;

do $preservation$
declare baseline jsonb;
begin
 select jsonb_build_object(
  'content_issuer',(select pg_get_functiondef(p.oid)||coalesce(p.proacl::text,'') from pg_proc p where p.oid=to_regprocedure('public.issue_content_media_delivery(jsonb,jsonb)')),
  'session_helper',(select pg_get_functiondef(p.oid)||coalesce(p.proacl::text,'') from pg_proc p where p.oid=to_regprocedure('media_delivery.require_session()')),
  'chat_authority',(select md5(string_agg(pg_get_functiondef(p.oid)||coalesce(p.proacl::text,''),E'\n' order by p.oid)) from pg_proc p where p.oid in(
   to_regprocedure('public.chat_media_manifest(uuid[])'),to_regprocedure('public.can_access_chat_conversation(uuid)'),
   to_regprocedure('public.can_read_chat_object(text,text)'),to_regprocedure('public.social_can_read_channel(uuid)'),to_regprocedure('public.studio_role()'))),
  'storage_policies',(select coalesce(jsonb_agg(to_jsonb(p) order by p.oid),'[]') from pg_policy p where polrelid in('storage.objects'::regclass,'storage.buckets'::regclass)),
  'bucket_visibility',(select jsonb_agg(jsonb_build_object('id',id,'public',public) order by id) from storage.buckets)
 ) into baseline;
 if baseline is distinct from current_setting('platinum.chat_ticket_baseline')::jsonb then
  raise exception 'CHAT_TICKETS_EXISTING_AUTHORITY_CHANGED';end if;
end $preservation$;
notify pgrst,'reload schema';
commit;
