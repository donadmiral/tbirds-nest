-- Operating target, not a provider reservation. Installing it never opens a slot.
set local lock_timeout='3s';
create table live_streams.capacity_tiers (
 broadcasts integer primary key,
 peak_room_viewers integer not null check (peak_room_viewers>0),
 other_room_viewers integer not null check(other_room_viewers>=1),
 previous_cap integer not null check(previous_cap>=10 and previous_cap<broadcasts)
);
insert into live_streams.capacity_tiers values
 (25,2500,100,10),(100,10000,100,25),(250,25000,100,100),(500,50000,100,250),(1000,100000,100,500);
-- Only the database operator may attest a retained and reviewed report after
-- validating its bytes with live-standard.cjs. No API or service-role writes.
create table live_streams.capacity_qualifications (
 evidence_sha256 text primary key check(evidence_sha256 ~ '^[0-9a-f]{64}$'),
 source_revision text not null check(source_revision ~ '^[0-9a-f]{40}$'),
 tier integer not null references live_streams.capacity_tiers(broadcasts),
 report_url text not null check (report_url like 'https://%' and length(report_url)<=1000),
 observed_until timestamptz not null,
 reviewed_at timestamptz not null default now(),
 consumed_at timestamptz,
 check(observed_until<=reviewed_at and observed_until>=reviewed_at-interval '30 days')
);
create index live_capacity_qualification_tier on live_streams.capacity_qualifications(tier);
alter table live_streams.capacity_tiers enable row level security;
alter table live_streams.capacity_qualifications enable row level security;
revoke all on table live_streams.capacity_tiers,live_streams.capacity_qualifications from public,anon,authenticated,service_role;

create function live_streams.require_capacity_qualification() returns trigger
language plpgsql security invoker set search_path='' as $$
declare prior integer; accepted text;
begin
 if new.max_active_broadcasts<=old.max_active_broadcasts or new.max_active_broadcasts<=10 then
  -- Operators can always reduce admission; never interrupt an existing stream.
  return new;
 end if;
 select previous_cap into prior from live_streams.capacity_tiers where broadcasts=new.max_active_broadcasts;
 if prior is null or old.max_active_broadcasts<>prior then
  raise exception 'LIVE_CAPACITY_TIER_ORDER';end if;
 update live_streams.capacity_qualifications set consumed_at=statement_timestamp()
 where evidence_sha256=new.capacity_evidence_ref and tier=new.max_active_broadcasts and consumed_at is null
 and observed_until between statement_timestamp()-interval '30 days' and statement_timestamp()
 returning evidence_sha256 into accepted;
 if accepted is null then raise exception 'LIVE_CAPACITY_EVIDENCE_REQUIRED';end if;
 return new;
end $$;
revoke all on function live_streams.require_capacity_qualification() from public,anon,authenticated,service_role;
create trigger live_admission_qualification before update of max_active_broadcasts on live_streams.settings
for each row execute function live_streams.require_capacity_qualification();
