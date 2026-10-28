-- Coordinated client cutover: old limited-view clients must update first.
CREATE SCHEMA IF NOT EXISTS private_media;
REVOKE ALL ON SCHEMA private_media FROM PUBLIC,anon,authenticated;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS private_expires_at timestamptz;
UPDATE public.messages SET private_expires_at=coalesce(created_at,now())+interval '7 days' WHERE view_limit IS NOT NULL AND private_expires_at IS NULL;
CREATE TABLE private_media.recipients(message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,user_id uuid NOT NULL,views integer NOT NULL DEFAULT 0 CHECK(views>=0),PRIMARY KEY(message_id,user_id));
CREATE TABLE private_media.grants(user_id uuid NOT NULL,request_id uuid NOT NULL,message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,auth_session_id uuid,opened_at timestamptz,expires_at timestamptz NOT NULL,closed_at timestamptz,close_reason text,PRIMARY KEY(user_id,request_id));
CREATE TABLE private_media.events(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,message_id uuid,user_id uuid,request_id uuid,event text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE private_media.erasure(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),locator text NOT NULL UNIQUE,state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','deleting','deleted')),available_at timestamptz NOT NULL DEFAULT now(),attempts integer NOT NULL DEFAULT 0,lease_token uuid,lease_until timestamptz,completed_at timestamptz);
ALTER TABLE private_media.recipients ENABLE ROW LEVEL SECURITY;ALTER TABLE private_media.grants ENABLE ROW LEVEL SECURITY;ALTER TABLE private_media.events ENABLE ROW LEVEL SECURITY;ALTER TABLE private_media.erasure ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA private_media FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX private_grants_active ON private_media.grants(message_id,expires_at) WHERE closed_at IS NULL;
CREATE INDEX private_erasure_due ON private_media.erasure(available_at) WHERE state<>'deleted';
-- Existing locator indexes cover only ordinary live messages. These checks also
-- inspect private/deleted historical references before reserving an upload.
CREATE INDEX private_message_media_locator ON public.messages(public.chat_object_path(media_url)) WHERE public.chat_object_path(media_url) IS NOT NULL;
CREATE INDEX private_message_thumbnail_locator ON public.messages(public.chat_object_path(thumbnail_url)) WHERE public.chat_object_path(thumbnail_url) IS NOT NULL;
-- Legacy recipients are snapshotted once, but no historical object is enrolled for erasure.
INSERT INTO private_media.recipients(message_id,user_id,views)
SELECT m.id,u.id,coalesce(v.views,0) FROM public.messages m JOIN public.conversations c ON c.id=m.conversation_id
CROSS JOIN LATERAL(SELECT c.user_1 id WHERE NOT c.is_group UNION SELECT c.user_2 WHERE NOT c.is_group UNION SELECT cm.user_id FROM public.conversation_members cm WHERE c.is_group AND cm.conversation_id=c.id)u
LEFT JOIN public.message_views v ON v.message_id=m.id AND v.user_id=u.id
WHERE m.view_limit IS NOT NULL AND u.id IS NOT NULL AND u.id<>m.sender_id ON CONFLICT DO NOTHING;
CREATE FUNCTION private_media.current_session() RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE sid uuid;
BEGIN
 IF auth.uid() IS NULL OR coalesce((auth.jwt()->>'is_anonymous')::boolean,false) THEN RETURN NULL;END IF;
 BEGIN sid:=(auth.jwt()->>'session_id')::uuid;EXCEPTION WHEN invalid_text_representation THEN RETURN NULL;END;
 IF NOT EXISTS(SELECT 1 FROM auth.sessions s JOIN auth.users u ON u.id=s.user_id WHERE s.id=sid AND s.user_id=auth.uid() AND (s.not_after IS NULL OR s.not_after>now()) AND u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until<=now())) THEN RETURN NULL;END IF;
 RETURN sid;
