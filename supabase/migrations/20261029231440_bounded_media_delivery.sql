-- New clients request noncached delivery explicitly. Existing signed-URL
-- clients remain compatible until the reviewed minimum-client cutover.
begin;
set local lock_timeout='3s';
create schema media_delivery;
revoke all on schema media_delivery from public,anon,authenticated,service_role;
create table media_delivery.tickets (
 token_digest bytea primary key check(octet_length(token_digest)=32),
 user_id uuid not null references auth.users(id) on delete cascade,
 session_id uuid not null references auth.sessions(id) on delete cascade,
 object_id uuid not null,
 object_version text not null,
 object_owner text,
 bucket_id text not null,
 object_path text not null,
 source_kind text not null check(source_kind in ('post','story','sound','story_draft','memory_album','highlight','upload','chat','chat_object')),
 source_id uuid,
 source_url text not null,
 expires_at timestamptz not null,
 created_at timestamptz not null default clock_timestamp()
);
create index media_delivery_ticket_expiry on media_delivery.tickets(expires_at);
create index media_delivery_ticket_session on media_delivery.tickets(session_id);
alter table media_delivery.tickets enable row level security;
revoke all on media_delivery.tickets from public,anon,authenticated,service_role;

create function media_delivery.require_session() returns uuid
language plpgsql stable security definer set search_path='' as $$
declare session_id uuid;
begin
 if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'MEDIA_SESSION_REQUIRED' using errcode='42501'; end if;
 begin session_id:=(auth.jwt()->>'session_id')::uuid;exception when others then session_id:=null;end;
 if not exists(select 1 from auth.sessions s join auth.users u on u.id=s.user_id where s.id=session_id
  and s.user_id=auth.uid() and (s.not_after is null or s.not_after>clock_timestamp()) and u.deleted_at is null
  and (u.banned_until is null or u.banned_until<=clock_timestamp())) then raise exception 'MEDIA_SESSION_REQUIRED' using errcode='42501'; end if;
 return session_id;
end $$;
revoke all on function media_delivery.require_session() from public,anon,authenticated,service_role;

-- A stale binding must never authorize a newly replaced object owned by a
-- different account. Legacy snapshots remain read provenance, not ownership.
create function media_delivery.content_provenance(p_kind text,p_id uuid,p_url text,p_bucket text,p_path text,p_owner text) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare author_id uuid;
begin
 if p_kind='post' then select user_id into author_id from public.posts where id=p_id;
 elsif p_kind='story' then select user_id into author_id from public.stories where id=p_id;
 elsif p_kind='story_draft' then select user_id into author_id from public.story_drafts where id=p_id;
 elsif p_kind='sound' then select owner_id into author_id from public.story_sounds where id=p_id;
 elsif p_kind='memory_album' then select user_id into author_id from public.memory_albums where id=p_id;
 elsif p_kind='highlight' then select user_id into author_id from public.story_highlights where id=p_id;
 end if;
 if author_id is null then return false;end if;
 return exists(select 1 from public.content_media_bindings b where b.entity_kind=p_kind and b.entity_id=p_id
   and b.bucket_id=p_bucket and b.object_path=p_path and b.uploader_id::text=p_owner)
  or (p_kind='memory_album' and exists(select 1 from public.memory_pages mp
   join public.stories st on st.id=mp.story_id and st.user_id=author_id
   join public.content_media_bindings b on b.entity_kind='story' and b.entity_id=st.id
   where mp.album_id=p_id and b.bucket_id=p_bucket and b.object_path=p_path and b.uploader_id::text=p_owner))
  or (p_kind='highlight' and (
   exists(select 1 from public.story_highlights h where h.id=p_id and h.cover_url=p_url and h.user_id::text=p_owner)
   or exists(select 1 from public.story_highlight_items hi
    join public.stories st on st.id=hi.story_id and st.user_id=author_id
    join public.content_media_bindings b on b.entity_kind='story' and b.entity_id=st.id
    where hi.highlight_id=p_id and b.bucket_id=p_bucket and b.object_path=p_path and b.uploader_id::text=p_owner)))
  or content_media_legacy.allows_read(p_kind,p_id,author_id,p_url,p_bucket,p_path);
end $$;
revoke all on function media_delivery.content_provenance(text,uuid,text,text,text,text) from public,anon,authenticated,service_role;

