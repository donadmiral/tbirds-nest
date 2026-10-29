-- Preserve ten audited pre-existing public read associations without inventing
-- upload ownership. This is an exact finite snapshot, not a public-URL fallback.
-- No storage owner, bucket visibility, upload policy or new-write right changes.
BEGIN;
SET LOCAL lock_timeout = '3s';

CREATE SCHEMA IF NOT EXISTS content_media_legacy;
REVOKE ALL ON SCHEMA content_media_legacy FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE content_media_legacy.snapshots (
  entity_kind text NOT NULL CHECK (entity_kind IN ('post', 'story')),
  entity_id uuid NOT NULL,
  author_id uuid NOT NULL,
  publication_created_at timestamptz NOT NULL,
  object_id uuid NOT NULL,
  bucket_id text NOT NULL CHECK (bucket_id IN ('post-media', 'story-media', 'media')),
  object_path text NOT NULL,
  canonical_url text NOT NULL,
  object_version text NOT NULL,
  provenance text NOT NULL DEFAULT 'reviewed_legacy_public_read_20261029'
    CHECK (provenance = 'reviewed_legacy_public_read_20261029'),
  observed_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  PRIMARY KEY (entity_kind, entity_id, object_id)
);
ALTER TABLE content_media_legacy.snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON content_media_legacy.snapshots FROM PUBLIC, anon, authenticated, service_role;
CREATE INDEX legacy_content_locator ON content_media_legacy.snapshots(bucket_id, object_path);

-- SHA-256 fingerprints were read from production on 2026-10-29. The exact
-- fields are separated with U+001F: kind, entity ID, author ID, object ID,
-- bucket, path, canonical URL and Storage version. User URLs/identities are
-- deliberately not copied into source control. Other projects match zero.
WITH published_references AS (
  SELECT 'post'::text AS kind, p.id, p.user_id AS author, p.created_at,
    p.audience::text AS audience, u.url
  FROM public.posts p
  CROSS JOIN LATERAL (VALUES (p.media_url), (p.image_url)) u(url)
  UNION ALL
  SELECT 'post', p.id, p.user_id, p.created_at, p.audience::text, m.url
  FROM public.posts p JOIN public.post_media m ON m.post_id = p.id
  UNION ALL
  SELECT 'story', s.id, s.user_id, s.created_at, s.audience::text, u.url
  FROM public.stories s
  CROSS JOIN LATERAL (VALUES (s.media_url), (s.thumbnail_url), (s.dual_front_url)) u(url)
), paths AS (
  SELECT DISTINCT *, regexp_match(url,
    '^https://prlkikhckbifseosbukl[.]supabase[.]co/storage/v1/object/public/(post-media|story-media|media)/([^?#]+)$') AS path
  FROM published_references WHERE url IS NOT NULL
), candidates AS (
  SELECT p.*, o.id AS object_id, o.version
  FROM paths p
  JOIN storage.objects o ON o.bucket_id = p.path[1] AND o.name = p.path[2]
  JOIN storage.buckets b ON b.id = o.bucket_id
  WHERE p.audience = 'everyone' AND b.public
    AND coalesce(o.owner_id, o.owner::text) IS NULL
    AND o.version IS NOT NULL
    AND split_part(p.path[2], '/', 1) = p.author::text
    AND p.path[2] !~ '(%|\\|(^|/)\.\.?(/|$)|//)'
)
INSERT INTO content_media_legacy.snapshots (
  entity_kind, entity_id, author_id, publication_created_at, object_id,
  bucket_id, object_path, canonical_url, object_version
)
SELECT kind, id, author, created_at, object_id, path[1], path[2], url, version
FROM candidates
WHERE encode(extensions.digest(concat_ws(chr(31), kind, id::text, author::text,
  object_id::text, path[1], path[2], url, version), 'sha256'), 'hex') = ANY (ARRAY[
  '3a62fdb825d6679d1a0c4dbcc75d538a0da03391259a711fc4709dd3c07b048b',
  '53567b20bdb034ab0f2410c9e14c0b8d5b8233f7b229f41358aba567c9a7bac9',
  '55a98e4f44ede0a5575381ee23b05a5d4244cb40c537b8a4a36b06165b2a17f9',
  '5da8ef1758e4fd892b7a162138a14ecf5dbf35bb5e037daa6a8fc696244a1780',
  'bf6d85b03d4aaf602225ea2070d92b63d7a453d8fefcc8a8a1167b2e32392f5f',
  '0d5b106fb8b0e36361194776d71f3f0c80bb601bb7987ce12a01d38d784c538f',
  '3f41e6a4e03b5fcac2db2f7d614b66de9e97280360079884e7a5a646e8f2e41c',
  '60a512419f2138c4bf6e59c01252e46f12f9675e26a3737dd6d1f45b36f03f31',
  '6dea47a5f3c32ce4fd42e01e6a1e1f4d2ccdca0c4eb734ddc7d0b6523c3008b1',
  '779bd5ac48ff9c5b51bbc6fd7dfcf23200a82e306d6ec9c2a85a763448beae5f'
]);

DO $$
DECLARE matched integer;
BEGIN
  SELECT count(*) INTO matched FROM content_media_legacy.snapshots;
  IF matched NOT IN (0, 10) THEN
    RAISE EXCEPTION 'LEGACY_MEDIA_SNAPSHOT_CHANGED: expected zero or all ten reviewed references, got %', matched;
  END IF;
END;
$$;