END$$;
CREATE FUNCTION private_media.can_view(mid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT private_media.current_session() IS NOT NULL AND EXISTS(SELECT 1 FROM public.messages m JOIN public.conversations c ON c.id=m.conversation_id JOIN private_media.recipients r ON r.message_id=m.id AND r.user_id=auth.uid() JOIN public.profiles sender ON sender.id=m.sender_id JOIN public.profiles viewer ON viewer.id=auth.uid()
 WHERE m.id=mid AND m.view_limit IN(1,2) AND m.media_type IN('image','video') AND m.deleted_at IS NULL AND m.private_expires_at>now() AND m.sender_id<>auth.uid() AND sender.deactivated_at IS NULL AND viewer.deactivated_at IS NULL
 AND ((NOT c.is_group AND auth.uid() IN(c.user_1,c.user_2)) OR (c.is_group AND EXISTS(SELECT 1 FROM public.conversation_members cm WHERE cm.conversation_id=c.id AND cm.user_id=auth.uid())))
 AND NOT EXISTS(SELECT 1 FROM public.blocked_users b WHERE (b.blocker_id=m.sender_id AND b.blocked_id=auth.uid()) OR (b.blocked_id=m.sender_id AND b.blocker_id=auth.uid()))
 AND public.chat_object_path(m.media_url) IS NOT NULL AND split_part(public.chat_object_path(m.media_url),'/',2)=m.sender_id::text);
$$;
CREATE FUNCTION private_media.enqueue(loc text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN IF loc IS NULL THEN RETURN;END IF;PERFORM pg_advisory_xact_lock(hashtextextended('private-object:'||loc,0));INSERT INTO private_media.erasure(locator) VALUES(loc) ON CONFLICT(locator) DO NOTHING;END$$;
CREATE FUNCTION private_media.before_message() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE loc text;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.private_expires_at IS DISTINCT FROM OLD.private_expires_at THEN RAISE EXCEPTION 'PRIVATE_EXPIRY_IMMUTABLE' USING ERRCODE='42501';END IF;
  RETURN NEW;
 END IF;
 FOREACH loc IN ARRAY ARRAY[public.chat_object_path(NEW.media_url),public.chat_object_path(NEW.thumbnail_url)] LOOP
  IF loc IS NOT NULL THEN
   PERFORM pg_advisory_xact_lock(hashtextextended('private-object:'||loc,0));
   IF EXISTS(SELECT 1 FROM private_media.erasure WHERE locator=loc) THEN RAISE EXCEPTION 'PRIVATE_OBJECT_RESERVED' USING ERRCODE='42501';END IF;
  END IF;
 END LOOP;
 IF NEW.view_limit IS NOT NULL THEN
  loc:=public.chat_object_path(NEW.media_url);
  IF EXISTS(SELECT 1 FROM public.messages m WHERE public.chat_object_path(m.media_url)=loc OR public.chat_object_path(m.thumbnail_url)=loc)
   OR EXISTS(SELECT 1 FROM public.channel_messages WHERE public.chat_object_path(media_url)=loc)
   OR EXISTS(SELECT 1 FROM public.conversations WHERE public.chat_object_path(group_avatar_url)=loc)
   OR EXISTS(SELECT 1 FROM public.job_applications WHERE public.chat_object_path(cv_url)=loc) THEN RAISE EXCEPTION 'PRIVATE_REQUIRES_NEW_UPLOAD';END IF;
  IF loc IS NULL OR split_part(loc,'/',2)<>NEW.sender_id::text OR NEW.view_limit NOT IN(1,2) OR NEW.media_type IS NULL OR NEW.media_type NOT IN('image','video') OR NEW.thumbnail_url IS NOT NULL OR NEW.forwarded_from_id IS NOT NULL THEN RAISE EXCEPTION 'INVALID_PRIVATE_ATTACHMENT';END IF;
  IF NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id=split_part(loc,'/',1) AND o.name=substring(loc FROM position('/' IN loc)+1)) THEN RAISE EXCEPTION 'UPLOAD_PRIVATE_ATTACHMENT_FIRST';END IF;
  NEW.private_expires_at:=now()+interval '7 days';
 ELSE NEW.private_expires_at:=NULL;END IF;
 RETURN NEW;
END$$;
CREATE TRIGGER private_message_guard BEFORE INSERT OR UPDATE ON public.messages FOR EACH ROW EXECUTE FUNCTION private_media.before_message();
CREATE FUNCTION private_media.after_message() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.conversations;loc text;
BEGIN
 IF TG_OP='INSERT' AND NEW.view_limit IS NOT NULL THEN
  SELECT * INTO c FROM public.conversations WHERE id=NEW.conversation_id;
  INSERT INTO private_media.recipients(message_id,user_id) SELECT NEW.id,u.id FROM(SELECT c.user_1 id WHERE NOT c.is_group UNION SELECT c.user_2 WHERE NOT c.is_group UNION SELECT cm.user_id FROM public.conversation_members cm WHERE c.is_group AND cm.conversation_id=c.id)u WHERE u.id IS NOT NULL AND u.id<>NEW.sender_id ON CONFLICT DO NOTHING;
  PERFORM private_media.enqueue(public.chat_object_path(NEW.media_url));
 ELSIF TG_OP='UPDATE' AND NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
  -- A legacy delete does not opt historical files into the new erasure programme.
  UPDATE private_media.grants SET closed_at=coalesce(closed_at,now()),close_reason=coalesce(close_reason,'deleted') WHERE message_id=NEW.id;
  UPDATE private_media.erasure SET available_at=least(available_at,now()) WHERE locator=public.chat_object_path(OLD.media_url) AND state='pending';
 END IF;
 RETURN NEW;
END$$;
CREATE TRIGGER private_message_snapshot AFTER INSERT OR UPDATE ON public.messages FOR EACH ROW EXECUTE FUNCTION private_media.after_message();
CREATE OR REPLACE FUNCTION public.open_private_media(p_message_id uuid,p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.messages;g private_media.grants;r private_media.recipients;sid uuid;remaining integer;
BEGIN
 sid:=private_media.current_session();IF sid IS NULL OR p_request_id IS NULL THEN RAISE EXCEPTION 'AUTH_SESSION_REQUIRED' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_request_id::text,0));
 SELECT * INTO m FROM public.messages WHERE id=p_message_id FOR UPDATE;
 IF NOT private_media.can_view(p_message_id) THEN RETURN NULL;END IF;
 SELECT * INTO g FROM private_media.grants WHERE user_id=auth.uid() AND request_id=p_request_id;
 IF FOUND THEN
  IF g.message_id<>p_message_id OR g.auth_session_id IS DISTINCT FROM sid OR g.opened_at IS NULL OR g.closed_at IS NOT NULL OR g.expires_at<=now() THEN RETURN NULL;END IF;
 ELSE
  SELECT * INTO r FROM private_media.recipients WHERE message_id=p_message_id AND user_id=auth.uid() FOR UPDATE;
  IF r.views>=m.view_limit THEN RETURN NULL;END IF;
  UPDATE private_media.recipients SET views=views+1 WHERE message_id=p_message_id AND user_id=auth.uid();
  INSERT INTO private_media.grants(user_id,request_id,message_id,auth_session_id,opened_at,expires_at) VALUES(auth.uid(),p_request_id,p_message_id,sid,now(),least(m.private_expires_at,now()+interval '15 minutes')) RETURNING * INTO g;
  INSERT INTO private_media.events(message_id,user_id,request_id,event) VALUES(p_message_id,auth.uid(),p_request_id,'opened');
  INSERT INTO public.message_views(message_id,user_id,views,first_viewed_at) VALUES(p_message_id,auth.uid(),r.views+1,now()) ON CONFLICT(message_id,user_id) DO UPDATE SET views=excluded.views;
  PERFORM private_media.enqueue(public.chat_object_path(m.media_url));
 END IF;
 SELECT m.view_limit-views INTO remaining FROM private_media.recipients WHERE message_id=p_message_id AND user_id=auth.uid();
 RETURN jsonb_build_object('requestId',p_request_id,'expiresAt',g.expires_at,'remaining',remaining,'mediaType',m.media_type,'watermark',auth.uid()::text||' · '||p_request_id::text);
