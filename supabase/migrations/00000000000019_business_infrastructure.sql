-- 0019_business_infrastructure.sql
-- Everything the business surface needs server side.
--
-- Model: a business is its own profiles row (account_type = 'business') backed by
-- a shadow auth user nobody signs into. business_members says which humans may
-- act as it. business_profiles is a 1:1 extension holding only what a person
-- does not have.
--
-- The important piece here is the posts insert policy. posts_insert_own requires
-- auth.uid() = user_id, so without an additional path a member could never
-- create a post authored by the business, which would make an actor switcher
-- decorative.

-- ── opening hours ───────────────────────────────────────────────────────────
-- jsonb rather than columns: {"mon":[["08:00","17:00"]],"sat":[["09:00","13:00"]]}
-- An empty array means closed that day. Two ranges handle a lunch closure.
alter table public.business_profiles
  add column if not exists hours jsonb;

-- ── business_profiles RLS moves from owner_id to membership ─────────────────
drop policy if exists bp_select_all   on public.business_profiles;
drop policy if exists bp_insert_own   on public.business_profiles;
drop policy if exists bp_update_own   on public.business_profiles;
drop policy if exists bp_delete_own   on public.business_profiles;
drop policy if exists business_profiles_select on public.business_profiles;
drop policy if exists business_profiles_write  on public.business_profiles;

create policy business_profiles_select on public.business_profiles
  for select to authenticated using (true);

create policy business_profiles_write on public.business_profiles
  for all to authenticated
  using (profile_id is not null and is_business_member(profile_id))
  with check (profile_id is not null and is_business_member(profile_id));

-- ── a member may post as the business ──────────────────────────────────────
drop policy if exists posts_insert_as_business on public.posts;
create policy posts_insert_as_business on public.posts
  for insert to authenticated
  with check (is_business_member(user_id));

drop policy if exists posts_update_as_business on public.posts;
create policy posts_update_as_business on public.posts
  for update to authenticated
  using (is_business_member(user_id))
  with check (is_business_member(user_id));

drop policy if exists posts_delete_as_business on public.posts;
create policy posts_delete_as_business on public.posts
  for delete to authenticated
  using (is_business_member(user_id));

-- Same for media and product cards attached to a business post.
drop policy if exists post_media_write_as_business on public.post_media;
create policy post_media_write_as_business on public.post_media
  for all to authenticated
  using (exists (select 1 from posts p where p.id = post_media.post_id and is_business_member(p.user_id)))
  with check (exists (select 1 from posts p where p.id = post_media.post_id and is_business_member(p.user_id)));

drop policy if exists post_products_write_as_business on public.post_products;
create policy post_products_write_as_business on public.post_products
  for all to authenticated
  using (exists (select 1 from posts p where p.id = post_products.post_id and is_business_member(p.user_id)))
  with check (exists (select 1 from posts p where p.id = post_products.post_id and is_business_member(p.user_id)));

-- ── which businesses do I run ──────────────────────────────────────────────
create or replace function public.get_my_businesses()
returns table (
  business_id  uuid,
  full_name    text,
  username     text,
  avatar_url   text,
  role         text,
  category     text,
  is_verified  boolean,
  member_count int,
  post_count   int
)
language sql stable security invoker set search_path = public
as $fn$
  select p.id, p.full_name, p.username, p.avatar_url, m.role,
         b.category, coalesce(b.is_verified, false),
         (select count(*)::int from business_members m2 where m2.business_id = p.id),
         (select count(*)::int from posts po where po.user_id = p.id)
  from business_members m
  join profiles p on p.id = m.business_id
  left join business_profiles b on b.profile_id = p.id
  where m.member_id = auth.uid()
  order by p.full_name;
$fn$;

grant execute on function public.get_my_businesses() to authenticated;

-- ── username availability, for the create screen ───────────────────────────
create or replace function public.is_username_available(p_username text)
returns boolean
language sql stable security definer set search_path = public
as $fn$
  select p_username is not null
     and length(trim(p_username)) between 3 and 30
     and trim(p_username) ~ '^[a-z0-9_]+$'
     and not exists (select 1 from profiles where lower(username) = lower(trim(p_username)));
$fn$;

grant execute on function public.is_username_available(text) to authenticated;

-- ── business info, editable by any member ──────────────────────────────────
create or replace function public.update_business_info(
  p_business_id uuid,
  p_category    text default null,
  p_phone       text default null,
  p_email       text default null,
  p_website     text default null,
  p_address     text default null,
  p_location    text default null,
  p_hours       jsonb default null,
  p_social      jsonb default null
) returns jsonb
language plpgsql security invoker set search_path = public
as $fn$
declare v_row business_profiles;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not is_business_member(p_business_id) then
    raise exception 'You do not manage this business';
  end if;

  update business_profiles set
    category     = coalesce(nullif(trim(p_category), ''), category),
    phone        = coalesce(nullif(trim(p_phone), ''), phone),
    email        = coalesce(nullif(trim(p_email), ''), email),
    website      = coalesce(nullif(trim(p_website), ''), website),
    address      = coalesce(nullif(trim(p_address), ''), address),
    location     = coalesce(nullif(trim(p_location), ''), location),
    hours        = coalesce(p_hours, hours),
    social_links = coalesce(p_social, social_links),
    updated_at   = now()
  where profile_id = p_business_id
  returning * into v_row;

  if v_row.id is null then raise exception 'No business record for that profile'; end if;

  return jsonb_build_object(
    'category', v_row.category, 'phone', v_row.phone, 'email', v_row.email,
    'website', v_row.website, 'address', v_row.address, 'location', v_row.location,
    'hours', v_row.hours, 'social_links', v_row.social_links);
