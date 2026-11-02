-- Durable, versioned faststart preparation. Applying this migration performs no
-- downloads, Storage writes, provider calls, scheduled work or reader cutover.
-- All feature gates remain false until the separate rollout gates are met.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';
create schema if not exists media_processing;
revoke all on schema media_processing from public, anon, authenticated, service_role;
do $$ begin
  if exists(select 1 from storage.buckets where id='derived-media' and public)
    or exists(select 1 from storage.objects where bucket_id='derived-media') then
    raise exception 'Derived destination is already public or populated; review before installation';
  end if;
end $$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  values('derived-media','derived-media',false,536870912,array['video/mp4','video/quicktime']) on conflict(id) do nothing;
-- Restrictive policies intersect every existing permissive policy. Ordinary
-- users cannot read, sign, list or write derivatives even when a broad legacy
-- Storage policy exists. Service-role Storage operations retain their bypass.
create policy media_derivatives_service_only on storage.objects as restrictive for all to public
  using(bucket_id<>'derived-media') with check(bucket_id<>'derived-media');
create policy media_derivatives_bucket_service_only on storage.buckets as restrictive for all to public
  using(id<>'derived-media') with check(id<>'derived-media');
create table media_processing.settings (
  singleton boolean primary key default true check(singleton),
  admission_enabled boolean not null default false,
  inline_enabled boolean not null default false,
  external_enabled boolean not null default false,
  maintenance_enabled boolean not null default false,
  delivery_enabled boolean not null default false,
  delivery_started_at timestamptz,
  delivery_stopped_at timestamptz,
  emergency_revoke boolean not null default false,
  inline_max_bytes bigint not null default 16777216 check(inline_max_bytes between 1 and 16777216),
  external_max_bytes bigint not null default 536870912 check(external_max_bytes between 16777216 and 536870912),
  inline_concurrency integer not null default 1 check(inline_concurrency between 1 and 4),
  external_concurrency integer not null default 2 check(external_concurrency between 1 and 32),
  inline_backoff_until timestamptz,
  external_backoff_until timestamptz
);
insert into media_processing.settings(singleton) values(true);
create function media_processing.delivery_epoch() returns trigger language plpgsql set search_path='' as $$
begin
  if old.delivery_started_at is not null and new.delivery_started_at is distinct from old.delivery_started_at then raise exception 'Media delivery epoch is immutable'; end if;
  if old.delivery_stopped_at is not null and new.delivery_stopped_at is distinct from old.delivery_stopped_at then raise exception 'Media delivery stop epoch is immutable'; end if;
  if new.delivery_enabled and new.delivery_stopped_at is not null then raise exception 'A later delivery activation requires a new reviewed epoch contract'; end if;
  if new.delivery_enabled and new.delivery_started_at is null then new.delivery_started_at:=clock_timestamp(); end if;
  if old.delivery_enabled and not new.delivery_enabled then new.delivery_stopped_at:=clock_timestamp(); end if;
  return new;
end $$;
create trigger preserve_media_delivery_epoch before update on media_processing.settings for each row execute function media_processing.delivery_epoch();
create table media_processing.jobs (
  id uuid primary key default gen_random_uuid(),
  profile text not null default 'faststart-v1' check(profile='faststart-v1'),
  source_id uuid not null, source_version text not null,
  source_bucket text not null, source_path text not null, source_owner uuid not null,
  source_bytes bigint not null check(source_bytes>0), source_etag text not null, source_mime text not null,
  lane text not null check(lane in ('inline','external')),
  state text not null default 'pending' check(state in ('pending','processing','retry','ready','passthrough','failed','cancelled','blocked')),
  attempts integer not null default 0 check(attempts between 0 and 5),
  available_at timestamptz not null default now(),
  lease_id uuid, lease_until timestamptz,
  error_code text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  next_check_at timestamptz not null default now(),
  unique(profile,source_id,source_version)
);
create index media_jobs_claim_idx on media_processing.jobs(lane,available_at,id) where state in ('pending','retry','processing');
create index media_jobs_source_path_idx on media_processing.jobs(source_bucket,source_path) where state in ('pending','processing','retry','ready');
create index media_jobs_lease_idx on media_processing.jobs(lane,lease_until) where state='processing';
create index media_jobs_owner_idx on media_processing.jobs(source_owner,id);
create index media_jobs_recheck_idx on media_processing.jobs(next_check_at,id) where state='ready';
create index media_jobs_retention_idx on media_processing.jobs(updated_at,id) where state in ('cancelled','failed','passthrough');
create table media_processing.attempts (
  lease_id uuid primary key, job_id uuid not null references media_processing.jobs(id),
  attempt integer not null, bucket text not null, path text not null,
  expires_at timestamptz not null, closed_at timestamptz,
  cleanup_pending boolean not null default false, cleanup_done boolean not null default false,
  cleanup_lease uuid, cleanup_until timestamptz, cleanup_attempts integer not null default 0,
  unique(bucket,path), unique(job_id,attempt)
);
create index media_attempts_cleanup_idx on media_processing.attempts(expires_at,lease_id)
  where not cleanup_done and cleanup_attempts<10 and (cleanup_pending or closed_at is null);
