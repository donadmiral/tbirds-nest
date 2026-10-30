-- QA-ONLY forward adapter for uaulhuelcfkjwojtymmw.
-- Exact inspected catalog, preserving every existing account and Storage object.
-- Production candidates are unchanged. No bucket visibility change or data reset.
begin;
set local lock_timeout='3s';
do $qa_preflight$
declare actual jsonb;
begin
select jsonb_build_object(
 'counts',jsonb_build_object('auth',(select count(*) from auth.users),'staff',(select count(*) from public.admin_users),'profiles',(select count(*) from public.profiles),'objects',(select count(*) from storage.objects)),
 'schemas',(select coalesce(jsonb_agg(nspname order by nspname),'[]'::jsonb) from pg_namespace where nspname in('private_media','account_erasure','media_delivery')),
 'buckets',(select jsonb_agg(jsonb_build_object('id',id,'public',public) order by id) from storage.buckets where id in('post-media','story-media','media','chat-media','chat-files')),
 'functions',(select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),'acl',coalesce(p.proacl::text,''),'md5',md5(pg_get_functiondef(p.oid))) order by p.oid::regprocedure::text)
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='content_media_legacy' and p.proname='allows_read') or (n.nspname='public' and p.proname in('delete_user_account','open_legacy_chat_media','claim_chat_media_view','consume_media_view','can_read_legacy_chat_object','guard_legacy_chat_reference','platinum_upload_path_allowed','chat_media_manifest','content_media_manifest','content_media_document'))),
 'policies',(select jsonb_agg(jsonb_build_object('name',polname,'cmd',polcmd,'permissive',polpermissive,'roles',coalesce((select jsonb_agg(rolname order by rolname) from pg_roles where oid=any(polroles)),'["public"]'::jsonb),'using',pg_get_expr(polqual,polrelid),'check',pg_get_expr(polwithcheck,polrelid)) order by polname) from pg_policy where polrelid='storage.objects'::regclass and (polname like 'chat_private_%' or polname like 'platinum_%')),
 'triggers',(select jsonb_agg(jsonb_build_object('name',tgname,'table',tgrelid::regclass::text,'definition',pg_get_triggerdef(oid),'enabled',tgenabled) order by tgrelid::regclass::text,tgname) from pg_trigger where not tgisinternal and tgname in('channel_private_reference_guard','group_private_reference_guard','application_legacy_reference_guard','chat_limited_object_reuse_guard'))
) into actual;

 if actual is distinct from $qa_catalog${"counts":{"auth":1,"staff":1,"objects":15,"profiles":1},"buckets":[{"id":"chat-files","public":false},{"id":"chat-media","public":false},{"id":"media","public":false},{"id":"post-media","public":false},{"id":"story-media","public":false}],"schemas":[],"policies":[{"cmd":"*","name":"chat_private_anon_guard","check":"(bucket_id <> ALL (ARRAY['chat-media'::text, 'chat-files'::text]))","roles":["anon"],"using":"(bucket_id <> ALL (ARRAY['chat-media'::text, 'chat-files'::text]))","permissive":false},{"cmd":"d","name":"chat_private_delete_guard","check":null,"roles":["authenticated"],"using":"(bucket_id <> ALL (ARRAY['chat-media'::text, 'chat-files'::text]))","permissive":false},{"cmd":"w","name":"chat_private_immutable_guard","check":"(bucket_id <> ALL (ARRAY['chat-media'::text, 'chat-files'::text]))","roles":["authenticated"],"using":"(bucket_id <> ALL (ARRAY['chat-media'::text, 'chat-files'::text]))","permissive":false},{"cmd":"a","name":"chat_private_insert","check":"((bucket_id = ANY (ARRAY['chat-media'::text, 'chat-files'::text])) AND can_act_as((split_part(name, '/'::text, 1))::uuid))","roles":["authenticated"],"using":null,"permissive":true},{"cmd":"a","name":"chat_private_insert_guard","check":"((bucket_id <> ALL (ARRAY['chat-media'::text, 'chat-files'::text])) OR ((name ~ '^[0-9a-f-]{36}/[A-Za-z0-9_. /-]+$'::text) AND (name !~ '(^|/)[.][.]?(/|$)'::text) AND can_act_as((split_part(name, '/'::text, 1))::uuid)))","roles":["authenticated"],"using":null,"permissive":false},{"cmd":"r","name":"chat_private_read","check":null,"roles":["authenticated"],"using":"((bucket_id = ANY (ARRAY['chat-media'::text, 'chat-files'::text])) AND (can_read_chat_object(bucket_id, name) OR can_read_legacy_chat_object(bucket_id, name)))","permissive":true},{"cmd":"r","name":"chat_private_read_guard","check":null,"roles":["authenticated"],"using":"((bucket_id <> ALL (ARRAY['chat-media'::text, 'chat-files'::text])) OR can_read_chat_object(bucket_id, name) OR can_read_legacy_chat_object(bucket_id, name))","permissive":false},{"cmd":"d","name":"platinum_assets_anon_delete_guard","check":null,"roles":["anon"],"using":"(bucket_id <> ALL (ARRAY['post-media'::text, 'story-media'::text, 'media'::text, 'avatars'::text, 'market-media'::text]))","permissive":false},{"cmd":"a","name":"platinum_assets_anon_insert_guard","check":"(bucket_id <> ALL (ARRAY['post-media'::text, 'story-media'::text, 'media'::text, 'avatars'::text, 'market-media'::text]))","roles":["anon"],"using":null,"permissive":false},{"cmd":"w","name":"platinum_assets_anon_update_guard","check":"(bucket_id <> ALL (ARRAY['post-media'::text, 'story-media'::text, 'media'::text, 'avatars'::text, 'market-media'::text]))","roles":["anon"],"using":"(bucket_id <> ALL (ARRAY['post-media'::text, 'story-media'::text, 'media'::text, 'avatars'::text, 'market-media'::text]))","permissive":false},{"cmd":"a","name":"platinum_assets_insert","check":"((bucket_id = ANY (ARRAY['post-media'::text, 'story-media'::text, 'media'::text, 'avatars'::text, 'market-media'::text])) AND platinum_upload_path_allowed(bucket_id, name) AND (COALESCE(owner_id, (owner)::text) = (( SELECT auth.uid() AS uid))::text))","roles":["authenticated"],"using":null,"permissive":true},{"cmd":"a","name":"platinum_assets_insert_guard","check":"((bucket_id <> ALL (ARRAY['post-media'::text, 'story-media'::text, 'media'::text, 'avatars'::text, 'market-media'::text])) OR (platinum_upload_path_allowed(bucket_id, name) AND (COALESCE(owner_id, (owner)::text) = (( SELECT auth.uid() AS uid))::text)))","roles":["authenticated"],"using":null,"permissive":false},{"cmd":"r","name":"platinum_content_anon_read_guard","check":null,"roles":["anon"],"using":"(bucket_id <> ALL (ARRAY['post-media'::text, 'story-media'::text, 'media'::text]))","permissive":false},{"cmd":"d","name":"platinum_content_delete_guard","check":null,"roles":["authenticated"],"using":"(bucket_id <> ALL (ARRAY['post-media'::text, 'story-media'::text, 'media'::text]))","permissive":false},{"cmd":"w","name":"platinum_content_immutable_guard","check":"(bucket_id <> ALL (ARRAY['post-media'::text, 'story-media'::text, 'media'::text]))","roles":["authenticated"],"using":"(bucket_id <> ALL (ARRAY['post-media'::text, 'story-media'::text, 'media'::text]))","permissive":false},{"cmd":"r","name":"platinum_content_owner_read","check":null,"roles":["authenticated"],"using":"((bucket_id = ANY (ARRAY['post-media'::text, 'story-media'::text, 'media'::text])) AND (COALESCE(owner_id, (owner)::text) = (( SELECT auth.uid() AS uid))::text))","permissive":true},{"cmd":"r","name":"platinum_content_owner_read_guard","check":null,"roles":["authenticated"],"using":"((bucket_id <> ALL (ARRAY['post-media'::text, 'story-media'::text, 'media'::text])) OR (COALESCE(owner_id, (owner)::text) = (( SELECT auth.uid() AS uid))::text))","permissive":false},{"cmd":"d","name":"platinum_public_asset_delete","check":null,"roles":["authenticated"],"using":"((bucket_id = ANY (ARRAY['avatars'::text, 'market-media'::text])) AND (COALESCE(owner_id, (owner)::text) = (( SELECT auth.uid() AS uid))::text))","permissive":true},{"cmd":"d","name":"platinum_public_asset_delete_guard","check":null,"roles":["authenticated"],"using":"((bucket_id <> ALL (ARRAY['avatars'::text, 'market-media'::text])) OR (COALESCE(owner_id, (owner)::text) = (( SELECT auth.uid() AS uid))::text))","permissive":false},{"cmd":"r","name":"platinum_public_asset_read","check":null,"roles":["anon","authenticated"],"using":"(bucket_id = ANY (ARRAY['avatars'::text, 'market-media'::text]))","permissive":true},{"cmd":"w","name":"platinum_public_asset_update","check":"((bucket_id = ANY (ARRAY['avatars'::text, 'market-media'::text])) AND (COALESCE(owner_id, (owner)::text) = (( SELECT auth.uid() AS uid))::text) AND platinum_upload_path_allowed(bucket_id, name))","roles":["authenticated"],"using":"((bucket_id = ANY (ARRAY['avatars'::text, 'market-media'::text])) AND (COALESCE(owner_id, (owner)::text) = (( SELECT auth.uid() AS uid))::text))","permissive":true},{"cmd":"w","name":"platinum_public_asset_update_guard","check":"((bucket_id <> ALL (ARRAY['avatars'::text, 'market-media'::text])) OR ((COALESCE(owner_id, (owner)::text) = (( SELECT auth.uid() AS uid))::text) AND platinum_upload_path_allowed(bucket_id, name)))","roles":["authenticated"],"using":"((bucket_id <> ALL (ARRAY['avatars'::text, 'market-media'::text])) OR (COALESCE(owner_id, (owner)::text) = (( SELECT auth.uid() AS uid))::text))","permissive":false}],"triggers":[{"name":"channel_private_reference_guard","table":"channel_messages","enabled":"O","definition":"CREATE TRIGGER channel_private_reference_guard BEFORE INSERT OR UPDATE OF media_url ON public.channel_messages FOR EACH ROW EXECUTE FUNCTION guard_legacy_chat_reference()"},{"name":"group_private_reference_guard","table":"conversations","enabled":"O","definition":"CREATE TRIGGER group_private_reference_guard BEFORE INSERT OR UPDATE OF group_avatar_url ON public.conversations FOR EACH ROW EXECUTE FUNCTION guard_legacy_chat_reference()"},{"name":"application_legacy_reference_guard","table":"job_applications","enabled":"O","definition":"CREATE TRIGGER application_legacy_reference_guard BEFORE INSERT OR UPDATE OF cv_url ON public.job_applications FOR EACH ROW EXECUTE FUNCTION guard_legacy_chat_reference()"}],"functions":[{"acl":"{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}","md5":"64693d475835ba5fbe227d683f9651ac","signature":"can_read_legacy_chat_object(text,text)","definition":"CREATE OR REPLACE FUNCTION public.can_read_legacy_chat_object(p_bucket text, p_name text)\n RETURNS boolean\n LANGUAGE sql\n STABLE SECURITY DEFINER\n SET search_path TO 'public', 'pg_temp'\nAS $function$\n SELECT auth.uid() IS NOT NULL AND (\n  (p_bucket='chat-media' AND EXISTS (\n    SELECT 1 FROM public.channel_messages m WHERE public.chat_object_path(m.media_url)=p_bucket||'/'||p_name\n      AND split_part(p_name,'/',1)=m.sender_id::text AND public.social_can_read_channel(m.channel_id)))\n  OR (p_bucket='chat-media' AND EXISTS (\n    SELECT 1 FROM public.conversations c WHERE c.is_group AND public.chat_object_path(c.group_avatar_url)=p_bucket||'/'||p_name\n      AND public.can_access_chat_conversation(c.id)))\n  OR (p_bucket='chat-files' AND EXISTS (\n    SELECT 1 FROM public.job_applications a JOIN public.jobs j ON j.id=a.job_id\n    WHERE public.chat_object_path(a.cv_url)=p_bucket||'/'||p_name AND split_part(p_name,'/',1)=a.applicant_id::text\n      AND (a.applicant_id=auth.uid() OR (j.posted_by=auth.uid() AND public.studio_role() IN ('owner','admin','recruiter')))))\n );\n$function$\n"},{"acl":"{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}","md5":"0f59e65db37bb54e784787e278bc4306","signature":"chat_media_manifest(uuid[])","definition":"CREATE OR REPLACE FUNCTION public.chat_media_manifest(p_message_ids uuid[])\n RETURNS TABLE(id uuid, media_url text, thumbnail_url text, view_limit smallint)\n LANGUAGE sql\n STABLE SECURITY DEFINER\n SET search_path TO 'public', 'pg_temp'\nAS $function$\n SELECT m.id, CASE WHEN public.chat_object_path(m.media_url) IS NOT NULL THEN m.media_url END, CASE WHEN public.chat_object_path(m.thumbnail_url) IS NOT NULL THEN m.thumbnail_url END, m.view_limit FROM public.messages m\n WHERE cardinality(p_message_ids) BETWEEN 1 AND 100 AND m.id = ANY(p_message_ids)\n   AND m.deleted_at IS NULL AND public.can_access_chat_conversation(m.conversation_id)\n   AND (m.media_access_verified OR (\n     (public.chat_object_path(m.media_url) IS NULL OR split_part(public.chat_object_path(m.media_url), '/', 2) = m.sender_id::text)\n     AND (public.chat_object_path(m.thumbnail_url) IS NULL OR split_part(public.chat_object_path(m.thumbnail_url), '/', 2) = m.sender_id::text)))\n   AND (public.chat_object_path(m.media_url) IS NOT NULL OR public.chat_object_path(m.thumbnail_url) IS NOT NULL);\n$function$\n"},{"acl":"{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}","md5":"c47a9441784d6c13fd2f3b1d0363837b","signature":"claim_chat_media_view(uuid,uuid)","definition":"CREATE OR REPLACE FUNCTION public.claim_chat_media_view(p_message_id uuid, p_request_id uuid)\n RETURNS TABLE(url text, remaining integer)\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO 'public', 'pg_temp'\nAS $function$\nDECLARE m public.messages%ROWTYPE; g public.chat_media_view_grants%ROWTYPE; v integer;\nBEGIN\n IF auth.uid() IS NULL OR p_request_id IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;\n -- Serialize grants for this message; no two devices can consume the last view.\n SELECT * INTO m FROM public.messages WHERE id = p_message_id FOR UPDATE;\n IF m.id IS NULL OR m.deleted_at IS NOT NULL OR m.view_limit IS NULL OR public.can_act_as(m.sender_id)\n   OR NOT public.can_access_chat_conversation(m.conversation_id)\n   OR public.chat_object_path(m.media_url) IS NULL\n   OR split_part(public.chat_object_path(m.media_url), '/', 2) <> m.sender_id::text THEN\n   RETURN QUERY SELECT NULL::text, 0; RETURN;\n END IF;\n SELECT * INTO g FROM public.chat_media_view_grants WHERE user_id = auth.uid() AND request_id = p_request_id;\n IF FOUND THEN\n   IF g.message_id = p_message_id AND g.expires_at > now() THEN RETURN QUERY SELECT m.media_url, g.remaining;\n   ELSE RETURN QUERY SELECT NULL::text, 0; END IF;\n   RETURN;\n END IF;\n INSERT INTO public.message_views(message_id,user_id,views,first_viewed_at)\n VALUES(m.id,auth.uid(),0,now()) ON CONFLICT DO NOTHING;\n SELECT views INTO v FROM public.message_views WHERE message_id=m.id AND user_id=auth.uid() FOR UPDATE;\n IF v >= m.view_limit THEN RETURN QUERY SELECT NULL::text,0; RETURN; END IF;\n UPDATE public.message_views SET views=views+1, first_viewed_at=coalesce(first_viewed_at,now()) WHERE message_id=m.id AND user_id=auth.uid();\n INSERT INTO public.chat_media_view_grants(request_id,user_id,message_id,remaining) VALUES(p_request_id,auth.uid(),m.id,m.view_limit-v-1);\n RETURN QUERY SELECT m.media_url, m.view_limit-v-1;\nEND;\n$function$\n"},{"acl":"{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}","md5":"8e3e17e74717f3454b5c0deef3f62566","signature":"consume_media_view(uuid)","definition":"CREATE OR REPLACE FUNCTION public.consume_media_view(p_message_id uuid)\n RETURNS TABLE(url text, remaining integer)\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO ''\nAS $function$\nBEGIN\n  IF to_regnamespace('private_media') IS NOT NULL THEN\n    RAISE EXCEPTION 'Update Platinum Circles to open limited-view attachments'\n      USING ERRCODE = '42501';\n  END IF;\n\n  -- Installed clients retain their original TABLE(url, remaining) response.\n  -- Each legacy call is one consumption, using the same serialized counters as\n  -- modern idempotent requests; this does not bypass or reset a view limit.\n  RETURN QUERY\n    SELECT c.url, c.remaining\n      FROM public.claim_chat_media_view(p_message_id, gen_random_uuid()) c;\nEND;\n$function$\n"},{"acl":"{postgres=X/postgres,service_role=X/postgres}","md5":"70773b480e9de2bd9857ad42c04146f9","signature":"content_media_document(text,uuid)","definition":"CREATE OR REPLACE FUNCTION public.content_media_document(p_kind text, p_id uuid)\n RETURNS jsonb\n LANGUAGE plpgsql\n STABLE SECURITY DEFINER\n SET search_path TO ''\nAS $function$\ndeclare v_document jsonb; v_article public.articles; v_blocks jsonb;\nbegin\n  if p_kind = 'post' then\n    select jsonb_build_object('media_url', p.media_url, 'image_url', p.image_url,\n      'media', coalesce((select jsonb_agg(jsonb_build_object('url', m.url, 'edit', m.edit)) from public.post_media m where m.post_id = p.id), '[]'::jsonb),\n      'products', coalesce((select jsonb_agg(jsonb_build_object('image_url', pp.image_url)) from public.post_products pp where pp.post_id = p.id), '[]'::jsonb))\n      into v_document from public.posts p where p.id = p_id;\n    select * into v_article from public.articles a where a.linked_post_id = p_id limit 1;\n    if found then\n      select coalesce(jsonb_agg(b.content), '[]'::jsonb) into v_blocks from public.article_blocks b where b.revision_id = v_article.current_revision_id;\n      v_document := v_document || jsonb_build_object('article', v_blocks, 'assets', (\n        select coalesce(jsonb_agg(jsonb_build_object('url', a.url, 'thumbnail_url', a.thumbnail_url)), '[]'::jsonb)\n        from public.media_assets a where a.id = v_article.cover_asset_id or a.id::text in (select public.content_media_strings(v_blocks))\n      ));\n    end if;\n  elsif p_kind = 'story' then\n    select jsonb_build_object('media_url', s.media_url, 'thumbnail_url', s.thumbnail_url, 'dual_front_url', s.dual_front_url,\n      'audio_url', s.audio_url, 'media_transform', s.media_transform,\n      'stickers', coalesce((select jsonb_agg(jsonb_build_object('photoUrl', sticker->>'photoUrl'))\n        from jsonb_array_elements(case when jsonb_typeof(s.stickers_json) = 'array' then s.stickers_json else '[]'::jsonb end) sticker), '[]'::jsonb))\n      into v_document from public.stories s where s.id = p_id;\n    -- postMediaUrl/entityImage are deliberately excluded. Their source content\n    -- needs its own current authorization; a public outer story is insufficient.\n  elsif p_kind = 'story_draft' then\n    select jsonb_build_object('media_url', d.media_url, 'media_transform', d.media_transform,\n      'stickers', coalesce((select jsonb_agg(jsonb_build_object('photoUrl', sticker->>'photoUrl'))\n        from jsonb_array_elements(case when jsonb_typeof(d.stickers_json) = 'array' then d.stickers_json else '[]'::jsonb end) sticker), '[]'::jsonb))\n      into v_document from public.story_drafts d where d.id = p_id;\n  elsif p_kind = 'memory_album' then\n    select jsonb_agg(jsonb_build_object('story', public.content_media_document('story', s.id), 'media_url', mp.media_url, 'thumbnail_url', mp.thumbnail_url))\n      into v_document from public.memory_albums a join public.memory_pages mp on mp.album_id=a.id\n      join public.stories s on s.id=mp.story_id and s.user_id=a.user_id where a.id=p_id;\n  elsif p_kind = 'highlight' then\n    select jsonb_build_object('cover_url', h.cover_url, 'stories', (\n      select jsonb_agg(public.content_media_document('story', s.id)) from public.story_highlight_items hi\n      join public.stories s on s.id=hi.story_id and s.user_id=h.user_id\n      where hi.highlight_id=h.id and public.content_story_audience_visible(s.id)\n    )) into v_document from public.story_highlights h where h.id=p_id;\n  elsif p_kind = 'sound' then\n    select jsonb_build_object('url', s.url) into v_document from public.story_sounds s where s.id = p_id;\n  end if;\n  return coalesce(v_document, '{}'::jsonb);\nend $function$\n"},{"acl":"{postgres=X/postgres}","md5":"c7dfc27056fafc6a902d629222a1eeb8","signature":"content_media_legacy.allows_read(text,uuid,uuid,text,text,text)","definition":"CREATE OR REPLACE FUNCTION content_media_legacy.allows_read(requested_kind text, requested_id uuid, expected_author uuid, current_url text, current_bucket text, current_path text)\n RETURNS boolean\n LANGUAGE sql\n STABLE SECURITY DEFINER\n SET search_path TO ''\nAS $function$\n  SELECT auth.uid() IS NOT NULL\n    AND NOT coalesce((auth.jwt()->>'is_anonymous')::boolean, false)\n    AND EXISTS (\n      SELECT 1\n      FROM content_media_legacy.snapshots l\n      JOIN storage.objects o ON o.id = l.object_id\n        AND o.bucket_id = l.bucket_id AND o.name = l.object_path\n        AND o.version = l.object_version\n        AND (coalesce(o.owner_id, o.owner::text) IS NULL\n          OR coalesce(o.owner_id, o.owner::text) = l.author_id::text)\n      JOIN storage.buckets b ON b.id = o.bucket_id AND b.public\n      WHERE l.revoked_at IS NULL\n        AND l.author_id = expected_author\n        AND l.bucket_id = current_bucket AND l.object_path = current_path\n        AND l.canonical_url = current_url\n        AND (\n          (l.entity_kind = 'post' AND EXISTS (\n            SELECT 1 FROM public.posts p WHERE p.id = l.entity_id\n              AND p.user_id = l.author_id AND p.created_at = l.publication_created_at\n          )) OR\n          (l.entity_kind = 'story' AND EXISTS (\n            SELECT 1 FROM public.stories s WHERE s.id = l.entity_id\n              AND s.user_id = l.author_id AND s.created_at = l.publication_created_at\n          ))\n        )\n        AND EXISTS (\n          SELECT 1 FROM public.content_media_strings(\n            public.content_media_document(l.entity_kind, l.entity_id)\n          ) AS live_url WHERE live_url = l.canonical_url\n        )\n        AND (\n          (requested_kind = l.entity_kind AND requested_id = l.entity_id)\n          OR (requested_kind = 'memory_album' AND l.entity_kind = 'story'\n            AND public.can_view_memory_book(requested_id)\n            AND EXISTS (\n              SELECT 1 FROM public.memory_pages mp\n              JOIN public.memory_albums a ON a.id = mp.album_id\n              WHERE mp.album_id = requested_id AND mp.story_id = l.entity_id\n                AND mp.user_id = l.author_id AND a.user_id = l.author_id\n            ))\n          OR (requested_kind = 'highlight' AND l.entity_kind = 'story'\n            AND public.content_story_audience_visible(l.entity_id)\n            AND EXISTS (\n              SELECT 1 FROM public.story_highlight_items hi\n              JOIN public.story_highlights h ON h.id = hi.highlight_id\n              WHERE hi.highlight_id = requested_id AND hi.story_id = l.entity_id\n                AND h.user_id = l.author_id\n            ))\n        )\n    );\n$function$\n"},{"acl":"{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}","md5":"47b5dff186018f351aa0e188d1e805d2","signature":"content_media_manifest(jsonb)","definition":"CREATE OR REPLACE FUNCTION public.content_media_manifest(p_references jsonb)\n RETURNS TABLE(entity_kind text, entity_id uuid, media_url text)\n LANGUAGE plpgsql\n STABLE SECURITY DEFINER\n SET search_path TO ''\nAS $function$\ndeclare r record; use_kind text;\nbegin\n for r in select * from public.content_media_manifest_before_sound_rights(p_references) loop\n  use_kind:=case r.entity_kind when 'post' then 'post' when 'memory_album' then 'memory_album' else 'story' end;\n  if exists(select 1 from public.story_sounds s where s.url=r.media_url and not (\n   public.sound_rights_allow(s.id,use_kind) or (r.entity_kind='sound' and (public.sound_rights_allow(s.id,'post') or public.sound_rights_allow(s.id,'memory_album')))\n  )) then continue; end if;\n  entity_kind:=r.entity_kind;entity_id:=r.entity_id;media_url:=r.media_url;return next;\n end loop;\nend $function$\n"},{"acl":"{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}","md5":"2216cc828cb339debeeed40865d72d78","signature":"delete_user_account(uuid)","definition":"CREATE OR REPLACE FUNCTION public.delete_user_account(p_user_id uuid)\n RETURNS void\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO 'public'\nAS $function$\r\nbegin\r\n  if p_user_id is distinct from auth.uid()\r\n     and coalesce(auth.jwt()->>'role','') <> 'service_role' then\r\n    raise exception 'You can only delete your own account';\r\n  end if;\r\n  delete from message_deletions where user_id = p_user_id;\r\n  delete from saved_messages where user_id = p_user_id;\r\n  delete from starred_messages where starred_by = p_user_id;\r\n  delete from message_reactions where user_id = p_user_id;\r\n  delete from message_reads where user_id = p_user_id;\r\n  delete from messages where sender_id = p_user_id;\r\n  delete from conversation_typing where user_id = p_user_id;\r\n  delete from conversation_settings where user_id = p_user_id;\r\n  delete from conversation_members where user_id = p_user_id;\r\n  delete from chat_payments where sender_id = p_user_id or recipient_id = p_user_id;\r\n  delete from call_participants where user_id = p_user_id;\r\n  delete from story_views where user_id = p_user_id;\r\n  delete from story_reactions where user_id = p_user_id;\r\n  delete from stories where user_id = p_user_id;\r\n  delete from post_seen where user_id = p_user_id;\r\n  delete from post_bookmarks where user_id = p_user_id;\r\n  delete from post_reposts where user_id = p_user_id;\r\n  delete from post_likes where user_id = p_user_id;\r\n  delete from comment_reactions where user_id = p_user_id;\r\n  delete from post_comments where user_id = p_user_id;\r\n  delete from post_products where post_id in (select id from posts where user_id = p_user_id);\r\n  delete from posts where user_id = p_user_id;\r\n  -- offers made by the person, and offers on the person's own listings\r\n  delete from listing_offers where proposer_id = p_user_id;\r\n  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'listing_offers' and column_name = 'listing_id') then\r\n    execute 'delete from listing_offers where listing_id in (select id from marketplace_listings where seller_id = $1)' using p_user_id;\r\n  end if;\r\n  delete from marketplace_listings where seller_id = p_user_id;\r\n  delete from saved_listings where user_id = p_user_id;\r\n  delete from seller_reviews where seller_id = p_user_id or reviewer_id = p_user_id;\r\n  -- jobs the person posted, applications they sent, and applications to their jobs\r\n  delete from job_saves where user_id = p_user_id or job_id in (select id from jobs where posted_by = p_user_id);\r\n  delete from job_applications where applicant_id = p_user_id or job_id in (select id from jobs where posted_by = p_user_id);\r\n  delete from jobs where posted_by = p_user_id;\r\n  delete from follows where follower_id = p_user_id or following_id = p_user_id;\r\n  delete from follow_requests where requester_id = p_user_id or target_id = p_user_id;\r\n  delete from close_friends where owner_id = p_user_id or friend_id = p_user_id;\r\n  delete from blocked_users where blocker_id = p_user_id or blocked_id = p_user_id;\r\n  delete from user_reports where reporter_id = p_user_id or reported_id = p_user_id;\r\n  delete from notifications where recipient_id = p_user_id;\r\n  delete from club_members where user_id = p_user_id;\r\n  delete from community_members where user_id = p_user_id;\r\n  delete from business_members where member_id = p_user_id or business_id = p_user_id;\r\n  delete from business_reviews where user_id = p_user_id;\r\n  delete from business_posts where owner_id = p_user_id;\r\n  delete from business_profiles where owner_id = p_user_id or profile_id = p_user_id;\r\n  delete from support_tickets where user_id = p_user_id;\r\n  delete from user_app_settings where user_id = p_user_id;\r\n  delete from user_presence where user_id = p_user_id;\r\n  delete from user_push_tokens where user_id = p_user_id;\r\n  delete from profiles where id = p_user_id;\r\n  delete from auth.users where id = p_user_id;\r\nend;\r\n$function$\n"},{"acl":"{postgres=X/postgres,service_role=X/postgres}","md5":"3b5ec08cd4d8b08a09a3e1960a7d336c","signature":"guard_legacy_chat_reference()","definition":"CREATE OR REPLACE FUNCTION public.guard_legacy_chat_reference()\n RETURNS trigger\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO 'public', 'pg_temp'\nAS $function$\nDECLARE value text; old_value text; loc text; bucket text; object_name text;\nBEGIN\n IF TG_TABLE_NAME='channel_messages' THEN\n  value:=NEW.media_url;\n  IF TG_OP='UPDATE' THEN old_value:=OLD.media_url; END IF;\n ELSIF TG_TABLE_NAME='conversations' THEN\n  value:=NEW.group_avatar_url;\n  IF TG_OP='UPDATE' THEN old_value:=OLD.group_avatar_url; END IF;\n ELSE\n  value:=NEW.cv_url;\n  IF TG_OP='UPDATE' THEN old_value:=OLD.cv_url; END IF;\n END IF;\n IF value IS NULL OR (TG_OP='UPDATE' AND value IS NOT DISTINCT FROM old_value) THEN RETURN NEW; END IF;\n loc:=public.chat_object_path(value);\n IF TG_TABLE_NAME='channel_messages' AND value ~ '/storage/v1/object/public/channel-media/' THEN\n   IF value !~ '^https://[^/?#]+/storage/v1/object/public/channel-media/[0-9a-f-]{36}/[0-9a-f-]{36}/[A-Za-z0-9_.-]+$' THEN RAISE EXCEPTION 'Invalid channel attachment'; END IF;\n   bucket:='channel-media'; object_name:=substring(value FROM '/storage/v1/object/public/channel-media/(.*)$');\n   IF split_part(object_name,'/',1)<>NEW.channel_id::text OR split_part(object_name,'/',2)<>NEW.sender_id::text OR NOT public.can_act_as(NEW.sender_id) THEN\n     RAISE EXCEPTION 'Channel attachment must belong to this channel and author' USING ERRCODE='42501';\n   END IF;\n ELSIF loc IS NOT NULL THEN\n   bucket:=split_part(loc,'/',1); object_name:=substring(loc FROM position('/' IN loc)+1);\n   IF TG_TABLE_NAME='channel_messages' THEN\n     IF bucket<>'chat-media' OR split_part(object_name,'/',1)<>NEW.sender_id::text OR NOT public.can_act_as(NEW.sender_id) THEN RAISE EXCEPTION 'Invalid channel attachment owner' USING ERRCODE='42501'; END IF;\n   ELSIF TG_TABLE_NAME='job_applications' THEN\n     IF bucket<>'chat-files' OR split_part(object_name,'/',1)<>NEW.applicant_id::text OR NOT public.can_act_as(NEW.applicant_id) THEN RAISE EXCEPTION 'Invalid CV attachment owner' USING ERRCODE='42501'; END IF;\n   ELSIF bucket<>'chat-media' OR NOT public.can_act_as(split_part(object_name,'/',1)::uuid) THEN\n     RAISE EXCEPTION 'Group photo must belong to the editor' USING ERRCODE='42501';\n   END IF;\n ELSIF value ~ '/storage/v1/object/(public/|sign/|authenticated/)?(chat-media|chat-files|channel-media)/' THEN\n   RAISE EXCEPTION 'Invalid private attachment locator' USING ERRCODE='42501';\n ELSE RETURN NEW;\n END IF;\n IF NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id=bucket AND o.name=object_name) THEN\n   RAISE EXCEPTION 'Upload the attachment before sharing it' USING ERRCODE='42501';\n END IF;\n RETURN NEW;\nEND;\n$function$\n"},{"acl":"{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}","md5":"7e77610be112c7b1e69dcb2db082758e","signature":"open_legacy_chat_media(uuid,uuid)","definition":"CREATE OR REPLACE FUNCTION public.open_legacy_chat_media(p_message_id uuid, p_request_id uuid)\n RETURNS jsonb\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO ''\nAS $function$\nDECLARE\n  viewer uuid := auth.uid();\n  attachment_type text;\n  claimed_url text;\n  claimed_remaining integer;\n  grant_row public.chat_media_view_grants%ROWTYPE;\nBEGIN\n  IF to_regnamespace('private_media') IS NOT NULL\n     OR viewer IS NULL\n     OR p_message_id IS NULL\n     OR p_request_id IS NULL THEN\n    RETURN NULL;\n  END IF;\n\n  -- Reject unsupported attachments before consuming a view. This row lock is\n  -- also held by claim_chat_media_view and prevents a delete racing the result.\n  SELECT m.media_type\n    INTO attachment_type\n    FROM public.messages m\n   WHERE m.id = p_message_id\n     AND m.deleted_at IS NULL\n   FOR UPDATE;\n\n  IF attachment_type IS NULL OR attachment_type NOT IN ('image', 'video') THEN\n    RETURN NULL;\n  END IF;\n\n  -- This existing RPC owns conversation authorization, uploader binding,\n  -- sender exclusion, request idempotency, and the shared message_views count.\n  SELECT c.url, c.remaining\n    INTO claimed_url, claimed_remaining\n    FROM public.claim_chat_media_view(p_message_id, p_request_id) c;\n\n  IF claimed_url IS NULL THEN\n    RETURN NULL;\n  END IF;\n\n  SELECT g.*\n    INTO grant_row\n    FROM public.chat_media_view_grants g\n   WHERE g.user_id = viewer\n     AND g.request_id = p_request_id\n     AND g.message_id = p_message_id\n     AND g.remaining = claimed_remaining\n     AND g.expires_at > clock_timestamp();\n\n  IF NOT FOUND THEN\n    RETURN NULL;\n  END IF;\n\n  -- Return the original grant deadline: retrying must never renew a capability.\n  -- The Edge signer authenticates again, matches the authorized manifest, and\n  -- signs only the seconds still remaining before this timestamp.\n  RETURN jsonb_build_object(\n    'url', claimed_url,\n    'remaining', grant_row.remaining,\n    'expiresAt', grant_row.expires_at,\n    'mediaType', attachment_type,\n    'requestId', grant_row.request_id\n  );\nEND;\n$function$\n"},{"acl":"{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}","md5":"2b8d2ac5f6935d98566bfa299b5509ff","signature":"platinum_upload_path_allowed(text,text)","definition":"CREATE OR REPLACE FUNCTION public.platinum_upload_path_allowed(p_bucket text, p_name text)\n RETURNS boolean\n LANGUAGE plpgsql\n STABLE\n SET search_path TO ''\nAS $function$\ndeclare actor text;\nbegin\n if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then return false; end if;\n if p_bucket not in ('post-media','story-media','media','avatars','market-media') then return false; end if;\n if p_name is null or length(p_name)>1024 or p_name !~ '^[A-Za-z0-9_. /-]+$'\n   or p_name ~ '(^|/)\\.\\.?(/|$)|//' then return false; end if;\n actor:=case when p_bucket='market-media' and split_part(p_name,'/',1)='listings'\n   then split_part(p_name,'/',2) else split_part(p_name,'/',1) end;\n if actor !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'\n   or position('/' in p_name)=0 then return false; end if;\n return public.can_act_as(actor::uuid);\nend $function$\n"}]}$qa_catalog$::jsonb then raise exception 'QA_MEDIA_BASELINE_CHANGED';end if;
