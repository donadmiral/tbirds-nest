-- Individual memory-book visibility and durable cover/soundtrack settings.
ALTER TABLE public.memory_albums ADD COLUMN IF NOT EXISTS cover_design text NOT NULL DEFAULT 'keepsake';
ALTER TABLE public.memory_albums ADD COLUMN IF NOT EXISTS soundtrack jsonb;
ALTER TABLE public.memory_albums ADD CONSTRAINT memory_cover_design CHECK (cover_design IN ('keepsake','postcard','editorial','field_notes','night_film','daybook','botanical','classic'));
CREATE OR REPLACE FUNCTION public.can_view_memory_book(p_album uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT auth.uid() IS NOT NULL AND EXISTS (
 SELECT 1 FROM public.memory_albums a JOIN public.profiles owner ON owner.id=a.user_id
 WHERE a.id=p_album AND owner.deactivated_at IS NULL
 AND EXISTS(SELECT 1 FROM public.profiles viewer WHERE viewer.id=auth.uid() AND viewer.deactivated_at IS NULL)
 AND (a.user_id=auth.uid() OR (
 NOT EXISTS(SELECT 1 FROM public.blocked_users b WHERE (b.blocker_id=a.user_id AND b.blocked_id=auth.uid()) OR (b.blocker_id=auth.uid() AND b.blocked_id=a.user_id))
 AND NOT EXISTS(SELECT 1 FROM public.memory_album_access x WHERE x.owner_id=a.user_id AND x.member_id=auth.uid() AND x.kind='block')
 AND CASE a.audience
 WHEN 'only_me' THEN false
 WHEN 'custom' THEN EXISTS(SELECT 1 FROM public.memory_album_access x WHERE x.owner_id=a.user_id AND x.member_id=auth.uid() AND x.kind='allow')
 WHEN 'followers' THEN EXISTS(SELECT 1 FROM public.follows f WHERE f.following_id=a.user_id AND f.follower_id=auth.uid())
 WHEN 'profile' THEN (coalesce(owner.profile_visibility,'public')<>'private' OR EXISTS(SELECT 1 FROM public.follows f WHERE f.following_id=a.user_id AND f.follower_id=auth.uid()))
 ELSE false END )));
$$;
REVOKE ALL ON FUNCTION public.can_view_memory_book(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_view_memory_book(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.can_view_memory_album(p_owner uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.memory_albums a WHERE a.user_id=p_owner AND public.can_view_memory_book(a.id));
$$;
REVOKE ALL ON FUNCTION public.can_view_memory_album(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_view_memory_album(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.get_memory_book(p_album uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.memory_albums; pgs jsonb;
BEGIN
 SELECT * INTO a FROM public.memory_albums WHERE id=p_album;
 IF NOT FOUND OR NOT public.can_view_memory_book(p_album) THEN
 RETURN jsonb_build_object('can_view',false,'is_owner',false,'count',0,'pages','[]'::jsonb); END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object(
 'id',mp.id,'story_id',mp.story_id,'sort_order',mp.sort_order,'style',mp.style,
 'media_url',coalesce(s.media_url,mp.media_url),'media_type',coalesce(s.media_type,mp.media_type),
 'thumbnail_url',coalesce(s.thumbnail_url,mp.thumbnail_url),'caption',mp.caption,'taken_at',mp.taken_at,
 'story_caption',s.caption,'text_background',s.text_background,'stickers',s.stickers_json,
 'duration_sec',s.duration_sec,'dual_front_url',s.dual_front_url,'audio_url',s.audio_url,'audio_title',s.audio_title
 ) ORDER BY mp.sort_order,mp.created_at,mp.id),'[]'::jsonb) INTO pgs
 FROM public.memory_pages mp JOIN public.stories s ON s.id=mp.story_id AND s.user_id=a.user_id WHERE mp.album_id=a.id AND mp.user_id=a.user_id;
 RETURN jsonb_build_object('id',a.id,'user_id',a.user_id,'is_default',a.is_default,'title',a.title,'cover_color',a.cover_color,
 'cover_design',a.cover_design,'soundtrack',a.soundtrack,'audience',a.audience,'is_owner',a.user_id=auth.uid(),'can_view',true,
 'count',jsonb_array_length(pgs),'pages',pgs);
END $$;
CREATE OR REPLACE FUNCTION public.get_memory_album(p_owner uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.get_memory_book((SELECT a.id FROM public.memory_albums a WHERE a.user_id=p_owner AND a.is_default ORDER BY a.created_at,a.id LIMIT 1));
$$;
CREATE OR REPLACE FUNCTION public.get_memory_albums(p_owner uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('is_owner',auth.uid()=p_owner,'can_view',public.can_view_memory_album(p_owner),
 'books',coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'title',a.title,'cover_color',a.cover_color,'cover_design',a.cover_design,
 'audience',a.audience,'is_default',a.is_default,'count',(SELECT count(*) FROM public.memory_pages mp JOIN public.stories s ON s.id=mp.story_id AND s.user_id=a.user_id WHERE mp.album_id=a.id AND mp.user_id=a.user_id))
 ORDER BY a.is_default DESC,a.created_at,a.id) FROM public.memory_albums a WHERE a.user_id=p_owner AND public.can_view_memory_book(a.id)),'[]'::jsonb));
$$;
REVOKE ALL ON FUNCTION public.get_memory_book(uuid),public.get_memory_album(uuid),public.get_memory_albums(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_memory_book(uuid),public.get_memory_album(uuid),public.get_memory_albums(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.validate_memory_book_settings() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF new.cover_color NOT IN ('blush','rose','pearl','cream','sage','sky','lilac','ink') OR new.audience NOT IN ('profile','followers','custom','only_me') OR length(trim(new.title)) NOT BETWEEN 1 AND 40 THEN RAISE EXCEPTION 'INVALID_BOOK_SETTINGS'; END IF;
 IF TG_OP='INSERT' OR new.soundtrack IS DISTINCT FROM old.soundtrack THEN
 new.soundtrack:=public.validate_soundtrack(new.soundtrack,'memory_album'); END IF;
 RETURN new;
END $$;
REVOKE ALL ON FUNCTION public.validate_memory_book_settings() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER memory_book_settings BEFORE INSERT OR UPDATE ON public.memory_albums FOR EACH ROW EXECUTE FUNCTION public.validate_memory_book_settings();
CREATE OR REPLACE FUNCTION public.create_memory_book_design(p_title text,p_cover_color text DEFAULT 'blush',p_cover_design text DEFAULT 'keepsake')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result uuid;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_SIGNED_IN' USING ERRCODE='42501'; END IF;
 INSERT INTO public.memory_albums(user_id,title,cover_color,cover_design,is_default) VALUES(auth.uid(),trim(p_title),p_cover_color,p_cover_design,false) RETURNING id INTO result;
 RETURN result;
END $$;
CREATE OR REPLACE FUNCTION public.save_memory_book_design(p_album uuid,p_title text,p_cover_color text,p_audience text,p_cover_design text,p_soundtrack jsonb DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 UPDATE public.memory_albums SET title=trim(p_title),cover_color=p_cover_color,audience=p_audience,cover_design=p_cover_design,soundtrack=p_soundtrack WHERE id=p_album AND user_id=auth.uid();
 IF NOT FOUND THEN RAISE EXCEPTION 'BOOK_NOT_OWNED' USING ERRCODE='42501'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.create_memory_book_design(text,text,text),public.save_memory_book_design(uuid,text,text,text,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_memory_book_design(text,text,text),public.save_memory_book_design(uuid,text,text,text,text,jsonb) TO authenticated;
CREATE OR REPLACE FUNCTION public.add_memory_page(p_story_id uuid,p_caption text DEFAULT NULL,p_style text DEFAULT 'polaroid',p_album_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid; result uuid;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_SIGNED_IN' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.stories s WHERE s.id=p_story_id AND s.user_id=auth.uid()) THEN RAISE EXCEPTION 'STORY_NOT_OWNED' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('memory-book:'||auth.uid()::text,0));
 IF p_album_id IS NULL THEN
 SELECT id INTO a FROM public.memory_albums WHERE user_id=auth.uid() AND is_default;
 IF a IS NULL THEN INSERT INTO public.memory_albums(user_id,is_default) VALUES(auth.uid(),true) RETURNING id INTO a; END IF;
 ELSE SELECT id INTO a FROM public.memory_albums WHERE id=p_album_id AND user_id=auth.uid(); END IF;
 IF a IS NULL THEN RAISE EXCEPTION 'BOOK_NOT_OWNED' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.memory_albums WHERE id=a FOR UPDATE;
 SELECT id INTO result FROM public.memory_pages WHERE album_id=a AND story_id=p_story_id;
 IF result IS NOT NULL THEN RETURN result; END IF;
 INSERT INTO public.memory_pages(user_id,album_id,story_id,media_url,media_type,thumbnail_url,caption,style,taken_at,sort_order)
 SELECT auth.uid(),a,s.id,s.media_url,s.media_type,s.thumbnail_url,coalesce(p_caption,s.caption),p_style,s.created_at,
 coalesce((SELECT max(sort_order)+1 FROM public.memory_pages WHERE album_id=a),0) FROM public.stories s WHERE s.id=p_story_id RETURNING id INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.add_memory_page(uuid,text,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.add_memory_page(uuid,text,text,uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.swap_memory_pages(p_first uuid,p_second uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.memory_pages; b public.memory_pages;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_SIGNED_IN' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.memory_pages WHERE id IN(p_first,p_second) ORDER BY id FOR UPDATE;
 SELECT * INTO a FROM public.memory_pages WHERE id=p_first AND user_id=auth.uid();
 SELECT * INTO b FROM public.memory_pages WHERE id=p_second AND user_id=auth.uid();
 IF a.id IS NULL OR b.id IS NULL OR a.album_id<>b.album_id THEN RAISE EXCEPTION 'PAGES_NOT_OWNED_OR_DIFFERENT_BOOK' USING ERRCODE='42501'; END IF;
 UPDATE public.memory_pages SET sort_order=CASE id WHEN a.id THEN b.sort_order ELSE a.sort_order END WHERE id IN(a.id,b.id);
END $$;
REVOKE ALL ON FUNCTION public.swap_memory_pages(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.swap_memory_pages(uuid,uuid) TO authenticated;
-- Keep direct owner-table writes as strict as the RPC: an owned row must not
-- attach someone else's story or become a page of someone else's book.
CREATE OR REPLACE FUNCTION public.validate_memory_page_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.memory_albums a WHERE a.id=new.album_id AND a.user_id=new.user_id)
 OR (new.story_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.stories s WHERE s.id=new.story_id AND s.user_id=new.user_id))
 THEN RAISE EXCEPTION 'MEMORY_PAGE_OWNER_MISMATCH' USING ERRCODE='42501'; END IF;
 RETURN new;
END $$;
REVOKE ALL ON FUNCTION public.validate_memory_page_owner() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER memory_page_owner BEFORE INSERT OR UPDATE ON public.memory_pages FOR EACH ROW EXECUTE FUNCTION public.validate_memory_page_owner();
