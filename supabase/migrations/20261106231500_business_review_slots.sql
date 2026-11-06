begin;
set local lock_timeout='3s';
alter table public.business_applications add column review_slot smallint;
with pending as (
  select id, row_number() over(partition by lower(btrim(contact_email)) order by created_at,id) as slot
  from public.business_applications where status='submitted'
)
update public.business_applications b set review_slot=p.slot from pending p where p.id=b.id;
alter table public.business_applications add constraint business_review_slot_valid check (
  case when status='submitted' then review_slot is not null and review_slot between 1 and 3 else review_slot is null end
);
create unique index business_review_contact_slot on public.business_applications(lower(btrim(contact_email)),review_slot)
  where status='submitted';

create function public.assign_business_review_slot() returns trigger
language plpgsql security definer set search_path='' as $$
declare contact text := lower(btrim(new.contact_email));
begin
  if new.status <> 'submitted' then new.review_slot := null; return new; end if;
  if tg_op='UPDATE' then
    if old.status='submitted' and lower(btrim(old.contact_email))=contact then
      new.review_slot := old.review_slot; return new;
    end if;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('business-review:'||contact,0));
  select s into new.review_slot from generate_series(1,3) s
    where not exists (select from public.business_applications a
      where a.status='submitted' and lower(btrim(a.contact_email))=contact and a.review_slot=s)
    order by s limit 1;
  if new.review_slot is null then raise exception 'BUSINESS_REVIEW_FULL' using errcode='PBR03'; end if;
  return new;
end;
$$;
revoke all on function public.assign_business_review_slot() from public, anon, authenticated, service_role;
create trigger assign_business_review_slot before insert or update of contact_email,status,review_slot
on public.business_applications for each row execute function public.assign_business_review_slot();
commit;
