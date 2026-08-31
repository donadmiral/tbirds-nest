-- 00000000000152_organizations.sql
--
-- The organization foundation. Written against the function bodies captured
-- in migration 151. Every existing business becomes a one-level organization
-- and every existing member carries over, so nothing anyone uses today
-- changes on the day this runs.
--
-- Run the whole file in the SQL editor as one statement batch. It is
-- transactional: if any step fails, nothing is applied.

begin;

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------

create table if not exists public.organizations (
  id          uuid primary key default gen_random_uuid(),
  parent_id   uuid references public.organizations(id) on delete restrict,
  kind        text not null check (kind in ('individual','business','agency','government','education','nonprofit','media','brand','location')),
  name        text not null,
  slug        text unique,
  -- The profile that posts and receives messages for this organization.
  -- Null for a brand or location that has not asked for its own presence.
  profile_id  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  archived_at timestamptz
);
create index if not exists idx_organizations_parent on public.organizations (parent_id);
create unique index if not exists idx_organizations_profile on public.organizations (profile_id) where profile_id is not null;

create table if not exists public.org_memberships (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  role        text not null check (role in ('owner','admin','editor','analyst','recruiter','ads_manager','commerce_manager','support','member')),
  -- Contractors lapse on their own; null means no end date.
  expires_at  timestamptz,
  invited_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (org_id, user_id)
);
create index if not exists idx_org_memberships_user on public.org_memberships (user_id);

create table if not exists public.org_delegations (
  id               uuid primary key default gen_random_uuid(),
  principal_org_id uuid not null references public.organizations(id) on delete cascade,
  client_org_id    uuid not null references public.organizations(id) on delete cascade,
  scopes           text[] not null default '{}',
  expires_at       timestamptz,
  granted_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  unique (principal_org_id, client_org_id),
  check (principal_org_id <> client_org_id)
);
create index if not exists idx_org_delegations_client on public.org_delegations (client_org_id);

create table if not exists public.org_surfaces (
  org_id   uuid not null references public.organizations(id) on delete cascade,
  surface  text not null check (surface in ('content','insights','planner','inbox','recruiter','commerce','audience','ads','reviews','settings')),
  enabled  boolean not null default true,
  primary key (org_id, surface)
);

