-- Memory book appearance, page ownership/order and per-book visibility.
-- This migration contains only visual presentation and existing story references.
BEGIN;
SET LOCAL lock_timeout = '3s';

ALTER TABLE public.memory_albums
  ADD COLUMN IF NOT EXISTS cover_design text NOT NULL DEFAULT 'keepsake',
  ADD COLUMN IF NOT EXISTS subtitle text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS cover_story_id uuid REFERENCES public.stories(id) ON DELETE SET NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.memory_albums'::regclass AND conname = 'memory_cover_design') THEN
    ALTER TABLE public.memory_albums ADD CONSTRAINT memory_cover_design
      CHECK (cover_design IN ('keepsake','postcard','editorial','field_notes','night_film','daybook','botanical','classic'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.memory_albums'::regclass AND conname = 'memory_subtitle_length') THEN
    ALTER TABLE public.memory_albums ADD CONSTRAINT memory_subtitle_length CHECK (length(subtitle) <= 120);
  END IF;
END;
$$;

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

CREATE OR REPLACE FUNCTION public.can_view_memory_album(p_owner uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.memory_albums a WHERE a.user_id=p_owner AND public.can_view_memory_book(a.id));
$$;

CREATE OR REPLACE FUNCTION public.validate_memory_book_visual_settings()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.cover_color NOT IN ('blush','rose','pearl','cream','sage','sky','lilac','ink')
    OR NEW.audience NOT IN ('profile','followers','custom','only_me')
    OR length(trim(NEW.title)) NOT BETWEEN 1 AND 30
  THEN RAISE EXCEPTION 'INVALID_BOOK_SETTINGS'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS memory_book_visual_settings ON public.memory_albums;
CREATE TRIGGER memory_book_visual_settings BEFORE INSERT OR UPDATE ON public.memory_albums
  FOR EACH ROW EXECUTE FUNCTION public.validate_memory_book_visual_settings();

CREATE OR REPLACE FUNCTION public.create_memory_book_design(p_title text,p_cover_color text DEFAULT 'blush',p_cover_design text DEFAULT 'keepsake')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result uuid;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_SIGNED_IN' USING ERRCODE='42501'; END IF;
 INSERT INTO public.memory_albums(user_id,title,cover_color,cover_design,is_default) VALUES(auth.uid(),trim(p_title),p_cover_color,p_cover_design,false) RETURNING id INTO result;
 RETURN result;
END $$;

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

CREATE OR REPLACE FUNCTION public.validate_memory_page_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.memory_albums a WHERE a.id=new.album_id AND a.user_id=new.user_id)
 OR (new.story_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.stories s WHERE s.id=new.story_id AND s.user_id=new.user_id))
 THEN RAISE EXCEPTION 'MEMORY_PAGE_OWNER_MISMATCH' USING ERRCODE='42501'; END IF;
 RETURN new;
END $$;

DROP TRIGGER IF EXISTS memory_page_owner ON public.memory_pages;
CREATE TRIGGER memory_page_owner BEFORE INSERT OR UPDATE ON public.memory_pages
  FOR EACH ROW EXECUTE FUNCTION public.validate_memory_page_owner();

CREATE OR REPLACE FUNCTION public.validate_memory_book_cover()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF new.cover_story_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.memory_pages p
    JOIN public.stories s ON s.id = p.story_id
    WHERE p.album_id = new.id
      AND p.user_id = new.user_id
      AND s.user_id = new.user_id
      AND s.id = new.cover_story_id
  ) THEN
    RAISE EXCEPTION 'COVER_NOT_IN_OWNED_BOOK' USING ERRCODE = '42501';
  END IF;
  RETURN new;
END;
$$;

CREATE OR REPLACE FUNCTION public.clear_removed_memory_cover()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE'
    OR old.album_id IS DISTINCT FROM new.album_id
    OR old.story_id IS DISTINCT FROM new.story_id
    OR old.user_id IS DISTINCT FROM new.user_id
  THEN
    UPDATE public.memory_albums
    SET cover_story_id = NULL
    WHERE id = old.album_id AND cover_story_id = old.story_id;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS memory_book_cover ON public.memory_albums;
