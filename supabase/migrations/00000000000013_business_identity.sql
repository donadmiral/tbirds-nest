-- 0013_business_identity.sql
-- A business is a profiles row, backed by a shadow auth user nobody logs into.
-- business_members records which humans may act as it. Reads stay simple: a
-- business is just a profile, so posts, follows, stories, chat and listings all
-- work with no new code paths.
--
-- Cleanup in here too: Don's personal account (c49e690d) was mislabelled
-- account_type = 'business', and birds_business_posts is an empty duplicate of
-- business_posts.

-- ── who may act as a business ───────────────────────────────────────────────
create table if not exists public.business_members (
  business_id uuid not null references public.profiles(id) on delete cascade,
  member_id   uuid not null references public.profiles(id) on delete cascade,
  role        text not null default 'owner',
  created_at  timestamptz not null default now(),
  primary key (business_id, member_id),
  constraint business_members_role_check check (role in ('owner', 'manager', 'contributor'))
);

create index if not exists idx_business_members_member on public.business_members (member_id);

alter table public.business_members enable row level security;

-- A member can see the rosters of businesses they belong to.
drop policy if exists business_members_select on public.business_members;
create policy business_members_select on public.business_members
  for select to authenticated
  using (exists (select 1 from business_members m
                 where m.business_id = business_members.business_id
                   and m.member_id = auth.uid()));

-- Only an owner may change the roster.
drop policy if exists business_members_write_owner on public.business_members;
create policy business_members_write_owner on public.business_members
  for all to authenticated
  using (exists (select 1 from business_members m
                 where m.business_id = business_members.business_id
                   and m.member_id = auth.uid() and m.role = 'owner'))
  with check (exists (select 1 from business_members m
                 where m.business_id = business_members.business_id
                   and m.member_id = auth.uid() and m.role = 'owner'));

-- ── business_profiles becomes a 1:1 extension of a business profile ─────────
alter table public.business_profiles
  add column if not exists profile_id uuid references public.profiles(id) on delete cascade;

create unique index if not exists uq_business_profiles_profile
  on public.business_profiles (profile_id) where profile_id is not null;

-- ── correct the mislabelled personal account ────────────────────────────────
update public.profiles
   set account_type = 'personal'
 where id = 'c49e690d-3ee6-4e8b-9a51-f61528058039'
   and account_type = 'business';

-- ── drop the dead duplicate table ───────────────────────────────────────────
drop table if exists public.birds_business_posts;

-- ── helpers ─────────────────────────────────────────────────────────────────

/**
 * Which businesses may the caller post as? The composer's actor switcher
 * reads this. Returns the caller's own profile first, then their businesses.
 */
create or replace function public.get_my_actors()
returns table (
  actor_id   uuid,
  full_name  text,
  username   text,
  avatar_url text,
  kind       text,
  role       text
)
language sql stable security invoker set search_path = public
as $fn$
  select p.id, p.full_name, p.username, p.avatar_url, 'personal'::text, 'self'::text
  from profiles p where p.id = auth.uid()
  union all
  select p.id, p.full_name, p.username, p.avatar_url, 'business'::text, m.role
  from business_members m
  join profiles p on p.id = m.business_id
  where m.member_id = auth.uid()
  -- Positional: in a UNION, ORDER BY cannot reference RETURNS TABLE output
  -- names. Column 5 is kind, column 2 is full_name.
  order by 5, 2;
$fn$;

grant execute on function public.get_my_actors() to authenticated;

/**
 * Attach an existing auth-backed profile to a business_profiles page, flag it
 * as a business, and make the caller its owner. Used to promote Pearl Group,
 * and by the Edge Function once self-serve creation exists.
 */
create or replace function public.link_business_profile(
  p_business_profile_id uuid,
  p_business_auth_id    uuid
) returns jsonb
language plpgsql security definer set search_path = public
as $fn$
declare
  v_me uuid := auth.uid();
  v_owner uuid;
  v_name text;
begin
  if v_me is null then raise exception 'Not authenticated'; end if;

  select owner_id, name into v_owner, v_name
  from business_profiles where id = p_business_profile_id;
  if v_owner is null then raise exception 'Business page not found'; end if;
  if v_owner <> v_me then raise exception 'Only the page owner can link it'; end if;

  if not exists (select 1 from profiles where id = p_business_auth_id) then
    raise exception 'No profile exists for that auth id yet';
  end if;

  update profiles set account_type = 'business' where id = p_business_auth_id;
  update business_profiles set profile_id = p_business_auth_id
   where id = p_business_profile_id;

  insert into business_members (business_id, member_id, role)
  values (p_business_auth_id, v_me, 'owner')
  on conflict (business_id, member_id) do update set role = 'owner';

  return jsonb_build_object('business_id', p_business_auth_id, 'name', v_name);
end;
$fn$;

grant execute on function public.link_business_profile(uuid, uuid) to authenticated;