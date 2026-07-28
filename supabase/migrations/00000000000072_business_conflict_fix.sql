-- 0072: finalise_business failed with "no unique or exclusion constraint
-- matching ON CONFLICT" — business_profiles.profile_id had only a PARTIAL
-- unique index, which ON CONFLICT (profile_id) cannot match. A full unique
-- constraint replaces it; multiple NULLs remain legal under UNIQUE.

drop index if exists business_profiles_profile_id_key;
drop index if exists idx_business_profiles_profile_id;
alter table public.business_profiles
  drop constraint if exists business_profiles_profile_id_unique;
alter table public.business_profiles
  add constraint business_profiles_profile_id_unique unique (profile_id);