-- Compatibility and restrictive object policies only. This migration does not
-- change bucket visibility. Activate with the separately reviewed cutover tool
-- after both client generations, CDN behavior and synthetic HTTP tests pass.
begin;
set local lock_timeout = '3s';

do $legacy$
declare source text; anchor text:='JOIN storage.buckets b ON b.id = o.bucket_id AND b.public';
begin
 source:=pg_get_functiondef('content_media_legacy.allows_read(text,uuid,uuid,text,text,text)'::regprocedure);
 if (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 then
  raise exception 'PRIVATE_MEDIA_LEGACY_BASELINE_CHANGED';
 end if;
 -- A reviewed read association remains valid when its bucket becomes private.
 -- Object ID/version/owner, parent, author, canonical URL and audience checks
 -- all remain unchanged. This never confers ownership or deletion permission.
 execute replace(source,anchor,'JOIN storage.buckets b ON b.id = o.bucket_id');
end $legacy$;

-- A limited attachment cannot acquire an ordinary read capability merely by
-- being reused in another message, group photo, broadcast or legacy CV.
create function public.chat_locator_unrestricted(p_locator text) returns boolean
language sql volatile security definer set search_path='' as $$
 select p_locator is null or not exists(select 1 from public.messages m where m.view_limit is not null
  and (public.chat_object_path(m.media_url)=p_locator or public.chat_object_path(m.thumbnail_url)=p_locator));
$$;
revoke all on function public.chat_locator_unrestricted(text) from public,anon;
grant execute on function public.chat_locator_unrestricted(text) to authenticated;

create function public.guard_limited_chat_object_reuse() returns trigger
language plpgsql security definer set search_path='' as $$
declare loc text; object_name text; object_bucket text;
begin
 for loc in select distinct x from unnest(array[public.chat_object_path(new.media_url),public.chat_object_path(new.thumbnail_url)]) x where x is not null order by x loop
  perform pg_advisory_xact_lock(hashtextextended('limited-chat-object:'||loc,0));
  if not public.chat_locator_unrestricted(loc) then
   raise exception 'Limited-view attachments cannot be reused' using errcode='42501';
  end if;
  if new.view_limit is not null then
   object_bucket:=split_part(loc,'/',1); object_name:=substring(loc from position('/' in loc)+1);
   if not exists(select 1 from storage.objects o where o.bucket_id=object_bucket and o.name=object_name
     and coalesce(o.owner_id,o.owner::text)=auth.uid()::text)
    or exists(select 1 from public.messages m where public.chat_object_path(m.media_url)=loc or public.chat_object_path(m.thumbnail_url)=loc)
    or exists(select 1 from public.channel_messages m where public.chat_object_path(m.media_url)=loc)
    or exists(select 1 from public.conversations c where public.chat_object_path(c.group_avatar_url)=loc)
    or exists(select 1 from public.job_applications a where public.chat_object_path(a.cv_url)=loc)
   then raise exception 'Limited-view attachments require a new owned upload' using errcode='42501'; end if;
  end if;
 end loop;
 return new;
end $$;
revoke all on function public.guard_limited_chat_object_reuse() from public,anon,authenticated,service_role;
create trigger chat_limited_object_reuse_guard before insert on public.messages
 for each row execute function public.guard_limited_chat_object_reuse();

do $manifest$
declare source text; anchor text:='AND (public.chat_object_path(m.media_url) IS NOT NULL OR public.chat_object_path(m.thumbnail_url) IS NOT NULL);';
begin
 source:=pg_get_functiondef('public.chat_media_manifest(uuid[])'::regprocedure);
 if (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 then raise exception 'CHAT_MANIFEST_BASELINE_CHANGED'; end if;
 execute replace(source,anchor,
  'AND (m.view_limit IS NOT NULL OR (public.chat_locator_unrestricted(public.chat_object_path(m.media_url)) AND public.chat_locator_unrestricted(public.chat_object_path(m.thumbnail_url)))) '||anchor);
end $manifest$;

-- chat-media historically also stored broadcast attachments and group photos;
-- chat-files stored CVs. Authorize the exact referenced object in each context.
CREATE OR REPLACE FUNCTION public.can_read_legacy_chat_object(p_bucket text,p_name text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
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
$$;
REVOKE ALL ON FUNCTION public.can_read_legacy_chat_object(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_read_legacy_chat_object(text,text) TO authenticated;

-- Do not let a member turn someone else's DM object into a channel/group/CV
-- attachment and thereby grant themselves permission to sign it.
CREATE OR REPLACE FUNCTION public.guard_legacy_chat_reference()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE value text; old_value text; loc text; bucket text; object_name text;
BEGIN
 IF TG_TABLE_NAME='channel_messages' THEN
  value:=NEW.media_url;
  IF TG_OP='UPDATE' THEN old_value:=OLD.media_url; END IF;
 ELSIF TG_TABLE_NAME='conversations' THEN
  value:=NEW.group_avatar_url;
  IF TG_OP='UPDATE' THEN old_value:=OLD.group_avatar_url; END IF;
 ELSE
  value:=NEW.cv_url;
  IF TG_OP='UPDATE' THEN old_value:=OLD.cv_url; END IF;
 END IF;
 IF value IS NULL OR (TG_OP='UPDATE' AND value IS NOT DISTINCT FROM old_value) THEN RETURN NEW; END IF;
 loc:=public.chat_object_path(value);
 IF TG_TABLE_NAME='channel_messages' AND value ~ '/storage/v1/object/public/channel-media/' THEN
   IF value !~ '^https://[^/?#]+/storage/v1/object/public/channel-media/[0-9a-f-]{36}/[0-9a-f-]{36}/[A-Za-z0-9_.-]+$' THEN RAISE EXCEPTION 'Invalid channel attachment'; END IF;
   bucket:='channel-media'; object_name:=substring(value FROM '/storage/v1/object/public/channel-media/(.*)$');
   IF split_part(object_name,'/',1)<>NEW.channel_id::text OR split_part(object_name,'/',2)<>NEW.sender_id::text OR NOT public.can_act_as(NEW.sender_id) THEN
     RAISE EXCEPTION 'Channel attachment must belong to this channel and author' USING ERRCODE='42501';
   END IF;
 ELSIF loc IS NOT NULL THEN
   bucket:=split_part(loc,'/',1); object_name:=substring(loc FROM position('/' IN loc)+1);
   IF TG_TABLE_NAME='channel_messages' THEN
     IF bucket<>'chat-media' OR split_part(object_name,'/',1)<>NEW.sender_id::text OR NOT public.can_act_as(NEW.sender_id) THEN RAISE EXCEPTION 'Invalid channel attachment owner' USING ERRCODE='42501'; END IF;
   ELSIF TG_TABLE_NAME='job_applications' THEN
     IF bucket<>'chat-files' OR split_part(object_name,'/',1)<>NEW.applicant_id::text OR NOT public.can_act_as(NEW.applicant_id) THEN RAISE EXCEPTION 'Invalid CV attachment owner' USING ERRCODE='42501'; END IF;
   ELSIF bucket<>'chat-media' OR NOT public.can_act_as(split_part(object_name,'/',1)::uuid) THEN
     RAISE EXCEPTION 'Group photo must belong to the editor' USING ERRCODE='42501';
   END IF;
 ELSIF value ~ '/storage/v1/object/(public/|sign/|authenticated/)?(chat-media|chat-files|channel-media)/' THEN
   RAISE EXCEPTION 'Invalid private attachment locator' USING ERRCODE='42501';
 ELSE RETURN NEW;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('limited-chat-object:'||bucket||'/'||object_name,0));
 IF NOT public.chat_locator_unrestricted(bucket||'/'||object_name) THEN
   RAISE EXCEPTION 'Limited-view attachments cannot be reused' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id=bucket AND o.name=object_name AND coalesce(o.owner_id,o.owner::text)=auth.uid()::text) THEN
   RAISE EXCEPTION 'Upload the attachment before sharing it' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_legacy_chat_reference() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER channel_private_reference_guard BEFORE INSERT OR UPDATE OF media_url ON public.channel_messages FOR EACH ROW EXECUTE FUNCTION public.guard_legacy_chat_reference();
CREATE TRIGGER group_private_reference_guard BEFORE INSERT OR UPDATE OF group_avatar_url ON public.conversations FOR EACH ROW EXECUTE FUNCTION public.guard_legacy_chat_reference();
CREATE TRIGGER application_legacy_reference_guard BEFORE INSERT OR UPDATE OF cv_url ON public.job_applications FOR EACH ROW EXECUTE FUNCTION public.guard_legacy_chat_reference();

CREATE INDEX IF NOT EXISTS channel_messages_private_object_idx ON public.channel_messages(public.chat_object_path(media_url));
CREATE INDEX IF NOT EXISTS conversations_private_avatar_idx ON public.conversations(public.chat_object_path(group_avatar_url)) WHERE is_group;
CREATE INDEX IF NOT EXISTS job_applications_legacy_cv_idx ON public.job_applications(public.chat_object_path(cv_url));

-- Existing permissive policies must not bypass these checks.
CREATE POLICY chat_private_anon_guard ON storage.objects AS RESTRICTIVE FOR ALL TO anon
 USING(bucket_id NOT IN ('chat-media','chat-files')) WITH CHECK(bucket_id NOT IN ('chat-media','chat-files'));
CREATE POLICY chat_private_read_guard ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated
 USING(bucket_id NOT IN ('chat-media','chat-files') OR coalesce(owner_id,owner::text)=(select auth.uid())::text OR (public.chat_locator_unrestricted(bucket_id||'/'||name) AND (public.can_read_chat_object(bucket_id,name) OR public.can_read_legacy_chat_object(bucket_id,name))));
CREATE POLICY chat_private_read ON storage.objects FOR SELECT TO authenticated
 USING(bucket_id IN ('chat-media','chat-files') AND (coalesce(owner_id,owner::text)=(select auth.uid())::text OR (public.chat_locator_unrestricted(bucket_id||'/'||name) AND (public.can_read_chat_object(bucket_id,name) OR public.can_read_legacy_chat_object(bucket_id,name)))));
CREATE POLICY chat_private_insert_guard ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated
 WITH CHECK(bucket_id NOT IN ('chat-media','chat-files') OR (
  name ~ '^[0-9a-f-]{36}/[A-Za-z0-9_. /-]+$' AND name !~ '(^|/)[.][.]?(/|$)'
  AND public.can_act_as(split_part(name,'/',1)::uuid) AND coalesce(owner_id,owner::text)=(select auth.uid())::text));
CREATE POLICY chat_private_insert ON storage.objects FOR INSERT TO authenticated
 WITH CHECK(bucket_id IN ('chat-media','chat-files') AND public.can_act_as(split_part(name,'/',1)::uuid));
CREATE POLICY chat_private_immutable_guard ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated
 USING(bucket_id NOT IN ('chat-media','chat-files')) WITH CHECK(bucket_id NOT IN ('chat-media','chat-files'));

-- Deleting a live attachment breaks forwarded copies. Cleanup of unreferenced
-- uploads belongs to the service worker, after its retention grace period.
CREATE POLICY chat_private_delete_guard ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated
 USING(bucket_id NOT IN ('chat-media','chat-files'));

create function public.private_content_upload_allowed(p_bucket text,p_name text) returns boolean
language plpgsql stable security invoker set search_path='' as $$
declare actor text;
begin
 if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false)
  or p_bucket not in ('post-media','story-media','media') then return false; end if;
 if p_name is null or length(p_name)>1024 or p_name !~ '^[A-Za-z0-9_. /-]+$'
  or p_name ~ '(^|/)\.\.?(/|$)|//' then return false; end if;
 actor:=split_part(p_name,'/',1);
 if actor !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  or position('/' in p_name)=0 then return false; end if;
 return public.can_act_as(actor::uuid);
end $$;
revoke all on function public.private_content_upload_allowed(text,text) from public,anon;
grant execute on function public.private_content_upload_allowed(text,text) to authenticated;

-- Public-form strings remain canonical identifiers in database documents.
-- Every viewer other than the real upload owner needs the content manifest and
-- its short-lived signer. Restrictive rules constrain old permissive policies.
create policy private_content_anon_guard on storage.objects as restrictive for all to anon
 using(bucket_id not in ('post-media','story-media','media'))
 with check(bucket_id not in ('post-media','story-media','media'));
create policy private_content_read_guard on storage.objects as restrictive for select to authenticated
 using(bucket_id not in ('post-media','story-media','media') or coalesce(owner_id,owner::text)=(select auth.uid())::text);
create policy private_content_owner_read on storage.objects for select to authenticated
 using(bucket_id in ('post-media','story-media','media') and coalesce(owner_id,owner::text)=(select auth.uid())::text);
create policy private_content_insert_guard on storage.objects as restrictive for insert to authenticated
 with check(bucket_id not in ('post-media','story-media','media') or (
  public.private_content_upload_allowed(bucket_id,name) and coalesce(owner_id,owner::text)=(select auth.uid())::text));
create policy private_content_owner_insert on storage.objects for insert to authenticated
 with check(bucket_id in ('post-media','story-media','media') and public.private_content_upload_allowed(bucket_id,name)
  and coalesce(owner_id,owner::text)=(select auth.uid())::text);
create policy private_content_immutable_guard on storage.objects as restrictive for update to authenticated
 using(bucket_id not in ('post-media','story-media','media')) with check(bucket_id not in ('post-media','story-media','media'));
create policy private_content_delete_guard on storage.objects as restrictive for delete to authenticated
 using(bucket_id not in ('post-media','story-media','media'));

-- Metadata-only release inspection. A reviewed legacy snapshot is a valid read
-- association, never an invented owner. No filename/account ID is returned.
create function public.private_media_cutover_readiness() returns jsonb
language sql stable security definer set search_path='' as $$
 with entities as (
  select 'post'::text kind,id,user_id author from public.posts
  union all select 'story',id,user_id from public.stories
  union all select 'story_draft',id,user_id from public.story_drafts
 ), refs as (
  select distinct e.*,u.value url,loc[1] bucket,loc[2] path
  from entities e cross join lateral public.content_media_strings(public.content_media_document(e.kind,e.id)) u(value)
  cross join lateral regexp_match(u.value,'^https://[^/]+/storage/v1/object/public/(post-media|story-media|media)/([^?#]+)') loc
 ), checked as (
  select r.*,o.id object_id,
   exists(select 1 from public.content_media_bindings b where b.entity_kind=r.kind and b.entity_id=r.id
    and b.bucket_id=r.bucket and b.object_path=r.path and b.uploader_id::text=coalesce(o.owner_id,o.owner::text)) bound,
   exists(select 1 from content_media_legacy.snapshots l where l.entity_kind=r.kind and l.entity_id=r.id
    and l.author_id=r.author and l.object_id=o.id and l.bucket_id=r.bucket and l.object_path=r.path
    and l.object_version=o.version and l.canonical_url=r.url and l.revoked_at is null
    and (coalesce(o.owner_id,o.owner::text) is null or coalesce(o.owner_id,o.owner::text)=r.author::text)) legacy
  from refs r left join storage.objects o on o.bucket_id=r.bucket and o.name=r.path
 ), chat_refs as (
  select distinct public.chat_object_path(u.url) loc,m.view_limit is not null limited from public.messages m
   cross join lateral(values(m.media_url),(m.thumbnail_url)) u(url) where m.deleted_at is null and public.chat_object_path(u.url) is not null
  union all select public.chat_object_path(media_url),false from public.channel_messages where public.chat_object_path(media_url) is not null
  union all select public.chat_object_path(group_avatar_url),false from public.conversations where public.chat_object_path(group_avatar_url) is not null
  union all select public.chat_object_path(cv_url),false from public.job_applications where public.chat_object_path(cv_url) is not null
 ) select jsonb_build_object(
  'buckets',(select jsonb_agg(jsonb_build_object('id',id,'public',public) order by id) from storage.buckets
    where id in ('post-media','story-media','media','chat-media','chat-files')),
  'contentReferences',(select count(*) from checked),
  'missingObjects',(select count(*) from checked where object_id is null),
  'unboundReferences',(select count(*) from checked where object_id is not null and not bound and not legacy),
  'reviewedLegacyReferences',(select count(*) from checked where legacy),
  'missingChatObjects',(select count(distinct r.loc) from chat_refs r where not exists(select 1 from storage.objects o where o.bucket_id||'/'||o.name=r.loc)),
  'limitedObjectsWithOrdinaryReferences',(select count(distinct r.loc) from chat_refs r where not r.limited and not public.chat_locator_unrestricted(r.loc)),
  'legacyRequiresPublicBucket',position('AND b.public' in pg_get_functiondef('content_media_legacy.allows_read(text,uuid,uuid,text,text,text)'::regprocedure))>0,
  'restrictedPolicyCount',(select count(*) from pg_policy where polrelid='storage.objects'::regclass and not polpermissive and polname in (
   'chat_private_anon_guard','chat_private_read_guard','chat_private_insert_guard','chat_private_immutable_guard','chat_private_delete_guard',
   'private_content_anon_guard','private_content_read_guard','private_content_insert_guard','private_content_immutable_guard','private_content_delete_guard')),
  'chatObjectCount',(select count(*) from storage.objects where bucket_id in ('chat-media','chat-files'))
 );
$$;
revoke all on function public.private_media_cutover_readiness() from public,anon,authenticated;
grant execute on function public.private_media_cutover_readiness() to service_role;

notify pgrst, 'reload schema';
commit;


