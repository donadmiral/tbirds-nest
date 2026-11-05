-- Complete only the missing legacy no-store reader installed on QA.
-- No grant rows are backfilled, consumed, renewed, or upgraded. Existing
-- signed-URL clients retain their original limited-view deadline.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $$begin
 if to_regnamespace('media_delivery') is null
  or to_regprocedure('media_delivery.require_session()') is null
  or to_regclass('public.chat_media_view_grants') is null
  or to_regprocedure('public.chat_media_manifest(uuid[])') is null
  or to_regprocedure('public.chat_object_path(text)') is null then
  raise exception 'Existing legacy delivery prerequisites are missing';
 end if;
 if to_regnamespace('private_media') is not null then
  raise exception 'Legacy reader cannot be installed after private-session cutover';
 end if;
end $$;
create table if not exists media_delivery.legacy_grants (
 user_id uuid not null references auth.users(id) on delete cascade,
 request_id uuid not null,
 message_id uuid not null,
 session_id uuid not null references auth.sessions(id) on delete cascade,
 object_id uuid not null,
 object_version text not null,
 object_owner text,
 bucket_id text not null,
 object_path text not null,
 source_url text not null,
 primary key(user_id,request_id),
 foreign key(user_id,request_id) references public.chat_media_view_grants(user_id,request_id) on delete cascade
);
alter table media_delivery.legacy_grants enable row level security;
revoke all on media_delivery.legacy_grants from public,anon,authenticated,service_role;
create or replace function media_delivery.bind_legacy_grant() returns trigger
language plpgsql security definer set search_path='' as $$
declare sid uuid:=media_delivery.require_session();m public.messages%rowtype;o storage.objects%rowtype;loc text;
begin
 if new.user_id is distinct from auth.uid() then raise exception 'MEDIA_SESSION_REQUIRED' using errcode='42501';end if;
 select * into m from public.messages where id=new.message_id and deleted_at is null and view_limit is not null;
 loc:=public.chat_object_path(m.media_url);
 if loc is null then raise exception 'MEDIA_OBJECT_UNAVAILABLE' using errcode='42501';end if;
 select * into o from storage.objects where bucket_id=split_part(loc,'/',1) and name=substring(loc from position('/' in loc)+1) and version is not null;
 if not found or (coalesce(o.owner_id,o.owner::text) is not null and coalesce(o.owner_id,o.owner::text)<>m.sender_id::text)
 then raise exception 'MEDIA_OBJECT_UNAVAILABLE' using errcode='42501';end if;
 insert into media_delivery.legacy_grants(user_id,request_id,message_id,session_id,object_id,object_version,object_owner,bucket_id,object_path,source_url)
 values(new.user_id,new.request_id,new.message_id,sid,o.id,o.version,coalesce(o.owner_id,o.owner::text),o.bucket_id,o.name,m.media_url);
 return null;
end $$;
revoke all on function media_delivery.bind_legacy_grant() from public,anon,authenticated,service_role;
drop trigger if exists bind_legacy_media_delivery on public.chat_media_view_grants;
create trigger bind_legacy_media_delivery after insert on public.chat_media_view_grants
 for each row execute function media_delivery.bind_legacy_grant();

create or replace function public.read_legacy_chat_media(p_message_id uuid,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare sid uuid:=media_delivery.require_session();g public.chat_media_view_grants%rowtype;m public.messages%rowtype;bound media_delivery.legacy_grants%rowtype;
begin
 if to_regnamespace('private_media') is not null then return null;end if;
 select * into g from public.chat_media_view_grants where user_id=auth.uid() and request_id=p_request_id
  and message_id=p_message_id and expires_at>clock_timestamp();
 if not found then return null;end if;
 select * into m from public.messages where id=p_message_id and deleted_at is null and media_type in ('image','video') and view_limit is not null;
 if not found or not exists(select 1 from public.chat_media_manifest(array[p_message_id]) a where a.id=m.id and a.media_url=m.media_url) then return null;end if;
 select * into bound from media_delivery.legacy_grants b where b.user_id=auth.uid() and b.request_id=p_request_id
  and b.message_id=p_message_id and b.session_id=sid and b.source_url=m.media_url;
 if not found or not exists(select 1 from storage.objects o where o.id=bound.object_id and o.version=bound.object_version
  and o.bucket_id=bound.bucket_id and o.name=bound.object_path and coalesce(o.owner_id,o.owner::text) is not distinct from bound.object_owner) then return null;end if;
 return jsonb_build_object('url',m.media_url,'mediaType',m.media_type,'expiresAt',g.expires_at,'requestId',g.request_id,'objectVersion',bound.object_version);
end $$;
create or replace function public.close_legacy_chat_media(p_message_id uuid,p_request_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 perform media_delivery.require_session();
 update public.chat_media_view_grants set expires_at=least(expires_at,clock_timestamp())
  where user_id=auth.uid() and request_id=p_request_id and message_id=p_message_id;
 return found;
end $$;
revoke all on function public.read_legacy_chat_media(uuid,uuid),public.close_legacy_chat_media(uuid,uuid) from public,anon,service_role;
grant execute on function public.read_legacy_chat_media(uuid,uuid),public.close_legacy_chat_media(uuid,uuid) to authenticated;

notify pgrst,'reload schema';
commit;
