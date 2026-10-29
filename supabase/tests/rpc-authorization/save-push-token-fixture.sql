-- LOCAL PGlite only. Synthetic roles/auth identity and rows; never execute on hosted projects.

CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;

CREATE SCHEMA auth;

CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;

CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role',true),'') $$;

GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

CREATE TABLE public.profiles (id uuid PRIMARY KEY);

CREATE FUNCTION public.uuid_generate_v4() RETURNS uuid LANGUAGE sql AS $$ SELECT gen_random_uuid() $$;

CREATE TABLE public.user_push_tokens (id uuid NOT NULL,
user_id uuid,
expo_push_token text NOT NULL,
device_name text,
platform text,
created_at timestamp without time zone,
updated_at timestamp without time zone,
voip_token text);

ALTER TABLE public.user_push_tokens ALTER COLUMN id SET DEFAULT uuid_generate_v4();

ALTER TABLE public.user_push_tokens ALTER COLUMN created_at SET DEFAULT now();

ALTER TABLE public.user_push_tokens ALTER COLUMN updated_at SET DEFAULT now();

ALTER TABLE public.user_push_tokens ADD CONSTRAINT user_push_tokens_pkey PRIMARY KEY (id);

ALTER TABLE public.user_push_tokens ADD CONSTRAINT user_push_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX user_push_tokens_user_token_key ON public.user_push_tokens USING btree (user_id, expo_push_token);

CREATE FUNCTION "public"."push_token_reassign"() RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
CALLED ON NULL INPUT
PARALLEL UNSAFE
COST 100
SET search_path TO 'public'
AS $qa_source$
begin
  -- A phone's token belongs to the account that is active on it.
  if new.expo_push_token is not null then
    delete from user_push_tokens where expo_push_token = new.expo_push_token and user_id <> new.user_id;
  end if;
  if new.voip_token is not null then
    delete from user_push_tokens where voip_token = new.voip_token and user_id <> new.user_id;
  end if;
  return new;
end $qa_source$;

CREATE TRIGGER aa_push_token_reassign BEFORE INSERT OR UPDATE ON public.user_push_tokens FOR EACH ROW EXECUTE FUNCTION push_token_reassign();

ALTER TABLE public.user_push_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY push_tokens_all_own ON public.user_push_tokens FOR ALL TO PUBLIC USING (user_id=auth.uid()) WITH CHECK (user_id=auth.uid());

GRANT SELECT,INSERT,UPDATE,DELETE ON public.user_push_tokens TO anon,authenticated,service_role;

CREATE FUNCTION "public"."save_push_token"(p_user_id uuid, p_token text, p_device_name text DEFAULT NULL::text, p_platform text DEFAULT 'ios'::text) RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
CALLED ON NULL INPUT
PARALLEL UNSAFE
COST 100
AS $qa_source$
BEGIN
  IF p_token IS NULL OR p_token = '' THEN RETURN; END IF;
  -- One row per account per device: a phone with two accounts keeps both.
  INSERT INTO user_push_tokens (user_id, expo_push_token, device_name, platform, updated_at)
  VALUES (p_user_id, p_token, p_device_name, p_platform, NOW())
  ON CONFLICT (user_id, expo_push_token)
  DO UPDATE SET device_name = EXCLUDED.device_name, platform = EXCLUDED.platform, updated_at = NOW();
END;
$qa_source$;

GRANT EXECUTE ON FUNCTION public.save_push_token(uuid,text,text,text) TO PUBLIC,anon,authenticated,service_role;

INSERT INTO public.profiles(id) VALUES ('10000000-0000-4000-8000-000000000001'),('10000000-0000-4000-8000-000000000002');
