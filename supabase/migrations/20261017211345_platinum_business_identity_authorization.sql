BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';
DO $preflight$
DECLARE v record; p record;
BEGIN
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'Apply this repair as the database owner'; END IF;
  FOR v IN SELECT * FROM (VALUES
    ('is_business_owner(uuid)', '549f137b1881640b33c22ca3919a4fd2', 'postgres', '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
    ('link_business_profile(uuid,uuid)', '00f395c17dbe196860236e563c3e9c49', 'postgres', '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
    ('add_business_member(uuid,text,text)', 'd938531c61e8c3aa58ec036926e92f5c', 'postgres', '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
    ('set_business_member_role(uuid,uuid,text)', '9101a29dae90c38e10a89e440f5a6574', 'postgres', '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
    ('remove_business_member(uuid,uuid)', '17d966ccc9bf3918f874efa0cea44250', 'postgres', '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
    ('org_role_for_profile(uuid)', 'ee634c1db6d6cd01118faf4a31bbe895', 'postgres', '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
    ('finalise_business(uuid,text,text,text,uuid)', '844f0b69c1448d2dee237d7c638c0b01', 'postgres', '{postgres=X/postgres,service_role=X/postgres}')
  ) expected(signature, definition_hash, owner_name, acl) LOOP
    SELECT md5(pg_get_functiondef(oid)) hash, pg_get_userbyid(proowner) owner_name, proacl::text acl
      INTO p FROM pg_proc WHERE oid = to_regprocedure('public.' || v.signature);
    IF p.hash IS DISTINCT FROM v.definition_hash OR p.owner_name IS DISTINCT FROM v.owner_name
       OR p.acl IS DISTINCT FROM v.acl THEN
      RAISE EXCEPTION 'Function changed since review: %', v.signature;
    END IF;
  END LOOP;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.is_business_owner(p_business_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT coalesce(public.org_role_for_profile(p_business_id) = 'owner', false)
      OR EXISTS (SELECT 1 FROM public.business_members
                 WHERE business_id = p_business_id AND member_id = auth.uid() AND role = 'owner');
$function$;

CREATE OR REPLACE FUNCTION public.link_business_profile(p_business_profile_id uuid, p_business_auth_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_me uuid := auth.uid();
  v_owner uuid;
  v_name text;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  IF p_business_profile_id IS NULL OR p_business_auth_id IS NULL THEN
    RAISE EXCEPTION 'A business page and profile are required' USING ERRCODE = '22023';
  END IF;

  -- Shared with the legacy membership writers; check authorization after waiting.
  PERFORM 1 FROM public.profiles WHERE id = p_business_auth_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No profile exists for that auth id yet'; END IF;

  SELECT owner_id, name INTO v_owner, v_name
  FROM public.business_profiles WHERE id = p_business_profile_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Business page not found'; END IF;
  IF v_owner IS DISTINCT FROM v_me THEN
    RAISE EXCEPTION 'Only the page owner can link it' USING ERRCODE = '42501';
  END IF;

  -- Creating new business identities uses the service-only finalise_business flow.
  -- This legacy endpoint may link only the caller's own profile or an identity
  -- they already own. Membership or delegated publishing access is insufficient.
  IF p_business_auth_id <> v_me AND public.is_business_owner(p_business_auth_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'You must own the profile being linked' USING ERRCODE = '42501';
  END IF;

  UPDATE public.profiles SET account_type = 'business' WHERE id = p_business_auth_id;
  UPDATE public.business_profiles SET profile_id = p_business_auth_id WHERE id = p_business_profile_id;
  INSERT INTO public.business_members (business_id, member_id, role)
  VALUES (p_business_auth_id, v_me, 'owner')
  ON CONFLICT (business_id, member_id) DO UPDATE SET role = 'owner';
  RETURN jsonb_build_object('business_id', p_business_auth_id, 'name', v_name);
END;
$function$;

CREATE OR REPLACE FUNCTION public.add_business_member(p_business_id uuid, p_username text, p_role text DEFAULT 'contributor'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_target uuid; v_name text;
begin
  if auth.uid() is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  -- Serialize these legacy writers before reading membership or owner counts.
  perform 1 from public.profiles where id = p_business_id for update;
  if not found then raise exception 'Business profile not found'; end if;
  if public.is_business_owner(p_business_id) is not true then
    raise exception 'Only an owner can add team members' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('owner', 'manager', 'contributor') then
    raise exception 'Role must be owner, manager or contributor';
  end if;

  select id, full_name into v_target, v_name
  from public.profiles where lower(username) = lower(trim(p_username));
  if v_target is null then raise exception 'No account with that username'; end if;
  if v_target = p_business_id then raise exception 'A business cannot be its own member'; end if;

  if p_role <> 'owner' and exists (
    select 1 from public.business_members where business_id = p_business_id
      and member_id = v_target and role = 'owner'
  ) and (select count(*) from public.business_members where business_id = p_business_id and role = 'owner') <= 1 then
    raise exception 'A business must keep at least one owner';
  end if;

  insert into public.business_members (business_id, member_id, role)
  values (p_business_id, v_target, p_role)
  on conflict (business_id, member_id) do update set role = excluded.role;

  return jsonb_build_object('member_id', v_target, 'full_name', v_name, 'role', p_role);
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_business_member_role(p_business_id uuid, p_member_id uuid, p_role text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_owners int;
begin
  if auth.uid() is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  -- Serialize these legacy writers before reading membership or owner counts.
  perform 1 from public.profiles where id = p_business_id for update;
  if not found then raise exception 'Business profile not found'; end if;
  if public.is_business_owner(p_business_id) is not true then
    raise exception 'Only an owner can change roles' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('owner', 'manager', 'contributor') then
    raise exception 'Role must be owner, manager or contributor';
  end if;

  select count(*) into v_owners
  from public.business_members where business_id = p_business_id and role = 'owner';

  if p_role <> 'owner' and v_owners <= 1 and exists (
       select 1 from public.business_members
       where business_id = p_business_id and member_id = p_member_id and role = 'owner') then
    raise exception 'A business must keep at least one owner';
  end if;

  update public.business_members set role = p_role
  where business_id = p_business_id and member_id = p_member_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.remove_business_member(p_business_id uuid, p_member_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_owners int;
begin
  if auth.uid() is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  -- Serialize these legacy writers before reading membership or owner counts.
  perform 1 from public.profiles where id = p_business_id for update;
  if not found then raise exception 'Business profile not found'; end if;
  if public.is_business_owner(p_business_id) is not true and auth.uid() is distinct from p_member_id then
    raise exception 'Only an owner can remove other members' using errcode = '42501';
  end if;

  select count(*) into v_owners
  from public.business_members where business_id = p_business_id and role = 'owner';

  if v_owners <= 1 and exists (
       select 1 from public.business_members
       where business_id = p_business_id and member_id = p_member_id and role = 'owner') then
    raise exception 'A business must keep at least one owner';
  end if;

  delete from public.business_members
  where business_id = p_business_id and member_id = p_member_id;
end;
$function$;
REVOKE EXECUTE ON FUNCTION public.link_business_profile(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.link_business_profile(uuid,uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.add_business_member(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_business_member(uuid,text,text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.set_business_member_role(uuid,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_business_member_role(uuid,uuid,text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.remove_business_member(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_business_member(uuid,uuid) TO authenticated, service_role;
COMMIT;
