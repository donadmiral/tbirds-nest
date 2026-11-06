begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

create schema prepared_feed;
revoke all on schema prepared_feed from public,anon,service_role;
grant usage on schema prepared_feed to authenticated;

do $$begin
 if exists(select 1 from pg_roles where rolname='prepared_feed_reader') then
  raise exception 'PREPARED_FEED_ROLE_ALREADY_EXISTS';
 end if;
 create role prepared_feed_reader nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
 execute format('grant prepared_feed_reader to %I',current_user);
end$$;
-- Explicit inheritance lets canonical INVOKER reads retain the same policy role.
alter role prepared_feed_reader inherit;
grant authenticated to prepared_feed_reader;
grant usage on schema prepared_feed to prepared_feed_reader;

create table prepared_feed.settings(singleton boolean primary key default true check(singleton),enabled boolean not null default false);
insert into prepared_feed.settings values(true,false);
create table prepared_feed.demand(
 viewer_id uuid not null references public.profiles(id) on delete cascade,
 scope text not null check(length(scope)=32), mode text not null check(mode in('for_you','following','trending','innovation')),
 revision bigint not null default 1, claims jsonb not null check(octet_length(claims::text)<=8192),
 requested_at timestamptz not null default clock_timestamp(), available_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null, prepared_at timestamptz, failures integer not null default 0 check(failures between 0 and 6),
 primary key(viewer_id,scope,mode)
);
create index prepared_feed_demand_due on prepared_feed.demand(available_at,viewer_id) where failures<6;
create index prepared_feed_demand_expiry on prepared_feed.demand(expires_at);
create sequence prepared_feed.cursor_sequence minvalue 1 maxvalue 1000000000000 no cycle;
create table prepared_feed.snapshots(
 id uuid primary key default gen_random_uuid(), cursor_serial bigint not null unique default nextval('prepared_feed.cursor_sequence'), viewer_id uuid not null references public.profiles(id) on delete cascade,
 scope text not null,mode text not null,revision bigint not null,
 ids uuid[] not null,keys double precision[] not null,
 created_at timestamptz not null default clock_timestamp(),fresh_until timestamptz not null,expires_at timestamptz not null,
 check(cardinality(ids)=cardinality(keys) and cardinality(ids)<=200),
 check(fresh_until<=expires_at)
);
create index prepared_feed_snapshot_lookup on prepared_feed.snapshots(viewer_id,scope,mode,created_at desc);
create index prepared_feed_snapshot_expiry on prepared_feed.snapshots(expires_at);
alter table prepared_feed.settings enable row level security;
alter table prepared_feed.demand enable row level security;
alter table prepared_feed.snapshots enable row level security;
create policy prepared_demand_read on prepared_feed.demand for select to authenticated using(viewer_id=(select auth.uid()));
create policy prepared_snapshot_read on prepared_feed.snapshots for select to authenticated using(viewer_id=(select auth.uid()));
revoke all on all tables in schema prepared_feed from public,anon,authenticated,service_role;
grant select on prepared_feed.demand,prepared_feed.snapshots to authenticated;

create function prepared_feed.scope()
returns text language sql stable security invoker set search_path='' as $$
 select md5(jsonb_build_object('sub',auth.uid(),'session',auth.jwt()->'session_id','role',auth.jwt()->'role','app',auth.jwt()->'app_metadata')::text)
$$;
alter policy prepared_demand_read on prepared_feed.demand using(viewer_id=(select auth.uid()) and scope=(select prepared_feed.scope()));
alter policy prepared_snapshot_read on prepared_feed.snapshots using(viewer_id=(select auth.uid()) and scope=(select prepared_feed.scope()));
create function prepared_feed.enabled()
returns boolean language sql stable security definer set search_path='' as $$select enabled from prepared_feed.settings where singleton$$;

-- Claims originate in the verified PostgREST context, never a caller argument.
-- No bearer token, media capability, full card or profile body is persisted.
create function prepared_feed.request(p_mode text)
returns void language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid();claim jsonb:=auth.jwt();until_at timestamptz;cache_scope text;
begin
 if actor is null or claim->>'role' is distinct from 'authenticated' or p_mode is null or p_mode not in('for_you','following','trending','innovation')
   or not prepared_feed.enabled() then return;end if;
 if coalesce(claim->>'exp','')!~'^[0-9]{1,12}$' or octet_length(claim::text)>8192 then return;end if;
 until_at:=least(to_timestamp((claim->>'exp')::double precision),clock_timestamp()+interval '10 minutes');
 if until_at<=clock_timestamp()+interval '15 seconds' then return;end if;
 cache_scope:=prepared_feed.scope();
 -- A renderer must not wait behind background ranking of the same demand.
 begin
  perform 1 from prepared_feed.demand d where (d.viewer_id,d.scope,d.mode)=(actor,cache_scope,p_mode) for update nowait;
 exception when lock_not_available then return;end;
 insert into prepared_feed.demand(viewer_id,scope,mode,claims,expires_at)
 values(actor,cache_scope,p_mode,claim,until_at)
 on conflict(viewer_id,scope,mode) do update set claims=excluded.claims,expires_at=excluded.expires_at,
 requested_at=excluded.requested_at,
 available_at=case when prepared_feed.demand.expires_at<clock_timestamp() then clock_timestamp() else prepared_feed.demand.available_at end,
 failures=case when prepared_feed.demand.expires_at<clock_timestamp() then 0 else prepared_feed.demand.failures end;
end$$;
revoke all on schema prepared_feed from public,anon,authenticated,service_role;
revoke all on all tables in schema prepared_feed from public,anon,authenticated,service_role;
revoke all on all functions in schema prepared_feed from public,anon,authenticated,service_role;
comment on schema prepared_feed is 'prepared-feed:f6efa6982b921d1f8495b82868880d61f52ab15d9b856962329cdb8ac32af8dc:1';
commit;