create table media_processing.variants (
  job_id uuid primary key references media_processing.jobs(id), lease_id uuid not null references media_processing.attempts(lease_id),
  object_id uuid not null, object_version text not null, etag text not null,
  bucket text not null, path text not null, bytes bigint not null, mime text not null,
  active boolean not null default true, created_at timestamptz not null default now(), retired_at timestamptz
);
create table media_processing.invalidations (
  entity_kind text not null, entity_id uuid not null, cursor uuid,
  touched_at timestamptz not null default now(), primary key(entity_kind,entity_id)
);
create index media_invalidations_age_idx on media_processing.invalidations(touched_at);
-- Run this index separately CONCURRENTLY before applying on a large live table.
create index if not exists content_media_bindings_source_idx on public.content_media_bindings(bucket_id,object_path);
alter table media_processing.settings enable row level security;
alter table media_processing.jobs enable row level security;
alter table media_processing.attempts enable row level security;
alter table media_processing.variants enable row level security;
alter table media_processing.invalidations enable row level security;
revoke all on all tables in schema media_processing from public, anon, authenticated, service_role;

create function media_processing.source_snapshot(p_id uuid,p_version text) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',o.id,'version',o.version,'bucket',o.bucket_id,'path',o.name,
    'owner',coalesce(nullif(o.owner_id,''),o.owner::text),'bytes',case when (o.metadata->>'size') ~ '^[0-9]{1,12}$' then (o.metadata->>'size')::bigint end,
    'etag',trim(both '"' from coalesce(o.metadata->>'eTag',o.metadata->>'etag')),
    'mime',case when lower(o.name) like '%.mov' then 'video/quicktime' else 'video/mp4' end)
  from storage.objects o
  where o.id=p_id and o.version=p_version and length(o.version) between 1 and 128
    and o.bucket_id in ('post-media','story-media')
    and o.name ~* '\.(mp4|mov|m4v)$' and length(o.name)<=1024
    and o.name !~ '(%|\\|(^|/)\.{1,2}(/|$)|//|/_derived_v1/)'
    and split_part(o.name,'/',1)=coalesce(nullif(o.owner_id,''),o.owner::text)
    and exists(select 1 from auth.users u where u.id=(case when coalesce(nullif(o.owner_id,''),o.owner::text) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then coalesce(nullif(o.owner_id,''),o.owner::text)::uuid end) and u.deleted_at is null)
    and case when (o.metadata->>'size') ~ '^[0-9]{1,12}$' then (o.metadata->>'size')::bigint>0 else false end
    and length(trim(both '"' from coalesce(o.metadata->>'eTag',o.metadata->>'etag'))) between 1 and 256
    and coalesce(o.metadata->>'eTag',o.metadata->>'etag') not like 'W/%'
    and exists(select 1 from public.content_media_bindings b
      where b.bucket_id=o.bucket_id and b.object_path=o.name and b.entity_kind in ('post','story')
        and b.uploader_id::text=coalesce(nullif(o.owner_id,''),o.owner::text)
        and (exists(select 1 from public.posts p where b.entity_kind='post' and p.id=b.entity_id and p.user_id=b.uploader_id)
          or exists(select 1 from public.stories s where b.entity_kind='story' and s.id=b.entity_id and s.user_id=b.uploader_id))
        and exists(select 1 from public.content_media_strings(public.content_media_document(b.entity_kind,b.entity_id)) u
          where regexp_match(u,'^https://[^/]+/storage/v1/object/public/(post-media|story-media)/([^?#]+)$')=array[o.bucket_id,o.name]))
