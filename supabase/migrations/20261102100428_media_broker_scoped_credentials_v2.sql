-- Scoped external media credentials. No Supabase service key leaves Edge Functions.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
alter table media_renditions.settings add column gateway_origin text check(gateway_origin is null or gateway_origin ~ '^https://[a-z0-9][a-z0-9.-]*[a-z0-9]$');
create function public.media_adaptive_gateway_origin_v2() returns text
language sql stable security definer set search_path='' as $$
 select gateway_origin from media_renditions.settings where singleton and delivery_enabled and not emergency_revoke
$$;
create table media_renditions.broker_keys (
 id uuid primary key default gen_random_uuid(),
 role text not null check(role in ('worker','gateway')),
 token_hash bytea not null check(octet_length(token_hash)=32),
 enabled boolean not null default true,
 expires_at timestamptz not null default (now()+interval '90 days'),
 max_requests_per_minute integer not null check(max_requests_per_minute between 64 and 1048576),
 created_at timestamptz not null default now()
);
create table media_renditions.broker_nonces (
 key_id uuid not null references media_renditions.broker_keys(id) on delete cascade,
 request_id uuid not null,expires_at timestamptz not null,
 primary key(key_id,request_id)
);
create index media_broker_nonces_expiry on media_renditions.broker_nonces(expires_at);
create table media_renditions.broker_rates (
 key_id uuid not null references media_renditions.broker_keys(id) on delete cascade,
 minute_at timestamptz not null,shard integer not null check(shard between 0 and 63),
 requests integer not null,primary key(key_id,minute_at,shard)
);
create index media_broker_rates_expiry on media_renditions.broker_rates(minute_at);
alter table media_renditions.broker_keys enable row level security;
alter table media_renditions.broker_nonces enable row level security;
alter table media_renditions.broker_rates enable row level security;
revoke all on media_renditions.broker_keys,media_renditions.broker_nonces,media_renditions.broker_rates from public,anon,authenticated,service_role;

create function public.authorize_media_broker_v2(p_key_id uuid,p_token_hash text,p_request_id uuid,p_issued_at timestamptz) returns text
language plpgsql security definer set search_path='' as $$
declare k media_renditions.broker_keys; supplied bytea;difference integer:=0;i integer;n integer;slot integer;
begin
 perform media_processing.require_service();
 if p_token_hash !~ '^[0-9a-f]{64}$' or p_issued_at is null or p_request_id is null
  or abs(extract(epoch from clock_timestamp()-p_issued_at))>60 then return null;end if;
 select * into k from media_renditions.broker_keys where id=p_key_id and enabled and expires_at>clock_timestamp();
 if not found then return null;end if;
 supplied:=decode(p_token_hash,'hex');
 -- Compare all 32 hash bytes, regardless of the first differing byte.
 for i in 0..31 loop difference:=difference | (get_byte(supplied,i) # get_byte(k.token_hash,i));end loop;
 if difference<>0 then return null;end if;
 -- Distinct random request IDs distribute limiter writes across 64 rows.
 slot:=get_byte(extensions.digest(p_request_id::text,'sha256'),0)%64;
 insert into media_renditions.broker_rates(key_id,minute_at,shard,requests)
  values(k.id,date_trunc('minute',clock_timestamp()),slot,1)
  on conflict(key_id,minute_at,shard) do update set requests=media_renditions.broker_rates.requests+1
  returning requests into n;
 if n>floor(k.max_requests_per_minute/64.0) then return 'rate_limited';end if;
 insert into media_renditions.broker_nonces(key_id,request_id,expires_at) values(k.id,p_request_id,clock_timestamp()+interval '2 minutes') on conflict do nothing;
 get diagnostics n=row_count;
 if n<>1 then return null;end if;
 return k.role;
end $$;

create function public.media_rendition_transfer_v2(p_job_id uuid,p_lease_id uuid,p_attempt integer,p_name text default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare j media_renditions.jobs;a media_renditions.attempts;x media_renditions.assets;
begin
 perform media_processing.require_service();
 if not public.check_media_rendition_v2(p_job_id,p_lease_id,p_attempt) then return null;end if;
 select * into j from media_renditions.jobs where id=p_job_id;
 select * into a from media_renditions.attempts where lease_id=p_lease_id and closed_at is null;
 if not found then return null;end if;
 if p_name is null then return jsonb_build_object('bucket',j.source_bucket,'path',j.source_path,'bytes',j.source_bytes,'etag',j.source_etag,'version',j.source_version);end if;
 select * into x from media_renditions.assets where lease_id=p_lease_id and name=p_name;
 if not found then return null;end if;
 return jsonb_build_object('bucket','adaptive-media','path',a.prefix||x.name,'bytes',x.bytes,'mime',x.mime,
  'metadata',jsonb_build_object('processing_job_id',j.id,'processing_lease_id',a.lease_id,'source_id',j.source_id,'source_version',j.source_version,'sha256',x.sha256));
end $$;

create function public.media_rendition_cleanup_transfer_v2(p_lease_id uuid,p_cleanup_lease uuid,p_names jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare a media_renditions.attempts;
begin
 perform media_processing.require_service();
 if jsonb_typeof(p_names)<>'array' or jsonb_array_length(p_names) not between 1 and 100 then return null;end if;
 select * into a from media_renditions.attempts where lease_id=p_lease_id and cleanup_lease=p_cleanup_lease
  and cleanup_until>clock_timestamp() and cleanup_pending and not cleanup_done and closed_at is not null;
 if not found or exists(select 1 from jsonb_array_elements_text(p_names) n(name) where not exists(
  select 1 from media_renditions.assets x where x.lease_id=p_lease_id and x.name=n.name)) then return null;end if;
 return jsonb_build_object('bucket','adaptive-media','prefixes',(select jsonb_agg(a.prefix||n.name) from jsonb_array_elements_text(p_names) n(name)));
end $$;

create function public.prune_media_broker_v2(p_limit integer default 20000) returns integer
language plpgsql security definer set search_path='' as $$
declare n integer;extra integer;
begin
 -- Explicit ACL authorizes service callers and the postgres-owned scheduler.
 with expired as(select key_id,request_id from media_renditions.broker_nonces where expires_at<clock_timestamp() order by expires_at limit least(greatest(p_limit,1),20000) for update skip locked)
 delete from media_renditions.broker_nonces t using expired e where t.key_id=e.key_id and t.request_id=e.request_id;
 get diagnostics n=row_count;
 with expired as(select key_id,minute_at,shard from media_renditions.broker_rates where minute_at<clock_timestamp()-interval '3 minutes' order by minute_at limit 2048 for update skip locked)
 delete from media_renditions.broker_rates t using expired e where t.key_id=e.key_id and t.minute_at=e.minute_at and t.shard=e.shard;
 get diagnostics extra=row_count;return n+extra;
end $$;

do $$declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in('authorize_media_broker_v2','media_rendition_transfer_v2','media_rendition_cleanup_transfer_v2','prune_media_broker_v2','media_adaptive_gateway_origin_v2') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
-- Expired nonces are removable only after the timestamp replay window closes.
do $$begin
 if exists(select 1 from pg_extension where extname='pg_cron') then
  -- 240k expired nonces/minute exceeds the two normal key budgets plus rotation overlap.
  perform cron.schedule('media-broker-prune-v2','5 seconds','select public.prune_media_broker_v2(20000)');
 end if;
end $$;
commit;