CREATE TRIGGER memory_book_cover BEFORE INSERT OR UPDATE OF cover_story_id, user_id ON public.memory_albums
  FOR EACH ROW EXECUTE FUNCTION public.validate_memory_book_cover();
DROP TRIGGER IF EXISTS memory_page_removed_cover ON public.memory_pages;
CREATE TRIGGER memory_page_removed_cover AFTER DELETE OR UPDATE OF story_id, album_id, user_id ON public.memory_pages
  FOR EACH ROW EXECUTE FUNCTION public.clear_removed_memory_cover();

CREATE OR REPLACE FUNCTION public.get_memory_book(p_album uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  a public.memory_albums;
  pgs jsonb;
  cover_pg jsonb;
BEGIN
  SELECT * INTO a FROM public.memory_albums WHERE id = p_album;
  IF NOT FOUND OR NOT public.can_view_memory_book(p_album) THEN
    RETURN jsonb_build_object(
      'can_view', false, 'is_owner', false, 'count', 0, 'pages', '[]'::jsonb
    );
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', mp.id,
    'story_id', mp.story_id,
    'sort_order', mp.sort_order,
    'style', mp.style,
    'media_url', coalesce(s.media_url, mp.media_url),
    'media_type', coalesce(s.media_type, mp.media_type),
    'thumbnail_url', coalesce(s.thumbnail_url, mp.thumbnail_url),
    'caption', mp.caption,
    'taken_at', mp.taken_at,
    'story_caption', s.caption,
    'text_background', s.text_background,
    'stickers', s.stickers_json,
    'media_transform', s.media_transform,
    'filter_id', s.filter_id,
    'duration_sec', s.duration_sec,
    'dual_front_url', s.dual_front_url
  ) ORDER BY mp.sort_order, mp.created_at, mp.id), '[]'::jsonb)
  INTO pgs
  FROM public.memory_pages mp
  JOIN public.stories s ON s.id = mp.story_id AND s.user_id = a.user_id
  WHERE mp.album_id = a.id AND mp.user_id = a.user_id;

  -- Ordinality retains the same deterministic order as the page reader.
  SELECT page INTO cover_pg
  FROM jsonb_array_elements(pgs) WITH ORDINALITY AS pages(page, page_order)
  ORDER BY
    (page->>'story_id' = a.cover_story_id::text) DESC NULLS LAST,
    (page->>'media_type' IN ('image', 'video')) DESC NULLS LAST,
    page_order
  LIMIT 1;

  RETURN jsonb_build_object(
    'id', a.id,
    'user_id', a.user_id,
    'is_default', a.is_default,
    'title', a.title,
    'subtitle', a.subtitle,
    'cover_color', a.cover_color,
    'cover_design', a.cover_design,
    'cover_story_id', a.cover_story_id,
    'cover_page', cover_pg,
    'audience', a.audience,
    'is_owner', a.user_id = auth.uid(),
    'can_view', true,
    'count', jsonb_array_length(pgs),
    'pages', pgs
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_memory_album(p_owner uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.get_memory_book((SELECT a.id FROM public.memory_albums a WHERE a.user_id=p_owner AND a.is_default ORDER BY a.created_at,a.id LIMIT 1));
$$;

CREATE OR REPLACE FUNCTION public.get_memory_albums(p_owner uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'is_owner', auth.uid() = p_owner,
    'can_view', public.can_view_memory_album(p_owner),
    'books', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', a.id,
        'title', a.title,
        'subtitle', a.subtitle,
        'cover_color', a.cover_color,
        'cover_design', a.cover_design,
        'cover_story_id', a.cover_story_id,
        'audience', a.audience,
        'is_default', a.is_default,
        'count', (
          SELECT count(*)
          FROM public.memory_pages mp
          JOIN public.stories s ON s.id = mp.story_id AND s.user_id = a.user_id
          WHERE mp.album_id = a.id AND mp.user_id = a.user_id
        ),
        'cover_page', (
          SELECT jsonb_build_object(
            'id', mp.id,
            'story_id', mp.story_id,
            'media_url', coalesce(s.media_url, mp.media_url),
            'media_type', coalesce(s.media_type, mp.media_type),
            'thumbnail_url', coalesce(s.thumbnail_url, mp.thumbnail_url),
            'caption', mp.caption,
            'taken_at', mp.taken_at,
            'stickers', s.stickers_json,
            'media_transform', s.media_transform,
            'filter_id', s.filter_id
          )
          FROM public.memory_pages mp
          JOIN public.stories s ON s.id = mp.story_id AND s.user_id = a.user_id
          WHERE mp.album_id = a.id AND mp.user_id = a.user_id
          ORDER BY
            (mp.story_id = a.cover_story_id) DESC NULLS LAST,
            (coalesce(s.media_type, mp.media_type) IN ('image', 'video')) DESC NULLS LAST,
            mp.sort_order, mp.created_at, mp.id
          LIMIT 1
        )
      ) ORDER BY a.is_default DESC, a.created_at, a.id)
      FROM public.memory_albums a
      WHERE a.user_id = p_owner AND public.can_view_memory_book(a.id)
    ), '[]'::jsonb)
  );