end $qa_preflight$;
drop trigger channel_private_reference_guard on public.channel_messages;
drop trigger group_private_reference_guard on public.conversations;
drop trigger application_legacy_reference_guard on public.job_applications;
drop policy chat_private_anon_guard on storage.objects;
drop policy chat_private_delete_guard on storage.objects;
drop policy chat_private_immutable_guard on storage.objects;
drop policy chat_private_insert on storage.objects;
drop policy chat_private_insert_guard on storage.objects;
drop policy chat_private_read on storage.objects;
drop policy chat_private_read_guard on storage.objects;

-- Reviewed candidate 20261029224813_private_media_cutover_compatibility; SHA-256 e95b6958699507679692dc59106cebafbb6001b25048bcd32ca1d50928e8e5d8
-- Compatibility and restrictive object policies only. This migration does not
-- change bucket visibility. Activate with the separately reviewed cutover tool
-- after both client generations, CDN behavior and synthetic HTTP tests pass.

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


-- Reviewed candidate 20261029231440_bounded_media_delivery; SHA-256 44c6f9d4cbcf858fdbc6a4c50a27bbc5f871347e8dfc45dc97825f52e9e82982
-- New clients request noncached delivery explicitly. Existing signed-URL
-- clients remain compatible until the reviewed minimum-client cutover.

