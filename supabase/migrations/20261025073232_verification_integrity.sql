-- Verification is a reviewed identity assertion, never a self-editable profile flag.
-- Keep the existing admin command's session, permission, idempotency and audit checks.
create or replace function admin_ops.validate_verification_evidence(p_tier text, p_category text, p_evidence jsonb)
returns void language plpgsql immutable set search_path='' as $$
declare link jsonb; value text;
begin
 if p_tier is null or p_tier not in ('public_figure','business','official') then raise exception 'VERIFICATION_TIER_INVALID'; end if;
 if length(btrim(coalesce(p_category,''))) not between 2 and 120 then raise exception 'VERIFICATION_CATEGORY_REQUIRED'; end if;
 if jsonb_typeof(p_evidence) is distinct from 'object'
   or jsonb_typeof(p_evidence->'statement') is distinct from 'string'
   or length(btrim(p_evidence->>'statement')) not between 20 and 2000 then
   raise exception 'VERIFICATION_STATEMENT_REQUIRED';
 end if;
 if jsonb_typeof(p_evidence->'links') is distinct from 'array' then raise exception 'VERIFICATION_EVIDENCE_LINK_REQUIRED'; end if;
 if jsonb_array_length(p_evidence->'links') not between 1 and 8 then raise exception 'VERIFICATION_EVIDENCE_LINK_REQUIRED'; end if;
 for link in select * from jsonb_array_elements(p_evidence->'links') loop
  value := link #>> '{}';
  if jsonb_typeof(link) <> 'string' or length(value)>2048
    or value !~* '^https?://[^/@[:space:]]+([/?#][^[:space:]]*)?$'
    or value ~ '[[:cntrl:]]' or value like '%\%' then raise exception 'VERIFICATION_EVIDENCE_URL_INVALID'; end if;
 end loop;
 if p_tier='official' and (jsonb_typeof(p_evidence->'office') is distinct from 'string'
   or length(btrim(p_evidence->>'office')) not between 3 and 200) then raise exception 'VERIFICATION_OFFICE_REQUIRED'; end if;
end $$;
revoke all on function admin_ops.validate_verification_evidence(text,text,jsonb) from public,anon,authenticated;

create or replace function admin_ops.guard_profile_verification()
returns trigger language plpgsql security definer set search_path='' as $$
declare client_write boolean := current_setting('role',true) in ('anon','authenticated') or coalesce(auth.role(),'') in ('anon','authenticated');
begin
 if client_write then
  if TG_OP='INSERT' then
   if coalesce(new.is_verified,false) or new.verified_tier is not null or new.verified_category is not null then
    raise exception 'VERIFICATION_STAFF_REVIEW_REQUIRED' using errcode='42501';
   end if;
  else
   if new.is_verified is distinct from old.is_verified or new.verified_tier is distinct from old.verified_tier
      or new.verified_category is distinct from old.verified_category then
    raise exception 'VERIFICATION_STAFF_REVIEW_REQUIRED' using errcode='42501';
   end if;
   if old.is_verified and (new.username is distinct from old.username or new.full_name is distinct from old.full_name
      or new.account_type is distinct from old.account_type) then
    raise exception 'Verified identity changes require support review.' using errcode='42501';
   end if;
  end if;
 end if;
 return new;
end $$;
revoke all on function admin_ops.guard_profile_verification() from public,anon,authenticated;
drop trigger if exists guard_profile_verification on public.profiles;
create trigger guard_profile_verification before insert or update on public.profiles
for each row execute function admin_ops.guard_profile_verification();

alter table public.verification_applications drop constraint if exists verification_applications_status_check;
alter table public.verification_applications add constraint verification_applications_status_check
check (status in ('submitted','under_review','approved','rejected','revoked'));
alter table public.verification_applications add column if not exists revoked_at timestamptz;
create index if not exists verification_applications_applicant_created_idx
on public.verification_applications(applicant_id,created_at desc);

create or replace function admin_ops.guard_verification_application()
returns trigger language plpgsql security definer set search_path='' as $$
declare client_write boolean := current_setting('role',true) in ('anon','authenticated') or coalesce(auth.role(),'') in ('anon','authenticated');
 p public.profiles;
