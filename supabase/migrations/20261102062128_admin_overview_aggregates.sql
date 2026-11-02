begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

-- Supports the rolling signup cohort and the existing newest-member list.
-- Unlike an index on last_seen, this key does not change on every heartbeat.
-- Large existing datasets need a rehearsed concurrent index build before this
-- migration; the guarded regular build is intended for the initial cutover.
create index if not exists profiles_created_at_reporting_idx on public.profiles(created_at);

do $$ begin
  if to_regcollation('pg_catalog."und-x-icu"') is null then
    raise exception 'ADMIN_REPORT_UNICODE_COLLATION_REQUIRED';
  end if;
end $$;

-- Exact, request-time reporting. Aggregate in Postgres before crossing the API
-- row limit; never page through private profiles or truncate a global figure.
-- This removes unbounded response payloads, not the cost of exact aggregation.
-- Large deployments should measure these reads separately from member traffic.
create function public.admin_overview_summary(p_as_of timestamptz, p_scope text)
returns jsonb
language plpgsql stable security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  result jsonb;
  profile_counts jsonb;
  location_counts jsonb;
  report_counts jsonb;
  application_counts jsonb;
  tier_counts jsonb;
  cohort_counts jsonb;
begin
  if p_as_of is null or not pg_catalog.isfinite(p_as_of)
     or p_scope is null or p_scope not in ('dashboard', 'analytics') then
    raise exception 'INVALID_REPORT_ARGUMENT';
  end if;

  select jsonb_build_object(
    'members', count(*),
    'businesses', count(*) filter (where p.account_type = 'business'),
    'verified', count(*) filter (where p.is_verified is true),
    'business_verified', count(*) filter (where p.account_type = 'business' and p.is_verified is true),
    'active', count(*) filter (where p.last_seen >= p_as_of - interval '5 minutes')
  ) into profile_counts from public.profiles p;

  -- Match JS /\s+/g + trim, including NBSP, thin spaces and BOM. ICU's neutral
  -- Unicode lowercasing also preserves JS cases such as dotted I/final sigma.
  -- The displayed spelling is a stable submitted spelling, not a guessed city.
  with raw_locations as (
    -- Collapse repeated input spellings before Unicode normalization. A common
    -- city is normalized once, not once for every resident's profile.
    select p.location collate pg_catalog."C" as location, count(*) as n from public.profiles p
    where p.location is not null group by 1
  ), normalized as (
    select btrim(regexp_replace(coalesce(p.location, ''),
      U&'[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]+', ' ', 'g')) as label, p.n
    from raw_locations p
  ), grouped as materialized (
    select lower(label collate pg_catalog."und-x-icu") collate pg_catalog."C" as key,
      min(label collate pg_catalog."C") as label, sum(n) as n
    from normalized where label <> '' group by 1
  )
  select jsonb_build_object(
    'located', coalesce((select sum(n) from grouped), 0),
    'locations', coalesce((select jsonb_agg(to_jsonb(l) order by n desc, label collate pg_catalog."C")
      from (select label, n from grouped order by n desc, label collate pg_catalog."C" limit 8) l), '[]'::jsonb)
  ) into location_counts;

  result := jsonb_build_object('version', 1, 'as_of', p_as_of,
    'profiles', profile_counts || location_counts);

  if p_scope = 'analytics' then
    select coalesce(jsonb_agg(to_jsonb(t) order by key), '[]'::jsonb) into tier_counts
    from (
      select coalesce(nullif(p.verified_tier, ''), 'unrecorded') as key, count(*) as n
      from public.profiles p where p.is_verified is true group by 1
    ) t;

    select coalesce(jsonb_agg(to_jsonb(c) order by week desc), '[]'::jsonb) into cohort_counts
    from (
      select to_char(date_trunc('week', p.created_at at time zone 'UTC'), 'YYYY-MM-DD') as week,
        count(*) as size,
        jsonb_build_array(
          count(*) filter (where date_trunc('milliseconds', p.last_seen) - date_trunc('milliseconds', p.created_at) >= interval '7 days'),
          count(*) filter (where date_trunc('milliseconds', p.last_seen) - date_trunc('milliseconds', p.created_at) >= interval '14 days'),
          count(*) filter (where date_trunc('milliseconds', p.last_seen) - date_trunc('milliseconds', p.created_at) >= interval '21 days'),
          count(*) filter (where date_trunc('milliseconds', p.last_seen) - date_trunc('milliseconds', p.created_at) >= interval '28 days')
        ) as kept
      from public.profiles p where p.created_at >= p_as_of - interval '70 days'
      group by 1
    ) c;
    -- Future-dated rows retain the existing report's semantics. Refuse an
    -- implausibly wide data set rather than silently returning a partial report.
    if jsonb_array_length(cohort_counts) > 1000 or jsonb_array_length(tier_counts) > 100 then
      raise exception 'REPORT_DIMENSIONS_EXCEED_LIMIT';
    end if;
    return result || jsonb_build_object('tiers', tier_counts, 'cohorts', cohort_counts);
  end if;

  with recent_reports as (
    select created_at from public.post_reports where created_at >= p_as_of - interval '30 days'
    union all
    select created_at from public.listing_reports where created_at >= p_as_of - interval '30 days'
    union all
    select created_at from public.user_reports where created_at >= p_as_of - interval '30 days'
  ), grouped as materialized (
    select (created_at at time zone 'UTC')::date as day, count(*) as n,
      count(*) filter (where created_at >= p_as_of - interval '7 days') as week,
      count(*) filter (where created_at >= p_as_of - interval '14 days' and created_at < p_as_of - interval '7 days') as previous_week
    from recent_reports group by 1
  )
  select jsonb_build_object(
    'series', (select jsonb_agg(coalesce(g.n, 0) order by d.day)
      from (select (p_as_of at time zone 'UTC')::date - 29 + i as day from generate_series(0, 29) i) d
      left join grouped g using (day)),
    'week', coalesce((select sum(week) from grouped), 0),
    'previous_week', coalesce((select sum(previous_week) from grouped), 0)
  ) into report_counts;

  select jsonb_build_object(
    'total', count(*),
    'reached_review', count(*) filter (where status in ('under_review', 'approved', 'rejected')),
    'approved', count(*) filter (where status = 'approved'),
    'rejected', count(*) filter (where status = 'rejected'),
    'week', count(*) filter (where created_at >= p_as_of - interval '7 days'),
    'previous_week', count(*) filter (where created_at >= p_as_of - interval '14 days' and created_at < p_as_of - interval '7 days')
  ) into application_counts from public.verification_applications;

  with grouped as (
    select (created_at at time zone 'UTC')::date as day, count(*) as n
    from public.verification_applications
    where created_at >= p_as_of - interval '30 days'
    group by 1
  )
  select application_counts || jsonb_build_object('series',
    jsonb_agg(coalesce(g.n, 0) order by d.day)) into application_counts
  from (select (p_as_of at time zone 'UTC')::date - 29 + i as day from generate_series(0, 29) i) d
  left join grouped g using (day);

  return result || jsonb_build_object('reports', report_counts, 'verifications', application_counts);
end;
$$;

-- requireDesk/session/role checks remain in the server page before this call.
-- Ordinary users cannot bypass that boundary through the public Data API.
revoke all on function public.admin_overview_summary(timestamptz, text) from public, anon, authenticated;
grant execute on function public.admin_overview_summary(timestamptz, text) to service_role;

commit;
