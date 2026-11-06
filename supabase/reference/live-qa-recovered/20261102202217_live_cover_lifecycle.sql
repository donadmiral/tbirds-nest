-- Immutable cover ownership, account erasure and bounded abandoned-file cleanup.
-- Storage bytes are deleted only through the Storage API by the worker.
begin;
set local lock_timeout='3s';
set local statement_timeout='60s';
alter table live_streams.settings drop constraint settings_max_stage_members_check;
alter table live_streams.settings add constraint settings_max_stage_members_check check(max_stage_members between 2 and 12);
alter table live_streams.cover_uploads add column issuer_auth_session_id uuid default nullif(auth.jwt()->>'session_id','')::uuid;
alter table live_streams.cover_uploads add column cleanup_started_at timestamptz;
create index live_cover_uploads_expiry on live_streams.cover_uploads(created_at,object_path) where cleanup_started_at is null;
create table live_streams.cover_cleanup (
 id uuid primary key default gen_random_uuid(), object_path text not null unique, user_id uuid not null,
 object_id uuid, object_version text, state text not null default 'pending' check(state in ('pending','leased','done','dead')),
 lease_id uuid, lease_until timestamptz, attempts integer not null default 0,
 available_at timestamptz not null default now(), created_at timestamptz not null default now(), last_error text
);
alter table live_streams.cover_cleanup enable row level security;
revoke all on live_streams.cover_cleanup from public,anon,authenticated,service_role;
create index live_cover_cleanup_due on live_streams.cover_cleanup(available_at,id) where state in ('pending','leased');

create function live_streams.bind_cover_owner() returns trigger language plpgsql security definer set search_path='' as $$
declare asset live_streams.cover_uploads;
begin
 if new.bucket_id<>'live-covers' then return new;end if;
 select * into asset from live_streams.cover_uploads where object_path=new.name for update;
 if not found or asset.finalized_at is not null or asset.cleanup_started_at is not null or asset.created_at<now()-interval '2 hours'
  or asset.issuer_auth_session_id is null or not live_streams.publisher_allowed(asset.user_id,asset.issuer_auth_session_id)
  or not live_streams.can_view(asset.session_id,asset.user_id) or live_streams.role_for(asset.session_id,asset.user_id) not in ('host','producer')
  or exists(select 1 from live_streams.cover_cleanup where object_path=new.name)
  then raise exception 'LIVE_COVER_UPLOAD_NOT_AUTHORIZED' using errcode='42501';end if;
 if new.name !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$'
  or split_part(new.name,'/',1)<>asset.user_id::text or split_part(new.name,'/',2)<>asset.session_id::text
  then raise exception 'LIVE_COVER_UPLOAD_NOT_AUTHORIZED' using errcode='42501';end if;
 if tg_op='UPDATE' and (old.id<>new.id or old.bucket_id<>new.bucket_id or old.name<>new.name) then raise exception 'LIVE_COVER_IMMUTABLE';end if;
 -- Signed service uploads do not inherit the user's JWT. The unforgeable
 -- database grant binds real ownership before existing erasure scans see it.
 perform account_erasure.assert_writable(asset.user_id);
 new.owner:=asset.user_id;new.owner_id:=asset.user_id::text;
 return new;
end $$;
create trigger live_cover_owned_upload before insert or update on storage.objects for each row execute function live_streams.bind_cover_owner();

