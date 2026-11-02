begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
lock table public.profiles,public.post_reports,public.listing_reports,public.user_reports,
 public.verification_applications in share row exclusive mode nowait;
create schema admin_reporting;
revoke all on schema admin_reporting from public,anon,authenticated,service_role;
create table admin_reporting.settings(singleton boolean primary key default true check(singleton),
 enabled boolean not null default false,last_reconciled_at timestamptz not null default clock_timestamp());
insert into admin_reporting.settings(singleton) values(true);
create table admin_reporting.profile_facts(
 id uuid primary key,created_at timestamptz,last_seen timestamptz,
 k1 integer not null,k2 integer not null,k3 integer not null,k4 integer not null
);
create index profile_facts_created on admin_reporting.profile_facts(created_at);
create index profile_facts_last_seen on admin_reporting.profile_facts(last_seen);
create table admin_reporting.cells(
 kind text not null,bucket timestamptz not null,dimension bytea not null,
 shard smallint not null check(shard between 0 and 255),key text collate pg_catalog."C" not null,
 label text collate pg_catalog."C" not null,n bigint not null default 0,
 k1 bigint not null default 0,k2 bigint not null default 0,k3 bigint not null default 0,k4 bigint not null default 0,
 primary key(kind,bucket,dimension,shard),
 check(n>=0 and k1>=0 and k2>=0 and k3>=0 and k4>=0)
);
alter table admin_reporting.settings enable row level security;
alter table admin_reporting.profile_facts enable row level security;
alter table admin_reporting.cells enable row level security;
revoke all on all tables in schema admin_reporting from public,anon,authenticated,service_role;

-- Exact sufficient statistics. Heartbeats inside one minute do not rewrite an
-- aggregate unless they cross a retention boundary. Global totals and popular
-- cities are spread over 256 stable member shards rather than one hot row.
create function admin_reporting.contributions(p jsonb,p_table text)
returns table(kind text,bucket timestamptz,key text,label text,n bigint,k1 bigint,k2 bigint,k3 bigint,k4 bigint)
language plpgsql immutable set search_path='' set timezone='UTC' as $$
declare created timestamptz:=(p->>'created_at')::timestamptz;seen timestamptz:=(p->>'last_seen')::timestamptz;
 age interval;verified boolean:=coalesce((p->>'is_verified')::boolean,false);business boolean:=p->>'account_type'='business';
begin
 bucket:='-infinity';key:='';label:='';n:=1;k1:=0;k2:=0;k3:=0;k4:=0;
 if p_table='profiles' then
   kind:='profiles';k1:=coalesce(business,false)::int;k2:=verified::int;k3:=(coalesce(business,false) and verified)::int;return next;
   k1:=0;k2:=0;k3:=0;
   label:=btrim(regexp_replace(coalesce(p->>'location',''),
     U&'[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]+',' ','g'));
   if label<>'' then kind:='location';key:=lower(label collate pg_catalog."und-x-icu");return next;end if;
   label:='';key:='';
   if verified then kind:='tier';key:=coalesce(nullif(p->>'verified_tier',''),'unrecorded');return next;key:='';end if;
   if created is not null then
     kind:='cohort';bucket:=date_trunc('day',created at time zone 'UTC') at time zone 'UTC';
     age:=date_trunc('milliseconds',seen)-date_trunc('milliseconds',created);
     k1:=coalesce(age>=interval '7 days',false)::int;k2:=coalesce(age>=interval '14 days',false)::int;
     k3:=coalesce(age>=interval '21 days',false)::int;k4:=coalesce(age>=interval '28 days',false)::int;return next;
   end if;
   if seen is not null then
     kind:='active';bucket:=date_trunc('minute',seen at time zone 'UTC') at time zone 'UTC';k1:=0;k2:=0;k3:=0;k4:=0;return next;
   end if;
 elsif p_table='verification_applications' then
   kind:='applications';k1:=coalesce(p->>'status' in('under_review','approved','rejected'),false)::int;
   k2:=coalesce(p->>'status'='approved',false)::int;k3:=coalesce(p->>'status'='rejected',false)::int;return next;
   if created is not null then
     kind:='application_day';bucket:=date_trunc('day',created at time zone 'UTC') at time zone 'UTC';k1:=0;k2:=0;k3:=0;return next;
   end if;
 elsif p_table in('post_reports','listing_reports','user_reports') and created is not null then
   kind:='report_day';bucket:=date_trunc('day',created at time zone 'UTC') at time zone 'UTC';return next;
 else raise exception 'UNKNOWN_REPORTING_TABLE';end if;
end $$;

