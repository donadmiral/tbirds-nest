-- Rehearse the database guard without committing synthetic applications.
begin;
set local statement_timeout='8s';
do $proof$
declare contact text := 'pc-review-'||gen_random_uuid()||'@example.invalid'; i integer;
begin
  for i in 1..3 loop
    insert into public.business_applications(company_name,description,contact_email,desired_username)
    values('Acceptance fixture','Synthetic application',case when i=2 then upper(contact) else contact end,'pc_fixture');
  end loop;
  begin
    insert into public.business_applications(company_name,description,contact_email,desired_username)
    values('Acceptance fixture','Synthetic application',contact,'pc_fixture');
    raise exception 'Fourth application accepted';
  exception when sqlstate 'PBR03' then null;
  end;
  update public.business_applications set status='rejected' where lower(contact_email)=contact and review_slot=2;
  insert into public.business_applications(company_name,description,contact_email,desired_username)
  values('Acceptance fixture','Synthetic application',contact,'pc_fixture_retry');
  if not exists(select from public.business_applications where contact_email=contact and desired_username='pc_fixture_retry' and review_slot=2) then
    raise exception 'Reviewed slot was not reused';
  end if;
end $proof$;
select true as fourth_refused, true as reviewed_slot_reused;
rollback;