-- Preserve the existing erasure decisions; extend only the bucket allowlist.
do $$declare source text;anchor text:='''post-media'',''story-media''';begin
 source:=pg_get_functiondef('account_erasure.review_reason(uuid)'::regprocedure);
 if (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 then raise exception 'LIVE_ERASURE_CONTRACT_CHANGED';end if;
 execute replace(source,anchor,'''live-covers'',''post-media'',''story-media''');
end $$;
-- Make a retired object permanently unavailable for finalization. This closes
-- a cleanup/finalize race without deleting storage metadata in SQL.
do $$declare source text;anchor text;begin
 source:=pg_get_functiondef('live_streams.cover_upload(uuid,text,text,uuid)'::regprocedure);
 anchor:='if asset.created_at<now()-interval ''2 hours'' then';
 if position(anchor in source)=0 then raise exception 'LIVE_COVER_UPLOAD_CONTRACT_CHANGED';end if;
 source:=replace(source,anchor,'if asset.cleanup_started_at is not null or asset.created_at<now()-interval ''2 hours'' then');
 source:=replace(source,'if not found or asset.created_at<now()-interval ''2 hours'' and asset.finalized_at is null then',
  'if not found or asset.cleanup_started_at is not null or asset.created_at<now()-interval ''2 hours'' and asset.finalized_at is null then');execute source;
 source:=pg_get_functiondef('live_streams.cover_finalize(uuid,uuid,uuid,text,integer,integer)'::regprocedure);
 anchor:='if not found or asset.created_at<now()-interval ''2 hours'' and asset.finalized_at is null then';
 if position(anchor in source)=0 then raise exception 'LIVE_COVER_FINALIZE_CONTRACT_CHANGED';end if;
 source:=replace(source,anchor,'if not found or asset.cleanup_started_at is not null or asset.created_at<now()-interval ''2 hours'' and asset.finalized_at is null then');
 source:=replace(source,'where o.bucket_id=''live-covers'' and o.name=p_path;',
  'where o.bucket_id=''live-covers'' and o.name=p_path and coalesce(o.owner_id,o.owner::text)=p_actor::text;');execute source;
end $$;

create function live_streams.cover_deleted() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into live_streams.cover_cleanup(object_path,user_id,object_id,object_version)
 select old.object_path,old.user_id,o.id,o.version from (select 1) x left join storage.objects o on o.bucket_id='live-covers' and o.name=old.object_path
 on conflict(object_path) do nothing;
 update live_streams.sessions set cover_object_path=null,updated_at=now() where cover_object_path=old.object_path;
 return old;
end $$;
create trigger live_cover_grant_deleted before delete on live_streams.cover_uploads for each row execute function live_streams.cover_deleted();

create function live_streams.claim_cover_cleanup(p_limit integer default 25) returns jsonb language plpgsql security definer set search_path='' as $$
declare asset live_streams.cover_uploads;items jsonb;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'SERVICE_REQUIRED';end if;
 for asset in select a.* from live_streams.cover_uploads a where a.cleanup_started_at is null and a.created_at<now()-interval '1 day'
  and not exists(select 1 from live_streams.sessions s where s.cover_object_path=a.object_path)
  order by a.created_at,a.object_path for update of a skip locked limit 50 loop
  update live_streams.cover_uploads set cleanup_started_at=now() where object_path=asset.object_path;
  insert into live_streams.cover_cleanup(object_path,user_id,object_id,object_version)
   select asset.object_path,asset.user_id,o.id,o.version from (select 1) x left join storage.objects o on o.bucket_id='live-covers' and o.name=asset.object_path
   on conflict(object_path) do nothing;
 end loop;
 with claimed as(select id from live_streams.cover_cleanup where state in ('pending','leased') and available_at<=now()
  and (lease_until is null or lease_until<=now()) and attempts<8 order by available_at,id for update skip locked limit greatest(1,least(coalesce(p_limit,25),25))),updated as(
  update live_streams.cover_cleanup c set state='leased',lease_id=gen_random_uuid(),lease_until=now()+interval '60 seconds',attempts=attempts+1
  from claimed where c.id=claimed.id returning c.*)
 select coalesce(jsonb_agg(to_jsonb(updated)),'[]') into items from updated;
 return jsonb_build_object('items',items);
end $$;
create function live_streams.check_cover_cleanup(p_id uuid,p_lease uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare job live_streams.cover_cleanup;obj storage.objects;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'SERVICE_REQUIRED';end if;
 select * into job from live_streams.cover_cleanup where id=p_id and lease_id=p_lease and state='leased' and lease_until>now() for update;
 if not found then raise exception 'COVER_LEASE_EXPIRED';end if;
 if exists(select 1 from live_streams.sessions where cover_object_path=job.object_path) then raise exception 'COVER_IN_USE';end if;
 select * into obj from storage.objects where bucket_id='live-covers' and name=job.object_path;
 if not found then return jsonb_build_object('absent',true,'object_path',job.object_path);end if;
 if (obj.id,obj.version) is distinct from (job.object_id,job.object_version) or coalesce(obj.owner_id,obj.owner::text) is distinct from job.user_id::text then
  raise exception 'COVER_OBJECT_CHANGED';end if;
 return jsonb_build_object('absent',false,'object_path',job.object_path);
end $$;
create function live_streams.finish_cover_cleanup(p_id uuid,p_lease uuid,p_ok boolean,p_error text) returns jsonb language plpgsql security definer set search_path='' as $$
declare job live_streams.cover_cleanup;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'SERVICE_REQUIRED';end if;
 select * into job from live_streams.cover_cleanup where id=p_id and lease_id=p_lease and state='leased' for update;
 if not found then raise exception 'COVER_LEASE_EXPIRED';end if;
 if p_ok and exists(select 1 from storage.objects where bucket_id='live-covers' and name=job.object_path) then raise exception 'COVER_BYTES_NOT_ERASED';end if;
 update live_streams.cover_cleanup set state=case when p_ok then 'done' when attempts>=8 then 'dead' else 'pending' end,
  available_at=now()+make_interval(secs=>least(900,5*(2^attempts)::integer)),lease_until=null,last_error=case when p_ok then null else left(p_error,200) end where id=job.id;
 if p_ok then delete from live_streams.cover_uploads where object_path=job.object_path and cleanup_started_at is not null;end if;
 -- Keep immutable tombstones for a month. Signed upload credentials expire in
 -- two hours, and removing the grant permanently prevents new writes.
 with old as(select id from live_streams.cover_cleanup where state='done' and created_at<now()-interval '30 days' order by created_at for update skip locked limit 25)
 delete from live_streams.cover_cleanup c using old where c.id=old.id;
 return jsonb_build_object('ok',true);
end $$;
create function public.live_claim_cover_cleanup(p_limit integer default 25) returns jsonb language sql security invoker set search_path='' as $$select live_streams.claim_cover_cleanup(p_limit);$$;
create function public.live_check_cover_cleanup(p_id uuid,p_lease uuid) returns jsonb language sql security invoker set search_path='' as $$select live_streams.check_cover_cleanup(p_id,p_lease);$$;
create function public.live_finish_cover_cleanup(p_id uuid,p_lease uuid,p_ok boolean,p_error text default null) returns jsonb language sql security invoker set search_path='' as $$select live_streams.finish_cover_cleanup(p_id,p_lease,p_ok,p_error);$$;
revoke all on function live_streams.bind_cover_owner(),live_streams.cover_deleted(),live_streams.claim_cover_cleanup(integer),live_streams.check_cover_cleanup(uuid,uuid),live_streams.finish_cover_cleanup(uuid,uuid,boolean,text),
 public.live_claim_cover_cleanup(integer),public.live_check_cover_cleanup(uuid,uuid),public.live_finish_cover_cleanup(uuid,uuid,boolean,text) from public,anon,authenticated,service_role;
grant execute on function live_streams.claim_cover_cleanup(integer),live_streams.check_cover_cleanup(uuid,uuid),live_streams.finish_cover_cleanup(uuid,uuid,boolean,text),
 public.live_claim_cover_cleanup(integer),public.live_check_cover_cleanup(uuid,uuid),public.live_finish_cover_cleanup(uuid,uuid,boolean,text) to service_role;
commit;
