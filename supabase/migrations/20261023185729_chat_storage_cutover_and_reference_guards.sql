-- Apply with the matching web/native readers, chat-media-sign and social migration.
-- A public-form URL is only an immutable locator; it no longer grants public access.
BEGIN;
SET LOCAL lock_timeout = '3s';

-- Legacy uploads include a numeric cache-buster. Ignore only that known suffix,
-- never a signed token, fragment, encoded separator or traversal component.
CREATE OR REPLACE FUNCTION public.chat_object_path(p_url text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
 SELECT CASE WHEN p_url ~ '^https://[^/?#]+/storage/v1/object/public/(chat-media|chat-files)/[0-9a-fA-F-]{36}/[A-Za-z0-9_. /-]+([?]t=[0-9]+)?$'
   AND p_url !~ '/[.][.]?(/|[?]|$)' THEN substring(split_part(p_url, '?', 1) FROM '/storage/v1/object/public/((?:chat-media|chat-files)/.*)$') END;
$$;

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
 IF NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id=bucket AND o.name=object_name) THEN
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
 USING(bucket_id NOT IN ('chat-media','chat-files') OR public.can_read_chat_object(bucket_id,name) OR public.can_read_legacy_chat_object(bucket_id,name));
CREATE POLICY chat_private_read ON storage.objects FOR SELECT TO authenticated
 USING(bucket_id IN ('chat-media','chat-files') AND (public.can_read_chat_object(bucket_id,name) OR public.can_read_legacy_chat_object(bucket_id,name)));
CREATE POLICY chat_private_insert_guard ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated
 WITH CHECK(bucket_id NOT IN ('chat-media','chat-files') OR (
  name ~ '^[0-9a-f-]{36}/[A-Za-z0-9_. /-]+$' AND name !~ '(^|/)[.][.]?(/|$)'
  AND public.can_act_as(split_part(name,'/',1)::uuid)));
CREATE POLICY chat_private_insert ON storage.objects FOR INSERT TO authenticated
 WITH CHECK(bucket_id IN ('chat-media','chat-files') AND public.can_act_as(split_part(name,'/',1)::uuid));
CREATE POLICY chat_private_immutable_guard ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated
 USING(bucket_id NOT IN ('chat-media','chat-files')) WITH CHECK(bucket_id NOT IN ('chat-media','chat-files'));

-- Deleting a live attachment breaks forwarded copies. Cleanup of unreferenced
-- uploads belongs to the service worker, after its retention grace period.
CREATE POLICY chat_private_delete_guard ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated
 USING(bucket_id NOT IN ('chat-media','chat-files'));

-- Rebuild expression indexes after widening canonical parsing to legacy ?t=.
REINDEX INDEX public.messages_chat_media_locator;
REINDEX INDEX public.messages_chat_thumbnail_locator;

UPDATE storage.buckets SET public=false WHERE id IN ('chat-media','chat-files');
CREATE OR REPLACE FUNCTION public.guard_call_session_lifecycle()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
 IF TG_OP='INSERT' THEN
   IF NEW.status<>'ringing' THEN RAISE EXCEPTION 'New calls must ring first' USING ERRCODE='42501'; END IF;
   NEW.created_at:=now(); NEW.expires_at:=now()+interval '90 seconds';
   NEW.started_at:=NULL; NEW.ended_at:=NULL; NEW.duration_sec:=NULL;
   RETURN NEW;
 END IF;
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.initiator_id IS DISTINCT FROM OLD.initiator_id
   OR NEW.receiver_id IS DISTINCT FROM OLD.receiver_id OR NEW.conversation_id IS DISTINCT FROM OLD.conversation_id
   OR NEW.is_group_call IS DISTINCT FROM OLD.is_group_call OR NEW.created_at IS DISTINCT FROM OLD.created_at
   OR NEW.expires_at IS DISTINCT FROM OLD.expires_at OR to_jsonb(NEW)->'is_video' IS DISTINCT FROM to_jsonb(OLD)->'is_video'
   OR to_jsonb(NEW)->'call_type' IS DISTINCT FROM to_jsonb(OLD)->'call_type' THEN
   RAISE EXCEPTION 'Call identity is immutable' USING ERRCODE='42501';
 END IF;
 NEW.started_at:=OLD.started_at; NEW.ended_at:=OLD.ended_at; NEW.duration_sec:=OLD.duration_sec;
 IF NEW.status IS DISTINCT FROM OLD.status THEN
   IF OLD.status NOT IN('ringing','active') OR NEW.status NOT IN('active','ended','declined','missed')
     OR (OLD.status='active' AND NEW.status NOT IN('ended')) THEN
     RAISE EXCEPTION 'Invalid call transition' USING ERRCODE='42501';
   END IF;
   IF NEW.status='active' THEN
     IF coalesce(OLD.expires_at,OLD.created_at+interval '90 seconds')<=now() THEN RAISE EXCEPTION 'Call expired'; END IF;
     IF NOT OLD.is_group_call AND auth.uid() IS DISTINCT FROM OLD.receiver_id THEN RAISE EXCEPTION 'Only the receiver can answer' USING ERRCODE='42501'; END IF;
     IF OLD.is_group_call AND NOT EXISTS(SELECT 1 FROM public.call_participants WHERE call_session_id=OLD.id AND status='joined' AND user_id<>OLD.initiator_id) THEN RAISE EXCEPTION 'No answering participant'; END IF;
     NEW.started_at:=now();
   ELSE
     NEW.ended_at:=now(); NEW.duration_sec:=greatest(0,extract(epoch FROM(now()-coalesce(OLD.started_at,now())))::int);
   END IF;
 END IF;
 RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_call_heartbeat()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.last_seen_at IS DISTINCT FROM OLD.last_seen_at THEN NEW.last_seen_at:=now(); END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_call_heartbeat() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER call_heartbeat_clock BEFORE UPDATE OF last_seen_at ON public.call_participants FOR EACH ROW EXECUTE FUNCTION public.guard_call_heartbeat();