$$;
create function media_processing.snapshot_matches(j media_processing.jobs) returns boolean
language sql stable security definer set search_path='' as $$
  select coalesce(media_processing.source_snapshot(j.source_id,j.source_version) @> jsonb_build_object(
    'bucket',j.source_bucket,'path',j.source_path,'owner',j.source_owner,'bytes',j.source_bytes,'etag',j.source_etag),false)
$$;
create function media_processing.require_service() returns void
language plpgsql stable security definer set search_path='' as $$
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
end $$;
create function media_processing.enqueue(p_id uuid,p_version text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s jsonb; j media_processing.jobs; c media_processing.settings;
begin
  select * into c from media_processing.settings where singleton;
  if not c.admission_enabled then return jsonb_build_object('state','disabled'); end if;
  s:=media_processing.source_snapshot(p_id,p_version);
  if s is null then return jsonb_build_object('state','ineligible'); end if;
  insert into media_processing.jobs(source_id,source_version,source_bucket,source_path,source_owner,source_bytes,source_etag,source_mime,lane,state,error_code)
    values(p_id,p_version,s->>'bucket',s->>'path',(s->>'owner')::uuid,(s->>'bytes')::bigint,s->>'etag',s->>'mime',
      case when (s->>'bytes')::bigint<=c.inline_max_bytes then 'inline' else 'external' end,
      case when (s->>'bytes')::bigint>536870912 then 'blocked' else 'pending' end,
      case when (s->>'bytes')::bigint>536870912 then 'external_input_budget' else null end)
    on conflict(profile,source_id,source_version) do nothing;
  select * into j from media_processing.jobs where profile='faststart-v1' and source_id=p_id and source_version=p_version;
  return jsonb_build_object('job_id',j.id,'state',j.state,'lane',j.lane);
end $$;
create function public.enqueue_media_processing_v1(p_bucket text,p_path text,p_object_id uuid,p_version text) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform media_processing.require_service();
  if not exists(select 1 from storage.objects o where o.id=p_object_id and o.version=p_version and o.bucket_id=p_bucket and o.name=p_path) then
    return jsonb_build_object('state','ineligible');
  end if;
  return media_processing.enqueue(p_object_id,p_version);
end $$;
create function media_processing.cancel_job(p_id uuid,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
begin
  update media_processing.jobs set state='cancelled',error_code=p_reason,lease_id=null,lease_until=null,updated_at=clock_timestamp()
    where id=p_id and state not in ('cancelled','failed');
  update media_processing.attempts set closed_at=coalesce(closed_at,clock_timestamp()),cleanup_pending=true where job_id=p_id and not cleanup_done;
  update media_processing.variants set active=false,retired_at=coalesce(retired_at,clock_timestamp()) where job_id=p_id;
end $$;
create function public.claim_media_processing_v1(p_lane text,p_limit integer default 1) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c media_processing.settings; j media_processing.jobs; v_lease uuid; v_until timestamptz; v_path text;
  result jsonb:='[]'; capacity integer; active_count integer; wanted integer;
begin
  perform media_processing.require_service();
  if p_lane not in ('inline','external') then raise exception 'Unknown media lane'; end if;
  select * into c from media_processing.settings where singleton for update;
  if not exists(select 1 from storage.buckets where id='derived-media' and not public) then return result; end if;
  if (p_lane='inline' and (not c.inline_enabled or c.inline_backoff_until>clock_timestamp()))
    or (p_lane='external' and (not c.external_enabled or c.external_backoff_until>clock_timestamp())) then return result; end if;
  capacity:=case when p_lane='inline' then c.inline_concurrency else c.external_concurrency end;
  select count(*) into active_count from media_processing.jobs where lane=p_lane and state='processing' and lease_until>clock_timestamp();
  wanted:=least(greatest(coalesce(p_limit,1),1),case when p_lane='inline' then 1 else 4 end,capacity-active_count);
  if wanted<=0 then return result; end if;
  for j in select * from media_processing.jobs where lane=p_lane
    and ((state in ('pending','retry') and available_at<=clock_timestamp()) or (state='processing' and lease_until<=clock_timestamp()))
    and source_bytes<=case when p_lane='inline' then c.inline_max_bytes else c.external_max_bytes end
    order by available_at,id limit wanted for update skip locked loop
    if j.attempts>=5 then
      update media_processing.jobs set state='failed',error_code='attempt_limit',updated_at=clock_timestamp() where id=j.id;
      update media_processing.attempts set closed_at=coalesce(closed_at,clock_timestamp()),cleanup_pending=true where job_id=j.id and not cleanup_done;
      continue;
    end if;
    if not media_processing.snapshot_matches(j) then perform media_processing.cancel_job(j.id,'source_changed'); continue; end if;
    v_lease:=gen_random_uuid(); v_until:=clock_timestamp()+case when p_lane='inline' then interval '90 seconds' else interval '15 minutes' end;
    v_path:=j.source_owner::text||'/_derived_v1/'||j.id::text||'/'||v_lease::text||case when j.source_mime='video/quicktime' then '.mov' else '.mp4' end;
    update media_processing.attempts set closed_at=coalesce(closed_at,clock_timestamp()),cleanup_pending=true where job_id=j.id and not cleanup_done;
    update media_processing.jobs set state='processing',attempts=attempts+1,lease_id=v_lease,lease_until=v_until,updated_at=clock_timestamp() where id=j.id returning * into j;
    insert into media_processing.attempts(lease_id,job_id,attempt,bucket,path,expires_at) values(v_lease,j.id,j.attempts,'derived-media',v_path,v_until);
    result:=result||jsonb_build_array(jsonb_build_object('job_id',j.id,'lease_id',v_lease,'attempt',j.attempts,'lease_until',v_until,
      'source_id',j.source_id,'source_version',j.source_version,'source_bucket',j.source_bucket,'source_path',j.source_path,
      'source_bytes',j.source_bytes,'source_etag',j.source_etag,'source_mime',j.source_mime,'output_bucket','derived-media','output_path',v_path));
  end loop;
  return result;
end $$;
create function public.check_media_processing_v1(p_job_id uuid,p_lease_id uuid,p_attempt integer) returns boolean
language plpgsql security definer set search_path='' as $$
declare j media_processing.jobs; c media_processing.settings;
begin
  perform media_processing.require_service();
  select * into j from media_processing.jobs where id=p_job_id and lease_id=p_lease_id and attempts=p_attempt and state='processing' and lease_until>clock_timestamp();
  if not found then return false; end if;
  if not exists(select 1 from storage.buckets where id='derived-media' and not public) then return false; end if;
  select * into c from media_processing.settings where singleton;
  return (case when j.lane='inline' then c.inline_enabled else c.external_enabled end) and media_processing.snapshot_matches(j);
end $$;
create function public.finish_media_processing_v1(p_job_id uuid,p_lease_id uuid,p_attempt integer,p_outcome text,p_error_code text default null,p_retry_after_seconds integer default null) returns boolean
language plpgsql security definer set search_path='' as $$
declare j media_processing.jobs; a media_processing.attempts; o storage.objects; delay integer;
begin
  perform media_processing.require_service();
  select * into j from media_processing.jobs where id=p_job_id and lease_id=p_lease_id and attempts=p_attempt and state='processing' and lease_until>clock_timestamp() for update;
  if not found then return false; end if;
  select * into a from media_processing.attempts where lease_id=p_lease_id for update;
  if a.closed_at is not null then return false; end if;
  if not media_processing.snapshot_matches(j) then perform media_processing.cancel_job(j.id,'source_changed'); return false; end if;
  if p_outcome not in ('ready','passthrough','external','retry','failed') then raise exception 'Invalid media outcome'; end if;
  if p_outcome='ready' then
    if not exists(select 1 from storage.buckets where id='derived-media' and not public) then return false; end if;
    -- No row lock on Storage: an in-flight Storage write must acquire the
    -- attempt lock in the guard below, then observe its closed tombstone.
    select * into o from storage.objects where bucket_id=a.bucket and name=a.path;
    if not found or o.version is null or o.id=j.source_id or (case when (o.metadata->>'size') ~ '^[0-9]{1,12}$' then (o.metadata->>'size')::bigint<>j.source_bytes else true end)
      or coalesce(o.user_metadata->>'processing_job_id','')<>j.id::text
      or coalesce(o.user_metadata->>'processing_lease_id','')<>p_lease_id::text
      or coalesce(o.user_metadata->>'source_id','')<>j.source_id::text
      or coalesce(o.user_metadata->>'source_version','')<>j.source_version
      or nullif(trim(both '"' from coalesce(o.metadata->>'eTag',o.metadata->>'etag')),'') is null
      then return false; end if;
    insert into media_processing.variants(job_id,lease_id,object_id,object_version,etag,bucket,path,bytes,mime)
      values(j.id,p_lease_id,o.id,o.version,trim(both '"' from coalesce(o.metadata->>'eTag',o.metadata->>'etag')),a.bucket,a.path,j.source_bytes,j.source_mime)
      on conflict(job_id) do update set lease_id=excluded.lease_id,object_id=excluded.object_id,object_version=excluded.object_version,
        etag=excluded.etag,bucket=excluded.bucket,path=excluded.path,bytes=excluded.bytes,mime=excluded.mime,active=true,created_at=clock_timestamp(),retired_at=null;
  end if;
  delay:=least(86400,greatest(coalesce(p_retry_after_seconds,0),least(300,power(2,j.attempts)::integer)));
  update media_processing.attempts set closed_at=clock_timestamp(),cleanup_pending=(p_outcome<>'ready') where lease_id=p_lease_id;
  update media_processing.jobs set state=case when p_outcome='external' then 'pending' when p_outcome='retry' and attempts>=5 then 'failed' else p_outcome end,
    lane=case when p_outcome='external' then 'external' else lane end,
    lease_id=null,lease_until=null,available_at=clock_timestamp()+make_interval(secs=>case when p_outcome='retry' then delay else 0 end),
    error_code=left(p_error_code,80),updated_at=clock_timestamp() where id=j.id;
  if p_error_code='upstream_throttled' and p_outcome='retry' then
    update media_processing.settings set
      inline_backoff_until=case when j.lane='inline' then greatest(inline_backoff_until,clock_timestamp()+make_interval(secs=>delay)) else inline_backoff_until end,
      external_backoff_until=case when j.lane='external' then greatest(external_backoff_until,clock_timestamp()+make_interval(secs=>delay)) else external_backoff_until end where singleton;
  end if;
  return true;
end $$;
create function public.resolve_media_variant_v1(p_bucket text,p_path text,p_source_version text,p_grant_issued_at timestamptz) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c media_processing.settings; j media_processing.jobs; v media_processing.variants;
begin
  perform media_processing.require_service();
  select * into c from media_processing.settings where singleton;
  if c.delivery_started_at is null or p_grant_issued_at is null or p_grant_issued_at<c.delivery_started_at
    or (c.delivery_stopped_at is not null and p_grant_issued_at>=c.delivery_stopped_at) then return null; end if;
  select q.* into j from storage.objects o join media_processing.jobs q on q.profile='faststart-v1' and q.source_id=o.id and q.source_version=p_source_version
    where o.bucket_id=p_bucket and o.name=p_path and o.version=p_source_version;
  if not found then return null; end if;
  select * into v from media_processing.variants where job_id=j.id and created_at<=p_grant_issued_at;
  if not found or (v.retired_at is not null and p_grant_issued_at>=v.retired_at) then return null; end if;
  -- Choice is fixed for this ticket's issuance time. Never splice different
  -- byte layouts into successive Range reads under one playback URL.
  if c.emergency_revoke or not v.active or j.state<>'ready' or not media_processing.snapshot_matches(j)
    or not exists(select 1 from storage.buckets where id=v.bucket and not public)
    or not exists(select 1 from storage.objects o where o.id=v.object_id and o.bucket_id=v.bucket and o.name=v.path and o.version=v.object_version
      and trim(both '"' from coalesce(o.metadata->>'eTag',o.metadata->>'etag'))=v.etag) then return jsonb_build_object('unavailable',true); end if;
  return jsonb_build_object('bucket',v.bucket,'path',v.path,'version',v.object_version,'etag',v.etag,'sourceVersion',j.source_version);
end $$;

-- Look up the actual persisted ticket creation time. No TTL inference or
-- caller-supplied timestamp determines a representation. Older deployments
-- without this ticket contract keep the original media path.
create function public.resolve_media_variant_for_ticket_v1(p_token text,p_bucket text,p_path text,p_source_version text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare issued timestamptz; source_id uuid;
begin
  perform media_processing.require_service();
  if p_token !~ '^[0-9a-f]{64}$' or to_regclass('media_delivery.tickets') is null then return null; end if;
  execute 'select created_at,object_id from media_delivery.tickets where token_digest=extensions.digest($1,''sha256'') and bucket_id=$2 and object_path=$3 and object_version=$4 and expires_at>clock_timestamp()'
    into issued,source_id using p_token,p_bucket,p_path,p_source_version;
  if issued is null or not exists(select 1 from storage.objects where id=source_id and bucket_id=p_bucket and name=p_path and version=p_source_version) then return null; end if;
  return public.resolve_media_variant_v1(p_bucket,p_path,p_source_version,issued);
end $$;

-- Derived paths are reserved only for registered, live attempts. Once sealed,
-- they can be removed but never overwritten or recreated, including by retry.
-- This makes a later Storage API remove safe from same-path replacement races.
create function media_processing.guard_derived_object() returns trigger
language plpgsql security definer set search_path='' as $$
declare a media_processing.attempts; j media_processing.jobs; v_bucket text; v_path text;
begin
  v_bucket:=case when tg_op='DELETE' then old.bucket_id else new.bucket_id end;
  v_path:=case when tg_op='DELETE' then old.name else new.name end;
  if tg_op='UPDATE' and old.bucket_id='derived-media' and (old.name<>new.name or old.bucket_id<>new.bucket_id or old.id<>new.id) then raise exception 'Derived identity is immutable'; end if;
  if v_bucket<>'derived-media' then return case when tg_op='DELETE' then old else new end; end if;
  select * into a from media_processing.attempts where bucket=v_bucket and path=v_path for update;
  if tg_op='DELETE' then
    if found then
      update media_processing.attempts set closed_at=coalesce(closed_at,clock_timestamp()),cleanup_done=true where lease_id=a.lease_id;
      update media_processing.variants set active=false,retired_at=coalesce(retired_at,clock_timestamp()) where lease_id=a.lease_id;
    end if;
    return old;
  end if;
  if not found or a.closed_at is not null or a.expires_at<=clock_timestamp() or coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Derived write requires live registered attempt' using errcode='42501'; end if;
  select * into j from media_processing.jobs where id=a.job_id and lease_id=a.lease_id and state='processing' and attempts=a.attempt and lease_until>clock_timestamp();
  if not found or not media_processing.snapshot_matches(j) then raise exception 'Derived source changed' using errcode='42501'; end if;
  return new;
end $$;
create trigger guard_media_processing_output before insert or update or delete on storage.objects for each row execute function media_processing.guard_derived_object();
create function media_processing.source_changed() returns trigger
language plpgsql security definer set search_path='' as $$
declare j record;
begin
  if tg_op='UPDATE' and old.id=new.id and old.version is not distinct from new.version and old.name=new.name and old.bucket_id=new.bucket_id
    and old.owner_id is not distinct from new.owner_id and old.owner is not distinct from new.owner
    and old.metadata is not distinct from new.metadata then return new; end if;
  for j in select id from media_processing.jobs where profile='faststart-v1' and source_id=old.id and source_version=old.version and state not in ('cancelled','failed') loop
    perform media_processing.cancel_job(j.id,'source_changed');
  end loop;
  return case when tg_op='DELETE' then old else new end;
end $$;
create trigger invalidate_media_processing_source after update or delete on storage.objects for each row execute function media_processing.source_changed();
create function media_processing.binding_changed() returns trigger
language plpgsql security definer set search_path='' as $$
declare o record; j media_processing.jobs;
begin
  if tg_op='INSERT' and new.entity_kind in ('post','story') then
    select id,version into o from storage.objects where bucket_id=new.bucket_id and name=new.object_path;
    if found then perform media_processing.enqueue(o.id,o.version); end if;
  elsif tg_op='DELETE' then
    for j in select * from media_processing.jobs where source_bucket=old.bucket_id and source_path=old.object_path and state in ('pending','processing','retry','ready') loop
      if not media_processing.snapshot_matches(j) then perform media_processing.cancel_job(j.id,'reference_removed'); end if;
    end loop;
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
create trigger enqueue_bound_media_processing after insert or delete on public.content_media_bindings for each row execute function media_processing.binding_changed();
create function media_processing.entity_changed() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from media_processing.settings where singleton and (admission_enabled or maintenance_enabled or delivery_started_at is not null)) then
    insert into media_processing.invalidations(entity_kind,entity_id) values(case when tg_table_name='posts' then 'post' else 'story' end,old.id)
      on conflict(entity_kind,entity_id) do update set cursor=null,touched_at=clock_timestamp();
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
create trigger invalidate_post_media_processing after delete or update of media_url,image_url,user_id on public.posts for each row execute function media_processing.entity_changed();
create trigger invalidate_story_media_processing after delete or update of media_url,thumbnail_url,dual_front_url,stickers_json,media_transform,user_id on public.stories for each row execute function media_processing.entity_changed();
create function media_processing.owner_erased() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op='UPDATE' and (new.deleted_at is null or old.deleted_at is not null) then return new; end if;
  if exists(select 1 from media_processing.jobs where source_owner=old.id) then
    insert into media_processing.invalidations(entity_kind,entity_id) values('owner',old.id)
      on conflict(entity_kind,entity_id) do update set cursor=null,touched_at=clock_timestamp();
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
create trigger invalidate_erased_owner_media after delete or update of deleted_at on auth.users for each row execute function media_processing.owner_erased();
create function media_processing.attachment_changed() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from media_processing.settings where singleton and (admission_enabled or maintenance_enabled or delivery_started_at is not null)) then
    insert into media_processing.invalidations(entity_kind,entity_id) values('post',old.post_id)
      on conflict(entity_kind,entity_id) do update set cursor=null,touched_at=clock_timestamp();
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
create trigger invalidate_post_attachment_processing after delete or update of url,edit,post_id on public.post_media for each row execute function media_processing.attachment_changed();
create function public.reconcile_media_processing_v1(p_limit integer default 100) returns integer
language plpgsql security definer set search_path='' as $$
declare i media_processing.invalidations; j media_processing.jobs; count_done integer:=0; ids uuid[]; v_job_id uuid; blocked boolean:=false;
begin
  perform media_processing.require_service();
  if not exists(select 1 from media_processing.settings where singleton and maintenance_enabled) then return 0; end if;
  select * into i from media_processing.invalidations order by touched_at limit 1 for update skip locked;
  if found then
    if i.entity_kind='owner' then
      select array_agg(id) into ids from (select id from media_processing.jobs where source_owner=i.entity_id and (i.cursor is null or id>i.cursor)
        order by id limit least(greatest(coalesce(p_limit,100),1),100)) selected;
    else
      select array_agg(id) into ids from (select distinct q.id from public.content_media_bindings b join media_processing.jobs q
        on q.source_bucket=b.bucket_id and q.source_path=b.object_path and q.state in ('pending','processing','retry','ready')
        where b.entity_kind=i.entity_kind and b.entity_id=i.entity_id and (i.cursor is null or q.id>i.cursor)
        order by q.id limit least(greatest(coalesce(p_limit,100),1),100)) selected;
    end if;
    foreach v_job_id in array coalesce(ids,'{}'::uuid[]) loop
      -- A content writer can hold its job while queuing this invalidation.
      -- Never wait on that job while holding the marker; retain its cursor so
      -- the next drain revisits it after the writer commits.
      select * into j from media_processing.jobs where id=v_job_id for update skip locked;
      if not found then
        if exists(select 1 from media_processing.jobs where id=v_job_id) then blocked:=true; exit; end if;
        update media_processing.invalidations set cursor=v_job_id where entity_kind=i.entity_kind and entity_id=i.entity_id;
        continue;
      end if;
      if i.entity_kind='owner' or not media_processing.snapshot_matches(j) then perform media_processing.cancel_job(j.id,'reference_changed'); end if;
      update media_processing.invalidations set cursor=j.id where entity_kind=i.entity_kind and entity_id=i.entity_id;
      count_done:=count_done+1;
    end loop;
    if count_done=0 and not blocked then delete from media_processing.invalidations where entity_kind=i.entity_kind and entity_id=i.entity_id; end if;
  end if;
  -- A bounded indexed sweep catches indirect article/asset edits or a lost
  -- invalidation event. Its backlog/oldest check age is an activation metric.
  for j in select * from media_processing.jobs where state='ready' and next_check_at<=clock_timestamp()
    order by next_check_at,id limit greatest(0,least(greatest(coalesce(p_limit,100),1),100)-count_done) for update skip locked loop
    if not media_processing.snapshot_matches(j) then perform media_processing.cancel_job(j.id,'reference_changed');
    else update media_processing.jobs set next_check_at=clock_timestamp()+interval '1 hour' where id=j.id; end if;
    count_done:=count_done+1;
  end loop;
  return count_done;
end $$;
create function public.claim_media_cleanup_v1(p_limit integer default 10) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a media_processing.attempts; o storage.objects; result jsonb:='[]'; token uuid;
begin
  perform media_processing.require_service();
  if not exists(select 1 from media_processing.settings where singleton and maintenance_enabled) then return result; end if;
  for a in select * from media_processing.attempts where not cleanup_done
    and cleanup_attempts<10
    and (cleanup_pending or closed_at is null)
    and (cleanup_pending or (closed_at is null and expires_at<=clock_timestamp()))
    and (cleanup_until is null or cleanup_until<=clock_timestamp())
    order by expires_at limit least(greatest(coalesce(p_limit,10),1),10) for update skip locked loop
    if exists(select 1 from media_processing.variants where lease_id=a.lease_id and active) then continue; end if;
    token:=gen_random_uuid();
    update media_processing.attempts set closed_at=coalesce(closed_at,clock_timestamp()),cleanup_pending=true,
      cleanup_lease=token,cleanup_until=clock_timestamp()+interval '90 seconds',cleanup_attempts=cleanup_attempts+1 where lease_id=a.lease_id;
    select * into o from storage.objects where bucket_id=a.bucket and name=a.path;
    if not found then update media_processing.attempts set cleanup_done=true where lease_id=a.lease_id; continue; end if;
    result:=result||jsonb_build_array(jsonb_build_object('lease_id',a.lease_id,'cleanup_lease',token,'bucket',a.bucket,'path',a.path,'object_id',o.id,'version',o.version));
  end loop;
  return result;
end $$;
create function public.finish_media_cleanup_v1(p_lease_id uuid,p_cleanup_lease uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare a media_processing.attempts;
begin
  perform media_processing.require_service();
  select * into a from media_processing.attempts where lease_id=p_lease_id and cleanup_lease=p_cleanup_lease for update;
  if not found or exists(select 1 from storage.objects where bucket_id=a.bucket and name=a.path) then return false; end if;
  update media_processing.attempts set cleanup_done=true where lease_id=p_lease_id; return true;
end $$;
create function public.prune_media_processing_v1(p_limit integer default 100) returns integer
language plpgsql security definer set search_path='' as $$
declare j record; total integer:=0;
begin
  perform media_processing.require_service();
  if not exists(select 1 from media_processing.settings where singleton and maintenance_enabled) then return 0; end if;
  for j in select q.id from media_processing.jobs q where q.state in ('cancelled','failed','passthrough')
    and q.updated_at<clock_timestamp()-interval '30 days'
    and not exists(select 1 from media_processing.attempts a where a.job_id=q.id and not a.cleanup_done)
    order by q.updated_at,q.id limit least(greatest(coalesce(p_limit,100),1),100) for update skip locked loop
    perform 1 from media_processing.attempts where job_id=j.id order by lease_id for update;
    delete from media_processing.variants where job_id=j.id;
    delete from media_processing.attempts where job_id=j.id;
    delete from media_processing.jobs where id=j.id;
    total:=total+1;
  end loop;
  return total;
end $$;
revoke all on all functions in schema media_processing from public, anon, authenticated, service_role;
revoke all on function public.enqueue_media_processing_v1(text,text,uuid,text),public.claim_media_processing_v1(text,integer),public.check_media_processing_v1(uuid,uuid,integer),public.finish_media_processing_v1(uuid,uuid,integer,text,text,integer),public.resolve_media_variant_v1(text,text,text,timestamptz),public.resolve_media_variant_for_ticket_v1(text,text,text,text),public.reconcile_media_processing_v1(integer),public.claim_media_cleanup_v1(integer),public.finish_media_cleanup_v1(uuid,uuid) from public,anon,authenticated;
grant execute on function public.enqueue_media_processing_v1(text,text,uuid,text),public.claim_media_processing_v1(text,integer),public.check_media_processing_v1(uuid,uuid,integer),public.finish_media_processing_v1(uuid,uuid,integer,text,text,integer),public.resolve_media_variant_v1(text,text,text,timestamptz),public.resolve_media_variant_for_ticket_v1(text,text,text,text),public.reconcile_media_processing_v1(integer),public.claim_media_cleanup_v1(integer),public.finish_media_cleanup_v1(uuid,uuid) to service_role;
revoke all on function public.prune_media_processing_v1(integer) from public,anon,authenticated;
grant execute on function public.prune_media_processing_v1(integer) to service_role;
commit;
