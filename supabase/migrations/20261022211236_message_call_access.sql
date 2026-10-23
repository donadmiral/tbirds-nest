-- Private attachment authorization and call lifecycle guards. No bucket visibility
-- change here: the coordinated storage migration also covers legacy channel media.
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS media_access_verified boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.can_access_chat_conversation(p_conversation uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
 SELECT auth.uid() IS NOT NULL AND EXISTS (
   SELECT 1 FROM public.conversations c WHERE c.id = p_conversation AND
   ((NOT c.is_group AND (public.can_act_as(c.user_1) OR public.can_act_as(c.user_2))) OR
    (c.is_group AND EXISTS (SELECT 1 FROM public.conversation_members m
      WHERE m.conversation_id = c.id AND public.can_act_as(m.user_id))))
 );
$$;
REVOKE ALL ON FUNCTION public.can_access_chat_conversation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_chat_conversation(uuid) TO authenticated, service_role;

-- Locators are immutable public-form identifiers, not public read permissions.
-- Percent-encoded separators, signed URLs and dot segments are rejected.
CREATE OR REPLACE FUNCTION public.chat_object_path(p_url text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
 SELECT CASE WHEN p_url ~ '^https://[^/?#]+/storage/v1/object/public/(chat-media|chat-files)/[0-9a-fA-F-]{36}/[A-Za-z0-9_. /-]+([?]t=[0-9]+)?$'
   AND p_url !~ '/[.][.]?(/|[?]|$)' THEN substring(split_part(p_url, '?', 1) FROM '/storage/v1/object/public/((?:chat-media|chat-files)/.*)$') END;
$$;

CREATE OR REPLACE FUNCTION public.guard_chat_media_reference()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE source public.messages%ROWTYPE; media_path text; thumb_path text;
BEGIN
 IF TG_OP = 'UPDATE' THEN
   IF NEW.id IS DISTINCT FROM OLD.id OR NEW.sender_id IS DISTINCT FROM OLD.sender_id
     OR NEW.conversation_id IS DISTINCT FROM OLD.conversation_id OR NEW.receiver_id IS DISTINCT FROM OLD.receiver_id
     OR NEW.media_url IS DISTINCT FROM OLD.media_url OR NEW.thumbnail_url IS DISTINCT FROM OLD.thumbnail_url
     OR NEW.view_limit IS DISTINCT FROM OLD.view_limit OR NEW.forwarded_from_id IS DISTINCT FROM OLD.forwarded_from_id
     OR NEW.media_type IS DISTINCT FROM OLD.media_type THEN
     -- Delete-for-everyone can clear attachments; it cannot replace them or undo deletion.
     IF NOT (NEW.deleted_at IS NOT NULL AND NEW.id = OLD.id AND NEW.sender_id = OLD.sender_id
       AND NEW.conversation_id = OLD.conversation_id AND NEW.receiver_id IS NOT DISTINCT FROM OLD.receiver_id
       AND (NEW.media_url IS NULL OR NEW.media_url IS NOT DISTINCT FROM OLD.media_url) AND (NEW.thumbnail_url IS NULL OR NEW.thumbnail_url IS NOT DISTINCT FROM OLD.thumbnail_url)
       AND NEW.view_limit IS NOT DISTINCT FROM OLD.view_limit AND NEW.forwarded_from_id IS NOT DISTINCT FROM OLD.forwarded_from_id
       AND (NEW.media_type IS NULL OR NEW.media_type IS NOT DISTINCT FROM OLD.media_type)) THEN
       RAISE EXCEPTION 'Message identity and attachment references are immutable' USING ERRCODE = '42501';
     END IF;
   END IF;
   IF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN RAISE EXCEPTION 'Deleted messages cannot be restored' USING ERRCODE = '42501'; END IF;
   NEW.media_access_verified := OLD.media_access_verified;
   RETURN NEW;
 END IF;
 NEW.media_access_verified := false;
 media_path := public.chat_object_path(NEW.media_url);
 thumb_path := public.chat_object_path(NEW.thumbnail_url);
 IF NEW.media_url ~ '/storage/v1/object/(public/|sign/)?(chat-media|chat-files)/' AND media_path IS NULL THEN
   RAISE EXCEPTION 'Invalid private media locator' USING ERRCODE = '42501';
 END IF;
 IF NEW.thumbnail_url ~ '/storage/v1/object/(public/|sign/)?(chat-media|chat-files)/' AND thumb_path IS NULL THEN
   RAISE EXCEPTION 'Invalid private thumbnail locator' USING ERRCODE = '42501';
 END IF;
 IF NEW.view_limit IS NOT NULL AND (media_path IS NULL OR NEW.forwarded_from_id IS NOT NULL) THEN
   RAISE EXCEPTION 'Limited-view attachments must use private uploaded media' USING ERRCODE = '42501';
 END IF;
 IF media_path IS NULL AND thumb_path IS NULL THEN RETURN NEW; END IF;
 IF (media_path IS NULL OR split_part(media_path, '/', 2) = NEW.sender_id::text)
   AND (thumb_path IS NULL OR split_part(thumb_path, '/', 2) = NEW.sender_id::text) THEN
   NEW.media_access_verified := true;
 ELSE
   SELECT * INTO source FROM public.messages WHERE id = NEW.forwarded_from_id FOR SHARE;
   IF source.id IS NULL OR source.deleted_at IS NOT NULL OR source.view_limit IS NOT NULL
     OR NOT public.can_access_chat_conversation(source.conversation_id)
     OR NEW.media_url IS DISTINCT FROM source.media_url OR NEW.thumbnail_url IS DISTINCT FROM source.thumbnail_url
     OR NEW.media_type IS DISTINCT FROM source.media_type
     OR NOT (source.media_access_verified OR (
       (public.chat_object_path(source.media_url) IS NULL OR split_part(public.chat_object_path(source.media_url), '/', 2) = source.sender_id::text)
       AND (public.chat_object_path(source.thumbnail_url) IS NULL OR split_part(public.chat_object_path(source.thumbnail_url), '/', 2) = source.sender_id::text))) THEN
     RAISE EXCEPTION 'Attachment forwarding is not authorized' USING ERRCODE = '42501';
   END IF;
   NEW.media_access_verified := true;
 END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS chat_media_reference_guard ON public.messages;
CREATE TRIGGER chat_media_reference_guard BEFORE INSERT OR UPDATE ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.guard_chat_media_reference();
REVOKE ALL ON FUNCTION public.guard_chat_media_reference() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.chat_media_manifest(p_message_ids uuid[])
RETURNS TABLE(id uuid, media_url text, thumbnail_url text, view_limit smallint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
 SELECT m.id, CASE WHEN public.chat_object_path(m.media_url) IS NOT NULL THEN m.media_url END, CASE WHEN public.chat_object_path(m.thumbnail_url) IS NOT NULL THEN m.thumbnail_url END, m.view_limit FROM public.messages m
 WHERE cardinality(p_message_ids) BETWEEN 1 AND 100 AND m.id = ANY(p_message_ids)
   AND m.deleted_at IS NULL AND public.can_access_chat_conversation(m.conversation_id)
   AND (m.media_access_verified OR (
     (public.chat_object_path(m.media_url) IS NULL OR split_part(public.chat_object_path(m.media_url), '/', 2) = m.sender_id::text)
     AND (public.chat_object_path(m.thumbnail_url) IS NULL OR split_part(public.chat_object_path(m.thumbnail_url), '/', 2) = m.sender_id::text)))
   AND (public.chat_object_path(m.media_url) IS NOT NULL OR public.chat_object_path(m.thumbnail_url) IS NOT NULL);
$$;
REVOKE ALL ON FUNCTION public.chat_media_manifest(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_media_manifest(uuid[]) TO authenticated;

-- An idempotent short viewing grant prevents a lost response consuming a second
-- view. Grants are not storage URLs, and can only be redeemed by the same user.
CREATE TABLE IF NOT EXISTS public.chat_media_view_grants (
 request_id uuid NOT NULL, user_id uuid NOT NULL, message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
 remaining integer NOT NULL, expires_at timestamptz NOT NULL DEFAULT now() + interval '2 minutes',
 PRIMARY KEY(user_id, request_id)
);
ALTER TABLE public.chat_media_view_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.chat_media_view_grants FROM anon, authenticated;
CREATE INDEX IF NOT EXISTS chat_media_view_grants_expiry ON public.chat_media_view_grants(expires_at);
CREATE OR REPLACE FUNCTION public.claim_chat_media_view(p_message_id uuid, p_request_id uuid)
RETURNS TABLE(url text, remaining integer) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE m public.messages%ROWTYPE; g public.chat_media_view_grants%ROWTYPE; v integer;
BEGIN
 IF auth.uid() IS NULL OR p_request_id IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
 -- Serialize grants for this message; no two devices can consume the last view.
 SELECT * INTO m FROM public.messages WHERE id = p_message_id FOR UPDATE;
 IF m.id IS NULL OR m.deleted_at IS NOT NULL OR m.view_limit IS NULL OR public.can_act_as(m.sender_id)
   OR NOT public.can_access_chat_conversation(m.conversation_id)
   OR public.chat_object_path(m.media_url) IS NULL
   OR split_part(public.chat_object_path(m.media_url), '/', 2) <> m.sender_id::text THEN
   RETURN QUERY SELECT NULL::text, 0; RETURN;
 END IF;
 SELECT * INTO g FROM public.chat_media_view_grants WHERE user_id = auth.uid() AND request_id = p_request_id;
 IF FOUND THEN
   IF g.message_id = p_message_id AND g.expires_at > now() THEN RETURN QUERY SELECT m.media_url, g.remaining;
   ELSE RETURN QUERY SELECT NULL::text, 0; END IF;
   RETURN;
 END IF;
 INSERT INTO public.message_views(message_id,user_id,views,first_viewed_at)
 VALUES(m.id,auth.uid(),0,now()) ON CONFLICT DO NOTHING;
 SELECT views INTO v FROM public.message_views WHERE message_id=m.id AND user_id=auth.uid() FOR UPDATE;
 IF v >= m.view_limit THEN RETURN QUERY SELECT NULL::text,0; RETURN; END IF;
 UPDATE public.message_views SET views=views+1, first_viewed_at=coalesce(first_viewed_at,now()) WHERE message_id=m.id AND user_id=auth.uid();
 INSERT INTO public.chat_media_view_grants(request_id,user_id,message_id,remaining) VALUES(p_request_id,auth.uid(),m.id,m.view_limit-v-1);
 RETURN QUERY SELECT m.media_url, m.view_limit-v-1;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_chat_media_view(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_chat_media_view(uuid,uuid) TO authenticated;
-- Old builds cannot reopen limited-view public locators after the private migration.
CREATE OR REPLACE FUNCTION public.consume_media_view(p_message_id uuid)
RETURNS TABLE(url text, remaining integer) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN RAISE EXCEPTION 'Update Platinum Circles to open limited-view attachments'; END;
$$;

CREATE OR REPLACE FUNCTION public.join_group_call(p_session_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s public.call_sessions%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 SELECT * INTO s FROM public.call_sessions WHERE id=p_session_id FOR UPDATE;
 IF s.id IS NULL OR NOT s.is_group_call OR s.status NOT IN ('ringing','active')
   OR (s.status='ringing' AND coalesce(s.expires_at,s.created_at+interval '90 seconds')<=now()) THEN
   RAISE EXCEPTION 'Call is no longer available';
 END IF;
 IF NOT public.is_conversation_member(s.conversation_id,auth.uid()) THEN RAISE EXCEPTION 'Not a member' USING ERRCODE='42501'; END IF;
 INSERT INTO public.call_participants(call_session_id,user_id,status,joined_at,last_seen_at)
 VALUES(s.id,auth.uid(),'joined',now(),now()) ON CONFLICT(call_session_id,user_id)
 DO UPDATE SET status='joined',joined_at=coalesce(call_participants.joined_at,now()),left_at=NULL,last_seen_at=now();
 UPDATE public.call_sessions SET status='active',started_at=coalesce(started_at,now())
 WHERE id=s.id AND status='ringing' AND auth.uid()<>s.initiator_id;
END;
$$;
CREATE OR REPLACE FUNCTION public.leave_group_call(p_session_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s public.call_sessions%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 SELECT * INTO s FROM public.call_sessions WHERE id=p_session_id FOR UPDATE;
 IF s.id IS NULL OR NOT s.is_group_call OR NOT EXISTS(SELECT 1 FROM public.call_participants WHERE call_session_id=s.id AND user_id=auth.uid()) THEN
   RAISE EXCEPTION 'Not a participant' USING ERRCODE='42501';
 END IF;
 UPDATE public.call_participants SET status='left',left_at=coalesce(left_at,now()) WHERE call_session_id=s.id AND user_id=auth.uid();
 UPDATE public.call_sessions SET status='ended',ended_at=now(),duration_sec=greatest(0,extract(epoch FROM(now()-coalesce(started_at,created_at)))::int)
 WHERE id=s.id AND status IN('ringing','active') AND NOT EXISTS(SELECT 1 FROM public.call_participants WHERE call_session_id=s.id AND status='joined');
END;
$$;
CREATE OR REPLACE FUNCTION public.decline_group_call(p_session_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s public.call_sessions%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 SELECT * INTO s FROM public.call_sessions WHERE id=p_session_id FOR UPDATE;
 IF s.id IS NULL OR NOT s.is_group_call OR NOT EXISTS(SELECT 1 FROM public.call_participants WHERE call_session_id=s.id AND user_id=auth.uid()) THEN
   RAISE EXCEPTION 'Not a participant' USING ERRCODE='42501';
 END IF;
 UPDATE public.call_participants SET status='declined',left_at=coalesce(left_at,now()) WHERE call_session_id=s.id AND user_id=auth.uid() AND status='invited';
 UPDATE public.call_sessions SET status='missed',ended_at=now() WHERE id=s.id AND status='ringing'
 AND NOT EXISTS(SELECT 1 FROM public.call_participants WHERE call_session_id=s.id AND status IN('invited','joined') AND user_id<>s.initiator_id);
END;
$$;
REVOKE ALL ON FUNCTION public.join_group_call(uuid), public.leave_group_call(uuid), public.decline_group_call(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_group_call(uuid), public.leave_group_call(uuid), public.decline_group_call(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.can_read_chat_object(p_bucket text, p_name text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
 SELECT p_bucket IN ('chat-media','chat-files') AND EXISTS(
  SELECT 1 FROM public.messages m
  WHERE (public.chat_object_path(m.media_url)=p_bucket||'/'||p_name OR public.chat_object_path(m.thumbnail_url)=p_bucket||'/'||p_name)
    AND m.deleted_at IS NULL AND m.view_limit IS NULL
    AND public.can_access_chat_conversation(m.conversation_id)
    AND (m.media_access_verified OR (
     (public.chat_object_path(m.media_url) IS NULL OR split_part(public.chat_object_path(m.media_url),'/',2)=m.sender_id::text)
     AND (public.chat_object_path(m.thumbnail_url) IS NULL OR split_part(public.chat_object_path(m.thumbnail_url),'/',2)=m.sender_id::text)))
 );
$$;
REVOKE ALL ON FUNCTION public.can_read_chat_object(text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_chat_object(text,text) TO authenticated, service_role;
CREATE INDEX IF NOT EXISTS messages_chat_media_locator ON public.messages (public.chat_object_path(media_url)) WHERE deleted_at IS NULL AND view_limit IS NULL;
CREATE INDEX IF NOT EXISTS messages_chat_thumbnail_locator ON public.messages (public.chat_object_path(thumbnail_url)) WHERE deleted_at IS NULL AND view_limit IS NULL;

-- Distinct provider identities per group admission make revocation permanent for
-- the old admission while allowing a later authorized rejoin of the same call.
ALTER TABLE public.call_participants ADD COLUMN IF NOT EXISTS provider_identity uuid NOT NULL DEFAULT gen_random_uuid();
CREATE TABLE IF NOT EXISTS public.call_provider_revocations (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 call_session_id uuid NOT NULL, provider_user_id text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), available_at timestamptz NOT NULL DEFAULT now(),
 attempts integer NOT NULL DEFAULT 0, completed_at timestamptz, last_error text,
 UNIQUE(call_session_id,provider_user_id)
);
ALTER TABLE public.call_provider_revocations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.call_provider_revocations FROM anon, authenticated;
GRANT ALL ON public.call_provider_revocations TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.call_provider_revocations_id_seq TO service_role;
CREATE INDEX IF NOT EXISTS call_revocations_pending ON public.call_provider_revocations(available_at,id) WHERE completed_at IS NULL;

CREATE OR REPLACE FUNCTION public.queue_call_participant_revocation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' OR (OLD.status='joined' AND NEW.status<>'joined') THEN
   INSERT INTO public.call_provider_revocations(call_session_id,provider_user_id)
   VALUES(OLD.call_session_id,OLD.provider_identity::text) ON CONFLICT DO NOTHING;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF NEW.provider_identity IS DISTINCT FROM OLD.provider_identity THEN NEW.provider_identity:=OLD.provider_identity; END IF;
 IF NEW.status='joined' AND OLD.status<>'joined' THEN NEW.provider_identity:=gen_random_uuid(); END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER call_participant_provider_revoke BEFORE UPDATE OR DELETE ON public.call_participants
FOR EACH ROW EXECUTE FUNCTION public.queue_call_participant_revocation();

CREATE OR REPLACE FUNCTION public.queue_ended_call_revocation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
 IF NEW.status NOT IN ('ringing','active') AND OLD.status IN('ringing','active') THEN
   INSERT INTO public.call_provider_revocations(call_session_id,provider_user_id)
   SELECT NEW.id,p.provider_identity::text FROM public.call_participants p WHERE p.call_session_id=NEW.id
   ON CONFLICT DO NOTHING;
   IF NOT NEW.is_group_call THEN
     INSERT INTO public.call_provider_revocations(call_session_id,provider_user_id)
     SELECT NEW.id,u::text FROM unnest(ARRAY[NEW.initiator_id,NEW.receiver_id]) u WHERE u IS NOT NULL
     ON CONFLICT DO NOTHING;
   END IF;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER call_session_provider_revoke AFTER UPDATE OF status ON public.call_sessions
FOR EACH ROW EXECUTE FUNCTION public.queue_ended_call_revocation();

CREATE OR REPLACE FUNCTION public.revoke_removed_chat_member_calls()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
 UPDATE public.call_participants p SET status='left',left_at=coalesce(left_at,now())
 FROM public.call_sessions s WHERE p.call_session_id=s.id AND s.conversation_id=OLD.conversation_id
 AND s.is_group_call AND s.status IN('ringing','active') AND p.user_id=OLD.user_id AND p.status='joined';
 RETURN OLD;
END;
$$;
CREATE TRIGGER removed_chat_member_calls AFTER DELETE ON public.conversation_members
FOR EACH ROW EXECUTE FUNCTION public.revoke_removed_chat_member_calls();
REVOKE ALL ON FUNCTION public.queue_call_participant_revocation(), public.queue_ended_call_revocation(), public.revoke_removed_chat_member_calls() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.claim_call_revocations(p_limit integer DEFAULT 50)
RETURNS SETOF public.call_provider_revocations LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
 UPDATE public.call_provider_revocations r SET attempts=r.attempts+1,available_at=now()+interval '2 minutes'
 WHERE r.id IN (SELECT id FROM public.call_provider_revocations WHERE completed_at IS NULL AND available_at<=now()
 ORDER BY available_at,id LIMIT least(greatest(p_limit,1),50) FOR UPDATE SKIP LOCKED) RETURNING r.*;
$$;
REVOKE ALL ON FUNCTION public.claim_call_revocations(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_call_revocations(integer) TO service_role;

-- Clients may stamp their heartbeat, but invitation/admission/leave state is
-- owned by the authorization-checked RPCs above.
REVOKE INSERT, UPDATE, DELETE ON public.call_participants FROM PUBLIC, anon, authenticated;
GRANT UPDATE(last_seen_at) ON public.call_participants TO authenticated;
CREATE POLICY call_participant_heartbeat_guard ON public.call_participants AS RESTRICTIVE
FOR UPDATE TO authenticated USING(user_id=auth.uid() AND status='joined')
WITH CHECK(user_id=auth.uid() AND status='joined');

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
CREATE TRIGGER call_session_lifecycle_guard BEFORE INSERT OR UPDATE ON public.call_sessions
FOR EACH ROW EXECUTE FUNCTION public.guard_call_session_lifecycle();
REVOKE ALL ON FUNCTION public.guard_call_session_lifecycle() FROM PUBLIC, anon, authenticated;
