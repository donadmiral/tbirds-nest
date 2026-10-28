BEGIN;
CREATE SCHEMA IF NOT EXISTS private;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE TABLE IF NOT EXISTS private.private_media_cleanup_credentials(purpose text PRIMARY KEY CHECK(purpose='private-media-cleanup'),secret_digest bytea NOT NULL CHECK(octet_length(secret_digest)=32),updated_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE private.private_media_cleanup_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.private_media_cleanup_credentials FROM PUBLIC,anon,authenticated,service_role;
DO $$DECLARE token text;BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('platinum:private-media-cleanup:credential',0));
 IF (SELECT count(*) FROM vault.secrets WHERE name='private_media_cleanup_secret')>1 THEN RAISE EXCEPTION 'Duplicate cleanup credentials';END IF;
 SELECT decrypted_secret INTO token FROM vault.decrypted_secrets WHERE name='private_media_cleanup_secret';
 IF token IS NULL THEN token:='pc_private_'||encode(extensions.gen_random_bytes(32),'hex');PERFORM vault.create_secret(token,'private_media_cleanup_secret','Scoped private attachment cleanup');END IF;
 IF length(token)<32 OR length(token)>512 THEN RAISE EXCEPTION 'Invalid cleanup credential';END IF;
 INSERT INTO private.private_media_cleanup_credentials(purpose,secret_digest) VALUES('private-media-cleanup',extensions.digest(token,'sha256')) ON CONFLICT(purpose) DO UPDATE SET secret_digest=excluded.secret_digest,updated_at=now();
END$$;
CREATE OR REPLACE FUNCTION public.validate_private_media_cleanup_token(p_token text) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$BEGIN
 IF p_token IS NULL OR length(p_token)<32 OR length(p_token)>512 THEN RETURN false;END IF;
 RETURN EXISTS(SELECT 1 FROM private.private_media_cleanup_credentials WHERE purpose='private-media-cleanup' AND secret_digest=extensions.digest(p_token,'sha256'));
END$$;
REVOKE ALL ON FUNCTION public.validate_private_media_cleanup_token(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.validate_private_media_cleanup_token(text) TO service_role;
COMMIT;
