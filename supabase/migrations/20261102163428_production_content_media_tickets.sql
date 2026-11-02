-- Additive content tickets on the inspected visual production baseline.
-- Does not replace any existing public function, Storage policy, bucket flag,
-- account deletion, login or chat contract. Ticket issuance defaults OFF.
-- Existing canonical/full media_delivery installations (including QA) are
-- deliberately refused, never overwritten. Reconcile forward as documented in
-- supabase/ops/production-content-media-tickets-20261102/README.md.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $preflight$
declare expected record; baseline jsonb;
begin
 if current_user<>'postgres' then raise exception 'CONTENT_TICKETS_POSTGRES_REQUIRED';end if;
 if to_regnamespace('media_delivery') is not null
  or to_regprocedure('public.issue_content_media_delivery(jsonb,jsonb)') is not null
  or to_regprocedure('public.resolve_media_delivery(text,text,text)') is not null then
  raise exception 'CONTENT_TICKETS_EXISTING_DELIVERY_REQUIRES_FORWARD_RECONCILIATION';end if;
 if to_regnamespace('business_auth') is not null then
  raise exception 'CONTENT_TICKETS_BUSINESS_AUTH_REQUIRES_FORWARD_RECONCILIATION';end if;
 for expected in select * from(values
  ('public.content_media_manifest(jsonb)','820e23b8bc5ba91b71b0a32997df6911','{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
  ('public.content_upload_manifest(jsonb)','73627c8916f1a8b8116ab37af16c0c28','{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
  ('content_media_legacy.allows_read(text,uuid,uuid,text,text,text)','79a6d0c6dfa89facfdb96da2cd10e56a','{postgres=X/postgres}')
 )v(signature,source_md5,acl) loop
  if not exists(select 1 from pg_proc p where p.oid=to_regprocedure(expected.signature)
   and md5(p.prosrc)=expected.source_md5 and p.proowner='postgres'::regrole and p.prosecdef
   and p.proconfig=array['search_path=""']::text[]
   and (select array_agg(a::text order by a::text) from unnest(p.proacl)a)
    =(select array_agg(a::text order by a::text) from unnest(expected.acl::aclitem[])a)) then
   raise exception 'CONTENT_TICKETS_CANONICAL_BASELINE_CHANGED: %',expected.signature;end if;
 end loop;
 if to_regprocedure('auth.uid()') is null or to_regprocedure('auth.jwt()') is null
  or to_regprocedure('extensions.digest(text,text)') is null or to_regprocedure('extensions.gen_random_bytes(integer)') is null
  or to_regclass('public.content_media_bindings') is null or to_regclass('content_media_legacy.snapshots') is null
 then raise exception 'CONTENT_TICKETS_CANONICAL_PREREQUISITES_REQUIRED';end if;
 if exists(select 1 from(values
  ('auth.users','id','uuid'),('auth.users','deleted_at','timestamp with time zone'),
  ('auth.users','banned_until','timestamp with time zone'),('auth.sessions','id','uuid'),
  ('auth.sessions','user_id','uuid'),('auth.sessions','not_after','timestamp with time zone')
 )v(relation_name,column_name,type_name) where not exists(select 1 from pg_attribute a
  where a.attrelid=to_regclass(v.relation_name) and a.attname=v.column_name and not a.attisdropped
   and format_type(a.atttypid,a.atttypmod)=v.type_name)) then
  raise exception 'CONTENT_TICKETS_AUTH_COLUMNS_REQUIRED';end if;
 select jsonb_build_object(
 'public_functions',(select md5(string_agg(p.oid::regprocedure::text||pg_get_functiondef(p.oid)||coalesce(p.proacl::text,''),E'\n' order by p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f' and p.proname not in ('issue_content_media_delivery','resolve_media_delivery')),
 'auth_functions',(select md5(string_agg(p.oid::regprocedure::text||pg_get_functiondef(p.oid)||coalesce(p.proacl::text,''),E'\n' order by p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='auth' and p.prokind='f'),
 'storage_policies',(select coalesce(jsonb_agg(jsonb_build_object('name',polname,'relation',polrelid::regclass::text,'permissive',polpermissive,'roles',polroles,'command',polcmd,'using',pg_get_expr(polqual,polrelid),'check',pg_get_expr(polwithcheck,polrelid)) order by polrelid,polname),'[]') from pg_policy where polrelid in ('storage.objects'::regclass,'storage.buckets'::regclass)),
 'bucket_visibility',(select jsonb_agg(jsonb_build_object('id',id,'public',public) order by id) from storage.buckets)
) into baseline;
 perform set_config('platinum.content_ticket_baseline',baseline::text,true);
end $preflight$;
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
 source_kind text not null check(source_kind in ('post','story','sound','story_draft','memory_album','highlight','upload')),
 source_id uuid,
 source_url text not null,
 expires_at timestamptz not null,
 created_at timestamptz not null default clock_timestamp()
);
create index media_delivery_ticket_expiry on media_delivery.tickets(expires_at,token_digest);
create index media_delivery_ticket_session on media_delivery.tickets(session_id);
alter table media_delivery.tickets enable row level security;
revoke all on media_delivery.tickets from public,anon,authenticated,service_role;

create table media_delivery.prerequisite_settings (
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false
);
insert into media_delivery.prerequisite_settings(singleton) values(true);
alter table media_delivery.prerequisite_settings enable row level security;
revoke all on media_delivery.prerequisite_settings from public,anon,authenticated,service_role;
-- The Auth user foreign key must not require a scan of the whole ticket table.
create index media_delivery_ticket_user on media_delivery.tickets(user_id);

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
 loc:=regexp_match(p_url,'^https://[^/]+/storage/v1/object/public/(post-media|story-media|media)/([^?#]+)(?:[?]t=[0-9]+)?$');
 if loc is null or loc[2] ~ '(%|\\|(^|/)\.\.?(/|$)|//)' or length(loc[2])>1024 then return;end if;
 select * into o from storage.objects s where s.bucket_id=loc[1] and s.name=loc[2] and s.version is not null;
 if not found then return;end if;
 if p_kind<>'upload' and not media_delivery.content_provenance(p_kind,p_id,p_url,o.bucket_id,o.name,coalesce(o.owner_id,o.owner::text)) then return;end if;
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
 cleanup_before timestamptz:=clock_timestamp()-interval '5 minutes';
begin
 if not exists(select 1 from media_delivery.prerequisite_settings where singleton and enabled) then
  raise exception 'MEDIA_CONTENT_DELIVERY_NOT_READY' using errcode='55000';end if;
 if (p_references is null)=(p_uploads is null) then raise exception 'Choose content or upload references';end if;
 -- Cleanup stays bounded even after an idle period or a backlog.
 with expired as(select stale.token_digest from media_delivery.tickets stale
  where stale.expires_at<cleanup_before
  order by stale.expires_at,stale.token_digest limit 2000 for update skip locked)
 delete from media_delivery.tickets t using expired e where t.token_digest=e.token_digest;
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

create function public.resolve_media_delivery(p_token text,p_bucket text,p_path text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare g media_delivery.tickets%rowtype; allowed boolean:=false;
 old_sub text:=coalesce(current_setting('request.jwt.claim.sub',true),'');
 old_role text:=coalesce(current_setting('request.jwt.claim.role',true),'');
 old_claims text:=coalesce(current_setting('request.jwt.claims',true),'');
begin
 if not exists(select 1 from media_delivery.prerequisite_settings where singleton and enabled) then return null;end if;
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

do $preservation$
declare baseline jsonb;
begin
 select jsonb_build_object(
 'public_functions',(select md5(string_agg(p.oid::regprocedure::text||pg_get_functiondef(p.oid)||coalesce(p.proacl::text,''),E'\n' order by p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f' and p.proname not in ('issue_content_media_delivery','resolve_media_delivery')),
 'auth_functions',(select md5(string_agg(p.oid::regprocedure::text||pg_get_functiondef(p.oid)||coalesce(p.proacl::text,''),E'\n' order by p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='auth' and p.prokind='f'),
 'storage_policies',(select coalesce(jsonb_agg(jsonb_build_object('name',polname,'relation',polrelid::regclass::text,'permissive',polpermissive,'roles',polroles,'command',polcmd,'using',pg_get_expr(polqual,polrelid),'check',pg_get_expr(polwithcheck,polrelid)) order by polrelid,polname),'[]') from pg_policy where polrelid in ('storage.objects'::regclass,'storage.buckets'::regclass)),
 'bucket_visibility',(select jsonb_agg(jsonb_build_object('id',id,'public',public) order by id) from storage.buckets)
) into baseline;
 if baseline is distinct from current_setting('platinum.content_ticket_baseline')::jsonb then
  raise exception 'CONTENT_TICKETS_EXISTING_CONTRACT_CHANGED';end if;
 if exists(select 1 from media_delivery.prerequisite_settings where enabled)
  or exists(select 1 from media_delivery.tickets) then raise exception 'CONTENT_TICKETS_UNEXPECTED_ACTIVATION';end if;
end $preservation$;
notify pgrst,'reload schema';
commit;
