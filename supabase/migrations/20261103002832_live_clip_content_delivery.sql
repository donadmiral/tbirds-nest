-- Preserve the deployed content authorization implementations. Extend only
-- live-clips references through exact publication and source authorization.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $guard$ begin
 if to_regnamespace('live_streams') is null or to_regclass('media_delivery.tickets') is null
  or to_regprocedure('public.content_media_manifest(jsonb)') is null
  or to_regprocedure('public.issue_content_media_delivery(jsonb,jsonb)') is null
  or to_regprocedure('public.content_media_document(text,uuid)') is null then
  raise exception 'LIVE_CLIP_MEDIA_PREREQUISITES_REQUIRED';
 end if;
 if to_regprocedure('live_streams.content_manifest_base_v1(jsonb)') is not null
  or to_regprocedure('live_streams.issue_content_base_v1(jsonb,jsonb)') is not null then
  raise exception 'LIVE_CLIP_MEDIA_ALREADY_INSTALLED';
 end if;
end $guard$;
-- Channel clip tickets use the same current-channel ACL as their publication.
do $ticket_kinds$ declare existing text;begin
 select pg_get_expr(conbin,conrelid) into existing from pg_constraint
  where conrelid='media_delivery.tickets'::regclass and conname='tickets_source_kind_check' and contype='c';
 if existing is null then raise exception 'LIVE_TICKET_KIND_CONTRACT_CHANGED';end if;
 alter table media_delivery.tickets drop constraint tickets_source_kind_check;
 execute format('alter table media_delivery.tickets add constraint tickets_source_kind_check check ((%s) or source_kind=''channel_message'')',existing);
end $ticket_kinds$;
alter function public.content_media_manifest(jsonb) set schema live_streams;
alter function live_streams.content_media_manifest(jsonb) rename to content_manifest_base_v1;
alter function public.issue_content_media_delivery(jsonb,jsonb) set schema live_streams;
alter function live_streams.issue_content_media_delivery(jsonb,jsonb) rename to issue_content_base_v1;
revoke all on function live_streams.content_manifest_base_v1(jsonb),live_streams.issue_content_base_v1(jsonb,jsonb)
 from public,anon,authenticated,service_role;

create function public.content_media_manifest(p_references jsonb)
returns table(entity_kind text,entity_id uuid,media_url text)
language plpgsql stable security definer set search_path='' as $$
declare r record;uri text;loc text[];access jsonb;document jsonb;
begin
 if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'Authentication required' using errcode='42501';end if;
 if jsonb_typeof(p_references) is distinct from 'array' or jsonb_array_length(p_references)>100 then raise exception 'At most 100 content references' using errcode='22023';end if;
 return query select * from live_streams.content_manifest_base_v1(p_references);
 for r in select distinct x.kind,x.id from jsonb_to_recordset(p_references)x(kind text,id uuid) where x.kind in ('post','story','channel_message') loop
  if r.kind='channel_message' then
   select jsonb_build_object('media_url',m.media_url) into document from public.channel_messages m where m.id=r.id;
  else document:=public.content_media_document(r.kind,r.id);end if;
  for uri in select public.content_media_strings(document) loop
   loc:=regexp_match(uri,'^https://[^/]+/storage/v1/object/public/(live-clips)/([^?#]+)$');
   if loc is null or length(loc[2])>1024 or loc[2] ~ '(%|\\|(^|/)\.\.?(/|$)|//)' then continue;end if;
   access:=live_streams.clip_reference_access(loc[1],loc[2],r.kind,r.id,auth.uid());
   if coalesce((access->>'allowed')::boolean,false) then
    entity_kind:=r.kind;entity_id:=r.id;media_url:=uri;return next;
   end if;
  end loop;
 end loop;
end $$;
revoke all on function public.content_media_manifest(jsonb) from public,anon;
grant execute on function public.content_media_manifest(jsonb) to authenticated,service_role;

create function live_streams.issue_clip_content(p_url text,p_kind text,p_content uuid,p_session uuid)
returns table(bucket_id text,object_path text,token text,expires_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare loc text[];asset storage.objects;capability text;deadline timestamptz:=clock_timestamp()+interval '5 minutes';access jsonb;
begin
 loc:=regexp_match(p_url,'^https://[^/]+/storage/v1/object/public/(live-clips)/([^?#]+)$');
 if loc is null or length(loc[2])>1024 or loc[2] ~ '(%|\\|(^|/)\.\.?(/|$)|//)' then return;end if;
 access:=live_streams.clip_reference_access(loc[1],loc[2],p_kind,p_content,auth.uid());
 if not coalesce((access->>'allowed')::boolean,false) then return;end if;
 select * into asset from storage.objects where storage.objects.bucket_id='live-clips' and name=loc[2] and version is not null;
 if not found then return;end if;
 capability:=encode(extensions.gen_random_bytes(32),'hex');
 insert into media_delivery.tickets(token_digest,user_id,session_id,object_id,object_version,object_owner,bucket_id,object_path,source_kind,source_id,source_url,expires_at)
 values(extensions.digest(capability,'sha256'),auth.uid(),p_session,asset.id,asset.version,coalesce(asset.owner_id,asset.owner::text),asset.bucket_id,asset.name,p_kind,p_content,p_url,deadline);
 return query select asset.bucket_id,asset.name,capability,deadline;
end $$;
revoke all on function live_streams.issue_clip_content(text,text,uuid,uuid) from public,anon,authenticated,service_role;

create function public.issue_content_media_delivery(p_references jsonb default null,p_uploads jsonb default null)
returns table(bucket_id text,object_path text,token text,expires_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare sid uuid;r record;total integer:=0;
begin
 -- Existing issuance performs session, readiness, input and cleanup checks.
 return query select * from live_streams.issue_content_base_v1(p_references,p_uploads);
 if p_references is null then return;end if;
 sid:=media_delivery.require_session();
 for r in select * from public.content_media_manifest(p_references) where media_url like '%/storage/v1/object/public/live-clips/%' loop
  total:=total+1;if total>2000 then raise exception 'Too many media references';end if;
  return query select * from live_streams.issue_clip_content(r.media_url,r.entity_kind,r.entity_id,sid);
 end loop;
end $$;
revoke all on function public.issue_content_media_delivery(jsonb,jsonb) from public,anon,service_role;
grant execute on function public.issue_content_media_delivery(jsonb,jsonb) to authenticated;
-- resolve_media_delivery retains object version/session checks and re-evaluates
-- the public manifest on every media request, including source/clip revocation.
notify pgrst,'reload schema';
commit;
