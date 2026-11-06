-- Prepared ranking is an opt-in acceleration. Authorization and full card
-- hydration always run again under the requesting member's current RLS.
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

-- Capture the exact existing return contract. Existing clients need no new
-- cursor or media format. The immutable selected snapshot owns its cursor.
do $$declare result_type text;projection text;
begin
 select pg_get_function_result(p.oid),string_agg(case when name='sort_key' then 'chosen.key' else 'card.'||quote_ident(name) end,', ' order by ord)
 into result_type,projection from pg_proc p,unnest(p.proargnames,p.proargmodes) with ordinality a(name,mode,ord)
 where p.oid='public.get_feed(text,double precision,uuid,integer)'::regprocedure and mode='t' group by p.oid;
 if result_type is null or to_regprocedure('public.get_feed_rows_by_ids_v1(uuid[])') is null then raise exception 'PREPARED_FEED_CANONICAL_CONTRACT_REQUIRED';end if;
 alter function public.get_feed(text,double precision,uuid,integer) set schema prepared_feed;
 alter function prepared_feed.get_feed(text,double precision,uuid,integer) rename to canonical;
 execute format('create function prepared_feed.tail(p_mode text,p_key double precision,p_id uuid,p_limit integer,p_exclude uuid[])
 returns %s language plpgsql volatile security invoker set search_path='''' as $tail$
 declare cursor_key double precision:=p_key;cursor_id uuid:=p_id;remaining integer:=p_limit;emitted integer;next_key double precision;next_id uuid;
 begin
  -- At most 200 prepared IDs can overlap the recalculated tail. Five bounded
  -- 50-row reads cover those overlaps plus the largest requested page.
  for batch in 1..5 loop
   return query select c.* from prepared_feed.canonical(p_mode,cursor_key,cursor_id,50)c
    where not(c.post_id=any(p_exclude)) order by c.sort_key desc,c.post_id desc limit remaining;
   get diagnostics emitted=row_count;remaining:=remaining-emitted;exit when remaining<=0;
   select c.sort_key,c.post_id into next_key,next_id from prepared_feed.canonical(p_mode,cursor_key,cursor_id,50)c
    order by c.sort_key,c.post_id limit 1;
   exit when next_id is null or (next_key,next_id) is not distinct from (cursor_key,cursor_id);
   cursor_key:=next_key;cursor_id:=next_id;
  end loop;
 end $tail$',result_type);
 execute format('create function public.get_feed(p_mode text default ''for_you'',p_cursor_key double precision default null,p_cursor_id uuid default null,p_limit integer default 20)
 returns %s language plpgsql volatile security invoker set search_path='''' as $body$
 declare saved prepared_feed.snapshots; actor uuid:=auth.uid();cache_scope text:=prepared_feed.scope();lim integer:=least(coalesce(p_limit,20),50);emitted integer;
 begin
  if actor is null then raise exception ''Authentication required'' using errcode=''42501'';end if;
  if not prepared_feed.enabled() or p_mode is null or p_mode not in(''for_you'',''following'',''trending'',''innovation'') then
   if p_cursor_key<=-4000000000000000 then raise exception ''PREPARED_FEED_CURSOR_EXPIRED'' using errcode=''22023'';end if;
   return query select * from prepared_feed.canonical(p_mode,p_cursor_key,p_cursor_id,p_limit);return;
  end if;
  perform prepared_feed.request(p_mode);
  if p_cursor_key is null and p_cursor_id is null then
   select s.* into saved from prepared_feed.snapshots s join prepared_feed.demand d
    on (d.viewer_id,d.scope,d.mode,d.revision)=(s.viewer_id,s.scope,s.mode,s.revision)
    where s.viewer_id=actor and s.scope=cache_scope and s.mode=p_mode and s.fresh_until>clock_timestamp()
    order by s.created_at desc,s.id desc limit 1;
  elsif p_cursor_key<=-4000000000000000 and p_cursor_id is not null then
   select s.* into saved from prepared_feed.snapshots s
    where s.viewer_id=actor and s.scope=cache_scope and s.mode=p_mode and s.expires_at>clock_timestamp()
    and s.cursor_serial=floor((-4000000000000000-p_cursor_key)/256)::bigint
    and exists(select 1 from unnest(s.ids) with ordinality u(id,ord) where u.id=p_cursor_id and (-4000000000000000-s.cursor_serial*256-u.ord)::double precision=p_cursor_key)
    order by s.created_at desc,s.id desc limit 1;
  end if;
  if saved.id is null and p_cursor_key<=-4000000000000000 then raise exception ''PREPARED_FEED_CURSOR_EXPIRED'' using errcode=''22023'';end if;
  if saved.id is null then
   return query select * from prepared_feed.canonical(p_mode,p_cursor_key,p_cursor_id,p_limit);return;
  end if;
  if p_cursor_key=(-4000000000000000-saved.cursor_serial*256-cardinality(saved.ids))::double precision then
   return query select * from prepared_feed.tail(p_mode,saved.keys[cardinality(saved.keys)],p_cursor_id,p_limit,saved.ids);return;
  end if;
  -- At most 200 IDs, split into two canonical hydration batches. Rechecking
  -- beyond the visible page fills gaps left by revoked/deleted/hidden rows.
  return query with candidates as materialized(
   select u.id,(-4000000000000000-saved.cursor_serial*256-u.ord)::double precision key,u.ord
   from unnest(saved.ids) with ordinality u(id,ord)
   where p_cursor_key is null or (-4000000000000000-saved.cursor_serial*256-u.ord)::double precision<p_cursor_key
  ),chunks as(select array_agg(id order by ord) ids from candidates group by (ord-1)/100),
  cards as materialized(select c.* from chunks cross join lateral public.get_feed_rows_by_ids_v1(chunks.ids)c),
  chosen as(select p.* from candidates p join cards c on c.post_id=p.id order by p.ord limit lim)
  select %s from chosen join cards card on card.post_id=chosen.id order by chosen.ord;
  get diagnostics emitted=row_count;
  if emitted<lim and cardinality(saved.ids)=200 then
   return query select * from prepared_feed.tail(p_mode,saved.keys[200],saved.ids[200],lim-emitted,saved.ids);
  end if;
 end $body$',result_type,projection);
end$$;

-- Rank work executes with authenticated privileges, never service-role RLS
-- bypass. This function is private and callable only by the owning dispatcher.
create function prepared_feed.rank(p_claims jsonb,p_mode text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare previous_claims text:=current_setting('request.jwt.claims',true);previous_sub text:=current_setting('request.jwt.claim.sub',true);
 rows jsonb:='[]';batch jsonb;cursor_key double precision;cursor_id uuid;count_rows integer;
begin
 if p_claims->>'role' is distinct from 'authenticated' or coalesce(p_claims->>'exp','')!~'^[0-9]{1,12}$'
  or to_timestamp((p_claims->>'exp')::double precision)<=clock_timestamp() then raise exception 'PREPARED_FEED_SESSION_EXPIRED';end if;
 perform set_config('request.jwt.claims',p_claims::text,true);
 perform set_config('request.jwt.claim.sub',p_claims->>'sub',true);
 if auth.uid() is null then raise exception 'PREPARED_FEED_IDENTITY_REQUIRED';end if;
 for page in 1..4 loop
  select coalesce(jsonb_agg(jsonb_build_object('id',r.post_id,'key',r.sort_key) order by r.sort_key desc,r.post_id desc),'[]') into batch
   from prepared_feed.canonical(p_mode,cursor_key,cursor_id,50)r;
  count_rows:=jsonb_array_length(batch);rows:=rows||batch;
  exit when count_rows<50;
  cursor_key:=(batch->(count_rows-1)->>'key')::double precision;cursor_id:=(batch->(count_rows-1)->>'id')::uuid;
 end loop;
 perform set_config('request.jwt.claims',coalesce(previous_claims,''),true);
 perform set_config('request.jwt.claim.sub',coalesce(previous_sub,''),true);
 return rows;
exception when others then
 perform set_config('request.jwt.claims',coalesce(previous_claims,''),true);
 perform set_config('request.jwt.claim.sub',coalesce(previous_sub,''),true);
 raise;
end$$;
grant create on schema prepared_feed to prepared_feed_reader;
alter function prepared_feed.rank(jsonb,text) owner to prepared_feed_reader;
revoke create on schema prepared_feed from prepared_feed_reader;

create function public.drain_prepared_feed_v1(p_jobs integer default 1)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare job prepared_feed.demand;ranked jsonb;ids uuid[];keys double precision[];done integer:=0;failed integer:=0;now_at timestamptz;
begin
 if p_jobs is null or p_jobs<1 or p_jobs>4 then raise exception 'INVALID_PREPARED_FEED_BATCH';end if;
 delete from prepared_feed.snapshots where id in(select id from prepared_feed.snapshots where expires_at<=clock_timestamp() order by expires_at limit 500);
 delete from prepared_feed.demand where (viewer_id,scope,mode) in(select viewer_id,scope,mode from prepared_feed.demand where expires_at<=clock_timestamp() order by expires_at limit 500);
 if not prepared_feed.enabled() then return jsonb_build_object('prepared',0,'failed',0,'enabled',false);end if;
 for job in select * from prepared_feed.demand where available_at<=clock_timestamp() and expires_at>clock_timestamp()+interval '15 seconds' and failures<6
  order by available_at,viewer_id for update skip locked limit p_jobs loop
  begin
   if job.claims->>'sub' is distinct from job.viewer_id::text then raise exception 'PREPARED_FEED_IDENTITY_MISMATCH';end if;
   ranked:=prepared_feed.rank(job.claims,job.mode);
   select coalesce(array_agg((v->>'id')::uuid order by ord),'{}'),coalesce(array_agg((v->>'key')::double precision order by ord),'{}')
    into ids,keys from jsonb_array_elements(ranked) with ordinality e(v,ord);
   if cardinality(ids)<>(select count(distinct id) from unnest(ids)id) then raise exception 'PREPARED_FEED_DUPLICATE_IDS';end if;
   now_at:=clock_timestamp();
   -- Revision checked again when publishing. A delayed worker never publishes
   -- a result for a newer preference generation or expired request.
   insert into prepared_feed.snapshots(viewer_id,scope,mode,revision,ids,keys,fresh_until,expires_at)
    select job.viewer_id,job.scope,job.mode,job.revision,ids,keys,now_at+interval '60 seconds',least(job.expires_at,now_at+interval '5 minutes')
    where exists(select 1 from prepared_feed.demand d where (d.viewer_id,d.scope,d.mode,d.revision)=(job.viewer_id,job.scope,job.mode,job.revision) and d.expires_at>now_at+interval '60 seconds');
   update prepared_feed.demand set prepared_at=now_at,available_at=now_at+interval '45 seconds',failures=0
    where (viewer_id,scope,mode,revision)=(job.viewer_id,job.scope,job.mode,job.revision);
   delete from prepared_feed.snapshots where id in(select id from prepared_feed.snapshots s
    where (s.viewer_id,s.scope,s.mode)=(job.viewer_id,job.scope,job.mode) order by created_at desc,id desc offset 8);
   done:=done+1;
  exception when others then
   failed:=failed+1;
   update prepared_feed.demand set failures=least(failures+1,6),available_at=clock_timestamp()+make_interval(secs=>least(300,5*(2^failures)::integer))
    where (viewer_id,scope,mode)=(job.viewer_id,job.scope,job.mode);
  end;
 end loop;
 return jsonb_build_object('prepared',done,'failed',failed,'enabled',true);
end$$;

create function prepared_feed.invalidate_viewer()
returns trigger language plpgsql volatile security definer set search_path='' as $$
declare row_data jsonb:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;actor uuid;other uuid;
begin
 actor:=coalesce(row_data->>'user_id',row_data->>'follower_id',row_data->>'blocker_id')::uuid;
 if tg_table_name='blocked_users' then other:=(row_data->>'blocked_id')::uuid;end if;
 update prepared_feed.demand set revision=revision+1,available_at=clock_timestamp(),failures=0 where viewer_id=actor or viewer_id=other;
 return null;
end$$;
create trigger prepared_feed_follow_change after insert or update or delete on public.follows for each row execute function prepared_feed.invalidate_viewer();
create trigger prepared_feed_block_change after insert or update or delete on public.blocked_users for each row execute function prepared_feed.invalidate_viewer();
create trigger prepared_feed_mute_change after insert or update or delete on public.muted_authors for each row execute function prepared_feed.invalidate_viewer();
create trigger prepared_feed_hidden_change after insert or update or delete on public.hidden_posts for each row execute function prepared_feed.invalidate_viewer();

create function public.configure_prepared_feed_v1(p_enabled boolean)
returns void language plpgsql security definer set search_path='' as $$begin
 if p_enabled is null then raise exception 'EXPLICIT_PREPARED_FEED_SETTING_REQUIRED';end if;
 update prepared_feed.settings set enabled=p_enabled where singleton;
end$$;
create function public.prepared_feed_status_v1()
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('enabled',enabled,'max_ranked_rows',200,'fresh_seconds',60,'snapshot_seconds',300,
 'queued',(select count(*) from(select 1 from prepared_feed.demand where expires_at>now() limit 10001)q),
 'failed',(select count(*) from(select 1 from prepared_feed.demand where failures>=6 limit 10001)q),
 'oldest_due',(select available_at from prepared_feed.demand where expires_at>now() and failures<6 order by available_at limit 1))
 from prepared_feed.settings where singleton
$$;
revoke all on all functions in schema prepared_feed from public,anon,authenticated,service_role;
grant execute on function prepared_feed.scope(),prepared_feed.enabled(),prepared_feed.request(text),prepared_feed.canonical(text,double precision,uuid,integer),prepared_feed.tail(text,double precision,uuid,integer,uuid[]) to authenticated;
revoke all on function public.get_feed(text,double precision,uuid,integer) from public,anon;
grant execute on function public.get_feed(text,double precision,uuid,integer) to authenticated;
revoke all on function public.drain_prepared_feed_v1(integer),public.configure_prepared_feed_v1(boolean),public.prepared_feed_status_v1() from public,anon,authenticated;
grant execute on function public.drain_prepared_feed_v1(integer),public.configure_prepared_feed_v1(boolean),public.prepared_feed_status_v1() to service_role;
notify pgrst,'reload schema';
commit;
