-- A scoped worker credential is generated and retained inside Supabase Vault.
-- The Edge Function receives only a boolean from the service-only validator.
BEGIN;
CREATE SCHEMA IF NOT EXISTS private;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS private.call_worker_credentials (
  purpose text PRIMARY KEY CHECK (purpose='daily-reconcile'),
  secret_digest bytea NOT NULL CHECK (octet_length(secret_digest)=32),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE private.call_worker_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.call_worker_credentials FROM PUBLIC,anon,authenticated,service_role;

DO $$
DECLARE token text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('platinum:daily-reconcile:credential',0));
  IF (SELECT count(*) FROM vault.secrets WHERE name='call_reconcile_secret')>1 THEN
    RAISE EXCEPTION 'Call worker credential has duplicate Vault entries';
  END IF;
  SELECT decrypted_secret INTO token FROM vault.decrypted_secrets WHERE name='call_reconcile_secret';
  IF token IS NULL THEN
    token:='pc_call_'||encode(extensions.gen_random_bytes(32),'hex');
    PERFORM vault.create_secret(token,'call_reconcile_secret','Scoped invocation credential for Platinum call cleanup and revocation');
  END IF;
  IF length(token)<32 OR length(token)>512 THEN
    RAISE EXCEPTION 'Call worker credential must be a strong dedicated secret';
  END IF;
  INSERT INTO private.call_worker_credentials(purpose,secret_digest)
  VALUES('daily-reconcile',extensions.digest(token,'sha256'))
  ON CONFLICT(purpose) DO UPDATE SET secret_digest=excluded.secret_digest,updated_at=now();
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_call_worker_token(p_token text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF p_token IS NULL OR length(p_token)<32 OR length(p_token)>512 THEN RETURN false; END IF;
  RETURN EXISTS(SELECT 1 FROM private.call_worker_credentials c
    WHERE c.purpose='daily-reconcile' AND c.secret_digest=extensions.digest(p_token,'sha256'));
END;
$$;
REVOKE ALL ON FUNCTION public.validate_call_worker_token(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.validate_call_worker_token(text) TO service_role;
COMMIT;