begin
 if client_write and TG_OP='UPDATE' then raise exception 'VERIFICATION_STAFF_REVIEW_REQUIRED' using errcode='42501'; end if;
 if TG_OP='INSERT' then
  if client_write and (new.applicant_id is distinct from auth.uid() or new.status<>'submitted'
    or new.reviewer_id is not null or new.decision_reason is not null or new.decided_at is not null or new.revoked_at is not null) then
   raise exception 'VERIFICATION_STAFF_REVIEW_REQUIRED' using errcode='42501';
  end if;
  -- Serialize submissions per account; avoids duplicate pending applications, even across devices.
  select * into p from public.profiles where id=new.applicant_id for update;
  if not found or p.deactivated_at is not null then raise exception 'VERIFICATION_ACCOUNT_UNAVAILABLE'; end if;
  if p.is_verified then raise exception 'VERIFICATION_ALREADY_ACTIVE'; end if;
  if exists(select 1 from public.verification_applications where applicant_id=new.applicant_id and status in ('submitted','under_review')) then
   raise exception 'VERIFICATION_ALREADY_PENDING';
  end if;
  perform admin_ops.validate_verification_evidence(new.tier,new.category,new.evidence);
  if (new.tier='business') is distinct from (coalesce(p.account_type,'personal')='business') then raise exception 'VERIFICATION_ACCOUNT_TYPE_MISMATCH'; end if;
  new.created_at := now();
 elsif new.status='approved' and old.status is distinct from 'approved' then
  if old.status not in ('submitted','under_review') then raise exception 'VERIFICATION_DECISION_FINAL'; end if;
  perform admin_ops.validate_verification_evidence(new.tier,new.category,new.evidence);
  select * into p from public.profiles where id=new.applicant_id for update;
  if not found or p.deactivated_at is not null then raise exception 'VERIFICATION_ACCOUNT_UNAVAILABLE'; end if;
  if (new.tier='business') is distinct from (coalesce(p.account_type,'personal')='business') then raise exception 'VERIFICATION_ACCOUNT_TYPE_MISMATCH'; end if;
  if new.reviewer_id is null or new.reviewer_id=new.applicant_id or new.decided_at is null
    or length(btrim(coalesce(new.decision_reason,''))) not between 20 and 2000 then
   raise exception 'VERIFICATION_REVIEW_BASIS_REQUIRED';
  end if;
  if not coalesce(p.is_verified,false) or p.verified_tier is distinct from new.tier then raise exception 'VERIFICATION_PROFILE_NOT_GRANTED'; end if;
 end if;
 return new;
end $$;
revoke all on function admin_ops.guard_verification_application() from public,anon,authenticated;
drop trigger if exists guard_verification_application on public.verification_applications;
create trigger guard_verification_application before insert or update on public.verification_applications
for each row execute function admin_ops.guard_verification_application();

create or replace function admin_ops.sync_verification_revocation()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.is_verified and not coalesce(new.is_verified,false) then
  update public.verification_applications set status='revoked',revoked_at=now()
  where applicant_id=new.id and status='approved';
 end if;
 return new;
end $$;
revoke all on function admin_ops.sync_verification_revocation() from public,anon,authenticated;
drop trigger if exists sync_verification_revocation on public.profiles;
create trigger sync_verification_revocation after update of is_verified on public.profiles
for each row execute function admin_ops.sync_verification_revocation();

-- Evidence is private to the applicant; staff read it through the protected admin server.
drop policy if exists vapps_select on public.verification_applications;
create policy vapps_select on public.verification_applications for select to authenticated using(applicant_id=(select auth.uid()));
revoke update,delete,truncate on public.verification_applications from anon,authenticated;
grant select,insert on public.verification_applications to authenticated;

-- A report enters the moderation queue; reporters cannot mark it resolved at submission.
drop policy if exists user_reports_submission_integrity on public.user_reports;
create policy user_reports_submission_integrity on public.user_reports as restrictive
for insert to authenticated with check (
 reporter_id=(select auth.uid()) and status='open' and resolved_by is null and resolved_at is null
 and char_length(coalesce(details,''))<=2000
);