create function admin_reporting.apply_changes()
returns trigger language plpgsql security definer set search_path='' as $$
declare changes text;selected text;change record;
begin
 if tg_level<>'STATEMENT' or tg_when<>'AFTER' or tg_table_schema<>'public' then raise exception 'INVALID_REPORTING_TRIGGER';end if;
 selected:=case when tg_table_name='profiles'
   then 'id,created_at,last_seen,account_type,is_verified,verified_tier,location' else '*' end;
 if tg_op='INSERT' then changes:=format('select to_jsonb(r) p,1 sign from(select %s from new_rows)r',selected);
 elsif tg_op='DELETE' then changes:=format('select to_jsonb(r) p,-1 sign from(select %s from old_rows)r',selected);
 elsif tg_op='UPDATE' then changes:=format('select to_jsonb(r) p,1 sign from(select %s from new_rows)r
   union all select to_jsonb(r) p,-1 sign from(select %s from old_rows)r',selected,selected);
 else raise exception 'INVALID_REPORTING_OPERATION';end if;
 for change in execute format('select c.kind,c.bucket,c.key,c.label,
   sha256(convert_to(jsonb_build_array(c.key,c.label)::text,''UTF8'')) dimension,
   get_byte(decode(md5(coalesce(p->>''id'',p::text)),''hex''),0)::smallint shard,
   sum(sign*c.n)::bigint n,sum(sign*c.k1)::bigint k1,sum(sign*c.k2)::bigint k2,sum(sign*c.k3)::bigint k3,sum(sign*c.k4)::bigint k4
   from (%s) changed cross join lateral admin_reporting.contributions(changed.p,%L)c
   group by c.kind,c.bucket,c.key,c.label,shard
   having sum(sign*c.n)<>0 or sum(sign*c.k1)<>0 or sum(sign*c.k2)<>0 or sum(sign*c.k3)<>0 or sum(sign*c.k4)<>0
   order by c.kind,c.bucket,dimension,shard',changes,tg_table_name)
 loop
   insert into admin_reporting.cells(kind,bucket,dimension,shard,key,label)
     values(change.kind,change.bucket,change.dimension,change.shard,change.key,change.label) on conflict do nothing;
   update admin_reporting.cells c set n=c.n+change.n,k1=c.k1+change.k1,k2=c.k2+change.k2,k3=c.k3+change.k3,k4=c.k4+change.k4
   where c.kind=change.kind and c.bucket=change.bucket and c.dimension=change.dimension and c.shard=change.shard
     and c.key=change.key and c.label=change.label;
   if not found then raise exception 'REPORT_DIMENSION_COLLISION';end if;
   delete from admin_reporting.cells c where c.kind=change.kind and c.bucket=change.bucket and c.dimension=change.dimension
     and c.shard=change.shard and c.n=0 and c.k1=0 and c.k2=0 and c.k3=0 and c.k4=0;
 end loop;
 if tg_table_name='profiles' then
   if tg_op<>'INSERT' then
     execute 'delete from admin_reporting.profile_facts f using old_rows o where f.id=o.id';
   end if;
   if tg_op<>'DELETE' then
     execute 'insert into admin_reporting.profile_facts(id,created_at,last_seen,k1,k2,k3,k4)
       select p.id,p.created_at,p.last_seen,
         coalesce(date_trunc(''milliseconds'',p.last_seen)-date_trunc(''milliseconds'',p.created_at)>=interval ''7 days'',false)::int,
         coalesce(date_trunc(''milliseconds'',p.last_seen)-date_trunc(''milliseconds'',p.created_at)>=interval ''14 days'',false)::int,
         coalesce(date_trunc(''milliseconds'',p.last_seen)-date_trunc(''milliseconds'',p.created_at)>=interval ''21 days'',false)::int,
         coalesce(date_trunc(''milliseconds'',p.last_seen)-date_trunc(''milliseconds'',p.created_at)>=interval ''28 days'',false)::int
       from new_rows p order by p.id';
   end if;
 end if;
 return null;
end $$;

-- Bootstrap under the same short writer fence as trigger installation. This is
-- a one-time operation. Neither reporting requests nor cron rebuild all users.
do $$declare target text;
begin
 foreach target in array array['profiles','post_reports','listing_reports','user_reports','verification_applications'] loop
   execute format('insert into admin_reporting.cells(kind,bucket,dimension,shard,key,label,n,k1,k2,k3,k4)
     select c.kind,c.bucket,sha256(convert_to(jsonb_build_array(c.key,c.label)::text,''UTF8'')),
       get_byte(decode(md5(coalesce(p->>''id'',p::text)),''hex''),0)::smallint,c.key,c.label,
       sum(c.n),sum(c.k1),sum(c.k2),sum(c.k3),sum(c.k4)
     from(select to_jsonb(t)p from public.%I t)r cross join lateral admin_reporting.contributions(r.p,%L)c
     group by c.kind,c.bucket,c.key,c.label,get_byte(decode(md5(coalesce(p->>''id'',p::text)),''hex''),0)
     on conflict(kind,bucket,dimension,shard) do update set n=cells.n+excluded.n,k1=cells.k1+excluded.k1,
       k2=cells.k2+excluded.k2,k3=cells.k3+excluded.k3,k4=cells.k4+excluded.k4',target,target);
   execute format('create trigger admin_report_insert after insert on public.%I referencing new table as new_rows
     for each statement execute function admin_reporting.apply_changes()',target);
   execute format('create trigger admin_report_update after update on public.%I referencing old table as old_rows new table as new_rows
     for each statement execute function admin_reporting.apply_changes()',target);
   execute format('create trigger admin_report_delete after delete on public.%I referencing old table as old_rows
     for each statement execute function admin_reporting.apply_changes()',target);
 end loop;
end $$;
insert into admin_reporting.profile_facts
select p.id,p.created_at,p.last_seen,
 coalesce(date_trunc('milliseconds',p.last_seen)-date_trunc('milliseconds',p.created_at)>=interval '7 days',false)::int,
 coalesce(date_trunc('milliseconds',p.last_seen)-date_trunc('milliseconds',p.created_at)>=interval '14 days',false)::int,
 coalesce(date_trunc('milliseconds',p.last_seen)-date_trunc('milliseconds',p.created_at)>=interval '21 days',false)::int,
 coalesce(date_trunc('milliseconds',p.last_seen)-date_trunc('milliseconds',p.created_at)>=interval '28 days',false)::int
from public.profiles p;
create index if not exists post_reports_reporting_time on public.post_reports(created_at);
create index if not exists listing_reports_reporting_time on public.listing_reports(created_at);
create index if not exists user_reports_reporting_time on public.user_reports(created_at);
create index if not exists verification_applications_reporting_time on public.verification_applications(created_at);

create function admin_reporting.since(p_kind text,p_since timestamptz)
returns bigint language plpgsql stable set search_path='' set timezone='UTC' as $$
declare boundary timestamptz;total bigint;edge bigint;
begin
 boundary:=date_trunc(case when p_kind='active' then 'minute' else 'day' end,p_since at time zone 'UTC') at time zone 'UTC';
 if boundary=p_since then
   select coalesce(sum(n),0) into total from admin_reporting.cells where kind=p_kind and bucket>=boundary;return total;
 end if;
 select coalesce(sum(n),0) into total from admin_reporting.cells where kind=p_kind and bucket>boundary;
 if p_kind='active' then select count(*) into edge from admin_reporting.profile_facts where last_seen>=p_since and last_seen<boundary+interval '1 minute';
 elsif p_kind='application_day' then select count(*) into edge from public.verification_applications where created_at>=p_since and created_at<boundary+interval '1 day';
 elsif p_kind='report_day' then
   select count(*) into edge from(
     select 1 from public.post_reports where created_at>=p_since and created_at<boundary+interval '1 day'
     union all select 1 from public.listing_reports where created_at>=p_since and created_at<boundary+interval '1 day'
     union all select 1 from public.user_reports where created_at>=p_since and created_at<boundary+interval '1 day'
   )r;
 else raise exception 'UNKNOWN_REPORTING_WINDOW';end if;
 return total+edge;
end $$;

alter function public.admin_overview_summary(timestamptz,text) rename to admin_overview_summary_before_projection_v1;
create function public.admin_overview_summary(p_as_of timestamptz,p_scope text)
returns jsonb language plpgsql stable security definer set search_path='' set timezone='UTC' as $$
declare result jsonb;profiles jsonb;locations jsonb;tiers jsonb;cohorts jsonb;reports jsonb;applications jsonb;series jsonb;
 cutoff timestamptz;boundary timestamptz;week bigint;previous bigint;first_day timestamptz;
begin
 if p_as_of is null or not pg_catalog.isfinite(p_as_of) or p_scope is null or p_scope not in('dashboard','analytics') then raise exception 'INVALID_REPORT_ARGUMENT';end if;
 if not (select enabled from admin_reporting.settings where singleton) then
   return public.admin_overview_summary_before_projection_v1(p_as_of,p_scope);
 end if;
 select jsonb_build_object('members',coalesce(sum(n),0),'businesses',coalesce(sum(k1),0),'verified',coalesce(sum(k2),0),
   'business_verified',coalesce(sum(k3),0),'active',admin_reporting.since('active',p_as_of-interval '5 minutes'))
 into profiles from admin_reporting.cells where kind='profiles';
 with grouped as materialized(
   select key,min(label collate pg_catalog."C") label,sum(n) n from admin_reporting.cells where kind='location' group by key
 ) select jsonb_build_object('located',coalesce((select sum(n) from grouped),0),
   'locations',coalesce((select jsonb_agg(to_jsonb(l) order by n desc,label collate pg_catalog."C")
     from(select label,n from grouped order by n desc,label collate pg_catalog."C" limit 8)l),'[]'::jsonb)) into locations;
 result:=jsonb_build_object('version',1,'as_of',p_as_of,'profiles',profiles||locations);
 if p_scope='analytics' then
   select coalesce(jsonb_agg(to_jsonb(t) order by key),'[]'::jsonb) into tiers
   from(select key,sum(n) n from admin_reporting.cells where kind='tier' group by key)t;
   cutoff:=p_as_of-interval '70 days';boundary:=date_trunc('day',cutoff at time zone 'UTC') at time zone 'UTC';
   with daily as (
     select bucket as cohort_day,n,k1,k2,k3,k4 from admin_reporting.cells where kind='cohort' and bucket>boundary
     union all select boundary,1,k1,k2,k3,k4 from admin_reporting.profile_facts where created_at>=cutoff and created_at<boundary+interval '1 day'
   ), grouped as (
     select to_char(date_trunc('week',cohort_day at time zone 'UTC'),'YYYY-MM-DD') week,sum(n) size,
       jsonb_build_array(sum(k1),sum(k2),sum(k3),sum(k4)) kept from daily group by 1
   )select coalesce(jsonb_agg(to_jsonb(c) order by c.week desc),'[]'::jsonb) into cohorts from grouped c;
   if jsonb_array_length(cohorts)>1000 or jsonb_array_length(tiers)>100 then raise exception 'REPORT_DIMENSIONS_EXCEED_LIMIT';end if;
   return result||jsonb_build_object('tiers',tiers,'cohorts',cohorts);
 end if;
 first_day:=(p_as_of at time zone 'UTC')::date at time zone 'UTC';
 select jsonb_agg(coalesce(n,0) order by day) into series
 from generate_series(first_day-interval '29 days',first_day,interval '1 day')day
 left join(select bucket,sum(n)n from admin_reporting.cells where kind='report_day' and bucket>=first_day-interval '29 days' and bucket<=first_day group by bucket)c on c.bucket=day;
 week:=admin_reporting.since('report_day',p_as_of-interval '7 days');
 previous:=admin_reporting.since('report_day',p_as_of-interval '14 days')-week;
 reports:=jsonb_build_object('series',series,'week',week,'previous_week',previous);
 select jsonb_build_object('total',coalesce(sum(n),0),'reached_review',coalesce(sum(k1),0),'approved',coalesce(sum(k2),0),'rejected',coalesce(sum(k3),0))
 into applications from admin_reporting.cells where kind='applications';
 select jsonb_agg(coalesce(n,0) order by day) into series
 from generate_series(first_day-interval '29 days',first_day,interval '1 day')day
 left join(select bucket,sum(n)n from admin_reporting.cells where kind='application_day' and bucket>=first_day-interval '29 days' and bucket<=first_day group by bucket)c on c.bucket=day;
 week:=admin_reporting.since('application_day',p_as_of-interval '7 days');
 previous:=admin_reporting.since('application_day',p_as_of-interval '14 days')-week;
 return result||jsonb_build_object('reports',reports,'verifications',applications||jsonb_build_object('series',series,'week',week,'previous_week',previous));
end $$;
create function public.configure_admin_reporting_v1(p_enabled boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
 if p_enabled is null then raise exception 'INVALID_REPORT_CONFIGURATION';end if;
 update admin_reporting.settings set enabled=p_enabled where singleton;
end $$;
create function public.admin_reporting_status_v1()
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('version',1,'enabled',enabled,'last_reconciled_at',last_reconciled_at,'transactional',true,
 'profile_shards',256,'heartbeat_bucket_seconds',60) from admin_reporting.settings where singleton;
$$;
revoke all on all functions in schema admin_reporting from public,anon,authenticated,service_role;
revoke all on function public.admin_overview_summary(timestamptz,text),
 public.configure_admin_reporting_v1(boolean),public.admin_reporting_status_v1() from public,anon,authenticated;
grant execute on function public.admin_overview_summary(timestamptz,text),
 public.configure_admin_reporting_v1(boolean),public.admin_reporting_status_v1() to service_role;
notify pgrst,'reload schema';
commit;
