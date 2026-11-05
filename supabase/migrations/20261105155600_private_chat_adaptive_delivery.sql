-- Separate, session-bound chat HLS. Generic content-ticket delivery is unchanged.
-- Installation is inert. Enable this lane only after encoder/Edge/client rollout.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
create schema private_hls;
revoke all on schema private_hls from public,anon,authenticated,service_role;
create table private_hls.settings(singleton boolean primary key default true check(singleton),enabled boolean not null default false);
insert into private_hls.settings(singleton) values(true);
create table private_hls.grants(
 user_id uuid not null references auth.users(id) on delete cascade,
 request_id uuid not null,session_id uuid not null references auth.sessions(id) on delete cascade,
 message_id uuid not null references public.messages(id) on delete cascade,
 source_id uuid,source_version text,source_url text,source_owner uuid,lease_id uuid,
 expires_at timestamptz not null,closed_at timestamptz,created_at timestamptz not null default clock_timestamp(),
 primary key(user_id,request_id),check(closed_at is not null or (source_id is not null and source_version is not null and source_url is not null and source_owner is not null))
);
create index private_hls_expiry on private_hls.grants(user_id,expires_at);
create index private_hls_message on private_hls.grants(message_id);
create index private_hls_source on private_hls.grants(source_id);
create index private_hls_message_video_locator on public.messages(public.chat_object_path(media_url)) where deleted_at is null and media_type='video';
create index private_hls_job_locator on media_renditions.jobs(source_bucket,source_path) where state in ('pending','processing','retry','ready');
alter table private_hls.settings enable row level security;
alter table private_hls.grants enable row level security;
revoke all on all tables in schema private_hls from public,anon,authenticated,service_role;
create function private_hls.session_id() returns uuid language plpgsql stable security definer set search_path='' as $$
declare sid uuid;
begin
 if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then return null;end if;
 begin sid:=(auth.jwt()->>'session_id')::uuid;exception when others then return null;end;
 if not exists(select 1 from auth.sessions s join auth.users u on u.id=s.user_id join public.profiles p on p.id=u.id
  where s.id=sid and s.user_id=auth.uid() and (s.not_after is null or s.not_after>clock_timestamp())
  and u.deleted_at is null and (u.banned_until is null or u.banned_until<=clock_timestamp()) and p.deactivated_at is null) then return null;end if;
 return sid;
end $$;
-- Capture only newly created original limited-view grants. Older grants remain
-- usable by the original reader but cannot be upgraded without a source pin.
create table private_hls.limited_bindings(
 user_id uuid not null,request_id uuid not null,session_id uuid not null references auth.sessions(id) on delete cascade,
 message_id uuid not null,source_id uuid not null,source_version text not null,source_url text not null,source_owner text,
 primary key(user_id,request_id),foreign key(user_id,request_id) references public.chat_media_view_grants(user_id,request_id) on delete cascade
);
alter table private_hls.limited_bindings enable row level security;
revoke all on private_hls.limited_bindings from public,anon,authenticated,service_role;
create function private_hls.bind_limited_grant() returns trigger language plpgsql security definer set search_path='' as $$
declare sid uuid:=private_hls.session_id();m public.messages;o storage.objects;loc text;
begin
 if sid is null or new.user_id is distinct from auth.uid() or to_regnamespace('private_media') is not null then return null;end if;
 select * into m from public.messages where id=new.message_id and deleted_at is null and media_type='video' and view_limit is not null;
 if not found then return null;end if;
 loc:=public.chat_object_path(m.media_url);
 select * into o from storage.objects where bucket_id=split_part(loc,'/',1) and name=substring(loc from position('/' in loc)+1) and version is not null;
 if not found or coalesce(nullif(o.owner_id,''),o.owner::text) is distinct from m.sender_id::text then return null;end if;
 insert into private_hls.limited_bindings(user_id,request_id,session_id,message_id,source_id,source_version,source_url,source_owner)
 values(new.user_id,new.request_id,sid,new.message_id,o.id,o.version,m.media_url,coalesce(nullif(o.owner_id,''),o.owner::text));
 return null;
