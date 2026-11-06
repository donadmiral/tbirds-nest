begin;
-- NULL dates on legacy decisions sort after dated rows. UUID breaks ties.
create index business_application_decision_history on public.business_applications
  ((coalesce(decided_at, '-infinity'::timestamptz)) desc, id desc)
  where status <> 'submitted';

-- The server checks the staff session and /businesses desk permission before
-- using the service client. Members cannot call this cross-account report.
create function public.admin_business_decision_page(p_before_at timestamptz, p_before_id uuid)
returns table(id uuid, company_name text, desired_username text, status text, decision_reason text, decided_at timestamptz)
language sql stable security invoker set search_path = '' as $$
  select a.id, a.company_name, a.desired_username, a.status, a.decision_reason, a.decided_at
  from public.business_applications a
  where a.status <> 'submitted'
    and (coalesce(a.decided_at,'-infinity'::timestamptz),a.id) <
        (case when p_before_id is null then 'infinity'::timestamptz else coalesce(p_before_at,'-infinity'::timestamptz) end,
         coalesce(p_before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
  order by coalesce(a.decided_at,'-infinity'::timestamptz) desc, a.id desc
  limit 26;
$$;
revoke all on function public.admin_business_decision_page(timestamptz,uuid) from public, anon, authenticated;
grant execute on function public.admin_business_decision_page(timestamptz,uuid) to service_role;
notify pgrst, 'reload schema';
commit;
