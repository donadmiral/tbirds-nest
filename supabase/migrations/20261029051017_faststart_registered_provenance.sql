-- A background optimization must not erase the upload proof before publication
-- or overwrite a different generation of an object. Legacy public-read snapshots
-- and drafts alone do not authorize processing. No ownership/bucket changes.
BEGIN;
SET LOCAL lock_timeout = '3s';

CREATE SCHEMA content_media_processing;
REVOKE ALL ON SCHEMA content_media_processing FROM PUBLIC, anon, authenticated, service_role;
CREATE TABLE content_media_processing.faststart_leases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  object_id uuid NOT NULL,
  bucket_id text NOT NULL CHECK (bucket_id IN ('post-media', 'story-media')),
  object_path text NOT NULL,
  object_version text NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT (clock_timestamp() + interval '2 minutes')
);
ALTER TABLE content_media_processing.faststart_leases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON content_media_processing.faststart_leases FROM PUBLIC, anon, authenticated, service_role;
CREATE INDEX faststart_lease_expiry ON content_media_processing.faststart_leases(expires_at);
CREATE INDEX IF NOT EXISTS content_media_bindings_object_lookup
  ON public.content_media_bindings(bucket_id, object_path);

CREATE FUNCTION content_media_processing.has_published_binding(p_bucket text, p_path text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p_bucket IN ('post-media', 'story-media') AND EXISTS (
    SELECT 1 FROM public.content_media_bindings b
    JOIN storage.objects o ON o.bucket_id = b.bucket_id AND o.name = b.object_path
    WHERE b.bucket_id = p_bucket AND b.object_path = p_path
      AND b.entity_kind IN ('post', 'story')
      AND (coalesce(o.owner_id, o.owner::text) IS NULL
        OR coalesce(o.owner_id, o.owner::text) = b.uploader_id::text)
      AND EXISTS (
        SELECT 1
        FROM public.content_media_strings(public.content_media_document(b.entity_kind, b.entity_id)) u
        CROSS JOIN LATERAL regexp_match(u,
          '^https://[^/]+/storage/v1/object/public/(post-media|story-media)/([^?#]+)') loc
        WHERE loc[1] = p_bucket AND loc[2] = p_path
      )
  );
$$;
REVOKE ALL ON FUNCTION content_media_processing.has_published_binding(text, text)
  FROM PUBLIC, anon, authenticated, service_role;

-- Only the service role can obtain a capability, and only for the exact webhook
-- object generation. No user-supplied uploader or legacy snapshot is accepted.
CREATE FUNCTION public.claim_faststart_video_remux(
  p_bucket text, p_object_path text, p_object_id uuid, p_object_version text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE obj storage.objects%ROWTYPE; lease_id uuid; source_etag text;
BEGIN
  IF p_bucket NOT IN ('post-media', 'story-media') OR p_object_id IS NULL
    OR nullif(p_object_version, '') IS NULL OR length(p_object_version) > 128
    OR p_object_path !~* '\.(mp4|mov|m4v)$'
    OR p_object_path ~ '(%|\\|(^|/)\.\.?(/|$)|//)'
  THEN RETURN NULL; END IF;
  SELECT * INTO obj FROM storage.objects o
    WHERE o.id = p_object_id AND o.bucket_id = p_bucket AND o.name = p_object_path
      AND o.version = p_object_version FOR KEY SHARE;
  IF NOT FOUND OR NOT content_media_processing.has_published_binding(p_bucket, p_object_path)
  THEN RETURN NULL; END IF;
  source_etag := coalesce(obj.metadata->>'eTag', obj.metadata->>'etag');
  IF nullif(source_etag, '') IS NULL OR length(source_etag) > 256 THEN RETURN NULL; END IF;
  DELETE FROM content_media_processing.faststart_leases WHERE expires_at <= clock_timestamp();
  INSERT INTO content_media_processing.faststart_leases(object_id, bucket_id, object_path, object_version)
    VALUES (obj.id, obj.bucket_id, obj.name, obj.version) RETURNING id INTO lease_id;
  RETURN jsonb_build_object('lease_id', lease_id, 'object_id', obj.id,
    'object_version', obj.version, 'etag', source_etag,
    'metadata', CASE WHEN jsonb_typeof(obj.user_metadata) = 'object' THEN obj.user_metadata ELSE '{}'::jsonb END);
END;
$$;
REVOKE ALL ON FUNCTION public.claim_faststart_video_remux(text, text, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_faststart_video_remux(text, text, uuid, text) TO service_role;

CREATE FUNCTION public.check_faststart_video_remux(p_lease_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM content_media_processing.faststart_leases l
    JOIN storage.objects o ON o.id = l.object_id AND o.bucket_id = l.bucket_id
      AND o.name = l.object_path AND o.version = l.object_version
    WHERE l.id = p_lease_id AND l.expires_at > clock_timestamp()
      AND content_media_processing.has_published_binding(l.bucket_id, l.object_path)
  );
$$;
REVOKE ALL ON FUNCTION public.check_faststart_video_remux(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.check_faststart_video_remux(uuid) TO service_role;

CREATE FUNCTION public.release_faststart_video_remux(p_lease_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  DELETE FROM content_media_processing.faststart_leases WHERE id = p_lease_id;
$$;
REVOKE ALL ON FUNCTION public.release_faststart_video_remux(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.release_faststart_video_remux(uuid) TO service_role;

-- Storage uploads bytes under a new version, then commits that version in this
-- row. This guard runs at that commit: a stale attempt cannot replace the current
-- pointer. Storage's preliminary permission upsert runs in a rolled-back savepoint;
-- any lease consumption in that probe rolls back with it.
CREATE FUNCTION content_media_processing.guard_faststart_version()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE marker text; lease content_media_processing.faststart_leases%ROWTYPE;
BEGIN
  marker := NEW.user_metadata->>'platinum_faststart_lease';
  IF TG_WHEN = 'AFTER' THEN
    -- A marked request must resolve to the guarded conflict UPDATE, never a
    -- newly inserted/versioned row. Unknown Storage write modes fail closed.
    IF marker IS NOT NULL THEN RAISE EXCEPTION 'FASTSTART_IN_PLACE_UPDATE_REQUIRED' USING ERRCODE = '42501'; END IF;
    RETURN NULL;
  END IF;
  IF marker IS NULL THEN
    -- Also fence an already-running old service remux during rollout. New object
    -- uploads and all ordinary user writes retain their existing Storage rules.
    IF TG_OP = 'UPDATE' AND NEW.bucket_id IN ('post-media', 'story-media')
      AND NEW.name ~* '\.(mp4|mov|m4v)$' AND NEW.version IS DISTINCT FROM OLD.version
      AND auth.jwt()->>'role' = 'service_role'
    THEN RAISE EXCEPTION 'FASTSTART_REGISTERED_LEASE_REQUIRED' USING ERRCODE = '42501'; END IF;
    RETURN NEW;
  END IF;
  IF auth.jwt()->>'role' IS DISTINCT FROM 'service_role'
    OR marker !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  THEN RAISE EXCEPTION 'FASTSTART_SERVICE_LEASE_REQUIRED' USING ERRCODE = '42501'; END IF;
  SELECT * INTO lease FROM content_media_processing.faststart_leases l
    WHERE l.id = marker::uuid FOR UPDATE;
  IF NOT FOUND OR lease.expires_at <= clock_timestamp()
    OR NEW.bucket_id IS DISTINCT FROM lease.bucket_id OR NEW.name IS DISTINCT FROM lease.object_path
    OR NOT content_media_processing.has_published_binding(lease.bucket_id, lease.object_path)
  THEN RAISE EXCEPTION 'FASTSTART_LEASE_INVALID' USING ERRCODE = '42501'; END IF;
  IF TG_OP = 'INSERT' THEN
    -- An upsert fires BEFORE INSERT before its conflict UPDATE. Keep the marker
    -- for that UPDATE, and do not permit deletion/recreation to resurrect a file.
    PERFORM 1 FROM storage.objects o WHERE o.id = lease.object_id
      AND o.bucket_id = lease.bucket_id AND o.name = lease.object_path
      AND o.version = lease.object_version FOR KEY SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'FASTSTART_OBJECT_CHANGED' USING ERRCODE = '40001'; END IF;
    RETURN NEW;
  END IF;
  IF OLD.id IS DISTINCT FROM lease.object_id OR OLD.version IS DISTINCT FROM lease.object_version
    OR NEW.id IS DISTINCT FROM OLD.id OR NEW.bucket_id IS DISTINCT FROM OLD.bucket_id
    OR NEW.name IS DISTINCT FROM OLD.name OR NEW.version IS NULL
    OR NEW.version IS NOT DISTINCT FROM OLD.version
  THEN RAISE EXCEPTION 'FASTSTART_OBJECT_CHANGED' USING ERRCODE = '40001'; END IF;
  NEW.user_metadata := NEW.user_metadata - 'platinum_faststart_lease';
  DELETE FROM content_media_processing.faststart_leases WHERE id = lease.id;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION content_media_processing.guard_faststart_version()
  FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER faststart_registered_version_guard BEFORE INSERT OR UPDATE ON storage.objects
  FOR EACH ROW EXECUTE FUNCTION content_media_processing.guard_faststart_version();
CREATE TRIGGER faststart_no_marked_insert AFTER INSERT ON storage.objects
  FOR EACH ROW EXECUTE FUNCTION content_media_processing.guard_faststart_version();
COMMIT;
