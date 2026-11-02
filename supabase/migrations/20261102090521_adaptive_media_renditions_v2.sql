-- Additive HLS renditions. Originals, existing delivery tickets and v1 remain intact.
-- Installing this file does not activate processing, delivery or paid compute.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
create schema media_renditions;
revoke all on schema media_renditions from public,anon,authenticated,service_role;
do $$ begin
 if exists(select 1 from storage.buckets where id='adaptive-media' and public)
   or exists(select 1 from storage.objects where bucket_id='adaptive-media') then
  raise exception 'Adaptive destination must be new and private';
 end if;
end $$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('adaptive-media','adaptive-media',false,536870912,array['video/mp4','video/mp2t','application/vnd.apple.mpegurl']) on conflict(id) do nothing;
create policy adaptive_objects_private on storage.objects as restrictive for all to public
 using(bucket_id<>'adaptive-media') with check(bucket_id<>'adaptive-media');
create policy adaptive_bucket_private on storage.buckets as restrictive for all to public
 using(id<>'adaptive-media') with check(id<>'adaptive-media');
create table media_renditions.settings (
 singleton boolean primary key default true check(singleton),
 admission_enabled boolean not null default false,
 worker_enabled boolean not null default false,
 delivery_enabled boolean not null default false,
 maintenance_enabled boolean not null default false,
 emergency_revoke boolean not null default false,
 concurrency integer not null default 2 check(concurrency between 1 and 32),
 input_max_bytes bigint not null default 536870912 check(input_max_bytes between 1 and 536870912),
 output_max_bytes bigint not null default 805306368 check(output_max_bytes between 1 and 805306368),
 duration_max_seconds integer not null default 600 check(duration_max_seconds between 1 and 600),
 backoff_until timestamptz,last_worker_at timestamptz
);
insert into media_renditions.settings(singleton) values(true);
create table media_renditions.jobs (
 id uuid primary key default gen_random_uuid(), profile text not null default 'hls-v2' check(profile='hls-v2'),
 source_id uuid not null,source_version text not null,source_bucket text not null,source_path text not null,
 source_owner uuid not null,source_bytes bigint not null,source_etag text not null,source_mime text not null,
 state text not null default 'pending' check(state in ('pending','processing','retry','ready','failed','cancelled','blocked')),
 attempts integer not null default 0 check(attempts between 0 and 100),retry_budget integer not null default 5 check(retry_budget between 0 and 5),
 available_at timestamptz not null default now(),lease_id uuid,lease_until timestamptz,
 error_code text,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 next_check_at timestamptz not null default now(),unique(profile,source_id,source_version)
);
create index adaptive_jobs_claim on media_renditions.jobs(available_at,id) where state in ('pending','retry','processing');
create index adaptive_jobs_leases on media_renditions.jobs(lease_until) where state='processing';
create index adaptive_jobs_source on media_renditions.jobs(source_id,source_version);
create index adaptive_jobs_recheck on media_renditions.jobs(next_check_at,id) where state='ready';
create index adaptive_jobs_state on media_renditions.jobs(state,created_at,id);
create table media_renditions.attempts (
 lease_id uuid primary key,job_id uuid not null references media_renditions.jobs(id),attempt integer not null,
 prefix text not null unique,expires_at timestamptz not null,closed_at timestamptz,
 cleanup_pending boolean not null default false,cleanup_done boolean not null default false,
 cleanup_lease uuid,cleanup_until timestamptz,cleanup_attempts integer not null default 0,
 unique(job_id,attempt)
);
create index adaptive_attempts_cleanup on media_renditions.attempts(expires_at,lease_id) where not cleanup_done and (cleanup_pending or closed_at is null);
create table media_renditions.assets (
 lease_id uuid not null references media_renditions.attempts(lease_id),name text not null,
 bytes bigint not null check(bytes between 1 and 536870912),sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
 mime text not null check(mime in ('video/mp4','video/mp2t','application/vnd.apple.mpegurl')),
 playlist text,object_id uuid,object_version text,etag text,
 -- This shared Storage capability is server-only and never appears in a player URL.
 cache_token text,cache_expires_at timestamptz,
 primary key(lease_id,name),
 check(name ~ '^(master\.m3u8|fallback\.mp4|r[0-3]/(index\.m3u8|seg[0-9]{5}\.ts))$'),
 check((name like '%.m3u8' and mime='application/vnd.apple.mpegurl' and length(playlist) between 1 and 65536)
    or (name not like '%.m3u8' and playlist is null))
);
create table media_renditions.publications (
 job_id uuid primary key references media_renditions.jobs(id),lease_id uuid not null unique references media_renditions.attempts(lease_id),
 created_at timestamptz not null default now(),active boolean not null default true,
 width integer not null,height integer not null,duration numeric not null,asset_count integer not null,bytes bigint not null
);
alter table media_renditions.settings enable row level security;
alter table media_renditions.jobs enable row level security;
alter table media_renditions.attempts enable row level security;
alter table media_renditions.assets enable row level security;
alter table media_renditions.publications enable row level security;
revoke all on all tables in schema media_renditions from public,anon,authenticated,service_role;