set local lock_timeout='3s';
create schema media_delivery;
revoke all on schema media_delivery from public,anon,authenticated,service_role;
create table media_delivery.tickets (
 token_digest bytea primary key check(octet_length(token_digest)=32),
 user_id uuid not null references auth.users(id) on delete cascade,
 session_id uuid not null references auth.sessions(id) on delete cascade,
 object_id uuid not null,
 object_version text not null,
 object_owner text,
 bucket_id text not null,
 object_path text not null,
 source_kind text not null check(source_kind in ('post','story','sound','story_draft','memory_album','highlight','upload','chat','chat_object')),
 source_id uuid,
 source_url text not null,
 expires_at timestamptz not null,
 created_at timestamptz not null default clock_timestamp()
);
create index media_delivery_ticket_expiry on media_delivery.tickets(expires_at);
create index media_delivery_ticket_session on media_delivery.tickets(session_id);
alter table media_delivery.tickets enable row level security;
revoke all on media_delivery.tickets from public,anon,authenticated,service_role;

create function media_delivery.require_session() returns uuid
language plpgsql stable security definer set search_path='' as $$
declare session_id uuid;
begin
 if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'MEDIA_SESSION_REQUIRED' using errcode='42501'; end if;
 begin session_id:=(auth.jwt()->>'session_id')::uuid;exception when others then session_id:=null;end;
 if not exists(select 1 from auth.sessions s join auth.users u on u.id=s.user_id where s.id=session_id
  and s.user_id=auth.uid() and (s.not_after is null or s.not_after>clock_timestamp()) and u.deleted_at is null
  and (u.banned_until is null or u.banned_until<=clock_timestamp())) then raise exception 'MEDIA_SESSION_REQUIRED' using errcode='42501'; end if;
 return session_id;
