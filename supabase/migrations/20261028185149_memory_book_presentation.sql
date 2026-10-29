-- Additive presentation metadata. Installed clients keep their existing RPCs.
-- Covers reference an owned page; signed media URLs are never persisted here.
ALTER TABLE public.memory_albums
  ADD COLUMN IF NOT EXISTS subtitle text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS cover_story_id uuid
    REFERENCES public.stories(id) ON DELETE SET NULL;

ALTER TABLE public.memory_albums
  ADD CONSTRAINT memory_subtitle_length CHECK (length(subtitle) <= 120);

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

REVOKE ALL ON FUNCTION public.validate_memory_book_cover()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER memory_book_cover
  BEFORE INSERT OR UPDATE OF cover_story_id, user_id ON public.memory_albums
  FOR EACH ROW EXECUTE FUNCTION public.validate_memory_book_cover();

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

REVOKE ALL ON FUNCTION public.clear_removed_memory_cover()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER memory_page_removed_cover
  AFTER DELETE OR UPDATE OF story_id, album_id, user_id ON public.memory_pages
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
    'duration_sec', s.duration_sec,
    'dual_front_url', s.dual_front_url,
    'audio_url', s.audio_url,
    'audio_title', s.audio_title
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
    'soundtrack', a.soundtrack,
    'audience', a.audience,
    'is_owner', a.user_id = auth.uid(),
    'can_view', true,
    'count', jsonb_array_length(pgs),
    'pages', pgs
  );
END;
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
            'stickers', s.stickers_json
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

-- CREATE OR REPLACE retains these grants. Reassert the intended API boundary
-- explicitly so this migration remains straightforward to audit.
REVOKE ALL ON FUNCTION public.get_memory_book(uuid), public.get_memory_albums(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_memory_book(uuid), public.get_memory_albums(uuid)
  TO authenticated;

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
  -- A presentation edit leaves any previously saved soundtrack untouched.
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
  public.create_memory_book_presentation(text, text, text, text, uuid[], uuid),
  public.save_memory_book_presentation(uuid, text, text, text, text, text, uuid)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.create_memory_book_presentation(text, text, text, text, uuid[], uuid),
  public.save_memory_book_presentation(uuid, text, text, text, text, text, uuid)
TO authenticated;
