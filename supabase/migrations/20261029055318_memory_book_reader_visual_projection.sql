-- Compatibility projection for QA, where visual presentation columns already exist.
-- Production receives these exact definitions in the visual presentation unit.
-- Replace only readers; preserve current schema, data and function privileges.
BEGIN;
SET LOCAL lock_timeout = '3s';

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

COMMIT;
