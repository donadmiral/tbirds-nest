-- Read-only snapshot from production prlkikhckbifseosbukl, 2026-11-05.
-- Used only in isolated tests. Org role lookup fixture is supplied by the test.

CREATE OR REPLACE FUNCTION public.is_business_member(p_business_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select org_role_for_profile(p_business_id) is not null
      or cardinality(org_delegated_scopes(p_business_id)) > 0
      or exists (select 1 from business_members where business_id = p_business_id and member_id = auth.uid());
$function$
;

CREATE OR REPLACE FUNCTION public.can_act_as(p_target uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select auth.uid() is not null and (auth.uid() = p_target or is_business_member(p_target));
$function$
;

CREATE OR REPLACE FUNCTION public.can_access_chat_conversation(p_conversation uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 SELECT auth.uid() IS NOT NULL AND EXISTS (
   SELECT 1 FROM public.conversations c WHERE c.id = p_conversation AND
   ((NOT c.is_group AND (public.can_act_as(c.user_1) OR public.can_act_as(c.user_2))) OR
    (c.is_group AND EXISTS (SELECT 1 FROM public.conversation_members m
      WHERE m.conversation_id = c.id AND public.can_act_as(m.user_id))))
 );
$function$
;

CREATE OR REPLACE FUNCTION public.chat_object_path(p_url text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
 SELECT CASE WHEN p_url ~ '^https://[^/?#]+/storage/v1/object/public/(chat-media|chat-files)/[0-9a-fA-F-]{36}/[A-Za-z0-9_. /-]+([?]t=[0-9]+)?$'
   AND p_url !~ '/[.][.]?(/|[?]|$)' THEN substring(split_part(p_url, '?', 1) FROM '/storage/v1/object/public/((?:chat-media|chat-files)/.*)$') END;
$function$
;

CREATE OR REPLACE FUNCTION public.chat_media_manifest(p_message_ids uuid[])
 RETURNS TABLE(id uuid, media_url text, thumbnail_url text, view_limit smallint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 SELECT m.id, CASE WHEN public.chat_object_path(m.media_url) IS NOT NULL THEN m.media_url END, CASE WHEN public.chat_object_path(m.thumbnail_url) IS NOT NULL THEN m.thumbnail_url END, m.view_limit FROM public.messages m
 WHERE cardinality(p_message_ids) BETWEEN 1 AND 100 AND m.id = ANY(p_message_ids)
   AND m.deleted_at IS NULL AND public.can_access_chat_conversation(m.conversation_id)
   AND (m.media_access_verified OR (
     (public.chat_object_path(m.media_url) IS NULL OR split_part(public.chat_object_path(m.media_url), '/', 2) = m.sender_id::text)
     AND (public.chat_object_path(m.thumbnail_url) IS NULL OR split_part(public.chat_object_path(m.thumbnail_url), '/', 2) = m.sender_id::text)))
   AND (public.chat_object_path(m.media_url) IS NOT NULL OR public.chat_object_path(m.thumbnail_url) IS NOT NULL);
$function$
;

CREATE OR REPLACE FUNCTION public.claim_chat_media_view(p_message_id uuid, p_request_id uuid)
 RETURNS TABLE(url text, remaining integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$
;