$$;

CREATE OR REPLACE FUNCTION public.create_memory_book_presentation(
  p_title text,
  p_cover_color text DEFAULT 'cream',
  p_cover_design text DEFAULT 'postcard',
  p_subtitle text DEFAULT '',
  p_story_ids uuid[] DEFAULT '{}',
  p_cover_story_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  result uuid;
  story uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_SIGNED_IN' USING ERRCODE = '42501';
  END IF;
  IF cardinality(p_story_ids) > 80 OR length(coalesce(p_subtitle, '')) > 120 THEN
    RAISE EXCEPTION 'INVALID_BOOK_PRESENTATION';
  END IF;
  IF p_cover_story_id IS NOT NULL
    AND NOT coalesce(p_cover_story_id = ANY(p_story_ids), false)
  THEN
    RAISE EXCEPTION 'COVER_NOT_SELECTED';
  END IF;

  -- Existing validation and ownership checks also run inside this transaction.
  -- A failed page addition rolls back the entire new book.
  result := public.create_memory_book_design(p_title, p_cover_color, p_cover_design);
  FOREACH story IN ARRAY coalesce(p_story_ids, '{}'::uuid[]) LOOP
    PERFORM public.add_memory_page(story, NULL, 'polaroid', result);
  END LOOP;
  UPDATE public.memory_albums
  SET subtitle = trim(coalesce(p_subtitle, '')), cover_story_id = p_cover_story_id
  WHERE id = result;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_memory_book_presentation(
  p_album uuid,
  p_title text,
  p_cover_color text,
  p_audience text,
  p_cover_design text,
  p_subtitle text,
  p_cover_story_id uuid
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_SIGNED_IN' USING ERRCODE = '42501';
  END IF;
  -- The existing settings trigger and design constraint validate this update.
  UPDATE public.memory_albums
  SET title = trim(p_title),
      cover_color = p_cover_color,
      audience = p_audience,
      cover_design = p_cover_design,
      subtitle = trim(coalesce(p_subtitle, '')),
      cover_story_id = p_cover_story_id
  WHERE id = p_album AND user_id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOK_NOT_OWNED' USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION
  public.validate_memory_book_visual_settings(), public.validate_memory_page_owner(),
  public.validate_memory_book_cover(), public.clear_removed_memory_cover()
FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION
  public.can_view_memory_book(uuid), public.can_view_memory_album(uuid),
  public.get_memory_book(uuid), public.get_memory_album(uuid), public.get_memory_albums(uuid),
  public.create_memory_book_design(text,text,text), public.add_memory_page(uuid,text,text,uuid),
  public.swap_memory_pages(uuid,uuid),
  public.create_memory_book_presentation(text,text,text,text,uuid[],uuid),
  public.save_memory_book_presentation(uuid,text,text,text,text,text,uuid)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.can_view_memory_book(uuid), public.can_view_memory_album(uuid),
  public.get_memory_book(uuid), public.get_memory_album(uuid), public.get_memory_albums(uuid),
  public.create_memory_book_design(text,text,text), public.add_memory_page(uuid,text,text,uuid),
  public.swap_memory_pages(uuid,uuid),
  public.create_memory_book_presentation(text,text,text,text,uuid[],uuid),
  public.save_memory_book_presentation(uuid,text,text,text,text,text,uuid)
TO authenticated;
COMMIT;