END$$;
CREATE OR REPLACE FUNCTION public.read_private_media(p_message_id uuid,p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE g private_media.grants;m public.messages;
BEGIN
 IF NOT private_media.can_view(p_message_id) THEN RETURN NULL;END IF;
 SELECT * INTO g FROM private_media.grants WHERE user_id=auth.uid() AND request_id=p_request_id AND message_id=p_message_id AND auth_session_id=private_media.current_session() AND opened_at IS NOT NULL AND closed_at IS NULL AND expires_at>now();
 IF NOT FOUND THEN RETURN NULL;END IF;
 SELECT * INTO m FROM public.messages WHERE id=p_message_id;
 RETURN jsonb_build_object('url',m.media_url,'expiresAt',g.expires_at,'mediaType',m.media_type);
END$$;
CREATE OR REPLACE FUNCTION public.close_private_media(p_message_id uuid,p_request_id uuid,p_reason text DEFAULT 'closed') RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE sid uuid;g private_media.grants;reason text;
BEGIN
 sid:=private_media.current_session();IF sid IS NULL OR p_request_id IS NULL THEN RETURN false;END IF;
 reason:=CASE WHEN p_reason IN('closed','background','screenshot','camera_detected','guard_failed','expired','account_changed','error') THEN p_reason ELSE 'closed' END;
 PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_request_id::text,0));
 SELECT * INTO g FROM private_media.grants WHERE user_id=auth.uid() AND request_id=p_request_id FOR UPDATE;
 IF FOUND THEN
  IF g.message_id<>p_message_id OR g.auth_session_id IS DISTINCT FROM sid THEN RETURN false;END IF;
  IF g.closed_at IS NOT NULL THEN RETURN true;END IF;
  UPDATE private_media.grants SET closed_at=coalesce(closed_at,now()),close_reason=coalesce(close_reason,reason) WHERE user_id=auth.uid() AND request_id=p_request_id;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM private_media.recipients WHERE message_id=p_message_id AND user_id=auth.uid()) THEN RETURN false;END IF;
  INSERT INTO private_media.grants(user_id,request_id,message_id,auth_session_id,expires_at,closed_at,close_reason) VALUES(auth.uid(),p_request_id,p_message_id,sid,now(),now(),reason);
 END IF;
 INSERT INTO private_media.events(message_id,user_id,request_id,event) VALUES(p_message_id,auth.uid(),p_request_id,reason);
 RETURN true;