end;
$fn$;

grant execute on function public.update_business_info(uuid, text, text, text, text, text, text, jsonb, jsonb) to authenticated;

-- ── team management ────────────────────────────────────────────────────────
create or replace function public.add_business_member(
  p_business_id uuid, p_username text, p_role text default 'contributor'
) returns jsonb
language plpgsql security definer set search_path = public
as $fn$
declare v_target uuid; v_name text;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not is_business_owner(p_business_id) then
    raise exception 'Only an owner can add team members';
  end if;
  if p_role not in ('owner', 'manager', 'contributor') then
    raise exception 'Role must be owner, manager or contributor';
  end if;

  select id, full_name into v_target, v_name
  from profiles where lower(username) = lower(trim(p_username));
  if v_target is null then raise exception 'No account with that username'; end if;
  if v_target = p_business_id then raise exception 'A business cannot be its own member'; end if;

  insert into business_members (business_id, member_id, role)
  values (p_business_id, v_target, p_role)
  on conflict (business_id, member_id) do update set role = excluded.role;

  return jsonb_build_object('member_id', v_target, 'full_name', v_name, 'role', p_role);
end;
$fn$;

create or replace function public.remove_business_member(
  p_business_id uuid, p_member_id uuid
) returns void
language plpgsql security definer set search_path = public
as $fn$
declare v_owners int;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not is_business_owner(p_business_id) and auth.uid() <> p_member_id then
    raise exception 'Only an owner can remove other members';
  end if;

  select count(*) into v_owners
  from business_members where business_id = p_business_id and role = 'owner';

  if v_owners <= 1 and exists (
       select 1 from business_members
       where business_id = p_business_id and member_id = p_member_id and role = 'owner') then
    raise exception 'A business must keep at least one owner';
  end if;

  delete from business_members
  where business_id = p_business_id and member_id = p_member_id;
end;
$fn$;

create or replace function public.set_business_member_role(
  p_business_id uuid, p_member_id uuid, p_role text
) returns void
language plpgsql security definer set search_path = public
as $fn$
declare v_owners int;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not is_business_owner(p_business_id) then
    raise exception 'Only an owner can change roles';
  end if;
  if p_role not in ('owner', 'manager', 'contributor') then
    raise exception 'Role must be owner, manager or contributor';
  end if;

  select count(*) into v_owners
  from business_members where business_id = p_business_id and role = 'owner';

  if p_role <> 'owner' and v_owners <= 1 and exists (
       select 1 from business_members
       where business_id = p_business_id and member_id = p_member_id and role = 'owner') then
    raise exception 'A business must keep at least one owner';
  end if;

  update business_members set role = p_role
  where business_id = p_business_id and member_id = p_member_id;
end;
$fn$;

create or replace function public.get_business_members(p_business_id uuid)
returns table (
  member_id  uuid,
  full_name  text,
  username   text,
  avatar_url text,
  role       text,
  joined_at  timestamptz
)
language sql stable security invoker set search_path = public
as $fn$
  select p.id, p.full_name, p.username, p.avatar_url, m.role, m.created_at
  from business_members m
  join profiles p on p.id = m.member_id
  where m.business_id = p_business_id
    and is_business_member(p_business_id)
  order by case m.role when 'owner' then 0 when 'manager' then 1 else 2 end, p.full_name;
$fn$;

grant execute on function public.add_business_member(uuid, text, text) to authenticated;
grant execute on function public.remove_business_member(uuid, uuid) to authenticated;
grant execute on function public.set_business_member_role(uuid, uuid, text) to authenticated;
grant execute on function public.get_business_members(uuid) to authenticated;

-- ── finalise a business created by the Edge Function ───────────────────────
-- The function mints the auth user; this stamps the profile and wires the
-- extension and the owner row in one transaction.
create or replace function public.finalise_business(
  p_business_id uuid,
  p_name        text,
  p_username    text,
  p_category    text,
  p_owner_id    uuid
) returns jsonb
language plpgsql security definer set search_path = public
as $fn$
begin
  if not exists (select 1 from profiles where id = p_business_id) then
    raise exception 'No profile row for that auth user yet';
  end if;

  update profiles set
    full_name    = p_name,
    username     = lower(trim(p_username)),
    account_type = 'business',
    updated_at   = now()
  where id = p_business_id;

  insert into business_profiles (owner_id, profile_id, name, category)
  values (p_owner_id, p_business_id, p_name, nullif(trim(p_category), ''))
  on conflict (profile_id) do update
    set name = excluded.name, category = excluded.category, updated_at = now();

  insert into business_members (business_id, member_id, role)
  values (p_business_id, p_owner_id, 'owner')
  on conflict (business_id, member_id) do update set role = 'owner';

  return jsonb_build_object('business_id', p_business_id, 'name', p_name, 'username', lower(trim(p_username)));
end;
$fn$;

grant execute on function public.finalise_business(uuid, text, text, text, uuid) to service_role;