end $$;
revoke all on function media_delivery.require_session() from public,anon,authenticated,service_role;

-- A stale binding must never authorize a newly replaced object owned by a
-- different account. Legacy snapshots remain read provenance, not ownership.
create function media_delivery.content_provenance(p_kind text,p_id uuid,p_url text,p_bucket text,p_path text,p_owner text) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare author_id uuid;
begin
 if p_kind='post' then select user_id into author_id from public.posts where id=p_id;
 elsif p_kind='story' then select user_id into author_id from public.stories where id=p_id;
 elsif p_kind='story_draft' then select user_id into author_id from public.story_drafts where id=p_id;
 elsif p_kind='sound' then select owner_id into author_id from public.story_sounds where id=p_id;
 elsif p_kind='memory_album' then select user_id into author_id from public.memory_albums where id=p_id;
 elsif p_kind='highlight' then select user_id into author_id from public.story_highlights where id=p_id;
 end if;
 if author_id is null then return false;end if;
 return exists(select 1 from public.content_media_bindings b where b.entity_kind=p_kind and b.entity_id=p_id
   and b.bucket_id=p_bucket and b.object_path=p_path and b.uploader_id::text=p_owner)
  or (p_kind='memory_album' and exists(select 1 from public.memory_pages mp
   join public.stories st on st.id=mp.story_id and st.user_id=author_id
   join public.content_media_bindings b on b.entity_kind='story' and b.entity_id=st.id
   where mp.album_id=p_id and b.bucket_id=p_bucket and b.object_path=p_path and b.uploader_id::text=p_owner))
  or (p_kind='highlight' and (
   exists(select 1 from public.story_highlights h where h.id=p_id and h.cover_url=p_url and h.user_id::text=p_owner)
   or exists(select 1 from public.story_highlight_items hi
    join public.stories st on st.id=hi.story_id and st.user_id=author_id
    join public.content_media_bindings b on b.entity_kind='story' and b.entity_id=st.id
    where hi.highlight_id=p_id and b.bucket_id=p_bucket and b.object_path=p_path and b.uploader_id::text=p_owner)))
  or content_media_legacy.allows_read(p_kind,p_id,author_id,p_url,p_bucket,p_path);
