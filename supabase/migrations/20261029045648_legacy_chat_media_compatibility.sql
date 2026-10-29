-- Compatibility for production installations that have not adopted private
-- media sessions. Apply atomically with 20261022211236_message_call_access.sql
-- when that migration is not installed. Never change bucket visibility here.
-- Private-session installations must keep their stricter lifecycle; the
-- presence of that schema deliberately disables both legacy entry points.

CREATE OR REPLACE FUNCTION public.open_legacy_chat_media(
  p_message_id uuid,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  viewer uuid := auth.uid();
  attachment_type text;
  claimed_url text;
  claimed_remaining integer;
  grant_row public.chat_media_view_grants%ROWTYPE;
BEGIN
  IF to_regnamespace('private_media') IS NOT NULL
     OR viewer IS NULL
     OR p_message_id IS NULL
     OR p_request_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Reject unsupported attachments before consuming a view. This row lock is
  -- also held by claim_chat_media_view and prevents a delete racing the result.
  SELECT m.media_type
    INTO attachment_type
    FROM public.messages m
   WHERE m.id = p_message_id
     AND m.deleted_at IS NULL
   FOR UPDATE;

  IF attachment_type IS NULL OR attachment_type NOT IN ('image', 'video') THEN
    RETURN NULL;
  END IF;

  -- This existing RPC owns conversation authorization, uploader binding,
  -- sender exclusion, request idempotency, and the shared message_views count.
  SELECT c.url, c.remaining
    INTO claimed_url, claimed_remaining
    FROM public.claim_chat_media_view(p_message_id, p_request_id) c;

  IF claimed_url IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT g.*
    INTO grant_row
    FROM public.chat_media_view_grants g
   WHERE g.user_id = viewer
     AND g.request_id = p_request_id
     AND g.message_id = p_message_id
     AND g.remaining = claimed_remaining
     AND g.expires_at > clock_timestamp();

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Return the original grant deadline: retrying must never renew a capability.
  -- The Edge signer authenticates again, matches the authorized manifest, and
  -- signs only the seconds still remaining before this timestamp.
  RETURN jsonb_build_object(
    'url', claimed_url,
    'remaining', grant_row.remaining,
    'expiresAt', grant_row.expires_at,
    'mediaType', attachment_type,
    'requestId', grant_row.request_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.open_legacy_chat_media(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.open_legacy_chat_media(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.consume_media_view(p_message_id uuid)
RETURNS TABLE(url text, remaining integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF to_regnamespace('private_media') IS NOT NULL THEN
    RAISE EXCEPTION 'Update Platinum Circles to open limited-view attachments'
      USING ERRCODE = '42501';
  END IF;

  -- Installed clients retain their original TABLE(url, remaining) response.
  -- Each legacy call is one consumption, using the same serialized counters as
  -- modern idempotent requests; this does not bypass or reset a view limit.
  RETURN QUERY
    SELECT c.url, c.remaining
      FROM public.claim_chat_media_view(p_message_id, gen_random_uuid()) c;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_media_view(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_media_view(uuid) TO authenticated;

COMMENT ON FUNCTION public.open_legacy_chat_media(uuid, uuid) IS
  'Compatibility grant only before private_media adoption; authenticated ownership/count checks with the original two-minute deadline.';
