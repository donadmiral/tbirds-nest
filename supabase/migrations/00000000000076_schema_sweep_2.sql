-- 0076 schema sweep stage two.
-- Every table here reached ZERO code references after the 2026-07-28 retirement
-- scripts (connections app-wide, mingle events, AI identity, affiliations,
-- campus moments / institutions). Children dropped before parents.

drop table if exists public.mingle_post_attendees cascade;
drop table if exists public.mingle_posts cascade;
drop table if exists public.profile_affiliations cascade;
drop table if exists public.affiliations cascade;
drop table if exists public.profile_institutions cascade;
drop table if exists public.institutions cascade;
drop table if exists public.identity_training_photos cascade;
drop table if exists public.user_identity_models cascade;
drop table if exists public.enhancement_history cascade;
drop table if exists public.connections cascade;

-- Orphaned school-era columns.
alter table public.conversations drop column if exists affiliation_id cascade;
alter table public.conversations drop column if exists mentorship_id cascade;
alter table public.jobs drop column if exists institution_id cascade;
alter table public.jobs drop column if exists scope cascade;
alter table public.jobs drop column if exists institution_name cascade;

-- Report any function whose body still mentions the retired schema, so it can
-- be patched before it errors at runtime (delete_user_account has history here).
do $$
declare r record; found boolean := false;
begin
  for r in
    select p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (p.prosrc ilike '%connections%'
        or p.prosrc ilike '%mingle_%'
        or p.prosrc ilike '%affiliation%'
        or p.prosrc ilike '%institution%'
        or p.prosrc ilike '%identity_training%')
  loop
    found := true;
    raise notice 'ORPHAN FUNCTION mentions retired schema: %', r.proname;
  end loop;
  if not found then
    raise notice 'Clean: no function mentions the retired schema.';
  end if;
end $$;