CREATE FUNCTION content_media_legacy.protect_snapshot()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'LEGACY_MEDIA_SNAPSHOT_IMMUTABLE';
  END IF;
  IF (to_jsonb(NEW) - 'revoked_at') IS DISTINCT FROM (to_jsonb(OLD) - 'revoked_at')
    OR NEW.revoked_at IS NULL
    OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at)
  THEN
    RAISE EXCEPTION 'LEGACY_MEDIA_SNAPSHOT_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION content_media_legacy.protect_snapshot() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER legacy_snapshot_immutable BEFORE UPDATE OR DELETE ON content_media_legacy.snapshots
  FOR EACH ROW EXECUTE FUNCTION content_media_legacy.protect_snapshot();

CREATE FUNCTION content_media_legacy.revoke_deleted_parent()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE content_media_legacy.snapshots
  SET revoked_at = clock_timestamp()
  WHERE entity_kind = CASE TG_TABLE_NAME WHEN 'posts' THEN 'post' ELSE 'story' END
    AND entity_id = OLD.id AND revoked_at IS NULL;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION content_media_legacy.revoke_deleted_parent() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER revoke_deleted_legacy_post AFTER DELETE ON public.posts
  FOR EACH ROW EXECUTE FUNCTION content_media_legacy.revoke_deleted_parent();
CREATE TRIGGER revoke_deleted_legacy_story AFTER DELETE ON public.stories
  FOR EACH ROW EXECUTE FUNCTION content_media_legacy.revoke_deleted_parent();

CREATE FUNCTION content_media_legacy.allows_read(
  requested_kind text, requested_id uuid, expected_author uuid,
  current_url text, current_bucket text, current_path text
)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT auth.uid() IS NOT NULL
    AND NOT coalesce((auth.jwt()->>'is_anonymous')::boolean, false)
    AND EXISTS (
      SELECT 1
      FROM content_media_legacy.snapshots l
      JOIN storage.objects o ON o.id = l.object_id
        AND o.bucket_id = l.bucket_id AND o.name = l.object_path
        AND o.version = l.object_version
        AND (coalesce(o.owner_id, o.owner::text) IS NULL
          OR coalesce(o.owner_id, o.owner::text) = l.author_id::text)
      JOIN storage.buckets b ON b.id = o.bucket_id AND b.public
      WHERE l.revoked_at IS NULL
        AND l.author_id = expected_author
        AND l.bucket_id = current_bucket AND l.object_path = current_path
        AND l.canonical_url = current_url
        AND (
          (l.entity_kind = 'post' AND EXISTS (
            SELECT 1 FROM public.posts p WHERE p.id = l.entity_id
              AND p.user_id = l.author_id AND p.created_at = l.publication_created_at
          )) OR
          (l.entity_kind = 'story' AND EXISTS (
            SELECT 1 FROM public.stories s WHERE s.id = l.entity_id
              AND s.user_id = l.author_id AND s.created_at = l.publication_created_at
          ))
        )
        AND EXISTS (
          SELECT 1 FROM public.content_media_strings(
            public.content_media_document(l.entity_kind, l.entity_id)
          ) AS live_url WHERE live_url = l.canonical_url
        )
        AND (
          (requested_kind = l.entity_kind AND requested_id = l.entity_id)
          OR (requested_kind = 'memory_album' AND l.entity_kind = 'story'
            AND public.can_view_memory_book(requested_id)
            AND EXISTS (
              SELECT 1 FROM public.memory_pages mp
              JOIN public.memory_albums a ON a.id = mp.album_id
              WHERE mp.album_id = requested_id AND mp.story_id = l.entity_id
                AND mp.user_id = l.author_id AND a.user_id = l.author_id
            ))
          OR (requested_kind = 'highlight' AND l.entity_kind = 'story'
            AND public.content_story_audience_visible(l.entity_id)
            AND EXISTS (
              SELECT 1 FROM public.story_highlight_items hi
              JOIN public.story_highlights h ON h.id = hi.highlight_id
              WHERE hi.highlight_id = requested_id AND hi.story_id = l.entity_id
                AND h.user_id = l.author_id
            ))
        )
    );
$$;
REVOKE ALL ON FUNCTION content_media_legacy.allows_read(text, uuid, uuid, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;

-- Keep the entire existing manifest's caller, audience, profile, block,
-- subscription and retained-story checks. Add only an exact read association
-- at its binding test; the outer sound-rights wrapper remains unchanged.
DO $patch$
DECLARE
  original text;
  anchor text := 'if v_location is not null and (';
  addition text := 'content_media_legacy.allows_read(r.kind, r.id, v_author, v_url, v_location[1], v_location[2]) OR';
BEGIN
  original := pg_get_functiondef('public.content_media_manifest_before_sound_rights(jsonb)'::regprocedure);
  IF position('content_media_legacy.allows_read(' IN original) > 0 THEN
    RETURN;
  END IF;
  IF (length(original) - length(replace(original, anchor, ''))) / length(anchor) <> 1 THEN
    RAISE EXCEPTION 'UNKNOWN_CONTENT_MANIFEST_BINDING_ANCHOR';
  END IF;
  EXECUTE replace(original, anchor, anchor || E'\n        ' || addition);
END;
$patch$;

COMMENT ON TABLE content_media_legacy.snapshots IS
  'Finite reviewed legacy public read associations. Does not prove uploader ownership or authorize new references, uploads, edits, object reuse or deletion.';
COMMIT;