create function media_renditions.source_matches(j media_renditions.jobs) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce(media_processing.source_snapshot(j.source_id,j.source_version) @> jsonb_build_object(
 'bucket',j.source_bucket,'path',j.source_path,'owner',j.source_owner,'bytes',j.source_bytes,'etag',j.source_etag),false)
$$;
create function media_renditions.cancel(p_id uuid,p_reason text) returns void
language plpgsql security definer set search_path='' as $$ begin
 update media_renditions.jobs set state='cancelled',error_code=p_reason,lease_id=null,lease_until=null,updated_at=clock_timestamp()
 where id=p_id and state<>'cancelled';
 update media_renditions.publications set active=false where job_id=p_id;
 update media_renditions.attempts set closed_at=coalesce(closed_at,clock_timestamp()),cleanup_pending=true where job_id=p_id and not cleanup_done;
end $$;
create function media_renditions.enqueue(p_id uuid,p_version text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c media_renditions.settings;s jsonb;j media_renditions.jobs;
begin
 select * into c from media_renditions.settings where singleton;
 if not c.admission_enabled then return jsonb_build_object('state','disabled');end if;
 s:=media_processing.source_snapshot(p_id,p_version);
 if s is null then return jsonb_build_object('state','ineligible');end if;
 insert into media_renditions.jobs(source_id,source_version,source_bucket,source_path,source_owner,source_bytes,source_etag,source_mime,state,error_code)
 values(p_id,p_version,s->>'bucket',s->>'path',(s->>'owner')::uuid,(s->>'bytes')::bigint,s->>'etag',s->>'mime',
 case when (s->>'bytes')::bigint>c.input_max_bytes then 'blocked' else 'pending' end,
 case when (s->>'bytes')::bigint>c.input_max_bytes then 'input_budget' else null end)
 on conflict(profile,source_id,source_version) do nothing;
 select * into j from media_renditions.jobs where source_id=p_id and source_version=p_version;
 return jsonb_build_object('job_id',j.id,'state',j.state);
end $$;
create function public.enqueue_media_rendition_v2(p_object_id uuid,p_version text) returns jsonb
language plpgsql security definer set search_path='' as $$ begin
 perform media_processing.require_service();return media_renditions.enqueue(p_object_id,p_version);
end $$;
create function media_renditions.binding_added() returns trigger
language plpgsql security definer set search_path='' as $$
declare o storage.objects;
begin
 if new.entity_kind in ('post','story') then
  select * into o from storage.objects where bucket_id=new.bucket_id and name=new.object_path;
  if found then perform media_renditions.enqueue(o.id,o.version);end if;
 end if;return new;
end $$;
create trigger enqueue_adaptive_media after insert on public.content_media_bindings for each row execute function media_renditions.binding_added();
create function media_renditions.source_changed() returns trigger
language plpgsql security definer set search_path='' as $$
declare j media_renditions.jobs;
begin
 if old.bucket_id not in ('post-media','story-media') then return case when tg_op='DELETE' then old else new end;end if;
 if tg_op='UPDATE' and old.id=new.id and old.version is not distinct from new.version and old.name=new.name and old.bucket_id=new.bucket_id
  and old.metadata is not distinct from new.metadata and old.owner_id is not distinct from new.owner_id and old.owner is not distinct from new.owner then return new;end if;
 for j in select * from media_renditions.jobs where source_id=old.id and state in ('pending','processing','retry','ready') loop perform media_renditions.cancel(j.id,'source_changed');end loop;
 if tg_op='UPDATE' and new.bucket_id in ('post-media','story-media') then perform media_renditions.enqueue(new.id,new.version);end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
create trigger invalidate_adaptive_source after update or delete on storage.objects for each row execute function media_renditions.source_changed();
create function public.claim_media_rendition_v2(p_worker_max_bytes bigint default 536870912) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c media_renditions.settings;j media_renditions.jobs;l uuid;until_at timestamptz;prefix text;
begin
 perform media_processing.require_service();
 select * into c from media_renditions.settings where singleton for update;
 update media_renditions.settings set last_worker_at=clock_timestamp() where singleton;
 if not c.worker_enabled or c.emergency_revoke or c.backoff_until>clock_timestamp()
  or not exists(select 1 from storage.buckets where id='adaptive-media' and not public)
  or (select count(*) from media_renditions.jobs where state='processing' and lease_until>clock_timestamp())>=c.concurrency then return null;end if;
 for j in select * from media_renditions.jobs where ((state in ('pending','retry') and available_at<=clock_timestamp())
  or (state='processing' and lease_until<=clock_timestamp())) and source_bytes<=least(c.input_max_bytes,greatest(coalesce(p_worker_max_bytes,0),0)) order by available_at,id limit 20 for update skip locked loop
  update media_renditions.attempts set closed_at=coalesce(closed_at,clock_timestamp()),cleanup_pending=true where job_id=j.id and not cleanup_done;
  if j.retry_budget=0 or j.attempts>=100 then update media_renditions.jobs set state='failed',error_code='attempt_limit',updated_at=clock_timestamp() where id=j.id;continue;end if;
  if not media_renditions.source_matches(j) then perform media_renditions.cancel(j.id,'source_changed');continue;end if;
  l:=gen_random_uuid();until_at:=clock_timestamp()+interval '15 minutes';prefix:=j.source_owner::text||'/_renditions_v2/'||j.id::text||'/'||l::text||'/';
  update media_renditions.jobs set state='processing',attempts=attempts+1,retry_budget=retry_budget-1,lease_id=l,lease_until=until_at,updated_at=clock_timestamp()
   where id=j.id returning * into j;
  insert into media_renditions.attempts(lease_id,job_id,attempt,prefix,expires_at) values(l,j.id,j.attempts,prefix,until_at);
  return jsonb_build_object('job_id',j.id,'lease_id',l,'attempt',j.attempts,'lease_until',until_at,
   'source_id',j.source_id,'source_version',j.source_version,'source_bucket',j.source_bucket,'source_path',j.source_path,
   'source_owner',j.source_owner,'source_bytes',j.source_bytes,'source_etag',j.source_etag,
   'output_bucket','adaptive-media','output_prefix',prefix,'output_max_bytes',c.output_max_bytes,'duration_max_seconds',c.duration_max_seconds);
 end loop;return null;
end $$;
create function public.check_media_rendition_v2(p_job_id uuid,p_lease_id uuid,p_attempt integer) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare j media_renditions.jobs;
begin
 perform media_processing.require_service();
 select * into j from media_renditions.jobs where id=p_job_id and lease_id=p_lease_id and attempts=p_attempt and state='processing' and lease_until>clock_timestamp();
 return found and exists(select 1 from media_renditions.settings where worker_enabled and not emergency_revoke)
  and exists(select 1 from storage.buckets where id='adaptive-media' and not public) and media_renditions.source_matches(j);
end $$;
create function public.register_media_rendition_assets_v2(p_job_id uuid,p_lease_id uuid,p_attempt integer,p_assets jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare c media_renditions.settings;row jsonb;total bigint:=0;
begin
 perform media_processing.require_service();
 perform 1 from media_renditions.jobs where id=p_job_id for update;
 perform 1 from media_renditions.attempts where lease_id=p_lease_id and closed_at is null for update;
 if not found or not public.check_media_rendition_v2(p_job_id,p_lease_id,p_attempt) then return false;end if;
 if jsonb_typeof(p_assets)<>'array' or jsonb_array_length(p_assets) not between 4 and 2048 then raise exception 'Invalid asset manifest';end if;
 if exists(select 1 from media_renditions.assets where lease_id=p_lease_id) then raise exception 'Asset manifest is immutable';end if;
 select * into c from media_renditions.settings where singleton;
 for row in select value from jsonb_array_elements(p_assets) loop
  if length(row::text)>70000 then raise exception 'Asset metadata budget';end if;
  total:=total+(row->>'bytes')::bigint;
  insert into media_renditions.assets(lease_id,name,bytes,sha256,mime,playlist)
   values(p_lease_id,row->>'name',(row->>'bytes')::bigint,row->>'sha256',row->>'mime',row->>'playlist');
 end loop;
 if total>c.output_max_bytes or not exists(select 1 from media_renditions.assets where lease_id=p_lease_id and name='master.m3u8')
  or not exists(select 1 from media_renditions.assets where lease_id=p_lease_id and name='fallback.mp4') then raise exception 'Incomplete or oversized output';end if;
 return true;
end $$;
create function media_renditions.guard_asset() returns trigger
language plpgsql security definer set search_path='' as $$
declare a media_renditions.attempts;x media_renditions.assets;b text;p text;
begin
 b:=case when tg_op='DELETE' then old.bucket_id else new.bucket_id end;p:=case when tg_op='DELETE' then old.name else new.name end;
 if tg_op='UPDATE' and old.bucket_id='adaptive-media' and (old.bucket_id<>new.bucket_id or old.name<>new.name or old.id<>new.id) then raise exception 'Adaptive identity is immutable';end if;
 if b<>'adaptive-media' then return case when tg_op='DELETE' then old else new end;end if;
 select a0.* into a from media_renditions.attempts a0 where a0.lease_id=(case when split_part(p,'/',4) ~* '^[0-9a-f-]{36}$' then split_part(p,'/',4)::uuid end) for update;
 if tg_op='DELETE' then
  if found then update media_renditions.publications set active=false where lease_id=a.lease_id;end if;return old;
 end if;
 if not found or a.closed_at is not null or a.expires_at<=clock_timestamp() or not starts_with(p,a.prefix)
  or not public.check_media_rendition_v2(a.job_id,a.lease_id,a.attempt) then raise exception 'Adaptive write requires a live registered lease' using errcode='42501';end if;
 select * into x from media_renditions.assets where lease_id=a.lease_id and name=substr(p,length(a.prefix)+1);
 if not found then raise exception 'Unregistered adaptive asset' using errcode='42501';end if;
 if tg_op='UPDATE' and old.version is distinct from new.version then raise exception 'Adaptive overwrite prohibited';end if;
 if new.metadata ? 'size' and (new.metadata->>'size')::bigint<>x.bytes then raise exception 'Adaptive size mismatch';end if;
 return new;
end $$;
create trigger guard_adaptive_asset before insert or update or delete on storage.objects for each row execute function media_renditions.guard_asset();
create function public.finish_media_rendition_v2(p_job_id uuid,p_lease_id uuid,p_attempt integer,p_outcome text,p_media jsonb default null,p_error_code text default null,p_retry_after_seconds integer default null) returns boolean
language plpgsql security definer set search_path='' as $$
declare j media_renditions.jobs;a media_renditions.attempts;c media_renditions.settings;wait_seconds integer;asset_count integer;total bigint;
begin
 perform media_processing.require_service();
 select * into c from media_renditions.settings where singleton for update;
 select * into j from media_renditions.jobs where id=p_job_id and lease_id=p_lease_id and attempts=p_attempt and state='processing' and lease_until>clock_timestamp() for update;
 if not found then return false;end if;
 select * into a from media_renditions.attempts where lease_id=p_lease_id for update;
 if a.closed_at is not null then return false;end if;
 if not media_renditions.source_matches(j) then perform media_renditions.cancel(j.id,'source_changed');return false;end if;
 if p_outcome not in ('ready','retry','failed') then raise exception 'Invalid rendition outcome';end if;
 if p_outcome='ready' then
  if not public.check_media_rendition_v2(p_job_id,p_lease_id,p_attempt) then return false;end if;
  select count(*),sum(bytes) into asset_count,total from media_renditions.assets where lease_id=p_lease_id;
  if asset_count not between 4 and 2048 or total>c.output_max_bytes or (p_media->>'duration')::numeric not between 0.05 and c.duration_max_seconds
   or (p_media->>'width')::integer not between 2 and 1920 or (p_media->>'height')::integer not between 2 and 1920 then raise exception 'Invalid output bounds';end if;
  if exists(select 1 from media_renditions.assets x left join storage.objects o on o.bucket_id='adaptive-media' and o.name=a.prefix||x.name
   where x.lease_id=p_lease_id and (o.id is null or o.version is null or coalesce((o.metadata->>'size')::bigint,-1)<>x.bytes
    or coalesce(o.user_metadata->>'processing_lease_id','')<>p_lease_id::text or coalesce(o.user_metadata->>'sha256','')<>x.sha256
    or nullif(trim(both '"' from coalesce(o.metadata->>'eTag',o.metadata->>'etag')),'') is null)) then return false;end if;
  update media_renditions.assets x set object_id=o.id,object_version=o.version,etag=trim(both '"' from coalesce(o.metadata->>'eTag',o.metadata->>'etag'))
   from storage.objects o where x.lease_id=p_lease_id and o.bucket_id='adaptive-media' and o.name=a.prefix||x.name;
  insert into media_renditions.publications(job_id,lease_id,width,height,duration,asset_count,bytes)
   values(j.id,p_lease_id,(p_media->>'width')::integer,(p_media->>'height')::integer,(p_media->>'duration')::numeric,asset_count,total);
 end if;
 wait_seconds:=least(86400,greatest(coalesce(p_retry_after_seconds,0),least(3600,30*power(2,least(j.attempts,7)))::integer+(random()*10)::integer));
 update media_renditions.attempts set closed_at=clock_timestamp(),cleanup_pending=p_outcome<>'ready' where lease_id=p_lease_id;
 update media_renditions.jobs set state=case when p_outcome='retry' and retry_budget=0 then 'failed' else p_outcome end,
  available_at=clock_timestamp()+make_interval(secs=>wait_seconds),lease_id=null,lease_until=null,
  error_code=left(regexp_replace(coalesce(p_error_code,''),'[^a-z0-9_]','','g'),80),updated_at=clock_timestamp(),next_check_at=clock_timestamp()+interval '1 hour' where id=j.id;
 if p_error_code='upstream_throttled' then update media_renditions.settings set backoff_until=clock_timestamp()+make_interval(secs=>wait_seconds) where singleton;end if;
 return true;
end $$;
-- The ticket pins a publication that already existed at issuance. Every child
-- request additionally rechecks the existing delivery ticket's live access rules.
create function public.resolve_media_rendition_v2(p_token text,p_bucket text,p_path text,p_source_version text,p_name text default 'master.m3u8',p_lease_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare issued timestamptz;j media_renditions.jobs;p media_renditions.publications;a media_renditions.attempts;x media_renditions.assets;
begin
 perform media_processing.require_service();
 if not exists(select 1 from media_renditions.settings where delivery_enabled and not emergency_revoke)
  or p_token !~ '^[0-9a-f]{64}$' then return null;end if;
 select created_at into issued from media_delivery.tickets where token_digest=extensions.digest(p_token,'sha256') and bucket_id=p_bucket and object_path=p_path and object_version=p_source_version and expires_at>clock_timestamp();
 if issued is null then return null;end if;
 select q.* into j from media_renditions.jobs q join storage.objects o on o.id=q.source_id and o.version=q.source_version
  where q.source_bucket=p_bucket and q.source_path=p_path and q.source_version=p_source_version and q.state='ready';
 if not found or not media_renditions.source_matches(j) then return null;end if;
 select * into p from media_renditions.publications where job_id=j.id and active and created_at<=issued;
 if not found or (p_lease_id is not null and p.lease_id<>p_lease_id) then return null;end if;
 select * into a from media_renditions.attempts where lease_id=p.lease_id and not cleanup_pending and not cleanup_done;
 if not found or not exists(select 1 from storage.buckets where id='adaptive-media' and not public) then return null;end if;
 select * into x from media_renditions.assets where lease_id=p.lease_id and name=p_name;
 if not found or not exists(select 1 from storage.objects o where o.id=x.object_id and o.version=x.object_version and o.bucket_id='adaptive-media' and o.name=a.prefix||x.name
  and trim(both '"' from coalesce(o.metadata->>'eTag',o.metadata->>'etag'))=x.etag) then return null;end if;
 return jsonb_build_object('leaseId',p.lease_id,'sourceVersion',j.source_version,'bucket','adaptive-media','path',a.prefix||x.name,
  'name',x.name,'version',x.object_version,'etag',x.etag,'bytes',x.bytes,'mime',x.mime,'playlist',x.playlist,
  'cacheToken',case when x.cache_expires_at>clock_timestamp()+interval '2 minutes' then x.cache_token end,'cacheTokenExpiresAt',x.cache_expires_at);
end $$;
create function public.store_media_rendition_cache_v2(p_lease_id uuid,p_name text,p_version text,p_token text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare x media_renditions.assets;
begin
 perform media_processing.require_service();
 if p_token !~ '^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$' or length(p_token)>4096 then raise exception 'Invalid internal capability';end if;
 select * into x from media_renditions.assets where lease_id=p_lease_id and name=p_name and object_version=p_version for update;
 if not found or not exists(select 1 from media_renditions.publications where lease_id=p_lease_id and active) then return null;end if;
 if x.cache_token is not null and x.cache_expires_at>clock_timestamp()+interval '2 minutes' then return jsonb_build_object('token',x.cache_token,'expiresAt',x.cache_expires_at);end if;
 update media_renditions.assets set cache_token=p_token,cache_expires_at=clock_timestamp()+interval '55 minutes' where lease_id=p_lease_id and name=p_name;
 return jsonb_build_object('token',p_token,'expiresAt',clock_timestamp()+interval '55 minutes');
end $$;
create function public.reconcile_media_renditions_v2(p_limit integer default 100) returns integer
language plpgsql security definer set search_path='' as $$
declare j media_renditions.jobs;n integer:=0;
begin
 perform media_processing.require_service();
 if not exists(select 1 from media_renditions.settings where maintenance_enabled) then return 0;end if;
 for j in select * from media_renditions.jobs where state='ready' and next_check_at<=clock_timestamp() order by next_check_at,id limit least(greatest(p_limit,1),100) for update skip locked loop
  if not media_renditions.source_matches(j) then perform media_renditions.cancel(j.id,'source_revoked');
  else update media_renditions.jobs set next_check_at=clock_timestamp()+interval '1 hour' where id=j.id;end if;n:=n+1;
 end loop;
 return n;
end $$;
create function public.claim_media_rendition_cleanup_v2(p_limit integer default 4) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a media_renditions.attempts;l uuid;result jsonb:='[]';
begin
 perform media_processing.require_service();
 if not exists(select 1 from media_renditions.settings where maintenance_enabled) then return result;end if;
 for a in select * from media_renditions.attempts where not cleanup_done and (cleanup_pending or (closed_at is null and expires_at<=clock_timestamp()))
  and (cleanup_until is null or cleanup_until<=clock_timestamp()) order by expires_at,lease_id limit least(greatest(p_limit,1),4) for update skip locked loop
  l:=gen_random_uuid();update media_renditions.attempts set closed_at=coalesce(closed_at,clock_timestamp()),cleanup_pending=true,cleanup_lease=l,cleanup_until=clock_timestamp()+interval '5 minutes',cleanup_attempts=cleanup_attempts+1 where lease_id=a.lease_id;
  update media_renditions.publications set active=false where lease_id=a.lease_id;
  result:=result||jsonb_build_array(jsonb_build_object('lease_id',a.lease_id,'cleanup_lease',l,'bucket','adaptive-media','prefix',a.prefix,
   'names',coalesce((select jsonb_agg(name order by name) from media_renditions.assets where lease_id=a.lease_id),'[]'::jsonb)));
 end loop;return result;
end $$;
create function public.finish_media_rendition_cleanup_v2(p_lease_id uuid,p_cleanup_lease uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare a media_renditions.attempts;
begin
 perform media_processing.require_service();select * into a from media_renditions.attempts where lease_id=p_lease_id and cleanup_lease=p_cleanup_lease and cleanup_until>clock_timestamp() for update;
 if not found or exists(select 1 from storage.objects where bucket_id='adaptive-media' and starts_with(name,a.prefix)) then return false;end if;
 update media_renditions.attempts set cleanup_done=true,cleanup_until=null,cleanup_lease=null where lease_id=p_lease_id;return true;
end $$;
create function public.redrive_media_rendition_v2(p_job_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare j media_renditions.jobs;
begin
 perform media_processing.require_service();select * into j from media_renditions.jobs where id=p_job_id and state='failed' and attempts<100 for update;
 if not found or not media_renditions.source_matches(j) then return false;end if;
 update media_renditions.jobs set state='pending',retry_budget=5,error_code=null,available_at=clock_timestamp(),updated_at=clock_timestamp() where id=j.id;return true;
end $$;
create function public.media_processing_status_v1() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;state_name text;n bigint;states jsonb:='{}';
begin
 -- Read-only aggregate is protected by explicit service-only EXECUTE grants.
 -- The postgres-owned capacity sampler has no request JWT.
 foreach state_name in array array['pending','retry','processing','failed','blocked','cancelled'] loop
  select count(*) into n from(select 1 from media_renditions.jobs where state=state_name limit 10001)s;
  states:=states||jsonb_build_object(state_name,least(n,10000),state_name||'_capped',n>10000);
 end loop;
 result:=jsonb_build_object('profile','hls-v2','states',states,'worker_last_seen_at',(select last_worker_at from media_renditions.settings where singleton),
  'worker_enabled',(select worker_enabled from media_renditions.settings where singleton),
  'delivery_enabled',(select delivery_enabled from media_renditions.settings where singleton),
  'oldest_pending_seconds',(select coalesce(extract(epoch from clock_timestamp()-min(created_at)),0)::bigint from(
   (select created_at from media_renditions.jobs where state='pending' order by created_at limit 1) union all
   (select created_at from media_renditions.jobs where state='retry' order by created_at limit 1))s),
  'expired_leases',(select count(*) from(select 1 from media_renditions.jobs where state='processing' and lease_until<=clock_timestamp() limit 10000)s),
  'cleanup_pending',(select count(*) from(select 1 from media_renditions.attempts where cleanup_pending and not cleanup_done limit 10000)s),
  'faststart_v1_pending',(select count(*) from(select 1 from media_processing.jobs where state in ('pending','retry','processing') limit 10000)s),
  'sample_limit',10000);
 return result;
end $$;
create function public.media_rendition_health_v2() returns jsonb
language sql stable security definer set search_path='' as $$select public.media_processing_status_v1()$$;
create function public.prune_media_renditions_v2(p_limit integer default 10) returns integer
language plpgsql security definer set search_path='' as $$
declare j media_renditions.jobs;n integer:=0;
begin
 perform media_processing.require_service();
 if not exists(select 1 from media_renditions.settings where maintenance_enabled) then return 0;end if;
 for j in select * from media_renditions.jobs q where state in ('cancelled','failed','blocked') and updated_at<clock_timestamp()-interval '30 days'
  and not exists(select 1 from media_renditions.attempts where job_id=q.id and not cleanup_done)
  order by state,created_at,id limit least(greatest(p_limit,1),10) for update skip locked loop
  delete from media_renditions.publications where job_id=j.id;
  delete from media_renditions.assets where lease_id in(select lease_id from media_renditions.attempts where job_id=j.id);
  delete from media_renditions.attempts where job_id=j.id;delete from media_renditions.jobs where id=j.id;n:=n+1;
 end loop;return n;
end $$;
revoke all on all functions in schema media_renditions from public,anon,authenticated,service_role;
do $$ declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in('enqueue_media_rendition_v2','claim_media_rendition_v2','check_media_rendition_v2','register_media_rendition_assets_v2','finish_media_rendition_v2','resolve_media_rendition_v2','store_media_rendition_cache_v2','reconcile_media_renditions_v2','claim_media_rendition_cleanup_v2','finish_media_rendition_cleanup_v2','redrive_media_rendition_v2','media_rendition_health_v2','media_processing_status_v1','prune_media_renditions_v2') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
commit;
