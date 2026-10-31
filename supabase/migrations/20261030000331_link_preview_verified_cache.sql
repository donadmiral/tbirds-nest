-- The authenticated legacy RPC remains a harmless compatibility no-op so an
-- installed client's post submission does not start failing. Only the service
-- Edge fetcher can populate verified shared metadata and thumbnail origins.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';
DO $preflight$
DECLARE p record;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='auth.users'::regclass AND attname='banned_until' AND atttypid='timestamptz'::regtype AND NOT attisdropped)
    OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role' AND rolbypassrls) THEN
    RAISE EXCEPTION 'LINK_PREVIEW_AUTH_DRIFT';
  END IF;
  SELECT md5(pg_get_functiondef(oid)) hash,proacl::text acl,pg_get_userbyid(proowner) owner INTO p
    FROM pg_proc WHERE oid=to_regprocedure('public.upsert_link_preview(text,text,text,text,text)');
  IF p.hash IS DISTINCT FROM '686178f5e0db6e4bf417d153a2bc585f' OR p.owner IS DISTINCT FROM 'postgres'
    OR coalesce(p.acl,'') NOT IN ('{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}',
      '{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}') THEN
    RAISE EXCEPTION 'LINK_PREVIEW_FUNCTION_DRIFT';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_class c WHERE c.oid='public.link_previews'::regclass AND c.relrowsecurity
    AND c.relacl::text='{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}')
    OR (SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute WHERE attrelid='public.link_previews'::regclass AND attnum>0 AND NOT attisdropped)
      IS DISTINCT FROM ARRAY['url','title','description','image_url','domain','fetched_at']
    OR EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.link_previews'::regclass AND attnum>0 AND NOT attisdropped AND attacl IS NOT NULL)
    OR EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='public.link_previews'::regclass AND (polname<>'link_previews_read' OR polcmd<>'r' OR pg_get_expr(polqual,polrelid) IS DISTINCT FROM 'true'))
    OR NOT EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='public.link_previews'::regclass AND polname='link_previews_read' AND polroles=ARRAY[(SELECT oid FROM pg_roles WHERE rolname='authenticated')]) THEN
    RAISE EXCEPTION 'LINK_PREVIEW_TABLE_DRIFT';
  END IF;
  IF to_regnamespace('link_preview_service') IS NOT NULL OR to_regprocedure('public.claim_link_preview_fetch(uuid)') IS NOT NULL
    OR to_regprocedure('public.claim_link_preview_image(uuid)') IS NOT NULL
    OR to_regprocedure('public.store_verified_link_preview(text,text,text,text,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'LINK_PREVIEW_TARGET_ALREADY_EXISTS';
  END IF;
END $preflight$;

CREATE SCHEMA link_preview_service;
REVOKE ALL ON SCHEMA link_preview_service FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE link_preview_service.fetch_budget(
  actor_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  window_start timestamptz NOT NULL,
  requests integer NOT NULL CHECK(requests BETWEEN 1 AND 8)
);
ALTER TABLE link_preview_service.fetch_budget ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE link_preview_service.fetch_budget FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.claim_link_preview_fetch(p_actor uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE accepted integer; v_now timestamptz:=clock_timestamp();
BEGIN
  IF p_actor IS NULL OR NOT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=p_actor AND (u.banned_until IS NULL OR u.banned_until<=v_now)) THEN RETURN false; END IF;
  INSERT INTO link_preview_service.fetch_budget(actor_id,window_start,requests)
  VALUES(p_actor,v_now,1)
  ON CONFLICT(actor_id) DO UPDATE SET
    window_start=CASE WHEN link_preview_service.fetch_budget.window_start<=v_now-interval '1 minute' THEN v_now ELSE link_preview_service.fetch_budget.window_start END,
    requests=CASE WHEN link_preview_service.fetch_budget.window_start<=v_now-interval '1 minute' THEN 1 ELSE link_preview_service.fetch_budget.requests+1 END
  WHERE link_preview_service.fetch_budget.window_start<=v_now-interval '1 minute' OR link_preview_service.fetch_budget.requests<8
  RETURNING requests INTO accepted;
  RETURN accepted IS NOT NULL;
END $$;
REVOKE ALL ON FUNCTION public.claim_link_preview_fetch(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_link_preview_fetch(uuid) TO service_role;

ALTER TABLE public.link_previews ADD COLUMN verified_at timestamptz;
ALTER TABLE public.link_previews ADD COLUMN image_origin_url text;
ALTER TABLE public.link_previews ADD COLUMN image_token uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.link_previews ADD CONSTRAINT link_previews_image_token_key UNIQUE(image_token);

CREATE TABLE link_preview_service.image_budget(
  image_token uuid PRIMARY KEY REFERENCES public.link_previews(image_token) ON DELETE CASCADE,
  window_start timestamptz NOT NULL,
  requests integer NOT NULL CHECK(requests BETWEEN 1 AND 20)
);
CREATE TABLE link_preview_service.image_global_budget(
  singleton boolean PRIMARY KEY CHECK(singleton),
  window_start timestamptz NOT NULL,
  requests integer NOT NULL CHECK(requests BETWEEN 1 AND 120)
);
ALTER TABLE link_preview_service.image_budget ENABLE ROW LEVEL SECURITY;
ALTER TABLE link_preview_service.image_global_budget ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE link_preview_service.image_budget,link_preview_service.image_global_budget FROM PUBLIC,anon,authenticated,service_role;

-- Public thumbnail reads may reuse bounded in-memory/CDN raster caches. Every
-- actual origin fetch additionally claims both durable budgets, including when
-- requests arrive at different isolates or after a cold start.
CREATE FUNCTION public.claim_link_preview_image(p_token uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE accepted integer; v_now timestamptz:=clock_timestamp();
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.link_previews p WHERE p.image_token=p_token AND p.verified_at IS NOT NULL AND p.image_origin_url IS NOT NULL) THEN RETURN false; END IF;
  INSERT INTO link_preview_service.image_budget(image_token,window_start,requests) VALUES(p_token,v_now,1)
  ON CONFLICT(image_token) DO UPDATE SET
    window_start=CASE WHEN link_preview_service.image_budget.window_start<=v_now-interval '1 minute' THEN v_now ELSE link_preview_service.image_budget.window_start END,
    requests=CASE WHEN link_preview_service.image_budget.window_start<=v_now-interval '1 minute' THEN 1 ELSE link_preview_service.image_budget.requests+1 END
  WHERE link_preview_service.image_budget.window_start<=v_now-interval '1 minute' OR link_preview_service.image_budget.requests<20
  RETURNING requests INTO accepted;
  IF accepted IS NULL THEN RETURN false; END IF;
  accepted:=NULL;
  INSERT INTO link_preview_service.image_global_budget(singleton,window_start,requests) VALUES(true,v_now,1)
  ON CONFLICT(singleton) DO UPDATE SET
    window_start=CASE WHEN link_preview_service.image_global_budget.window_start<=v_now-interval '1 minute' THEN v_now ELSE link_preview_service.image_global_budget.window_start END,
    requests=CASE WHEN link_preview_service.image_global_budget.window_start<=v_now-interval '1 minute' THEN 1 ELSE link_preview_service.image_global_budget.requests+1 END
  WHERE link_preview_service.image_global_budget.window_start<=v_now-interval '1 minute' OR link_preview_service.image_global_budget.requests<120
  RETURNING requests INTO accepted;
  RETURN accepted IS NOT NULL;
END $$;
REVOKE ALL ON FUNCTION public.claim_link_preview_image(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_link_preview_image(uuid) TO service_role;

-- One atomic upsert preserves an already established token even when independent
-- isolates all read a cache miss. The caller returns this authoritative row.
CREATE FUNCTION public.store_verified_link_preview(p_url text,p_title text,p_description text,
  p_image_origin_url text,p_domain text,p_backend_origin text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_token uuid:=gen_random_uuid(); v_now timestamptz:=clock_timestamp(); saved public.link_previews;
BEGIN
  IF p_url IS NULL OR length(p_url)>4096 OR p_url !~ '^https?://' OR p_backend_origin IS NULL
    OR p_backend_origin !~ '^https://[a-z0-9.-]+$' OR length(p_backend_origin)>300
    OR (p_image_origin_url IS NOT NULL AND (length(p_image_origin_url)>4096 OR p_image_origin_url !~ '^https?://')) THEN
    RAISE EXCEPTION 'Invalid verified preview' USING errcode='22023';
  END IF;
  INSERT INTO public.link_previews(url,title,description,image_url,domain,fetched_at,verified_at,image_origin_url,image_token)
  VALUES(p_url,left(p_title,200),left(p_description,300),
    CASE WHEN p_image_origin_url IS NOT NULL THEN p_backend_origin||'/functions/v1/link-preview?image='||v_token::text END,
    left(p_domain,253),v_now,v_now,p_image_origin_url,v_token)
  ON CONFLICT(url) DO UPDATE SET title=excluded.title,description=excluded.description,domain=excluded.domain,
    fetched_at=excluded.fetched_at,verified_at=excluded.verified_at,image_origin_url=excluded.image_origin_url,
    image_url=CASE WHEN excluded.image_origin_url IS NOT NULL THEN p_backend_origin||'/functions/v1/link-preview?image='||public.link_previews.image_token::text END
  RETURNING * INTO saved;
  RETURN to_jsonb(saved);
END $$;
REVOKE ALL ON FUNCTION public.store_verified_link_preview(text,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.store_verified_link_preview(text,text,text,text,text,text) TO service_role;
-- The Edge service writes through the atomic definer above. Revoking its direct
-- table writes also prevents an old in-flight Edge version from repopulating
-- unverified metadata after this cutover.
REVOKE ALL ON TABLE public.link_previews FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON TABLE public.link_previews TO authenticated,service_role;

-- Existing rows were writable through the old public definer. Preserve URL keys
-- and every post, but invalidate their derived metadata before trusting this
-- cache. The inspected production cache has six rows; QA has zero.
UPDATE public.link_previews SET title=NULL,description=NULL,image_url=NULL,domain=NULL,
  fetched_at='1970-01-01T00:00:00Z',verified_at=NULL,image_origin_url=NULL;

CREATE OR REPLACE FUNCTION public.upsert_link_preview(p_url text,p_title text DEFAULT NULL,
  p_description text DEFAULT NULL,p_image_url text DEFAULT NULL,p_domain text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  -- Compatibility acknowledgment only. Deliberately ignore untrusted metadata.
  RETURN;
END $$;
COMMENT ON FUNCTION public.upsert_link_preview(text,text,text,text,text) IS
  'Legacy client compatibility no-op. Verified link metadata is written only by the authenticated link-preview Edge service.';
REVOKE ALL ON FUNCTION public.upsert_link_preview(text,text,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.upsert_link_preview(text,text,text,text,text) TO authenticated,service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