end $$;
revoke all on function media_delivery.content_provenance(text,uuid,text,text,text,text) from public,anon,authenticated,service_role;

create function media_delivery.issue(p_url text,p_kind text,p_id uuid,p_session uuid)
returns table(bucket_id text,object_path text,token text,expires_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare loc text[];o storage.objects%rowtype; capability text; deadline timestamptz:=clock_timestamp()+interval '5 minutes';
begin
 loc:=regexp_match(p_url,'^https://[^/]+/storage/v1/object/public/(post-media|story-media|media|chat-media|chat-files)/([^?#]+)(?:[?]t=[0-9]+)?$');
 if loc is null or loc[2] ~ '(%|\\|(^|/)\.\.?(/|$)|//)' or length(loc[2])>1024 then return;end if;
 select * into o from storage.objects s where s.bucket_id=loc[1] and s.name=loc[2] and s.version is not null;
 if not found then return;end if;
 if p_kind not in ('upload','chat','chat_object') and not media_delivery.content_provenance(p_kind,p_id,p_url,o.bucket_id,o.name,coalesce(o.owner_id,o.owner::text)) then return;end if;
 capability:=encode(extensions.gen_random_bytes(32),'hex');
 insert into media_delivery.tickets(token_digest,user_id,session_id,object_id,object_version,object_owner,bucket_id,object_path,source_kind,source_id,source_url,expires_at)
 values(extensions.digest(capability,'sha256'),auth.uid(),p_session,o.id,o.version,coalesce(o.owner_id,o.owner::text),o.bucket_id,o.name,p_kind,p_id,p_url,deadline);
 return query select o.bucket_id,o.name,capability,deadline;
end $$;
revoke all on function media_delivery.issue(text,text,uuid,uuid) from public,anon,authenticated,service_role;

create function public.issue_content_media_delivery(p_references jsonb default null,p_uploads jsonb default null)
returns table(bucket_id text,object_path text,token text,expires_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare sid uuid:=media_delivery.require_session();r record;counted integer:=0;
begin
 if (p_references is null)=(p_uploads is null) then raise exception 'Choose content or upload references';end if;
 delete from media_delivery.tickets where tickets.expires_at<clock_timestamp()-interval '5 minutes';
 if p_references is not null then
  for r in select * from public.content_media_manifest(p_references) loop
   counted:=counted+1;if counted>2000 then raise exception 'Too many media references';end if;
   return query select * from media_delivery.issue(r.media_url,r.entity_kind,r.entity_id,sid);
  end loop;
 else
  if jsonb_typeof(p_uploads) is distinct from 'array' or jsonb_array_length(p_uploads) not between 1 and 100 then raise exception 'At most 100 upload references';end if;
  for r in select * from public.content_upload_manifest(p_uploads) loop
   return query select * from media_delivery.issue(r.media_url,'upload',null,sid);
  end loop;
 end if;
end $$;
revoke all on function public.issue_content_media_delivery(jsonb,jsonb) from public,anon,service_role;
grant execute on function public.issue_content_media_delivery(jsonb,jsonb) to authenticated;

create function public.issue_chat_media_delivery(p_message_ids uuid[])
returns table(message_id uuid,media_url text,bucket_id text,object_path text,token text,expires_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare sid uuid:=media_delivery.require_session();r record;u text;
begin
 delete from media_delivery.tickets where tickets.expires_at<clock_timestamp()-interval '5 minutes';
 for r in select * from public.chat_media_manifest(p_message_ids) where view_limit is null loop
  for u in select distinct x from unnest(array[r.media_url,r.thumbnail_url]) x where x is not null loop
   return query select r.id,u,t.* from media_delivery.issue(u,'chat',r.id,sid) t;
  end loop;
 end loop;
end $$;
revoke all on function public.issue_chat_media_delivery(uuid[]) from public,anon,service_role;
grant execute on function public.issue_chat_media_delivery(uuid[]) to authenticated;

create function public.issue_chat_object_delivery(p_urls text[])
returns table(bucket_id text,object_path text,token text,expires_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare sid uuid:=media_delivery.require_session();u text;loc text; b text;p text;
begin
 if cardinality(p_urls) not between 1 and 100 then raise exception 'At most 100 references';end if;
 delete from media_delivery.tickets where tickets.expires_at<clock_timestamp()-interval '5 minutes';
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

-- Only the byte proxy may redeem a ticket. Recheck the real session, current
-- object/version and original audience on every request, including range reads.
-- Claims are temporarily set to the stored, verified viewer for existing
-- authorization functions, then restored before this service RPC returns.
create function public.resolve_media_delivery(p_token text,p_bucket text,p_path text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare g media_delivery.tickets%rowtype; allowed boolean:=false;
 old_sub text:=coalesce(current_setting('request.jwt.claim.sub',true),'');
 old_role text:=coalesce(current_setting('request.jwt.claim.role',true),'');
 old_claims text:=coalesce(current_setting('request.jwt.claims',true),'');
begin
 if p_token is null or p_token !~ '^[0-9a-f]{64}$' then return null;end if;
 select * into g from media_delivery.tickets where token_digest=extensions.digest(p_token,'sha256')
  and bucket_id=p_bucket and object_path=p_path and expires_at>clock_timestamp();
 if not found or not exists(select 1 from auth.sessions s join auth.users u on u.id=s.user_id where s.id=g.session_id and s.user_id=g.user_id
  and (s.not_after is null or s.not_after>clock_timestamp()) and u.deleted_at is null and (u.banned_until is null or u.banned_until<=clock_timestamp()))
  or not exists(select 1 from storage.objects o where o.id=g.object_id and o.bucket_id=g.bucket_id and o.name=g.object_path
   and o.version=g.object_version and coalesce(o.owner_id,o.owner::text) is not distinct from g.object_owner) then return null;end if;
 perform set_config('request.jwt.claim.sub',g.user_id::text,true),set_config('request.jwt.claim.role','authenticated',true),
  set_config('request.jwt.claims',jsonb_build_object('sub',g.user_id,'role','authenticated','session_id',g.session_id,'is_anonymous',false)::text,true);
 if g.source_kind='upload' then
  select exists(select 1 from public.content_upload_manifest(jsonb_build_array(g.source_url)) m where m.media_url=g.source_url) into allowed;
 elsif g.source_kind='chat' then
  select exists(select 1 from public.chat_media_manifest(array[g.source_id]) m where m.view_limit is null and g.source_url in(m.media_url,m.thumbnail_url)) into allowed;
 elsif g.source_kind='chat_object' then
  allowed:=g.object_owner=g.user_id::text or (public.chat_locator_unrestricted(g.bucket_id||'/'||g.object_path)
   and (public.can_read_chat_object(g.bucket_id,g.object_path) or public.can_read_legacy_chat_object(g.bucket_id,g.object_path)));
 else
  select exists(select 1 from public.content_media_manifest(jsonb_build_array(jsonb_build_object('kind',g.source_kind,'id',g.source_id))) m where m.media_url=g.source_url) into allowed;
 end if;
 perform set_config('request.jwt.claim.sub',old_sub,true),set_config('request.jwt.claim.role',old_role,true),set_config('request.jwt.claims',old_claims,true);
 if not coalesce(allowed,false) then return null;end if;
 return jsonb_build_object('bucket',g.bucket_id,'path',g.object_path,'version',g.object_version,'expiresAt',g.expires_at);
exception when others then
 perform set_config('request.jwt.claim.sub',old_sub,true),set_config('request.jwt.claim.role',old_role,true),set_config('request.jwt.claims',old_claims,true);
 return null;
end $$;
revoke all on function public.resolve_media_delivery(text,text,text) from public,anon,authenticated;
grant execute on function public.resolve_media_delivery(text,text,text) to service_role;

-- The existing consume counter, request ID and deadline remain authoritative.
-- Record exact bytes and session on grant insertion; a second device, replaced
-- object, closed grant or revoked session cannot replay this private viewer.
create table media_delivery.legacy_grants (
 user_id uuid not null references auth.users(id) on delete cascade,
 request_id uuid not null,
 message_id uuid not null,
 session_id uuid not null references auth.sessions(id) on delete cascade,
 object_id uuid not null,
 object_version text not null,
 object_owner text,
 bucket_id text not null,
 object_path text not null,
 source_url text not null,
 primary key(user_id,request_id),
 foreign key(user_id,request_id) references public.chat_media_view_grants(user_id,request_id) on delete cascade
);
alter table media_delivery.legacy_grants enable row level security;
revoke all on media_delivery.legacy_grants from public,anon,authenticated,service_role;
create function media_delivery.bind_legacy_grant() returns trigger
language plpgsql security definer set search_path='' as $$
declare sid uuid:=media_delivery.require_session();m public.messages%rowtype;o storage.objects%rowtype;loc text;
begin
 if new.user_id is distinct from auth.uid() then raise exception 'MEDIA_SESSION_REQUIRED' using errcode='42501';end if;
 select * into m from public.messages where id=new.message_id and deleted_at is null and view_limit is not null;
 loc:=public.chat_object_path(m.media_url);
 if loc is null then raise exception 'MEDIA_OBJECT_UNAVAILABLE' using errcode='42501';end if;
 select * into o from storage.objects where bucket_id=split_part(loc,'/',1) and name=substring(loc from position('/' in loc)+1) and version is not null;
 if not found or (coalesce(o.owner_id,o.owner::text) is not null and coalesce(o.owner_id,o.owner::text)<>m.sender_id::text)
 then raise exception 'MEDIA_OBJECT_UNAVAILABLE' using errcode='42501';end if;
 insert into media_delivery.legacy_grants(user_id,request_id,message_id,session_id,object_id,object_version,object_owner,bucket_id,object_path,source_url)
 values(new.user_id,new.request_id,new.message_id,sid,o.id,o.version,coalesce(o.owner_id,o.owner::text),o.bucket_id,o.name,m.media_url);
 return null;
end $$;
revoke all on function media_delivery.bind_legacy_grant() from public,anon,authenticated,service_role;
create trigger bind_legacy_media_delivery after insert on public.chat_media_view_grants
 for each row execute function media_delivery.bind_legacy_grant();

create function public.read_legacy_chat_media(p_message_id uuid,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare sid uuid:=media_delivery.require_session();g public.chat_media_view_grants%rowtype;m public.messages%rowtype;bound media_delivery.legacy_grants%rowtype;
begin
 if to_regnamespace('private_media') is not null then return null;end if;
 select * into g from public.chat_media_view_grants where user_id=auth.uid() and request_id=p_request_id
  and message_id=p_message_id and expires_at>clock_timestamp();
 if not found then return null;end if;
 select * into m from public.messages where id=p_message_id and deleted_at is null and media_type in ('image','video') and view_limit is not null;
 if not found or not exists(select 1 from public.chat_media_manifest(array[p_message_id]) a where a.id=m.id and a.media_url=m.media_url) then return null;end if;
 select * into bound from media_delivery.legacy_grants b where b.user_id=auth.uid() and b.request_id=p_request_id
  and b.message_id=p_message_id and b.session_id=sid and b.source_url=m.media_url;
 if not found or not exists(select 1 from storage.objects o where o.id=bound.object_id and o.version=bound.object_version
  and o.bucket_id=bound.bucket_id and o.name=bound.object_path and coalesce(o.owner_id,o.owner::text) is not distinct from bound.object_owner) then return null;end if;
 return jsonb_build_object('url',m.media_url,'mediaType',m.media_type,'expiresAt',g.expires_at,'requestId',g.request_id,'objectVersion',bound.object_version);
end $$;
create function public.close_legacy_chat_media(p_message_id uuid,p_request_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 perform media_delivery.require_session();
 update public.chat_media_view_grants set expires_at=least(expires_at,clock_timestamp())
  where user_id=auth.uid() and request_id=p_request_id and message_id=p_message_id;
 return found;
end $$;
revoke all on function public.read_legacy_chat_media(uuid,uuid),public.close_legacy_chat_media(uuid,uuid) from public,anon,service_role;
grant execute on function public.read_legacy_chat_media(uuid,uuid),public.close_legacy_chat_media(uuid,uuid) to authenticated;

-- The admin server independently verifies current staff/assurance/permission.
-- Only its configured Supabase origin is accepted; an arbitrary-host path in a
-- user-edited publication cannot become a privileged Storage request.
create function media_delivery.admin_content_references(p_kind text,p_entity_ids uuid[],p_origin text)
returns table(entity_id uuid,bucket_id text,object_path text,object_id uuid,object_version text)
language sql stable security definer set search_path='' as $$
 with entities as materialized (
  select p.id,p.user_id author_id,p.created_at published_at from public.posts p
   where p_kind='post' and p.id=any(p_entity_ids)
  union all
  select s.id,s.user_id,s.created_at from public.stories s
   where p_kind='story' and s.id=any(p_entity_ids)
 ), urls as (
  select e.*,u.url from entities e
   cross join lateral public.content_media_strings(public.content_media_document(p_kind,e.id)) u(url)
 ), located as (
  select u.*,regexp_match(substring(u.url from length(p_origin)+1),
   '^/storage/v1/object/public/(post-media|story-media|media)/([^?#]+)(?:[?]t=[0-9]+)?$') loc
  from urls u where starts_with(u.url,p_origin||'/')
 )
 select distinct l.id,o.bucket_id,o.name,o.id,o.version
 from located l join storage.objects o on o.bucket_id=l.loc[1] and o.name=l.loc[2]
 where o.version is not null and length(o.name) between 1 and 1024
  and o.name !~ '(%|\\|(^|/)\.\.?(/|$)|//|^[ /]|/$|[[:cntrl:]])'
  and (
   exists(select 1 from public.content_media_bindings b where b.entity_kind=p_kind and b.entity_id=l.id
    and b.bucket_id=o.bucket_id and b.object_path=o.name and b.uploader_id::text=coalesce(o.owner_id,o.owner::text))
   or exists(select 1 from content_media_legacy.snapshots s where s.entity_kind=p_kind and s.entity_id=l.id
    and s.author_id=l.author_id and s.publication_created_at=l.published_at and s.object_id=o.id and s.object_version=o.version
    and s.bucket_id=o.bucket_id and s.object_path=o.name and s.canonical_url=l.url and s.revoked_at is null
    and (coalesce(o.owner_id,o.owner::text) is null or coalesce(o.owner_id,o.owner::text)=l.author_id::text))
  );
$$;
revoke all on function media_delivery.admin_content_references(text,uuid[],text) from public,anon,authenticated,service_role;

create function public.admin_bound_content_media_object(p_kind text,p_entity_id uuid,p_bucket text,p_path text,p_origin text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if p_kind is null or p_kind not in ('post','story') or p_entity_id is null
  or p_bucket is null or p_bucket not in ('post-media','story-media','media')
  or p_origin is null or p_origin !~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?$'
  or p_path is null or length(p_path) not between 1 and 1024
  or p_path ~ '(%|\\|(^|/)\.\.?(/|$)|//|^/|/$|[[:cntrl:]])' then return null;end if;
 select jsonb_build_object('object_id',r.object_id,'object_version',r.object_version) into result
  from media_delivery.admin_content_references(p_kind,array[p_entity_id],p_origin) r
  where r.bucket_id=p_bucket and r.object_path=p_path;
 return result;
end $$;
revoke all on function public.admin_bound_content_media_object(text,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.admin_bound_content_media_object(text,uuid,text,text,text) to service_role;

-- One bounded query covers bound uploads and reviewed legacy objects alike.
-- Overflow is an explicit failure, never a silently truncated moderation desk.
create function public.admin_bound_content_media_manifest(p_kind text,p_entity_ids uuid[],p_origin text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if p_kind is null or p_kind not in ('post','story') or p_entity_ids is null
  or cardinality(p_entity_ids) not between 1 and 200 or array_position(p_entity_ids,null) is not null
  or p_origin is null or p_origin !~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?$'
 then raise exception 'ADMIN_MEDIA_INVALID_REFERENCE' using errcode='22023';end if;
 select coalesce(jsonb_agg(jsonb_build_object('entity_id',r.entity_id,'bucket_id',r.bucket_id,'object_path',r.object_path)
   order by r.entity_id,r.bucket_id,r.object_path),'[]'::jsonb) into result
 from (select * from media_delivery.admin_content_references(p_kind,p_entity_ids,p_origin)
  order by entity_id,bucket_id,object_path limit 4001) r;
 if jsonb_array_length(result)>4000 then raise exception 'ADMIN_MEDIA_TOO_LARGE' using errcode='54000';end if;
 return result;
end $$;
revoke all on function public.admin_bound_content_media_manifest(text,uuid[],text) from public,anon,authenticated;
grant execute on function public.admin_bound_content_media_manifest(text,uuid[],text) to service_role;
notify pgrst,'reload schema';

commit;