end $$;
create trigger private_hls_bind_limited after insert on public.chat_media_view_grants for each row execute function private_hls.bind_limited_grant();
-- Source admission is independent of viewer access. A viewer is authorized again
-- below for every request; these files are never served by the generic gateway.
create function private_hls.source_snapshot(p_id uuid,p_version text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not exists(select 1 from private_hls.settings where enabled) then return null;end if;
 select jsonb_build_object('id',o.id,'version',o.version,'bucket',o.bucket_id,'path',o.name,'owner',m.sender_id,
   'bytes',(o.metadata->>'size')::bigint,'etag',trim(both '"' from coalesce(o.metadata->>'eTag',o.metadata->>'etag')),'mime',split_part(o.metadata->>'mimetype',';',1))
 into result from storage.objects o
 join public.messages m on public.chat_object_path(m.media_url)=o.bucket_id||'/'||o.name
 join auth.users u on u.id=m.sender_id and u.deleted_at is null and (u.banned_until is null or u.banned_until<=clock_timestamp())
 join public.profiles p on p.id=m.sender_id and p.deactivated_at is null
 where o.id=p_id and o.version=p_version and o.bucket_id in ('chat-media','chat-files')
  and length(o.version) between 1 and 128 and o.name ~* '\.(mp4|mov|m4v)$'
  and o.name !~ '(%|\\|(^|/)\.\.?(/|$)|//|[[:cntrl:]])'
  and split_part(o.name,'/',1)=m.sender_id::text and coalesce(nullif(o.owner_id,''),o.owner::text)=m.sender_id::text
  and m.deleted_at is null and m.media_type='video'
  and (m.view_limit is null or to_regnamespace('private_media') is null)
  and split_part(o.metadata->>'mimetype',';',1) in ('video/mp4','video/quicktime')
  and case when o.metadata->>'size' ~ '^[0-9]{1,12}$' then (o.metadata->>'size')::bigint between 1 and 536870912 else false end
  and length(trim(both '"' from coalesce(o.metadata->>'eTag',o.metadata->>'etag'))) between 1 and 256
  and coalesce(o.metadata->>'eTag',o.metadata->>'etag') not like 'W/%'
 limit 1;
 return result;
end $$;
-- Preserve the complete existing content/clip implementation under its own name.
do $$declare body text;begin
 body:=pg_get_functiondef('media_renditions.source_snapshot(uuid,text)'::regprocedure);
 body:=replace(body,'FUNCTION media_renditions.source_snapshot(', 'FUNCTION private_hls.content_source_snapshot(');
 if body not like '%FUNCTION private_hls.content_source_snapshot(%' then raise exception 'Unexpected source snapshot definition';end if;
 execute body;
end $$;
create or replace function media_renditions.source_snapshot(p_id uuid,p_version text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;begin
 result:=private_hls.content_source_snapshot(p_id,p_version);
 if result is null then result:=private_hls.source_snapshot(p_id,p_version);end if;
 return result;
end $$;
create function private_hls.refresh_source(p_bucket text,p_path text) returns void language plpgsql security definer set search_path='' as $$
declare o storage.objects;j record;
begin
 if p_bucket not in ('chat-media','chat-files') or p_path is null then return;end if;
 select * into o from storage.objects where bucket_id=p_bucket and name=p_path;
 for j in select * from media_renditions.jobs where source_bucket=p_bucket and source_path=p_path and state in ('pending','processing','retry','ready') loop
  if o.id is null or o.version is distinct from j.source_version or private_hls.source_snapshot(j.source_id,j.source_version) is null then
   perform media_renditions.cancel(j.id,'chat_source_revoked');
  end if;
 end loop;
 if o.id is not null and private_hls.source_snapshot(o.id,o.version) is not null then perform media_renditions.enqueue(o.id,o.version);end if;
end $$;
create function private_hls.message_changed() returns trigger language plpgsql security definer set search_path='' as $$
declare loc text;begin
 if tg_op='INSERT' and new.media_type is distinct from 'video' then return null;end if;
 if tg_op='DELETE' and old.media_type is distinct from 'video' then return null;end if;
 if tg_op='UPDATE' and old.media_type is distinct from 'video' and new.media_type is distinct from 'video' then return null;end if;
 if tg_op='UPDATE' and new.media_url is not distinct from old.media_url and new.deleted_at is not distinct from old.deleted_at and new.sender_id is not distinct from old.sender_id and new.media_type is not distinct from old.media_type and new.view_limit is not distinct from old.view_limit then return null;end if;
 if tg_op<>'INSERT' then
  loc:=public.chat_object_path(old.media_url);perform private_hls.refresh_source(split_part(loc,'/',1),substring(loc from position('/' in loc)+1));
  if tg_op='DELETE' or (tg_op='UPDATE' and (new.media_url is distinct from old.media_url or new.deleted_at is distinct from old.deleted_at or new.sender_id is distinct from old.sender_id)) then
   update private_hls.grants set closed_at=coalesce(closed_at,clock_timestamp()) where message_id=old.id;
  end if;
 end if;
 if tg_op<>'DELETE' then loc:=public.chat_object_path(new.media_url);perform private_hls.refresh_source(split_part(loc,'/',1),substring(loc from position('/' in loc)+1));end if;
 return null;
end $$;
create trigger private_hls_message_change after insert or update or delete on public.messages for each row execute function private_hls.message_changed();
create function private_hls.storage_changed() returns trigger language plpgsql security definer set search_path='' as $$
declare j record;begin
 if tg_op<>'INSERT' and old.bucket_id in ('chat-media','chat-files') then
  if tg_op='UPDATE' and old.id=new.id and old.version is not distinct from new.version and old.name=new.name and old.bucket_id=new.bucket_id
   and old.metadata is not distinct from new.metadata and old.user_metadata is not distinct from new.user_metadata
   and old.owner_id is not distinct from new.owner_id and old.owner is not distinct from new.owner then return new;end if;
  for j in select id from media_renditions.jobs where source_id=old.id and state in ('pending','processing','retry','ready') loop perform media_renditions.cancel(j.id,'chat_source_changed');end loop;
  update private_hls.grants set closed_at=coalesce(closed_at,clock_timestamp()) where source_id=old.id;
 end if;
 if tg_op<>'DELETE' and new.bucket_id in ('chat-media','chat-files') then perform private_hls.refresh_source(new.bucket_id,new.name);end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
create trigger private_hls_storage_change after insert or update or delete on storage.objects for each row execute function private_hls.storage_changed();
-- Existing legacy limited-view grants own the view counter and source binding.
-- A later private_media-v2 cutover intentionally fails closed until its adapter
-- is installed, rather than silently replacing its new erasure semantics.
create function private_hls.authorized_source(p_message uuid,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.messages;o storage.objects;bound private_hls.limited_bindings;loc text;deadline timestamptz:=clock_timestamp()+interval '15 minutes';
begin
 if private_hls.session_id() is null then return null;end if;
 select * into m from public.messages where id=p_message and deleted_at is null and media_type='video';
 if not found then return null;end if;
 if exists(select 1 from public.blocked_users b where (b.blocker_id=auth.uid() and b.blocked_id=m.sender_id) or (b.blocked_id=auth.uid() and b.blocker_id=m.sender_id)) then return null;end if;
 if m.view_limit is null then
  if not exists(select 1 from public.chat_media_manifest(array[p_message]) v where v.id=p_message and v.media_url=m.media_url and v.view_limit is null) then return null;end if;
 else
  if to_regnamespace('private_media') is not null then return null;end if;
  select * into bound from private_hls.limited_bindings where user_id=auth.uid() and request_id=p_request and message_id=p_message and session_id=private_hls.session_id();
  if not found or bound.source_url is distinct from m.media_url then return null;end if;
  select least(deadline,g.expires_at) into deadline from public.chat_media_view_grants g
   where g.user_id=auth.uid() and g.request_id=p_request and g.message_id=p_message and g.expires_at>clock_timestamp();
  if not found or not exists(select 1 from public.chat_media_manifest(array[p_message]) v where v.id=p_message and v.media_url=m.media_url and v.view_limit is not null) then return null;end if;
 end if;
 loc:=public.chat_object_path(m.media_url);
 select * into o from storage.objects where bucket_id=split_part(loc,'/',1) and name=substring(loc from position('/' in loc)+1);
 if not found or (m.view_limit is not null and (bound.source_id is distinct from o.id or bound.source_version is distinct from o.version or bound.source_owner is distinct from coalesce(nullif(o.owner_id,''),o.owner::text))) or private_hls.source_snapshot(o.id,o.version) is null then return null;end if;
 return jsonb_build_object('sourceId',o.id,'sourceVersion',o.version,'sourceUrl',m.media_url,'sourceOwner',m.sender_id,'expiresAt',deadline);
end $$;
create function public.read_chat_hls_v1(p_message_id uuid,p_request_id uuid,p_source_version text,p_lease_id uuid,p_name text default 'master.m3u8') returns jsonb language plpgsql security definer set search_path='' as $$
declare g private_hls.grants;s jsonb;j media_renditions.jobs;p media_renditions.publications;a media_renditions.attempts;x media_renditions.assets;
begin
 if not exists(select 1 from private_hls.settings where enabled) or not exists(select 1 from media_renditions.settings where delivery_enabled and not emergency_revoke)
  or p_name is null or p_name !~ '^(master\.m3u8|r[0-3]/(index\.m3u8|seg[0-9]{5}\.ts))$' then return null;end if;
 select * into g from private_hls.grants where user_id=auth.uid() and request_id=p_request_id and message_id=p_message_id and session_id=private_hls.session_id()
  and closed_at is null and expires_at>clock_timestamp() and source_version=p_source_version and lease_id=p_lease_id;
 if not found then return null;end if;
 s:=private_hls.authorized_source(p_message_id,p_request_id);
 if s is null or s->>'sourceId'<>g.source_id::text or s->>'sourceVersion'<>g.source_version or s->>'sourceUrl'<>g.source_url or s->>'sourceOwner'<>g.source_owner::text then return null;end if;
 select * into j from media_renditions.jobs where source_id=g.source_id and source_version=g.source_version and state='ready';
 if not found or not media_renditions.source_matches(j) then return null;end if;
 select * into p from media_renditions.publications where job_id=j.id and lease_id=g.lease_id and active;
 if not found then return null;end if;
 select * into a from media_renditions.attempts where lease_id=p.lease_id and not cleanup_pending and not cleanup_done;
 if not found or not exists(select 1 from storage.buckets where id='adaptive-media' and not public) then return null;end if;
 select * into x from media_renditions.assets where lease_id=p.lease_id and name=p_name;
 if not found or (p_name like '%.ts' and x.bytes>16777216) or not exists(select 1 from storage.objects o where o.id=x.object_id and o.version=x.object_version and o.bucket_id='adaptive-media' and o.name=a.prefix||x.name
  and trim(both '"' from coalesce(o.metadata->>'eTag',o.metadata->>'etag'))=x.etag) then return null;end if;
 return jsonb_build_object('leaseId',g.lease_id,'sourceVersion',g.source_version,'expiresAt',least(g.expires_at,(s->>'expiresAt')::timestamptz),'bucket','adaptive-media','path',a.prefix||x.name,
  'name',x.name,'version',x.object_version,'etag',x.etag,'sha256',x.sha256,'bytes',x.bytes,'mime',x.mime,'playlist',x.playlist);
end $$;
create function public.open_chat_hls_v1(p_message_id uuid,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare sid uuid:=private_hls.session_id();g private_hls.grants;s jsonb;lease uuid;
begin
 if sid is null or p_request_id is null or not exists(select 1 from private_hls.settings where enabled) then return null;end if;
 perform pg_advisory_xact_lock(hashtextextended('private-hls:'||auth.uid()::text,0));
 delete from private_hls.grants where (user_id,request_id) in (select user_id,request_id from private_hls.grants where user_id=auth.uid() and expires_at<clock_timestamp()-interval '24 hours' order by expires_at limit 128);
 select * into g from private_hls.grants where user_id=auth.uid() and request_id=p_request_id for update;
 if found and (g.closed_at is not null or g.expires_at<=clock_timestamp() or g.message_id<>p_message_id or g.session_id<>sid) then return null;end if;
 s:=private_hls.authorized_source(p_message_id,p_request_id);if s is null then return null;end if;
 if g.request_id is not null and (g.source_id::text<>s->>'sourceId' or g.source_version<>s->>'sourceVersion' or g.source_url<>s->>'sourceUrl') then return null;end if;
 select p.lease_id into lease from media_renditions.jobs j join media_renditions.publications p on p.job_id=j.id and p.active
 where j.source_id=(s->>'sourceId')::uuid and j.source_version=s->>'sourceVersion' and j.state='ready';
 if lease is null then return null;end if;
 if g.request_id is null then
  if (select count(*) from (select 1 from private_hls.grants where user_id=auth.uid() and expires_at>clock_timestamp() limit 128) q)>=128 then return null;end if;
  insert into private_hls.grants(user_id,request_id,session_id,message_id,source_id,source_version,source_url,source_owner,lease_id,expires_at)
  values(auth.uid(),p_request_id,sid,p_message_id,(s->>'sourceId')::uuid,s->>'sourceVersion',s->>'sourceUrl',(s->>'sourceOwner')::uuid,lease,(s->>'expiresAt')::timestamptz) returning * into g;
 end if;
 return public.read_chat_hls_v1(p_message_id,p_request_id,g.source_version,g.lease_id,'master.m3u8');
end $$;
create function public.close_chat_hls_v1(p_message_id uuid,p_request_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare sid uuid:=private_hls.session_id();g private_hls.grants;
begin
 if sid is null or p_request_id is null or p_message_id is null then return false;end if;
 perform pg_advisory_xact_lock(hashtextextended('private-hls:'||auth.uid()::text,0));
 delete from private_hls.grants where (user_id,request_id) in (select user_id,request_id from private_hls.grants where user_id=auth.uid() and expires_at<clock_timestamp()-interval '24 hours' order by expires_at limit 128);
 select * into g from private_hls.grants where user_id=auth.uid() and request_id=p_request_id for update;
 if found then
  if g.session_id<>sid or g.message_id<>p_message_id then return false;end if;
  update private_hls.grants set closed_at=coalesce(closed_at,clock_timestamp()) where user_id=auth.uid() and request_id=p_request_id;return true;
 end if;
 -- A close before a delayed open is terminal. It does not create/consume a
 -- limited-view grant, and outsiders cannot reserve another message's IDs.
 if not exists(select 1 from public.chat_media_manifest(array[p_message_id]) where id=p_message_id) then return false;end if;
 if (select count(*) from (select 1 from private_hls.grants where user_id=auth.uid() and expires_at>clock_timestamp() limit 128) q)>=128 then return false;end if;
 insert into private_hls.grants(user_id,request_id,session_id,message_id,expires_at,closed_at) values(auth.uid(),p_request_id,sid,p_message_id,clock_timestamp()+interval '15 minutes',clock_timestamp());
 return true;
end $$;
create function public.backfill_chat_hls_v1(p_after_id uuid default null,p_limit integer default 50,p_dry_run boolean default true) returns jsonb language plpgsql security definer set search_path='' as $$
declare o record;last_id uuid:=p_after_id;n integer:=0;eligible integer:=0;begin
 perform media_processing.require_service();
 if p_limit is null or p_limit not between 1 and 50 or p_dry_run is null then raise exception 'Invalid bounded backfill';end if;
 for o in select id,version from storage.objects where bucket_id in ('chat-media','chat-files') and (p_after_id is null or id>p_after_id) order by id limit p_limit loop
  n:=n+1;last_id:=o.id;if private_hls.source_snapshot(o.id,o.version) is not null then eligible:=eligible+1;if not p_dry_run then perform media_renditions.enqueue(o.id,o.version);end if;end if;
 end loop;
 return jsonb_build_object('scanned',n,'eligible',eligible,'nextAfterId',last_id,'hasMore',exists(select 1 from storage.objects where bucket_id in ('chat-media','chat-files') and id>last_id));
end $$;
-- Account deletion invalidates outstanding encoder leases in the same
-- transaction. Delivery already rejects a deleted/banned/deactivated owner.
create function private_hls.owner_changed() returns trigger language plpgsql security definer set search_path='' as $$
declare j record;uid uuid;begin
 uid:=case when tg_op='DELETE' then old.id else new.id end;
 if tg_op='UPDATE' and new.deleted_at is null and (new.banned_until is null or new.banned_until<=clock_timestamp()) then return null;end if;
 for j in select id from media_renditions.jobs where source_owner=uid and source_bucket in ('chat-media','chat-files') and state in ('pending','processing','retry','ready') loop perform media_renditions.cancel(j.id,'chat_owner_revoked');end loop;
 update private_hls.grants set closed_at=coalesce(closed_at,clock_timestamp()) where source_owner=uid or user_id=uid;
 return null;
end $$;
create trigger private_hls_owner_change after update or delete on auth.users for each row execute function private_hls.owner_changed();
-- This completion predicate covers every attempt, including cancelled encoders
-- with signed upload URLs. Existing storage lease checks prevent late writes.
create function private_hls.owner_erasure_ready(p_owner uuid) returns boolean language sql stable security definer set search_path='' as $$
 select not exists(select 1 from media_renditions.jobs j where j.source_owner=p_owner and j.source_bucket in ('chat-media','chat-files') and
  (j.state in ('pending','processing','retry','ready') or exists(select 1 from media_renditions.attempts a where a.job_id=j.id and
   (not a.cleanup_done or exists(select 1 from storage.objects o where o.bucket_id='adaptive-media' and starts_with(o.name,a.prefix))))))
$$;
create function private_hls.account_erasure_changed() returns trigger language plpgsql security definer set search_path='' as $$
declare j record;uid uuid;begin
 uid:=coalesce(new.user_id,case when tg_op='UPDATE' then old.user_id end);
 if uid is null then return new;end if;
 if new.state='completed' and not private_hls.owner_erasure_ready(uid) then raise exception 'CHAT_DERIVATIVE_ERASURE_PENDING';end if;
 if new.state<>'completed' then
  for j in select id from media_renditions.jobs where source_owner=uid and source_bucket in ('chat-media','chat-files') and state in ('pending','processing','retry','ready') loop perform media_renditions.cancel(j.id,'account_erasure');end loop;
  update private_hls.grants set closed_at=coalesce(closed_at,clock_timestamp()) where source_owner=uid or user_id=uid;
 end if;return new;
end $$;
do $$begin
 if to_regclass('account_erasure.jobs') is not null then execute 'create trigger private_hls_account_erasure before insert or update on account_erasure.jobs for each row execute function private_hls.account_erasure_changed()';end if;
end $$;
revoke all on all functions in schema private_hls from public,anon,authenticated,service_role;
revoke all on function public.open_chat_hls_v1(uuid,uuid),public.read_chat_hls_v1(uuid,uuid,text,uuid,text),public.close_chat_hls_v1(uuid,uuid) from public,anon,service_role;
grant execute on function public.open_chat_hls_v1(uuid,uuid),public.read_chat_hls_v1(uuid,uuid,text,uuid,text),public.close_chat_hls_v1(uuid,uuid) to authenticated;
revoke all on function public.backfill_chat_hls_v1(uuid,integer,boolean) from public,anon,authenticated;
grant execute on function public.backfill_chat_hls_v1(uuid,integer,boolean) to service_role;
notify pgrst,'reload schema';
commit;