-- Direct calls have no group participant rows. A global sweep must not end
-- healthy direct calls simply because a different client opens the app.
CREATE OR REPLACE FUNCTION public.sweep_dead_calls()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 UPDATE public.call_participants SET status='left',left_at=now()
 WHERE status='joined' AND coalesce(last_seen_at,joined_at,'epoch'::timestamptz)<now()-interval '120 seconds';
 UPDATE public.call_sessions SET status='missed'
 WHERE status='ringing' AND coalesce(expires_at,created_at+interval '90 seconds')<now();
 UPDATE public.call_sessions c SET status='ended'
 WHERE c.status='active' AND (
   (c.is_group_call AND c.created_at<now()-interval '2 minutes' AND NOT EXISTS(
     SELECT 1 FROM public.call_participants p WHERE p.call_session_id=c.id AND p.status='joined'))
   OR c.created_at<now()-interval '6 hours');
 DELETE FROM public.chat_media_view_grants WHERE expires_at<now()-interval '1 day';
END;
$$;
REVOKE ALL ON FUNCTION public.sweep_dead_calls() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_dead_calls() TO service_role;
CREATE OR REPLACE FUNCTION public.guard_call_context()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF auth.uid() IS NULL OR NEW.initiator_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Call initiator must be the signed-in account' USING ERRCODE='42501'; END IF;
 IF NEW.is_group_call THEN
   IF NEW.receiver_id IS NOT NULL OR NOT EXISTS(SELECT 1 FROM public.conversations c WHERE c.id=NEW.conversation_id AND c.is_group)
     OR NOT public.is_conversation_member(NEW.conversation_id,auth.uid()) THEN
     RAISE EXCEPTION 'Call requires current group membership' USING ERRCODE='42501';
   END IF;
 ELSE
   IF NEW.receiver_id IS NULL OR NEW.receiver_id=NEW.initiator_id OR EXISTS(
     SELECT 1 FROM public.blocked_users b WHERE (b.blocker_id=NEW.initiator_id AND b.blocked_id=NEW.receiver_id)
       OR (b.blocker_id=NEW.receiver_id AND b.blocked_id=NEW.initiator_id)) THEN
     RAISE EXCEPTION 'Call is not available' USING ERRCODE='42501';
   END IF;
   IF NEW.conversation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.conversations c WHERE c.id=NEW.conversation_id AND NOT c.is_group
       AND ((c.user_1=NEW.initiator_id AND c.user_2=NEW.receiver_id) OR (c.user_2=NEW.initiator_id AND c.user_1=NEW.receiver_id))) THEN
     RAISE EXCEPTION 'Call participants do not match the conversation' USING ERRCODE='42501';
   END IF;
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_call_context() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER call_context_guard BEFORE INSERT ON public.call_sessions FOR EACH ROW EXECUTE FUNCTION public.guard_call_context();

CREATE OR REPLACE FUNCTION public.start_group_call(p_conversation_id uuid,p_is_video boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE session_id uuid:=gen_random_uuid();
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_conversation_member(p_conversation_id,auth.uid()) THEN RAISE EXCEPTION 'Not a member of this group' USING ERRCODE='42501'; END IF;
 -- Serialize creation for a group; simultaneous callers cannot create two rooms.
 PERFORM 1 FROM public.conversations WHERE id=p_conversation_id AND is_group FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Group not found'; END IF;
 UPDATE public.call_sessions SET status='missed' WHERE conversation_id=p_conversation_id AND status='ringing' AND coalesce(expires_at,created_at+interval '90 seconds')<now();
 IF EXISTS(SELECT 1 FROM public.call_sessions WHERE conversation_id=p_conversation_id AND status IN('ringing','active')) THEN RAISE EXCEPTION 'A call is already running in this group'; END IF;
 INSERT INTO public.call_sessions(id,conversation_id,initiator_id,call_type,status,is_video,is_group_call,agora_channel)
 VALUES(session_id,p_conversation_id,auth.uid(),CASE WHEN p_is_video THEN 'video' ELSE 'voice' END,'ringing',p_is_video,true,session_id::text);
 INSERT INTO public.call_participants(call_session_id,user_id,status,joined_at,last_seen_at)
 SELECT session_id,m.user_id,CASE WHEN m.user_id=auth.uid() THEN 'joined' ELSE 'invited' END,
   CASE WHEN m.user_id=auth.uid() THEN now() ELSE NULL END,CASE WHEN m.user_id=auth.uid() THEN now() ELSE NULL END
 FROM public.conversation_members m WHERE m.conversation_id=p_conversation_id;
 RETURN session_id;
END;
$$;
REVOKE ALL ON FUNCTION public.start_group_call(uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.start_group_call(uuid,boolean) TO authenticated;
COMMIT;