END$$;
CREATE OR REPLACE FUNCTION public.claim_chat_media_view(p_message_id uuid,p_request_id uuid) RETURNS TABLE(url text,remaining integer) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$BEGIN RAISE EXCEPTION 'Update Platinum Circles to open private attachments';END$$;
REVOKE ALL ON FUNCTION public.claim_chat_media_view(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.open_private_media(uuid,uuid),public.read_private_media(uuid,uuid),public.close_private_media(uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.open_private_media(uuid,uuid),public.read_private_media(uuid,uuid),public.close_private_media(uuid,uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.private_media_erasure_safe(p_locator text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT NOT EXISTS(SELECT 1 FROM public.messages m WHERE (public.chat_object_path(m.media_url)=p_locator OR public.chat_object_path(m.thumbnail_url)=p_locator) AND m.deleted_at IS NULL AND (
  m.view_limit IS NULL OR (m.private_expires_at>now() AND EXISTS(SELECT 1 FROM private_media.recipients r WHERE r.message_id=m.id AND r.views<m.view_limit)) OR EXISTS(SELECT 1 FROM private_media.grants g WHERE g.message_id=m.id AND g.opened_at IS NOT NULL AND g.closed_at IS NULL AND g.expires_at>now())))
 AND NOT EXISTS(SELECT 1 FROM public.channel_messages WHERE public.chat_object_path(media_url)=p_locator)
 AND NOT EXISTS(SELECT 1 FROM public.conversations WHERE public.chat_object_path(group_avatar_url)=p_locator)
 AND NOT EXISTS(SELECT 1 FROM public.job_applications WHERE public.chat_object_path(cv_url)=p_locator);
$$;
CREATE OR REPLACE FUNCTION public.claim_private_media_cleanup(p_worker uuid,p_limit integer DEFAULT 25) RETURNS TABLE(id uuid,bucket text,path text,lease_token uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e private_media.erasure;
BEGIN
 IF p_worker IS NULL THEN RETURN;END IF;
 FOR e IN SELECT * FROM private_media.erasure WHERE state<>'deleted' AND available_at<=now() AND (lease_until IS NULL OR lease_until<=now()) ORDER BY available_at LIMIT greatest(1,least(p_limit,25)) FOR UPDATE SKIP LOCKED LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended('private-object:'||e.locator,0));
  IF public.private_media_erasure_safe(e.locator) THEN
   UPDATE private_media.erasure q SET state='deleting',attempts=attempts+1,lease_token=p_worker,lease_until=now()+interval '2 minutes',available_at=now()+interval '2 minutes' WHERE q.id=e.id;
   id:=e.id;bucket:=split_part(e.locator,'/',1);path:=substring(e.locator FROM position('/' IN e.locator)+1);lease_token:=p_worker;RETURN NEXT;
  ELSE UPDATE private_media.erasure q SET available_at=now()+interval '1 minute' WHERE q.id=e.id;END IF;
 END LOOP;
END$$;
CREATE OR REPLACE FUNCTION public.finish_private_media_cleanup(p_id uuid,p_worker uuid,p_success boolean) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 UPDATE private_media.erasure SET state=CASE WHEN p_success THEN 'deleted' ELSE 'pending' END,completed_at=CASE WHEN p_success THEN now() ELSE NULL END,lease_token=NULL,lease_until=NULL,available_at=now()+interval '2 minutes' WHERE id=p_id AND lease_token=p_worker AND lease_until>now() AND state='deleting';RETURN FOUND;
END$$;
CREATE FUNCTION private_media.guard_external_reference() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE loc text;value text;old_value text;
BEGIN
 IF TG_TABLE_SCHEMA='storage' THEN
  IF NEW.bucket_id NOT IN('chat-media','chat-files') THEN RETURN NEW;END IF;loc:=NEW.bucket_id||'/'||NEW.name;
 ELSE
  value:=CASE TG_TABLE_NAME WHEN 'channel_messages' THEN to_jsonb(NEW)->>'media_url' WHEN 'conversations' THEN to_jsonb(NEW)->>'group_avatar_url' ELSE to_jsonb(NEW)->>'cv_url' END;
  IF TG_OP='UPDATE' THEN old_value:=CASE TG_TABLE_NAME WHEN 'channel_messages' THEN to_jsonb(OLD)->>'media_url' WHEN 'conversations' THEN to_jsonb(OLD)->>'group_avatar_url' ELSE to_jsonb(OLD)->>'cv_url' END;IF value IS NOT DISTINCT FROM old_value THEN RETURN NEW;END IF;END IF;
  loc:=public.chat_object_path(value);
 END IF;
 IF loc IS NOT NULL THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('private-object:'||loc,0));
  IF EXISTS(SELECT 1 FROM private_media.erasure WHERE locator=loc) THEN RAISE EXCEPTION 'PRIVATE_OBJECT_RESERVED' USING ERRCODE='42501';END IF;
 END IF;
 RETURN NEW;
END$$;
CREATE TRIGGER private_storage_reservation BEFORE INSERT OR UPDATE ON storage.objects FOR EACH ROW EXECUTE FUNCTION private_media.guard_external_reference();
CREATE TRIGGER private_channel_reservation BEFORE INSERT OR UPDATE OF media_url ON public.channel_messages FOR EACH ROW EXECUTE FUNCTION private_media.guard_external_reference();
CREATE TRIGGER private_avatar_reservation BEFORE INSERT OR UPDATE OF group_avatar_url ON public.conversations FOR EACH ROW EXECUTE FUNCTION private_media.guard_external_reference();
CREATE TRIGGER private_cv_reservation BEFORE INSERT OR UPDATE OF cv_url ON public.job_applications FOR EACH ROW EXECUTE FUNCTION private_media.guard_external_reference();
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA private_media FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.private_media_erasure_safe(text),public.claim_private_media_cleanup(uuid,integer),public.finish_private_media_cleanup(uuid,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.private_media_erasure_safe(text),public.claim_private_media_cleanup(uuid,integer),public.finish_private_media_cleanup(uuid,uuid,boolean) TO service_role;