create function media_delivery.issue(p_url text,p_kind text,p_id uuid,p_session uuid)
returns table(bucket_id text,object_path text,token text,expires_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare loc text[];o storage.objects%rowtype; capability text; deadline timestamptz:=clock_timestamp()+interval '5 minutes';
begin
 loc:=regexp_match(p_url,'^https://[^/]+/storage/v1/object/public/(post-media|story-media|media|chat-media|chat-files)/([^?#]+)(?:[?]t=[0-9]+)?$');
 if loc is null or loc[2] ~ '(%|\\|(^|/)\.\.?(/|$)|//)' or length(loc[2])>1024 then return;end if;
 select * into o from storage.objects s where s.bucket_id=loc[1] and s.name=loc[2] and s.version is not null;
 if not found then return;end if;
 if p_kind not in ('upload','chat','chat_object') and not media_delivery.content_provenance(p_kind,p_id,p_url,o.bucket_id,o.name,coalesce(o.owner_id,o.owner::text)) then return;end if;
 capability:=encode(extensions.gen_random_bytes(32),'hex');
 insert into media_delivery.tickets(token_digest,user_id,session_id,object_id,object_version,object_owner,bucket_id,object_path,source_kind,source_id,source_url,expires_at)
 values(extensions.digest(capability,'sha256'),auth.uid(),p_session,o.id,o.version,coalesce(o.owner_id,o.owner::text),o.bucket_id,o.name,p_kind,p_id,p_url,deadline);
 return query select o.bucket_id,o.name,capability,deadline;
end $$;
revoke all on function media_delivery.issue(text,text,uuid,uuid) from public,anon,authenticated,service_role;

create function public.issue_content_media_delivery(p_references jsonb default null,p_uploads jsonb default null)
returns table(bucket_id text,object_path text,token text,expires_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare sid uuid:=media_delivery.require_session();r record;counted integer:=0;
begin
 if (p_references is null)=(p_uploads is null) then raise exception 'Choose content or upload references';end if;
 delete from media_delivery.tickets where tickets.expires_at<clock_timestamp()-interval '5 minutes';
 if p_references is not null then
  for r in select * from public.content_media_manifest(p_references) loop
   counted:=counted+1;if counted>2000 then raise exception 'Too many media references';end if;
   return query select * from media_delivery.issue(r.media_url,r.entity_kind,r.entity_id,sid);
  end loop;
 else
  if jsonb_typeof(p_uploads) is distinct from 'array' or jsonb_array_length(p_uploads) not between 1 and 100 then raise exception 'At most 100 upload references';end if;
  for r in select * from public.content_upload_manifest(p_uploads) loop
   return query select * from media_delivery.issue(r.media_url,'upload',null,sid);
  end loop;
 end if;
end $$;
revoke all on function public.issue_content_media_delivery(jsonb,jsonb) from public,anon,service_role;
grant execute on function public.issue_content_media_delivery(jsonb,jsonb) to authenticated;

create function public.issue_chat_media_delivery(p_message_ids uuid[])
returns table(message_id uuid,media_url text,bucket_id text,object_path text,token text,expires_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare sid uuid:=media_delivery.require_session();r record;u text;
begin
 delete from media_delivery.tickets where tickets.expires_at<clock_timestamp()-interval '5 minutes';
 for r in select * from public.chat_media_manifest(p_message_ids) where view_limit is null loop
  for u in select distinct x from unnest(array[r.media_url,r.thumbnail_url]) x where x is not null loop
   return query select r.id,u,t.* from media_delivery.issue(u,'chat',r.id,sid) t;
  end loop;
 end loop;
end $$;
revoke all on function public.issue_chat_media_delivery(uuid[]) from public,anon,service_role;
grant execute on function public.issue_chat_media_delivery(uuid[]) to authenticated;

create function public.issue_chat_object_delivery(p_urls text[])
returns table(bucket_id text,object_path text,token text,expires_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare sid uuid:=media_delivery.require_session();u text;loc text; b text;p text;
begin
 if cardinality(p_urls) not between 1 and 100 then raise exception 'At most 100 references';end if;
 delete from media_delivery.tickets where tickets.expires_at<clock_timestamp()-interval '5 minutes';
 for u in select distinct unnest(p_urls) loop
  loc:=public.chat_object_path(u);if loc is null then continue;end if;
  b:=split_part(loc,'/',1);p:=substring(loc from position('/' in loc)+1);
  if exists(select 1 from storage.objects o where o.bucket_id=b and o.name=p and coalesce(o.owner_id,o.owner::text)=auth.uid()::text)
   or (public.chat_locator_unrestricted(loc) and (public.can_read_chat_object(b,p) or public.can_read_legacy_chat_object(b,p))) then
   return query select * from media_delivery.issue(u,'chat_object',null,sid);
  end if;
 end loop;
end $$;
revoke all on function public.issue_chat_object_delivery(text[]) from public,anon,service_role;
grant execute on function public.issue_chat_object_delivery(text[]) to authenticated;

-- Only the byte proxy may redeem a ticket. Recheck the real session, current
-- object/version and original audience on every request, including range reads.
-- Claims are temporarily set to the stored, verified viewer for existing
-- authorization functions, then restored before this service RPC returns.
create function public.resolve_media_delivery(p_token text,p_bucket text,p_path text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare g media_delivery.tickets%rowtype; allowed boolean:=false;
 old_sub text:=coalesce(current_setting('request.jwt.claim.sub',true),'');
 old_role text:=coalesce(current_setting('request.jwt.claim.role',true),'');
 old_claims text:=coalesce(current_setting('request.jwt.claims',true),'');
begin
 if p_token is null or p_token !~ '^[0-9a-f]{64}$' then return null;end if;
 select * into g from media_delivery.tickets where token_digest=extensions.digest(p_token,'sha256')
  and bucket_id=p_bucket and object_path=p_path and expires_at>clock_timestamp();
 if not found or not exists(select 1 from auth.sessions s join auth.users u on u.id=s.user_id where s.id=g.session_id and s.user_id=g.user_id
  and (s.not_after is null or s.not_after>clock_timestamp()) and u.deleted_at is null and (u.banned_until is null or u.banned_until<=clock_timestamp()))
  or not exists(select 1 from storage.objects o where o.id=g.object_id and o.bucket_id=g.bucket_id and o.name=g.object_path
   and o.version=g.object_version and coalesce(o.owner_id,o.owner::text) is not distinct from g.object_owner) then return null;end if;
 perform set_config('request.jwt.claim.sub',g.user_id::text,true),set_config('request.jwt.claim.role','authenticated',true),
  set_config('request.jwt.claims',jsonb_build_object('sub',g.user_id,'role','authenticated','session_id',g.session_id,'is_anonymous',false)::text,true);
 if g.source_kind='upload' then
  select exists(select 1 from public.content_upload_manifest(jsonb_build_array(g.source_url)) m where m.media_url=g.source_url) into allowed;
 elsif g.source_kind='chat' then
  select exists(select 1 from public.chat_media_manifest(array[g.source_id]) m where m.view_limit is null and g.source_url in(m.media_url,m.thumbnail_url)) into allowed;
 elsif g.source_kind='chat_object' then
  allowed:=g.object_owner=g.user_id::text or (public.chat_locator_unrestricted(g.bucket_id||'/'||g.object_path)
   and (public.can_read_chat_object(g.bucket_id,g.object_path) or public.can_read_legacy_chat_object(g.bucket_id,g.object_path)));
 else
  select exists(select 1 from public.content_media_manifest(jsonb_build_array(jsonb_build_object('kind',g.source_kind,'id',g.source_id))) m where m.media_url=g.source_url) into allowed;
 end if;
 perform set_config('request.jwt.claim.sub',old_sub,true),set_config('request.jwt.claim.role',old_role,true),set_config('request.jwt.claims',old_claims,true);
 if not coalesce(allowed,false) then return null;end if;
 return jsonb_build_object('bucket',g.bucket_id,'path',g.object_path,'version',g.object_version,'expiresAt',g.expires_at);
exception when others then
 perform set_config('request.jwt.claim.sub',old_sub,true),set_config('request.jwt.claim.role',old_role,true),set_config('request.jwt.claims',old_claims,true);
 return null;
end $$;
revoke all on function public.resolve_media_delivery(text,text,text) from public,anon,authenticated;
grant execute on function public.resolve_media_delivery(text,text,text) to service_role;

-- The existing consume counter, request ID and deadline remain authoritative.
-- Record exact bytes and session on grant insertion; a second device, replaced
-- object, closed grant or revoked session cannot replay this private viewer.
create table media_delivery.legacy_grants (
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
create function media_delivery.bind_legacy_grant() returns trigger
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
create trigger bind_legacy_media_delivery after insert on public.chat_media_view_grants
 for each row execute function media_delivery.bind_legacy_grant();

create function public.read_legacy_chat_media(p_message_id uuid,p_request_id uuid) returns jsonb
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
create function public.close_legacy_chat_media(p_message_id uuid,p_request_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 perform media_delivery.require_session();
 update public.chat_media_view_grants set expires_at=least(expires_at,clock_timestamp())
  where user_id=auth.uid() and request_id=p_request_id and message_id=p_message_id;
 return found;
end $$;
revoke all on function public.read_legacy_chat_media(uuid,uuid),public.close_legacy_chat_media(uuid,uuid) from public,anon,service_role;
grant execute on function public.read_legacy_chat_media(uuid,uuid),public.close_legacy_chat_media(uuid,uuid) to authenticated;

-- The admin server independently verifies current staff/assurance/permission.
-- Only its configured Supabase origin is accepted; an arbitrary-host path in a
-- user-edited publication cannot become a privileged Storage request.
create function media_delivery.admin_content_references(p_kind text,p_entity_ids uuid[],p_origin text)
returns table(entity_id uuid,bucket_id text,object_path text,object_id uuid,object_version text)
language sql stable security definer set search_path='' as $$
 with entities as materialized (
  select p.id,p.user_id author_id,p.created_at published_at from public.posts p
   where p_kind='post' and p.id=any(p_entity_ids)
  union all
  select s.id,s.user_id,s.created_at from public.stories s
   where p_kind='story' and s.id=any(p_entity_ids)
 ), urls as (
  select e.*,u.url from entities e
   cross join lateral public.content_media_strings(public.content_media_document(p_kind,e.id)) u(url)
 ), located as (
  select u.*,regexp_match(substring(u.url from length(p_origin)+1),
   '^/storage/v1/object/public/(post-media|story-media|media)/([^?#]+)(?:[?]t=[0-9]+)?$') loc
  from urls u where starts_with(u.url,p_origin||'/')
 )
 select distinct l.id,o.bucket_id,o.name,o.id,o.version
 from located l join storage.objects o on o.bucket_id=l.loc[1] and o.name=l.loc[2]
 where o.version is not null and length(o.name) between 1 and 1024
  and o.name !~ '(%|\\|(^|/)\.\.?(/|$)|//|^[ /]|/$|[[:cntrl:]])'
  and (
   exists(select 1 from public.content_media_bindings b where b.entity_kind=p_kind and b.entity_id=l.id
    and b.bucket_id=o.bucket_id and b.object_path=o.name and b.uploader_id::text=coalesce(o.owner_id,o.owner::text))
   or exists(select 1 from content_media_legacy.snapshots s where s.entity_kind=p_kind and s.entity_id=l.id
    and s.author_id=l.author_id and s.publication_created_at=l.published_at and s.object_id=o.id and s.object_version=o.version
    and s.bucket_id=o.bucket_id and s.object_path=o.name and s.canonical_url=l.url and s.revoked_at is null
    and (coalesce(o.owner_id,o.owner::text) is null or coalesce(o.owner_id,o.owner::text)=l.author_id::text))
  );
$$;
revoke all on function media_delivery.admin_content_references(text,uuid[],text) from public,anon,authenticated,service_role;

create function public.admin_bound_content_media_object(p_kind text,p_entity_id uuid,p_bucket text,p_path text,p_origin text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if p_kind is null or p_kind not in ('post','story') or p_entity_id is null
  or p_bucket is null or p_bucket not in ('post-media','story-media','media')
  or p_origin is null or p_origin !~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?$'
  or p_path is null or length(p_path) not between 1 and 1024
  or p_path ~ '(%|\\|(^|/)\.\.?(/|$)|//|^/|/$|[[:cntrl:]])' then return null;end if;
 select jsonb_build_object('object_id',r.object_id,'object_version',r.object_version) into result
  from media_delivery.admin_content_references(p_kind,array[p_entity_id],p_origin) r
  where r.bucket_id=p_bucket and r.object_path=p_path;
 return result;
end $$;
revoke all on function public.admin_bound_content_media_object(text,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.admin_bound_content_media_object(text,uuid,text,text,text) to service_role;

-- One bounded query covers bound uploads and reviewed legacy objects alike.
-- Overflow is an explicit failure, never a silently truncated moderation desk.
create function public.admin_bound_content_media_manifest(p_kind text,p_entity_ids uuid[],p_origin text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if p_kind is null or p_kind not in ('post','story') or p_entity_ids is null
  or cardinality(p_entity_ids) not between 1 and 200 or array_position(p_entity_ids,null) is not null
  or p_origin is null or p_origin !~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?$'
 then raise exception 'ADMIN_MEDIA_INVALID_REFERENCE' using errcode='22023';end if;
 select coalesce(jsonb_agg(jsonb_build_object('entity_id',r.entity_id,'bucket_id',r.bucket_id,'object_path',r.object_path)
   order by r.entity_id,r.bucket_id,r.object_path),'[]'::jsonb) into result
 from (select * from media_delivery.admin_content_references(p_kind,p_entity_ids,p_origin)
  order by entity_id,bucket_id,object_path limit 4001) r;
 if jsonb_array_length(result)>4000 then raise exception 'ADMIN_MEDIA_TOO_LARGE' using errcode='54000';end if;
 return result;
end $$;
revoke all on function public.admin_bound_content_media_manifest(text,uuid[],text) from public,anon,authenticated;
grant execute on function public.admin_bound_content_media_manifest(text,uuid[],text) to service_role;
notify pgrst,'reload schema';
commit;