create table if not exists public.org_audit_log (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  actor_id    uuid references public.profiles(id) on delete set null,
  action      text not null,
  target_type text,
  target_id   text,
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists idx_org_audit_org_created on public.org_audit_log (org_id, created_at desc);

-- Access-code seats keep working; they now know which organization they belong to.
alter table public.business_access_members add column if not exists org_id uuid references public.organizations(id) on delete cascade;

-- ---------------------------------------------------------------------------
-- 2. Backfill: every business becomes a one-level organization
-- ---------------------------------------------------------------------------

insert into public.organizations (kind, name, slug, profile_id, created_at)
select 'business', coalesce(p.full_name, b.name, 'Business'), p.username, b.profile_id, coalesce(b.created_at, now())
from public.business_profiles b
join public.profiles p on p.id = b.profile_id
where b.profile_id is not null
on conflict do nothing;

-- Old roles map onto the one fixed list.
insert into public.org_memberships (org_id, user_id, role, created_at)
select o.id, m.member_id,
       case m.role when 'owner' then 'owner' when 'manager' then 'admin' else 'editor' end,
       coalesce(m.created_at, now())
from public.business_members m
join public.organizations o on o.profile_id = m.business_id
on conflict (org_id, user_id) do nothing;

-- The business's own auth identity is its owner.
insert into public.org_memberships (org_id, user_id, role)
select o.id, o.profile_id, 'owner' from public.organizations o where o.profile_id is not null
on conflict (org_id, user_id) do nothing;

update public.business_access_members a
set org_id = o.id
from public.organizations o
where o.profile_id = a.business_id and a.org_id is null;

-- Nothing disappears from anyone's Studio on day one.
insert into public.org_surfaces (org_id, surface)
select o.id, s.surface
from public.organizations o
cross join (values ('content'),('insights'),('planner'),('inbox'),('recruiter'),('commerce'),('audience'),('ads'),('reviews'),('settings')) as s(surface)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 3. Resolution: what role does the caller hold over a profile?
-- ---------------------------------------------------------------------------

-- Walks up the parent chain, so a membership at a parent applies to every
-- descendant unless a closer row overrides it. Returns null when none.
create or replace function public.org_role_for_profile(p_profile uuid)
returns text language sql stable security definer set search_path to 'public' as $$
  with recursive chain as (
    select o.id, o.parent_id, 0 as depth from organizations o where o.profile_id = p_profile
    union all
    select o.id, o.parent_id, c.depth + 1 from organizations o join chain c on o.id = c.parent_id
  )
  select m.role
  from chain c
  join org_memberships m on m.org_id = c.id
  where m.user_id = auth.uid()
    and (m.expires_at is null or m.expires_at > now())
  order by c.depth asc
  limit 1;
$$;

-- An agency member acting for a client within the delegated scopes.
create or replace function public.org_delegated_scopes(p_profile uuid)
returns text[] language sql stable security definer set search_path to 'public' as $$
  select coalesce(array_agg(distinct s), '{}')
  from org_delegations d
  join organizations client on client.id = d.client_org_id and client.profile_id = p_profile
  join org_memberships m on m.org_id = d.principal_org_id and m.user_id = auth.uid()
    and (m.expires_at is null or m.expires_at > now()),
  unnest(d.scopes) s
  where d.expires_at is null or d.expires_at > now();
$$;

-- ---------------------------------------------------------------------------
-- 4. The three gates every policy already calls, same signatures
-- ---------------------------------------------------------------------------

-- Previous body, kept for rollback:
--   select exists (select 1 from business_members where business_id = p_business_id and member_id = auth.uid());
create or replace function public.is_business_member(p_business_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select org_role_for_profile(p_business_id) is not null
      or cardinality(org_delegated_scopes(p_business_id)) > 0
      or exists (select 1 from business_members where business_id = p_business_id and member_id = auth.uid());
$$;

-- Previous body, kept for rollback:
--   select exists (select 1 from business_members where business_id = p_business_id and member_id = auth.uid() and role = 'owner');
create or replace function public.is_business_owner(p_business_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select org_role_for_profile(p_business_id) = 'owner'
      or exists (select 1 from business_members where business_id = p_business_id and member_id = auth.uid() and role = 'owner');
$$;

-- Previous body, kept for rollback:
--   select auth.uid() is not null and (auth.uid() = p_target or is_business_member(p_target));
create or replace function public.can_act_as(p_target uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select auth.uid() is not null and (auth.uid() = p_target or is_business_member(p_target));
$$;

-- ---------------------------------------------------------------------------
-- 5. Studio: surfaces and the account switcher
-- ---------------------------------------------------------------------------

-- Which desks this business uses. Studio's shell reads this to build its tabs.
create or replace function public.studio_surfaces()
returns text[] language sql stable security definer set search_path to 'public' as $$
  select coalesce(array_agg(s.surface order by s.surface), '{}')
  from org_surfaces s join organizations o on o.id = s.org_id
  where o.profile_id = auth.uid() and s.enabled;
$$;

-- Previous body listed the caller plus business_members rows. This adds every
-- organization the caller may act as, at any level, plus delegated clients.
create or replace function public.get_my_actors()
returns table(actor_id uuid, full_name text, username text, avatar_url text, kind text, role text)
language sql stable set search_path to 'public' as $$
  select p.id, p.full_name, p.username, p.avatar_url, 'personal'::text, 'self'::text
  from profiles p where p.id = auth.uid()
  union
  select p.id, p.full_name, p.username, p.avatar_url, o.kind, m.role
  from org_memberships m
  join organizations o on o.id = m.org_id
  join profiles p on p.id = o.profile_id
  where m.user_id = auth.uid() and p.id <> auth.uid()
    and (m.expires_at is null or m.expires_at > now())
  union
  select p.id, p.full_name, p.username, p.avatar_url, 'delegated'::text, 'agency'::text
  from org_delegations d
  join org_memberships m on m.org_id = d.principal_org_id and m.user_id = auth.uid()
    and (m.expires_at is null or m.expires_at > now())
  join organizations c on c.id = d.client_org_id
  join profiles p on p.id = c.profile_id
  where d.expires_at is null or d.expires_at > now()
  order by 5, 2;
$$;

-- ---------------------------------------------------------------------------
-- 6. Management RPCs, each writing the audit log
-- ---------------------------------------------------------------------------

create or replace function public.org_require(p_org uuid, p_roles text[])
returns void language plpgsql stable security definer set search_path to 'public' as $$
declare r text;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select role into r from org_memberships
  where org_id = p_org and user_id = auth.uid() and (expires_at is null or expires_at > now());
  if r is null then
    -- inherited from an ancestor
    with recursive up as (
      select parent_id from organizations where id = p_org
      union all select o.parent_id from organizations o join up on o.id = up.parent_id
    )
    select m.role into r from up join org_memberships m on m.org_id = up.parent_id
    where m.user_id = auth.uid() and (m.expires_at is null or m.expires_at > now()) limit 1;
  end if;
  if r is null or not (r = any(p_roles)) then raise exception 'Not permitted for this organization'; end if;
end $$;

create or replace function public.org_audit(p_org uuid, p_action text, p_target_type text, p_target_id text, p_meta jsonb default '{}'::jsonb)
returns void language sql security definer set search_path to 'public' as $$
  insert into org_audit_log (org_id, actor_id, action, target_type, target_id, meta)
  values (p_org, auth.uid(), p_action, p_target_type, p_target_id, coalesce(p_meta, '{}'::jsonb));
$$;

create or replace function public.org_create_child(p_parent uuid, p_kind text, p_name text, p_slug text default null)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid;
begin
  perform org_require(p_parent, array['owner','admin']);
  if p_kind not in ('brand','location','business') then raise exception 'A child is a brand, a location or a business'; end if;
  insert into organizations (parent_id, kind, name, slug) values (p_parent, p_kind, trim(p_name), nullif(trim(coalesce(p_slug,'')),'')) returning id into v_id;
  insert into org_surfaces (org_id, surface) select v_id, surface from org_surfaces where org_id = p_parent and enabled;
  perform org_audit(p_parent, 'child_created', 'organization', v_id::text, jsonb_build_object('kind', p_kind, 'name', p_name));
  return v_id;
end $$;

create or replace function public.org_add_member(p_org uuid, p_username text, p_role text, p_expires_at timestamptz default null)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_user uuid; v_id uuid;
begin
  perform org_require(p_org, array['owner','admin']);
  if p_role = 'owner' then perform org_require(p_org, array['owner']); end if;
  select id into v_user from profiles where lower(username) = lower(trim(p_username));
  if v_user is null then raise exception 'No account with that username'; end if;
  insert into org_memberships (org_id, user_id, role, expires_at, invited_by)
  values (p_org, v_user, p_role, p_expires_at, auth.uid())
  on conflict (org_id, user_id) do update set role = excluded.role, expires_at = excluded.expires_at
  returning id into v_id;
  perform org_audit(p_org, 'member_set', 'user', v_user::text, jsonb_build_object('role', p_role, 'expires_at', p_expires_at));
  return v_id;
end $$;

create or replace function public.org_remove_member(p_org uuid, p_user uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_owners int;
begin
  perform org_require(p_org, array['owner','admin']);
  select count(*) into v_owners from org_memberships where org_id = p_org and role = 'owner' and (expires_at is null or expires_at > now());
  if v_owners <= 1 and exists (select 1 from org_memberships where org_id = p_org and user_id = p_user and role = 'owner') then
    raise exception 'An organization keeps at least one owner';
  end if;
  delete from org_memberships where org_id = p_org and user_id = p_user;
  perform org_audit(p_org, 'member_removed', 'user', p_user::text);
end $$;

create or replace function public.org_transfer_ownership(p_org uuid, p_to_user uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  perform org_require(p_org, array['owner']);
  insert into org_memberships (org_id, user_id, role, invited_by) values (p_org, p_to_user, 'owner', auth.uid())
  on conflict (org_id, user_id) do update set role = 'owner', expires_at = null;
  update org_memberships set role = 'admin' where org_id = p_org and user_id = auth.uid() and user_id <> p_to_user;
  perform org_audit(p_org, 'ownership_transferred', 'user', p_to_user::text);
end $$;

create or replace function public.org_set_surface(p_org uuid, p_surface text, p_enabled boolean)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  perform org_require(p_org, array['owner','admin']);
  insert into org_surfaces (org_id, surface, enabled) values (p_org, p_surface, p_enabled)
  on conflict (org_id, surface) do update set enabled = excluded.enabled;
  perform org_audit(p_org, 'surface_set', 'surface', p_surface, jsonb_build_object('enabled', p_enabled));
end $$;

create or replace function public.org_grant_delegation(p_client uuid, p_principal_slug text, p_scopes text[], p_expires_at timestamptz default null)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_principal uuid; v_id uuid;
begin
  perform org_require(p_client, array['owner','admin']);
  select id into v_principal from organizations where slug = p_principal_slug and archived_at is null;
  if v_principal is null then raise exception 'No organization with that slug'; end if;
  insert into org_delegations (principal_org_id, client_org_id, scopes, expires_at, granted_by)
  values (v_principal, p_client, coalesce(p_scopes, '{}'), p_expires_at, auth.uid())
  on conflict (principal_org_id, client_org_id) do update set scopes = excluded.scopes, expires_at = excluded.expires_at
  returning id into v_id;
  perform org_audit(p_client, 'delegation_granted', 'organization', v_principal::text, jsonb_build_object('scopes', p_scopes, 'expires_at', p_expires_at));
  return v_id;
end $$;

create or replace function public.org_revoke_delegation(p_client uuid, p_principal uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  perform org_require(p_client, array['owner','admin']);
  delete from org_delegations where client_org_id = p_client and principal_org_id = p_principal;
  perform org_audit(p_client, 'delegation_revoked', 'organization', p_principal::text);
end $$;

-- The tree beneath an organization the caller belongs to.
create or replace function public.org_tree(p_root uuid)
returns table(id uuid, parent_id uuid, kind text, name text, slug text, profile_id uuid, depth int)
language sql stable security definer set search_path to 'public' as $$
  with recursive t as (
    select o.id, o.parent_id, o.kind, o.name, o.slug, o.profile_id, 0 as depth
    from organizations o where o.id = p_root and o.archived_at is null
    union all
    select o.id, o.parent_id, o.kind, o.name, o.slug, o.profile_id, t.depth + 1
    from organizations o join t on o.parent_id = t.id where o.archived_at is null
  )
  select * from t
  where exists (
    select 1 from org_memberships m where m.org_id = p_root and m.user_id = auth.uid() and (m.expires_at is null or m.expires_at > now())
  )
  order by depth, name;
$$;

-- ---------------------------------------------------------------------------
-- 7. Row-level security
-- ---------------------------------------------------------------------------

alter table public.organizations   enable row level security;
alter table public.org_memberships enable row level security;
alter table public.org_delegations enable row level security;
alter table public.org_surfaces    enable row level security;
alter table public.org_audit_log   enable row level security;

drop policy if exists organizations_read on public.organizations;
create policy organizations_read on public.organizations for select to authenticated
  using (archived_at is null and (
    exists (select 1 from org_memberships m where m.org_id = organizations.id and m.user_id = auth.uid())
    or (profile_id is not null and can_act_as(profile_id))
  ));

drop policy if exists org_memberships_read on public.org_memberships;
create policy org_memberships_read on public.org_memberships for select to authenticated
  using (user_id = auth.uid() or exists (select 1 from org_memberships me where me.org_id = org_memberships.org_id and me.user_id = auth.uid()));

drop policy if exists org_delegations_read on public.org_delegations;
create policy org_delegations_read on public.org_delegations for select to authenticated
  using (exists (select 1 from org_memberships m where m.user_id = auth.uid() and m.org_id in (client_org_id, principal_org_id)));

drop policy if exists org_surfaces_read on public.org_surfaces;
create policy org_surfaces_read on public.org_surfaces for select to authenticated
  using (exists (select 1 from org_memberships m where m.org_id = org_surfaces.org_id and m.user_id = auth.uid())
      or exists (select 1 from organizations o where o.id = org_surfaces.org_id and o.profile_id = auth.uid()));

drop policy if exists org_audit_read on public.org_audit_log;
create policy org_audit_read on public.org_audit_log for select to authenticated
  using (exists (select 1 from org_memberships m where m.org_id = org_audit_log.org_id and m.user_id = auth.uid() and m.role in ('owner','admin')));

-- All writes go through the security-definer RPCs above; no direct write policies.

grant execute on function
  public.org_role_for_profile(uuid), public.org_delegated_scopes(uuid), public.studio_surfaces(), public.get_my_actors(),
  public.org_create_child(uuid,text,text,text), public.org_add_member(uuid,text,text,timestamptz), public.org_remove_member(uuid,uuid),
  public.org_transfer_ownership(uuid,uuid), public.org_set_surface(uuid,text,boolean),
  public.org_grant_delegation(uuid,text,text[],timestamptz), public.org_revoke_delegation(uuid,uuid), public.org_tree(uuid)
to authenticated;

commit;

-- Verify after it runs. Both numbers should match the count of businesses.
-- select (select count(*) from organizations) as orgs,
--        (select count(*) from business_profiles where profile_id is not null) as businesses,
--        (select count(*) from org_memberships) as memberships;
